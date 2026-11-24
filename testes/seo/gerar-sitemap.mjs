// Gera o sitemap.xml a partir das páginas do repositório e confere o blog/feed.xml (melhoria 54).
//
// Uso (na raiz do projeto):
//   node testes/seo/gerar-sitemap.mjs              # reescreve sitemap.xml
//   node testes/seo/gerar-sitemap.mjs --conferir   # só confere (sai com erro se o sitemap ou o feed estiverem desatualizados)
//
// Regras:
// - Entra no sitemap toda página com o comentário "Rascunho: remover esta linha" (o mesmo que o PUBLICAR.md usa para
//   achar as páginas públicas). Exemplos fictícios, páginas privadas, 404 e /admin/ ficam sempre fora.
// - portfolio.html só entra quando config.portfolio.projetos tiver itens reais.
// - lastmod = data do último commit que mexeu na página (git log). Arquivo com alteração ainda não commitada → hoje.
//   Em clone raso (--depth), a página cujo último commit é a borda do clone mantém o lastmod que já estava no sitemap.
// - O feed precisa ter um <item> para cada artigo (página do blog com JSON-LD Article) e nada além deles.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PASTAS = ['', 'blog/', 'segmentos/', 'exemplos/', 'admin/'];
export const MARCA_PUBLICA = 'Rascunho: remover esta linha';

const ler = (f) => readFileSync(RAIZ + f, 'utf8');

export function lerConfig() {
  const janela = {};
  vm.runInNewContext(ler('config.js'), { window: janela });
  return janela.PBR_CONFIG;
}

// Todas as páginas HTML do site, em ordem estável
export function todasAsPaginas() {
  return PASTAS.flatMap((d) => (existsSync(RAIZ + (d || '.')) ? readdirSync(RAIZ + (d || '.')) : [])
    .filter((f) => f.endsWith('.html')).sort().map((f) => d + f));
}

