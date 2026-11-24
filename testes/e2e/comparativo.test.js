// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Comparativo de planos (item 5 do MELHORIAS.md): tabela acessível a partir de 48rem e abas no celular,
// dados do config.js, "Escolher" marca o plano no formulário, teclado, oculto sem JS, axe e rolagem em 4 larguras.
const { chromium } = require('playwright');

const BASE = process.env.SITE || 'http://localhost:8080/';
const SITE = new URL('planos.html', BASE).href;
const AXE = require.resolve('axe-core/axe.min.js');
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, opcoes = {}, url = SITE) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.goto(url, { waitUntil: 'networkidle' });
  return p;
}
const marcado = (p) => p.evaluate(() => { const r = document.querySelector('input[name="plano"]:checked'); return r ? r.value : ''; });

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Coerência do config.js');
  {
    const p = await abrir(browser);
    const c = await p.evaluate(() => ({ ids: PBR_CONFIG.planos.map((x) => x.id), linhas: PBR_CONFIG.comparativo }));
    ok(c.linhas.length >= 5, `${c.linhas.length} linhas no config.comparativo`);
    ok(c.linhas.every((l) => Object.keys(l.valores).sort().join() === [...c.ids].sort().join()), 'cada linha tem um valor para cada plano (' + c.ids.join(', ') + ')');

    console.log('\n[2] Tabela (1280 px)');
    ok(await p.locator('[data-comparativo]').isVisible() && await p.locator('[data-link-comparativo]').isVisible(), 'seção e link "Compare" visíveis');
    const t = await p.evaluate(() => {
      const tb = document.querySelector('.tabela-comparativa');
      return {
        caption: tb.caption && tb.caption.textContent,
        cols: [...tb.querySelectorAll('thead th[scope="col"]:not(.tabela-comparativa__canto)')].map((th) => th.querySelector('.tabela-comparativa__nome').textContent),
        linhas: tb.querySelectorAll('tbody tr:not(.tabela-comparativa__acoes) th[scope="row"]').length,
        sim: tb.querySelectorAll('.comparativo__valor--sim .visualmente-oculto').length,
        nao: [...tb.querySelectorAll('.comparativo__valor--nao .visualmente-oculto')].map((s) => s.textContent),
        preco: tb.querySelector('tbody tr td').textContent,
      };
    });
    const n = await p.evaluate(() => PBR_CONFIG.comparativo.length + 2);
    ok(!!t.caption && t.cols.length === 3, 'caption + 3 colunas com th scope=col: ' + t.cols.join(' | '));
    ok(t.linhas === n, `${t.linhas} linhas com th scope=row (preço, prazo e config)`);
    ok(t.sim > 0 && t.nao.length > 0 && t.nao.every((x) => x === 'Não incluído'), 'ícones com texto para leitor de tela ("Incluído"/"Não incluído")');
    ok(/R\$/.test(t.preco), 'preço vindo de config.planos: ' + t.preco);
    ok(await p.locator('.comparativo__abas').isHidden(), 'abas ocultas no desktop');
    await p.click('.tabela-comparativa [data-escolher-plano="premium"]');
    await p.waitForTimeout(700);
    ok(await marcado(p) === 'premium', '"Escolher o Premium" marca o plano no formulário');
    ok(await p.evaluate(() => document.activeElement.name === 'plano' && document.activeElement.value === 'premium'), 'foco vai para a escolha do plano');
    ok((await p.textContent('[data-resumo-plano]')).includes('Premium'), 'resumo do pedido atualizado');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[3] Abas no celular (375 px)');
  {
    const p = await abrir(browser, { viewport: { width: 375, height: 800 } }, SITE + '?plano=essencial');
    ok(await p.locator('.comparativo__tabela').isHidden(), 'tabela oculta no celular');
    const sel = () => p.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((a) => a.getAttribute('aria-selected') + ':' + a.tabIndex).join());
    ok(await sel() === 'true:0,false:-1,false:-1', 'aba inicial = plano marcado (essencial), tabindex móvel');
    await p.focus('[role="tab"][aria-selected="true"]');
    await p.keyboard.press('ArrowRight');
    ok(await sel() === 'false:-1,true:0,false:-1' && await p.evaluate(() => document.activeElement.getAttribute('aria-selected') === 'true'), 'seta → próxima aba, com foco');
    await p.keyboard.press('End');
    ok(await sel() === 'false:-1,false:-1,true:0', 'End → última aba');
    await p.keyboard.press('ArrowRight');
    ok(await sel() === 'true:0,false:-1,false:-1', 'seta na última volta à primeira');
    await p.keyboard.press('ArrowLeft');
    const painel = await p.evaluate(() => { const v = [...document.querySelectorAll('[role="tabpanel"]')].filter((x) => !x.hidden); return v.length === 1 && v[0].getAttribute('aria-labelledby') === document.activeElement.id; });
    ok(painel, 'só o painel da aba ativa à vista, ligado por aria-labelledby');
    await p.click('[role="tab"]:nth-child(2)');
    await p.click('.comparativo__painel:not([hidden]) [data-escolher-plano]');
    await p.waitForTimeout(700);
    ok(await marcado(p) === 'profissional', 'clique na aba + "Escolher" marca o Profissional');
    ok(p.erros.length === 0, 'console limpo');
    await p.context().close();
  }

  console.log('\n[4] Link da home e sem JavaScript');
  {
    const p = await abrir(browser, {}, BASE);
    await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
    await Promise.all([p.waitForURL(/planos\.html#comparativo/), p.click('.planos__comparar a')]);
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(300);
    ok(await p.evaluate(() => { const r = document.querySelector('#comparativo').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), 'home → planos.html#comparativo mostra o comparativo');
    await p.context().close();
    const q = await abrir(browser, { javaScriptEnabled: false });
    ok(await q.locator('#comparativo').isHidden() && await q.locator('[data-link-comparativo]').isHidden(), 'sem JS: seção e link ocultos');
    await q.context().close();
  }

  console.log('\n[5] 320, 375, 768 e 1280 px');
  for (const w of [320, 375, 768, 1280]) {
    const p = await abrir(browser, { viewport: { width: w, height: 800 } });
    await p.locator('#comparativo').scrollIntoViewIfNeeded();
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px: sem rolagem horizontal`);
    await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
    const v = await p.evaluate(async () => (await axe.run('#comparativo', { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] })).violations.map((x) => `${x.impact} ${x.id}`));
    ok(v.length === 0, `${w}px: axe sem violações` + (v.length ? ' → ' + v.join(', ') : ''));
    ok(p.erros.length === 0, `${w}px: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    if (process.env.SHOT && (w === 375 || w === 1280)) await p.locator('#comparativo').screenshot({ path: process.env.SHOT.replace('.png', `-${w}.png`) });
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DO COMPARATIVO PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
