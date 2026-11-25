// Avisos temporários (item 112 do MELHORIAS.md, WCAG 2.2.1 e 4.1.3), com o relógio controlado (page.clock):
//  - "Link copiado" do FAQ (home): o rótulo do botão não muda; a confirmação fica num role="status" (anunciada uma vez:
//    um único texto não vazio por clique), dura pelo menos 5 s, não some com o foco ou o ponteiro dentro e Esc dispensa.
//  - Arquivo recusado no briefing: o item fica ≥ 5 s, não some com o foco nele, "Fechar"/Esc dispensam e o foco volta
//    ao campo de arquivos.
//  - Painel: "Tempo real de volta" fica ≥ 5 s, não some com o foco no aviso, "Fechar aviso"/Esc dispensam e o foco vai
//    para o conteúdo principal. (Precisa do Supabase falso em :54321, como o tempo-real-pausado.test.js.)
//  - 320/375/768/1280 px: sem rolagem horizontal, axe sem violações sérias com o aviso na tela, console limpo.
// Uso: sirva a raiz (python3 -m http.server 8080), rode  npm run servidor  e  node testes/e2e/avisos-temporarios.test.js
const { chromium } = require('playwright');
const fs = require('fs');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
const RAIZ = require('path').resolve(__dirname, '../..');
fs.mkdirSync(SAIDA, { recursive: true });
const LARGURAS = [320, 375, 768, 1280];

const configOriginal = fs.readFileSync(RAIZ + '/config.js', 'utf8');
const configTeste = configOriginal
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, largura, opcoes = {}) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 800 } });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.addInitScript(() => {
    try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ }
    // Conta cada texto não vazio escrito nas regiões role="status" (anunciado = um texto novo na região)
    window.__anuncios = [];
    new MutationObserver((ms) => ms.forEach((m) => {
      const alvo = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      const regiao = alvo && alvo.closest('[role="status"]');
      if (regiao && regiao.textContent.trim()) window.__anuncios.push(regiao.textContent.trim());
    })).observe(document, { subtree: true, childList: true, characterData: true });
  });
  if (opcoes.supabaseFalso) {
    await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
    await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
      path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
      headers: { 'Access-Control-Allow-Origin': '*' }
    }));
  }
  await p.clock.install();
  return p;
}
async function axe(p, rotulo) {
  await p.waitForTimeout(800); // transições CSS (tempo real) terminam antes da medição de contraste
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}
const semRolagem = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent.trim());
const limparAnuncios = (p) => p.evaluate(() => { window.__anuncios = []; });
const anuncios = (p) => p.evaluate(() => window.__anuncios.slice());
// O clipboard e a rede resolvem em tempo real; os timers da página andam pelo relógio controlado
async function avancar(p, ms) { await p.waitForTimeout(150); await p.clock.runFor(ms); }
const console0 = (p, rotulo) => ok(p.erros.length === 0, `console limpo (${rotulo})` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));

