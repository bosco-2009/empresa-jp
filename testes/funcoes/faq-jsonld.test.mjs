// FAQPage só com as perguntas visíveis (melhoria 121).
// Abre a home e planos.html num Chromium (Playwright), servidas por um servidor estático próprio do teste,
// e compara cada Question do JSON-LD com o FAQ que está na tela: mesma quantidade, mesma ordem, texto idêntico
// (pergunta = <summary>, resposta = parágrafo da resposta), nenhuma pergunta oculta e um único FAQPage por página.
// Uso: node --test testes/funcoes/*.test.mjs   (precisa do Playwright: cd testes && npm i)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const raiz = fileURLToPath(new URL('../../', import.meta.url));
const janela = {};
vm.runInNewContext(readFileSync(raiz + 'config.js', 'utf8'), { window: janela });
const config = JSON.parse(JSON.stringify(janela.PBR_CONFIG)); // objetos do contexto principal (deepEqual compara protótipos)
const SITE = config.site.url.replace(/\/?$/, '/');

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch (e) { /* sem Playwright: pula */ }
const pular = chromium ? false : 'Playwright não instalado (cd testes && npm i)';

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.ico': 'image/x-icon' };

function servir() {
  const srv = createServer(async (req, res) => {
    let caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (caminho.endsWith('/')) caminho += 'index.html';
    const arquivo = normalize(raiz + caminho.slice(1));
    if (!arquivo.startsWith(normalize(raiz)) || arquivo.split(sep).includes('.git')) { res.writeHead(403).end(); return; }
    try {
      const corpo = await readFile(arquivo);
      res.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] || 'application/octet-stream' }).end(corpo);
    } catch (e) { res.writeHead(404).end(); }
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

// Lê, dentro da página: os FAQPage do JSON-LD e as perguntas do FAQ realmente visíveis.
async function lerPagina(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  // o Supabase e CDNs não fazem parte deste teste
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await p.goto(url, { waitUntil: 'load' });
  const dados = await p.evaluate(() => {
    const blocos = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent));
    const faqs = blocos.flatMap((b) => b['@graph'] || [b]).filter((n) => n['@type'] === 'FAQPage');
    const lista = document.querySelector('[data-lista-faq]');
    const itens = lista ? [...lista.querySelectorAll('.faq__item')] : [];
    const visivel = (el) => { for (let x = el; x; x = x.parentElement) if (x.hidden) return false; return true; };
    return {
      faqs,
      todos: itens.length,
      tela: itens.filter((d) => visivel(d) && d.querySelector('summary').checkVisibility()).map((d) => ({
        pergunta: d.querySelector('.faq__pergunta').textContent,
        resposta: d.querySelector('.faq__resposta').textContent
      }))
    };
  });
  await ctx.close();
  return Object.assign(dados, { erros });
}

function comparar(nome, d, esperadas) {
  assert.deepEqual(d.erros, [], `${nome}: erros de JavaScript`);
  assert.equal(d.faqs.length, 1, `${nome}: deve haver exatamente um FAQPage (há ${d.faqs.length})`);
  const q = d.faqs[0].mainEntity;
  assert.ok(Array.isArray(q) && q.length > 0, `${nome}: FAQPage sem perguntas`);
  assert.equal(d.tela.length, d.todos, `${nome}: há perguntas do FAQ ocultas na carga`);
  assert.equal(q.length, d.tela.length, `${nome}: JSON-LD tem ${q.length} perguntas, a tela mostra ${d.tela.length}`);
  q.forEach((x, i) => {
    assert.equal(x['@type'], 'Question', `${nome}: item ${i + 1} não é Question`);
    assert.equal(x.acceptedAnswer && x.acceptedAnswer['@type'], 'Answer', `${nome}: item ${i + 1} sem Answer`);
    assert.equal(x.name, d.tela[i].pergunta, `${nome}: pergunta ${i + 1} diferente da tela`);
    assert.equal(x.acceptedAnswer.text, d.tela[i].resposta, `${nome}: resposta ${i + 1} diferente da tela`);
    assert.ok(x.name.trim() && x.acceptedAnswer.text.trim(), `${nome}: item ${i + 1} vazio`);
    assert.ok(!/PROVIS[ÓO]RIO|undefined|<\/?[a-z]/i.test(x.name + x.acceptedAnswer.text), `${nome}: item ${i + 1} com texto indevido`);
  });
  assert.equal(new Set(q.map((x) => x.name)).size, q.length, `${nome}: perguntas repetidas`);
  // e a tela é exatamente o que o config.js manda mostrar nesta página
  assert.deepEqual(d.tela, esperadas.map((f) => ({ pergunta: f.pergunta, resposta: f.resposta })), `${nome}: FAQ da tela ≠ config.js`);
  assert.equal(d.faqs[0].inLanguage, 'pt-BR', `${nome}: inLanguage`);
}

test('FAQPage da home e de planos.html: idênticos ao FAQ visível (gerado do config.js), sem perguntas ocultas', { skip: pular, timeout: 120000 }, async () => {
  const srv = await servir();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  try {
    const home = await lerPagina(browser, base);
    comparar('index.html', home, config.faq);
    assert.equal(home.faqs[0]['@id'], SITE + '#duvidas', 'index.html: @id da seção de dúvidas');
    assert.equal(home.faqs[0].url, SITE, 'index.html: url = canonical da home');

    const planos = await lerPagina(browser, base + 'planos.html');
    comparar('planos.html', planos, config.faq.filter((f) => f.checkout === true));
    assert.equal(planos.faqs[0].url, SITE + 'planos.html', 'planos.html: url = canonical');
  } finally {
    await browser.close();
    srv.close();
  }
});

test('FAQPage nunca aparece no HTML estático (só o main.js monta, a partir da tela)', () => {
  for (const f of ['index.html', 'planos.html']) {
    const html = readFileSync(raiz + f, 'utf8');
    const blocos = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(blocos.every((b) => !/"FAQPage"/.test(b)), `${f}: FAQPage fixo no HTML ficaria fora de sincronia com o config.js`);
  }
});
