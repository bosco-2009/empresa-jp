-- =====================================================================================
-- Portfólio BR — Fase 3: planos, pedidos e pagamentos (Mercado Pago Checkout Pro)
--
-- Tabelas: planos (preço oficial, lido só pelo servidor), pedidos, pedidos_eventos (auditoria do webhook).
--
-- Quem pode o quê:
--   * anon:          nada nas tabelas. Só a RPC pedido_consultar(codigo, token), que devolve o status
--                    do próprio pedido (sem dados pessoais) se o token secreto conferir.
--   * authenticated: admin (eh_admin()) lê pedidos e eventos. Ninguém do front cria nem altera pedido.
--   * service_role:  (Edge Functions criar-pagamento e webhook-mercadopago) cria pedidos e muda status
--                    pelas funções pedido_criar / pedido_definir_preferencia / pedido_registrar_pagamento.
--
-- Depende de: 20261118120000_chat_ao_vivo.sql (eh_admin()).
-- Idempotente: pode ser executado mais de uma vez sem erro.
-- =====================================================================================

-- ---------------------------------------------------------------------------
-- Planos (fonte do PREÇO cobrado). O config.js só exibe; o servidor nunca confia no preço do front.
-- [PROVISÓRIO] Os valores iniciais abaixo espelham config.js. Para mudar um preço depois:
--   update public.planos set valor_centavos = 59700 where id = 'essencial';   (e ajustar config.js)
-- ---------------------------------------------------------------------------
create table if not exists public.planos (
  id             text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  nome           text not null check (char_length(nome) between 2 and 60),
  valor_centavos integer not null check (valor_centavos between 100 and 10000000),
  ativo          boolean not null default true,
  atualizado_em  timestamptz not null default now()
);

insert into public.planos (id, nome, valor_centavos) values
  ('essencial',    'Essencial',    49700),
  ('profissional', 'Profissional', 99700),
  ('premium',      'Premium',     179700)
