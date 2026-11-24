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
const BLOG = ['blog/index.html', 'blog/autor.html', ...ARTIGOS];
// Páginas por segmento (melhoria 25): uma por site de exemplo, geradas por testes/segmentos/gerar.py
const IDS_SEGMENTOS = ['restaurante', 'moda', 'beleza', 'saude', 'servicos', 'pet'];
const SEGMENTOS = IDS_SEGMENTOS.map((s) => `segmentos/${s}.html`);
const PUBLICAS = ['index.html', 'planos.html', 'exemplos.html', 'termos.html', 'privacidade.html', 'portfolio.html', ...BLOG, ...SEGMENTOS];
// Sites de EXEMPLO (fictícios): sempre noindex, com o próprio cabeçalho
const DEMOS = ['moda', 'restaurante', 'beleza', 'saude', 'servicos', 'pet'].map((s) => `exemplos/${s}.html`);
const PRIVADAS = ['obrigado.html', 'briefing.html', 'pedido.html', '404.html'];
// Imagens Open Graph por página (melhoria 14): geradas por testes/og/gerar.mjs em assets/img/og/. As demais usam og-image.png
const OG_POR_PAGINA = {
  'planos.html': 'planos', 'exemplos.html': 'exemplos', 'blog/index.html': 'blog',
  // Melhoria 111: termos, privacidade, portfólio e acompanhamento do pedido com imagem própria
  'termos.html': 'termos', 'privacidade.html': 'privacidade', 'portfolio.html': 'portfolio', 'pedido.html': 'pedido',
  ...Object.fromEntries(ARTIGOS.map((f) => [f, 'blog-' + f.slice(5, -5)])),
  ...Object.fromEntries(IDS_SEGMENTOS.map((s) => [`segmentos/${s}.html`, 'segmento-' + s])),
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
    assert.match(h, /src="\.\.\/assets\/js\/chat\.js(?:\?v=[0-9a-f]+)?" defer/, `${f}: chat ao vivo (todas as páginas públicas)`);
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
  for (const f of [...PUBLICAS, 'obrigado.html', 'briefing.html', 'pedido.html']) {
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

// Cartões de compartilhamento (melhoria 47): WhatsApp, Facebook, LinkedIn e X montam a prévia com estas tags
test('cartões de compartilhamento: título, tipo e texto alternativo da imagem coerentes com a imagem OG', () => {
  // Textos alternativos de cada imagem: os mesmos usados para gerá-la (testes/og/gerar.mjs e testes/segmentos/og.json)
  const gerador = ler('testes/og/gerar.mjs');
  const ALT_DA_IMAGEM = { 'og-image': 'Portfólio BR: sites profissionais para pequenos negócios' };
  for (const [, nome, alt] of gerador.matchAll(/nome: '([^']+)'[\s\S]*?alt: '([^']+)'/g)) ALT_DA_IMAGEM[`og/${nome}`] = alt;
  for (const s of JSON.parse(ler('testes/segmentos/og.json'))) ALT_DA_IMAGEM[`og/${s.nome}`] = s.alt;
  for (const f of [...TODAS]) {
    const h = ler(f);
    const t = (/<title>([^<]+)<\/title>/.exec(h) || [])[1];
    assert.equal(meta(h, 'og:title'), t, `${f}: og:title igual ao <title>`);
    assert.equal(meta(h, 'og:site_name'), 'Portfólio BR', `${f}: og:site_name`);
    assert.ok((meta(h, 'og:description') || '').length >= 20, `${f}: og:description`);
    assert.equal(meta(h, 'og:locale'), 'pt_BR', `${f}: og:locale`);
    assert.equal(meta(h, 'og:image:type'), 'image/png', `${f}: og:image:type`);
    assert.equal(meta(h, 'twitter:card'), 'summary_large_image', `${f}: twitter:card`);
    const img = (/assets\/img\/(.+)\.png$/.exec(meta(h, 'og:image') || '') || [])[1];
    assert.ok(img in ALT_DA_IMAGEM, `${f}: imagem OG conhecida (${img})`);
    assert.equal(meta(h, 'og:image:alt'), ALT_DA_IMAGEM[img], `${f}: og:image:alt descreve a imagem ${img}`);
    assert.equal(meta(h, 'twitter:image:alt'), ALT_DA_IMAGEM[img], `${f}: twitter:image:alt igual ao og:image:alt`);
    // Uma tag de cada (duplicadas confundem os leitores de prévia)
    for (const tag of ['og:title', 'og:image', 'og:image:alt', 'twitter:card', 'twitter:image:alt']) {
      assert.equal(h.split(`"${tag}"`).length - 1, 1, `${f}: ${tag} uma única vez`);
    }
  }
});

test('sites de exemplo nunca indexáveis nem divulgados como página do site', () => {
  const sitemap = ler('sitemap.xml').replace(/<!--[\s\S]*?-->/g, '');
  for (const f of DEMOS) {
    const h = ler(f);
    assert.match(h, /<meta name="robots" content="noindex[,"]/, `${f}: noindex`);
    assert.doesNotMatch(h, /Rascunho: remover/, `${f}: sem o comentário de rascunho (o noindex fica ao publicar)`);
    assert.doesNotMatch(h, /<link rel="canonical"|property="og:|name="twitter:/, `${f}: sem canonical nem cartão de compartilhamento`);
    assert.ok(!sitemap.includes(f), `${f}: fora do sitemap.xml`);
  }
  for (const f of PRIVADAS) assert.ok(!sitemap.includes(`/${f}<`), `${f}: fora do sitemap.xml`);
  // O PUBLICAR.md manda tirar o noindex só das páginas com o comentário de rascunho: elas são exatamente as públicas
  const comComentario = [...TODAS, ...DEMOS, 'admin/index.html'].filter((f) => ler(f).includes('Rascunho: remover esta linha')).sort();
  assert.deepEqual(comComentario, [...PUBLICAS].sort(), 'comentário de rascunho só nas páginas públicas');
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
      const blog = lds[0]['@graph'].find((n) => n['@type'] === 'Blog');
      assert.ok(blog, 'blog/index.html: Blog no @graph');
      assert.equal(blog.blogPost.length, ARTIGOS.length);
      continue;
    }
    if (f === 'blog/autor.html') {
      assert.ok(lds[0]['@graph'].some((n) => n['@type'] === 'ProfilePage'), 'blog/autor.html: ProfilePage');
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

test('trilha (melhoria 22): <nav aria-label="Trilha"> visível igual ao JSON-LD BreadcrumbList', () => {
  const COM_TRILHA = [...BLOG, ...SEGMENTOS, 'planos.html', 'exemplos.html', 'portfolio.html', 'termos.html', 'privacidade.html', ...DEMOS];
  for (const f of COM_TRILHA) {
    const h = ler(f);
    const navs = [...h.matchAll(/<nav class="migalhas[^"]*" aria-label="Trilha"><ol role="list">([\s\S]*?)<\/ol><\/nav>/g)];
    assert.equal(navs.length, 1, `${f}: uma trilha visível`);
    const itens = [...navs[0][1].matchAll(/<li( aria-current="page")?>(?:<a href="([^"]+)">)?([^<]+)/g)];
    assert.ok(itens.length >= 2, `${f}: ao menos 2 níveis`);
    itens.forEach(([, atual, href], i) => {
      const ultimo = i === itens.length - 1;
      assert.equal(Boolean(atual), ultimo, `${f}: só o último item tem aria-current="page"`);
      assert.equal(Boolean(href), !ultimo, `${f}: itens anteriores são links`);
    });
    const lista = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]))
      .flatMap((d) => d['@graph'] || [d])
      .find((n) => n['@type'] === 'BreadcrumbList');
    assert.ok(lista, `${f}: BreadcrumbList`);
    const el = lista.itemListElement;
    assert.equal(el.length, itens.length, `${f}: mesmo número de níveis na trilha e no JSON-LD`);
    el.forEach((item, i) => {
      assert.equal(item.position, i + 1, `${f}: posição ${i + 1}`);
      assert.ok(item.item.startsWith(SITE), `${f}: URL absoluta do site`);
      if (i < el.length - 1) {
        assert.equal(item.name, itens[i][3].trim(), `${f}: nome do nível ${i + 1}`);
        const destino = new URL(itens[i][2], new URL(f, SITE)).href.replace(/index\.html$/, '');
        assert.equal(destino, item.item, `${f}: link do nível ${i + 1} igual ao JSON-LD`);
      }
    });
    assert.equal(el.at(-1).item, SITE + f.replace(/index\.html$/, ''), `${f}: último nível é a própria página`);
  }
});

test('segmentos (melhoria 25): JSON-LD Service, exemplo e simulador do segmento, sitemap, links e honestidade', () => {
  const urls = [...ler('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const home = ler('index.html');
  const simulador = ler('index.html').match(/name="tipo" value="([a-z]+)"/g).map((t) => t.slice(19, -1));
  for (const id of IDS_SEGMENTOS) {
    const f = `segmentos/${id}.html`;
    const h = ler(f);
    const url = SITE + f;
    assert.ok(urls.includes(url), `${f} no sitemap`);
    assert.ok(home.includes(`href="${f}"`), `${f}: link na seção "Para quem é" da home`);
    const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.equal(lds.length, 1, `${f}: um JSON-LD`);
    const servico = lds[0]['@graph'].find((n) => n['@type'] === 'Service');
    assert.ok(servico && servico.name && servico.description && servico.serviceType, `${f}: Service completo`);
    assert.equal(servico.url, url, `${f}: Service.url`);
    assert.equal(servico.provider.name, 'Portfólio BR');
    assert.equal(servico.image, meta(h, 'og:image'), `${f}: imagem do Service igual à OG`);
    assert.ok(!('offers' in servico) && !('aggregateRating' in servico), `${f}: sem preço fixo nem avaliações no JSON-LD`);
    assert.equal(meta(h, 'og:type'), 'website');
    assert.match(h, new RegExp(`href="\\.\\./exemplos/${id}\\.html"`), `${f}: link para o exemplo do segmento`);
    assert.ok(existsSync(new URL(`exemplos/${id}.html`, raiz)), `exemplos/${id}.html existe`);
    assert.ok(simulador.includes(id), `${id} é uma opção do simulador`);
    assert.match(h, new RegExp(`href="\\.\\./index\\.html\\?segmento=${id}#simulador"`), `${f}: link para o simulador já com o segmento`);
    assert.match(h, /data-whats="segmento" hidden/, `${f}: WhatsApp só aparece com número válido`);
    for (const outro of IDS_SEGMENTOS.filter((o) => o !== id)) assert.match(h, new RegExp(`href="${outro}\\.html"`), `${f}: liga para ${outro}`);
    for (const [, alvo] of h.matchAll(/\s(?:href|src)="(?![#]|https?:|mailto:|data:)([^"#?]+)/g)) {
      const resolvido = new URL(alvo, new URL(f, raiz));
      const arquivo = resolvido.pathname.endsWith('/') ? new URL('index.html', resolvido) : resolvido;
      assert.ok(existsSync(arquivo), `${f}: link quebrado ${alvo}`);
    }
    // honestidade: sem estatísticas, números de clientes, depoimentos ou preços escritos na página
    const texto = (/<article[\s\S]*?<\/article>/.exec(h) || [''])[0].replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(texto, /\d+\s?%|\d+\s+(clientes|sites|empresas|negócios)|R\$|depoimento|garantimos|primeiro lugar/i, `${f}: sem números ou promessas inventadas`);
  }
});

test('404.html usa caminhos absolutos do subcaminho (o GitHub Pages serve em qualquer URL)', () => {
  const h = ler('404.html');
  const prefixo = new URL(SITE).pathname;
  const relativos = [...h.matchAll(/\s(?:href|src)="(?![#/]|https?:|mailto:|data:)([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(relativos, [], 'sem caminhos relativos no 404');
  assert.match(h, new RegExp(`src="${prefixo}config\\.js(?:\\?v=[0-9a-f]+)?"`));
});

test('scripts: config.js e inicio.js síncronos no <head>; os demais com defer', () => {
  for (const f of TODAS) {
    const head = bloco(ler(f), /<head>[\s\S]*?<\/head>/);
    const scripts = [...head.matchAll(/<script src="([^"]+)"( defer)?><\/script>/g)];
    for (const [, src, defer] of scripts) {
      const sincrono = /(^|\/)(config\.js|assets\/js\/inicio\.js)$/.test(src.replace(/\?v=[0-9a-f]+$/, ''));
      assert.equal(!defer, sincrono, `${f}: ${src} ${sincrono ? 'deve ser síncrono' : 'deve ter defer'}`);
    }
    assert.match(head, /rel="preload" href="[^"]*plus-jakarta-sans-latin-wght\.woff2(?:\?v=[0-9a-f]+)?" as="font" type="font\/woff2" crossorigin/, `${f}: preload da fonte`);
  }
});

test('portfólio (melhoria 21): cada projeto com foto tem as 6 imagens responsivas; LARGURAS iguais no JS e no gerador', () => {
  const larguras = (texto, re) => (re.exec(texto) || [])[1].split(',').map((n) => Number(n.trim()));
  const js = larguras(ler('assets/js/main.js'), /LARGURAS_PORTFOLIO = \[([^\]]+)\]/);
  const py = larguras(ler('testes/portfolio/gerar.py'), /LARGURAS = \(([^)]+)\)/);
  assert.deepEqual(js, py, 'larguras do main.js e do gerar.py');
  for (const p of config.portfolio.projetos) {
    if (!p.foto) continue;
    assert.match(p.foto, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `foto "${p.foto}" só com minúsculas, números e hífen`);
    for (const l of js) for (const ext of ['webp', 'png']) {
      const arq = `assets/img/portfolio/${p.foto}-${l}.${ext}`;
      assert.ok(existsSync(new URL(arq, raiz)), `${arq} existe (rode python3 testes/portfolio/gerar.py)`);
    }
  }
});
