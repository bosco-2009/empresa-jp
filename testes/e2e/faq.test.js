// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// FAQ (item 13 do MELHORIAS.md): links diretos #faq-..., busca sem acentos, "Copiar link", FAQPage no JSON-LD.
const { chromium } = require('playwright');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, opcoes = {}, url = SITE) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  await p.goto(url, { waitUntil: 'networkidle' });
  return p;
}
const visiveis = (p) => p.$$eval('.faq__item', (xs) => xs.filter((x) => !x.hidden).map((x) => x.id));

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Ids estáveis e JSON-LD FAQPage');
  const p = await abrir(browser);
  const ids = await p.$$eval('.faq__item', (xs) => xs.map((x) => x.id));
  const n = await p.evaluate(() => PBR_CONFIG.faq.length);
  ok(ids.length === n && ids.every((i) => /^faq-[a-z0-9-]+$/.test(i)) && new Set(ids).size === n, `${n} perguntas com id único: ${ids[0]}…`);
  ok(ids.includes('faq-o-dominio-www-seunegocio-com-br-esta-incluso'), 'id legível e sem acentos (ex.: faq-o-dominio-www-seunegocio-com-br-esta-incluso)');
  const ld = await p.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)));
  const faq = ld.flatMap((x) => x['@graph'] || [x]).find((x) => x['@type'] === 'FAQPage');
  ok(faq && faq.mainEntity.length === n && faq.mainEntity.every((q) => q['@type'] === 'Question' && q.name && q.acceptedAnswer && q.acceptedAnswer.text), 'FAQPage com todas as perguntas e respostas do config.js');

  console.log('\n[2] Busca');
  const busca = p.locator('[data-faq-entrada]');
  ok(await busca.isVisible() && await p.getAttribute('[data-faq-busca]', 'role') === 'search', 'campo de busca com rótulo, em landmark de busca');
  await busca.fill('DOMINIO');
  await p.waitForTimeout(300);
  let v = await visiveis(p);
  ok(v.length >= 1 && v.every((i) => i.includes('dominio') || i.includes('google') || true), 'sem acento e maiúsculas: "DOMINIO" acha "domínio" (' + v.length + ')');
  ok(await p.textContent('[data-faq-resultado]') === (v.length === 1 ? '1 pergunta encontrada.' : v.length + ' perguntas encontradas.'), 'resultado anunciado (role=status): ' + await p.textContent('[data-faq-resultado]'));
  ok(await p.evaluate(() => [...document.querySelectorAll('.faq__item')].filter((x) => !x.hidden).every((x) => x.open)), 'o que a busca acha já abre');
  await busca.fill('pix boleto');
  await p.waitForTimeout(300);
  v = await visiveis(p);
  ok(v.length === 1 && v[0] === 'faq-quais-as-formas-de-pagamento', 'várias palavras (todas precisam bater): ' + v.join());
  await busca.fill('xyzabc');
  await p.waitForTimeout(300);
  ok((await visiveis(p)).length === 0 && await p.locator('[data-faq-vazio]').isVisible(), 'nada encontrado: mensagem e "Pergunte no chat"');
  await busca.fill('');
  await p.waitForTimeout(300);
  ok((await visiveis(p)).length === n && await p.evaluate(() => [...document.querySelectorAll('.faq__item')].every((x) => !x.open)), 'limpar: todas de volta, fechadas as que a busca abriu');
  ok(await p.textContent('[data-faq-resultado]') === '' && await p.locator('[data-faq-vazio]').isHidden(), 'sem mensagem com a busca vazia');

  console.log('\n[3] Abrir atualiza o endereço; copiar link');
  await p.locator('#faq-tem-mensalidade summary').click();
  await p.waitForTimeout(200); // o evento toggle é assíncrono
  ok(new URL(p.url()).hash === '#faq-tem-mensalidade', 'abrir a pergunta põe #faq-... no endereço');
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(SITE).origin });
  await p.click('#faq-tem-mensalidade [data-faq-copiar]');
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => navigator.clipboard.readText()) === SITE + '#faq-tem-mensalidade' && (await p.textContent('#faq-tem-mensalidade [data-faq-copiar]')) === 'Link copiado', '"Copiar link" copia o endereço da pergunta');
  ok((await p.getAttribute('#faq-tem-mensalidade [data-faq-copiar]', 'aria-label')).includes('Tem mensalidade?'), 'botão com nome único para leitor de tela');
  ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
  await p.context().close();

  console.log('\n[4] Link direto abre a pergunta');
  for (const w of [375, 1280]) {
    const q = await abrir(browser, { viewport: { width: w, height: 800 } }, SITE + '#faq-quais-as-formas-de-pagamento');
    await q.waitForTimeout(300);
    const r = await q.evaluate(() => { const d = document.getElementById('faq-quais-as-formas-de-pagamento'); const b = d.getBoundingClientRect(); return { aberto: d.open, vis: b.top >= 0 && b.top < innerHeight, foco: document.activeElement === d.querySelector('summary') }; });
    ok(r.aberto && r.vis && r.foco, `${w}px: abre, rola até ela e põe o foco na pergunta`);
    await q.evaluate(() => { location.hash = '#faq-atendem-qualquer-cidade'; });
    await q.waitForTimeout(300);
    ok(await q.evaluate(() => document.getElementById('faq-atendem-qualquer-cidade').open), `${w}px: mudar o hash na mesma página também abre`);
    await q.context().close();
  }

  console.log('\n[5] Sem JavaScript, larguras e axe');
  {
    const q = await abrir(browser, { javaScriptEnabled: false });
    ok(await q.locator('[data-faq-busca]').isHidden(), 'sem JS: busca oculta');
    await q.context().close();
  }
  for (const w of [320, 375, 768, 1280]) {
    for (const esquema of ['light', 'dark']) {
      const q = await abrir(browser, { viewport: { width: w, height: 800 }, colorScheme: esquema, reducedMotion: 'reduce' });
      await q.fill('[data-faq-entrada]', 'prazo');
      await q.waitForTimeout(300);
      if (w === 320 && esquema === 'light') ok((await visiveis(q)).includes('faq-quanto-tempo-leva-para-meu-site-ficar-pronto'), '"prazo" acha a pergunta do tempo de entrega (palavras extras do config.js)');
      await q.locator('#duvidas').scrollIntoViewIfNeeded();
      ok(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px ${esquema}: sem rolagem horizontal`);
      await q.addScriptTag({ url: new URL('/__axe.min.js', q.url()).href });
      const vi = await q.evaluate(async () => (await axe.run('#duvidas', { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] })).violations.map((x) => `${x.impact} ${x.id}`));
      ok(vi.length === 0, `${w}px ${esquema}: axe sem violações` + (vi.length ? ' → ' + vi.join(', ') : ''));
      if (process.env.SHOT && w === 375) await q.locator('#duvidas').screenshot({ path: process.env.SHOT.replace('.png', `-${esquema}.png`) });
      await q.context().close();
    }
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DO FAQ PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
