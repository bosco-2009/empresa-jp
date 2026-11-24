// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Melhoria 74: o simulador da home guarda o último plano indicado (pbr_simulador_v1, 30 dias) e planos.html sem ?plano=
// mostra "O simulador indicou o plano X" com "Marcar" e "Dispensar". Nada é marcado sozinho; com ?plano= não aparece;
// vencido ou inválido é descartado; teclado, aria-live, axe, rolagem e console nas 4 larguras.
const { chromium } = require('playwright');
const fs = require('fs');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const CHAVE = 'pbr_simulador_v1';
const DIA = 24 * 60 * 60 * 1000;
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function contexto(browser, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  return ctx;
}
async function pagina(ctx) {
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  return p;
}
async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}
const marcado = (p) => p.evaluate(() => { const r = document.querySelector('input[name="plano"]:checked'); return r ? r.value : ''; });
const salvo = (p, k) => p.evaluate((k) => localStorage.getItem(k), k || CHAVE);
const caixa = (p) => p.locator('[data-sim-lembrete]');
async function gravar(p, valor) {
  await p.evaluate(([k, v]) => localStorage.setItem(k, v), [CHAVE, typeof valor === 'string' ? valor : JSON.stringify(valor)]);
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] O simulador guarda só o id do plano e a hora');
  const ctx = await contexto(browser);
  const p = await pagina(ctx);
  await p.goto(SITE, { waitUntil: 'networkidle' });
  ok(await salvo(p) === null, 'sem responder: nada salvo');
  await p.check('[data-simulador] input[name="vende"][value="nao"]');
  await p.check('[data-simulador] input[name="paginas"][value="uma"]');
  const cfg = await p.evaluate(() => ({ destaque: (PBR_CONFIG.planos.filter((x) => x.destaque)[0] || PBR_CONFIG.planos[0]).id, nomes: Object.fromEntries(PBR_CONFIG.planos.map((x) => [x.id, x.nome])) }));
  let s = JSON.parse(await salvo(p));
  ok(s && s.plano === 'essencial' && Math.abs(Date.now() - s.em) < 60000 && Object.keys(s).length === 2, 'salvou {plano, em}: ' + JSON.stringify(s));
  await p.check('[data-simulador] input[name="vende"][value="sim"]');
  s = JSON.parse(await salvo(p));
  ok(s.plano === 'premium', 'mudou a resposta → guarda o último indicado (premium)');
  ok(p.erros.length === 0, 'console limpo na home' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));

  console.log('\n[2] planos.html sem ?plano=: aviso, nada marcado sozinho');
  await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  ok(await caixa(p).isVisible(), 'aviso visível');
  ok((await p.textContent('[data-sim-lembrete-texto]')).includes('plano ' + cfg.nomes.premium), 'texto cita o plano ' + cfg.nomes.premium);
  ok(await marcado(p) === cfg.destaque, 'continua marcado o padrão (' + cfg.destaque + '), não o indicado');
  const ordem = await p.evaluate(() => {
    const c = document.querySelector('[data-sim-lembrete]');
    const o = document.querySelector('[data-opcoes-plano]');
    return !!(c.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING) && c.closest('fieldset') === o.closest('fieldset');
  });
  ok(ordem, 'aviso dentro do passo 1, antes das opções');
  await p.screenshot({ path: SAIDA + '/lembrar-simulador-1280.png', fullPage: false });

  console.log('\n[3] "Marcar" pelo teclado marca, foca o plano e anuncia');
  await p.focus('[data-sim-lembrete-marcar]');
  await p.keyboard.press('Enter');
  ok(await marcado(p) === 'premium', 'premium marcado');
  ok(await caixa(p).isHidden(), 'aviso some');
  ok(await p.evaluate(() => document.activeElement.name === 'plano' && document.activeElement.value === 'premium'), 'foco vai para o plano marcado');
  ok((await p.textContent('[data-sim-lembrete-aviso]')).includes('marcado'), 'anúncio em aria-live');
  ok(await p.getAttribute('[data-sim-lembrete-aviso]', 'aria-live') === 'polite', 'região polite');
  ok((await p.textContent('[data-resumo-plano]')).includes('Plano ' + cfg.nomes.premium), 'resumo atualizado');
  ok(/[?&]plano=premium/.test(p.url()), 'URL ganha ?plano=premium');
  ok(await salvo(p) !== null, 'marcar não apaga a lembrança');

  console.log('\n[4] Com ?plano= na URL: sem aviso');
  await p.goto(SITE + 'planos.html?plano=essencial', { waitUntil: 'networkidle' });
  ok(await caixa(p).isHidden() && await marcado(p) === 'essencial', 'quem chegou por link não vê o aviso');

  console.log('\n[5] Indicado = já marcado: sem aviso');
  await gravar(p, { plano: cfg.destaque, em: Date.now() });
  await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  ok(await caixa(p).isHidden(), 'nada a acrescentar quando o indicado já está marcado');

  console.log('\n[6] Marcar o plano à mão também fecha o aviso');
  await gravar(p, { plano: 'essencial', em: Date.now() });
  await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  ok(await caixa(p).isVisible(), 'aviso visível');
  await p.check('input[name="plano"][value="essencial"]');
  ok(await caixa(p).isHidden(), 'some ao escolher o plano indicado');

  console.log('\n[7] "Dispensar" apaga a lembrança e não volta');
  await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  await p.click('[data-sim-lembrete-dispensar]');
  ok(await caixa(p).isHidden() && await salvo(p) === null, 'oculto e apagado');
  ok(await marcado(p) === cfg.destaque, 'nada mudou na escolha');
  ok(await p.evaluate(() => document.activeElement.name === 'plano'), 'foco volta para as opções');
  await p.reload({ waitUntil: 'networkidle' });
  ok(await caixa(p).isHidden(), 'não reaparece ao recarregar');

  console.log('\n[8] Vencido, inválido ou corrompido: descartado sem erro');
  for (const [rotulo, valor, apaga] of [
    ['31 dias', { plano: 'premium', em: Date.now() - 31 * DIA }, true],
    ['29 dias', { plano: 'premium', em: Date.now() - 29 * DIA }, false],
    ['plano inexistente', { plano: 'xyz', em: Date.now() }, true],
    ['data no futuro', { plano: 'premium', em: Date.now() + 2 * DIA }, true],
    ['JSON quebrado', '{oi', false],
    ['tipos errados', { plano: 3, em: 'ontem' }, false],
  ]) {
    await gravar(p, valor);
    await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
    const visivel = await caixa(p).isVisible();
    const deve = rotulo === '29 dias';
    ok(visivel === deve, `${rotulo}: ${deve ? 'mostra' : 'não mostra'}`);
    if (apaga) ok(await salvo(p) === null, `${rotulo}: apagado`);
  }
  ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
  await ctx.close();

  console.log('\n[9] Sem localStorage (bloqueado): planos.html funciona');
  {
    const c = await contexto(browser);
    await c.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('bloqueado'); } }); });
    const q = await pagina(c);
    await q.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
    ok(await caixa(q).isHidden() && (await q.locator('input[name="plano"]').count()) > 0, 'sem aviso e com os planos');
    ok(q.erros.filter((e) => /pageerror/.test(e)).length === 0, 'sem exceção');
    await c.close();
  }

  console.log('\n[10] 4 larguras: rolagem, axe, console, alvos e tema escuro');
  for (const largura of [320, 375, 768, 1280]) {
    for (const tema of ['light', 'dark']) {
      const c = await browser.newContext({ viewport: { width: largura, height: 800 }, colorScheme: tema });
      await c.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
      await c.addInitScript((k) => { try { localStorage.setItem(k, JSON.stringify({ plano: 'premium', em: Date.now() })); } catch (e) { /* */ } }, CHAVE);
      const q = await pagina(c);
      await q.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
      ok(await caixa(q).isVisible(), `${largura}px ${tema}: aviso visível`);
      ok(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${largura}px ${tema}: sem rolagem horizontal`);
      const alvos = await q.evaluate(() => [...document.querySelectorAll('[data-sim-lembrete] button')].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
      ok(alvos.every((m) => m >= 24), `${largura}px ${tema}: botões com alvo ≥ 24 px (${alvos.map(Math.round).join(', ')})`);
      await axe(q, `${largura}px ${tema}`);
      await q.locator('[data-sim-lembrete]').screenshot({ path: `${SAIDA}/lembrar-simulador-caixa-${largura}-${tema}.png` });
      ok(q.erros.length === 0, `${largura}px ${tema}: console limpo` + (q.erros.length ? ': ' + q.erros.join(' | ') : ''));
      await c.close();
    }
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
