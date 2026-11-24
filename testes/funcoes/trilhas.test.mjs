// Trilhas em JSON-LD (melhoria 91): BreadcrumbList em todas as páginas internas, formato do schema.org,
// posições em ordem e cada nível apontando para uma página que existe no sitemap.
// (A igualdade com a <nav aria-label="Trilha"> visível fica em paginas.test.mjs e blog-seo.test.mjs.)
// Uso: node --test testes/funcoes/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const raiz = new URL('../../', import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');
const janela = {};
vm.runInNewContext(ler('config.js'), { window: janela });
const config = janela.PBR_CONFIG;
const SITE = config.site.url;

const paginas = ['', 'blog/', 'segmentos/', 'exemplos/', 'admin/']
  .flatMap((d) => readdirSync(new URL(d || '.', raiz)).filter((f) => f.endsWith('.html')).map((f) => d + f));
const sitemap = new Set([...ler('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
const urlDe = (f) => SITE + f.replace(/(^|\/)index\.html$/, '$1');

function trilhaDe(f) {
  const listas = [...ler(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]))
    .flatMap((d) => d['@graph'] || [d])
    .filter((n) => n['@type'] === 'BreadcrumbList');
  assert.ok(listas.length <= 1, `${f}: no máximo uma BreadcrumbList`);
  return listas[0];
}

// Páginas internas que precisam da trilha (item 91 da fila)
const OBRIGATORIAS = [
  'blog/index.html', 'planos.html', 'exemplos.html', 'portfolio.html', 'termos.html', 'privacidade.html',
  ...paginas.filter((f) => /^(blog|segmentos|exemplos)\/.+\.html$/.test(f)),
];
// Fora do sitemap de propósito: sites de exemplo (noindex) e o portfólio enquanto não há projetos reais
const foraDoSitemap = (f) => f.startsWith('exemplos/') || (f === 'portfolio.html' && !(config.portfolio?.projetos || []).length);

test('trilhas: toda página interna tem BreadcrumbList; home, admin e páginas de fluxo não', () => {
  for (const f of OBRIGATORIAS) assert.ok(trilhaDe(f), `${f}: falta a BreadcrumbList`);
  for (const f of ['index.html', 'admin/index.html', '404.html', 'obrigado.html', 'pedido.html', 'briefing.html']) {
    assert.equal(trilhaDe(f), undefined, `${f}: não deveria ter trilha`);
  }
});

test('trilhas: formato schema.org, posições 1..n em ordem e URLs do site', () => {
  for (const f of paginas) {
    const lista = trilhaDe(f);
    if (!lista) continue;
    assert.equal(lista['@context'] ?? 'https://schema.org', 'https://schema.org', `${f}: @context`);
    const el = lista.itemListElement;
    assert.ok(Array.isArray(el) && el.length >= 2, `${f}: ao menos 2 níveis`);
    const vistos = new Set();
    el.forEach((it, i) => {
      assert.equal(it['@type'], 'ListItem', `${f}: nível ${i + 1} é ListItem`);
      assert.equal(it.position, i + 1, `${f}: posição ${i + 1} (inteiro, em ordem)`);
      assert.equal(typeof it.name, 'string', `${f}: nome do nível ${i + 1}`);
      assert.ok(it.name.trim() && it.name === it.name.trim(), `${f}: nome do nível ${i + 1} sem espaços sobrando`);
      assert.doesNotMatch(it.name, /PROVIS/i, `${f}: nome provisório na trilha`);
      assert.equal(typeof it.item, 'string', `${f}: item do nível ${i + 1} é URL (texto)`);
      assert.ok(it.item.startsWith(SITE), `${f}: item fora do site (${it.item})`);
      assert.doesNotMatch(it.item, /index\.html$|[?#]|\.\.\//, `${f}: item com index.html, parâmetro ou caminho relativo (${it.item})`);
      assert.ok(!vistos.has(it.item), `${f}: item repetido (${it.item})`);
      vistos.add(it.item);
    });
    assert.equal(el[0].item, SITE, `${f}: a trilha começa na home`);
    assert.equal(el.at(-1).item, urlDe(f), `${f}: a trilha termina na própria página`);
  }
});

test('trilhas: cada nível existe no sitemap (exceto a própria página quando ela fica fora dele de propósito)', () => {
  for (const f of paginas) {
    const lista = trilhaDe(f);
    if (!lista) continue;
    lista.itemListElement.forEach((it, i, el) => {
      const propria = i === el.length - 1;
      if (propria && foraDoSitemap(f)) {
        assert.ok(!sitemap.has(it.item), `${f}: página fora do sitemap de propósito, mas listada`);
        return;
      }
      assert.ok(sitemap.has(it.item), `${f}: nível ${i + 1} (${it.item}) não está no sitemap`);
    });
  }
});
