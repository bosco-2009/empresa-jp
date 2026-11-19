// Testes unitários das Edge Functions (Node 22+: importa os .ts diretamente, removendo os tipos).
// Uso: node --test testes/funcoes/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { lerAmbiente, origemPermitida } from '../../supabase/functions/_shared/comum.ts';
import { criarHandlerCriarPagamento, validarEntrada, limparOrigem } from '../../supabase/functions/_shared/criar-pagamento.ts';
import { criarHandlerWebhook, montarManifesto, lerAssinatura } from '../../supabase/functions/_shared/webhook-mercadopago.ts';

const SEGREDO = 'segredo-do-webhook';
const PEDIDO_ID = '5f0c8f6e-2a3b-4c5d-8e9f-0a1b2c3d4e5f';

function ambiente(extra = {}) {
  const vars = {
    SUPABASE_URL: 'https://projeto.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'eyJ.chave.servico',
    MP_ACCESS_TOKEN: 'TEST-123',
    MP_WEBHOOK_SECRET: SEGREDO,
    SITE_URL: 'https://bosco-2009.github.io/empresa-jp',
    ...extra,
  };
  return lerAmbiente((n) => vars[n]);
}

// fetch falso: registra as chamadas e responde conforme o roteiro
function fetchFalso(roteiro) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    const corpo = init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url: String(url), metodo: init.method || 'GET', cabecalhos: init.headers || {}, corpo });
    for (const [padrao, resposta] of roteiro) {
      if (String(url).includes(padrao)) {
        const r = typeof resposta === 'function' ? resposta(corpo, String(url)) : resposta;
        return new Response(JSON.stringify(r.corpo ?? null), { status: r.status ?? 200 });
      }
    }
    throw new Error('URL inesperada: ' + url);
  };
  return { f, chamadas };
}

