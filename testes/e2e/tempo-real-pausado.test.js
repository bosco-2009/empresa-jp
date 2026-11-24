// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o fila-espera.test.js)
// Aviso de dados desatualizados (item 79 do MELHORIAS.md): o servidor falso derruba os WebSockets do Realtime
// (/__realtime/derrubar) e recusa novos; o painel mostra "Atualizações em tempo real pausadas" com "Atualizar" numa
// região role=status. Dados gravados durante a queda (sem evento) aparecem com "Atualizar" e ao voltar o tempo real,
// sem duplicar itens. Também: queda curta não mostra aviso, logout limpa o aviso, 4 larguras + axe + console limpo +
// sem rolagem horizontal.
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
const controle = (acao) => fetch(API + '/__realtime/' + acao).then((r) => r.json());

async function novaPagina(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  const p = await ctx.newPage();
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  // O próprio WebSocket derrubado gera um aviso de rede no console do Chromium: é a queda simulada, não um erro do site.
  const daQueda = (t) => /WebSocket connection to 'ws:\/\/localhost:54321\/realtime/.test(t);
  p.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !daQueda(m.text())) p.erros.push(m.text()); });
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

async function entrar(browser, largura) {
  const a = await novaPagina(browser, { viewport: { width: largura, height: 800 } });
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.waitForSelector('[data-lista-conversas] .admin-item');
  await a.waitForFunction(() => document.querySelector('[data-conexao]').textContent === 'Tempo real ativo');
  return a;
}

const contar = (a, sel) => a.$$eval(sel, (els) => els.length);
const idsRepetidos = (a, sel) => a.$$eval(sel, (els) => {
  const ids = els.map((e) => e.getAttribute('data-id'));
  return ids.length - new Set(ids).size;
});
const avisoVisivel = (a) => a.evaluate(() => {
  const c = document.querySelector('[data-tempo-real]');
  return c.hasAttribute('data-ativo') && c.getBoundingClientRect().height > 0;
});

