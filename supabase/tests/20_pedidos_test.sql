-- Testes da migration de pedidos (rodar depois de 00_stubs, das migrations e de 10_chat_test).
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

-- token de teste: 'c' * 64; hash calculado aqui
select encode(sha256(convert_to(repeat('c', 64), 'UTF8')), 'hex') as hash_c \gset

-- ===================== service_role (Edge Function) =====================
set role service_role;

-- 1. Preço vem da tabela planos; dados normalizados; código legível
select * from public.pedido_criar('profissional', '  Ana Souza ', ' Ana@Exemplo.COM ', '(21) 97777-6666', :'hash_c') \gset p1_
reset role;
do $$ declare r public.pedidos; begin
  select * into r from public.pedidos order by criado_em desc limit 1;
  if r.valor_centavos <> 99700 or r.plano_nome <> 'Profissional' or r.nome <> 'Ana Souza'
     or r.email <> 'ana@exemplo.com' or r.whatsapp <> '21977776666' or r.status <> 'pendente'
     or r.codigo !~ '^PBR-[A-HJ-NP-Z2-9]{6}$' or r.aceite_termos_em is null then
    raise exception 'FALHOU: pedido criado errado: %', row_to_json(r);
  end if;
end $$;
\echo ok 1 pedido criado com preco do servidor, dados normalizados e codigo legivel

set role service_role;
select pg_temp.esperar_erro($$select * from public.pedido_criar('inexistente', 'Ana', 'a@b.co', '11999998888', repeat('a', 64))$$, 'plano_invalido');
select pg_temp.esperar_erro($$select * from public.pedido_criar('essencial', 'A', 'a@b.co', '11999998888', repeat('a', 64))$$, 'nome_invalido');
select pg_temp.esperar_erro($$select * from public.pedido_criar('essencial', 'Ana', 'sem-arroba', '11999998888', repeat('a', 64))$$, 'email_invalido');
select pg_temp.esperar_erro($$select * from public.pedido_criar('essencial', 'Ana', 'a@b.co', '123', repeat('a', 64))$$, 'whatsapp_invalido');
select pg_temp.esperar_erro($$select * from public.pedido_criar('essencial', 'Ana', 'a@b.co', '11999998888', 'xyz')$$, 'token_invalido');
reset role;
update public.planos set ativo = false where id = 'premium';
set role service_role;
select pg_temp.esperar_erro($$select * from public.pedido_criar('premium', 'Ana', 'a@b.co', '11999998888', repeat('a', 64))$$, 'plano_invalido');
reset role;
update public.planos set ativo = true where id = 'premium';
\echo ok 2 validacoes de plano, nome, email, whatsapp, token e plano inativo

-- 3. Limite por e-mail (5 por hora; já existe 1 da ana)
set role service_role;
do $$ begin
  for i in 1..4 loop
    perform public.pedido_criar('essencial', 'Ana Souza', 'ana@exemplo.com', '21977776666', repeat('d', 64));
  end loop;
end $$;
select pg_temp.esperar_erro($$select * from public.pedido_criar('essencial', 'Ana Souza', 'ANA@exemplo.com', '21977776666', repeat('d', 64))$$, 'limite_pedidos');
reset role;
\echo ok 3 limite de 5 pedidos por e-mail por hora

-- ===================== anon =====================
set role anon;
select pg_temp.esperar_erro('select * from public.pedidos', 'permission denied');
select pg_temp.esperar_erro('select * from public.planos', 'permission denied');
select pg_temp.esperar_erro('select * from public.pedidos_eventos', 'permission denied');
select pg_temp.esperar_erro($$select * from public.pedido_criar('essencial', 'Ana', 'a@b.co', '11999998888', repeat('a', 64))$$, 'permission denied');
select pg_temp.esperar_erro($$select public.pedido_registrar_pagamento(gen_random_uuid(), '1', 'approved', null, 1, 'BRL')$$, 'permission denied');
select pg_temp.esperar_erro($$select public.pedido_definir_preferencia(gen_random_uuid(), 'x')$$, 'permission denied');
\echo ok 4 anon sem acesso a tabelas nem as funcoes da service role

