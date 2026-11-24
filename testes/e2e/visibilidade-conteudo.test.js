// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Melhoria 109: content-visibility: auto nas seções longas abaixo da dobra (home e artigos do blog).
//  [1] Cada bloco marcado tem content-visibility: auto na tela e a altura reservada (--altura-estimada) nunca é
//      menor que a do conteúdo (senão o conteúdo de um bloco pulado vaza sobre o seguinte e o axe mede o contraste
//      contra o fundo errado) nem passa dela em mais de 30% (a barra de rolagem não "pula"), nas larguras das
//      bordas de cada faixa: 320, 375, 768, 1023, 1024 e 1280 px.
//  [2] Na carga, os blocos abaixo da dobra ficam de fato pulados (o revelar.js não força o layout deles).
//  [3] Rolar a página inteira (para baixo, End e de volta para cima): CLS 0 e console limpo; com animações,
//      todos os itens com data-revelar terminam revelados.
//  [4] Âncora direta (index.html#faq-...): a pergunta abre dentro da tela, abaixo do cabeçalho, e não sai do lugar.
//  [5] Busca do navegador: texto de um bloco ainda pulado é encontrado (window.find) e o bloco é renderizado.
//  [6] Impressão: tudo volta a content-visibility: visible (a regra é só @media screen).
//  [7] Tempo de estilo + layout na carga (CPU 4x mais lenta, mediana de 5): com a regra × sem ela (CSS reescrito
//      só neste teste). Os números são impressos para registro e "com" precisa ser menor que "sem".
const { chromium } = require('playwright');

const SITE = process.env.SITE || 'http://localhost:8080/';
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

const ARTIGOS = ['blog/site-ou-instagram.html', 'blog/o-que-um-site-profissional-precisa-ter.html',
  'blog/como-funciona-a-criacao-do-seu-site.html'];
const PAGINAS = { 'index.html': '.hero ~ .secao:not([hidden])' };
ARTIGOS.forEach((a) => { PAGINAS[a] = '.artigo > .artigo__corpo > :is(.indicado, .artigo__chamada, .artigo__mais)'; });
const ALTURA = (w) => (w < 768 ? 740 : 800);

async function abrir(browser, w, url, opcoes = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: w, height: ALTURA(w) } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; }))
      .observe({ type: 'layout-shift', buffered: true });
  });
  await p.goto(SITE + url, { waitUntil: 'load' });
  return p;
}

