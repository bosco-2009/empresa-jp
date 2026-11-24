// Uso: servidor estático em :8080 (python3 -m http.server 8080 na raiz) e: node testes/e2e/foco-ancoras.test.js
// Foco no destino dos links internos (item 107 do MELHORIAS.md; WCAG 2.4.3, 2.4.1 e 2.4.11):
//   [1] "Pular para o conteúdo" em todas as páginas: Tab, Enter → foco no <main>, e o próximo Tab segue dentro dele.
//   [2] Cada link para um ponto da MESMA página (menu, hero, migalhas, "Ver comparativo", menu dos exemplos...), a 320
//       e 1280 px, ativado pelo teclado: o foco vai para o destino, o destino não fica atrás do cabeçalho fixo, e o
//       próximo Tab continua a partir dele (nunca volta para o topo).
//   [3] Cada link para um ponto de OUTRA página (index.html#duvidas, planos.html#comparativo...): ao chegar, o foco está
//       no destino, visível abaixo do cabeçalho; a home com #destino não mostra a abertura.
//   [4] Texto ampliado a 200% (WCAG 1.4.4): o scroll-padding-top acompanha a altura real do cabeçalho.
//   [5] O tabindex="-1" posto pelo JS some quando o foco sai (nada fica focável por clique sem querer).
// Sempre: zero erros no console (inclusive CSP). Screenshots em testes/e2e/saida/foco-ancoras-*.png.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '../..');

const BASE = process.env.SITE || 'http://localhost:8080/';
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

