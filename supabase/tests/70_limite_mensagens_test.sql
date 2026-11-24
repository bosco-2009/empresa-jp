-- Testes da melhoria 96: limite de mensagens do chat por visitante, por minuto (chat_enviar).
-- Rodar depois de 00_stubs, de todas as migrations e de 10_chat_test.sql (usa só visitantes novos).
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

-- Devolve "sqlstate|mensagem|hint" do erro de p_sql (ou 'sem_erro').
create or replace function pg_temp.erro_de(p_sql text) returns text language plpgsql as $$
declare
  v_estado text; v_msg text; v_hint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_estado = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    return v_estado || '|' || v_msg || '|' || coalesce(v_hint, '');
  end;
  return 'sem_erro';
end $$;
grant execute on function pg_temp.erro_de(text) to anon, authenticated;

create or replace function pg_temp.conferir(p_ok boolean, p_o_que text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FALHOU: %', p_o_que; end if;
end $$;
grant execute on function pg_temp.conferir(boolean, text) to anon, authenticated;

-- Quantas mensagens do visitante existem na conversa dele (lido como postgres).
create or replace function pg_temp.n_visitante(p_visitante uuid) returns integer language sql as $$
  select count(*)::integer from public.mensagens m join public.conversas c on c.id = m.conversa_id
   where c.visitante_id = p_visitante and m.autor = 'visitante';
$$;

\set v4 '''44444444-4444-4444-4444-444444444444'''
\set t4 '''dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'''
\set v5 '''55555555-5555-5555-5555-555555555555'''
\set t5 '''eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'''
\set v6 '''66666666-6666-6666-6666-666666666666'''
\set t6 '''ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'''

set role anon;
select count(*) from public.chat_iniciar(:v4, :t4) \gset
select count(*) from public.chat_iniciar(:v5, :t5) \gset
select count(*) from public.chat_iniciar(:v6, :t6) \gset

-- 1. Exatamente N (8) mensagens no mesmo minuto passam; a N+1 é recusada com limite_mensagens
do $$ begin
  for i in 1..8 loop
    perform public.chat_enviar('44444444-4444-4444-4444-444444444444', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'msg ' || i);
  end loop;
end $$;
select pg_temp.conferir(
  pg_temp.erro_de($$select * from public.chat_enviar('44444444-4444-4444-4444-444444444444', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'msg 9')$$)
    = 'P0001|limite_mensagens|janela_1_minuto',
  'a 9a mensagem no minuto deveria dar P0001 limite_mensagens (janela_1_minuto)');
reset role;
select pg_temp.conferir(pg_temp.n_visitante(:v4) = 8, 'mensagem recusada não pode ser gravada');
\echo ok 1 N passa, N+1 recusada com limite_mensagens e nada gravado

-- 2. Outro visitante não é afetado pelo limite do primeiro
set role anon;
select pg_temp.conferir(
  pg_temp.erro_de($$select * from public.chat_enviar('55555555-5555-5555-5555-555555555555', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'oi')$$) = 'sem_erro',
  'visitante 5 não pode ser bloqueado pelo visitante 4');
\echo ok 2 limite isolado por visitante

-- 3. Janela: com as mensagens a 59 s ainda bloqueia; a 61 s (fora do minuto) volta a aceitar
reset role;
update public.mensagens set criado_em = now() - interval '59 seconds'
 where conversa_id = (select id from public.conversas where visitante_id = :v4);
set role anon;
select pg_temp.conferir(
  pg_temp.erro_de($$select * from public.chat_enviar('44444444-4444-4444-4444-444444444444', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'ainda cedo')$$)
    like 'P0001|limite_mensagens|%',
  'a 59 s as 8 mensagens ainda contam');
reset role;
update public.mensagens set criado_em = now() - interval '61 seconds'
 where conversa_id = (select id from public.conversas where visitante_id = :v4);
set role anon;
select pg_temp.conferir(
  pg_temp.erro_de($$select * from public.chat_enviar('44444444-4444-4444-4444-444444444444', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'depois do minuto')$$) = 'sem_erro',
  'com a janela expirada o visitante volta a enviar');
reset role;
select pg_temp.conferir(pg_temp.n_visitante(:v4) = 9, 'a mensagem depois da janela foi gravada');
\echo ok 3 janela de 1 minuto expira (59 s bloqueia, 61 s libera)

-- 4. Mensagens do admin não contam para o limite do visitante
insert into public.mensagens (conversa_id, autor, texto)
select c.id, 'admin', 'resposta ' || g from public.conversas c, generate_series(1, 12) g
 where c.visitante_id = :v5;
set role anon;
do $$ begin
  for i in 2..8 loop
    perform public.chat_enviar('55555555-5555-5555-5555-555555555555', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'msg ' || i);
  end loop;
end $$;
select pg_temp.conferir(
  pg_temp.erro_de($$select * from public.chat_enviar('55555555-5555-5555-5555-555555555555', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'msg 9')$$)
    like 'P0001|limite_mensagens|%',
  'visitante 5: 8 próprias + 12 do admin => só as 8 próprias contam, a 9a bloqueia');
reset role;
select pg_temp.conferir(pg_temp.n_visitante(:v5) = 8, 'visitante 5 com 8 mensagens');
\echo ok 4 mensagens do admin não contam

-- 5. O limite de 20 a cada 10 minutos continua valendo (com hint próprio)
insert into public.mensagens (conversa_id, autor, texto)
select c.id, 'visitante', 'antiga ' || g from public.conversas c, generate_series(1, 19) g
 where c.visitante_id = :v6;
update public.mensagens set criado_em = now() - interval '5 minutes'
 where conversa_id = (select id from public.conversas where visitante_id = :v6);
set role anon;
select pg_temp.conferir(
  pg_temp.erro_de($$select * from public.chat_enviar('66666666-6666-6666-6666-666666666666', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'vigésima')$$) = 'sem_erro',
  'a 20a mensagem em 10 minutos passa');
select pg_temp.conferir(
  pg_temp.erro_de($$select * from public.chat_enviar('66666666-6666-6666-6666-666666666666', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'vigésima primeira')$$)
    = 'P0001|limite_mensagens|janela_10_minutos',
  'a 21a mensagem em 10 minutos deveria dar limite_mensagens (janela_10_minutos)');
reset role;
-- mensagens com mais de 10 minutos não contam
update public.mensagens set criado_em = now() - interval '11 minutes'
 where conversa_id = (select id from public.conversas where visitante_id = :v6);
set role anon;
select pg_temp.conferir(
  pg_temp.erro_de($$select * from public.chat_enviar('66666666-6666-6666-6666-666666666666', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'nova janela')$$) = 'sem_erro',
  'depois de 10 minutos a janela longa também expira');
\echo ok 5 limite de 20 / 10 min mantido e com expiração

-- 6. Validações antigas continuam antes do limite (token errado não revela se há limite)
select pg_temp.conferir(
  pg_temp.erro_de($$select * from public.chat_enviar('44444444-4444-4444-4444-444444444444', repeat('x', 64), 'oi')$$) like '42501|acesso_negado|%',
  'token errado: acesso_negado');
select pg_temp.conferir(
  pg_temp.erro_de($$select * from public.chat_enviar('55555555-5555-5555-5555-555555555555', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '   ')$$) like '22023|texto_invalido|%',
  'texto vazio: texto_invalido mesmo no limite');
reset role;
\echo ok 6 acesso_negado e texto_invalido inalterados

-- 7. Segurança da função
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'chat_enviar' and p.prosecdef
                    and p.provolatile = 'v' and p.proconfig @> array['search_path=""']) then
    raise exception 'FALHOU: chat_enviar sem security definer / volatile / search_path vazio'; end if;
  if (select count(*) from pg_proc where proname = 'chat_enviar') <> 1 then
    raise exception 'FALHOU: chat_enviar duplicada (assinatura mudou?)'; end if;
  if has_function_privilege('public', 'public.chat_enviar(uuid, text, text)', 'execute') then
    raise exception 'FALHOU: execute liberado para public'; end if;
  if not has_function_privilege('anon', 'public.chat_enviar(uuid, text, text)', 'execute') then
    raise exception 'FALHOU: anon perdeu o execute de chat_enviar'; end if;
  if has_table_privilege('anon', 'public.mensagens', 'select') or has_table_privilege('anon', 'public.mensagens', 'insert') then
    raise exception 'FALHOU: anon com acesso direto a mensagens'; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity) then
    raise exception 'FALHOU: tabela sem RLS'; end if;
end $$;
\echo ok 7 security definer, search_path vazio, grants minimos e RLS em todas as tabelas
\echo TODOS OS TESTES DE LIMITE DE MENSAGENS PASSARAM