(async () => {
  await controle('liberar');
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, status) values
      (gen_random_uuid(), '${hash('a')}', 'Ana Antes', 'aberta'),
      (gen_random_uuid(), '${hash('b')}', 'Bia Antes', 'aberta');
    insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Oi!' from public.conversas;
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status) values
      ('PBR-ANTESA', '${hash('e')}', 'essencial', 'Essencial', 49700, 'Pedido Antes', 'antes@teste.local', '11999990000', now(), 'aprovado');
  `);
  const fonte = fs.readFileSync(RAIZ + '/assets/js/admin-tempo-real.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok(!/innerHTML|\.from\(|fetch\(/.test(fonte), 'admin-tempo-real.js sem innerHTML nem consultas próprias ao banco');

  const browser = await chromium.launch();

  console.log('\n[1] Estado normal: nenhum aviso, região viva já no DOM (1280 px)');
  const a = await entrar(browser, 1280);
  await a.waitForSelector('[data-lista-pedidos] .admin-item', { state: 'attached' });
  ok(!(await avisoVisivel(a)), 'sem aviso com o tempo real ativo');
  ok((await a.getAttribute('[data-tempo-real-texto]', 'role')) === 'status', 'texto do aviso em role=status');
  ok((await a.textContent('[data-tempo-real-texto]')) === '', 'região viva vazia (nada anunciado)');
  ok(await a.$eval('[data-tempo-real-atualizar]', (b) => b.hidden), 'botão Atualizar escondido');

  console.log('\n[2] Queda do Realtime: aviso com "Atualizar"');
  await controle('derrubar');
  await a.waitForFunction(() => document.querySelector('[data-tempo-real]').hasAttribute('data-ativo'), null, { timeout: 10000 });
  const texto = await a.textContent('[data-tempo-real-texto]');
  ok(/^Atualizações em tempo real pausadas\./.test(texto), 'aviso: ' + texto);
  ok(await a.isVisible('[data-tempo-real-atualizar]'), 'botão Atualizar visível');
  ok((await a.getAttribute('[data-conexao]', 'data-estado')) === 'erro', 'indicador do topo também em erro');
  await a.screenshot({ path: SAIDA + '/tempo-real-pausado-1280.png' });
  await axe(a, 'aviso aberto, 1280');

  console.log('\n[3] Dados novos durante a queda aparecem com "Atualizar", sem duplicar');
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, status) values (gen_random_uuid(), '${hash('c')}', 'Caio Durante', 'aberta');
    insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Cheguei offline' from public.conversas where nome = 'Caio Durante';
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status) values
      ('PBR-DURAN2', '${hash('f')}', 'profissional', 'Profissional', 99700, 'Pedido Durante', 'durante@teste.local', '21977776666', now(), 'pendente');
  `);
  await a.waitForTimeout(1500); // o servidor falso "publica" nesse intervalo, mas não há socket para receber
  ok(!(await a.textContent('[data-lista-conversas]')).includes('Caio Durante'), 'sem tempo real, a conversa nova ainda não aparece');
  await a.click('[data-tempo-real-atualizar]');
  await a.waitForFunction(() => document.querySelector('[data-lista-conversas]').textContent.includes('Caio Durante'), null, { timeout: 5000 });
  ok(true, 'conversa nova apareceu depois de "Atualizar"');
  await a.waitForFunction(() => document.querySelector('[data-lista-pedidos]').textContent.includes('PBR-DURAN2'), null, { timeout: 5000 });
  ok(true, 'pedido novo apareceu na aba Pedidos');
  await a.waitForFunction(() => /Listas atualizadas às \d\d:\d\d\./.test(document.querySelector('[data-tempo-real-texto]').textContent));
  ok(true, 'aviso continua, com a hora da atualização');
  await a.click('[data-tempo-real-atualizar]');
  await a.click('[data-tempo-real-atualizar]');
  await a.waitForTimeout(800);
  ok((await contar(a, '[data-lista-conversas] .admin-item')) === 3 && (await idsRepetidos(a, '[data-lista-conversas] .admin-item')) === 0, 'conversas: 3, sem repetidas após vários cliques');
  ok((await contar(a, '[data-lista-pedidos] .admin-item')) === 2 && (await idsRepetidos(a, '[data-lista-pedidos] .admin-item')) === 0, 'pedidos: 2, sem repetidos');
  // a conversa aberta também é recarregada, sem mensagens repetidas
  await a.click('[data-lista-conversas] .admin-item:has-text("Caio Durante")');
  await a.waitForSelector('[data-conversa-conteudo]:not([hidden])');
  psql(`insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Segunda mensagem offline' from public.conversas where nome = 'Caio Durante';`);
  await a.waitForTimeout(1200);
  await a.click('[data-tempo-real-atualizar]');
  await a.waitForFunction(() => document.querySelector('[data-mensagens]').textContent.includes('Segunda mensagem offline'), null, { timeout: 5000 });
  ok((await contar(a, '[data-mensagens] .admin-msg')) === 2, 'conversa aberta: 2 mensagens, sem duplicar');

  console.log('\n[4] Volta do tempo real: aviso some sozinho e nada duplica');
  psql(`insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status) values
      ('PBR-VEXTA3', '${hash('9')}', 'essencial', 'Essencial', 49700, 'Pedido Volta', 'volta@teste.local', '11955554444', now(), 'pendente');`);
  await a.waitForTimeout(1200);
  await controle('liberar');
  await a.waitForFunction(() => document.querySelector('[data-conexao]').textContent === 'Tempo real ativo', null, { timeout: 20000 });
  await a.waitForFunction(() => document.querySelector('[data-tempo-real-texto]').textContent === 'Tempo real de volta. Listas atualizadas.', null, { timeout: 5000 });
  ok(true, 'aviso "Tempo real de volta"');
  ok(await a.$eval('[data-tempo-real-atualizar]', (b) => b.hidden), 'sem botão Atualizar com o tempo real de volta');
  await a.waitForFunction(() => document.querySelector('[data-lista-pedidos]').textContent.includes('PBR-VEXTA3'), null, { timeout: 5000 });
  ok(true, 'pedido gravado durante a queda entrou ao reconectar (sem clicar)');
  ok((await contar(a, '[data-lista-pedidos] .admin-item')) === 3 && (await idsRepetidos(a, '[data-lista-pedidos] .admin-item')) === 0, 'pedidos: 3, sem repetidos');
  ok((await contar(a, '[data-lista-conversas] .admin-item')) === 3 && (await idsRepetidos(a, '[data-lista-conversas] .admin-item')) === 0, 'conversas: 3, sem repetidas');
  await a.waitForFunction(() => !document.querySelector('[data-tempo-real]').hasAttribute('data-ativo'), null, { timeout: 9000 });
  ok((await a.textContent('[data-tempo-real-texto]')) === '', 'aviso sumiu sozinho');
  // tempo real voltou mesmo: mensagem nova chega sem clicar
  psql(`insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Ao vivo de novo' from public.conversas where nome = 'Caio Durante';`);
  await a.waitForFunction(() => document.querySelector('[data-mensagens]').textContent.includes('Ao vivo de novo'), null, { timeout: 5000 });
  ok((await contar(a, '[data-mensagens] .admin-msg')) === 3, 'mensagem ao vivo chegou uma vez só');

  console.log('\n[5] Logout com o tempo real caído limpa o aviso');
  await controle('derrubar');
  await a.waitForFunction(() => document.querySelector('[data-tempo-real]').hasAttribute('data-ativo'), null, { timeout: 10000 });
  await a.click('[data-acoes-sessao] [data-sair]');
  await a.waitForSelector('[data-tela="login"]:not([hidden])');
  await a.waitForTimeout(3500);
  ok(!(await a.$eval('[data-tempo-real]', (c) => c.hasAttribute('data-ativo'))) && (await a.textContent('[data-tempo-real-texto]')) === '', 'sem aviso depois de sair');
  await controle('liberar');
  ok(a.erros.length === 0, 'console limpo (1280)' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[6] Larguras: aviso sem rolagem horizontal, axe e console limpos');
  for (const largura of [320, 375, 768]) {
    const p = await entrar(browser, largura);
    await controle('derrubar');
    await p.waitForFunction(() => document.querySelector('[data-tempo-real]').hasAttribute('data-ativo'), null, { timeout: 10000 });
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${largura}px sem rolagem horizontal`);
    const caixa = await p.$eval('[data-tempo-real-atualizar]', (b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, d: r.right }; });
    ok(caixa.w >= 24 && caixa.h >= 24 && caixa.d <= largura, `${largura}px botão Atualizar inteiro e com alvo ≥ 24 px`);
    await p.screenshot({ path: SAIDA + `/tempo-real-pausado-${largura}.png` });
    await axe(p, largura + 'px');
    await controle('liberar');
    await p.waitForFunction(() => document.querySelector('[data-conexao]').textContent === 'Tempo real ativo', null, { timeout: 20000 });
    ok(p.erros.length === 0, `console limpo (${largura})` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[7] Queda curta (reconexão rápida) não mostra o aviso');
  const q = await entrar(browser, 1280);
  await controle('derrubar');
  await q.waitForFunction(() => document.querySelector('[data-conexao]').getAttribute('data-estado') === 'erro', null, { timeout: 10000 });
  await controle('liberar');
  await q.waitForFunction(() => document.querySelector('[data-conexao]').textContent === 'Tempo real ativo', null, { timeout: 20000 });
  ok(true, 'reconectou');
  await q.waitForTimeout(3000);
  const t = await q.textContent('[data-tempo-real-texto]');
  ok(!/pausadas/.test(t), 'queda de ~1 s não deixou aviso de pausa: "' + t + '"');
  await q.context().close();

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
