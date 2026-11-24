// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Melhoria 115 — o botão flutuante do chat nunca fica sobre o texto do rodapé:
//  [1] A área do botão (--area-botao-flutuante) já está reservada no rodapé na 1ª pintura: o padding de baixo do
//      rodapé e a altura da página não mudam quando o chat é montado (no ócio, melhoria 89), sem CLS.
//  [2] Rolado até o fim, nenhum texto/link do rodapé fica sob o botão do chat (em 320, 375, 768 e 1280 px).
//  [3] O caso que fazia o contraste-escuro.test.js falhar de forma intermitente: viewport da altura da página medida
//      ANTES de o chat montar — o botão aparece depois e continua sem cobrir texto.
//  [4] Sem JavaScript: nada é reservado (não há chat).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const RAIZ = path.resolve(__dirname, '../..');
const LARGURAS = [320, 375, 768, 1280];
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

// Páginas públicas com o chat (o 404 usa caminhos absolutos do GitHub Pages; o painel não tem chat).
function paginas(dir = '', prefixo = '') {
  return fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory() && ['blog', 'exemplos', 'segmentos'].includes(e.name) && !prefixo) return paginas(e.name, e.name + '/');
    if (!e.isFile() || !e.name.endsWith('.html') || e.name === '404.html') return [];
    const html = fs.readFileSync(path.join(RAIZ, dir, e.name), 'utf8');
    return html.includes('assets/js/chat.js') ? [prefixo + e.name] : [];
  });
}

// Retângulos (em coordenadas da página) de cada trecho de texto e de cada link/botão do rodapé visível.
function textosDoRodape() {
  const rodape = document.querySelector('.rodape, .ex-rodape');
  if (!rodape) return [];
  const caixas = [];
  const andar = document.createTreeWalker(rodape, NodeFilter.SHOW_TEXT);
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    for (const c of r.getClientRects()) {
      if (c.width < 1 || c.height < 1) continue;
      caixas.push({ texto: n.textContent.trim().slice(0, 40), x0: c.left + scrollX, y0: c.top + scrollY, x1: c.right + scrollX, y1: c.bottom + scrollY });
    }
  }
  return caixas;
}

function botaoDoChat() {
  const b = document.querySelector('.chat__lancador');
  if (!b || !b.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return null;
  const c = b.getBoundingClientRect();
  return { x0: c.left + scrollX, y0: c.top + scrollY, x1: c.right + scrollX, y1: c.bottom + scrollY };
}

async function sobrepostos(p) {
  const botao = await p.evaluate(botaoDoChat);
  if (!botao) return { botao: null, lista: [] };
  const textos = await p.evaluate(textosDoRodape);
  const lista = textos.filter((t) => t.x0 < botao.x1 && t.x1 > botao.x0 && t.y0 < botao.y1 && t.y1 > botao.y0).map((t) => `"${t.texto}"`);
  return { botao, lista };
}

async function abrir(browser, largura, altura, url) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ }
    window.__cls = 0;
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__cls += e.value; }))
        .observe({ type: 'layout-shift', buffered: true });
    } catch (e) { /* */ }
    // CLS acumulado no instante em que o botão do chat entra no DOM: o que vier depois é da montagem do chat
    // (as outras mudanças de layout de cada página têm testes próprios, ex.: css-critico e movimento).
    new MutationObserver((m, obs) => {
      if (document.querySelector('.chat__lancador')) { window.__clsNaMontagem = window.__cls; obs.disconnect(); }
    }).observe(document, { childList: true, subtree: true });
    // Padding do rodapé e altura da página na 1ª pintura possível (antes de o chat existir).
    document.addEventListener('DOMContentLoaded', () => {
      const r = document.querySelector('.rodape, .ex-rodape');
      window.__antes = {
        pad: r ? parseFloat(getComputedStyle(r).paddingBottom) : null,
        altura: document.documentElement.scrollHeight,
        chat: !!document.querySelector('.chat__lancador'),
      };
    });
  });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push(e.message));
  await p.goto(SITE + url, { waitUntil: 'load' });
  return p;
}

const montado = (p) => p.waitForSelector('.chat__lancador', { state: 'attached', timeout: 8000 }).then(() => true, () => false);

(async () => {
  const browser = await chromium.launch();
  const lista = paginas();
  ok(lista.length >= 20, `${lista.length} páginas públicas com o chat`);

  for (const largura of LARGURAS) {
    console.log(`\n${largura} px`);
    for (const url of lista) {
      const nome = url || 'index.html';
      // [1] e [2] viewport normal, rolando até o fim
      const p = await abrir(browser, largura, 800, url);
      const antes = await p.evaluate(() => window.__antes);
      await p.mouse.wheel(0, 1); // primeira interação também monta o chat (melhoria 89)
      const temChat = await montado(p);
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await p.waitForTimeout(150);
      const depoisPad = await p.$eval('.rodape, .ex-rodape', (e) => parseFloat(getComputedStyle(e).paddingBottom));
      const { botao, lista: cobertos } = await sobrepostos(p);
      await p.waitForTimeout(300);
      const cls = await p.evaluate(() => window.__cls - (window.__clsNaMontagem ?? window.__cls));
      // < 0,001: termos/privacidade têm um deslocamento subpixel (0,0001, mesmo retângulo antes e depois) de um texto
      // do conteúdo que coincide com a montagem; o rodapé em si não muda (padding igual antes e depois, conferido acima).
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      ok(temChat && botao && !antes.chat && Math.abs(depoisPad - antes.pad) < 0.5 && cls < 0.001 && cobertos.length === 0 && sw === largura && p.erros.length === 0,
        `${nome}: reserva ${antes.pad}px já na 1ª pintura (depois ${depoisPad}px), CLS da montagem do chat ${cls.toFixed(4)}` +
        (cobertos.length ? ` | sob o botão: ${cobertos.join(', ')}` : ', nenhum texto sob o botão') +
        (temChat && botao ? '' : ' | chat não apareceu') + (sw !== largura ? ` | scrollWidth ${sw}` : '') +
        (p.erros.length ? ' | console: ' + p.erros.join(' ') : ''));
      await p.context().close();

      // [3] o cenário do teste de contraste: viewport da altura medida antes do chat
      if (largura === 375 || largura === 320) {
        const q = await abrir(browser, largura, 800, url);
        const altura = await q.evaluate(() => Math.min(document.documentElement.scrollHeight, 16000));
        await q.setViewportSize({ width: largura, height: altura });
        await montado(q);
        await q.waitForTimeout(100);
        const r = await sobrepostos(q);
        ok(r.lista.length === 0, `${nome}: viewport da altura da página, chat montado depois → ${r.lista.length ? 'sob o botão: ' + r.lista.join(', ') : r.botao ? 'nada coberto' : 'botão recolhido'}`);
        await q.context().close();
      }
    }
  }

  console.log('\nSem JavaScript');
  for (const url of ['', 'blog/', 'planos.html']) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 700 }, javaScriptEnabled: false });
    const p = await ctx.newPage();
    await p.goto(SITE + url);
    const pad = await p.$eval('.rodape', (e) => parseFloat(getComputedStyle(e).paddingBottom));
    ok(pad <= 48, `${url || 'home'}: nada reservado no rodapé (${pad}px)`);
    await ctx.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nCHAT SEM COBRIR O RODAPÉ OK');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
