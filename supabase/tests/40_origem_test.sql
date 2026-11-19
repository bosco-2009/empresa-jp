-- Testes da migration de origem do visitante (melhoria 10). Rodar depois das migrations e dos outros testes.
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

create or replace function pg_temp.esperar_erro(p_sql text, p_msg text) returns void language plpgsql as $$
declare
  v_erro text;
begin
  begin
    execute p_sql;
  exception when others then
    v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHOU: esperava erro "%" em: %', p_msg, p_sql;
  elsif v_erro not like '%' || p_msg || '%' then
    raise exception 'FALHOU: erro inesperado "%" (esperava "%") em: %', v_erro, p_msg, p_sql;
  end if;
end $$;
grant execute on function pg_temp.esperar_erro(text, text) to anon, authenticated, service_role;

select encode(sha256(convert_to(repeat('e', 64), 'UTF8')), 'hex') as hash_e \gset
set role service_role;
select * from public.pedido_criar('essencial', 'Origem Teste', 'origem@exemplo.com', '11955554444', :'hash_e') \gset o_
reset role;

-- 1. Front (anon/authenticated) não executa
set role anon;
select pg_temp.esperar_erro(format($$select public.pedido_definir_origem(%L, 'x')$$, :'o_pedido_id'), 'permission denied');
reset role;
set role authenticated;
select pg_temp.esperar_erro(format($$select public.pedido_definir_origem(%L, 'x')$$, :'o_pedido_id'), 'permission denied');
reset role;
\echo ok 1 so a service role define a origem

-- 2. Vazio não grava; texto com controles é limpo e cortado em 300
set role service_role;
select public.pedido_definir_origem(:'o_pedido_id', '   ');
reset role;
do $$ begin
  if (select origem from public.pedidos where codigo = (select codigo from public.pedidos where email = 'origem@exemplo.com')) is not null then
    raise exception 'FALHOU: origem vazia gravada'; end if;
end $$;
set role service_role;
select public.pedido_definir_origem(:'o_pedido_id', E'utm: instagram\n/ social\t' || repeat('x', 400));
reset role;
do $$ declare v text; begin
  select origem into v from public.pedidos where email = 'origem@exemplo.com';
  if v is null or char_length(v) <> 300 or v !~ '^utm: instagram / social x' or v ~ '[[:cntrl:]]' then
    raise exception 'FALHOU: origem não normalizada: %', v; end if;
end $$;
\echo ok 2 origem limpa (sem controles) e limitada a 300

-- 3. Não sobrescreve a primeira origem
set role service_role;
select public.pedido_definir_origem(:'o_pedido_id', 'outra');
reset role;
do $$ begin
  if (select origem from public.pedidos where email = 'origem@exemplo.com') = 'outra' then
    raise exception 'FALHOU: origem sobrescrita'; end if;
end $$;
\echo ok 3 origem gravada uma vez so

-- 4. Restrição de tamanho na tabela e RLS mantida
select pg_temp.esperar_erro($$update public.pedidos set origem = repeat('y', 301) where email = 'origem@exemplo.com'$$, 'pedidos_origem_tamanho');
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity) then
    raise exception 'FALHOU: tabela sem RLS'; end if;
end $$;
\echo ok 4 limite de tamanho na tabela e RLS em todas as tabelas
\echo TODOS OS TESTES DE ORIGEM PASSARAM
