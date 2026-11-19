-- =====================================================================================
-- Portfólio BR — Fase 4: briefing pós-compra (+ arquivos no Storage)
--
-- Um briefing por pedido. O cliente envia e edita pela RPC briefing_enviar(codigo, token, dados):
--   * só para pedido APROVADO;
--   * pode editar enquanto o status for 'novo'. Quando o admin muda o status (em_producao, em_revisao,
--     entregue), o briefing fica travado para o cliente.
-- Admin lê tudo e muda só o status.
-- Arquivos (logo, fotos, PDFs): bucket PRIVADO "briefings", máx. 5 MB, só imagens e PDF.
--   Upload por URL assinada gerada pela Edge Function briefing-upload (service role), depois de
--   briefing_autorizar_upload validar código + token, pedido aprovado, briefing editável e limite de arquivos.
--
-- Depende de: 20261118120000_chat_ao_vivo.sql (eh_admin) e 20261119120000_pedidos.sql (pedidos).
-- Idempotente.
-- =====================================================================================

create table if not exists public.briefings (
  id                   uuid primary key default gen_random_uuid(),
  pedido_id            uuid not null unique references public.pedidos (id) on delete cascade,
  status               text not null default 'novo'
                       check (status in ('novo', 'em_producao', 'em_revisao', 'entregue')),
  nome_negocio         text not null check (char_length(nome_negocio) between 2 and 120),
  segmento             text check (char_length(segmento) <= 120),
  cidade               text check (char_length(cidade) <= 120),
  publico              text check (char_length(publico) <= 2000),
  objetivo             text check (char_length(objetivo) <= 2000),
  paginas              text check (char_length(paginas) <= 2000),
  cores_estilo         text check (char_length(cores_estilo) <= 2000),
  referencias          text[] not null default '{}' check (cardinality(referencias) <= 10),
  textos_servicos      text check (char_length(textos_servicos) <= 10000),
  contatos_redes       text check (char_length(contatos_redes) <= 2000),
  tem_dominio          text check (tem_dominio in ('sim', 'nao', 'nao_sei')),
  dominio              text check (char_length(dominio) <= 253),
  observacoes          text check (char_length(observacoes) <= 4000),
  links_arquivos       text[] not null default '{}' check (cardinality(links_arquivos) <= 10),
  arquivos             jsonb not null default '[]'::jsonb check (jsonb_typeof(arquivos) = 'array' and jsonb_array_length(arquivos) <= 20),
  envios               integer not null default 1,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  status_atualizado_em timestamptz not null default now()
);

comment on table public.briefings is 'Briefing do cliente, um por pedido. Editável pelo cliente enquanto status = novo.';
comment on column public.briefings.arquivos is 'Arquivos no bucket "briefings": [{caminho, nome, tipo, tamanho}]. caminho começa com <pedido_id>/.';

create index if not exists briefings_status_idx on public.briefings (status, atualizado_em desc);

-- ---------------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------------
revoke all on public.briefings from anon, authenticated;
grant select on public.briefings to authenticated;
grant update (status) on public.briefings to authenticated;
grant all on public.briefings to service_role;

alter table public.briefings enable row level security;

drop policy if exists briefings_admin_ler on public.briefings;
create policy briefings_admin_ler on public.briefings
  for select to authenticated using ((select public.eh_admin()));

drop policy if exists briefings_admin_status on public.briefings;
create policy briefings_admin_status on public.briefings
  for update to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()));

create or replace function public._briefing_ao_mudar_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_atualizado_em := now();
  end if;
  return new;
end;
$$;

drop trigger if exists briefing_ao_mudar_status on public.briefings;
create trigger briefing_ao_mudar_status
  before update of status on public.briefings
  for each row execute function public._briefing_ao_mudar_status();

-- ---------------------------------------------------------------------------
-- Storage: bucket privado "briefings" (5 MB; imagens e PDF)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('briefings', 'briefings', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Admin pode ler (e gerar link de download). Ninguém mais tem política: o cliente só envia
-- por URL assinada criada pela service role.
drop policy if exists briefings_arquivos_admin_ler on storage.objects;
create policy briefings_arquivos_admin_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'briefings' and (select public.eh_admin()));

-- ---------------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------------

-- Pedido do cliente (código + token). Mesmo erro para código inexistente e token errado.
create or replace function public._pedido_do_cliente(p_codigo text, p_token text)
returns public.pedidos
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos;
begin
  if p_codigo is null or p_codigo !~ '^PBR-[A-HJ-NP-Z2-9]{6}$'
     or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;
  select * into v_pedido from public.pedidos p where p.codigo = p_codigo;
  if not found or v_pedido.token_hash <> encode(sha256(convert_to(p_token, 'UTF8')), 'hex') then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;
  return v_pedido;
