// Melhoria 59: resumo de erros no topo dos formulários (padrão GOV.UK) em planos.html e briefing.html.
//  - ao tentar avançar com erros: resumo "Corrija N campos" visível, com o foco, título no nome acessível do grupo;
//  - um link por campo com erro, que leva o foco ao campo (pelo teclado: Tab + Enter);
//  - cada campo com aria-invalid e a mensagem na descrição acessível (aria-describedby, árvore do Chromium);
//  - campo corrigido sai da lista na hora e o título acompanha; tudo certo → o resumo some;
//  - briefing: resumo por etapa (some ao trocar de etapa), links repetidos identificados pelo rótulo ("Referência 1: ...");
//  - 320/375/768/1280 px sem rolagem horizontal, console limpo, axe sem violações sérias (claro e escuro), screenshots.
// Não precisa de Postgres: as RPCs do briefing são respondidas pelo Playwright.
// Uso: sirva a raiz (python3 -m http.server 8080) e rode  node testes/e2e/resumo-erros.test.js
const { chromium } = require('playwright');
const fs = require('fs');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const CODIGO = 'PBR-ABCDEF';
const TOKEN = 'cd'.repeat(32);
const LARGURAS = [320, 375, 768, 1280];

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, largura, opcoes) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: largura, height: 800 } }, opcoes || {}));
  await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route(/https:\/\/[a-z0-9]+\.supabase\.co\/.*/, (r) => {
    const url = r.request().url();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    let corpo = [];
    if (url.endsWith('/rpc/briefing_obter')) corpo = [{ pedido_status: 'aprovado', plano_nome: 'Profissional', briefing: null }];
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(corpo) });
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
// Nome/descrição acessíveis calculados pelo próprio Chromium (o que o leitor de tela anuncia)
async function ax(p, seletor) {
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: seletor });
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  await cdp.detach();
  const n = nodes[0] || {};
  return { nome: (n.name && n.name.value) || '', descricao: (n.description && n.description.value) || '',
    invalido: (n.properties || []).some((x) => x.name === 'invalid' && x.value.value !== 'false') };
}
const semRolagem = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const resumo = (p, id) => p.evaluate((id) => {
  const c = document.getElementById(id);
  if (!c) return null;
  return {
    visivel: !c.hidden && c.getBoundingClientRect().height > 0,
    focado: document.activeElement === c,
    titulo: c.querySelector('h2').textContent,
    links: [...c.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), texto: a.textContent })),
    noTopo: c.getBoundingClientRect().top >= 0 && c.getBoundingClientRect().top < window.innerHeight
  };
}, id);
const focoId = (p) => p.evaluate(() => document.activeElement && document.activeElement.id);
async function tabAte(p, seletor) {
  for (let i = 0; i < 40; i++) {
    await p.keyboard.press('Tab');
    if (await p.evaluate((s) => document.activeElement && document.activeElement.matches(s), seletor)) return true;
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] planos.html: envio vazio pelo teclado');
  {
    const p = await novaPagina(browser, 375, { isMobile: true, hasTouch: true });
    await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
    ok(await p.$('#checkout-resumo-erros[hidden]') !== null, 'resumo criado oculto antes de qualquer erro');
    await p.focus('#checkout-nome');
    await p.keyboard.press('Enter'); // envia o formulário pelo teclado
    await p.waitForTimeout(400);
    let r = await resumo(p, 'checkout-resumo-erros');
    ok(r.visivel && r.focado, 'resumo visível e com o foco');
    ok(r.noTopo, 'resumo rolado para a tela');
    ok(r.titulo === 'Corrija 4 campos para continuar', 'título com a contagem: ' + r.titulo);
    ok(JSON.stringify(r.links.map((l) => l.href)) === JSON.stringify(['#checkout-nome', '#checkout-email', '#checkout-whatsapp', '#checkout-aceite']),
      'um link por campo, na ordem do formulário');
    const grupo = await ax(p, '#checkout-resumo-erros');
    ok(grupo.nome === 'Corrija 4 campos para continuar', 'nome acessível do resumo = título');
    for (const k of ['nome', 'email', 'whatsapp', 'aceite']) {
      const a = await ax(p, '#checkout-' + k);
      const msg = await p.$eval('#checkout-' + k + '-erro', (e) => e.textContent);
      ok(a.invalido && a.descricao.includes(msg), k + ': inválido e com a mensagem na descrição acessível');
    }
    await p.screenshot({ path: SAIDA + '/resumo-erros-planos-375.png' });

    // Teclado: Tab até o 2º link (e-mail) e Enter leva o foco ao campo
    ok(await tabAte(p, '#checkout-resumo-erros a[href="#checkout-email"]'), 'links do resumo alcançáveis pelo Tab');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
    ok(await focoId(p) === 'checkout-email', 'Enter no link leva o foco ao campo de e-mail');
    ok(await p.evaluate(() => { const l = document.querySelector('label[for="checkout-email"]').getBoundingClientRect(); return l.top >= 0 && l.bottom <= innerHeight; }),
      'o rótulo do campo fica visível');

    // Corrigir um campo tira o item do resumo
    await p.fill('#checkout-email', 'nome@exemplo.com');
    r = await resumo(p, 'checkout-resumo-erros');
    ok(r.titulo === 'Corrija 3 campos para continuar' && !r.links.some((l) => l.href === '#checkout-email'), 'e-mail corrigido sai da lista (3 campos)');
    await p.fill('#checkout-nome', 'Maria Exemplo');
    await p.fill('#checkout-whatsapp', '11912345678');
    r = await resumo(p, 'checkout-resumo-erros');
    ok(r.titulo === 'Corrija 1 campo para continuar', 'singular com 1 campo');
    await p.click('[data-resumo-erros] a');
    ok(await focoId(p) === 'checkout-aceite', 'clique no link foca a caixa de aceite');
    await p.check('#checkout-aceite');
    r = await resumo(p, 'checkout-resumo-erros');
    ok(!r.visivel, 'tudo certo: o resumo some');
    ok(p.erros.length === 0, 'console sem erros' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[2] briefing.html: resumo por etapa');
  {
    const p = await novaPagina(browser, 375, { isMobile: true, hasTouch: true });
    await p.goto(SITE + 'briefing.html#c=' + CODIGO + '&t=' + TOKEN, { waitUntil: 'networkidle' });
    await p.waitForSelector('[data-form-briefing]:not([hidden])');
    await p.click('[data-etapa-proxima]');
    await p.waitForTimeout(400);
    let r = await resumo(p, 'b-resumo-erros');
    ok(r.visivel && r.focado && r.titulo === 'Corrija 1 campo para continuar', 'etapa 1 sem nome: resumo com 1 campo e foco');
    ok(r.links[0].href === '#b-nome_negocio' && r.links[0].texto === 'Informe o nome do negócio.', 'link para o nome do negócio');
    await p.keyboard.press('Tab');
    await p.keyboard.press('Enter');
    ok(await focoId(p) === 'b-nome_negocio', 'Tab + Enter leva ao campo');
    await p.keyboard.type('Doceria Exemplo');
    ok(!(await resumo(p, 'b-resumo-erros')).visivel, 'nome válido: resumo some enquanto digita');
    ok(await p.$eval('#b-nome_negocio', (e) => !e.hasAttribute('aria-invalid')), 'campo deixa de ser inválido');
    await p.click('[data-etapa-proxima]');
    await p.fill('#b-referencias-1', 'exemplo.com');
    await p.fill('#b-referencias-2', 'www.outro');
    await p.click('[data-etapa-proxima]');
    await p.waitForTimeout(400);
    r = await resumo(p, 'b-resumo-erros');
    ok(r.titulo === 'Corrija 2 campos para continuar', 'etapa 2: 2 links errados');
    ok(r.links[0].texto.startsWith('Referência 1: ') && r.links[1].texto.startsWith('Referência 2: '), 'mensagens repetidas identificadas pelo rótulo');
    const a = await ax(p, '#b-referencias-1');
    ok(a.invalido && a.descricao.includes('https://'), 'referência 1 inválida com a mensagem na descrição acessível');
    await p.screenshot({ path: SAIDA + '/resumo-erros-briefing-375.png' });
    await axe(p, 'briefing com resumo, 375 px');
    await p.click('[data-etapa-anterior]');
    ok(!(await resumo(p, 'b-resumo-erros')).visivel, 'trocar de etapa esconde o resumo');
    ok(p.erros.length === 0, 'console sem erros' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[3] 4 larguras, claro e escuro: rolagem, axe e console com o resumo aberto');
  for (const esquema of ['light', 'dark']) {
    for (const w of LARGURAS) {
      const p = await novaPagina(browser, w, { colorScheme: esquema });
      await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
      await p.click('[data-botao-pagar]');
      await p.waitForTimeout(500);
      ok((await resumo(p, 'checkout-resumo-erros')).visivel, `planos ${w}px ${esquema}: resumo visível`);
      ok(await semRolagem(p), `planos ${w}px ${esquema}: sem rolagem horizontal`);
      if (w === 320 || w === 1280) await axe(p, `planos ${w}px ${esquema}`);
      if (w === 320 || w === 1280) await p.screenshot({ path: `${SAIDA}/resumo-erros-planos-${w}-${esquema}.png` });

      await p.goto(SITE + 'briefing.html#c=' + CODIGO + '&t=' + TOKEN, { waitUntil: 'networkidle' });
      await p.waitForSelector('[data-form-briefing]:not([hidden])');
      await p.click('[data-etapa-proxima]');
      await p.waitForTimeout(400);
      ok((await resumo(p, 'b-resumo-erros')).visivel, `briefing ${w}px ${esquema}: resumo visível`);
      ok(await semRolagem(p), `briefing ${w}px ${esquema}: sem rolagem horizontal`);
      if (w === 320 || w === 1280) await axe(p, `briefing ${w}px ${esquema}`);
      if (w === 1280) await p.screenshot({ path: `${SAIDA}/resumo-erros-briefing-${w}-${esquema}.png` });
      ok(p.erros.length === 0, `${w}px ${esquema}: console sem erros` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
      await p.context().close();
    }
  }

  console.log('\n[4] Movimento reduzido: rolagem instantânea, mesmo comportamento');
  {
    const p = await novaPagina(browser, 375, { reducedMotion: 'reduce' });
    await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
    await p.click('[data-botao-pagar]');
    const r = await resumo(p, 'checkout-resumo-erros'); // sem espera: rolagem 'auto' é imediata
    ok(r.visivel && r.focado && r.noTopo, 'resumo focado e na tela sem animação');
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
