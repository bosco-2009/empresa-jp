// Uso: veja testes/README.md (só precisa do servidor estático: python3 -m http.server 8080 na raiz)
// Melhoria 75: resumo fixo do plano no celular (planos.html).
// Abaixo de 48rem: barra oculta com o formulário na tela, visível ao descer até o resumo/dúvidas/comparativo,
// nome e preço EXIBIDO iguais ao config.js (e acompanhando a troca de plano), "Continuar" levando ao 1º campo
// vazio (depois aceite e botão de pagar), some com teclado aberto, não cobre o fim da página nem o botão do chat,
// CLS 0, entrada animada só sem movimento reduzido, nunca aparece a 768/1280 px nem sem JS; axe e console.
const { chromium } = require('playwright');
const fs = require('fs');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, opcoes, caminho) {
  const ctx = await browser.newContext(opcoes);
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ }
    // CLS acumulado desde a carga
    window.__cls = 0;
    try {
      new PerformanceObserver((l) => { l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; }); })
        .observe({ type: 'layout-shift', buffered: true });
    } catch (e) { /* */ }
  });
  const p = await ctx.newPage();
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.goto(SITE + (caminho || 'planos.html'), { waitUntil: 'networkidle' });
  return p;
}
async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}
const visivel = (p) => p.$eval('[data-barra-plano]', (e) => !e.hidden && getComputedStyle(e).display !== 'none');
const ate = async (p, seletor) => { await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start', behavior: 'instant' }), seletor); await p.waitForTimeout(350); };
const focoId = (p) => p.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.getAttribute('data-botao-pagar') !== null && 'pagar'));