on conflict (id) do nothing;  -- não sobrescreve preços alterados depois

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------
create table if not exists public.pedidos (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null unique check (codigo ~ '^PBR-[A-HJ-NP-Z2-9]{6}$'),
  token_hash        text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  plano_id          text not null references public.planos (id),
  plano_nome        text not null,
  valor_centavos    integer not null check (valor_centavos > 0),
  nome              text not null check (char_length(nome) between 2 and 80),
  email             text not null check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  whatsapp          text not null check (whatsapp ~ '^[0-9]{10,13}$'),
  aceite_termos_em  timestamptz not null,
  status            text not null default 'pendente'
                    check (status in ('pendente', 'aprovado', 'recusado', 'cancelado', 'reembolsado')),
  mp_preference_id  text check (mp_preference_id is null or char_length(mp_preference_id) <= 100),
  mp_payment_id     text check (mp_payment_id is null or mp_payment_id ~ '^[0-9]{1,30}$'),
  mp_status         text,
  mp_status_detalhe text,
  pago_em           timestamptz,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

comment on column public.pedidos.token_hash is 'SHA-256 (hex) do token que o navegador do cliente guarda para consultar o status.';
comment on column public.pedidos.plano_nome is 'Nome do plano no momento da compra (histórico).';

create index if not exists pedidos_criado_em_idx on public.pedidos (criado_em desc);
create index if not exists pedidos_status_idx on public.pedidos (status);
create index if not exists pedidos_email_idx on public.pedidos (lower(email));

-- Auditoria: cada notificação de pagamento processada (também garante idempotência).
create table if not exists public.pedidos_eventos (
  id             bigint generated always as identity primary key,
  pedido_id      uuid not null references public.pedidos (id) on delete cascade,
  mp_payment_id  text not null,
  mp_status      text not null,
  mp_status_detalhe text,
  valor_centavos integer,
  moeda          text,
  resultado      text not null,  -- aplicado | repetido | ignorado_aprovado | valor_divergente
  recebido_em    timestamptz not null default now()
);

create index if not exists pedidos_eventos_pedido_idx on public.pedidos_eventos (pedido_id, recebido_em);

-- ---------------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------------
revoke all on public.planos, public.pedidos, public.pedidos_eventos from anon, authenticated;
grant select on public.pedidos, public.pedidos_eventos, public.planos to authenticated;
grant all on public.planos, public.pedidos, public.pedidos_eventos to service_role;

alter table public.planos          enable row level security;
alter table public.pedidos         enable row level security;
alter table public.pedidos_eventos enable row level security;

drop policy if exists planos_admin_ler on public.planos;
create policy planos_admin_ler on public.planos
  for select to authenticated using ((select public.eh_admin()));

drop policy if exists pedidos_admin_ler on public.pedidos;
create policy pedidos_admin_ler on public.pedidos
  for select to authenticated using ((select public.eh_admin()));

drop policy if exists pedidos_eventos_admin_ler on public.pedidos_eventos;
create policy pedidos_eventos_admin_ler on public.pedidos_eventos
  for select to authenticated using ((select public.eh_admin()));
-- Sem políticas de insert/update/delete: só a service_role (que ignora o RLS) altera.

-- ---------------------------------------------------------------------------
-- Funções da service role (Edge Functions)
-- ---------------------------------------------------------------------------

-- Cria um pedido pendente com o PREÇO da tabela planos. Devolve id, código e valor.
create or replace function public.pedido_criar(
  p_plano_id   text,
  p_nome       text,
  p_email      text,
  p_whatsapp   text,
  p_token_hash text
)
returns table (pedido_id uuid, codigo text, plano_nome text, valor_centavos integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plano    public.planos;
  v_nome     text := btrim(coalesce(p_nome, ''));
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_whatsapp text := regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g');
  v_codigo   text;
  v_id       uuid;
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- sem 0/O/1/I
  i          integer;
begin
  select * into v_plano from public.planos p where p.id = p_plano_id and p.ativo;
  if not found then
    raise exception 'plano_invalido' using errcode = '22023';
  end if;
  if char_length(v_nome) not between 2 and 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'email_invalido' using errcode = '22023';
  end if;
  if v_whatsapp !~ '^[0-9]{10,13}$' then
    raise exception 'whatsapp_invalido' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_invalido' using errcode = '22023';
  end if;

  -- Anti-abuso: no máximo 5 pedidos por e-mail por hora e 60 pedidos no site a cada 10 minutos.
  if (select count(*) from public.pedidos p where lower(p.email) = v_email and p.criado_em > now() - interval '1 hour') >= 5 then
    raise exception 'limite_pedidos' using errcode = 'P0001';
  end if;
  if (select count(*) from public.pedidos p where p.criado_em > now() - interval '10 minutes') >= 60 then
    raise exception 'limite_pedidos' using errcode = 'P0001';
  end if;

  -- Código legível e único (tenta de novo em caso de colisão).
  for tentativa in 1..10 loop
    v_codigo := 'PBR-';
    for i in 1..6 loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::integer, 1);
    end loop;
    begin
      insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em)
      values (v_codigo, p_token_hash, v_plano.id, v_plano.nome, v_plano.valor_centavos, v_nome, v_email, v_whatsapp, now())
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;
  if v_id is null then
    raise exception 'falha_codigo' using errcode = 'P0001';
  end if;

  return query select v_id, v_codigo, v_plano.nome, v_plano.valor_centavos;
end;
$$;

