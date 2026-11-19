// Consistência entre as páginas estáticas (sem build, o <head>, o cabeçalho e o rodapé se repetem).
// Uso: node --test testes/funcoes/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const raiz = new URL('../../', import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');
const janela = {};
vm.runInNewContext(ler('config.js'), { window: janela });
const config = janela.PBR_CONFIG;
const SITE = config.site.url;

// Blog (melhoria 9): páginas em blog/, com caminhos ../ e JSON-LD Article
const ARTIGOS = ['site-ou-instagram', 'o-que-um-site-profissional-precisa-ter', 'como-funciona-a-criacao-do-seu-site'].map((s) => `blog/${s}.html`);
const BLOG = ['blog/index.html', ...ARTIGOS];
const PUBLICAS = ['index.html', 'planos.html', 'exemplos.html', 'termos.html', 'privacidade.html', 'portfolio.html', ...BLOG];
// Sites de EXEMPLO (fictícios): sempre noindex, com o próprio cabeçalho
const DEMOS = ['moda', 'restaurante', 'beleza', 'saude', 'servicos', 'pet'].map((s) => `exemplos/${s}.html`);
const PRIVADAS = ['obrigado.html', 'briefing.html', '404.html'];
// Imagens Open Graph por página (melhoria 14): geradas por testes/og/gerar.mjs em assets/img/og/. As demais usam og-image.png
const OG_POR_PAGINA = {
  'planos.html': 'planos', 'exemplos.html': 'exemplos', 'blog/index.html': 'blog',
  ...Object.fromEntries(ARTIGOS.map((f) => [f, 'blog-' + f.slice(5, -5)])),
};
const TODAS = [...PUBLICAS, ...PRIVADAS];