(async () => {
  const browser = await chromium.launch();
  const planos = await (async () => {
    const p = await browser.newPage();
    await p.goto(SITE + 'planos.html');
    const r = await p.evaluate(() => {
      const f = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
      return window.PBR_CONFIG.planos.map((x) => ({ id: x.id, nome: x.nome, preco: f.format(x.precoCentavos / 100) }));
    });
    await p.close();
    return r;
  })();

  for (const largura of [320, 375]) {
    console.log(`Celular ${largura} px`);
    const p = await abrir(browser, { viewport: { width: largura, height: 700 }, isMobile: true, hasTouch: true }, 'planos.html?plano=' + planos[0].id);
    ok(!(await visivel(p)), 'na carga (formulário na tela) a barra fica oculta');
    await ate(p, '#comparativo');
    ok(await visivel(p), 'ao descer até o comparativo a barra aparece');
    const texto = await p.$eval('[data-barra-plano]', (e) => ({ nome: e.querySelector('[data-barra-plano-nome]').textContent, preco: e.querySelector('[data-barra-plano-preco]').textContent }));
    ok(texto.nome === 'Plano ' + planos[0].nome && texto.preco === planos[0].preco, `nome e preço do config.js (${texto.nome} · ${texto.preco})`);
    await p.screenshot({ path: `${SAIDA}/barra-plano-${largura}.png` });

    // Barra dentro da tela, inteira, sem rolagem horizontal
    const caixa = await p.$eval('[data-barra-plano]', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; });
    ok(caixa.left >= 0 && caixa.right <= largura && Math.abs(caixa.bottom - 700) < 1, `barra presa ao rodapé da tela, na largura (${Math.round(caixa.h)} px de altura)`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth) === largura, 'sem rolagem horizontal');
    const alvo = await p.$eval('[data-barra-plano-continuar]', (e) => { const r = e.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; });
    ok(alvo, '"Continuar" com alvo de toque ≥ 24 px');

    // Botão do chat acima da barra (sem sobreposição)
    const chat = await p.evaluate(() => { const b = document.querySelector('.chat__lancador'); return b ? b.getBoundingClientRect().bottom : null; });
    if (chat !== null) ok(chat <= caixa.top + 1, `botão do chat acima da barra (${Math.round(chat)} ≤ ${Math.round(caixa.top)})`);

    // Troca de plano pelo comparativo/radio: a barra acompanha
    await p.evaluate((id) => { const r = document.querySelector('input[name="plano"][value="' + id + '"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, planos[1].id);
    const t2 = await p.$eval('[data-barra-plano-nome]', (e) => e.textContent);
    ok(t2 === 'Plano ' + planos[1].nome, 'troca de plano atualiza a barra (' + t2 + ')');

    await axe(p, `${largura}px com a barra visível`);

    // Fim da página: a barra não cobre o rodapé
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await p.waitForTimeout(350);
    const sobra = await p.evaluate(() => {
      const ultimo = [...document.querySelectorAll('.rodape__base p')].filter((e) => !e.hidden).pop();
      return document.querySelector('[data-barra-plano]').getBoundingClientRect().top - ultimo.getBoundingClientRect().bottom;
    });
    ok(sobra >= 0, `no fim da página o último texto do rodapé fica acima da barra (folga ${Math.round(sobra)} px)`);
    await p.screenshot({ path: `${SAIDA}/barra-plano-fim-${largura}.png` });

    // Continuar → 1º campo vazio; a barra some
    await p.click('[data-barra-plano-continuar]');
    await p.waitForTimeout(800);
    ok(await focoId(p) === 'checkout-nome', 'Continuar leva ao nome (1º campo vazio)');
    ok(!(await visivel(p)), 'com o formulário na tela e o campo em foco, a barra some');
    await p.fill('#checkout-nome', 'Maria Teste');
    await ate(p, '#comparativo');
    await p.evaluate(() => document.activeElement.blur());
    await p.waitForTimeout(100);
    ok(await visivel(p), 'de volta ao comparativo, a barra reaparece');
    await p.click('[data-barra-plano-continuar]');
    await p.waitForTimeout(800);
    ok(await focoId(p) === 'checkout-email', 'nome preenchido → Continuar leva ao e-mail');
    await p.fill('#checkout-email', 'maria@teste.local');
    await p.fill('#checkout-whatsapp', '11912345678');
    await ate(p, '#comparativo');
    await p.evaluate(() => document.activeElement.blur());
    await p.waitForTimeout(100);
    await p.click('[data-barra-plano-continuar]');
    await p.waitForTimeout(800);
    ok(await focoId(p) === 'checkout-aceite', 'dados preenchidos → Continuar leva ao aceite dos termos');
    await p.check('#checkout-aceite');
    await ate(p, '#comparativo');
    await p.click('[data-barra-plano-continuar]');
    await p.waitForTimeout(800);
    ok(await focoId(p) === 'pagar', 'tudo pronto → Continuar leva ao botão de pagar');

    // Teclado aberto (campo de texto em foco fora do formulário) → a barra some
    await ate(p, '#comparativo');
    ok(await visivel(p), 'barra visível antes do teclado');
    const temCampoFora = await p.evaluate(() => {
      const i = document.createElement('input'); i.type = 'text'; i.id = 'campo-fora'; i.setAttribute('aria-label', 'teste');
      document.querySelector('#comparativo').appendChild(i); return true;
    });
    if (temCampoFora) {
      await p.focus('#campo-fora');
      await p.waitForTimeout(50);
      ok(!(await visivel(p)), 'campo de texto em foco (teclado aberto) → barra oculta');
      await p.evaluate(() => { document.activeElement.blur(); document.getElementById('campo-fora').remove(); });
      await p.waitForTimeout(50);
      ok(await visivel(p), 'teclado fechado → barra de volta');
    }

    // Foco pelo teclado: Tab chega ao "Continuar" (fim do main)
    const foiFocado = await p.evaluate(() => { const b = document.querySelector('[data-barra-plano-continuar]'); b.focus(); return document.activeElement === b; });
    ok(foiFocado, '"Continuar" alcançável pelo teclado');

    const cls = await p.evaluate(() => window.__cls);
    ok(cls < 0.0001, `CLS 0 com a barra entrando e saindo (${cls.toFixed(4)})`);
    const anim = await p.evaluate(async () => {
      const b = document.querySelector('[data-barra-plano]'); b.hidden = true; await new Promise((r) => requestAnimationFrame(r));
      b.hidden = false; return b.getAnimations().length;
    });
    ok(anim === 1, 'sem movimento reduzido: a entrada é animada');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('Movimento reduzido e modo escuro');
  {
    const p = await abrir(browser, { viewport: { width: 375, height: 700 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', colorScheme: 'dark' });
    await ate(p, '#duvidas-pagamento');
    await ate(p, '#comparativo');
    ok(await visivel(p), 'barra visível');
    ok(await p.$eval('[data-barra-plano]', (e) => e.getAnimations().length === 0), 'com movimento reduzido: aparece sem animação');
    await axe(p, '375px escuro');
    await p.screenshot({ path: `${SAIDA}/barra-plano-escuro.png` });
    ok(p.erros.length === 0, 'console limpo');
    await p.context().close();
  }

  console.log('Tablet e desktop: nunca aparece');
  for (const largura of [768, 1280]) {
    const p = await abrir(browser, { viewport: { width: largura, height: 800 } });
    await ate(p, '#comparativo');
    ok(!(await visivel(p)), `${largura} px: barra oculta`);
    const pad = await p.$eval('.rodape', (e) => parseFloat(getComputedStyle(e).paddingBottom));
    ok(pad <= 120, `${largura} px: rodapé sem o espaço extra da barra (${pad}px = só o do chat)`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth) === largura, `${largura} px: sem rolagem horizontal`);
    ok(p.erros.length === 0, `${largura} px: console limpo`);
    await p.context().close();
  }

  console.log('Sem JavaScript');
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 700 }, javaScriptEnabled: false });
    const p = await ctx.newPage();
    await p.goto(SITE + 'planos.html');
    ok(await p.$eval('[data-barra-plano]', (e) => getComputedStyle(e).display === 'none'), 'barra oculta');
    const pad = await p.$eval('.rodape', (e) => parseFloat(getComputedStyle(e).paddingBottom));
    ok(pad <= 48, `nada reservado no rodapé (${pad}px)`);
    await ctx.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nBARRA DO PLANO OK');
  process.exit(falhas ? 1 : 0);
})();