const PAGINAS = [
  '', 'planos.html', 'obrigado.html', 'briefing.html', 'pedido.html', 'termos.html', 'privacidade.html', 'portfolio.html',
  'exemplos.html', 'blog/', 'blog/autor.html',
  ...['site-ou-instagram', 'o-que-um-site-profissional-precisa-ter', 'como-funciona-a-criacao-do-seu-site'].map((x) => `blog/${x}.html`),
  ...['moda', 'restaurante', 'beleza', 'saude', 'servicos', 'pet'].map((x) => `exemplos/${x}.html`),
  ...['restaurante', 'moda', 'beleza', 'saude', 'servicos', 'pet'].map((x) => `segmentos/${x}.html`),
  'empresa-jp/uma/pagina/que/nao/existe',
];

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(ctx, url) {
  const p = await ctx.newPage();
  p.erros = [];
  // O próprio documento da 404 responde 404 (como no GitHub Pages): esse aviso do console é esperado
  p.on('console', (m) => { if (m.type() === 'error' && !(url.includes('/uma/pagina/') && /status of 404/.test(m.text()))) p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/uma/pagina/')) p.erros.push(r.status() + ' ' + r.url()); });
  // O 404.html usa caminhos absolutos /empresa-jp/ (como no GitHub Pages) e responde em qualquer caminho
  await p.route('**/empresa-jp/uma/pagina/**', (r) => r.fulfill({ status: 404, path: RAIZ + '/404.html', contentType: 'text/html; charset=utf-8' }));
  await p.route('**/empresa-jp/**', (r) => {
    const arquivo = path.join(RAIZ, decodeURIComponent(new URL(r.request().url()).pathname.replace(/^\/empresa-jp\//, '')));
    if (fs.existsSync(arquivo) && fs.statSync(arquivo).isFile()) return r.fulfill({ path: arquivo });
    return r.fallback();
  });
  await p.goto(new URL(url, BASE).href, { waitUntil: 'load' });
  await p.waitForTimeout(150);
  return p;
}

// Situação do foco em relação a um destino (id): está nele (ou dentro), visível abaixo do cabeçalho fixo?
function situacao(id) {
  const alvo = document.getElementById(id);
  const ativo = document.activeElement;
  const topo = document.querySelector('.topo');
  const fixo = topo && getComputedStyle(topo).position === 'sticky' ? topo.getBoundingClientRect().bottom : 0;
  const r = alvo.getBoundingClientRect();
  // O destino pode estar perto do fim da página (não dá para rolar mais): basta não ficar ATRÁS do cabeçalho
  return {
    focado: !!alvo && (ativo === alvo || alvo.contains(ativo)),
    ativo: ativo ? ativo.tagName + (ativo.id ? '#' + ativo.id : '') : '-',
    coberto: r.top < fixo - 1 && r.bottom > 0,
    // E à vista: começa na metade de cima da tela, salvo se a página já chegou ao fim e não rola mais
    longe: r.top > innerHeight / 2 && Math.ceil(scrollY + innerHeight) < document.documentElement.scrollHeight - 1,
    topo: Math.round(r.top), fixo: Math.round(fixo),
  };
}

// Depois de um Tab: o novo foco vem DEPOIS do destino (ou dentro dele) e não está atrás do cabeçalho
function depoisDoTab(id) {
  const alvo = document.getElementById(id);
  const ativo = document.activeElement;
  if (!ativo || ativo === document.body) return { ok: false, ativo: 'body' };
  const segue = alvo.contains(ativo) || !!(alvo.compareDocumentPosition(ativo) & Node.DOCUMENT_POSITION_FOLLOWING);
  const topo = document.querySelector('.topo');
  const fixo = topo && getComputedStyle(topo).position === 'sticky' ? topo.getBoundingClientRect().bottom : 0;
  const r = ativo.getBoundingClientRect();
  return { ok: segue && !(r.top < fixo - 1 && r.bottom <= fixo + 1), segue, ativo: ativo.tagName + ' ' + (ativo.getAttribute('aria-label') || ativo.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) };
}

(async () => {
  const browser = await chromium.launch();
  const ctxReduzido = (w) => browser.newContext({ viewport: { width: w, height: 760 }, reducedMotion: 'reduce' });

  console.log('\n[1] "Pular para o conteúdo" em todas as páginas');
  {
    const ctx = await ctxReduzido(375);
    for (const pagina of PAGINAS) {
      const p = await abrir(ctx, pagina);
      await p.keyboard.press('Tab');
      const primeiro = await p.evaluate(() => document.activeElement.getAttribute('href'));
      await p.keyboard.press('Enter');
      await p.waitForTimeout(100);
      const s = await p.evaluate(situacao, 'conteudo');
      await p.keyboard.press('Tab');
      const t = await p.evaluate(() => { const a = document.activeElement; return !!a.closest('main'); });
      ok(primeiro === '#conteudo' && s.focado && t, `${pagina || 'home'}: 1º Tab = pular (${primeiro}), foco ${s.ativo}, próximo Tab dentro do main: ${t}`);
      ok(p.erros.length === 0, `${pagina || 'home'}: console limpo ${p.erros.join(' | ')}`);
      await p.close();
    }
    await ctx.close();
  }

  console.log('\n[2] Links para um ponto da mesma página (320 e 1280 px, teclado)');
  const externos = new Set();
  for (const w of [320, 1280]) {
    const ctx = await ctxReduzido(w);
    for (const pagina of PAGINAS) {
      const p = await abrir(ctx, pagina);
      // Todos os links com # (fora o pular, já conferido); os de outra página ficam para a parte [3]
      const links = await p.evaluate(() => [...document.querySelectorAll('a[href*="#"]')]
        .filter((a) => !a.closest('[hidden], [aria-hidden="true"], [inert]') && a.getAttribute('href') !== '#conteudo' && a.target !== '_blank')
        .map((a, i) => {
          const u = new URL(a.href);
          const mesma = u.origin === location.origin && u.pathname === location.pathname && u.search === location.search;
          a.setAttribute('data-teste-ancora', i);
          return { i, href: a.getAttribute('href'), abs: u.href, mesma, id: decodeURIComponent(u.hash.slice(1)), menu: !!a.closest('[data-menu]') };
        }));
      links.filter((l) => !l.mesma && new URL(l.abs).origin === new URL(BASE).origin).forEach((l) => externos.add(l.abs));
      const vistos = new Set();
      for (const l of links.filter((x) => x.mesma)) {
        const chave = l.href + (l.menu ? ' (menu)' : '');
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        await p.evaluate(() => { history.replaceState(null, '', location.pathname + location.search); window.scrollTo(0, 0); document.activeElement && document.activeElement.blur(); });
        const link = p.locator(`[data-teste-ancora="${l.i}"]`);
        if (!(await link.isVisible())) {
          // Menu móvel fechado: abre pelo botão (como faria quem usa o teclado)
          const botao = p.locator('[data-menu-botao]');
          if (l.menu && await botao.isVisible()) { await botao.focus(); await p.keyboard.press('Enter'); }
          if (!(await link.isVisible())) continue; // ex.: link de outra largura
        }
        await link.focus();
        await p.keyboard.press('Enter');
        await p.waitForTimeout(250);
        const s = await p.evaluate(situacao, l.id);
        ok(s.focado && !s.coberto && !s.longe, `${w}px ${pagina || 'home'} ${chave}: foco ${s.ativo}, topo ${s.topo} ≥ cabeçalho ${s.fixo}`);
        await p.keyboard.press('Tab');
        const t = await p.evaluate(depoisDoTab, l.id);
        ok(t.ok, `${w}px ${pagina || 'home'} ${chave}: próximo Tab segue do destino (${t.ativo})`);
      }
      ok(p.erros.length === 0, `${w}px ${pagina || 'home'}: console limpo ${p.erros.join(' | ')}`);
      await p.close();
    }
    await ctx.close();
  }

  console.log('\n[3] Chegada de outra página com #destino');
  ok(externos.size >= 5, `${externos.size} destinos em outras páginas: ${[...externos].map((u) => u.replace(BASE, '')).join(', ')}`);
  for (const w of [320, 1280]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 760 } }); // sem movimento reduzido: abertura possível
    for (const abs of externos) {
      const u = new URL(abs);
      const id = decodeURIComponent(u.hash.slice(1));
      const p = await abrir(ctx, abs);
      await p.waitForTimeout(700);
      const s = await p.evaluate(situacao, id);
      const abertura = await p.evaluate(() => document.documentElement.classList.contains('com-abertura'));
      ok(s.focado && !s.coberto && !s.longe && !abertura, `${w}px ${abs.replace(BASE, '')}: foco ${s.ativo}, topo ${s.topo} ≥ ${s.fixo}, sem abertura: ${!abertura}`);
      await p.keyboard.press('Tab');
      const t = await p.evaluate(depoisDoTab, id);
      ok(t.ok, `${w}px ${abs.replace(BASE, '')}: próximo Tab segue do destino (${t.ativo})`);
      // Voltando com Shift+Tab, o controle anterior (às vezes meio escondido sob o cabeçalho) aparece inteiro
      await p.keyboard.press('Shift+Tab');
      await p.keyboard.press('Shift+Tab');
      await p.waitForTimeout(1300); // rolagem suave do navegador + o ajuste do main.js
      const v = await p.evaluate(() => {
        const a = document.activeElement, topo = document.querySelector('.topo');
        if (!a || a === document.body || topo.contains(a)) return { ok: true, ativo: a ? a.tagName : '-' };
        const r = a.getBoundingClientRect();
        return { ok: r.top >= topo.getBoundingClientRect().bottom + 4, ativo: a.tagName + ' ' + (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), topo: Math.round(r.top) };
      });
      ok(v.ok, `${w}px ${abs.replace(BASE, '')}: Shift+Tab mostra o foco inteiro abaixo do cabeçalho (${v.ativo}, ${v.topo})`);
      if (w === 320 && /index\.html#como-funciona|planos\.html#comparativo/.test(abs) && !/segmento/.test(abs)) {
        await p.screenshot({ path: `${SAIDA}/foco-ancoras-${w}-${id}.png` });
      }
      ok(p.erros.length === 0, `${w}px ${abs.replace(BASE, '')}: console limpo ${p.erros.join(' | ')}`);
      await p.close();
    }
    await ctx.close();
  }

  console.log('\n[4] Texto a 200%: scroll-padding-top acompanha o cabeçalho');
  {
    const ctx = await ctxReduzido(320);
    const p = await abrir(ctx, '');
    const medir = () => p.evaluate(() => ({
      topo: document.querySelector('.topo').getBoundingClientRect().height,
      padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
    }));
    const antes = await medir();
    await p.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await p.waitForTimeout(200);
    const depois = await medir();
    ok(antes.padding >= antes.topo && depois.padding >= depois.topo && depois.topo > antes.topo,
      `cabeçalho ${antes.topo}→${depois.topo} px, scroll-padding-top ${antes.padding}→${depois.padding} px`);
    await p.locator('main a[href="#como-funciona"]').first().focus();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(250);
    const s = await p.evaluate(situacao, 'como-funciona');
    ok(s.focado && !s.coberto && !s.longe, `a 200%: #como-funciona focado e abaixo do cabeçalho (${s.topo} ≥ ${s.fixo})`);
    await p.keyboard.press('Tab');
    await p.screenshot({ path: `${SAIDA}/foco-ancoras-200.png` });
    await p.close();
    await ctx.close();
  }

  console.log('\n[5] tabindex temporário');
  {
    const ctx = await ctxReduzido(1280);
    const p = await abrir(ctx, '');
    ok(await p.evaluate(() => !document.getElementById('como-funciona').hasAttribute('tabindex')), 'sem JS de âncora, a seção não é focável');
    await p.locator('main a[href="#como-funciona"]').first().focus();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(200);
    const durante = await p.evaluate(() => document.getElementById('como-funciona').getAttribute('tabindex'));
    await p.keyboard.press('Tab');
    const depois = await p.evaluate(() => document.getElementById('como-funciona').hasAttribute('tabindex'));
    ok(durante === '-1' && !depois, `tabindex "-1" só enquanto focado (durante: ${durante}, depois do Tab: ${depois})`);
    // Com rolagem suave (sem movimento reduzido) o foco também chega
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const p2 = await abrir(ctx2, 'planos.html');
    await p2.locator('a[href="#comparativo"]').first().focus();
    await p2.keyboard.press('Enter');
    await p2.waitForTimeout(1200);
    const s = await p2.evaluate(situacao, 'comparativo');
    ok(s.focado && !s.coberto && !s.longe, `rolagem suave: #comparativo focado (${s.ativo}, topo ${s.topo} ≥ ${s.fixo})`);
    await ctx2.close();
    await ctx.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
