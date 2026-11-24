// Uso: veja testes/README.md (precisa só do servidor estático em :8080; o config.js é trocado pela rota do Playwright)
// Melhoria 89 — o widget do chat não disputa a primeira pintura:
//  [1] HTML: toda página com o chat cita o chat.css com media="not all" + data-chat-css (não bloqueia a renderização),
//      sem onload/estilo inline (CSP).
//  [2] Visitante novo, sem interação: nada do chat até o load; depois, no ócio, o botão aparece já estilizado
//      (position: fixed), o chat.css vira media="all", CLS 0 e o botão é montado depois da primeira pintura.
//  [3] Interação antes do ócio (requestIdleCallback que nunca dispara): tecla, toque e rolagem montam na hora.
//  [4] Navegador sem requestIdleCallback: monta pelo setTimeout.
//  [5] Conversa salva: monta sem esperar o ócio.
//  [6] Medição: FCP, LCP e tempo de bloqueio (long tasks) da home com o widget adiado, a 375 e 1280 px.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const RAIZ = path.resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

const configTeste = fs.readFileSync(RAIZ + '/config.js', 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

function paginas(dir, prefixo = '') {
  return fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory() && ['blog', 'exemplos', 'segmentos'].includes(e.name) && !prefixo) return paginas(e.name, e.name + '/');
    return e.isFile() && e.name.endsWith('.html') ? [prefixo + e.name] : [];
  });
}

async function novaPagina(browser, opcoes = {}, preparo) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, ...opcoes });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ }
    window.__cls = 0;
    window.__longas = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; }))
        .observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longas.push(e.duration)))
        .observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((l) => { const e = l.getEntries(); window.__lcp = e[e.length - 1].startTime; })
        .observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) { /* */ }
    // Momento em que o botão do chat entra no DOM.
    new MutationObserver(() => {
      if (!window.__montadoEm && document.querySelector('.chat__lancador')) {
        window.__montadoEm = performance.now();
        window.__estadoNaMontagem = document.readyState;
      }
    }).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => {
      const l = document.querySelector('link[data-chat-css]');
      window.__naCarga = { botao: !!document.querySelector('.chat__lancador'), media: l ? l.media : '' };
    });
  });
  if (preparo) await p.addInitScript(preparo);
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  return p;
}
const temBotao = (p) => p.evaluate(() => !!document.querySelector('.chat__lancador'));

