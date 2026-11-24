// Uso: veja testes/README.md (servidor estático em :8080 e Supabase falso em :54321)
// Boas-vindas do chat por página (item 48 do MELHORIAS.md): a primeira mensagem automática do widget muda conforme a
// página (planos, pedido/obrigado, artigo do blog com o título; demais páginas com o texto padrão), com os textos de
// config.chat.boasVindas. Sem config.chat ou com texto vazio, vale o padrão. Conversa já iniciada noutra página abre com
// a saudação geral. Os textos não prometem prazo nem simulam atendente digitando. Axe e rolagem em 4 larguras.
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const AXE = require.resolve('axe-core/axe.min.js');
const RAIZ = require('path').resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

const original = fs.readFileSync(RAIZ + '/config.js', 'utf8');
const configTeste = original
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
// Sem o bloco chat (config antigo) e com o texto de planos vazio.
const configSemChat = configTeste.replace(/\n    chat: \{[\s\S]*?\n    \},\n/, '\n');
if (configSemChat === configTeste) throw new Error('remoção de config.chat falhou');
const configPlanosVazio = configTeste.replace(/(\n        planos: )'[^']*'/, "$1''");
if (configPlanosVazio === configTeste) throw new Error('esvaziar config.chat.boasVindas.planos falhou');

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, caminho, cfg, opcoes = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opcoes.contexto || {}));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.addInitScript((estado) => {
    try {
      sessionStorage.setItem('pbr_abertura_vista', '1');
      if (estado) localStorage.setItem('pbr_chat_v1', estado);
    } catch (e) { /* */ }
  }, opcoes.estado || null);
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route('**/config.js*', (r) => r.fulfill({ body: cfg, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  await p.goto(new URL(caminho, BASE).href, { waitUntil: 'networkidle' });
  return p;
}

// Texto que o visitante vê (sem o prefixo oculto "Portfólio BR: " e sem o emoji decorativo).
async function boasVindas(p) {
  await p.waitForSelector('.chat__bolha--boas-vindas', { state: 'attached' });
  return p.evaluate(() => {
    const b = document.querySelector('.chat__bolha--boas-vindas');
    const visivel = [...b.childNodes].filter((n) => !(n.nodeType === 1 && (n.classList.contains('visualmente-oculto') || n.getAttribute('aria-hidden') === 'true')))
      .map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
    return { visivel, contexto: b.getAttribute('data-chat-boas-vindas'), completo: b.textContent.replace(/\s+/g, ' ').trim() };
  });
}

async function axe(p, seletor) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  return p.evaluate(async (s) => (await axe.run(s, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.impact} ${v.id}`), seletor);
}

(async () => {
  const browser = await chromium.launch();
  const textos = await (async () => {
    const p = await abrir(browser, 'index.html', configTeste);
    const t = await p.evaluate(() => PBR_CONFIG.chat.boasVindas);
    await p.context().close();
    return t;
  })();

  console.log('\n[1] Textos do config.chat: honestos (sem prazo, sem atendente digitando)');
  Object.keys(textos).forEach((k) => {
    ok(!/minuto|segundo|\bhoras?\b|imediat|na hora|agora mesmo|digitando|já já|rapidinho/i.test(textos[k]), `${k}: sem promessa de prazo nem simulação de atendente`);
  });
  ok(['padrao', 'planos', 'pedido', 'artigo'].every((k) => typeof textos[k] === 'string' && textos[k].length > 10), 'padrao, planos, pedido e artigo preenchidos');

  console.log('\n[2] Cada página com a sua mensagem');
  const casos = [
    { caminho: 'index.html', contexto: 'padrao', esperado: textos.padrao },
    { caminho: 'planos.html', contexto: 'planos', esperado: textos.planos },
    { caminho: 'pedido.html', contexto: 'pedido', esperado: textos.pedido },
    { caminho: 'obrigado.html', contexto: 'pedido', esperado: textos.pedido },
    { caminho: 'blog/', contexto: 'padrao', esperado: textos.padrao },
    { caminho: 'segmentos/moda.html', contexto: 'segmento', esperado: textos.padrao },
    { caminho: 'blog/site-ou-instagram.html', contexto: 'artigo', artigo: true }
  ];
  for (const c of casos) {
    const p = await abrir(browser, c.caminho, configTeste);
    const b = await boasVindas(p);
    let esperado = c.esperado;
    if (c.artigo) {
      const titulo = (await p.textContent('main h1')).replace(/\s+/g, ' ').trim();
      esperado = textos.artigo.replace('{pagina}', titulo);
      ok(titulo.length > 5 && b.visivel.includes('"' + titulo + '"'), `${c.caminho}: cita o artigo "${titulo}"`);
    }
    ok(b.visivel === 'Olá! ' + esperado, `${c.caminho}: "${b.visivel}"`);
    ok(b.contexto === c.contexto, `${c.caminho}: contexto ${b.contexto}`);
    ok(b.completo.startsWith('Portfólio BR:'), `${c.caminho}: leitor de tela ouve quem fala ("Portfólio BR:")`);
    ok(!/\{\w+\}/.test(b.completo), `${c.caminho}: nenhum marcador {…} sobrando`);
    ok(p.erros.length === 0, `${c.caminho}: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[3] Sem config.chat (config antigo) e com texto vazio: vale o padrão');
  {
    const p = await abrir(browser, 'planos.html', configSemChat);
    const b = await boasVindas(p);
    ok(b.visivel === 'Olá! Como podemos ajudar? Conte o que você precisa e respondemos por aqui.', 'sem config.chat: "' + b.visivel + '"');
    ok(p.erros.length === 0, 'console limpo');
    await p.context().close();
  }
  {
    const p = await abrir(browser, 'planos.html', configPlanosVazio);
    const b = await boasVindas(p);
    ok(b.visivel === 'Olá! ' + textos.padrao, 'planos vazio: usa o padrão do config');
    await p.context().close();
  }

  console.log('\n[4] Conversa já iniciada noutra página: o histórico abre com a saudação geral');
  {
    // Identidade válida, mas desconhecida do banco: o chat tenta retomar e volta ao formulário sem erro visível.
    const estado = JSON.stringify({ visitanteId: '11111111-2222-4333-8444-555555555555', token: 'a'.repeat(64), iniciada: true, ultimaVista: null });
    const p = await abrir(browser, 'blog/site-ou-instagram.html', configTeste, { estado });
    const b = await boasVindas(p);
    ok(b.contexto === 'padrao' && b.visivel === 'Olá! ' + textos.padrao, 'artigo com conversa em andamento: "' + b.visivel + '"');
    await p.context().close();
  }

  console.log('\n[5] Painel aberto: 4 larguras, rolagem, axe e área visível');
  for (const largura of [320, 375, 768, 1280]) {
    for (const caminho of ['planos.html', 'blog/o-que-um-site-profissional-precisa-ter.html']) {
      const p = await abrir(browser, caminho, configTeste, { contexto: { viewport: { width: largura, height: 740 } } });
      await p.click('.chat__lancador');
      await p.waitForSelector('#chat-painel:not([hidden])');
      const bolha = await p.locator('.chat__bolha--boas-vindas').boundingBox();
      const painel = await p.locator('#chat-painel').boundingBox();
      ok(bolha && painel && bolha.x >= painel.x - 1 && bolha.x + bolha.width <= painel.x + painel.width + 1, `${largura}px ${caminho}: bolha dentro do painel`);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      ok(sw <= largura, `${largura}px ${caminho}: sem rolagem horizontal (${sw})`);
      const v = await axe(p, '#chat-painel');
      ok(v.length === 0, `${largura}px ${caminho}: axe no painel` + (v.length ? ': ' + v.join(', ') : ''));
      ok(p.erros.length === 0, `${largura}px ${caminho}: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
      if (largura === 375 || largura === 1280) {
        const nome = caminho.startsWith('blog') ? 'artigo' : 'planos';
        await p.screenshot({ path: `${SAIDA}/chat-boas-vindas-${nome}-${largura}.png` });
      }
      await p.context().close();
    }
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