end;
$$;

revoke all on function public._pedido_do_cliente(text, text) from public, anon, authenticated;

-- Texto opcional: apara, limita e transforma vazio em null.
create or replace function public._texto(p jsonb, p_chave text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(left(coalesce(p ->> p_chave, ''), p_max)), '');
$$;

-- Lista de links http(s): no máximo 10, cada um com até 500 caracteres; ignora vazios.
create or replace function public._links(p jsonb, p_chave text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_saida text[] := '{}';
  v_item  text;
begin
  if p -> p_chave is null or jsonb_typeof(p -> p_chave) = 'null' then
    return v_saida;
  end if;
  if jsonb_typeof(p -> p_chave) <> 'array' then
    raise exception 'links_invalidos' using errcode = '22023';
  end if;
  for v_item in select btrim(x) from jsonb_array_elements_text(p -> p_chave) as x loop
    continue when v_item = '';
    if char_length(v_item) > 500 or v_item !~* '^https?://[^\s/$.?#][^\s]*$' then
      raise exception 'link_invalido: %', left(v_item, 60) using errcode = '22023';
    end if;
    v_saida := v_saida || v_item;
  end loop;
  if cardinality(v_saida) > 10 then
    raise exception 'links_demais' using errcode = '22023';
  end if;
  return v_saida;
end;
$$;

revoke all on function public._texto(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._links(jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs do cliente (anon): enviar/editar e obter o próprio briefing
-- ---------------------------------------------------------------------------
create or replace function public.briefing_enviar(p_codigo text, p_token text, p_dados jsonb)
returns table (status text, atualizado_em timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pedido   public.pedidos;
  v_atual    public.briefings;
  v_nome     text;
  v_dominio  text;
  v_tem      text;
  v_arquivos jsonb := '[]'::jsonb;
  v_arq      jsonb;
begin
  v_pedido := public._pedido_do_cliente(p_codigo, p_token);
  if v_pedido.status <> 'aprovado' then
    raise exception 'pedido_nao_aprovado' using errcode = '42501';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'dados_invalidos' using errcode = '22023';
  end if;

  select * into v_atual from public.briefings b where b.pedido_id = v_pedido.id for update;
  if found and v_atual.status <> 'novo' then
    raise exception 'briefing_bloqueado' using errcode = '42501';
  end if;
  if found and v_atual.envios >= 200 then
    raise exception 'limite_envios' using errcode = 'P0001';
  end if;

  v_nome := public._texto(p_dados, 'nome_negocio', 120);
  if v_nome is null or char_length(v_nome) < 2 then
    raise exception 'nome_negocio_obrigatorio' using errcode = '22023';
  end if;

  v_tem := nullif(p_dados ->> 'tem_dominio', '');
  if v_tem is not null and v_tem not in ('sim', 'nao', 'nao_sei') then
    raise exception 'dados_invalidos' using errcode = '22023';
  end if;
  v_dominio := lower(public._texto(p_dados, 'dominio', 253));

  -- Arquivos: só os do próprio pedido e que existem no bucket.
  if p_dados ? 'arquivos' and jsonb_typeof(p_dados -> 'arquivos') = 'array' then
    if jsonb_array_length(p_dados -> 'arquivos') > 20 then
      raise exception 'arquivos_demais' using errcode = '22023';
    end if;
    for v_arq in select * from jsonb_array_elements(p_dados -> 'arquivos') loop
      if jsonb_typeof(v_arq) <> 'object'
         or coalesce(v_arq ->> 'caminho', '') !~ ('^' || v_pedido.id::text || '/[A-Za-z0-9._-]{1,200}$')
         or not exists (select 1 from storage.objects o where o.bucket_id = 'briefings' and o.name = v_arq ->> 'caminho') then
        raise exception 'arquivo_invalido' using errcode = '22023';
      end if;
      v_arquivos := v_arquivos || jsonb_build_array(jsonb_build_object(
        'caminho', v_arq ->> 'caminho',
        'nome', left(coalesce(v_arq ->> 'nome', 'arquivo'), 200),
        'tipo', left(coalesce(v_arq ->> 'tipo', ''), 100),
        'tamanho', case when coalesce(v_arq ->> 'tamanho', '') ~ '^\d{1,9}$' then (v_arq ->> 'tamanho')::integer else null end
      ));
    end loop;
  end if;

  insert into public.briefings as b (
    pedido_id, nome_negocio, segmento, cidade, publico, objetivo, paginas, cores_estilo, referencias,
    textos_servicos, contatos_redes, tem_dominio, dominio, observacoes, links_arquivos, arquivos
  ) values (
    v_pedido.id, v_nome,
    public._texto(p_dados, 'segmento', 120),
    public._texto(p_dados, 'cidade', 120),
    public._texto(p_dados, 'publico', 2000),
    public._texto(p_dados, 'objetivo', 2000),
    public._texto(p_dados, 'paginas', 2000),
    public._texto(p_dados, 'cores_estilo', 2000),
    public._links(p_dados, 'referencias'),
    public._texto(p_dados, 'textos_servicos', 10000),
    public._texto(p_dados, 'contatos_redes', 2000),
    v_tem, v_dominio,
    public._texto(p_dados, 'observacoes', 4000),
    public._links(p_dados, 'links_arquivos'),
    v_arquivos
  )
  on conflict (pedido_id) do update set
    nome_negocio    = excluded.nome_negocio,
    segmento        = excluded.segmento,
    cidade          = excluded.cidade,
    publico         = excluded.publico,
    objetivo        = excluded.objetivo,
    paginas         = excluded.paginas,
    cores_estilo    = excluded.cores_estilo,
    referencias     = excluded.referencias,
    textos_servicos = excluded.textos_servicos,
    contatos_redes  = excluded.contatos_redes,
    tem_dominio     = excluded.tem_dominio,
    dominio         = excluded.dominio,
    observacoes     = excluded.observacoes,
    links_arquivos  = excluded.links_arquivos,
    arquivos        = excluded.arquivos,
    envios          = b.envios + 1,
    atualizado_em   = now()
  where b.status = 'novo';

  return query select b.status, b.atualizado_em from public.briefings b where b.pedido_id = v_pedido.id;
end;
$$;

-- Devolve o briefing do próprio pedido (para continuar a edição em outro aparelho) e o status do pedido.
create or replace function public.briefing_obter(p_codigo text, p_token text)
returns table (pedido_status text, plano_nome text, briefing jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos;
  v_b      public.briefings;
begin
  v_pedido := public._pedido_do_cliente(p_codigo, p_token);
  select * into v_b from public.briefings b where b.pedido_id = v_pedido.id;
  return query select v_pedido.status, v_pedido.plano_nome,
    case when v_b.id is null then null else
      jsonb_build_object(
        'status', v_b.status, 'atualizado_em', v_b.atualizado_em,
        'nome_negocio', v_b.nome_negocio, 'segmento', v_b.segmento, 'cidade', v_b.cidade,
        'publico', v_b.publico, 'objetivo', v_b.objetivo, 'paginas', v_b.paginas,
        'cores_estilo', v_b.cores_estilo, 'referencias', to_jsonb(v_b.referencias),
        'textos_servicos', v_b.textos_servicos, 'contatos_redes', v_b.contatos_redes,
        'tem_dominio', v_b.tem_dominio, 'dominio', v_b.dominio, 'observacoes', v_b.observacoes,
        'links_arquivos', to_jsonb(v_b.links_arquivos), 'arquivos', v_b.arquivos)
    end;
end;
$$;

revoke all on function public.briefing_enviar(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.briefing_obter(text, text) from public, anon, authenticated;
grant execute on function public.briefing_enviar(text, text, jsonb) to anon, authenticated;
grant execute on function public.briefing_obter(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Para a Edge Function briefing-upload (service role): autoriza um upload.
-- Devolve o id do pedido (pasta no bucket) e quantos arquivos já existem nela.
-- ---------------------------------------------------------------------------
create or replace function public.briefing_autorizar_upload(p_codigo text, p_token text)
returns table (pedido_id uuid, arquivos_existentes integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos;
begin
  v_pedido := public._pedido_do_cliente(p_codigo, p_token);
  if v_pedido.status <> 'aprovado' then
    raise exception 'pedido_nao_aprovado' using errcode = '42501';
  end if;
  if exists (select 1 from public.briefings b where b.pedido_id = v_pedido.id and b.status <> 'novo') then
    raise exception 'briefing_bloqueado' using errcode = '42501';
  end if;
  return query
    select v_pedido.id,
           (select count(*)::integer from storage.objects o
             where o.bucket_id = 'briefings' and o.name like v_pedido.id::text || '/%');
end;
$$;

revoke all on function public.briefing_autorizar_upload(text, text) from public, anon, authenticated;
grant execute on function public.briefing_autorizar_upload(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: o painel recebe briefings novos/alterados (RLS do admin)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'briefings') then
    alter publication supabase_realtime add table public.briefings;
  end if;
end;
$$;
