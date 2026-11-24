// Anúncio de mudança de etapa no briefing (item 87 do MELHORIAS.md): ao avançar/voltar, o foco vai para a legenda
// da etapa e uma ÚNICA região viva educada diz "Etapa X de Y: nome" — nada na carga, sem repetir a mesma etapa.
// "Voltar à revisão" (foco no "Editar") também anuncia a etapa 5. Rolagem suave só sem prefers-reduced-motion.
// Só pelo teclado; 4 larguras sem rolagem horizontal, console limpo e axe.
// Não precisa de Postgres: as RPCs do Supabase são respondidas pelo próprio Playwright.
// Uso: sirva a raiz (python3 -m http.server 8080) e rode  node testes/e2e/briefing-etapa-anuncio.test.js
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

async function novaPagina(browser, largura, opcoes) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: largura, height: 800 } }, opcoes || {}));
  const p = await ctx.newPage();
  // Registra o comportamento de cada scrollIntoView (smooth/auto) para checar o movimento reduzido.
  await p.addInitScript(() => {
    window.__rolagens = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (o) { window.__rolagens.push(o && o.behavior); return orig.call(this, o); };
  });
  p.erros = [];
  p.enviado = null;
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route(/https:\/\/[a-z0-9]+\.supabase\.co\/.*/, (r) => {
    const url = r.request().url();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    let corpo = [];
    if (url.endsWith('/rpc/briefing_obter')) corpo = [{ pedido_status: 'aprovado', plano_nome: 'Profissional', briefing: null }];
    if (url.endsWith('/rpc/briefing_enviar')) { p.enviado = JSON.parse(r.request().postData()).p_dados; corpo = null; }
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(corpo) });
  });
  return p;
}
async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}
const etapaVisivel = (p) => p.$eval('[data-etapa]:not([hidden])', (f) => Number(f.getAttribute('data-etapa')));
const semRolagem = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const foco = (p) => p.evaluate(() => {
  const a = document.activeElement;
  return { tag: a.tagName, texto: a.textContent.trim(), editar: a.getAttribute('data-editar-etapa'), legenda: a.classList.contains('briefing__legenda') };
});
async function abrir(p) {
  await p.goto(SITE + 'briefing.html#c=' + CODIGO + '&t=' + TOKEN, { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-form-briefing]:not([hidden])');
}
// Aperta Tab até o foco chegar no elemento (máx. 80 vezes) e aperta Enter: prova que tudo é alcançável pelo teclado.
async function tabAte(p, seletor) {
  for (let i = 0; i < 80; i++) {
    await p.keyboard.press('Tab');
    if (await p.evaluate((s) => document.activeElement && document.activeElement.matches(s), seletor)) return true;
  }
  return false;
}
async function preencherTudo(p) {
  await p.fill('#b-nome_negocio', 'Doceria Exemplo');
  await p.fill('#b-cidade', 'Campinas/SP');
  await p.click('[data-etapa-proxima]');
  await p.fill('#b-objetivo', 'Receber encomendas');
  await p.fill('#b-referencias-1', 'https://exemplo.com.br');
  await p.click('[data-etapa-proxima]');
  await p.fill('#b-textos_servicos', 'Bolos\nDoces finos');
  await p.click('[data-etapa-proxima]');
  await p.check('input[name="tem_dominio"][value="sim"]');
  await p.fill('#b-dominio', 'doceriaexemplo.com.br');
  await p.click('[data-etapa-proxima]');
}

const regiao = (p) => p.$eval('[data-anuncio-etapa]', (r) => r.textContent);
// Liga um MutationObserver na região viva para contar quantas vezes o texto mudou (anúncios repetidos).
const vigiar = (p) => p.evaluate(() => {
  window.__anuncios = [];
  new MutationObserver(() => window.__anuncios.push(document.querySelector('[data-anuncio-etapa]').textContent))
    .observe(document.querySelector('[data-anuncio-etapa]'), { childList: true, characterData: true, subtree: true });
});
const anuncios = (p) => p.evaluate(() => window.__anuncios.slice());
async function continuarPeloTeclado(p) {
  ok(await tabAte(p, '[data-etapa-proxima]'), 'Tab alcança "Continuar"');
  await p.keyboard.press('Enter');
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Região viva única e silenciosa na carga (375 px)');
  const p = await novaPagina(browser, 375);
  await abrir(p);
  const vivas = await p.$$eval('[aria-live]', (rs) => rs.filter((r) => r.hasAttribute('data-anuncio-etapa')).map((r) => ({
    live: r.getAttribute('aria-live'), atomic: r.getAttribute('aria-atomic'), oculta: getComputedStyle(r).position === 'absolute'
  })));
  ok(vivas.length === 1 && vivas[0].live === 'polite' && vivas[0].atomic === 'true', 'uma região aria-live="polite" aria-atomic="true"');
  ok(vivas[0] && vivas[0].oculta, 'região visualmente oculta (só para leitor de tela)');
  ok(await regiao(p) === '', 'nada anunciado na carga');
  const outras = await p.$$eval('[aria-live], [role="status"]', (rs) => rs.filter((r) => /Etapa \d de \d/.test(r.textContent) && !r.hasAttribute('data-anuncio-etapa')).length);
  ok(outras === 0, 'nenhuma outra região viva fala da etapa');
  await vigiar(p);

  console.log('\n[2] Teclado: avançar e voltar move o foco e anuncia a etapa');
  await p.fill('#b-nome_negocio', 'Doceria Exemplo');
  await continuarPeloTeclado(p);
  let f = await foco(p);
  ok(await etapaVisivel(p) === 2 && f.legenda && f.texto === 'Etapa 2 de 5: O site', 'foco na legenda da etapa 2');
  ok(await regiao(p) === 'Etapa 2 de 5: O site', 'anuncia "Etapa 2 de 5: O site"');
  ok(await tabAte(p, '[data-etapa-anterior]'), 'Tab alcança "Voltar"');
  await p.keyboard.press('Enter');
  f = await foco(p);
  ok(f.legenda && f.texto === 'Etapa 1 de 5: Seu negócio', 'Voltar: foco na legenda da etapa 1');
  ok(await regiao(p) === 'Etapa 1 de 5: Seu negócio', 'anuncia "Etapa 1 de 5: Seu negócio"');

  console.log('\n[3] Erro de validação não repete o anúncio');
  await p.fill('#b-nome_negocio', '');
  const antes = (await anuncios(p)).length;
  await continuarPeloTeclado(p);
  ok(await etapaVisivel(p) === 1, 'fica na etapa 1 com o nome vazio');
  ok((await anuncios(p)).length === antes && await regiao(p) === 'Etapa 1 de 5: Seu negócio', 'região viva não muda nem repete');
  await p.fill('#b-nome_negocio', 'Doceria Exemplo');
  await continuarPeloTeclado(p); // 2
  await p.fill('#b-referencias-1', '');
  await continuarPeloTeclado(p); // 3
  ok(await regiao(p) === 'Etapa 3 de 5: Conteúdo', 'anuncia a etapa 3');
  await continuarPeloTeclado(p); // 4
  await continuarPeloTeclado(p); // 5
  ok(await etapaVisivel(p) === 5 && await regiao(p) === 'Etapa 5 de 5: Revisão', 'anuncia a revisão');

  console.log('\n[4] Editar e "Voltar à revisão"');
  await p.click('[data-editar-etapa="3"]');
  ok(await regiao(p) === 'Etapa 3 de 5: Conteúdo', 'Editar: anuncia a etapa 3');
  ok(await tabAte(p, '[data-voltar-revisao]'), 'Tab alcança "Voltar à revisão"');
  await p.keyboard.press('Enter');
  f = await foco(p);
  ok(f.editar === '3', 'foco volta ao "Editar etapa 3"');
  ok(await regiao(p) === 'Etapa 5 de 5: Revisão', '"Voltar à revisão" anuncia a etapa 5');
  const lista = await anuncios(p);
  const repetidos = lista.filter((t, i) => i > 0 && t === lista[i - 1]).length;
  ok(repetidos === 0, 'nenhum anúncio repetido em sequência: ' + lista.join(' → '));
  ok(lista.every((t) => /^Etapa \d de 5: .+/.test(t)), 'todos no formato "Etapa X de Y: nome"');
  const rol = await p.evaluate(() => window.__rolagens);
  ok(rol.length > 0 && rol.every((b) => b === 'smooth'), 'sem movimento reduzido: rolagem suave');
  ok(p.erros.length === 0, 'console sem erros' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
  await axe(p, 'revisão 375');
  await p.context().close();

  console.log('\n[5] Larguras e movimento reduzido');
  for (const largura of [320, 375, 768, 1280]) {
    const q = await novaPagina(browser, largura, largura === 320 ? { reducedMotion: 'reduce' } : {});
    await abrir(q);
    await q.fill('#b-nome_negocio', 'Doceria Exemplo');
    await q.click('[data-etapa-proxima]');
    ok(await regiao(q) === 'Etapa 2 de 5: O site', `${largura}px: anuncia a etapa 2`);
    ok(await semRolagem(q), `${largura}px: sem rolagem horizontal`);
    await q.waitForTimeout(900); // espera a rolagem suave terminar
    const top = await q.$eval('[data-etapa="2"] .briefing__legenda', (l) => l.getBoundingClientRect().top);
    ok(top >= -1 && top < 800, `${largura}px: título da etapa visível após a troca`);
    if (largura === 320) {
      const r = await q.evaluate(() => window.__rolagens);
      ok(r.length > 0 && r.every((b) => b === 'auto'), '320px com movimento reduzido: rolagem sem animação');
      await q.screenshot({ path: SAIDA + '/briefing-etapa-anuncio-320.png', fullPage: false });
    }
    if (largura === 1280) await q.screenshot({ path: SAIDA + '/briefing-etapa-anuncio-1280.png', fullPage: false });
    await axe(q, `etapa 2 ${largura}`);
    ok(q.erros.length === 0, `${largura}px: console sem erros` + (q.erros.length ? ' -> ' + q.erros.join(' | ') : ''));
    await q.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
