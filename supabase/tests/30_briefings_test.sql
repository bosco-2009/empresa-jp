-- Testes da migration de briefings (rodar depois de 00_stubs, das migrations e dos testes anteriores).
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

-- Pedidos de teste: A aprovado (token 'a'*64), P pendente (token 'b'*64)
set role service_role;
select pedido_id as pa_id, codigo as pa_cod from public.pedido_criar('essencial', 'Gabi Nunes', 'gabi@exemplo.com', '11944443333',
  encode(sha256(convert_to(repeat('a', 64), 'UTF8')), 'hex')) \gset
select pedido_id as pp_id, codigo as pp_cod from public.pedido_criar('premium', 'Hugo Prado', 'hugo@exemplo.com', '11933332222',
  encode(sha256(convert_to(repeat('b', 64), 'UTF8')), 'hex')) \gset
select public.pedido_registrar_pagamento(:'pa_id', '3001', 'approved', 'accredited', 49700, 'BRL') \gset
reset role;
-- arquivo existente no bucket para o pedido A, e um de outro pedido
insert into storage.objects (bucket_id, name) values ('briefings', :'pa_id' || '/abc123-logo.png'), ('briefings', :'pp_id' || '/zzz-foto.jpg');

\set dados '{"nome_negocio": "  Doces da Gabi ", "segmento": "Confeitaria", "cidade": "Campinas/SP", "objetivo": "Receber encomendas pelo WhatsApp", "referencias": ["https://exemplo.com/a", " ", "http://exemplo.org/b"], "tem_dominio": "sim", "dominio": "DocesDaGabi.com.br", "links_arquivos": ["https://drive.google.com/x"], "arquivos": [{"caminho": "PA/abc123-logo.png", "nome": "logo.png", "tipo": "image/png", "tamanho": 1234}]}'

-- ===================== anon =====================
set role anon;
select pg_temp.esperar_erro('select * from public.briefings', 'permission denied');
select pg_temp.esperar_erro(format($$select * from public.briefing_autorizar_upload(%L, repeat('a', 64))$$, :'pa_cod'), 'permission denied');
\echo ok 1 anon sem acesso direto; autorizar_upload so para service role

-- 2. Token errado, código inexistente, pedido não aprovado
select pg_temp.esperar_erro(format($$select * from public.briefing_enviar(%L, repeat('f', 64), '{"nome_negocio": "X Y"}')$$, :'pa_cod'), 'acesso_negado');
select pg_temp.esperar_erro($$select * from public.briefing_enviar('PBR-AAAAAA', repeat('a', 64), '{"nome_negocio": "X Y"}')$$, 'acesso_negado');
select pg_temp.esperar_erro(format($$select * from public.briefing_enviar(%L, repeat('b', 64), '{"nome_negocio": "X Y"}')$$, :'pp_cod'), 'pedido_nao_aprovado');
\echo ok 2 token errado, codigo inexistente e pedido nao aprovado recusados

-- 3. Validações
select pg_temp.esperar_erro(format($$select * from public.briefing_enviar(%L, repeat('a', 64), '{"segmento": "x"}')$$, :'pa_cod'), 'nome_negocio_obrigatorio');
select pg_temp.esperar_erro(format($$select * from public.briefing_enviar(%L, repeat('a', 64), '{"nome_negocio": "Loja", "referencias": ["javascript:alert(1)"]}')$$, :'pa_cod'), 'link_invalido');
select pg_temp.esperar_erro(format($$select * from public.briefing_enviar(%L, repeat('a', 64), '{"nome_negocio": "Loja", "referencias": "https://x.com"}')$$, :'pa_cod'), 'links_invalidos');
select pg_temp.esperar_erro(format($$select * from public.briefing_enviar(%L, repeat('a', 64), %L)$$, :'pa_cod',
  '{"nome_negocio": "Loja", "links_arquivos": [' || (select string_agg('"https://x.com/' || i || '"', ',') from generate_series(1, 11) i) || ']}'), 'links_demais');
