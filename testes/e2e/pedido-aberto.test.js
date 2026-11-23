// Uso: veja testes/README.md (precisa do servidor estático, do Supabase falso e do Mercado Pago falso)
// Melhoria 39: planos.html avisa "Você tem um pedido em aberto" a quem voltou do Mercado Pago sem pagar.
// planos.html → criar-pagamento (real) → MP falso → volta sem pagar → aviso → "Concluir pagamento" reabre a MESMA
// preferência (modo reabrir, função SQL real) → Pix pendente → reabrir recusado (pagamento em andamento) →
// aprovado → aviso some. Sem dados pessoais na tela, nada novo no localStorage, 4 larguras com axe.
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

async function novaPagina(ctx) {
  const p = await ctx.newPage();
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  return p;
}
async function novoContexto(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  return ctx;
}
async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}
const semRolagem = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const aviso = (p) => p.locator('[data-pedido-aberto]');
async function avisoVisivel(p) {
  // a consulta ao status é assíncrona: espera a rede assentar
  await p.waitForLoadState('networkidle');
  return aviso(p).isVisible();
}
async function chavesLocais(p) {
  return p.evaluate(() => Object.keys(localStorage).sort().map((k) => k + '=' + localStorage.getItem(k)).join('\n'));
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await novoContexto(browser, { viewport: { width: 375, height: 812 } });
  const p = await novaPagina(ctx);

  console.log('\n1. Sem pedido salvo: nenhum aviso');
  await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  ok(!(await avisoVisivel(p)), 'aviso oculto para quem nunca pediu');

  console.log('\n2. Contrata, vai ao Mercado Pago e volta sem pagar');
  const email = `aberto-${Date.now()}@teste.local`;
  await p.goto(SITE + 'planos.html?plano=profissional', { waitUntil: 'networkidle' });
  await p.fill('#checkout-nome', 'Rita Moura');
  await p.fill('#checkout-email', email);
  await p.fill('#checkout-whatsapp', '(11) 98888-1234');
  await p.check('#checkout-aceite');
  await Promise.all([p.waitForURL(MP + '/checkout**'), p.click('[data-botao-pagar]')]);
  const prefOriginal = new URL(p.url()).searchParams.get('pref_id');
  const pedidosAntes = Number(psql(`select count(*) from public.pedidos where email = '${email}'`));
  const localAntes = await (async () => {
    await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
    return chavesLocais(p);
  })();
  ok(await avisoVisivel(p), 'aviso "Você tem um pedido em aberto" aparece');
  const textoAviso = await aviso(p).innerText();
  ok(/Você tem um pedido em aberto/.test(textoAviso), 'título do aviso');
  const codigo = psql(`select codigo from public.pedidos where email = '${email}'`);
  ok(textoAviso.includes(codigo) && /Profissional/.test(textoAviso), 'mostra código e plano');
  ok(!/Rita|Moura|98888|aberto-\d+@/.test(textoAviso), 'sem nome, e-mail ou WhatsApp na tela');
  ok(await p.getAttribute('[data-pedido-aberto-acompanhar]', 'href') === 'pedido.html?pedido=' + encodeURIComponent(codigo), '"Acompanhar pedido" leva a pedido.html sem o token');
  // ordem de leitura: o aviso vem antes do formulário e o h2 segue o h1
  const ordem = await p.evaluate(() => {
    const a = document.querySelector('[data-pedido-aberto]');
    const f = document.querySelector('[data-form-checkout]');
    return !!(a.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  ok(ordem, 'aviso antes do formulário');
  await p.screenshot({ path: SAIDA + '/pedido-aberto-375.png', fullPage: false });

  console.log('\n3. "Concluir pagamento" reabre a MESMA preferência, sem pedido novo');
  await Promise.all([p.waitForURL(MP + '/checkout**'), p.click('[data-pedido-aberto-concluir]')]);
  ok(new URL(p.url()).searchParams.get('pref_id') === prefOriginal, 'mesma preferência do Mercado Pago');
  ok(Number(psql(`select count(*) from public.pedidos where email = '${email}'`)) === pedidosAntes, 'nenhum pedido duplicado');
  await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  ok((await chavesLocais(p)) === localAntes, 'nada novo gravado no localStorage');

  console.log('\n4. Pix gerado (pagamento em processamento): não reabre, explica');
  await Promise.all([p.waitForURL(MP + '/checkout**'), p.click('[data-pedido-aberto-concluir]')]);
  await Promise.all([p.waitForURL('**/obrigado.html**'), p.click('button:has-text("Gerar Pix (pendente)")')]);
  await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  ok(await avisoVisivel(p), 'aviso continua (pedido pendente)');
  await p.click('[data-pedido-aberto-concluir]');
  await p.waitForSelector('[data-pedido-aberto-erro]:not([hidden])');
  const erro = await p.textContent('[data-pedido-aberto-erro]');
  ok(/pagamento em processamento/.test(erro), 'mensagem de pagamento em andamento: ' + erro);
  ok(p.url().startsWith(SITE), 'continua no site');
  ok(!(await p.getAttribute("[data-pedido-aberto-concluir]", "aria-disabled")), 'botão liberado de novo');
  ok(await p.evaluate(() => document.activeElement && document.activeElement.matches('[data-pedido-aberto-concluir]')), 'foco fica no botão');
  await p.screenshot({ path: SAIDA + '/pedido-aberto-erro-375.png', fullPage: false });

  console.log('\n5. Pagamento aprovado: o aviso some');
  const registro = await (await fetch(MP + '/__registro')).json();
  const pix = Object.values(registro.pagamentos).find((x) => x.preference_id === prefOriginal && x.status === 'pending');
  await fetch(MP + '/__atualizar', { method: 'POST', body: JSON.stringify({ payment_id: pix.id, mudancas: { status: 'approved', status_detail: 'accredited' } }) });
  await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  ok(!(await avisoVisivel(p)), 'aviso oculto depois do pagamento aprovado');

  console.log('\n6. Token adulterado ou pedido antigo: nenhum aviso');
  await p.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('pbr_pedidos_v1'));
    const id = localStorage.getItem('pbr_ultimo_pedido');
    t[id].token = 'f'.repeat(64);
    localStorage.setItem('pbr_pedidos_v1', JSON.stringify(t));
  });
  await p.reload({ waitUntil: 'networkidle' });
  ok(!(await avisoVisivel(p)), 'token errado não mostra nada');
  ok(p.erros.filter((e) => !/status of 4\d\d/.test(e)).length === 0, 'sem erros de JS/CSP no console' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
  await ctx.close();

  console.log('\n7. Pedido pendente novo: 4 larguras, modo escuro, sem rolagem horizontal e axe');
  const ctx2 = await novoContexto(browser, { viewport: { width: 320, height: 700 } });
  const p2 = await novaPagina(ctx2);
  const email2 = `aberto2-${Date.now()}@teste.local`;
  await p2.goto(SITE + 'planos.html?plano=essencial', { waitUntil: 'networkidle' });
  await p2.fill('#checkout-nome', 'Caio Teste');
  await p2.fill('#checkout-email', email2);
  await p2.fill('#checkout-whatsapp', '(21) 97777-1234');
  await p2.check('#checkout-aceite');
  await Promise.all([p2.waitForURL(MP + '/checkout**'), p2.click('[data-botao-pagar]')]);
  await p2.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  for (const largura of [320, 375, 768, 1280]) {
    await p2.setViewportSize({ width: largura, height: 900 });
    await p2.reload({ waitUntil: 'networkidle' });
    ok(await avisoVisivel(p2), `aviso visível em ${largura}px`);
    ok(await semRolagem(p2), `sem rolagem horizontal em ${largura}px`);
    await axe(p2, largura + 'px');
    await aviso(p2).screenshot({ path: `${SAIDA}/pedido-aberto-${largura}.png` });
  }
  await p2.emulateMedia({ colorScheme: 'dark' });
  await p2.reload({ waitUntil: 'networkidle' });
  await axe(p2, 'modo escuro 1280px');
  await aviso(p2).screenshot({ path: `${SAIDA}/pedido-aberto-escuro.png` });
  await p2.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('pbr_pedidos_v1'));
    const id = localStorage.getItem('pbr_ultimo_pedido');
    t[id].criado_em = new Date(Date.now() - 40 * 864e5).toISOString();
    localStorage.setItem('pbr_pedidos_v1', JSON.stringify(t));
  });
  await p2.reload({ waitUntil: 'networkidle' });
  ok(!(await avisoVisivel(p2)), 'pedido com mais de 30 dias não mostra aviso');
  ok(p2.erros.length === 0, 'sem erros no console' + (p2.erros.length ? ' -> ' + p2.erros.join(' | ') : ''));
  await ctx2.close();

  console.log('\n8. Sem JavaScript: aviso oculto');
  const ctx3 = await browser.newContext({ javaScriptEnabled: false });
  const p3 = await ctx3.newPage();
  await p3.goto(SITE + 'planos.html');
  ok(!(await p3.locator('[data-pedido-aberto]').isVisible()), 'oculto sem JS');
  await ctx3.close();

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTODOS OS TESTES DO PEDIDO EM ABERTO PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
