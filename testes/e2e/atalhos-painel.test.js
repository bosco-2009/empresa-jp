// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o chat.test.js)
// Atalhos de teclado do painel (item 41 do MELHORIAS.md): g c/p/b/r, "/", j/k, "?" com <dialog>, desligados em
// campos de texto e por preferência (WCAG 2.1.4), 4 larguras + axe.
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
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Sao_Paulo' }, opcoes));
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


const textos = (a, s) => a.$$eval(s, (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, whatsapp, pagina_origem, status) values
      (gen_random_uuid(), '${hash('a')}', 'Joana Araújo', null, '/', 'aberta'),
      (gen_random_uuid(), '${hash('b')}', null, '11988887777', '/planos.html', 'fechada'),
      (gen_random_uuid(), '${hash('c')}', 'Carlos', null, '/', 'aberta');
    insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante',
      case when nome = 'Carlos' then 'Quero uma loja virtual com catálogo de bolos e encomendas pelo WhatsApp, dá para fazer?' else 'Olá, tudo bem?' end
      from public.conversas;
    update public.conversas set status = 'fechada' where whatsapp = '11988887777';
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status) values
      ('PBR-JNAAA2', '${hash('e')}', 'essencial', 'Essencial', 49700, 'Joana Araújo', 'joana@teste.local', '11999990000', now(), 'aprovado'),
      ('PBR-PEDRA3', '${hash('f')}', 'profissional', 'Profissional', 99700, 'Pedro Lima', 'pedro@teste.local', '21977776666', now(), 'pendente');
    insert into public.briefings (pedido_id, nome_negocio, status) select id, 'Doceria da Joana', 'entregue' from public.pedidos where codigo = 'PBR-JNAAA2';
  `);

  const browser = await chromium.launch();
  const codigo = fs.readFileSync(RAIZ + '/assets/js/admin-atalhos.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok(!/\bfetch\(|\.from\(|\.rpc\(|PBRSupabase|XMLHttpRequest|innerHTML/.test(codigo), 'admin-atalhos.js sem consultas ao banco nem innerHTML');

  const ativo = (a) => a.evaluate(() => {
    const e = document.activeElement;
    return e.id || e.getAttribute('data-id') || e.tagName;
  });

  console.log('\n[1] g + letra troca de aba (1280 px)');
  const a = await entrar(browser, 1280);
  await a.waitForFunction(() => document.querySelector('[data-lista-briefings] .admin-item') && document.querySelector('[data-lista-pedidos] .admin-item'));
  ok(await a.isVisible('[data-atalhos-abrir]'), 'botão do teclado visível no desktop');
  await a.evaluate(() => document.activeElement.blur());
  for (const [tecla, hash, aba] of [['p', '#pedidos', 'pedidos'], ['b', '#briefings', 'briefings'], ['r', '#resumo', 'resumo'], ['c', '#conversas', 'conversas']]) {
    await a.keyboard.press('g');
    await a.keyboard.press(tecla);
    await a.waitForFunction((h) => location.hash === h, hash);
    ok(await a.waitForSelector(`[data-aba="${aba}"]:not([hidden])`, { timeout: 2000 }).then(() => true, () => false), `g ${tecla} → ${hash}`);
  }
  await a.keyboard.press('g');
  await a.waitForTimeout(1700);
  await a.keyboard.press('p');
  ok(await a.evaluate(() => location.hash === '#conversas'), 'g esquecido por mais de 1,5 s não troca de aba');

  console.log('\n[2] "/" foca a busca certa; atalhos não disparam digitando');
  await a.keyboard.press('/');
  ok((await ativo(a)) === 'busca-global', '"/" em Conversas foca a busca geral');
  await a.keyboard.type('gp');
  ok(await a.evaluate(() => location.hash === '#conversas' && document.querySelector('#busca-global').value === 'gp'), 'digitando "gp" no campo não troca de aba');
  await a.keyboard.press('Escape');
  await a.fill('#busca-global', '');
  await a.evaluate(() => document.activeElement.blur());
  await a.keyboard.press('g'); await a.keyboard.press('p');
  await a.waitForFunction(() => location.hash === '#pedidos');
  await a.keyboard.press('/');
  ok(await a.waitForFunction(() => document.activeElement.id === 'busca-pedidos', null, { timeout: 2000 }).then(() => true, () => false), '"/" logo depois de "g p" foca a busca da aba Pedidos');
  await a.keyboard.type('j/');
  ok(await a.evaluate(() => document.querySelector('#busca-pedidos').value === 'j/'), 'j e / viram texto dentro do campo');
  await a.fill('#busca-pedidos', '');
  await a.evaluate(() => document.activeElement.blur());

  console.log('\n[3] j/k andam na lista; Enter abre');
  const ids = await a.$$eval('[data-lista-pedidos] .admin-item', (b) => b.map((x) => x.dataset.id));
  ok(ids.length === 2, 'dois pedidos na lista');
  await a.keyboard.press('j');
  ok((await ativo(a)) === ids[0], 'j sem foco na lista → primeiro');
  await a.keyboard.press('j');
  ok((await ativo(a)) === ids[1], 'j → segundo');
  await a.keyboard.press('j');
  ok((await ativo(a)) === ids[1], 'j no último fica no último');
  await a.keyboard.press('k');
  ok((await ativo(a)) === ids[0], 'k → anterior');
  ok(await a.evaluate(() => document.activeElement.matches(':focus-visible')), 'foco visível no item');
  psql(`update public.pedidos set nome = 'Pedro Lima Souza' where codigo = 'PBR-PEDRA3';`);
  await a.waitForFunction(() => /Pedro Lima Souza/.test(document.querySelector('[data-lista-pedidos]').textContent), null, { timeout: 10000 });
  ok(await a.waitForFunction((id) => document.activeElement.getAttribute('data-id') === id, ids[0], { timeout: 2000 }).then(() => true, () => false), 'lista redesenhada pelo tempo real: foco continua no mesmo item');
  await a.keyboard.press('Enter');
  await a.waitForFunction((id) => document.querySelector(`[data-lista-pedidos] [data-id="${id}"][aria-current="true"]`), ids[0]);
  ok(true, 'Enter abre o pedido');
  await a.evaluate(() => document.activeElement.blur());
  await a.keyboard.press('k');
  ok((await ativo(a)) === ids[0], 'sem foco na lista, k começa pelo item aberto');

  console.log('\n[4] "?" abre a lista de atalhos; Esc fecha e devolve o foco');
  await a.keyboard.press('Shift+?');
  await a.waitForSelector('[data-atalhos-dialogo][open]');
  ok(true, '"?" abre o diálogo');
  await a.screenshot({ path: SAIDA + '/atalhos-1280.png' });
  await axe(a, 'diálogo 1280');
  await a.keyboard.press('g'); await a.keyboard.press('c');
  ok(await a.evaluate(() => location.hash === '#pedidos'), 'com o diálogo aberto os atalhos não agem');
  await a.keyboard.press('Escape');
  ok(await a.evaluate(() => !document.querySelector('[data-atalhos-dialogo]').open), 'Esc fecha');
  ok(await a.waitForFunction((id) => document.activeElement.getAttribute('data-id') === id, ids[0], { timeout: 2000 }).then(() => true, () => false), 'foco volta para onde estava');

  console.log('\n[5] Desligar os atalhos de uma tecla (WCAG 2.1.4), lembrado no navegador');
  await a.click('[data-atalhos-abrir]');
  await a.waitForSelector('[data-atalhos-dialogo][open]');
  await a.uncheck('[data-atalhos-ligados]');
  await a.waitForFunction(() => /desligados/.test(document.querySelector('[data-atalhos-status]').textContent));
  ok(true, 'status anuncia: ' + (await a.textContent('[data-atalhos-status]')));
  await a.click('[data-atalhos-fechar]');
  ok((await ativo(a)) === 'BUTTON' || (await a.evaluate(() => document.activeElement.matches('[data-atalhos-abrir]'))), 'Fechar devolve o foco ao botão');
  await a.keyboard.press('g'); await a.keyboard.press('c');
  await a.keyboard.press('Shift+?');
  ok(await a.evaluate(() => location.hash === '#pedidos' && !document.querySelector('[data-atalhos-dialogo]').open), 'desligados: g c e ? não fazem nada');
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  ok(await a.evaluate(() => !document.querySelector('[data-atalhos-ligados]').checked), 'preferência lembrada depois de recarregar');
  await a.click('[data-atalhos-abrir]');
  await a.check('[data-atalhos-ligados]');
  await a.click('[data-atalhos-fechar]');
  await a.keyboard.press('g'); await a.keyboard.press('b');
  await a.waitForFunction(() => location.hash === '#briefings');
  ok(true, 'religados: g b funciona');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ' -> ' + a.erros.join(' | ') : ''));
  await a.close();

  console.log('\n[6] Larguras: sem rolagem horizontal, diálogo cabe, axe');
  for (const w of [320, 375, 768, 1280]) {
    const p = await entrar(browser, w);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw === w, `${w}px: scrollWidth ${sw}`);
    if (w < 768) ok(await p.isHidden('[data-atalhos-abrir]'), `${w}px: botão do teclado oculto no celular`);
    await p.evaluate(() => document.activeElement.blur());
    await p.keyboard.press('Shift+?');
    await p.waitForSelector('[data-atalhos-dialogo][open]');
    const cabe = await p.$eval('[data-atalhos-dialogo]', (n) => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && n.scrollWidth <= n.clientWidth; });
    ok(cabe, `${w}px: diálogo dentro da tela, sem rolagem lateral`);
    await p.screenshot({ path: SAIDA + `/atalhos-${w}.png` });
    await axe(p, 'diálogo ' + w);
    ok(p.erros.length === 0, `${w}px: console sem erros` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.close();
  }

  await browser.close();
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade;`);
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
