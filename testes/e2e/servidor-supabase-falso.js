// SOMENTE PARA TESTES LOCAIS. Uso: veja testes/README.md
// Servidor que imita as partes do Supabase usadas pelo site, executando tudo no Postgres local
// (com os papéis anon/authenticated e o RLS reais da migration):
//   /rest/v1/rpc/*      -> funções SQL
//   /rest/v1/conversas  -> consultas do painel (RLS como "authenticated")
//   /rest/v1/mensagens
//   /auth/v1/token      -> login por senha (usuário fixo de teste)
//   /realtime/v1/websocket -> protocolo Phoenix vsn 2.0.0 (join, heartbeat, broadcast, postgres_changes)
const http = require('http');
const { Pool } = require('pg');
const { WebSocketServer } = require('ws');

const PORTA = Number(process.env.PORTA || 54321);
// Conexão via variáveis padrão do Postgres (PGHOST, PGUSER, PGPASSWORD...). Banco: BANCO ou pbr_e2e.
const pool = new Pool({ database: process.env.BANCO || 'pbr_e2e' });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(claims) + '.assinatura';
const ANON_KEY = jwt({ role: 'anon', iss: 'teste' });
const SERVICE_KEY = jwt({ role: 'service_role', iss: 'teste' });
const ADMIN = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'dono@teste.local', senha: 'senha-de-teste' };
const INTRUSO = { id: 'aaaaaaaa-0000-0000-0000-000000000002', email: 'intruso@teste.local', senha: 'senha-de-teste' };
const USUARIOS = [ADMIN, INTRUSO];

function claimsDe(req) {
  const h = req.headers.authorization || '';
  const t = h.replace(/^Bearer /, '');
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); } catch { return { role: 'anon' }; }
}

async function comoUsuario(req, sql, params) {
  const c = claimsDe(req);
  const cli = await pool.connect();
  try {
    await cli.query('begin');
    const papel = c.role === 'authenticated' ? 'authenticated' : c.role === 'service_role' ? 'service_role' : 'anon';
    await cli.query('set local role ' + papel);
    await cli.query("select set_config('request.jwt.claim.sub', $1, true)", [c.sub || '']);
    const r = await cli.query(sql, params);
    await cli.query('commit');
    return r;
  } catch (e) {
    await cli.query('rollback').catch(() => {});
    throw e;
  } finally {
    cli.release();
  }
}

function enviar(res, status, corpo, extra) {
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': '*'
  }, extra || {}));
  res.end(corpo === undefined ? '' : JSON.stringify(corpo));
}
function erroPg(res, e) {
  const status = e.code === '42501' ? 403 : 400;
  enviar(res, status, { code: e.code, message: e.message, details: null, hint: null });
}
const lerCorpo = (req) => new Promise((ok) => { let d = ''; req.on('data', (x) => (d += x)); req.on('end', () => ok(d ? JSON.parse(d) : {})); });

const ARGS_RPC = {
  chat_iniciar: ['p_visitante_id', 'p_token', 'p_nome', 'p_whatsapp', 'p_pagina', 'p_criar'],
  chat_listar: ['p_visitante_id', 'p_token', 'p_depois', 'p_limite'],
  chat_enviar: ['p_visitante_id', 'p_token', 'p_texto'],
  pedido_criar: ['p_plano_id', 'p_nome', 'p_email', 'p_whatsapp', 'p_token_hash'],
  pedido_definir_preferencia: ['p_pedido_id', 'p_preference_id'],
  pedido_definir_origem: ['p_pedido_id', 'p_origem'],
  pedido_registrar_pagamento: ['p_pedido_id', 'p_payment_id', 'p_mp_status', 'p_mp_status_detalhe', 'p_valor_centavos', 'p_moeda'],
  pedido_consultar: ['p_codigo', 'p_token'],
  pedido_acompanhar: ['p_codigo', 'p_token'],
  pedido_preferencia_para_reabrir: ['p_codigo', 'p_token'],
  briefing_enviar: ['p_codigo', 'p_token', 'p_dados'],
  briefing_obter: ['p_codigo', 'p_token'],
  briefing_autorizar_upload: ['p_codigo', 'p_token']
};
// Funções que devolvem um valor único (PostgREST responde o valor, não uma lista).
const ESCALARES = ['pedido_definir_preferencia', 'pedido_definir_origem', 'pedido_registrar_pagamento'];

