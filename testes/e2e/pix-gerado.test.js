// Uso: veja testes/README.md (servidor Supabase falso + Postgres local)
// Pedidos pendentes com Pix/boleto gerado (item 108 do MELHORIAS.md): filtros "Pix/boleto gerado" e "Sem pagamento" com
// contagem, etiqueta na lista, "Lembrar no WhatsApp" com mensagem pronta (sem valor, sem token, sem envio automático),
// cartão em análise fora, saída do filtro quando o pagamento cai, 4 larguras + axe.
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
const RAIZ = require('path').resolve(__dirname, '../..');
fs.mkdirSync(SAIDA, { recursive: true });

const configOriginal = fs.readFileSync(RAIZ + '/config.js', 'utf8');
const configTeste = configOriginal
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

function psql(sql) {
  return execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
}
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  const p = await ctx.newPage();
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  return p;
}

async function axe(p, rotulo) {
  await p.mouse.move(0, 0);
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}

async function entrar(browser, largura) {
  const a = await novaPagina(browser, { viewport: { width: largura, height: 800 } });
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  return a;
}
const textos = (a, s) => a.$$eval(s, (els) => els.map((e) => e.textContent.trim()));
async function abrirPedido(a, cod) {
  await a.click(`[data-lista-pedidos] .admin-item:has-text("${cod}")`);
  await a.waitForFunction((c) => document.querySelector('[data-pedido-titulo]').textContent.startsWith(c), cod);
}

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  psql(`
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, mp_payment_id, mp_status, mp_status_detalhe) values
      ('PBR-PXGERA', '${hash('a')}', 'profissional', 'Profissional', 99700, 'Paula Pix', 'paula@teste.local', '11944443333', now(), 'pendente', now() - interval '3 hours', '1001', 'pending', 'pending_waiting_transfer'),
      ('PBR-BXLETA', '${hash('b')}', 'essencial', 'Essencial', 49700, 'Bruno Boleto', 'bruno@teste.local', '21988887777', now(), 'pendente', now() - interval '20 minutes', '1002', 'pending', 'pending_waiting_payment'),
      ('PBR-SEMWH3', '${hash('c')}', 'essencial', 'Essencial', 49700, 'Sara Segunda', 'sara@teste.local', '11955556666', now(), 'pendente', now() - interval '2 hours', '1003', 'pending', 'pending_waiting_transfer'),
      ('PBR-ANALZ4', '${hash('d')}', 'essencial', 'Essencial', 49700, 'Ana Análise', 'ana@teste.local', '11922221111', now(), 'pendente', now() - interval '2 hours', '1004', 'in_process', 'pending_review_manual'),
      ('PBR-NUNCA5', '${hash('e')}', 'essencial', 'Essencial', 49700, 'Nico Nunca', 'nico@teste.local', '11911110000', now(), 'pendente', now() - interval '3 hours', null, null, null),
      ('PBR-PAGX66', '${hash('f')}', 'essencial', 'Essencial', 49700, 'Pedro Pago', 'pedro@teste.local', '11900009999', now(), 'aprovado', now() - interval '2 hours', '1006', 'approved', 'accredited');
  `);

  const browser = await chromium.launch();

  console.log('\n[1] Lista: filtros "Pix/boleto gerado" e "Sem pagamento" com contagem (1280 px)');
  const a = await entrar(browser, 1280);
  ok((await a.textContent('[data-filtro-pedido="pix-gerado"]')) === 'Pix/boleto gerado (3)', 'contador: dois Pix e um boleto (cartão em análise fora)');
  ok((await a.textContent('[data-filtro-pedido="sem-pagamento"]')) === 'Sem pagamento (1)', 'contador: só o que nunca gerou pagamento');
  ok((await a.textContent('[data-filtro-pedido="pendente"]')) === 'Pendentes (5)', '"Pendentes" continua contando todos');
  const tags = await textos(a, '.admin-item__tag--aviso');
  ok(tags.includes('Pix gerado') && tags.includes('boleto gerado'), 'etiquetas "Pix gerado" e "boleto gerado": ' + tags.join(','));
  ok((await textos(a, '.admin-item__tag--alerta')).some((t) => /^abandonado · /.test(t)), 'sem pagamento há +1 h continua "abandonado"');
  await a.click('[data-filtro-pedido="pix-gerado"]');
  ok((await a.getAttribute('[data-filtro-pedido="pix-gerado"]', 'aria-pressed')) === 'true', 'filtro com aria-pressed');
  let nomes = await textos(a, '[data-lista-pedidos] .admin-item__nome');
  ok(nomes.length === 3 && nomes.every((n) => /PBR-PXGERA|PBR-BXLETA|PBR-SEMWH3/.test(n)), 'filtro mostra só os com pagamento gerado: ' + nomes.join(','));
  await a.click('[data-filtro-pedido="sem-pagamento"]');
  nomes = await textos(a, '[data-lista-pedidos] .admin-item__nome');
  ok(nomes.length === 1 && /PBR-NUNCA5/.test(nomes[0]), '"Sem pagamento" mostra só o que nunca pagou: ' + nomes.join(','));
  await a.click('[data-filtro-pedido="pix-gerado"]');

  console.log('\n[2] Detalhe: "Lembrar no WhatsApp" com mensagem pronta, sem envio automático');
  await abrirPedido(a, 'PBR-PXGERA');
  await a.waitForSelector('[data-recuperar][data-modo="pix"]:not([hidden])');
  ok((await a.textContent('[data-recuperar-titulo]')) === 'Pix gerado, pagamento não confirmado', 'título do bloco');
  ok((await a.textContent('[data-recuperar-texto]')).includes('ainda não confirmou'), 'texto explica a situação');
  ok((await a.textContent('[data-recuperar-link-texto]')) === 'Lembrar no WhatsApp', 'botão "Lembrar no WhatsApp"');
  const msg = await a.inputValue('[data-recuperar-mensagem]');
  ok(msg.startsWith('Olá, Paula! Aqui é da Portfólio BR.') && msg.includes('o Pix do seu pedido PBR-PXGERA') && msg.includes('plano Profissional'), 'mensagem com nome, meio, código e plano');
  ok(!/R\$/.test(msg) && !/undefined|null/.test(msg) && !/#c=|[?&]t=|token/i.test(msg), 'sem valor, sem "undefined" e sem token');
  ok(!msg.includes('planos.html'), 'não manda gerar outro pagamento');
  const href = await a.getAttribute('[data-recuperar-link]', 'href');
  ok(href.startsWith('https://wa.me/5511944443333?text=') && decodeURIComponent(href.split('text=')[1]) === msg, 'wa.me com o texto pronto');
  await a.fill('[data-recuperar-mensagem]', 'Oi Paula');
  await a.click('[data-recuperar-padrao]');
  ok((await a.inputValue('[data-recuperar-mensagem]')) === msg, '"Restaurar mensagem" volta ao lembrete');
  await axe(a, 'detalhe Pix gerado 1280');
  await a.screenshot({ path: SAIDA + '/pix-gerado-1280.png' });
  const [popup] = await Promise.all([a.context().waitForEvent('page'), a.click('[data-recuperar-link]')]);
  await popup.close().catch(() => {});
  ok(/^Você abriu o WhatsApp para este cliente em /.test(await a.textContent('[data-recuperar-chamado]')), 'registra o lembrete');
  ok((await textos(a, '.admin-item__tag--aviso')).includes('Pix gerado · lembrado'), 'etiqueta passa a "lembrado"');
  const salvo = await a.evaluate(() => localStorage.getItem('pbr-admin-lembrete-pix'));
  ok(salvo && !salvo.includes('Paula') && !salvo.includes('11944'), 'localStorage guarda só id e data');
  ok(psql(`select count(*) from public.mensagens`) === '0', 'nada enviado pelo sistema');

  console.log('\n[3] Boleto, outro Pix, cartão em análise e sem pagamento');
  await abrirPedido(a, 'PBR-BXLETA');
  await a.waitForSelector('[data-recuperar][data-modo="pix"]:not([hidden])');
  ok((await a.textContent('[data-recuperar-titulo]')) === 'Boleto gerado, pagamento não confirmado', 'boleto: título próprio');
  ok((await a.inputValue('[data-recuperar-mensagem]')).includes('o boleto do seu pedido PBR-BXLETA'), 'boleto: mensagem fala do boleto');
  await abrirPedido(a, 'PBR-SEMWH3');
  await a.waitForSelector('[data-recuperar][data-modo="pix"]:not([hidden])');
  ok((await a.inputValue('[data-recuperar-mensagem]')).startsWith('Olá, Sara!'), 'trocar de pedido troca a mensagem pronta');
  await a.click('[data-filtro-pedido="todos"]');
  await abrirPedido(a, 'PBR-ANALZ4');
  ok((await a.getAttribute('[data-recuperar]', 'data-modo')) === 'abandono', 'cartão em análise: fica no fluxo de abandono, não no de Pix');
  await abrirPedido(a, 'PBR-NUNCA5');
  await a.waitForSelector('[data-recuperar][data-modo="abandono"]:not([hidden])');
  ok((await a.textContent('[data-recuperar-link-texto]')) === 'Chamar no WhatsApp', 'sem pagamento mantém "Chamar no WhatsApp"');

  console.log('\n[4] O Pix cai: sai do filtro (tempo real)');
  psql(`update public.pedidos set status = 'aprovado', mp_status = 'approved', mp_status_detalhe = 'accredited', pago_em = now(), atualizado_em = clock_timestamp() where codigo = 'PBR-BXLETA';`);
  await a.waitForFunction(() => document.querySelector('[data-filtro-pedido="pix-gerado"]').textContent === 'Pix/boleto gerado (2)', null, { timeout: 35000 });
  ok(true, 'contador cai para 2');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[5] Larguras 320, 375 e 768 px');
  for (const w of [320, 375, 768]) {
    const p = await entrar(browser, w);
    await p.click('[data-filtro-pedido="pix-gerado"]');
    let sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px lista sem rolagem horizontal (${sw})`);
    await p.screenshot({ path: SAIDA + `/pix-gerado-lista-${w}.png`, fullPage: true });
    await p.click('[data-lista-pedidos] .admin-item');
    await p.waitForSelector('[data-recuperar]:not([hidden])');
    sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px detalhe sem rolagem horizontal (${sw})`);
    await axe(p, `${w}px detalhe`);
    await p.screenshot({ path: SAIDA + `/pix-gerado-${w}.png`, fullPage: true });
    ok(p.erros.length === 0, `${w}px console sem erros` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
