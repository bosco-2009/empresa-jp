// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Página "Exemplos" e os 6 sites de exemplo (item 3 do MELHORIAS.md).
const { chromium } = require('playwright');
const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const fs = require('fs');
const path = require('path');
const configTeste = fs.readFileSync(path.resolve(__dirname, '../../config.js'), 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`).replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
let falhas = 0;
function ok(c, m) { if (c) console.log('  ✔ ' + m); else { falhas++; console.log('  ✘ ' + m); } }

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 375, height: 800 } });
  const p = await ctx.newPage();
  const erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') erros.push(m.text()); });
  p.on('response', (r) => { if (r.status() >= 400) erros.push(r.status() + ' ' + r.url()); });
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.addInitScript(() => sessionStorage.setItem('pbr_abertura_vista', '1'));

  await p.goto(SITE, { waitUntil: 'networkidle' });
  await p.click('[data-menu-botao]');
  ok(await p.isVisible('#menu-principal a[href="exemplos.html"]'), 'link "Exemplos" no menu');
  await Promise.all([p.waitForURL('**/exemplos.html'), p.click('#menu-principal a[href="exemplos.html"]')]);
  ok(await p.locator('.ex-cartao').count() === 6, '6 cartões de exemplo');
  ok(await p.locator('.ex-cartao__rotulo').evaluateAll((els) => els.every((e) => e.textContent.trim() === 'site de exemplo')), 'todos com o rótulo "site de exemplo"');
  ok((await p.textContent('.pagina-topo')).includes('fictícios'), 'aviso de que os negócios são fictícios');

  // clicar em qualquer parte do cartão abre o exemplo (link esticado)
  await p.locator('.ex-cartao').nth(1).scrollIntoViewIfNeeded();
  const caixa = await p.locator('.ex-cartao').nth(1).locator('.ex-mini').boundingBox();
  await Promise.all([p.waitForURL('**/exemplos/restaurante.html'), p.mouse.click(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)]);
  ok(true, 'cartão inteiro clicável (abre o restaurante de exemplo)');
  ok(await p.isVisible('.ex-aviso') && (await p.textContent('.ex-aviso')).includes('Site de exemplo'), 'faixa "Site de exemplo" visível');
  ok((await p.getAttribute('.ex-aviso__links a', 'href')) === '../planos.html', 'CTA "Quero um site assim" para os planos');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sem rolagem horizontal');

  // chat ao vivo também nos exemplos (caminhos relativos a exemplos/)
  await p.evaluate(() => window.scrollTo(0, 600));
  await p.click('.chat__lancador');
  ok(await p.isVisible('#chat-painel'), 'chat abre dentro de exemplos/');
  ok(await p.evaluate(() => { const i = document.querySelector('.chat__avatar'); return i.complete && i.naturalWidth > 0; }), 'avatar do chat carrega (caminho ../assets)');
  await p.keyboard.press('Escape');

  await Promise.all([p.waitForURL('**/planos.html'), p.click('#contato a.botao')]);
  ok(true, 'botão de contato do exemplo leva aos planos (sem WhatsApp falso)');
  ok(erros.length === 0, 'sem erros nem respostas 4xx' + (erros.length ? ': ' + erros.join(' | ') : ''));
  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE EXEMPLOS PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