// Edge Functions de verdade (os .ts do repositório), com o MP falso.
const AMBIENTE_FUNCOES = {
  SUPABASE_URL: 'http://localhost:' + PORTA,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  MP_ACCESS_TOKEN: process.env.MP_ACCESS_TOKEN || 'TEST-falso',
  MP_WEBHOOK_SECRET: process.env.MP_WEBHOOK_SECRET || 'segredo-teste',
  MP_API_URL: 'http://localhost:' + (process.env.PORTA_MP || 54400),
  SITE_URL: process.env.SITE || 'http://localhost:8080/',
};
let funcoes = null;
async function carregarFuncoes() {
  if (funcoes) return funcoes;
  const comum = await import('../../supabase/functions/_shared/comum.ts');
  const cp = await import('../../supabase/functions/_shared/criar-pagamento.ts');
  const wh = await import('../../supabase/functions/_shared/webhook-mercadopago.ts');
  const bu = await import('../../supabase/functions/_shared/briefing-upload.ts');
  const amb = comum.lerAmbiente((n) => AMBIENTE_FUNCOES[n]);
  funcoes = {
    'criar-pagamento': cp.criarHandlerCriarPagamento(amb),
    'webhook-mercadopago': wh.criarHandlerWebhook(amb),
    'briefing-upload': bu.criarHandlerBriefingUpload(amb),
  };
  return funcoes;
}
async function chamarFuncao(nome, req, res) {
  const f = (await carregarFuncoes())[nome];
  if (!f) return enviar(res, 404, { message: 'função inexistente' });
  const corpo = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : await new Promise((ok) => { const b = []; req.on('data', (x) => b.push(x)); req.on('end', () => ok(Buffer.concat(b))); });
  const resposta = await f(new Request('http://localhost:' + PORTA + req.url, { method: req.method, headers: req.headers, body: corpo }));
  registro.push({ funcao: nome, status: resposta.status });
  const cab = {};
  resposta.headers.forEach((v, k) => { cab[k] = v; });
  res.writeHead(resposta.status, cab);
  res.end(Buffer.from(await resposta.arrayBuffer()));
  setImmediate(publicarFila);
}

