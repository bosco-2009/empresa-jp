// SEO técnico do blog (melhoria 33): JSON-LD válido em todas as páginas, metas de artigo, autor e feed RSS.
// Uso: node --test testes/funcoes/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const raiz = new URL('../../', import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');
const janela = {};
vm.runInNewContext(ler('config.js'), { window: janela });
const SITE = janela.PBR_CONFIG.site.url;
const ORG_ID = SITE + '#organizacao';
const AUTOR = SITE + 'blog/autor.html';

const ARTIGOS = ['site-ou-instagram', 'o-que-um-site-profissional-precisa-ter', 'como-funciona-a-criacao-do-seu-site'];
const meta = (html, nome) => (new RegExp(`<meta (?:name|property)="${nome}" content="([^"]*)"`).exec(html) || [])[1];
const canonical = (html) => (/<link rel="canonical" href="([^"]+)">/.exec(html) || [])[1];
const blocosLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const dataIso = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z))?$/;

// Todas as páginas HTML do site (raiz, blog/, segmentos/, exemplos/, admin/)
const paginas = ['', 'blog/', 'segmentos/', 'exemplos/', 'admin/']
  .flatMap((d) => readdirSync(new URL(d || '.', raiz)).filter((f) => f.endsWith('.html')).map((f) => d + f));

// Percorre o grafo e devolve todos os nós com @type
function nos(valor, lista = []) {
  if (Array.isArray(valor)) valor.forEach((v) => nos(v, lista));
  else if (valor && typeof valor === 'object') {
    if (valor['@type']) lista.push(valor);
    Object.values(valor).forEach((v) => nos(v, lista));
  }
  return lista;
}

test('JSON-LD: todo bloco é JSON válido, com @context schema.org e @type em cada nó do @graph', () => {
  let total = 0;
  for (const f of paginas) {
    for (const bruto of blocosLd(ler(f))) {
      let dados;
      assert.doesNotThrow(() => { dados = JSON.parse(bruto); }, `${f}: JSON-LD inválido`);
      assert.equal(dados['@context'], 'https://schema.org', `${f}: @context`);
      const raizes = dados['@graph'] || [dados];
      for (const n of raizes) assert.ok(n['@type'], `${f}: nó sem @type`);
      // URLs absolutas no domínio final (exceto redes sociais)
      for (const n of nos(dados)) {
        for (const chave of ['url', 'item', 'image', 'logo', 'mainEntityOfPage', '@id']) {
          const v = n[chave];
          if (typeof v === 'string' && v.startsWith('http')) assert.ok(v.startsWith(SITE), `${f}: ${chave} fora do site (${v})`);
        }
        if (n['@type'] === 'BreadcrumbList') {
          n.itemListElement.forEach((it, i) => assert.equal(it.position, i + 1, `${f}: posição da trilha`));
        }
      }
      total++;
    }
  }
  assert.ok(total >= 20, `JSON-LD encontrado em várias páginas (${total})`);
});

test('artigos: Article completo, coerente com as metas Open Graph de artigo e com a data visível', () => {
  for (const a of ARTIGOS) {
    const f = `blog/${a}.html`;
    const h = ler(f);
    const art = nos(JSON.parse(blocosLd(h)[0])).find((n) => n['@type'] === 'Article');
    assert.ok(art, `${f}: Article`);
    assert.ok(art.headline && art.headline.length <= 110, `${f}: headline com até 110 caracteres`);
    assert.match(art.datePublished, dataIso, `${f}: datePublished ISO 8601`);
    assert.match(art.dateModified, dataIso, `${f}: dateModified ISO 8601`);
    assert.ok(art.dateModified >= art.datePublished, `${f}: dateModified não pode ser anterior à publicação`);
    assert.equal(art.mainEntityOfPage, canonical(h), `${f}: mainEntityOfPage = canonical`);
    assert.equal(art.image, meta(h, 'og:image'), `${f}: image = og:image`);
    assert.equal(art.author['@id'], ORG_ID, `${f}: autor é a organização (sem pessoa inventada)`);
    assert.equal(art.author['@type'], 'Organization', `${f}: autor Organization`);
    assert.equal(art.author.url, AUTOR, `${f}: autor aponta para a página de autor`);
    assert.equal(art.publisher['@id'], ORG_ID, `${f}: publisher`);
    assert.equal(meta(h, 'og:type'), 'article');
    assert.equal(meta(h, 'article:published_time'), art.datePublished, `${f}: article:published_time`);
    assert.equal(meta(h, 'article:modified_time'), art.dateModified, `${f}: article:modified_time`);
    assert.equal(meta(h, 'article:author'), AUTOR, `${f}: article:author`);
    assert.match(h, new RegExp(`<time datetime="${art.datePublished}">`), `${f}: data visível igual à do JSON-LD`);
    assert.match(h, /<a href="autor\.html" rel="author">Portfólio BR<\/a>/, `${f}: link visível para o autor`);
  }
});

