// Uso: veja testes/README.md (servidor estático em :8080; o Supabase falso em :54321 evita erros do chat)
// Páginas por segmento (item 25 do MELHORIAS.md): conteúdo e links de cada segmento, simulador já marcado ao chegar
// pela página do segmento, WhatsApp só com número válido (mensagem padrão), axe, rolagem e console em 4 larguras,
// e screenshots em testes/e2e/saida/.
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const AXE = require.resolve('axe-core/axe.min.js');
const RAIZ = require('path').resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

const IDS = ['restaurante', 'moda', 'beleza', 'saude', 'servicos', 'pet'];
const LARGURAS = [320, 375, 768, 1280];
const NUMERO = '5511999999999'; // só no teste: o config.js real continua vazio
const original = fs.readFileSync(RAIZ + '/config.js', 'utf8');
const configSem = original
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
const configCom = configSem.replace("whatsapp: '', // [PROVISÓRIO]", `whatsapp: '${NUMERO}', //`);
if (configCom === configSem) throw new Error('substituição do WhatsApp no config falhou');

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, caminho, cfg, opcoes = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route('**/config.js*', (r) => r.fulfill({ body: cfg, contentType: 'application/javascript' }));
  await p.goto(new URL(caminho, BASE).href, { waitUntil: 'networkidle' });
  return p;
}

async function axe(p) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.impact} ${v.id}`));
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Cada segmento em 4 larguras: rolagem, console, axe, links');
  for (const id of IDS) {
    for (const w of LARGURAS) {
      const p = await abrir(browser, `segmentos/${id}.html`, configSem, { viewport: { width: w, height: 800 }, reducedMotion: 'reduce' });
      const largura = await p.evaluate(() => document.documentElement.scrollWidth);
      const v = await axe(p);
      const whats = await p.locator('a[data-whats="segmento"]').isVisible();
      const ok1 = largura <= w && v.length === 0 && p.erros.length === 0 && !whats;
      ok(ok1, `${id} @${w}: sem rolagem (${largura}), axe ${v.join(', ') || 'ok'}, console ${p.erros.join(' | ') || 'limpo'}, WhatsApp oculto sem número`);
      if (w === 375 || w === 1280) await p.screenshot({ path: `${SAIDA}/segmento-${id}-${w}.png`, fullPage: true });
      await p.context().close();
    }
  }

  console.log('\n[2] "Qual plano é para mim?" leva ao simulador da home já com o segmento marcado');
  for (const id of IDS) {
    const p = await abrir(browser, `segmentos/${id}.html`, configSem, { viewport: { width: 375, height: 760 }, reducedMotion: 'reduce' });
    await Promise.all([p.waitForURL(/index\.html\?segmento=/), p.locator('.seg__acoes a[href*="#simulador"]').click()]);
    await p.waitForLoadState('networkidle');
    const marcado = await p.locator('input[name="tipo"]:checked').getAttribute('value').catch(() => null);
    ok(marcado === id, `${id}: tipo marcado no simulador (${marcado})`);
    const topo = await p.evaluate(() => document.querySelector('#simulador').getBoundingClientRect().top);
    ok(topo >= 0 && topo < 200, `${id}: simulador visível no topo da tela (${Math.round(topo)} px)`);
    // responder o resto leva ao exemplo do mesmo segmento
    await p.check('input[name="vende"][value="nao"]');
    await p.check('input[name="paginas"][value="uma"]');
    ok((await p.getAttribute('[data-sim-exemplo]', 'href')) === `exemplos/${id}.html`, `${id}: simulador sugere o exemplo do segmento`);
    ok(p.erros.length === 0, `${id}: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }
  {
    const p = await abrir(browser, 'index.html?segmento=%22%5D%2Cbody%2C%5B', configSem);
    ok((await p.locator('input[name="tipo"]:checked').count()) === 0 && p.erros.length === 0, 'segmento inválido na URL é ignorado sem erro');
    await p.context().close();
  }

  console.log('\n[3] Com WhatsApp válido: botão aparece com a mensagem padrão (sem número fixo no código)');
  {
    const p = await abrir(browser, 'segmentos/pet.html', configCom);
    const a = p.locator('a[data-whats="segmento"]');
    ok(await a.isVisible(), 'botão visível');
    const href = await a.getAttribute('href');
    const msg = await p.evaluate(() => PBR_CONFIG.contato.whatsappModelos.segmento || PBR_CONFIG.contato.whatsappMensagem);
    ok(href.startsWith(`https://wa.me/${NUMERO}?text=`) && decodeURIComponent(new URL(href).searchParams.get('text')) === msg.replace('{pagina}', 'Site para pet shop e banho e tosa'), 'mensagem: ' + decodeURIComponent(new URL(href).searchParams.get('text')));
    ok(p.erros.length === 0, 'console limpo');
    await p.context().close();
  }

  console.log('\n[4] Home: título de cada segmento leva à página dele');
  {
    const p = await abrir(browser, 'index.html', configSem, { viewport: { width: 375, height: 800 }, reducedMotion: 'reduce' });
    for (const id of IDS) ok(await p.locator(`#para-quem a[href="segmentos/${id}.html"]`).count() === 1, `link para segmentos/${id}.html`);
    await p.context().close();
  }

  console.log('\n[5] Modo escuro: axe sem violações');
  for (const id of ['restaurante', 'saude']) {
    const p = await abrir(browser, `segmentos/${id}.html`, configSem, { colorScheme: 'dark', reducedMotion: 'reduce' });
    const v = await axe(p);
    ok(v.length === 0, `${id} no escuro: ${v.join(', ') || 'ok'}`);
    await p.screenshot({ path: `${SAIDA}/segmento-${id}-escuro.png`, fullPage: true });
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