// Estado de cada bloco: regra aplicada, altura reservada e se o conteúdo está pulado agora.
const ler = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((el) => {
  const cs = getComputedStyle(el);
  const filho = el.querySelector('h2, p, li');
  return {
    nome: el.id || el.className.split(' ')[0],
    cv: cs.contentVisibility,
    estimada: parseFloat(cs.getPropertyValue('--altura-estimada')),
    pulado: filho ? !filho.checkVisibility({ contentVisibilityAuto: true }) : null,
    topo: el.getBoundingClientRect().top
  };
}), sel);

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Regra aplicada e altura reservada perto da real');
  for (const [pag, sel] of Object.entries(PAGINAS)) {
    for (const w of [320, 375, 768, 1023, 1024, 1280]) {
      const p = await abrir(browser, w, pag, { reducedMotion: 'reduce' });
      const blocos = await ler(p, sel);
      // altura real do conteúdo: renderiza cada bloco (rolando até ele) e mede sem padding/borda
      const reais = await p.evaluate(async (s) => {
        const out = [];
        for (const el of document.querySelectorAll(s)) {
          el.scrollIntoView();
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const cs = getComputedStyle(el);
          const extra = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((a, k) => a + parseFloat(cs[k]), 0);
          out.push(el.getBoundingClientRect().height - extra);
        }
        return out;
      }, sel);
      const ruins = blocos.map((b, i) => ({ b, real: reais[i] }))
        .filter(({ b, real }) => b.cv !== 'auto' || !(real <= b.estimada + 1 && b.estimada <= real * 1.3))
        .map(({ b, real }) => `${b.nome} cv=${b.cv} estimada=${b.estimada} real=${Math.round(real)}`);
      ok(blocos.length >= (pag === 'index.html' ? 7 : 3) && ruins.length === 0,
        `${pag} ${w}px: ${blocos.length} blocos com content-visibility: auto e altura reservada ≥ real e ≤ 30% acima` + (ruins.length ? ' — ' + ruins.join('; ') : ''));
      await p.context().close();
    }
  }

  console.log('\n[2] Na carga, o que está abaixo da dobra fica pulado (com animações ligadas)');
  for (const [pag, sel] of Object.entries(PAGINAS)) {
    for (const w of [375, 1280]) {
      const p = await abrir(browser, w, pag);
      await p.waitForTimeout(600);
      const blocos = await ler(p, sel);
      // o Chrome renderiza com folga de ~1,5 tela além da dobra; "longe" = a mais de 3 telas do topo
      const longe = blocos.filter((b) => b.topo > ALTURA(w) * 3);
      ok(longe.length > 0 && longe.every((b) => b.pulado),
        `${pag} ${w}px: ${longe.length} blocos longe da dobra continuam pulados` +
        (longe.some((b) => !b.pulado) ? ' — renderizados: ' + longe.filter((b) => !b.pulado).map((b) => b.nome).join(', ') : ''));
      await p.context().close();
    }
  }

  console.log('\n[3] Rolar a página inteira: CLS 0, console limpo e tudo revelado');
  for (const [pag, sel] of Object.entries(PAGINAS)) {
    for (const w of [320, 1280]) {
      const p = await abrir(browser, w, pag);
      await p.waitForTimeout(300);
      await p.mouse.move(w / 2, 300);
      for (let i = 0; i < 80; i++) {
        await p.mouse.wheel(0, 400);
        await p.waitForTimeout(25);
        if (await p.evaluate(() => innerHeight + scrollY >= document.documentElement.scrollHeight - 2)) break;
      }
      await p.waitForTimeout(500);
      for (let i = 0; i < 80 && (await p.evaluate(() => scrollY)) > 0; i++) { await p.mouse.wheel(0, -500); await p.waitForTimeout(20); }
      await p.keyboard.press('End');
      await p.waitForTimeout(300);
      await p.keyboard.press('Home');
      await p.waitForTimeout(400);
      const r = await p.evaluate(() => ({
        cls: window.__cls,
        faltam: [...document.querySelectorAll('[data-revelar]')].filter((e) => !e.classList.contains('revelado')).length,
        largura: document.documentElement.scrollWidth
      }));
      const blocos = await ler(p, sel);
      ok(r.cls === 0, `${pag} ${w}px: CLS ${r.cls.toFixed(4)} ao rolar a página inteira`);
      ok(r.faltam === 0, `${pag} ${w}px: todos os itens animados ficaram revelados (faltam ${r.faltam})`);
      ok(blocos.every((b) => !b.pulado || b.topo > 0), `${pag} ${w}px: nenhum bloco ficou pulado dentro da tela`);
      ok(r.largura === w, `${pag} ${w}px: sem rolagem horizontal (${r.largura})`);
      ok(p.erros.length === 0, `${pag} ${w}px: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
      await p.context().close();
    }
  }

  console.log('\n[4] Âncora direta para uma pergunta do FAQ');
  {
    const p0 = await abrir(browser, 375, 'index.html', { reducedMotion: 'reduce' });
    const ids = await p0.evaluate(() => [...document.querySelectorAll('details.faq__item[id]')].map((d) => d.id));
    await p0.context().close();
    const alvo = ids[ids.length - 1];
    ok(Boolean(alvo), `FAQ com ids (${ids.length}); alvo: #${alvo}`);
    for (const w of [320, 1280]) {
      const p = await abrir(browser, w, 'index.html#' + alvo);
      await p.waitForTimeout(1500); // a pergunta entra com a animação de revelar (subida curta) antes de assentar
      const pos = () => p.evaluate((id) => {
        const el = document.getElementById(id);
        const cab = document.querySelector('.cabecalho');
        const base = cab && getComputedStyle(cab).position === 'sticky' ? cab.getBoundingClientRect().bottom : 0;
        return { topo: Math.round(el.getBoundingClientRect().top), base: Math.round(base), aberto: el.open, h: innerHeight };
      }, alvo);
      const a = await pos();
      await p.waitForTimeout(1200);
      const b = await pos();
      ok(a.topo >= a.base - 1 && a.topo < a.h - 40, `${w}px: #${alvo} visível abaixo do cabeçalho (topo ${a.topo}, cabeçalho até ${a.base})`);
      ok(Math.abs(a.topo - b.topo) <= 1, `${w}px: a pergunta não sai do lugar depois (${a.topo} → ${b.topo})`);
      ok(p.erros.length === 0, `${w}px: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
      await p.context().close();
    }
  }

  console.log('\n[5] Busca do navegador encontra texto de bloco ainda pulado');
  for (const [pag, sel] of Object.entries(PAGINAS)) {
    const p = await abrir(browser, 375, pag, { reducedMotion: 'reduce' });
    const r = await p.evaluate((s) => {
      const blocos = [...document.querySelectorAll(s)];
      const bloco = blocos.reverse().find((el) => { const f = el.querySelector('h2'); return f && !f.checkVisibility({ contentVisibilityAuto: true }); });
      if (!bloco) return { achou: false, texto: '(nenhum bloco pulado)' };
      const h2 = bloco.querySelector('h2');
      const texto = h2.textContent.trim().slice(0, 30);
      const achou = window.find(texto, false, false, true);
      return { achou, texto, nome: bloco.id || bloco.className.split(' ')[0] };
    }, sel);
    await p.waitForTimeout(300);
    const renderizado = await p.evaluate((s) => {
      const sel = window.getSelection();
      return sel.rangeCount > 0 && sel.anchorNode.parentElement.checkVisibility({ contentVisibilityAuto: true });
    }, sel);
    ok(r.achou && renderizado, `${pag}: "${r.texto}" (${r.nome || '-'}) encontrado e renderizado pela busca`);
    await p.context().close();
  }

  console.log('\n[6] Impressão: nada fica pulado');
  for (const [pag, sel] of Object.entries(PAGINAS)) {
    const p = await abrir(browser, 375, pag, { reducedMotion: 'reduce' });
    await p.emulateMedia({ media: 'print' });
    const blocos = await ler(p, sel);
    ok(blocos.every((b) => b.cv === 'visible'), `${pag}: content-visibility: visible em todos os ${blocos.length} blocos na impressão`);
    await p.context().close();
  }

  console.log('\n[7] Tempo de estilo + layout na carga (CPU 4x mais lenta, mediana de 5)');
  async function medir(pag, w, semRegra) {
    const ctx = await browser.newContext({ viewport: { width: w, height: ALTURA(w) } });
    const p = await ctx.newPage();
    if (semRegra) {
      await p.route(/\/assets\/css\/(home|blog)\.css/, async (rota) => {
        const res = await rota.fetch();
        const corpo = (await res.text()).replace(/content-visibility: auto/g, 'content-visibility: visible');
        rota.fulfill({ response: res, body: corpo });
      });
    }
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await p.goto(SITE + pag, { waitUntil: 'load' });
    await p.waitForTimeout(800);
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    await ctx.close();
    return (m.LayoutDuration + m.RecalcStyleDuration) * 1000;
  }
  const mediana = (v) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
  for (const pag of ['index.html', ARTIGOS[0]]) {
    for (const w of [375, 1280]) {
      const sem = [], com = [];
      for (let i = 0; i < 5; i++) { sem.push(await medir(pag, w, true)); com.push(await medir(pag, w, false)); }
      const ms = mediana(sem), mc = mediana(com);
      ok(mc < ms, `${pag} ${w}px: estilo+layout ${ms.toFixed(0)} ms sem a regra → ${mc.toFixed(0)} ms com ela (${Math.round((1 - mc / ms) * 100)}% a menos)`);
    }
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
