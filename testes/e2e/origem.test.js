// Uso: veja testes/README.md (servidor Supabase falso + Mercado Pago falso + Postgres local, como o checkout.test.js)
// Origem do visitante (item 10 do MELHORIAS.md): utm_* e domínio de referência guardados na chegada (localStorage),
// enviados no chat (pagina_origem) e no pedido (Edge Function real → pedidos.origem), visíveis no painel.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const MP = 'http://localhost:' + (process.env.PORTA_MP || 54400);
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const RAIZ = path.resolve(__dirname, '../..');
const configTeste = fs.readFileSync(RAIZ + '/config.js', 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`)
  .replace("{ dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' },", "{ dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '23:59' },");
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

const psql = (sql) => execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, opcoes = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes));
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  return p;
}
const salvo = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('pbr_origem_v1')));

(async () => {
  psql("truncate public.mensagens, public.conversas cascade; delete from realtime.enviados;");
  const browser = await chromium.launch();

  console.log('\n[1] Chegada por campanha do Instagram');
  const p = await novaPagina(browser);
  await p.goto(SITE + 'blog/site-ou-instagram.html?utm_source=instagram&utm_medium=social&utm_campaign=lancamento&fbclid=abc',
    { waitUntil: 'networkidle', referer: 'https://l.instagram.com/?u=https%3A%2F%2Fexemplo&e=email%40pessoa.com' });
  let o = await salvo(p);
  ok(o && o.utm.source === 'instagram' && o.utm.medium === 'social' && o.utm.campaign === 'lancamento', 'utm_* guardados: ' + JSON.stringify(o && o.utm));
  ok(o && o.ref === 'l.instagram.com', 'referrer: só o domínio (sem caminho nem parâmetros, que podem ter dados pessoais)');
  ok(o && o.entrada === '/blog/site-ou-instagram.html' && !JSON.stringify(o).includes('fbclid') && !JSON.stringify(o).includes('email'), 'página de entrada; nada além do necessário');
  const resumo = 'utm: instagram / social / lancamento · ref: l.instagram.com · entrada: /blog/site-ou-instagram.html';
  ok(await p.evaluate(() => PBROrigem.resumo()) === resumo, 'resumo: ' + await p.evaluate(() => PBROrigem.resumo()));

  console.log('\n[2] Navegação interna não apaga a origem');
  await p.click('.artigo__chamada a[href$="planos.html"]');
  await p.waitForLoadState('networkidle');
  o = await salvo(p);
  ok(o && o.ref === 'l.instagram.com' && o.utm.source === 'instagram', 'continua a mesma depois de ir para planos.html');

  console.log('\n[3] Chat leva a origem em pagina_origem');
  await p.click('.chat__lancador');
  await p.fill('#chat-texto', 'Oi! Vim pelo Instagram.');
  await p.press('#chat-texto', 'Enter');
  await p.waitForSelector('.chat__bolha--visitante');
  const pag = psql('select pagina_origem from public.conversas order by criado_em desc limit 1');
  ok(pag === '/planos.html · ' + resumo, 'conversas.pagina_origem: ' + pag);

  console.log('\n[4] Pedido grava a origem (Edge Function real)');
  const email = `origem${Date.now()}@exemplo.com`;
  await p.fill('#checkout-nome', 'Cliente Origem');
  await p.fill('#checkout-email', email);
  await p.fill('#checkout-whatsapp', '(11) 94444-3333');
  await p.check('#checkout-aceite');
  await Promise.all([p.waitForURL(MP + '/checkout**'), p.click('[data-botao-pagar]')]);
  const ped = psql(`select codigo || '|' || coalesce(origem, '∅') from public.pedidos where email = '${email}'`);
  ok(ped.endsWith('|' + resumo), 'pedidos.origem: ' + ped);
  ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
  const codigo = ped.split('|')[0];
  await p.context().close();

  console.log('\n[5] Painel mostra a origem');
  const a = await novaPagina(browser);
  await a.goto(SITE + 'admin/#pedidos', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.locator('.admin-item', { hasText: codigo }).first().click();
  await a.waitForSelector('[data-pedido-dados] dt');
  const dados = await a.$$eval('[data-pedido-dados] dt', (dts) => dts.map((dt) => dt.textContent + '=' + dt.nextElementSibling.textContent));
  ok(dados.includes('Origem=' + resumo), 'detalhe do pedido com "Origem"' + (dados.includes('Origem=' + resumo) ? '' : ': ' + dados.join(' ; ')));
  await a.goto(SITE + 'admin/#conversas', { waitUntil: 'load' });
  await a.waitForSelector('.admin-item');
  await a.locator('.admin-item').first().click();
  ok((await a.textContent('[data-conversa-detalhes]')).includes('ref: l.instagram.com'), 'conversa: "veio de … ref: l.instagram.com"');
  ok(a.erros.length === 0, 'painel: console limpo' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[5b] Banco sem a migration: o painel continua funcionando');
  {
    const b = await novaPagina(browser);
    await b.route('**/rest/v1/pedidos?*', (r) => (r.request().url().includes('origem')
      ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '42703', message: 'column pedidos.origem does not exist', details: null, hint: null }) })
      : r.continue()));
    await b.goto(SITE + 'admin/#pedidos', { waitUntil: 'networkidle' });
    await b.fill('#login-email', 'dono@teste.local');
    await b.fill('#login-senha', 'senha-de-teste');
    await b.click('[data-form-login] button[type=submit]');
    await b.waitForSelector('[data-tela="painel"]:not([hidden])');
    await b.locator('.admin-item', { hasText: codigo }).first().click();
    await b.waitForSelector('[data-pedido-dados] dt');
    const d = await b.$$eval('[data-pedido-dados] dt', (dts) => dts.map((dt) => dt.textContent));
    ok(d.includes('Cliente') && !d.includes('Origem'), 'lista e detalhes carregam sem a coluna origem');
    await b.context().close();
  }

  console.log('\n[6] Casos de borda');
  {
    const q = await novaPagina(browser);
    await q.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
    ok(await salvo(q) === null && await q.evaluate(() => PBROrigem.resumo()) === '', 'visita direta: nada guardado, resumo vazio');
    await q.goto(SITE + '?utm_source=%3Cscript%3Ealert(1)%3C%2Fscript%3E&utm_medium=' + 'x'.repeat(200), { waitUntil: 'networkidle' });
    o = await salvo(q);
    ok(o && !/[<>()]/.test(o.utm.source) && o.utm.medium.length === 60, 'valores limpos (sem < > ( )) e limitados a 60: ' + o.utm.source);
    await q.goto(SITE + '?utm_source=google&utm_medium=cpc', { waitUntil: 'networkidle' });
    ok((await salvo(q)).utm.source === 'google', 'nova campanha substitui a anterior');
    await q.evaluate(() => { const o = JSON.parse(localStorage.getItem('pbr_origem_v1')); o.em -= 31 * 864e5; localStorage.setItem('pbr_origem_v1', JSON.stringify(o)); });
    ok(await q.evaluate(() => PBROrigem.resumo()) === '', 'expira depois de 30 dias');
    await q.goto(SITE + 'planos.html', { waitUntil: 'networkidle', referer: SITE + 'blog/' });
    ok((await salvo(q)).em < Date.now() - 30 * 864e5, 'referrer do próprio site não conta como origem');
    ok(q.erros.length === 0, 'console limpo');
    await q.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE ORIGEM PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
