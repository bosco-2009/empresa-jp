// SEO: títulos e descrições sem repetição (melhoria 67).
// Uso: node --test testes/funcoes/metatags.test.mjs
// Descobre sozinho todas as páginas HTML publicadas (menos o painel /admin/), para uma página nova não escapar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const raiz = new URL('../../', import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');

// Pastas que não são páginas públicas do site
const FORA = /^(\.git|testes|supabase|admin|node_modules)(\/|$)/;
const PAGINAS = readdirSync(raiz, { recursive: true })
  .map((f) => String(f).split('\\').join('/'))
  .filter((f) => f.endsWith('.html') && !FORA.test(f))
  .sort();

// Limites usados pelos buscadores para não cortar o texto no resultado
const TITULO_MAX = 60;
const DESCRICAO_MIN = 70;
const DESCRICAO_MAX = 160;

const decodificar = (t) => t
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const titulo = (h) => { const m = /<title>([\s\S]*?)<\/title>/.exec(h); return m ? decodificar(m[1].trim()) : undefined; };
const meta = (h, nome) => {
  const m = new RegExp(`<meta (?:name|property)="${nome.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`).exec(h);
  return m ? decodificar(m[1]) : undefined;
};
// Comprimento em caracteres visíveis (o travessão e os acentos contam como um)
const tamanho = (t) => [...t].length;

const dados = PAGINAS.map((f) => {
  const h = ler(f);
  return {
    f,
    titulo: titulo(h),
    descricao: meta(h, 'description'),
    ogTitulo: meta(h, 'og:title'),
    ogDescricao: meta(h, 'og:description'),
    metas: [...h.matchAll(/<meta (?:name|property)="((?:og|twitter):[a-z:_]+)" content="([^"]*)"/g)],
  };
});

test('encontra as páginas públicas (e não o painel)', () => {
  assert.ok(PAGINAS.length >= 25, `poucas páginas encontradas: ${PAGINAS.length}`);
  for (const f of ['index.html', 'planos.html', 'blog/index.html', 'segmentos/moda.html', 'exemplos/moda.html', '404.html']) {
    assert.ok(PAGINAS.includes(f), `faltou ${f}`);
  }
  assert.ok(!PAGINAS.some((f) => f.startsWith('admin/')), 'o painel não entra');
});

test(`title presente, com até ${TITULO_MAX} caracteres e único`, () => {
  const vistos = new Map();
  for (const { f, titulo: t } of dados) {
    assert.ok(t, `${f}: sem <title>`);
    assert.ok(tamanho(t) <= TITULO_MAX, `${f}: title com ${tamanho(t)} caracteres (máx. ${TITULO_MAX}): "${t}"`);
    assert.ok(!vistos.has(t), `${f}: title repetido de ${vistos.get(t)}: "${t}"`);
    vistos.set(t, f);
  }
});

test(`meta description presente, com ${DESCRICAO_MIN}–${DESCRICAO_MAX} caracteres e única`, () => {
  const vistos = new Map();
  for (const { f, descricao: d } of dados) {
    assert.ok(d, `${f}: sem meta description`);
    const n = tamanho(d);
    assert.ok(n >= DESCRICAO_MIN && n <= DESCRICAO_MAX, `${f}: description com ${n} caracteres (${DESCRICAO_MIN}–${DESCRICAO_MAX}): "${d}"`);
    assert.ok(!vistos.has(d), `${f}: description repetida de ${vistos.get(d)}`);
    vistos.set(d, f);
  }
});

test('Open Graph coerente com o title e a description', () => {
  for (const { f, titulo: t, ogTitulo, ogDescricao } of dados) {
    // Os sites de exemplo (fictícios) não têm Open Graph; quem tem um precisa ter o par completo
    assert.equal(ogTitulo === undefined, ogDescricao === undefined, `${f}: og:title e og:description andam juntos`);
    if (ogTitulo === undefined) continue;
    assert.equal(ogTitulo, t, `${f}: og:title diferente do title`);
    const n = tamanho(ogDescricao);
    assert.ok(n >= DESCRICAO_MIN && n <= DESCRICAO_MAX, `${f}: og:description com ${n} caracteres`);
  }
});

test('nenhum [PROVISÓRIO] nem texto vazio nas metatags', () => {
  for (const { f, titulo: t, descricao: d, metas } of dados) {
    const textos = [['title', t], ['description', d], ...metas.map((m) => [m[1], decodificar(m[2])])];
    for (const [nome, valor] of textos) {
      assert.ok(valor && valor.trim(), `${f}: ${nome} vazio`);
      assert.doesNotMatch(valor, /PROVIS[OÓ]RIO/i, `${f}: ${nome} com [PROVISÓRIO]`);
      assert.doesNotMatch(valor, /undefined|null|\{\{|\$\{/, `${f}: ${nome} com marcador não preenchido`);
    }
  }
});
