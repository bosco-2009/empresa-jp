// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o resumo.test.js)
// Tempo de primeira resposta no Resumo (item 88 do MELHORIAS.md): mediana e percentil 90 entre a 1ª mensagem do
// visitante e a 1ª resposta do dono, com horários controlados; "sem dados suficientes" abaixo de 5 respondidas;
// comparação com o mês anterior (menor = melhor); CSV sem dados pessoais; nenhuma consulta nova nem escrita;
// servidor que recusa os horários extras; 4 larguras + axe.
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

async function novaPagina(browser, opcoes, recusarHorarios) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Sao_Paulo' }, opcoes));
  const p = await ctx.newPage();
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.consultas = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  p.on('request', (r) => { if (r.url().startsWith(API + '/rest/')) p.consultas.push(r.method() + ' ' + r.url()); });
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  if (recusarHorarios) {
    // Servidor que não entende os apelidos: o painel deve seguir sem eles.
    await p.route(API + '/rest/v1/conversas?*', (r) => /primeira_visitante/.test(decodeURIComponent(r.request().url()))
      ? r.fulfill({ status: 400, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"code":"PGRST100","message":"teste"}' })
      : r.fallback());
  }
  return p;
}

async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}

async function entrar(browser, opcoes, recusarHorarios) {
  const a = await novaPagina(browser, opcoes, recusarHorarios);
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

// Cartões da primeira resposta: { rotulo: { valor, detalhe, comparacao, direcao } }
function cartoesResposta(a) {
  return a.$$eval('.admin-kpi', (els) => {
    const r = {};
    els.forEach((e) => {
      const rot = e.querySelector('.admin-kpi__rotulo').textContent.trim();
      if (!rot.startsWith('Primeira resposta')) return;
      const seta = e.querySelector('.admin-kpi__seta');
      r[rot] = {
        valor: e.querySelector('.admin-kpi__valor').textContent.trim(),
        detalhe: (e.querySelector('.admin-kpi__detalhe') || {}).textContent || '',
        comparacao: e.querySelector('.admin-kpi__comparacao').textContent.replace(/^[▲▼=] /, '').trim(),
        direcao: seta ? seta.getAttribute('data-direcao') : null
      };
    });
    return r;
  });
}

(async () => {
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  // Meio do mês (no fuso de São Paulo continua no mesmo mês). M = este mês, A = anterior, A2 = retrasado.
  const M = `(date_trunc('month', now()) + interval '10 days 12 hours')`;
  const A = `(date_trunc('month', now()) - interval '1 month' + interval '10 days 12 hours')`;
  const A2 = `(date_trunc('month', now()) - interval '2 months' + interval '10 days 12 hours')`;
  let n = 0;
  // Conversa com a 1ª mensagem do visitante em "base" e as do dono depois de cada intervalo (segundos).
  function conversa(base, nome, respostas, extra) {
    n++;
    const h = String(n).padStart(2, '0').repeat(32);
    return `
      with c as (insert into public.conversas (visitante_id, token_hash, nome, whatsapp, pagina_origem, status, criado_em, atualizado_em)
                 values (gen_random_uuid(), '${h}', '${nome}', null, '/', 'aberta', ${base}, ${base}) returning id)
      insert into public.mensagens (conversa_id, autor, texto, criado_em)
        select id, 'visitante', 'Olá, quero um site', ${base} from c
        ${respostas.map((s) => `union all select id, 'admin', 'Oi! Posso ajudar', ${base} + interval '${s} seconds' from c`).join('\n        ')}
        ${extra ? 'union all ' + extra.replace(/BASE/g, base) : ''};`;
  }
  psql([
    // Este mês: 6 respondidas (45 s, 2, 5, 10, 30 e 90 min) → mediana 7,5 min ≈ 8 min; p90 = 90 min.
    conversa(M, 'Ana', [45]),
    conversa(M, 'Bia', [120, 3600]), // só a 1ª resposta do dono conta
    conversa(M, 'Caio', [300], `select id, 'visitante', 'Mais uma', BASE + interval '200 seconds' from c`),
    conversa(M, 'Davi', [600]),
    conversa(M, 'Eva', [1800]),
    conversa(M, 'Fábio', [5400]),
    conversa(M, 'Gil', []), // sem resposta
    // Mês anterior: 5 respondidas (10, 20, 30, 40, 50 min) → mediana 30 min, p90 50 min.
    conversa(A, 'Hugo', [600]), conversa(A, 'Iris', [1200]), conversa(A, 'Jó', [1800]), conversa(A, 'Kim', [2400]), conversa(A, 'Lia', [3000]),
    // Retrasado: só 2 respondidas → sem dados suficientes.
    conversa(A2, 'Max', [60]), conversa(A2, 'Nina', [120])
  ].join('\n'));
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const anterior = MESES[(agora.getMonth() + 11) % 12];
  const retrasado = MESES[(agora.getMonth() + 10) % 12];
  const marcaMensagens = psql('select count(*) from public.mensagens');

  const browser = await chromium.launch();

  console.log('\n[1] Funções puras: formato, mediana, percentil e comparação');
  const a = await entrar(browser, { viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const puras = await a.evaluate(() => {
    const R = window.PBRAdminResumo;
    return {
      fmt: [30e3, 90e3, 12 * 60e3, 60 * 60e3, 125 * 60e3, 26 * 3600e3, 48 * 3600e3, null].map(R.duracao),
      med: [R.mediana([1, 2, 3]), R.mediana([1, 2, 3, 4]), R.mediana([])],
      p90: [R.percentil([1, 2, 3, 4, 5], 0.9), R.percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), R.percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 0.9)],
      comp: [R.compararTempo(5 * 60e3, 10 * 60e3, { ano: 2026, mes: 9 }), R.compararTempo(null, 60e3, { ano: 2026, mes: 9 }), R.compararTempo(60e3, 60e3, { ano: 2026, mes: 9 })]
    };
  });
  ok(puras.fmt.join('|') === 'menos de 1 min|2 min|12 min|1 h|2 h 5 min|1 d 2 h|2 d|—', 'duração em texto: ' + puras.fmt.join(' | '));
  ok(puras.med.join('|') === '2|2.5|', 'mediana (par = média dos dois do meio): ' + puras.med.join(' | '));
  ok(puras.p90.join('|') === '5|9|10', 'p90 pelo posto mais próximo: ' + puras.p90.join(' | '));
  ok(puras.comp[0].texto === '5 min mais rápido que em outubro (10 min)' && puras.comp[0].direcao === 'melhor' && puras.comp[0].seta === '▼', 'mais rápido = melhor');
  ok(puras.comp[1].texto === 'Em outubro: 1 min' && puras.comp[2].texto === 'Igual a outubro (1 min)', 'sem dados agora / igual');

  console.log('\n[2] Este mês (1280 px): mediana, p90 e comparação');
  const antesResumo = a.consultas.length;
  const sel = a.consultas.find((c) => c.includes('/rest/v1/conversas?') && c.includes('primeira_visitante'));
  ok(!!sel && /primeira_visitante\.autor=eq\.visitante/.test(sel) && /primeira_resposta\.autor=eq\.admin/.test(sel) &&
    /primeira_visitante\.limit=1/.test(sel) && /primeira_resposta\.limit=1/.test(sel), 'a lista de conversas já traz só os horários da 1ª mensagem de cada lado');
  ok(!/primeira_(visitante|resposta):mensagens\([^)]*texto/.test(decodeURIComponent(sel || '')), 'os apelidos não trazem texto de mensagem');
  await a.click('[data-aba-link="resumo"]');
  await a.waitForSelector('.admin-kpi');
  let c = await cartoesResposta(a);
  const med = c['Primeira resposta (mediana)'];
  const p90 = c['Primeira resposta (90%)'];
  ok(med && med.valor === '8 min', 'mediana: ' + (med && med.valor));
  ok(med && med.detalhe === 'Metade respondida nesse tempo · 6 conversas respondidas · 1 sem resposta', 'detalhe: ' + (med && med.detalhe));
  ok(med && med.comparacao === `22 min mais rápido que em ${anterior} (30 min)` && med.direcao === 'melhor', 'comparação da mediana: ' + (med && med.comparacao + ' / ' + med.direcao));
  ok(p90 && p90.valor === '1 h 30 min', 'p90: ' + (p90 && p90.valor));
  ok(p90 && p90.comparacao === `40 min mais lento que em ${anterior} (50 min)` && p90.direcao === 'pior', 'comparação do p90: ' + (p90 && p90.comparacao + ' / ' + p90.direcao));
  const cores = await a.$$eval('.admin-kpi__seta[data-direcao]', (s) => s.map((x) => x.getAttribute('data-direcao') + '=' + getComputedStyle(x).color));
  const corDe = (d) => (cores.find((x) => x.startsWith(d + '=')) || '').split('=')[1];
  ok(corDe('melhor') && corDe('pior') && corDe('melhor') !== corDe('pior'), 'cores diferentes para melhor e pior: ' + cores.join(', '));
  ok(await a.$$eval('.admin-kpi__seta', (s) => s.every((x) => x.getAttribute('aria-hidden') === 'true')), 'setas decorativas (o texto diz tudo)');
  await a.screenshot({ path: SAIDA + '/tempo-resposta-1280.png', fullPage: true });
  await axe(a, 'resumo 1280');

  console.log('\n[3] Mês anterior e retrasado (sem dados suficientes)');
  await a.selectOption('[data-resumo-mes]', { index: 1 });
  c = await cartoesResposta(a);
  ok(c['Primeira resposta (mediana)'].valor === '30 min' && c['Primeira resposta (90%)'].valor === '50 min', 'mês anterior: 30 min e 50 min');
  ok(c['Primeira resposta (mediana)'].comparacao === `Sem dados suficientes em ${retrasado} para comparar`, 'retrasado insuficiente: ' + c['Primeira resposta (mediana)'].comparacao);
  await a.selectOption('[data-resumo-mes]', { index: 2 });
  c = await cartoesResposta(a);
  ok(c['Primeira resposta (mediana)'].valor === '—' && c['Primeira resposta (90%)'].valor === '—', 'retrasado: sem valor');
  ok(c['Primeira resposta (mediana)'].detalhe === 'Sem dados suficientes: 2 conversas respondidas (mínimo 5)', 'retrasado: ' + c['Primeira resposta (mediana)'].detalhe);
  const antesDoRetrasado = MESES[(agora.getMonth() + 9) % 12];
  ok(c['Primeira resposta (mediana)'].comparacao === `Sem dados suficientes em ${antesDoRetrasado} para comparar`, 'nenhum dos dois meses com dados: ' + c['Primeira resposta (mediana)'].comparacao);
  await a.selectOption('[data-resumo-mes]', { index: 5 });
  c = await cartoesResposta(a);
  ok(c['Primeira resposta (mediana)'].detalhe === 'Sem dados suficientes: 0 conversas respondidas (mínimo 5)', 'mês vazio: ' + c['Primeira resposta (mediana)'].detalhe);
  ok(a.consultas.length === antesResumo, 'trocar de aba e de mês não faz consulta ao banco');

  console.log('\n[4] CSV: minutos, sem dados pessoais');
  await a.selectOption('[data-resumo-mes]', { index: 0 });
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('[data-resumo-baixar]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const linhas = csv.replace(/^﻿/, '').split(/\r\n/);
  ok(linhas.includes('"Primeira resposta, mediana (min)";"7,5";"30,0"'), 'mediana em minutos no CSV');
  ok(linhas.includes('"Primeira resposta, 90% em até (min)";"90,0";"50,0"'), 'p90 em minutos no CSV');
  ok(linhas.includes('"Conversas respondidas";"6";"5"') && linhas.includes('"Conversas sem resposta";"1";"0"'), 'contagens no CSV');
  ok(!/Ana|Bia|Gil|Olá|Posso ajudar/.test(csv), 'nenhum nome nem texto de mensagem no CSV');

  console.log('\n[5] Resposta nova do dono chega pelo tempo real');
  // O tempo real do servidor falso avisa mensagens com horário novo: a pergunta da Gil passa a ser de 4 h atrás.
  psql(`begin;
        update public.mensagens set criado_em = now() - interval '4 hours'
         where conversa_id = (select id from public.conversas where nome = 'Gil');
        insert into public.mensagens (conversa_id, autor, texto, criado_em)
          select id, 'admin', 'Desculpe a demora', now() from public.conversas where nome = 'Gil';
        commit;`);
  await a.waitForFunction(() => [...document.querySelectorAll('.admin-kpi__detalhe')].some((e) => e.textContent.includes('7 conversas respondidas')), null, { timeout: 20000 }).catch(() => {});
  c = await cartoesResposta(a);
  ok(/7 conversas respondidas$/.test(c['Primeira resposta (mediana)'].detalhe) && c['Primeira resposta (mediana)'].valor === '10 min' && c['Primeira resposta (90%)'].valor === '4 h',
    'agora 7 respondidas, mediana 10 min e p90 4 h: ' + JSON.stringify(c['Primeira resposta (mediana)']) + ' ' + c['Primeira resposta (90%)'].valor);
  ok(a.consultas.every((q) => q.startsWith('GET ') || /\/rest\/v1\/rpc\//.test(q)), 'o cálculo não grava nada (só leituras)');
  ok(psql('select count(*) from public.mensagens') === String(Number(marcaMensagens) + 1), 'banco só mudou pela mensagem inserida no teste');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ' -> ' + a.erros.join(' | ') : ''));
  await a.close();

  console.log('\n[6] Servidor que recusa os horários extras: lista funciona, cartão explica');
  const f = await entrar(browser, { viewport: { width: 1280, height: 900 } }, true);
  ok((await f.$$('[data-lista-conversas] .admin-item')).length >= 14, 'lista de conversas carregou sem os horários');
  await f.click('[data-aba-link="resumo"]');
  await f.waitForSelector('.admin-kpi');
  const rot = await textos(f, '.admin-kpi__rotulo');
  const val = await textos(f, '.admin-kpi__valor');
  const i = rot.indexOf('Primeira resposta');
  ok(i >= 0 && val[i] === 'Indisponível' && !rot.includes('Primeira resposta (90%)'), 'um cartão "Indisponível": ' + rot.join(', '));
  ok(f.erros.every((e) => /status of 400/.test(e)), 'sem outros erros além do 400 simulado' + (f.erros.length ? ' -> ' + f.erros.join(' | ') : ''));
  await f.close();

  console.log('\n[7] Larguras: sem rolagem horizontal, valores cabem, axe');
  for (const w of [320, 375, 768, 1280]) {
    const p = await entrar(browser, { viewport: { width: w, height: 800 } });
    await p.click('[data-aba-link="resumo"]');
    await p.waitForSelector('.admin-kpi');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw === w, `${w}px: scrollWidth ${sw}`);
    ok(await p.$$eval('.admin-kpi__valor', (els) => els.every((e) => e.scrollWidth <= e.clientWidth)), `${w}px: valores cabem nos cartões`);
    await p.screenshot({ path: SAIDA + `/tempo-resposta-${w}.png`, fullPage: true });
    await axe(p, 'resumo ' + w);
    ok(p.erros.length === 0, `${w}px: console sem erros` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.close();
  }

  await browser.close();
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade;`);
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
