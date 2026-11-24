// Sitemap e feed sempre atualizados (melhoria 54).
// O sitemap.xml é gerado por testes/seo/gerar-sitemap.mjs; este teste falha quando uma página pública nova fica fora
// dele, quando uma página de exemplo/privada/noindex entra nele ou quando o feed do blog não bate com os artigos.
// Uso: node --test testes/funcoes/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  lerConfig, todasAsPaginas, paginasDoSitemap, montarSitemap, problemasDoFeed, artigosDoBlog, urlDe, MARCA_PUBLICA,
} from '../seo/gerar-sitemap.mjs';

const raiz = new URL('../../', import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');
const config = lerConfig();
const SITE = config.site.url;
const sitemap = ler('sitemap.xml');
const blocos = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
const locs = blocos.map((b) => (/<loc>([^<]+)<\/loc>/.exec(b) || [])[1]);
const semLastmod = (xml) => xml.replace(/\s*<lastmod>[^<]*<\/lastmod>/g, '');

test('sitemap: exatamente as páginas públicas (nenhuma faltando, nenhuma sobrando)', () => {
  const esperadas = paginasDoSitemap(config).map((f) => urlDe(SITE, f));
  for (const u of esperadas) assert.ok(locs.includes(u), `faltando no sitemap.xml: ${u} (rode node testes/seo/gerar-sitemap.mjs)`);
  for (const u of locs) assert.ok(esperadas.includes(u), `sobrando no sitemap.xml: ${u}`);
  assert.equal(new Set(locs).size, locs.length, 'sem URL repetida');
  assert.ok(locs.length >= 10, `sitemap com as páginas do site (${locs.length})`);
});

test('sitemap: igual ao gerado pelo script (ordem, prioridade e frequência)', () => {
  // lastmod depende do histórico do git (clone raso, alterações locais): comparado à parte
  assert.equal(semLastmod(sitemap), semLastmod(montarSitemap({ config, lastmod: () => null })),
    'sitemap.xml editado à mão ou desatualizado: rode node testes/seo/gerar-sitemap.mjs');
});

test('sitemap: nenhuma página noindex de propósito (exemplo, privada, 404, admin)', () => {
  const urlsNoSitemap = new Set(locs);
  for (const f of todasAsPaginas()) {
    const h = ler(f);
    const noindex = /<meta name="robots" content="noindex/.test(h);
    // noindex sem o comentário de rascunho = noindex permanente: nunca no sitemap
    if (noindex && !h.includes(MARCA_PUBLICA)) assert.ok(!urlsNoSitemap.has(urlDe(SITE, f)), `${f} é noindex permanente e está no sitemap`);
    if (f.startsWith('exemplos/') || f.startsWith('admin/') || f === '404.html') {
      assert.ok(!urlsNoSitemap.has(urlDe(SITE, f)), `${f} não pode estar no sitemap`);
    }
  }
});

test('sitemap: cada URL existe, tem canonical igual e lastmod válido', () => {
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  for (const b of blocos) {
    const loc = (/<loc>([^<]+)<\/loc>/.exec(b) || [])[1];
    const arquivo = loc.slice(SITE.length).replace(/(^|\/)$/, '$1index.html');
    const h = ler(arquivo);
    assert.equal((/<link rel="canonical" href="([^"]+)">/.exec(h) || [])[1], loc, `${arquivo}: canonical = loc do sitemap`);
    const mod = (/<lastmod>([^<]+)<\/lastmod>/.exec(b) || [])[1];
    if (mod) {
      assert.match(mod, /^\d{4}-\d{2}-\d{2}$/, `${loc}: lastmod AAAA-MM-DD`);
      assert.ok(!Number.isNaN(new Date(mod).getTime()), `${loc}: lastmod é uma data`);
      assert.ok(mod <= amanha, `${loc}: lastmod no futuro (${mod})`);
    }
    assert.match(b, /<changefreq>(daily|weekly|monthly|yearly)<\/changefreq>/, `${loc}: changefreq`);
    assert.match(b, /<priority>(0\.\d|1\.0)<\/priority>/, `${loc}: priority`);
  }
  assert.ok(blocos.every((b) => b.includes('<lastmod>')), 'lastmod em todas as URLs (gerado pelo git)');
});

test('feed: um item por artigo do blog, todos existentes e no sitemap', () => {
  assert.ok(artigosDoBlog().length >= 3, 'artigos do blog encontrados pelo JSON-LD Article');
  assert.deepEqual(problemasDoFeed(config), []);
  for (const a of artigosDoBlog()) assert.ok(locs.includes(urlDe(SITE, a)), `${a} no sitemap`);
});

test('detector: página pública nova entra; página noindex sem o comentário fica fora', () => {
  // Páginas simuladas em memória (nada é gravado no disco: os testes rodam em paralelo)
  const falsas = {
    'segmentos/nova.html': `<!-- ${MARCA_PUBLICA} -->\n<meta name="robots" content="noindex, nofollow">`,
    'blog/demo.html': '<meta name="robots" content="noindex, follow">',
    'exemplos/nova.html': `<!-- ${MARCA_PUBLICA} -->`,
    'admin/nova.html': `<!-- ${MARCA_PUBLICA} -->`,
  };
  const paginas = [...todasAsPaginas(), ...Object.keys(falsas)];
  const lerPagina = (f) => falsas[f] ?? ler(f);
  const lista = paginasDoSitemap(config, { paginas, lerPagina });
  assert.ok(lista.includes('segmentos/nova.html'), 'página com o comentário de rascunho entra no sitemap');
  for (const f of ['blog/demo.html', 'exemplos/nova.html', 'admin/nova.html']) assert.ok(!lista.includes(f), `${f} fica fora`);
  const sem = { ...config, portfolio: { ...config.portfolio, projetos: [] } };
  const com = { ...config, portfolio: { ...config.portfolio, projetos: [{ nome: 'x' }] } };
  assert.ok(!paginasDoSitemap(sem).includes('portfolio.html'), 'portfólio fora sem projetos');
  assert.ok(paginasDoSitemap(com).includes('portfolio.html'), 'portfólio entra com projetos reais');
});
