// Uso: veja testes/README.md (servidor estático em :8080 e Supabase falso em :54321)
// "Tirar dúvida no chat" em cada plano (item 120 do MELHORIAS.md):
// - home (cartões) e planos.html (resumo do plano marcado): botão que abre o chat com "Tenho uma dúvida sobre o
//   plano X" no campo, editável e nunca enviado sozinho; o foco vai para o campo da mensagem;
// - funciona no primeiro clique, antes de o widget ser montado; não apaga o que o visitante já escreveu;
// - data-origem-cta grava home/duvida-plano ou planos/duvida-plano, que segue na origem da conversa (chat_iniciar);
// - com WhatsApp configurado: no horário só o chat aparece; fora do horário, o link do WhatsApp no lugar;
// - sem rolagem lateral, axe sem violações sérias, alvo ≥ 24 px e console limpo em 320, 375, 768 e 1280 px.
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
const configSem = original
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
const configCom = configSem.replace("whatsapp: '', // [PROVISÓRIO]", `whatsapp: '${NUMERO}', //`);
if (configCom === configSem) throw new Error('substituição do WhatsApp no config falhou');

const NO_HORARIO = new Date('2026-11-24T17:00:00Z'); // terça, 14:00 em São Paulo
const FORA = new Date('2026-11-22T06:00:00Z'); // domingo, 03:00 em São Paulo

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } return cond; }

