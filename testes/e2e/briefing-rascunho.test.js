// Rascunho do briefing (item 43 do MELHORIAS.md): respostas salvas por etapa no localStorage (sem token nem conteúdo de
// arquivos), retomada na etapa onde parou após recarregar, "Limpar rascunho" com confirmação acessível (Esc cancela),
// volta ao briefing já enviado quando existe; 4 larguras sem rolagem horizontal, console limpo e axe.
// Não precisa de Postgres: as RPCs do Supabase são respondidas pelo próprio Playwright.
// Uso: sirva a raiz (python3 -m http.server 8080) e rode  node testes/e2e/briefing-rascunho.test.js
const { chromium } = require('playwright');
const fs = require('fs');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const CODIGO = 'PBR-ABCDEF';
const TOKEN = 'ab'.repeat(32);
const CHAVE = 'pbr_briefing_rascunho_' + CODIGO;

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, largura, briefingServidor) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 800 } });
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
    if (url.endsWith('/rpc/briefing_obter')) corpo = [{ pedido_status: 'aprovado', plano_nome: 'Profissional', briefing: briefingServidor || null }];
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
const etapaVisivel = (p) => p.$eval('[data-etapa]:not([hidden])', (f) => Number(f.getAttribute('data-etapa')));
const semRolagem = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const rascunho = (p) => p.evaluate((k) => localStorage.getItem(k), CHAVE);
async function abrir(p, comHash) {
  await p.goto(SITE + 'briefing.html' + (comHash ? '#c=' + CODIGO + '&t=' + TOKEN : ''), { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-form-briefing]:not([hidden])');
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Sem briefing no servidor: salva, recarrega e retoma na etapa 3 (375 px)');
  const p = await novaPagina(browser, 375);
  await abrir(p, true);
  ok(await p.locator('[data-limpar-rascunho]').isHidden(), 'sem rascunho: "Limpar rascunho" oculto');
  ok(await rascunho(p) === null, 'abrir o formulário não cria rascunho');
  await p.fill('#b-nome_negocio', 'Doceria Exemplo');
  await p.fill('#b-publico', 'Famílias do bairro');
  await p.click('[data-etapa-proxima]');
  await p.fill('#b-objetivo', 'Receber encomendas pelo WhatsApp');
  await p.click('[data-etapa-proxima]');
  await p.waitForFunction((k) => (JSON.parse(localStorage.getItem(k) || '{}').etapa === 3), CHAVE);
  const bruto = await rascunho(p);
  ok(!bruto.includes(TOKEN), 'rascunho não guarda o token');
  ok(JSON.parse(bruto).dados.objetivo === 'Receber encomendas pelo WhatsApp', 'rascunho guarda as respostas');
  ok(await p.locator('[data-limpar-rascunho]').isVisible(), 'com rascunho: "Limpar rascunho" visível');

  await abrir(p, false);
  ok(await etapaVisivel(p) === 3, 'após recarregar: retoma na etapa 3');
  ok(await p.getAttribute('[data-indicador="3"]', 'aria-current') === 'step', 'indicador marca a etapa 3 como atual');
  ok((await p.textContent('[data-rascunho-status]')).includes('etapa 3 de 5'), 'aviso: "Continuando o rascunho... na etapa 3 de 5"');
  ok(await p.inputValue('#b-nome_negocio') === 'Doceria Exemplo' && await p.inputValue('#b-objetivo') === 'Receber encomendas pelo WhatsApp', 'respostas restauradas');
  await p.click('[data-etapa-anterior]');
  await p.waitForFunction((k) => (JSON.parse(localStorage.getItem(k) || '{}').etapa === 2), CHAVE);
  ok(true, 'voltar de etapa também atualiza a etapa salva');
  await axe(p, 'etapa 2 com rascunho');

  console.log('\n[2] Limpar rascunho: confirmação, Esc cancela, Apagar limpa');
  await p.click('[data-limpar-rascunho]');
  ok(await p.locator('[data-confirmar-limpeza]').isVisible(), 'confirmação aparece');
  ok(await p.evaluate(() => document.activeElement.hasAttribute('data-confirmar-limpar')), 'foco no botão "Apagar rascunho"');
  await axe(p, 'confirmação aberta');
  await p.locator('.briefing__rascunho').screenshot({ path: SAIDA + '/briefing-rascunho-confirmar-375.png' });
  await p.keyboard.press('Escape');
  ok(await p.locator('[data-confirmar-limpeza]').isHidden() && await p.evaluate(() => document.activeElement.hasAttribute('data-limpar-rascunho')), 'Esc fecha e devolve o foco a "Limpar rascunho"');
  ok(await rascunho(p) !== null, 'cancelar mantém o rascunho');
  await p.click('[data-limpar-rascunho]');
  await p.click('[data-confirmar-limpar]');
  ok(await rascunho(p) === null, 'rascunho apagado do localStorage');
  ok(await etapaVisivel(p) === 1 && await p.inputValue('#b-nome_negocio') === '', 'formulário volta vazio na etapa 1');
  ok(await p.evaluate(() => document.activeElement.id === 'b-nome_negocio'), 'foco no primeiro campo');
  ok((await p.textContent('[data-rascunho-status]')).includes('Rascunho apagado'), 'aviso "Rascunho apagado" (aria-live)');
  await p.waitForTimeout(700);
  ok(await rascunho(p) === null, 'nada é regravado depois de apagar');
  await abrir(p, false);
  ok(await etapaVisivel(p) === 1 && await p.locator('[data-limpar-rascunho]').isHidden(), 'recarregar depois de limpar: etapa 1, sem botão');
  ok(p.erros.length === 0, 'console sem erros' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
  await p.context().close();

  console.log('\n[3] Com briefing já enviado: rascunho mais novo vence; limpar volta ao enviado');
  const servidor = { status: 'novo', atualizado_em: '2026-01-01T00:00:00Z', nome_negocio: 'Nome Enviado', segmento: 'Confeitaria' };
  const q = await novaPagina(browser, 1280, servidor);
  await q.goto(SITE + 'termos.html');
  await q.evaluate(([k, a]) => {
    localStorage.setItem('pbr_briefing_acesso', JSON.stringify(a));
    localStorage.setItem(k, JSON.stringify({ salvo_em: new Date().toISOString(), etapa: 9, dados: { nome_negocio: 'Nome do Rascunho' } }));
  }, [CHAVE, { codigo: CODIGO, token: TOKEN }]);
  await abrir(q, false);
  ok(await etapaVisivel(q) === 5, 'etapa salva fora do limite é ajustada (9 → 5)');
  ok(await q.inputValue('#b-nome_negocio') === 'Nome do Rascunho', 'rascunho mais novo que o enviado é usado');
  await q.click('[data-limpar-rascunho]');
  await q.screenshot({ path: SAIDA + '/briefing-rascunho-confirmar-1280.png' });
  await q.click('[data-confirmar-limpar]');
  ok(await q.inputValue('#b-nome_negocio') === 'Nome Enviado' && await q.inputValue('#b-segmento') === 'Confeitaria', 'limpar volta ao briefing enviado');
  ok((await q.textContent('[data-rascunho-status]')).includes('briefing que você já enviou'), 'aviso explica que voltou ao enviado');
  ok(q.erros.length === 0, 'console sem erros (1280)');
  await q.context().close();

  console.log('\n[4] Larguras: sem rolagem horizontal com a confirmação aberta');
  for (const largura of [320, 375, 768, 1280]) {
    const r = await novaPagina(browser, largura);
    await abrir(r, true);
    await r.fill('#b-nome_negocio', 'Loja Exemplo');
    await r.click('[data-etapa-proxima]');
    await r.waitForFunction((k) => localStorage.getItem(k), CHAVE);
    await r.click('[data-limpar-rascunho]');
    ok(await semRolagem(r), `sem rolagem horizontal (${largura}px)`);
    await r.locator('[data-confirmar-limpeza]').scrollIntoViewIfNeeded();
    await r.screenshot({ path: SAIDA + `/briefing-rascunho-${largura}.png` });
    if (largura === 320) {
      await r.emulateMedia({ colorScheme: 'dark' });
      await axe(r, 'confirmação no modo escuro (320)');
      await r.screenshot({ path: SAIDA + '/briefing-rascunho-320-escuro.png' });
    }
    ok(r.erros.length === 0, `console sem erros (${largura}px)` + (r.erros.length ? ' -> ' + r.erros.join(' | ') : ''));
    await r.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