-- Guarda o id da preferência criada no Mercado Pago.
create or replace function public.pedido_definir_preferencia(p_pedido_id uuid, p_preference_id text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.pedidos
     set mp_preference_id = p_preference_id, atualizado_em = now()
   where id = p_pedido_id and status = 'pendente';
$$;

-- Aplica um pagamento consultado na API do Mercado Pago. Idempotente.
--   * Confere valor e moeda (BRL) contra o pedido: se divergir, registra e NÃO aprova.
--   * Pedido aprovado não volta para pendente/recusado/cancelado por outro pagamento
--     (ex.: tentativa recusada que chega atrasada). Reembolso do pagamento aprovado é aplicado.
-- Retorna o resultado: aplicado | repetido | ignorado_aprovado | valor_divergente | pedido_inexistente
create or replace function public.pedido_registrar_pagamento(
  p_pedido_id         uuid,
  p_payment_id        text,
  p_mp_status         text,
  p_mp_status_detalhe text,
  p_valor_centavos    integer,
  p_moeda             text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos;
  v_novo   text;
  v_res    text;
begin
  if p_payment_id is null or p_payment_id !~ '^[0-9]{1,30}$' then
    raise exception 'payment_id_invalido' using errcode = '22023';
  end if;

  select * into v_pedido from public.pedidos where id = p_pedido_id for update;
  if not found then
    return 'pedido_inexistente';
  end if;

  v_novo := case p_mp_status
    when 'approved'     then 'aprovado'
    when 'authorized'   then 'pendente'
    when 'pending'      then 'pendente'
    when 'in_process'   then 'pendente'
    when 'in_mediation' then 'pendente'
    when 'rejected'     then 'recusado'
    when 'cancelled'    then 'cancelado'
    when 'refunded'     then 'reembolsado'
    when 'charged_back' then 'reembolsado'
    else null
  end;
  if v_novo is null then
    raise exception 'status_mp_desconhecido: %', p_mp_status using errcode = '22023';
  end if;

  if v_novo = 'aprovado' and (p_valor_centavos is distinct from v_pedido.valor_centavos or upper(coalesce(p_moeda, '')) <> 'BRL') then
    v_res := 'valor_divergente';
  elsif v_pedido.mp_payment_id = p_payment_id and v_pedido.mp_status = p_mp_status then
    v_res := 'repetido';
  elsif v_pedido.status in ('aprovado', 'reembolsado')
        and v_pedido.mp_payment_id is distinct from p_payment_id then
    v_res := 'ignorado_aprovado';
  elsif v_pedido.status = 'reembolsado' and v_novo <> 'reembolsado' then
    v_res := 'ignorado_aprovado';  -- reembolso é final
  else
    update public.pedidos
       set status            = v_novo,
           mp_payment_id     = p_payment_id,
           mp_status         = p_mp_status,
           mp_status_detalhe = left(p_mp_status_detalhe, 200),
           pago_em           = case when v_novo = 'aprovado' then coalesce(pago_em, now()) else pago_em end,
           atualizado_em     = now()
     where id = v_pedido.id;
    v_res := 'aplicado';
  end if;

  insert into public.pedidos_eventos (pedido_id, mp_payment_id, mp_status, mp_status_detalhe, valor_centavos, moeda, resultado)
  values (v_pedido.id, p_payment_id, p_mp_status, left(p_mp_status_detalhe, 200), p_valor_centavos, left(p_moeda, 3), v_res);

  return v_res;
end;
$$;

revoke all on function public.pedido_criar(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.pedido_definir_preferencia(uuid, text) from public, anon, authenticated;
revoke all on function public.pedido_registrar_pagamento(uuid, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.pedido_criar(text, text, text, text, text) to service_role;
grant execute on function public.pedido_definir_preferencia(uuid, text) to service_role;
grant execute on function public.pedido_registrar_pagamento(uuid, text, text, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- RPC pública: status do próprio pedido (código + token secreto do navegador)
-- Não devolve dados pessoais.
-- ---------------------------------------------------------------------------
create or replace function public.pedido_consultar(p_codigo text, p_token text)
returns table (codigo text, plano_id text, plano_nome text, valor_centavos integer, status text, criado_em timestamptz, atualizado_em timestamptz)
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
    -- Mesma resposta para "não existe" e "token errado" (não revela códigos válidos).
    raise exception 'acesso_negado' using errcode = '42501';
  end if;

  return query select v_pedido.codigo, v_pedido.plano_id, v_pedido.plano_nome, v_pedido.valor_centavos,
                      v_pedido.status, v_pedido.criado_em, v_pedido.atualizado_em;
end;
$$;

revoke all on function public.pedido_consultar(text, text) from public, anon, authenticated;
grant execute on function public.pedido_consultar(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: o painel recebe mudanças de pedidos (respeita o RLS do admin)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos') then
    alter publication supabase_realtime add table public.pedidos;
  end if;
end;
$$;
