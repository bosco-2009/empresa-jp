// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o recuperacao.test.js)
// Acompanhar pedido (item 30 do MELHORIAS.md): pedido.html mostra as etapas (pago → briefing recebido → em produção →
// entregue) pela RPC pedido_acompanhar com código + token do navegador, sem dados pessoais; o dono muda a etapa no
// painel (detalhe do pedido) e o cliente vê ao atualizar. 4 larguras, modo escuro, axe, console e rolagem.
const { chromium } = require('playwright');
const fs = require('fs');
const crypto = require('crypto');
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
const janela = {};
require('vm').runInNewContext(configOriginal, { window: janela });
const PRAZO_PROFISSIONAL = janela.PBR_CONFIG.planos.filter((p) => p.id === 'profissional')[0].prazo;

function psql(sql) {
  return execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
}
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

const TOKEN = { pago: 'a'.repeat(64), pendente: 'b'.repeat(64), recusado: 'c'.repeat(64) };
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const COD = { pago: 'PBR-PAGA22', pendente: 'PBR-PEND33', recusado: 'PBR-RECU44' };

async function novaPagina(browser, opcoes, pedidosLocais) {
  const ctx = await browser.newContext(opcoes);
  if (pedidosLocais) {
    await ctx.addInitScript((dados) => {
      if (!localStorage.getItem('pbr_pedidos_v1')) {
        localStorage.setItem('pbr_pedidos_v1', JSON.stringify(dados.pedidos));
        localStorage.setItem('pbr_ultimo_pedido', dados.ultimo);
      }
    }, pedidosLocais);
  }
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

const titulo = (p) => p.textContent('[data-acompanhar-titulo]');
const estados = (p) => p.$$eval('[data-etapas] .etapas__item', (els) => els.map((e) =>
  e.className.replace(/.*etapas__item--/, '') + (e.getAttribute('aria-current') === 'step' ? '*' : '')));
async function esperarEstado(p, estado) {
  await p.waitForFunction((e) => document.querySelector('[data-acompanhar]').getAttribute('data-estado') === e, estado, { timeout: 8000 });
}

async function entrarAdmin(browser, largura) {
  const a = await novaPagina(browser, { viewport: { width: largura, height: 800 } });
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  return a;
}

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  psql(`
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em) values
      ('${COD.pago}', '${hash(TOKEN.pago)}', 'profissional', 'Profissional', 99700, 'Paula Sigilosa', 'paula@teste.local', '11977776666', now(), 'aprovado', now() - interval '2 days', now() - interval '2 days'),
      ('${COD.pendente}', '${hash(TOKEN.pendente)}', 'essencial', 'Essencial', 49700, 'Pedro Pendente', 'pedro@teste.local', '11966665555', now(), 'pendente', now(), null),
      ('${COD.recusado}', '${hash(TOKEN.recusado)}', 'premium', 'Premium', 179700, 'Rita Recusada', 'rita@teste.local', '11955554444', now(), 'recusado', now(), null);
  `);
  const local = (chave) => ({
    pedidos: { ['id-' + chave]: { codigo: COD[chave], token: TOKEN[chave], plano_id: 'x', plano_nome: 'x', valor_centavos: 1, criado_em: new Date().toISOString() } },
    ultimo: 'id-' + chave
  });

  const browser = await chromium.launch();

  console.log('\n[1] Sem pedido neste aparelho e token errado');
  let p = await novaPagina(browser, { viewport: { width: 375, height: 800 } });
  await p.goto(SITE + 'pedido.html', { waitUntil: 'networkidle' });
  await esperarEstado(p, 'erro');
  ok(/Não encontramos o seu pedido/.test(await titulo(p)), 'sem acesso: aviso claro');
  ok(await p.isHidden('[data-etapas]'), 'sem acesso: etapas ocultas');
  await p.goto(SITE + 'pedido.html#c=' + COD.pago + '&t=' + 'f'.repeat(64), { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await esperarEstado(p, 'erro');
  ok(/Não foi possível abrir/.test(await titulo(p)), 'token errado: acesso negado sem revelar nada');
  ok(p.erros.filter((e) => !/403|Forbidden/.test(e)).length === 0, 'console sem erros (além do 403 esperado)' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
  await p.context().close();

  console.log('\n[2] Pagamento pendente (pedido salvo neste navegador)');
  p = await novaPagina(browser, { viewport: { width: 375, height: 800 } }, local('pendente'));
  await p.goto(SITE + 'pedido.html', { waitUntil: 'networkidle' });
  await esperarEstado(p, 'pendente');
  ok(/Aguardando a confirmação/.test(await titulo(p)), 'título do pendente');
  ok(JSON.stringify(await estados(p)) === JSON.stringify(['atual*', 'futura', 'futura', 'futura']), 'etapas: 1ª atual ' + (await estados(p)).join(','));
  ok(await p.isHidden('[data-outro-aparelho]'), 'sem link pessoal enquanto não pago');
  ok(p.erros.length === 0, 'console sem erros' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
  await p.context().close();

  console.log('\n[3] Pagamento recusado');
  p = await novaPagina(browser, { viewport: { width: 375, height: 800 } }, local('recusado'));
  await p.goto(SITE + 'pedido.html?pedido=' + COD.recusado, { waitUntil: 'networkidle' });
  await esperarEstado(p, 'recusado');
  ok(await p.isHidden('[data-etapas]'), 'recusado: sem etapas');
  ok((await p.getAttribute('[data-acompanhar-acoes] .botao--primario', 'href')) === 'planos.html?plano=premium', 'recusado: "Tentar de novo" com o plano');
  await p.context().close();

  console.log('\n[4] Link pessoal: pago, sem briefing');
  p = await novaPagina(browser, { viewport: { width: 1280, height: 900 } });
  await p.goto(SITE + 'pedido.html#c=' + COD.pago + '&t=' + TOKEN.pago, { waitUntil: 'networkidle' });
  await esperarEstado(p, 'pago');
  ok(!p.url().includes(TOKEN.pago) && p.url().endsWith('pedido.html?pedido=' + COD.pago), 'token sai da barra de endereço: ' + p.url());
  ok(JSON.stringify(await estados(p)) === JSON.stringify(['feita', 'atual*', 'futura', 'futura']), 'etapas: pago feito, briefing atual');
  ok((await p.getAttribute('[data-link-briefing]', 'href')) === 'briefing.html?pedido=' + COD.pago, 'botão do briefing');
  const corpo = await p.textContent('main');
  ok(!/Paula|paula@|977776666/.test(corpo), 'nenhum dado pessoal na página');
  ok(corpo.includes(COD.pago) && corpo.includes('Profissional'), 'mostra código e plano');
  ok(await p.$eval('[data-etapas] .etapas__item', (e) => !!e.querySelector('time[datetime]')), 'data do pagamento');
  ok(await p.$eval('[data-etapas] .etapas__item:nth-child(2) h2', (e) => e.textContent.includes('(etapa atual)')), 'estado da etapa para leitores de tela');
  await p.click('[data-outro-aparelho] summary');
  ok((await p.inputValue('#link-acompanhar')).endsWith('pedido.html#c=' + COD.pago + '&t=' + TOKEN.pago), 'link pessoal com o token no fragmento');
  ok(JSON.parse(await p.evaluate(() => localStorage.getItem('pbr_briefing_acesso'))).codigo === COD.pago, 'acesso salvo para o briefing neste aparelho');
  await axe(p, '1280 px pago');
  await p.screenshot({ path: SAIDA + '/pedido-pago-1280.png', fullPage: true });

  console.log('\n[5] Briefing enviado → "Atualizar" mostra a nova etapa');
  psql(`insert into public.briefings (pedido_id, nome_negocio) select id, 'Ateliê Teste' from public.pedidos where codigo = '${COD.pago}';`);
  await p.click('[data-acompanhar-atualizar]');
  await esperarEstado(p, 'briefing_recebido');
  ok(/Recebemos o seu briefing/.test(await titulo(p)), 'título: briefing recebido');
  ok(JSON.stringify(await estados(p)) === JSON.stringify(['feita', 'feita', 'atual*', 'futura']), 'etapas: produção é a próxima ' + (await estados(p)).join(','));
  ok(/Atualizado às \d\d:\d\d/.test(await p.textContent('[data-acompanhar-hora]')), 'hora da atualização anunciada (aria-live)');
  ok((await p.textContent('[data-link-briefing]')) === 'Revisar o briefing', 'pode revisar o briefing');
  ok(p.erros.length === 0, 'console sem erros' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));

  console.log('\n[6] O dono muda a etapa no painel (detalhe do pedido)');
  const a = await entrarAdmin(browser, 1280);
  await a.click(`[data-lista-pedidos] .admin-item:has-text("${COD.pendente}")`);
  await a.waitForFunction((c) => document.querySelector('[data-pedido-titulo]').textContent.startsWith(c), COD.pendente);
  ok(await a.isHidden('[data-pedido-etapa]'), 'pedido pendente: sem controle de etapa');
  await a.click(`[data-lista-pedidos] .admin-item:has-text("${COD.pago}")`);
  await a.waitForSelector('[data-pedido-etapa]:not([hidden]) [data-pedido-etapa-controle]:not([hidden])');
  ok((await a.inputValue('[data-pedido-etapa-select]')) === 'novo', 'select mostra a etapa atual');
  await axe(a, 'painel com a etapa');
  await a.selectOption('[data-pedido-etapa-select]', 'em_producao');
  await a.waitForFunction(() => /Em produção/.test(document.querySelector('[data-pedido-etapa-texto]').textContent));
  ok(psql(`select b.status from public.briefings b join public.pedidos p on p.id = b.pedido_id where p.codigo = '${COD.pago}'`) === 'em_producao', 'banco: briefing em produção');
  ok(/Etapa atualizada/.test(await a.textContent('[data-pedido-etapa-ok]')), 'confirmação anunciada (role=status)');
  await a.screenshot({ path: SAIDA + '/pedido-painel-1280.png' });

  await p.click('[data-acompanhar-atualizar]');
  await esperarEstado(p, 'em_producao');
  ok(/em produção/.test(await titulo(p)), 'cliente vê "em produção"');
  ok((await p.textContent('[data-etapas]')).includes(PRAZO_PROFISSIONAL), 'prazo do plano vindo do config.js');
  ok(await p.isHidden('[data-acompanhar-proximo]'), 'sem botão do briefing (travado)');

  await a.selectOption('[data-pedido-etapa-select]', 'em_revisao');
  await a.waitForFunction(() => /ajustes finais/.test(document.querySelector('[data-pedido-etapa-texto]').textContent));
  await p.click('[data-acompanhar-atualizar]');
  await p.waitForFunction(() => /ajustes finais/.test(document.querySelector('[data-acompanhar-titulo]').textContent));
  ok(true, 'em revisão: "ajustes finais" para o cliente');

  await a.selectOption('[data-pedido-etapa-select]', 'entregue');
  await a.waitForFunction(() => /Site entregue/.test(document.querySelector('[data-pedido-etapa-texto]').textContent));
  ok(a.erros.length === 0, 'painel: console sem erros' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  await p.click('[data-acompanhar-atualizar]');
  await esperarEstado(p, 'entregue');
  ok(JSON.stringify(await estados(p)) === JSON.stringify(['feita', 'feita', 'feita', 'feita-atual*']), 'entregue: todas concluídas');
  await axe(p, '1280 px entregue');
  await p.screenshot({ path: SAIDA + '/pedido-entregue-1280.png', fullPage: true });
  ok(p.erros.length === 0, 'console sem erros' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
  await p.context().close();

  console.log('\n[7] Links para o acompanhamento');
  const htmlObrigado = fs.readFileSync(RAIZ + '/assets/js/obrigado.js', 'utf8');
  const htmlBriefing = fs.readFileSync(RAIZ + '/assets/js/briefing.js', 'utf8');
  ok(htmlObrigado.includes("'pedido.html?pedido='") && htmlBriefing.includes("'pedido.html?pedido='"), 'obrigado.html e briefing.html levam ao acompanhamento');

  console.log('\n[8] Larguras 320, 375, 768 e 1280 px (claro e escuro)');
  psql(`update public.briefings set status = 'em_producao' where pedido_id = (select id from public.pedidos where codigo = '${COD.pago}');`);
  for (const w of [320, 375, 768, 1280]) {
    for (const tema of ['light', 'dark']) {
      const q = await novaPagina(browser, { viewport: { width: w, height: 800 }, colorScheme: tema }, local('pago'));
      await q.goto(SITE + 'pedido.html', { waitUntil: 'networkidle' });
      await esperarEstado(q, 'em_producao');
      const sw = await q.evaluate(() => document.documentElement.scrollWidth);
      ok(sw <= w, `${w}px ${tema}: sem rolagem horizontal (${sw})`);
      if (tema === 'light' || w === 375) await axe(q, `${w}px ${tema}`);
      await q.screenshot({ path: SAIDA + `/pedido-${w}-${tema}.png`, fullPage: true });
      ok(q.erros.length === 0, `${w}px ${tema}: console sem erros` + (q.erros.length ? ': ' + q.erros.join(' | ') : ''));
      await q.context().close();
    }
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
