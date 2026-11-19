// Uso: veja testes/README.md (precisa só do servidor estático em :8080; a Edge Function é simulada aqui)
// Microinterações (item 16 do MELHORIAS.md): hover/pressionar nos botões e cards, carregando no checkout,
// tremor do campo inválido, "+" do FAQ girando, tudo desligado com prefers-reduced-motion.
const { chromium } = require('playwright');

const SITE = process.env.SITE || 'http://localhost:8080/';
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, opcoes = {}, caminho = '') {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  await p.goto(SITE + caminho, { waitUntil: 'networkidle' });
  return p;
}
const estilo = (p, sel, prop, pseudo) => p.$eval(sel, (el, [prop, pseudo]) => getComputedStyle(el, pseudo || null)[prop], [prop, pseudo]);

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Hover em botões e cards (home)');
  {
    const p = await abrir(browser);
    await p.hover('.hero .botao--primario');
    await p.waitForTimeout(350);
    ok(await estilo(p, '.hero .botao--primario', 'translate') === '0px -2px' && await estilo(p, '.hero .botao--primario', 'boxShadow') !== 'none', 'botão principal levanta com sombra');
    const seg = p.locator('.segmento').first();
    await seg.scrollIntoViewIfNeeded();
    await p.waitForTimeout(1200); // revelado pela rolagem
    await seg.hover();
    await p.waitForTimeout(350);
    const t = await seg.evaluate((el) => [getComputedStyle(el).translate, el.classList.contains('revelado'), getComputedStyle(el).transform]);
    ok(t[0] === '0px -3px' && t[1] && t[2] === 'none', 'card revelado também levanta no hover (translate soma com a revelação)');
    await p.locator('#faq-tem-mensalidade summary').click();
    await p.waitForTimeout(350);
    ok(await estilo(p, '#faq-tem-mensalidade .faq__pergunta', 'rotate', '::after') === '180deg', 'FAQ: o "+" gira ao abrir');
    ok(p.erros.length === 0, 'console limpo');
    await p.context().close();
  }

  console.log('\n[2] Checkout: carregando e tremor do campo inválido');
  {
    const p = await abrir(browser, {}, 'planos.html');
    await p.click('[data-botao-pagar]');
    await p.waitForTimeout(50);
    ok(await estilo(p, '#checkout-nome', 'animationName') === 'tremer', 'campo inválido treme uma vez');
    let liberar;
    const espera = new Promise((r) => { liberar = r; });
    await p.route('**/functions/v1/criar-pagamento', async (r) => { await espera; await r.fulfill({ status: 500, contentType: 'application/json', body: '{"erro":"falha_pedido"}' }); });
    await p.fill('#checkout-nome', 'Ana Teste');
    await p.fill('#checkout-email', 'ana@exemplo.com');
    await p.fill('#checkout-whatsapp', '(11) 98888-7777');
    await p.check('#checkout-aceite');
    await p.click('[data-botao-pagar]');
    await p.waitForTimeout(150);
    const b = '[data-botao-pagar]';
    const c = await p.$eval(b, (el) => ({ attr: el.hasAttribute('data-carregando'), dis: el.disabled, icone: getComputedStyle(el.querySelector('.icone')).display, anim: getComputedStyle(el, '::before').animationName, texto: el.textContent.trim() }));
    ok(c.attr && c.dis && c.icone === 'none' && c.anim === 'girar-botao', 'botão em "carregando": desabilitado, indicador girando no lugar do ícone');
    ok(c.texto === 'Preparando o pagamento…' && await p.getAttribute('[data-form-checkout]', 'aria-busy') === 'true', 'texto diz o que acontece; formulário aria-busy');
    liberar();
    await p.waitForSelector('[data-erro-checkout]:not([hidden])');
    ok(!(await p.$eval(b, (el) => el.hasAttribute('data-carregando') || el.disabled)), 'erro: botão volta ao normal');
    await p.context().close();
  }

  console.log('\n[3] Movimento reduzido');
  {
    const p = await abrir(browser, { reducedMotion: 'reduce' }, 'planos.html');
    await p.click('[data-botao-pagar]');
    await p.waitForTimeout(50);
    ok(await estilo(p, '#checkout-nome', 'animationName') === 'none', 'sem tremor');
    await p.$eval('[data-botao-pagar]', (el) => el.setAttribute('data-carregando', ''));
    ok(await estilo(p, '[data-botao-pagar]', 'animationName', '::before') === 'none', 'indicador parado (sem girar)');
    await p.hover('[data-botao-pagar]');
    await p.waitForTimeout(100);
    ok(await estilo(p, '[data-botao-pagar]', 'translate') === 'none', 'botão não levanta');
    await p.context().close();
  }

  console.log('\n[4] Toque (sem hover)');
  {
    const p = await abrir(browser, { viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true }, 'blog/');
    ok(await p.evaluate(() => matchMedia('(hover: none)').matches), 'dispositivo de toque emulado');
    await p.hover('.blog-cartao');
    await p.waitForTimeout(300);
    ok(await estilo(p, '.blog-cartao', 'translate') === 'none', 'no toque o cartão não fica "levantado" preso');
    const regra = await p.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.conditionText === '(hover: none)' && r.cssText.includes('.blog-cartao:active')); } catch (e) { return false; } }));
    ok(regra, 'cartões clicáveis afundam ao toque (:active em @media (hover: none))');
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE MICROINTERAÇÕES PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
