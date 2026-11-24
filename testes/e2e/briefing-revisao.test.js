// Prévia do briefing antes de enviar (item 50 do MELHORIAS.md): a etapa 5 mostra o resumo agrupado por etapa,
// com títulos (h3) e "Editar" com nome acessível; "Editar" leva à etapa certa (foco na legenda) e "Voltar à revisão"
// devolve o foco ao mesmo "Editar", com o resumo atualizado. Só pelo teclado. Envio descrito por aria-describedby.
// 4 larguras sem rolagem horizontal, console limpo e axe (claro e escuro).
// Não precisa de Postgres: as RPCs do Supabase são respondidas pelo próprio Playwright.
// Uso: sirva a raiz (python3 -m http.server 8080) e rode  node testes/e2e/briefing-revisao.test.js
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

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Resumo agrupado por etapa, com títulos e nomes acessíveis (375 px)');
  const p = await novaPagina(browser, 375);
  await abrir(p);
  await preencherTudo(p);
  ok(await etapaVisivel(p) === 5, 'chegou à etapa 5');
  const grupos = await p.$$eval('[data-resumo-grupo]', (gs) => gs.map((g) => ({
    etapa: g.getAttribute('data-resumo-grupo'),
    titulo: document.getElementById(g.getAttribute('aria-labelledby')).textContent,
    h3: g.querySelector('h3') && g.querySelector('h3').textContent,
    botao: g.querySelector('[data-editar-etapa]').textContent.trim(),
    texto: g.querySelector('dl').innerText
  })));
  ok(grupos.length === 4 && grupos.map((g) => g.etapa).join() === '1,2,3,4', '4 grupos, um por etapa');
  ok(grupos.every((g) => g.h3 && g.titulo === g.h3), 'cada grupo é uma seção nomeada pelo seu h3');
  ok(grupos[0].botao === 'Editar etapa 1: Seu negócio' && grupos[3].botao === 'Editar etapa 4: Domínio e arquivos', 'nome acessível do "Editar" diz a etapa: ' + grupos[0].botao);
  ok(grupos[0].texto.includes('Doceria Exemplo') && grupos[0].texto.includes('Campinas/SP'), 'grupo 1 mostra as respostas da etapa 1');
  ok(grupos[1].texto.includes('https://exemplo.com.br'), 'grupo 2 mostra a referência');
  ok(grupos[2].texto.includes('Bolos\nDoces finos'), 'quebras de linha preservadas no resumo');
  ok(grupos[3].texto.includes('doceriaexemplo.com.br'), 'domínio aparece quando "Sim"');
  ok(grupos[0].texto.includes('Não informado'), 'campo vazio aparece como "Não informado"');
  const niveis = await p.$$eval('h1, h2, h3', (hs) => hs.filter((h) => h.offsetParent !== null || h.tagName === 'H1').map((h) => h.tagName));
  ok(niveis.indexOf('H2') !== -1 && niveis.indexOf('H2') < niveis.indexOf('H3'), 'hierarquia: h2 "Confira as informações" antes dos h3');
  const desc = await p.getAttribute('[data-enviar-briefing]', 'aria-describedby');
  ok(desc && (await p.textContent('#' + desc)).includes('Confira'), 'botão Enviar descrito pela dica da revisão (aria-describedby)');
  const descSec = await p.getAttribute('.briefing__revisao', 'aria-describedby');
  ok(descSec === desc, 'seção da revisão também usa a dica como descrição');
  await axe(p, 'revisão 375');
  await p.screenshot({ path: SAIDA + '/briefing-revisao-375.png', fullPage: true });

  console.log('\n[2] Teclado: Editar → etapa certa → Voltar à revisão devolve o foco');
  await p.evaluate(() => document.querySelector('[data-etapa="5"] .briefing__legenda').focus());
  ok(await tabAte(p, '[data-editar-etapa="2"]'), 'Tab alcança "Editar etapa 2"');
  await p.keyboard.press('Enter');
  ok(await etapaVisivel(p) === 2, 'Enter em "Editar" abre a etapa 2');
  let f = await foco(p);
  ok(f.legenda && f.texto.includes('Etapa 2 de 5'), 'foco na legenda da etapa 2');
  ok(await p.locator('[data-voltar-revisao]').isVisible(), '"Voltar à revisão" visível');
  ok(await p.getAttribute('[data-etapa-proxima]', 'class').then((c) => c.includes('botao--contorno')), '"Continuar" vira secundário durante a edição');
  await p.fill('#b-objetivo', 'Vender bolos pelo WhatsApp');
  ok(await tabAte(p, '[data-voltar-revisao]'), 'Tab alcança "Voltar à revisão"');
  await p.keyboard.press('Enter');
  ok(await etapaVisivel(p) === 5, 'volta para a etapa 5');
  f = await foco(p);
  ok(f.editar === '2', 'foco volta ao "Editar etapa 2"');
  ok((await p.textContent('[data-resumo-grupo="2"]')).includes('Vender bolos pelo WhatsApp'), 'resumo atualizado com a correção');
  ok(await p.locator('[data-voltar-revisao]').isHidden(), '"Voltar à revisão" some na etapa 5');

  console.log('\n[3] Link inválido impede voltar à revisão; Continuar ainda funciona');
  await p.click('[data-editar-etapa="2"]');
  await p.fill('#b-referencias-2', 'exemplo sem https');
  await p.click('[data-voltar-revisao]');
  ok(await etapaVisivel(p) === 2, 'com link inválido, fica na etapa 2');
  ok(await p.getAttribute('#b-referencias-2', 'aria-invalid') === 'true', 'campo marcado como inválido e focado');
  await p.fill('#b-referencias-2', '');
  await p.click('[data-etapa-proxima]');
  ok(await etapaVisivel(p) === 3, '"Continuar" segue para a etapa 3 durante a edição');
  ok(await p.locator('[data-voltar-revisao]').isVisible(), 'continua oferecendo "Voltar à revisão"');
  await p.click('[data-voltar-revisao]');
  f = await foco(p);
  ok(await etapaVisivel(p) === 5 && f.editar === '3', 'voltando da etapa 3, foco no "Editar etapa 3"');

  console.log('\n[4] Domínio "Não" esconde a linha do domínio; envio manda as respostas corrigidas');
  await p.click('[data-editar-etapa="4"]');
  await p.check('input[name="tem_dominio"][value="nao"]');
  await p.click('[data-voltar-revisao]');
  const g4 = await p.textContent('[data-resumo-grupo="4"]');
  ok(!g4.includes('doceriaexemplo.com.br') && g4.includes('Não'), 'sem domínio: linha do domínio some do resumo');
  await p.click('[data-enviar-briefing]');
  await p.waitForSelector('[data-briefing-aviso][data-tipo="sucesso"]');
  ok(p.enviado && p.enviado.objetivo === 'Vender bolos pelo WhatsApp' && p.enviado.dominio === '', 'RPC recebeu as respostas corrigidas');
  ok(p.erros.length === 0, 'console sem erros' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));

  console.log('\n[5] Larguras, modo escuro e movimento reduzido');
  for (const largura of [320, 375, 768, 1280]) {
    const q = await novaPagina(browser, largura, largura === 320 ? { reducedMotion: 'reduce' } : {});
    await abrir(q);
    await preencherTudo(q);
    ok(await semRolagem(q), `${largura}px: sem rolagem horizontal na revisão`);
    const caixas = await q.$$eval('[data-editar-etapa]', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return r.right <= window.innerWidth && r.width > 0; }));
    ok(caixas.every(Boolean), `${largura}px: botões "Editar" inteiros na tela`);
    if (largura === 768) {
      await q.evaluate(() => { document.documentElement.setAttribute('data-tema', 'escuro'); });
      await axe(q, 'revisão no escuro 768');
      await q.screenshot({ path: SAIDA + '/briefing-revisao-768-escuro.png', fullPage: true });
    }
    if (largura === 1280) await q.screenshot({ path: SAIDA + '/briefing-revisao-1280.png', fullPage: true });
    if (largura === 320) {
      await q.click('[data-editar-etapa="1"]');
      await q.click('[data-voltar-revisao]');
      ok((await foco(q)).editar === '1', '320px com movimento reduzido: foco volta ao "Editar etapa 1"');
      await q.screenshot({ path: SAIDA + '/briefing-revisao-320.png', fullPage: true });
    }
    ok(q.erros.length === 0, `${largura}px: console sem erros` + (q.erros.length ? ' -> ' + q.erros.join(' | ') : ''));
    await q.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