(async () => {
  const browser = await chromium.launch();

  // ------------------------------------------------------------------ FAQ
  console.log('\n[1] FAQ: "Link copiado" com tempo, foco, ponteiro e Esc');
  for (const w of LARGURAS) {
    const p = await novaPagina(browser, w);
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(SITE).origin });
    await p.goto(SITE + '#faq-tem-mensalidade', { waitUntil: 'load' });
    await p.clock.runFor(500);
    const item = '#faq-tem-mensalidade';
    await p.waitForSelector(item + '[open]');
    const botao = p.locator(item + ' [data-faq-copiar]');
    const regiao = item + ' [data-faq-copiado]';
    ok(await p.getAttribute(regiao, 'role') === 'status' && (await texto(p, regiao)) === '', `${w}px: região role="status" vazia antes de copiar`);
    await limparAnuncios(p);
    await botao.click();
    await avancar(p, 200);
    ok((await texto(p, regiao)) === 'Link copiado.', `${w}px: "Link copiado." visível`);
    ok((await botao.textContent()) === 'Copiar link', `${w}px: o rótulo do botão não muda`);
    ok(JSON.stringify(await anuncios(p)) === '["Link copiado."]', `${w}px: anunciado uma vez -> ${JSON.stringify(await anuncios(p))}`);
    ok(await semRolagem(p), `${w}px: sem rolagem horizontal com o aviso`);
    if (w === 375 || w === 1280) {
      await axe(p, `FAQ com aviso, ${w}px`);
      await p.screenshot({ path: `${SAIDA}/avisos-temporarios-faq-${w}.png`, clip: await p.locator(item).boundingBox() });
      await botao.click(); // o tempo real gasto pelo axe não conta: recomeça a contagem
      await avancar(p, 200);
    }
    // foco + ponteiro no botão: continua
    await p.clock.runFor(20000);
    ok((await texto(p, regiao)) === 'Link copiado.', `${w}px: com o foco/ponteiro no botão, não some (20 s)`);
    await p.keyboard.press('Escape');
    ok((await texto(p, regiao)) === '', `${w}px: Esc dispensa`);
    // fora do foco e do ponteiro: ≥ 5 s e some
    await botao.click();
    await avancar(p, 200);
    await p.mouse.move(1, 1);
    await p.evaluate(() => document.activeElement.blur());
    await p.clock.runFor(4800);
    ok((await texto(p, regiao)) === 'Link copiado.', `${w}px: ainda visível aos 5 s`);
    await p.clock.runFor(3000);
    ok((await texto(p, regiao)) === '', `${w}px: some sozinho depois (sem foco nem ponteiro)`);
    // foco volta para dentro antes do fim: espera sair
    await botao.click();
    await avancar(p, 200);
    await p.mouse.move(1, 1);
    await p.clock.runFor(10000);
    ok((await texto(p, regiao)) === 'Link copiado.', `${w}px: com o foco no botão (sem ponteiro), continua`);
    await p.evaluate(() => document.activeElement.blur());
    await p.clock.runFor(1500);
    ok((await texto(p, regiao)) === '', `${w}px: o foco saiu: some no próximo ciclo`);
    console0(p, `FAQ ${w}px`);
    await p.context().close();
  }

  // ------------------------------------------------------------------ briefing: arquivo recusado
  console.log('\n[2] Briefing: arquivo recusado fica, respeita o foco e se fecha pelo teclado');
  for (const w of LARGURAS) {
    const p = await novaPagina(browser, w);
    await p.route(/https:\/\/[a-z0-9]+\.supabase\.co\/.*/, (r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (r.request().url().endsWith('/rpc/briefing_obter')) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify([{ pedido_status: 'aprovado', plano_nome: 'Profissional', briefing: null }]) });
      return r.fulfill({ status: 404, contentType: 'application/json', headers: cors, body: '{}' });
    });
    await p.goto(SITE + 'briefing.html#c=PBR-REDE82&t=' + 'cd'.repeat(32), { waitUntil: 'load' });
    for (let i = 0; i < 40 && !(await p.locator('[data-form-briefing]:not([hidden])').count()); i++) await avancar(p, 500);
    await p.waitForSelector('[data-form-briefing]:not([hidden])', { timeout: 2000 });
    await p.fill('#b-nome_negocio', 'Doceria Exemplo');
    await p.fill('#b-cidade', 'Campinas/SP');
    await p.click('[data-etapa-proxima]');
    await p.fill('#b-objetivo', 'Receber encomendas');
    await p.click('[data-etapa-proxima]');
    await p.fill('#b-textos_servicos', 'Bolos');
    await p.click('[data-etapa-proxima]');
    await p.clock.runFor(1000);
    const recusado = '[data-arquivo-estado="recusado"]';
    const escolher = () => p.setInputFiles('#b-arquivos', { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('oi') });
    await escolher();
    await p.waitForSelector(recusado);
    ok(/Tipo não aceito/.test(await texto(p, recusado)), `${w}px: recusa visível`);
    ok(await semRolagem(p), `${w}px: sem rolagem horizontal com a recusa`);
    if (w === 320 || w === 1280) {
      await axe(p, `briefing com recusa, ${w}px`);
      await p.locator('[data-lista-arquivos]').screenshot({ path: `${SAIDA}/avisos-temporarios-briefing-${w}.png` }); // rola até a lista (o lembrete do pedido, item 126, empurra o formulário)
      await p.click(recusado + ' [data-arquivo-fechar]'); // o tempo real gasto pelo axe não conta: recomeça
      await escolher();
      await p.waitForSelector(recusado);
    }
    await p.mouse.move(1, 1);
    await p.clock.runFor(5000);
    ok(await p.locator(recusado).count() === 1, `${w}px: ainda na tela aos 5 s`);
    await p.clock.runFor(4000);
    ok(await p.locator(recusado).count() === 0, `${w}px: some sozinho depois de 8 s`);
    // foco no "Fechar": não some; Enter fecha e o foco vai para o campo de arquivos
    await escolher();
    await p.waitForSelector(recusado);
    await p.focus(recusado + ' [data-arquivo-fechar]');
    await p.clock.runFor(20000);
    ok(await p.locator(recusado).count() === 1, `${w}px: com o foco no item, não some (20 s)`);
    await p.keyboard.press('Enter');
    ok(await p.locator(recusado).count() === 0 && await p.evaluate(() => document.activeElement.id) === 'b-arquivos', `${w}px: "Fechar" dispensa e o foco vai ao campo de arquivos`);
    // Esc com o foco no item
    await escolher();
    await p.waitForSelector(recusado);
    await p.focus(recusado + ' [data-arquivo-fechar]');
    await p.keyboard.press('Escape');
    ok(await p.locator(recusado).count() === 0 && await p.evaluate(() => document.activeElement.id) === 'b-arquivos', `${w}px: Esc dispensa e o foco vai ao campo de arquivos`);
    ok(await p.$eval('[data-etapa]:not([hidden])', (f) => f.getAttribute('data-etapa')) === '4', `${w}px: Esc não sai da etapa de arquivos`);
    console0(p, `briefing ${w}px`);
    await p.context().close();
  }

  // ------------------------------------------------------------------ painel: "Tempo real de volta"
  console.log('\n[3] Painel: "Tempo real de volta" com tempo, foco e "Fechar aviso"');
  let servidorNoAr = true;
  try { await fetch(API + '/rest/v1/'); } catch (e) { servidorNoAr = false; }
  if (!servidorNoAr) { ok(false, 'Supabase falso em :54321 (npm run servidor)'); }
  else for (const w of LARGURAS) {
    const a = await novaPagina(browser, w, { supabaseFalso: true });
    await a.goto(SITE + 'admin/', { waitUntil: 'load' });
    await a.clock.runFor(500);
    // O módulo é testado sozinho: um canal de teste cai e volta (a tela do painel é mostrada sem login)
    await a.evaluate(() => {
      document.querySelector('[data-tela="painel"]').hidden = false;
      document.querySelector('[data-tela="login"]').hidden = true;
      window.PBRTempoReal.registrar('teste', () => true);
    });
    const caiEVolta = async () => {
      await a.evaluate(() => window.PBRTempoReal.informar('teste', 'CLOSED'));
      await a.clock.runFor(3000);
      await limparAnuncios(a);
      await a.evaluate(() => window.PBRTempoReal.informar('teste', 'SUBSCRIBED'));
    };
    const ativo = () => a.$eval('[data-tempo-real]', (c) => c.hasAttribute('data-ativo'));
    await caiEVolta();
    ok((await texto(a, '[data-tempo-real-texto]')) === 'Tempo real de volta. Listas atualizadas.', `${w}px: aviso "Tempo real de volta"`);
    ok(JSON.stringify(await anuncios(a)) === '["Tempo real de volta. Listas atualizadas."]', `${w}px: anunciado uma vez`);
    ok(await a.locator('[data-tempo-real-fechar]').isVisible(), `${w}px: botão "Fechar aviso" visível`);
    ok(await semRolagem(a), `${w}px: sem rolagem horizontal com o aviso`);
    if (w === 320 || w === 1280) {
      await axe(a, `painel com aviso, ${w}px`);
      await a.screenshot({ path: `${SAIDA}/avisos-temporarios-painel-${w}.png`, clip: await a.locator('[data-tempo-real]').boundingBox() });
      await a.click('[data-tempo-real-fechar]'); // o tempo real gasto pelo axe não conta: recomeça
      await caiEVolta();
    }
    await a.mouse.move(1, 1);
    await a.clock.runFor(5000);
    ok(await ativo(), `${w}px: ainda na tela aos 5 s`);
    await a.clock.runFor(2000);
    ok(!(await ativo()), `${w}px: some sozinho depois (sem foco nem ponteiro)`);
    // foco no "Fechar aviso": não some; Esc dispensa e o foco vai para o conteúdo principal
    await caiEVolta();
    await a.focus('[data-tempo-real-fechar]');
    await a.clock.runFor(20000);
    ok(await ativo(), `${w}px: com o foco no aviso, não some (20 s)`);
    await a.keyboard.press('Escape');
    ok(!(await ativo()) && await a.evaluate(() => document.activeElement.id) === 'conteudo', `${w}px: Esc dispensa e o foco vai para o conteúdo`);
    await caiEVolta();
    await a.focus('[data-tempo-real-fechar]');
    await a.keyboard.press('Enter');
    ok(!(await ativo()) && await a.evaluate(() => document.activeElement.id) === 'conteudo', `${w}px: "Fechar aviso" dispensa e o foco vai para o conteúdo`);
    console0(a, `painel ${w}px`);
    await a.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