async function abrir(browser, caminho, cfg, opcoes = {}) {
  const ctx = await browser.newContext({ viewport: { width: opcoes.largura || 1280, height: 800 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = [];
  p.rpcs = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  p.on('request', (r) => { if (r.url().includes('/rest/v1/rpc/chat_')) p.rpcs.push({ nome: r.url().split('/rpc/')[1], corpo: r.postData() || '' }); });
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route('**/config.js*', (r) => r.fulfill({ body: cfg, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  await p.clock.setFixedTime(opcoes.relogio || NO_HORARIO);
  await p.goto(new URL(caminho, BASE).href, { waitUntil: opcoes.espera || 'networkidle' });
  return p;
}

async function axe(p) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.impact} ${v.id}`));
}

const ctaSalvo = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('pbr_origem_cta_v1')).de; } catch (e) { return ''; } });
const estadoChat = (p) => p.evaluate(() => {
  const t = document.getElementById('chat-texto');
  return {
    aberto: !!document.querySelector('#chat-painel:not([hidden])'),
    valor: t ? t.value : null,
    foco: document.activeElement && document.activeElement.id
  };
});

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Home, no horário, sem WhatsApp (config real): um botão por plano, primeiro clique antes de montar o chat');
  {
    const p = await abrir(browser, 'index.html', configSem, { espera: 'domcontentloaded' });
    const botoes = p.locator('[data-lista-planos] [data-duvida-chat]');
    const nomes = await p.$$eval('[data-lista-planos] > li', (lis) => lis.map((li) => ({
      plano: li.querySelector('.plano__nome').textContent,
      rotulo: (li.querySelector('[data-duvida-chat]') || {}).textContent || '',
      visivel: !!(li.querySelector('[data-duvida-chat]') || {}).offsetParent,
      cta: (li.querySelector('[data-duvida-chat]') || { getAttribute: () => '' }).getAttribute('data-origem-cta')
    })));
    ok(nomes.length >= 3 && nomes.every((n) => n.visivel), `${nomes.length} cartões, todos com o botão visível`);
    nomes.forEach((n) => ok(n.rotulo.replace(/\s+/g, ' ').trim() === `Tirar dúvida no chat sobre o plano ${n.plano}` && n.cta === 'home/duvida-plano',
      `${n.plano}: nome acessível "${n.rotulo.replace(/\s+/g, ' ').trim()}", cta ${n.cta}`));
    ok(await p.locator('[data-lista-planos] a[href^="https://wa.me/"]').count() === 0, 'sem número: nenhum link de WhatsApp');
    const montadoAntes = await p.evaluate(() => !!document.querySelector('[data-chat]'));
    const segundo = botoes.nth(1);
    await segundo.scrollIntoViewIfNeeded();
    await segundo.click();
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'chat-texto', null, { timeout: 5000 }).catch(() => {});
    let e = await estadoChat(p);
    console.log(`  · widget ${montadoAntes ? 'já montado' : 'ainda não montado'} no momento do clique`);
    ok(e.aberto && e.foco === 'chat-texto' && e.valor === `Tenho uma dúvida sobre o plano ${nomes[1].plano}`,
      `chat aberto, foco na mensagem: "${e.valor}" (foco: ${e.foco})`);
    ok(await ctaSalvo(p) === 'home/duvida-plano', 'origem do clique gravada: home/duvida-plano');
    await p.waitForTimeout(800);
    ok(!p.rpcs.some((r) => r.nome === 'chat_enviar' || r.nome === 'chat_iniciar'), 'nada foi enviado sozinho');

    // O visitante edita; outro plano não apaga o texto dele
    await p.fill('#chat-texto', 'Minha pergunta própria');
    await p.keyboard.press('Escape');
    await botoes.nth(0).scrollIntoViewIfNeeded();
    await botoes.nth(0).click();
    e = await estadoChat(p);
    ok(e.valor === 'Minha pergunta própria' && e.foco === 'chat-texto', 'texto já escrito é mantido: ' + e.valor);

    // Enviar de verdade (pelo visitante): a origem segue na conversa
    await p.fill('#chat-texto', `Tenho uma dúvida sobre o plano ${nomes[1].plano}: o domínio está incluso?`);
    await p.keyboard.press('Enter');
    await p.waitForSelector('.chat__bolha--visitante', { timeout: 8000 }).catch(() => {});
    const iniciar = p.rpcs.find((r) => r.nome === 'chat_iniciar');
    ok(iniciar && /cta: home\/duvida-plano/.test(JSON.parse(iniciar.corpo).p_pagina || ''), 'chat_iniciar leva "cta: home/duvida-plano": ' + (iniciar ? JSON.parse(iniciar.corpo).p_pagina : '—'));
    ok(await p.locator('.chat__bolha--visitante').count() === 1, 'mensagem enviada só quando o visitante mandou');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[2] Teclado e leitor de tela (375 px): Tab até o botão, Enter, foco no campo do chat');
  {
    const p = await abrir(browser, 'index.html', configSem, { largura: 375 });
    const alvo = p.locator('[data-lista-planos] [data-duvida-chat]').first();
    await alvo.scrollIntoViewIfNeeded();
    await alvo.focus();
    const visivelFoco = await alvo.evaluate((b) => getComputedStyle(b).outlineStyle !== 'none' || getComputedStyle(b).boxShadow !== 'none');
    ok(visivelFoco, 'foco visível no botão');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'chat-texto', null, { timeout: 5000 }).catch(() => {});
    const e = await estadoChat(p);
    ok(e.foco === 'chat-texto' && /^Tenho uma dúvida sobre o plano /.test(e.valor), 'Enter abre o chat com a mensagem e o foco no campo');
    const nome = await p.evaluate(() => {
      const t = document.getElementById('chat-texto');
      return document.querySelector('label[for="chat-texto"]').textContent + ' | ' + t.selectionStart + '/' + t.value.length;
    });
    ok(/^Sua mensagem \| (\d+)\/\1$/.test(nome), 'campo rotulado "Sua mensagem", cursor no fim: ' + nome);
    await p.keyboard.press('Escape');
    ok(await p.evaluate(() => document.querySelector('.chat__lancador') === document.activeElement), 'Esc fecha e devolve o foco ao botão do chat');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[3] planos.html: o resumo acompanha o plano marcado');
  {
    const p = await abrir(browser, 'planos.html?plano=essencial', configSem);
    const botao = p.locator('[data-resumo-plano] [data-duvida-chat]');
    ok(await botao.isVisible() && (await botao.getAttribute('data-duvida-chat')) === 'Essencial', 'resumo: botão do Essencial');
    ok(await botao.getAttribute('data-origem-cta') === 'planos/duvida-plano', 'cta planos/duvida-plano');
    await p.check('input[name="plano"][value="premium"]');
    ok(await botao.getAttribute('data-duvida-chat') === 'Premium', 'trocou o plano → botão do Premium');
    await botao.click();
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'chat-texto', null, { timeout: 5000 }).catch(() => {});
    const e = await estadoChat(p);
    ok(e.valor === 'Tenho uma dúvida sobre o plano Premium' && e.foco === 'chat-texto', 'chat com a mensagem do Premium');
    ok(await ctaSalvo(p) === 'planos/duvida-plano', 'origem gravada: planos/duvida-plano');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[4] Com WhatsApp: no horário só o chat; fora do horário, o WhatsApp no lugar');
  for (const [nome, relogio, caminho] of [['no horário', NO_HORARIO, 'index.html'], ['fora do horário', FORA, 'index.html'],
    ['no horário', NO_HORARIO, 'planos.html?plano=essencial'], ['fora do horário', FORA, 'planos.html?plano=essencial']]) {
    const p = await abrir(browser, caminho, configCom, { relogio });
    const caixas = await p.$$eval('[data-duvida]', (cs) => cs.map((c) => ({
      chat: !!(c.querySelector('[data-duvida-chat]') || {}).offsetParent,
      zap: !!(c.querySelector('[data-duvida-whats]') || {}).offsetParent,
      texto: decodeURIComponent(new URL((c.querySelector('[data-duvida-whats]') || { href: 'https://x/' }).href).searchParams.get('text') || '')
    })));
    const fora = relogio === FORA;
    ok(caixas.length > 0 && caixas.every((c) => c.chat === !fora && c.zap === fora), `${caminho} ${nome}: ${fora ? 'WhatsApp' : 'chat'} visível em ${caixas.length} caixa(s)`);
    if (fora) ok(caixas.every((c) => /plano /.test(c.texto)), 'mensagem do WhatsApp com o plano: ' + caixas[0].texto);
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[5] 4 larguras: rolagem, alvo de toque, axe (home e planos)');
  for (const largura of [320, 375, 768, 1280]) {
    for (const caminho of ['index.html', 'planos.html?plano=essencial']) {
      const p = await abrir(browser, caminho, configSem, { largura });
      const b = p.locator('[data-duvida-chat]').first();
      await b.scrollIntoViewIfNeeded();
      await p.waitForTimeout(400);
      const caixa = await b.boundingBox();
      ok(caixa && caixa.height >= 24 && caixa.width >= 24, `${caminho} ${largura}px: alvo ${caixa ? Math.round(caixa.width) + '×' + Math.round(caixa.height) : '—'}`);
      const rolagem = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(rolagem <= 0, `${caminho} ${largura}px: sem rolagem lateral (${rolagem})`);
      const v = await axe(p);
      ok(v.length === 0, `${caminho} ${largura}px: axe ${v.join(', ') || 'ok'}`);
      if (largura === 375 || largura === 1280) {
        await p.locator('[data-duvida]').first().screenshot({ path: `${SAIDA}/duvida-plano-${caminho.replace(/\W.*/, '')}-${largura}.png` });
      }
      ok(p.erros.length === 0, `${caminho} ${largura}px: console limpo` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
      await p.context().close();
    }
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
