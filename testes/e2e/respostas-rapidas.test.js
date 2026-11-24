// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o chat.test.js)
// Respostas rápidas no chat do admin (item 7 do MELHORIAS.md): inserem no cursor sem enviar, {nome},
// padrões com preços/prazos do config.js, editor em <dialog> acessível, salvo no localStorage do admin.
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
const RAIZ = require('path').resolve(__dirname, '../..');
fs.mkdirSync(SAIDA, { recursive: true });

const configOriginal = fs.readFileSync(RAIZ + '/config.js', 'utf8');
// Aponta o site para o servidor falso (troca url/anonKey, sejam quais forem no config.js real).
const comSupabase = (cfg, url, chave) => cfg
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${url}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${chave}'`);
const configSemSupabase = comSupabase(configOriginal, '', '');
const configTeste = comSupabase(configOriginal, API, ANON)
  .replace("whatsapp: '', // [PROVISÓRIO]", "whatsapp: '5511999999999', //")
  // atendimento sempre aberto, exceto quando o teste fixa a hora
  .replace("{ dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' },", "{ dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '23:59' },");
if (!configTeste.includes(API) || configSemSupabase.includes('supabase.co')) throw new Error('substituição do config falhou');

function psql(sql) {
  return execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
}
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function novaPagina(browser, opcoes, configJs) {
  const ctx = await browser.newContext(opcoes);
  const p = await ctx.newPage();
  // a abertura de marca tem teste próprio (movimento.test.js); aqui ela é marcada como já vista
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  // axe servido como arquivo da mesma origem (a CSP das páginas bloqueia scripts inline)
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js*', (r) => r.fulfill({ body: configJs || configTeste, contentType: 'application/javascript' }));
  // Mesmo arquivo do CDN (conferido byte a byte com cmp); o SRI do <script> continua sendo verificado.
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  // Conta sons tocados
  await p.addInitScript(() => {
    window.__sons = 0;
    const C = window.AudioContext;
    if (C) {
      const orig = C.prototype.createOscillator;
      C.prototype.createOscillator = function () { window.__sons++; return orig.call(this); };
    }
  });
  return p;
}


