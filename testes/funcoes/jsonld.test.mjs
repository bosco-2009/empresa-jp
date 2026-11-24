// Dados estruturados estáticos de todo o site (melhoria 61).
// Valida cada <script type="application/ld+json"> do HTML: JSON válido, @context, URLs absolutas
// coerentes com o canonical e nenhum campo que exigiria dado inventado (avaliações, números, prêmios).
// Uso: node --test testes/funcoes/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const raiz = new URL('../../', import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');
const janela = {};
vm.runInNewContext(ler('config.js'), { window: janela });
const SITE = janela.PBR_CONFIG.site.url.replace(/\/?$/, '/');

const paginas = ['', 'blog/', 'segmentos/', 'exemplos/', 'admin/']
  .flatMap((d) => readdirSync(new URL(d || '.', raiz)).filter((f) => f.endsWith('.html')).map((f) => d + f));
const canonical = (html) => (/<link rel="canonical" href="([^"]+)">/.exec(html) || [])[1];
const blocosLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

function nos(valor, lista = []) {
  if (Array.isArray(valor)) valor.forEach((v) => nos(v, lista));
  else if (valor && typeof valor === 'object') {
    if (valor['@type']) lista.push(valor);
    Object.values(valor).forEach((v) => nos(v, lista));
  }
  return lista;
}
// Todos os pares [chave, valor-texto] do grafo, em qualquer profundidade
function textos(valor, chave = '', lista = []) {
  if (Array.isArray(valor)) valor.forEach((v) => textos(v, chave, lista));
  else if (valor && typeof valor === 'object') Object.entries(valor).forEach(([k, v]) => textos(v, k, lista));
  else if (typeof valor === 'string') lista.push([chave, valor]);
  return lista;
}

// Tipos e campos que só fariam sentido com dados reais que o site não tem (CLAUDE.md, "Honestidade").
const TIPOS_PROIBIDOS = ['Review', 'AggregateRating', 'Rating', 'EmployeeRole'];
const CAMPOS_PROIBIDOS = ['review', 'aggregateRating', 'ratingValue', 'reviewCount', 'ratingCount', 'bestRating',
  'award', 'numberOfEmployees', 'foundingDate', 'founder', 'interactionStatistic', 'userInteractionCount'];
// Tipos que descrevem a própria página: url deve ser exatamente o canonical
const TIPOS_PAGINA = ['WebPage', 'CollectionPage', 'ProfilePage', 'AboutPage', 'ContactPage', 'FAQPage', 'Blog', 'Service'];
const CHAVES_URL = ['url', 'item', 'image', 'logo', 'mainEntityOfPage', '@id', 'contentUrl', 'thumbnailUrl'];

test('JSON-LD estático: válido, com @context schema.org e sem [PROVISÓRIO] em nenhuma página', () => {
  let total = 0;
  for (const f of paginas) {
    const html = ler(f);
    const brutos = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const b of brutos) {
      let d;
      assert.doesNotThrow(() => { d = JSON.parse(b); }, `${f}: JSON-LD inválido`);
      assert.equal(d['@context'], 'https://schema.org', `${f}: @context`);
      for (const n of d['@graph'] || [d]) assert.ok(n['@type'], `${f}: nó raiz sem @type`);
      assert.ok(!/PROVIS[ÓO]RIO/i.test(b), `${f}: texto [PROVISÓRIO] vazou para o JSON-LD`);
      total++;
    }
  }
  assert.ok(total >= 20, `blocos JSON-LD encontrados (${total})`);
});