const PEDIDO = { pedido_id: PEDIDO_ID, codigo: 'PBR-ABC234', plano_nome: 'Profissional', valor_centavos: 99700 };
const roteiroOk = () => [
  ['/rpc/pedido_criar', { corpo: [PEDIDO] }],
  ['/checkout/preferences', { corpo: { id: 'pref-1', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1', sandbox_init_point: 'https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1' } }],
  ['/rpc/pedido_definir_preferencia', { corpo: null }],
];

function requisicaoCriar(corpo, origem = 'https://bosco-2009.github.io') {
  return new Request('https://projeto.supabase.co/functions/v1/criar-pagamento', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origem },
    body: JSON.stringify(corpo),
  });
}
const ENTRADA = { plano_id: 'profissional', nome: 'Ana Souza', email: 'ana@exemplo.com', whatsapp: '(21) 97777-6666', aceite_termos: true };

// =========================================================================== criar-pagamento
test('CORS: permite o domínio do site e localhost; recusa outros', async () => {
  const amb = ambiente();
  assert.equal(origemPermitida('https://bosco-2009.github.io', amb), true);
  assert.equal(origemPermitida('http://localhost:8080', amb), true);
  assert.equal(origemPermitida('http://127.0.0.1:5500', amb), true);
  assert.equal(origemPermitida('https://evil.example', amb), false);
  assert.equal(origemPermitida('https://bosco-2009.github.io.evil.example', amb), false);
  assert.equal(origemPermitida('http://localhost.evil.example', amb), false);
  assert.equal(origemPermitida(null, amb), false);

  const { f, chamadas } = fetchFalso(roteiroOk());
  const h = criarHandlerCriarPagamento(amb, f);
  const pre = await h(new Request('https://x/functions/v1/criar-pagamento', { method: 'OPTIONS', headers: { Origin: 'https://bosco-2009.github.io' } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://bosco-2009.github.io');
  assert.match(pre.headers.get('access-control-allow-headers'), /apikey/);

  const ruim = await h(requisicaoCriar(ENTRADA, 'https://evil.example'));
  assert.equal(ruim.status, 403);
  assert.equal(ruim.headers.get('access-control-allow-origin'), null);
  assert.equal(chamadas.length, 0, 'origem recusada não toca no banco nem no MP');
});

test('ORIGENS_PERMITIDAS aceita domínio próprio', () => {
  const amb = ambiente({ ORIGENS_PERMITIDAS: 'https://portfoliobr.com.br, https://www.portfoliobr.com.br' });
  assert.equal(origemPermitida('https://www.portfoliobr.com.br', amb), true);
  assert.equal(origemPermitida('https://bosco-2009.github.io', amb), false);
});

test('validação de entrada', () => {
  assert.equal(validarEntrada(ENTRADA), null);
  assert.equal(validarEntrada({ ...ENTRADA, plano_id: '../x' }), 'plano_invalido');
  assert.equal(validarEntrada({ ...ENTRADA, nome: 'A' }), 'nome_invalido');
  assert.equal(validarEntrada({ ...ENTRADA, email: 'sem-arroba' }), 'email_invalido');
  assert.equal(validarEntrada({ ...ENTRADA, whatsapp: '123' }), 'whatsapp_invalido');
  assert.equal(validarEntrada({ ...ENTRADA, aceite_termos: 'sim' }), 'aceite_obrigatorio');
  assert.equal(validarEntrada({ ...ENTRADA, aceite_termos: false }), 'aceite_obrigatorio');
});

test('cria pedido com preço do servidor e preferência correta; ignora valor do front', async () => {
  const { f, chamadas } = fetchFalso(roteiroOk());
  const h = criarHandlerCriarPagamento(ambiente(), f);
  const r = await h(requisicaoCriar({ ...ENTRADA, valor_centavos: 1, unit_price: 0.01, preco: 1 }));
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.codigo, 'PBR-ABC234');
  assert.equal(d.valor_centavos, 99700);
  assert.match(d.token, /^[0-9a-f]{64}$/);
  assert.equal(d.init_point, 'https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1', 'token TEST- usa sandbox');

  const criar = chamadas.find((c) => c.url.endsWith('/rest/v1/rpc/pedido_criar'));
  assert.deepEqual(Object.keys(criar.corpo).sort(), ['p_email', 'p_nome', 'p_plano_id', 'p_token_hash', 'p_whatsapp']);
  assert.equal(criar.corpo.p_whatsapp, '21977776666');
  assert.equal(criar.corpo.p_token_hash, createHash('sha256').update(d.token).digest('hex'), 'banco recebe só o hash do token');
  assert.equal(criar.cabecalhos.apikey, 'eyJ.chave.servico');
  assert.equal(criar.cabecalhos.Authorization, 'Bearer eyJ.chave.servico');

  const mp = chamadas.find((c) => c.url === 'https://api.mercadopago.com/checkout/preferences');
  assert.equal(mp.cabecalhos.Authorization, 'Bearer TEST-123');
  assert.equal(mp.cabecalhos['X-Idempotency-Key'], PEDIDO_ID);
  const p = mp.corpo;
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].unit_price, 997, 'preço da tabela planos, não do front');
  assert.equal(p.items[0].currency_id, 'BRL');
  assert.equal(p.items[0].quantity, 1);
  assert.equal(p.external_reference, PEDIDO_ID);
  assert.equal(p.back_urls.success, 'https://bosco-2009.github.io/empresa-jp/obrigado.html');
  assert.equal(p.back_urls.failure, 'https://bosco-2009.github.io/empresa-jp/obrigado.html');
  assert.equal(p.auto_return, 'approved');
  assert.equal(p.notification_url, 'https://projeto.supabase.co/functions/v1/webhook-mercadopago');
  assert.deepEqual(p.payer.phone, { area_code: '21', number: '977776666' });

  const pref = chamadas.find((c) => c.url.endsWith('/rpc/pedido_definir_preferencia'));
  assert.deepEqual(pref.corpo, { p_pedido_id: PEDIDO_ID, p_preference_id: 'pref-1' });
});

test('origem do visitante (melhoria 10): gravada depois do pedido; falha não impede o pagamento', async () => {
  assert.equal(limparOrigem('  utm: instagram\n/ <b>social</b> '), 'utm: instagram / b social /b');
  assert.equal(limparOrigem('x'.repeat(400)).length, 300);
  assert.equal(limparOrigem(''), null);
  assert.equal(limparOrigem(42), null);

  const { f, chamadas } = fetchFalso([['/rpc/pedido_definir_origem', { corpo: null }], ...roteiroOk()]);
  const r = await criarHandlerCriarPagamento(ambiente(), f)(requisicaoCriar({ ...ENTRADA, origem: 'utm: instagram / social · ref: l.instagram.com' }));
  assert.equal(r.status, 200);
  const origem = chamadas.find((c) => c.url.includes('/rpc/pedido_definir_origem'));
  assert.deepEqual(origem.corpo, { p_pedido_id: PEDIDO_ID, p_origem: 'utm: instagram / social · ref: l.instagram.com' });
  assert.ok(chamadas.findIndex((c) => c.url.includes('pedido_criar')) < chamadas.indexOf(origem), 'depois de criar o pedido');

  // sem origem: nem chama; com a função ausente (migration não aplicada): segue o pagamento
  const sem = fetchFalso(roteiroOk());
  assert.equal((await criarHandlerCriarPagamento(ambiente(), sem.f)(requisicaoCriar(ENTRADA))).status, 200);
  assert.ok(!sem.chamadas.some((c) => c.url.includes('pedido_definir_origem')));
  const falha = fetchFalso([['/rpc/pedido_definir_origem', { status: 404, corpo: { code: 'PGRST202', message: 'function not found' } }], ...roteiroOk()]);
  const erroOriginal = console.error; console.error = () => {};
  try {
    const r2 = await criarHandlerCriarPagamento(ambiente(), falha.f)(requisicaoCriar({ ...ENTRADA, origem: 'utm: google' }));
    assert.equal(r2.status, 200, 'pagamento segue mesmo sem gravar a origem');
  } finally { console.error = erroOriginal; }
});

test('token de produção usa init_point; MP_SANDBOX força; chave sb_secret vai só no apikey', async () => {
  for (const [vars, esperado] of [
    [{ MP_ACCESS_TOKEN: 'APP_USR-999' }, 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1'],
    [{ MP_ACCESS_TOKEN: 'APP_USR-999', MP_SANDBOX: 'true' }, 'https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1'],
  ]) {
    const { f } = fetchFalso(roteiroOk());
    const r = await criarHandlerCriarPagamento(ambiente(vars), f)(requisicaoCriar(ENTRADA));
    assert.equal((await r.json()).init_point, esperado);
  }
  const { f, chamadas } = fetchFalso(roteiroOk());
  await criarHandlerCriarPagamento(ambiente({ SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: 'sb_secret_abc' }), f)(requisicaoCriar(ENTRADA));
  const c = chamadas.find((x) => x.url.includes('pedido_criar'));
  assert.equal(c.cabecalhos.apikey, 'sb_secret_abc');
  assert.equal(c.cabecalhos.Authorization, undefined);
});

test('erros: entrada inválida 400, limite 429, MP fora do ar 502, sem configuração 500', async () => {
  let { f, chamadas } = fetchFalso(roteiroOk());
  let r = await criarHandlerCriarPagamento(ambiente(), f)(requisicaoCriar({ ...ENTRADA, aceite_termos: false }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).erro, 'aceite_obrigatorio');
  assert.equal(chamadas.length, 0);

  ({ f } = fetchFalso([['/rpc/pedido_criar', { status: 400, corpo: { code: 'P0001', message: 'limite_pedidos' } }]]));
  r = await criarHandlerCriarPagamento(ambiente(), f)(requisicaoCriar(ENTRADA));
  assert.equal(r.status, 429);

  ({ f } = fetchFalso([['/rpc/pedido_criar', { status: 400, corpo: { code: '22023', message: 'plano_invalido' } }]]));
  r = await criarHandlerCriarPagamento(ambiente(), f)(requisicaoCriar(ENTRADA));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).erro, 'plano_invalido');

  ({ f } = fetchFalso([['/rpc/pedido_criar', { corpo: [PEDIDO] }], ['/checkout/preferences', { status: 500, corpo: { message: 'erro' } }]]));
  r = await criarHandlerCriarPagamento(ambiente(), f)(requisicaoCriar(ENTRADA));
  assert.equal(r.status, 502);

  r = await criarHandlerCriarPagamento(ambiente({ MP_ACCESS_TOKEN: '' }), f)(requisicaoCriar(ENTRADA));
  assert.equal(r.status, 500);

  r = await criarHandlerCriarPagamento(ambiente(), f)(new Request('https://x', { method: 'POST', headers: { Origin: 'http://localhost:8080' }, body: 'não é json' }));
  assert.equal(r.status, 400);
});

