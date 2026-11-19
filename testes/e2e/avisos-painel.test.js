// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o chat.test.js)
// Avisos no painel (item 8 do MELHORIAS.md): contador de não lidas no título e no favicon, notificações do navegador
// (Notification simulada: o headless não mostra notificações reais), clique abre a conversa, desligar, bloqueio.
// O som e o "Pedido pago" são cobertos também por chat.test.js e checkout.test.js.
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



// Notification falsa e controlável: window.__perm define a permissão; window.__notifs registra o que foi mostrado
function stubNotificacao(perm) {
  return (p) => {
    window.__notifs = [];
    window.__perm = p;
    if (p === 'sem-suporte') { delete window.Notification; return; }
    class N { constructor(t, o) { this.titulo = t; Object.assign(this, o || {}); if (t) window.__notifs.push(this); } close() {}
      static get permission() { return window.__perm; }
      static requestPermission() { window.__perm = window.__perm === 'default' ? 'granted' : window.__perm; return Promise.resolve(window.__perm); } }
    window.Notification = N;
  };
}

async function visitante(browser, nome, texto) {
  const v = await novaPagina(browser, { viewport: { width: 1280, height: 800 } });
  await v.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  await v.click('.chat__lancador');
  if (nome) await v.fill('#chat-nome', nome);
  await v.fill('#chat-texto', texto);
  await v.press('#chat-texto', 'Enter');
  await v.waitForSelector('.chat__bolha--visitante');
  return v;
}

async function entrar(browser, perm, largura) {
  const a = await novaPagina(browser, { viewport: { width: largura || 1280, height: 800 } });
  await a.addInitScript(stubNotificacao(), perm);
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.waitForSelector('.admin-item');
  await a.waitForFunction(() => document.querySelector('[data-conexao]').textContent.includes('Tempo real ativo'));
  return a;
}
const favicon = (a) => a.evaluate(() => [...document.querySelectorAll('link[rel~="icon"]')].map((l) => l.getAttribute('href').slice(0, 22)).join(' '));
const TITULO = 'Painel — Portfólio BR';

