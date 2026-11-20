// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o chat.test.js)
// Filtros e exportação do painel (item 20 do MELHORIAS.md): período, origem (utm/ref) e "só leads" nas conversas;
// período e origem nos pedidos; CSV gerado no navegador (";", BOM, aspas, proteção contra fórmulas), 4 larguras + axe.
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
    insert into public.conversas (visitante_id, token_hash, nome, whatsapp, pagina_origem, status, criado_em, atualizado_em) values
      (gen_random_uuid(), '${hash('a')}', 'Ana Insta', '11988887777', '/planos.html · utm: instagram / social / bio · entrada: /', 'aberta', now() - interval '1 hour', now() - interval '1 hour'),
      (gen_random_uuid(), '${hash('b')}', null, null, '/index.html · ref: google.com · entrada: /blog/', 'aberta', now() - interval '2 hours', now() - interval '2 hours'),
      (gen_random_uuid(), '${hash('c')}', 'Bruno Antigo', null, '/index.html', 'fechada', now() - interval '40 days', now() - interval '40 days');
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Olá', criado_em from public.conversas;
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, origem, criado_em, pago_em) values
      ('PBR-AAAAA2', '${hash('d')}', 'essencial', 'Essencial', 49700, 'Carla "Aspas"', 'carla@teste.local', '11977776666', now(), 'aprovado', 'utm: instagram / social / bio · entrada: /', now() - interval '3 hours', now() - interval '2 hours'),
      ('PBR-BBBBB3', '${hash('e')}', 'profissional', 'Profissional', 99700, '=SOMA(1;1)', 'formula@teste.local', '11966665555', now(), 'pendente', 'ref: google.com · entrada: /', now() - interval '5 days', null),
      ('PBR-CCCCC4', '${hash('f')}', 'essencial', 'Essencial', 49700, 'Diego Antigo', 'diego@teste.local', '11955554444', now(), 'aprovado', null, now() - interval '60 days', now() - interval '60 days');
  `);

  const browser = await chromium.launch();

  console.log('\n[1] Conversas: período, origem, só leads e CSV (1280 px)');
  const a = await entrar(browser, 1280);
  await a.click('[data-filtro="todas"]');
  ok((await a.$$('[data-lista-conversas] .admin-item')).length === 3, 'Todas: 3 conversas');
  const origens = await textos(a, '[data-origem-conversas] option');
  ok(origens.join('|') === 'Todas as origens|Direto (sem campanha) (1)|google.com (1)|instagram (1)', 'origens com contagem: ' + origens.join(', '));
  await a.selectOption('[data-periodo-conversas]', '7');
  ok((await a.$$('[data-lista-conversas] .admin-item')).length === 2, 'Últimos 7 dias: 2 conversas');
  await a.check('[data-so-leads]');
  ok((await a.$$('[data-lista-conversas] .admin-item')).length === 1, 'Só leads: 1 (a anônima sai)');
  ok((await a.textContent('[data-exportar-conversas]')).trim() === 'Exportar CSV (1)', 'botão mostra quantos vão no arquivo');
  const leads = await baixar(a, '[data-exportar-conversas]');
  const ll = linhasCsv(leads.texto);
  ok(/^leads-portfolio-br-\d{4}-\d{2}-\d{2}\.csv$/.test(leads.nome), 'nome do arquivo: ' + leads.nome);
  ok(leads.texto.startsWith('﻿'), 'CSV com BOM (acentos no Excel)');
  ok(ll[0] === '"Nome";"WhatsApp";"Status";"Canal de origem";"Página e origem";"Início";"Última atividade";"Não lidas"', 'cabeçalho das conversas');
  ok(ll.length === 2 && ll[1].startsWith('"Ana Insta";"(11) 98888-7777";"Aberta";"instagram";'), 'linha do lead: ' + ll[1]);
  ok((await a.textContent('[data-exportado-conversas]')) === '1 conversa exportada.', 'aviso em role=status');
  await a.uncheck('[data-so-leads]');
  await a.selectOption('[data-periodo-conversas]', 'tudo');
  await a.selectOption('[data-origem-conversas]', 'google.com');
  ok((await a.$$('[data-lista-conversas] .admin-item')).length === 1, 'origem google.com: 1');
  await a.selectOption('[data-origem-conversas]', '');
  await axe(a, 'conversas com filtros');

  console.log('\n[2] Pedidos: período, origem, contadores e CSV');
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  ok((await a.$$('[data-lista-pedidos] .admin-item')).length === 3, '3 pedidos');
  await a.selectOption('[data-periodo-pedidos]', '30');
  ok((await a.$$('[data-lista-pedidos] .admin-item')).length === 2, 'últimos 30 dias: 2');
  ok((await a.textContent('[data-filtro-pedido="aprovado"]')) === 'Aprovados (1)', 'contadores seguem o recorte');
  const resumo = await a.textContent('[data-resumo-pedidos]');
  ok(/1 pedido aprovado · R\$\s?497,00 \(de 3 pedidos no total\)/.test(resumo), 'resumo do recorte: ' + resumo);
  await a.selectOption('[data-origem-pedidos]', 'instagram');
  ok((await a.$$('[data-lista-pedidos] .admin-item')).length === 1, 'origem instagram: 1');
  await a.selectOption('[data-origem-pedidos]', '');
  const ped = await baixar(a, '[data-exportar-pedidos]');
  const lp = linhasCsv(ped.texto);
  ok(/^pedidos-portfolio-br-\d{4}-\d{2}-\d{2}\.csv$/.test(ped.nome), 'nome do arquivo: ' + ped.nome);
  ok(lp[0] === '"Código";"Criado em";"Status";"Plano";"Valor (R$)";"Cliente";"E-mail";"WhatsApp";"Canal de origem";"Origem (detalhe)";"Pago em";"Briefing"', 'cabeçalho dos pedidos');
  ok(lp.length === 3, 'só os 2 pedidos do recorte no CSV');
  ok(lp.some((l) => l.includes('"PBR-AAAAA2"') && l.includes('"497,00"') && l.includes('"Carla ""Aspas"""') && l.includes('"instagram"')), 'aspas escapadas e valor em reais');
  ok(lp.some((l) => l.includes('"\'=SOMA(1;1)"')), 'nome que parece fórmula ganha apóstrofo (sem injeção de CSV)');
  ok(!lp.some((l) => l.includes('PBR-CCCCC4')), 'pedido fora do período não vai');
  await a.fill('[data-busca-pedidos]', 'nada-disso');
  ok(await a.isDisabled('[data-exportar-pedidos]'), 'sem resultados: exportar desativado');
  await a.fill('[data-busca-pedidos]', '');
  await axe(a, 'pedidos com filtros');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.screenshot({ path: SAIDA + '/exportar-1280.png' });
  await a.context().close();

  console.log('\n[3] Larguras');
  for (const w of [320, 375, 768]) {
    const p = await entrar(browser, w);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px conversas sem rolagem horizontal (${sw})`);
    await p.screenshot({ path: SAIDA + `/exportar-conversas-${w}.png` });
    await p.click('[data-aba-link="pedidos"]');
    await p.waitForSelector('[data-lista-pedidos] .admin-item');
    const sw2 = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw2 <= w, `${w}px pedidos sem rolagem horizontal (${sw2})`);
    await axe(p, `${w}px pedidos`);
    await p.screenshot({ path: SAIDA + `/exportar-pedidos-${w}.png` });
    ok(p.erros.length === 0, `${w}px console sem erros` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
