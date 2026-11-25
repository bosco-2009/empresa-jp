// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Melhoria 119: fonte da primeira tela, preload e troca sem deslocamento.
//  [1] Todas as páginas (menos 404.html, que usa caminhos absolutos /empresa-jp/) a 375 e 1280 px: o texto da
//      primeira tela usa a Plus Jakarta Sans em pesos dentro do eixo 400–800; a fonte é pedida UMA vez e pelo
//      preload (initiatorType "link"); nenhum aviso de "preloaded but not used" no console. Os pesos usados acima
//      da dobra no site inteiro são 400, 600, 700 e 800: por isso um único arquivo variável (13 852 bytes) é
//      pré-carregado, em vez de instâncias estáticas (31 472 bytes em 4 pedidos; medição em fontes.test.mjs).
//  [2] Fonte atrasada 1,5 s (internet lenta): o texto aparece antes da fonte (sem FOIT), na face de reserva com
//      métricas ajustadas; a troca não muda a altura de nada e o CLS fica < 0,005 (sem a reserva, a home a 375 px
//      chegava a 0,028).
//  [3] Fonte rápida: CLS 0 (planos.html fica de fora: tem um deslocamento pequeno que não vem da fonte e já existia
//      antes; é o item 44 da fila). Termos e privacidade entraram na melhoria 125: os dados do config.js já vêm
//      gravados no HTML (testes/legal/gravar.mjs) e o legal.js não troca nada na carga.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const RAIZ = path.join(__dirname, '..', '..');
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

function paginas(dir, prefixo = '') {
  return fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory() && ['blog', 'exemplos', 'segmentos', 'admin'].includes(e.name) && !prefixo) return paginas(e.name, e.name + '/');
    return e.isFile() && e.name.endsWith('.html') && e.name !== '404.html' ? [prefixo + e.name] : [];
  });
}

const LENTAS = ['index.html', 'planos.html', 'blog/site-ou-instagram.html', 'exemplos/moda.html', 'segmentos/moda.html', 'termos.html', 'privacidade.html'];
const CLS_LENTA = 0.005;
const RAPIDAS = LENTAS.filter((p) => p !== 'planos.html');

function observarCls() {
  window.__cls = 0;
  window.__alturaMudou = false;
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__cls += e.value;
      for (const s of e.sources) if (Math.abs(s.previousRect.height - s.currentRect.height) > 0.5) window.__alturaMudou = true;
    }
  }).observe({ type: 'layout-shift', buffered: true });
}

(async () => {
  const navegador = await chromium.launch();
  const pesosSite = new Set();

  console.log('\n[1] Primeira tela: fonte, pesos e preload');
  for (const largura of [375, 1280]) {
    const ctx = await navegador.newContext({ viewport: { width: largura, height: 800 }, reducedMotion: 'reduce' });
    for (const p of paginas('.')) {
      const pg = await ctx.newPage();
      const avisos = [];
      pg.on('console', (m) => { if (/preload/i.test(m.text())) avisos.push(m.text()); });
      await pg.goto(SITE + p, { waitUntil: 'load' });
      await pg.evaluate(() => document.fonts.ready);
      const r = await pg.evaluate(() => {
        const pesos = new Set(), familias = new Set();
        const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          if (!n.textContent.trim()) continue;
          const el = n.parentElement, ret = el.getBoundingClientRect();
          if (ret.bottom <= 0 || ret.top >= innerHeight || !ret.width) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden') continue;
          pesos.add(+cs.fontWeight);
          familias.add(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
        }
        const fontes = performance.getEntriesByType('resource').filter((e) => /\.woff2/.test(e.name));
        return { pesos: [...pesos], familias: [...familias], pedidos: fontes.length, inic: fontes.map((e) => e.initiatorType) };
      });
      r.pesos.forEach((x) => pesosSite.add(x));
      const nome = `${p} @${largura}`;
      ok(r.familias.length === 1 && r.familias[0] === 'Plus Jakarta Sans', `${nome}: primeira tela em Plus Jakarta Sans (${r.familias.join(', ')})`);
      ok(r.pesos.every((x) => x >= 400 && x <= 800), `${nome}: pesos ${r.pesos.sort().join('/')} dentro de 400–800`);
      ok(r.pedidos === 1 && r.inic[0] === 'link', `${nome}: fonte pedida uma vez, pelo preload (${r.pedidos}× ${r.inic.join(',')})`);
      ok(avisos.length === 0, `${nome}: sem aviso de preload no console${avisos.length ? ': ' + avisos[0] : ''}`);
      await pg.close();
    }
    await ctx.close();
  }
  ok([400, 600, 700, 800].every((x) => pesosSite.has(x)), `pesos usados acima da dobra no site: ${[...pesosSite].sort().join(', ')} (justifica o arquivo variável único)`);

  console.log('\n[2] Fonte atrasada 1,5 s: texto na reserva e troca sem deslocamento');
  for (const largura of [375, 1280]) {
    for (const p of LENTAS) {
      const ctx = await navegador.newContext({ viewport: { width: largura, height: 800 }, reducedMotion: 'reduce' });
      const pg = await ctx.newPage();
      await pg.route('**/*.woff2*', async (rota) => { await new Promise((s) => setTimeout(s, 1500)); rota.continue(); });
      await pg.addInitScript(observarCls);
      await pg.goto(SITE + p, { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(500);
      const antes = await pg.evaluate(() => ({
        status: document.fonts.status,
        fcp: !!performance.getEntriesByName('first-contentful-paint')[0],
        larguraH1: document.querySelector('h1').getBoundingClientRect().width,
        reserva: [...document.fonts].some((f) => /Reserva/.test(f.family) && f.status === 'loaded'),
      }));
      await pg.waitForTimeout(2200);
      const depois = await pg.evaluate(() => ({ status: document.fonts.status, cls: window.__cls, altura: window.__alturaMudou }));
      const nome = `${p} @${largura}`;
      ok(antes.status === 'loading' && antes.fcp && antes.larguraH1 > 0, `${nome}: texto pintado antes da fonte chegar (sem FOIT)`);
      ok(antes.reserva, `${nome}: texto na face de reserva ajustada enquanto a fonte não chega`);
      ok(depois.status === 'loaded', `${nome}: fonte carregada depois`);
      ok(!depois.altura, `${nome}: a troca não muda a altura de nenhum elemento`);
      ok(depois.cls < CLS_LENTA, `${nome}: CLS ${depois.cls.toFixed(5)} < ${CLS_LENTA}`);
      await ctx.close();
    }
  }

  console.log('\n[3] Fonte rápida: CLS 0');
  for (const largura of [375, 1280]) {
    for (const p of RAPIDAS) {
      const ctx = await navegador.newContext({ viewport: { width: largura, height: 800 }, reducedMotion: 'reduce' });
      const pg = await ctx.newPage();
      await pg.addInitScript(observarCls);
      await pg.goto(SITE + p, { waitUntil: 'load' });
      await pg.waitForTimeout(800);
      const cls = await pg.evaluate(() => window.__cls);
      ok(cls === 0, `${p} @${largura}: CLS ${cls}`);
      await ctx.close();
    }
  }

  await navegador.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
