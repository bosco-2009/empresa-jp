// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o exportar.test.js)
// Recuperação de checkout abandonado (item 23 do MELHORIAS.md): filtro e etiqueta de pedidos pendentes há mais de 1 h,
// mensagem pronta editável, link wa.me sem envio automático, registro local de "chamado", 4 larguras + axe.
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
      ('PBR-BBBBB2', '${hash('b')}', 'profissional', 'Profissional', 99700, 'Bruna de Souza', 'bruna@teste.local', '11977776666', now(), 'pendente', now() - interval '3 hours', null),
      ('PBR-CCCCC3', '${hash('c')}', 'essencial', 'Essencial', 49700, 'Caio Novo', 'caio@teste.local', '11966665555', now(), 'pendente', now() - interval '10 minutes', null),
      ('PBR-DDDDD4', '${hash('d')}', 'essencial', 'Essencial', 49700, 'Dora Paga', 'dora@teste.local', '11955554444', now(), 'aprovado', now() - interval '5 hours', now() - interval '4 hours');
  `);

  const browser = await chromium.launch();

  console.log('\n[1] Filtro "Abandonados" e etiqueta na lista (1280 px)');
  const a = await entrar(browser, 1280);
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  ok((await a.textContent('[data-filtro-pedido="abandonado"]')) === 'Abandonados (1)', 'contador: só o pendente há mais de 1 h');
  ok((await a.textContent('[data-filtro-pedido="pendente"]')) === 'Pendentes (2)', 'pendentes continuam 2');
  const tags = await textos(a, '.admin-item__tag--alerta');
  ok(tags.length === 1 && /^abandonado · 3 h$/.test(tags[0]), 'etiqueta no item: ' + tags.join(','));
  await a.click('[data-filtro-pedido="abandonado"]');
  const nomes = await textos(a, '[data-lista-pedidos] .admin-item__nome');
  ok(nomes.length === 1 && nomes[0].startsWith('PBR-BBBBB2'), 'filtro mostra só o abandonado');

  console.log('\n[2] Detalhe: mensagem pronta e link do WhatsApp, sem envio automático');
  await a.click('[data-lista-pedidos] .admin-item');
  await a.waitForSelector('[data-recuperar]:not([hidden])');
  const msg = await a.inputValue('[data-recuperar-mensagem]');
  ok(msg.startsWith('Olá, Bruna! Aqui é da Portfólio BR.') && msg.includes('PBR-BBBBB2') && msg.includes('plano Profissional') && /R\$\s?997,00/.test(msg), 'mensagem com nome, código, plano e valor');
  ok(msg.includes('planos.html?plano=profissional'), 'mensagem com link para retomar o plano');
  let href = await a.getAttribute('[data-recuperar-link]', 'href');
  ok(href.startsWith('https://wa.me/5511977776666?text=') && decodeURIComponent(href.split('text=')[1]) === msg, 'link wa.me com o texto: ' + href.slice(0, 50));
  ok((await a.getAttribute('[data-recuperar-link]', 'rel')) === 'noopener', 'rel=noopener');
  await a.fill('[data-recuperar-mensagem]', 'Oi Bruna, tudo bem? & teste');
  href = await a.getAttribute('[data-recuperar-link]', 'href');
  ok(decodeURIComponent(href.split('text=')[1]) === 'Oi Bruna, tudo bem? & teste', 'editar a mensagem atualiza o link (com escape)');
  await a.click('[data-recuperar-padrao]');
  ok((await a.inputValue('[data-recuperar-mensagem]')) === msg, '"Restaurar mensagem" volta ao texto pronto');
  ok((await a.textContent('[data-recuperar-chamado]')) === '', 'ainda não chamado');
  await axe(a, 'detalhe abandonado');
  await a.screenshot({ path: SAIDA + '/recuperacao-1280.png' });
  const [popup] = await Promise.all([a.context().waitForEvent('page'), a.click('[data-recuperar-link]')]);
  await popup.close().catch(() => {});
  ok(/^Você abriu o WhatsApp para este cliente em /.test(await a.textContent('[data-recuperar-chamado]')), 'registra "chamado" (role=status)');
  ok((await textos(a, '.admin-item__tag--alerta'))[0] === 'abandonado · chamado', 'etiqueta passa a "chamado"');
  const salvo = await a.evaluate(() => localStorage.getItem('pbr-admin-recuperacao'));
  ok(salvo && !salvo.includes('Bruna') && !salvo.includes('11977'), 'localStorage guarda só id e data (sem dados do cliente)');
  const enviados = psql(`select count(*) from public.mensagens where autor <> 'visitante'`);
  ok(enviados === '0', 'nada enviado pelo sistema');

  console.log('\n[3] Pedido pendente recente e aprovado: sem bloco de recuperação');
  await a.click('[data-filtro-pedido="todos"]');
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-CCCCC3")');
  await a.waitForFunction(() => document.querySelector('[data-pedido-titulo]').textContent.startsWith('PBR-CCCCC3'));
  ok(await a.isHidden('[data-recuperar]'), 'PBR-CCCCC3: sem bloco');
  // Aprovado sem mensagem do dono: o bloco aparece como boas-vindas (melhoria 51), nunca como recuperação.
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-DDDDD4")');
  await a.waitForFunction(() => document.querySelector('[data-pedido-titulo]').textContent.startsWith('PBR-DDDDD4'));
  ok((await a.getAttribute('[data-recuperar]', 'data-modo')) === 'boas-vindas', 'PBR-DDDDD4: sem recuperação (só boas-vindas)');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[4] Larguras 320, 375 e 768 px');
  for (const w of [320, 375, 768]) {
    const p = await entrar(browser, w);
    await p.click('[data-aba-link="pedidos"]');
    await p.waitForSelector('[data-lista-pedidos] .admin-item');
    await p.click('[data-filtro-pedido="abandonado"]');
    await p.click('[data-lista-pedidos] .admin-item');
    await p.waitForSelector('[data-recuperar]:not([hidden])');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px sem rolagem horizontal (${sw})`);
    await axe(p, `${w}px detalhe`);
    await p.screenshot({ path: SAIDA + `/recuperacao-${w}.png`, fullPage: true });
    ok(p.erros.length === 0, `${w}px console sem erros` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