select pg_temp.esperar_erro(format($$select * from public.briefing_enviar(%L, repeat('a', 64), '{"nome_negocio": "Loja", "tem_dominio": "talvez"}')$$, :'pa_cod'), 'dados_invalidos');
-- arquivo de OUTRO pedido, arquivo inexistente e caminho com ../ são recusados
select pg_temp.esperar_erro(format($$select * from public.briefing_enviar(%L, repeat('a', 64), %L)$$, :'pa_cod',
  jsonb_build_object('nome_negocio', 'Loja', 'arquivos', jsonb_build_array(jsonb_build_object('caminho', :'pp_id' || '/zzz-foto.jpg')))), 'arquivo_invalido');
select pg_temp.esperar_erro(format($$select * from public.briefing_enviar(%L, repeat('a', 64), %L)$$, :'pa_cod',
  jsonb_build_object('nome_negocio', 'Loja', 'arquivos', jsonb_build_array(jsonb_build_object('caminho', :'pa_id' || '/nao-existe.png')))), 'arquivo_invalido');
select pg_temp.esperar_erro(format($$select * from public.briefing_enviar(%L, repeat('a', 64), %L)$$, :'pa_cod',
  jsonb_build_object('nome_negocio', 'Loja', 'arquivos', jsonb_build_array(jsonb_build_object('caminho', :'pa_id' || '/../' || :'pp_id' || '/zzz-foto.jpg')))), 'arquivo_invalido');
\echo ok 3 validacoes: nome obrigatorio, links http(s), limite de links, dominio, arquivos so do proprio pedido

-- 4. Envio válido (normalizado) e edição
select status as b_status from public.briefing_enviar(:'pa_cod', repeat('a', 64), replace(:'dados', 'PA', :'pa_id')::jsonb) \gset
select (:'b_status' = 'novo') as ok4 \gset
\if :ok4
\else
  \echo FALHOU 4: status inicial
  select 1/0;
\endif
select * from public.briefing_enviar(:'pa_cod', repeat('a', 64), '{"nome_negocio": "Doces da Gabi", "observacoes": "Quero tons de rosa"}') \gset
reset role;
do $$ declare b public.briefings; begin
  select * into b from public.briefings;
  if b.nome_negocio <> 'Doces da Gabi' or b.observacoes <> 'Quero tons de rosa' or b.envios <> 2
     or b.segmento is not null or cardinality(b.referencias) <> 0 then
    raise exception 'FALHOU 4b: edição não substituiu os dados: %', row_to_json(b); end if;
end $$;
set role anon;
select * from public.briefing_enviar(:'pa_cod', repeat('a', 64), replace(:'dados', 'PA', :'pa_id')::jsonb) \gset
reset role;
do $$ declare b public.briefings; begin
  select * into b from public.briefings;
  if b.nome_negocio <> 'Doces da Gabi' or b.dominio <> 'docesdagabi.com.br' or b.referencias <> array['https://exemplo.com/a', 'http://exemplo.org/b']
     or b.tem_dominio <> 'sim' or jsonb_array_length(b.arquivos) <> 1 or (b.arquivos -> 0 ->> 'tamanho')::int <> 1234 then
    raise exception 'FALHOU 4c: %', row_to_json(b); end if;
  if (select count(*) from public.briefings) <> 1 then raise exception 'FALHOU 4d: mais de um briefing por pedido'; end if;
end $$;
\echo ok 4 envio normalizado, edicao substitui os dados, um briefing por pedido

-- 5. briefing_obter
set role anon;
\o
select pedido_status as o_status, briefing ->> 'nome_negocio' as o_nome from public.briefing_obter(:'pa_cod', repeat('a', 64)) \gset
select pedido_status as o2_status, (briefing is null) as o2_vazio from public.briefing_obter(:'pp_cod', repeat('b', 64)) \gset
\o /dev/null
select pg_temp.esperar_erro(format($$select * from public.briefing_obter(%L, repeat('c', 64))$$, :'pa_cod'), 'acesso_negado');
reset role;
select (:'o_status' = 'aprovado' and :'o_nome' = 'Doces da Gabi' and :'o2_status' = 'pendente' and :'o2_vazio') as ok5 \gset
\if :ok5
\else
  \echo FALHOU 5: briefing_obter
  select 1/0;
