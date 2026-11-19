// Uso: veja testes/README.md (só precisa do servidor estático na porta 8080)
// Linha do tempo "Como funciona" (melhoria 12): prazos vindos do config.js, animação só ao entrar na tela,
// estado final sem animação com movimento reduzido e sem JS, sem rolagem horizontal.
const { chromium } = require('playwright');
const SITE = process.env.SITE || 'http://localhost:8080/';
let falhas = 0;
function ok(c, m) { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) falhas++; }

(async () => {
  const b = await chromium.launch();
  async function abrir(opcoes) {
    const ctx = await b.newContext(Object.assign({ viewport: { width: 375, height: 800 } }, opcoes));
    await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) {} });
    const p = await ctx.newPage();
    const erros = [];
    p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
    p.on('pageerror', (e) => erros.push(e.message));
    await p.goto(SITE, { waitUntil: 'networkidle' });
    return { ctx, p, erros };
  }

  console.log('[1] Prazos vêm do config.js');
  let { ctx, p, erros } = await abrir();
  const esperado = await p.evaluate(() => {
    const c = window.PBR_CONFIG;
    const dias = [...new Set(c.planos.map((x) => +/(\d+)\s*dias?\s+úte/i.exec(x.prazo)[1]))].sort((a, b) => a - b);
    return { dias: dias.slice(0, -1).join(', ') + ' ou ' + dias[dias.length - 1], suporte: String(c.legal.suportePosEntregaDias) };
  });
  const rotulos = await p.$$eval('[data-passo-prazo]', (els) => els.map((e) => ({ k: e.dataset.passoPrazo, t: e.textContent, h: e.hidden })));
  ok(rotulos.length === 4 && rotulos.every((r) => !r.h && r.t), '4 rótulos de prazo visíveis');
  ok(rotulos.find((r) => r.k === 'entrega').t.includes(esperado.dias + ' dias úteis'), 'entrega usa os dias dos planos: ' + esperado.dias);
  ok(rotulos.find((r) => r.k === 'publicacao').t.startsWith(esperado.suporte + ' dias'), 'suporte usa legal.suportePosEntregaDias');

  console.log('[2] Animação só ao entrar na tela');
  const lista = p.locator('[data-linha-tempo]');
  ok(!(await lista.getAttribute('class')).includes('linha-tempo--viva'), 'abaixo da dobra: ainda não animou');
  await p.locator('#como-funciona').scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  ok((await lista.getAttribute('class')).includes('linha-tempo--viva'), 'ao rolar: linha-tempo--viva');
  await p.waitForTimeout(3800);
  const fim = await p.$$eval('.passo__numero', (els) => els.map((e) => getComputedStyle(e).opacity));
  ok(fim.every((o) => o === '1'), 'ao final todos os números acesos');
  const trecho = await p.$eval('.passo:first-child', (e) => getComputedStyle(e, '::after').transform);
  ok(trecho === 'none' || trecho === 'matrix(1, 0, 0, 1, 0, 0)', 'trecho 1→2 preenchido');
  ok(await p.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'sem rolagem horizontal');
  ok(erros.length === 0, 'console limpo ' + erros.join(' | '));
  await ctx.close();

  console.log('[3] Movimento reduzido e sem JS: estado final direto');
  ({ ctx, p } = await abrir({ reducedMotion: 'reduce' }));
  await p.locator('#como-funciona').scrollIntoViewIfNeeded();
  ok((await p.$$eval('.passo__numero', (els) => els.map((e) => getComputedStyle(e).opacity))).every((o) => o === '1'), 'reduzido: números acesos sem animar');
  await ctx.close();
  ({ ctx, p } = await abrir({ javaScriptEnabled: false }));
  ok((await p.$$eval('.passo__numero', (els) => els.map((e) => getComputedStyle(e).opacity))).every((o) => o === '1'), 'sem JS: números visíveis');
  ok((await p.$$eval('[data-passo-prazo]', (els) => els.every((e) => e.hidden))), 'sem JS: rótulos de prazo ocultos (nada de texto vazio)');
  await ctx.close();

  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nLINHA DO TEMPO OK');
  process.exit(falhas ? 1 : 0);
})();
