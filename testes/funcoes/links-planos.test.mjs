// Melhoria 110: todo caminho para a contratação leva o plano marcado (?plano=) e a origem (data-origem-cta).
// Lista cada link para planos.html no HTML publicado e cada montagem de "?plano=" nos scripts do site;
// falha se um atalho de plano ficar sem plano, com plano inexistente ou sem origem, ou se surgir um script novo
// montando link de plano sem estar registrado aqui (com o motivo).
// Uso: node --test testes/funcoes/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerConfig } from '../conteudo/indicado.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const config = lerConfig();
const IDS = config.planos.map((p) => p.id);
const ler = (f) => readFileSync(join(RAIZ, f), 'utf8');

// A regra de origem aceita pelo origem.js é a mesma que o painel (admin-resumo.js) sabe ler.
const fonteOrigem = ler('assets/js/origem.js');
const tiposOrigem = /\/\^\(([a-z|]+)\)\\\/\[a-z0-9-\]\+\$\//.exec(fonteOrigem);
const ORIGEM = new RegExp('^(' + (tiposOrigem ? tiposOrigem[1] : 'x') + ')/[a-z0-9-]+$');

function paginas(dir = '') {
  const fora = new Set(['.git', 'testes', 'supabase', 'node_modules']);
  return readdirSync(join(RAIZ, dir)).flatMap((n) => {
    const r = join(dir, n);
    if (fora.has(n)) return [];
    if (statSync(join(RAIZ, r)).isDirectory()) return paginas(r);
    return n.endsWith('.html') ? [r] : [];
  });
}
const attr = (tag, nome) => { const m = new RegExp('\\s' + nome + '(?:="([^"]*)")?(?=[\\s>/])').exec(tag); return m ? (m[1] ?? '') : null; };
const ancoras = (html) => [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
  .map((m) => ({ tag: '<a' + m[1] + '>', texto: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));

test('o origem.js e o painel aceitam os mesmos tipos de origem', () => {
  assert.ok(tiposOrigem, 'regra de data-origem-cta encontrada no origem.js');
  for (const t of ['blog', 'segmento', 'exemplo', 'home', 'erro']) assert.ok(tiposOrigem[1].split('|').includes(t), 'tipo ' + t);
  assert.ok(ler('assets/js/admin-resumo.js').includes('(?:' + tiposOrigem[1] + ')\\/[a-z0-9-]+)$/'), 'admin-resumo.js lê os mesmos tipos');
});

test('todo link para planos.html com ?plano= tem plano existente e data-origem-cta válida', () => {
  let total = 0;
  for (const arquivo of paginas()) {
    for (const a of ancoras(ler(arquivo))) {
      const href = attr(a.tag, 'href') || '';
      const m = /planos\.html\?(?:[^"#]*&)?plano=([^&#"]*)/.exec(href);
      if (!m) continue;
      total++;
      const onde = `${arquivo}: "${a.texto}" (${href})`;
      assert.ok(IDS.includes(m[1]), onde + ': plano inexistente');
      const origem = attr(a.tag, 'data-origem-cta');
      assert.ok(origem && ORIGEM.test(origem), onde + ': falta data-origem-cta válida');
      const [tipo, nome] = origem.split('/');
      if (['blog', 'segmento', 'exemplo'].includes(tipo)) {
        const pasta = { blog: 'blog', segmento: 'segmentos', exemplo: 'exemplos' }[tipo];
        assert.equal(relative(pasta, arquivo), nome + '.html', onde + ': a origem precisa ser a própria página');
      }
    }
  }
  assert.ok(total >= 15, 'blog, segmentos e exemplos têm links de plano no HTML (' + total + ')');
});

test('todo atalho de contratação no HTML leva o plano (ou é preenchido pelo JS com origem)', () => {
  for (const arquivo of paginas()) {
    for (const a of ancoras(ler(arquivo))) {
      const href = attr(a.tag, 'href') || '';
      if (!/planos\.html/.test(href) || !/^(Contratar|Quero o plano|Ver o plano|Escolher o)/i.test(a.texto)) continue;
      const onde = `${arquivo}: "${a.texto}"`;
      if (attr(a.tag, 'data-sim-cta') !== null) {
        assert.equal(attr(a.tag, 'data-origem-cta'), 'home/simulador', onde + ': resultado do simulador sem origem');
        continue;
      }
      assert.match(href, /\?(?:[^"#]*&)?plano=/, onde + ': atalho de plano sem ?plano=');
    }
  }
});

test('listas de planos montadas pelo JS declaram a origem no HTML', () => {
  const casos = [['index.html', 'data-lista-planos', 'home/planos'], ['404.html', 'data-planos-404=', 'erro/404']];
  for (const [arquivo, gancho, origem] of casos) {
    const tag = (ler(arquivo).match(new RegExp('<[a-z]+\\b[^>]*' + gancho + '[^>]*>')) || [''])[0];
    assert.ok(tag, arquivo + ': ' + gancho);
    assert.equal(attr(tag, 'data-origem-planos'), origem, arquivo + ': data-origem-planos');
    assert.ok(ORIGEM.test(origem));
  }
  const main = ler('assets/js/main.js');
  assert.match(main, /botao\.href = 'planos\.html\?plano=' \+ encodeURIComponent\(plano\.id\);\s*\/\/[^\n]*\n\s*var origemPlanos = listaPlanos\.getAttribute\('data-origem-planos'\);\s*if \(origemPlanos\) botao\.setAttribute\('data-origem-cta', origemPlanos\);/, 'cartões da home ganham data-origem-cta');
  assert.match(main, /link\.href = base404 \+ '\?plano=' \+ encodeURIComponent\(plano\.id\);\s*var origem404 = planos404\.getAttribute\('data-origem-planos'\);[^\n]*\n\s*if \(origem404\) link\.setAttribute\('data-origem-cta', origem404\);/, 'planos da 404 ganham data-origem-cta');
});

// Cada lugar dos scripts que monta "plano=" está registrado com o motivo. Um novo precisa entrar aqui.
const REGISTRO = {
  'main.js': [5, 'cartões da home e planos da 404 (com data-origem-cta), troca do plano do bloco indicado (mantém a origem), "Continuar com o plano" (reentrada com a origem da página, melhoria 116) e JSON-LD (não é link)'],
  'simulador.js': [1, 'resultado do simulador: o link tem data-origem-cta="home/simulador" no index.html'],
  'retomada.js': [1, 'reentrada: "Continue de onde parou" (a origem já foi gravada na primeira visita)'],
  'obrigado.js': [1, 'reentrada: "Tentar de novo" depois de um pagamento recusado'],
  'pedido.js': [1, 'reentrada: "Tentar de novo" na página do pedido'],
  'admin-pedidos.js': [1, 'painel: link mandado pelo dono no WhatsApp (não é clique no site)'],
};

test('todo script que monta link com plano= está registrado', () => {
  const dir = join(RAIZ, 'assets/js');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const linhas = readFileSync(join(dir, f), 'utf8').split('\n')
      .filter((l) => /plano=/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
    if (!linhas.length) continue;
    assert.ok(REGISTRO[f], `${f} monta "plano=" e não está registrado em links-planos.test.mjs:\n${linhas.join('\n')}`);
    assert.equal(linhas.length, REGISTRO[f][0], `${f}: ${linhas.length} montagens de "plano=" (registradas ${REGISTRO[f][0]}: ${REGISTRO[f][1]})`);
  }
  assert.match(ler('index.html'), /data-sim-cta data-origem-cta="home\/simulador"/);
});

test('o comparativo marca o plano no formulário (sem sair da página)', () => {
  const c = ler('assets/js/comparativo.js');
  assert.match(c, /b\.setAttribute\('data-escolher-plano', p\.id\)/);
  assert.match(c, /radio\.checked = true;\s*radio\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\);/);
});
