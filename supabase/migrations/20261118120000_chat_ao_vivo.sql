-- =====================================================================================
-- Portfólio BR — Fase 2: chat ao vivo
--
-- Tabelas: admins, conversas, mensagens. Função eh_admin(). RPCs do visitante.
-- RLS habilitado em todas as tabelas.
--
-- Modelo de segurança do visitante (anônimo, sem login):
--   * O navegador gera um visitante_id (uuid) e um TOKEN secreto aleatório (64 hex),
--     guardados no localStorage.
--   * O banco guarda só o hash SHA-256 do token (conversas.token_hash).
--   * O papel "anon" NÃO tem acesso direto a nenhuma tabela. Tudo passa pelas funções
--     chat_iniciar / chat_listar / chat_enviar (SECURITY DEFINER), que exigem
--     visitante_id + token e conferem o hash. Saber só o visitante_id não basta.
--   * Avisos em tempo real para o visitante: o gatilho publica um "ping" sem conteúdo
--     num canal Broadcast público cujo nome (conversas.canal) é secreto e só é devolvido
--     a quem apresenta o token. O widget, ao receber o ping, busca as mensagens pela RPC
--     (fonte da verdade). Mesmo que alguém forjasse um ping, só causaria uma releitura.
--
-- Admin: usuário do Supabase Auth cadastrado em public.admins. Lê e escreve tudo via
-- RLS (eh_admin()) e recebe mudanças por Realtime (postgres_changes) em mensagens e conversas.
--
-- Idempotente: pode ser executado mais de uma vez sem erro.
-- =====================================================================================

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);

comment on table public.admins is 'Usuários do Supabase Auth com acesso ao painel /admin/.';

