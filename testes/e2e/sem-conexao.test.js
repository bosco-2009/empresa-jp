// Erros amigáveis sem conexão (item 53 do MELHORIAS.md). Em planos, briefing, pedido e chat:
//  - sem internet (navigator.onLine falso) ou com a requisição caindo por falta de rede, a página mostra
//    "Sem internet: …" com "Tentar de novo", sem apagar nada do que foi digitado;
//  - "Tentar de novo" reenvia quando a conexão volta; briefing e pedido consultam sozinhos ao voltar a conexão;
//  - erros do servidor (recusa, acesso negado) continuam com as mensagens de antes, sem o botão;
//  - 320/375/768/1280 px sem rolagem horizontal, console limpo e axe sem violações sérias com a mensagem na tela.
// Não precisa de Postgres: as RPCs e Edge Functions são respondidas pelo próprio Playwright.
// Uso: sirva a raiz (python3 -m http.server 8080) e rode  node testes/e2e/sem-conexao.test.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const AXE = require.resolve('axe-core/axe.min.js');
const SUPA_JS = require.resolve('@supabase/supabase-js/dist/umd/supabase.js');
const RAIZ = path.resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const CODIGO = 'PBR-ABCDEF';
const TOKEN = 'ab'.repeat(32);
const LARGURAS = [320, 375, 768, 1280];

const configTeste = fs.readFileSync(RAIZ + '/config.js', 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

// rede.cair = true -> a API do Supabase falha como sem internet (net::ERR_INTERNET_DISCONNECTED)
// rede.recusar = 'codigo' -> a API responde 400 com esse erro (falha do servidor, não da rede)
async function abrir(browser, largura, caminho, rede, antes) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 800 } });
  await ctx.addInitScript(({ codigo, token }) => {
    try {
      sessionStorage.setItem('pbr_abertura_vista', '1');
      localStorage.setItem('pbr_briefing_acesso', JSON.stringify({ codigo, token }));
      localStorage.setItem('pbr_pedidos_v1', JSON.stringify({ x: { codigo, token, plano_id: 'profissional' } }));
    } catch (e) { /* */ }
  }, { codigo: CODIGO, token: TOKEN });
  const p = await ctx.newPage();
  p.erros = [];
  p.chamadas = [];
  p.on('console', (m) => {
    // A falha de rede simulada aparece no console como erro de carregamento do próprio navegador
    // (não é erro do site): só ela é ignorada, e só enquanto a rede está "caída".
    if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) p.erros.push(m.text());
  });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: SUPA_JS, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  await p.routeWebSocket(/localhost:54321/, () => { /* Realtime aceito e mudo: o chat cai na consulta periódica */ });
  await p.route(API + '/**', (r) => {
    const req = r.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const nome = req.url().split('/').pop();
    p.chamadas.push(nome);
    if (rede.cair) return r.abort('internetdisconnected');
    if (rede.recusar) return r.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: JSON.stringify({ erro: rede.recusar, message: rede.recusar }) });
    let corpo = [];
    if (nome === 'briefing_obter') corpo = [{ pedido_status: 'aprovado', plano_nome: 'Profissional', briefing: null }];
    if (nome === 'briefing_enviar') corpo = { ok: true };
    if (nome === 'pedido_acompanhar') corpo = [{ etapa: 'pago', pedido_status: 'aprovado', plano_nome: 'Profissional', pago_em: new Date().toISOString() }];
    if (nome === 'pedido_consultar') corpo = [];
    if (nome === 'criar-pagamento') corpo = { init_point: 'http://localhost:8080/obrigado.html?teste=1', codigo: CODIGO, token: TOKEN, pedido_id: 'x' };
    if (nome === 'chat_iniciar') corpo = [{ id: 1, canal: 'teste', status: 'aberta' }];
    if (nome === 'chat_enviar') {
      const texto = JSON.parse(req.postData() || '{}').p_texto;
      corpo = [{ id: 'm' + p.chamadas.length, autor: 'visitante', texto, criado_em: new Date().toISOString() }];
    }
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(corpo) });
  });
  if (antes) await antes(p);
  await p.goto(SITE + caminho, { waitUntil: 'networkidle' });
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
const foco = (p) => p.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.getAttribute('data-tentar-pedido') !== null && 'tentar-pedido' || a.className || a.tagName) : ''; });
function console0(p, rotulo) { ok(p.erros.length === 0, `console limpo (${rotulo})` + (p.erros.length ? ': ' + p.erros.join(' | ') : '')); }