const registro = []; // chamadas recebidas (para o teste inspecionar)
let realtimeBloqueado = false; // queda simulada do Realtime (/__realtime/derrubar)

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS' && !url.pathname.startsWith('/functions/')) return enviar(res, 204);
  try {
    // ---------- testes: inspeção ----------
    if (url.pathname === '/__registro') return enviar(res, 200, registro);
    // Queda do Realtime (melhoria 79): derruba os WebSockets abertos e recusa novos até /__realtime/liberar.
    if (url.pathname === '/__realtime/derrubar') {
      realtimeBloqueado = true;
      for (const ws of sockets) ws.terminate();
      return enviar(res, 200, { derrubados: true });
    }
    if (url.pathname === '/__realtime/liberar') { realtimeBloqueado = false; return enviar(res, 200, { liberado: true }); }

    // ---------- Storage (bucket "briefings") ----------
    const st = /^\/storage\/v1\/object\/(upload\/sign|sign)\/([\w-]+)\/(.+)$/.exec(url.pathname);
    if (st) return storage(st[1], st[2], decodeURIComponent(st[3]), url, req, res);

    // ---------- Edge Functions ----------
    const fn = /^\/functions\/v1\/([\w-]+)$/.exec(url.pathname);
    if (fn) return chamarFuncao(fn[1], req, res);

    // ---------- auth ----------
    if (url.pathname === '/auth/v1/token') {
      const corpo = await lerCorpo(req);
      const u = USUARIOS.find((x) => x.email === corpo.email && x.senha === corpo.password);
      if (!u) return enviar(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const usuario = { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      return enviar(res, 200, {
        access_token: jwt({ sub: u.id, role: 'authenticated', aud: 'authenticated', exp, email: u.email, session_id: 's' }),
        token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r-' + u.id, user: usuario
      });
    }
    if (url.pathname === '/auth/v1/logout') return enviar(res, 204);
    if (url.pathname === '/auth/v1/user') {
      const c = claimsDe(req);
      const u = USUARIOS.find((x) => x.id === c.sub);
      return u ? enviar(res, 200, { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email }) : enviar(res, 401, { msg: 'no' });
    }

    // ---------- RPC ----------
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
    if (rpc) {
      const nome = rpc[1];
      const corpo = await lerCorpo(req);
      registro.push({ rpc: nome, corpo });
      if (nome === 'eh_admin') {
        const r = await comoUsuario(req, 'select public.eh_admin() as r');
        return enviar(res, 200, r.rows[0].r);
      }
      const permitidos = ARGS_RPC[nome];
      if (!permitidos) return enviar(res, 404, { message: 'função desconhecida' });
      const chaves = Object.keys(corpo).filter((k) => permitidos.includes(k));
      const args = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
      const escalar = ESCALARES.includes(nome);
      const sql = escalar ? `select public.${nome}(${args}) as r` : `select * from public.${nome}(${args})`;
      const r = await comoUsuario(req, sql, chaves.map((k) => corpo[k]));
      setImmediate(publicarFila);
      return enviar(res, 200, escalar ? r.rows[0].r : r.rows);
    }

    // ---------- tabelas (só as consultas usadas pelo painel) ----------
    // Paginação como o PostgREST: ?limit=&offset= (o supabase-js .range() manda os dois) e, com
    // "Prefer: count=exact", o total no cabeçalho Content-Range ("0-49/200" ou "*/0").
    const pagina = (padrao) => {
      const limite = Math.min(Number(url.searchParams.get('limit')) || padrao, 1000);
      const deslocamento = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
      return { limite, deslocamento, sql: ` limit ${limite} offset ${deslocamento}` };
    };
    const comContagem = async (sqlBase, params, pg, linhas) => {
      if (!/count=exact/.test(req.headers.prefer || '')) return undefined;
      const t = Number((await comoUsuario(req, `select count(*)::int as n from (${sqlBase}) t`, params)).rows[0].n);
      return { 'Content-Range': (linhas.length ? `${pg.deslocamento}-${pg.deslocamento + linhas.length - 1}` : '*') + '/' + t };
    };
    if (url.pathname === '/rest/v1/conversas' && req.method === 'GET') {
      // Aba Pedidos (melhoria 51): ?select=whatsapp,mensagens!inner(autor)&mensagens.autor=eq.admin&whatsapp=in.(...)
      const emWhats = /^in\.\((.*)\)$/.exec(url.searchParams.get('whatsapp') || '');
      if (emWhats) {
        const numeros = emWhats[1].split(',').map((n) => n.replace(/"/g, '').trim()).filter(Boolean);
        const autor = (url.searchParams.get('mensagens.autor') || '').replace(/^eq\./, '');
        registro.push({ consulta: 'conversas-whatsapp', numeros, autor });
        const r = await comoUsuario(req, `select c.whatsapp, json_agg(json_build_object('autor', m.autor)) as mensagens
            from public.conversas c join public.mensagens m on m.conversa_id = c.id
           where c.whatsapp = any($1) and ($2 = '' or m.autor = $2)
           group by c.id, c.whatsapp limit 1000`, [numeros, autor]);
        return enviar(res, 200, r.rows);
      }
      // mensagens!inner: só conversas com pelo menos uma mensagem (como o PostgREST faz com !inner)
      const inner = /mensagens!inner/.test(url.searchParams.get('select') || '');
      const base = `
        select c.id, c.nome, c.whatsapp, c.pagina_origem, c.status, c.nao_lidas_admin, c.criado_em, c.atualizado_em,
               coalesce((select json_agg(x) from (select m.texto, m.autor, m.criado_em from public.mensagens m
                          where m.conversa_id = c.id order by m.criado_em desc limit 1) x), '[]') as mensagens
          from public.conversas c
          ${inner ? 'where exists (select 1 from public.mensagens m where m.conversa_id = c.id)' : ''}`;
      const pg = pagina(300);
      const r = await comoUsuario(req, base + ' order by c.atualizado_em desc, c.id' + pg.sql);
      return enviar(res, 200, r.rows, await comContagem(base, [], pg, r.rows));
    }
    if (url.pathname === '/rest/v1/conversas' && req.method === 'PATCH') {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      const corpo = await lerCorpo(req);
      registro.push({ patch: 'conversas', id, corpo });
      const cols = Object.keys(corpo);
      const r = await comoUsuario(req, `update public.conversas set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning id`,
        [id, ...cols.map((k) => corpo[k])]);
      setImmediate(() => { publicarFila(); emitirAdmin('conversas', 'UPDATE', { id }); });
      return enviar(res, r.rowCount ? 200 : 200, []);
    }
    if (url.pathname === '/rest/v1/briefings' && req.method === 'GET') {
      const base = `select b.*, json_build_object('codigo', p.codigo, 'nome', p.nome, 'email', p.email,
          'whatsapp', p.whatsapp, 'plano_nome', p.plano_nome) as pedidos
        from public.briefings b join public.pedidos p on p.id = b.pedido_id`;
      const pg = pagina(500);
      const r = await comoUsuario(req, base + ' order by b.atualizado_em desc, b.id' + pg.sql);
      return enviar(res, 200, r.rows, await comContagem(base, [], pg, r.rows));
    }
    if (url.pathname === '/rest/v1/briefings' && req.method === 'PATCH') {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      const corpo = await lerCorpo(req);
      registro.push({ patch: 'briefings', id, corpo });
      const r = await comoUsuario(req, 'update public.briefings set status = $2 where id = $1 returning id, status', [id, corpo.status]);
      return enviar(res, 200, r.rows);
    }
    if (url.pathname === '/rest/v1/pedidos' && req.method === 'GET') {
      // Como o PostgREST: usa as colunas pedidas em ?select= (só identificadores simples; coluna inexistente → erro 42703)
      const pedidas = (url.searchParams.get('select') || '').split(',').map((c) => c.trim()).filter(Boolean);
      const lista = pedidas.length && pedidas.every((c) => /^[a-z_]+$/.test(c)) ? pedidas.join(', ')
        : `id, codigo, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, status,
        mp_preference_id, mp_payment_id, mp_status, mp_status_detalhe, aceite_termos_em, pago_em, criado_em, atualizado_em`;
      const umId = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      const base = `select ${lista} from public.pedidos` + (umId ? ' where id = $1' : '');
      const params = umId ? [umId] : [];
      const pg = pagina(500);
      let r;
      try {
        r = await comoUsuario(req, base + ' order by criado_em desc, id' + pg.sql, params);
      } catch (e) { return erroPg(res, e); }
      return enviar(res, 200, r.rows, await comContagem(base, params, pg, r.rows));
    }
    if (url.pathname === '/rest/v1/pedidos_eventos' && req.method === 'GET') {
      const id = (url.searchParams.get('pedido_id') || '').replace(/^eq\./, '');
      const r = await comoUsuario(req, `select mp_payment_id, mp_status, mp_status_detalhe, valor_centavos, moeda, resultado, recebido_em
        from public.pedidos_eventos where pedido_id = $1 order by recebido_em`, [id]);
      return enviar(res, 200, r.rows);
    }
    if (url.pathname === '/rest/v1/mensagens' && req.method === 'GET') {
      const id = (url.searchParams.get('conversa_id') || '').replace(/^eq\./, '');
      const r = await comoUsuario(req, `select id, conversa_id, autor, texto, criado_em from public.mensagens
                                         where conversa_id = $1 order by criado_em desc limit 500`, [id]);
      return enviar(res, 200, r.rows);
    }
    if (url.pathname === '/rest/v1/mensagens' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      registro.push({ insert: 'mensagens', corpo });
      const r = await comoUsuario(req, `insert into public.mensagens (conversa_id, autor, texto) values ($1, $2, $3)
                                         returning id, conversa_id, autor, texto, criado_em`, [corpo.conversa_id, corpo.autor, corpo.texto]);
      setImmediate(publicarFila);
      const unico = /vnd\.pgrst\.object/.test(req.headers.accept || '');
      return enviar(res, 201, unico ? r.rows[0] : r.rows);
    }
    enviar(res, 404, { message: 'não implementado no servidor de teste: ' + req.method + ' ' + url.pathname });
  } catch (e) {
    erroPg(res, e);
  }
});

// ---------- Storage falso ----------
const tokensUpload = new Map();   // token -> caminho
const tokensDownload = new Map(); // token -> caminho
const conteudos = new Map();      // caminho -> { tipo, bytes }
async function storage(acao, bucket, caminho, url, req, res) {
  const c = claimsDe(req);
  if (acao === 'upload/sign' && req.method === 'POST') {
    if (c.role !== 'service_role') return enviar(res, 403, { message: 'service role obrigatória' });
    const token = require('crypto').randomUUID();
    tokensUpload.set(token, bucket + '/' + caminho);
    return enviar(res, 200, { url: `/object/upload/sign/${bucket}/${caminho}?token=${token}` });
  }
  if (acao === 'upload/sign' && req.method === 'PUT') {
    const token = url.searchParams.get('token');
    if (tokensUpload.get(token) !== bucket + '/' + caminho) return enviar(res, 400, { message: 'token inválido' });
    tokensUpload.delete(token);
    const bytes = await new Promise((ok) => { const b = []; req.on('data', (x) => b.push(x)); req.on('end', () => ok(Buffer.concat(b))); });
    const tipo = (req.headers['content-type'] || '').split(';')[0];
    const cfg = (await pool.query('select file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket])).rows[0];
    if (!cfg.allowed_mime_types.includes(tipo)) return enviar(res, 415, { message: 'mime type not supported' });
    if (bytes.length > Number(cfg.file_size_limit)) return enviar(res, 413, { message: 'Payload too large' });
    try {
      await pool.query('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)', [bucket, caminho, { mimetype: tipo, size: bytes.length }]);
    } catch (e) { return enviar(res, 409, { message: 'The resource already exists' }); }
    conteudos.set(bucket + '/' + caminho, { tipo, bytes });
    registro.push({ upload: caminho, tipo, tamanho: bytes.length });
    return enviar(res, 200, { Key: bucket + '/' + caminho });
  }
  if (acao === 'sign' && req.method === 'POST') {
    // createSignedUrl: só se o usuário puder LER o objeto (RLS de storage.objects)
    const r = await comoUsuario(req, 'select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, caminho]);
    if (!r.rowCount) return enviar(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const token = require('crypto').randomUUID();
    tokensDownload.set(token, bucket + '/' + caminho);
    return enviar(res, 200, { signedURL: `/object/sign/${bucket}/${caminho}?token=${token}` });
  }
  if (acao === 'sign' && req.method === 'GET') {
    const token = url.searchParams.get('token');
    if (tokensDownload.get(token) !== bucket + '/' + caminho) return enviar(res, 400, { message: 'token inválido' });
    const arq = conteudos.get(bucket + '/' + caminho);
    if (!arq) return enviar(res, 404, { message: 'sem conteúdo' });
    res.writeHead(200, { 'Content-Type': arq.tipo, 'Access-Control-Allow-Origin': '*' });
    return res.end(arq.bytes);
  }
  enviar(res, 405, { message: 'não implementado' });
}

// ---------- Realtime (Phoenix vsn 2.0.0: [join_ref, ref, topic, event, payload]) ----------
const wss = new WebSocketServer({ server: servidor, path: '/realtime/v1/websocket' });
const sockets = new Set();
wss.on('connection', (ws, req) => {
  if (realtimeBloqueado) return ws.terminate();
  const params = new URL(req.url, 'http://x').searchParams;
  ws.canais = new Map(); // topic -> { joinRef, pcIds, claims }
  ws.tokenInicial = params.get('apikey');
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
  ws.on('message', (bruto) => {
    let joinRef, ref, topic, event, payload;
    try { [joinRef, ref, topic, event, payload] = JSON.parse(String(bruto)); } catch { return; }
    const responder = (p) => ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: p || {} }]));
    if (topic === 'phoenix' && event === 'heartbeat') return responder();
    if (event === 'phx_join') {
      const pcs = (payload.config && payload.config.postgres_changes) || [];
      const comIds = pcs.map((pc, i) => Object.assign({ id: 1000 + i }, pc));
      const claims = (() => { try { return JSON.parse(Buffer.from(String(payload.access_token).split('.')[1], 'base64url').toString()); } catch { return {}; } })();
      ws.canais.set(topic, { joinRef, pcs: comIds, claims });
      registro.push({ join: topic });
      return responder({ postgres_changes: comIds });
    }
    if (event === 'access_token') {
      const c = ws.canais.get(topic);
      if (c) { try { c.claims = JSON.parse(Buffer.from(String(payload.access_token).split('.')[1], 'base64url').toString()); } catch { /* */ } }
      return;
    }
    if (event === 'phx_leave') { ws.canais.delete(topic); return responder(); }
    responder();
  });
});

// Broadcast do banco: consome realtime.enviados (gravado pelo stub de realtime.send).
// Serializa as publicações (evita emitir a mesma linha duas vezes em chamadas concorrentes).
let filaPublicacao = Promise.resolve();
function publicarFila() {
  filaPublicacao = filaPublicacao.then(publicarFilaAgora, publicarFilaAgora);
  return filaPublicacao;
}
async function publicarFilaAgora() {
  const r = await pool.query('delete from realtime.enviados returning topic, event, payload');
  for (const linha of r.rows) {
    for (const ws of sockets) {
      const c = ws.canais.get('realtime:' + linha.topic);
      if (c) ws.send(JSON.stringify([null, null, 'realtime:' + linha.topic, 'broadcast', { type: 'broadcast', event: linha.event, payload: linha.payload }]));
    }
  }
  await emitirMensagensNovas();
  await emitirPedidosAlterados();
  await emitirBriefingsAlterados();
}

let ultimoBriefing = '';
async function emitirBriefingsAlterados() {
  const r = await pool.query("select coalesce(max(greatest(atualizado_em, status_atualizado_em))::text, '') || count(*) as marca from public.briefings");
  if (r.rows[0].marca !== ultimoBriefing) {
    if (ultimoBriefing) emitirAdmin('briefings', 'UPDATE', { marca: r.rows[0].marca });
    ultimoBriefing = r.rows[0].marca;
  }
}

// Guarda a marca como texto do Postgres (microssegundos): o toISOString() corta em milissegundos e fazia o mesmo
// pedido "mudar" a cada volta, recarregando o painel sem parar (e o networkidle dos testes nunca chegava).
let ultimoPedido = new Date(0).toISOString();
async function emitirPedidosAlterados() {
  const r = await pool.query('select id, status, atualizado_em::text as marca from public.pedidos where atualizado_em > $1::timestamptz order by atualizado_em', [ultimoPedido]);
  for (const p of r.rows) {
    ultimoPedido = p.marca;
    emitirAdmin('pedidos', 'UPDATE', { id: p.id, status: p.status });
  }
}

// postgres_changes para o painel: só para canais com token de admin (imita o RLS).
let ultimaMensagem = new Date(0).toISOString();
async function emitirMensagensNovas() {
  const r = await pool.query('select id, conversa_id, autor, texto, criado_em from public.mensagens where criado_em > $1 order by criado_em', [ultimaMensagem]);
  for (const m of r.rows) {
    ultimaMensagem = m.criado_em.toISOString();
    emitirAdmin('mensagens', 'INSERT', Object.assign({}, m, { criado_em: m.criado_em.toISOString() }));
    emitirAdmin('conversas', 'UPDATE', { id: m.conversa_id });
  }
}
async function emitirAdmin(tabela, tipo, registroLinha) {
  for (const ws of sockets) {
    for (const [topic, c] of ws.canais) {
      if (!c.claims || c.claims.sub !== ADMIN.id) continue;
      const alvo = c.pcs.filter((pc) => pc.table === tabela && (pc.event === '*' || pc.event === tipo));
      if (!alvo.length) continue;
      const colunas = Object.keys(registroLinha).map((n) => ({ name: n, type: n === 'id' || n === 'conversa_id' ? 'uuid' : n === 'criado_em' ? 'timestamptz' : 'text' }));
      ws.send(JSON.stringify([null, null, topic, 'postgres_changes', {
        ids: alvo.map((pc) => pc.id),
        data: { schema: 'public', table: tabela, commit_timestamp: new Date().toISOString(), type: tipo, eventType: tipo, record: registroLinha, old_record: null, columns: colunas, errors: null }
      }]));
    }
  }
}

// Mensagens inseridas fora do servidor (ex.: pelo teste via psql) também são publicadas.
setInterval(() => publicarFila().catch(() => {}), 500);

servidor.listen(PORTA, () => console.log('supabase falso em http://localhost:' + PORTA + '\nANON_KEY=' + ANON_KEY));
module.exports = { ANON_KEY };
