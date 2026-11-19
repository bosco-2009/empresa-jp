// Home: rolagem horizontal, console e axe em 320/375/768/1280 px. Uso: veja testes/README.md
const { chromium } = require('playwright');
const fs = require('fs');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const SITE = process.env.SITE || 'http://localhost:8080/';
let falhas = 0;
(async () => {
  const b = await chromium.launch();
  for (const w of [320, 375, 768, 1280]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
    await p.route('**/__axe.min.js', (r) => r.fulfill({ path: require.resolve('axe-core/axe.min.js'), contentType: 'application/javascript' }));
    const erros = [];
    p.on('console', m => { if (['error','warning'].includes(m.type())) erros.push(m.type()+': '+m.text()); });
    p.on('pageerror', e => erros.push('pageerror: ' + e.message));
    p.on('requestfailed', r => erros.push('falhou: ' + r.url()));
    p.on('response', r => { if (r.status() >= 400) erros.push(r.status() + ' ' + r.url()); });
    await p.goto(SITE, { waitUntil: 'networkidle' });
    const larg = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    // elementos que extrapolam
    const fora = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > document.documentElement.clientWidth + 0.5 || r.left < -0.5) && !e.closest('.sprite,.visualmente-oculto,.pular-link'); }).slice(0,8).map(e => e.className || e.tagName));
    await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
    const axe = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] })).violations.map(v => `${v.impact} ${v.id} (${v.nodes.length}): ${v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | ')}`));
    console.log(`\n== ${w}px  scrollWidth=${larg.sw} clientWidth=${larg.cw}`, fora.length ? 'FORA: ' + fora.join(', ') : '');
    console.log('console:', erros.length ? erros : 'ok');
    console.log('axe:', axe.length ? axe : 'ok');
    await p.screenshot({ path: `${SAIDA}/home-${w}.png`, fullPage: true });
    if (larg.sw > larg.cw || erros.length || axe.length) falhas++;
    await ctx.close();
  }
  await b.close();
  console.log(falhas ? `\n${falhas} largura(s) com problema` : '\nLAYOUT OK em todas as larguras');
  process.exit(falhas ? 1 : 0);
})();
