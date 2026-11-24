// Datas das páginas de segmento (melhoria 117): dateModified e "atualizado em" pela última mudança de TEXTO no git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGINAS, textoDoSegmento, datasGravadas, aplicar, calcular } from '../segmentos/data-modificacao.mjs';

const RAIZ = new URL('../../', import.meta.url);
const ler = (f) => readFileSync(new URL(f, RAIZ), 'utf8');
const SITE = 'https://bosco-2009.github.io/empresa-jp/';
const dataIso = /^\d{4}-\d{2}-\d{2}$/;
const grafo = (h) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h)[1])['@graph'];

test('segmentos: nó WebPage com datas ISO, ligado ao Service, e linha visível coerente', () => {
  assert.equal(PAGINAS.length, 6);
  for (const f of PAGINAS) {
    const h = ler(f);
    const url = SITE + f;
    const pagina = grafo(h).find((n) => n['@type'] === 'WebPage');
    assert.ok(pagina, `${f}: nó WebPage no JSON-LD`);
    assert.equal(pagina['@id'], url);
    assert.equal(pagina.url, url);
    assert.equal(pagina.inLanguage, 'pt-BR');
    assert.equal(pagina.mainEntity['@id'], url + '#servico', `${f}: mainEntity aponta o Service`);
    assert.ok(grafo(h).some((n) => n['@id'] === url + '#servico'), `${f}: Service existe`);
    assert.match(pagina.datePublished, dataIso);
    assert.match(pagina.dateModified, dataIso);
    assert.ok(pagina.dateModified >= pagina.datePublished, `${f}: dateModified não anterior à publicação`);
    const linha = /<p class="artigo__meta seg__meta">Publicado em <time datetime="([^"]+)">[^<]+<\/time>(?:<span class="artigo__atualizado"> · atualizado em <time datetime="([^"]+)">[^<]+<\/time><\/span>)?<\/p>/.exec(h);
    assert.ok(linha, `${f}: linha "Publicado em" visível no topo`);
    assert.equal(linha[1], pagina.datePublished, `${f}: data visível = datePublished`);
    assert.equal(linha[2] ?? pagina.datePublished, pagina.dateModified, `${f}: "atualizado em" = dateModified (some quando igual)`);
    assert.equal(h.split('seg__meta').length - 1, 1, `${f}: uma linha de datas só`);
  }
});

test('segmentos: só o texto lido conta (sem tags, sem "Plano indicado", sem a própria linha de datas)', () => {
  const h = ler('segmentos/moda.html');
  const base = textoDoSegmento(h);
  assert.ok(base && base.length > 500, 'texto do <main> extraído');
  assert.doesNotMatch(base, /</, 'sem tags');
  assert.doesNotMatch(base, /Publicado em/, 'sem a linha de datas');
  // atributos/classes, bloco do plano indicado e a própria data não mudam o texto
  assert.equal(textoDoSegmento(h.replace('class="seg-lista"', 'class="seg-lista outra"')), base);
  assert.equal(textoDoSegmento(h.replace('<!-- indicado:fim -->', '<p>Plano X por R$ 1</p><!-- indicado:fim -->')), base);
  assert.equal(textoDoSegmento(aplicar(h, '2026-11-20', '2027-03-15')), base);
  // texto de verdade muda
  assert.notEqual(textoDoSegmento(h.replace('Dica antes de começar:', 'Dica:')), base);
  assert.equal(textoDoSegmento('<html><body>sem main</body></html>'), null);
});

test('segmentos: aplicar grava JSON-LD e "atualizado em", é idempotente e volta ao original', () => {
  const original = ler('segmentos/pet.html');
  const { publicado, modificado } = datasGravadas(original);
  assert.equal(modificado >= publicado, true);
  const base = aplicar(original, publicado, publicado);
  const novo = aplicar(base, publicado, '2027-03-15');
  assert.match(novo, /"dateModified": "2027-03-15"/);
  assert.match(novo, /seg__meta">Publicado em <time datetime="[^"]+">[^<]+<\/time><span class="artigo__atualizado"> · atualizado em <time datetime="2027-03-15">15 de março de 2027<\/time><\/span><\/p>/);
  assert.equal(aplicar(novo, publicado, '2027-03-15'), novo, 'aplicar duas vezes não duplica');
  assert.equal(aplicar(novo, publicado, publicado), base, 'voltar à publicação remove a linha');
  assert.equal(novo.split('2027-03-15').length - 1, 2, 'só o JSON-LD e a linha visível mudam');
});

test('segmentos: páginas em dia com o git (node testes/segmentos/data-modificacao.mjs --gravar)', () => {
  for (const { f, publicado, data } of calcular()) {
    const h = ler(f);
    assert.equal(datasGravadas(h).publicado, publicado);
    assert.equal(datasGravadas(h).modificado, data, `${f}: dateModified desatualizado`);
  }
});
