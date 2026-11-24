// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o exportar.test.js)
// Lembrete de briefing pendente (item 34 do MELHORIAS.md): filtro "Sem briefing" (aprovados há mais de 24 h sem briefing),
// contador no selo da aba, mensagem pronta com o link de acompanhamento SEM o token, wa.me sem envio automático,
// registro local de "lembrado", some quando o briefing chega; 4 larguras + axe.
// Melhoria 56: botão "Copiar link do briefing" (briefing.html?pedido=, sem token) com aviso em role=status.
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
const configTeste = configOriginal
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

function psql(sql) {
  return execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
}
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, opcoes) {
  const ctx = await browser.newContext(Object.assign({ acceptDownloads: true }, opcoes));
  const p = await ctx.newPage();
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  return p;
}

async function axe(p, rotulo) {
  await p.mouse.move(0, 0); // ponteiro parado sobre um botão em transição de hover confunde o cálculo de contraste
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}

async function entrar(browser, largura) {
  const a = await novaPagina(browser, { viewport: { width: largura, height: 800 } });
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.waitForSelector('[data-lista-conversas] .admin-item');
  return a;
}

async function baixar(a, seletor) {
  const [d] = await Promise.all([a.waitForEvent('download'), a.click(seletor)]);
  const caminho = SAIDA + '/' + d.suggestedFilename();
  await d.saveAs(caminho);
  return { nome: d.suggestedFilename(), texto: fs.readFileSync(caminho, 'utf8') };
}
const linhasCsv = (t) => t.replace(/^﻿/, '').trim().split('\r\n');
const textos = (a, s) => a.$$eval(s, (els) => els.map((e) => e.textContent.trim()));


