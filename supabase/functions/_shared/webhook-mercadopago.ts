// Lógica da Edge Function webhook-mercadopago.
//
// 1. Aceita só notificações de pagamento (type/topic = payment); as demais recebem 200 e são ignoradas.
// 2. Valida a assinatura x-signature (HMAC-SHA256 com MP_WEBHOOK_SECRET) sobre o manifesto
//    "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" (formato da documentação do Mercado Pago).
// 3. NÃO confia no corpo: consulta o pagamento na API do MP (GET /v1/payments/{id}).
// 4. Confere external_reference (= id do pedido), valor e moeda e atualiza o pedido pela função
//    pedido_registrar_pagamento, que é idempotente (notificação repetida não muda nada).
//
// Respostas: 200 quando processado ou ignorado de propósito; 401 assinatura inválida;
// 5xx em falha temporária (o Mercado Pago tenta de novo).
import type { Ambiente } from './comum.ts';
import { hmacSha256Hex, iguaisSeguro, json, rpc } from './comum.ts';

export function lerAssinatura(cabecalho: string | null): { ts: string; v1: string } | null {
  if (!cabecalho) return null;
  const partes: Record<string, string> = {};
  for (const p of cabecalho.split(',')) {
    const i = p.indexOf('=');
    if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  return partes.ts && partes.v1 ? { ts: partes.ts, v1: partes.v1.toLowerCase() } : null;
}

// Monta o manifesto omitindo as partes ausentes, como manda a documentação.
export function montarManifesto(dataId: string | null, requestId: string | null, ts: string): string {
  let m = '';
  if (dataId) m += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) m += `request-id:${requestId};`;
  m += `ts:${ts};`;
  return m;
}

export async function assinaturaValida(req: Request, dataId: string | null, segredo: string): Promise<boolean> {
  const a = lerAssinatura(req.headers.get('x-signature'));
  if (!a || !segredo) return false;
  const esperado = await hmacSha256Hex(segredo, montarManifesto(dataId, req.headers.get('x-request-id'), a.ts));
  return iguaisSeguro(esperado, a.v1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function criarHandlerWebhook(amb: Ambiente, f: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({ erro: 'metodo_nao_permitido' }, 405);
    if (!amb.mpWebhookSecret || !amb.mpAccessToken || !amb.supabaseUrl || !amb.chaveServico) {
      console.error('webhook-mercadopago: variáveis de ambiente ausentes');
      return json({ erro: 'configuracao' }, 500);
    }

    const url = new URL(req.url);
    let corpo: Record<string, unknown> = {};
    try { corpo = await req.json(); } catch { /* corpo vazio ou inválido: usa a query string */ }
    const dadosCorpo = (corpo.data && typeof corpo.data === 'object') ? corpo.data as Record<string, unknown> : {};

    const tipo = url.searchParams.get('type') || (corpo.type as string) || url.searchParams.get('topic') || '';
    // A assinatura usa o data.id da QUERY STRING (documentação do MP).
    const dataIdQuery = url.searchParams.get('data.id');
    const dataId = dataIdQuery || (dadosCorpo.id != null ? String(dadosCorpo.id) : null);

    if (tipo !== 'payment') return json({ ignorado: 'tipo', tipo });

    if (!(await assinaturaValida(req, dataIdQuery ?? dataId, amb.mpWebhookSecret))) {
      console.warn('webhook-mercadopago: assinatura inválida');
      return json({ erro: 'assinatura_invalida' }, 401);
    }
    if (!dataId || !/^\d{1,30}$/.test(dataId)) return json({ erro: 'id_invalido' }, 400);

    // Consulta o pagamento na API (fonte da verdade).
    let pagamento: Record<string, unknown>;
    try {
      const r = await f(`${amb.mpApiUrl}/v1/payments/${dataId}`, {
        headers: { Authorization: 'Bearer ' + amb.mpAccessToken },
      });
      if (r.status === 404) return json({ ignorado: 'pagamento_inexistente' });
      if (!r.ok) throw new Error(`MP respondeu ${r.status}`);
      pagamento = await r.json();
    } catch (e) {
      console.error('webhook-mercadopago: falha ao consultar pagamento', e instanceof Error ? e.message : e);
      return json({ erro: 'mp_indisponivel' }, 502);
    }

    const pedidoId = String(pagamento.external_reference ?? '');
    if (!UUID.test(pedidoId)) return json({ ignorado: 'sem_pedido' });
    if (String(pagamento.id) !== dataId) return json({ erro: 'pagamento_divergente' }, 400);

    const valor = Math.round(Number(pagamento.transaction_amount) * 100);
    try {
      const resultado = await rpc(amb, 'pedido_registrar_pagamento', {
        p_pedido_id: pedidoId,
        p_payment_id: dataId,
        p_mp_status: String(pagamento.status ?? ''),
        p_mp_status_detalhe: pagamento.status_detail == null ? null : String(pagamento.status_detail),
        p_valor_centavos: Number.isFinite(valor) ? valor : null,
        p_moeda: String(pagamento.currency_id ?? ''),
      }, f);
      if (resultado === 'valor_divergente') console.warn('webhook-mercadopago: valor divergente no pedido', pedidoId);
      return json({ resultado });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('status_mp_desconhecido')) return json({ ignorado: 'status_desconhecido' });
      console.error('webhook-mercadopago: falha ao registrar', msg);
      return json({ erro: 'falha_registro' }, 500);
    }
  };
}
