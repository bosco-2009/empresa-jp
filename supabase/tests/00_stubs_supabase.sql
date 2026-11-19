-- Simula, em um Postgres comum, o mínimo do ambiente Supabase usado pelas migrations.
-- NÃO aplicar no Supabase de verdade: lá tudo isso já existe.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- realtime.send: aqui só registra a chamada para o teste conferir.
create schema if not exists realtime;
create table if not exists realtime.enviados (topic text, event text, payload jsonb, private boolean, em timestamptz default now());
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$
  insert into realtime.enviados (topic, event, payload, private) values (topic, event, payload, private)
$$;

-- Storage (mínimo): buckets e objects, com RLS como no Supabase.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
