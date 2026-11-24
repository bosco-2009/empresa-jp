// Melhoria 102: erros de campo em planos.html e briefing.html ligados por aria-describedby e anunciados UMA vez.
//  - cada erro tem id próprio e único, citado em aria-describedby do seu campo (sem ids soltos);
//  - aria-invalid coerente: só com erro mostrado; corrigido, sai da descrição acessível (árvore do Chromium)
//    — inclusive no briefing, onde antes o texto ficava escondido mas continuava sendo lido;
//  - a descrição começa com "Erro:" (só para leitor de tela);
//  - ao sair de um campo com erro novo: um anúncio polite "Erro em <campo>: ..."; sair de novo sem mudar não repete;
//  - no envio: o resumo recebe o foco e NENHUM anúncio extra é feito (o aviso não se repete);
//  - 320 e 1280 px: sem rolagem horizontal, axe sem violações sérias, console limpo, screenshots.
// Uso: sirva a raiz (python3 -m http.server 8080) e rode  node testes/e2e/erros-campos.test.js
const { chromium } = require('playwright');
const fs = require('fs');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const CODIGO = 'PBR-ABCDEF';
const TOKEN = 'cd'.repeat(32);

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, largura) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 800 } });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ }
    // Registra todo texto não vazio que entra na região de anúncio dos erros de campo
    window.__anuncios = [];
    new MutationObserver(() => {
      document.querySelectorAll('[data-anuncio-erro-campo]').forEach((r) => {
        const t = r.textContent.trim();
        if (t && r.__ultimo !== t) window.__anuncios.push(t);
        r.__ultimo = t;
      });
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route(/https:\/\/[a-z0-9]+\.supabase\.co\/.*/, (r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    let corpo = [];
    if (r.request().url().endsWith('/rpc/briefing_obter')) corpo = [{ pedido_status: 'aprovado', plano_nome: 'Profissional', briefing: null }];
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
async function ax(p, seletor) {
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: seletor });
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  await cdp.detach();
  const n = nodes[0] || {};
  return { descricao: (n.description && n.description.value) || '',
    invalido: (n.properties || []).some((x) => x.name === 'invalid' && x.value.value !== 'false') };
}
const anuncios = (p) => p.evaluate(() => window.__anuncios.slice());
// Todo id citado em aria-describedby existe, e cada .campo__erro tem id único citado por exatamente um campo
const idsCoerentes = (p) => p.evaluate(() => {
  const problemas = [];
  document.querySelectorAll('[aria-describedby]').forEach((e) => e.getAttribute('aria-describedby').split(/\s+/).filter(Boolean)
    .forEach((id) => { if (!document.getElementById(id)) problemas.push('id solto ' + id); }));
  const vistos = new Set();
  document.querySelectorAll('.campo__erro').forEach((e) => {
    if (!e.id || vistos.has(e.id)) problemas.push('erro sem id único ' + e.id);
    vistos.add(e.id);
    const n = document.querySelectorAll('[aria-describedby~="' + e.id + '"]').length;
    if (n !== 1) problemas.push(e.id + ' citado por ' + n + ' campos');
  });
  document.querySelectorAll('[aria-invalid="true"]').forEach((c) => {
    const ids = (c.getAttribute('aria-describedby') || '').split(/\s+/);
    if (!ids.some((id) => { const e = document.getElementById(id); return e && e.classList.contains('campo__erro') && !e.hidden && e.textContent.trim(); }))
      problemas.push('inválido sem mensagem visível: ' + c.id);
  });
  return problemas;
});

(async () => {
  const browser = await chromium.launch();

  for (const w of [320, 1280]) {
    console.log(`\n[planos.html ${w} px]`);
    const p = await novaPagina(browser, w);
    await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
    ok((await idsCoerentes(p)).length === 0, 'ids de erro únicos e coerentes antes de qualquer erro');

    // Erro ao sair do campo: anunciado uma vez
    await p.fill('#checkout-email', 'maria@');
    await p.focus('#checkout-whatsapp'); // blur do e-mail
    await p.waitForTimeout(250);
    let a = await ax(p, '#checkout-email');
    ok(a.invalido && a.descricao.startsWith('O comprovante') && a.descricao.includes('Erro: Informe um e-mail válido'),
      'e-mail inválido: aria-invalid + dica + "Erro: ..." na descrição (' + a.descricao + ')');
    let an = await anuncios(p);
    ok(an.length === 1 && an[0].startsWith('Erro em E-mail: Informe um e-mail válido'), 'um anúncio ao sair do campo: ' + JSON.stringify(an));
    await p.focus('#checkout-email');
    await p.focus('#checkout-whatsapp'); // sai de novo sem mudar nada
    await p.waitForTimeout(250);
    ok((await anuncios(p)).length === 1, 'sair de novo com o mesmo erro não repete o anúncio');
    ok((await idsCoerentes(p)).length === 0, 'coerência com 1 erro: ' + JSON.stringify(await idsCoerentes(p)));

    // Corrigir: aria-invalid e mensagem saem da descrição
    await p.fill('#checkout-email', 'maria@exemplo.com');
    a = await ax(p, '#checkout-email');
    ok(!a.invalido && !a.descricao.includes('Erro') && !a.descricao.includes('Informe'), 'corrigido: nada de erro na descrição (' + a.descricao + ')');

    // Envio com erros: o resumo é focado e nada mais é anunciado
    const antes = (await anuncios(p)).length;
    await p.click('[data-botao-pagar]');
    await p.waitForTimeout(400);
    ok(await p.evaluate(() => document.activeElement && document.activeElement.id === 'checkout-resumo-erros'), 'envio: foco no resumo');
    ok((await anuncios(p)).length === antes, 'envio: nenhum anúncio extra além do resumo');
    for (const k of ['nome', 'whatsapp', 'aceite']) {
      const d = await ax(p, '#checkout-' + k);
      ok(d.invalido && d.descricao.includes('Erro: '), k + ': inválido com "Erro: ..." na descrição');
    }
    ok(!(await ax(p, '#checkout-email')).invalido, 'e-mail válido continua sem aria-invalid');
    ok((await idsCoerentes(p)).length === 0, 'coerência com 3 erros: ' + JSON.stringify(await idsCoerentes(p)));
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sem rolagem horizontal');
    await axe(p, `planos ${w}px com erros`);
    await p.screenshot({ path: `${SAIDA}/erros-campos-planos-${w}.png`, fullPage: false });
    ok(p.erros.length === 0, 'console sem erros' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();

    console.log(`\n[briefing.html ${w} px]`);
    const b = await novaPagina(browser, w);
    await b.goto(SITE + 'briefing.html#c=' + CODIGO + '&t=' + TOKEN, { waitUntil: 'networkidle' });
    await b.waitForSelector('[data-form-briefing]:not([hidden])');
    ok((await idsCoerentes(b)).length === 0, 'ids de erro únicos e coerentes (inclusive os links criados pelo JS)');
    await b.click('[data-etapa-proxima]');
    await b.waitForTimeout(300);
    let d = await ax(b, '#b-nome_negocio');
    ok(d.invalido && d.descricao === 'Erro: Informe o nome do negócio.', 'nome vazio: "Erro: ..." na descrição (' + d.descricao + ')');
    ok((await anuncios(b)).length === 0, 'avançar com erro: só o resumo focado, sem anúncio repetido');
    await b.fill('#b-nome_negocio', 'Doceria Exemplo');
    d = await ax(b, '#b-nome_negocio');
    ok(!d.invalido && d.descricao === '', 'corrigido: a mensagem escondida não fica mais na descrição (' + d.descricao + ')');
    await b.click('[data-etapa-proxima]');
    await b.fill('#b-referencias-1', 'exemplo.com');
    await b.click('[data-etapa-proxima]');
    await b.waitForTimeout(300);
    d = await ax(b, '#b-referencias-1');
    ok(d.invalido && d.descricao.startsWith('Erro: Cole um link completo'), 'link inválido descrito como erro');
    ok((await idsCoerentes(b)).length === 0, 'coerência na etapa 2 com erro');
    await axe(b, `briefing ${w}px com erro`);
    await b.screenshot({ path: `${SAIDA}/erros-campos-briefing-${w}.png` });
    await b.fill('#b-referencias-1', 'https://exemplo.com');
    d = await ax(b, '#b-referencias-1');
    ok(!d.invalido && d.descricao === '', 'link corrigido: descrição limpa');
    ok(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sem rolagem horizontal');
    ok(b.erros.length === 0, 'console sem erros' + (b.erros.length ? ' -> ' + b.erros.join(' | ') : ''));
    await b.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
