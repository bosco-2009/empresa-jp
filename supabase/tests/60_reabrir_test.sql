-- Testes de pedido_preferencia_para_reabrir (melhoria 39). Rodar depois das migrations e dos outros testes.
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
create or replace function pg_temp.conferir(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALHOU: %', p_msg; end if;
end $$;

-- Pedidos de teste (tokens '3'..'7' * 64):
--   A pendente com preferência · B pendente sem preferência · C pendente com pagamento em processamento
--   D aprovado · E pendente com preferência, mas antigo (40 dias)
-- Os testes anteriores já criaram muitos pedidos: envelhece-os para não bater no limite anti-abuso de pedido_criar.
update public.pedidos set criado_em = criado_em - interval '1 day' where criado_em > now() - interval '1 hour';
set role service_role;
select pedido_id as pa_id, codigo as pa_cod from public.pedido_criar('essencial', 'Ana Prado', 'ana@exemplo.com', '11933330000',
  encode(sha256(convert_to(repeat('3', 64), 'UTF8')), 'hex')) \gset
select pedido_id as pb_id, codigo as pb_cod from public.pedido_criar('essencial', 'Bia Prado', 'bia@exemplo.com', '11933330001',
  encode(sha256(convert_to(repeat('4', 64), 'UTF8')), 'hex')) \gset
select pedido_id as pc_id, codigo as pc_cod from public.pedido_criar('essencial', 'Caio Prado', 'caio@exemplo.com', '11933330002',
  encode(sha256(convert_to(repeat('5', 64), 'UTF8')), 'hex')) \gset
select pedido_id as pd_id, codigo as pd_cod from public.pedido_criar('essencial', 'Davi Prado', 'davi@exemplo.com', '11933330003',
  encode(sha256(convert_to(repeat('6', 64), 'UTF8')), 'hex')) \gset
select pedido_id as pe_id, codigo as pe_cod from public.pedido_criar('essencial', 'Eva Prado', 'eva@exemplo.com', '11933330004',
  encode(sha256(convert_to(repeat('7', 64), 'UTF8')), 'hex')) \gset
select public.pedido_definir_preferencia(:'pa_id', 'pref-a-123');
select public.pedido_definir_preferencia(:'pc_id', 'pref-c-123');
select public.pedido_definir_preferencia(:'pd_id', 'pref-d-123');
select public.pedido_definir_preferencia(:'pe_id', 'pref-e-123');
reset role;
-- Estados ajustados direto (superusuário) para o teste não depender do preço nem do webhook.
update public.pedidos set mp_payment_id = '7001', mp_status = 'pending' where id = :'pc_id';
update public.pedidos set status = 'aprovado', mp_payment_id = '7002' where id = :'pd_id';
update public.pedidos set criado_em = now() - interval '40 days' where id = :'pe_id';

-- 1. Caminho feliz: devolve só o código e a preferência
set role service_role;
select codigo as a_cod, mp_preference_id as a_pref from public.pedido_preferencia_para_reabrir(:'pa_cod', repeat('3', 64)) \gset
reset role;
select pg_temp.conferir(:'a_cod' = :'pa_cod' and :'a_pref' = 'pref-a-123', 'pendente com preferência reabre');
\echo ok 1 pedido pendente com preferencia devolve a preferencia

-- 2. Token errado, código inexistente, formato inválido e token de outro pedido: acesso_negado
set role service_role;
select pg_temp.esperar_erro(format($$select * from public.pedido_preferencia_para_reabrir(%L, repeat('f', 64))$$, :'pa_cod'), 'acesso_negado');
select pg_temp.esperar_erro($$select * from public.pedido_preferencia_para_reabrir('PBR-AAAAAA', repeat('3', 64))$$, 'acesso_negado');
select pg_temp.esperar_erro(format($$select * from public.pedido_preferencia_para_reabrir(%L, 'curto')$$, :'pa_cod'), 'acesso_negado');
select pg_temp.esperar_erro($$select * from public.pedido_preferencia_para_reabrir(null, null)$$, 'acesso_negado');
select pg_temp.esperar_erro(format($$select * from public.pedido_preferencia_para_reabrir(%L, repeat('4', 64))$$, :'pa_cod'), 'acesso_negado');
\echo ok 2 token errado, codigo inexistente e formato invalido recusados com acesso_negado

-- 3. Estados que não podem ser reabertos
select pg_temp.esperar_erro(format($$select * from public.pedido_preferencia_para_reabrir(%L, repeat('4', 64))$$, :'pb_cod'), 'pedido_nao_reabrivel');
select pg_temp.esperar_erro(format($$select * from public.pedido_preferencia_para_reabrir(%L, repeat('5', 64))$$, :'pc_cod'), 'pagamento_em_andamento');
select pg_temp.esperar_erro(format($$select * from public.pedido_preferencia_para_reabrir(%L, repeat('6', 64))$$, :'pd_cod'), 'pedido_nao_pendente');
select pg_temp.esperar_erro(format($$select * from public.pedido_preferencia_para_reabrir(%L, repeat('7', 64))$$, :'pe_cod'), 'pedido_nao_reabrivel');
reset role;
\echo ok 3 sem preferencia, pagamento em andamento, aprovado e antigo nao reabrem

-- 4. Só a service role executa; anon e authenticated nem enxergam a função
set role anon;
select pg_temp.esperar_erro(format($$select * from public.pedido_preferencia_para_reabrir(%L, repeat('3', 64))$$, :'pa_cod'), 'permission denied');
reset role;
set role authenticated;
select pg_temp.esperar_erro(format($$select * from public.pedido_preferencia_para_reabrir(%L, repeat('3', 64))$$, :'pa_cod'), 'permission denied');
reset role;
\echo ok 4 anon e authenticated sem permissao de execucao

-- 5. Nada mudou nos pedidos (função só lê); segurança da função
select pg_temp.conferir((select status = 'pendente' and mp_payment_id is null and mp_preference_id = 'pref-a-123'
                           from public.pedidos where id = :'pa_id'), 'pedido A intacto');
do $$ declare v_cols text; begin
  select string_agg(p.parameter_name, ',') into v_cols
    from information_schema.parameters p
    join information_schema.routines r on r.specific_name = p.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'pedido_preferencia_para_reabrir' and p.parameter_mode = 'OUT';
  if string_to_array(v_cols, ',') && array['nome', 'email', 'whatsapp', 'token_hash', 'origem', 'mp_payment_id'] then
    raise exception 'FALHOU: pedido_preferencia_para_reabrir expõe dados pessoais: %', v_cols; end if;
  if not exists (select 1 from pg_proc where proname = 'pedido_preferencia_para_reabrir' and prosecdef
                  and provolatile = 's' and proconfig @> array['search_path=""']) then
    raise exception 'FALHOU: sem security definer / stable / search_path vazio'; end if;
  if has_function_privilege('public', 'public.pedido_preferencia_para_reabrir(text, text)', 'execute') then
    raise exception 'FALHOU: execute liberado para public'; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity) then
    raise exception 'FALHOU: tabela sem RLS'; end if;
end $$;
\echo ok 5 funcao so le, sem dados pessoais, security definer stable com search_path vazio, RLS em todas as tabelas
\echo TODOS OS TESTES DE REABRIR PAGAMENTO PASSARAM
