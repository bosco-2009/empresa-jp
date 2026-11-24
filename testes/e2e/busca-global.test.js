// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o chat.test.js)
// Busca global do painel (item 37 do MELHORIAS.md): procura nos dados já carregados das três abas (sem consulta
// nova), resultados agrupados por aba, teclado (setas, Home/End, Esc, Enter), abre o item certo, 4 larguras + axe.
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
  const codigo = fs.readFileSync(RAIZ + '/assets/js/admin-busca.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok(!/\bfetch\(|\.from\(|\.rpc\(|PBRSupabase|XMLHttpRequest|localStorage|innerHTML/.test(codigo), 'admin-busca.js sem consultas ao banco, armazenamento nem innerHTML');

  console.log('\n[1] Busca sem acento acha nas três abas, agrupado (1280 px)');
  const a = await entrar(browser, 1280);
  await a.waitForFunction(() => document.querySelector('[data-lista-briefings] .admin-item') && document.querySelector('[data-lista-pedidos] .admin-item'));
  // Sem consulta nova: os resultados aparecem no mesmo instante da digitação (síncrono, sem esperar a rede).
  const sincrono = await a.evaluate(() => {
    const c = document.querySelector('#busca-global');
    c.value = 'pedra';
    c.dispatchEvent(new Event('input'));
    const n = document.querySelectorAll('[data-busca-resultado]').length;
    c.value = '';
    c.dispatchEvent(new Event('input'));
    return n;
  });
  ok(sincrono === 1, 'resultados calculados na hora, sem esperar o banco (' + sincrono + ')');
  await a.fill('#busca-global', 'joana');
  await a.waitForSelector('[data-busca-global-resultados]:not([hidden])');
  const titulos = await textos(a, '.admin-busca-global__titulo');
  ok(titulos.join('|') === 'Conversas (1)|Pedidos (1)|Briefings (1)', 'grupos: ' + titulos.join(', '));
  ok((await textos(a, '.admin-busca-global__marca')).every((t) => /^jo[aã]na$/i.test(t)), 'trecho destacado com <mark>');
  await a.waitForFunction(() => /3 resultados/.test(document.querySelector('[data-busca-global-status]').textContent));
  ok(true, 'status anuncia: ' + (await a.textContent('[data-busca-global-status]')));
  await a.screenshot({ path: SAIDA + '/busca-1280.png' });
  await axe(a, 'busca aberta 1280');

  console.log('\n[2] Trecho de mensagem, código, e-mail e WhatsApp');
  await a.fill('#busca-global', 'encomendas pelo whats');
  await a.waitForFunction(() => /Mensagem/.test(document.querySelector('[data-busca-global-resultados]').textContent));
  ok((await textos(a, '.admin-busca-global__achado'))[0].startsWith('Mensagem: …'), 'mensagem longa vira recorte: ' + (await textos(a, '.admin-busca-global__achado'))[0]);
  await a.fill('#busca-global', 'pbr-pedra');
  ok((await textos(a, '.admin-busca-global__nome'))[0] === 'PBR-PEDRA3 · Pedro Lima', 'código do pedido');
  await a.fill('#busca-global', 'pedro@teste');
  ok((await textos(a, '.admin-busca-global__achado'))[0] === 'E-mail: pedro@teste.local', 'e-mail');
  await a.fill('#busca-global', '98888-7777');
  ok((await textos(a, '.admin-busca-global__nome'))[0] === 'Visitante ' + (await a.$eval('[data-busca-resultado]', (b) => b.dataset.id.slice(0, 4).toUpperCase())), 'WhatsApp com máscara acha a conversa');
  await a.fill('#busca-global', 'xyzinexistente');
  ok((await textos(a, '.admin-busca-global__vazio'))[0] === 'Nada encontrado para “xyzinexistente”.', 'mensagem de nada encontrado');
  await a.fill('#busca-global', 'j');
  ok(await a.isHidden('[data-busca-global-resultados]'), 'uma letra só não abre resultados');


  console.log('\n[3] Teclado: setas, Esc, Enter abre o item na aba certa');
  await a.fill('#busca-global', 'joana');
  await a.press('#busca-global', 'ArrowDown');
  ok(await a.evaluate(() => document.activeElement.dataset.buscaResultado === 'conversas'), 'seta para baixo vai ao 1º resultado');
  await a.keyboard.press('ArrowDown');
  ok(await a.evaluate(() => document.activeElement.dataset.buscaResultado === 'pedidos'), 'seta para baixo passa de grupo');
  await a.keyboard.press('End');
  ok(await a.evaluate(() => document.activeElement.dataset.buscaResultado === 'briefings'), 'End vai ao último');
  await a.keyboard.press('Home');
  await a.keyboard.press('ArrowUp');
  ok(await a.evaluate(() => document.activeElement.id === 'busca-global'), 'seta para cima no 1º volta ao campo');
  await a.keyboard.press('ArrowDown');
  await a.keyboard.press('Escape');
  ok(await a.isHidden('[data-busca-global-resultados]') && await a.evaluate(() => document.activeElement.id === 'busca-global'), 'Esc fecha e volta ao campo');
  await a.fill('#busca-global', 'pbr-pedra');
  await a.press('#busca-global', 'Enter');
  await a.waitForFunction(() => location.hash.split('/')[0] === '#pedidos' && !document.querySelector('[data-pedido-detalhe]').hidden);
  ok(await a.evaluate(() => location.hash === '#pedidos/PBR-PEDRA3'), 'endereço com o código do pedido aberto (melhoria 118)');
  ok((await a.textContent('[data-pedido-titulo]')).includes('PBR-PEDRA3'), 'Enter abre o pedido na aba Pedidos');
  ok(await a.evaluate(() => document.activeElement.matches('[data-pedido-titulo]')), 'foco no título do pedido');

  console.log('\n[4] Clique abre conversa escondida pelo filtro e briefing');
  await a.fill('#busca-global', '988887777');
  await a.click('[data-busca-resultado="conversas"]');
  await a.waitForFunction(() => location.hash === '#conversas' && !document.querySelector('[data-conversa-conteudo]').hidden);
  ok((await a.getAttribute('[data-filtro="todas"]', 'aria-pressed')) === 'true', 'conversa fechada: filtro vira "Todas"');
  ok(await a.evaluate(() => document.activeElement.matches('[data-conversa-nome]')), 'foco no nome da conversa');
  ok((await a.$$('[data-lista-conversas] [aria-current="true"]')).length === 1, 'conversa marcada na lista');
  await a.fill('#busca-global', 'doceria');
  await a.click('[data-busca-resultado="briefings"]');
  await a.waitForFunction(() => location.hash === '#briefings' && !document.querySelector('[data-briefing-detalhe]').hidden);
  ok((await a.textContent('[data-briefing-titulo]')) === 'Doceria da Joana', 'briefing aberto');
  await a.fill('#busca-global', 'joana');
  await a.click('.admin-abas', { position: { x: 900, y: 5 } }).catch(() => {});
  await a.mouse.click(1200, 700);
  ok(await a.isHidden('[data-busca-global-resultados]'), 'clique fora fecha');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ' -> ' + a.erros.join(' | ') : ''));
  await a.close();

  console.log('\n[5] Larguras: sem rolagem horizontal, painel cabe, axe');
  for (const w of [320, 375, 768, 1280]) {
    const p = await entrar(browser, w);
    await p.waitForFunction(() => document.querySelector('[data-lista-briefings] .admin-item'));
    await p.fill('#busca-global', 'joana');
    await p.waitForSelector('[data-busca-global-resultados]:not([hidden])');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw === w, `${w}px: scrollWidth ${sw}`);
    const caixa = await p.$eval('[data-busca-global-resultados]', (n) => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && n.scrollWidth <= n.clientWidth; });
    ok(caixa, `${w}px: resultados dentro da tela, sem rolagem lateral`);
    await p.screenshot({ path: SAIDA + `/busca-${w}.png` });
    await axe(p, 'busca ' + w);
    ok(p.erros.length === 0, `${w}px: console sem erros` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.close();
  }

  await browser.close();
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade;`);
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
