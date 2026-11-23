// Uso: veja testes/README.md (precisa do Supabase falso e do servidor estático)
// Melhoria 36 — acessibilidade do chat ao vivo com leitor de tela (árvore de acessibilidade do Playwright):
// ordem de foco ao abrir/fechar, Tab preso no painel em tela cheia (celular), Esc fecha e devolve o foco,
// rótulos dos campos opcionais, aria-live só para mensagens novas do atendente (nunca o histórico nem as
// mensagens do próprio visitante), axe e console limpo.
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const AXE = require.resolve('axe-core/axe.min.js');
const RAIZ = require('path').resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

const configOriginal = fs.readFileSync(RAIZ + '/config.js', 'utf8');
const configTeste = configOriginal
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`)
  .replace("{ dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' },", "{ dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '23:59' },");
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

function psql(sql) {
  return execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
}
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  // Registra tudo o que passa pela região aria-live do chat (o que o leitor de tela anunciaria)
  await p.addInitScript(() => {
    window.__anuncios = [];
    new MutationObserver(() => {
      const a = document.querySelector('[data-chat-anuncio]');
      if (a && a.textContent && window.__anuncios[window.__anuncios.length - 1] !== a.textContent) window.__anuncios.push(a.textContent);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return p;
}

async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias/críticas (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}

const focoNoPainel = (p) => p.evaluate(() => !!document.activeElement.closest('#chat-painel'));
const idFoco = (p) => p.evaluate(() => document.activeElement.id || document.activeElement.className);

(async () => {
  psql('truncate public.mensagens, public.conversas cascade; delete from realtime.enviados;');
  const browser = await chromium.launch();

  // ============================================================ celular
  console.log('\n[1] Celular 375px: abrir pelo teclado, rótulos, Tab preso no painel em tela cheia');
  const v = await novaPagina(browser, { viewport: { width: 375, height: 740 } });
  await v.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  await v.evaluate(() => window.scrollTo(0, 1200));
  await v.focus('.chat__lancador');
  ok((await v.locator('.chat__lancador').getAttribute('aria-expanded')) === 'false', 'botão começa com aria-expanded=false');
  ok(await v.getByRole('button', { name: 'Abrir chat' }).count() === 1, 'botão flutuante com nome acessível "Abrir chat"');
  await v.keyboard.press('Enter');
  await v.waitForSelector('#chat-painel:not([hidden])');
  ok(await idFoco(v) === 'chat-nome', 'Enter abre e o foco vai para o primeiro campo (nome)');
  ok((await v.getAttribute('#chat-painel', 'aria-modal')) === 'true', 'em tela cheia o painel é diálogo modal');

  const arvore = await v.locator('#chat-painel').ariaSnapshot();
  fs.writeFileSync(SAIDA + '/chat-arvore-celular.txt', arvore);
  ok(/dialog "Portfólio BR"/.test(arvore), 'árvore: diálogo com o nome "Portfólio BR"');
  ok(/textbox "Seu nome \(opcional\)"/.test(arvore), 'árvore: campo "Seu nome (opcional)"');
  ok(/textbox "Seu WhatsApp \(opcional\)"/.test(arvore), 'árvore: campo "Seu WhatsApp (opcional)"');
  ok(/textbox "Sua mensagem"/.test(arvore), 'árvore: campo "Sua mensagem"');
  ok(/button "Fechar chat"/.test(arvore) && /button "Iniciar conversa"/.test(arvore), 'árvore: botões "Fechar chat" e "Iniciar conversa"');
  ok(/region "Mensagens da conversa"/.test(arvore), 'árvore: histórico como região rotulada');
  ok(!/👋/.test(arvore), 'emoji decorativo da saudação fica fora da árvore');

  const descricoes = await v.evaluate(() => ['chat-nome', 'chat-whatsapp'].map((id) =>
    (document.getElementById(id).getAttribute('aria-describedby') || '').split(' ').map((d) => document.getElementById(d) ? 'ok' : 'falta:' + d).join(',')));
  ok(descricoes.every((d) => d && !d.includes('falta')), 'campos opcionais descritos pela dica e pelo aviso de privacidade: ' + descricoes.join(' | '));

  const vivas = await v.evaluate(() => [...document.querySelectorAll('[data-chat] [aria-live], [data-chat] [role="log"], [data-chat] [role="status"]')].map((x) => x.getAttribute('data-chat-anuncio') !== null ? 'anuncio' : x.className));
  ok(vivas.length === 1 && vivas[0] === 'anuncio', 'uma só região aria-live no widget (o anúncio), histórico não é região viva: ' + vivas.join(','));

  // Tab circula dentro do painel
  let sempreDentro = true;
  const vistos = new Set();
  for (let i = 0; i < 14; i++) { await v.keyboard.press('Tab'); vistos.add(await idFoco(v)); if (!(await focoNoPainel(v))) sempreDentro = false; }
  ok(sempreDentro, 'Tab nunca sai do painel em tela cheia (' + vistos.size + ' alvos percorridos)');
  await v.focus('.chat__fechar');
  await v.keyboard.press('Shift+Tab');
  ok(await focoNoPainel(v), 'Shift+Tab no primeiro item volta para o último do painel');
  await axe(v, 'painel aberto no celular');
  await v.screenshot({ path: SAIDA + '/chat-acessivel-375.png' });

  // Esc fecha e devolve o foco
  await v.focus('#chat-texto');
  await v.keyboard.press('Escape');
  ok(await v.locator('#chat-painel').isHidden(), 'Esc fecha o painel');
  ok(await v.evaluate(() => document.activeElement.classList.contains('chat__lancador')), 'Esc devolve o foco ao botão flutuante');
  ok((await v.locator('.chat__lancador').getAttribute('aria-expanded')) === 'false', 'aria-expanded volta a false');

  // Envio: a mensagem do próprio visitante não é anunciada
  await v.keyboard.press('Enter');
  await v.fill('#chat-nome', 'Ana Acessível');
  await v.fill('#chat-whatsapp', '12');
  await v.fill('#chat-texto', 'Oi, uso leitor de tela.');
  await v.press('#chat-texto', 'Enter');
  ok(await idFoco(v) === 'chat-whatsapp', 'WhatsApp inválido: foco volta ao campo');
  ok((await v.getAttribute('#chat-whatsapp', 'aria-invalid')) === 'true' &&
    (await v.getAttribute('#chat-whatsapp', 'aria-describedby')).split(' ')[0] === 'chat-erro', 'campo inválido marcado e descrito pelo erro');
  await v.fill('#chat-whatsapp', '');
  await v.fill('#chat-texto', 'Oi, uso leitor de tela.');
  await v.press('#chat-texto', 'Enter');
  await v.waitForSelector('.chat__bolha--visitante');
  ok(!(await v.getAttribute('#chat-whatsapp', 'aria-invalid')), 'erro corrigido: aria-invalid removido');
  await v.waitForTimeout(600);
  ok((await v.evaluate(() => window.__anuncios)).length === 0, 'mensagem do próprio visitante não é anunciada');

  // ============================================================ admin responde
  console.log('\n[2] Resposta do atendente é anunciada (painel aberto e fechado)');
  const a = await novaPagina(browser, { viewport: { width: 1280, height: 800 } });
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('.admin-item');
  await a.click('.admin-item');
  await a.waitForSelector('.admin-msg--visitante');
  async function responder(texto) {
    await a.fill('[data-resposta-texto]', texto);
    await a.press('[data-resposta-texto]', 'Enter');
    await a.waitForFunction((t) => [...document.querySelectorAll('.admin-msg--admin')].some((x) => x.textContent.includes(t)), texto);
  }
  await responder('Olá Ana! Como podemos ajudar?');
  await v.waitForFunction(() => window.__anuncios.length > 0, null, { timeout: 6000 }).catch(() => {});
  let anuncios = await v.evaluate(() => window.__anuncios);
  ok(anuncios.length === 1 && anuncios[0] === 'Nova mensagem da Portfólio BR: Olá Ana! Como podemos ajudar?', 'resposta nova anunciada uma vez: ' + JSON.stringify(anuncios));

  await v.keyboard.press('Escape');
  ok(await v.evaluate(() => document.activeElement.classList.contains('chat__lancador')), 'Esc com conversa iniciada devolve o foco ao botão');
  await responder('Pode me mandar o Instagram da loja?');
  await v.waitForFunction(() => window.__anuncios.length > 1, null, { timeout: 6000 }).catch(() => {});
  anuncios = await v.evaluate(() => window.__anuncios);
  ok(anuncios[1] === 'Nova mensagem da Portfólio BR: Pode me mandar o Instagram da loja?', 'com o chat fechado a resposta também é anunciada');
  ok(/1 nova mensagem/.test(await v.locator('.chat__lancador').textContent()), 'botão fechado informa a nova mensagem no nome acessível');

  // ============================================================ recarga: histórico não é relido
  console.log('\n[3] Recarregar: o histórico não é anunciado de novo');
  await v.reload({ waitUntil: 'networkidle' });
  await v.evaluate(() => window.scrollTo(0, 1200));
  await v.click('.chat__lancador');
  await v.waitForFunction(() => document.querySelectorAll('.chat__lista .chat__bolha').length >= 3, null, { timeout: 6000 });
  ok(await idFoco(v) === 'chat-texto', 'conversa já iniciada: foco vai direto para a mensagem');
  await v.waitForTimeout(800);
  ok((await v.evaluate(() => window.__anuncios)).length === 0, 'histórico restaurado sem anúncio');
  await responder('Estamos por aqui.');
  await v.waitForFunction(() => window.__anuncios.length > 0, null, { timeout: 6000 }).catch(() => {});
  ok((await v.evaluate(() => window.__anuncios))[0] === 'Nova mensagem da Portfólio BR: Estamos por aqui.', 'depois do histórico, resposta nova volta a ser anunciada');
  await axe(v, 'conversa com histórico (celular)');

  // ============================================================ desktop
  console.log('\n[4] Computador 1280px: janela não modal, Tab segue para a página, Esc não rouba o foco de fora');
  const d = await novaPagina(browser, { viewport: { width: 1280, height: 800 } });
  await d.goto(SITE, { waitUntil: 'networkidle' });
  await d.click('.chat__lancador');
  await d.waitForSelector('#chat-painel:not([hidden])');
  ok((await d.getAttribute('#chat-painel', 'aria-modal')) === 'false', 'no computador o painel não é modal');
  await d.focus('.chat__enviar');
  await d.keyboard.press('Tab');
  ok(await d.evaluate(() => document.activeElement.classList.contains('chat__lancador')), 'Tab depois do último item vai para o botão do chat (sem prender)');
  await d.focus('a.cabecalho__marca, header a');
  await d.keyboard.press('Escape');
  ok(await d.locator('#chat-painel').isVisible(), 'Esc com o foco na página não fecha o chat nem rouba o foco');
  await d.focus('#chat-nome');
  await d.keyboard.press('Escape');
  ok(await d.locator('#chat-painel').isHidden() && await d.evaluate(() => document.activeElement.classList.contains('chat__lancador')), 'Esc dentro do chat fecha e devolve o foco');
  await d.click('.chat__lancador');
  await axe(d, 'painel aberto no computador');
  await d.screenshot({ path: SAIDA + '/chat-acessivel-1280.png' });

  console.log('\n[5] Console');
  for (const [n, p] of [['celular', v], ['computador', d], ['admin', a]]) {
    ok(p.erros.length === 0, 'console limpo (' + n + ')' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
  }

  await browser.close();
  psql('truncate public.mensagens, public.conversas cascade; delete from realtime.enviados;');
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE ACESSIBILIDADE DO CHAT PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
