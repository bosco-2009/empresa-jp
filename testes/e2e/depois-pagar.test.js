// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Melhoria 35: planos.html mostra "O que acontece depois de pagar" (etapas de pedido.html, textos do config.js)
// logo abaixo do botão de pagar e as dúvidas de checkout (config.faq com checkout: true), com link para cada uma.
const { chromium } = require('playwright');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, url, opcoes = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  await p.goto(SITE + url, { waitUntil: 'networkidle' });
  return p;
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] O que acontece depois de pagar');
  const p = await abrir(browser, 'planos.html?plano=essencial');
  const cfg = await p.evaluate(() => PBR_CONFIG.depoisDoPagamento);
  ok(await p.isVisible('[data-depois-pagar]'), 'bloco visível');
  ok(await p.evaluate(() => {
    const botao = document.querySelector('[data-botao-pagar]');
    const bloco = document.querySelector('[data-depois-pagar]');
    return botao.form === bloco.closest('form') && (botao.compareDocumentPosition(bloco) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), 'fica logo abaixo do botão de pagar, no mesmo formulário');
  ok(await p.textContent('#depois-pagar-titulo') === cfg.titulo, 'título do config.js');
  const titulos = await p.$$eval('.depois-pagar__etapa-titulo', (xs) => xs.map((x) => x.textContent));
  ok(JSON.stringify(titulos) === JSON.stringify(cfg.etapas.map((e) => e.titulo)), 'etapas do config.js, na ordem: ' + titulos.join(' → '));
  const prazo = () => p.$$eval('.depois-pagar__texto', (xs) => xs.map((x) => x.textContent).join(' '));
  const prazos = await p.evaluate(() => Object.fromEntries(PBR_CONFIG.planos.map((x) => [x.id, x.prazo])));
  ok((await prazo()).includes(prazos.essencial) && !(await prazo()).includes('{prazo}'), 'prazo do plano escolhido no lugar de {prazo}');
  await p.check('input[name="plano"][value="premium"]', { force: true });
  ok((await prazo()).includes(prazos.premium) && !(await prazo()).includes(prazos.essencial), 'trocar o plano atualiza o prazo');
  ok(!(await prazo()).includes('..'), 'sem ponto duplicado');
  ok(await p.isVisible('[data-depois-acompanhar]'), 'nota sobre o link de acompanhamento');

  console.log('\n[2] Dúvidas sobre o pagamento');
  const esperadas = await p.evaluate(() => PBR_CONFIG.faq.filter((f) => f.checkout === true).map((f) => f.pergunta));
  const perguntas = await p.$$eval('#duvidas-pagamento .faq__pergunta', (xs) => xs.map((x) => x.textContent));
  ok(esperadas.length === 3 && JSON.stringify(perguntas) === JSON.stringify(esperadas), '3 perguntas de checkout do config.faq: ' + perguntas.join(' | '));
  const ids = await p.$$eval('#duvidas-pagamento .faq__item', (xs) => xs.map((x) => x.id));
  ok(ids.every((i) => /^faq-[a-z0-9-]+$/.test(i)), 'cada pergunta tem id para link direto');
  ok(await p.$$eval('#duvidas-pagamento [data-faq-copiar]', (xs) => xs.length) === 3, '"Copiar link" em cada pergunta');
  await p.click('[data-depois-duvidas] a');
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => location.hash) === '#duvidas-pagamento', 'link "Veja as respostas" leva às dúvidas');
  const home = await p.evaluate(() => PBR_CONFIG.faq.length);
  await p.context().close();

  const q = await abrir(browser, 'planos.html#' + ids[1]);
  ok(await q.$eval('#' + ids[1], (d) => d.open), 'link direto #' + ids[1] + ' abre a pergunta');
  await q.context().close();

  const h = await abrir(browser, '');
  ok(await h.$$eval('#duvidas .faq__item', (xs) => xs.length) === home, 'a home continua com todas as perguntas (' + home + ')');
  await h.context().close();

  console.log('\n[3] Larguras, console e axe (claro e escuro)');
  for (const tema of ['light', 'dark']) {
    for (const w of [320, 375, 768, 1280]) {
      const r = await abrir(browser, 'planos.html?plano=profissional', { viewport: { width: w, height: 800 }, colorScheme: tema });
      const sw = await r.evaluate(() => document.documentElement.scrollWidth);
      await r.addScriptTag({ url: '/__axe.min.js' });
      const v = await r.evaluate(async () => (await axe.run({ include: [['[data-depois-pagar]'], ['#duvidas-pagamento']] })).violations
        .filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => x.id));
      ok(sw === w && !r.erros.length && !v.length, `${tema} ${w}px: sem rolagem, sem erros, axe ok ${v.join(',')} ${r.erros.join(' ')}`);
      await r.context().close();
    }
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE "DEPOIS DE PAGAR" PASSARAM');
  process.exit(falhas ? 1 : 0);
})();
