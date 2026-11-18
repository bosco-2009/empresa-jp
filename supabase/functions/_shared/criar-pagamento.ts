// Lógica da Edge Function criar-pagamento (Checkout Pro do Mercado Pago).
//
// Entrada (POST JSON): { plano_id, nome, email, whatsapp, aceite_termos: true }
// Saída: { pedido_id, codigo, token, plano_nome, valor_centavos, init_point }
//
// O PREÇO vem da tabela public.planos (função pedido_criar). Qualquer valor enviado pelo front é ignorado.
// O token devolvido é o segredo que o navegador guarda para consultar o status (pedido_consultar);
// no banco fica só o SHA-256 dele.
import type { Ambiente } from './comum.ts';
import { cabecalhosCors, ErroBanco, json, rpc, sha256Hex, tokenAleatorio } from './comum.ts';

interface PedidoCriado {
  pedido_id: string;
  codigo: string;
  plano_nome: string;
  valor_centavos: number;
}

const ERROS_DE_ENTRADA = ['plano_invalido', 'nome_invalido', 'email_invalido', 'whatsapp_invalido'];

export function validarEntrada(c: Record<string, unknown>): string | null {
  if (typeof c.plano_id !== 'string' || !/^[a-z0-9-]{2,40}$/.test(c.plano_id)) return 'plano_invalido';
  if (typeof c.nome !== 'string' || c.nome.trim().length < 2 || c.nome.trim().length > 80) return 'nome_invalido';
  if (typeof c.email !== 'string' || c.email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) return 'email_invalido';
  if (typeof c.whatsapp !== 'string' || !/^\d{10,13}$/.test(c.whatsapp.replace(/\D/g, ''))) return 'whatsapp_invalido';
  if (c.aceite_termos !== true) return 'aceite_obrigatorio';
  return null;
}

export function criarHandlerCriarPagamento(amb: Ambiente, f: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const cors = cabecalhosCors(req.headers.get('origin'), amb);
    if (req.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    if (!cors) return json({ erro: 'origem_nao_permitida' }, 403);
    if (req.method !== 'POST') return json({ erro: 'metodo_nao_permitido' }, 405, cors);
    if (!amb.supabaseUrl || !amb.chaveServico || !amb.mpAccessToken) {
      console.error('criar-pagamento: variáveis de ambiente ausentes');
      return json({ erro: 'configuracao' }, 500, cors);
    }

    let corpo: Record<string, unknown>;
    try {
      corpo = await req.json();
      if (!corpo || typeof corpo !== 'object') throw new Error('corpo');
    } catch {
      return json({ erro: 'json_invalido' }, 400, cors);
    }
    const erroEntrada = validarEntrada(corpo);
    if (erroEntrada) return json({ erro: erroEntrada }, 400, cors);

    // 1) Pedido pendente com o preço do servidor
    const token = tokenAleatorio();
    let pedido: PedidoCriado;
    try {
      const linhas = await rpc(amb, 'pedido_criar', {
        p_plano_id: corpo.plano_id,
        p_nome: String(corpo.nome).trim(),
        p_email: String(corpo.email).trim(),
        p_whatsapp: String(corpo.whatsapp).replace(/\D/g, ''),
        p_token_hash: await sha256Hex(token),
      }, f) as PedidoCriado[];
      pedido = linhas[0];
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const conhecido = ERROS_DE_ENTRADA.find((x) => msg.includes(x));
      if (conhecido) return json({ erro: conhecido }, 400, cors);
      if (msg.includes('limite_pedidos')) return json({ erro: 'limite_pedidos' }, 429, cors);
      console.error('criar-pagamento: pedido_criar falhou', e instanceof ErroBanco ? e.codigo : '', msg);
      return json({ erro: 'falha_pedido' }, 500, cors);
    }

    // 2) Preferência do Checkout Pro
    const whatsapp = String(corpo.whatsapp).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    const preferencia = {
      items: [{
        id: corpo.plano_id,
        title: `Site profissional — Plano ${pedido.plano_nome}`,
        description: `Portfólio BR · pedido ${pedido.codigo}`,
        category_id: 'services',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: pedido.valor_centavos / 100,
      }],
      payer: {
        name: String(corpo.nome).trim(),
        email: String(corpo.email).trim(),
        phone: { area_code: whatsapp.slice(0, 2), number: whatsapp.slice(2) },
      },
      external_reference: pedido.pedido_id,
      back_urls: {
        success: amb.siteUrl + 'obrigado.html',
        pending: amb.siteUrl + 'obrigado.html',
        failure: amb.siteUrl + 'obrigado.html',
      },
      auto_return: 'approved',
      notification_url: `${amb.supabaseUrl}/functions/v1/webhook-mercadopago`,
      statement_descriptor: 'PORTFOLIOBR',
      payment_methods: { installments: 12 },
      metadata: { pedido_codigo: pedido.codigo },
    };

    let pref: { id?: string; init_point?: string; sandbox_init_point?: string };
    try {
      const r = await f(`${amb.mpApiUrl}/checkout/preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + amb.mpAccessToken,
          'X-Idempotency-Key': pedido.pedido_id,
        },
        body: JSON.stringify(preferencia),
      });
      pref = await r.json();
      if (!r.ok || !pref.id) throw new Error(`MP respondeu ${r.status}`);
    } catch (e) {
      console.error('criar-pagamento: Mercado Pago falhou', e instanceof Error ? e.message : e);
      return json({ erro: 'mp_indisponivel' }, 502, cors);
    }

    try {
      await rpc(amb, 'pedido_definir_preferencia', { p_pedido_id: pedido.pedido_id, p_preference_id: pref.id }, f);
    } catch (e) {
      // Não impede o pagamento: o webhook encontra o pedido pelo external_reference.
      console.error('criar-pagamento: falha ao gravar preference_id', e instanceof Error ? e.message : e);
    }

    const sandbox = amb.mpSandbox ?? amb.mpAccessToken.startsWith('TEST-');
    const initPoint = sandbox ? pref.sandbox_init_point : pref.init_point;
    if (!initPoint) return json({ erro: 'mp_indisponivel' }, 502, cors);

    return json({
      pedido_id: pedido.pedido_id,
      codigo: pedido.codigo,
      token,
      plano_nome: pedido.plano_nome,
      valor_centavos: pedido.valor_centavos,
      init_point: initPoint,
    }, 200, cors);
  };
}