test('índice do blog: BlogPosting com datas e autor iguais aos artigos', () => {
  const blog = nos(JSON.parse(blocosLd(ler('blog/index.html'))[0])).filter((n) => n['@type'] === 'BlogPosting');
  assert.equal(blog.length, ARTIGOS.length);
  for (const a of ARTIGOS) {
    const art = nos(JSON.parse(blocosLd(ler(`blog/${a}.html`))[0])).find((n) => n['@type'] === 'Article');
    const post = blog.find((p) => p.url === `${SITE}blog/${a}.html`);
    assert.ok(post, `blog/index.html lista ${a}`);
    assert.equal(post.headline, art.headline);
    assert.equal(post.datePublished, art.datePublished);
    assert.equal(post.dateModified, art.dateModified);
    assert.equal(post.author.url, AUTOR);
  }
});

test('página de autor: ProfilePage da organização, sem pessoa inventada', () => {
  const h = ler('blog/autor.html');
  const dados = JSON.parse(blocosLd(h)[0]);
  const perfil = nos(dados).find((n) => n['@type'] === 'ProfilePage');
  assert.ok(perfil);
  assert.equal(perfil.url, canonical(h));
  assert.equal(perfil.mainEntity['@type'], 'Organization');
  assert.equal(perfil.mainEntity['@id'], ORG_ID);
  assert.ok(!nos(dados).some((n) => n['@type'] === 'Person'), 'sem Person');
  for (const a of ARTIGOS) assert.match(h, new RegExp(`href="\\.\\./blog/${a}\\.html"`), `autor lista ${a}`);
});

