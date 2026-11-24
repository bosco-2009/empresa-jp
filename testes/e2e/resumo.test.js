// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o chat.test.js)
// Resumo do mês no painel (item 32 do MELHORIAS.md): cartões calculados no navegador com os dados já carregados
// (sem consulta nova), comparação com o mês anterior em texto, troca de mês, 4 larguras sem rolagem + axe.
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


const textos = (a, s) => a.$$eval(s, (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  // Meio do mês (no fuso de São Paulo continua no mesmo mês). M = este mês, A = mês anterior.
  const M = `(date_trunc('month', now()) + interval '10 days 12 hours')`;
  const A = `(date_trunc('month', now()) - interval '1 month' + interval '10 days 12 hours')`;
  const A2 = `(date_trunc('month', now()) - interval '2 months' + interval '10 days 12 hours')`;
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, whatsapp, pagina_origem, status, criado_em, atualizado_em) values
      (gen_random_uuid(), '${hash('a')}', 'Ana', null, '/', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('b')}', null, '11988887777', '/', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('c')}', null, null, '/', 'fechada', ${M}, ${M}),
      (gen_random_uuid(), '${hash('d')}', 'Bruno', null, '/', 'fechada', ${A}, ${A}),
      (gen_random_uuid(), '${hash('9')}', 'Sem mensagem', null, '/', 'aberta', ${M}, ${M});
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Olá', criado_em from public.conversas where nome is distinct from 'Sem mensagem';
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em) values
      ('PBR-AAAAA2', '${hash('e')}', 'essencial', 'Essencial', 49700, 'Cliente A', 'a@teste.local', '11999990000', now(), 'aprovado', ${M}, ${M}),
      ('PBR-BBBBB3', '${hash('f')}', 'profissional', 'Profissional', 99700, 'Cliente B', 'b@teste.local', '11999990000', now(), 'aprovado', ${A}, ${M}),
      ('PBR-CCCCC4', '${hash('1')}', 'essencial', 'Essencial', 49700, 'Cliente C', 'c@teste.local', '11999990000', now(), 'pendente', ${M}, null),
      ('PBR-DDDDD5', '${hash('2')}', 'essencial', 'Essencial', 49700, 'Cliente D', 'd@teste.local', '11999990000', now(), 'reembolsado', ${M}, ${M}),
      ('PBR-EEEEE6', '${hash('3')}', 'essencial', 'Essencial', 49700, 'Cliente E', 'e@teste.local', '11999990000', now(), 'aprovado', ${A}, ${A}),
      ('PBR-FFFFF7', '${hash('4')}', 'essencial', 'Essencial', 49700, 'Cliente F', 'f@teste.local', '11999990000', now(), 'pendente', ${A}, null),
      ('PBR-GGGGG8', '${hash('5')}', 'essencial', 'Essencial', 49700, 'Cliente G', 'g@teste.local', '11999990000', now(), 'aprovado', ${A2}, ${A2});
  `);
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const anterior = MESES[(agora.getMonth() + 11) % 12];
  const retrasado = MESES[(agora.getMonth() + 10) % 12];

  const browser = await chromium.launch();
  // O resumo só usa os dados já carregados: o módulo não tem acesso ao Supabase nem faz requisições.
  const codigoResumo = fs.readFileSync(RAIZ + '/assets/js/admin-resumo.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok(!/\bfetch\(|\.from\(|\.rpc\(|PBRSupabase|XMLHttpRequest|localStorage/.test(codigoResumo), 'admin-resumo.js sem consultas ao banco nem armazenamento');

  console.log('\n[1] Este mês: cartões e comparação com o mês anterior (1280 px)');
  const a = await entrar(browser, 1280);
  await a.waitForTimeout(800);
  await a.click('[data-aba-link="resumo"]');
  await a.waitForSelector('[data-resumo-cartoes] .admin-kpi');
  ok(await a.isVisible('[data-aba="resumo"]') && !(await a.isVisible('[data-aba="conversas"]')), 'aba Resumo visível e as outras ocultas');
  ok((await a.getAttribute('[data-aba-link="resumo"]', 'aria-current')) === 'page', 'aba marcada com aria-current');
  const opcao = (await a.$eval('[data-resumo-mes]', (s) => s.options[s.selectedIndex].textContent));
  ok(/\(este mês\)$/.test(opcao), 'mês padrão é o atual: ' + opcao);
  ok((await a.$$eval('[data-resumo-mes] option', (o) => o.length)) === 12, '12 meses para escolher');
  const rotulos = await textos(a, '.admin-kpi__rotulo');
  ok(rotulos.join('|') === 'Conversas novas|Leads|Pedidos pagos|Valor recebido|Conversão do checkout', 'cinco cartões: ' + rotulos.join(', '));
  const valores = await textos(a, '.admin-kpi__valor');
  ok(valores.join('|') === '3|2|2|R$ 1.494,00|33,3%', 'valores: ' + valores.join(' | '));
  const comps = (await textos(a, '.admin-kpi__comparacao')).map((t) => t.replace(/^[▲▼=] /, ''));
  ok(comps[0] === `2 a mais que em ${anterior} (1)`, 'conversas: ' + comps[0]);
  ok(comps[1] === `1 a mais que em ${anterior} (1)`, 'leads: ' + comps[1]);
  ok(comps[2] === `1 a mais que em ${anterior} (1)`, 'pagos: ' + comps[2]);
  ok(comps[3] === `R$ 997,00 a mais que em ${anterior} (R$ 497,00)`, 'valor: ' + comps[3]);
  ok(comps[4] === `33,3 pontos percentuais abaixo de ${anterior} (66,7%)`, 'conversão: ' + comps[4]);
  const det = await textos(a, '.admin-kpi__detalhe');
  ok(det.includes('1 de 3 pedidos iniciados foram pagos'), 'detalhe da conversão em texto');
  ok((await a.$$eval('.admin-kpi__seta', (s) => s.every((x) => x.getAttribute('aria-hidden') === 'true'))), 'setas decorativas (aria-hidden)');
  ok(await a.isHidden('[data-resumo-limite]'), 'sem aviso de limite com poucos registros');
  await a.screenshot({ path: SAIDA + '/resumo-1280.png', fullPage: true });
  await axe(a, 'resumo 1280');

  console.log('\n[2] Mês anterior e mês sem dados');
  await a.selectOption('[data-resumo-mes]', { index: 1 });
  const v2 = await textos(a, '.admin-kpi__valor');
  ok(v2.join('|') === '1|1|1|R$ 497,00|66,7%', 'mês anterior: ' + v2.join(' | '));
  const c2 = (await textos(a, '.admin-kpi__comparacao')).map((t) => t.replace(/^[▲▼=] /, ''));
  ok(c2[0] === `1 a mais que em ${retrasado} (0)`, 'comparação com o retrasado: ' + c2[0]);
  ok(c2[4] === `33,3 pontos percentuais abaixo de ${retrasado} (100%)`, 'conversão contra o retrasado: ' + c2[4]);
  await a.selectOption('[data-resumo-mes]', { index: 5 });
  const v3 = await textos(a, '.admin-kpi__valor');
  ok(v3.join('|') === '0|0|0|R$ 0,00|—', 'mês vazio: ' + v3.join(' | '));
  ok((await textos(a, '.admin-kpi__detalhe')).includes('Nenhum pedido iniciado no mês'), 'mês vazio explica a conversão');

  console.log('\n[3] Atualiza quando chega um pedido pago (dados já recarregados pelo painel)');
  await a.selectOption('[data-resumo-mes]', { index: 0 });
  psql(`update public.pedidos set status = 'aprovado', pago_em = ${M} where codigo = 'PBR-CCCCC4';`);
  await a.waitForFunction(() => document.querySelectorAll('.admin-kpi__valor')[2].textContent === '3', null, { timeout: 20000 }).catch(() => {});
  ok((await textos(a, '.admin-kpi__valor'))[2] === '3', 'pedidos pagos sobe para 3 sem recarregar a página');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ' -> ' + a.erros.join(' | ') : ''));
  await a.close();

  console.log('\n[4] Larguras: sem rolagem horizontal, abas cabem, axe');
  for (const w of [320, 375, 768, 1024]) {
    const p = await entrar(browser, w);
    await p.click('[data-aba-link="resumo"]');
    await p.waitForSelector('[data-resumo-cartoes] .admin-kpi');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw === w, `${w}px: scrollWidth ${sw}`);
    const abas = await p.$eval('.admin-abas', (n) => n.scrollWidth <= n.clientWidth || [n.scrollWidth, n.clientWidth, [...n.children].map((c) => c.offsetWidth)].join(' '));
    const cabem = await p.$$eval('.admin-kpi__valor', (els) => els.every((e) => e.scrollWidth <= e.clientWidth));
    ok(cabem, `${w}px: valores cabem nos cartões`);
    ok(abas === true, abas + ' ' + `${w}px: as quatro abas cabem na barra`);
    await p.screenshot({ path: SAIDA + `/resumo-${w}.png`, fullPage: true });
    await axe(p, 'resumo ' + w);
    ok(p.erros.length === 0, `${w}px: console sem erros` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.close();
  }

  await browser.close();
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade;`);
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
