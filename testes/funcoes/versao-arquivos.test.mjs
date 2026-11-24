// Melhoria 69: CSS, JS e fontes referenciados com ?v=<hash do conteúdo>, para o visitante nunca ficar com arquivo velho
// depois de uma publicação (o GitHub Pages não deixa configurar cabeçalhos de cache).
// Falhou? Rode: node testes/cache/versionar.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
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
