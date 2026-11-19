// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Abertura de marca e animações de rolagem (item 1 do MELHORIAS.md).
// Também grava testes/video-abertura.webm (1280x720) para revisão.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
const VIDEO = path.resolve(__dirname, '../video-abertura.webm');
fs.mkdirSync(SAIDA, { recursive: true });

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function abrir(browser, opcoes = {}, url = SITE) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 720 } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  // mede deslocamentos de layout desde o início
  await p.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; }))
      .observe({ type: 'layout-shift', buffered: true });
  });
  if (url) await p.goto(url, { waitUntil: 'domcontentloaded' });
  return p;
}
const estado = (p) => p.evaluate(() => ({
  classe: document.documentElement.className,
  telaVisivel: (() => { const t = document.querySelector('[data-abertura-tela]'); if (!t) return false; const cs = getComputedStyle(t); return !t.hidden && cs.display !== 'none' && cs.visibility !== 'hidden'; })()
}));

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Abertura: aparece, termina sozinha e não se repete na sessão');
  {
    const p = await abrir(browser);
    const e0 = await estado(p);
    ok(e0.classe.includes('com-abertura') && e0.telaVisivel, 'primeira visita: abertura na tela');
    ok(await p.getAttribute('[data-abertura-tela]', 'aria-hidden') === 'true', 'camada da abertura com aria-hidden');
    const arvore = await p.locator('body').ariaSnapshot();
    ok(/heading "Seu negócio com um site profissional/.test(arvore) && !/Toque ou pressione/.test(arvore),
      'leitores de tela já veem o conteúdo real (h1 do hero) e não veem a abertura');
    await p.waitForTimeout(1200);
    await p.screenshot({ path: SAIDA + '/abertura-1200ms.png' });
    await p.waitForTimeout(500);
    await p.screenshot({ path: SAIDA + '/abertura-1700ms.png' });
    await p.waitForTimeout(500);
    await p.screenshot({ path: SAIDA + '/abertura-2200ms.png' });
    await p.waitForFunction(() => !document.documentElement.classList.contains('com-abertura'), null, { timeout: 4500 });
    const fim = await p.evaluate(() => performance.now());
    ok(fim < 3500, `abertura termina sozinha em ~${(fim / 1000).toFixed(1)} s (2 a 3 s de animação)`);
    ok(!(await estado(p)).telaVisivel, 'camada escondida ao final');
    await p.reload({ waitUntil: 'domcontentloaded' });
    ok(!(await estado(p)).classe.includes('com-abertura'), 'recarregar na mesma sessão: sem abertura');
    await p.goto(SITE + 'planos.html', { waitUntil: 'domcontentloaded' });
    ok(await p.locator('[data-abertura-tela]').count() === 0, 'outras páginas não têm abertura');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[2] Pular por tecla, clique e toque');
  for (const [nome, acao] of [
    ['tecla', (p) => p.keyboard.press('Space')],
    ['clique', (p) => p.mouse.click(400, 300)],
  ]) {
    const p = await abrir(browser);
    await p.waitForTimeout(500);
    const t0 = Date.now();
    await acao(p);
    await p.waitForFunction(() => !document.documentElement.classList.contains('com-abertura'), null, { timeout: 2000 });
    const dt = Date.now() - t0;
    ok(dt >= 300 && dt < 1000, `pular por ${nome}: saída animada curta (${dt} ms)`);
    await p.context().close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    await p.goto(SITE, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(500);
    await p.touchscreen.tap(180, 300);
    await p.waitForFunction(() => !document.documentElement.classList.contains('com-abertura'), null, { timeout: 2000 });
    ok(true, 'pular por toque (celular)');
    await ctx.close();
  }

  console.log('\n[3] Movimento reduzido e sem JavaScript');
  {
    const p = await abrir(browser, { reducedMotion: 'reduce' });
    await p.waitForLoadState('networkidle');
    const e = await estado(p);
    ok(!e.classe.includes('com-abertura') && !e.telaVisivel, 'prefers-reduced-motion: sem abertura');
    ok(!e.classe.includes('revelar-ativo'), 'prefers-reduced-motion: sem animações de rolagem');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('.celular')).transform) === 'none', 'prefers-reduced-motion: celular sem 3D');
    await p.context().close();
  }
  {
    const p = await abrir(browser, { javaScriptEnabled: false });
    await p.waitForLoadState('networkidle');
    const r = await p.evaluate(() => ({
      tela: getComputedStyle(document.querySelector('[data-abertura-tela]')).display,
      // as telas 2 e 3 do mockup (decorativas, item 2) e seções [hidden] que dependem de JS (simulador, item 4)
      // ficam ocultas sem JS de propósito; aqui só interessa o que a animação esconderia
      escondidos: [...document.querySelectorAll('main *')].filter((el) => !el.closest('[data-mock-tela], [hidden]') && getComputedStyle(el).opacity === '0').length,
    }));
    ok(r.tela === 'none' && r.escondidos === 0, 'sem JS: nenhuma abertura e nada escondido');
    await p.context().close();
  }

  console.log('\n[4] Rolagem: seções, cascata, sublinhado e celular em 3D');
  {
    const p = await abrir(browser, {}, null);
    await p.addInitScript(() => sessionStorage.setItem('pbr_abertura_vista', '1'));
    await p.goto(SITE, { waitUntil: 'networkidle' });
    ok((await estado(p)).classe.includes('revelar-ativo'), 'animações de rolagem ativas');
    await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
    const vCarga = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] })).violations.map((x) => `${x.impact} ${x.id}`));
    ok(vCarga.length === 0, 'axe logo na carga, com seções ainda ocultas: sem violações (nada em meio a transição)' + (vCarga.length ? ' → ' + vCarga.join(', ') : ''));
    const servicos = await p.evaluate(() => document.querySelector('#servicos .secao__cabecalho').classList.contains('revelado'));
    ok(!servicos, 'seção abaixo da dobra começa oculta (aguardando rolagem)');
    const visHero = await p.evaluate(() => getComputedStyle(document.querySelector('.hero h1')).opacity);
    ok(visHero === '1', 'hero visível desde o início (nada some diante do visitante)');
    const t0 = await p.evaluate(() => getComputedStyle(document.querySelector('.celular')).transform);
    await p.mouse.wheel(0, 400);
    await p.waitForTimeout(300);
    const t1 = await p.evaluate(() => getComputedStyle(document.querySelector('.celular')).transform);
    ok(t0 !== t1 && /matrix3d/.test(t1), 'celular gira/amplia em 3D conforme a rolagem');
    await p.evaluate(() => document.querySelector('#servicos').scrollIntoView());
    await p.waitForTimeout(1600);
    const fileira1 = await p.evaluate(() => [...document.querySelectorAll('#servicos .grade-cards > li')].slice(0, 3).map((li) => [li.classList.contains('revelado'), li.style.getPropertyValue('--atraso')]));
    ok(fileira1.every((c) => c[0]) && fileira1.map((c) => c[1]).join() === '0ms,90ms,180ms', 'primeira fileira de cards em cascata (0, 90, 180 ms)');
    await p.evaluate(() => document.querySelectorAll('#servicos .grade-cards > li')[4].scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(1200);
    const fileira2 = await p.evaluate(() => [...document.querySelectorAll('#servicos .grade-cards > li')].slice(3).map((li) => [li.classList.contains('revelado'), li.style.getPropertyValue('--atraso')]));
    ok(fileira2.every((c) => c[0]) && fileira2[0][1] === '0ms', 'segunda fileira também começa sem espera (cascata por fileira): ' + fileira2.map((c) => c[1]).join());
    const sub = await p.evaluate(() => getComputedStyle(document.querySelector('#servicos .secao__titulo'), '::after').transform);
    ok(/matrix\(1, 0, 0, 1/.test(sub), 'sublinhado amarelo do título desenhado');
    for (const id of ['como-funciona', 'planos', 'garantias', 'duvidas', 'contato']) {
      await p.evaluate((i) => document.getElementById(i).scrollIntoView(), id);
      await p.waitForTimeout(250);
    }
    await p.waitForTimeout(1200);
    const ocultos = await p.evaluate(() => [...document.querySelectorAll('[data-revelar]:not(.revelado)')].map((e) => e.className));
    ok(ocultos.length === 0, 'depois de rolar até o fim, tudo foi revelado' + (ocultos.length ? ': ' + ocultos.join(', ') : ''));
    const props = await p.evaluate(() => [...new Set(document.getAnimations().flatMap((a) => a.effect && a.effect.getKeyframes ? a.effect.getKeyframes().flatMap((k) => Object.keys(k)) : []))]);
    ok(props.every((k) => ['offset', 'easing', 'composite', 'computedOffset', 'transform', 'opacity'].includes(k)), 'transições de rolagem só com transform/opacity: ' + props.join(', '));
    ok(await p.evaluate(() => window.__cls) === 0, 'CLS 0 (carga + rolagem)');
    ok(p.erros.length === 0, 'console limpo');
    await p.context().close();
  }

  console.log('\n[5] CLS e quadros durante a abertura (celular)');
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
      window.__quadros = [];
      let ult = 0;
      const loop = (t) => { if (ult) window.__quadros.push(t - ult); ult = t; if (t < 4000) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    await p.goto(SITE, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3600);
    const r = await p.evaluate(() => {
      const q = window.__quadros.slice(5);
      const media = q.reduce((a, b) => a + b, 0) / q.length;
      return { cls: window.__cls, fps: Math.round(1000 / media), longos: q.filter((x) => x > 50).length, total: q.length };
    });
    ok(r.cls === 0, 'CLS 0 durante a abertura');
    console.log(`    (Chromium headless, sem GPU: ~${r.fps} fps médios, ${r.longos} quadros > 50 ms em ${r.total})`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sem rolagem horizontal durante a abertura (375px)');
    await ctx.close();
  }

  console.log('\n[6] 320, 375, 768 e 1280 px: durante e depois da abertura');
  for (const w of [320, 375, 768, 1280]) {
    const p = await abrir(browser, { viewport: { width: w, height: 800 } });
    await p.waitForTimeout(800);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px: sem rolagem horizontal durante a abertura`);
    await p.screenshot({ path: `${SAIDA}/abertura-${w}.png` });
    await p.waitForFunction(() => !document.documentElement.classList.contains('com-abertura'), null, { timeout: 4500 });
    await p.waitForLoadState('networkidle');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px: sem rolagem horizontal depois`);
    await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
    const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
      .violations.map((x) => `${x.impact} ${x.id}`));
    ok(v.length === 0, `${w}px: axe sem violações` + (v.length ? ' → ' + v.join(', ') : ''));
    ok(p.erros.length === 0, `${w}px: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[7] Vídeo para revisão (1280x720)');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: SAIDA + '/video', size: { width: 1280, height: 720 } } });
    const p = await ctx.newPage();
    await p.goto(SITE, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3400);          // abertura completa
    for (let i = 0; i < 26; i++) {         // rolagem suave pela página
      await p.mouse.wheel(0, 120);
      await p.waitForTimeout(110);
    }
    await p.waitForTimeout(800);
    const caminho = await p.video().path();
    await ctx.close();
    fs.copyFileSync(caminho, VIDEO);
    const tamanho = fs.statSync(VIDEO).size;
    ok(tamanho > 50 * 1024, `vídeo salvo em testes/video-abertura.webm (${Math.round(tamanho / 1024)} KB)`);
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE MOVIMENTO PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
