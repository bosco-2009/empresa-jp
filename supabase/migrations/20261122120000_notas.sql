-- =====================================================================================
-- Melhoria 27: notas internas do dono em cada conversa e em cada pedido.
-- ADITIVA: só cria a tabela public.notas e a função public.nota_salvar. Nada existente muda.
--
-- Segurança:
--   * Só admin (eh_admin()) lê, pelo RLS. anon nunca acessa (nem tabela, nem função).
--   * Ninguém escreve direto na tabela: a gravação passa por nota_salvar (security definer,
--     search_path vazio), que confere eh_admin(), valida o alvo e o tamanho e detecta edição
--     concorrente (outro aparelho/aba) pelo atualizado_em que o painel viu por último.
--   * Uma nota por conversa e uma por pedido (unique). Apagar a conversa/pedido apaga a nota (cascade).
--
-- Depende de: 20261118120000_chat_ao_vivo.sql (conversas, eh_admin) e 20261119120000_pedidos.sql (pedidos).
-- Idempotente.
-- =====================================================================================

create table if not exists public.notas (
  id             uuid primary key default gen_random_uuid(),
  conversa_id    uuid unique references public.conversas (id) on delete cascade,
  pedido_id      uuid unique references public.pedidos (id) on delete cascade,
  texto          text not null default '',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete set null,
  constraint notas_um_alvo check (num_nonnulls(conversa_id, pedido_id) = 1),
  constraint notas_texto_tamanho check (char_length(texto) <= 5000)
);

comment on table public.notas is
  'Anotações internas do dono (painel /admin/) sobre uma conversa ou um pedido. O visitante nunca vê.';

alter table public.notas enable row level security;

-- Defesa em profundidade: o front só lê; a escrita é pela função.
revoke all on public.notas from anon, authenticated;
grant select on public.notas to authenticated;

drop policy if exists notas_admin_ler on public.notas;
create policy notas_admin_ler on public.notas
  for select to authenticated
  using ((select public.eh_admin()));

-- -------------------------------------------------------------------------------------
-- nota_salvar: cria ou atualiza a nota de UMA conversa ou de UM pedido.
--   p_esperado: o atualizado_em que o painel carregou (null = "não havia nota").
--   p_forcar:   true grava mesmo que outra aba/aparelho tenha mudado a nota no meio tempo.
-- Erros:
--   42501 'acesso negado'            -> não é admin
--   22023 'informe uma conversa ou um pedido'
--   22001 'nota longa demais'        -> mais de 5000 caracteres
--   P0001 'nota_alterada'            -> mudou desde que o painel carregou (detail = atualizado_em atual)
--   23503 (FK)                       -> conversa/pedido inexistente
-- Devolve o novo atualizado_em (o painel guarda para a próxima gravação).
-- -------------------------------------------------------------------------------------
create or replace function public.nota_salvar(
  p_conversa_id uuid,
  p_pedido_id   uuid,
  p_texto       text,
  p_esperado    timestamptz default null,
  p_forcar      boolean default false
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_texto text := coalesce(p_texto, '');
  v_id    uuid;
  v_atual timestamptz;
  v_agora timestamptz := clock_timestamp();
begin
  if not public.eh_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if num_nonnulls(p_conversa_id, p_pedido_id) <> 1 then
    raise exception 'informe uma conversa ou um pedido' using errcode = '22023';
  end if;
  if char_length(v_texto) > 5000 then
    raise exception 'nota longa demais' using errcode = '22001';
  end if;

  select n.id, n.atualizado_em into v_id, v_atual
    from public.notas n
   where (p_conversa_id is not null and n.conversa_id = p_conversa_id)
      or (p_pedido_id   is not null and n.pedido_id   = p_pedido_id)
   for update;

  if v_id is not null then
    if not coalesce(p_forcar, false) and v_atual is distinct from p_esperado then
      raise exception 'nota_alterada' using detail = v_atual::text;
    end if;
    -- Garante que o novo carimbo seja sempre maior que o anterior (relógios iguais em gravações rápidas).
    if v_agora <= v_atual then v_agora := v_atual + interval '1 microsecond'; end if;
    update public.notas
       set texto = v_texto, atualizado_em = v_agora, atualizado_por = (select auth.uid())
     where id = v_id;
  else
    if not coalesce(p_forcar, false) and p_esperado is not null then
      -- O painel achava que havia uma nota, mas ela não existe mais (o alvo foi apagado e recriado?).
      raise exception 'nota_alterada';
    end if;
    begin
      insert into public.notas (conversa_id, pedido_id, texto, criado_em, atualizado_em, atualizado_por)
      values (p_conversa_id, p_pedido_id, v_texto, v_agora, v_agora, (select auth.uid()));
    exception when unique_violation then
      -- Outra aba criou a nota ao mesmo tempo.
      raise exception 'nota_alterada';
    end;
  end if;

  return v_agora;
end;
$$;

revoke all on function public.nota_salvar(uuid, uuid, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.nota_salvar(uuid, uuid, text, timestamptz, boolean) to authenticated;