const bloco = (html, re) => (re.exec(html) || [])[0] || '';
const meta = (html, nome) => (new RegExp(`<meta (?:name|property)="${nome}" content="([^"]*)"`).exec(html) || [])[1];
// Normaliza links para comparar o cabeçalho/rodapé da home com o das outras páginas
const normalizar = (t) => t
  .replace(/\/empresa-jp\//g, '')
  .replace(/(href|src)="\.\.\//g, '$1="')
  .replace(/href="#inicio"/g, 'href="index.html"')
  .replace(/href="#(servicos|como-funciona|duvidas)"/g, 'href="index.html#$1"')
  .replace(/href="(?:#planos|index\.html#planos)"/g, 'href="planos.html"');

const csp = (html) => (/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html) || [])[1];

test('todas as páginas: lang, charset, viewport, um h1, title e description únicos', () => {
  const titulos = new Set();
  for (const f of TODAS) {
    const h = ler(f);
    assert.match(h, /<html lang="pt-BR"/, f);
    assert.match(h, /<meta charset="utf-8">/, f);
    assert.match(h, /<meta name="viewport" content="width=device-width, initial-scale=1/, f);
    assert.equal((h.match(/<h1[\s>]/g) || []).length, 1, `${f}: um único h1`);
    const t = (/<title>([^<]+)<\/title>/.exec(h) || [])[1];
    assert.ok(t && !titulos.has(t), `${f}: title único (${t})`);
    titulos.add(t);
    assert.ok((meta(h, 'description') || '').length >= 20, `${f}: meta description`);
    assert.match(h, /<a class="pular-link" href="#conteudo">/, `${f}: link "Pular para o conteúdo"`);
    assert.match(h, /<main id="conteudo"/, f);
  }
});

test('CSP idêntica em todas as páginas (e no painel), sem unsafe-inline/eval e com o Supabase do config.js', () => {
  const ref = csp(ler('index.html'));
  assert.ok(ref, 'index.html tem CSP');
  for (const f of [...TODAS, ...DEMOS, 'admin/index.html']) assert.equal(csp(ler(f)), ref, `${f}: CSP igual à da home`);
  assert.doesNotMatch(ref, /unsafe-inline|unsafe-eval|\*/);
  const host = new URL(config.supabase.url).host;
  assert.match(ref, new RegExp(`connect-src [^;]*https://${host.replace(/\./g, '\\.')}`), 'connect-src com o Supabase do config.js');
  assert.match(ref, new RegExp(`connect-src [^;]*wss://${host.replace(/\./g, '\\.')}`), 'Realtime (wss) liberado');
  const lib = (/BIBLIOTECA = \{\s*url: '([^']+)'/.exec(ler('assets/js/supabase-client.js')) || [])[1];
  assert.ok(lib && ref.includes(lib.replace(/dist\/umd\/supabase\.js$/, '')), 'script-src cobre a versão do supabase-js usada');
});

test('sites de exemplo: aviso de exemplo, sempre noindex, um h1, CTA para os planos e chat', () => {
  for (const f of DEMOS) {
    const h = ler(f);
    assert.match(h, /<html lang="pt-BR"/, f);
    assert.equal((h.match(/<h1[\s>]/g) || []).length, 1, `${f}: um único h1`);
    assert.match(h, /<meta name="robots" content="noindex/, `${f}: sempre noindex (negócio fictício)`);
    assert.match(h, /<strong>Site de exemplo<\/strong>/, `${f}: aviso visível de site de exemplo`);
    assert.match(h, /fictício/, `${f}: diz que o negócio é fictício`);
    assert.match(h, /href="\.\.\/planos\.html"/, `${f}: CTA para os planos`);
    assert.match(h, /src="\.\.\/assets\/js\/chat\.js" defer/, `${f}: chat ao vivo (todas as páginas públicas)`);
    assert.doesNotMatch(h, /wa\.me\/|tel:|mailto:/, `${f}: sem contatos falsos`);
  }
  const lista = ler('exemplos.html');
  for (const f of DEMOS) assert.match(lista, new RegExp(`href="${f}"`), `exemplos.html liga para ${f}`);
});

test('cabeçalho e rodapé iguais aos da home', () => {
  const home = ler('index.html');
  const topo = normalizar(bloco(home, /<header class="topo"[\s\S]*?<\/header>/));
  const rodape = normalizar(bloco(home, /<footer class="rodape">[\s\S]*?<\/footer>/));
  assert.ok(topo && rodape);
  for (const f of TODAS.slice(1)) {
    const h = ler(f);
    assert.equal(normalizar(bloco(h, /<header class="topo"[\s\S]*?<\/header>/)), topo, `${f}: cabeçalho`);
    assert.equal(normalizar(bloco(h, /<footer class="rodape">[\s\S]*?<\/footer>/)), rodape, `${f}: rodapé`);
  }
});

test('SEO: canonical e Open Graph no subcaminho final; imagem OG 1200x630', () => {
  for (const f of [...PUBLICAS, 'obrigado.html', 'briefing.html']) {
    const h = ler(f);
    const esperado = SITE + (f === 'index.html' ? '' : f.replace(/index\.html$/, ''));
    assert.equal((/<link rel="canonical" href="([^"]+)">/.exec(h) || [])[1], esperado, `${f}: canonical`);
    assert.equal(meta(h, 'og:url'), esperado, `${f}: og:url`);
    assert.equal(meta(h, 'og:image'), SITE + 'assets/img/' + (OG_POR_PAGINA[f] ? `og/${OG_POR_PAGINA[f]}.png` : 'og-image.png'), `${f}: og:image`);
    assert.ok(meta(h, 'og:image:alt'), `${f}: og:image:alt`);
    assert.equal(meta(h, 'og:image:width'), '1200');
    assert.equal(meta(h, 'og:image:height'), '630');
    assert.equal(meta(h, 'og:locale'), 'pt_BR');
    assert.equal(meta(h, 'twitter:card'), 'summary_large_image');
  }
  for (const img of ['og-image', ...Object.values(OG_POR_PAGINA).map((n) => `og/${n}`)]) {
    const png = readFileSync(new URL(`assets/img/${img}.png`, raiz));
    assert.equal(png.readUInt32BE(16), 1200, `largura da imagem OG ${img}`);
    assert.equal(png.readUInt32BE(20), 630, `altura da imagem OG ${img}`);
    assert.ok(png.length < 100 * 1024, `imagem OG ${img} com menos de 100 KB`);
  }
  // Artigos: o JSON-LD Article usa a mesma imagem do og:image
  for (const f of ARTIGOS) assert.ok(ler(f).includes(`"image": "${SITE}assets/img/og/${OG_POR_PAGINA[f]}.png"`), `${f}: JSON-LD image`);
});

test('noindex: privadas sempre; públicas só enquanto config.rascunho = true', () => {
  for (const f of PRIVADAS) assert.match(ler(f), /<meta name="robots" content="noindex, nofollow">/, `${f}: sempre noindex`);
  for (const f of PUBLICAS) {
    const tem = /<meta name="robots" content="noindex/.test(ler(f));
    assert.equal(tem, config.rascunho === true, `${f}: noindex ${config.rascunho ? 'obrigatório no rascunho' : 'deve sair ao publicar'} (ver PUBLICAR.md)`);
  }
  assert.match(ler('admin/index.html'), /noindex/);
});

test('sitemap e robots com as URLs finais; JSON-LD sem avaliações', () => {
  const sm = ler('sitemap.xml');
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const u of urls) {
    assert.ok(u.startsWith(SITE), `${u} no domínio final`);
    const arquivo = u.slice(SITE.length) || 'index.html';
    assert.ok(existsSync(new URL(arquivo, raiz)), `${arquivo} existe`);
    assert.ok(!PRIVADAS.includes(arquivo) && !DEMOS.includes(arquivo), `${arquivo} é privada/exemplo e não deve estar no sitemap`);
  }
  assert.ok(urls.includes(SITE) && urls.includes(SITE + 'planos.html') && urls.includes(SITE + 'exemplos.html'));
  assert.equal(urls.includes(SITE + 'portfolio.html'), config.portfolio.projetos.length > 0, 'portfolio.html no sitemap só com projetos reais');
  assert.match(ler('robots.txt'), new RegExp(`Sitemap: ${SITE}sitemap.xml`));
  const ld = (/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(ler('index.html')) || [])[1];
  const dados = JSON.parse(ld);
  assert.ok(dados['@graph'].some((n) => n['@type'] === 'Organization'));
  assert.doesNotMatch(ld + ler('assets/js/main.js'), /aggregateRating|"review"|ratingValue/i, 'sem avaliações');
});

test('blog: JSON-LD Article/Blog válido, links relativos resolvem, no sitemap e no rodapé', () => {
  const urls = [...ler('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const f of BLOG) {
    const h = ler(f);
    const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.equal(lds.length, 1, `${f}: um JSON-LD`);
    const url = SITE + f.replace(/index\.html$/, '');
    assert.ok(urls.includes(url), `${f} no sitemap`);
    // todo caminho relativo aponta para um arquivo que existe
    for (const [, alvo] of h.matchAll(/\s(?:href|src)="(?![#]|https?:|mailto:|data:)([^"#?]+)/g)) {
      const resolvido = new URL(alvo, new URL(f, raiz));
      const arquivo = resolvido.pathname.endsWith('/') ? new URL('index.html', resolvido) : resolvido;
      assert.ok(existsSync(arquivo), `${f}: link quebrado ${alvo}`);
    }
    if (f === 'blog/index.html') {
      assert.equal(lds[0]['@type'], 'Blog');
      assert.equal(lds[0].blogPost.length, ARTIGOS.length);
      continue;
    }
    const art = lds[0]['@graph'].find((n) => n['@type'] === 'Article');
    assert.ok(art && art.headline && art.datePublished && art.author && art.publisher, `${f}: Article completo`);
    assert.equal(art.mainEntityOfPage, url, `${f}: mainEntityOfPage`);
    assert.ok(lds[0]['@graph'].some((n) => n['@type'] === 'BreadcrumbList'), `${f}: BreadcrumbList`);
    assert.equal(meta(h, 'og:type'), 'article', `${f}: og:type article`);
    // honestidade: sem estatísticas ("x%") nem números de clientes
    const texto = (/<article[\s\S]*?<\/article>/.exec(h) || [''])[0].replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(texto, /\d+\s?%|\d+\s+(clientes|sites entregues|empresas)/i, `${f}: sem estatísticas inventadas`);
  }
  assert.match(ler('index.html'), /<a href="blog\/">Blog<\/a>/, 'link do blog no rodapé');
});

test('404.html usa caminhos absolutos do subcaminho (o GitHub Pages serve em qualquer URL)', () => {
  const h = ler('404.html');
  const prefixo = new URL(SITE).pathname;
  const relativos = [...h.matchAll(/\s(?:href|src)="(?![#/]|https?:|mailto:|data:)([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(relativos, [], 'sem caminhos relativos no 404');
  assert.match(h, new RegExp(`src="${prefixo}config\\.js"`));
});

test('scripts: config.js e inicio.js síncronos no <head>; os demais com defer', () => {
  for (const f of TODAS) {
    const head = bloco(ler(f), /<head>[\s\S]*?<\/head>/);
    const scripts = [...head.matchAll(/<script src="([^"]+)"( defer)?><\/script>/g)];
    for (const [, src, defer] of scripts) {
      const sincrono = /(^|\/)(config\.js|assets\/js\/inicio\.js)$/.test(src);
      assert.equal(!defer, sincrono, `${f}: ${src} ${sincrono ? 'deve ser síncrono' : 'deve ter defer'}`);
    }
    assert.match(head, /rel="preload" href="[^"]*plus-jakarta-sans-latin-wght\.woff2" as="font" type="font\/woff2" crossorigin/, `${f}: preload da fonte`);
  }
});
