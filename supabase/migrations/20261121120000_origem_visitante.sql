-- =====================================================================================
-- Melhoria 10: origem do visitante nos pedidos (de onde veio: utm_* e domínio de referência).
-- ADITIVA: só acrescenta uma coluna e uma função. Nenhum dado existente é alterado ou apagado.
--
-- O chat não precisa de mudança no banco: a origem vai junto no texto de conversas.pagina_origem.
-- No pedido, a Edge Function criar-pagamento chama pedido_definir_origem logo depois de pedido_criar
-- (sem mudar a assinatura de pedido_criar, para não criar sobrecarga ambígua no PostgREST).
--
-- Depende de: 20261119120000_pedidos.sql. Idempotente.
-- =====================================================================================

alter table public.pedidos add column if not exists origem text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pedidos_origem_tamanho' and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos add constraint pedidos_origem_tamanho check (origem is null or char_length(origem) <= 300);
  end if;
end
$$;

comment on column public.pedidos.origem is
  'Como o cliente chegou ao site (ex.: "utm: instagram / social · ref: google.com · entrada: /blog/"). Sem dados pessoais.';

-- Grava a origem uma única vez (não sobrescreve). Só a service role (Edge Function) executa.
create or replace function public.pedido_definir_origem(p_pedido_id uuid, p_origem text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.pedidos
     set origem = nullif(left(btrim(regexp_replace(coalesce(p_origem, ''), '[[:cntrl:]]+', ' ', 'g')), 300), '')
   where id = p_pedido_id
     and origem is null;
$$;

revoke all on function public.pedido_definir_origem(uuid, text) from public, anon, authenticated;
grant execute on function public.pedido_definir_origem(uuid, text) to service_role;
