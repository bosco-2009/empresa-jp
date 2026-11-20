// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Pré-carregamento dos próximos passos (item 28 do MELHORIAS.md): hover/foco/toque nos links para planos.html e
// exemplos.html criam UMA vez um <link rel="prefetch">; nada com Save-Data, 2g, nem para a própria página.
const { chromium } = require('playwright');

const SITE = process.env.SITE || 'http://localhost:8080/';
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, caminho = '', conexao = null, opcoes = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.pedidos = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  p.on('request', (r) => p.pedidos.push(r.url()));
  await p.addInitScript((c) => {
    try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ }
    if (c) Object.defineProperty(navigator, 'connection', { value: c, configurable: true });
  }, conexao);
  await p.goto(SITE + caminho, { waitUntil: 'networkidle' });
  return p;
}
const prefetches = (p) => p.$$eval('link[rel="prefetch"]', (ls) => ls.map((l) => new URL(l.href).pathname));

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Mouse sobre o link do menu → prefetch de exemplos.html, uma vez só');
  {
    const p = await abrir(browser);
    ok((await prefetches(p)).length === 0, 'nenhum prefetch na carga');
    const link = p.locator('header a[href="exemplos.html"]').first();
    await link.hover();
    await p.waitForTimeout(250);
    let l = await prefetches(p);
    ok(l.length === 1 && l[0].endsWith('/exemplos.html'), 'prefetch criado: ' + l.join(','));
    await p.waitForTimeout(500);
    ok(p.pedidos.some((u) => u.endsWith('/exemplos.html')), 'navegador buscou exemplos.html');
    await p.mouse.move(0, 700);
    await link.hover();
    await p.locator('footer a[href="exemplos.html"]').first().hover();
    await p.waitForTimeout(250);
    ok((await prefetches(p)).length === 1, 'sem duplicar para a mesma página');
    ok(p.erros.length === 0, 'console limpo ' + p.erros.join(' | '));
    await p.context().close();
  }

  console.log('\n[2] Passada rápida do mouse não pré-carrega; foco pelo teclado pré-carrega');
  {
    const p = await abrir(browser);
    const link = p.locator('a[href^="planos.html"]:visible').first();
    await link.hover();
    await p.mouse.move(0, 790);
    await p.waitForTimeout(250);
    ok((await prefetches(p)).length === 0, 'passada < 65 ms ignorada');
    await link.focus();
    await p.waitForTimeout(100);
    const l = await prefetches(p);
    ok(l.length === 1 && l[0].endsWith('/planos.html'), 'foco cria prefetch (âncora removida): ' + l.join(','));
    await p.context().close();
  }

  console.log('\n[3] Toque no celular');
  {
    const p = await abrir(browser, '', null, { viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true });
    await p.evaluate(() => {
      const a = [...document.querySelectorAll('a[href^="planos.html"]')].find((x) => x.offsetParent);
      a.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [] }));
    });
    const l = await prefetches(p);
    ok(l.length === 1 && l[0].endsWith('/planos.html'), 'touchstart cria prefetch');
    await p.context().close();
  }

  console.log('\n[4] Save-Data e 2g: nada');
  for (const c of [{ saveData: true, effectiveType: '4g' }, { saveData: false, effectiveType: 'slow-2g' }, { saveData: false, effectiveType: '2g' }]) {
    const p = await abrir(browser, '', c);
    await p.locator('a[href^="planos.html"]:visible').first().focus();
    await p.waitForTimeout(100);
    ok((await prefetches(p)).length === 0, 'sem prefetch com ' + JSON.stringify(c));
    await p.context().close();
  }

  console.log('\n[5] Própria página e páginas de outra pasta');
  {
    const p = await abrir(browser, 'planos.html');
    const links = await p.$$('a[href="planos.html"], a[href^="planos.html#"]');
    for (const a of links) await a.focus().catch(() => {});
    ok(!(await prefetches(p)).some((x) => x.endsWith('/planos.html')), 'planos.html não pré-carrega a si mesma');
    await p.context().close();
    const b = await abrir(browser, 'blog/');
    const a = b.locator('a[href$="exemplos.html"]').first();
    if (await a.count()) {
      await a.focus();
      await b.waitForTimeout(100);
      const l = await prefetches(b);
      ok(l.length === 1 && /\/exemplos\.html$/.test(l[0]) && !l[0].includes('/blog/'), 'blog: caminho ../ resolvido: ' + l.join(','));
    }
    ok(b.erros.length === 0, 'console limpo no blog ' + b.erros.join(' | '));
    await b.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