\endif
\echo ok 5 briefing_obter devolve o proprio briefing e o status do pedido

-- 6. Autorização de upload (service role)
set role service_role;
\o
select arquivos_existentes as qtd from public.briefing_autorizar_upload(:'pa_cod', repeat('a', 64)) \gset
\o /dev/null
select pg_temp.esperar_erro(format($$select * from public.briefing_autorizar_upload(%L, repeat('b', 64))$$, :'pp_cod'), 'pedido_nao_aprovado');
select pg_temp.esperar_erro(format($$select * from public.briefing_autorizar_upload(%L, repeat('f', 64))$$, :'pa_cod'), 'acesso_negado');
reset role;
select (:qtd = 1) as ok6 \gset
\if :ok6
\else
  \echo FALHOU 6: contagem de arquivos
  select 1/0;
\endif
\echo ok 6 autorizar_upload: pasta do pedido e contagem; nega pendente e token errado

-- ===================== authenticated =====================
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';  -- não admin
do $$ begin
  if (select count(*) from public.briefings) <> 0 then raise exception 'FALHOU: não-admin leu briefing'; end if;
  if (select count(*) from storage.objects where bucket_id = 'briefings') <> 0 then raise exception 'FALHOU: não-admin listou arquivos'; end if;
end $$;
update public.briefings set status = 'entregue';  -- 0 linhas (RLS)
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';  -- admin
do $$ begin
  if (select count(*) from public.briefings) <> 1 then raise exception 'FALHOU: admin não lê briefing'; end if;
  if (select count(*) from storage.objects where bucket_id = 'briefings') <> 2 then raise exception 'FALHOU: admin não lista arquivos'; end if;
end $$;
select pg_temp.esperar_erro($$update public.briefings set nome_negocio = 'x'$$, 'permission denied');
select pg_temp.esperar_erro($$update public.briefings set status = 'pronto'$$, 'check');
update public.briefings set status = 'em_producao';
reset role;
do $$ begin
  if (select status from public.briefings) <> 'em_producao' then raise exception 'FALHOU: intruso mudou ou admin não mudou o status'; end if;
  if (select status_atualizado_em <= criado_em from public.briefings) then raise exception 'FALHOU: status_atualizado_em'; end if;
end $$;
\echo ok 7 admin le tudo (inclusive arquivos) e muda so o status; nao-admin nada

-- 8. Briefing travado depois que o admin muda o status
set role anon;
select pg_temp.esperar_erro(format($$select * from public.briefing_enviar(%L, repeat('a', 64), '{"nome_negocio": "Outro Nome"}')$$, :'pa_cod'), 'briefing_bloqueado');
reset role;
set role service_role;
select pg_temp.esperar_erro(format($$select * from public.briefing_autorizar_upload(%L, repeat('a', 64))$$, :'pa_cod'), 'briefing_bloqueado');
reset role;
\echo ok 8 cliente nao edita nem envia arquivo depois que o admin muda o status

do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity) then raise exception 'FALHOU: tabela sem RLS'; end if;
  if (select public or file_size_limit <> 5242880 or not ('application/pdf' = any(allowed_mime_types)) or 'image/svg+xml' = any(allowed_mime_types)
      from storage.buckets where id = 'briefings') then raise exception 'FALHOU: bucket'; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'briefings') then
    raise exception 'FALHOU: briefings fora do realtime'; end if;
end $$;
\echo ok 9 RLS, bucket privado 5 MB (imagens e PDF, sem SVG) e realtime
\echo TODOS OS TESTES DE BRIEFINGS PASSARAM
