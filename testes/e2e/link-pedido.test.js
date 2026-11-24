// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o pedidos-atrasados.test.js)
// Link direto para um pedido no painel (item 118 do MELHORIAS.md): "admin/#pedidos/<codigo>" abre o detalhe já no login,
// o endereço muda ao abrir/fechar um pedido (abrir da lista cria entrada no histórico; trocar de pedido só substitui),
// voltar/avançar do navegador seguem o endereço, código inexistente ou inválido mostra aviso em role="alert",
// pedido fora dos 50 carregados é buscado pelo código, e nada além do código vai para o endereço. 4 larguras, teclado, axe.
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

const configTeste = fs.readFileSync(RAIZ + '/config.js', 'utf8')
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
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
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

// Entra no painel já com um endereço (hash) e espera os pedidos carregarem.
async function entrar(browser, largura, hash) {
  const a = await novaPagina(browser, { viewport: { width: largura, height: 800 } });
  await a.goto(SITE + 'admin/' + (hash || ''), { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.waitForFunction(() => document.querySelectorAll('[data-lista-pedidos] .admin-item').length > 0);
  return a;
}

const titulo = (a) => a.$eval('[data-pedido-titulo]', (e) => e.textContent.trim());
const detalheVisivel = (a) => a.$eval('[data-pedido-detalhe]', (e) => !e.hidden && e.getClientRects().length > 0);
const aviso = (a) => a.$eval('[data-pedido-link-aviso]', (e) => e.textContent.trim());
const focoEm = (a) => a.evaluate(() => {
  const f = document.activeElement;
  return f ? (f.getAttribute('data-id') ? 'item:' + f.textContent.trim().slice(0, 10) : f.matches('[data-pedido-titulo]') ? 'titulo' : f.tagName) : '';
});
const esperarHash = (a, h) => a.waitForFunction((x) => location.hash === x, h, { timeout: 4000 }).then(() => true, () => false);

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  const pedido = (cod, h, nome, dias) =>
    `('${cod}', encode(sha256('${cod}'::bytea), 'hex'), 'essencial', 'Essencial', 49700, '${nome}', '${cod.toLowerCase()}@teste.local', '11911112222', now(), 'pendente', now() - interval '${dias} days')`;
  // 3 pedidos recentes + 50 de enchimento + 1 antigo, que fica fora da 1ª página (50) e só abre pela busca por código.
  const enchimento = Array.from({ length: 50 }, (_, i) => {
    const c = 'PBR-' + 'ENCH' + '23456789'[Math.floor(i / 8)] + '23456789'[i % 8];
    return pedido(c, 'e', 'Cliente ' + i, 3 + i / 100);
  });
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, status) values (gen_random_uuid(), '${hash('0')}', 'Visitante', 'aberta');
    insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Olá' from public.conversas;
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em) values
      ${pedido('PBR-AAAAA2', 'a', 'Ana Link', 0.1)},
      ${pedido('PBR-BBBBB2', 'b', 'Bruno Link', 0.2)},
      ${pedido('PBR-CCCCC3', 'c', 'Carla Link', 0.3)},
      ${enchimento.join(',\n')},
      ${pedido('PBR-VELH22', 'v', 'Vera Antiga', 90)};
  `);
  const browser = await chromium.launch();

  console.log('\n[1] Painel aberto já em #pedidos/<codigo> (1280 px)');
  const a = await entrar(browser, 1280, '#pedidos/PBR-CCCCC3');
  await a.waitForFunction(() => !document.querySelector('[data-pedido-detalhe]').hidden);
  ok(await a.$eval('[data-aba="pedidos"]', (e) => !e.hidden), 'aba Pedidos visível com #pedidos/<codigo>');
  ok(await a.$eval('[data-aba-link="pedidos"]', (e) => e.getAttribute('aria-current') === 'page'), 'link da aba Pedidos marcado como atual');
  ok((await titulo(a)).startsWith('PBR-CCCCC3'), 'detalhe do pedido do link aberto: ' + await titulo(a));
  ok(await focoEm(a) === 'titulo', 'foco no título do detalhe');
  ok(await aviso(a) === '', 'sem aviso');
  ok(await a.$eval('[data-pedido-link-aviso]', (e) => e.getBoundingClientRect().height === 0), 'aviso vazio não ocupa espaço');

  console.log('\n[2] Trocar de pedido pelo teclado substitui o endereço (sem entrada nova)');
  const comprimento0 = await a.evaluate(() => history.length);
  await a.focus('[data-lista-pedidos] li:nth-child(2) .admin-item');
  await a.keyboard.press('Enter');
  ok(await esperarHash(a, '#pedidos/PBR-BBBBB2'), 'Enter num item da lista → #pedidos/PBR-BBBBB2');
  ok((await titulo(a)).startsWith('PBR-BBBBB2'), 'detalhe do PBR-BBBBB2');
  ok(await a.evaluate(() => history.length) === comprimento0, 'trocar de pedido não cria entrada no histórico');
  ok(/^#pedidos\/PBR-[A-HJ-NP-Z2-9]{6}$/.test(await a.evaluate(() => location.hash)), 'endereço só com o código (sem nome, e-mail ou WhatsApp)');

  console.log('\n[3] Lista (#pedidos) → abrir cria entrada; voltar fecha, avançar reabre');
  await a.evaluate(() => { location.hash = '#pedidos'; });
  await a.waitForFunction(() => document.querySelector('[data-pedido-detalhe]').hidden);
  ok(!(await detalheVisivel(a)), 'ir para #pedidos fecha o detalhe (mostra "Escolha um pedido")');
  ok(await a.$eval('[data-pedido-vazio]', (e) => !e.hidden), 'estado vazio visível');
  await a.focus('[data-lista-pedidos] li:nth-child(1) .admin-item');
  await a.keyboard.press('Enter');
  ok(await esperarHash(a, '#pedidos/PBR-AAAAA2'), 'abrir da lista → #pedidos/PBR-AAAAA2');
  await a.goBack();
  ok(await esperarHash(a, '#pedidos'), 'voltar do navegador → #pedidos');
  await a.waitForFunction(() => document.querySelector('[data-pedido-detalhe]').hidden);
  ok(!(await detalheVisivel(a)), 'voltar fecha o detalhe');
  ok((await focoEm(a)).startsWith('item:PBR-AAAAA2'), 'foco volta para o pedido na lista: ' + await focoEm(a));
  await a.goForward();
  ok(await esperarHash(a, '#pedidos/PBR-AAAAA2'), 'avançar → #pedidos/PBR-AAAAA2');
  await a.waitForFunction(() => !document.querySelector('[data-pedido-detalhe]').hidden);
  ok((await titulo(a)).startsWith('PBR-AAAAA2'), 'avançar reabre o pedido');

  console.log('\n[4] Código inexistente, inválido e fora dos carregados');
  await a.evaluate(() => { location.hash = '#pedidos/PBR-ZZZZZ9'; });
  await a.waitForFunction(() => document.querySelector('[data-pedido-link-aviso]').textContent.trim() !== '');
  ok(/PBR-ZZZZZ9 não encontrado/.test(await aviso(a)), 'aviso de pedido não encontrado: ' + await aviso(a));
  ok(await a.$eval('[data-pedido-link-aviso]', (e) => e.getAttribute('role') === 'alert'), 'aviso em role="alert"');
  ok(await a.$eval('[data-pedido-link-aviso]', (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= e.closest('[data-pedidos-lista-painel]').getBoundingClientRect().top; }), 'aviso dentro da vista da lista');
  ok(await esperarHash(a, '#pedidos'), 'endereço volta para #pedidos');
  ok(!(await detalheVisivel(a)), 'nenhum pedido aberto');
  await a.screenshot({ path: SAIDA + '/link-pedido-aviso-1280.png' });
  await axe(a, 'aviso de código inexistente');
  await a.evaluate(() => { location.hash = '#pedidos/abc%3Cb%3E'; });
  await a.waitForFunction(() => /válido/.test(document.querySelector('[data-pedido-link-aviso]').textContent));
  ok(/código de pedido válido/.test(await aviso(a)), 'código fora do formato → aviso sem consulta: ' + await aviso(a));
  ok(await a.$eval('[data-pedido-link-aviso]', (e) => !e.querySelector('*')), 'aviso só com texto (nada do endereço vira HTML)');
  await a.evaluate(() => { location.hash = '#pedidos/pbr-velh22'; });
  await a.waitForFunction(() => !document.querySelector('[data-pedido-detalhe]').hidden, null, { timeout: 4000 });
  ok((await titulo(a)).startsWith('PBR-VELH22'), 'pedido fora dos 50 carregados abre pelo código (minúsculas aceitas)');
  ok(await esperarHash(a, '#pedidos/PBR-VELH22'), 'endereço normalizado para o código em maiúsculas');
  ok(await aviso(a) === '', 'aviso some ao abrir um pedido');

  console.log('\n[5] Outra aba e volta: o pedido aberto continua e o endereço mostra qual');
  await a.click('[data-aba-link="conversas"]');
  ok(await esperarHash(a, '#conversas'), 'aba Conversas');
  await a.click('[data-aba-link="pedidos"]');
  ok(await esperarHash(a, '#pedidos/PBR-VELH22'), 'de volta à aba Pedidos: #pedidos/PBR-VELH22');
  // O "popstate" do clique chega antes do "hashchange" que mostra a aba: espera a aba aparecer.
  await a.waitForFunction(() => !document.querySelector('[data-aba="pedidos"]').hidden);
  ok(await detalheVisivel(a), 'pedido continua aberto');
  // Atalho "g p" com o pedido aberto não fecha o pedido
  await a.focus('[data-pedido-titulo]');
  await a.keyboard.press('g'); await a.keyboard.press('p');
  await a.waitForTimeout(200);
  ok(await a.evaluate(() => location.hash) === '#pedidos/PBR-VELH22', '"g p" não fecha o pedido aberto');
  ok(a.erros.length === 0, 'console limpo (1280)' + (a.erros.length ? ' -> ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[6] Celular: link abre o detalhe, "Voltar" fecha e o voltar do navegador reabre');
  for (const largura of [320, 375, 768]) {
    const m = await entrar(browser, largura, '#pedidos/PBR-BBBBB2');
    await m.waitForFunction(() => !document.querySelector('[data-pedido-detalhe]').hidden);
    ok((await titulo(m)).startsWith('PBR-BBBBB2'), `${largura}px: pedido do link aberto`);
    const sw = await m.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= largura, `${largura}px: sem rolagem horizontal (${sw})`);
    await m.screenshot({ path: SAIDA + `/link-pedido-${largura}.png` });
    const voltar = await m.$('[data-pedido-voltar]');
    if (await voltar.isVisible()) {
      await m.focus('[data-pedido-voltar]');
      await m.keyboard.press('Enter');
      ok(await esperarHash(m, '#pedidos'), `${largura}px: "Voltar" → #pedidos`);
      ok(await m.$eval('[data-pedidos-lista-painel]', (e) => e.getClientRects().length > 0), `${largura}px: lista visível`);
      ok((await focoEm(m)).startsWith('item:PBR-BBBBB2'), `${largura}px: foco no pedido da lista`);
      await m.goBack();
      ok(await esperarHash(m, '#pedidos/PBR-BBBBB2'), `${largura}px: voltar do navegador → #pedidos/PBR-BBBBB2`);
      await m.waitForFunction(() => !document.querySelector('[data-pedido-detalhe]').hidden);
      ok(await detalheVisivel(m), `${largura}px: pedido reaberto`);
    }
    await m.evaluate(() => { location.hash = '#pedidos/PBR-ZZZZZ9'; });
    await m.waitForFunction(() => document.querySelector('[data-pedido-link-aviso]').textContent.trim() !== '');
    ok(await m.$eval('[data-pedido-link-aviso]', (e) => { const r = e.getBoundingClientRect(); const l = e.closest('[data-pedidos-lista-painel]').getBoundingClientRect(); return r.height > 0 && r.top >= l.top && r.bottom <= Math.min(l.bottom, innerHeight); }), `${largura}px: aviso visível na lista (rolado para a vista)`);
    const sw2 = await m.evaluate(() => document.documentElement.scrollWidth);
    ok(sw2 <= largura, `${largura}px: sem rolagem horizontal com o aviso (${sw2})`);
    await m.screenshot({ path: SAIDA + `/link-pedido-aviso-${largura}.png` });
    await axe(m, `${largura}px`);
    ok(m.erros.length === 0, `console limpo (${largura}px)` + (m.erros.length ? ' -> ' + m.erros.join(' | ') : ''));
    await m.context().close();
  }

  await browser.close();
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
