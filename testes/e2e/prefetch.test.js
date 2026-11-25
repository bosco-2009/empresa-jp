// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Pré-carregamento dos próximos passos (melhorias 28 e 124).
// Chromium (com Speculation Rules): UMA regra `prefetch` "moderate" para planos.html/exemplos.html, liberada na CSP
// só por 'inline-speculation-rules'; o navegador pré-carrega no hover/toque. Foco pelo teclado continua com
// <link rel="prefetch">. Sem Speculation Rules: o caminho antigo (hover com espera, foco, toque → <link rel="prefetch">).
// Nada com Save-Data, 2g, nem para a própria página.
const { chromium } = require('playwright');

const SITE = process.env.SITE || 'http://localhost:8080/';
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, caminho = '', conexao = null, opcoes = {}, semRegras = false) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.pedidos = [];
  p.especulados = {}; // url -> último status do prefetch das Speculation Rules (via CDP)
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  p.on('request', (r) => p.pedidos.push(r.url()));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Preload.enable');
  cdp.on('Preload.prefetchStatusUpdated', (e) => { p.especulados[e.prefetchUrl] = e.status; });
  p.regrasComErro = [];
  cdp.on('Preload.ruleSetUpdated', (e) => { if (e.ruleSet.errorType) p.regrasComErro.push(e.ruleSet.errorType + ' ' + (e.ruleSet.errorMessage || '')); });
  await p.addInitScript(([c, sem]) => {
    try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ }
    if (c) Object.defineProperty(navigator, 'connection', { value: c, configurable: true });
    if (sem) {
      const orig = HTMLScriptElement.supports;
      HTMLScriptElement.supports = (t) => (t === 'speculationrules' ? false : orig.call(HTMLScriptElement, t));
    }
  }, [conexao, semRegras]);
  await p.goto(SITE + caminho, { waitUntil: 'networkidle' });
  return p;
}
const prefetches = (p) => p.$$eval('link[rel="prefetch"]', (ls) => ls.map((l) => new URL(l.href).pathname));
const regras = (p) => p.$$eval('script[type="speculationrules"]', (ss) => ss.map((s) => s.textContent));
const especulou = (p, fim) => Object.keys(p.especulados).filter((u) => new URL(u).pathname.endsWith(fim));

