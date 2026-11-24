// Erro de rede, tempo esgotado e 5xx no envio do briefing e dos arquivos (item 82 do MELHORIAS.md).
//  - Envio do briefing: 503, queda da conexão no meio do envio e tempo esgotado mostram mensagem clara no role="alert"
//    com "Tentar de novo"; o rascunho do aparelho continua com tudo; "Tentar de novo" reenvia o mesmo briefing.
//  - Arquivo: falha passageira deixa o item na lista com a mensagem num role="alert", "Tentar de novo" (o mesmo
//    arquivo, sem escolher de novo) e "Descartar". A 2ª tentativa reaproveita a URL assinada (mesmo caminho);
//    se o arquivo já tinha chegado (resposta perdida), o 409 do Storage conta como enviado: entra uma vez só.
//  - Enviar o briefing com arquivo pendente de falha leva à etapa 4 e foca o "Tentar de novo" do arquivo.
//  - 4 larguras (320/375/768/1280) sem rolagem horizontal, axe (claro e escuro), alvos de toque e console limpo.
// Não precisa de Postgres: as RPCs, a Edge Function e o Storage são respondidos pelo próprio Playwright
// ("derrubar a rede" = r.abort() no meio do envio).
// Uso: sirva a raiz (python3 -m http.server 8080) e rode  node testes/e2e/briefing-erro-rede.test.js
const { chromium } = require('playwright');
const fs = require('fs');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const CODIGO = 'PBR-REDE82';
const TOKEN = 'ab'.repeat(32);
const CHAVE_RASCUNHO = 'pbr_briefing_rascunho_' + CODIGO;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

// modo.enviar / modo.assinar / modo.put: 'ok' | '503' | 'cair' (abort no meio) | 'pendurar' (nunca responde)
//   | 'chegou-e-caiu' (put: o Storage grava e a resposta se perde) ; filas: um valor por chamada, depois 'ok'
async function novaPagina(browser, largura, opcoes) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: largura, height: 800 } }, opcoes || {}));
  const p = await ctx.newPage();
  p.erros = [];
  p.chamadas = { enviar: 0, assinar: 0, put: [] };
  p.fila = { enviar: [], assinar: [], put: [] };
  p.storage = new Set();
  p.on('console', (m) => {
    // Falhas simuladas aparecem como erro de carregamento do próprio navegador (não do site): só elas são ignoradas.
    if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|ERR_INTERNET_DISCONNECTED/.test(m.text())) p.erros.push(m.text());
  });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route(/https:\/\/[a-z0-9]+\.supabase\.co\/.*/, async (r) => {
    const req = r.request();
    const url = req.url();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const json = (status, corpo) => r.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(corpo) });
    const falhar = (modo) => {
      if (modo === '503') return json(503, { message: 'Service Unavailable', erro: 'indisponivel' });
      if (modo === 'cair') return r.abort('failed');
      if (modo === 'pendurar') return new Promise(() => {});
      return null;
    };
    if (url.endsWith('/rpc/briefing_obter')) return json(200, [{ pedido_status: 'aprovado', plano_nome: 'Profissional', briefing: null }]);
    if (url.endsWith('/rpc/briefing_enviar')) {
      p.chamadas.enviar++;
      const modo = p.fila.enviar.shift() || 'ok';
      if (modo !== 'ok') return falhar(modo);
      p.enviado = JSON.parse(req.postData()).p_dados;
      return json(200, null);
    }
    if (url.endsWith('/functions/v1/briefing-upload')) {
      p.chamadas.assinar++;
      const modo = p.fila.assinar.shift() || 'ok';
      if (modo !== 'ok') return falhar(modo);
      const caminho = 'pedido-x/arq' + p.chamadas.assinar + '-logo.png';
      return json(200, { caminho, upload_url: new URL('/storage/v1/object/upload/sign/briefings/' + caminho + '?token=t' + p.chamadas.assinar, url).href });
    }
    if (url.includes('/storage/v1/object/upload/sign/') && req.method() === 'PUT') {
      const caminho = new URL(url).pathname.split('/briefings/')[1];
      p.chamadas.put.push(caminho);
      const modo = p.fila.put.shift() || 'ok';
      if (modo === 'chegou-e-caiu') { p.storage.add(caminho); return r.abort('failed'); }
      if (modo !== 'ok') return falhar(modo);
      if (p.storage.has(caminho)) return json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      p.storage.add(caminho);
      return json(200, { Key: 'briefings/' + caminho });
    }
    return json(404, {});
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
const semRolagem = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const etapaVisivel = (p) => p.$eval('[data-etapa]:not([hidden])', (f) => Number(f.getAttribute('data-etapa')));
const rascunho = (p) => p.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, CHAVE_RASCUNHO);
const erroGeral = (p) => p.evaluate(() => { const e = document.querySelector('[data-erro-briefing]'); return e.hidden ? '' : e.textContent; });
function console0(p, rotulo) { ok(p.erros.length === 0, `console limpo (${rotulo})` + (p.erros.length ? ': ' + p.erros.join(' | ') : '')); }

