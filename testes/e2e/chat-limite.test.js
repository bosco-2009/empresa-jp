// Uso: veja testes/README.md (precisa do Supabase falso, do Postgres e do servidor estático)
// Melhoria 96 — limite de mensagens do chat por visitante, aplicado no servidor (chat_enviar):
// passou de 8 mensagens no minuto, o widget mostra "Aguarde um pouco antes de enviar de novo" no
// role="alert", mantém o texto digitado, nada é gravado; quando a janela expira o envio volta a funcionar
// e o aviso some. 4 larguras, axe, console limpo (inclusive CSP) e sem rolagem horizontal.
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const AXE = require.resolve('axe-core/axe.min.js');
const RAIZ = require('path').resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

const configOriginal = fs.readFileSync(RAIZ + '/config.js', 'utf8');
const configTeste = configOriginal
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`)
  .replace("{ dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' },", "{ dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '23:59' },");
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

function psql(sql) {
  return execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
}
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
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
  ok(v.length === 0, `axe sem violações sérias/críticas (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}

const LARGURAS = [320, 375, 768, 1280];

(async () => {
  const browser = await chromium.launch();
  for (const largura of LARGURAS) {
    console.log(`\n[${largura}px] limite por minuto no chat`);
    psql('truncate public.mensagens, public.conversas cascade; delete from realtime.enviados;');
    const p = await novaPagina(browser, { viewport: { width: largura, height: 780 } });
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await p.evaluate(() => window.scrollTo(0, 1200));
    await p.click('.chat__lancador');
    await p.waitForSelector('#chat-painel:not([hidden])');

    // 1ª mensagem cria a conversa pela interface
    await p.fill('#chat-texto', 'Olá, quero um site.');
    await p.press('#chat-texto', 'Enter');
    await p.waitForSelector('.chat__bolha--visitante');
    // mais 7 mensagens do visitante no último minuto, gravadas direto (total 8 = o limite)
    psql(`insert into public.mensagens (conversa_id, autor, texto)
          select id, 'visitante', 'anterior ' || g from public.conversas, generate_series(1, 7) g;`);

    await p.fill('#chat-texto', 'Mais uma pergunta rápida');
    await p.press('#chat-texto', 'Enter');
    await p.waitForSelector('.chat__erro:not([hidden])', { timeout: 5000 });
    const alerta = p.getByRole('alert');
    ok(await alerta.count() === 1, 'um único role="alert" visível');
    ok((await alerta.textContent()).includes('Aguarde um pouco antes de enviar de novo'), 'aviso "Aguarde um pouco antes de enviar de novo"');
    ok(await p.locator('.chat__tentar').isHidden(), 'sem botão "Tentar de novo" (não é falha de rede)');
    ok((await p.inputValue('#chat-texto')) === 'Mais uma pergunta rápida', 'texto recusado continua no campo');
    ok(!(await p.locator('.chat__enviar').isDisabled()), 'botão de enviar volta a ficar disponível');
    ok(Number(psql("select count(*) from public.mensagens where autor = 'visitante'")) === 8, 'banco não gravou a 9ª mensagem');
    ok(await p.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth), 'sem rolagem horizontal');
    await axe(p, `aviso visível a ${largura}px`);
    await p.screenshot({ path: `${SAIDA}/chat-limite-${largura}.png` });

    // janela de 1 minuto expirada: o mesmo texto agora é aceito e o aviso some
    psql("update public.mensagens set criado_em = now() - interval '61 seconds';");
    await p.press('#chat-texto', 'Enter');
    await p.waitForFunction(() => [...document.querySelectorAll('.chat__bolha--visitante')].some((b) => b.textContent.includes('Mais uma pergunta rápida')), null, { timeout: 5000 });
    ok(await p.locator('.chat__erro').isHidden(), 'depois da janela: aviso some e a mensagem é enviada');
    ok((await p.inputValue('#chat-texto')) === '', 'campo limpo depois do envio aceito');

    // a recusa do servidor é um 400 esperado (o navegador registra o recurso); nada além disso
    const recusas = p.erros.filter((e) => /status of 400/.test(e));
    const outros = p.erros.filter((e) => !/status of 400/.test(e));
    ok(recusas.length === 1, 'exatamente uma recusa 400 (a 9ª mensagem)');
    ok(outros.length === 0, 'console sem erros de JS/CSP' + (outros.length ? ' -> ' + outros.slice(0, 3).join(' | ') : ''));
    await p.context().close();
  }
  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DO LIMITE DE MENSAGENS PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