// Prioridade e frequência por tipo de página (a ordem do array é a ordem no sitemap)
const REGRAS = [
  { re: /^index\.html$/, prioridade: '1.0', freq: 'monthly' },
  { re: /^planos\.html$/, prioridade: '0.9', freq: 'monthly' },
  { re: /^exemplos\.html$/, prioridade: '0.8', freq: 'monthly' },
  { re: /^portfolio\.html$/, prioridade: '0.7', freq: 'monthly' },
  { re: /^segmentos\//, prioridade: '0.7', freq: 'monthly' },
  { re: /^blog\/index\.html$/, prioridade: '0.7', freq: 'weekly' },
  { re: /^blog\/autor\.html$/, prioridade: '0.4', freq: 'monthly', depois: true },
  { re: /^blog\//, prioridade: '0.6', freq: 'yearly' },
  { re: /^(termos|privacidade)\.html$/, prioridade: '0.3', freq: 'yearly' },
  { re: /./, prioridade: '0.5', freq: 'monthly' },
];
const regraDe = (f) => REGRAS.findIndex((r) => r.re.test(f));
// Ordem fixa dentro de cada grupo, para o diff do sitemap ficar pequeno
const ORDEM_SEGMENTOS = ['restaurante', 'moda', 'beleza', 'saude', 'servicos', 'pet'];
const ORDEM_TERMOS = ['termos.html', 'privacidade.html'];

/** Páginas que devem estar no sitemap (caminhos relativos à raiz). */
export function paginasDoSitemap(config = lerConfig(), { paginas = todasAsPaginas(), lerPagina = ler } = {}) {
  const lista = paginas.filter((f) => !f.startsWith('exemplos/') && !f.startsWith('admin/') && f !== '404.html')
    .filter((f) => lerPagina(f).includes(MARCA_PUBLICA))
    .filter((f) => f !== 'portfolio.html' || (config.portfolio?.projetos || []).length > 0);
  const chave = (f) => {
    const r = regraDe(f);
    // Dentro de blog/: índice, artigos (ordem do feed), autor por último
    let sub = 0;
    if (f.startsWith('segmentos/')) sub = ORDEM_SEGMENTOS.indexOf(f.slice(10, -5));
    else if (ORDEM_TERMOS.includes(f)) sub = ORDEM_TERMOS.indexOf(f);
    else if (/^blog\//.test(f) && !/index|autor/.test(f)) sub = ordemDoFeed().indexOf(f);
    return [REGRAS[r].depois ? 7.5 : r, sub < 0 ? 99 : sub, f];
  };
  return lista.sort((a, b) => {
    const [x1, y1, z1] = chave(a); const [x2, y2, z2] = chave(b);
    return x1 - x2 || y1 - y2 || z1.localeCompare(z2);
  });
}

export const urlDe = (site, f) => site + f.replace(/(^|\/)index\.html$/, '$1');

// ---------- git ----------
function git(...args) {
  try { return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}
const hoje = () => new Date().toISOString().slice(0, 10);

/** Data (AAAA-MM-DD) da última mudança da página; null quando não dá para saber. */
export function ultimaMudanca(f, anterior = null) {
  if (git('status', '--porcelain', '--', f)) return hoje();
  const linha = git('log', '-1', '--format=%H %cs', '--', f);
  if (!linha) return anterior;
  const [hash, data] = linha.split(' ');
  // Clone raso: o commit da borda "toca" todos os arquivos, então a data dele não vale
  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    const bordas = existsSync(RAIZ + '.git/shallow') ? readFileSync(RAIZ + '.git/shallow', 'utf8').split('\n') : [];
    if (bordas.includes(hash)) return anterior;
  }
  return data;
}

// ---------- sitemap ----------
export function lastmodsAtuais(xml = existsSync(RAIZ + 'sitemap.xml') ? ler('sitemap.xml') : '') {
  const mapa = {};
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = (/<loc>([^<]+)<\/loc>/.exec(m[1]) || [])[1];
    const mod = (/<lastmod>([^<]+)<\/lastmod>/.exec(m[1]) || [])[1];
    if (loc) mapa[loc] = mod || null;
  }
  return mapa;
}

export function montarSitemap({ config = lerConfig(), lastmod = ultimaMudanca } = {}) {
  const site = config.site.url;
  const antes = lastmodsAtuais();
  const urls = paginasDoSitemap(config).map((f) => {
    const loc = urlDe(site, f);
    const { prioridade, freq } = REGRAS[regraDe(f)];
    const mod = lastmod(f, antes[loc] || null);
    return '  <url>\n'
      + `    <loc>${loc}</loc>\n`
      + (mod ? `    <lastmod>${mod}</lastmod>\n` : '')
      + `    <changefreq>${freq}</changefreq>\n`
      + `    <priority>${prioridade}</priority>\n`
      + '  </url>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!-- GERADO por testes/seo/gerar-sitemap.mjs: não edite à mão. Rode `node testes/seo/gerar-sitemap.mjs` depois de criar\n'
    + '     ou mudar uma página pública. Entram as páginas com o comentário de rascunho; portfolio.html só com projetos reais.\n'
    + '     Ficam fora: obrigado.html, briefing.html, pedido.html, 404.html, exemplos/*.html (sites fictícios) e /admin/. -->\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.join('\n') + '\n</urlset>\n';
}

// ---------- feed ----------
const blocosLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
function temArtigo(html) {
  const visitar = (v) => (Array.isArray(v) ? v.some(visitar)
    : v && typeof v === 'object' ? v['@type'] === 'Article' || Object.values(v).some(visitar) : false);
  return blocosLd(html).some((b) => { try { return visitar(JSON.parse(b)); } catch { return false; } });
}

/** Artigos do blog: páginas em blog/ com JSON-LD Article. */
export const artigosDoBlog = () => todasAsPaginas().filter((f) => f.startsWith('blog/') && temArtigo(ler(f)));

function ordemDoFeed() {
  const site = lerConfig().site.url;
  if (!existsSync(RAIZ + 'blog/feed.xml')) return [];
  const rss = ler('blog/feed.xml').replace(/<!--[\s\S]*?-->/g, '');
  return [...rss.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)].map((m) => m[1].slice(site.length));
}

/** Lista de problemas do feed (vazia = tudo certo). */
export function problemasDoFeed(config = lerConfig()) {
  const site = config.site.url;
  const erros = [];
  if (!existsSync(RAIZ + 'blog/feed.xml')) return ['blog/feed.xml não existe'];
  const rss = ler('blog/feed.xml').replace(/<!--[\s\S]*?-->/g, '');
  const links = ordemDoFeed();
  const artigos = artigosDoBlog();
  for (const a of artigos) if (!links.includes(a)) erros.push(`artigo fora do feed: ${a}`);
  for (const l of links) {
    if (!existsSync(RAIZ + l)) erros.push(`feed aponta para página que não existe: ${l}`);
    else if (!artigos.includes(l)) erros.push(`feed aponta para página que não é artigo: ${l}`);
  }
  if (new Set(links).size !== links.length) erros.push('feed com item repetido');
  const pubs = [...rss.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => new Date(m[1]).getTime());
  const build = new Date((/<lastBuildDate>([^<]+)<\/lastBuildDate>/.exec(rss) || [])[1]).getTime();
  if (Number.isNaN(build)) erros.push('feed sem lastBuildDate válida');
  else if (pubs.some((p) => p > build)) erros.push('lastBuildDate anterior ao artigo mais novo');
  // Os artigos do feed também precisam estar no sitemap
  const noSitemap = paginasDoSitemap(config);
  for (const a of artigos) if (!noSitemap.includes(a)) erros.push(`artigo sem o comentário de rascunho (ficaria fora do sitemap): ${a}`);
  if (!rss.includes(`<link>${site}blog/</link>`)) erros.push('feed sem o link do blog');
  return erros;
}

// ---------- linha de comando ----------
const urlsDe = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const conferir = process.argv.includes('--conferir');
  const novo = montarSitemap();
  const atual = existsSync(RAIZ + 'sitemap.xml') ? ler('sitemap.xml') : '';
  const erros = problemasDoFeed();
  if (conferir) {
    const a = urlsDe(atual); const n = urlsDe(novo);
    for (const u of n) if (!a.includes(u)) erros.push(`faltando no sitemap: ${u}`);
    for (const u of a) if (!n.includes(u)) erros.push(`sobrando no sitemap: ${u}`);
    if (!erros.length && atual !== novo) erros.push('sitemap.xml desatualizado (lastmod/ordem): rode node testes/seo/gerar-sitemap.mjs');
  } else if (atual !== novo) {
    writeFileSync(RAIZ + 'sitemap.xml', novo);
    console.log(`sitemap.xml atualizado (${urlsDe(novo).length} URLs).`);
  } else {
    console.log(`sitemap.xml já estava em dia (${urlsDe(novo).length} URLs).`);
  }
  for (const e of erros) console.error('✗ ' + e);
  if (!erros.length && conferir) console.log('✓ sitemap.xml e blog/feed.xml em dia.');
  process.exitCode = erros.length ? 1 : 0;
}
