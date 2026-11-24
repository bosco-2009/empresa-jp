// Uso: servidor estático em :8080 (python3 -m http.server 8080 na raiz) e: node testes/e2e/exemplo-chamada.test.js
// Faixa final "Gostou deste exemplo?" nas páginas de exemplo (item 95 do MELHORIAS.md):
// fixa no HTML (funciona sem JS), plano igual à regra config.planoIndicado do segmento, simulador com o segmento,
// cta "exemplo/<segmento>" guardado pelo origem.js, rótulo de exemplo e noindex mantidos, teclado, axe,
// console e rolagem em 4 larguras, e screenshots.
const { chromium } = require('playwright');
const fs = require('fs');
const vm = require('vm');

const BASE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const RAIZ = require('path').resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const LARGURAS = [320, 375, 768, 1280];

const janela = {};
vm.runInNewContext(fs.readFileSync(RAIZ + '/config.js', 'utf8'), { window: janela });
const config = janela.PBR_CONFIG;
const SEGMENTOS = fs.readdirSync(RAIZ + '/exemplos').filter((f) => f.endsWith('.html')).map((f) => f.replace('.html', '')).sort();

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(ctx, url) {
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  p.on('response', (r) => { if (r.status() >= 400) p.erros.push(r.status() + ' ' + r.url()); });
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.goto(new URL(url, BASE).href, { waitUntil: 'networkidle' });
  return p;
}

async function axe(p) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.impact} ${v.id}`));
}

(async () => {
  const browser = await chromium.launch();
  ok(SEGMENTOS.length === 6, '6 páginas de exemplo: ' + SEGMENTOS.join(', '));

  console.log('\n[1] Sem JavaScript a faixa já está completa');
  const semJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 800 } });
  for (const seg of SEGMENTOS) {
    const p = await abrir(semJs, `exemplos/${seg}.html`);
    const id = config.planoIndicado['segmento:' + seg];
    const nome = config.planos.find((x) => x.id === id).nome;
    const f = p.locator('.ex-chamada-final');
    const plano = f.locator('a[data-origem-cta]');
    ok(await f.isVisible()
      && (await f.locator('h2').innerText()).trim() === 'Gostou deste exemplo? Um site assim para o seu negócio'
      && (await plano.getAttribute('href')) === '../planos.html?plano=' + id
      && (await plano.innerText()).trim() === 'Ver o plano ' + nome
      && (await plano.getAttribute('data-origem-cta')) === 'exemplo/' + seg
      && (await f.locator('a.ex-chamada-final__link').getAttribute('href')) === `../index.html?segmento=${seg}#simulador`,
    `${seg}: plano ${nome} (?plano=${id}) e simulador com o segmento`);
    ok(await p.isVisible('.ex-aviso') && (await p.getAttribute('meta[name="robots"]', 'content')) === 'noindex, follow'
      && (await f.innerText()).toLowerCase().includes('site de exemplo'), `${seg}: aviso de exemplo e noindex mantidos`);
    // ordem: conteúdo do exemplo → faixa → rodapé (fora do <main>, como landmark complementar rotulado)
    ok(await p.evaluate(() => {
      const faixa = document.querySelector('.ex-chamada-final');
      return faixa.previousElementSibling.tagName === 'MAIN' && faixa.nextElementSibling.tagName === 'FOOTER' && !faixa.closest('main');
    }), `${seg}: entre o <main> e o rodapé`);
    await p.close();
  }
  await semJs.close();

  console.log('\n[2] Larguras: rolagem, console, axe, alvos e screenshots');
  for (const w of LARGURAS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
    for (const seg of SEGMENTOS) {
      const p = await abrir(ctx, `exemplos/${seg}.html`);
      const f = p.locator('.ex-chamada-final');
      await f.scrollIntoViewIfNeeded();
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px ${seg}: sem rolagem horizontal`);
      const alvos = await f.locator('a').evaluateAll((as) => as.map((a) => { const r = a.getBoundingClientRect(); return Math.min(r.width, r.height); }));
      ok(alvos.every((m) => m >= 24), `${w}px ${seg}: links da faixa com ≥ 24 px (${alvos.map(Math.round).join(', ')})`);
      const v = await axe(p);
      ok(v.length === 0, `${w}px ${seg}: axe sem violações sérias` + (v.length ? ': ' + v.join(', ') : ''));
      ok(p.erros.length === 0, `${w}px ${seg}: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
      if (seg === 'moda' || seg === 'pet') await f.screenshot({ path: `${SAIDA}/exemplo-chamada-${seg}-${w}.png` });
      await p.close();
    }
    await ctx.close();
  }

  console.log('\n[3] Teclado e origem do pedido');
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  const p = await abrir(ctx, 'exemplos/restaurante.html');
  await p.evaluate(() => document.querySelector('#ex-contato').parentElement.querySelector('a').focus());
  let chegou = false;
  for (let i = 0; i < 6 && !chegou; i++) {
    await p.keyboard.press('Tab');
    chegou = await p.evaluate(() => document.activeElement && document.activeElement.matches('.ex-chamada-final a[data-origem-cta]'));
  }
  ok(chegou, 'Tab chega ao "Ver o plano" logo depois do conteúdo do exemplo');
  const foco = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  ok(foco !== 'none', 'foco visível no botão (' + foco + ')');
  const id = config.planoIndicado['segmento:restaurante'];
  await Promise.all([p.waitForURL('**/planos.html?plano=' + id), p.keyboard.press('Enter')]);
  const cta = await p.evaluate(() => JSON.parse(localStorage.getItem('pbr_origem_cta_v1') || 'null'));
  ok(cta && cta.de === 'exemplo/restaurante', 'origem.js guardou o cta "exemplo/restaurante"');
  ok(await p.evaluate(() => window.PBROrigem && /· cta: exemplo\/restaurante$|^cta: exemplo\/restaurante$/.test(window.PBROrigem.resumo())),
    'resumo da origem termina em "cta: exemplo/restaurante" (vai para o pedido e o chat)');
  ok(await p.evaluate((id) => { const r = document.querySelector(`input[name="plano"][value="${id}"]`); return !r || r.checked; }, id), 'plano indicado já marcado em planos.html');
  ok(p.erros.length === 0, 'console limpo em planos.html' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
  await ctx.close();

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DA FAIXA FINAL DOS EXEMPLOS PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
