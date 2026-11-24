// Uso: SITE=http://localhost:8080/ node testes/e2e/preconexao.test.js (servidor estático na raiz)
// Melhoria 94 — pré-conexão ao Supabase só quando necessário: <link rel="preconnect"> à origem do Supabase
// injetado pelo JS só em planos/briefing/obrigado/pedido e na intenção de abrir o chat; nunca na carga das
// demais páginas; uma única vez; nada de supabase-js baixado nem chamada à API só por pré-conectar.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
const RAIZ = path.resolve(__dirname, '../..');

const configTeste = fs.readFileSync(RAIZ + '/config.js', 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`)
  .replace("{ dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' },", "{ dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '23:59' },");
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');
const configVazio = configTeste.replace(`'${API}'`, "''");

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

const COM = ['planos.html', 'briefing.html', 'obrigado.html', 'pedido.html'];
const SEM = ['', 'portfolio.html', 'exemplos.html', 'termos.html', 'privacidade.html', 'blog/', 'blog/site-ou-instagram.html',
  'segmentos/moda.html', 'exemplos/moda.html'];  // 404.html usa caminhos absolutos /empresa-jp/

async function novaPagina(browser, config) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  p.erros = [];
  p.rede = { cdn: 0, api: 0 };
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  p.on('request', (r) => { if (r.url() === CDN) p.rede.cdn++; else if (r.url().startsWith(API)) p.rede.api++; });
  await p.route('**/config.js*', (r) => r.fulfill({ body: config || configTeste, contentType: 'application/javascript' }));
  await p.route(CDN, (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  return p;
}

const links = (p) => p.evaluate(() => Array.from(document.querySelectorAll('link[rel="preconnect"]'))
  .map((l) => ({ href: l.href, cross: l.crossOrigin, marcado: l.hasAttribute('data-preconexao-supabase') })));

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Páginas que falam com o banco: pré-conexão na carga');
  for (const pag of COM) {
    const p = await novaPagina(browser);
    await p.goto(SITE + pag, { waitUntil: 'load' });
    await p.waitForTimeout(300);
    const l = await links(p);
    ok(l.length === 1 && l[0].href.replace(/\/$/, '') === API && l[0].cross === 'anonymous' && l[0].marcado,
      `${pag}: um preconnect ${API} crossorigin=anonymous (${JSON.stringify(l)})`);
    ok(p.rede.cdn === 0, `${pag}: supabase-js não é baixado só por pré-conectar`);
    ok(p.erros.length === 0, `${pag}: console limpo` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[2] Demais páginas: nenhuma pré-conexão na carga');
  for (const pag of SEM) {
    const p = await novaPagina(browser);
    await p.goto(SITE + pag, { waitUntil: 'networkidle' });
    await p.waitForTimeout(3500); // passa da montagem do chat no ócio
    const l = await links(p);
    ok(l.length === 0, `${pag || 'index'}: sem preconnect (${l.length})`);
    ok(p.erros.length === 0, `${pag || 'index'}: console limpo` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[3] Intenção de abrir o chat: pré-conecta uma vez');
  for (const [rotulo, acao] of [['mouse', (p) => p.dispatchEvent('.chat__lancador', 'pointerenter')],
    ['teclado', (p) => p.dispatchEvent('.chat__lancador', 'focus')], ['dedo', (p) => p.dispatchEvent('.chat__lancador', 'touchstart')]]) {
    const p = await novaPagina(browser);
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await p.waitForSelector('.chat__lancador', { state: 'attached', timeout: 6000 });
    ok((await links(p)).length === 0, `${rotulo}: widget montado sem preconnect`);
    await acao(p);
    await p.waitForTimeout(300);
    await acao(p);
    const l = await links(p);
    ok(l.length === 1 && l[0].href.replace(/\/$/, '') === API, `${rotulo}: um preconnect depois da intenção (${l.length})`);
    ok(p.rede.api === 0, `${rotulo}: nenhuma chamada à API antes de abrir`);
    ok(p.erros.length === 0, `${rotulo}: console limpo` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[4] Supabase não configurado: nenhuma pré-conexão');
  {
    const p = await novaPagina(browser, configVazio);
    await p.goto(SITE + 'planos.html', { waitUntil: 'load' });
    await p.waitForTimeout(300);
    ok((await links(p)).length === 0, 'planos.html sem url do Supabase: sem preconnect');
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
