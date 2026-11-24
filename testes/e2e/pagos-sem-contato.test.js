// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o exportar.test.js)
// Pedidos pagos sem contato do dono (item 51 do MELHORIAS.md): filtro "Sem contato" (aprovados nos últimos 30 dias, site
// não entregue, sem resposta do dono no chat de uma conversa com o mesmo WhatsApp — com ou sem 55 — e sem WhatsApp aberto
// pelo painel), etiqueta na lista, boas-vindas editável com wa.me sem envio automático, "Já falei com este cliente",
// tempo real quando o dono responde no chat, falha da consulta sem alarme falso, nada gravado no banco; 4 larguras + axe.
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

const textos = (a, s) => a.$$eval(s, (els) => els.map((e) => e.textContent.trim()));


(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, whatsapp, status) values
      (gen_random_uuid(), '${hash('a')}', 'Igor', '5511922223333', 'aberta'),
      (gen_random_uuid(), '${hash('b')}', 'Joana', '11933334444', 'aberta');
    insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Olá' from public.conversas;
    insert into public.mensagens (conversa_id, autor, texto) select id, 'admin', 'Oi Igor!' from public.conversas where nome = 'Igor';
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em) values
      ('PBR-HHHHH2', '${hash('c')}', 'profissional', 'Profissional', 99700, 'Helena Nova', 'helena@teste.local', '11911112222', now(), 'aprovado', now() - interval '3 hours', now() - interval '2 hours'),
      ('PBR-JJJJJ3', '${hash('d')}', 'essencial', 'Essencial', 49700, 'Joana Visitante', 'joana@teste.local', '11933334444', now(), 'aprovado', now() - interval '6 hours', now() - interval '5 hours'),
      ('PBR-NNNNN4', '${hash('e')}', 'essencial', 'Essencial', 49700, 'Nina Ligação', 'nina@teste.local', '11955556666', now(), 'aprovado', now() - interval '2 hours', now() - interval '1 hour'),
      ('PBR-KKKKK5', '${hash('f')}', 'essencial', 'Essencial', 49700, 'Igor Respondido', 'igor@teste.local', '11922223333', now(), 'aprovado', now() - interval '4 hours', now() - interval '3 hours'),
      ('PBR-LLLLL6', '${hash('9')}', 'essencial', 'Essencial', 49700, 'Lia Entregue', 'lia@teste.local', '11966667777', now(), 'aprovado', now() - interval '6 days', now() - interval '6 days'),
      ('PBR-MMMMM7', '${hash('8')}', 'essencial', 'Essencial', 49700, 'Mauro Antigo', 'mauro@teste.local', '11977778888', now(), 'aprovado', now() - interval '41 days', now() - interval '40 days'),
      ('PBR-PPPPP8', '${hash('7')}', 'essencial', 'Essencial', 49700, 'Paulo Pendente', 'paulo@teste.local', '11988889999', now(), 'pendente', now() - interval '10 minutes', null);
    insert into public.briefings (pedido_id, nome_negocio) select id, 'Loja da Lia' from public.pedidos where codigo = 'PBR-LLLLL6';
    update public.briefings set status = 'entregue';
    insert into public.briefings (pedido_id, nome_negocio) select id, 'Doces da Joana' from public.pedidos where codigo = 'PBR-JJJJJ3';
  `);
  const adminAntes = psql(`select count(*) from public.mensagens where autor = 'admin'`);

  const browser = await chromium.launch();

  console.log('\n[1] Filtro "Sem contato" e etiqueta na lista (1280 px)');
  const a = await entrar(browser, 1280);
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  await a.waitForFunction(() => document.querySelector('[data-filtro-pedido="sem-contato"]').textContent === 'Sem contato (3)');
  ok(true, 'contador: Helena, Joana (só mensagem do visitante) e Nina');
  const tags = await a.$$eval('.admin-item__tag--contato', (els) => els.map((e) => e.closest('.admin-item').querySelector('.admin-item__nome').textContent));
  ok(tags.length === 3 && tags.every((n) => /PBR-HHHHH2|PBR-JJJJJ3|PBR-NNNNN4/.test(n)), 'etiqueta "sem contato" só nos três: ' + tags.join(','));
  ok((await a.textContent('[data-selo-aba="pedidos"]')) === '2', 'selo da aba não muda (1 pendente + 1 sem briefing há +24 h)');
  const reg = await (await fetch(API + '/__registro')).json();
  const consulta = reg.filter((x) => x.consulta === 'conversas-whatsapp').pop();
  ok(consulta && consulta.autor === 'admin' && consulta.numeros.includes('11911112222') && consulta.numeros.includes('5511911112222'),
    'uma consulta com o número com e sem 55, só mensagens do dono');
  ok(consulta && !consulta.numeros.includes('11977778888') && !consulta.numeros.includes('11988889999'), 'não consulta pago há +30 dias nem pendente');
  await a.click('[data-filtro-pedido="sem-contato"]');
  ok((await a.getAttribute('[data-filtro-pedido="sem-contato"]', 'aria-pressed')) === 'true', 'botão com aria-pressed');
  ok((await textos(a, '[data-lista-pedidos] .admin-item__nome')).length === 3, 'filtro mostra só os três');

  console.log('\n[2] Detalhe: boas-vindas editável, wa.me sem envio automático');
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-HHHHH2")');
  await a.waitForSelector('[data-recuperar][data-modo="boas-vindas"]:not([hidden])');
  ok((await a.textContent('[data-recuperar-titulo]')) === 'Cliente ainda sem mensagem sua', 'título');
  ok(/^Pago há (1[12]\d min|2 h)\./.test(await a.textContent('[data-recuperar-texto]')), 'texto com o tempo desde o pagamento');
  const msg = await a.inputValue('[data-recuperar-mensagem]');
  ok(msg.startsWith('Olá, Helena! Aqui é da Portfólio BR.') && msg.includes('PBR-HHHHH2') && msg.includes('plano Profissional'), 'mensagem com nome, código e plano');
  ok(msg.includes('pedido.html?pedido=PBR-HHHHH2') && !/#c=|[?&]t=|token/i.test(msg) && !/R\$/.test(msg), 'link de acompanhamento sem token e sem valor');
  ok(await a.isVisible('[data-recuperar-contatado]'), 'botão "Já falei com este cliente" visível');
  const href = await a.getAttribute('[data-recuperar-link]', 'href');
  ok(href.startsWith('https://wa.me/5511911112222?text=') && decodeURIComponent(href.split('text=')[1]) === msg, 'link wa.me com o texto');
  await a.fill('[data-recuperar-mensagem]', 'Oi Helena! Bem-vinda');
  ok(decodeURIComponent((await a.getAttribute('[data-recuperar-link]', 'href')).split('text=')[1]) === 'Oi Helena! Bem-vinda', 'editar atualiza o link');
  await a.click('[data-recuperar-padrao]');
  ok((await a.inputValue('[data-recuperar-mensagem]')) === msg, '"Restaurar mensagem" volta às boas-vindas');
  await axe(a, 'detalhe sem contato');
  await a.screenshot({ path: SAIDA + '/sem-contato-1280.png' });
  const [popup] = await Promise.all([a.context().waitForEvent('page'), a.click('[data-recuperar-link]')]);
  await popup.close().catch(() => {});
  ok(/^Você abriu o WhatsApp para este cliente em /.test(await a.textContent('[data-recuperar-chamado]')), 'registra o contato (role=status)');
  ok(await a.isVisible('[data-recuperar][data-modo="boas-vindas"]'), 'bloco continua aberto enquanto o pedido está na tela');
  ok((await a.textContent('[data-filtro-pedido="sem-contato"]')) === 'Sem contato (2)', 'contador cai para 2');
  const salvo = await a.evaluate(() => localStorage.getItem('pbr-admin-boas-vindas'));
  ok(salvo && !salvo.includes('Helena') && !salvo.includes('11911'), 'localStorage guarda só id e data');

  console.log('\n[3] Briefing já recebido: a mensagem não pede o briefing');
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-JJJJJ3")');
  await a.waitForSelector('[data-recuperar][data-pedido*="boas-vindas"]:not([hidden])');
  await a.waitForFunction(() => /Joana/.test(document.querySelector('[data-recuperar-mensagem]').value));
  const msgJ = await a.inputValue('[data-recuperar-mensagem]');
  ok(msgJ.includes('Já recebemos o seu briefing') && !msgJ.includes('pedido.html'), 'boas-vindas sem pedir o briefing');

  console.log('\n[4] O dono responde no chat: o aviso some (tempo real)');
  psql(`insert into public.mensagens (conversa_id, autor, texto) select id, 'admin', 'Oi Joana!' from public.conversas where nome = 'Joana';`);
  await a.waitForFunction(() => document.querySelector('[data-filtro-pedido="sem-contato"]').textContent === 'Sem contato (1)', null, { timeout: 35000 });
  ok(true, 'contador cai para 1 sem recarregar a página');
  await a.waitForSelector('[data-recuperar]', { state: 'hidden' });
  ok(true, 'bloco some do pedido aberto');

  console.log('\n[5] "Já falei com este cliente" (contato por outro caminho)');
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-NNNNN4")');
  await a.waitForSelector('[data-recuperar][data-modo="boas-vindas"]:not([hidden])');
  await a.click('[data-recuperar-contatado]');
  ok(/^Marcado como já contatado em /.test(await a.textContent('[data-recuperar-chamado]')), 'aviso em role=status');
  ok(await a.isHidden('[data-recuperar-contatado]'), 'botão some depois de marcar');
  ok((await a.evaluate(() => document.activeElement.id)) === 'recuperar-mensagem', 'foco vai para a mensagem (não se perde)');
  ok((await a.textContent('[data-filtro-pedido="sem-contato"]')) === 'Sem contato (0)', 'contador zera');
  ok(await a.isVisible('[data-pedidos-vazio]'), 'lista filtrada vazia mostra o aviso de lista vazia');

  console.log('\n[6] Sem aviso para quem não precisa');
  await a.click('[data-filtro-pedido="todos"]');
  for (const cod of ['PBR-KKKKK5', 'PBR-LLLLL6', 'PBR-MMMMM7']) {
    await a.click(`[data-lista-pedidos] .admin-item:has-text("${cod}")`);
    await a.waitForFunction((c) => document.querySelector('[data-pedido-titulo]').textContent.startsWith(c), cod);
    ok(!(await a.isVisible('[data-recuperar][data-modo="boas-vindas"]')), cod + ': sem boas-vindas');
  }
  ok(psql(`select count(*) from public.mensagens where autor = 'admin'`) === String(Number(adminAntes) + 1), 'nada enviado pelo sistema (só a resposta do teste)');
  ok(!(await (await fetch(API + '/__registro')).json()).some((x) => x.insert || (x.patch && x.patch !== 'conversas')), 'nenhuma escrita no banco pelo painel');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[7] Consulta das conversas falha: nada de alarme falso');
  const f = await novaPagina(browser, { viewport: { width: 1280, height: 800 } });
  await f.route(/\/rest\/v1\/conversas\?.*whatsapp=in/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"falha"}' }));
  await f.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await f.evaluate(() => localStorage.clear());
  await f.fill('#login-email', 'dono@teste.local');
  await f.fill('#login-senha', 'senha-de-teste');
  await f.click('[data-form-login] button[type=submit]');
  await f.waitForSelector('[data-tela="painel"]:not([hidden])');
  await f.click('[data-aba-link="pedidos"]');
  await f.waitForSelector('[data-lista-pedidos] .admin-item');
  await f.waitForFunction(() => /\(\d+\)/.test(document.querySelector('[data-filtro-pedido="todos"]').textContent));
  ok((await f.textContent('[data-filtro-pedido="sem-contato"]')) === 'Sem contato (0)' && (await f.$$('.admin-item__tag--contato')).length === 0, 'sem etiquetas quando não dá para saber');
  ok((await f.$$('[data-lista-pedidos] .admin-item')).length === 7, 'a lista de pedidos continua aparecendo');
  await f.context().close();

  console.log('\n[8] Larguras 320, 375 e 768 px');
  psql(`insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em) values
    ('PBR-QQQQQ9', '${hash('6')}', 'premium', 'Premium', 179700, 'Quitéria de Albuquerque Nascimento', 'q@teste.local', '11912345678', now(), 'aprovado', now() - interval '2 hours', now() - interval '90 minutes');`);
  for (const w of [320, 375, 768]) {
    const p = await entrar(browser, w);
    await p.click('[data-aba-link="pedidos"]');
    await p.waitForSelector('[data-lista-pedidos] .admin-item');
    // Contexto novo: o "chamado"/"já falei" das etapas anteriores ficou no outro navegador (Helena, Nina e Quitéria).
    await p.waitForFunction(() => document.querySelector('[data-filtro-pedido="sem-contato"]').textContent === 'Sem contato (3)');
    await p.click('[data-filtro-pedido="sem-contato"]');
    await p.screenshot({ path: SAIDA + `/sem-contato-lista-${w}.png`, fullPage: true });
    await p.click('[data-lista-pedidos] .admin-item:has-text("PBR-QQQQQ9")');
    await p.waitForSelector('[data-recuperar][data-modo="boas-vindas"]:not([hidden])');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px sem rolagem horizontal (${sw})`);
    await axe(p, `${w}px detalhe`);
    await p.screenshot({ path: SAIDA + `/sem-contato-${w}.png`, fullPage: true });
    ok(p.erros.length === 0, `${w}px console sem erros` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
