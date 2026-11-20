// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Seção "Para quem é" da home (item 6 do MELHORIAS.md): segmentos com ícones SVG próprios do sprite,
// uma frase de benefício cada, link para o site de exemplo do segmento, sem números inventados, axe e rolagem.
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
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* sem JS */ } });
  await p.goto(SITE, { waitUntil: 'networkidle' });
  return p;
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Conteúdo');
  {
    const p = await abrir(browser);
    const s = await p.evaluate(() => [...document.querySelectorAll('#para-quem .segmento')].map((li) => ({
      titulo: li.querySelector('h3').textContent.trim(),
      texto: li.querySelector('.segmento__texto').textContent.trim(),
      icone: li.querySelector('.segmento__icone use').getAttribute('href'),
      existe: !!document.querySelector(li.querySelector('.segmento__icone use').getAttribute('href')),
      link: li.querySelector('.segmento__link') && li.querySelector('.segmento__link').getAttribute('href'),
      nome: li.querySelector('.segmento__link') && li.querySelector('.segmento__link').textContent.replace(/\s+/g, ' ').trim(),
      pagina: li.querySelector('.segmento__titulo-link') && li.querySelector('.segmento__titulo-link').getAttribute('href'),
    })));
    ok(s.length >= 6, `${s.length} segmentos: ` + s.map((x) => x.titulo).join(', '));
    ok(s.every((x) => x.existe) && new Set(s.map((x) => x.icone)).size === s.length, 'cada um com ícone próprio do sprite');
    ok(s.every((x) => x.texto.length > 20 && !/\d/.test(x.texto.replace('4 perguntas', ''))), 'uma frase de benefício por segmento, sem números');
    const links = s.filter((x) => x.link);
    // melhoria 25: o título dos segmentos com exemplo leva à página do segmento
    ok(links.filter((x) => x.link[0] !== '#').every((x) => /^segmentos\/\w+\.html$/.test(x.pagina || '')), 'títulos levam às páginas por segmento');
    ok(links.length >= 6 && links.filter((x) => x.link[0] !== '#').every((x) => /^exemplos\/\w+\.html$/.test(x.link) && /^Ver exemplo de site de /.test(x.nome)), 'links "Ver exemplo" com nome acessível único');
    for (const l of links.filter((x) => x.link[0] !== '#')) {
      const r = await p.request.get(new URL(l.link, SITE).href);
      ok(r.status() === 200, `${l.link} existe`);
    }
    ok(await p.locator('.segmentos').count() === 0, 'lista antiga "Ideal para" substituída');
    await p.locator('#para-quem').scrollIntoViewIfNeeded();
    await p.waitForTimeout(1200);
    ok(await p.evaluate(() => [...document.querySelectorAll('#para-quem .segmento')].every((li) => li.classList.contains('revelado'))), 'cards revelados na rolagem');
    ok(p.erros.length === 0, 'console limpo');
    await p.context().close();
  }

  console.log('\n[2] 320, 375, 768 e 1280 px');
  for (const w of [320, 375, 768, 1280]) {
    const p = await abrir(browser, { viewport: { width: w, height: 800 }, reducedMotion: 'reduce' });
    await p.locator('#para-quem').scrollIntoViewIfNeeded();
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px: sem rolagem horizontal`);
    await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
    const v = await p.evaluate(async () => (await axe.run('#para-quem', { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] })).violations.map((x) => `${x.impact} ${x.id}`));
    ok(v.length === 0, `${w}px: axe sem violações` + (v.length ? ' → ' + v.join(', ') : ''));
    if (process.env.SHOT && (w === 375 || w === 1280)) await p.locator('#para-quem').screenshot({ path: process.env.SHOT.replace('.png', `-${w}.png`) });
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE "PARA QUEM É" PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
