// Uso: veja testes/README.md (precisa do servidor estático, do Supabase falso e do Mercado Pago falso)
// Melhoria 60: quem volta do Mercado Pago sem pagar (recusado, cancelado ou "voltar" com o pedido pendente) vê
// "Tentar de novo com o plano X" em obrigado.html, que reabre planos.html?plano=X&retomar=1 com nome/e-mail/WhatsApp
// da última tentativa (só neste navegador), aviso e botão "Limpar meus dados". Aceite nunca pré-marcado; dados
// apagados ao aprovar; validade de 30 dias; sem ?retomar=1 só preenche logo depois (2 h). 4 larguras, axe, escuro.
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
const CHAVE = 'pbr_checkout_rascunho_v1';

const configOriginal = fs.readFileSync(RAIZ + '/config.js', 'utf8');
const configTeste = configOriginal
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

const psql = (sql) => execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

const errosConsole = [];
async function novoContexto(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  await ctx.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await ctx.route('**/config.js', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  ctx.on('page', (p) => {
    p.on('console', (m) => { if (m.type() === 'error') errosConsole.push(p.url() + ' ' + m.text()); });
    p.on('pageerror', (e) => errosConsole.push('pageerror: ' + e.message));
  });
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
const valores = (p) => p.evaluate(() => ['nome', 'email', 'whatsapp'].map((k) => document.querySelector('#checkout-' + k).value));
const rascunho = (p) => p.evaluate((k) => localStorage.getItem(k), CHAVE);

async function contratar(p, plano, dados) {
  await p.goto(SITE + 'planos.html?plano=' + plano, { waitUntil: 'networkidle' });
  await p.fill('#checkout-nome', dados.nome);
  await p.fill('#checkout-email', dados.email);
  await p.fill('#checkout-whatsapp', dados.whatsapp);
  await p.check('#checkout-aceite');
  await Promise.all([p.waitForURL(MP + '/checkout**'), p.click('[data-botao-pagar]')]);
}
async function pagar(p, resultado) {
  const rotulo = { aprovado: 'Pagar com cartão (aprovar)', pendente: 'Gerar Pix (pendente)', recusado: 'Cartão recusado' }[resultado];
  await Promise.all([p.waitForURL('**/obrigado.html**'), p.click(`button:has-text("${rotulo}")`)]);
}
const esperarEstado = (p, estado) => p.waitForFunction((e) => document.querySelector('[data-resultado]').getAttribute('data-estado') === e, estado, { timeout: 15000 });

(async () => {
  const browser = await chromium.launch();
  const ctx = await novoContexto(browser, { viewport: { width: 375, height: 800 } });
  const p = await ctx.newPage();
  const email = `retomar-${Date.now()}@teste.local`;
  const dados = { nome: 'Lia Campos', email, whatsapp: '(31) 97777-2222' };

  console.log('\n1. Cartão recusado: "Tentar de novo com o plano Essencial"');
  await contratar(p, 'essencial', dados);
  await pagar(p, 'recusado');
  await esperarEstado(p, 'recusado');
  const botao = p.locator('[data-tentar-de-novo]');
  ok(/Tentar de novo com o plano Essencial/.test(await botao.innerText()), 'texto com o nome do plano');
  ok((await botao.getAttribute('href')) === 'planos.html?plano=essencial&retomar=1', 'link para planos.html?plano=essencial&retomar=1');
  await axe(p, 'obrigado recusado 375px');
  await p.screenshot({ path: SAIDA + '/tentar-de-novo-obrigado-375.png' });

  console.log('\n2. planos.html vem preenchido, com aviso e sem aceite marcado');
  await Promise.all([p.waitForURL('**/planos.html**'), botao.click()]);
  await p.waitForLoadState('networkidle');
  ok(JSON.stringify(await valores(p)) === JSON.stringify([dados.nome, dados.email, dados.whatsapp]), 'nome, e-mail e WhatsApp preenchidos');
  ok(!(await p.isChecked('#checkout-aceite')), 'aceite dos termos NÃO vem marcado');
  ok(await p.isChecked('input[name="plano"][value="essencial"]'), 'plano Essencial selecionado');
  ok(await p.locator('[data-dados-salvos]').isVisible(), 'aviso "Preenchemos seus dados" visível');
  ok(!new URL(p.url()).searchParams.has('retomar') && new URL(p.url()).searchParams.get('plano') === 'essencial', 'retomar=1 sai da barra, plano fica');
  const ordem = await p.evaluate(() => {
    const a = document.querySelector('[data-dados-salvos]');
    return !!(a.compareDocumentPosition(document.querySelector('#checkout-nome')) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  ok(ordem, 'aviso antes dos campos');
  ok(await semRolagem(p), 'sem rolagem horizontal (375px)');
  await axe(p, 'planos preenchido 375px');
  await p.locator('[data-dados-salvos]').scrollIntoViewIfNeeded();
  await p.screenshot({ path: SAIDA + '/tentar-de-novo-planos-375.png' });

  console.log('\n3. Nova tentativa direto, sem redigitar (só o aceite)');
  const pedidosAntes = Number(psql(`select count(*) from public.pedidos where email = '${email}'`));
  await p.check('#checkout-aceite');
  await Promise.all([p.waitForURL(MP + '/checkout**'), p.click('[data-botao-pagar]')]);
  ok(Number(psql(`select count(*) from public.pedidos where email = '${email}'`)) === pedidosAntes + 1, 'novo pedido criado com os dados preenchidos');

  console.log('\n4. "Voltar" no Mercado Pago (status=null, pedido pendente no servidor)');
  const idPedido = (await ctx.storageState()).origins.find((o) => o.origin === new URL(SITE).origin)
    .localStorage.find((x) => x.name === 'pbr_ultimo_pedido').value;
  await p.goto(SITE + `obrigado.html?external_reference=${idPedido}&collection_status=null&status=null`, { waitUntil: 'networkidle' });
  await esperarEstado(p, 'pendente');
  ok(await p.locator('[data-tentar-de-novo]').isVisible(), '"Tentar de novo" aparece com o pedido pendente');
  await axe(p, 'obrigado voltou sem pagar');

  console.log('\n5. Pix gerado (pendente de verdade): sem "Tentar de novo"');
  await p.goto(SITE + `obrigado.html?external_reference=${idPedido}&collection_status=pending&status=pending`, { waitUntil: 'networkidle' });
  await esperarEstado(p, 'pendente');
  ok(await p.locator('[data-tentar-de-novo]').count() === 0, 'nenhum botão de nova tentativa');

  console.log('\n6. "Limpar meus dados"');
  await p.goto(SITE + 'planos.html?plano=essencial&retomar=1', { waitUntil: 'networkidle' });
  ok(await p.locator('[data-dados-salvos]').isVisible(), 'aviso visível');
  await p.click('[data-limpar-dados]');
  ok(JSON.stringify(await valores(p)) === '["","",""]', 'campos esvaziados');
  ok((await rascunho(p)) === null, 'dados apagados do localStorage');
  ok(await p.locator('[data-dados-salvos]').isHidden(), 'aviso some');
  ok(await p.evaluate(() => document.activeElement.id === 'checkout-nome'), 'foco vai para o campo Nome');
  ok(/apagados/.test(await p.textContent('[data-dados-salvos-aviso]')), 'aviso para leitor de tela (aria-live)');
  ok(await p.locator('[aria-invalid]').count() === 0, 'nenhum campo marcado com erro');
  await p.reload({ waitUntil: 'networkidle' });
  ok(JSON.stringify(await valores(p)) === '["","",""]' && await p.locator('[data-dados-salvos]').isHidden(), 'depois de recarregar continua vazio');

  console.log('\n7. Validade: 2 h sem retomar=1; 30 dias com retomar=1');
  const gravar = (horas) => p.evaluate(([k, h]) => localStorage.setItem(k, JSON.stringify({ nome: 'Lia Campos', email: 'lia@teste.local', whatsapp: '(31) 97777-2222', plano_id: 'essencial', salvo_em: new Date(Date.now() - h * 3600e3).toISOString() })), [CHAVE, horas]);
  await gravar(0.5);
  await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  ok((await valores(p))[0] === 'Lia Campos', 'volta logo depois (pelo "voltar"): preenche');
  await gravar(3);
  await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  ok((await valores(p))[0] === '' && await p.locator('[data-dados-salvos]').isHidden(), 'visita comum 3 h depois: não preenche');
  await p.goto(SITE + 'planos.html?retomar=1', { waitUntil: 'networkidle' });
  ok((await valores(p))[0] === 'Lia Campos', 'com retomar=1 3 h depois: preenche');
  await gravar(31 * 24);
  await p.goto(SITE + 'planos.html?retomar=1', { waitUntil: 'networkidle' });
  ok((await valores(p))[0] === '' && (await rascunho(p)) === null, 'mais de 30 dias: não preenche e apaga');
  await p.evaluate((k) => localStorage.setItem(k, '{"nome":1}'), CHAVE);
  await p.goto(SITE + 'planos.html?retomar=1', { waitUntil: 'networkidle' });
  ok((await valores(p))[0] === '', 'dado corrompido é ignorado sem erro');
  await p.evaluate((k) => localStorage.setItem(k, '<img src=x onerror=alert(1)>'), CHAVE);
  await p.goto(SITE + 'planos.html?retomar=1', { waitUntil: 'networkidle' });
  ok((await valores(p))[0] === '', 'JSON inválido é ignorado sem erro');

  console.log('\n8. Pagamento aprovado apaga os dados guardados');
  await contratar(p, 'profissional', { nome: 'Lia Campos', email, whatsapp: '31977772222' });
  ok((await (async () => { const e = await ctx.storageState(); return e.origins.find((o) => o.origin === new URL(SITE).origin).localStorage.some((x) => x.name === CHAVE); })()), 'guardado ao ir para o Mercado Pago');
  await pagar(p, 'aprovado');
  await esperarEstado(p, 'aprovado');
  ok((await rascunho(p)) === null, 'apagado ao aprovar');
  ok(await p.locator('[data-tentar-de-novo]').count() === 0, 'sem "Tentar de novo" quando aprovado');

  console.log('\n9. Larguras e modo escuro');
  for (const largura of [320, 375, 768, 1280]) {
    const c = await novoContexto(browser, { viewport: { width: largura, height: 900 } });
    const q = await c.newPage();
    await q.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
    await q.evaluate((k) => localStorage.setItem(k, JSON.stringify({ nome: 'Lia Campos', email: 'lia@teste.local', whatsapp: '(31) 97777-2222', plano_id: 'essencial', salvo_em: new Date().toISOString() })), CHAVE);
    await q.goto(SITE + 'planos.html?plano=essencial&retomar=1', { waitUntil: 'networkidle' });
    ok(await q.locator('[data-dados-salvos]').isVisible(), `aviso visível em ${largura}px`);
    ok(await semRolagem(q), `sem rolagem horizontal em ${largura}px`);
    await axe(q, `${largura}px`);
    await q.locator('[data-dados-salvos]').scrollIntoViewIfNeeded();
    await q.screenshot({ path: SAIDA + `/tentar-de-novo-planos-${largura}.png` });
    if (largura === 1280) {
      await q.emulateMedia({ colorScheme: 'dark' });
      await q.reload({ waitUntil: 'networkidle' });
      await axe(q, 'modo escuro 1280px');
      await q.locator('[data-dados-salvos]').scrollIntoViewIfNeeded();
      await q.screenshot({ path: SAIDA + '/tentar-de-novo-planos-escuro-1280.png' });
    }
    await c.close();
  }

  console.log('\n10. Sem JavaScript: aviso oculto');
  const semJs = await browser.newContext({ javaScriptEnabled: false });
  const s = await semJs.newPage();
  await s.goto(SITE + 'planos.html', { waitUntil: 'load' });
  ok(await s.locator('[data-dados-salvos]').isHidden(), 'oculto sem JS');
  await semJs.close();

  ok(errosConsole.length === 0, 'sem erros no console' + (errosConsole.length ? ' -> ' + errosConsole.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE "TENTAR DE NOVO" PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