-- 5. Consulta do próprio pedido: só com token certo, sem dados pessoais
select pg_temp.esperar_erro(format($$select * from public.pedido_consultar(%L, repeat('f', 64))$$, :'p1_codigo'), 'acesso_negado');
select pg_temp.esperar_erro($$select * from public.pedido_consultar('PBR-AAAAAA', repeat('c', 64))$$, 'acesso_negado');
select pg_temp.esperar_erro(format($$select * from public.pedido_consultar(%L, 'curto')$$, :'p1_codigo'), 'acesso_negado');
\o
select status as consulta_status, valor_centavos as consulta_valor from public.pedido_consultar(:'p1_codigo', repeat('c', 64)) \gset
\o /dev/null
reset role;
\if :{?consulta_status}
\else
  \echo FALHOU: consulta com token certo nao retornou
  select 1/0;
\endif
select (:'consulta_status' = 'pendente' and :'consulta_valor' = '99700') as consulta_ok \gset
\if :consulta_ok
\else
  \echo FALHOU: consulta retornou dados errados
  select 1/0;
\endif
do $$ begin
  if exists (select 1 from information_schema.routines r
             join information_schema.parameters p on p.specific_name = r.specific_name
             where r.routine_name = 'pedido_consultar' and p.parameter_mode = 'OUT'
               and p.parameter_name in ('nome', 'email', 'whatsapp', 'token_hash')) then
    raise exception 'FALHOU: pedido_consultar expõe dados pessoais';
  end if;
end $$;
\echo ok 5 consulta por codigo + token, sem dados pessoais; token errado e codigo inexistente negados igual

-- ===================== Webhook: registrar pagamento =====================
set role service_role;
select public.pedido_definir_preferencia(:'p1_pedido_id', 'pref-123') \gset
do $$ declare v uuid; r text; begin
  select id into v from public.pedidos where mp_preference_id = 'pref-123';
  -- pendente (pix gerado)
  r := public.pedido_registrar_pagamento(v, '1001', 'pending', 'pending_waiting_transfer', 99700, 'BRL');
  if r <> 'aplicado' then raise exception 'FALHOU 6a: %', r; end if;
  -- valor divergente não aprova
  r := public.pedido_registrar_pagamento(v, '1002', 'approved', 'accredited', 100, 'BRL');
  if r <> 'valor_divergente' then raise exception 'FALHOU 6b: %', r; end if;
  r := public.pedido_registrar_pagamento(v, '1003', 'approved', 'accredited', 99700, 'USD');
  if r <> 'valor_divergente' then raise exception 'FALHOU 6c: %', r; end if;
  if (select status from public.pedidos where id = v) <> 'pendente' then raise exception 'FALHOU 6d: aprovou valor divergente'; end if;
  -- aprovado
  r := public.pedido_registrar_pagamento(v, '1001', 'approved', 'accredited', 99700, 'BRL');
  if r <> 'aplicado' then raise exception 'FALHOU 6e: %', r; end if;
  -- repetido (idempotente)
  r := public.pedido_registrar_pagamento(v, '1001', 'approved', 'accredited', 99700, 'BRL');
  if r <> 'repetido' then raise exception 'FALHOU 6f: %', r; end if;
  -- tentativa recusada atrasada de outro pagamento não derruba o aprovado
  r := public.pedido_registrar_pagamento(v, '1000', 'rejected', 'cc_rejected_other_reason', 99700, 'BRL');
  if r <> 'ignorado_aprovado' then raise exception 'FALHOU 6g: %', r; end if;
  if (select status from public.pedidos where id = v) <> 'aprovado' or (select pago_em from public.pedidos where id = v) is null then
    raise exception 'FALHOU 6h'; end if;
  -- reembolso do pagamento aprovado
  r := public.pedido_registrar_pagamento(v, '1001', 'refunded', 'refunded', 99700, 'BRL');
  if r <> 'aplicado' or (select status from public.pedidos where id = v) <> 'reembolsado' then raise exception 'FALHOU 6i: %', r; end if;
  -- reembolso é final
  r := public.pedido_registrar_pagamento(v, '1001', 'approved', 'accredited', 99700, 'BRL');
  if r <> 'ignorado_aprovado' then raise exception 'FALHOU 6j: %', r; end if;
  -- inexistente e status desconhecido
  if public.pedido_registrar_pagamento(gen_random_uuid(), '1', 'approved', null, 1, 'BRL') <> 'pedido_inexistente' then raise exception 'FALHOU 6k'; end if;
