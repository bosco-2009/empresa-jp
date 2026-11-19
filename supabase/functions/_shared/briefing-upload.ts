// Lógica da Edge Function briefing-upload: gera uma URL ASSINADA para o cliente enviar UM arquivo
// (logo, foto ou PDF) ao bucket privado "briefings".
//
// Entrada (POST JSON): { codigo, token, nome, tipo, tamanho }
// Saída: { caminho, upload_url }  → o navegador faz PUT do arquivo em upload_url (Content-Type = tipo).
//
// Validações: código + token do pedido, pedido aprovado, briefing ainda editável (status novo), limite de
// 20 arquivos por pedido (briefing_autorizar_upload), tipo (imagens e PDF) e tamanho (até 5 MB).
// O bucket repete os limites de tipo e tamanho (allowed_mime_types / file_size_limit), então um PUT
// diferente do declarado também é recusado pelo Storage.
import type { Ambiente } from './comum.ts';
import { cabecalhosCors, json, rpc } from './comum.ts';

export const BUCKET = 'briefings';
export const TAMANHO_MAXIMO = 5 * 1024 * 1024;
export const MAX_ARQUIVOS = 20;
export const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf'];

const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
};

// Nome seguro para o caminho: sem acentos, só [a-z0-9-], com a extensão do tipo declarado.
export function nomeSeguro(nome: string, tipo: string): string {
  const base = String(nome || 'arquivo')
    .replace(/\.[^.]*$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'arquivo';
  return `${base}.${EXTENSOES[tipo]}`;
}

function aleatorio(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function criarHandlerBriefingUpload(amb: Ambiente, f: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const cors = cabecalhosCors(req.headers.get('origin'), amb);
    if (req.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    if (!cors) return json({ erro: 'origem_nao_permitida' }, 403);
    if (req.method !== 'POST') return json({ erro: 'metodo_nao_permitido' }, 405, cors);
    if (!amb.supabaseUrl || !amb.chaveServico) return json({ erro: 'configuracao' }, 500, cors);

    let c: Record<string, unknown>;
    try {
      c = await req.json();
      if (!c || typeof c !== 'object') throw new Error('corpo');
    } catch {
      return json({ erro: 'json_invalido' }, 400, cors);
    }

    const tipo = String(c.tipo || '').toLowerCase();
    const tamanho = Number(c.tamanho);
    if (!TIPOS_PERMITIDOS.includes(tipo)) return json({ erro: 'tipo_nao_permitido' }, 400, cors);
    if (!Number.isInteger(tamanho) || tamanho <= 0) return json({ erro: 'tamanho_invalido' }, 400, cors);
    if (tamanho > TAMANHO_MAXIMO) return json({ erro: 'arquivo_grande' }, 413, cors);
    if (typeof c.codigo !== 'string' || typeof c.token !== 'string') return json({ erro: 'acesso_negado' }, 403, cors);

    let pedidoId: string;
    try {
      const linhas = await rpc(amb, 'briefing_autorizar_upload', { p_codigo: c.codigo, p_token: c.token }, f) as
        { pedido_id: string; arquivos_existentes: number }[];
      const linha = linhas[0];
      if (linha.arquivos_existentes >= MAX_ARQUIVOS) return json({ erro: 'limite_arquivos' }, 429, cors);
      pedidoId = linha.pedido_id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      for (const conhecido of ['acesso_negado', 'pedido_nao_aprovado', 'briefing_bloqueado']) {
        if (msg.includes(conhecido)) return json({ erro: conhecido }, conhecido === 'briefing_bloqueado' ? 409 : 403, cors);
      }
      console.error('briefing-upload: falha ao autorizar', msg);
      return json({ erro: 'falha_autorizacao' }, 500, cors);
    }

    const caminho = `${pedidoId}/${aleatorio()}-${nomeSeguro(String(c.nome || ''), tipo)}`;
    try {
      const cab: Record<string, string> = { apikey: amb.chaveServico, 'Content-Type': 'application/json' };
      if (amb.chaveServico.startsWith('eyJ')) cab.Authorization = 'Bearer ' + amb.chaveServico;
      const r = await f(`${amb.supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${caminho}`, {
        method: 'POST', headers: cab, body: '{}',
      });
      const d = await r.json() as { url?: string };
      if (!r.ok || !d.url) throw new Error(`Storage respondeu ${r.status}`);
      return json({ caminho, upload_url: `${amb.supabaseUrl}/storage/v1${d.url}` }, 200, cors);
    } catch (e) {
      console.error('briefing-upload: falha ao assinar', e instanceof Error ? e.message : e);
      return json({ erro: 'storage_indisponivel' }, 502, cors);
    }
  };
}
