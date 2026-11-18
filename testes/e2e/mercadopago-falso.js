// SOMENTE PARA TESTES LOCAIS. Imita as partes do Mercado Pago usadas pelo site:
//   POST /checkout/preferences   (Checkout Pro)        GET /v1/payments/:id
//   GET  /checkout?pref_id=...   (tela de pagamento falsa com botões Aprovar / Pix pendente / Recusar)
//   POST /__pagar                (cria o pagamento, envia o webhook ASSINADO e volta para back_urls)
//   POST /__atualizar            (muda o status de um pagamento e envia novo webhook — ex.: Pix pago depois)
//   GET  /__registro             (o que foi recebido/enviado, para os testes)
const http = require('http');
const crypto = require('crypto');

const PORTA = Number(process.env.PORTA_MP || 54400);
const SEGREDO = process.env.MP_WEBHOOK_SECRET || 'segredo-teste';
const TOKEN = process.env.MP_ACCESS_TOKEN || 'TEST-falso';
const BASE = `http://localhost:${PORTA}`;

const preferencias = {};
const pagamentos = {};
const registro = { preferencias: [], webhooks: [] };
let proximoPagamento = 9000001;

const enviar = (res, status, corpo, tipo = 'application/json') => {
  res.writeHead(status, { 'Content-Type': tipo });
  res.end(tipo === 'application/json' ? JSON.stringify(corpo) : corpo);
};
const lerCorpo = (req) => new Promise((ok) => { let d = ''; req.on('data', (x) => (d += x)); req.on('end', () => ok(d)); });
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function enviarWebhook(pagamento, { assinaturaInvalida = false } = {}) {
  const pref = preferencias[pagamento.preference_id];
  const requestId = crypto.randomUUID();
  const ts = String(Date.now());
  const manifesto = `id:${pagamento.id};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', assinaturaInvalida ? 'segredo-errado' : SEGREDO).update(manifesto).digest('hex');
  const url = `${pref.notification_url}?data.id=${pagamento.id}&type=payment`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    body: JSON.stringify({ action: 'payment.updated', api_version: 'v1', type: 'payment', data: { id: String(pagamento.id) }, live_mode: false }),
  });
  const corpo = await r.text();
  registro.webhooks.push({ pagamento: pagamento.id, status: pagamento.status, resposta: r.status, corpo, assinaturaInvalida });
  return r.status;
}

const STATUS = {
  aprovado: { status: 'approved', status_detail: 'accredited', payment_type_id: 'credit_card' },
  pendente: { status: 'pending', status_detail: 'pending_waiting_transfer', payment_type_id: 'bank_transfer' },
  recusado: { status: 'rejected', status_detail: 'cc_rejected_insufficient_amount', payment_type_id: 'credit_card' },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  try {
    if (url.pathname === '/checkout/preferences' && req.method === 'POST') {
      if (req.headers.authorization !== 'Bearer ' + TOKEN) return enviar(res, 401, { message: 'invalid access token' });
      const corpo = JSON.parse(await lerCorpo(req));
      const id = 'pref-' + crypto.randomUUID().slice(0, 8);
      preferencias[id] = Object.assign({ id }, corpo);
      registro.preferencias.push({ id, corpo, idempotencia: req.headers['x-idempotency-key'] });
      return enviar(res, 201, { id, init_point: `${BASE}/checkout?pref_id=${id}`, sandbox_init_point: `${BASE}/checkout?pref_id=${id}&sandbox=1` });
    }

    if (url.pathname.startsWith('/v1/payments/') && req.method === 'GET') {
      if (req.headers.authorization !== 'Bearer ' + TOKEN) return enviar(res, 401, { message: 'invalid access token' });
      const p = pagamentos[url.pathname.split('/').pop()];
      return p ? enviar(res, 200, p) : enviar(res, 404, { message: 'Payment not found' });
    }

    if (url.pathname === '/checkout' && req.method === 'GET') {
      const pref = preferencias[url.searchParams.get('pref_id')];
      if (!pref) return enviar(res, 404, 'preferência inexistente', 'text/html; charset=utf-8');
      const item = pref.items[0];
      const botoes = Object.keys(STATUS).map((r) => `<button name="resultado" value="${r}">${r === 'aprovado' ? 'Pagar com cartão (aprovar)' : r === 'pendente' ? 'Gerar Pix (pendente)' : 'Cartão recusado'}</button>`).join(' ');
      return enviar(res, 200, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Mercado Pago (falso)</title></head>
        <body><main><h1>Mercado Pago — ambiente de teste</h1>
        <p data-item>${esc(item.title)}</p><p data-valor>R$ ${esc(item.unit_price)}</p>
        <form method="post" action="/__pagar"><input type="hidden" name="pref_id" value="${esc(pref.id)}">${botoes}</form></main></body></html>`, 'text/html; charset=utf-8');
    }

    if (url.pathname === '/__pagar' && req.method === 'POST') {
      const dados = new URLSearchParams(await lerCorpo(req));
      const pref = preferencias[dados.get('pref_id')];
      const resultado = dados.get('resultado');
      const valor = dados.get('valor') ? Number(dados.get('valor')) : pref.items[0].unit_price;
      const id = String(proximoPagamento++);
      const p = Object.assign({
        id: Number(id), preference_id: pref.id, external_reference: pref.external_reference,
        transaction_amount: valor, currency_id: 'BRL', date_created: new Date().toISOString(),
      }, STATUS[resultado]);
      pagamentos[id] = p;
      await enviarWebhook(p, { assinaturaInvalida: dados.get('assinatura') === 'invalida' });
      const volta = new URL(resultado === 'aprovado' ? pref.back_urls.success : resultado === 'pendente' ? pref.back_urls.pending : pref.back_urls.failure);
      const q = { collection_id: id, collection_status: p.status, payment_id: id, status: p.status, external_reference: pref.external_reference,
        payment_type: p.payment_type_id, merchant_order_id: '1' + id, preference_id: pref.id, site_id: 'MLB', processing_mode: 'aggregator', merchant_account_id: 'null' };
      Object.keys(q).forEach((k) => volta.searchParams.set(k, q[k]));
      res.writeHead(302, { Location: volta.toString() });
      return res.end();
    }

    if (url.pathname === '/__atualizar' && req.method === 'POST') {
      const corpo = JSON.parse(await lerCorpo(req));
      const p = pagamentos[corpo.payment_id];
      if (!p) return enviar(res, 404, {});
      Object.assign(p, corpo.mudancas || {});
      const status = await enviarWebhook(p, { assinaturaInvalida: !!corpo.assinaturaInvalida });
      return enviar(res, 200, { webhook: status });
    }

    if (url.pathname === '/__registro') return enviar(res, 200, { registro, pagamentos });
    enviar(res, 404, { message: 'não implementado no MP falso' });
  } catch (e) {
    enviar(res, 500, { message: e.message });
  }
}).listen(PORTA, () => console.log('Mercado Pago falso em ' + BASE));