create table if not exists public.conversas (
  id              uuid primary key default gen_random_uuid(),
  visitante_id    uuid not null unique,
  token_hash      text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  canal           text not null unique
                  default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  nome            text check (nome is null or char_length(nome) between 1 and 80),
  whatsapp        text check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  pagina_origem   text check (pagina_origem is null or char_length(pagina_origem) <= 300),
  status          text not null default 'aberta' check (status in ('aberta', 'fechada')),
  nao_lidas_admin integer not null default 0 check (nao_lidas_admin >= 0),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

comment on column public.conversas.token_hash is 'SHA-256 (hex) do token secreto do visitante. O token em si nunca é gravado.';
comment on column public.conversas.canal is 'Nome secreto do canal Realtime Broadcast usado para avisar o visitante.';

create index if not exists conversas_atualizado_em_idx on public.conversas (atualizado_em desc);
create index if not exists conversas_criado_em_idx on public.conversas (criado_em);

create table if not exists public.mensagens (
  id          uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversas (id) on delete cascade,
  autor       text not null check (autor in ('visitante', 'admin')),
  texto       text not null check (char_length(texto) between 1 and 2000 and btrim(texto) <> ''),
  criado_em   timestamptz not null default now()
);

create index if not exists mensagens_conversa_criado_em_idx on public.mensagens (conversa_id, criado_em);

-- ---------------------------------------------------------------------------
-- Permissões de tabela (defesa em profundidade; o RLS é a barreira principal)
-- ---------------------------------------------------------------------------
revoke all on public.admins, public.conversas, public.mensagens from anon, authenticated;

grant select on public.admins to authenticated;
grant select, delete on public.conversas to authenticated;
grant update (status, nao_lidas_admin) on public.conversas to authenticated;
grant select, insert, delete on public.mensagens to authenticated;

-- ---------------------------------------------------------------------------
-- eh_admin()
-- ---------------------------------------------------------------------------
create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.eh_admin() from public, anon, authenticated;
grant execute on function public.eh_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.admins    enable row level security;
alter table public.conversas enable row level security;
alter table public.mensagens enable row level security;

-- admins: cada admin enxerga apenas a própria linha. Cadastro só por SQL (service role).
drop policy if exists admins_ler_propria_linha on public.admins;
create policy admins_ler_propria_linha on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- conversas: só admin (o visitante usa as RPCs).
drop policy if exists conversas_admin_ler on public.conversas;
create policy conversas_admin_ler on public.conversas
  for select to authenticated
  using ((select public.eh_admin()));

drop policy if exists conversas_admin_atualizar on public.conversas;
create policy conversas_admin_atualizar on public.conversas
  for update to authenticated
  using ((select public.eh_admin()))
  with check ((select public.eh_admin()));

drop policy if exists conversas_admin_apagar on public.conversas;
create policy conversas_admin_apagar on public.conversas
  for delete to authenticated
  using ((select public.eh_admin()));

-- mensagens: admin lê/apaga tudo e só insere como autor 'admin'.
drop policy if exists mensagens_admin_ler on public.mensagens;
create policy mensagens_admin_ler on public.mensagens
  for select to authenticated
  using ((select public.eh_admin()));

drop policy if exists mensagens_admin_inserir on public.mensagens;
create policy mensagens_admin_inserir on public.mensagens
  for insert to authenticated
  with check ((select public.eh_admin()) and autor = 'admin');

drop policy if exists mensagens_admin_apagar on public.mensagens;
create policy mensagens_admin_apagar on public.mensagens
  for delete to authenticated
  using ((select public.eh_admin()));

-- ---------------------------------------------------------------------------
-- Aviso em tempo real para o visitante (Broadcast público em canal secreto)
-- Só existe no Supabase; em Postgres puro a chamada é ignorada.
-- ---------------------------------------------------------------------------
create or replace function public._chat_avisar_visitante(p_canal text, p_evento text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute 'select realtime.send($1, $2, $3, false)'
      using p_payload, p_evento, 'chat:' || p_canal;
  end if;
exception when others then
  -- Nunca impedir a gravação da mensagem por falha no aviso em tempo real.
  raise warning 'chat: falha ao publicar aviso realtime: %', sqlerrm;
end;
$$;

revoke all on function public._chat_avisar_visitante(text, text, jsonb) from public, anon, authenticated;

-- Após cada mensagem: atualiza a conversa (não lidas, data, reabertura) e avisa o visitante.
create or replace function public._chat_apos_mensagem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canal text;
begin
  update public.conversas c
     set atualizado_em   = new.criado_em,
         nao_lidas_admin = case when new.autor = 'visitante' then c.nao_lidas_admin + 1 else 0 end,
         status          = case when new.autor = 'visitante' then 'aberta' else c.status end
   where c.id = new.conversa_id
  returning c.canal into v_canal;

  perform public._chat_avisar_visitante(
    v_canal, 'nova_mensagem',
    jsonb_build_object('autor', new.autor, 'criado_em', new.criado_em)
  );
  return null;
end;
$$;

revoke all on function public._chat_apos_mensagem() from public, anon, authenticated;

drop trigger if exists chat_apos_mensagem on public.mensagens;
create trigger chat_apos_mensagem
  after insert on public.mensagens
  for each row execute function public._chat_apos_mensagem();

-- Quando o admin fecha/reabre a conversa, o widget do visitante é avisado.
create or replace function public._chat_apos_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform public._chat_avisar_visitante(new.canal, 'status', jsonb_build_object('status', new.status));
  end if;
  return null;
end;
$$;

revoke all on function public._chat_apos_status() from public, anon, authenticated;

drop trigger if exists chat_apos_status on public.conversas;
create trigger chat_apos_status
  after update of status on public.conversas
  for each row execute function public._chat_apos_status();

-- ---------------------------------------------------------------------------
-- RPCs do visitante
-- ---------------------------------------------------------------------------

-- Confere visitante_id + token e devolve a conversa (travada para atualização).
-- Uso interno. Lança 'acesso_negado' se o token não confere.
create or replace function public._chat_conversa_do_visitante(p_visitante_id uuid, p_token text)
returns public.conversas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversa public.conversas;
begin
  if p_visitante_id is null or p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;

  select * into v_conversa
    from public.conversas c
   where c.visitante_id = p_visitante_id
   for update;

  if not found then
    return null;
  end if;

  if v_conversa.token_hash <> encode(sha256(convert_to(p_token, 'UTF8')), 'hex') then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;

  return v_conversa;
end;
$$;

revoke all on function public._chat_conversa_do_visitante(uuid, text) from public, anon, authenticated;

-- Inicia (ou retoma) a conversa do visitante.
--   p_criar = false: só retoma; se não existir, não devolve linhas.
--   Nome/WhatsApp/página: opcionais; valores novos substituem os antigos.
create or replace function public.chat_iniciar(
  p_visitante_id uuid,
  p_token        text,
  p_nome         text    default null,
  p_whatsapp     text    default null,
  p_pagina       text    default null,
  p_criar        boolean default true
)
returns table (conversa_id uuid, canal text, status text, nome text, whatsapp text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conversa public.conversas;
  v_nome     text := nullif(btrim(left(coalesce(p_nome, ''), 80)), '');
  v_whatsapp text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g'), '');
  v_pagina   text := nullif(left(coalesce(p_pagina, ''), 300), '');
begin
  if v_whatsapp is not null and v_whatsapp !~ '^[0-9]{10,13}$' then
    raise exception 'whatsapp_invalido' using errcode = '22023';
  end if;

  v_conversa := public._chat_conversa_do_visitante(p_visitante_id, p_token);

  if v_conversa.id is null then
    if not p_criar then
      return;
    end if;

    -- Anti-spam global: no máximo 60 conversas novas a cada 10 minutos.
    if (select count(*) from public.conversas c where c.criado_em > now() - interval '10 minutes') >= 60 then
      raise exception 'limite_conversas' using errcode = 'P0001';
    end if;

    insert into public.conversas (visitante_id, token_hash, nome, whatsapp, pagina_origem)
    values (p_visitante_id, encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), v_nome, v_whatsapp, v_pagina)
    on conflict (visitante_id) do nothing;

    -- Corrida (duas abas ao mesmo tempo): relê e confere o token de novo.
    v_conversa := public._chat_conversa_do_visitante(p_visitante_id, p_token);
  elsif v_nome is not null or v_whatsapp is not null then
    update public.conversas c
       set nome     = coalesce(v_nome, c.nome),
           whatsapp = coalesce(v_whatsapp, c.whatsapp)
     where c.id = v_conversa.id
    returning * into v_conversa;
  end if;

  return query select v_conversa.id, v_conversa.canal, v_conversa.status, v_conversa.nome, v_conversa.whatsapp;
end;
$$;

-- Histórico: até p_limite mensagens (as mais recentes), em ordem cronológica.
-- Com p_depois, só as mensagens posteriores a esse instante.
create or replace function public.chat_listar(
  p_visitante_id uuid,
  p_token        text,
  p_depois       timestamptz default null,
  p_limite       integer     default 100
)
returns table (id uuid, autor text, texto text, criado_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conversa public.conversas;
begin
  -- Sem "for update" aqui: função de leitura. Repete a conferência do token.
  if p_visitante_id is null or p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;

  select * into v_conversa from public.conversas c where c.visitante_id = p_visitante_id;
  if not found then
    return;
  end if;
  if v_conversa.token_hash <> encode(sha256(convert_to(p_token, 'UTF8')), 'hex') then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;

  return query
    select m.id, m.autor, m.texto, m.criado_em
      from (
        select m2.* from public.mensagens m2
         where m2.conversa_id = v_conversa.id
           and (p_depois is null or m2.criado_em > p_depois)
         order by m2.criado_em desc
         limit least(greatest(coalesce(p_limite, 100), 1), 200)
      ) m
     order by m.criado_em asc;
end;
$$;

-- Envia uma mensagem do visitante.
-- Anti-spam: no máximo 20 mensagens do visitante por conversa a cada 10 minutos.
create or replace function public.chat_enviar(
  p_visitante_id uuid,
  p_token        text,
  p_texto        text
)
returns table (id uuid, autor text, texto text, criado_em timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conversa public.conversas;
  v_texto    text := btrim(coalesce(p_texto, ''));
begin
  if char_length(v_texto) = 0 or char_length(v_texto) > 2000 then
    raise exception 'texto_invalido' using errcode = '22023';
  end if;

  v_conversa := public._chat_conversa_do_visitante(p_visitante_id, p_token);  -- trava a conversa
  if v_conversa.id is null then
    raise exception 'conversa_inexistente' using errcode = 'P0002';
  end if;

  if (select count(*) from public.mensagens m
       where m.conversa_id = v_conversa.id
         and m.autor = 'visitante'
         and m.criado_em > now() - interval '10 minutes') >= 20 then
    raise exception 'limite_mensagens' using errcode = 'P0001';
  end if;

  return query
    insert into public.mensagens as m (conversa_id, autor, texto)
    values (v_conversa.id, 'visitante', v_texto)
    returning m.id, m.autor, m.texto, m.criado_em;
end;
$$;

revoke all on function public.chat_iniciar(uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.chat_listar(uuid, text, timestamptz, integer)      from public, anon, authenticated;
revoke all on function public.chat_enviar(uuid, text, text)                       from public, anon, authenticated;
grant execute on function public.chat_iniciar(uuid, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.chat_listar(uuid, text, timestamptz, integer)      to anon, authenticated;
grant execute on function public.chat_enviar(uuid, text, text)                       to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (postgres_changes para o painel admin; respeita o RLS acima)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensagens') then
      alter publication supabase_realtime add table public.mensagens;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversas') then
      alter publication supabase_realtime add table public.conversas;
    end if;
  end if;
end;
$$;
