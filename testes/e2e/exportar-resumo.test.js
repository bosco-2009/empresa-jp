// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o resumo.test.js)
// Item 76 do MELHORIAS.md: botão "Baixar CSV" na aba Resumo — cartões do mês (e do mês anterior) e a tabela
// "De onde vieram os pedidos", gerados no navegador com o escape do admin-exportar.js, sem dados pessoais.
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
  p.consultas = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  p.on('request', (r) => { if (r.url().startsWith(API + '/rest/')) p.consultas.push(r.url()); });
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

async function entrar(browser, opcoes) {
  const a = await novaPagina(browser, opcoes);
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.waitForSelector('[data-lista-conversas] .admin-item');
  await a.waitForTimeout(600);
  return a;
}


async function baixar(a, acao) {
  const [d] = await Promise.all([a.waitForEvent('download'), acao()]);
  const caminho = SAIDA + '/' + d.suggestedFilename();
  await d.saveAs(caminho);
  return { nome: d.suggestedFilename(), bruto: fs.readFileSync(caminho, 'utf8') };
}
const linhasCsv = (t) => t.replace(/^﻿/, '').replace(/\r\n$/, '').split('\r\n');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  const M = `(date_trunc('month', now()) + interval '10 days 12 hours')`;
  const A = `(date_trunc('month', now()) - interval '1 month' + interval '10 days 12 hours')`;
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, whatsapp, pagina_origem, status, criado_em, atualizado_em) values
      (gen_random_uuid(), '${hash('a')}', 'Ana Secreta', '11977776666', '/planos.html · cta: blog/site-ou-instagram', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('b')}', null, null, '/planos.html · utm: instagram / social · cta: segmento/moda', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('c')}', null, null, '/ · cta: blog/site-ou-instagram', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('d')}', null, null, '/=HYPERLINK("x")', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('1')}', 'Bia Privada', null, '/ · cta: segmento/saude', 'fechada', ${A}, ${A});
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Mensagem confidencial', criado_em from public.conversas;
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em, origem) values
      ('PBR-AAAAA2', '${hash('2')}', 'essencial', 'Essencial', 49700, 'Cliente Alfa', 'alfa@teste.local', '11999990000', now(), 'aprovado', ${M}, ${M}, 'cta: segmento/moda'),
      ('PBR-BBBBB3', '${hash('3')}', 'essencial', 'Essencial', 49700, 'Cliente Beta', 'beta@teste.local', '11999990000', now(), 'pendente', ${M}, null, 'cta: segmento/moda'),
      ('PBR-CCCCC4', '${hash('4')}', 'essencial', 'Essencial', 123456, 'Cliente Gama', 'gama@teste.local', '11999990000', now(), 'aprovado', ${M}, ${M}, null),
      ('PBR-EEEEE6', '${hash('6')}', 'essencial', 'Essencial', 49700, 'Cliente Delta', 'delta@teste.local', '11999990000', now(), 'aprovado', ${A}, ${A}, 'cta: segmento/saude');
  `);

  const browser = await chromium.launch();
  const codigo = fs.readFileSync(RAIZ + '/assets/js/admin-resumo.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok(!/\bfetch\(|\.from\(|\.rpc\(|PBRSupabase|XMLHttpRequest|localStorage|innerHTML/.test(codigo), 'admin-resumo.js continua sem consultas, armazenamento nem innerHTML');

  console.log('\n[1] Antes dos dados: botão desligado');
  const a0 = await novaPagina(browser, { viewport: { width: 1280, height: 900 } });
  await a0.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  ok(await a0.$eval('[data-resumo-baixar]', (b) => b.disabled), 'sem login/dados, "Baixar CSV" fica desligado');
  await a0.close();

  console.log('\n[2] Baixar o mês atual (teclado, 1280 px)');
  const a = await entrar(browser, { viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await a.click('[data-aba-link="resumo"]');
  await a.waitForSelector('[data-resumo-conteudos-tabela]:not([hidden]) tbody tr');
  ok(!(await a.$eval('[data-resumo-baixar]', (b) => b.disabled)), 'com dados, botão ligado');
  const nomeBtn = await a.$eval('[data-resumo-baixar]', (b) => b.textContent.trim() + ' / ' + document.getElementById(b.getAttribute('aria-describedby')).textContent.trim());
  ok(/^Baixar CSV \/ .*sem dados de clientes\.$/.test(nomeBtn), 'nome e descrição: ' + nomeBtn);
  const antes = a.consultas.length;
  await a.focus('[data-resumo-baixar]');
  const r = await baixar(a, () => a.keyboard.press('Enter'));
  ok(a.consultas.length === antes, 'baixar não faz consulta ao banco');
  const agora = await a.evaluate(() => ({ ano: new Date().getFullYear(), mes: new Date().getMonth() }));
  const ant = agora.mes === 0 ? { ano: agora.ano - 1, mes: 11 } : { ano: agora.ano, mes: agora.mes - 1 };
  const chave = (m) => m.ano + '-' + String(m.mes + 1).padStart(2, '0');
  const nome = (m, cap) => { const t = MESES[m.mes] + ' de ' + m.ano; return cap ? t[0].toUpperCase() + t.slice(1) : t; };
  ok(r.nome === `resumo-portfolio-br-${chave(agora)}.csv`, 'nome do arquivo: ' + r.nome);
  ok(r.bruto.charCodeAt(0) === 0xFEFF, 'arquivo com BOM (acentos no Excel)');
  const hojeTxt = await a.evaluate(() => window.PBRExportar.hoje());
  const esperado = [
    `"Resumo do mês";"${nome(agora, true)}";"${nome(ant, true)} (mês anterior)"`,
    '"Conversas novas";"4";"1"',
    '"Leads (conversas com nome ou WhatsApp)";"1";"1"',
    '"Pedidos pagos (pela data do pagamento)";"2";"1"',
    '"Valor recebido (R$, aprovados sem reembolsados)";"1731,56";"497,00"',
    '"Pedidos iniciados";"3";"1"',
    '"Pedidos iniciados que foram pagos";"2";"1"',
    '"Conversão do checkout (%)";"66,7";"100,0"',
    '',
    `"De onde vieram os pedidos — ${nome(agora)}";"Tipo";"Conversas";"Pedidos";"Pagos"`,
    '"Moda";"Página de segmento";"1";"2";"1"',
    '"Site ou instagram";"Artigo do blog";"2";"0";"0"',
    '"Total";"";"3";"2";"1"',
    '"Todas as conversas do mês";"";"4";"";""',
    '"Todos os pedidos do mês";"";"";"3";""',
    '',
    '"Observações"',
    `"Calculado no painel em ${hojeTxt}. Datas no fuso deste navegador."`
  ];
  const obtido = linhasCsv(r.bruto);
  ok(JSON.stringify(obtido) === JSON.stringify(esperado), 'conteúdo do CSV' + (JSON.stringify(obtido) === JSON.stringify(esperado) ? '' : '\n' + obtido.join('\n')));
  ok(!/Ana|Bia|Cliente|@teste|1197777|1199999|PBR-|confidencial|HYPERLINK|utm|instagram \//.test(r.bruto), 'nenhum dado pessoal, código de pedido ou texto de visitante no arquivo');
  const st = (await a.textContent('[data-resumo-baixado]')).trim();
  ok(st === `Resumo de ${nome(agora)} baixado em CSV.` && (await a.getAttribute('[data-resumo-baixado]', 'role')) === 'status', 'aviso em role=status: ' + st);
  ok(await a.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-resumo-baixar')), 'foco continua no botão');
  await a.locator('.admin-resumo-mes__topo').screenshot({ path: SAIDA + '/resumo-csv-topo-1280.png' });
  await axe(a, 'resumo com aviso 1280');

  console.log('\n[3] Mês anterior: arquivo do mês escolhido');
  await a.selectOption('[data-resumo-mes]', { index: 1 });
  ok((await a.textContent('[data-resumo-baixado]')).trim() === '', 'trocar o mês limpa o aviso');
  const r2 = await baixar(a, () => a.click('[data-resumo-baixar]'));
  const l2 = linhasCsv(r2.bruto);
  ok(r2.nome === `resumo-portfolio-br-${chave(ant)}.csv`, 'nome do arquivo do mês anterior: ' + r2.nome);
  ok(l2[1] === '"Conversas novas";"1";"0"' && l2.includes('"Saúde";"Página de segmento";"1";"1";"1"'), 'mês anterior: ' + l2.slice(0, 2).join(' / '));

  console.log('\n[4] Mês sem dados e tempo real');
  await a.selectOption('[data-resumo-mes]', { index: 5 });
  const r3 = await baixar(a, () => a.click('[data-resumo-baixar]'));
  const l3 = linhasCsv(r3.bruto);
  ok(l3[1] === '"Conversas novas";"0";"0"' && l3.includes('"Conversão do checkout (%)";"";""') && l3.includes('"Total";"";"0";"0";"0"'), 'mês vazio: zeros e conversão em branco');
  await a.selectOption('[data-resumo-mes]', { index: 0 });
  psql(`update public.pedidos set status = 'aprovado', pago_em = ${M} where codigo = 'PBR-BBBBB3';`);
  await a.waitForFunction(() => /\| 2 \| 2$/.test([...document.querySelector('[data-resumo-conteudos-tabela] tbody tr').children].map((c) => c.textContent.trim()).join(' | ')), null, { timeout: 20000 }).catch(() => {});
  const r4 = await baixar(a, () => a.click('[data-resumo-baixar]'));
  ok(linhasCsv(r4.bruto).includes('"Moda";"Página de segmento";"1";"2";"2"'), 'CSV acompanha o tempo real sem recarregar');

  console.log('\n[5] Escape contra fórmula (mesmo do admin-exportar.js)');
  const esc = await a.evaluate(() => window.PBRExportar.csv([{ titulo: 'x', valor: (l) => l }], ['=1+1', '+2', '-3', '@a']));
  ok(esc === '"x"\r\n"\'=1+1"\r\n"\'+2"\r\n"\'-3"\r\n"\'@a"\r\n', 'fórmulas neutralizadas');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ' -> ' + a.erros.join(' | ') : ''));
  await a.close();

  console.log('\n[6] Larguras, modo escuro do sistema e axe');
  for (const w of [320, 375, 768, 1280]) {
    const p = await entrar(browser, { viewport: { width: w, height: 800 }, colorScheme: w === 375 ? 'dark' : 'light', acceptDownloads: true });
    await p.click('[data-aba-link="resumo"]');
    await p.waitForSelector('[data-resumo-conteudos-tabela]:not([hidden]) tbody tr');
    await baixar(p, () => p.click('[data-resumo-baixar]'));
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw === w, `${w}px: scrollWidth ${sw}`);
    const caixa = await p.$eval('[data-resumo-baixar]', (b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, dir: r.right, larg: innerWidth }; });
    ok(caixa.w >= 24 && caixa.h >= 24 && caixa.dir <= caixa.larg, `${w}px: botão ${Math.round(caixa.w)}×${Math.round(caixa.h)} dentro da tela`);
    await p.locator('.admin-resumo-mes__topo').screenshot({ path: SAIDA + `/resumo-csv-topo-${w}.png` });
    await p.screenshot({ path: SAIDA + `/resumo-csv-${w}.png` });
    await axe(p, 'resumo ' + w);
    ok(p.erros.length === 0, `${w}px: console sem erros` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.close();
  }

  await browser.close();
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade;`);
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
