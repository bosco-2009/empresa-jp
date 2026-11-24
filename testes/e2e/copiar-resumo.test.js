// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o exportar-resumo.test.js)
// Item 113 do MELHORIAS.md: botão "Copiar resumo" na aba Resumo — os números do mês em texto pronto para o WhatsApp,
// sem dados pessoais, copiados com aviso acessível (role="status"), com cópia alternativa quando a API é negada.
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

async function novaPagina(browser, opcoesTodas) {
  const opcoes = Object.assign({}, opcoesTodas); delete opcoes.semClipboard;
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Sao_Paulo' }, opcoes));
  const p = await ctx.newPage();
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.consultas = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  if (opcoesTodas && opcoesTodas.semClipboard) await p.addInitScript(opcoesTodas.semClipboard);
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



const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEM_API = () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('negado')) } }); };
const SEM_NADA = () => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined });
  document.execCommand = () => false;
};

async function abrirResumo(a) {
  await a.click('[data-aba-link="resumo"]');
  await a.waitForSelector('[data-resumo-cartoes] li');
}
async function textoStatus(a) {
  await a.waitForFunction(() => document.querySelector('[data-resumo-baixado]').textContent.trim() !== '');
  return a.$eval('[data-resumo-baixado]', (e) => e.textContent.trim());
}

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  const M = `(date_trunc('month', now()) + interval '10 days 12 hours')`;
  const A = `(date_trunc('month', now()) - interval '1 month' + interval '10 days 12 hours')`;
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, whatsapp, pagina_origem, status, criado_em, atualizado_em) values
      (gen_random_uuid(), '${hash('a')}', 'Ana Secreta', '11977776666', '/planos.html', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('b')}', null, null, '/', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('c')}', null, null, '/', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('d')}', null, null, '/', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('e')}', null, null, '/', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('f')}', null, null, '/', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('1')}', 'Bia Privada', null, '/', 'fechada', ${A}, ${A});
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Mensagem confidencial', criado_em from public.conversas;
    -- 5 conversas do mês respondidas em 10 min (a 'f' fica sem resposta)
    insert into public.mensagens (conversa_id, autor, texto, criado_em)
      select id, 'admin', 'Resposta do dono', criado_em + interval '10 minutes' from public.conversas
      where token_hash in ('${hash('a')}', '${hash('b')}', '${hash('c')}', '${hash('d')}', '${hash('e')}');
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em, origem) values
      ('PBR-AAAAA2', '${hash('2')}', 'essencial', 'Essencial', 49700, 'Cliente Alfa', 'alfa@teste.local', '11999990000', now(), 'aprovado', ${M}, ${M}, null),
      ('PBR-BBBBB3', '${hash('3')}', 'essencial', 'Essencial', 49700, 'Cliente Beta', 'beta@teste.local', '11999990000', now(), 'pendente', ${M}, null, null),
      ('PBR-EEEEE6', '${hash('6')}', 'essencial', 'Essencial', 49700, 'Cliente Delta', 'delta@teste.local', '11999990000', now(), 'aprovado', ${A}, ${A}, null);
  `);

  const browser = await chromium.launch();
  const codigo = fs.readFileSync(RAIZ + '/assets/js/admin-resumo.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok(!/\bfetch\(|\.from\(|\.rpc\(|PBRSupabase|XMLHttpRequest|localStorage|innerHTML/.test(codigo), 'admin-resumo.js continua sem consultas, armazenamento nem innerHTML');

  console.log('\n[1] Antes dos dados: botão desligado');
  const a0 = await novaPagina(browser, { viewport: { width: 1280, height: 900 } });
  await a0.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  ok(await a0.$eval('[data-resumo-copiar]', (b) => b.disabled), 'sem login/dados, "Copiar resumo" fica desligado');
  ok(await a0.evaluate(() => window.PBRAdminResumo.textoWhatsapp({ ano: 2026, mes: 0 }) === null), 'sem dados, o texto é null (nada é copiado)');
  await a0.close();

  console.log('\n[2] Copiar pelo teclado (área de transferência permitida, 1280 px)');
  const a = await entrar(browser, { viewport: { width: 1280, height: 900 } });
  await a.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(SITE).origin });
  await abrirResumo(a);
  ok(!(await a.$eval('[data-resumo-copiar]', (b) => b.disabled)), 'com dados, botão ligado');
  const nomeBtn = await a.$eval('[data-resumo-copiar]', (b) => b.textContent.trim() + ' / ' + document.getElementById(b.getAttribute('aria-describedby')).textContent.trim());
  ok(/^Copiar resumo \/ .*sem dados de clientes\.$/.test(nomeBtn), 'nome e descrição: ' + nomeBtn);
  ok(await a.$eval('[data-resumo-baixado]', (e) => e.getAttribute('role') === 'status'), 'aviso em role="status"');
  const antes = a.consultas.length;
  await a.focus('[data-resumo-copiar]');
  await a.keyboard.press('Enter');
  const st = await textoStatus(a);
  const agora = await a.evaluate(() => ({ ano: new Date().getFullYear(), mes: new Date().getMonth() }));
  const ant = agora.mes === 0 ? { ano: agora.ano - 1, mes: 11 } : { ano: agora.ano, mes: agora.mes - 1 };
  const nomeAgora = MESES[agora.mes] + ' de ' + agora.ano;
  const nomeAnt = MESES[ant.mes];
  ok(st === `Resumo de ${nomeAgora} copiado. Cole no WhatsApp.`, 'aviso: ' + st);
  ok(a.consultas.length === antes, 'copiar não faz consulta ao banco');
  ok(await a.evaluate(() => document.activeElement.matches('[data-resumo-copiar]')), 'o foco continua no botão');
  const copiado = await a.evaluate(() => navigator.clipboard.readText());
  const hojeTxt = await a.evaluate(() => window.PBRExportar.hoje());
  const esperado = [
    `*Resumo de ${nomeAgora} · Portfólio BR*`,
    '',
    `• Conversas novas: 6 (${nomeAnt}: 1)`,
    `• Leads (com nome ou WhatsApp): 1 (${nomeAnt}: 1)`,
    `• Pedidos pagos: 1 (${nomeAnt}: 1)`,
    `• Valor recebido: R$ 497,00 (${nomeAnt}: R$ 497,00)`,
    `• Conversão do checkout: 50% · 1 de 2 (${nomeAnt}: 100%)`,
    '• Pedidos atrasados agora: 0',
    '• 1ª resposta (mediana): 10 min',
    '• 1ª resposta (90% em até): 10 min',
    '',
    `_Calculado no painel em ${hojeTxt}._`
  ].join('\n');
  ok(copiado === esperado, 'texto copiado confere' + (copiado === esperado ? '' : '\n--- copiado:\n' + copiado + '\n--- esperado:\n' + esperado));
  ok(!/Ana|Bia|Secreta|Privada|Cliente|@|1199|1197|PBR-|confidencial|undefined|null|NaN/.test(copiado), 'sem nomes, contatos, códigos, textos de visitante nem "undefined"');
  await a.screenshot({ path: SAIDA + '/copiar-resumo-1280.png' });

  console.log('\n[3] Mês anterior: sem dados suficientes de 1ª resposta');
  await a.selectOption('[data-resumo-mes]', { index: 1 });
  ok(await a.$eval('[data-resumo-baixado]', (e) => e.textContent === ''), 'trocar o mês limpa o aviso');
  await a.click('[data-resumo-copiar]');
  await textoStatus(a);
  const copiado2 = await a.evaluate(() => navigator.clipboard.readText());
  ok(copiado2.includes('• 1ª resposta: sem dados suficientes (0 de 5 conversas respondidas)'), 'mês com poucas respostas diz "sem dados suficientes"');
  ok(copiado2.startsWith(`*Resumo de ${MESES[ant.mes]} de ${ant.ano} · Portfólio BR*`), 'título do mês escolhido');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.close();

  console.log('\n[4] API negada: cópia alternativa');
  const b = await entrar(browser, { viewport: { width: 375, height: 800 }, semClipboard: SEM_API });
  await abrirResumo(b);
  await b.evaluate(() => { window.__copiado = null; document.addEventListener('copy', () => { window.__copiado = String(document.getSelection()); }); });
  await b.click('[data-resumo-copiar]');
  const st2 = await textoStatus(b);
  ok(/copiado\. Cole no WhatsApp\.$/.test(st2), 'aviso de sucesso pela cópia alternativa: ' + st2);
  ok(await b.evaluate(() => (window.__copiado || '').startsWith('*Resumo de ')), 'texto foi para o evento copy');
  ok(await b.evaluate(() => !document.querySelector('textarea.visualmente-oculto')), 'caixa temporária removida');
  ok(await b.evaluate(() => document.activeElement.matches('[data-resumo-copiar]')), 'foco devolvido ao botão');
  ok(b.erros.length === 0, 'console sem erros' + (b.erros.length ? ': ' + b.erros.join(' | ') : ''));
  await b.close();

  console.log('\n[5] Nada permitido: aviso de erro');
  const c = await entrar(browser, { viewport: { width: 375, height: 800 }, semClipboard: SEM_NADA });
  await abrirResumo(c);
  await c.click('[data-resumo-copiar]');
  const st3 = await textoStatus(c);
  ok(/^Não foi possível copiar o resumo de .*Baixar CSV/.test(st3), 'aviso de erro: ' + st3);
  await c.close();

  console.log('\n[6] Larguras: rolagem, botões, axe e console');
  for (const w of [320, 375, 768, 1280]) {
    const p = await entrar(browser, { viewport: { width: w, height: 900 } });
    await abrirResumo(p);
    const m = await p.evaluate(() => {
      const r = (s) => { const x = document.querySelector(s).getBoundingClientRect(); return { l: x.left, r: x.right, w: x.width, h: x.height }; };
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, copiar: r('[data-resumo-copiar]'), baixar: r('[data-resumo-baixar]') };
    });
    ok(m.sw === m.cw, `${w}px: scrollWidth ${m.sw}`);
    ok(m.copiar.l >= 0 && m.copiar.r <= m.cw && m.copiar.h >= 24 && m.copiar.w >= 24, `${w}px: botão copiar ${Math.round(m.copiar.w)}×${Math.round(m.copiar.h)} dentro da tela`);
    await axe(p, 'resumo ' + w);
    await p.screenshot({ path: SAIDA + `/copiar-resumo-${w}.png` });
    ok(p.erros.length === 0, `${w}px: console sem erros` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.close();
  }

  await browser.close();
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade;`);
  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