async function axe(p, rotulo, alvo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async (alvo) => (await axe.run(alvo || document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), alvo);
  ok(v.length === 0, `axe sem violações (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}

async function visitante(browser, nome, texto) {
  const v = await novaPagina(browser, { viewport: { width: 1280, height: 800 } });
  await v.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  await v.click('.chat__lancador');
  if (nome) await v.fill('#chat-nome', nome);
  await v.fill('#chat-texto', texto);
  await v.press('#chat-texto', 'Enter');
  await v.waitForSelector('.chat__bolha--visitante');
  await v.context().close();
}

async function entrar(browser, largura) {
  const a = await novaPagina(browser, { viewport: { width: largura, height: 800 } });
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.waitForSelector('.admin-item');
  return a;
}
async function abrirConversa(a, trecho) {
  await a.locator('.admin-item', { hasText: trecho }).first().click();
  await a.waitForSelector('[data-rapidas]:not([hidden]) .admin-rapidas__botao');
}
const caixa = (a) => a.inputValue('[data-resposta-texto]');

(async () => {
  psql("truncate public.mensagens, public.conversas cascade; delete from realtime.enviados;");
  const browser = await chromium.launch();
  await visitante(browser, '', 'Oi, quanto custa?');
  await visitante(browser, 'Maria Teste', 'Quero um site para minha confeitaria');
  const enviadas = () => psql("select count(*) from public.mensagens where autor = 'admin'");

  console.log('\n[1] Padrões e inserção (1280 px)');
  const a = await entrar(browser, 1280);
  await abrirConversa(a, 'Maria Teste');
  const botoes = await a.$$eval('.admin-rapidas__botao', (bs) => bs.map((b) => b.textContent));
  ok(botoes.join() === 'Saudação,Preços,Prazos,Pedir WhatsApp,Encerrar', 'modelos padrão: ' + botoes.join(', '));
  ok(await a.getAttribute('[data-rapidas-lista]', 'role') === 'group' && !!(await a.getAttribute('[data-rapidas-lista]', 'aria-label')), 'grupo com rótulo acessível');
  await a.click('.admin-rapidas__botao >> text=Saudação');
  ok((await caixa(a)).startsWith('Olá, Maria! Obrigado'), '{nome} vira o primeiro nome: ' + (await caixa(a)).slice(0, 30));
  ok(await a.evaluate(() => document.activeElement.hasAttribute('data-resposta-texto')), 'foco volta para a caixa de resposta');
  await a.waitForTimeout(400);
  ok(await enviadas() === '0', 'inserir NÃO envia');
  await a.fill('[data-resposta-texto]', 'Oi');
  await a.click('.admin-rapidas__botao >> text=Preços');
  const precos = await a.evaluate(() => PBR_CONFIG.planos.map((p) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(p.precoCentavos / 100)));
  const t = await caixa(a);
  ok(t.startsWith('Oi Nossos planos') && precos.every((p) => t.includes(p)) && t.includes('planos.html#comparativo'), 'insere depois do texto, com os preços do config.js');
  await a.evaluate(() => { const x = document.querySelector('[data-resposta-texto]'); x.setSelectionRange(0, 2); });
  await a.click('.admin-rapidas__botao >> text=Prazos');
  ok((await caixa(a)).startsWith('Os prazos contam') && (await caixa(a)).includes('dias úteis') && !(await caixa(a)).includes('Oi Nossos'), 'substitui o trecho selecionado');
  await a.press('[data-resposta-texto]', 'Enter');
  await a.waitForSelector('.admin-msg--admin');
  ok(await enviadas() === '1', 'Enter envia normalmente o texto montado');

  await abrirConversa(a, 'Visitante');
  await a.fill('[data-resposta-texto]', '');
  await a.click('.admin-rapidas__botao >> text=Encerrar');
  ok((await caixa(a)).startsWith('Fico à disposição! Se'), 'sem nome: {nome} some sem deixar vírgula: ' + (await caixa(a)).slice(0, 25));
  await axe(a, 'conversa com respostas rápidas');

  console.log('\n[2] Editor (<dialog>)');
  await a.click('[data-rapidas-editar]');
  ok(await a.locator('[data-rapidas-dialogo]').isVisible() && await a.evaluate(() => document.querySelector('[data-rapidas-dialogo]').matches(':modal')), 'abre como modal');
  ok(await a.locator('[data-rapida-item]').count() === 5, '5 itens editáveis');
  await axe(a, 'editor aberto', '[data-rapidas-dialogo]');
  await a.click('[data-rapidas-adicionar]');
  ok(await a.evaluate(() => document.activeElement.matches('[data-rapida-item]:last-child input')), 'adicionar: foco no novo título');
  await a.keyboard.type('Horário');
  await a.click('[data-rapidas-dialogo] button[type=submit]');
  ok((await a.textContent('[data-rapidas-erro]')).includes('Preencha') && await a.locator('[data-rapidas-dialogo]').isVisible(), 'item incompleto: erro e o editor continua aberto');
  await a.fill('[data-rapida-item]:last-child textarea', 'Atendemos de segunda a sexta, {nome}.');
  await a.click('[data-rapida-item]:nth-child(2) [data-rapida-remover]');
  ok(await a.getAttribute('[data-rapida-item]:nth-child(2) [data-rapida-remover]', 'aria-label') === 'Remover a resposta Prazos', 'botão remover com nome do item');
  await a.click('[data-rapidas-dialogo] button[type=submit]');
  ok(await a.locator('[data-rapidas-dialogo]').isHidden(), 'salvar fecha o editor');
  ok(await a.evaluate(() => document.activeElement.hasAttribute('data-rapidas-editar')), 'foco volta para "Editar respostas"');
  const nomes = await a.$$eval('.admin-rapidas__botao', (bs) => bs.map((b) => b.textContent));
  ok(nomes.join() === 'Saudação,Prazos,Pedir WhatsApp,Encerrar,Horário', 'lista atualizada: ' + nomes.join(', '));
  const salvo = await a.evaluate(() => JSON.parse(localStorage.getItem('pbr_admin_respostas_v1')));
  ok(Array.isArray(salvo) && salvo.length === 5 && salvo[4].texto.includes('{nome}'), 'salvo no localStorage com o marcador {nome}');

  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('.admin-item');
  await abrirConversa(a, 'Maria Teste');
  ok((await a.$$eval('.admin-rapidas__botao', (bs) => bs.map((b) => b.textContent))).includes('Horário'), 'continua após recarregar');
  await a.fill('[data-resposta-texto]', '');
  await a.click('.admin-rapidas__botao >> text=Horário');
  ok(await caixa(a) === 'Atendemos de segunda a sexta, Maria.', 'modelo novo com {nome}');

  await a.click('[data-rapidas-editar]');
  await a.keyboard.press('Escape');
  ok(await a.locator('[data-rapidas-dialogo]').isHidden() && await a.evaluate(() => document.activeElement.hasAttribute('data-rapidas-editar')), 'Esc fecha e devolve o foco');
  await a.click('[data-rapidas-editar]');
  await a.click('[data-rapidas-restaurar]');
  await a.click('[data-rapidas-dialogo] button[type=submit]');
  ok((await a.$$eval('.admin-rapidas__botao', (bs) => bs.map((b) => b.textContent))).join() === 'Saudação,Preços,Prazos,Pedir WhatsApp,Encerrar', 'restaurar padrões');
  ok(a.erros.length === 0, 'console limpo' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[3] Larguras');
  for (const w of [320, 375, 768, 1280]) {
    const p = await entrar(browser, w);
    await abrirConversa(p, 'Maria Teste');
    ok(await p.locator('.admin-rapidas__botao').first().isVisible(), `${w}px: respostas rápidas à vista`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px: sem rolagem horizontal`);
    ok(await p.evaluate(() => { const r = document.querySelector('[data-form-resposta]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; }), `${w}px: caixa de resposta inteira na tela`);
    await p.click('[data-rapidas-editar]');
    ok(await p.evaluate(() => { const r = document.querySelector('[data-rapidas-dialogo]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), `${w}px: editor cabe na tela`);
    await p.keyboard.press('Escape');
    ok(await p.evaluate(() => [...document.querySelectorAll('*')].every((el) => el.scrollLeft === 0 || el.matches('.admin-rapidas__lista'))), `${w}px: nada rolou para o lado ao devolver o foco`);
    ok(p.erros.length === 0, `${w}px: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    if (process.env.SHOT && w === 375) await p.screenshot({ path: process.env.SHOT });
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DAS RESPOSTAS RÁPIDAS PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
