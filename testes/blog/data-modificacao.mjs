// Data da última alteração de CONTEÚDO de cada artigo do blog (melhoria 101).
//
// Uso (na raiz do projeto):
//   node testes/blog/data-modificacao.mjs             # mostra as datas calculadas
//   node testes/blog/data-modificacao.mjs --gravar    # grava dateModified (artigo e blog/index.html), article:modified_time e "atualizado em"
//   node testes/blog/data-modificacao.mjs --conferir  # sai com erro se alguma página estiver desatualizada
//
// Regras:
// - Conta como alteração só o TEXTO do artigo: título (h1) + corpo (o mesmo trecho que a leitura estimada conta,
//   do 1º parágrafo até o bloco "Plano indicado"/chamada final). Mudanças no <head>, CSP, cabeçalho, rodapé,
//   versão dos arquivos (?v=), "Leia também" ou classes não mudam a data.
// - A data vem do git log: o commit mais recente em que esse texto ficou diferente do commit anterior.
//   Texto alterado e ainda não commitado → hoje. Sem histórico suficiente (clone raso) → mantém a data gravada.
// - A data nunca é anterior à publicação (datePublished). Quando é igual, a página não mostra "atualizado em".
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARTIGOS, corpoDoArtigo } from './leitura.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const ler = (f) => readFileSync(RAIZ + f, 'utf8');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro',
  'novembro', 'dezembro'];

function git(...args) {
  try { return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }); }
  catch { return null; }
}

/** Texto editorial do artigo (título + corpo), com espaços normalizados. null se a página não tiver artigo. */
export function textoEditorial(html) {
  try {
    const h1 = (/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html) || [])[1] || '';
    return (h1.replace(/<[^>]+>/g, ' ') + '\n' + corpoDoArtigo(html)).replace(/\s+/g, ' ').trim();
  } catch { return null; }
}

/** "2026-11-19" → "19 de novembro de 2026" */
export function dataPorExtenso(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return `${d === 1 ? "1º" : d} de ${MESES[m - 1]} de ${a}`;
}

export const datasGravadas = (html) => ({
  publicado: (/"datePublished": "([^"]+)"/.exec(html) || [])[1],
  modificado: (/"dateModified": "([^"]+)"/.exec(html) || [])[1],
});

const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * Data (AAAA-MM-DD) da última alteração de texto do arquivo, ou `anterior` quando o histórico não basta.
 * `historico` permite testar sem git: lista do mais novo para o mais antigo de { data, texto } (texto null = sem pai).
 */
export function ultimaAlteracaoDeTexto(f, anterior, { historico = historicoGit(f), atual = textoEditorial(ler(f)) } = {}) {
  // Primeiro item do histórico = versão commitada (HEAD); se o arquivo local difere dela, mudou hoje
  if (historico.length && historico[0].texto !== null && atual !== historico[0].texto) return hoje();
  for (let i = 0; i < historico.length; i++) {
    const { data, texto } = historico[i];
    const pai = historico[i + 1];
    if (!pai) return historico[i].criado ? data : anterior; // criação do arquivo ou borda do clone raso
    if (pai.texto !== texto) return data;
  }
  return anterior;
}

/** Versões do arquivo no git, do commit mais novo para o mais antigo. */
function historicoGit(f) {
  const log = git('log', '--format=%H %cs', '--', f);
  if (!log) return [];
  const raso = git('rev-parse', '--is-shallow-repository')?.trim() === 'true';
  const bordas = raso && existsSync(RAIZ + '.git/shallow') ? readFileSync(RAIZ + '.git/shallow', 'utf8').split('\n') : [];
  const commits = log.trim().split('\n').map((l) => l.split(' '));
  return commits.map(([hash, data], i) => {
    const conteudo = git('show', `${hash}:${f}`);
    const ultimo = i === commits.length - 1;
    // No último commit da lista: se ele não for borda de clone raso, foi onde o arquivo nasceu
    return { data, texto: conteudo === null ? null : textoEditorial(conteudo), criado: ultimo && !bordas.includes(hash) };
  });
}

/** Datas que cada artigo deveria ter agora. */
export function calcular() {
  return ARTIGOS.map((slug) => {
    const f = `blog/${slug}.html`;
    const { publicado, modificado } = datasGravadas(ler(f));
    let data = ultimaAlteracaoDeTexto(f, modificado || publicado) || publicado;
    if (data < publicado) data = publicado;
    return { slug, f, publicado, modificado, data };
  });
}

/** Aplica a data de modificação no HTML do artigo (JSON-LD, metatag e linha "atualizado em"). */
export function aplicar(html, publicado, data) {
  let h = html
    .replace(/("dateModified": ")[^"]+(")/, `$1${data}$2`)
    .replace(/(<meta property="article:modified_time" content=")[^"]+(">)/, `$1${data}$2`)
    .replace(/<span class="artigo__atualizado"[^>]*>[\s\S]*?<\/span>/, '');
  if (data !== publicado) {
    const linha = `<span class="artigo__atualizado"> · atualizado em <time datetime="${data}">${dataPorExtenso(data)}</time></span>`;
    h = h.replace(/(<p class="artigo__meta">[\s\S]*?<time datetime="[^"]+">[^<]*<\/time>)/, `$1${linha}`);
  }
  return h;
}

/** Aplica a data no BlogPosting do artigo em blog/index.html. */
export function aplicarNoIndice(html, slug, data) {
  const re = new RegExp(`("url": "[^"]*/blog/${slug}\\.html",\\s*"datePublished": "[^"]+",\\s*"dateModified": ")[^"]+(")`);
  return html.replace(re, `$1${data}$2`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const conferir = process.argv.includes('--conferir');
  const gravar = process.argv.includes('--gravar');
  let desatualizados = 0;
  for (const { slug, f, publicado, data } of calcular()) {
    const antes = ler(f);
    const depois = aplicar(antes, publicado, data);
    const indiceAntes = ler('blog/index.html');
    const indiceDepois = aplicarNoIndice(indiceAntes, slug, data);
    const mudou = antes !== depois || indiceAntes !== indiceDepois;
    if (gravar && mudou) { writeFileSync(RAIZ + f, depois); writeFileSync(RAIZ + 'blog/index.html', indiceDepois); }
    if (conferir && mudou) desatualizados++;
    console.log(`${slug}: publicado ${publicado} · alterado ${data}${mudou ? (gravar ? ' (gravado)' : ' (desatualizado)') : ''}`);
  }
  if (conferir && desatualizados) {
    console.error(`${desatualizados} artigo(s) desatualizado(s): rode node testes/blog/data-modificacao.mjs --gravar`);
    process.exit(1);
  }
}