// =========================================================================== webhook
function assinar(dataId, requestId, ts, segredo = SEGREDO) {
  // Implementação independente (node:crypto) do formato documentado pelo Mercado Pago.
  const manifesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return `ts=${ts},v1=${createHmac('sha256', segredo).update(manifesto).digest('hex')}`;
}

function requisicaoWebhook(dataId, { assinatura, requestId = 'req-1', tipo = 'payment', corpo } = {}) {
  const ts = '1742505638683';
  return new Request(`https://projeto.supabase.co/functions/v1/webhook-mercadopago?data.id=${dataId}&type=${tipo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': requestId, 'x-signature': assinatura ?? assinar(dataId, requestId, ts) },
    body: JSON.stringify(corpo ?? { action: 'payment.updated', api_version: 'v1', type: tipo, data: { id: dataId } }),
  });
}

const PAGAMENTO = { id: 123456789, status: 'approved', status_detail: 'accredited', transaction_amount: 997, currency_id: 'BRL', external_reference: PEDIDO_ID };

test('manifesto e leitura do cabeçalho x-signature', () => {
  assert.equal(montarManifesto('123', 'abc', '99'), 'id:123;request-id:abc;ts:99;');
  assert.equal(montarManifesto('ABC1', null, '99'), 'id:abc1;ts:99;', 'id alfanumérico em minúsculas; request-id ausente é omitido');
  assert.deepEqual(lerAssinatura('ts=1,v1=ABCD'), { ts: '1', v1: 'abcd' });
  assert.deepEqual(lerAssinatura(' ts=1 , v1=ff '), { ts: '1', v1: 'ff' });
  assert.equal(lerAssinatura('v1=ff'), null);
  assert.equal(lerAssinatura(null), null);
});

test('webhook com assinatura válida consulta o MP e registra o pagamento', async () => {
  const { f, chamadas } = fetchFalso([
    ['/v1/payments/123456789', { corpo: PAGAMENTO }],
    ['/rpc/pedido_registrar_pagamento', { corpo: 'aplicado' }],
  ]);
  const r = await criarHandlerWebhook(ambiente(), f)(requisicaoWebhook('123456789'));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).resultado, 'aplicado');
  const mp = chamadas.find((c) => c.url.includes('/v1/payments/'));
  assert.equal(mp.cabecalhos.Authorization, 'Bearer TEST-123');
  const reg = chamadas.find((c) => c.url.includes('pedido_registrar_pagamento'));
  assert.deepEqual(reg.corpo, {
    p_pedido_id: PEDIDO_ID, p_payment_id: '123456789', p_mp_status: 'approved',
    p_mp_status_detalhe: 'accredited', p_valor_centavos: 99700, p_moeda: 'BRL',
  });
});

test('webhook: valor com centavos é convertido sem erro de ponto flutuante', async () => {
  const { f, chamadas } = fetchFalso([
    ['/v1/payments/1', { corpo: { ...PAGAMENTO, id: 1, transaction_amount: 1797.1 } }],
    ['/rpc/pedido_registrar_pagamento', { corpo: 'valor_divergente' }],
  ]);
  await criarHandlerWebhook(ambiente(), f)(requisicaoWebhook('1'));
  assert.equal(chamadas.find((c) => c.url.includes('registrar')).corpo.p_valor_centavos, 179710);
});

test('webhook: assinatura inválida, ausente, de outro segredo ou de outro id → 401 sem consultar nada', async () => {
  for (const assinatura of ['ts=1,v1=00', '', assinar('123456789', 'req-1', '1742505638683', 'outro-segredo'), assinar('999', 'req-1', '1742505638683')]) {
    const { f, chamadas } = fetchFalso([]);
    const r = await criarHandlerWebhook(ambiente(), f)(requisicaoWebhook('123456789', { assinatura }));
    assert.equal(r.status, 401, 'assinatura: ' + assinatura);
    assert.equal(chamadas.length, 0);
  }
  // request-id adulterado também invalida
  const { f } = fetchFalso([]);
  const req = requisicaoWebhook('123456789', { assinatura: assinar('123456789', 'req-original', '1742505638683'), requestId: 'req-trocado' });
  assert.equal((await criarHandlerWebhook(ambiente(), f)(req)).status, 401);
});

test('webhook: tipos que não são pagamento são ignorados com 200', async () => {
  const { f, chamadas } = fetchFalso([]);
  const r = await criarHandlerWebhook(ambiente(), f)(requisicaoWebhook('55', { tipo: 'merchant_order' }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ignorado, 'tipo');
  assert.equal(chamadas.length, 0);
});

test('webhook: pagamento inexistente (teste do painel do MP) → 200; MP fora do ar → 502; sem pedido → 200', async () => {
  let { f } = fetchFalso([['/v1/payments/', { status: 404, corpo: {} }]]);
  let r = await criarHandlerWebhook(ambiente(), f)(requisicaoWebhook('123456'));
  assert.equal(r.status, 200);

  ({ f } = fetchFalso([['/v1/payments/', { status: 500, corpo: {} }]]));
  r = await criarHandlerWebhook(ambiente(), f)(requisicaoWebhook('123456'));
  assert.equal(r.status, 502, 'falha temporária faz o MP tentar de novo');

  const { f: f2, chamadas } = fetchFalso([['/v1/payments/', { corpo: { ...PAGAMENTO, id: 123456, external_reference: 'outra-coisa' } }]]);
  r = await criarHandlerWebhook(ambiente(), f2)(requisicaoWebhook('123456'));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ignorado, 'sem_pedido');
  assert.equal(chamadas.some((c) => c.url.includes('registrar')), false);
});

test('webhook: id da notificação diferente do pagamento consultado → 400; id não numérico → 400', async () => {
  let { f } = fetchFalso([['/v1/payments/777', { corpo: { ...PAGAMENTO, id: 888 } }]]);
  let r = await criarHandlerWebhook(ambiente(), f)(requisicaoWebhook('777'));
  assert.equal(r.status, 400);
  ({ f } = fetchFalso([]));
  r = await criarHandlerWebhook(ambiente(), f)(requisicaoWebhook('abc'));
  assert.equal(r.status, 400);
});

test('webhook: erro do banco → 500 (MP tenta de novo); GET → 405; sem segredo → 500', async () => {
  let { f } = fetchFalso([['/v1/payments/', { corpo: PAGAMENTO }], ['registrar', { status: 503, corpo: { message: 'indisponível' } }]]);
  let r = await criarHandlerWebhook(ambiente(), f)(requisicaoWebhook('123456789'));
  assert.equal(r.status, 500);
  r = await criarHandlerWebhook(ambiente(), f)(new Request('https://x/', { method: 'GET' }));
  assert.equal(r.status, 405);
  r = await criarHandlerWebhook(ambiente({ MP_WEBHOOK_SECRET: '' }), f)(requisicaoWebhook('123456789'));
  assert.equal(r.status, 500);
});
