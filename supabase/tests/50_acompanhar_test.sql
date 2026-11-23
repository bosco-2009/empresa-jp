-- Testes de pedido_acompanhar (melhoria 30). Rodar depois das migrations e dos outros testes.
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

-- Pedidos de teste: X aprovado (token '1'*64), Y pendente (token '2'*64)
set role service_role;
select pedido_id as px_id, codigo as px_cod from public.pedido_criar('profissional', 'Iara Lima', 'iara@exemplo.com', '11922221111',
  encode(sha256(convert_to(repeat('1', 64), 'UTF8')), 'hex')) \gset
select pedido_id as py_id, codigo as py_cod from public.pedido_criar('essencial', 'Joel Reis', 'joel@exemplo.com', '11911110000',
  encode(sha256(convert_to(repeat('2', 64), 'UTF8')), 'hex')) \gset
select public.pedido_registrar_pagamento(:'px_id', '5001', 'approved', 'accredited', 99700, 'BRL') \gset
reset role;

-- 1. Token errado, código inexistente e formatos inválidos: o mesmo erro
set role anon;
select pg_temp.esperar_erro(format($$select * from public.pedido_acompanhar(%L, repeat('f', 64))$$, :'px_cod'), 'acesso_negado');
select pg_temp.esperar_erro($$select * from public.pedido_acompanhar('PBR-AAAAAA', repeat('1', 64))$$, 'acesso_negado');
select pg_temp.esperar_erro(format($$select * from public.pedido_acompanhar(%L, 'curto')$$, :'px_cod'), 'acesso_negado');
select pg_temp.esperar_erro($$select * from public.pedido_acompanhar(null, null)$$, 'acesso_negado');
select pg_temp.esperar_erro(format($$select * from public.pedido_acompanhar(lower(%L), repeat('1', 64))$$, :'px_cod'), 'acesso_negado');
-- o token de um pedido não abre outro
select pg_temp.esperar_erro(format($$select * from public.pedido_acompanhar(%L, repeat('2', 64))$$, :'px_cod'), 'acesso_negado');
\echo ok 1 token errado, codigo inexistente e formato invalido recusados com acesso_negado

-- 2. Pedido pendente: etapa nao_pago, sem datas
select etapa as y_etapa, pedido_status as y_status, pago_em is null as y_sem_pago, briefing_em is null as y_sem_brief
  from public.pedido_acompanhar(:'py_cod', repeat('2', 64)) \gset
reset role;
select pg_temp.conferir(not (:'y_etapa' <> 'nao_pago' or :'y_status' <> 'pendente' or :'y_sem_pago' <> 't' or :'y_sem_brief' <> 't'), 'pedido pendente');
\echo ok 2 pedido pendente aparece como nao_pago

-- 3. Pago sem briefing
set role anon;
select etapa as x1_etapa, plano_nome || '|' || plano_id as x1_plano, pago_em is not null as x1_tem_pago, etapa_em is null as x1_sem_etapa_em
  from public.pedido_acompanhar(:'px_cod', repeat('1', 64)) \gset
reset role;
select pg_temp.conferir(not (:'x1_etapa' <> 'pago' or :'x1_plano' <> 'Profissional|profissional' or :'x1_tem_pago' <> 't' or :'x1_sem_etapa_em' <> 't'), 'pago sem briefing');
\echo ok 3 pago sem briefing: etapa pago com a data do pagamento

-- 4. Briefing enviado pelo cliente → briefing_recebido
set role anon;
select * from public.briefing_enviar(:'px_cod', repeat('1', 64), '{"nome_negocio": "Ateliê da Iara"}');
select etapa as x2_etapa, briefing_em is not null as x2_tem_brief, etapa_em is null as x2_sem_etapa_em
  from public.pedido_acompanhar(:'px_cod', repeat('1', 64)) \gset
reset role;
select pg_temp.conferir(not (:'x2_etapa' <> 'briefing_recebido' or :'x2_tem_brief' <> 't' or :'x2_sem_etapa_em' <> 't'), 'briefing recebido');
\echo ok 4 briefing enviado: etapa briefing_recebido

