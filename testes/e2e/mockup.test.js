// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Mockup vivo no hero (item 2 do MELHORIAS.md): 3 sites de exemplo alternando, rótulo "exemplo",
// botão de pausa (WCAG 2.2.2), pausa fora da tela, movimento reduzido e sem JS.
const { chromium } = require('playwright');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, opcoes = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.addInitScript(() => {
    try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* sem JS */ }
    window.__cls = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
  });
  await p.goto(SITE, { waitUntil: 'networkidle' });
  return p;
}
const ativa = (p) => p.evaluate(() => [...document.querySelectorAll('[data-mock-tela]')].findIndex((t) => t.classList.contains('mock-tela--ativa')));

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Três telas de exemplo alternando');
  {
    const p = await abrir(browser);
    const telas = await p.$$eval('[data-mock-tela]', (ts) => ts.map((t) => [t.className.match(/mock-tela--(\w+)/)[1], t.querySelector('.mock__exemplo').textContent.trim(), t.querySelector('.mock__marca').textContent.trim()]));
    ok(telas.length === 3 && telas.map((t) => t[0]).join() === 'moda,restaurante,salao', 'loja de roupas, restaurante e salão: ' + telas.map((t) => t[2]).join(', '));
    ok(telas.every((t) => t[1] === 'exemplo'), 'cada tela com o rótulo "exemplo" visível');
    ok(await p.locator('.mock__exemplo').first().isVisible(), 'rótulo "exemplo" à vista na tela ativa');
    ok(await ativa(p) === 0, 'começa pela primeira tela');
    await p.waitForTimeout(4300);
    ok(await ativa(p) === 1, 'troca sozinha (≈3,8 s)');
    const props = await p.evaluate(() => [...new Set(document.getAnimations().flatMap((a) => (a.effect && a.effect.getKeyframes ? a.effect.getKeyframes().flatMap((k) => Object.keys(k)) : [])))]);
    ok(props.filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)).every((k) => ['transform', 'opacity'].includes(k)), 'transição só com transform/opacity: ' + props.join(', '));
    await p.waitForTimeout(3900);
    ok(await ativa(p) === 2, 'terceira tela');
    await p.waitForTimeout(3900);
    ok(await ativa(p) === 0, 'volta à primeira (ciclo)');
    ok(await p.evaluate(() => window.__cls) === 0, 'CLS 0 com as trocas');

    console.log('\n[2] Botão de pausa (WCAG 2.2.2)');
    const botao = p.locator('[data-mockup-pausa]');
    ok(await botao.isVisible() && (await botao.getAttribute('aria-pressed')) === 'false', 'botão "Pausar exemplos" visível');
    await botao.focus();
    await p.keyboard.press('Enter');
    ok((await botao.getAttribute('aria-pressed')) === 'true' && (await botao.textContent()).includes('Continuar'), 'pausa pelo teclado (aria-pressed=true, "Continuar exemplos")');
    const parada = await ativa(p);
    await p.waitForTimeout(4300);
    ok(await ativa(p) === parada, 'pausado: não troca mais');
    await botao.click();
    await p.waitForTimeout(4300);
    ok(await ativa(p) !== parada, 'continuar: volta a alternar');

    console.log('\n[3] Pausa fora da tela');
    await p.evaluate(() => window.scrollTo(0, 3000));
    await p.waitForTimeout(300);
    const fora = await ativa(p);
    await p.waitForTimeout(4300);
    ok(await ativa(p) === fora, 'hero fora da tela: não troca (sem trabalho à toa)');
    ok(p.erros.length === 0, 'console limpo');
    await p.context().close();
  }

  console.log('\n[4] Movimento reduzido e sem JavaScript');
  {
    const p = await abrir(browser, { reducedMotion: 'reduce' });
    await p.waitForTimeout(4300);
    ok(await ativa(p) === 0 && await p.locator('[data-mockup-pausa]').isHidden(), 'movimento reduzido: tela parada e sem botão');
    await p.context().close();
    const q = await abrir(browser, { javaScriptEnabled: false });
    const vis = await q.evaluate(() => [...document.querySelectorAll('[data-mock-tela]')].map((t) => getComputedStyle(t).opacity));
    ok(vis.join() === '1,0,0' && await q.locator('[data-mockup-pausa]').isHidden(), 'sem JS: primeira tela visível, sem botão');
    await q.context().close();
  }

  console.log('\n[5] 320, 375, 768 e 1280 px');
  for (const w of [320, 375, 768, 1280]) {
    const p = await abrir(browser, { viewport: { width: w, height: 800 } });
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px: sem rolagem horizontal`);
    const sobrepoe = await p.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const a = r('[data-mockup-pausa]'), b = r('.flutuante--b'), c = r('.flutuante--a');
      const cruza = (x, y) => x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top;
      return cruza(a, b) || cruza(a, c);
    });
    ok(!sobrepoe, `${w}px: botão de pausa não cobre os selos`);
    await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
    const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] })).violations.map((x) => `${x.impact} ${x.id}`));
    ok(v.length === 0, `${w}px: axe sem violações` + (v.length ? ' → ' + v.join(', ') : ''));
    ok(p.erros.length === 0, `${w}px: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DO MOCKUP PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