async function esperar(cond, ms = 3000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Speculation Rules: uma regra "moderate" na carga, sem erro de CSP; mouse → navegador pré-carrega');
  {
    const p = await abrir(browser);
    const r = await regras(p);
    ok(r.length === 1, 'uma regra speculationrules na página: ' + r.length);
    const regra = JSON.parse(r[0] || '{}');
    ok(regra.prefetch && regra.prefetch[0].eagerness === 'moderate' && regra.prefetch[0].source === 'document', 'prefetch, source document, eagerness moderate');
    ok(!regra.prerender, 'sem prerender (só baixa o HTML, não executa a página)');
    ok(p.regrasComErro.length === 0, 'regra aceita pelo navegador ' + p.regrasComErro.join(' | '));
    ok(Object.keys(p.especulados).length === 0, 'nada pré-carregado só por abrir a página');
    ok((await prefetches(p)).length === 0, 'nenhum <link rel=prefetch> na carga');
    const link = p.locator('header a[href="exemplos.html"]').first();
    const bx = await link.boundingBox();
    await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2, { steps: 4 });
    ok(await esperar(() => especulou(p, '/exemplos.html').length === 1 && p.especulados[especulou(p, '/exemplos.html')[0]] === 'Ready'),
      'mouse parado no link → exemplos.html pré-carregado pelo navegador: ' + JSON.stringify(p.especulados));
    ok((await prefetches(p)).length === 0, 'sem <link rel=prefetch> duplicado no hover');
    ok(p.erros.length === 0, 'console limpo (inclusive CSP) ' + p.erros.join(' | '));
    await p.context().close();
  }

  console.log('\n[2] Teclado: foco continua criando o <link rel="prefetch">, uma vez só');
  {
    const p = await abrir(browser);
    const link = p.locator('a[href^="planos.html"]:visible').first();
    await link.focus();
    await p.waitForTimeout(100);
    let l = await prefetches(p);
    ok(l.length === 1 && l[0].endsWith('/planos.html'), 'foco cria prefetch (âncora removida): ' + l.join(','));
    await p.locator('a[href^="planos.html"]:visible').nth(1).focus().catch(() => {});
    await p.waitForTimeout(100);
    ok((await prefetches(p)).length === 1, 'sem duplicar para a mesma página');
    await p.context().close();
  }

  console.log('\n[3] Toque no celular → navegador pré-carrega (pointerdown)');
  {
    const p = await abrir(browser, '', null, { viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true });
    ok((await regras(p)).length === 1, 'regra presente no celular');
    await p.evaluate(() => {
      const a = [...document.querySelectorAll('a[href^="planos.html"]')].find((x) => x.offsetParent);
      a.addEventListener('click', (e) => e.preventDefault(), { once: true });
    });
    await p.locator('a[href^="planos.html"]:visible').first().tap();
    ok(await esperar(() => especulou(p, '/planos.html').length >= 1), 'toque → planos.html pré-carregado: ' + JSON.stringify(p.especulados));
    await p.context().close();
  }

  console.log('\n[4] Save-Data e 2g: sem regra e sem <link rel=prefetch>');
  for (const c of [{ saveData: true, effectiveType: '4g' }, { saveData: false, effectiveType: 'slow-2g' }, { saveData: false, effectiveType: '2g' }]) {
    const p = await abrir(browser, '', c);
    ok((await regras(p)).length === 0, 'sem regra com ' + JSON.stringify(c));
    await p.locator('a[href^="planos.html"]:visible').first().focus();
    await p.waitForTimeout(100);
    ok((await prefetches(p)).length === 0, 'sem prefetch com ' + JSON.stringify(c));
    await p.context().close();
  }

  console.log('\n[5] Própria página excluída da regra; páginas de outra pasta');
  {
    const p = await abrir(browser, 'planos.html');
    const casa = await p.evaluate(() => {
      const r = JSON.parse(document.querySelector('script[type="speculationrules"]').textContent).prefetch[0].where.and;
      const pad = (o) => new URLPattern(Object.assign({ baseURL: location.href }, o.href_matches));
      const inclui = (u) => r[0].or.some((o) => pad(o).test(u));
      return {
        propria: pad(r[1].not).test(location.href) && pad(r[1].not).test(location.origin + location.pathname + '?plano=x#y'),
        exemplos: inclui(new URL('exemplos.html', location.href).href) && !pad(r[1].not).test(new URL('exemplos.html', location.href).href),
        pasta: inclui(location.origin + '/blog/../outra/planos.html?a=1'),
        parecido: inclui(location.origin + '/xplanos.html') || inclui(location.origin + '/planos.htmlx')
      };
    });
    ok(casa.propria, 'planos.html não pré-carrega a si mesma (com ?busca e #âncora)');
    ok(casa.exemplos && casa.pasta, 'exemplos.html e planos.html em qualquer pasta entram na regra');
    ok(!casa.parecido, 'nomes parecidos (xplanos.html) ficam de fora');
    const links = await p.$$('a[href="planos.html"], a[href^="planos.html#"]');
    for (const a of links) await a.focus().catch(() => {});
    ok(!(await prefetches(p)).some((x) => x.endsWith('/planos.html')), 'foco em link para a própria página não pré-carrega');
    ok(p.erros.length === 0, 'console limpo em planos.html ' + p.erros.join(' | '));
    await p.context().close();
    const b = await abrir(browser, 'blog/');
    ok((await regras(b)).length === 1 && b.regrasComErro.length === 0, 'blog: regra presente e válida');
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

  console.log('\n[6] Navegador sem Speculation Rules: caminho antigo do <link rel="prefetch">');
  {
    const p = await abrir(browser, '', null, {}, true);
    ok((await regras(p)).length === 0, 'sem regra');
    const link = p.locator('header a[href="exemplos.html"]').first();
    await link.hover();
    await p.waitForTimeout(250);
    let l = await prefetches(p);
    ok(l.length === 1 && l[0].endsWith('/exemplos.html'), 'hover cria prefetch: ' + l.join(','));
    await p.waitForTimeout(400);
    ok(p.pedidos.some((u) => u.endsWith('/exemplos.html')), 'navegador buscou exemplos.html');
    await p.locator('footer a[href="exemplos.html"]').first().hover();
    await p.waitForTimeout(250);
    ok((await prefetches(p)).length === 1, 'sem duplicar para a mesma página');
    const planos = p.locator('a[href^="planos.html"]:visible').first();
    await planos.hover();
    await p.mouse.move(0, 790);
    await p.waitForTimeout(250);
    ok(!(await prefetches(p)).some((x) => x.endsWith('/planos.html')), 'passada < 65 ms ignorada');
    ok(p.erros.length === 0, 'console limpo ' + p.erros.join(' | '));
    await p.context().close();
    const m = await abrir(browser, '', null, { viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true }, true);
    await m.evaluate(() => {
      const a = [...document.querySelectorAll('a[href^="planos.html"]')].find((x) => x.offsetParent);
      a.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [] }));
    });
    const lm = await prefetches(m);
    ok(lm.length === 1 && lm[0].endsWith('/planos.html'), 'touchstart cria prefetch');
    await m.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
