// Uso: veja testes/README.md
// Teste ponta a ponta do widget de chat e do painel admin contra o servidor Supabase falso
// (que executa as RPCs/consultas no Postgres local com RLS real).
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
// Aponta o site para o servidor falso (troca url/anonKey, sejam quais forem no config.js real).
const comSupabase = (cfg, url, chave) => cfg
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${url}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${chave}'`);
const configSemSupabase = comSupabase(configOriginal, '', '');
const configTeste = comSupabase(configOriginal, API, ANON)
  .replace("whatsapp: '', // [PROVISÓRIO]", "whatsapp: '5511999999999', //")
  // atendimento sempre aberto, exceto quando o teste fixa a hora
  .replace("{ dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' },", "{ dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '23:59' },");
if (!configTeste.includes(API) || configSemSupabase.includes('supabase.co')) throw new Error('substituição do config falhou');

function psql(sql) {
  return execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
}
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function novaPagina(browser, opcoes, configJs) {
  const ctx = await browser.newContext(opcoes);
  const p = await ctx.newPage();
  // a abertura de marca tem teste próprio (movimento.test.js); aqui ela é marcada como já vista
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  // axe servido como arquivo da mesma origem (a CSP das páginas bloqueia scripts inline)
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js', (r) => r.fulfill({ body: configJs || configTeste, contentType: 'application/javascript' }));
  // Mesmo arquivo do CDN (conferido byte a byte com cmp); o SRI do <script> continua sendo verificado.
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  // Conta sons tocados
  await p.addInitScript(() => {
    window.__sons = 0;
    const C = window.AudioContext;
    if (C) {
      const orig = C.prototype.createOscillator;
      C.prototype.createOscillator = function () { window.__sons++; return orig.call(this); };
    }
  });
  return p;
}

async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}

