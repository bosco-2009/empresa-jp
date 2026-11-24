// Bloco "Plano indicado" no fim dos artigos e das páginas de segmento (melhoria 65).
// Uso: node --test testes/funcoes/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { paginas, paginasExemplo, lerConfig, ler } from '../conteudo/indicado.mjs';

const config = lerConfig();

test('toda regra de planoIndicado aponta para um plano que existe', () => {
  const ids = config.planos.map((p) => p.id);
  for (const [chave, id] of Object.entries(config.planoIndicado)) assert.ok(ids.includes(id), `${chave} → ${id}`);
});

test('todo artigo do blog e toda página de segmento tem uma regra', () => {
  const blog = readdirSync(new URL('../../blog/', import.meta.url)).filter((f) => f.endsWith('.html') && !['index.html', 'autor.html'].includes(f));
  const segs = readdirSync(new URL('../../segmentos/', import.meta.url)).filter((f) => f.endsWith('.html'));
  for (const f of blog) assert.ok(config.planoIndicado['blog:' + f.replace('.html', '')], 'falta regra para blog/' + f);
  for (const f of segs) assert.ok(config.planoIndicado['segmento:' + f.replace('.html', '')], 'falta regra para segmentos/' + f);
});

test('o HTML gravado está igual à regra do config.js (rode testes/conteudo/indicado.mjs --gravar)', () => {
  for (const p of paginas()) assert.equal(p.atual, p.esperado, p.arquivo + ' desatualizado');
});

test('o bloco funciona sem JS e não inventa números', () => {
  for (const p of paginas()) {
    const b = p.atual.slice(p.atual.indexOf('<!-- indicado:inicio -->'), p.atual.indexOf('<!-- indicado:fim -->'));
    assert.match(b, /href="\.\.\/planos\.html\?plano=[a-z]+"/, p.arquivo);
    assert.match(b, /data-origem-cta="(blog|segmento)\/[a-z-]+"/, p.arquivo);
    assert.doesNotMatch(b, /R\$|%|\[PROVIS/, p.arquivo + ': sem preço, porcentagem ou marcação provisória no bloco');
    assert.equal((p.atual.match(/id="indicado-titulo"/g) || []).length, 1, p.arquivo + ': id único');
  }
  assert.ok(ler('blog/site-ou-instagram.html').includes('<h2 id="indicado-titulo"'));
  assert.ok(ler('segmentos/moda.html').includes('<h3 id="indicado-titulo"'));
});

// Melhoria 95: faixa final "Gostou deste exemplo?" nas páginas de exemplo, com a regra do segmento.
test('toda página de exemplo tem a faixa final igual à regra do segmento (rode testes/conteudo/indicado.mjs --gravar)', () => {
  const exs = paginasExemplo();
  assert.equal(exs.length, 6, 'seis páginas de exemplo');
  for (const p of exs) {
    assert.ok(config.planoIndicado[p.chave], 'falta regra ' + p.chave + ' para ' + p.arquivo);
    assert.equal(p.atual, p.esperado, p.arquivo + ' desatualizado');
  }
});

test('a faixa final é fixa no HTML, aponta para o plano indicado e mantém o exemplo fora do índice', () => {
  for (const p of paginasExemplo()) {
    const b = p.atual.slice(p.atual.indexOf('<!-- exemplo-chamada:inicio -->'), p.atual.indexOf('<!-- exemplo-chamada:fim -->'));
    const id = config.planoIndicado[p.chave];
    assert.ok(b.includes(`href="../planos.html?plano=${id}" data-origem-cta="exemplo/${p.slug}"`), p.arquivo + ': link do plano com data-origem-cta');
    assert.ok(b.includes(`href="../index.html?segmento=${p.slug}#simulador"`), p.arquivo + ': link do simulador com o segmento');
    assert.match(b, /Gostou deste exemplo\? Um site assim para o seu negócio/, p.arquivo);
    assert.match(b, /site de exemplo/i, p.arquivo + ': deixa claro que era um exemplo');
    assert.doesNotMatch(b, /R\$|%|\[PROVIS|<script/, p.arquivo + ': sem preço, porcentagem, provisório ou script');
    // depois do </main> e antes do rodapé; o resto da página continua como era
    assert.ok(p.atual.indexOf('</main>') < p.atual.indexOf('<!-- exemplo-chamada:inicio -->'), p.arquivo + ': depois do conteúdo');
    assert.ok(p.atual.indexOf('<!-- exemplo-chamada:fim -->') < p.atual.indexOf('<footer class="ex-rodape">'), p.arquivo + ': antes do rodapé');
    assert.match(p.atual, /<meta name="robots" content="noindex, follow">/, p.arquivo + ': continua noindex');
    assert.equal((p.atual.match(/id="exemplo-chamada-titulo"/g) || []).length, 1, p.arquivo + ': id único');
  }
});
