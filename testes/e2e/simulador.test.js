// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Simulador "Qual plano é para mim?" (item 4 do MELHORIAS.md): regras do config.js, link para planos.html?plano=,
// exemplo do segmento, teclado, aria-live, oculto sem JS, axe e rolagem em 4 larguras.
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
async function responder(p, r) {
  for (const [nome, valor] of Object.entries(r)) await p.check(`[data-simulador] input[name="${nome}"][value="${valor}"]`);
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Regras vindas do config.js');
  {
    const p = await abrir(browser);
    ok(await p.locator('#simulador').isVisible(), 'seção visível com JS');
    ok(await p.locator('[data-sim-recomendacao]').isHidden() && await p.locator('[data-sim-espera]').isVisible(), 'antes de responder: só a orientação');
    const cfg = await p.evaluate(() => ({ s: PBR_CONFIG.simulador, ids: PBR_CONFIG.planos.map((x) => x.id), nomes: Object.fromEntries(PBR_CONFIG.planos.map((x) => [x.id, x.nome])) }));
    const maior = (a, b) => (cfg.ids.indexOf(a) >= cfg.ids.indexOf(b) ? a : b);
    for (const paginas of Object.keys(cfg.s.porPaginas)) {
      for (const vende of ['sim', 'nao']) {
        await responder(p, { vende, paginas });
        const esperado = vende === 'sim' ? maior(cfg.s.porPaginas[paginas], cfg.s.vendeOnline) : cfg.s.porPaginas[paginas];
        const nome = await p.textContent('[data-sim-plano]');
        const href = await p.getAttribute('[data-sim-cta]', 'href');
        ok(nome === 'Plano ' + cfg.nomes[esperado] && href === 'planos.html?plano=' + esperado, `páginas=${paginas}, vende=${vende} → ${esperado}`);
      }
    }
    const preco = await p.textContent('[data-sim-preco]');
    ok(/R\$\s?[\d.]+/.test(preco), 'preço do config.planos: ' + preco);

    console.log('\n[2] Exemplo do segmento e domínio');
    await responder(p, { tipo: 'restaurante', dominio: 'nao' });
    ok(await p.getAttribute('[data-sim-exemplo]', 'href') === 'exemplos/restaurante.html' && await p.locator('[data-sim-exemplo]').isVisible(), 'restaurante → exemplos/restaurante.html');
    ok((await p.textContent('[data-sim-motivos]')).includes('Registro.br'), 'sem domínio: orientação de registro');
    await responder(p, { tipo: 'outro', dominio: 'sim' });
    ok(await p.locator('[data-sim-exemplo]').isHidden(), '"Outro": sem link de exemplo');
    ok((await p.textContent('[data-sim-motivos]')).includes('domínio que você já tem'), 'com domínio: usa o atual');
    ok(await p.getAttribute('[data-sim-resultado]', 'aria-live') === 'polite', 'resultado em região aria-live');

    console.log('\n[3] Link leva ao plano escolhido');
    await responder(p, { vende: 'nao', paginas: 'uma' });
    await Promise.all([p.waitForURL(/planos\.html\?plano=essencial/), p.click('[data-sim-cta]')]);
    await p.waitForLoadState('networkidle');
    ok(await p.evaluate(() => { const r = document.querySelector('input[name="plano"]:checked'); return r ? r.value : ''; }) === 'essencial', 'planos.html pré-seleciona o plano');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[4] Teclado');
  {
    const p = await abrir(browser);
    await p.focus('[data-simulador] input[name="vende"][value="sim"]');
    await p.keyboard.press('Space');
    await p.keyboard.press('Tab');
    await p.keyboard.press('Space');
    const foco = await p.evaluate(() => [document.activeElement.name, document.activeElement.value, getComputedStyle(document.activeElement.parentElement).outlineStyle]);
    ok(foco[0] === 'paginas' && foco[2] !== 'none', 'Tab vai ao próximo grupo, com foco visível no cartão');
    ok(await p.locator('[data-sim-recomendacao]').isVisible(), 'só com teclado sai uma recomendação');
    await p.context().close();
  }

  console.log('\n[5] Sem JavaScript');
  {
    const p = await abrir(browser, { javaScriptEnabled: false });
    ok(await p.locator('#simulador').isHidden(), 'seção oculta (sem cálculo possível)');
    await p.context().close();
  }

  console.log('\n[6] 320, 375, 768 e 1280 px');
  for (const w of [320, 375, 768, 1280]) {
    const p = await abrir(browser, { viewport: { width: w, height: 800 } });
    await responder(p, { tipo: 'beleza', vende: 'sim', paginas: 'ate5', dominio: 'naoSei' });
    await p.locator('#simulador').scrollIntoViewIfNeeded();
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px: sem rolagem horizontal`);
    await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
    const v = await p.evaluate(async () => (await axe.run('#simulador', { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] })).violations.map((x) => `${x.impact} ${x.id}`));
    ok(v.length === 0, `${w}px: axe sem violações` + (v.length ? ' → ' + v.join(', ') : ''));
    ok(p.erros.length === 0, `${w}px: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    if (w === 375) await p.locator('#simulador').screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DO SIMULADOR PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
