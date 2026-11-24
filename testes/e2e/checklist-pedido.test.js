// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o pagos-sem-contato.test.js)
// Lista de verificação por pedido (item 66 do MELHORIAS.md): checkbox nativos no detalhe de pedidos aprovados
// (briefing recebido, domínio, primeira versão, ajustes, publicado), data de cada marcação, contagem "N de 5" no
// cartão da lista, salvo só no localStorage do admin (id + datas, nada do cliente), nada gravado no banco,
// teclado (espaço), aviso em role=status, falha do armazenamento sem perder o estado, 4 larguras + axe.
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
  const ctx = await browser.newContext(opcoes);
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
  await p.mouse.move(0, 0);
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}

async function entrar(browser, largura, ctxOpcoes) {
  const a = await novaPagina(browser, Object.assign({ viewport: { width: largura, height: 800 } }, ctxOpcoes));
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  return a;
}

const tagDe = (a, cod) => a.$eval(`[data-lista-pedidos] .admin-item:has-text("${cod}")`, (b) => {
  const t = [...b.querySelectorAll('.admin-item__tag')].find((x) => / de 5$/.test(x.textContent));
  return t ? { texto: t.textContent, ok: t.classList.contains('admin-item__tag--ok') } : null;
});

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  psql(`
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em) values
      ('PBR-RRRRR2', '${hash('a')}', 'profissional', 'Profissional', 99700, 'Ana Aprovada', 'ana@teste.local', '11911112222', now(), 'aprovado', now() - interval '3 days', now() - interval '3 days'),
      ('PBR-SSSSS3', '${hash('b')}', 'essencial', 'Essencial', 49700, 'Bruno Briefing', 'bruno@teste.local', '11933334444', now(), 'aprovado', now() - interval '2 days', now() - interval '2 days'),
      ('PBR-TTTTT4', '${hash('c')}', 'essencial', 'Essencial', 49700, 'Carla Pendente', 'carla@teste.local', '11955556666', now(), 'pendente', now() - interval '10 minutes', null),
      ('PBR-WWWWW5', '${hash('d')}', 'premium', 'Premium', 179700, 'Quitéria de Albuquerque Nascimento', 'q@teste.local', '11912345678', now(), 'aprovado', now() - interval '1 day', now() - interval '1 day');
    insert into public.briefings (pedido_id, nome_negocio) select id, 'Oficina do Bruno' from public.pedidos where codigo = 'PBR-SSSSS3';
  `);
  const registroAntes = (await (await fetch(API + '/__registro')).json()).length;
  const browser = await chromium.launch();

  console.log('\n[1] Lista: contagem "etapas 0 de 5" só nos aprovados');
  const a = await entrar(browser, 1280);
  ok((await tagDe(a, 'PBR-RRRRR2'))?.texto === 'etapas 0 de 5', 'aprovado sem marcações mostra 0 de 5');
  ok((await tagDe(a, 'PBR-TTTTT4')) === null, 'pendente não tem lista de verificação');

  console.log('\n[2] Detalhe: checkbox nativos, rótulos e dica');
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-TTTTT4")');
  await a.waitForFunction(() => document.querySelector('[data-pedido-titulo]').textContent.startsWith('PBR-TTTTT4'));
  ok(await a.isHidden('[data-checklist]'), 'pendente: bloco escondido');
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-RRRRR2")');
  await a.waitForSelector('[data-checklist]:not([hidden])');
  const rotulos = await a.$$eval('[data-checklist] input[type=checkbox]', (els) => els.map((e) => e.labels[0].textContent));
  ok(rotulos.join('|') === 'Briefing recebido|Domínio|Primeira versão|Ajustes|Publicado', 'cinco itens com label: ' + rotulos.join(', '));
  ok((await a.textContent('[data-checklist-conta]')) === '0 de 5 concluídas', 'contagem no detalhe');
  ok((await a.textContent('[data-checklist-data="briefing"]')) === '', 'sem briefing pelo site: sem dica');

  console.log('\n[3] Marcar com o mouse e com o teclado');
  await a.click('label[for="checklist-dominio"]');
  ok(await a.isChecked('#checklist-dominio'), 'clicar no rótulo marca');
  ok(/^em \d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}$/.test(await a.textContent('[data-checklist-data="dominio"]')), 'data da marcação: ' + await a.textContent('[data-checklist-data="dominio"]'));
  ok((await a.textContent('[data-checklist-aviso]')) === 'Marcado: Domínio. 1 de 5 concluídas.', 'aviso em role=status');
  ok((await a.getAttribute('[data-checklist-aviso]', 'role')) === 'status', 'aviso é role=status');
  await a.focus('#checklist-versao');
  await a.keyboard.press('Space');
  ok(await a.isChecked('#checklist-versao'), 'espaço marca pelo teclado');
  await a.keyboard.press('Tab');
  ok((await a.evaluate(() => document.activeElement.id)) === 'checklist-ajustes', 'Tab vai para o próximo item');
  await a.keyboard.press('Space');
  ok((await tagDe(a, 'PBR-RRRRR2'))?.texto === 'etapas 3 de 5', 'cartão da lista atualiza: 3 de 5');
  ok((await a.evaluate(() => document.activeElement.id)) === 'checklist-ajustes', 'foco continua no item depois de marcar');
  await a.keyboard.press('Space');
  ok(!(await a.isChecked('#checklist-ajustes')) && (await a.textContent('[data-checklist-data="ajustes"]')) === '', 'desmarcar apaga a data');
  ok((await a.textContent('[data-checklist-aviso]')) === 'Desmarcado: Ajustes. 2 de 5 concluídas.', 'aviso de desmarcar');
  const salvo = await a.evaluate(() => localStorage.getItem('pbr-admin-checklist'));
  const obj = JSON.parse(salvo);
  const ids = Object.keys(obj);
  ok(ids.length === 1 && Object.keys(obj[ids[0]]).sort().join() === 'dominio,versao', 'localStorage: só id e itens marcados');
  ok(!/Ana|11911|ana@|PBR-/.test(salvo), 'nenhum dado do cliente no localStorage');

  console.log('\n[4] Completo e persistência');
  for (const k of ['briefing', 'ajustes', 'publicado']) await a.check('#checklist-' + k);
  ok((await a.textContent('[data-checklist-conta]')) === '5 de 5 concluídas', '5 de 5 no detalhe');
  const t = await tagDe(a, 'PBR-RRRRR2');
  ok(t?.texto === 'etapas 5 de 5' && t.ok, 'cartão 5 de 5 com estilo de concluído');
  await axe(a, 'detalhe com lista 1280');
  await a.screenshot({ path: SAIDA + '/checklist-1280.png' });
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  ok((await tagDe(a, 'PBR-RRRRR2'))?.texto === 'etapas 5 de 5', 'continua depois de recarregar');

  console.log('\n[5] Briefing que chegou pelo site: dica, sem marcar sozinho');
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-SSSSS3")');
  await a.waitForFunction(() => document.querySelector('[data-pedido-titulo]').textContent.startsWith('PBR-SSSSS3'));
  ok(!(await a.isChecked('#checklist-briefing')), 'não marca sozinho');
  ok((await a.textContent('[data-checklist-data="briefing"]')) === 'o briefing já chegou pelo site', 'dica do briefing recebido');
  ok((await a.textContent('[data-checklist-aviso]')) === '', 'aviso limpo ao trocar de pedido');

  console.log('\n[6] Outra aba do painel acompanha (evento storage)');
  const b = await a.context().newPage();
  b.erros = [];
  b.on('pageerror', (e) => b.erros.push(e.message));
  await b.route('**/config.js', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await b.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript'
  }));
  await b.goto(SITE + 'admin/#pedidos', { waitUntil: 'networkidle' });
  await b.waitForSelector('[data-lista-pedidos] .admin-item:has-text("PBR-SSSSS3")');
  await b.click('[data-lista-pedidos] .admin-item:has-text("PBR-SSSSS3")');
  await b.waitForSelector('[data-checklist]:not([hidden])');
  await b.check('#checklist-briefing');
  await a.waitForFunction(() => document.querySelector('#checklist-briefing').checked, null, { timeout: 5000 });
  ok((await tagDe(a, 'PBR-SSSSS3'))?.texto === 'etapas 1 de 5', 'a primeira aba atualiza o detalhe e o cartão');
  await b.close();

  console.log('\n[7] Nada no banco');
  ok(!(await (await fetch(API + '/__registro')).json()).slice(registroAntes).some((x) => x.insert || x.patch), 'nenhuma escrita no banco pelo painel');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[8] Armazenamento bloqueado: avisa e não finge que salvou');
  const f = await entrar(browser, 1280);
  await f.click('[data-lista-pedidos] .admin-item:has-text("PBR-WWWWW5")');
  await f.waitForSelector('[data-checklist]:not([hidden])');
  await f.evaluate(() => { Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); }; });
  await f.click('label[for="checklist-dominio"]');
  ok(!(await f.isChecked('#checklist-dominio')), 'checkbox volta ao estado salvo');
  ok(/^Não foi possível salvar/.test(await f.textContent('[data-checklist-aviso]')), 'aviso acessível do erro');
  await f.context().close();

  console.log('\n[9] Larguras 320, 375 e 768 px');
  for (const w of [320, 375, 768]) {
    const p = await entrar(browser, w);
    await p.click('[data-lista-pedidos] .admin-item:has-text("PBR-WWWWW5")');
    await p.waitForSelector('[data-checklist]:not([hidden])');
    await p.check('#checklist-dominio');
    await p.check('#checklist-versao');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px sem rolagem horizontal (${sw})`);
    const alvo = await p.$eval('.admin-checklist__item', (e) => e.getBoundingClientRect().height);
    ok(alvo >= 44, `${w}px linha do item com alvo de toque confortável (${Math.round(alvo)} px)`);
    await axe(p, `${w}px detalhe`);
    await p.locator('[data-checklist]').scrollIntoViewIfNeeded();
    await p.screenshot({ path: SAIDA + `/checklist-${w}.png` });
    ok(p.erros.length === 0, `${w}px console sem erros` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