test('feed RSS: bem formado, um item por artigo, datas iguais e linkado no <head> do blog', () => {
  const rss = ler('blog/feed.xml').replace(/<!--[\s\S]*?-->/g, '');
  assert.match(ler('blog/feed.xml'), /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(rss, /<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(rss, new RegExp(`<atom:link href="${SITE}blog/feed\\.xml" rel="self" type="application/rss\\+xml"/>`));
  // Equilíbrio simples de tags (sem dependência de parser XML)
  for (const tag of ['rss', 'channel', 'item', 'title', 'link', 'guid', 'pubDate', 'description']) {
    const abre = (rss.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
    const fecha = (rss.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    assert.equal(abre, fecha, `feed.xml: <${tag}> equilibrada`);
  }
  assert.doesNotMatch(rss, /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/, 'feed.xml: & escapado');
  const itens = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  assert.equal(itens.length, ARTIGOS.length, 'um item por artigo');
  const datas = [];
  for (const a of ARTIGOS) {
    const url = `${SITE}blog/${a}.html`;
    const item = itens.find((i) => i.includes(`<link>${url}</link>`));
    assert.ok(item, `feed.xml: item de ${a}`);
    assert.match(item, new RegExp(`<guid isPermaLink="true">${url}</guid>`));
    const art = nos(JSON.parse(blocosLd(ler(`blog/${a}.html`))[0])).find((n) => n['@type'] === 'Article');
    assert.equal((/<title>([^<]+)<\/title>/.exec(item) || [])[1], art.headline, `feed.xml: título de ${a}`);
    const pub = (/<pubDate>([^<]+)<\/pubDate>/.exec(item) || [])[1];
    assert.match(pub, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/, `feed.xml: pubDate RFC 822 (${pub})`);
    const d = new Date(pub);
    assert.ok(!Number.isNaN(d.getTime()), `feed.xml: pubDate válida (${pub})`);
    // Data local (-03:00) igual à de publicação do artigo, e dia da semana coerente
    const local = new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    assert.equal(local, art.datePublished, `feed.xml: pubDate de ${a}`);
    assert.equal(d.toUTCString().slice(0, 3), pub.slice(0, 3), `feed.xml: dia da semana de ${a}`);
    datas.push(d.getTime());
  }
  const ultima = new Date((/<lastBuildDate>([^<]+)<\/lastBuildDate>/.exec(rss) || [])[1]).getTime();
  assert.ok(ultima >= Math.max(...datas), 'lastBuildDate não anterior ao artigo mais novo');
  for (const f of ['blog/index.html', 'blog/autor.html', ...ARTIGOS.map((a) => `blog/${a}.html`)]) {
    assert.match(ler(f), /<link rel="alternate" type="application\/rss\+xml" title="[^"]+" href="\.\.\/blog\/feed\.xml">/, `${f}: feed no <head>`);
  }
  assert.ok(existsSync(new URL('blog/feed.xml', raiz)));
  assert.ok(ler('sitemap.xml').includes(`<loc>${AUTOR}</loc>`), 'autor no sitemap');
});

// SEO local sem inventar (melhoria 40): atendimento online para o Brasil, trilhas coerentes com a tela.
const SEGMENTOS = readdirSync(new URL('segmentos/', raiz)).filter((f) => f.endsWith('.html')).map((f) => 'segmentos/' + f);
const COM_TRILHA = ['exemplos.html', ...paginas.filter((f) => /^(blog|segmentos|exemplos)\//.test(f))];
const temaDe = (h) => nos(JSON.parse(blocosLd(h)[0])).find((n) => n.knowsAbout);
const decodifica = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

test('trilhas: BreadcrumbList em blog/segmentos/exemplos igual à <nav aria-label="Trilha"> visível', () => {
  for (const f of COM_TRILHA) {
    const h = ler(f);
    // Exemplos fictícios são noindex e sem canonical: a página atual é o próprio endereço
    const atual = canonical(h) || (SITE + f).replace(/index\.html$/, '');
    const nav = /<nav class="migalhas[^"]*" aria-label="Trilha"><ol role="list">([\s\S]*?)<\/ol><\/nav>/.exec(h);
    assert.ok(nav, `${f}: trilha visível`);
    const visivel = [...nav[1].matchAll(/<li(?: aria-current="page")?>(?:<a href="([^"]+)">)?([^<]+)(?:<\/a>)?<\/li>/g)]
      .map((m) => ({ nome: decodifica(m[2]), url: m[1] ? new URL(m[1], SITE + f).href.replace(/index\.html$/, '') : atual }));
    assert.ok(visivel.length >= 2, `${f}: trilha com pelo menos 2 níveis`);
    assert.match(nav[1], /<li aria-current="page">[^<]+<\/li><\/ol>$|<li aria-current="page">[^<]+<\/li>$/, `${f}: último nível é a página atual`);
    const listas = blocosLd(h).flatMap((b) => nos(JSON.parse(b))).filter((n) => n['@type'] === 'BreadcrumbList');
    assert.equal(listas.length, 1, `${f}: uma BreadcrumbList`);
    const ld = listas[0].itemListElement.map((it) => ({ nome: it.name, url: it.item }));
    assert.deepEqual(ld, visivel, `${f}: JSON-LD = trilha visível`);
    assert.equal(ld.at(-1).url, atual, `${f}: último item = página atual (canonical)`);
  }
});

test('segmentos: Service com área Brasil, canal online e provedor ligado à organização', () => {
  assert.equal(SEGMENTOS.length, 6);
  for (const f of SEGMENTOS) {
    const h = ler(f);
    const srv = nos(JSON.parse(blocosLd(h)[0])).find((n) => n['@type'] === 'Service');
    assert.ok(srv, `${f}: Service`);
    assert.equal(srv['@id'], canonical(h) + '#servico', `${f}: @id do serviço`);
    assert.equal(srv.url, canonical(h));
    assert.deepEqual(srv.areaServed, { '@type': 'Country', name: 'Brasil' }, `${f}: areaServed só Brasil`);
    assert.equal(srv.availableChannel['@type'], 'ServiceChannel', `${f}: canal`);
    assert.equal(srv.availableChannel.serviceUrl, SITE + 'planos.html', `${f}: canal leva aos planos`);
    assert.equal(srv.availableChannel.availableLanguage, 'pt-BR');
    assert.equal(srv.provider['@id'], ORG_ID, `${f}: provider = organização`);
    const trilha = nos(JSON.parse(blocosLd(h)[0])).find((n) => n['@type'] === 'BreadcrumbList').itemListElement.at(-1).name;
    assert.ok(srv.provider.knowsAbout.includes(trilha), `${f}: knowsAbout inclui o segmento da página`);
    assert.ok(ler('index.html').includes(`"${trilha}"`), `${f}: segmento listado no knowsAbout da home`);
  }
});

test('organização: knowsAbout igual na home e no autor, só com serviços que têm página', () => {
  const home = temaDe(ler('index.html'));
  const autor = temaDe(ler('blog/autor.html'));
  assert.equal(home['@id'], ORG_ID);
  assert.deepEqual(autor.knowsAbout, home.knowsAbout, 'mesma lista nos dois nós da organização');
  assert.deepEqual(home.areaServed, { '@type': 'Country', name: 'Brasil' });
  const segmentos = home.knowsAbout.filter((t) => /^Sites para (?!pequenos)/.test(t));
  assert.equal(segmentos.length, SEGMENTOS.length, 'um tema por página de segmento');
});

test('sem dados locais inventados: nenhuma cidade, endereço, geo, nota ou contato fixo no JSON-LD estático', () => {
  const proibidos = ['City', 'PostalAddress', 'GeoCoordinates', 'AggregateRating', 'Review', 'LocalBusiness'];
  const chaves = ['address', 'addressLocality', 'geo', 'aggregateRating', 'review', 'telephone', 'email', 'taxID', 'openingHours'];
  for (const f of paginas) {
    for (const bruto of blocosLd(ler(f))) {
      for (const n of nos(JSON.parse(bruto))) {
        assert.ok(!proibidos.includes(n['@type']), `${f}: @type ${n['@type']} não pode ser inventado`);
        for (const c of chaves) assert.ok(!(c in n), `${f}: ${c} só vem do config.js pelo main.js`);
        if (n.areaServed) assert.equal(n.areaServed.name, 'Brasil', `${f}: areaServed só Brasil`);
      }
    }
  }
});
