-- Testes da migration do chat (rodar depois de 00_stubs e da migration).
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
grant execute on function pg_temp.esperar_erro(text, text) to anon, authenticated;

-- Dados fixos
\set v1 '''11111111-1111-1111-1111-111111111111'''
\set t1 '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
\set v2 '''22222222-2222-2222-2222-222222222222'''
\set t2 '''bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'''

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'dono@teste.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'intruso@teste.local');
insert into public.admins (user_id) values ('aaaaaaaa-0000-0000-0000-000000000001');

-- ===================== Visitante (anon) =====================
set role anon;

-- 1. Sem acesso direto às tabelas
select pg_temp.esperar_erro('select * from public.conversas', 'permission denied');
select pg_temp.esperar_erro('select * from public.mensagens', 'permission denied');
select pg_temp.esperar_erro($$insert into public.mensagens (conversa_id, autor, texto) values (gen_random_uuid(), 'admin', 'x')$$, 'permission denied');
select pg_temp.esperar_erro('select * from public.admins', 'permission denied');
\echo ok 1 anon sem acesso direto as tabelas

-- 2. Retomar sem conversa não cria nada
do $$ begin
  if (select count(*) from public.chat_iniciar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', p_criar => false)) <> 0 then
    raise exception 'FALHOU: p_criar=false criou conversa'; end if;
end $$;
\echo ok 2 p_criar=false nao cria

-- 3. Token inválido / curto
select pg_temp.esperar_erro($$select * from public.chat_iniciar('11111111-1111-1111-1111-111111111111', 'curto')$$, 'acesso_negado');
select pg_temp.esperar_erro($$select * from public.chat_iniciar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; drop table x')$$, 'acesso_negado');
\echo ok 3 token mal formado recusado

-- 4. Cria conversa com nome e WhatsApp normalizado
do $$ declare r record; begin
  select * into r from public.chat_iniciar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '  Maria  ', '(11) 99999-8888', '/index.html');
  if r.nome <> 'Maria' or r.whatsapp <> '11999998888' or r.status <> 'aberta' or length(r.canal) <> 64 then
    raise exception 'FALHOU: conversa criada errada: %', row_to_json(r); end if;
end $$;
select pg_temp.esperar_erro($$select * from public.chat_iniciar('33333333-3333-3333-3333-333333333333', 'cccccccccccccccccccccccccccccccccccccccc', null, '123')$$, 'whatsapp_invalido');
\echo ok 4 conversa criada, whatsapp normalizado e validado

-- 5. Outro token para o mesmo visitante_id é recusado (iniciar, listar, enviar)
select pg_temp.esperar_erro($$select * from public.chat_iniciar('11111111-1111-1111-1111-111111111111', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')$$, 'acesso_negado');
select pg_temp.esperar_erro($$select * from public.chat_listar('11111111-1111-1111-1111-111111111111', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')$$, 'acesso_negado');
select pg_temp.esperar_erro($$select * from public.chat_enviar('11111111-1111-1111-1111-111111111111', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'oi')$$, 'acesso_negado');
\echo ok 5 token errado recusado

-- 6. Enviar e listar
select count(*) from public.chat_enviar(:v1, :t1, '  Olá, quero um site!  ') \gset
do $$ declare r record; begin
  select * into r from public.chat_listar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  if r.texto <> 'Olá, quero um site!' or r.autor <> 'visitante' then raise exception 'FALHOU: listar: %', row_to_json(r); end if;
end $$;
select pg_temp.esperar_erro($$select * from public.chat_enviar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '   ')$$, 'texto_invalido');
select pg_temp.esperar_erro($$select * from public.chat_enviar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', repeat('x', 2001))$$, 'texto_invalido');
select pg_temp.esperar_erro($$select * from public.chat_enviar('22222222-2222-2222-2222-222222222222', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'oi')$$, 'conversa_inexistente');
\echo ok 6 enviar/listar, texto vazio, >2000 e conversa inexistente

-- 7. Visitante 2 não vê mensagens do visitante 1
select count(*) as n from public.chat_iniciar(:v2, :t2) \gset
do $$ begin
  if (select count(*) from public.chat_listar('22222222-2222-2222-2222-222222222222', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')) <> 0 then
    raise exception 'FALHOU: visitante 2 viu mensagens alheias'; end if;
end $$;
\echo ok 7 isolamento entre visitantes

-- 8. Limite: 20 mensagens do visitante a cada 10 minutos (já há 1). Desde a melhoria 96 também há
--    um limite por minuto (testado a fundo em 70_limite_mensagens_test.sql), então as mensagens vão
--    em blocos de 8 e as anteriores são "envelhecidas" para fora do minuto, mas dentro dos 10 minutos.
do $$ begin
  for i in 2..8 loop
    perform public.chat_enviar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'msg ' || i);
  end loop;
end $$;
reset role;
update public.mensagens set criado_em = now() - interval '5 minutes'
 where conversa_id = (select id from public.conversas where visitante_id = :v1) and autor = 'visitante';
set role anon;
do $$ begin
  for i in 9..16 loop
    perform public.chat_enviar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'msg ' || i);
  end loop;
end $$;
reset role;
update public.mensagens set criado_em = now() - interval '3 minutes'
 where conversa_id = (select id from public.conversas where visitante_id = :v1) and autor = 'visitante'
   and criado_em > now() - interval '1 minute';
set role anon;
do $$ begin
  for i in 17..20 loop
    perform public.chat_enviar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'msg ' || i);
  end loop;
end $$;
select pg_temp.esperar_erro($$select * from public.chat_enviar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'msg 21')$$, 'limite_mensagens');
\echo ok 8 limite de 20 mensagens / 10 min

-- 9. Funções internas não são executáveis por anon
select pg_temp.esperar_erro($$select public._chat_avisar_visitante('x', 'y', '{}')$$, 'permission denied');
select pg_temp.esperar_erro($$select public._chat_conversa_do_visitante('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$, 'permission denied');
do $$ begin if public.eh_admin() then raise exception 'FALHOU: anon é admin'; end if; end $$;
\echo ok 9 funcoes internas protegidas, anon nao e admin
reset role;

-- 10. Não lidas, aviso realtime no canal secreto e token não gravado em claro
do $$ declare c public.conversas; begin
  select * into c from public.conversas where visitante_id = '11111111-1111-1111-1111-111111111111';
  if c.nao_lidas_admin <> 20 then raise exception 'FALHOU: nao_lidas_admin = %', c.nao_lidas_admin; end if;
  if c.token_hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' then raise exception 'FALHOU: token em claro'; end if;
  if (select count(*) from realtime.enviados where topic = 'chat:' || c.canal and event = 'nova_mensagem' and private = false) <> 20 then
    raise exception 'FALHOU: avisos realtime'; end if;
  if exists (select 1 from realtime.enviados where payload ? 'texto') then raise exception 'FALHOU: aviso contém texto'; end if;
end $$;
\echo ok 10 nao_lidas, avisos realtime sem conteudo, token so em hash

-- ===================== Usuário autenticado que NÃO é admin =====================
select id as conversa1 from public.conversas where visitante_id = :v1 \gset
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$ begin
  if (select count(*) from public.conversas) <> 0 or (select count(*) from public.mensagens) <> 0 then
    raise exception 'FALHOU: não-admin enxergou dados'; end if;
  if public.eh_admin() then raise exception 'FALHOU: intruso é admin'; end if;
  if (select count(*) from public.admins) <> 0 then raise exception 'FALHOU: intruso vê admins'; end if;
end $$;
-- mesmo conhecendo o id real da conversa
select pg_temp.esperar_erro(format($$insert into public.mensagens (conversa_id, autor, texto) values (%L, 'admin', 'x')$$, :'conversa1'), 'row-level security');
update public.conversas set status = 'fechada' where id = :'conversa1';  -- 0 linhas (RLS)
select pg_temp.esperar_erro($$insert into public.admins (user_id) values ('aaaaaaaa-0000-0000-0000-000000000002')$$, 'permission denied');
reset role;
do $$ begin
  if (select status from public.conversas where visitante_id = '11111111-1111-1111-1111-111111111111') <> 'aberta' then
    raise exception 'FALHOU: intruso fechou conversa'; end if;
end $$;
\echo ok 11 autenticado nao-admin nao ve nem escreve nada

-- ===================== Admin =====================
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ declare v_id uuid; begin
  if not public.eh_admin() then raise exception 'FALHOU: dono não é admin'; end if;
  if (select count(*) from public.conversas) <> 2 then raise exception 'FALHOU: admin não vê conversas'; end if;
  select id into v_id from public.conversas where visitante_id = '11111111-1111-1111-1111-111111111111';
  insert into public.mensagens (conversa_id, autor, texto) values (v_id, 'admin', 'Oi Maria! Como posso ajudar?');
  if (select nao_lidas_admin from public.conversas where id = v_id) <> 0 then raise exception 'FALHOU: resposta não zerou não lidas'; end if;
  update public.conversas set status = 'fechada' where id = v_id;
  update public.conversas set nao_lidas_admin = 0 where id = v_id;
end $$;
select pg_temp.esperar_erro($$insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'falso' from public.conversas limit 1$$, 'row-level security');
select pg_temp.esperar_erro($$update public.conversas set token_hash = repeat('0', 64)$$, 'permission denied');
select pg_temp.esperar_erro($$update public.conversas set visitante_id = gen_random_uuid()$$, 'permission denied');
\echo ok 12 admin le, responde, fecha; nao forja visitante nem altera token
reset role;

-- 13. Visitante vê a resposta e reabre a conversa ao escrever
do $$ begin
  if (select count(*) from realtime.enviados where event = 'status' and payload->>'status' = 'fechada') <> 1 then
    raise exception 'FALHOU: aviso de status'; end if;
end $$;
set role anon;
do $$ declare r record; begin
  select * into r from public.chat_listar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', p_limite => 1);
  if r.autor <> 'admin' then raise exception 'FALHOU: visitante não viu resposta'; end if;
  select * into r from public.chat_iniciar('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', p_criar => false);
  if r.status <> 'fechada' then raise exception 'FALHOU: status'; end if;
  perform public.chat_enviar('22222222-2222-2222-2222-222222222222', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Oi');
end $$;
reset role;
update public.conversas set status = 'fechada' where visitante_id = '22222222-2222-2222-2222-222222222222';
set role anon;
select count(*) from public.chat_enviar(:v2, :t2, 'Voltei') \gset
reset role;
do $$ begin
  if (select status from public.conversas where visitante_id = '22222222-2222-2222-2222-222222222222') <> 'aberta' then
    raise exception 'FALHOU: mensagem do visitante não reabriu'; end if;
end $$;
\echo ok 13 visitante ve resposta; nova mensagem reabre conversa

-- 14. Realtime: tabelas na publicação
do $$ begin
  if (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('mensagens', 'conversas')) <> 2 then
    raise exception 'FALHOU: publicação realtime'; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity) then
    raise exception 'FALHOU: tabela sem RLS'; end if;
end $$;
\echo ok 14 realtime habilitado e RLS em todas as tabelas
\echo TODOS OS TESTES PASSARAM
