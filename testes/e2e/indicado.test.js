// Uso: servidor estático em :8080 (python3 -m http.server 8080 na raiz) e: node testes/e2e/indicado.test.js
// "Plano indicado" no fim dos artigos e das páginas de segmento (item 65 do MELHORIAS.md):
// bloco presente sem JS, link planos.html?plano= igual à regra do config.js, plano já marcado ao chegar,
// origem "cta: blog/..." registrada pelo origem.js, axe, console e rolagem em 4 larguras, e screenshots.
const { chromium } = require('playwright');
const fs = require('fs');
const vm = require('vm');

const BASE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const RAIZ = require('path').resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const LARGURAS = [320, 375, 768, 1280];

const janela = {};
vm.runInNewContext(fs.readFileSync(RAIZ + '/config.js', 'utf8'), { window: janela });
const config = janela.PBR_CONFIG;
const caminho = (chave) => { const [t, s] = chave.split(':'); return (t === 'blog' ? 'blog/' : 'segmentos/') + s + '.html'; };

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(ctx, url) {
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.goto(new URL(url, BASE).href, { waitUntil: 'networkidle' });
  return p;
}

async function axe(p) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  return p.evaluate(async () => (await axe.run(document.querySelector('.indicado'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.impact} ${v.id}`));
}

(async () => {
  const browser = await chromium.launch();
  const chaves = Object.keys(config.planoIndicado);

  console.log('\n[1] Sem JavaScript o bloco já está completo');
  const semJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 800 } });
  for (const chave of chaves) {
    const p = await abrir(semJs, caminho(chave));
    const id = config.planoIndicado[chave];
    const nome = config.planos.find((x) => x.id === id).nome;
    const b = p.locator('.indicado');
    ok(await b.isVisible() && (await b.locator('a[data-indicado-link]').getAttribute('href')) === '../planos.html?plano=' + id
      && (await b.locator('.indicado__titulo').innerText()).includes(nome), `${chave}: plano ${nome} visível, link ?plano=${id}`);
    await p.close();
  }
  await semJs.close();

  console.log('\n[2] Larguras: rolagem, console, axe, alvo do bloco e screenshots');
  for (const w of LARGURAS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
    for (const chave of chaves) {
      const p = await abrir(ctx, caminho(chave));
      const largura = await p.evaluate(() => document.documentElement.scrollWidth);
      const caixa = await p.locator('.indicado').boundingBox();
      const botao = await p.locator('.indicado a[data-indicado-link]').boundingBox();
      const v = w === 375 || w === 1280 ? await axe(p) : [];
      const problemas = [];
      if (largura > w) problemas.push('rolagem ' + largura);
      if (!caixa || caixa.width > w) problemas.push('bloco fora da tela');
      if (!botao || botao.height < 24 || botao.width < 24) problemas.push('botão pequeno');
      if (p.erros.length) problemas.push('console: ' + p.erros.join(' | '));
      if (v.length) problemas.push('axe: ' + v.join(', '));
      ok(problemas.length === 0, `${w}px ${chave}` + (problemas.length ? ' → ' + problemas.join('; ') : ''));
      if (chave === 'blog:site-ou-instagram' || chave === 'segmento:moda') {
        await p.locator('.indicado').scrollIntoViewIfNeeded();
        await p.locator('.indicado').screenshot({ path: `${SAIDA}/indicado-${chave.replace(':', '-')}-${w}.png` });
      }
      await p.close();
    }
    await ctx.close();
  }

  console.log('\n[3] Modo escuro');
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, colorScheme: 'dark' });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
    const p = await abrir(ctx, 'segmentos/restaurante.html');
    const v = await axe(p);
    ok(v.length === 0, 'axe no escuro: ' + (v.join(', ') || 'sem violações sérias'));
    await p.locator('.indicado').scrollIntoViewIfNeeded();
    await p.locator('.indicado').screenshot({ path: `${SAIDA}/indicado-escuro-375.png` });
    await ctx.close();
  }

  console.log('\n[4] Clique leva ao plano marcado e registra a origem');
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
    const p = await abrir(ctx, 'blog/site-ou-instagram.html');
    ok(await p.evaluate(() => PBROrigem.resumo()) === '', 'antes do clique: sem origem');
    await Promise.all([p.waitForURL(/planos\.html\?plano=essencial/), p.click('.indicado a[data-indicado-link]')]);
    await p.waitForLoadState('networkidle');
    ok(await p.locator('input[name="plano"][value="essencial"]').isChecked().catch(() => false), 'plano Essencial já marcado em planos.html');
    ok(await p.evaluate(() => PBROrigem.resumo()) === 'cta: blog/site-ou-instagram', 'resumo: ' + await p.evaluate(() => PBROrigem.resumo()));
    ok(p.erros.length === 0, 'console limpo em planos.html');
    // com utm de campanha, o cta entra no fim do resumo
    const p2 = await abrir(ctx, 'segmentos/moda.html?utm_source=instagram&utm_medium=bio');
    await Promise.all([p2.waitForURL(/planos\.html\?plano=premium/), p2.click('.indicado a[data-indicado-link]')]);
    const r = await p2.evaluate(() => PBROrigem.resumo());
    ok(r === 'utm: instagram / bio · entrada: /segmentos/moda.html · cta: segmento/moda', 'resumo com utm: ' + r);
    // o valor do atributo é validado: um data-origem-cta estranho não é gravado
    const p3 = await abrir(ctx, 'blog/site-ou-instagram.html');
    await p3.evaluate(() => {
      localStorage.removeItem('pbr_origem_cta_v1');
      const a = document.querySelector('.indicado a[data-indicado-link]');
      a.setAttribute('data-origem-cta', '<script>x</script>');
      a.addEventListener('click', (e) => e.preventDefault());
      a.click();
    });
    ok(await p3.evaluate(() => localStorage.getItem('pbr_origem_cta_v1')) === null, 'valor inválido em data-origem-cta é ignorado');
    await ctx.close();
  }

  console.log('\n[5] Mudança no config.js vale na hora (antes de regravar o HTML)');
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const cfg = fs.readFileSync(RAIZ + '/config.js', 'utf8').replace("'segmento:pet': 'profissional'", "'segmento:pet': 'premium'");
    const p = await ctx.newPage();
    await p.route('**/config.js', (r) => r.fulfill({ body: cfg, contentType: 'application/javascript' }));
    await p.goto(BASE + 'segmentos/pet.html', { waitUntil: 'networkidle' });
    ok(await p.locator('.indicado a[data-indicado-link]').getAttribute('href') === '../planos.html?plano=premium'
      && (await p.locator('.indicado__titulo').innerText()) === 'Plano Premium', 'regra nova aplicada pelo main.js');
    await ctx.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