end $$;
select pg_temp.esperar_erro(format($$select public.pedido_registrar_pagamento(%L, '1', 'xpto', null, 1, 'BRL')$$, :'p1_pedido_id'), 'status_mp_desconhecido');
select pg_temp.esperar_erro(format($$select public.pedido_registrar_pagamento(%L, 'abc; drop', 'approved', null, 1, 'BRL')$$, :'p1_pedido_id'), 'payment_id_invalido');
reset role;
do $$ begin
  if (select count(*) from public.pedidos_eventos) <> 8 then
    raise exception 'FALHOU: eventos de auditoria = %', (select count(*) from public.pedidos_eventos); end if;
end $$;
\echo ok 6 webhook: pendente, valor/moeda divergente, aprovado, idempotente, fora de ordem, reembolso final, auditoria

-- 7. Recusado e depois aprovado com outro pagamento (nova tentativa) é aplicado
set role service_role;
do $$ declare v uuid; r text; begin
  select pedido_id into v from public.pedido_criar('essencial', 'Bruno', 'bruno@exemplo.com', '11988887777', repeat('e', 64));
  r := public.pedido_registrar_pagamento(v, '2001', 'rejected', 'cc_rejected_insufficient_amount', 49700, 'BRL');
  if r <> 'aplicado' or (select status from public.pedidos where id = v) <> 'recusado' then raise exception 'FALHOU 7a'; end if;
  r := public.pedido_registrar_pagamento(v, '2002', 'approved', 'accredited', 49700, 'brl');
  if r <> 'aplicado' or (select status from public.pedidos where id = v) <> 'aprovado' then raise exception 'FALHOU 7b'; end if;
end $$;
reset role;
\echo ok 7 nova tentativa aprovada apos recusa

-- ===================== authenticated =====================
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';  -- não admin
do $$ begin
  if (select count(*) from public.pedidos) <> 0 or (select count(*) from public.pedidos_eventos) <> 0 then
    raise exception 'FALHOU: não-admin leu pedidos'; end if;
end $$;
select pg_temp.esperar_erro($$update public.pedidos set status = 'aprovado'$$, 'permission denied');
select pg_temp.esperar_erro($$insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em) values ('PBR-ZZZZZZ', repeat('a',64), 'essencial', 'x', 1, 'xx', 'a@b.co', '11999998888', now())$$, 'permission denied');
select pg_temp.esperar_erro($$select * from public.pedido_criar('essencial', 'Ana', 'a@b.co', '11999998888', repeat('a', 64))$$, 'permission denied');
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';  -- admin
do $$ begin
  if (select count(*) from public.pedidos) < 6 or (select count(*) from public.pedidos_eventos) < 8 then
    raise exception 'FALHOU: admin não lê pedidos'; end if;
end $$;
select pg_temp.esperar_erro($$update public.pedidos set status = 'aprovado'$$, 'permission denied');
select pg_temp.esperar_erro($$delete from public.pedidos$$, 'permission denied');
reset role;
\echo ok 8 admin so le; ninguem do front cria ou muda status

do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity) then
    raise exception 'FALHOU: tabela sem RLS'; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pedidos') then
    raise exception 'FALHOU: pedidos fora do realtime'; end if;
end $$;
\echo ok 9 RLS em todas as tabelas e pedidos no realtime
\echo TODOS OS TESTES DE PEDIDOS PASSARAM
