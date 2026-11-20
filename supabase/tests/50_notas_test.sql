-- Testes da migration de notas internas (melhoria 27). Rodar depois das migrations e dos outros testes.
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

-- Preparação: um admin, um intruso logado, uma conversa e um pedido.
insert into auth.users (id, email) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'dono-notas@exemplo.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'intruso-notas@exemplo.com')
on conflict (id) do nothing;
insert into public.admins (user_id) values ('bbbbbbbb-0000-0000-0000-000000000001') on conflict do nothing;

insert into public.conversas (id, visitante_id, token_hash)
values ('cccccccc-0000-0000-0000-000000000001', gen_random_uuid(), repeat('a', 64))
on conflict (id) do nothing;

select encode(sha256(convert_to(repeat('f', 64), 'UTF8')), 'hex') as hash_f \gset
set role service_role;
select * from public.pedido_criar('essencial', 'Notas Teste', 'notas@exemplo.com', '11955553333', :'hash_f') \gset p_
reset role;

-- 1. anon não lê nem executa
set role anon;
select pg_temp.esperar_erro('select * from public.notas', 'permission denied');
select pg_temp.esperar_erro($$select public.nota_salvar('cccccccc-0000-0000-0000-000000000001', null, 'x')$$, 'permission denied');
reset role;
\echo ok 1 anon sem acesso

-- 2. Logado que não é admin: função recusa, tabela não mostra nada, escrita direta proibida
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select pg_temp.esperar_erro($$select public.nota_salvar('cccccccc-0000-0000-0000-000000000001', null, 'x')$$, 'acesso negado');
select pg_temp.esperar_erro($$insert into public.notas (conversa_id, texto) values ('cccccccc-0000-0000-0000-000000000001', 'x')$$, 'permission denied');
reset role;
\echo ok 2 nao-admin recusado

-- 3. Admin cria nota da conversa (p_esperado null) e lê de volta
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
select public.nota_salvar('cccccccc-0000-0000-0000-000000000001', null, E'Cliente quer loja\ncom Pix') as t1 \gset
do $$ begin
  if (select texto from public.notas where conversa_id = 'cccccccc-0000-0000-0000-000000000001') <> E'Cliente quer loja\ncom Pix' then
    raise exception 'FALHOU: admin não lê a nota criada'; end if;
  if (select atualizado_por from public.notas where conversa_id = 'cccccccc-0000-0000-0000-000000000001') <> 'bbbbbbbb-0000-0000-0000-000000000001' then
    raise exception 'FALHOU: atualizado_por não registrado'; end if;
end $$;
-- Escrita direta continua proibida mesmo para o admin (só pela função)
select pg_temp.esperar_erro($$update public.notas set texto = 'y'$$, 'permission denied');
select pg_temp.esperar_erro($$delete from public.notas$$, 'permission denied');
\echo ok 3 admin cria e le a nota

-- 4. Atualiza com o carimbo certo; carimbo velho ou "não havia nota" dá conflito; forçar grava
select public.nota_salvar('cccccccc-0000-0000-0000-000000000001', null, 'versão 2', :'t1') as t2 \gset
select pg_temp.esperar_erro(format($$select public.nota_salvar('cccccccc-0000-0000-0000-000000000001', null, 'velha', %L)$$, :'t1'), 'nota_alterada');
select pg_temp.esperar_erro($$select public.nota_salvar('cccccccc-0000-0000-0000-000000000001', null, 'outra aba')$$, 'nota_alterada');
do $$ begin
  if (select texto from public.notas where conversa_id = 'cccccccc-0000-0000-0000-000000000001') <> 'versão 2' then
    raise exception 'FALHOU: conflito sobrescreveu a nota'; end if;
end $$;
select public.nota_salvar('cccccccc-0000-0000-0000-000000000001', null, 'forçada', :'t1', true) as t3 \gset
do $$ begin
  if (select texto from public.notas where conversa_id = 'cccccccc-0000-0000-0000-000000000001') <> 'forçada' then
    raise exception 'FALHOU: forçar não gravou'; end if;
end $$;
\echo ok 4 deteccao de edicao concorrente e gravacao forcada

-- 5. Carimbo sempre cresce, mesmo em gravações seguidas
select public.nota_salvar('cccccccc-0000-0000-0000-000000000001', null, 'a', :'t3') as t4 \gset
select public.nota_salvar('cccccccc-0000-0000-0000-000000000001', null, 'b', :'t4') as t5 \gset
select (:'t5'::timestamptz > :'t4'::timestamptz and :'t4'::timestamptz > :'t3'::timestamptz) as cresceu \gset
\if :cresceu
\else
  select 1/0 as "FALHOU: carimbo não cresceu";
\endif
\echo ok 5 carimbo crescente

-- 6. Nota do pedido é separada da nota da conversa; vazio é permitido (nota apagada pelo dono)
select public.nota_salvar(null, :'p_pedido_id', 'Pediu nota fiscal') as tp \gset
select public.nota_salvar(null, :'p_pedido_id', '', :'tp') as tp2 \gset
do $$ begin
  if (select count(*) from public.notas) < 2 then raise exception 'FALHOU: notas não separadas'; end if;
  if (select texto from public.notas where pedido_id is not null and conversa_id is null limit 1) <> '' then
    raise exception 'FALHOU: nota vazia não gravada'; end if;
end $$;
\echo ok 6 nota de pedido e nota vazia

-- 7. Validações: alvo duplo/nenhum, texto longo, alvo inexistente
select pg_temp.esperar_erro($$select public.nota_salvar(null, null, 'x')$$, 'informe uma conversa ou um pedido');
select pg_temp.esperar_erro(format($$select public.nota_salvar('cccccccc-0000-0000-0000-000000000001', %L, 'x')$$, :'p_pedido_id'), 'informe uma conversa ou um pedido');
select pg_temp.esperar_erro(format($$select public.nota_salvar(null, %L, repeat('x', 5001), %L)$$, :'p_pedido_id', :'tp2'), 'nota longa demais');
select pg_temp.esperar_erro($$select public.nota_salvar('dddddddd-0000-0000-0000-000000000009', null, 'x')$$, 'foreign key');
select public.nota_salvar(null, :'p_pedido_id', repeat('x', 5000), :'tp2') as tp3 \gset
\echo ok 7 validacoes

-- 8. Intruso logado não vê as notas pelo RLS
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $$ begin
  if (select count(*) from public.notas) <> 0 then raise exception 'FALHOU: intruso vê notas'; end if;
end $$;
reset role;
\echo ok 8 intruso nao ve notas

-- 9. Apagar a conversa apaga a nota (cascade); RLS em todas as tabelas; função com search_path vazio
delete from public.conversas where id = 'cccccccc-0000-0000-0000-000000000001';
do $$ begin
  if exists (select 1 from public.notas where conversa_id = 'cccccccc-0000-0000-0000-000000000001') then
    raise exception 'FALHOU: nota órfã'; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity) then
    raise exception 'FALHOU: tabela sem RLS'; end if;
  if not exists (select 1 from pg_proc where proname = 'nota_salvar' and prosecdef
                 and proconfig @> array['search_path=""']) then
    raise exception 'FALHOU: nota_salvar sem search_path vazio'; end if;
end $$;
\echo ok 9 cascade, RLS e search_path
\echo TODOS OS TESTES DE NOTAS PASSARAM
