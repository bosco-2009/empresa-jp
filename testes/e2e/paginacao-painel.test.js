// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o chat.test.js)
// Listas longas no painel (item 49 do MELHORIAS.md): conversas, pedidos e briefings em páginas de 50 com
// "Carregar mais" e "Mostrando X de Y", tempo real sem perder o que já foi carregado, filtros/exportação
// coerentes com o carregado, pedido fora da página aberto pelo briefing, erro sem perder o limite,
// foco no primeiro item novo, 4 larguras sem rolagem + axe e console limpo. 200 registros de teste.
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
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
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

const texto = (a, s) => a.$eval(s, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const contar = (a, s) => a.$$eval(s, (els) => els.length);
const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codigo = (i) => 'PBR-' + [0, 1, 2, 3, 4, 5].map((k) => ALFA[Math.floor(i / Math.pow(ALFA.length, k)) % ALFA.length]).join('');

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  // 200 conversas com mensagem (a nº 1 é a mais recente), 5 conversas vazias ainda mais recentes (não contam),
  // 200 pedidos (1 = mais recente; os pares aprovados) e 200 briefings (o mais recente é do pedido MAIS ANTIGO).
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, status, criado_em, atualizado_em)
      select gen_random_uuid(), lpad(to_hex(i), 64, '0'), 'Cliente ' || lpad(i::text, 3, '0'), 'aberta',
             now() - make_interval(mins => i), now() - make_interval(mins => i)
        from generate_series(1, 200) i;
    insert into public.mensagens (conversa_id, autor, texto, criado_em)
      select id, 'visitante', 'Olá, sou ' || nome, atualizado_em from public.conversas;
    insert into public.conversas (visitante_id, token_hash, status, criado_em, atualizado_em)
      select gen_random_uuid(), lpad(to_hex(1000 + i), 64, '0'), 'aberta', now(), now() from generate_series(1, 5) i;
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp,
                                aceite_termos_em, status, pago_em, criado_em)
      select c.codigo, lpad(to_hex(i), 64, '0'), 'essencial', 'Essencial', 49700, 'Comprador ' || lpad(i::text, 3, '0'),
             'c' || i || '@teste.local', '11999990000', now(), case when i % 2 = 0 then 'aprovado' else 'pendente' end,
             case when i % 2 = 0 then now() - make_interval(hours => i) end, now() - make_interval(hours => i)
        from generate_series(1, 200) i join (values ${Array.from({ length: 200 }, (_, i) => `(${i + 1}, '${codigo(i + 7)}')`).join(',')}) c(n, codigo) on c.n = i;
    insert into public.briefings (pedido_id, nome_negocio, criado_em, atualizado_em)
      select p.id, 'Negócio ' || substr(p.nome, 11), now() - make_interval(mins => 201 - substr(p.nome, 11)::int), now() - make_interval(mins => 201 - substr(p.nome, 11)::int)
        from public.pedidos p;
  `);
  ok(psql('select count(*) from public.briefings') === '200', '200 briefings de teste criados');

  const browser = await chromium.launch();

  console.log('\n[1] Conversas: 50 por vez (1280 px)');
  const a = await entrar(browser, 1280);
  await a.click('[data-filtro="todas"]');
  ok(await contar(a, '[data-lista-conversas] .admin-item') === 50, '50 conversas na primeira carga');
  ok(/^Mostrando 50 de 200 conversas\. Filtros, busca e exportação valem para as carregadas\.$/.test(await texto(a, '[data-mais="conversas"] [data-mais-conta]')),
    'contador "Mostrando 50 de 200 conversas" (as 5 conversas sem mensagem ficam de fora do total)');
  ok(await texto(a, '[data-mais="conversas"] [data-mais-botao]') === 'Carregar mais 50', 'botão "Carregar mais 50"');
  ok(/\(50\)/.test(await texto(a, '[data-exportar-conversas]')), 'exportação conta só as carregadas');
  const primeiro51 = 'Cliente 051';
  // Pelo teclado (Tab até o botão + Enter), como faria quem não usa mouse.
  await a.focus('[data-mais="conversas"] [data-mais-botao]');
  await a.keyboard.press('Enter');
  await a.waitForFunction(() => document.querySelectorAll('[data-lista-conversas] .admin-item').length === 100);
  ok(await a.evaluate(() => document.activeElement.textContent.includes('Cliente 051')), `foco no primeiro item novo (${primeiro51})`);
  ok(/^50 conversas a mais\. Mostrando 100 de 200\.$/.test(await texto(a, '[data-mais="conversas"] [data-mais-aviso]')), 'aviso para leitor de tela (role=status)');
  ok(await a.evaluate(() => document.activeElement.matches(':focus-visible')), 'foco visível no item novo (teclado)');
  await a.click('[data-mais="conversas"] [data-mais-botao]');
  await a.waitForFunction(() => document.querySelectorAll('[data-lista-conversas] .admin-item').length === 150);
  await a.click('[data-mais="conversas"] [data-mais-botao]');
  await a.waitForFunction(() => document.querySelectorAll('[data-lista-conversas] .admin-item').length === 200);
  ok(await texto(a, '[data-mais="conversas"] [data-mais-conta]') === 'Mostrando 200 de 200 conversas.', 'tudo carregado: "Mostrando 200 de 200 conversas."');
  ok(await a.isHidden('[data-mais="conversas"] [data-mais-botao]'), 'sem mais nada, o botão some');

  console.log('\n[2] Tempo real mantém o que foi carregado');
  psql(`insert into public.conversas (visitante_id, token_hash, nome, status) values (gen_random_uuid(), repeat('e', 64), 'Cliente Novo', 'aberta');
        insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Oi!' from public.conversas where nome = 'Cliente Novo';`);
  await a.waitForFunction(() => /Cliente Novo/.test(document.querySelector('[data-lista-conversas]').textContent), null, { timeout: 10000 });
  ok(await contar(a, '[data-lista-conversas] .admin-item') === 200, 'nova conversa entra no topo e a lista continua com 200 (limite mantido)');
  ok(await texto(a, '[data-mais="conversas"] [data-mais-conta]') === 'Mostrando 200 de 201 conversas. Filtros, busca e exportação valem para as carregadas.',
    'contador atualizado pelo tempo real (200 de 201)');
  ok(await a.isVisible('[data-mais="conversas"] [data-mais-botao]') && await texto(a, '[data-mais="conversas"] [data-mais-botao]') === 'Carregar mais 1', 'botão volta com "Carregar mais 1"');

  console.log('\n[3] Pedidos: 50 por vez, filtros coerentes com o carregado');
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  ok(await contar(a, '[data-lista-pedidos] .admin-item') === 50, '50 pedidos na primeira carga');
  ok(/^Mostrando 50 de 200 pedidos\. Filtros, busca e exportação valem para os carregados\.$/.test(await texto(a, '[data-mais="pedidos"] [data-mais-conta]')), 'contador de pedidos (masculino)');
  ok(/^Aprovados \(25\)$/.test(await texto(a, '[data-filtro-pedido="aprovado"]')), 'filtro "Aprovados" conta só os carregados (25 de 50)');
  ok(/\(50\)/.test(await texto(a, '[data-exportar-pedidos]')), 'exportação de pedidos conta os carregados');
  // Falha de rede na próxima página: aviso, limite volta, nada se perde.
  let falhar = true;
  await a.route('**/rest/v1/pedidos?*', (r) => (falhar && /offset=0&limit=100|limit=100/.test(r.request().url())) ? r.fulfill({ status: 500, body: '{"message":"erro"}', contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } }) : r.fallback());
  await a.click('[data-mais="pedidos"] [data-mais-botao]');
  await a.waitForFunction(() => /Não foi possível carregar mais/.test(document.querySelector('[data-mais="pedidos"] [data-mais-aviso]').textContent));
  ok(true, 'erro ao carregar mais: aviso "Não foi possível carregar mais. Tente de novo."');
  ok(await a.evaluate(() => document.activeElement.matches('[data-mais="pedidos"] [data-mais-botao]')), 'foco continua no botão para tentar de novo');
  falhar = false;
  // O 500 simulado aparece no console como recurso que falhou: é esperado, o resto precisa estar limpo.
  a.erros = a.erros.filter((e) => !/status of 500/.test(e));
  await a.click('[data-mais="pedidos"] [data-mais-botao]');
  await a.waitForFunction(() => document.querySelectorAll('[data-lista-pedidos] .admin-item').length === 100);
  ok(/^Mostrando 100 de 200 pedidos/.test(await texto(a, '[data-mais="pedidos"] [data-mais-conta]')), 'nova tentativa carrega 100 (limite não pulou para 150)');
  ok(/^Aprovados \(50\)$/.test(await texto(a, '[data-filtro-pedido="aprovado"]')), 'contador do filtro acompanha (50 de 100)');
  await a.fill('[data-busca-pedidos]', 'Comprador 099');
  ok(await contar(a, '[data-lista-pedidos] .admin-item') === 1, 'busca encontra um pedido carregado');
  await a.fill('[data-busca-pedidos]', 'Comprador 150');
  ok(await contar(a, '[data-lista-pedidos] .admin-item') === 0, 'busca não inventa o que não foi carregado (aviso no rodapé)');
  await a.fill('[data-busca-pedidos]', '');

  console.log('\n[4] Briefings: 50 por vez; "Ver pedido" abre pedido fora da página');
  await a.click('[data-aba-link="briefings"]');
  await a.waitForSelector('[data-lista-briefings] .admin-item');
  ok(await contar(a, '[data-lista-briefings] .admin-item') === 50, '50 briefings na primeira carga');
  ok(/^Mostrando 50 de 200 briefings/.test(await texto(a, '[data-mais="briefings"] [data-mais-conta]')), 'contador de briefings');
  ok(/^Todos \(50\)$/.test(await texto(a, '[data-filtro-briefing="todos"]')), 'filtro "Todos" conta os carregados');
  await a.click('[data-lista-briefings] .admin-item >> nth=0');
  await a.waitForSelector('[data-briefing-ver-pedido]:visible');
  await a.click('[data-briefing-ver-pedido]');
  await a.waitForFunction(() => location.hash.split('/')[0] === '#pedidos');
  ok(await a.waitForFunction(() => /Comprador 200/.test((document.querySelector('[data-pedido-titulo]') || {}).textContent || ''), null, { timeout: 5000 }).then(() => true, () => false),
    'pedido mais antigo (fora dos 100 carregados) abre com os dados certos');
  ok(await contar(a, '[data-lista-pedidos] .admin-item') === 100, 'a lista de pedidos não muda por causa dele');

  console.log('\n[5] Resumo avisa que considera só o carregado');
  await a.click('[data-aba-link="resumo"]');
  ok(/mais recentes/.test(await texto(a, '[data-resumo-limite]')), 'aviso do Resumo: considera só os itens mais recentes');
  ok(a.erros.length === 0, 'console sem erros (1280)' + (a.erros.length ? ' -> ' + a.erros.join(' | ') : ''));
  await a.click('[data-aba-link="conversas"]');
  await a.click('[data-filtro="todas"]');
  await a.$eval('[data-mais="conversas"]', (e) => e.scrollIntoView({ block: 'end' }));
  await a.screenshot({ path: SAIDA + '/paginacao-1280.png' });
  await a.context().close();

  console.log('\n[6] 4 larguras: sem rolagem, axe, console');
  for (const largura of [320, 375, 768, 1280]) {
    const p = await entrar(browser, largura);
    await p.waitForSelector('[data-mais="conversas"]:not([hidden])');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw === largura, `${largura}px: sem rolagem horizontal (scrollWidth ${sw})`);
    const caixa = await p.$eval('[data-mais="conversas"] [data-mais-botao]', (b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, d: r.right }; });
    ok(caixa.h >= 40 && caixa.d <= largura, `${largura}px: botão com alvo de toque ≥ 40 px e dentro da tela`);
    await p.$eval('[data-mais="conversas"]', (e) => e.scrollIntoView({ block: 'end' }));
    if (largura === 375) await p.screenshot({ path: SAIDA + '/paginacao-375.png' });
    await axe(p, 'conversas ' + largura);
    await p.click('[data-aba-link="pedidos"]');
    await p.waitForSelector('[data-mais="pedidos"]:not([hidden])');
    await axe(p, 'pedidos ' + largura);
    ok(await p.evaluate(() => document.documentElement.scrollWidth) === largura, `${largura}px: pedidos sem rolagem horizontal`);
    ok(p.erros.length === 0, `${largura}px: console sem erros` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