-- 5. O dono muda a etapa pelo status do briefing (admin pelo RLS); intruso não consegue
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';  -- não admin
update public.briefings set status = 'entregue' where pedido_id = :'px_id';
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';  -- admin
update public.briefings set status = 'em_producao' where pedido_id = :'px_id';
reset role;
set role anon;
select etapa as x3_etapa, briefing_status as x3_bs, etapa_em is not null as x3_tem_etapa_em
  from public.pedido_acompanhar(:'px_cod', repeat('1', 64)) \gset
reset role;
select pg_temp.conferir(not (:'x3_etapa' <> 'em_producao' or :'x3_bs' <> 'em_producao' or :'x3_tem_etapa_em' <> 't'), 'em produção');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.briefings set status = 'em_revisao' where pedido_id = :'px_id';
reset role;
set role anon;
select etapa as x4_etapa, briefing_status as x4_bs from public.pedido_acompanhar(:'px_cod', repeat('1', 64)) \gset
reset role;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.briefings set status = 'entregue' where pedido_id = :'px_id';
reset role;
set role anon;
select etapa as x5_etapa from public.pedido_acompanhar(:'px_cod', repeat('1', 64)) \gset
reset role;
select pg_temp.conferir(not (:'x4_etapa' <> 'em_producao' or :'x4_bs' <> 'em_revisao' or :'x5_etapa' <> 'entregue'), 'em revisão / entregue');
\echo ok 5 status do briefing mudado pelo admin vira a etapa (em_producao, em_revisao, entregue); intruso nao muda

-- 6. Reembolso: volta para nao_pago e esconde as datas do briefing
set role service_role;
select public.pedido_registrar_pagamento(:'px_id', '5001', 'refunded', 'refunded', 99700, 'BRL') \gset
reset role;
set role anon;
select etapa as x6_etapa, pedido_status as x6_status, briefing_status is null as x6_sem_bs, pago_em is null as x6_sem_pago
  from public.pedido_acompanhar(:'px_cod', repeat('1', 64)) \gset
reset role;
select pg_temp.conferir(not (:'x6_etapa' <> 'nao_pago' or :'x6_status' <> 'reembolsado' or :'x6_sem_bs' <> 't' or :'x6_sem_pago' <> 't'), 'reembolsado');
\echo ok 6 pedido reembolsado aparece como nao_pago, sem dados do briefing

-- 7. Sem dados pessoais na saída; permissões e segurança da função
do $$ declare v_cols text; begin
  select string_agg(p.parameter_name, ',') into v_cols
    from information_schema.parameters p
    join information_schema.routines r on r.specific_name = p.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'pedido_acompanhar' and p.parameter_mode = 'OUT';
  if string_to_array(v_cols, ',') && array['nome', 'email', 'whatsapp', 'token_hash', 'nome_negocio', 'origem', 'cidade', 'mp_payment_id'] then
    raise exception 'FALHOU: pedido_acompanhar expõe dados pessoais: %', v_cols; end if;
  if not exists (select 1 from pg_proc where proname = 'pedido_acompanhar' and prosecdef
                  and proconfig @> array['search_path=""']) then
    raise exception 'FALHOU: pedido_acompanhar sem security definer / search_path vazio'; end if;
  if has_function_privilege('public', 'public.pedido_acompanhar(text, text)', 'execute') then
    raise exception 'FALHOU: execute liberado para public'; end if;
  if not has_function_privilege('anon', 'public.pedido_acompanhar(text, text)', 'execute') then
    raise exception 'FALHOU: anon não executa'; end if;
  if has_function_privilege('anon', 'public._pedido_do_cliente(text, text)', 'execute') then
    raise exception 'FALHOU: anon executa a auxiliar _pedido_do_cliente'; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity) then
    raise exception 'FALHOU: tabela sem RLS'; end if;
end $$;
\echo ok 7 sem dados pessoais, security definer com search_path vazio, grants minimos, RLS em todas as tabelas
\echo TODOS OS TESTES DE ACOMPANHAMENTO PASSARAM
