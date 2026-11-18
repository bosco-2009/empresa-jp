// Utilitários das Edge Functions. Só APIs Web padrão (fetch, crypto.subtle): roda no Deno (Supabase)
// e no Node 22+ (testes locais). Sem imports externos.

export interface Ambiente {
  supabaseUrl: string;
  chaveServico: string; // service_role (JWT legado) ou sb_secret_...
  mpAccessToken: string;
  mpWebhookSecret: string;
  mpApiUrl: string;
  mpSandbox: boolean | null; // null = decide pelo prefixo TEST- do token
  siteUrl: string; // termina com "/"
  origensPermitidas: string[];
}

// Lê as variáveis de ambiente (Deno.env.get no Supabase; process.env nos testes).
export function lerAmbiente(ler: (nome: string) => string | undefined): Ambiente {
  const siteUrl = (ler('SITE_URL') || 'https://bosco-2009.github.io/empresa-jp/').replace(/\/?$/, '/');
  const origens = (ler('ORIGENS_PERMITIDAS') || new URL(siteUrl).origin)
    .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  const sandbox = ler('MP_SANDBOX');
  return {
    supabaseUrl: (ler('SUPABASE_URL') || '').replace(/\/$/, ''),
    chaveServico: ler('SUPABASE_SECRET_KEY') || ler('SUPABASE_SERVICE_ROLE_KEY') || '',
    mpAccessToken: ler('MP_ACCESS_TOKEN') || '',
    mpWebhookSecret: ler('MP_WEBHOOK_SECRET') || '',
    mpApiUrl: (ler('MP_API_URL') || 'https://api.mercadopago.com').replace(/\/$/, ''),
    mpSandbox: sandbox === 'true' ? true : sandbox === 'false' ? false : null,
    siteUrl,
    origensPermitidas: origens,
  };
}

// ----------------------------------------------------------------------------- CORS
// Permite só as origens do site e o localhost (desenvolvimento).
export function origemPermitida(origem: string | null, amb: Ambiente): boolean {
  if (!origem) return false;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origem)) return true;
  return amb.origensPermitidas.includes(origem);
}

export function cabecalhosCors(origem: string | null, amb: Ambiente): Record<string, string> | null {
  if (!origemPermitida(origem, amb)) return null;
  return {
    'Access-Control-Allow-Origin': origem as string,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

export function json(corpo: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

// ----------------------------------------------------------------------------- cripto
export function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function tokenAleatorio(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return hex(b);
}

export async function sha256Hex(texto: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

export async function hmacSha256Hex(segredo: string, mensagem: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(mensagem)));
}

// Comparação em tempo constante (para assinaturas).
export function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

// ----------------------------------------------------------------------------- banco (PostgREST)
export class ErroBanco extends Error {
  codigo: string;
  constructor(mensagem: string, codigo: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

// Chama uma função SQL com a chave de serviço (ignora o RLS; só as funções concedidas à service_role).
export async function rpc(amb: Ambiente, nome: string, args: Record<string, unknown>, f: typeof fetch = fetch): Promise<unknown> {
  const cabecalhos: Record<string, string> = { 'Content-Type': 'application/json', apikey: amb.chaveServico };
  // Chave JWT legada também vai no Authorization; a sb_secret_ basta no apikey.
  if (amb.chaveServico.startsWith('eyJ')) cabecalhos.Authorization = 'Bearer ' + amb.chaveServico;
  const r = await f(`${amb.supabaseUrl}/rest/v1/rpc/${nome}`, { method: 'POST', headers: cabecalhos, body: JSON.stringify(args) });
  const texto = await r.text();
  const dados = texto ? JSON.parse(texto) : null;
  if (!r.ok) throw new ErroBanco((dados && dados.message) || `erro ${r.status}`, (dados && dados.code) || String(r.status));
  return dados;
}
