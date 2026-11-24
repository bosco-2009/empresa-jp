// SEO: idioma coerente em todas as páginas (melhoria 85).
// Uso: node --test testes/funcoes/idioma.test.mjs
// Descobre sozinho as páginas HTML publicadas (menos o painel /admin/) e confere, em cada uma:
//   - <html lang="pt-BR">;
//   - og:locale = pt_BR (quando a página tem Open Graph);
//   - todo "inLanguage" do JSON-LD = pt-BR (inclusive os montados pelo main.js);
//   - quem tem canonical tem também <link rel="alternate" hreflang="pt-BR"> e hreflang="x-default",
//     os dois apontando para o próprio canonical; quem não tem canonical (404, exemplos) não tem hreflang.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const raiz = new URL('../../', import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');

const FORA = /^(\.git|testes|supabase|admin|node_modules)(\/|$)/;
const PAGINAS = readdirSync(raiz, { recursive: true })
  .map((f) => String(f).split('\\').join('/'))
  .filter((f) => f.endsWith('.html') && !FORA.test(f))
  .sort();

const IDIOMA = 'pt-BR';
const LOCALE = 'pt_BR';

test('encontra as páginas públicas', () => {
  assert.ok(PAGINAS.length >= 25, `poucas páginas: ${PAGINAS.length}`);
  for (const f of ['index.html', '404.html', 'blog/index.html', 'segmentos/moda.html', 'exemplos/moda.html']) {
    assert.ok(PAGINAS.includes(f), `faltou ${f}`);
  }
});

test(`<html lang="${IDIOMA}"> em todas as páginas`, () => {
  for (const f of PAGINAS) {
    const m = /<html\b[^>]*\blang="([^"]*)"/.exec(ler(f));
    assert.ok(m, `${f}: <html> sem lang`);
    assert.equal(m[1], IDIOMA, `${f}: lang`);
  }
});

test(`og:locale = ${LOCALE} sempre que houver Open Graph`, () => {
  for (const f of PAGINAS) {
    const h = ler(f);
    const locales = [...h.matchAll(/<meta property="og:locale(?::alternate)?" content="([^"]*)"/g)].map((m) => m[1]);
    if (/property="og:/.test(h)) assert.deepEqual(locales, [LOCALE], `${f}: og:locale`);
    else assert.equal(locales.length, 0, `${f}: og:locale sem Open Graph`);
  }
});

test(`inLanguage do JSON-LD = ${IDIOMA} (páginas e main.js)`, () => {
  const fontes = [...PAGINAS, 'assets/js/main.js'];
  let total = 0;
  for (const f of fontes) {
    for (const m of ler(f).matchAll(/["']?inLanguage["']?\s*:\s*["']([^"']*)["']/g)) {
      total++;
      assert.equal(m[1], IDIOMA, `${f}: inLanguage "${m[1]}"`);
    }
  }
  assert.ok(total >= 10, `poucos inLanguage encontrados (${total}): o teste perdeu o formato?`);
});

test('hreflang pt-BR e x-default apontam para o próprio canonical', () => {
  let comCanonical = 0;
  for (const f of PAGINAS) {
    const h = ler(f);
    const canonical = (/<link rel="canonical" href="([^"]+)">/.exec(h) || [])[1];
    const alternos = [...h.matchAll(/<link\b[^>]*\bhreflang="([^"]*)"[^>]*>/g)].map((m) => ({
      tag: m[0],
      hreflang: m[1],
      href: (/\bhref="([^"]*)"/.exec(m[0]) || [])[1],
    }));
    if (!canonical) {
      assert.equal(alternos.length, 0, `${f}: hreflang sem canonical`);
      continue;
    }
    comCanonical++;
    assert.deepEqual(alternos.map((a) => a.hreflang).sort(), [IDIOMA, 'x-default'], `${f}: hreflang esperados`);
    for (const a of alternos) {
      assert.match(a.tag, /^<link rel="alternate" /, `${f}: ${a.tag}`);
      assert.equal(a.href, canonical, `${f}: hreflang="${a.hreflang}" difere do canonical`);
    }
  }
  assert.ok(comCanonical >= 20, `poucas páginas com canonical: ${comCanonical}`);
});
