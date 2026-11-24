// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Modo escuro (item 11 do MELHORIAS.md): segue o sistema, botão alterna e guarda a escolha (sem piscar nem CLS),
// sites de exemplo e painel sempre claros, axe sem violações no escuro em todas as páginas e larguras.
const { chromium } = require('playwright');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const PAGINAS = ['', 'planos.html', 'exemplos.html', 'portfolio.html', 'termos.html', 'privacidade.html', 'briefing.html', 'obrigado.html', 'blog/', 'blog/site-ou-instagram.html', 'segmentos/restaurante.html', 'segmentos/saude.html'];
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, opcoes = {}, caminho = '', antes) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.addInitScript(() => {
    try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ }
    window.__cls = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
  });
  if (antes) await p.addInitScript(antes);
  await p.goto(SITE + caminho, { waitUntil: 'networkidle' });
  return p;
}
const fundo = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const CLARO = 'rgb(255, 255, 255)';
const ESCURO = 'rgb(8, 16, 31)';

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Segue o sistema');
  {
    const p = await abrir(browser, { colorScheme: 'light' });
    ok(await fundo(p) === CLARO && await p.getAttribute('[data-tema-botao]', 'aria-pressed') === 'false', 'sistema claro: site claro, botão "Modo escuro" não pressionado');
    await p.emulateMedia({ colorScheme: 'dark' });
    await p.waitForTimeout(100);
    ok(await fundo(p) === ESCURO && await p.getAttribute('[data-tema-botao]', 'aria-pressed') === 'true', 'sistema muda para escuro: o site acompanha');
    ok(await p.getAttribute('meta[name="theme-color"]', 'content') === '#08101F', 'theme-color acompanha o tema');
    await p.context().close();
  }

  console.log('\n[2] Botão alterna e guarda a escolha');
  {
    const p = await abrir(browser, { colorScheme: 'light' });
    const b = p.locator('[data-tema-botao]');
    ok((await b.textContent()).trim() === 'Modo escuro' && await b.isVisible(), 'botão com nome acessível "Modo escuro"');
    await b.focus();
    await p.keyboard.press('Enter');
    ok(await fundo(p) === ESCURO && await b.getAttribute('aria-pressed') === 'true' && await p.evaluate(() => localStorage.getItem('pbr_tema')) === 'escuro', 'pelo teclado: escuro, salvo no localStorage');
    await p.goto(SITE + 'blog/', { waitUntil: 'networkidle' });
    ok(await fundo(p) === ESCURO, 'outra página já abre escura');
    // a escolha é aplicada antes da 1ª pintura (inicio.js síncrono): o atributo existe antes dos scripts defer
    const cedo = await p.evaluate(() => new Promise((r) => {
      const x = new XMLHttpRequest(); x.open('GET', location.href); x.onload = () => r(/<script src="[^"]*inicio\.js(?:\?v=[0-9a-f]+)?"><\/script>/.test(x.responseText)); x.send();
    }));
    ok(cedo && await p.evaluate(() => document.documentElement.getAttribute('data-tema')) === 'escuro', 'inicio.js (síncrono no <head>) aplica data-tema="escuro"');
    ok(await p.evaluate(() => window.__cls) === 0, 'CLS 0 com o botão e o tema salvo');
    await b.click();
    ok(await fundo(p) === CLARO && await p.evaluate(() => localStorage.getItem('pbr_tema')) === null && !(await p.evaluate(() => document.documentElement.hasAttribute('data-tema'))), 'voltar ao tema do sistema apaga a escolha (volta a seguir o sistema)');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();

    const q = await abrir(browser, { colorScheme: 'dark' }, '', () => { try { localStorage.setItem('pbr_tema', 'claro'); } catch (e) { /* */ } });
    ok(await fundo(q) === CLARO && await q.getAttribute('[data-tema-botao]', 'aria-pressed') === 'false', 'escolha "claro" vale mesmo com o sistema escuro');
    await q.context().close();
  }

  console.log('\n[3] Sites de exemplo e painel ficam claros');
  for (const c of ['exemplos/moda.html', 'admin/']) {
    const p = await abrir(browser, { colorScheme: 'dark' }, c, () => { try { localStorage.setItem('pbr_tema', 'escuro'); } catch (e) { /* */ } });
    const cor = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cor-fundo').trim());
    ok(cor.toLowerCase() === '#ffffff' && !(await p.evaluate(() => document.documentElement.hasAttribute('data-tema'))), `${c}: sempre claro`);
    ok(await p.locator('[data-tema-botao]').count() === 0 || await p.locator('[data-tema-botao]').isHidden(), `${c}: sem botão de tema`);
    await p.context().close();
  }

  console.log('\n[4] Sem JavaScript');
  {
    const p = await abrir(browser, { colorScheme: 'dark', javaScriptEnabled: false });
    ok(await fundo(p) === ESCURO && await p.locator('[data-tema-botao]').isHidden(), 'segue o sistema só com CSS; botão oculto');
    await p.context().close();
  }

  console.log('\n[5] Cabeçalho cabe com o botão');
  for (const w of [320, 375, 768, 1024, 1280]) {
    const p = await abrir(browser, { viewport: { width: w, height: 700 } });
    const r = await p.evaluate(() => {
      const topo = document.querySelector('.topo__barra').getBoundingClientRect();
      const itens = [...document.querySelectorAll('.topo__barra > *')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect());
      return { sem: document.documentElement.scrollWidth <= innerWidth, umaLinha: itens.every((i) => i.top >= topo.top - 1 && i.bottom <= topo.bottom + 1), dentro: itens.every((i) => i.right <= innerWidth) };
    });
    ok(r.sem && r.umaLinha && r.dentro, `${w}px: cabeçalho numa linha, sem rolagem horizontal`);
    await p.context().close();
  }

  console.log('\n[6] Escuro: axe em todas as páginas, 320/375/768/1280');
  for (const w of [320, 375, 768, 1280]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
    for (const c of PAGINAS) {
      const p = await ctx.newPage();
      const erros = [];
      p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
      await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
      await p.goto(SITE + c, { waitUntil: 'networkidle' });
      await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
      const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] })).violations
        .filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
      const sem = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      ok(v.length === 0 && sem && erros.length === 0, `${w}px ${c || 'home'}: escuro sem violações sérias, sem rolagem, console limpo` + (v.length ? ' → ' + v.join('; ') : '') + (erros.length ? ' | ' + erros.join(' ') : ''));
      await p.close();
    }
    await ctx.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DO MODO ESCURO PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