(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, status) values (gen_random_uuid(), '${hash('a')}', 'Ana', 'aberta');
    insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Olá' from public.conversas;
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em) values
      ('PBR-EEEEE5', '${hash('e')}', 'profissional', 'Profissional', 99700, 'Elisa Prado', 'elisa@teste.local', '11944443333', now(), 'aprovado', now() - interval '31 hours', now() - interval '30 hours'),
      ('PBR-FFFFF6', '${hash('f')}', 'essencial', 'Essencial', 49700, 'Fabio Com Briefing', 'fabio@teste.local', '11933332222', now(), 'aprovado', now() - interval '50 hours', now() - interval '49 hours'),
      ('PBR-DDDDD4', '${hash('d')}', 'essencial', 'Essencial', 49700, 'Dora Recente', 'dora@teste.local', '11955554444', now(), 'aprovado', now() - interval '5 hours', now() - interval '4 hours'),
      ('PBR-GGGGG7', '${hash('9')}', 'essencial', 'Essencial', 49700, 'Gil Antigo', 'gil@teste.local', '11922221111', now(), 'aprovado', now() - interval '80 hours', now() - interval '72 hours'),
      ('PBR-CCCCC3', '${hash('c')}', 'essencial', 'Essencial', 49700, 'Caio Pendente', 'caio@teste.local', '11966665555', now(), 'pendente', now() - interval '10 minutes', null);
    insert into public.briefings (pedido_id, nome_negocio) select id, 'Loja do Fabio' from public.pedidos where codigo = 'PBR-FFFFF6';
  `);

  const browser = await chromium.launch();

  console.log('\n[1] Filtro "Sem briefing", etiqueta e selo da aba (1280 px)');
  const a = await entrar(browser, 1280);
  await a.waitForFunction(() => document.querySelector('[data-selo-aba="pedidos"]').textContent !== '');
  ok((await a.textContent('[data-selo-aba="pedidos"]')) === '3', 'selo: 1 pendente + 2 sem briefing há +24 h');
  ok(/sem briefing há mais de 24 h/.test(await a.getAttribute('[data-selo-aba="pedidos"]', 'title')), 'title do selo explica a soma');
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  ok((await a.textContent('[data-filtro-pedido="sem-briefing"]')) === 'Sem briefing (2)', 'contador: só aprovados há +24 h sem briefing');
  const tags = await textos(a, '.admin-item__tag--aviso');
  ok(tags.length === 2 && tags.includes('sem briefing · 30 h') && tags.includes('sem briefing · 3 dias'), 'etiqueta com o tempo: ' + tags.join(','));
  ok((await textos(a, '.admin-item__tag')).filter((t) => t === 'sem briefing').length === 1, 'pago há 4 h: etiqueta simples, sem alerta');
  await a.click('[data-filtro-pedido="sem-briefing"]');
  ok((await a.getAttribute('[data-filtro-pedido="sem-briefing"]', 'aria-pressed')) === 'true', 'botão com aria-pressed');
  const nomes = await textos(a, '[data-lista-pedidos] .admin-item__nome');
  ok(nomes.length === 2 && nomes.every((n) => /PBR-EEEEE5|PBR-GGGGG7/.test(n)), 'filtro mostra só os atrasados: ' + nomes.join(','));

  console.log('\n[2] Detalhe: mensagem com o link de acompanhamento sem token');
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-EEEEE5")');
  await a.waitForSelector('[data-recuperar][data-modo="briefing"]:not([hidden])');
  ok((await a.textContent('[data-recuperar-titulo]')) === 'Briefing pendente', 'título "Briefing pendente"');
  ok(/^Pago há 30 h/.test(await a.textContent('[data-recuperar-texto]')), 'texto com o tempo desde o pagamento');
  const msg = await a.inputValue('[data-recuperar-mensagem]');
  ok(msg.startsWith('Olá, Elisa! Aqui é da Portfólio BR.') && msg.includes('PBR-EEEEE5') && msg.includes('plano Profissional'), 'mensagem com nome, código e plano');
  ok(msg.includes('pedido.html?pedido=PBR-EEEEE5') && !/#c=|[?&]t=|token/i.test(msg), 'link de acompanhamento sem o token');
  ok(!/R\$/.test(msg), 'sem valor na mensagem de briefing');
  let href = await a.getAttribute('[data-recuperar-link]', 'href');
  ok(href.startsWith('https://wa.me/5511944443333?text=') && decodeURIComponent(href.split('text=')[1]) === msg, 'link wa.me com o texto');
  await a.fill('[data-recuperar-mensagem]', 'Oi Elisa, lembrete do briefing');
  await a.click('[data-recuperar-padrao]');
  ok((await a.inputValue('[data-recuperar-mensagem]')) === msg, '"Restaurar mensagem" volta ao texto do briefing');
  // Melhoria 56: copiar o link do briefing (só o código, sem token), com aviso em role=status.
  ok(await a.isVisible('[data-briefing-link]'), 'bloco "Link do briefing" visível no modo briefing');
  const urlBriefing = await a.textContent('[data-briefing-link-url]');
  ok(urlBriefing === 'https://bosco-2009.github.io/empresa-jp/briefing.html?pedido=PBR-EEEEE5', 'link do briefing exibido: ' + urlBriefing);
  ok(!/#c=|[?&]t=|token/i.test(urlBriefing), 'link do briefing sem o token');
  await a.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(SITE).origin });
  await a.click('[data-briefing-copiar]');
  await a.waitForFunction(() => document.querySelector('[data-briefing-copiado]').textContent !== '');
  ok((await a.textContent('[data-briefing-copiado]')).startsWith('Link copiado'), 'aviso "Link copiado"');
  ok((await a.getAttribute('[data-briefing-copiado]', 'role')) === 'status', 'aviso com role=status');
  ok((await a.evaluate(() => navigator.clipboard.readText())) === urlBriefing, 'área de transferência com o link');
  ok(psql(`select count(*) from public.mensagens where autor <> 'visitante'`) === '0', 'copiar não envia nada');
  await axe(a, 'detalhe briefing pendente');
  await a.screenshot({ path: SAIDA + '/briefing-pendente-1280.png' });
  const [popup] = await Promise.all([a.context().waitForEvent('page'), a.click('[data-recuperar-link]')]);
  await popup.close().catch(() => {});
  ok(/^Você abriu o WhatsApp para este cliente em /.test(await a.textContent('[data-recuperar-chamado]')), 'registra o lembrete (role=status)');
  ok((await textos(a, '.admin-item__tag--aviso')).includes('sem briefing · lembrado'), 'etiqueta passa a "lembrado"');
  const salvo = await a.evaluate(() => localStorage.getItem('pbr-admin-lembrete-briefing'));
  ok(salvo && !salvo.includes('Elisa') && !salvo.includes('11944'), 'localStorage guarda só id e data');
  ok((await a.evaluate(() => localStorage.getItem('pbr-admin-recuperacao'))) === null, 'não mistura com o registro de checkout abandonado');
  ok(psql(`select count(*) from public.mensagens where autor <> 'visitante'`) === '0', 'nada enviado pelo sistema');

  console.log('\n[3] Com briefing ou pago há menos de 24 h: sem lembrete');
  await a.click('[data-filtro-pedido="todos"]');
  // Sem lembrete de briefing; como o dono ainda não falou com eles, o bloco é o de boas-vindas (melhoria 51).
  for (const cod of ['PBR-FFFFF6', 'PBR-DDDDD4']) {
    await a.click(`[data-lista-pedidos] .admin-item:has-text("${cod}")`);
    await a.waitForFunction((c) => document.querySelector('[data-pedido-titulo]').textContent.startsWith(c), cod);
    ok((await a.getAttribute('[data-recuperar]', 'data-modo')) === 'boas-vindas', cod + ': sem lembrete de briefing (só boas-vindas)');
    ok(!(await a.isVisible('[data-briefing-link]')), cod + ': sem o bloco "Link do briefing"');
  }

  console.log('\n[4] O briefing chega: o lembrete some (tempo real)');
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-EEEEE5")');
  await a.waitForSelector('[data-recuperar][data-modo="briefing"]:not([hidden])');
  psql(`insert into public.briefings (pedido_id, nome_negocio) select id, 'Ateliê da Elisa' from public.pedidos where codigo = 'PBR-EEEEE5';`);
  await a.waitForSelector('[data-recuperar]', { state: 'hidden', timeout: 35000 });
  ok(true, 'bloco some quando o briefing chega');
  await a.waitForFunction(() => document.querySelector('[data-filtro-pedido="sem-briefing"]').textContent === 'Sem briefing (1)');
  ok((await a.textContent('[data-selo-aba="pedidos"]')) === '2', 'selo cai para 2');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[5] Larguras 320, 375 e 768 px');
  for (const w of [320, 375, 768]) {
    const p = await entrar(browser, w);
    await p.click('[data-aba-link="pedidos"]');
    await p.waitForSelector('[data-lista-pedidos] .admin-item');
    await p.click('[data-filtro-pedido="sem-briefing"]');
    await p.click('[data-lista-pedidos] .admin-item');
    await p.waitForSelector('[data-recuperar]:not([hidden])');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px sem rolagem horizontal (${sw})`);
    await axe(p, `${w}px detalhe`);
    await p.screenshot({ path: SAIDA + `/briefing-pendente-${w}.png`, fullPage: true });
    ok(p.erros.length === 0, `${w}px console sem erros` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