test('JSON-LD estático: URLs absolutas, do próprio site, e páginas apontando para o próprio canonical', () => {
  for (const f of paginas) {
    const html = ler(f);
    const can = canonical(html);
    for (const d of blocosLd(html)) {
      for (const [k, v] of textos(d)) {
        if (!CHAVES_URL.includes(k)) continue;
        if (k === '@id' && v.startsWith('#')) continue;
        assert.match(v, /^https:\/\//, `${f}: ${k} precisa ser URL absoluta (${v})`);
        assert.ok(v.startsWith(SITE), `${f}: ${k} fora do site (${v})`);
        assert.ok(!/\.\.\/|\/\.\//.test(v), `${f}: ${k} com caminho relativo (${v})`);
      }
      for (const n of nos(d)) {
        // nós "desta página" (com @id ancorado no canonical) carregam o canonical como url
        if (can && typeof n['@id'] === 'string' && n['@id'].startsWith(can + '#') && n.url) {
          assert.equal(n.url, can, `${f}: url de ${n['@type']} ≠ canonical`);
        }
        if (can && TIPOS_PAGINA.includes(n['@type']) && n.url && n['@id'] && !n['@id'].startsWith(SITE + '#')) {
          assert.equal(n.url, can, `${f}: ${n['@type']}.url ≠ canonical`);
        }
        if (n['@type'] === 'BreadcrumbList' && can) {
          const ultimo = n.itemListElement[n.itemListElement.length - 1];
          assert.equal(ultimo.item, can, `${f}: último item da trilha ≠ canonical`);
        }
      }
    }
  }
});

test('JSON-LD estático: sem avaliações, números ou campos que exigiriam dados inventados', () => {
  for (const f of paginas) {
    for (const d of blocosLd(ler(f))) {
      for (const n of nos(d)) {
        assert.ok(!TIPOS_PROIBIDOS.includes(n['@type']), `${f}: tipo proibido ${n['@type']}`);
        for (const c of CAMPOS_PROIBIDOS) assert.ok(!(c in n), `${f}: campo proibido ${c} em ${n['@type']}`);
      }
    }
  }
});

// Melhoria 99: as listas apontam só para páginas indexáveis (no sitemap), na ordem dos cartões visíveis.
const noSitemap = new Set([...ler('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
const h1De = (f) => (/<h1[^>]*>([^<]+)<\/h1>/.exec(ler(f)) || [])[1]?.trim();

test('exemplos.html: CollectionPage + ItemList dos guias por segmento (indexáveis), na ordem dos cartões', () => {
  const html = ler('exemplos.html');
  const can = canonical(html);
  const todos = blocosLd(html).flatMap((d) => nos(d));
  const pagina = todos.find((n) => n['@type'] === 'CollectionPage');
  assert.ok(pagina, 'CollectionPage presente');
  assert.equal(pagina.url, can);
  assert.equal(pagina['@id'], can + '#pagina');
  assert.match(pagina.description, /fictício/, 'descrição deixa claro que são fictícios');
  const lista = pagina.mainEntity;
  assert.equal(lista['@type'], 'ItemList');
  const exemplos = [...html.matchAll(/<a class="ex-cartao__link" href="([^"]+)"/g)].map((m) => m[1]);
  const guias = [...html.matchAll(/<a class="ex-cartao__guia" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(exemplos.length, 6, 'seis cartões de exemplo na página');
  assert.equal(guias.length, exemplos.length, 'cada cartão tem o link visível do guia do segmento');
  guias.forEach((g, i) => assert.equal(g.replace('segmentos/', ''), exemplos[i].replace('exemplos/', ''), `cartão ${i + 1}: guia do mesmo segmento`));
  assert.equal(lista.numberOfItems, guias.length);
  assert.deepEqual(lista.itemListElement.map((i) => i.url), guias.map((g) => SITE + g), 'itens = guias dos cartões, na mesma ordem');
  lista.itemListElement.forEach((it, i) => {
    assert.equal(it.position, i + 1);
    assert.ok(!it.url.includes('/exemplos/'), `item ${i + 1}: nunca aponta para exemplo noindex`);
    assert.ok(noSitemap.has(it.url), `item ${i + 1}: ${it.url} está no sitemap`);
    assert.equal(it.name, h1De(guias[i]), `item ${i + 1}: nome = h1 da página do segmento`);
    assert.ok(html.includes(`<span class="visualmente-oculto">: ${it.name}</span>`), `item ${i + 1}: nome também no link visível`);
  });
});

test('blog/index.html: ItemList com os artigos na ordem dos cartões, todos no sitemap', () => {
  const html = ler('blog/index.html');
  const todos = blocosLd(html).flatMap((d) => nos(d));
  const listas = todos.filter((n) => n['@type'] === 'ItemList');
  assert.equal(listas.length, 1, 'uma ItemList');
  const cartoes = [...html.matchAll(/<h2 class="blog-cartao__titulo"><a href="([^"]+)">([^<]+)<\/a><\/h2>/g)]
    .map((m) => ({ url: new URL(m[1], SITE + 'blog/').href, nome: m[2] }));
  assert.ok(cartoes.length >= 1, 'cartões de artigo na página');
  const itens = listas[0].itemListElement;
  assert.equal(listas[0].numberOfItems, cartoes.length);
  assert.deepEqual(itens.map((i) => i.url), cartoes.map((c) => c.url), 'URLs = links dos cartões, na mesma ordem');
  itens.forEach((it, i) => {
    assert.equal(it.position, i + 1);
    assert.equal(it.name, cartoes[i].nome, `item ${i + 1}: nome = título visível`);
    assert.ok(noSitemap.has(it.url), `item ${i + 1}: ${it.url} está no sitemap`);
  });
  // os artigos da lista são os mesmos do blogPost do Blog
  const blog = todos.find((n) => n['@type'] === 'Blog');
  assert.deepEqual(blog.blogPost.map((b) => b.url), itens.map((i) => i.url), 'ItemList = blogPost');
});

test('portfolio.html: sem JSON-LD de projetos no HTML (só o JS gera, e só com projetos reais do config.js)', () => {
  const html = ler('portfolio.html');
  const tipos = blocosLd(html).flatMap((d) => nos(d)).map((n) => n['@type']);
  assert.ok(!tipos.includes('ItemList') && !tipos.includes('CreativeWork'), 'nenhuma lista de projetos estática');
  const js = ler('assets/js/main.js');
  assert.match(js, /data-ld-portfolio/, 'main.js gera o JSON-LD do portfólio');
  assert.match(js, /projetos\.length > 0\)[\s\S]{0,4000}data-ld-portfolio/, 'JSON-LD do portfólio só dentro do bloco com projetos reais');
});

// Melhoria 80: Organization + WebSite da home montados só com o que é real no config.js.
test('index.html: Organization e WebSite com campos obrigatórios, coerentes com o config.js e o canonical', () => {
  const html = ler('index.html');
  const can = canonical(html);
  const cfg = janela.PBR_CONFIG;
  assert.equal(can, SITE, 'canonical da home = config.site.url');
  const todos = blocosLd(html).flatMap((d) => nos(d));
  const org = todos.find((n) => n['@type'] === 'Organization');
  const site = todos.find((n) => n['@type'] === 'WebSite');
  assert.ok(org && site, 'Organization e WebSite presentes no HTML (funcionam sem JS)');
  assert.equal(org['@id'], can + '#organizacao');
  assert.equal(org.url, can);
  assert.equal(org.name, cfg.site.nome, 'nome = config.site.nome');
  assert.match(org.logo, /\.png$/, 'logo em PNG');
  const logo = org.logo.slice(SITE.length);
  assert.doesNotThrow(() => readFileSync(new URL(logo, raiz)), `logo existe (${logo})`);
  const png = readFileSync(new URL(logo, raiz));
  assert.ok(png.readUInt32BE(16) >= 112 && png.readUInt32BE(20) >= 112, 'logo com pelo menos 112×112 px');
  assert.deepEqual(org.sameAs, [`https://www.instagram.com/${cfg.contato.instagram}/`], 'sameAs = Instagram do config.js');
  // Contatos e dados da empresa nunca ficam fixos no HTML: vêm do config.js (main.js), só quando reais.
  for (const c of ['email', 'telephone', 'contactPoint', 'legalName', 'taxID', 'address']) {
    assert.ok(!(c in org), `Organization estática sem ${c}`);
  }
  assert.equal(site['@id'], can + '#site');
  assert.equal(site.url, can);
  assert.equal(site.name, cfg.site.nome);
  assert.equal(site.inLanguage, 'pt-BR');
  assert.deepEqual(site.publisher, { '@id': org['@id'] }, 'WebSite publicado pela Organization');
  assert.ok(!('potentialAction' in site), 'sem SearchAction: o site não tem busca interna');
});

test('main.js: contatos do JSON-LD só entram quando reais (sem [PROVISÓRIO], formato validado)', () => {
  const js = ler('assets/js/main.js');
  const bloco = js.slice(js.indexOf('Melhoria 80'), js.indexOf("'@type': 'Service'"));
  assert.ok(bloco.length > 100, 'bloco da Organization encontrado');
  assert.match(bloco, /provis\[óo\]rio/i, 'descarta valores marcados [PROVISÓRIO]');
  assert.match(bloco, /whatsDisponivel/, 'telefone só com WhatsApp válido');
  assert.match(bloco, /org\.email = email/, 'e-mail validado antes de entrar');
});
