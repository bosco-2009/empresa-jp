// Dados do config.js gravados em termos.html e privacidade.html (melhoria 125).
// Uso: node --test testes/funcoes/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGINAS, lerConfig, gravarHtml } from '../legal/gravar.mjs';

const ler = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const config = lerConfig();

test('o HTML gravado está igual ao config.js (rode testes/legal/gravar.mjs --gravar)', () => {
  for (const p of PAGINAS) assert.equal(ler(p), gravarHtml(ler(p), config), p + ' desatualizado');
});

test('a primeira tela (data da última atualização) já vem preenchida, sem marcação provisória', () => {
  for (const p of PAGINAS) {
    const linha = /<p class="pagina-topo__texto">Última atualização: (<span[^>]*>[^<]*<\/span>)<\/p>/.exec(ler(p));
    assert.ok(linha, p + ': linha da última atualização');
    if (config.legal.atualizadoEm) {
      assert.ok(linha[1].includes('>' + config.legal.atualizadoEm + '<'), p);
      assert.doesNotMatch(linha[1], /legal__provisorio/, p);
    }
  }
});

test('valor vazio vira [PROVISÓRIO: rótulo] com a classe; preenchido perde a classe', () => {
  const html = '<p><span class="legal__provisorio" data-cfg="legal.x" data-cfg-rotulo="dias">[PROVISÓRIO: dias]</span></p>';
  assert.equal(gravarHtml(html, { legal: { x: 12 } }), '<p><span data-cfg="legal.x" data-cfg-rotulo="dias">12</span></p>');
  assert.equal(gravarHtml(gravarHtml(html, { legal: { x: 12 } }), { legal: { x: '' } }), html, 'volta ao provisório se o valor for apagado');
  assert.equal(gravarHtml(html, { legal: { x: '<b>&' } }), '<p><span data-cfg="legal.x" data-cfg-rotulo="dias">&lt;b&gt;&amp;</span></p>', 'texto escapado');
});

test('e-mail e WhatsApp viram links iguais aos do legal.js, e voltam ao provisório quando vazios', () => {
  const html = '<span class="legal__provisorio" data-cfg-email>[PROVISÓRIO: e-mail]</span> <span class="legal__provisorio" data-cfg-whatsapp>[PROVISÓRIO: WhatsApp]</span>';
  const cheio = gravarHtml(html, { contato: { email: 'a@b.com.br', whatsapp: '5511999998888' } });
  assert.equal(cheio, '<span data-cfg-email><a href="mailto:a@b.com.br">a@b.com.br</a></span> <span data-cfg-whatsapp><a href="https://wa.me/5511999998888" target="_blank" rel="noopener">(11) 99999-8888</a></span>');
  assert.equal(gravarHtml(cheio, { contato: { email: '', whatsapp: '' } }), html);
});

test('a lista de planos continua montada pelo legal.js (fora da gravação)', () => {
  assert.match(ler('termos.html'), /<div class="legal__planos" data-cfg-planos><\/div>/);
});
