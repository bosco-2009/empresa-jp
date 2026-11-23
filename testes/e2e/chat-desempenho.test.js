// Uso: veja testes/README.md (precisa do servidor estático e do Supabase falso, como o chat.test.js)
// Melhoria 31 — desempenho do chat: o supabase-js e o Realtime só são baixados/abertos quando o visitante
// abre o widget (ou mostra intenção) ou já tem conversa salva — e, neste caso, só depois do evento load.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
const RAIZ = path.resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

const configTeste = fs.readFileSync(RAIZ + '/config.js', 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`)
  .replace("{ dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' },", "{ dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '23:59' },");
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  p.erros = [];
  p.rede = { cdn: 0, api: 0, ws: 0, cdnAntesDoLoad: false };
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  p.on('websocket', (w) => { if (w.url().startsWith('ws://localhost:54321')) p.rede.ws++; });
  p.on('request', (r) => {
    if (r.url() === CDN) p.rede.cdn++;
    else if (r.url().startsWith(API)) p.rede.api++;
  });
  await p.route('**/config.js', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route(CDN, async (r) => {
    // Registra se a biblioteca foi pedida antes do evento load da página.
    p.rede.cdnAntesDoLoad = p.rede.cdnAntesDoLoad || await p.evaluate(() => document.readyState !== 'complete').catch(() => false);
    r.fulfill({
      path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  });
  return p;
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Visitante novo: nada do Supabase na carga');
  {
    const p = await novaPagina(browser, { viewport: { width: 375, height: 700 } });
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await p.waitForTimeout(3500); // passa do timeout do requestIdleCallback
    ok(await p.locator('.chat__lancador').count() === 1, 'widget do chat criado');
    ok(p.rede.cdn === 0, 'supabase-js não é baixado na carga (' + p.rede.cdn + ')');
    ok(p.rede.api === 0 && p.rede.ws === 0, 'nenhuma chamada à API nem WebSocket na carga');
    ok(!(await p.evaluate(() => !!window.supabase)), 'window.supabase não existe');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[2] Intenção (mouse ou foco no botão): baixa a biblioteca, sem conexão');
  for (const [rotulo, acao] of [['mouse', (p) => p.hover('.chat__lancador')], ['teclado', (p) => p.focus('.chat__lancador')]]) {
    const p = await novaPagina(browser, { viewport: { width: 1280, height: 800 } });
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await acao(p);
    await p.waitForFunction(() => !!(window.supabase && window.supabase.createClient), null, { timeout: 5000 }).catch(() => {});
    ok(p.rede.cdn === 1, `${rotulo}: supabase-js baixado uma vez (${p.rede.cdn})`);
    ok(p.rede.api === 0 && p.rede.ws === 0, `${rotulo}: sem chamadas à API nem WebSocket antes de abrir`);
    ok(await p.locator('[data-chat] [aria-expanded="false"]').count() === 1 || await p.locator('.chat__painel').isHidden(), `${rotulo}: chat continua fechado`);
    await p.click('.chat__lancador');
    await p.waitForTimeout(500);
    ok(await p.locator('.chat__painel').isVisible(), `${rotulo}: abre normalmente`);
    ok(p.rede.cdn === 1, `${rotulo}: abrir não baixa de novo (${p.rede.cdn})`);
    ok(p.rede.ws === 0, `${rotulo}: sem conversa ainda, nenhum WebSocket aberto`);
    ok(p.erros.length === 0, `${rotulo}: console limpo` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[3] Toque no celular: abre e conversa normalmente');
  let armazenamento;
  {
    const p = await novaPagina(browser, { viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
    await p.goto(SITE, { waitUntil: 'networkidle' });
    // No celular o botão se recolhe enquanto o CTA do topo está visível: rola para longe dele.
    await p.evaluate(() => window.scrollTo(0, 1600));
    await p.locator('.chat__lancador').waitFor({ state: 'visible' });
    await p.tap('.chat__lancador');
    await p.fill('#chat-texto', 'Teste de desempenho do chat');
    await p.press('#chat-texto', 'Enter');
    await p.waitForSelector('.chat__bolha--visitante', { timeout: 8000 });
    await p.waitForTimeout(800);
    ok(p.rede.cdn === 1, 'supabase-js baixado uma vez (' + p.rede.cdn + ')');
    ok(p.rede.ws === 1, 'Realtime conectado depois da primeira mensagem (' + p.rede.ws + ')');
    ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 320, 'sem rolagem horizontal a 320 px com o chat aberto');
    await p.screenshot({ path: SAIDA + '/chat-desempenho-320.png' });
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    armazenamento = await p.context().storageState();
    await p.context().close();
  }

  console.log('\n[4] Quem já conversou: retoma só depois do load, sem bloquear a carga');
  {
    const p = await novaPagina(browser, { viewport: { width: 1280, height: 800 }, storageState: armazenamento });
    await p.goto(SITE, { waitUntil: 'load' });
    await p.waitForFunction(() => !!window.supabase, null, { timeout: 6000 }).catch(() => {});
    await p.waitForTimeout(1200);
    ok(p.rede.cdn === 1, 'supabase-js baixado uma vez (' + p.rede.cdn + ')');
    ok(!p.rede.cdnAntesDoLoad, 'download só começa depois do evento load');
    ok(p.rede.ws === 1, 'Realtime religado para receber respostas com o chat fechado (' + p.rede.ws + ')');
    // Abrir durante/depois da retomada não duplica a conversa nem o canal.
    await p.click('.chat__lancador');
    await p.waitForTimeout(800);
    ok(await p.locator('.chat__bolha--visitante').count() === 1, 'mensagem anterior aparece uma vez');
    ok(p.rede.ws === 1, 'abrir não abre outro WebSocket (' + p.rede.ws + ')');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[5] Retomada com o chat aberto antes do load: um só chat_iniciar');
  {
    const p = await novaPagina(browser, { viewport: { width: 1280, height: 800 }, storageState: armazenamento });
    const iniciar = [];
    p.on('request', (r) => { if (r.url().includes('/rest/v1/rpc/chat_iniciar')) iniciar.push(r.url()); });
    await p.goto(SITE, { waitUntil: 'domcontentloaded' });
    await p.click('.chat__lancador');
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(3500);
    ok(iniciar.length === 1, 'chat_iniciar chamado uma vez (' + iniciar.length + ')');
    ok(p.rede.ws === 1, 'um único WebSocket (' + p.rede.ws + ')');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE DESEMPENHO DO CHAT PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
