// Uso: veja testes/README.md
// Teste ponta a ponta do checkout: planos.html → Edge Function criar-pagamento (código real) →
// Mercado Pago falso → webhook assinado → Edge Function webhook-mercadopago (código real) → Postgres (RLS real)
// → obrigado.html → aba Pedidos do painel.
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

async function novaPagina(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  const p = await ctx.newPage();
  // a abertura de marca tem teste próprio (movimento.test.js); aqui ela é marcada como já vista
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  // axe servido como arquivo da mesma origem (a CSP das páginas bloqueia scripts inline)
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  await p.addInitScript(() => {
    window.__sons = 0;
    const C = window.AudioContext;
    if (C) { const o = C.prototype.createOscillator; C.prototype.createOscillator = function () { window.__sons++; return o.call(this); }; }
    // Notificações do navegador (melhoria 8): permissão concedida e ligadas; registra em window.__notifs
    window.__notifs = [];
    try { localStorage.setItem('pbr_admin_notificacoes', 'on'); } catch (e) { /* */ }
    window.Notification = class { constructor(t, o) { this.titulo = t; Object.assign(this, o); if (t) window.__notifs.push(this); } close() {} static requestPermission() { return Promise.resolve('granted'); } };
    window.Notification.permission = 'granted';
  });
  return p;
}
async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}
const semRolagem = async (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

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
const tituloResultado = (p) => p.textContent('[data-resultado-titulo]');
// localStorage do SITE (a página atual pode estar no Mercado Pago falso)
async function pedidosLocais(p) {
  const estado = await p.context().storageState();
  const origem = estado.origins.find((o) => o.origin === new URL(SITE).origin);
  const item = origem && origem.localStorage.find((x) => x.name === 'pbr_pedidos_v1');
  return item ? JSON.parse(item.value) : {};
}

(async () => {
  psql('truncate public.pedidos cascade; delete from realtime.enviados;');
  const browser = await chromium.launch();

  console.log('\n[1] Home → planos');
  const h = await novaPagina(browser, { viewport: { width: 375, height: 740 } });
  await h.goto(SITE, { waitUntil: 'networkidle' });
  const hrefs = await h.$$eval('.plano a.botao', (as) => as.map((a) => a.getAttribute('href')));
  ok(JSON.stringify(hrefs) === JSON.stringify(['planos.html?plano=essencial', 'planos.html?plano=profissional', 'planos.html?plano=premium']), 'botões dos planos da home levam a planos.html com o plano: ' + hrefs);
  await h.context().close();

  console.log('\n[2] planos.html (320, 375 e 1280 px)');
  for (const w of [320, 375, 1280]) {
    const p = await novaPagina(browser, { viewport: { width: w, height: 800 } });
    await p.goto(SITE + 'planos.html?plano=premium', { waitUntil: 'networkidle' });
    ok(await semRolagem(p), `sem rolagem horizontal em ${w}px`);
    if (w === 375) {
      ok(await p.isChecked('input[name=plano][value=premium]'), 'plano pré-selecionado pela URL');
      ok((await p.textContent('[data-resumo-plano]')).includes('Premium'), 'resumo mostra o plano escolhido');
      await p.check('input[name=plano][value=essencial]');
      ok((await p.textContent('[data-resumo-plano]')).replace(/\u00a0/g, ' ').includes('R$ 497'), 'trocar o plano atualiza o resumo');
      ok(new URL(p.url()).searchParams.get('plano') === 'essencial', 'URL acompanha o plano escolhido');
      await p.click('[data-botao-pagar]');
      ok(await p.evaluate(() => document.activeElement.id) === 'checkout-nome', 'envio vazio: foco no primeiro campo com erro');
      ok(await p.locator('[aria-invalid=true]').count() === 4, 'nome, e-mail, WhatsApp e aceite marcados como inválidos');
      ok(psql('select count(*) from public.pedidos') === '0', 'nada é criado com o formulário inválido');
      await axe(p, 'planos.html com erros de validação');
      await p.screenshot({ path: SAIDA + '/planos-375.png', fullPage: true });
    }
    if (w === 1280) { await axe(p, 'planos.html desktop'); await p.screenshot({ path: SAIDA + '/planos-1280.png', fullPage: true }); }
    ok(p.erros.length === 0, `console limpo em ${w}px` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[3] Compra aprovada no cartão');
  const c = await novaPagina(browser, { viewport: { width: 375, height: 800 } });
  await contratar(c, 'premium', { nome: 'Carla Dias', email: 'Carla@Exemplo.com', whatsapp: '(31) 98888-1234' });
  const local = await pedidosLocais(c);
  const idCarla = Object.keys(local)[0];
  ok(/^PBR-[A-Z2-9]{6}$/.test(local[idCarla].codigo) && /^[0-9a-f]{64}$/.test(local[idCarla].token), 'código e token do pedido guardados no navegador');
  ok(psql(`select status || '|' || valor_centavos || '|' || email || '|' || (mp_preference_id is not null) from public.pedidos where id = '${idCarla}'`) === 'pendente|179700|carla@exemplo.com|true', 'pedido pendente com preço do servidor e preferência gravada');
  const regMp = await (await fetch(MP + '/__registro')).json();
  const pref = regMp.registro.preferencias.find((x) => x.corpo.external_reference === idCarla) || { corpo: { items: [{}], back_urls: {} } };
  ok(pref.corpo.items[0].unit_price === 1797 && pref.corpo.external_reference === idCarla && pref.idempotencia === idCarla, 'preferência: R$ 1797, external_reference = id do pedido, chave de idempotência');
  ok(pref.corpo.back_urls.success === SITE + 'obrigado.html' && pref.corpo.notification_url === API + '/functions/v1/webhook-mercadopago', 'back_urls para obrigado.html e notification_url para o webhook');
  ok((await c.textContent('[data-valor]')).includes('1797'), 'tela do MP mostra o valor cobrado');

  await pagar(c, 'aprovado');
  await c.waitForFunction(() => document.querySelector('[data-resultado]').getAttribute('data-estado') === 'aprovado', null, { timeout: 15000 });
  ok((await tituloResultado(c)).includes('Pagamento aprovado'), 'obrigado.html: pagamento aprovado');
  const dl = await c.textContent('[data-resultado-pedido]');
  ok(dl.includes(local[idCarla].codigo) && dl.includes('Premium') && dl.includes('1.797'), 'mostra código, plano e valor');
  ok((await c.textContent('[data-resultado-proximo]')).includes('briefing'), 'mostra o próximo passo (briefing)');
  ok(!c.url().includes('?'), 'parâmetros do MP removidos da barra de endereço');
  ok(psql(`select status || '|' || (pago_em is not null) || '|' || mp_status from public.pedidos where id = '${idCarla}'`) === 'aprovado|true|approved', 'banco: aprovado via webhook assinado');
  const regPos = await (await fetch(MP + '/__registro')).json();
  const wh = regPos.registro.webhooks.filter((w) => regPos.pagamentos[w.pagamento].external_reference === idCarla);
  ok(wh.length === 1 && wh[0].resposta === 200 && wh[0].corpo.includes('aplicado'), 'webhook respondeu 200 "aplicado"');
  await axe(c, 'obrigado aprovado');
  await c.screenshot({ path: SAIDA + '/obrigado-aprovado-375.png', fullPage: true });

  console.log('\n[4] Webhook repetido e assinatura inválida');
  const pagId = wh[0].pagamento;
  let r = await (await fetch(MP + '/__atualizar', { method: 'POST', body: JSON.stringify({ payment_id: pagId }) })).json();
  ok(r.webhook === 200 && psql(`select resultado from public.pedidos_eventos where pedido_id = '${idCarla}' order by id desc limit 1`) === 'repetido', 'notificação repetida é idempotente ("repetido")');
  r = await (await fetch(MP + '/__atualizar', { method: 'POST', body: JSON.stringify({ payment_id: pagId, mudancas: { status: 'refunded', status_detail: 'refunded' }, assinaturaInvalida: true }) })).json();
  ok(r.webhook === 401 && psql(`select status from public.pedidos where id = '${idCarla}'`) === 'aprovado', 'assinatura inválida: 401 e pedido não muda');
  await fetch(MP + '/__atualizar', { method: 'POST', body: JSON.stringify({ payment_id: pagId, mudancas: { status: 'approved', status_detail: 'accredited' } }) });

  console.log('\n[5] Pix pendente que é pago depois (página atualiza sozinha)');
  const x = await novaPagina(browser, { viewport: { width: 1280, height: 800 } });
  await contratar(x, 'essencial', { nome: 'Davi Lima', email: 'davi@exemplo.com', whatsapp: '11977776666' });
  await pagar(x, 'pendente');
  await x.waitForFunction(() => document.querySelector('[data-resultado]').getAttribute('data-estado') === 'pendente', null, { timeout: 10000 });
  ok((await tituloResultado(x)).includes('processamento'), 'obrigado.html: pendente (Pix aguardando)');
  await x.screenshot({ path: SAIDA + '/obrigado-pendente-1280.png' });
  const pixId = (await (await fetch(MP + '/__registro')).json()).registro.webhooks.slice(-1)[0].pagamento;
  await fetch(MP + '/__atualizar', { method: 'POST', body: JSON.stringify({ payment_id: pixId, mudancas: { status: 'approved', status_detail: 'accredited' } }) });
  await x.waitForFunction(() => document.querySelector('[data-resultado]').getAttribute('data-estado') === 'aprovado', null, { timeout: 15000 });
  ok(true, 'Pix confirmado depois: a página muda para aprovado sem recarregar');
  const idDavi = Object.keys(await pedidosLocais(x))[0];

  console.log('\n[6] Cartão recusado');
  const y = await novaPagina(browser, { viewport: { width: 375, height: 800 } });
  await contratar(y, 'profissional', { nome: 'Eva Rocha', email: 'eva@exemplo.com', whatsapp: '21966665555' });
  await pagar(y, 'recusado');
  await y.waitForFunction(() => document.querySelector('[data-resultado]').getAttribute('data-estado') === 'recusado', null, { timeout: 10000 });
  ok((await tituloResultado(y)).includes('não aprovado'), 'obrigado.html: recusado');
  ok((await y.getAttribute('[data-resultado-acoes] a.botao--primario', 'href')) === 'planos.html?plano=profissional', '"Tentar de novo" volta ao mesmo plano');
  await axe(y, 'obrigado recusado');
  const idEva = Object.keys(await pedidosLocais(y))[0];

  console.log('\n[7] URL de retorno adulterada não aprova nada');
  const z = await novaPagina(browser, { viewport: { width: 375, height: 800 } });
  await contratar(z, 'essencial', { nome: 'Fabio Reis', email: 'fabio@exemplo.com', whatsapp: '11955554444' });
  const idFabio = Object.keys(await pedidosLocais(z))[0];
  await z.goto(SITE + `obrigado.html?external_reference=${idFabio}&collection_status=approved&status=approved&payment_id=1`, { waitUntil: 'networkidle' });
  await z.waitForFunction(() => document.querySelector('[data-resultado]').getAttribute('data-confirmado') === 'true', null, { timeout: 10000 });
  ok(await z.getAttribute('[data-resultado]', 'data-estado') === 'pendente', '"status=approved" forjado na URL: continua pendente (só o webhook aprova)');
  const outro = await novaPagina(browser, { viewport: { width: 375, height: 800 } });
  await outro.goto(SITE + `obrigado.html?external_reference=${idCarla}&status=approved`, { waitUntil: 'networkidle' });
  await outro.waitForTimeout(500);
  ok(await outro.getAttribute('[data-resultado]', 'data-estado') !== 'aprovado' && (await outro.textContent('[data-resultado-texto]')).includes('Não encontramos'), 'outro navegador (sem token) não vê o pedido nem "aprovado"');
  ok(!(await outro.textContent('body')).includes('Carla'), 'nenhum dado pessoal exposto');
  await outro.context().close();

  console.log('\n[8] Valor pago diferente do pedido');
  await z.goto(SITE + 'planos.html?plano=essencial', { waitUntil: 'networkidle' });
  const prefFabio = psql(`select mp_preference_id from public.pedidos where id = '${idFabio}'`);
  await fetch(MP + '/__pagar', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `pref_id=${prefFabio}&resultado=aprovado&valor=1` });
  ok(psql(`select status from public.pedidos where id = '${idFabio}'`) === 'pendente' &&
     psql(`select resultado from public.pedidos_eventos where pedido_id = '${idFabio}'`) === 'valor_divergente', 'pagamento de R$ 1 num pedido de R$ 497: não aprova e registra "valor_divergente"');

  console.log('\n[9] Painel: aba Pedidos');
  const a = await novaPagina(browser, { viewport: { width: 1280, height: 800 } });
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  ok(await a.locator('.admin-chat').isVisible(), 'abre na aba Conversas');
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  ok(await a.locator('.admin-chat').isHidden() && a.url().endsWith('#pedidos'), 'aba Pedidos (#pedidos)');
  ok(await a.locator('[data-lista-pedidos] .admin-item').count() === 4, '4 pedidos na lista');
  ok((await a.textContent('[data-filtro-pedido="aprovado"]')) === 'Aprovados (2)' && (await a.textContent('[data-filtro-pedido="pendente"]')) === 'Pendentes (1)' && (await a.textContent('[data-filtro-pedido="recusado"]')) === 'Recusados (1)', 'contagem por status nos filtros');
  ok((await a.textContent('[data-resumo-pedidos]')).includes('2 pedidos aprovados') && (await a.textContent('[data-resumo-pedidos]')).includes('2.294,00'), 'resumo: 2 aprovados, R$ 2.294,00');
  ok((await a.textContent('[data-selo-aba="pedidos"]')) === '1', 'selo da aba com 1 pendente');
  await a.click('[data-filtro-pedido="recusado"]');
  ok(await a.locator('[data-lista-pedidos] .admin-item').count() === 1 && (await a.textContent('[data-lista-pedidos]')).includes('Eva Rocha'), 'filtro "Recusados"');
  await a.click('[data-filtro-pedido="todos"]');
  await a.fill('[data-busca-pedidos]', 'carla@');
  ok(await a.locator('[data-lista-pedidos] .admin-item').count() === 1, 'busca por e-mail');
  await a.fill('[data-busca-pedidos]', '');
  await a.click(`[data-lista-pedidos] [data-id="${idCarla}"]`);
  await a.waitForSelector('[data-pedido-eventos] li');
  const dados = await a.textContent('[data-pedido-dados]');
  ok(dados.includes('carla@exemplo.com') && dados.includes('(31) 98888-1234') && dados.includes('Premium') && dados.includes(String(pagId)), 'detalhes: e-mail, WhatsApp, plano e id do pagamento');
  ok(await a.locator('[data-pedido-eventos] li').count() === 3, 'histórico das notificações do MP (aplicado, repetido, repetido)');
  ok((await a.getAttribute('[data-pedido-dados] a[href^="https://wa.me"]', 'href')) === 'https://wa.me/5531988881234', 'link do WhatsApp do cliente');
  await axe(a, 'aba Pedidos com detalhes');
  await a.screenshot({ path: SAIDA + '/admin-pedidos-1280.png' });

  // Pedido aprovado chegando com o painel aberto: atualiza sozinho e toca o som
  await a.evaluate(() => { document.hasFocus = () => false; });
  const sonsAntes = await a.evaluate(() => window.__sons);
  const prefFabio2 = psql(`select mp_preference_id from public.pedidos where id = '${idFabio}'`);
  await fetch(MP + '/__pagar', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `pref_id=${prefFabio2}&resultado=aprovado` });
  await a.waitForFunction(() => document.querySelector('[data-filtro-pedido="aprovado"]').textContent === 'Aprovados (3)', null, { timeout: 8000 });
  ok(true, 'novo pagamento aprovado aparece no painel em tempo real');
  await a.waitForTimeout(1300);
  ok(await a.evaluate(() => window.__sons) > sonsAntes, 'som tocado no pedido aprovado');
  const notifPedido = await a.evaluate(() => window.__notifs.filter((n) => n.titulo.startsWith('Pedido pago')).map((n) => n.titulo + ' | ' + n.body));
  ok(notifPedido.length === 1, 'notificação do navegador "Pedido pago" (painel fora de foco): ' + notifPedido.join(''));
  ok(/Nova mensagem|Novas mensagens|Portfólio/.test(await a.title()), 'título da aba sinaliza a novidade');
  ok(await a.locator('[data-selo-aba="pedidos"]').isHidden(), 'selo some sem pendentes');

  console.log('\n[10] Painel no celular');
  const am = await novaPagina(browser, { viewport: { width: 375, height: 740 } });
  await am.goto(SITE + 'admin/#pedidos', { waitUntil: 'networkidle' });
  await am.fill('#login-email', 'dono@teste.local');
  await am.fill('#login-senha', 'senha-de-teste');
  await am.click('[data-form-login] button[type=submit]');
  await am.waitForSelector('[data-lista-pedidos] .admin-item');
  ok(await semRolagem(am), 'sem rolagem horizontal');
  await am.click(`[data-lista-pedidos] [data-id="${idDavi}"]`);
  ok(await am.locator('[data-pedidos-lista-painel]').isHidden() && await am.locator('[data-pedido-voltar]').isVisible(), 'detalhe em tela própria');
  await am.screenshot({ path: SAIDA + '/admin-pedidos-375.png' });
  await am.click('[data-pedido-voltar]');
  ok(await am.locator('[data-pedidos-lista-painel]').isVisible(), 'voltar mostra a lista');
  await axe(am, 'pedidos no celular');

  console.log('\n[11] Console');
  for (const [nome, p] of [['compra aprovada', c], ['pix', x], ['recusado', y], ['url adulterada', z], ['admin', a], ['admin celular', am]]) {
    ok(p.erros.length === 0, `console limpo (${nome})` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
  }
  void idEva;

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE CHECKOUT PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
