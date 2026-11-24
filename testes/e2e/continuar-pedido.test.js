// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Melhoria 90: home mostra "Continue de onde parou" logo abaixo do hero quando este aparelho guarda a última
// tentativa de contratação (pbr_checkout_rascunho_v1, melhoria 60). Só o nome do plano aparece; o link leva a
// planos.html?plano=<id>&retomar=1; "Dispensar" esconde por 7 dias (uma tentativa nova volta a mostrar).
// Sem rascunho, vencido, plano inexistente ou JSON inválido: nada. CLS 0, axe, teclado, rolagem e console em 4 larguras.
const { chromium } = require('playwright');
const fs = require('fs');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const CHAVE = 'pbr_checkout_rascunho_v1';
const DISPENSA = 'pbr_retomada_dispensada_v1';
const DIA = 24 * 60 * 60 * 1000;
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

function rascunho(extra) {
  return JSON.stringify(Object.assign({ nome: 'Maria Teste', email: 'maria@exemplo.com', whatsapp: '(11) 90000-0000',
    plano_id: 'profissional', salvo_em: new Date(Date.now() - 3 * DIA).toISOString() }, extra || {}));
}
async function contexto(browser, viewport, itens) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 800 } });
  await ctx.addInitScript((itens) => {
    try {
      sessionStorage.setItem('pbr_abertura_vista', '1');
      if (!sessionStorage.getItem('__semeado')) {
        Object.keys(itens).forEach((k) => localStorage.setItem(k, itens[k]));
        sessionStorage.setItem('__semeado', '1');
      }
    } catch (e) { /* */ }
  }, itens || {});
  return ctx;
}
async function pagina(ctx) {
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  });
  return p;
}
async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}
const visivel = (p) => p.locator('[data-retomada-caixa]').isVisible();

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Sem rascunho, nada aparece e nada ocupa espaço');
  {
    const ctx = await contexto(browser);
    const p = await pagina(ctx);
    await p.goto(SITE, { waitUntil: 'networkidle' });
    ok(!(await visivel(p)), 'aviso oculto');
    ok(await p.evaluate(() => document.querySelector('[data-retomada-caixa]').getBoundingClientRect().height) === 0, 'altura 0');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await ctx.close();
  }

  console.log('\n[2] Casos inválidos não mostram o aviso');
  const invalidos = {
    'vencido (31 dias)': { [CHAVE]: rascunho({ salvo_em: new Date(Date.now() - 31 * DIA).toISOString() }) },
    'plano inexistente': { [CHAVE]: rascunho({ plano_id: 'nao-existe' }) },
    'JSON inválido': { [CHAVE]: '{quebrado' },
    'sem data': { [CHAVE]: rascunho({ salvo_em: 123 }) },
    'dispensado há 2 dias (mesma tentativa)': (() => { const r = rascunho(); return { [CHAVE]: r, [DISPENSA]: JSON.stringify({ em: Date.now() - 2 * DIA, rascunho: JSON.parse(r).salvo_em }) }; })()
  };
  for (const [nome, itens] of Object.entries(invalidos)) {
    const ctx = await contexto(browser, null, itens);
    const p = await pagina(ctx);
    await p.goto(SITE, { waitUntil: 'networkidle' });
    ok(!(await visivel(p)), nome + ': oculto');
    ok(p.erros.length === 0, nome + ': console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await ctx.close();
  }
  for (const [nome, itens] of Object.entries({
    'dispensado há 8 dias': (() => { const r = rascunho(); return { [CHAVE]: r, [DISPENSA]: JSON.stringify({ em: Date.now() - 8 * DIA, rascunho: JSON.parse(r).salvo_em }) }; })(),
    'dispensado, mas tentativa nova': { [CHAVE]: rascunho(), [DISPENSA]: JSON.stringify({ em: Date.now() - DIA, rascunho: '2026-01-01T00:00:00.000Z' }) }
  })) {
    const ctx = await contexto(browser, null, itens);
    const p = await pagina(ctx);
    await p.goto(SITE, { waitUntil: 'networkidle' });
    ok(await visivel(p), nome + ': volta a aparecer');
    await ctx.close();
  }

  console.log('\n[3] Com rascunho válido: só o nome do plano, link certo, CLS 0, 4 larguras');
  const nomePlano = await (async () => {
    const ctx = await contexto(browser);
    const p = await pagina(ctx);
    await p.goto(SITE, { waitUntil: 'networkidle' });
    const n = await p.evaluate(() => PBR_CONFIG.planos.filter((x) => x.id === 'profissional')[0].nome);
    await ctx.close();
    return n;
  })();
  for (const w of [320, 375, 768, 1280]) {
    const ctx = await contexto(browser, { width: w, height: 800 }, { [CHAVE]: rascunho() });
    const p = await pagina(ctx);
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    ok(await visivel(p), `${w}px: aviso visível`);
    const info = await p.evaluate(() => {
      const c = document.querySelector('[data-retomada-caixa]');
      const hero = document.querySelector('.hero').getBoundingClientRect();
      return { texto: c.textContent.replace(/\s+/g, ' ').trim(), href: c.querySelector('[data-retomada-link]').getAttribute('href'),
        abaixoDoHero: c.getBoundingClientRect().top >= hero.bottom - 1, rolagem: document.documentElement.scrollWidth, cls: window.__cls };
    });
    ok(info.texto.includes('plano ' + nomePlano + '.'), `${w}px: mostra o plano "${nomePlano}"`);
    ok(!/Maria|maria@|90000/.test(info.texto), `${w}px: nenhum dado pessoal na home`);
    ok(info.href === 'planos.html?plano=profissional&retomar=1', `${w}px: link ${info.href}`);
    ok(info.abaixoDoHero, `${w}px: fica abaixo do hero`);
    ok(info.rolagem === w, `${w}px: sem rolagem horizontal (${info.rolagem})`);
    ok(info.cls === 0, `${w}px: CLS 0 (${info.cls})`);
    await p.locator('[data-retomada-caixa]').scrollIntoViewIfNeeded();
    await p.locator('[data-retomada-caixa]').screenshot({ path: `${SAIDA}/continuar-pedido-${w}.png` });
    if (w === 375 || w === 1280) { await p.waitForTimeout(1500); await axe(p, w + 'px'); } // espera a revelação da rolagem terminar
    ok(p.erros.length === 0, `${w}px: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await ctx.close();
  }

  console.log('\n[4] Modo escuro e axe');
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, colorScheme: 'dark' });
    await ctx.addInitScript((r) => { sessionStorage.setItem('pbr_abertura_vista', '1'); localStorage.setItem('pbr_checkout_rascunho_v1', r); }, rascunho());
    const p = await pagina(ctx);
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await p.locator('[data-retomada-caixa]').scrollIntoViewIfNeeded();
    await p.locator('[data-retomada-caixa]').screenshot({ path: `${SAIDA}/continuar-pedido-escuro.png` });
    await p.waitForTimeout(1500);
    await axe(p, 'escuro');
    await ctx.close();
  }

  console.log('\n[5] Continuar leva ao formulário preenchido; Dispensar esconde, anuncia e guarda');
  {
    const ctx = await contexto(browser, { width: 375, height: 800 }, { [CHAVE]: rascunho() });
    const p = await pagina(ctx);
    await p.goto(SITE, { waitUntil: 'networkidle' });
    // teclado: o link e o botão são alcançáveis pelo Tab
    await p.locator('[data-retomada-link]').focus();
    ok(await p.evaluate(() => document.activeElement.matches('[data-retomada-link]')), 'link focável');
    await p.keyboard.press('Tab');
    ok(await p.evaluate(() => document.activeElement.matches('[data-retomada-dispensar]')), 'Tab vai para Dispensar');
    await p.keyboard.press('Enter');
    ok(!(await visivel(p)), 'Enter em Dispensar esconde o aviso');
    ok(/dispensado/i.test(await p.locator('[data-retomada-aviso]').textContent()), 'aviso em role=status');
    ok(await p.evaluate(() => document.activeElement && document.activeElement.id === 'servicos-titulo'), 'foco vai para a seção seguinte');
    const d = JSON.parse(await p.evaluate((k) => localStorage.getItem(k), DISPENSA));
    ok(d && Math.abs(Date.now() - d.em) < 60000 && typeof d.rascunho === 'string' && Object.keys(d).length === 2, 'guardou {em, rascunho}');
    ok(await p.evaluate((k) => localStorage.getItem(k) !== null, CHAVE), 'não apagou os dados do formulário (só dispensou)');
    await p.reload({ waitUntil: 'networkidle' });
    ok(!(await visivel(p)), 'recarregou: continua oculto');
    await ctx.close();

    const ctx2 = await contexto(browser, { width: 375, height: 800 }, { [CHAVE]: rascunho({ salvo_em: new Date(Date.now() - 3 * 60 * 1000).toISOString() }) });
    const p2 = await pagina(ctx2);
    await p2.goto(SITE, { waitUntil: 'networkidle' });
    await Promise.all([p2.waitForURL(/planos\.html/), p2.click('[data-retomada-link]')]);
    await p2.waitForLoadState('networkidle');
    ok(await p2.evaluate(() => document.querySelector('input[name="plano"]:checked') && document.querySelector('input[name="plano"]:checked').value) === 'profissional', 'planos.html com o plano marcado');
    ok(await p2.inputValue('[data-form-checkout] [name="nome"]') === 'Maria Teste', 'formulário preenchido pela melhoria 60');
    ok(!/retomar=1/.test(p2.url()), 'retomar=1 sai da barra');
    ok(p2.erros.length === 0, 'console limpo em planos.html' + (p2.erros.length ? ': ' + p2.erros.join(' | ') : ''));
    await ctx2.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