(async () => {
  psql("truncate public.mensagens, public.conversas cascade; delete from realtime.enviados;");
  const browser = await chromium.launch();

  // =================================================================== sem configuração
  console.log('\n[1] Sem supabase.url/anonKey: chat oculto, sem erros');
  {
    const p = await novaPagina(browser, { viewport: { width: 375, height: 700 } }, configSemSupabase);
    await p.goto(SITE, { waitUntil: 'networkidle' });
    ok(await p.locator('[data-chat]').count() === 0, 'widget não é criado');
    ok(!(await p.evaluate(() => !!window.supabase)), 'supabase-js não é baixado');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  // =================================================================== visitante
  console.log('\n[2] Visitante (celular 375px)');
  const v = await novaPagina(browser, { viewport: { width: 375, height: 740 } });
  await v.goto(SITE, { waitUntil: 'networkidle' });
  ok(await v.evaluate(() => !window.supabase), 'supabase-js só carrega sob demanda');
  ok(await v.locator('.chat').getAttribute('data-recolhido') === 'true', 'botão recolhido enquanto o hero está visível');
  await v.evaluate(() => window.scrollTo(0, 1400));
  await v.waitForTimeout(300);
  ok(await v.locator('.chat').getAttribute('data-recolhido') === 'false', 'botão aparece após rolar');
  await v.click('.chat__lancador');
  ok(await v.locator('#chat-painel').isVisible(), 'painel abre');
  ok(await v.evaluate(() => document.activeElement.id) === 'chat-nome', 'foco vai para o campo nome');
  ok((await v.textContent('.chat__status')).includes('Online'), 'status online (no horário)');
  const larg = await v.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  ok(larg[0] <= larg[1], 'sem rolagem horizontal com painel aberto');
  await axe(v, 'painel do visitante aberto');

  await v.fill('#chat-whatsapp', '123');
  await v.fill('#chat-texto', 'Olá');
  await v.press('#chat-texto', 'Enter');
  ok((await v.textContent('.chat__erro')).includes('WhatsApp'), 'WhatsApp inválido bloqueado no front');

  await v.fill('#chat-nome', 'Maria Teste');
  await v.fill('#chat-whatsapp', '(11) 98888-7777');
  await v.fill('#chat-texto', 'Olá! Quero um site para minha confeitaria.\nÉ possível?');
  await v.press('#chat-texto', 'Enter');
  await v.waitForSelector('.chat__bolha--visitante');
  ok((await v.textContent('.chat__bolha--visitante .chat__bolha-texto')).includes('confeitaria.\nÉ possível?'), 'mensagem enviada aparece com quebra de linha');
  ok(await v.locator('.chat__inicio').isHidden(), 'formulário inicial some após iniciar');
  const ls = await v.evaluate(() => JSON.parse(localStorage.getItem('pbr_chat_v1')));
  ok(/^[0-9a-f]{64}$/.test(ls.token) && ls.iniciada === true, 'id + token aleatório salvos no localStorage');
  const linha = psql("select nome || '|' || whatsapp || '|' || pagina_origem || '|' || nao_lidas_admin || '|' || (token_hash <> '" + ls.token + "') from public.conversas");
  ok(linha === 'Maria Teste|11988887777|/|1|true', 'conversa gravada (nome, WhatsApp normalizado, página, não lidas, token só em hash): ' + linha);
  await v.waitForTimeout(800);
  const reg1 = await (await fetch(API + '/__registro')).json();
  ok(reg1.some((x) => x.join && x.join.startsWith('realtime:chat:')), 'widget assinou o canal secreto do Realtime');

  // =================================================================== admin
  console.log('\n[3] Painel admin (desktop 1280px)');
  const a = await novaPagina(browser, { viewport: { width: 1280, height: 800 } });
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  ok(await a.locator('[data-tela="login"]').isVisible(), 'tela de login');
  await axe(a, 'login');
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'errada');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-erro-login]:not([hidden])');
  ok((await a.textContent('[data-erro-login]')).includes('incorretos'), 'senha errada: mensagem clara');

  await a.fill('#login-email', 'intruso@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="negado"]:not([hidden])');
  ok(true, 'conta que não é admin: acesso negado');
  await a.click('[data-tela="negado"] [data-sair]');
  await a.waitForSelector('[data-tela="login"]:not([hidden])');

  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.waitForSelector('.admin-item');
  await a.waitForFunction(() => document.querySelector('[data-conexao]').textContent.includes('Tempo real ativo'));
  ok(true, 'admin entra, lista carrega e tempo real conecta');
  ok((await a.textContent('.admin-item')).includes('Maria Teste'), 'conversa da Maria na lista');
  ok((await a.textContent('.admin-item__selo')) === '1', 'selo com 1 não lida');
  ok((await a.textContent('[data-filtro="aberta"]')).includes('(1)'), 'filtro "Abertas (1)"');
  await axe(a, 'lista de conversas');

  await a.click('.admin-item');
  await a.waitForSelector('.admin-msg--visitante');
  ok((await a.textContent('[data-conversa-detalhes]')).includes('(11) 98888-7777'), 'detalhes com WhatsApp formatado');
  ok((await a.getAttribute('[data-conversa-whatsapp]', 'href')) === 'https://wa.me/5511988887777', 'link do WhatsApp do visitante');
  await a.waitForTimeout(500);
  ok(psql('select nao_lidas_admin from public.conversas') === '0', 'abrir a conversa zera não lidas no banco');
  await axe(a, 'conversa aberta');

  // Resposta do admin -> visitante recebe em tempo real
  await a.fill('[data-resposta-texto]', 'Oi Maria! É possível sim. Qual o nome da confeitaria?');
  await a.press('[data-resposta-texto]', 'Enter');
  await a.waitForSelector('.admin-msg--admin');
  ok(true, 'resposta do admin aparece no painel');
  await v.waitForSelector('.chat__bolha--admin:not(.chat__bolha--boas-vindas) >> nth=0', { timeout: 5000 });
  ok((await v.locator('.chat__lista .chat__bolha--admin').first().textContent()).includes('Qual o nome'), 'visitante recebe a resposta em tempo real (broadcast + RPC)');

  // Visitante escreve -> admin recebe em tempo real; som e título piscando quando fora de foco
  // Notificações do navegador: Notification falsa com permissão concedida (registra as chamadas)
  await a.evaluate(() => {
    window.__notifs = [];
    window.Notification = function (titulo, op) { window.__notifs.push({ titulo, corpo: op && op.body, tag: op && op.tag }); this.close = () => {}; };
    window.Notification.permission = 'granted';
    window.Notification.requestPermission = () => Promise.resolve('granted');
  });
  await a.click('[data-botao-notificacoes]'); // granted + ligado -> desliga
  ok(await a.getAttribute('[data-botao-notificacoes]', 'aria-pressed') === 'false', 'botão de notificações desliga');
  await a.click('[data-botao-notificacoes]');
  ok(await a.getAttribute('[data-botao-notificacoes]', 'aria-pressed') === 'true', 'botão de notificações liga (preferência salva)');
  await a.evaluate(() => { document.hasFocus = () => false; });
  await v.fill('#chat-texto', 'Doces da Maria!');
  await v.press('#chat-texto', 'Enter');
  await a.waitForFunction(() => [...document.querySelectorAll('.admin-msg--visitante')].some((x) => x.textContent.includes('Doces da Maria')), null, { timeout: 5000 });
  ok(true, 'admin recebe a mensagem do visitante em tempo real');
  await a.waitForTimeout(2200);
  const titulos = await a.evaluate(() => document.title);
  const sons = await a.evaluate(() => window.__sons);
  ok(sons > 0, 'som tocado na mensagem nova (' + sons + ' osciladores)');
  ok(/Nova mensagem|Portfólio/.test(titulos), 'título alternando');
  const piscou = await a.evaluate(() => new Promise((r) => { const vistos = new Set(); const t = setInterval(() => vistos.add(document.title), 200); setTimeout(() => { clearInterval(t); r([...vistos]); }, 2500); }));
  ok(piscou.some((t) => t === '(1) Nova mensagem!') && piscou.some((t) => t === '(1) Painel — Portfólio BR'), 'título da aba pisca com o contador de não lidas: ' + piscou.join(' / '));
  ok(await a.evaluate(() => document.documentElement.getAttribute('data-favicon-selo')) === '1', 'favicon com selo "1"');
  ok(await a.evaluate(() => [...document.querySelectorAll('link[rel~="icon"]')].every((l) => l.href.startsWith('data:image/png'))), 'favicon trocado pela versão com selo');
  const notifs = await a.evaluate(() => window.__notifs);
  ok(notifs.length === 1 && notifs[0].titulo === 'Nova mensagem no chat' && notifs[0].corpo.includes('Maria Teste'), 'notificação do navegador para a mensagem nova: ' + JSON.stringify(notifs));
  ok(!notifs.some((n) => (n.corpo || '').includes('Doces')), 'notificação não mostra o texto da mensagem');
  await a.evaluate(() => { document.hasFocus = () => true; window.dispatchEvent(new Event('focus')); });
  await a.waitForTimeout(300);
  ok((await a.title()) === 'Painel — Portfólio BR', 'ao focar a aba, o título volta ao normal');
  ok(await a.evaluate(() => !document.documentElement.hasAttribute('data-favicon-selo') && [...document.querySelectorAll('link[rel~="icon"]')].every((l) => !l.href.startsWith('data:'))), 'lida a mensagem, o favicon volta ao original');

  // Visitante com painel fechado recebe selo de não lida
  await v.click('.chat__fechar');
  ok(await v.evaluate(() => document.activeElement.classList.contains('chat__lancador')), 'fechar devolve o foco ao botão');
  await a.fill('[data-resposta-texto]', 'Perfeito! Vou te mandar as opções de plano.');
  await a.click('[data-resposta-enviar]');
  await v.waitForSelector('.chat__selo:not([hidden])', { timeout: 5000 });
  ok((await v.textContent('.chat__selo')) === '1', 'selo "1" no botão do visitante com painel fechado');
  ok((await v.textContent('.chat__lancador .visualmente-oculto')).includes('1 nova mensagem'), 'rótulo acessível informa a nova mensagem');

  // Fechar conversa -> visitante vê aviso
  await a.click('[data-alternar-status]');
  await a.waitForFunction(() => document.querySelector('[data-alternar-status]').textContent === 'Reabrir conversa');
  ok(psql('select status from public.conversas') === 'fechada', 'admin fecha a conversa');
  await v.click('.chat__lancador');
  await v.waitForSelector('.chat__nota:not([hidden])', { timeout: 5000 });
  ok(true, 'visitante vê aviso de conversa encerrada (broadcast de status)');
  ok(await v.locator('.chat__selo').isHidden(), 'abrir o painel zera o selo');
  await v.fill('#chat-texto', 'Mais uma dúvida!');
  await v.press('#chat-texto', 'Enter');
  await v.waitForFunction(() => document.querySelector('.chat__nota').hidden);
  ok(psql('select status from public.conversas') === 'aberta', 'mensagem do visitante reabre a conversa');
  await a.waitForFunction(() => document.querySelector('[data-alternar-status]').textContent === 'Fechar conversa', null, { timeout: 5000 });
  ok(true, 'painel atualiza o status em tempo real');

  // Recarregar a página do visitante restaura o histórico
  await v.reload({ waitUntil: 'networkidle' });
  await v.evaluate(() => window.scrollTo(0, 1400));
  await v.click('.chat__lancador');
  await v.waitForFunction(() => document.querySelectorAll('.chat__lista li').length >= 5, null, { timeout: 5000 });
  ok(await v.locator('.chat__inicio').isHidden(), 'após recarregar: histórico restaurado, sem formulário inicial');

  // Limite anti-spam
  for (let i = 0; i < 20; i++) {
    await v.fill('#chat-texto', 'spam ' + i);
    await v.press('#chat-texto', 'Enter');
    await v.waitForFunction(() => !document.querySelector('.chat__enviar').disabled);
  }
  ok((await v.textContent('.chat__erro')).includes('muitas mensagens'), 'limite de 20 mensagens/10 min avisado ao visitante');
  ok(Number(psql("select count(*) from public.mensagens where autor = 'visitante'")) === 20, 'banco guardou só 20 mensagens do visitante');

  // Token adulterado: não lê a conversa de outro, recomeça do zero
  console.log('\n[4] Segurança no navegador');
  const intruso = await novaPagina(browser, { viewport: { width: 375, height: 740 } });
  await intruso.goto(SITE, { waitUntil: 'networkidle' });
  await intruso.evaluate((id) => localStorage.setItem('pbr_chat_v1', JSON.stringify({ visitanteId: id, token: 'f'.repeat(64), iniciada: true })), ls.visitanteId);
  await intruso.reload({ waitUntil: 'networkidle' });
  await intruso.evaluate(() => window.scrollTo(0, 1400));
  await intruso.click('.chat__lancador');
  await intruso.waitForTimeout(1500);
  ok(await intruso.locator('.chat__lista li').count() === 0, 'mesmo visitante_id com token errado não vê mensagens');
  const novo = await intruso.evaluate(() => JSON.parse(localStorage.getItem('pbr_chat_v1')));
  ok(novo.visitanteId !== ls.visitanteId && novo.iniciada === false, 'widget descarta a identidade inválida e recomeça');
  await intruso.context().close();

  // Fora do horário
  console.log('\n[5] Fora do horário');
  const configHorario = configTeste.replace("{ dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '23:59' },", "{ dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' },");
  const f = await novaPagina(browser, { viewport: { width: 1280, height: 800 } }, configHorario);
  await f.clock.setFixedTime(new Date('2026-11-22T06:00:00Z')); // domingo, 03:00 em São Paulo
  await f.goto(SITE, { waitUntil: 'networkidle' });
  await f.click('.chat__lancador');
  ok((await f.textContent('.chat__status')).includes('Fora do horário'), 'status "fora do horário"');
  ok(await f.locator('.chat__aviso .botao--whatsapp').isVisible(), 'oferece o WhatsApp fora do horário');
  ok((await f.getAttribute('.chat__aviso a', 'href')).startsWith('https://wa.me/5511999999999?text='), 'link do WhatsApp do dono');
  await f.screenshot({ path: SAIDA + '/visitante-fora-horario-1280.png' });
  await axe(f, 'fora do horário');
  const pura = await f.evaluate(() => {
    const at = { fusoHorario: 'America/Sao_Paulo', horarios: [{ dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' }, { dias: [6], inicio: '09:00', fim: '13:00' }] };
    const t = (iso) => window.PBRChat.estaNoHorario(at, new Date(iso));
    return [t('2026-11-23T12:00:00Z'), t('2026-11-23T11:59:00Z'), t('2026-11-23T21:00:00Z'), t('2026-11-28T15:59:00Z'), t('2026-11-28T16:00:00Z'), t('2026-11-22T15:00:00Z')];
  });
  ok(JSON.stringify(pura) === JSON.stringify([true, false, false, true, false, false]), 'estaNoHorario: seg 9h ✓, seg 8h59 ✗, seg 18h ✗, sáb 12h59 ✓, sáb 13h ✗, dom ✗ → ' + pura);
  await f.context().close();

  // Admin no celular
  console.log('\n[6] Admin no celular (375px)');
  const am = await novaPagina(browser, { viewport: { width: 375, height: 740 } });
  await am.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await am.fill('#login-email', 'dono@teste.local');
  await am.fill('#login-senha', 'senha-de-teste');
  await am.click('[data-form-login] button[type=submit]');
  await am.waitForSelector('.admin-item');
  ok(await am.locator('.admin-chat .admin-conversa').isHidden(), 'celular: começa só com a lista');
  await am.click('.admin-item');
  await am.waitForSelector('.admin-msg');
  ok(await am.locator('.admin-chat .admin-lista').isHidden() && await am.locator('[data-voltar]').isVisible(), 'celular: conversa em tela própria com botão voltar');
  const la = await am.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  ok(la[0] <= la[1], 'admin sem rolagem horizontal no celular');
  await am.screenshot({ path: SAIDA + '/admin-375.png' });
  await am.click('[data-voltar]');
  ok(await am.locator('.admin-chat .admin-lista').isVisible(), 'voltar mostra a lista');
  await axe(am, 'admin celular');

  // Capturas
  await a.screenshot({ path: SAIDA + '/admin-1280.png' });
  await v.screenshot({ path: SAIDA + '/visitante-375.png' });

  console.log('\n[7] Console');
  for (const [nome, p] of [['visitante', v], ['admin', a], ['admin celular', am]]) {
    const erros = p.erros.filter((e) => !/Failed to load resource: the server responded with a status of 4\d\d/.test(e));
    ok(erros.length === 0, `console limpo (${nome})` + (erros.length ? ': ' + erros.join(' | ') : ''));
    const http4xx = p.erros.length - erros.length;
    if (http4xx) console.log(`    (${nome}: ${http4xx} respostas 4xx esperadas — login errado / limite de mensagens)`);
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES E2E PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
