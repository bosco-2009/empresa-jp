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