(async () => {
  psql("truncate public.mensagens, public.conversas cascade; delete from realtime.enviados;");
  const browser = await chromium.launch();
  const v1 = await visitante(browser, 'Maria Teste', 'Oi, quero um site');

  console.log('\n[1] Contador de não lidas no título e no favicon');
  const a = await entrar(browser, 'default');
  await a.waitForFunction((t) => document.title === '(1) ' + t, TITULO, { timeout: 3000 }).catch(() => {});
  ok(await a.title() === '(1) ' + TITULO, 'título com o contador: ' + await a.title());
  await a.waitForFunction(() => document.querySelector('link[rel~="icon"]').getAttribute('href').startsWith('data:image/png'), null, { timeout: 3000 }).catch(() => {});
  ok((await favicon(a)).split(' ').every((h) => h.startsWith('data:image/png')), 'favicon com selo (data:image/png, permitido pela CSP)');
  const png = await a.evaluate(() => document.querySelector('link[rel~="icon"]').href);
  const tam = await a.evaluate(async (u) => { const i = new Image(); i.src = u; await i.decode(); return [i.width, i.height]; }, png);
  ok(tam.join() === '64,64', 'selo desenhado em 64×64');

  console.log('\n[2] Ligar notificações');
  const botao = a.locator('[data-botao-notificar]');
  ok(await botao.isVisible() && await botao.getAttribute('aria-pressed') === 'false', 'botão visível, desligado');
  ok((await botao.textContent()).includes('Notificações do navegador'), 'rótulo acessível');
  await botao.click();
  await a.waitForTimeout(200);
  ok(await botao.getAttribute('aria-pressed') === 'true' && await a.evaluate(() => localStorage.getItem('pbr_admin_notificacoes')) === 'on', 'pede permissão e liga (salvo no localStorage)');
  ok(await a.evaluate(() => window.__notifs.length) === 0, 'com o painel à vista: nenhuma notificação');

  console.log('\n[3] Conversa nova com o painel fora de foco');
  await a.waitForTimeout(1500); // deixa chegar eventos atrasados do tempo real (mensagem inicial da Maria)
  await a.evaluate(() => { window.__notifs.length = 0; document.hasFocus = () => false; });
  const v2 = await visitante(browser, 'João Silva', 'Vocês fazem cardápio online?');
  await a.waitForFunction(() => window.__notifs.length > 0, null, { timeout: 5000 }).catch(() => {});
  const n = await a.evaluate(() => window.__notifs.map((x) => [x.titulo, x.body, x.tag, x.icon]));
  ok(n.length === 1 && /^Nova (conversa no chat|mensagem de João Silva)$/.test(n[0][0]) && n[0][1] === 'Vocês fazem cardápio online?' && /^conversa-/.test(n[0][2]), 'notificação: ' + (n[0] || []).slice(0, 2).join(' — '));
  ok(n[0] && n[0][3].endsWith('/assets/img/icon-192.png'), 'ícone da marca na notificação');
  await a.waitForFunction((t) => document.title.includes('(2) ') || document.title.includes('Nova mensagem'), TITULO, { timeout: 4000 }).catch(() => {});
  await v1.fill('#chat-texto', 'Mais uma coisa');
  await v1.press('#chat-texto', 'Enter');
  await a.waitForFunction(() => window.__notifs.length > 1, null, { timeout: 5000 }).catch(() => {});
  ok(await a.evaluate(() => window.__notifs[1] && window.__notifs[1].titulo) === 'Nova mensagem de Maria Teste', 'conversa conhecida: "Nova mensagem de Maria Teste" (tag própria por conversa)');

  console.log('\n[4] Clicar na notificação abre a conversa');
  await a.evaluate(() => { document.hasFocus = () => true; window.__notifs[0].onclick(); window.dispatchEvent(new Event('focus')); });
  await a.waitForFunction(() => document.querySelector('[data-conversa-nome]').textContent === 'João Silva', null, { timeout: 3000 }).catch(() => {});
  ok(await a.textContent('[data-conversa-nome]') === 'João Silva', 'abre a conversa do João');
  await a.waitForFunction((t) => document.title === '(1) ' + t, TITULO, { timeout: 4000 }).catch(() => {});
  ok(await a.title() === '(1) ' + TITULO, 'contador baixa ao ler: ' + await a.title());
  await a.locator('.admin-item', { hasText: 'Maria Teste' }).click();
  await a.waitForFunction((t) => document.title === t, TITULO, { timeout: 4000 }).catch(() => {});
  ok(await a.title() === TITULO, 'tudo lido: título original');
  ok(await a.evaluate(() => [...document.querySelectorAll('link[rel~="icon"]')].map((l) => l.getAttribute('href') + ':' + l.getAttribute('type')).join(' ')) === '../favicon.ico:null ../assets/img/favicon.svg:image/svg+xml', 'favicon original de volta (href e type)');

  console.log('\n[5] Desligar');
  await botao.click();
  ok(await botao.getAttribute('aria-pressed') === 'false' && await a.evaluate(() => localStorage.getItem('pbr_admin_notificacoes')) === 'off', 'desliga e salva');
  await a.evaluate(() => { document.hasFocus = () => false; });
  const antes = await a.evaluate(() => window.__notifs.length);
  await v2.fill('#chat-texto', 'Alô?');
  await v2.press('#chat-texto', 'Enter');
  await a.waitForTimeout(1500);
  ok(await a.evaluate(() => window.__notifs.length) === antes, 'desligadas: nada é mostrado');
  await a.screenshot({ path: SAIDA + '/admin-avisos-1280.png' });
  ok(a.erros.length === 0, 'console limpo' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await Promise.all([a.context().close(), v1.context().close(), v2.context().close()]);

  console.log('\n[6] Bloqueadas, sem suporte, larguras e axe');
  {
    const p = await entrar(browser, 'denied');
    const b = p.locator('[data-botao-notificar]');
    await b.click();
    ok(await b.getAttribute('aria-pressed') === 'false' && (await b.getAttribute('title')).includes('bloqueadas') && (await b.textContent()).includes('bloqueadas'), 'bloqueadas no navegador: avisa, sem ligar');
    await p.context().close();
    const q = await entrar(browser, 'sem-suporte');
    ok(await q.locator('[data-botao-notificar]').isHidden(), 'navegador sem Notification: botão oculto');
    ok(q.erros.length === 0, 'sem suporte: console limpo');
    await q.context().close();
  }
  for (const w of [320, 375, 768, 1280]) {
    const p = await entrar(browser, 'default', w);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px: sem rolagem horizontal`);
    ok(await p.evaluate(() => { const r = document.querySelector('[data-sair]').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; }), `${w}px: topo cabe (Sair à vista)`);
    await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
    const v = await p.evaluate(async () => (await axe.run('.admin-topo', { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] })).violations.map((x) => `${x.impact} ${x.id}`));
    ok(v.length === 0, `${w}px: axe no topo sem violações` + (v.length ? ' → ' + v.join(', ') : ''));
    if (w === 320) await p.screenshot({ path: SAIDA + '/admin-avisos-320.png' });
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DOS AVISOS DO PAINEL PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
