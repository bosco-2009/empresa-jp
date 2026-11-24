// Uso: veja testes/README.md (precisa do servidor estático, do Supabase falso e do Mercado Pago falso)
// Melhoria 105: pedido.html com o pedido PENDENTE e o token deste navegador mostra o mesmo "Como concluir o pagamento"
// de obrigado.html (concluir-pagamento.js, sem duplicar a lógica): 3 passos sem prazos, botão que reabre a MESMA
// preferência (sem pedido novo); com Pix já gerado o reabrir é recusado com aviso no role="alert", foco no botão, e o
// "Atualizar" não apaga o aviso; Pix pago → etapa "pago" e o bloco some. Sem o token: nada de reabrir.
// 4 larguras × claro/escuro, axe, alvo ≥ 24 px, console e movimento reduzido.
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
const esperarEstado = (p, estado) => p.waitForFunction((e) => document.querySelector('[data-acompanhar]').getAttribute('data-estado') === e, estado, { timeout: 20000 });
const passos = (p) => p.locator('[data-como-concluir]');
const botao = (p) => p.locator('[data-concluir-pagamento]');
const errosReais = (p) => p.erros.filter((e) => !/status of 4\d\d/.test(e));

async function contratar(p, plano, email) {
  await p.goto(SITE + 'planos.html?plano=' + plano, { waitUntil: 'networkidle' });
  await p.fill('#checkout-nome', 'Nina Prado');
  await p.fill('#checkout-email', email);
  await p.fill('#checkout-whatsapp', '(41) 96666-3333');
  await p.check('#checkout-aceite');
  await Promise.all([p.waitForURL(MP + '/checkout**'), p.click('[data-botao-pagar]')]);
  return { pref: new URL(p.url()).searchParams.get('pref_id') };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await novoContexto(browser, { viewport: { width: 375, height: 812 } });
  const p = await novaPagina(ctx);
  const email = `pix-pedido-${Date.now()}@teste.local`;

  console.log('\n1. Pedido pendente (voltou sem pagar): "Como concluir o pagamento" no acompanhamento');
  const { pref } = await contratar(p, 'profissional', email);
  const codigo = psql(`select codigo from public.pedidos where email = '${email}'`);
  await p.goto(SITE + 'pedido.html?pedido=' + codigo, { waitUntil: 'networkidle' });
  await esperarEstado(p, 'pendente');
  await passos(p).waitFor();
  ok(await p.locator('#como-concluir-titulo').innerText() === 'Como concluir o pagamento', 'título "Como concluir o pagamento" (h2)');
  ok(await p.evaluate(() => document.querySelectorAll('h1').length === 1), 'um único h1');
  ok(await passos(p).locator('li').count() === 3, '3 passos numerados');
  const texto = await passos(p).innerText();
  ok(!/\d+\s*(min|minuto|hora|dia)/i.test(texto), 'sem prazos inventados nos passos');
  ok(/Atualizar/.test(await passos(p).locator('li').nth(2).innerText()), '3º passo fala do botão "Atualizar" desta página');
  ok(await botao(p).isVisible(), 'botão "Concluir pagamento no Mercado Pago"');
  ok(await p.locator('[data-acompanhar] .botao--primario').count() === 1, 'um único botão principal (o de concluir)');
  ok(await p.locator('[data-etapas] li[aria-current="step"]').count() === 1, 'etapas continuam (pagamento como etapa atual)');
  ok(!/Nina|Prado|96666|pix-pedido-\d+@/.test(await p.locator('[data-acompanhar]').innerText()), 'sem nome, e-mail ou WhatsApp na tela');
  ok(await p.evaluate(() => !!document.querySelector('[data-concluir-erro][role="alert"][hidden]')), 'aviso de erro (role="alert") escondido até ser preciso');
  ok(await p.locator('[data-outro-aparelho]').count() === 0, 'link pessoal de outro aparelho só depois de pago');
  await p.screenshot({ path: SAIDA + '/pix-pedido-pendente-375.png', fullPage: true });

  console.log('\n2. "Concluir pagamento" reabre a MESMA preferência, sem pedido novo');
  await Promise.all([p.waitForURL(MP + '/checkout**'), botao(p).click()]);
  ok(new URL(p.url()).searchParams.get('pref_id') === pref, 'mesma preferência do Mercado Pago');
  ok(Number(psql(`select count(*) from public.pedidos where email = '${email}'`)) === 1, 'nenhum pedido duplicado');

  console.log('\n3. Pix gerado e não pago: reabrir recusado com aviso; "Atualizar" não apaga o aviso');
  await Promise.all([p.waitForURL('**/obrigado.html**'), p.click('button:has-text("Gerar Pix (pendente)")')]);
  await p.goto(SITE + 'pedido.html?pedido=' + codigo, { waitUntil: 'networkidle' });
  await esperarEstado(p, 'pendente');
  await passos(p).waitFor();
  await botao(p).focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-concluir-erro]:not([hidden])');
  ok(/Já existe um Pix ou boleto gerado/.test(await p.textContent('[data-concluir-erro]')), 'explica o pagamento em andamento');
  ok(p.url().startsWith(SITE), 'continua no site');
  ok(!(await botao(p).getAttribute('aria-disabled')) && !(await botao(p).getAttribute('data-carregando')), 'botão liberado de novo');
  ok(await p.evaluate(() => document.activeElement && document.activeElement.matches('[data-concluir-pagamento]')), 'foco fica no botão');
  const antes = await botao(p).elementHandle();
  await p.click('[data-acompanhar-atualizar]');
  await p.waitForFunction(() => /Atualizado às/.test(document.querySelector('[data-acompanhar-hora]').textContent));
  ok(await antes.evaluate((b) => b.isConnected), '"Atualizar" não redesenha o bloco (mesmo botão)');
  ok(await p.isVisible('[data-concluir-erro]'), 'aviso continua na tela depois de atualizar');
  ok(await passos(p).count() === 1, 'um único bloco de passos');
  await p.screenshot({ path: SAIDA + '/pix-pedido-erro-375.png', fullPage: true });
  await axe(p, 'pendente com aviso de erro');

  console.log('\n4. Pix pago: etapa "pago" e o bloco some');
  const registro = await (await fetch(MP + '/__registro')).json();
  const pix = Object.values(registro.pagamentos).find((x) => x.preference_id === pref && x.status === 'pending');
  await fetch(MP + '/__atualizar', { method: 'POST', body: JSON.stringify({ payment_id: pix.id, mudancas: { status: 'approved', status_detail: 'accredited' } }) });
  for (let i = 0; i < 20; i++) {
    await p.click('[data-acompanhar-atualizar]');
    await p.waitForTimeout(700);
    if (await p.getAttribute('[data-acompanhar]', 'data-estado') === 'pago') break;
  }
  await esperarEstado(p, 'pago');
  ok(await passos(p).count() === 0 && await botao(p).count() === 0, 'sem passos nem botão de concluir');
  ok(await p.locator('[data-link-briefing]').isVisible(), 'mostra o briefing como próximo passo');
  ok(errosReais(p).length === 0, 'sem erros de JS/CSP no console' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
  await ctx.close();

  console.log('\n5. Sem o token deste navegador: nada de reabrir');
  const ctx2 = await novoContexto(browser, { viewport: { width: 375, height: 812 } });
  const q = await novaPagina(ctx2);
  const email2 = `pix-pedido2-${Date.now()}@teste.local`;
  await contratar(q, 'essencial', email2);
  const codigo2 = psql(`select codigo from public.pedidos where email = '${email2}'`);
  const ctx3 = await novoContexto(browser, { viewport: { width: 375, height: 812 } });
  const r = await novaPagina(ctx3);
  await r.goto(SITE + 'pedido.html?pedido=' + codigo2, { waitUntil: 'networkidle' });
  await esperarEstado(r, 'erro');
  ok(await passos(r).count() === 0 && await botao(r).count() === 0, 'outro aparelho sem o link: sem passos nem botão');
  await ctx3.close();

  console.log('\n6. 4 larguras × claro/escuro: sem rolagem horizontal, axe, alvo e console');
  for (const largura of [320, 375, 768, 1280]) {
    for (const esquema of ['light', 'dark']) {
      await q.setViewportSize({ width: largura, height: 900 });
      await q.emulateMedia({ colorScheme: esquema });
      q.erros.length = 0;
      await q.goto(SITE + 'pedido.html?pedido=' + codigo2, { waitUntil: 'networkidle' });
      await passos(q).waitFor();
      ok(await semRolagem(q), `${largura}px ${esquema}: sem rolagem horizontal`);
      const caixa = await botao(q).boundingBox();
      ok(caixa && caixa.height >= 24 && caixa.width >= 24, `${largura}px ${esquema}: alvo do botão ≥ 24 px`);
      await axe(q, `${largura}px ${esquema}`);
      ok(errosReais(q).length === 0, `${largura}px ${esquema}: console limpo` + (q.erros.length ? ' -> ' + q.erros.join(' | ') : ''));
      await q.screenshot({ path: SAIDA + `/pix-pedido-${largura}-${esquema}.png`, fullPage: true });
    }
  }
  await q.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await q.goto(SITE + 'pedido.html?pedido=' + codigo2, { waitUntil: 'networkidle' });
  await passos(q).waitFor();
  ok(await q.evaluate(() => [...document.querySelectorAll('[data-acompanhar] *')].every((e) => getComputedStyle(e).animationName === 'none' || getComputedStyle(e).animationPlayState === 'paused' || parseFloat(getComputedStyle(e).animationDuration) <= 0.01)), 'movimento reduzido: nada animado no acompanhamento');
  await ctx2.close();

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
