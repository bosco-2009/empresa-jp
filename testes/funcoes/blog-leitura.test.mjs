// Melhoria 57: leitura estimada travada e "Leia também" (artigos + segmento mais próximo) em cada artigo.
// Se um artigo mudar e este teste falhar, rode: node testes/blog/leitura.mjs --gravar
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { ARTIGOS, ler, medir, minutos } from '../blog/leitura.mjs';

const raiz = new URL('../../', import.meta.url);
const medidas = medir();

test('cálculo: 200 palavras por minuto, arredondado, mínimo 1', () => {
  assert.equal(minutos(0), 1);
  assert.equal(minutos(120), 1);
  assert.equal(minutos(299), 1);
  assert.equal(minutos(300), 2);
  assert.equal(minutos(482), 2);
  assert.equal(minutos(522), 3);
});

test('artigos: "leitura de N min" visível = wordCount/timeRequired do JSON-LD = palavras contadas', () => {
  for (const { slug, palavras, minutos: n } of medidas) {
    const h = ler(`blog/${slug}.html`);
    assert.ok(palavras > 100, `${slug}: corpo encontrado (${palavras} palavras)`);
    assert.match(h, new RegExp(`class="artigo__meta">[^\\n]*· leitura de ${n} min</p>`), `${slug}: meta visível com ${n} min`);
    assert.match(h, new RegExp(`"wordCount": ${palavras},`), `${slug}: wordCount ${palavras}`);
    assert.match(h, new RegExp(`"timeRequired": "PT${n}M"`), `${slug}: timeRequired PT${n}M`);
  }
});

test('blog/index.html: cada cartão mostra a mesma leitura do artigo', () => {
  const idx = ler('blog/index.html');
  for (const { slug, minutos: n } of medidas) {
    assert.match(idx, new RegExp(`data-leitura="${slug}">Leitura de ${n} min</p>`), `cartão de ${slug}`);
  }
});

test('Leia também: até 3 links fixos no HTML (outros artigos + 1 segmento existente), sem o próprio artigo', () => {
  for (const slug of ARTIGOS) {
    const h = ler(`blog/${slug}.html`);
    const nav = (/<nav class="artigo__mais"[\s\S]*?<\/nav>/.exec(h) || [])[0];
    assert.ok(nav, `${slug}: bloco Leia também`);
    const cartoes = [...nav.matchAll(/<li class="relacionado[^"]*">[\s\S]*?<\/li>/g)].map((m) => m[0]);
    assert.ok(cartoes.length >= 2 && cartoes.length <= 3, `${slug}: 2 a 3 relacionados (${cartoes.length})`);
    const links = cartoes.map((c) => (/<a href="\.\.\/([^"]+)">/.exec(c) || [])[1]);
    assert.ok(!links.includes(`blog/${slug}.html`), `${slug}: não aponta para si mesmo`);
    assert.equal(new Set(links).size, links.length, `${slug}: sem links repetidos`);
    for (const l of links) assert.ok(existsSync(new URL(l, raiz)), `${slug}: destino existe (${l})`);
    const segmentos = links.filter((l) => l.startsWith('segmentos/'));
    assert.equal(segmentos.length, 1, `${slug}: exatamente um link para página de segmento`);
    // a leitura mostrada no cartão de outro artigo é a mesma do artigo
    for (const m of nav.matchAll(/data-leitura-rel="([^"]+)">leitura de (\d+) min/g)) {
      const alvo = medidas.find((x) => x.slug === m[1]);
      assert.ok(alvo, `${slug}: relacionado ${m[1]} é um artigo`);
      assert.equal(Number(m[2]), alvo.minutos, `${slug}: leitura de ${m[1]}`);
    }
    // títulos de cartão em h3 dentro do h2 "Leia também" (hierarquia correta)
    assert.equal((nav.match(/<h3 class="relacionado__titulo">/g) || []).length, cartoes.length, `${slug}: h3 por cartão`);
  }
});
