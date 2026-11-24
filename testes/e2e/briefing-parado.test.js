// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o briefing-pendente.test.js)
// Briefing parado (item 103 do MELHORIAS.md): pedidos pagos sem briefing há MAIS de 3 dias úteis (mesma conta da melhoria 83:
// segunda a sexta, o dia do pagamento não conta) ganham o selo "Briefing parado · N dias úteis", o filtro "Briefing parado (N)"
// e, no detalhe, o bloco "Briefing parado" com "Lembrar no WhatsApp": mensagem pronta com o link DIRETO do briefing
// (briefing.html?pedido=, sem token), só se o cliente deixou número; nada é enviado sozinho. Exatamente 3 dias úteis: ainda
// "sem briefing" comum. 4 larguras + axe + console + rolagem horizontal.
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

// Mesma conta do painel (o navegador do Playwright usa o fuso do sistema, como este processo).
function diasUteisDesde(d, fim) {
  let dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const hoje = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
  let n = 0;
  while (dia < hoje) { dia.setDate(dia.getDate() + 1); if (dia.getDay() !== 0 && dia.getDay() !== 6) n++; }
  return n;
}
// Meio-dia do dia mais recente com exatamente N dias úteis decorridos até hoje.
function pagoHa(n) {
  const agora = new Date();
  const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 12);
  for (d.setDate(d.getDate() - 1); diasUteisDesde(d, agora) < n; d.setDate(d.getDate() - 1));
  return d;
}
const agora = new Date();
const pagoParado = new Date(agora.getTime() - 10 * 86400000);
const diasParado = diasUteisDesde(pagoParado, agora);
const pagoLimite = pagoHa(3);
const rotDias = (n) => n + (n === 1 ? ' dia útil' : ' dias úteis');

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
  const ts = (d) => `'${d.toISOString()}'::timestamptz`;
  psql(`
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em) values
      ('PBR-PARAD2', '${hash('a')}', 'profissional', 'Profissional', 99700, 'Paula Parada', 'paula@teste.local', '11944443333', now(), 'aprovado', ${ts(pagoParado)} - interval '1 hour', ${ts(pagoParado)}),
      ('PBR-QUASE3', '${hash('b')}', 'essencial', 'Essencial', 49700, 'Quésia Limite', 'quesia@teste.local', '11933332222', now(), 'aprovado', ${ts(pagoLimite)} - interval '1 hour', ${ts(pagoLimite)}),
      ('PBR-SERG77', '${hash('c')}', 'essencial', 'Essencial', 49700, 'Sérgio Também', 'sergio@teste.local', '21988887777', now(), 'aprovado', ${ts(pagoParado)} - interval '1 hour', ${ts(pagoParado)}),
      ('PBR-TEMBR4', '${hash('d')}', 'essencial', 'Essencial', 49700, 'Teo Com Briefing', 'teo@teste.local', '11922221111', now(), 'aprovado', ${ts(pagoParado)} - interval '1 hour', ${ts(pagoParado)}),
      ('PBR-PEND55', '${hash('e')}', 'essencial', 'Essencial', 49700, 'Pedro Pendente', 'pedro@teste.local', '11911110000', now(), 'pendente', now() - interval '3 hours', null);
    insert into public.briefings (pedido_id, nome_negocio) select id, 'Loja do Teo' from public.pedidos where codigo = 'PBR-TEMBR4';
  `);
  console.log(`(pago há ${diasParado} dias úteis; limite: ${pagoLimite.toISOString()})`);

  const browser = await chromium.launch();

  console.log('\n[1] Lista: selo, filtro e contador (1280 px)');
  const a = await entrar(browser, 1280);
  ok((await a.textContent('[data-filtro-pedido="briefing-parado"]')) === 'Briefing parado (2)', 'contador: os dois pagos há +3 dias úteis sem briefing');
  ok((await a.textContent('[data-filtro-pedido="sem-briefing"]')) === 'Sem briefing (3)', '"Sem briefing" continua contando todos os de +24 h');
  const alertas = await textos(a, '.admin-item__tag--alerta');
  ok(alertas.filter((t) => t === 'Briefing parado · ' + rotDias(diasParado)).length === 2, 'selo "Briefing parado · N dias úteis": ' + alertas.join(','));
  ok((await textos(a, '.admin-item__tag--aviso')).some((t) => /^sem briefing · /.test(t)), 'exatamente 3 dias úteis: ainda "sem briefing" comum');
  const tituloSelo = await a.getAttribute('.admin-item__tag--alerta:has-text("Briefing parado")', 'title');
  ok(tituloSelo === 'Pago há ' + rotDias(diasParado) + ' sem briefing', 'title do selo explica: ' + tituloSelo);
  ok(/2 parado\(s\) há mais de 3 dias úteis/.test(await a.getAttribute('[data-selo-aba="pedidos"]', 'title')), 'selo da aba menciona os parados');
  await a.click('[data-filtro-pedido="briefing-parado"]');
  ok((await a.getAttribute('[data-filtro-pedido="briefing-parado"]', 'aria-pressed')) === 'true', 'filtro com aria-pressed');
  const nomes = await textos(a, '[data-lista-pedidos] .admin-item__nome');
  ok(nomes.length === 2 && nomes.every((n) => /PBR-PARAD2|PBR-SERG77/.test(n)), 'filtro mostra só os parados: ' + nomes.join(','));

  console.log('\n[2] Detalhe: "Lembrar no WhatsApp" com o link do briefing, sem token');
  await abrirPedido(a, 'PBR-PARAD2');
  await a.waitForSelector('[data-recuperar][data-modo="briefing"]:not([hidden])');
  ok((await a.textContent('[data-recuperar-titulo]')) === 'Briefing parado', 'título "Briefing parado"');
  ok((await a.textContent('[data-recuperar-texto]')).startsWith('Pago há ' + rotDias(diasParado) + ' e o briefing ainda não chegou'), 'texto em dias úteis');
  ok((await a.textContent('[data-recuperar-link-texto]')) === 'Lembrar no WhatsApp', 'botão "Lembrar no WhatsApp"');
  const nomeAcessivel = (await a.textContent('[data-recuperar-link]')).replace(/\s+/g, ' ').trim();
  ok(nomeAcessivel === 'Lembrar no WhatsApp (abre em nova aba)', 'nome acessível do link: ' + nomeAcessivel);
  const msg = await a.inputValue('[data-recuperar-mensagem]');
  ok(msg.startsWith('Olá, Paula! Aqui é da Portfólio BR.') && msg.includes('PBR-PARAD2') && msg.includes('plano Profissional'), 'mensagem com nome, código e plano');
  ok(msg.includes('briefing.html?pedido=PBR-PARAD2') && !msg.includes('pedido.html') && !/#c=|[?&]t=|token/i.test(msg), 'link direto do briefing, sem o token');
  ok(!/R\$/.test(msg), 'sem valor na mensagem');
  const href = await a.getAttribute('[data-recuperar-link]', 'href');
  ok(href.startsWith('https://wa.me/5511944443333?text=') && decodeURIComponent(href.split('text=')[1]) === msg, 'wa.me com o texto pronto');
  await a.fill('[data-recuperar-mensagem]', 'Oi Paula');
  await a.click('[data-recuperar-padrao]');
  ok((await a.inputValue('[data-recuperar-mensagem]')) === msg, '"Restaurar mensagem" volta ao lembrete');
  ok(await a.isVisible('[data-briefing-link]'), 'bloco "Link do briefing" junto');
  await axe(a, 'detalhe briefing parado 1280');
  await a.screenshot({ path: SAIDA + '/briefing-parado-1280.png' });
  const [popup] = await Promise.all([a.context().waitForEvent('page'), a.click('[data-recuperar-link]')]);
  await popup.close().catch(() => {});
  ok(/^Você abriu o WhatsApp para este cliente em /.test(await a.textContent('[data-recuperar-chamado]')), 'registra o lembrete');
  ok((await textos(a, '.admin-item__tag--alerta')).includes('Briefing parado · lembrado'), 'selo passa a "lembrado"');
  const salvo = await a.evaluate(() => localStorage.getItem('pbr-admin-lembrete-briefing'));
  ok(salvo && !salvo.includes('Paula') && !salvo.includes('11944'), 'localStorage guarda só id e data');
  ok(psql(`select count(*) from public.mensagens`) === '0', 'nada enviado pelo sistema');

  console.log('\n[3] Outro parado, no limite, com briefing e pendente');
  await abrirPedido(a, 'PBR-SERG77');
  await a.waitForSelector('[data-recuperar][data-modo="briefing"]:not([hidden])');
  ok((await a.textContent('[data-recuperar-titulo]')) === 'Briefing parado', 'outro parado: mesmo bloco');
  ok((await a.inputValue('[data-recuperar-mensagem]')).startsWith('Olá, Sérgio!'), 'trocar de pedido troca a mensagem pronta');
  await a.click('[data-filtro-pedido="todos"]');
  await abrirPedido(a, 'PBR-QUASE3');
  await a.waitForSelector('[data-recuperar][data-modo="briefing"]:not([hidden])');
  ok((await a.textContent('[data-recuperar-titulo]')) === 'Briefing pendente', '3 dias úteis: "Briefing pendente" (melhoria 34)');
  ok((await a.inputValue('[data-recuperar-mensagem]')).includes('pedido.html?pedido=PBR-QUASE3'), 'mensagem antiga, com o acompanhamento');
  ok((await a.textContent('[data-recuperar-link-texto]')) === 'Lembrar no WhatsApp', 'mesmo rótulo de lembrete');
  await abrirPedido(a, 'PBR-TEMBR4');
  ok((await a.getAttribute('[data-recuperar]', 'data-modo')) !== 'briefing', 'com briefing: sem lembrete');
  await abrirPedido(a, 'PBR-PEND55');
  await a.waitForSelector('[data-recuperar][data-modo="abandono"]:not([hidden])');
  ok((await a.textContent('[data-recuperar-link-texto]')) === 'Chamar no WhatsApp', 'checkout abandonado mantém "Chamar no WhatsApp"');

  console.log('\n[4] O briefing chega: sai do filtro (tempo real)');
  psql(`insert into public.briefings (pedido_id, nome_negocio) select id, 'Ateliê da Paula' from public.pedidos where codigo = 'PBR-PARAD2';`);
  await a.waitForFunction(() => document.querySelector('[data-filtro-pedido="briefing-parado"]').textContent === 'Briefing parado (1)', null, { timeout: 35000 });
  ok(true, 'contador cai para 1');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[5] Larguras 320, 375 e 768 px');
  for (const w of [320, 375, 768]) {
    const p = await entrar(browser, w);
    await p.click('[data-filtro-pedido="briefing-parado"]');
    let sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px lista sem rolagem horizontal (${sw})`);
    await p.screenshot({ path: SAIDA + `/briefing-parado-lista-${w}.png`, fullPage: true });
    await p.click('[data-lista-pedidos] .admin-item');
    await p.waitForSelector('[data-recuperar]:not([hidden])');
    sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px detalhe sem rolagem horizontal (${sw})`);
    await axe(p, `${w}px detalhe`);
    await p.screenshot({ path: SAIDA + `/briefing-parado-${w}.png`, fullPage: true });
    ok(p.erros.length === 0, `${w}px console sem erros` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
