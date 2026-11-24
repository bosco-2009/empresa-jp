// Melhoria 110: todos os caminhos para planos.html levam o plano marcado e a origem do clique.
// Uso: sirva a pasta raiz (python3 -m http.server 8080) e rode `node testes/e2e/links-planos.test.js`.
// Depois do JS: home (cartões de planos e simulador), 404, artigo, segmento e exemplo → todo link com ?plano= tem
// plano existente e data-origem-cta válida; clicar grava a origem (pbr_origem_cta_v1) e abre planos.html com o
// plano marcado; o comparativo marca o plano no formulário. 320 e 1280 px, sem erros no console nem rolagem lateral.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const RAIZ = path.resolve(__dirname, '../..');
const html404 = fs.readFileSync(RAIZ + '/404.html', 'utf8');
const ORIGEM = /^(blog|segmento|exemplo|home|erro)\/[a-z0-9-]+$/;
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } return cond; }

async function abrir(browser, w, caminho) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 404|ERR_CONNECTION_REFUSED|Failed to fetch/i.test(m.text())) p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  // a 404 do GitHub Pages responde em qualquer caminho com os endereços absolutos /empresa-jp/
  await p.route('**/empresa-jp/**', (r) => {
    const u = new URL(r.request().url());
    const arq = path.join(RAIZ, decodeURIComponent(u.pathname.replace(/^\/empresa-jp\//, '')));
    if (fs.existsSync(arq) && fs.statSync(arq).isFile()) return r.fulfill({ path: arq });
    return r.fulfill({ status: 404, body: html404, contentType: 'text/html; charset=utf-8' });
  });
  await p.goto(SITE + caminho, { waitUntil: 'networkidle' });
  return { ctx, p };
}

async function linksDePlano(p) {
  return p.$$eval('a[href*="plano="]', (as) => as.map((a) => ({
    href: a.href, origem: a.getAttribute('data-origem-cta'), texto: a.textContent.replace(/\s+/g, ' ').trim(),
  })));
}

(async () => {
  const browser = await chromium.launch();
  const ids = (() => { const w = {}; new Function('window', fs.readFileSync(RAIZ + '/config.js', 'utf8'))(w); return w.PBR_CONFIG.planos.map((x) => x.id); })();
  const paginas = [
    ['index.html', 'home/planos'], ['empresa-jp/nao/existe', 'erro/404'],
    ['blog/site-ou-instagram.html', 'blog/site-ou-instagram'], ['segmentos/moda.html', 'segmento/moda'], ['exemplos/pet.html', 'exemplo/pet'],
  ];

  for (const w of [320, 1280]) {
    console.log(`\n[${w}px] Links de plano depois do JS`);
    for (const [caminho, esperada] of paginas) {
      const { ctx, p } = await abrir(browser, w, caminho);
      const links = await linksDePlano(p);
      ok(links.length > 0, `${caminho}: ${links.length} links com ?plano=`);
      const ruins = links.filter((l) => !ORIGEM.test(l.origem || '') || !ids.includes(new URL(l.href).searchParams.get('plano')));
      ok(!ruins.length, `${caminho}: todos com plano existente e origem` + (ruins.length ? ' ' + JSON.stringify(ruins) : ''));
      ok(links.some((l) => l.origem === esperada), `${caminho}: origem "${esperada}" presente`);
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${caminho}: sem rolagem lateral`);
      ok(!p.erros.length, `${caminho}: console limpo` + (p.erros.length ? ' ' + p.erros.join(' | ') : ''));
      await ctx.close();
    }
  }

  console.log('\n[clique] Cartão da home grava a origem e marca o plano');
  {
    const { ctx, p } = await abrir(browser, 375, 'index.html');
    const alvo = p.locator('[data-lista-planos] a[data-origem-cta="home/planos"]').last();
    const id = new URL(await alvo.evaluate((a) => a.href)).searchParams.get('plano');
    await Promise.all([p.waitForURL(/planos\.html\?plano=/), alvo.click()]);
    await p.waitForLoadState('networkidle');
    const cta = await p.evaluate(() => JSON.parse(localStorage.getItem('pbr_origem_cta_v1') || 'null'));
    ok(cta && cta.de === 'home/planos', 'origem gravada: ' + JSON.stringify(cta && cta.de));
    ok(await p.locator(`input[name="plano"][value="${id}"]`).isChecked(), `plano ${id} marcado no formulário`);
    await ctx.close();
  }

  console.log('\n[clique] Resultado do simulador');
  {
    const { ctx, p } = await abrir(browser, 375, 'index.html');
    await p.check('[data-simulador] input[name="vende"][value="sim"]');
    await p.check('[data-simulador] input[name="paginas"][value="' + (await p.evaluate(() => Object.keys(PBR_CONFIG.simulador.porPaginas)[0])) + '"]');
    const cta = p.locator('[data-sim-cta]');
    const href = await cta.getAttribute('href');
    const id = new URL(href, SITE).searchParams.get('plano');
    ok(ids.includes(id) && (await cta.getAttribute('data-origem-cta')) === 'home/simulador', `"${(await cta.textContent()).trim()}" → ${href}`);
    await Promise.all([p.waitForURL(/planos\.html\?plano=/), cta.click()]);
    await p.waitForLoadState('networkidle');
    const de = await p.evaluate(() => (JSON.parse(localStorage.getItem('pbr_origem_cta_v1') || '{}')).de);
    ok(de === 'home/simulador', 'origem gravada: ' + de);
    ok(await p.locator(`input[name="plano"][value="${id}"]`).isChecked(), `plano ${id} marcado no formulário`);
    await ctx.close();
  }

  console.log('\n[clique] Plano da 404');
  {
    const { ctx, p } = await abrir(browser, 320, 'empresa-jp/nao/existe');
    const alvo = p.locator('[data-planos-404-lista] a').first();
    await Promise.all([p.waitForURL(/planos\.html\?plano=/), alvo.click()]);
    const de = await p.evaluate(() => (JSON.parse(localStorage.getItem('pbr_origem_cta_v1') || '{}')).de);
    ok(de === 'erro/404', 'origem gravada: ' + de);
    await ctx.close();
  }

  console.log('\n[comparativo] "Escolher" marca o plano sem sair da página');
  for (const w of [320, 1280]) {
    const { ctx, p } = await abrir(browser, w, 'planos.html?plano=essencial');
    const botoes = p.locator('[data-comparativo] [data-escolher-plano]:visible');
    const n = await botoes.count();
    ok(n >= 1, `${w}px: ${n} botões "Escolher" visíveis`);
    const ultimo = ids[ids.length - 1];
    if (w < 768) await p.click(`#comparativo-aba-${ultimo}`);
    await p.click(`[data-comparativo] [data-escolher-plano="${ultimo}"]:visible`);
    ok(await p.locator(`input[name="plano"][value="${ultimo}"]`).isChecked(), `${w}px: ${ultimo} marcado`);
    ok(new URL(p.url()).searchParams.get('plano') === ultimo, `${w}px: endereço com ?plano=${ultimo}`);
    ok(await p.evaluate((v) => document.activeElement && document.activeElement.value === v, ultimo), `${w}px: foco no plano escolhido`);
    await ctx.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
