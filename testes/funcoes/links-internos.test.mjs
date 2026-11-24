// Links internos sem erro (melhoria 71).
// Percorre todas as páginas HTML publicadas e confere, no HTML estático:
//   - cada href/src/srcset/poster/content local aponta para um arquivo que existe;
//   - cada âncora #id (na própria página ou em outra) existe como id/name no destino;
//   - abas do painel (href="#x" com data-aba-link="x") são rotas do JS e não precisam de id;
//   - endereços absolutos do próprio site (canonical, og:url, og:image, links /empresa-jp/ do 404) também existem.
// Ignora links externos (outro domínio, mailto:, tel:, data:, javascript:) e os montados pelo JS (não estão no HTML).
// Uso: node --test testes/funcoes/links-internos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { todasAsPaginas, lerConfig } from '../seo/gerar-sitemap.mjs';

const RAIZ = new URL('../../', import.meta.url);
const ler = (f) => readFileSync(new URL(f, RAIZ), 'utf8');
const SITE = lerConfig().site.url; // ex.: https://bosco-2009.github.io/empresa-jp/
const BASE_ABSOLUTA = new URL(SITE).pathname; // ex.: /empresa-jp/
const IGNORAR = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i; // qualquer esquema (http:, mailto:, data:...) ou //host

const paginas = todasAsPaginas();

// Tira comentários, <script> (inclusive JSON-LD) e <template>: só vale o HTML que o navegador mostra sem JS.
const limpar = (h) => h
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<script\b[\s\S]*?<\/script>/gi, '')
  .replace(/<template\b[\s\S]*?<\/template>/gi, '');

const decodificar = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const cacheIds = new Map();
function idsDe(arquivo) {
  if (!cacheIds.has(arquivo)) {
    const h = limpar(ler(arquivo));
    const ids = new Set([...h.matchAll(/\s(?:id|name)="([^"]+)"/g)].map((m) => decodificar(m[1])));
    cacheIds.set(arquivo, ids);
  }
  return cacheIds.get(arquivo);
}

// Endereços referenciados por uma página: [{ attr, valor }]
function referencias(html) {
  const h = limpar(html);
  const refs = [];
  for (const tag of h.matchAll(/<[a-z][^>]*>/gi)) {
    // Abas do painel: href="#pedidos" com data-aba-link="pedidos" é rota do JS (hashchange), não âncora de seção.
    const rota = (/\sdata-aba-link="([^"]+)"/.exec(tag[0]) || [])[1];
    for (const m of tag[0].matchAll(/\s(href|src|poster|action)="([^"]*)"/g)) {
      const valor = decodificar(m[2]);
      if (rota && m[1] === 'href' && valor === '#' + rota) continue;
      refs.push({ attr: m[1], valor });
    }
  }
  for (const m of h.matchAll(/\s(srcset)="([^"]*)"/g)) {
    for (const parte of decodificar(m[2]).split(',')) {
      const url = parte.trim().split(/\s+/)[0];
      if (url) refs.push({ attr: 'srcset', valor: url });
    }
  }
  // metatags com endereço (og:image, og:url, twitter:image)
  for (const m of h.matchAll(/<meta\b[^>]*\bproperty="(?:og:image|og:url)"[^>]*\bcontent="([^"]*)"/g)) refs.push({ attr: 'og', valor: decodificar(m[1]) });
  for (const m of h.matchAll(/<meta\b[^>]*\bname="twitter:image"[^>]*\bcontent="([^"]*)"/g)) refs.push({ attr: 'twitter', valor: decodificar(m[1]) });
  return refs;
}

// Converte um endereço em { arquivo, ancora } relativo à raiz do repositório, ou null se for externo.
export function resolver(pagina, valor) {
  let v = valor.trim();
  if (v === '') return { arquivo: pagina, ancora: '' };
  if (v.startsWith(SITE)) v = BASE_ABSOLUTA + v.slice(SITE.length);
  else if (IGNORAR.test(v)) return null;
  const u = new URL(v, 'http://local' + BASE_ABSOLUTA + pagina);
  if (u.host !== 'local') return null;
  let caminho = decodeURIComponent(u.pathname);
  if (!caminho.startsWith(BASE_ABSOLUTA)) return { arquivo: null, fora: caminho, ancora: '' };
  caminho = caminho.slice(BASE_ABSOLUTA.length);
  if (caminho === '' || caminho.endsWith('/')) caminho += 'index.html';
  return { arquivo: caminho, ancora: decodeURIComponent(u.hash.slice(1)) };
}

const existe = (arquivo) => {
  const u = new URL(arquivo, RAIZ);
  return existsSync(u) && statSync(u).isFile();
};

test('links internos: há páginas para conferir', () => {
  assert.ok(paginas.length >= 20, `páginas encontradas: ${paginas.length}`);
});

for (const pagina of paginas) {
  test(`links internos: ${pagina}`, () => {
    const erros = [];
    for (const { attr, valor } of referencias(ler(pagina))) {
      const r = resolver(pagina, valor);
      if (!r) continue;
      if (r.arquivo === null) { erros.push(`${attr}="${valor}" sai do site (${r.fora})`); continue; }
      if (!existe(r.arquivo)) { erros.push(`${attr}="${valor}" → arquivo inexistente: ${r.arquivo}`); continue; }
      if (r.ancora && r.arquivo.endsWith('.html') && !idsDe(r.arquivo).has(r.ancora)) {
        erros.push(`${attr}="${valor}" → âncora #${r.ancora} não existe em ${r.arquivo}`);
      }
    }
    assert.deepEqual(erros, [], `${pagina}:\n  ${erros.join('\n  ')}`);
  });
}

test('links internos: manifest aponta para arquivos que existem', () => {
  const m = JSON.parse(ler('manifest.webmanifest'));
  const erros = [];
  for (const icone of m.icons || []) {
    const r = resolver('manifest.webmanifest', icone.src);
    if (r && !existe(r.arquivo)) erros.push(icone.src);
  }
  if (m.start_url) {
    const r = resolver('manifest.webmanifest', m.start_url);
    if (r && !existe(r.arquivo)) erros.push(`start_url ${m.start_url}`);
  }
  assert.deepEqual(erros, [], 'manifest com arquivos inexistentes');
});

test('links internos: o resolvedor entende os formatos usados no site', () => {
  assert.deepEqual(resolver('blog/a.html', '../planos.html#p'), { arquivo: 'planos.html', ancora: 'p' });
  assert.deepEqual(resolver('index.html', '#faq'), { arquivo: 'index.html', ancora: 'faq' });
  assert.deepEqual(resolver('blog/a.html', './'), { arquivo: 'blog/index.html', ancora: '' });
  assert.deepEqual(resolver('404.html', BASE_ABSOLUTA + 'assets/x.css'), { arquivo: 'assets/x.css', ancora: '' });
  assert.deepEqual(resolver('index.html', SITE + 'planos.html'), { arquivo: 'planos.html', ancora: '' });
  assert.equal(resolver('index.html', 'https://instagram.com/x'), null);
  assert.equal(resolver('index.html', 'mailto:a@b.c'), null);
  assert.equal(resolver('index.html', 'data:image/png;base64,AA'), null);
});
