// Uso: veja testes/README.md (servidor estático em :8080 e Supabase falso em :54321)
// WhatsApp contextual (item 24 do MELHORIAS.md): cards de plano, resumo do pedido, comparativo, artigos do blog e
// chat fora do horário levam uma mensagem pronta com o plano ou o assunto da página, montada com os modelos do
// config.js. Com o WhatsApp vazio ([PROVISÓRIO]), nenhum desses links aparece. Axe e rolagem em 4 larguras.
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const AXE = require.resolve('axe-core/axe.min.js');
const RAIZ = require('path').resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

const NUMERO = '5511999999999'; // só no teste: o config.js real continua vazio
const original = fs.readFileSync(RAIZ + '/config.js', 'utf8');
const comSupabase = (cfg) => cfg
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
const configSem = comSupabase(original);
const configCom = configSem.replace("whatsapp: '', // [PROVISÓRIO]", `whatsapp: '${NUMERO}', //`);
if (configCom === configSem) throw new Error('substituição do WhatsApp no config falhou');

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }
const texto = (href) => decodeURIComponent(new URL(href).searchParams.get('text') || '');

async function abrir(browser, caminho, cfg, opcoes = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route('**/config.js*', (r) => r.fulfill({ body: cfg, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  if (opcoes.relogio) await p.clock.setFixedTime(opcoes.relogio);
  await p.goto(new URL(caminho, BASE).href, { waitUntil: 'networkidle' });
  return p;
}

async function axe(p, seletor) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  return p.evaluate(async (s) => (await axe.run(s, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.impact} ${v.id}`), seletor);
}

(async () => {
  const browser = await chromium.launch();
  const modelos = await (async () => {
    const p = await abrir(browser, 'index.html', configCom);
    const m = await p.evaluate(() => PBR_CONFIG.contato.whatsappModelos);
    await p.context().close();
    return m;
  })();

  console.log('\n[1] Sem número (config real, [PROVISÓRIO]): nada aparece');
  for (const caminho of ['index.html', 'planos.html', 'blog/site-ou-instagram.html']) {
    const p = await abrir(browser, caminho, configSem);
    const n = await p.locator('a[href^="https://wa.me/"]:visible, .link-whats').count();
    ok(n === 0, `${caminho}: nenhum link de WhatsApp (${n})`);
    ok(await p.locator('a[data-whats]').isHidden().catch(() => true), `${caminho}: botão estático continua oculto`);
    ok(p.erros.length === 0, `${caminho}: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[2] Home: cada card de plano com a mensagem do plano');
  {
    const p = await abrir(browser, 'index.html', configCom);
    const cards = await p.evaluate(() => [...document.querySelectorAll('[data-lista-planos] > li')].map((li) => ({
      nome: li.querySelector('.plano__nome').textContent,
      href: (li.querySelector('.plano__whats a') || {}).href || '',
      rel: (li.querySelector('.plano__whats a') || {}).rel || '',
      alvo: (li.querySelector('.plano__whats a') || {}).target || '',
      rotulo: (li.querySelector('.plano__whats a') || {}).textContent || ''
    })));
    ok(cards.length >= 3, `${cards.length} cards`);
    cards.forEach((c) => {
      ok(c.href.startsWith('https://wa.me/' + NUMERO + '?text=') && texto(c.href) === modelos.plano.replace('{plano}', c.nome),
        `${c.nome}: "${texto(c.href)}"`);
      ok(c.rel.includes('noopener') && c.alvo === '_blank' && /abre o WhatsApp em nova aba/.test(c.rotulo), `${c.nome}: nova aba com rel=noopener e aviso para leitor de tela`);
    });
    await p.locator('.plano__whats a').first().scrollIntoViewIfNeeded();
    await p.waitForTimeout(1500); // revelação da rolagem termina (o card entra com escala)
    const alvo = await p.locator('.plano__whats a').first().boundingBox();
    ok(alvo.height >= 44, `área de toque ${Math.round(alvo.height)}px`);
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[3] Planos: resumo acompanha o plano marcado; comparativo com mensagem própria');
  {
    const p = await abrir(browser, 'planos.html?plano=essencial', configCom);
    const hrefResumo = () => p.getAttribute('.checkout__resumo-whats a', 'href');
    ok(texto(await hrefResumo()).includes('plano Essencial'), 'resumo: ' + texto(await hrefResumo()));
    await p.check('input[name="plano"][value="premium"]');
    ok(texto(await hrefResumo()).includes('plano Premium'), 'trocou o plano → mensagem do Premium');
    const comp = await p.getAttribute('.comparativo__whats a', 'href');
    ok(texto(comp) === modelos.comparativo, 'comparativo: ' + texto(comp));
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[4] Artigos do blog: mensagem com o título do artigo');
  for (const caminho of ['blog/site-ou-instagram.html', 'blog/o-que-um-site-profissional-precisa-ter.html', 'blog/como-funciona-a-criacao-do-seu-site.html']) {
    const p = await abrir(browser, caminho, configCom);
    const h1 = (await p.textContent('main h1')).replace(/\s+/g, ' ').trim();
    const a = p.locator('a[data-whats="artigo"]');
    ok(await a.isVisible(), `${caminho}: botão visível`);
    ok(texto(await a.getAttribute('href')) === modelos.artigo.replace('{pagina}', h1), `${caminho}: "${texto(await a.getAttribute('href'))}"`);
    ok(p.erros.length === 0, `${caminho}: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[5] Chat fora do horário: WhatsApp com o contexto da página');
  const domingo = new Date('2026-11-22T06:00:00Z'); // domingo, 03:00 em São Paulo
  {
    const p = await abrir(browser, 'blog/site-ou-instagram.html', configCom, { relogio: domingo });
    await p.click('.chat__lancador');
    const href = await p.getAttribute('.chat__aviso a[href^="https://wa.me/"]', 'href');
    ok(texto(href).startsWith(modelos.artigo.split('{pagina}')[0]) && texto(href).includes('Site ou só Instagram'), 'artigo: ' + texto(href));
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }
  {
    const p = await abrir(browser, 'planos.html?plano=profissional', configCom, { relogio: domingo });
    await p.click('.chat__lancador');
    const link = p.locator('.chat__aviso a[href^="https://wa.me/"]');
    ok(texto(await link.getAttribute('href')).includes('plano Profissional'), 'planos: ' + texto(await link.getAttribute('href')));
    await p.click('.chat__fechar, [data-chat-fechar]').catch(() => p.keyboard.press('Escape'));
    await p.check('input[name="plano"][value="premium"]');
    await link.dispatchEvent('click'); // o clique recalcula a mensagem (evento sintético: não abre aba)
    ok(texto(await link.getAttribute('href')).includes('plano Premium'), 'após trocar o plano: ' + texto(await link.getAttribute('href')));
    await p.context().close();
  }
  {
    const p = await abrir(browser, 'index.html', configCom, { relogio: domingo });
    await p.click('.chat__lancador');
    const href = await p.getAttribute('.chat__aviso a[href^="https://wa.me/"]', 'href');
    ok(texto(href) === await p.evaluate(() => PBR_CONFIG.contato.whatsappMensagem), 'home: mensagem padrão');
    await p.context().close();
  }

  console.log('\n[6] 4 larguras: rolagem e axe');
  for (const w of [320, 375, 768, 1280]) {
    for (const [caminho, sel] of [['index.html', '#planos'], ['planos.html', 'main'], ['blog/site-ou-instagram.html', '.artigo__chamada']]) {
      const p = await abrir(browser, caminho, configCom, { viewport: { width: w, height: 900 } });
      await p.locator(sel).first().scrollIntoViewIfNeeded();
      await p.waitForTimeout(1500); // espera a revelação da rolagem (axe não deve pegar a transição no meio)
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      ok(sw === w, `${w}px ${caminho}: sem rolagem horizontal (${sw})`);
      const v = await axe(p, sel);
      ok(v.length === 0, `${w}px ${caminho}: axe sem violações sérias` + (v.length ? ' → ' + v.join(', ') : ''));
      if (w === 375 || w === 1280) {
        const alvo = { 'index.html': '#planos', 'planos.html': '.checkout__resumo', 'blog/site-ou-instagram.html': '.artigo__chamada' }[caminho];
        await p.locator(alvo).first().scrollIntoViewIfNeeded();
        await p.waitForTimeout(400);
        await p.locator(alvo).first().screenshot({ path: `${SAIDA}/whats-${caminho.replace(/\W+/g, '-')}-${w}.png` });
      }
      await p.context().close();
    }
  }

  console.log('\n[7] Modo escuro (375 px): axe');
  for (const [caminho, sel] of [['index.html', '#planos'], ['planos.html', 'main'], ['blog/site-ou-instagram.html', '.artigo__chamada']]) {
    const p = await abrir(browser, caminho, configCom, { viewport: { width: 375, height: 900 }, colorScheme: 'dark' });
    await p.locator(sel).first().scrollIntoViewIfNeeded();
    await p.waitForTimeout(1500);
    const v = await axe(p, sel);
    ok(v.length === 0, `escuro ${caminho}: axe sem violações sérias` + (v.length ? ' → ' + v.join(', ') : ''));
    if (caminho === 'index.html') await p.locator('.plano').first().screenshot({ path: `${SAIDA}/whats-escuro-plano-375.png` });
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
