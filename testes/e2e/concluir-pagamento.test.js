// Uso: veja testes/README.md (precisa do servidor estático, do Supabase falso e do Mercado Pago falso)
// Melhoria 100: obrigado.html com o pedido PENDENTE mostra "Como concluir o pagamento" (3 passos, sem prazos) e
// "Concluir pagamento no Mercado Pago", que reabre a MESMA preferência (criar-pagamento, modo reabrir, melhoria 39).
// Voltar sem pagar → passos + reabre a mesma preferência (sem pedido duplicado) → Pix gerado → reabrir recusado com
// aviso no role="alert" (que não some com as consultas repetidas) → Pix pago → "aprovado" e os passos somem.
// Retorno "approved"/"in_process" e navegador sem o pedido: sem passos. 4 larguras × claro/escuro, axe e console.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const MP = 'http://localhost:' + (process.env.PORTA_MP || 54400);
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const AXE = require.resolve('axe-core/axe.min.js');
const RAIZ = path.resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

const configOriginal = fs.readFileSync(RAIZ + '/config.js', 'utf8');
const configTeste = configOriginal
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

const psql = (sql) => execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novoContexto(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  return ctx;
}
async function novaPagina(ctx) {
  const p = await ctx.newPage();
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  return p;
}
async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}
const semRolagem = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const esperarEstado = (p, estado) => p.waitForFunction((e) => document.querySelector('[data-resultado]').getAttribute('data-estado') === e, estado, { timeout: 20000 });
const passos = (p) => p.locator('[data-como-concluir]');
const botao = (p) => p.locator('[data-concluir-pagamento]');

