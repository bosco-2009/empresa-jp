// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Melhoria 35: planos.html mostra "O que acontece depois de pagar" (etapas de pedido.html, textos do config.js)
// logo abaixo do botão de pagar e as dúvidas de checkout (config.faq com checkout: true), com link para cada uma.
// Melhoria 55: as dúvidas cobrem prazo, depois do pagamento, alterações e pagamento, com JSON-LD FAQPage validado.
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

  console.log('\n[2] Dúvidas antes de contratar (melhorias 35 e 55)');
  const esperadas = await p.evaluate(() => PBR_CONFIG.faq.filter((f) => f.checkout === true).map((f) => f.pergunta));
  const perguntas = await p.$$eval('#duvidas-pagamento .faq__pergunta', (xs) => xs.map((x) => x.textContent));
  ok(esperadas.length >= 4 && JSON.stringify(perguntas) === JSON.stringify(esperadas), esperadas.length + ' perguntas de compra do config.faq: ' + perguntas.join(' | '));
  ok(await p.textContent('#duvidas-pagamento-titulo') === 'Dúvidas antes de contratar', 'título "Dúvidas antes de contratar"');
  // Os quatro assuntos pedidos: prazo, depois do pagamento, formas de pagamento e alterações
  const assuntos = { prazo: /quanto tempo|prazo/i, depois: /preciso enviar|depois do pagamento/i, formas: /formas de pagamento/i, alteracoes: /altera/i };
  for (const [nome, re] of Object.entries(assuntos)) ok(perguntas.some((t) => re.test(t)), 'cobre o assunto: ' + nome);

  // JSON-LD FAQPage só desta página: igual ao que está na tela
  const lds = await p.$$eval('script[type="application/ld+json"]', (xs) => xs.map((x) => JSON.parse(x.textContent)));
  const faqs = lds.flatMap((x) => x['@graph'] || [x]).filter((x) => x['@type'] === 'FAQPage');
  ok(faqs.length === 1, 'um único FAQPage na página (' + faqs.length + ')');
  const fp = faqs[0] || { mainEntity: [] };
  const canonical = await p.getAttribute('link[rel="canonical"]', 'href');
  ok(fp['@context'] === 'https://schema.org' && fp.url === canonical && fp['@id'] === canonical + '#duvidas-pagamento', 'FAQPage com @context, url canônica e @id da seção: ' + fp['@id']);
  const respostasTela = await p.$$eval('#duvidas-pagamento .faq__resposta', (xs) => xs.map((x) => x.textContent));
  ok(JSON.stringify(fp.mainEntity.map((q) => q.name)) === JSON.stringify(perguntas), 'perguntas do JSON-LD = perguntas exibidas, na ordem');
  ok(JSON.stringify(fp.mainEntity.map((q) => q.acceptedAnswer && q.acceptedAnswer.text)) === JSON.stringify(respostasTela), 'respostas do JSON-LD = respostas exibidas');
  ok(fp.mainEntity.every((q) => q['@type'] === 'Question' && q.acceptedAnswer['@type'] === 'Answer' && q.name.trim() && q.acceptedAnswer.text.trim()),
    'cada item é Question com Answer e texto');
  ok(fp.mainEntity.every((q) => !/\[PROVIS|<[a-z]/i.test(q.name + q.acceptedAnswer.text)), 'sem [PROVISÓRIO] nem HTML no texto');
  ok(await p.$$eval('#duvidas-pagamento details.faq__item > summary', (xs) => xs.length) === perguntas.length, 'cada dúvida é um <details> com <summary>');
  const ids = await p.$$eval('#duvidas-pagamento .faq__item', (xs) => xs.map((x) => x.id));
  ok(ids.every((i) => /^faq-[a-z0-9-]+$/.test(i)), 'cada pergunta tem id para link direto');
  ok(await p.$$eval('#duvidas-pagamento [data-faq-copiar]', (xs) => xs.length) === perguntas.length, '"Copiar link" em cada pergunta');
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
  ok(await h.$$eval('script[data-ld-faq]', (xs) => xs.length) === 0, 'a home não ganha o FAQPage filtrado (mantém o completo)');
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
