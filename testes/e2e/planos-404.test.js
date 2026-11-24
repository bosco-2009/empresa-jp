// Melhoria 86: planos em resumo e "Fale no chat" na 404.
// Uso: sirva a pasta raiz (python3 -m http.server 8080) e rode `node testes/e2e/planos-404.test.js`.
// Confere em 320/375/768/1280 px (claro e escuro): 3 planos com nome e preço do config.js, links ABSOLUTOS
// /empresa-jp/planos.html?plano=<id> que abrem sem erro, nenhum link da 404 quebrado, botão do chat abrindo
// o widget, sem rolagem horizontal, axe sem violações sérias e nada do bloco sem JavaScript.
// Screenshots em testes/e2e/saida/planos-404/ (fora do git).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const RAIZ = path.resolve(__dirname, '../..');
const AXE = require.resolve('axe-core/axe.min.js');
const CAMINHO = 'empresa-jp/uma/pagina/que/nao/existe';
const CAPTURAS = path.join(__dirname, 'saida', 'planos-404');
const html404 = fs.readFileSync(RAIZ + '/404.html', 'utf8');
// Supabase apontado para uma porta fechada: o teste não depende do chat responder, só de abrir o painel.
const configTeste = fs.readFileSync(RAIZ + '/config.js', 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, "$1'http://localhost:54321'");

// Lê config.planos do config.js real (o mesmo objeto que a página usa).
const cfg = (() => { const w = {}; new Function('window', fs.readFileSync(RAIZ + '/config.js', 'utf8'))(w); return w.PBR_CONFIG; })();
const real = (c) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: (c % 100 ? 2 : 0) }).format(c / 100).replace(/\s/g, ' ');

let falhas = 0;
function ok(cond, msg) { if (!cond) { falhas++; console.log('  ✘ ' + msg); } else console.log('  ✔ ' + msg); return cond; }

async function abrir(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  const p = await ctx.newPage();
  const erros = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 404|ERR_CONNECTION_REFUSED|Failed to fetch|indispon/i.test(m.text())) erros.push(m.text()); });
  p.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route('**/empresa-jp/**', (r) => {
    const u = new URL(r.request().url());
    const arquivo = path.join(RAIZ, decodeURIComponent(u.pathname.replace(/^\/empresa-jp\//, '')));
    if (fs.existsSync(arquivo) && fs.statSync(arquivo).isFile()) return r.fulfill({ path: arquivo });
    return r.fulfill({ status: 404, body: html404, contentType: 'text/html; charset=utf-8' });
  });
  await p.goto(SITE + CAMINHO, { waitUntil: 'networkidle' });
  return { ctx, p, erros };
}

(async () => {
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const browser = await chromium.launch();

  for (const esquema of ['light', 'dark']) {
    for (const w of [320, 375, 768, 1280]) {
      const rotulo = `${w}px ${esquema === 'dark' ? 'escuro' : 'claro'}`;
      const { ctx, p, erros } = await abrir(browser, { viewport: { width: w, height: 900 }, colorScheme: esquema, reducedMotion: 'reduce' });

      const itens = await p.$$eval('[data-planos-404-lista] a', (as) => as.map((a) => ({
        href: a.getAttribute('href'), nome: a.querySelector('.planos-404__nome').textContent,
        preco: a.querySelector('.planos-404__preco').textContent, texto: a.textContent.replace(/\s+/g, ' ').trim(),
      })));
      ok(await p.isVisible('[data-planos-404]'), `${rotulo}: bloco de planos visível`);
      ok(itens.length === cfg.planos.length, `${rotulo}: ${itens.length} planos (config tem ${cfg.planos.length})`);
      cfg.planos.forEach((pl, i) => {
        const it = itens[i] || {};
        ok(it.nome === pl.nome && it.preco.replace(/\s/g, ' ') === real(pl.precoCentavos), `${rotulo}: ${pl.nome} ${real(pl.precoCentavos)} igual ao config.js`);
        ok(it.href === '/empresa-jp/planos.html?plano=' + pl.id, `${rotulo}: link absoluto do ${pl.nome} (${it.href})`);
      });
      ok(await p.isVisible('[data-abrir-chat]'), `${rotulo}: botão "Fale no chat" visível`);
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${rotulo}: sem rolagem horizontal`);

      await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
      const graves = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
        .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => x.id + ' → ' + x.nodes[0].target.join(' ')));
      ok(graves.length === 0, `${rotulo}: axe sem violações sérias ${graves.join('; ')}`);

      await p.locator('[data-planos-404]').screenshot({ path: path.join(CAPTURAS, `planos-404-${w}-${esquema}.png`) });
      if (w === 375 && esquema === 'light') await p.screenshot({ path: path.join(CAPTURAS, 'planos-404-pagina-375.png'), fullPage: true });

      // Teclado: o 1º plano é alcançável por Tab e o Enter no botão abre o chat.
      if (w === 375 || w === 1280) {
        await p.focus('[data-planos-404-lista] a');
        ok(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), `${rotulo}: foco visível no cartão do plano`);
        await p.focus('[data-abrir-chat]');
        await p.keyboard.press('Enter');
        await p.waitForTimeout(200);
        ok(await p.evaluate(() => document.querySelector('.chat__lancador').getAttribute('aria-expanded') === 'true'), `${rotulo}: Enter em "Fale no chat" abre o chat`);
        await p.click('[data-abrir-chat]', { force: true }).catch(() => {});
        ok(await p.evaluate(() => document.querySelector('.chat__lancador').getAttribute('aria-expanded') === 'true'), `${rotulo}: clicar de novo não fecha o chat`);
      }
      ok(erros.length === 0, `${rotulo}: sem erros no console ${erros.join(' | ')}`);
      await ctx.close();
    }
  }

  // Todos os links internos da 404 abrem uma página existente (nenhum cai na própria 404).
  {
    const { ctx, p } = await abrir(browser, { viewport: { width: 1280, height: 900 } });
    const hrefs = [...new Set(await p.$$eval('a[href^="/empresa-jp/"]', (as) => as.map((a) => a.getAttribute('href'))))];
    for (const h of hrefs) {
      const caminho = decodeURIComponent(new URL(h, SITE).pathname.replace(/^\/empresa-jp\//, '')).replace(/\/$/, '/index.html') || 'index.html';
      ok(fs.existsSync(path.join(RAIZ, caminho)), `link ${h} existe (${caminho})`);
    }
    const resposta = await p.goto(new URL('/empresa-jp/planos.html?plano=' + cfg.planos[0].id, SITE).href, { waitUntil: 'domcontentloaded' });
    ok(resposta.status() === 200 && await p.title() !== '' && !/não encontrada/i.test(await p.title()), 'link do plano abre planos.html (200)');
    await ctx.close();
  }

  // Sem JavaScript: o bloco fica oculto (depende do config.js) e a 404 continua útil.
  {
    const { ctx, p } = await abrir(browser, { viewport: { width: 375, height: 800 }, javaScriptEnabled: false });
    ok(!(await p.isVisible('[data-planos-404]')), 'sem JS: bloco de planos oculto');
    ok(await p.isVisible('a.botao[href="/empresa-jp/planos.html"]'), 'sem JS: "Ver planos" continua visível');
    await ctx.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nPLANOS NA 404 OK');
  process.exit(falhas ? 1 : 0);
})();
