// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o pagos-sem-contato.test.js)
// Fila de conversas sem resposta (item 62 do MELHORIAS.md): filtro "Aguardando resposta" (aberta e última mensagem do
// visitante), ordem por tempo de espera (quem espera há mais tempo primeiro), "aguardando há N min" atualizado a cada minuto
// sem redesenhar a lista (o foco fica), região viva só com o total, resposta do dono tira da fila, nada gravado no banco
// além da resposta; 4 larguras + axe + console limpo + sem rolagem horizontal.
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

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  // Ana espera há 42 min, Bia há 7 min, Caio foi respondido, Davi é fechada com última mensagem do visitante.
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, status) values
      (gen_random_uuid(), '${hash('a')}', 'Ana Espera', 'aberta'),
      (gen_random_uuid(), '${hash('b')}', 'Bia Recente', 'aberta'),
      (gen_random_uuid(), '${hash('c')}', 'Caio Respondido', 'aberta'),
      (gen_random_uuid(), '${hash('d')}', 'Davi Fechada', 'aberta');
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Oi, quanto custa?', now() - interval '42 minutes' from public.conversas where nome = 'Ana Espera';
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Vocês fazem loja?', now() - interval '7 minutes' from public.conversas where nome = 'Bia Recente';
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Olá', now() - interval '2 hours' from public.conversas where nome = 'Caio Respondido';
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'admin', 'Oi Caio!', now() - interval '1 hour' from public.conversas where nome = 'Caio Respondido';
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Obrigado', now() - interval '3 hours' from public.conversas where nome = 'Davi Fechada';
    update public.conversas set status = 'fechada' where nome = 'Davi Fechada';
  `);
  // A conversa mais recente por atualizado_em (Caio) vem primeiro em "Abertas": a fila precisa reordenar.
  psql(`update public.conversas set atualizado_em = now() - interval '1 minute' where nome = 'Caio Respondido';
        update public.conversas set atualizado_em = now() - interval '30 minutes' where nome = 'Ana Espera';
        update public.conversas set atualizado_em = now() - interval '5 minutes' where nome = 'Bia Recente';`);
  const mensagensAntes = psql(`select count(*) from public.mensagens`);

  const browser = await chromium.launch();

  console.log('\n[1] Filtro, contador e ordem (1280 px)');
  const a = await entrar(browser, 1280, true);
  await a.waitForFunction(() => document.querySelector('[data-filtro="aguardando"]').textContent === 'Aguardando resposta (2)');
  ok(true, 'botão mostra o total: Ana e Bia (Caio respondido, Davi fechada)');
  ok((await a.textContent('[data-espera-total]')) === '2 conversas aguardando resposta.', 'região viva com o total');
  ok((await a.getAttribute('[data-espera-total]', 'role')) === 'status', 'contador total com role=status');
  // Selo da aba "Conversas" (melhoria 122): o total que precisa de resposta, visível de qualquer aba.
  const seloAba = await a.$eval('[data-selo-aba="conversas"]', (s) => ({ oculto: s.hidden, visual: s.querySelector('[aria-hidden]') && s.querySelector('[aria-hidden]').textContent, titulo: s.title }));
  ok(!seloAba.oculto && seloAba.visual === '2' && seloAba.titulo === '2 conversas aguardando resposta', 'selo da aba Conversas: 2 (' + JSON.stringify(seloAba) + ')');
  const nomeAba = (await a.$eval('[data-aba-link="conversas"]', (l) => l.textContent.replace(/\s+/g, ' ').trim()));
  ok(nomeAba === 'Conversas 2, 2 aguardando resposta', 'nome da aba para o leitor de tela: "' + nomeAba + '"');
  await a.click('[data-aba-link="pedidos"]');
  ok(await a.isVisible('[data-selo-aba="conversas"]'), 'selo continua visível na aba Pedidos');
  await a.click('[data-aba-link="conversas"]');
  ok((await a.$$('[aria-live], [role=status]')).length > 0 && (await a.$$eval('[data-espera]', (e) => e.every((x) => !x.closest('[aria-live],[role=status],[role=alert]')))),
    'etiquetas "há N min" fora de regiões vivas');
  const abertas = await nomes(a);
  ok(abertas[0] === 'Caio Respondido', 'em "Abertas" a ordem continua pela última atividade');
  const etiquetasAbertas = await a.$$eval('[data-lista-conversas] .admin-item', (els) => els.map((e) => !!e.querySelector('[data-espera]')));
  ok(etiquetasAbertas.filter(Boolean).length === 2, 'etiqueta de espera só nas duas que aguardam');
  await a.click('[data-filtro="aguardando"]');
  ok((await a.getAttribute('[data-filtro="aguardando"]', 'aria-pressed')) === 'true' && (await a.getAttribute('[data-filtro="aberta"]', 'aria-pressed')) === 'false', 'aria-pressed');
  const fila = await nomes(a);
  ok(fila.join(',') === 'Ana Espera,Bia Recente', 'fila ordenada por espera: ' + fila.join(','));
  const esperas = await a.$$eval('[data-espera]', (els) => els.map((e) => e.textContent));
  ok(esperas[0] === 'aguardando há 42 min' && esperas[1] === 'aguardando há 7 min', 'textos relativos: ' + esperas.join(' | '));
  ok(/aguardando há 42 min/.test(await a.getAttribute('[data-lista-conversas] .admin-item >> nth=0', 'aria-label') || await a.textContent('[data-lista-conversas] .admin-item >> nth=0')),
    'tempo de espera faz parte do nome acessível do item');
  ok(/Exportar CSV \(2\)/.test(await a.textContent('[data-exportar-conversas]')), 'exportação coerente com a fila');
  await a.screenshot({ path: SAIDA + '/fila-espera-1280.png' });

  console.log('\n[2] Atualização a cada minuto sem redesenhar (foco preservado)');
  await a.focus('[data-lista-conversas] .admin-item >> nth=1');
  const marca = await a.evaluate(() => { const b = document.activeElement; b.dataset.marca = 'x'; return b.getAttribute('data-id'); });
  const anuncios = await a.evaluate(() => {
    window.__mudancas = 0;
    new MutationObserver((m) => { window.__mudancas += m.length; }).observe(document.querySelector('[data-espera-total]'), { childList: true, characterData: true, subtree: true });
    return true;
  });
  await a.clock.fastForward('01:00');
  await a.waitForFunction(() => document.querySelector('[data-espera]').textContent === 'aguardando há 43 min');
  ok(true, '42 → 43 min depois de 1 minuto');
  ok(await a.evaluate(() => document.activeElement && document.activeElement.dataset.marca === 'x'), 'foco continua no mesmo item (não redesenhou)');
  await a.clock.fastForward('20:00');
  await a.waitForFunction(() => document.querySelector('[data-espera]').textContent === 'aguardando há 1 h 3 min');
  ok(true, 'passa para horas: "há 1 h 3 min"');
  ok(anuncios && (await a.evaluate(() => window.__mudancas)) === 0, 'região viva não anuncia a passagem do tempo');
  ok(marca, 'item focado tinha id');

  console.log('\n[3] Resposta do dono tira a conversa da fila (tempo real)');
  await a.click('[data-lista-conversas] .admin-item:has-text("Bia Recente")');
  await a.waitForSelector('[data-conversa-conteudo]:not([hidden])');
  await a.fill('[data-resposta-texto]', 'Fazemos sim! Posso te explicar?');
  await a.click('[data-resposta-enviar]');
  await a.waitForFunction(() => document.querySelector('[data-filtro="aguardando"]').textContent === 'Aguardando resposta (1)', null, { timeout: 8000 });
  ok(true, 'contador cai para 1');
  ok((await a.textContent('[data-espera-total]')) === '1 conversa aguardando resposta.', 'região viva no singular');
  ok((await a.getAttribute('[data-selo-aba="conversas"]', 'title')) === '1 conversa aguardando resposta', 'selo da aba cai para 1 (singular)');
  ok((await nomes(a)).join(',') === 'Ana Espera', 'fila só com a Ana');
  ok(psql(`select count(*) from public.mensagens`) === String(+mensagensAntes + 1), 'banco: só a resposta do dono foi gravada');

  console.log('\n[4] Nova mensagem de visitante entra na fila');
  psql(`insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Quero sim' from public.conversas where nome = 'Bia Recente';`);
  await a.waitForFunction(() => document.querySelector('[data-filtro="aguardando"]').textContent === 'Aguardando resposta (2)', null, { timeout: 8000 });
  const fila2 = await nomes(a);
  ok(fila2.join(',') === 'Ana Espera,Bia Recente', 'Bia volta ao fim da fila: ' + fila2.join(','));
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ' -> ' + a.erros.join(' | ') : ''));
  // O axe desta página roda no passo 6: com o relógio falso do Playwright a entrada das bolhas fica no meio da transição.
  await a.context().close();

  console.log('\n[5] Fila vazia');
  psql(`update public.conversas set status = 'fechada'`);
  const v = await novaPagina(browser, { viewport: { width: 375, height: 800 } });
  await v.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
  await v.fill('#login-email', 'dono@teste.local');
  await v.fill('#login-senha', 'senha-de-teste');
  await v.click('[data-form-login] button[type=submit]');
  await v.waitForSelector('[data-tela="painel"]:not([hidden])');
  await v.waitForFunction(() => document.querySelector('[data-espera-total]').textContent === 'Nenhuma conversa aguardando resposta.');
  await v.click('[data-filtro="aguardando"]');
  ok(await v.isVisible('[data-lista-vazia]') && (await v.textContent('[data-lista-vazia]')) === 'Nenhuma conversa aguardando resposta.', 'mensagem de fila vazia');
  ok((await v.textContent('[data-filtro="aguardando"]')) === 'Aguardando resposta', 'sem número quando não há fila');
  ok(await v.$eval('[data-selo-aba="conversas"]', (s) => s.hidden && s.textContent === ''), 'selo da aba some quando ninguém espera');
  await v.click('[data-filtro="todas"]');
  ok((await v.textContent('[data-lista-vazia]')) === 'Nenhuma conversa aqui ainda.' && !(await v.isVisible('[data-lista-vazia]')), 'texto padrão volta nos outros filtros');
  ok(v.erros.length === 0, 'console sem erros (fila vazia)');
  await v.context().close();
  psql(`update public.conversas set status = 'aberta' where nome in ('Ana Espera', 'Bia Recente')`);

  console.log('\n[6] Larguras: filtros cabem, sem rolagem horizontal, axe');
  for (const largura of [320, 375, 768, 1280]) {
    const p = await entrar(browser, largura);
    await p.click('[data-filtro="aguardando"]');
    await p.waitForSelector('[data-espera]');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw === largura, `${largura}px sem rolagem horizontal (${sw})`);
    const fora = await p.$$eval('.admin-lista__filtros .admin-filtro', (bs) => bs.filter((b) => { const r = b.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.left < 0; }).length);
    ok(fora === 0, `${largura}px todos os filtros visíveis`);
    const alvo = await p.$eval('[data-filtro="aguardando"]', (b) => { const r = b.getBoundingClientRect(); return r.height >= 24 && r.width >= 24; });
    ok(alvo, `${largura}px alvo de toque do filtro ≥ 24 px`);
    const abas = await p.$$eval('.admin-aba', (as) => as.filter((x) => { const r = x.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.left < 0; }).length);
    ok(abas === 0, `${largura}px abas com o selo cabem na tela`);
    await p.screenshot({ path: `${SAIDA}/fila-espera-${largura}.png` });
    await axe(p, largura + 'px');
    ok(p.erros.length === 0, `${largura}px console sem erros` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
