// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o fila-espera.test.js)
// Aba Conversas (item 93 do MELHORIAS.md): "Só não lidas" (nao_lidas_admin > 0) combinável com os filtros, ordem
// "Maior espera" (as que aguardam resposta primeiro, quem espera há mais tempo no topo, o resto pela última atividade),
// ordem travada em "espera" na fila "Aguardando resposta", estado lembrado no localStorage do admin (e valor estragado
// ignorado), conversa aberta continua na lista depois de lida, tempo real, nada gravado no banco; 4 larguras + axe.
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

async function novaPagina(browser, opcoes, relogio) {
  const ctx = await browser.newContext(opcoes);
  const p = await ctx.newPage();
  if (relogio) await p.clock.install();
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

async function entrar(browser, largura, relogio) {
  const a = await novaPagina(browser, { viewport: { width: largura, height: 800 } }, relogio);
  await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.waitForSelector('[data-lista-conversas] .admin-item');
  return a;
}

const nomes = (a) => a.$$eval('[data-lista-conversas] .admin-item__nome', (els) => els.map((e) => e.textContent.trim()));
const ordem = (n) => n.join(',');

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  // Ana espera há 42 min (2 não lidas), Bia há 7 min (1), Caio respondido (0, atividade mais recente),
  // Davi fechada com 1 não lida.
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, status) values
      (gen_random_uuid(), '${hash('a')}', 'Ana Espera', 'aberta'),
      (gen_random_uuid(), '${hash('b')}', 'Bia Recente', 'aberta'),
      (gen_random_uuid(), '${hash('c')}', 'Caio Respondido', 'aberta'),
      (gen_random_uuid(), '${hash('d')}', 'Davi Fechada', 'aberta');
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Oi, quanto custa?', now() - interval '43 minutes' from public.conversas where nome = 'Ana Espera';
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Tem prazo?', now() - interval '42 minutes' from public.conversas where nome = 'Ana Espera';
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Vocês fazem loja?', now() - interval '7 minutes' from public.conversas where nome = 'Bia Recente';
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Olá', now() - interval '2 hours' from public.conversas where nome = 'Caio Respondido';
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'admin', 'Oi Caio!', now() - interval '1 hour' from public.conversas where nome = 'Caio Respondido';
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Obrigado', now() - interval '3 hours' from public.conversas where nome = 'Davi Fechada';
    update public.conversas set status = 'fechada' where nome = 'Davi Fechada';
    update public.conversas set atualizado_em = now() - interval '1 minute' where nome = 'Caio Respondido';
    update public.conversas set atualizado_em = now() - interval '30 minutes' where nome = 'Ana Espera';
    update public.conversas set atualizado_em = now() - interval '5 minutes' where nome = 'Bia Recente';
  `);
  const lidas = psql(`select string_agg(nome || '=' || nao_lidas_admin, ',' order by nome) from public.conversas`);
  ok(lidas === 'Ana Espera=2,Bia Recente=1,Caio Respondido=0,Davi Fechada=1', 'dados de teste: ' + lidas);
  const mensagensAntes = psql(`select count(*) from public.mensagens`);

  const browser = await chromium.launch();

  console.log('\n[1] Padrão, ordem por espera e "Só não lidas" (1280 px)');
  const a = await entrar(browser, 1280);
  ok(ordem(await nomes(a)) === 'Caio Respondido,Bia Recente,Ana Espera', 'padrão: Abertas pela última atividade');
  ok((await a.inputValue('[data-ordem-conversas]')) === 'recentes' && !(await a.isChecked('[data-so-nao-lidas]')), 'controles no padrão');
  ok(await a.$eval('[data-ordem-conversas]', (s) => !!s.labels.length && s.labels[0].textContent.trim() === 'Ordenar'), 'select com rótulo "Ordenar"');
  await a.selectOption('[data-ordem-conversas]', 'espera');
  ok(ordem(await nomes(a)) === 'Ana Espera,Bia Recente,Caio Respondido', 'espera mais longa: aguardando primeiro, depois o resto: ' + ordem(await nomes(a)));
  await a.check('[data-so-nao-lidas]');
  ok(ordem(await nomes(a)) === 'Ana Espera,Bia Recente', 'só não lidas em Abertas (Caio lido some)');
  ok(/Exportar CSV \(2\)/.test(await a.textContent('[data-exportar-conversas]')), 'exportação coerente com a vista');
  await a.click('[data-filtro="todas"]');
  ok(ordem(await nomes(a)) === 'Ana Espera,Bia Recente,Davi Fechada', 'Todas + só não lidas inclui a fechada com não lida: ' + ordem(await nomes(a)));
  await a.screenshot({ path: SAIDA + '/conversas-nao-lidas-1280.png' });

  console.log('\n[2] Fila "Aguardando resposta" trava a ordem em espera');
  await a.click('[data-filtro="aguardando"]');
  ok(await a.isDisabled('[data-ordem-conversas]') && (await a.inputValue('[data-ordem-conversas]')) === 'espera', 'select travado em "Maior espera"');
  ok(await a.isVisible('[data-ordem-dica]'), 'dica visível explicando a trava');
  ok((await a.getAttribute('[data-ordem-conversas]', 'aria-describedby')) === 'conversas-ordem-dica', 'dica ligada por aria-describedby');
  ok(ordem(await nomes(a)) === 'Ana Espera,Bia Recente', 'fila ordenada por espera');
  await a.selectOption('[data-ordem-conversas]', 'espera').catch(() => {});
  await a.click('[data-filtro="aberta"]');
  ok(!(await a.isDisabled('[data-ordem-conversas]')) && !(await a.isVisible('[data-ordem-dica]')), 'fora da fila o select volta a valer');
  await a.uncheck('[data-so-nao-lidas]');
  await a.selectOption('[data-ordem-conversas]', 'recentes');
  ok(ordem(await nomes(a)) === 'Caio Respondido,Bia Recente,Ana Espera', 'de volta a "Mais recentes"');

  console.log('\n[3] Estado lembrado ao recarregar (localStorage do admin)');
  await a.click('[data-filtro="todas"]');
  await a.selectOption('[data-ordem-conversas]', 'espera');
  await a.check('[data-so-nao-lidas]');
  const salvo = await a.evaluate(() => localStorage.getItem('pbr-admin-conversas-vista'));
  ok(salvo === '{"filtro":"todas","ordem":"espera","soNaoLidas":true}', 'gravado: ' + salvo);
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('[data-lista-conversas] .admin-item');
  ok((await a.getAttribute('[data-filtro="todas"]', 'aria-pressed')) === 'true' && (await a.getAttribute('[data-filtro="aberta"]', 'aria-pressed')) === 'false', 'filtro "Todas" restaurado (aria-pressed)');
  ok((await a.inputValue('[data-ordem-conversas]')) === 'espera' && (await a.isChecked('[data-so-nao-lidas]')), 'ordem e caixa restauradas');
  ok(ordem(await nomes(a)) === 'Ana Espera,Bia Recente,Davi Fechada', 'lista restaurada igual');

  console.log('\n[4] Conversa aberta continua na lista depois de lida; tempo real');
  await a.click('[data-lista-conversas] .admin-item:has-text("Bia Recente")');
  await a.waitForSelector('[data-conversa-conteudo]:not([hidden])');
  await a.waitForFunction(() => !document.querySelector('[data-lista-conversas] .admin-item[aria-current="true"]').classList.contains('admin-item--nova'), null, { timeout: 8000 });
  ok(psql(`select nao_lidas_admin from public.conversas where nome = 'Bia Recente'`) === '0', 'banco: Bia marcada como lida');
  ok((await nomes(a)).includes('Bia Recente'), 'Bia (aberta, já lida) continua na lista');
  psql(`insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Voltei' from public.conversas where nome = 'Caio Respondido';`);
  await a.waitForFunction(() => [...document.querySelectorAll('[data-lista-conversas] .admin-item__nome')].some((e) => e.textContent === 'Caio Respondido'), null, { timeout: 8000 });
  ok(ordem(await nomes(a)) === 'Ana Espera,Bia Recente,Caio Respondido,Davi Fechada' || ordem(await nomes(a)) === 'Ana Espera,Caio Respondido,Bia Recente,Davi Fechada',
    'nova mensagem do Caio entra pelo tempo real, no fim da fila de espera: ' + ordem(await nomes(a)));
  ok(psql(`select count(*) from public.mensagens`) === String(+mensagensAntes + 1), 'banco: nada gravado além da mensagem do teste');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ' -> ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[5] Valor estragado no localStorage → padrão, sem erro');
  const e = await novaPagina(browser, { viewport: { width: 375, height: 800 } });
  await e.addInitScript(() => { try { localStorage.setItem('pbr-admin-conversas-vista', '{"filtro":"<b>x</b>","ordem":7,soNaoLidas'); } catch (x) {} });
  await e.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await e.fill('#login-email', 'dono@teste.local');
  await e.fill('#login-senha', 'senha-de-teste');
  await e.click('[data-form-login] button[type=submit]');
  await e.waitForSelector('[data-lista-conversas] .admin-item');
  ok((await e.getAttribute('[data-filtro="aberta"]', 'aria-pressed')) === 'true' && (await e.inputValue('[data-ordem-conversas]')) === 'recentes' && !(await e.isChecked('[data-so-nao-lidas]')), 'padrão mantido');
  ok(e.erros.length === 0, 'console sem erros (valor estragado)');
  await e.context().close();

  console.log('\n[6] Só não lidas sem resultado');
  psql(`update public.conversas set nao_lidas_admin = 0`);
  const v = await entrar(browser, 375);
  await v.check('[data-so-nao-lidas]');
  ok(await v.isVisible('[data-lista-vazia]') && (await v.textContent('[data-lista-vazia]')) === 'Nenhuma conversa com mensagens não lidas neste filtro.', 'mensagem de lista vazia própria');
  await v.context().close();
  psql(`update public.conversas set nao_lidas_admin = 1 where nome in ('Ana Espera', 'Davi Fechada')`);

  console.log('\n[7] Larguras: controles cabem, sem rolagem horizontal, axe, teclado');
  for (const largura of [320, 375, 768, 1280]) {
    const p = await entrar(browser, largura);
    await p.selectOption('[data-ordem-conversas]', 'espera');
    await p.check('[data-so-nao-lidas]');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw === largura, `${largura}px sem rolagem horizontal (${sw})`);
    const fora = await p.$$eval('.admin-refino > *:not(.visualmente-oculto):not([hidden])', (els) => els.filter((b) => { const r = b.getBoundingClientRect(); const pai = b.parentElement.getBoundingClientRect(); return r.right > pai.right + 0.5 || r.left < pai.left - 0.5; }).length);
    ok(fora === 0, `${largura}px controles dentro do bloco de refino`);
    const alvos = await p.$$eval('[data-ordem-conversas], .admin-refino__marcar--meia', (els) => els.every((b) => { const r = b.getBoundingClientRect(); return r.height >= 24 && r.width >= 24; }));
    ok(alvos, `${largura}px alvos ≥ 24 px`);
    // Teclado: espaço marca/desmarca a caixa.
    await p.focus('[data-so-nao-lidas]');
    await p.keyboard.press('Space');
    ok(!(await p.isChecked('[data-so-nao-lidas]')), `${largura}px caixa desmarcada pelo teclado`);
    await p.keyboard.press('Space');
    await p.screenshot({ path: `${SAIDA}/conversas-nao-lidas-${largura}.png` });
    await axe(p, largura + 'px');
    ok(p.erros.length === 0, `${largura}px console sem erros` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
