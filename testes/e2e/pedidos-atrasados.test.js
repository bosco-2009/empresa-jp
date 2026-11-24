// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o pagos-sem-contato.test.js)
// Pedidos parados em produção (item 83 do MELHORIAS.md): etiqueta "Atrasado" quando o briefing foi recebido há mais dias
// úteis do que o prazo do plano (config.planos[].prazoDias ou os "N dias úteis" do texto de prazo) e o site não foi
// entregue; filtro "Atrasados", linha "Prazo de entrega" no detalhe, cartão no Resumo, nada gravado no banco pelo cálculo.
// Datas controladas: os briefings são gravados N dias úteis antes de hoje (fuso de São Paulo, o mesmo do navegador).
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
  .replace('Entrega em até 20 dias úteis após o briefing', 'Prazo combinado depois do briefing')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

function psql(sql) {
  return execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
}
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, opcoes) {
  const ctx = await browser.newContext(Object.assign({ acceptDownloads: true, timezoneId: 'America/Sao_Paulo' }, opcoes));
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
  await p.mouse.move(0, 0); // ponteiro parado sobre um botão em transição de hover confunde o cálculo de contraste
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

const textos = (a, s) => a.$$eval(s, (els) => els.map((e) => e.textContent.trim()));

// Data N dias úteis antes de hoje em São Paulo, às 10:00 (-03).
function uteisAtras(n) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const d = new Date(hoje + 'T12:00:00Z');
  for (let i = 0; i < n;) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) i++;
  }
  return d.toISOString().slice(0, 10) + ' 10:00:00-03';
}