async function contratar(p, plano, email) {
  await p.goto(SITE + 'planos.html?plano=' + plano, { waitUntil: 'networkidle' });
  await p.fill('#checkout-nome', 'Nina Prado');
  await p.fill('#checkout-email', email);
  await p.fill('#checkout-whatsapp', '(41) 96666-3333');
  await p.check('#checkout-aceite');
  await Promise.all([p.waitForURL(MP + '/checkout**'), p.click('[data-botao-pagar]')]);
  return { pref: new URL(p.url()).searchParams.get('pref_id') };
}
async function idPedido(p) {
  await p.goto(SITE + 'planos.html', { waitUntil: 'domcontentloaded' });
  return p.evaluate(() => localStorage.getItem('pbr_ultimo_pedido'));
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await novoContexto(browser, { viewport: { width: 375, height: 812 } });
  const p = await novaPagina(ctx);
  const email = `concluir-${Date.now()}@teste.local`;

  console.log('\n1. Voltou do Mercado Pago sem pagar: passos e "Concluir pagamento"');
  const { pref } = await contratar(p, 'profissional', email);
  const id = await idPedido(p);
  const codigo = psql(`select codigo from public.pedidos where email = '${email}'`);
  await p.goto(SITE + `obrigado.html?external_reference=${id}&collection_status=null&status=null`, { waitUntil: 'networkidle' });
  await esperarEstado(p, 'pendente');
  await passos(p).waitFor();
  ok(await p.locator('#como-concluir-titulo').innerText() === 'Como concluir o pagamento', 'título "Como concluir o pagamento" (h2)');
  ok(await passos(p).locator('li').count() === 3, '3 passos numerados');
  const texto = await passos(p).innerText();
  ok(!/\d+\s*(min|minuto|hora|dia)/i.test(texto), 'sem prazos inventados nos passos');
  ok(!/Nina|Prado|96666|concluir-\d+@/.test(await p.locator('[data-resultado]').innerText()), 'sem nome, e-mail ou WhatsApp na tela');
  ok(await botao(p).isVisible(), 'botão "Concluir pagamento no Mercado Pago"');
  ok(/botao--contorno/.test(await p.getAttribute('[data-tentar-de-novo]', 'class')), '"Tentar de novo" vira secundário');
  ok(await p.locator('[data-resultado-acoes] .botao--primario').count() === 0, 'um único botão principal (o de concluir)');
  ok(await p.getAttribute('[data-acompanhar-link]', 'href') === 'pedido.html?pedido=' + encodeURIComponent(codigo), '"Acompanhar meu pedido" sem o token');
  ok(await p.evaluate(() => !!document.querySelector('[data-resultado][aria-live="polite"] [data-concluir-erro][role="alert"]')), 'aviso de erro num role="alert" dentro da região aria-live');
  await p.screenshot({ path: SAIDA + '/concluir-voltou-375.png', fullPage: true });

  console.log('\n2. "Concluir pagamento" reabre a MESMA preferência, sem pedido novo');
  await Promise.all([p.waitForURL(MP + '/checkout**'), botao(p).click()]);
  ok(new URL(p.url()).searchParams.get('pref_id') === pref, 'mesma preferência do Mercado Pago');
  ok(Number(psql(`select count(*) from public.pedidos where email = '${email}'`)) === 1, 'nenhum pedido duplicado');

  console.log('\n3. Pix gerado e não pago: passos continuam; reabrir é recusado com aviso');
  await Promise.all([p.waitForURL('**/obrigado.html**'), p.click('button:has-text("Gerar Pix (pendente)")')]);
  await esperarEstado(p, 'pendente');
  await passos(p).waitFor();
  ok(await botao(p).isVisible(), 'passos e botão com o Pix pendente');
  await botao(p).focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-concluir-erro]:not([hidden])');
  const erro = await p.textContent('[data-concluir-erro]');
  ok(/Já existe um Pix ou boleto gerado/.test(erro), 'explica o pagamento em andamento: ' + erro);
  ok(p.url().startsWith(SITE), 'continua no site');
  ok(!(await botao(p).getAttribute('aria-disabled')) && !(await botao(p).getAttribute('data-carregando')), 'botão liberado de novo');
  ok(await p.evaluate(() => document.activeElement && document.activeElement.matches('[data-concluir-pagamento]')), 'foco fica no botão');
  // a página consulta o status a cada 4 s: sem mudança, nada é redesenhado (o aviso não some nem é relido)
  const mudancas = await p.evaluate(() => new Promise((res) => {
    let n = 0;
    const obs = new MutationObserver((l) => { n += l.length; });
    obs.observe(document.querySelector('[data-resultado]'), { childList: true, subtree: true, characterData: true });
    setTimeout(() => { obs.disconnect(); res(n); }, 9000);
  }));
  ok(mudancas === 0, 'consultas repetidas não redesenham a região aria-live (' + mudancas + ' mudanças)');
  ok(await p.isVisible('[data-concluir-erro]'), 'aviso continua na tela');
  await p.screenshot({ path: SAIDA + '/concluir-erro-375.png', fullPage: true });
  await axe(p, 'pendente com aviso de erro');

  console.log('\n4. Pix pago: a página passa para "aprovado" e os passos somem');
  const registro = await (await fetch(MP + '/__registro')).json();
  const pix = Object.values(registro.pagamentos).find((x) => x.preference_id === pref && x.status === 'pending');
  await fetch(MP + '/__atualizar', { method: 'POST', body: JSON.stringify({ payment_id: pix.id, mudancas: { status: 'approved', status_detail: 'accredited' } }) });
  await esperarEstado(p, 'aprovado');
  ok(await passos(p).count() === 0 && await botao(p).count() === 0, 'sem passos nem botão de concluir');
  ok(await p.locator('[data-link-briefing]').isVisible(), 'mostra o briefing');
  ok(p.erros.filter((e) => !/status of 4\d\d/.test(e)).length === 0, 'sem erros de JS/CSP no console' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
  await ctx.close();

  console.log('\n5. Retorno "approved" (aguardando webhook) ou "in_process": sem passos');
  const ctx3 = await novoContexto(browser, { viewport: { width: 375, height: 812 } });
  const q = await novaPagina(ctx3);
  await contratar(q, 'essencial', `concluir3-${Date.now()}@teste.local`);
  const id3 = await idPedido(q);
  for (const st of ['approved', 'in_process']) {
    await q.goto(SITE + `obrigado.html?external_reference=${id3}&collection_status=${st}&status=${st}`, { waitUntil: 'networkidle' });
    await esperarEstado(q, 'pendente');
    await q.waitForTimeout(500);
    ok(await passos(q).count() === 0, `retorno ${st}: sem "Como concluir"`);
  }
  await q.goto(SITE + `obrigado.html?external_reference=${id3}&status=pending`, { waitUntil: 'networkidle' });
  await esperarEstado(q, 'pendente');
  await passos(q).waitFor();
  ok(true, 'retorno pending: com "Como concluir"');

  console.log('\n6. Navegador sem o pedido: sem passos nem botão');
  const ctx4 = await novoContexto(browser, { viewport: { width: 375, height: 812 } });
  const r = await novaPagina(ctx4);
  await r.goto(SITE + `obrigado.html?external_reference=${id3}&status=pending`, { waitUntil: 'networkidle' });
  await r.waitForSelector('[data-resultado][data-confirmado="false"]');
  ok(await passos(r).count() === 0 && await botao(r).count() === 0, 'sem o token, nada de reabrir');
  await ctx4.close();

  console.log('\n7. 4 larguras × claro/escuro: sem rolagem horizontal, axe e console');
  for (const largura of [320, 375, 768, 1280]) {
    for (const esquema of ['light', 'dark']) {
      await q.setViewportSize({ width: largura, height: 900 });
      await q.emulateMedia({ colorScheme: esquema });
      q.erros.length = 0;
      await q.goto(SITE + `obrigado.html?external_reference=${id3}&status=pending`, { waitUntil: 'networkidle' });
      await passos(q).waitFor();
      ok(await semRolagem(q), `${largura}px ${esquema}: sem rolagem horizontal`);
      const caixa = await botao(q).boundingBox();
      ok(caixa && caixa.height >= 24 && caixa.width >= 24, `${largura}px ${esquema}: alvo do botão ≥ 24 px`);
      await axe(q, `${largura}px ${esquema}`);
      ok(q.erros.filter((e) => !/status of 4\d\d/.test(e)).length === 0, `${largura}px ${esquema}: console limpo` + (q.erros.length ? ' -> ' + q.erros.join(' | ') : ''));
      await q.screenshot({ path: SAIDA + `/concluir-${largura}-${esquema}.png`, fullPage: true });
    }
  }
  await q.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await q.goto(SITE + `obrigado.html?external_reference=${id3}&status=pending`, { waitUntil: 'networkidle' });
  await passos(q).waitFor();
  ok(await q.evaluate(() => getComputedStyle(document.querySelector('.resultado__icone .icone')).animationName === 'none'), 'movimento reduzido: ícone parado');
  await ctx3.close();

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
