// Lembrete do pedido no topo do briefing (item 126 do MELHORIAS.md): depois de validar código + token, o formulário abre
// com "Seu pedido" (código, plano, prazo em dias úteis de config.planos[].prazo e a próxima etapa) e o link para
// pedido.html?pedido=<código>. Tudo por textContent, montado antes de o formulário aparecer (CLS 0), sem dados além do
// que a RPC briefing_obter já devolve. Plano desconhecido esconde a linha do prazo. Teclado, axe, 4 larguras e console.
// Supabase falso: as RPCs são respondidas pelo próprio Playwright (não precisa de Postgres).
// Uso: sirva a raiz (python3 -m http.server 8080) e rode  node testes/e2e/briefing-resumo-pedido.test.js
const { chromium } = require('playwright');
const fs = require('fs');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const CODIGO = 'PBR-ABCDEF';
const TOKEN = 'cd'.repeat(32);

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, largura, resposta, opcoes) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: largura, height: 800 } }, opcoes || {}));
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; }))
      .observe({ type: 'layout-shift', buffered: true });
  });
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route(/https:\/\/[a-z0-9]+\.supabase\.co\/.*/, (r) => {
    const url = r.request().url();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    let corpo = [];
    if (url.endsWith('/rpc/briefing_obter')) corpo = [resposta];
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(corpo) });
  });
  return p;
}

async function axe(p, rotulo) {
  await p.mouse.move(0, 0);
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}

async function abrir(p) {
  await p.goto(SITE + 'briefing.html#c=' + CODIGO + '&t=' + TOKEN, { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-form-briefing]:not([hidden])');
}
const resumo = (p) => p.$eval('[data-briefing-pedido]', (c) => {
  const t = (s) => c.querySelector(s).textContent.trim();
  return {
    codigo: t('[data-pedido-codigo]'), plano: t('[data-pedido-plano]'), prazo: t('[data-pedido-prazo]'),
    prazoOculto: c.querySelector('[data-pedido-prazo-linha]').hidden, proxima: t('[data-pedido-proxima]'),
    href: c.querySelector('[data-pedido-acompanhar]').getAttribute('href'),
    titulo: c.querySelector('h2') && c.querySelector('h2').textContent.trim(),
    imagens: c.querySelectorAll('img').length,
    antesDaEtapa: !!(c.compareDocumentPosition(document.querySelector('[data-etapa="1"]')) & Node.DOCUMENT_POSITION_FOLLOWING),
    visivel: c.getBoundingClientRect().height > 0
  };
});
const prazoConfig = (p, nome) => p.evaluate((n) => (window.PBR_CONFIG.planos.filter((x) => x.nome === n)[0] || {}).prazo, nome);

(async () => {
  const browser = await chromium.launch();
  const PRIMEIRO = { pedido_status: 'aprovado', plano_nome: 'Profissional', briefing: null };

  console.log('\n[1] Primeiro acesso: resumo com plano, prazo do config e próxima etapa (4 larguras)');
  for (const largura of [320, 375, 768, 1280]) {
    const p = await novaPagina(browser, largura, PRIMEIRO);
    await abrir(p);
    const r = await resumo(p);
    const prazo = await prazoConfig(p, 'Profissional');
    ok(r.visivel && r.titulo === 'Seu pedido' && r.antesDaEtapa, `${largura}px: "Seu pedido" no topo, antes da etapa 1`);
    ok(r.codigo === CODIGO && r.plano === 'Profissional', `${largura}px: código e plano`);
    ok(!!prazo && /dias úteis/.test(prazo) && r.prazo === prazo + '.' && !r.prazoOculto, `${largura}px: prazo vindo de config.planos ("${r.prazo}")`);
    ok(/^Enviar este briefing\./.test(r.proxima), `${largura}px: próxima etapa = enviar o briefing`);
    ok(r.href === 'pedido.html?pedido=' + CODIGO, `${largura}px: link para pedido.html?pedido=<código> sem token`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${largura}px: sem rolagem horizontal`);
    await p.waitForTimeout(300);
    const cls = await p.evaluate(() => window.__cls);
    ok(cls === 0, `${largura}px: CLS 0 (${cls})`);
    await p.screenshot({ path: `${SAIDA}/briefing-resumo-${largura}.png` });
    if (largura === 375 || largura === 1280) await axe(p, largura + 'px');
    ok(p.erros.length === 0, `${largura}px: console limpo` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[2] Briefing já enviado: próxima etapa muda');
  {
    const p = await novaPagina(browser, 375, { pedido_status: 'aprovado', plano_nome: 'Essencial',
      briefing: { status: 'novo', atualizado_em: '2026-11-20T10:00:00Z', nome_negocio: 'Doceria Exemplo' } });
    await abrir(p);
    const r = await resumo(p);
    ok(r.plano === 'Essencial' && r.prazo === (await prazoConfig(p, 'Essencial')) + '.', 'plano e prazo do Essencial');
    ok(/^Briefing recebido/.test(r.proxima), 'próxima etapa = produção (pode editar até lá)');
    ok(p.erros.length === 0, 'console limpo');
    await p.context().close();
  }

  console.log('\n[3] Plano fora do config: sem linha de prazo; nome do plano só como texto');
  {
    const p = await novaPagina(browser, 320, { pedido_status: 'aprovado', plano_nome: '<img src=x onerror="window.__xss=1">Antigo', briefing: null });
    await abrir(p);
    const r = await resumo(p);
    ok(r.prazoOculto && r.prazo === '', 'linha do prazo oculta (nada inventado)');
    ok(r.imagens === 0 && r.plano.startsWith('<img') && !(await p.evaluate(() => window.__xss)), 'plano inserido por textContent');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sem rolagem horizontal com nome longo');
    await p.context().close();
  }

  console.log('\n[4] Teclado: o link vem antes do primeiro campo e abre o acompanhamento');
  {
    const p = await novaPagina(browser, 375, PRIMEIRO);
    await abrir(p);
    await p.focus('#conteudo');
    let chegou = false; let passouCampo = false;
    for (let i = 0; i < 40; i++) {
      await p.keyboard.press('Tab');
      const atual = await p.evaluate(() => ({ link: document.activeElement.matches('[data-pedido-acompanhar]'), campo: document.activeElement.id === 'b-nome_negocio' }));
      if (atual.campo) passouCampo = true;
      if (atual.link) { chegou = true; break; }
    }
    ok(chegou && !passouCampo, 'Tab alcança "Acompanhar meu pedido" antes do primeiro campo');
    const contorno = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    ok(contorno !== 'none', 'foco visível no link');
    await Promise.all([p.waitForURL(/pedido\.html\?pedido=PBR-ABCDEF/), p.keyboard.press('Enter')]);
    ok(true, 'Enter abre pedido.html?pedido=' + CODIGO);
    await p.context().close();
  }

  console.log('\n[5] Modo escuro');
  {
    const p = await novaPagina(browser, 375, PRIMEIRO, { colorScheme: 'dark' });
    await abrir(p);
    await p.screenshot({ path: `${SAIDA}/briefing-resumo-escuro.png` });
    await axe(p, 'escuro');
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