async function preencherPlanos(p) {
  await p.fill('#checkout-nome', 'Rita Moura');
  await p.fill('#checkout-email', 'rita@teste.local');
  await p.fill('#checkout-whatsapp', '(11) 98888-1234');
  await p.check('#checkout-aceite');
}
async function preencherBriefing(p) {
  await p.fill('#b-nome_negocio', 'Doceria Exemplo');
  for (let i = 0; i < 4; i++) await p.click('[data-etapa-proxima]');
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Planos: sem internet antes de enviar (offline) e com a requisição caindo');
  for (const largura of LARGURAS) {
    const rede = {};
    const p = await abrir(browser, largura, 'planos.html?plano=profissional', rede);
    await preencherPlanos(p);
    await p.context().setOffline(true);
    const antes = p.chamadas.length;
    await p.click('[data-botao-pagar]');
    const erro = p.locator('[data-erro-checkout]');
    await erro.waitFor();
    ok(/^Sem internet: seus dados continuam aqui/.test(await erro.textContent()), `${largura}px: mensagem "Sem internet" ao enviar offline`);
    ok(p.chamadas.length === antes, `${largura}px: offline não tenta chamar a Edge Function`);
    ok(await p.locator('[data-tentar-checkout]').isVisible(), `${largura}px: botão "Tentar de novo" visível`);
    ok(await p.inputValue('#checkout-nome') === 'Rita Moura' && await p.inputValue('#checkout-email') === 'rita@teste.local' &&
      await p.isChecked('#checkout-aceite'), `${largura}px: nada do que foi digitado se perdeu`);
    ok(await p.locator('[data-botao-pagar]').isEnabled(), `${largura}px: botão de pagamento continua ativo`);
    ok(await semRolagem(p), `${largura}px: sem rolagem horizontal`);
    await axe(p, `planos offline ${largura}px`);
    if (largura === 375 || largura === 1280) await p.screenshot({ path: `${SAIDA}/sem-conexao-planos-${largura}.png`, fullPage: false });
    await p.context().setOffline(false);
    await p.waitForFunction(() => /conexão voltou/.test(document.querySelector('[data-erro-checkout]').textContent));
    ok(true, `${largura}px: ao voltar a conexão, a mensagem avisa e nada é enviado sozinho`);
    ok(p.chamadas.length === antes, `${largura}px: nenhuma chamada automática ao voltar a conexão`);
    if (largura === 375) {
      // requisição caindo com o navegador "online" (Wi-Fi sem internet)
      rede.cair = true;
      await p.click('[data-tentar-checkout]');
      await p.waitForFunction(() => /^Sem internet/.test(document.querySelector('[data-erro-checkout]').textContent));
      ok(p.chamadas.includes('criar-pagamento'), 'falha de rede na Edge Function vira "Sem internet"');
      ok(await p.locator('[data-botao-pagar]').isEnabled() && (await p.textContent('[data-botao-pagar]')).includes('Ir para o pagamento'), 'botão de pagamento volta ao normal');
      // erro do servidor: mensagem de antes, sem "Tentar de novo"
      rede.cair = false; rede.recusar = 'limite_pedidos';
      await p.click('[data-tentar-checkout]');
      await p.waitForFunction(() => /Muitas tentativas/.test(document.querySelector('[data-erro-checkout]').textContent));
      ok(await p.locator('[data-tentar-checkout]').isHidden(), 'erro do servidor mantém a mensagem própria, sem "Tentar de novo"');
      // conexão de volta: "Tentar de novo" leva ao pagamento
      rede.recusar = null;
      await p.context().setOffline(true);
      await p.click('[data-botao-pagar]');
      await p.locator('[data-tentar-checkout]').waitFor();
      await p.context().setOffline(false);
      await p.focus('[data-tentar-checkout]');
      await Promise.all([p.waitForURL('**/obrigado.html**'), p.keyboard.press('Enter')]);
      ok(true, '"Tentar de novo" pelo teclado leva ao pagamento quando a conexão volta');
    }
    console0(p, `planos ${largura}px`);
    await p.context().close();
  }

  console.log('\n[2] Briefing: envio sem internet mantém as respostas; carga sem internet tenta sozinha ao voltar');
  for (const largura of LARGURAS) {
    const rede = {};
    const p = await abrir(browser, largura, 'briefing.html', rede);
    await p.waitForSelector('[data-form-briefing]:not([hidden])');
    await preencherBriefing(p);
    await p.context().setOffline(true);
    await p.click('[data-enviar-briefing]');
    await p.locator('[data-erro-briefing]').waitFor();
    ok(/^Sem internet: suas respostas continuam aqui/.test(await p.textContent('[data-erro-briefing]')), `${largura}px: "Sem internet" no envio`);
    ok(await p.locator('[data-tentar-briefing]').isVisible(), `${largura}px: "Tentar de novo" visível`);
    ok(await p.inputValue('#b-nome_negocio') === 'Doceria Exemplo', `${largura}px: respostas continuam no formulário`);
    ok(!p.chamadas.includes('briefing_enviar'), `${largura}px: offline não tenta enviar`);
    ok(await semRolagem(p), `${largura}px: sem rolagem horizontal`);
    await axe(p, `briefing offline ${largura}px`);
    if (largura === 375) await p.screenshot({ path: `${SAIDA}/sem-conexao-briefing-${largura}.png` });
    await p.context().setOffline(false);
    if (largura === 375) {
      rede.cair = true;
      await p.click('[data-tentar-briefing]');
      await p.waitForFunction(() => /^Sem internet/.test(document.querySelector('[data-erro-briefing]').textContent) &&
        !document.querySelector('[data-enviar-briefing]').disabled);
      ok(p.chamadas.includes('briefing_enviar'), 'falha de rede no envio vira "Sem internet"');
      rede.cair = false;
    }
    await p.click('[data-tentar-briefing]');
    await p.waitForSelector('[data-briefing-aviso][data-tipo="sucesso"]');
    ok(true, `${largura}px: "Tentar de novo" envia o briefing quando a conexão volta`);
    console0(p, `briefing ${largura}px`);
    await p.context().close();
  }
  {
    const rede = { cair: true };
    const p = await abrir(browser, 375, 'briefing.html', rede);
    await p.waitForSelector('[data-briefing-aviso][data-tipo="erro"]');
    ok(/Sem internet/.test(await p.textContent('[data-aviso-titulo]')), 'carga sem rede: aviso "Sem internet no momento"');
    ok(await p.locator('[data-tentar-carga]').isVisible(), 'carga sem rede: botão "Tentar de novo"');
    await axe(p, 'briefing carga sem rede');
    await p.screenshot({ path: `${SAIDA}/sem-conexao-briefing-carga-375.png` });
    await p.focus('[data-tentar-carga]');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => /Sem internet/.test(document.querySelector('[data-aviso-titulo]').textContent) && document.querySelector('[data-tentar-carga]'));
    ok(await foco(p) !== 'BODY', 'nova falha mantém o foco num elemento da página (' + await foco(p) + ')');
    rede.cair = false;
    await p.context().setOffline(true);
    await p.context().setOffline(false); // evento "online": tenta sozinho
    await p.waitForSelector('[data-form-briefing]:not([hidden])');
    ok(true, 'ao voltar a conexão, o briefing carrega sozinho');
    console0(p, 'briefing carga');
    await p.context().close();
  }
  {
    const rede = { recusar: 'acesso_negado' };
    const p = await abrir(browser, 375, 'briefing.html', rede);
    await p.waitForSelector('[data-briefing-aviso][data-tipo="erro"]');
    ok(/Não foi possível abrir este briefing/.test(await p.textContent('[data-aviso-titulo]')) && await p.locator('[data-tentar-carga]').count() === 0,
      'acesso negado continua com a mensagem própria, sem "Tentar de novo"');
    await p.context().close();
  }

  console.log('\n[3] Pedido: carga sem rede, consulta sozinha ao voltar; atualização sem rede mantém a última situação');
  for (const largura of LARGURAS) {
    const rede = { cair: true };
    const p = await abrir(browser, largura, 'pedido.html?pedido=' + CODIGO, rede);
    await p.waitForSelector('[data-tentar-pedido]');
    ok(/Sem internet/.test(await p.textContent('[data-acompanhar-titulo]')), `${largura}px: título "Sem internet no momento"`);
    ok(await semRolagem(p), `${largura}px: sem rolagem horizontal`);
    await axe(p, `pedido sem rede ${largura}px`);
    if (largura === 375) await p.screenshot({ path: `${SAIDA}/sem-conexao-pedido-${largura}.png` });
    rede.cair = false;
    if (largura === 375) {
      await p.focus('[data-tentar-pedido]');
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => !/Sem internet/.test(document.querySelector('[data-acompanhar-titulo]').textContent));
      ok(await foco(p) === 'pedido-titulo', '"Tentar de novo" carrega o pedido e o foco vai para o título');
      await p.context().setOffline(true);
      await p.click('[data-acompanhar-atualizar]');
      ok(/^Sem internet: mostrando a situação das \d\d:\d\d/.test(await p.textContent('[data-acompanhar-hora]')), 'atualizar sem internet mantém a situação e diz de quando é');
      ok(!/Sem internet/.test(await p.textContent('[data-acompanhar-titulo]')), 'a situação do pedido continua na tela');
      const antes = p.chamadas.filter((c) => c === 'pedido_acompanhar').length;
      await p.context().setOffline(false);
      await p.waitForFunction(() => /^Atualizado às/.test(document.querySelector('[data-acompanhar-hora]').textContent));
      ok(p.chamadas.filter((c) => c === 'pedido_acompanhar').length === antes + 1, 'ao voltar a conexão, consulta sozinha uma vez');
    } else {
      await p.context().setOffline(true);
      await p.context().setOffline(false);
      await p.waitForFunction(() => !/Sem internet/.test(document.querySelector('[data-acompanhar-titulo]').textContent));
      ok(true, `${largura}px: ao voltar a conexão, o pedido carrega sozinho`);
    }
    console0(p, `pedido ${largura}px`);
    await p.context().close();
  }

  console.log('\n[4] Chat: mensagem fica na caixa, "Tentar de novo" envia quando a conexão volta');
  for (const largura of LARGURAS) {
    const rede = {};
    const p = await abrir(browser, largura, 'planos.html', rede);
    await p.click('.chat__lancador');
    await p.waitForFunction(() => window.supabase && window.supabase.createClient);
    await p.fill('#chat-nome', 'Ana');
    await p.fill('#chat-texto', 'Oi, quero um site para minha loja.');
    await p.context().setOffline(true);
    await p.press('#chat-texto', 'Enter');
    await p.locator('#chat-erro').waitFor();
    ok(/^Sem internet: sua mensagem continua aqui/.test(await p.textContent('#chat-erro')), `${largura}px: "Sem internet" no chat`);
    ok(await p.inputValue('#chat-texto') === 'Oi, quero um site para minha loja.', `${largura}px: a mensagem continua na caixa`);
    ok(await p.locator('.chat__tentar').isVisible(), `${largura}px: "Tentar de novo" visível`);
    ok(!p.chamadas.includes('chat_iniciar'), `${largura}px: offline não tenta iniciar a conversa`);
    ok(await semRolagem(p), `${largura}px: sem rolagem horizontal`);
    await axe(p, `chat offline ${largura}px`);
    if (largura === 375 || largura === 1280) await p.screenshot({ path: `${SAIDA}/sem-conexao-chat-${largura}.png` });
    await p.context().setOffline(false);
    await p.waitForFunction(() => /conexão voltou/.test(document.querySelector('#chat-erro').textContent));
    if (largura === 375) {
      rede.cair = true;
      await p.click('.chat__tentar');
      await p.waitForFunction(() => /^Sem internet/.test(document.querySelector('#chat-erro').textContent) && !document.querySelector('.chat__enviar').disabled);
      ok(p.chamadas.includes('chat_iniciar'), 'falha de rede ao iniciar a conversa vira "Sem internet"');
      ok(await p.inputValue('#chat-texto') === 'Oi, quero um site para minha loja.', 'a mensagem continua na caixa depois da falha');
      rede.cair = false;
    }
    await p.click('.chat__tentar');
    await p.waitForFunction(() => document.querySelector('#chat-texto').value === '');
    ok(await p.locator('#chat-erro').isHidden() && await p.locator('.chat__tentar').isHidden(), `${largura}px: enviada, aviso e botão somem`);
    ok(await foco(p) === 'chat-texto', `${largura}px: o foco fica na caixa de mensagem`);
    ok((await p.textContent('.chat__mensagens, [role="log"]')).includes('quero um site'), `${largura}px: a mensagem aparece na conversa`);
    console0(p, `chat ${largura}px`);
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
