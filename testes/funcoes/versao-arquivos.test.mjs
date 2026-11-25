// Melhoria 69: CSS, JS e fontes referenciados com ?v=<hash do conteúdo>, para o visitante nunca ficar com arquivo velho
// depois de uma publicação (o GitHub Pages não deixa configurar cabeçalhos de cache).
// Falhou? Rode: node testes/cache/versionar.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, dirname } from 'node:path';
import { versionar, paginasHtml, hashDe, RAIZ } from '../cache/versionar.mjs';

test('nenhuma referência a CSS/JS/fonte desatualizada ou sem ?v= (rode node testes/cache/versionar.mjs)', () => {
  const { problemas } = versionar({ gravar: false });
  assert.deepEqual(problemas, []);
});

test('todas as páginas versionam CSS, JS e a fonte; links externos e de página ficam como estão', () => {
  const paginas = paginasHtml();
  assert.ok(paginas.length >= 25, `páginas encontradas: ${paginas.length}`);
  for (const f of paginas) {
    const h = readFileSync(f, 'utf8');
    const nome = relative(RAIZ, f);
    const locais = [...h.matchAll(/\s(?:href|src)="([^"]+\.(?:css|js|woff2)(?:\?[^"]*)?)"/g)]
      .map((m) => m[1]).filter((u) => !/^(?:https?:)?\/\//.test(u));
    assert.ok(locais.length > 0, `${nome}: tem CSS/JS locais`);
    for (const u of locais) assert.match(u, /\?v=[0-9a-f]{8}$/, `${nome}: ${u}`);
    assert.doesNotMatch(h, /\.html\?v=|https:\/\/[^"]+\?v=[0-9a-f]{8}"/, `${nome}: só arquivos locais levam ?v=`);
  }
});

test('a fonte pré-carregada é o mesmo endereço do @font-face (sem baixar duas vezes)', () => {
  const css = readFileSync(join(RAIZ, 'assets/css/tokens.css'), 'utf8');
  const urls = [...css.matchAll(/url\('([^']+\.woff2[^']*)'\)/g)].map((m) => resolve(join(RAIZ, 'assets/css'), m[1]));
  assert.ok(urls.length > 0 && urls.every((u) => u === urls[0]), 'tokens.css cita uma única fonte');
  const absolutoCss = '/' + relative(RAIZ, urls[0].split('?')[0]) + '?' + urls[0].split('?')[1];
  for (const f of paginasHtml()) {
    const h = readFileSync(f, 'utf8');
    const pre = (/rel="preload" href="([^"]+\.woff2[^"]*)"/.exec(h) || [])[1];
    if (!pre) continue;
    const absoluto = pre.startsWith('/empresa-jp/')
      ? pre.slice('/empresa-jp'.length)
      : '/' + relative(RAIZ, resolve(dirname(f), pre.split('?')[0])) + '?' + pre.split('?')[1];
    assert.equal(absoluto, absolutoCss, `${relative(RAIZ, f)}: preload = @font-face`);
  }
});

test('o hash muda quando o conteúdo muda (e só então)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'versao-'));
  try {
    const a = join(dir, 'a.css');
    const b = join(dir, 'b.css');
    writeFileSync(a, 'body{color:red}');
    writeFileSync(b, 'body{color:red}');
    assert.equal(hashDe(a), hashDe(b), 'mesmo conteúdo, mesma versão');
    const c = join(dir, 'c.css');
    writeFileSync(c, 'body{color:blue}');
    assert.notEqual(hashDe(a), hashDe(c), 'conteúdo novo, versão nova');
    assert.match(hashDe(a), /^[0-9a-f]{8}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Melhoria 130: TODA referência local das páginas (href, src, srcset) ou é código versionado (CSS/JS/fonte com ?v=),
// ou cai numa exceção com motivo. Arquivo de tipo novo (ex.: .json, .mjs, .mp4) citado sem ?v= faz este teste falhar:
// decida de propósito (versionar no testes/cache/versionar.mjs ou acrescentar aqui a exceção, com o motivo, e
// documentar no PUBLICAR.md §9). O GitHub Pages manda "Cache-Control: max-age=600" para tudo.
const EXCECOES_SEM_VERSAO = {
  html: 'página: o endereço é o que o visitante e o Google conhecem; vale o cache de 10 min do GitHub Pages',
  '': 'pasta (blog/, ../) = página index.html',
  png: 'imagem: troca rara; o navegador revalida pelo ETag depois de 10 min',
  webp: 'imagem (ver png)',
  svg: 'imagem e favicon (ver png)',
  ico: 'favicon pedido pelo navegador sem a página (endereço fixo)',
  webmanifest: 'manifest: lido pelo navegador ao instalar; endereço fixo',
  xml: 'feed RSS: o leitor de RSS assina o endereço exato',
};
const VERSIONADOS = /^(?:css|js|woff2)$/;

function referenciasLocais(html) {
  const refs = [];
  for (const m of html.matchAll(/\s(href|src|srcset)="([^"]*)"/g)) {
    const valores = m[1] === 'srcset' ? m[2].split(',').map((s) => s.trim().split(/\s+/)[0]) : [m[2]];
    for (const u of valores) {
      if (!u || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(u)) continue; // externo, data:, mailto:, âncora
      refs.push(u);
    }
  }
  return refs;
}
const extensao = (u) => ((/\.([a-z0-9]+)$/i.exec(u.split(/[?#]/)[0]) || [])[1] || '').toLowerCase();

test('toda referência local sem ?v= é uma exceção conhecida; CSS/JS/fonte sempre com ?v= (melhoria 130)', () => {
  const problemas = [];
  let total = 0;
  for (const f of paginasHtml()) {
    const nome = relative(RAIZ, f);
    for (const u of referenciasLocais(readFileSync(f, 'utf8'))) {
      total++;
      const ext = extensao(u);
      const temVersao = /\?v=[0-9a-f]{8}(?:#|$)/.test(u);
      if (VERSIONADOS.test(ext)) { if (!temVersao) problemas.push(`${nome}: ${u} sem ?v=`); continue; }
      if (!(ext in EXCECOES_SEM_VERSAO)) problemas.push(`${nome}: ${u} (.${ext || '?'}) não é versionado nem exceção conhecida`);
      else if (temVersao) problemas.push(`${nome}: ${u} é exceção e não deveria levar ?v=`);
    }
  }
  assert.ok(total > 1000, `referências locais encontradas: ${total}`);
  assert.deepEqual(problemas, []);
});

test('o detector de referências locais pega o que deve e ignora externos (melhoria 130)', () => {
  const html = '<link href="a.css?v=0123abcd"><script src="b.mjs"></script><img src="x.png" srcset="y.webp 1x, z.webp 2x">'
    + '<a href="https://ex.com/a.js"></a><a href="#topo"></a><a href="mailto:a@b"></a><img src="data:image/png;base64,AA">'
    + '<a href="blog/"></a><a href="?plano=x"></a>';
  assert.deepEqual(referenciasLocais(html), ['a.css?v=0123abcd', 'b.mjs', 'x.png', 'y.webp', 'z.webp', 'blog/']);
  assert.equal(extensao('b.mjs'), 'mjs');
  assert.ok(!('mjs' in EXCECOES_SEM_VERSAO) && !VERSIONADOS.test('mjs'), '.mjs sem ?v= seria acusado');
  assert.equal(extensao('blog/'), '');
});

test('os scripts do site não carregam CSS/JS/JSON locais por conta própria (fugiriam do ?v=) (melhoria 130)', () => {
  const dir = join(RAIZ, 'assets/js');
  const arquivos = [...readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => join(dir, f)), join(RAIZ, 'config.js')];
  const achados = [];
  for (const f of arquivos) {
    const codigo = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of codigo.matchAll(/(['"`])([^'"`\s]+\.(?:css|js|mjs|json))(?:\?[^'"`]*)?\1/g)) {
      if (/^https:\/\//.test(m[2])) continue; // CDN com versão exata (supabase-js)
      if (codigo[m.index - 1] === '=') continue; // seletor [src*="..."]: procura o script, não carrega nada
      achados.push(`${relative(RAIZ, f)}: ${m[2]}`);
    }
  }
  assert.deepEqual(achados, []);
});