(async () => {
  if (configTeste.includes('Entrega em até 20 dias úteis')) throw new Error('troca do prazo do Premium falhou');
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  const pedido = (cod, h, plano, nome, valor, cliente) =>
    `('${cod}', '${hash(h)}', '${plano}', '${nome}', ${valor}, '${cliente}', '${cod.toLowerCase()}@teste.local', '11911112222', now(), 'aprovado', now() - interval '60 days', now() - interval '59 days')`;
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, status) values (gen_random_uuid(), '${hash('0')}', 'Visitante', 'aberta');
    insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Olá' from public.conversas;
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em) values
      ${pedido('PBR-AAAAA2', 'a', 'essencial', 'Essencial', 49700, 'Ana Hoje')},
      ${pedido('PBR-BBBBB2', 'b', 'essencial', 'Essencial', 49700, 'Bruno Um Dia')},
      ${pedido('PBR-CCCCC3', 'c', 'profissional', 'Profissional', 99700, 'Carla Dois Dias')},
      ${pedido('PBR-DDDDD4', 'd', 'essencial', 'Essencial', 49700, 'Davi Entregue')},
      ${pedido('PBR-EEEEE5', 'e', 'premium', 'Premium', 179700, 'Eva Sem Prazo')},
      ${pedido('PBR-FFFFF6', 'f', 'essencial', 'Essencial', 49700, 'Fábio Sem Briefing')};
    insert into public.briefings (pedido_id, nome_negocio, status, criado_em) select id, 'Negócio ' || nome,
      case codigo when 'PBR-DDDDD4' then 'entregue' when 'PBR-CCCCC3' then 'em_producao' else 'novo' end,
      case codigo
        when 'PBR-AAAAA2' then '${uteisAtras(7)}'::timestamptz
        when 'PBR-BBBBB2' then '${uteisAtras(8)}'::timestamptz
        when 'PBR-CCCCC3' then '${uteisAtras(17)}'::timestamptz
        when 'PBR-DDDDD4' then '${uteisAtras(30)}'::timestamptz
        else '${uteisAtras(60)}'::timestamptz end
      from public.pedidos where codigo <> 'PBR-FFFFF6';
  `);
  const registroAntes = (await (await fetch(API + '/__registro')).json()).length;
  const browser = await chromium.launch();

  console.log('\n[1] Cálculo do prazo (dias úteis, fins de semana, prazoDias)');
  const a = await entrar(browser, 1280);
  const calc = await a.evaluate(() => {
    const P = window.PBRAdminPedidos.prazo;
    const cfg = [
      { id: 'teste-dias', prazoDias: 5, prazo: 'Entrega em até 9 dias úteis' },
      { id: 'teste-texto', prazo: 'Entrega em até 12 dias úteis após o briefing' },
      { id: 'teste-corridos', prazo: 'Entrega em 10 dias' }
    ];
    const r = {
      essencial: P.prazoDiasDe('essencial'), profissional: P.prazoDiasDe('profissional'), premium: P.prazoDiasDe('premium'),
      dias: P.prazoDiasDe('teste-dias', cfg), texto: P.prazoDiasDe('teste-texto', cfg), corridos: P.prazoDiasDe('teste-corridos', cfg), nenhum: P.prazoDiasDe('nao-existe'),
      // sexta 13/11/2026 → quarta 25/11/2026: 16–20 (5) + 23–25 (3) = 8 dias úteis
      sextaAQuarta: P.diasUteisDesde('2026-11-13T15:00:00-03:00', new Date('2026-11-25T09:00:00-03:00')),
      // sábado → segunda: 1; mesmo dia: 0
      sabadoASegunda: P.diasUteisDesde('2026-11-21T15:00:00-03:00', new Date('2026-11-23T09:00:00-03:00')),
      mesmoDia: P.diasUteisDesde('2026-11-24T08:00:00-03:00', new Date('2026-11-24T20:00:00-03:00')),
      vence: P.vencimento('2026-11-13T15:00:00-03:00', 7).toDateString()
    };
    return r;
  });
  ok(calc.essencial === 7 && calc.profissional === 15, 'prazo lido dos "N dias úteis" do config (7 e 15)');
  ok(calc.premium === null && calc.corridos === null && calc.nenhum === null, 'sem número confiável (ou dias corridos) não há prazo');
  ok(calc.dias === 5 && calc.texto === 12, 'prazoDias tem prioridade sobre o texto');
  ok(calc.sextaAQuarta === 8 && calc.sabadoASegunda === 1 && calc.mesmoDia === 0, 'contagem pula sábado e domingo e não conta o dia do briefing');
  ok(calc.vence === new Date(2026, 10, 24).toDateString(), 'vencimento: 7º dia útil depois de sexta 13/11 = terça 24/11');

  console.log('\n[2] Lista: filtro "Atrasados" e etiquetas (1280 px)');
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  await a.waitForFunction(() => document.querySelector('[data-filtro-pedido="atrasado"]').textContent === 'Atrasados (2)');
  ok(true, 'contador: Bruno (1 dia útil) e Carla (2 dias úteis)');
  const tags = await a.$$eval('.admin-item__tag--alerta', (els) => els.map((e) => e.closest('.admin-item').querySelector('.admin-item__nome').textContent.slice(0, 10) + '|' + e.textContent));
  ok(tags.length === 2 && tags.includes('PBR-BBBBB2|Atrasado · 1 dia útil') && tags.includes('PBR-CCCCC3|Atrasado · 2 dias úteis'), 'etiquetas: ' + tags.join(', '));
  await a.click('[data-filtro-pedido="atrasado"]');
  ok((await a.getAttribute('[data-filtro-pedido="atrasado"]', 'aria-pressed')) === 'true', 'botão com aria-pressed');
  ok((await textos(a, '[data-lista-pedidos] .admin-item__nome')).length === 2, 'filtro mostra só os dois');
  await a.screenshot({ path: SAIDA + '/atrasados-lista-1280.png' });

  console.log('\n[3] Detalhe: linha "Prazo de entrega"');
  const prazo = async (cod) => {
    await a.click(`[data-lista-pedidos] .admin-item:has-text("${cod}")`);
    await a.waitForFunction((c) => document.querySelector('[data-pedido-titulo]').textContent.startsWith(c), cod);
    return a.$$eval('[data-pedido-dados] dt', (dts) => {
      const dt = dts.find((d) => d.textContent === 'Prazo de entrega');
      return dt ? dt.nextElementSibling.textContent : null;
    });
  };
  const pc = await prazo('PBR-CCCCC3');
  ok(/^15 dias úteis após o briefing · vence em \d\d\/\d\d\/2026 · atrasado há 2 dias úteis$/.test(pc || ''), 'Carla: ' + pc);
  await axe(a, 'detalhe atrasado');
  await a.screenshot({ path: SAIDA + '/atrasados-detalhe-1280.png' });
  await a.click('[data-filtro-pedido="todos"]');
  const pa = await prazo('PBR-AAAAA2');
  ok(/· vence hoje$/.test(pa || ''), 'Ana (7º dia útil hoje): ' + pa);
  ok((await prazo('PBR-DDDDD4')) === null, 'site entregue: sem linha de prazo');
  ok((await prazo('PBR-EEEEE5')) === null, 'plano sem prazo numérico: sem linha de prazo');
  ok((await prazo('PBR-FFFFF6')) === null, 'sem briefing: sem linha de prazo');
  ok(!(await a.$$eval('.admin-item__tag--alerta', (els) => els.map((e) => e.closest('.admin-item').textContent).join(' '))).match(/PBR-(AAAAA2|DDDDD4|EEEEE5|FFFFF6)/), 'nenhuma etiqueta nos que não atrasaram');

  console.log('\n[4] Resumo: cartão "Pedidos atrasados"');
  await a.click('[data-aba-link="resumo"]');
  await a.waitForSelector('[data-resumo-cartoes] .admin-kpi');
  const kpi = await a.$$eval('.admin-kpi', (els) => els.map((e) => e.querySelector('.admin-kpi__rotulo').textContent + '=' + e.querySelector('.admin-kpi__valor').textContent));
  ok(kpi.includes('Pedidos atrasados=2'), 'cartão com 2: ' + kpi.join(', '));
  await axe(a, 'resumo');
  await a.screenshot({ path: SAIDA + '/atrasados-resumo-1280.png', fullPage: true });

  console.log('\n[5] O dono entrega um site: o atraso some');
  ok(!(await (await fetch(API + '/__registro')).json()).slice(registroAntes).some((x) => x.insert || x.patch), 'nenhuma escrita no banco pelo cálculo');
  await a.click('[data-aba-link="pedidos"]');
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-BBBBB2")');
  await a.waitForSelector('[data-pedido-etapa-select]:visible');
  await a.selectOption('[data-pedido-etapa-select]', 'entregue');
  await a.waitForFunction(() => document.querySelector('[data-filtro-pedido="atrasado"]').textContent === 'Atrasados (1)');
  ok(true, 'contador cai para 1');
  await a.click('[data-aba-link="resumo"]');
  await a.waitForFunction(() => [...document.querySelectorAll('.admin-kpi')].some((e) => e.textContent.startsWith('Pedidos atrasados1')));
  ok(true, 'Resumo acompanha (1)');
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[6] Larguras 320, 375 e 768 px');
  for (const w of [320, 375, 768]) {
    const p = await entrar(browser, w);
    await p.click('[data-aba-link="pedidos"]');
    await p.waitForSelector('[data-lista-pedidos] .admin-item');
    await p.waitForFunction(() => document.querySelector('[data-filtro-pedido="atrasado"]').textContent === 'Atrasados (1)');
    await p.click('[data-filtro-pedido="atrasado"]');
    let sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px lista sem rolagem horizontal (${sw})`);
    await p.screenshot({ path: SAIDA + `/atrasados-lista-${w}.png`, fullPage: true });
    await p.click('[data-lista-pedidos] .admin-item:has-text("PBR-CCCCC3")');
    await p.waitForFunction(() => document.querySelector('[data-pedido-titulo]').textContent.startsWith('PBR-CCCCC3'));
    sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px detalhe sem rolagem horizontal (${sw})`);
    await axe(p, `${w}px detalhe`);
    await p.screenshot({ path: SAIDA + `/atrasados-detalhe-${w}.png`, fullPage: true });
    ok(p.erros.length === 0, `${w}px console sem erros` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
