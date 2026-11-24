// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Melhoria 38: caminho crítico de CSS.
//  - home.css (regras só da home) é baixado só pela home, logo depois de main.css; nenhuma outra página o baixa;
//  - as páginas que não são a home não carregam regras da abertura/mockup/linha do tempo;
//  - planos.html não desloca o formulário quando o JS preenche as condições de pagamento (CLS 0);
//  - home, planos, blog e um artigo sem deslocamento de layout em 320/375/768/1280 px, claro e escuro
//    (planos em 768/1280 px: só o deslocamento mínimo que já existia, ver o comentário no laço).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const RAIZ = path.join(__dirname, '..', '..');
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

function paginas(dir, prefixo = '') {
  return fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory() && ['blog', 'exemplos', 'segmentos', 'admin'].includes(e.name) && !prefixo) return paginas(e.name, e.name + '/');
    return e.isFile() && e.name.endsWith('.html') ? [prefixo + e.name] : [];
  });
}

(async () => {
  console.log('\n[1] home.css só na home, logo depois de main.css');
  const todas = paginas('.');
  for (const p of todas) {
    const html = fs.readFileSync(path.join(RAIZ, p), 'utf8');
    const folhas = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1].split('?')[0].split('/').pop());
    if (p === 'index.html') {
      ok(folhas.indexOf('home.css') === folhas.indexOf('main.css') + 1, 'index.html: home.css logo depois de main.css (mesma cascata)');
    } else if (folhas.includes('home.css')) {
      ok(false, p + ' não deveria baixar home.css');
    }
  }
  ok(true, todas.length + ' páginas conferidas');
  const main = fs.readFileSync(path.join(RAIZ, 'assets/css/main.css'), 'utf8');
  const mov = fs.readFileSync(path.join(RAIZ, 'assets/css/movimento.css'), 'utf8');
  ok(!/\.(mock|mock-tela|mockup-pausa|hero|sim-opcao|cta-final|grade-segmentos|passos)\b/.test(main), 'main.css sem regras exclusivas da home');
  ok(!/\.abertura|linha-tempo|hero__visual/.test(mov), 'movimento.css sem abertura, linha do tempo e mockup 3D');

  const browser = await chromium.launch();
  console.log('\n[2] Sem deslocamento de layout (CLS 0) e sem home.css fora da home');
  for (const url of ['', 'planos.html', 'planos.html?plano=essencial', 'blog/', 'blog/site-ou-instagram.html']) {
    for (const tema of ['light', 'dark']) {
      for (const largura of [320, 375, 768, 1280]) {
        const ctx = await browser.newContext({ viewport: { width: largura, height: 800 }, colorScheme: tema });
        const p = await ctx.newPage();
        const erros = [];
        const folhas = [];
        p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
        p.on('pageerror', (e) => erros.push(e.message));
        p.on('request', (r) => { if (r.resourceType() === 'stylesheet') folhas.push(r.url().split('?')[0].split('/').pop()); });
        await p.addInitScript(() => {
          try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* sem sessionStorage */ }
          window.__cls = 0;
          new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
            .observe({ type: 'layout-shift', buffered: true });
        });
        await p.goto(SITE + url, { waitUntil: 'load' });
        await p.waitForTimeout(400);
        const cls = await p.evaluate(() => window.__cls);
        const largo = await p.evaluate(() => document.documentElement.scrollWidth);
        const nome = (url || 'home') + ' ' + largura + 'px ' + (tema === 'dark' ? 'escuro' : 'claro');
        // Celular (a medição do Lighthouse mobile): CLS 0. Em 768/1280 px, planos.html ainda tem um deslocamento
        // mínimo que já existia (os cartões de plano são montados pelo JS e empurram a borda do 2º grupo, visível
        // no fim da tela); fica registrado no MELHORIAS.md e o teste só impede que ele cresça.
        const limite = url.startsWith('planos') && largura >= 768 ? 0.005 : 0;
        ok(cls <= limite, nome + ': CLS ' + cls.toFixed(4) + (limite ? ' (≤ ' + limite + ')' : ''));
        ok(largo === largura, nome + ': sem rolagem horizontal');
        ok(erros.length === 0, nome + ': console limpo' + (erros.length ? ' — ' + erros[0] : ''));
        ok((url === '') === folhas.includes('home.css'), nome + ': home.css ' + (url === '' ? 'baixado' : 'não baixado'));
        await ctx.close();
      }
    }
  }

  console.log('\n[3] planos.html: condições de pagamento preenchidas e espaço reservado só com JS');
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(SITE + 'planos.html', { waitUntil: 'load' });
  const texto = await p.textContent('[data-texto-parcelamento]');
  ok(texto.trim().length > 0, 'texto de parcelamento vindo do config.js');
  await ctx.close();
  const semJs = await browser.newContext({ viewport: { width: 375, height: 800 }, javaScriptEnabled: false });
  const q = await semJs.newPage();
  await q.goto(SITE + 'planos.html');
  ok(await q.evaluate(() => getComputedStyle(document.querySelector('.pagina-topo__parcelamento')).display === 'inline'),
    'sem JS nenhum espaço é reservado');
  await semJs.close();

  await browser.close();
  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nCSS CRÍTICO OK');
  process.exit(falhas ? 1 : 0);
})();