async function abrir(p) {
  await p.goto(SITE + 'briefing.html#c=' + CODIGO + '&t=' + TOKEN, { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-form-briefing]:not([hidden])');
}
async function irAteArquivos(p) {
  await p.fill('#b-nome_negocio', 'Doceria Exemplo');
  await p.fill('#b-cidade', 'Campinas/SP');
  await p.click('[data-etapa-proxima]');
  await p.fill('#b-objetivo', 'Receber encomendas');
  await p.click('[data-etapa-proxima]');
  await p.fill('#b-textos_servicos', 'Bolos\nDoces finos');
  await p.click('[data-etapa-proxima]');
}
async function escolherLogo(p) {
  await p.setInputFiles('#b-arquivos', { name: 'logo.png', mimeType: 'image/png', buffer: PNG });
}
const esperarEnvioParado = (p) => p.waitForFunction(() => !document.querySelector('[data-enviar-briefing]').disabled &&
  !document.querySelector('[data-erro-briefing]').hidden);

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Envio do briefing: 503, queda no meio do envio e "Tentar de novo" (375 px)');
  {
    const p = await novaPagina(browser, 375);
    await abrir(p);
    await irAteArquivos(p);
    await p.click('[data-etapa-proxima]');
    ok(await etapaVisivel(p) === 5, 'chegou à revisão');
    p.fila.enviar.push('503');
    await p.click('[data-enviar-briefing]');
    await esperarEnvioParado(p);
    ok(/servidor teve um problema/.test(await erroGeral(p)), '503: mensagem de servidor no alerta -> ' + (await erroGeral(p)));
    ok(await p.getAttribute('[data-erro-briefing]', 'role') === 'alert', 'mensagem num role="alert"');
    ok(await p.locator('[data-tentar-briefing]').isVisible(), '503: "Tentar de novo" visível');
    let r = await rascunho(p);
    ok(r && r.dados && r.dados.nome_negocio === 'Doceria Exemplo' && r.dados.textos_servicos === 'Bolos\nDoces finos', 'rascunho do aparelho continua com as respostas');
    ok(await p.inputValue('#b-nome_negocio') === 'Doceria Exemplo', 'formulário continua preenchido');
    await axe(p, 'erro 503 no envio');
    await p.screenshot({ path: SAIDA + '/briefing-erro-rede-envio-375.png', fullPage: false });

    p.fila.enviar.push('cair');
    await p.click('[data-tentar-briefing]');
    await esperarEnvioParado(p);
    ok(/^Sem internet/.test(await erroGeral(p)), 'queda da conexão no meio do envio: "Sem internet"');
    ok(await p.locator('[data-tentar-briefing]').isVisible(), '"Tentar de novo" continua visível');
    ok(p.chamadas.enviar === 2, '2 tentativas até aqui');

    await p.focus('[data-tentar-briefing]');
    await p.keyboard.press('Enter');
    await p.waitForSelector('[data-briefing-aviso][data-tipo="sucesso"]');
    ok(p.chamadas.enviar === 3 && p.enviado && p.enviado.nome_negocio === 'Doceria Exemplo', '"Tentar de novo" (teclado) reenvia o mesmo briefing');
    ok(await rascunho(p) === null, 'rascunho apagado só depois do sucesso');
    console0(p, 'envio');
    await p.context().close();
  }

  console.log('\n[2] Tempo esgotado no envio do briefing (relógio controlado)');
  {
    const p = await novaPagina(browser, 375);
    await p.clock.install();
    await abrir(p);
    await irAteArquivos(p);
    await p.click('[data-etapa-proxima]');
    p.fila.enviar.push('pendurar');
    await p.click('[data-enviar-briefing]');
    await p.waitForFunction(() => document.querySelector('[data-enviar-briefing]').disabled);
    await p.clock.runFor(19000);
    ok(await p.$eval('[data-enviar-briefing]', (b) => b.disabled), 'aos 19 s ainda está enviando');
    await p.clock.runFor(2000);
    await esperarEnvioParado(p);
    ok(/demorou demais/.test(await erroGeral(p)), 'aos 20 s: "O envio demorou demais" -> ' + (await erroGeral(p)));
    ok(await p.locator('[data-tentar-briefing]').isVisible(), '"Tentar de novo" visível');
    ok(await p.$eval('[data-enviar-briefing]', (b) => b.textContent.trim()) === 'Enviar briefing' && !(await p.$eval('[data-enviar-briefing]', (b) => b.hasAttribute('data-carregando'))), 'botão de envio volta ao normal');
    const r = await rascunho(p);
    ok(r && r.dados && r.dados.objetivo === 'Receber encomendas', 'rascunho intacto após o tempo esgotado');
    await p.click('[data-tentar-briefing]');
    await p.waitForSelector('[data-briefing-aviso][data-tipo="sucesso"]');
    ok(p.chamadas.enviar === 2, 'nova tentativa enviou');
    console0(p, 'tempo esgotado');
    await p.context().close();
  }

  console.log('\n[3] Arquivo: 503 ao assinar, queda com o arquivo já gravado e 409 contado como enviado (sem duplicar)');
  {
    const p = await novaPagina(browser, 375);
    await abrir(p);
    await irAteArquivos(p);
    p.fila.assinar.push('503');
    await escolherLogo(p);
    await p.waitForSelector('[data-arquivo-estado="falhou"]');
    const item = p.locator('[data-arquivo-estado="falhou"]');
    ok(/servidor não respondeu/.test(await item.innerText()), 'mensagem clara no item -> ' + (await item.innerText()).replace(/\n/g, ' | '));
    ok(await item.locator('[role="alert"]').count() === 1, 'mensagem do arquivo num role="alert"');
    ok(await p.getAttribute('[data-tentar-arquivo]', 'aria-label') === 'Tentar enviar de novo logo.png', '"Tentar de novo" com o nome do arquivo');
    ok(await p.getAttribute('[data-descartar-arquivo]', 'aria-label') === 'Descartar logo.png', '"Descartar" com o nome do arquivo');
    await p.waitForTimeout(8500);
    ok(await item.count() === 1, 'falha passageira não some sozinha (8 s)');
    await axe(p, 'arquivo com falha');
    await p.screenshot({ path: SAIDA + '/briefing-erro-rede-arquivo-375.png', fullPage: false });

    p.fila.put.push('chegou-e-caiu');
    await p.focus('[data-tentar-arquivo]');
    await p.keyboard.press('Enter');
    await p.waitForSelector('[data-arquivo-estado="falhou"][data-falha="rede"]');
    ok(p.chamadas.assinar === 2 && p.chamadas.put.length === 1, 'nova tentativa pediu a URL assinada e fez o PUT');
    ok(await p.evaluate(() => document.activeElement.matches('[data-tentar-arquivo]')), 'foco volta ao novo "Tentar de novo" após falhar de novo');

    await p.keyboard.press('Enter');
    await p.waitForSelector('[data-lista-arquivos] li[data-caminho]');
    ok(p.chamadas.assinar === 2, 'URL assinada reaproveitada (nenhuma assinatura nova)');
    ok(p.chamadas.put.length === 2 && p.chamadas.put[0] === p.chamadas.put[1], 'mesmo caminho nas duas tentativas de PUT');
    ok(await p.locator('[data-lista-arquivos] li').count() === 1, 'arquivo aparece uma vez só (409 = já tinha chegado)');
    ok(p.storage.size === 1, 'um único objeto no Storage');
    await p.waitForTimeout(700); // o rascunho grava 500 ms depois da última mudança
    const r = await rascunho(p);
    ok(r && r.dados && r.dados.arquivos && r.dados.arquivos.length === 1 && r.dados.arquivos[0].caminho === p.chamadas.put[0], 'rascunho com o arquivo uma vez');
    ok(r && r.dados && r.dados.nome_negocio === 'Doceria Exemplo', 'respostas do rascunho intactas');
    ok(await p.evaluate(() => document.activeElement.id === 'b-arquivos'), 'foco volta para "Escolher arquivos" após o sucesso');

    console.log('\n[4] Briefing com arquivo pendente de falha: avisa, vai à etapa 4 e foca o "Tentar de novo"');
    p.fila.assinar.push('cair');
    await p.setInputFiles('#b-arquivos', { name: 'foto.png', mimeType: 'image/png', buffer: PNG });
    await p.waitForSelector('[data-arquivo-estado="falhou"]');
    await p.click('[data-etapa-proxima]');
    const enviosAntes = p.chamadas.enviar;
    await p.click('[data-enviar-briefing]');
    ok(await etapaVisivel(p) === 4, 'voltou à etapa 4');
    ok(/Um arquivo não foi enviado/.test(await erroGeral(p)), 'aviso do arquivo pendente');
    ok(await p.evaluate(() => document.activeElement.getAttribute('aria-label') === 'Tentar enviar de novo foto.png'), 'foco no "Tentar de novo" do arquivo');
    ok(p.chamadas.enviar === enviosAntes, 'briefing não foi enviado sem o arquivo');
    await p.click('[data-descartar-arquivo]');
    ok(await p.locator('[data-arquivo-estado]').count() === 0, '"Descartar" tira o arquivo pendente');
    ok(await p.evaluate(() => document.activeElement.id === 'b-arquivos'), 'foco em "Escolher arquivos" após descartar');
    await p.click('[data-etapa-proxima]');
    await p.click('[data-enviar-briefing]');
    await p.waitForSelector('[data-briefing-aviso][data-tipo="sucesso"]');
    ok(p.enviado && p.enviado.arquivos && p.enviado.arquivos.length === 1, 'briefing enviado com o arquivo que chegou, uma vez');
    console0(p, 'arquivos');
    await p.context().close();
  }

  console.log('\n[5] Recusa do servidor (não passageira) continua como antes: some sozinha, sem "Tentar de novo"');
  {
    const p = await novaPagina(browser, 375);
    await abrir(p);
    await irAteArquivos(p);
    await p.route(/functions\/v1\/briefing-upload/, (r) => r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
      : r.fulfill({ status: 429, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"erro":"limite_arquivos"}' }));
    await escolherLogo(p);
    await p.waitForSelector('[data-arquivo-estado="recusado"]');
    ok(/Limite de arquivos/.test(await p.textContent('[data-arquivo-estado="recusado"]')), 'limite de arquivos: mensagem de recusa');
    ok(await p.locator('[data-tentar-arquivo]').count() === 0, 'sem "Tentar de novo" numa recusa');
    console0(p, 'recusa');
    await p.context().close();
  }

  console.log('\n[6] 4 larguras × claro/escuro: alerta do envio e arquivo com falha');
  for (const largura of [320, 375, 768, 1280]) {
    for (const esquema of ['light', 'dark']) {
      const p = await novaPagina(browser, largura, { colorScheme: esquema });
      await abrir(p);
      await irAteArquivos(p);
      p.fila.put.push('503');
      await escolherLogo(p);
      await p.waitForSelector('[data-arquivo-estado="falhou"]');
      ok(await semRolagem(p), `${largura}px ${esquema}: sem rolagem horizontal com arquivo com falha`);
      const alvos = await p.$$eval('.arquivos__item--erro button', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
      ok(alvos.length === 2 && alvos.every((m) => m >= 24), `${largura}px: botões do arquivo com alvo ≥ 24 px (${alvos.map(Math.round).join(', ')})`);
      await axe(p, `arquivo ${largura}px ${esquema}`);
      if (esquema === 'light' || largura === 375) await p.locator('[data-lista-arquivos]').screenshot({ path: `${SAIDA}/briefing-erro-rede-arquivo-${largura}-${esquema}.png` });
      await p.click('[data-descartar-arquivo]');
      await p.click('[data-etapa-proxima]');
      p.fila.enviar.push('503');
      await p.click('[data-enviar-briefing]');
      await esperarEnvioParado(p);
      ok(await semRolagem(p), `${largura}px ${esquema}: sem rolagem horizontal com erro no envio`);
      await axe(p, `envio ${largura}px ${esquema}`);
      if (esquema === 'light' || largura === 375) await p.locator('.briefing__navegacao, [data-erro-briefing]').last().screenshot({ path: `${SAIDA}/briefing-erro-rede-envio-${largura}-${esquema}.png` }).catch(() => {});
      console0(p, `${largura}px ${esquema}`);
      await p.context().close();
    }
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
