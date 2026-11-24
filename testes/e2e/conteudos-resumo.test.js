// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o resumo.test.js)
// Item 70 do MELHORIAS.md: cartão "De onde vieram os pedidos" na aba Resumo — conversas e pedidos do mês agrupados
// pelo "cta: blog/..." / "cta: segmento/..." gravado pela melhoria 65, só com os dados já carregados (sem consulta nova).
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

const linhas = (a, s) => a.$$eval(s, (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  const M = `(date_trunc('month', now()) + interval '10 days 12 hours')`;
  const A = `(date_trunc('month', now()) - interval '1 month' + interval '10 days 12 hours')`;
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, whatsapp, pagina_origem, status, criado_em, atualizado_em) values
      (gen_random_uuid(), '${hash('a')}', 'Ana', null, '/planos.html · cta: blog/site-ou-instagram', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('b')}', null, null, '/planos.html · utm: instagram / social · ref: l.instagram.com · entrada: /segmentos/moda.html · cta: segmento/moda', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('c')}', null, null, '/ · cta: blog/site-ou-instagram', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('d')}', null, null, '/', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('e')}', null, null, '/ · cta: outro/coisa', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('f')}', null, null, '/ · cta: blog/site-ou-instagram · ref: x.com', 'aberta', ${M}, ${M}),
      (gen_random_uuid(), '${hash('1')}', 'Bia', null, '/ · cta: segmento/saude', 'fechada', ${A}, ${A});
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Olá', criado_em from public.conversas;
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em, origem) values
      ('PBR-AAAAA2', '${hash('2')}', 'essencial', 'Essencial', 49700, 'Cliente A', 'a@teste.local', '11999990000', now(), 'aprovado', ${M}, ${M}, 'utm: instagram · cta: segmento/moda'),
      ('PBR-BBBBB3', '${hash('3')}', 'essencial', 'Essencial', 49700, 'Cliente B', 'b@teste.local', '11999990000', now(), 'pendente', ${M}, null, 'cta: segmento/moda'),
      ('PBR-CCCCC4', '${hash('4')}', 'essencial', 'Essencial', 49700, 'Cliente C', 'c@teste.local', '11999990000', now(), 'aprovado', ${M}, ${M}, 'cta: blog/o-que-um-site-profissional-precisa-ter'),
      ('PBR-DDDDD5', '${hash('5')}', 'essencial', 'Essencial', 49700, 'Cliente D', 'd@teste.local', '11999990000', now(), 'aprovado', ${M}, ${M}, null),
      ('PBR-EEEEE6', '${hash('6')}', 'essencial', 'Essencial', 49700, 'Cliente E', 'e@teste.local', '11999990000', now(), 'aprovado', ${A}, ${A}, 'cta: segmento/saude');
  `);

  const browser = await chromium.launch();
  const codigo = fs.readFileSync(RAIZ + '/assets/js/admin-resumo.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok(!/\bfetch\(|\.from\(|\.rpc\(|PBRSupabase|XMLHttpRequest|localStorage|innerHTML/.test(codigo), 'admin-resumo.js sem consultas, armazenamento nem innerHTML');

  console.log('\n[1] Extração do cta (função pura)');
  const a = await entrar(browser, { viewport: { width: 1280, height: 900 } });
  const casos = await a.evaluate(() => {
    const f = window.PBRAdminResumo.ctaDe;
    return [f('cta: blog/site-ou-instagram'), f('/ · utm: a / b · cta: segmento/moda'), f('/ · cta: blog/x · ref: y'),
      f('cta: outro/x'), f('cta: blog/'), f(null), f('/ · cta: segmento/<img src=x>'), f('textocta: blog/x')];
  });
  ok(JSON.stringify(casos) === JSON.stringify(['blog/site-ou-instagram', 'segmento/moda', '', '', '', '', '', '']), 'ctaDe: ' + JSON.stringify(casos));
  const rot = await a.evaluate(() => [window.PBRAdminResumo.rotuloCta('segmento/saude'), window.PBRAdminResumo.rotuloCta('blog/site-ou-instagram')]);
  ok(rot[0].nome === 'Saúde' && rot[0].tipo === 'Página de segmento' && rot[1].nome === 'Site ou instagram' && rot[1].tipo === 'Artigo do blog', 'rótulos legíveis');

  console.log('\n[2] Este mês (1280 px)');
  const antes = a.consultas.length;
  await a.click('[data-aba-link="resumo"]');
  await a.waitForSelector('[data-resumo-conteudos-tabela]:not([hidden]) tbody tr');
  ok(a.consultas.length === antes, 'abrir o Resumo não faz consulta nova ao banco');
  ok((await a.textContent('#conteudos-titulo')).trim() === 'De onde vieram os pedidos', 'título do cartão');
  const cap = (await a.textContent('[data-resumo-conteudos-tabela] caption')).replace(/\s+/g, ' ').trim();
  ok(/^Conversas e pedidos de \S+ de \d{4} por conteúdo$/.test(cap), 'caption: ' + cap);
  ok((await a.$$eval('[data-resumo-conteudos-tabela] thead th', (t) => t.every((x) => x.getAttribute('scope') === 'col'))), 'cabeçalhos com scope="col"');
  ok((await a.$$eval('[data-resumo-conteudos-tabela] tbody th', (t) => t.every((x) => x.getAttribute('scope') === 'row'))), 'linhas com th scope="row"');
  const corpo = await linhas(a, '[data-resumo-conteudos-tabela] tbody tr');
  const esperado = [
    'Moda Página de segmento | 1 | 2 | 1',
    'O que um site profissional precisa ter Artigo do blog | 0 | 1 | 1',
    'Site ou instagram Artigo do blog | 2 | 0 | 0'
  ];
  ok(JSON.stringify(corpo) === JSON.stringify(esperado), 'linhas ordenadas por pagos/pedidos/conversas: ' + JSON.stringify(corpo));
  const pe = await linhas(a, '[data-resumo-conteudos-tabela] tfoot tr');
  ok(pe.join() === 'Total | 3 | 3 | 2', 'total: ' + pe.join());
  const nota = (await a.textContent('[data-resumo-conteudos-nota]')).trim();
  ok(nota === 'No mês, 3 de 6 conversas e 3 de 4 pedidos passaram por um desses conteúdos.', 'nota: ' + nota);
  ok(await a.isHidden('[data-resumo-conteudos-vazio]'), 'sem mensagem de vazio');
  await a.screenshot({ path: SAIDA + '/conteudos-1280.png', fullPage: true });
  await axe(a, 'conteúdos 1280');

  console.log('\n[3] Mês anterior e mês sem conteúdo');
  await a.selectOption('[data-resumo-mes]', { index: 1 });
  const c1 = await linhas(a, '[data-resumo-conteudos-tabela] tbody tr');
  ok(c1.join() === 'Saúde Página de segmento | 1 | 1 | 1', 'mês anterior: ' + c1.join());
  await a.selectOption('[data-resumo-mes]', { index: 4 });
  ok(await a.isHidden('[data-resumo-conteudos-tabela]') && await a.isHidden('[data-resumo-conteudos-nota]'), 'mês sem dados esconde a tabela');
  const vazio = (await a.textContent('[data-resumo-conteudos-vazio]')).trim();
  ok(await a.isVisible('[data-resumo-conteudos-vazio]') && /^Nenhuma conversa ou pedido de .+ passou por um artigo do blog ou página de segmento\.$/.test(vazio), 'vazio explicado: ' + vazio);

  console.log('\n[4] Atualiza com o tempo real (pedido pendente pago)');
  await a.selectOption('[data-resumo-mes]', { index: 0 });
  psql(`update public.pedidos set status = 'aprovado', pago_em = ${M} where codigo = 'PBR-BBBBB3';`);
  await a.waitForFunction(() => /\| 2 \| 2$/.test([...document.querySelector('[data-resumo-conteudos-tabela] tbody tr').children].map((c) => c.textContent.trim()).join(' | ')), null, { timeout: 20000 }).catch(() => {});
  const c2 = await linhas(a, '[data-resumo-conteudos-tabela] tbody tr');
  ok(c2[0] === 'Moda Página de segmento | 1 | 2 | 2', 'moda com 2 pagos sem recarregar: ' + c2[0]);
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ' -> ' + a.erros.join(' | ') : ''));
  await a.close();

  console.log('\n[5] Larguras, modo escuro do sistema e axe');
  for (const w of [320, 375, 768, 1280]) {
    const p = await entrar(browser, { viewport: { width: w, height: 800 }, colorScheme: w === 375 ? 'dark' : 'light' });
    await p.click('[data-aba-link="resumo"]');
    await p.waitForSelector('[data-resumo-conteudos-tabela]:not([hidden]) tbody tr');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw === w, `${w}px: scrollWidth ${sw}`);
    const cabe = await p.$eval('[data-resumo-conteudos-tabela]', (t) => {
      const caixa = t.parentElement;
      const fim = caixa.getBoundingClientRect().right - parseFloat(getComputedStyle(caixa).paddingRight) - parseFloat(getComputedStyle(caixa).borderRightWidth);
      return t.getBoundingClientRect().right <= fim + 0.5 || [t.getBoundingClientRect().right, fim].join(' > ');
    });
    ok(cabe === true, `${w}px: tabela cabe no cartão (dentro do padding) ` + (cabe === true ? '' : cabe));
    await p.$eval('[data-resumo-conteudos]', (e) => e.scrollIntoView());
    await p.locator('[data-resumo-conteudos]').screenshot({ path: SAIDA + `/conteudos-${w}.png` });
    await axe(p, 'conteúdos ' + w);
    ok(p.erros.length === 0, `${w}px: console sem erros` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.close();
  }

  await browser.close();
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade;`);
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
