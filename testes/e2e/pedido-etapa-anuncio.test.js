// Anúncio de mudança de etapa no pedido.html (item 129 do MELHORIAS.md): quando uma nova consulta (volta à aba ou
// botão Atualizar) traz outra situação, a região viva da hora diz "O pedido mudou: <situação>." UMA vez (nada na
// carga, nada quando a situação se repete), a etapa atual ganha o destaque .etapas__item--recem e o foco não sai do
// lugar. Com prefers-reduced-motion o anel aparece sem animação. 4 larguras sem rolagem horizontal, console e axe.
// Não precisa de Postgres: a RPC pedido_acompanhar é respondida pelo próprio Playwright.
// Uso: sirva a raiz (python3 -m http.server 8080) e rode  node testes/e2e/pedido-etapa-anuncio.test.js
const { chromium } = require('playwright');
const fs = require('fs');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const CODIGO = 'PBR-ETAPA2';
const TOKEN = 'ef'.repeat(32);

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

const ONTEM = new Date(Date.now() - 86400000).toISOString();
const SITUACOES = {
  pendente: { pedido_status: 'pendente', etapa: 'pendente', briefing_status: null, pago_em: null, briefing_em: null, etapa_em: null },
  pago: { pedido_status: 'aprovado', etapa: 'pago', briefing_status: null, pago_em: ONTEM, briefing_em: null, etapa_em: ONTEM },
  briefing: { pedido_status: 'aprovado', etapa: 'briefing_recebido', briefing_status: 'recebido', pago_em: ONTEM, briefing_em: ONTEM, etapa_em: ONTEM },
  producao: { pedido_status: 'aprovado', etapa: 'em_producao', briefing_status: 'em_producao', pago_em: ONTEM, briefing_em: ONTEM, etapa_em: ONTEM }
};

async function novaPagina(browser, largura, opcoes) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: largura, height: 800 } }, opcoes || {}));
  await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  const p = await ctx.newPage();
  p.erros = [];
  p.situacao = 'pago';
  p.consultas = 0;
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route(/https:\/\/[a-z0-9]+\.supabase\.co\/.*/, (r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    let corpo = [];
    if (r.request().url().endsWith('/rpc/pedido_acompanhar')) {
      p.consultas++;
      corpo = [Object.assign({ codigo: CODIGO, plano_id: 'profissional', plano_nome: 'Profissional' }, SITUACOES[p.situacao])];
    }
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
const semRolagem = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const hora = (p) => p.textContent('[data-acompanhar-hora]');
const recem = (p) => p.$$eval('.etapas__item--recem', (els) => els.map((e) => e.getAttribute('aria-current')));
const anuncios = (t) => (t.match(/O pedido mudou/g) || []).length;

async function abrir(p) {
  await p.goto(SITE + 'pedido.html#c=' + CODIGO + '&t=' + TOKEN, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => /Atualizado às/.test(document.querySelector('[data-acompanhar-hora]').textContent));
}
// Nova consulta como na volta à aba: o intervalo mínimo é de 30 s, então o relógio da página é adiantado.
async function voltarAba(p) {
  const antes = p.consultas;
  await p.clock.fastForward(31000);
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForFunction(() => !document.querySelector('[data-acompanhar-atualizar]').hasAttribute('aria-disabled'));
  await p.waitForTimeout(100);
  return p.consultas > antes;
}
async function atualizar(p) {
  await p.focus('[data-acompanhar-atualizar]');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => !document.querySelector('[data-acompanhar-atualizar]').hasAttribute('aria-disabled'));
  await p.waitForFunction(() => /Atualizado às/.test(document.querySelector('[data-acompanhar-hora]').textContent));
}

(async () => {
  const browser = await chromium.launch();

  for (const largura of [320, 375, 768, 1280]) {
    console.log(`\n${largura} px`);
    const p = await novaPagina(browser, largura);
    await p.clock.install();
    await abrir(p);
    ok(anuncios(await hora(p)) === 0 && (await recem(p)).length === 0, 'carga: sem anúncio de mudança e sem destaque');
    ok(await p.locator('[data-acompanhar-hora][aria-live="polite"]').count() === 1, 'uma região viva educada (a da hora)');

    // O foco fica onde o visitante estava (no link do briefing) quando a etapa muda pela volta à aba.
    await p.focus('[data-link-briefing]');
    p.situacao = 'briefing';
    ok(await voltarAba(p), 'volta à aba depois de 30 s consulta de novo');
    let t = await hora(p);
    ok(anuncios(t) === 1 && /O pedido mudou: Recebemos o seu briefing\.$/.test(t), 'anuncia a nova situação uma vez: ' + JSON.stringify(t));
    ok(JSON.stringify(await recem(p)) === '["step"]', 'destaque só na etapa atual (aria-current)');
    ok(await p.evaluate(() => document.activeElement.matches('[data-link-briefing]')),
      'foco segue no link do briefing (agora "Revisar o briefing"), sem ir para o início');
    const anel = await p.$eval('.etapas__item--recem .etapas__marca', (e) => {
      const s = getComputedStyle(e, '::after');
      return { animacao: s.animationName, borda: s.borderTopWidth };
    });
    ok(anel.animacao === 'etapa-recem' && anel.borda === '2px', 'anel com animação sem movimento reduzido');
    ok(await semRolagem(p), 'sem rolagem horizontal com o destaque');
    await p.screenshot({ path: `${SAIDA}/pedido-etapa-anuncio-${largura}.png` });
    await axe(p, `nova etapa ${largura}`);

    // Mesma situação de novo: nada anunciado, destaque some.
    await atualizar(p);
    t = await hora(p);
    ok(anuncios(t) === 0 && (await recem(p)).length === 0, 'mesma situação: sem novo anúncio nem destaque');

    // Outra mudança (produção) pelo botão Atualizar: anuncia de novo, uma vez.
    p.situacao = 'producao';
    await atualizar(p);
    t = await hora(p);
    ok(anuncios(t) === 1 && /Seu site está em produção\.$/.test(t), 'produção anunciada uma vez');
    ok(await p.evaluate(() => document.activeElement.matches('[data-acompanhar-atualizar]')), 'foco continua no Atualizar');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\npendente → pago, movimento reduzido, escuro');
  const p = await novaPagina(browser, 375, { reducedMotion: 'reduce', colorScheme: 'dark' });
  p.situacao = 'pendente';
  await p.clock.install();
  await abrir(p);
  ok(anuncios(await hora(p)) === 0, 'pendente na carga: sem anúncio');
  p.situacao = 'pago';
  await voltarAba(p);
  const t = await hora(p);
  ok(/O pedido mudou: Pagamento confirmado! Falta o briefing\.$/.test(t), 'pagamento confirmado anunciado: ' + JSON.stringify(t));
  const anel = await p.$eval('.etapas__item--recem .etapas__marca', (e) => {
    const s = getComputedStyle(e, '::after');
    return { animacao: s.animationName, opacidade: s.opacity };
  });
  ok(anel.animacao === 'none' && anel.opacidade === '1', 'movimento reduzido: anel visível sem animação');
  await p.screenshot({ path: `${SAIDA}/pedido-etapa-anuncio-escuro.png` });
  await axe(p, 'escuro + movimento reduzido');
  ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
