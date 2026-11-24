// Data da última alteração de TEXTO de cada página de segmento (melhoria 117).
// Reaproveita a regra do blog (testes/blog/data-modificacao.mjs, melhoria 101).
//
// Uso (na raiz do projeto):
//   node testes/segmentos/data-modificacao.mjs             # mostra as datas calculadas
//   node testes/segmentos/data-modificacao.mjs --gravar    # grava dateModified (nó WebPage do JSON-LD) e "atualizado em"
//   node testes/segmentos/data-modificacao.mjs --conferir  # sai com erro se alguma página estiver desatualizada
//
// Regras:
// - Conta como alteração só o texto do <main>: tudo o que o visitante lê, sem as tags. Não contam: <head>, CSP,
//   cabeçalho, rodapé, ?v=, classes e atributos, o bloco "Plano indicado" (vem do config.js, gravado por
//   testes/conteudo/indicado.mjs) e a própria linha de datas.
// - A data vem do git log (commit mais recente que mudou esse texto). Texto mudado e não commitado → hoje.
//   Clone raso sem a criação do arquivo → mantém a data gravada. Nunca anterior à publicação (datePublished).
// - testes/segmentos/gerar.py preserva a data gravada ao regenerar; depois de gerar, rode este script com --gravar.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ultimaAlteracaoDeTexto, dataPorExtenso } from '../blog/data-modificacao.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const ler = (f) => readFileSync(RAIZ + f, 'utf8');

export const PAGINAS = readdirSync(RAIZ + 'segmentos').filter((f) => f.endsWith('.html')).sort()
  .map((f) => `segmentos/${f}`);

/** Texto que o visitante lê no <main> da página de segmento, com espaços normalizados. null sem <main>. */
export function textoDoSegmento(html) {
  const m = /<main[\s>][\s\S]*?<\/main>/.exec(html);
  if (!m) return null;
  return m[0]
    .replace(/<!-- indicado:inicio -->[\s\S]*?<!-- indicado:fim -->/, ' ')
    .replace(/<p class="artigo__meta seg__meta">[\s\S]*?<\/p>/, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Datas gravadas no nó WebPage do JSON-LD. */
export const datasGravadas = (html) => ({
  publicado: (/"datePublished": "([^"]+)"/.exec(html) || [])[1],
  modificado: (/"dateModified": "([^"]+)"/.exec(html) || [])[1],
});

/** Datas que cada página deveria ter agora. */
export function calcular() {
  return PAGINAS.map((f) => {
    const { publicado, modificado } = datasGravadas(ler(f));
    let data = ultimaAlteracaoDeTexto(f, modificado || publicado, { extrair: textoDoSegmento }) || publicado;
    if (data < publicado) data = publicado;
    return { f, publicado, modificado, data };
  });
}

/** Aplica a data de modificação no HTML (JSON-LD e linha "atualizado em"). Idempotente. */
export function aplicar(html, publicado, data) {
  let h = html
    .replace(/("dateModified": ")[^"]+(")/, `$1${data}$2`)
    .replace(/<span class="artigo__atualizado"[^>]*>[\s\S]*?<\/span>/, '');
  if (data !== publicado) {
    const linha = `<span class="artigo__atualizado"> · atualizado em <time datetime="${data}">${dataPorExtenso(data)}</time></span>`;
    h = h.replace(/(<p class="artigo__meta seg__meta">[\s\S]*?<time datetime="[^"]+">[^<]*<\/time>)/, `$1${linha}`);
  }
  return h;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const conferir = process.argv.includes('--conferir');
  const gravar = process.argv.includes('--gravar');
  let desatualizados = 0;
  for (const { f, publicado, data } of calcular()) {
    const antes = ler(f);
    const depois = aplicar(antes, publicado, data);
    const mudou = antes !== depois;
    if (gravar && mudou) writeFileSync(RAIZ + f, depois);
    if (conferir && mudou) desatualizados++;
    console.log(`${f}: publicado ${publicado} · alterado ${data}${mudou ? (gravar ? ' (gravado)' : ' (desatualizado)') : ''}`);
  }
  if (conferir && desatualizados) {
    console.error(`${desatualizados} página(s) desatualizada(s): rode node testes/segmentos/data-modificacao.mjs --gravar`);
    process.exit(1);
  }
}