(async () => {
  console.log('\n[1] HTML: chat.css fora do caminho crítico');
  for (const pagina of paginas('.')) {
    const html = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
    const links = [...html.matchAll(/<link[^>]*chat\.css[^>]*>/g)].map((m) => m[0]);
    if (!links.length) continue;
    ok(links.length === 1 && /media="not all"/.test(links[0]) && /\sdata-chat-css[\s>]/.test(links[0]) && !/onload=/.test(links[0]),
      pagina + ': chat.css com media="not all" e data-chat-css, sem onload');
  }

  const browser = await chromium.launch();

  console.log('\n[2] Visitante novo, sem interação: monta no ócio, depois do load');
  for (const largura of [320, 375, 768, 1280]) {
    const p = await novaPagina(browser, { viewport: { width: largura, height: 800 } });
    await p.goto(SITE, { waitUntil: 'domcontentloaded' });
    const antes = await p.evaluate(() => window.__naCarga);
    ok(!antes.botao && antes.media === 'not all', `${largura}px: no DOMContentLoaded não há botão e o chat.css segue "not all"`);
    await p.waitForSelector('.chat__lancador', { state: 'attached', timeout: 6000 }).catch(() => {});
    await p.waitForTimeout(600);
    const depois = await p.evaluate(() => {
      const b = document.querySelector('.chat__lancador');
      const pintura = performance.getEntriesByName('first-contentful-paint')[0];
      return {
        existe: !!b,
        fixo: b ? getComputedStyle(b.closest('.chat')).position : '',
        largura: b ? b.getBoundingClientRect().width : 0,
        media: document.querySelector('link[data-chat-css]').media,
        estado: window.__estadoNaMontagem,
        depoisDaPintura: pintura ? window.__montadoEm > pintura.startTime : false,
        cls: window.__cls,
        rolagem: document.documentElement.scrollWidth
      };
    });
    ok(depois.existe && depois.fixo === 'fixed' && depois.largura >= 44, `${largura}px: botão montado já estilizado (fixed, ${Math.round(depois.largura)} px)`);
    ok(depois.media === 'all', `${largura}px: chat.css ativado (media="all")`);
    ok(depois.estado === 'complete', `${largura}px: montado depois do load (${depois.estado})`);
    ok(depois.depoisDaPintura, `${largura}px: montado depois da primeira pintura`);
    ok(depois.cls === 0, `${largura}px: CLS 0 (${depois.cls})`);
    ok(depois.rolagem <= largura, `${largura}px: sem rolagem horizontal`);
    if (largura === 1280 || largura === 320) await p.screenshot({ path: `${SAIDA}/chat-ocioso-${largura}.png` });
    // Abre normalmente pelo botão montado no ócio.
    await p.evaluate(() => window.scrollTo(0, 1600));
    await p.locator('.chat__lancador').click();
    ok(await p.locator('.chat__painel').isVisible(), `${largura}px: o chat abre normalmente`);
    ok(p.erros.filter((e) => !/localhost:54321/.test(e)).length === 0, `${largura}px: console limpo` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[3] Interação antes do ócio monta na hora');
  const semOcio = () => { window.requestIdleCallback = function () { return 0; }; };
  for (const [rotulo, acao] of [
    ['tecla Tab', (p) => p.keyboard.press('Tab')],
    ['rolagem', (p) => p.mouse.wheel(0, 400)],
    ['toque', (p) => p.mouse.click(5, 300)]
  ]) {
    const p = await novaPagina(browser, { viewport: { width: 375, height: 740 } }, semOcio);
    await p.goto(SITE, { waitUntil: 'load' });
    await p.waitForTimeout(2500);
    ok(!(await temBotao(p)), `${rotulo}: sem ócio nem interação, o widget continua adiado`);
    await acao(p);
    await p.waitForSelector('.chat__lancador', { state: 'attached', timeout: 3000 }).catch(() => {});
    ok(await temBotao(p), `${rotulo}: a interação monta o widget`);
    ok(await p.locator('.chat').count() === 1, `${rotulo}: um único widget`);
    ok(p.erros.length === 0, `${rotulo}: console limpo` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[4] Sem requestIdleCallback: alternativa por setTimeout');
  {
    const p = await novaPagina(browser, {}, () => { delete window.requestIdleCallback; window.requestIdleCallback = undefined; });
    await p.goto(SITE, { waitUntil: 'load' });
    await p.waitForSelector('.chat__lancador', { state: 'attached', timeout: 4000 }).catch(() => {});
    ok(await temBotao(p), 'botão montado pelo setTimeout');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[5] Conversa salva: monta sem esperar o ócio');
  {
    const salva = () => {
      semOcioInterno();
      function semOcioInterno() { window.requestIdleCallback = function () { return 0; }; }
      localStorage.setItem('pbr_chat_v1', JSON.stringify({
        visitanteId: '11111111-2222-4333-8444-555555555555', token: 'a'.repeat(64), iniciada: true, ultimaVista: null
      }));
    };
    const p = await novaPagina(browser, { viewport: { width: 1280, height: 800 } }, salva);
    // A retomada chama a API falsa: aqui só importa a montagem, então a API responde vazio.
    await p.route(API + '/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: { 'Access-Control-Allow-Origin': '*' } }));
    await p.goto(SITE, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.chat__lancador', { state: 'attached', timeout: 3000 }).catch(() => {});
    ok(await temBotao(p), 'widget montado mesmo sem ócio nem interação');
    await p.context().close();
  }

  console.log('\n[6] Medição da home (FCP, LCP, bloqueio)');
  for (const largura of [375, 1280]) {
    const p = await novaPagina(browser, { viewport: { width: largura, height: 800 }, deviceScaleFactor: 1 });
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    const m = await p.evaluate(() => ({
      fcp: Math.round((performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0),
      lcp: Math.round(window.__lcp || 0),
      bloqueio: Math.round(window.__longas.reduce((s, d) => s + Math.max(0, d - 50), 0)),
      montado: Math.round(window.__montadoEm || 0)
    }));
    console.log(`  · ${largura}px: FCP ${m.fcp} ms · LCP ${m.lcp} ms · bloqueio ${m.bloqueio} ms · chat montado em ${m.montado} ms`);
    ok(m.montado >= m.fcp, `${largura}px: chat montado depois do FCP`);
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DO CHAT ADIADO PASSARAM');
  process.exit(falhas ? 1 : 0);
})();
