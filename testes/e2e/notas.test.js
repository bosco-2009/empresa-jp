// Uso: veja testes/README.md (servidor Supabase falso + Postgres local, como o exportar.test.js)
// Notas internas (item 27 do MELHORIAS.md): salvamento automático na conversa e no pedido, data da última edição,
// conflito com outra aba (manter/carregar), erro de rede acessível com "Tentar de novo", troca de conversa sem
// perder texto, 4 larguras + axe + console.
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
  const ctx = await browser.newContext(Object.assign({ acceptDownloads: true }, opcoes));
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


const estado = (a, t) => a.textContent(`[data-notas="${t}"] [data-notas-estado]`);
const esperarSalva = (a, t) => a.waitForFunction((tt) => /^Salva · última edição em /.test(document.querySelector(`[data-notas="${tt}"] [data-notas-estado]`).textContent), t, { timeout: 8000 });
const nota = (filtro) => psql(`select texto from public.notas where ${filtro}`);

(async () => {
  psql(`truncate public.notas, public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  psql(`
    insert into public.conversas (id, visitante_id, token_hash, nome, status, atualizado_em) values
      ('11111111-0000-0000-0000-000000000001', gen_random_uuid(), '${hash('a')}', 'Ana', 'aberta', now()),
      ('11111111-0000-0000-0000-000000000002', gen_random_uuid(), '${hash('b')}', 'Beto', 'aberta', now() - interval '1 hour');
    insert into public.mensagens (conversa_id, autor, texto, criado_em) select id, 'visitante', 'Olá', atualizado_em from public.conversas;
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em) values
      ('PBR-NNNNN2', '${hash('c')}', 'essencial', 'Essencial', 49700, 'Carla Nota', 'carla@teste.local', '11977776666', now(), 'aprovado', now() - interval '2 hours', now() - interval '1 hour');
  `);
  const ANA = "conversa_id = '11111111-0000-0000-0000-000000000001'";
  const BETO = "conversa_id = '11111111-0000-0000-0000-000000000002'";

  const browser = await chromium.launch();

  console.log('\n[1] Conversa sem nota: fechada, selo oculto; escrever salva sozinho');
  const a = await entrar(browser, 1280);
  await a.click('[data-lista-conversas] .admin-item:has-text("Ana")');
  await a.waitForFunction(() => /^Nenhuma nota ainda/.test(document.querySelector('[data-notas="conversa"] [data-notas-estado]').textContent));
  ok(!(await a.$eval('[data-notas="conversa"]', (d) => d.open)), 'sem nota: bloco começa fechado');
  ok(await a.isHidden('[data-notas="conversa"] [data-notas-selo]'), 'sem nota: sem selo');
  await a.click('[data-notas="conversa"] summary');
  await a.fill('#notas-conversa-texto', 'Quer loja com Pix.\nLigar sexta & 18h <b>');
  ok(/não salvas/.test(await estado(a, 'conversa')), 'mostra "Alterações ainda não salvas…"');
  await esperarSalva(a, 'conversa');
  ok(nota(ANA) === 'Quer loja com Pix.\nLigar sexta & 18h <b>', 'gravada no banco (texto exato)');
  ok(await a.isVisible('[data-notas="conversa"] [data-notas-selo]'), 'selo "com nota" aparece');
  ok((await a.getAttribute('#notas-conversa-texto', 'aria-describedby')) === 'notas-conversa-estado' &&
     (await a.getAttribute('#notas-conversa-estado', 'role')) === 'status', 'estado ligado ao campo e em role=status');
  await axe(a, 'conversa com nota');
  await a.screenshot({ path: SAIDA + '/notas-conversa-1280.png' });

  console.log('\n[2] Trocar de conversa logo depois de digitar não perde o texto');
  await a.fill('#notas-conversa-texto', 'Quer loja com Pix. Orçamento enviado.');
  await a.click('[data-lista-conversas] .admin-item:has-text("Beto")');
  await a.waitForFunction(() => /^Nenhuma nota ainda/.test(document.querySelector('[data-notas="conversa"] [data-notas-estado]').textContent));
  await a.waitForTimeout(500);
  ok(nota(ANA) === 'Quer loja com Pix. Orçamento enviado.', 'nota da Ana salva ao trocar');
  ok((await a.inputValue('#notas-conversa-texto')) === '', 'campo do Beto vazio');
  await a.click('[data-notas="conversa"] summary');
  await a.fill('#notas-conversa-texto', 'Beto: só quer saber prazo');
  await a.press('#notas-conversa-texto', 'Tab'); // sair do campo salva na hora
  await esperarSalva(a, 'conversa');
  ok(nota(BETO) === 'Beto: só quer saber prazo', 'salva ao sair do campo');

  console.log('\n[3] Recarregar: nota aparece aberta com a data');
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('[data-tela="painel"]:not([hidden])');
  await a.waitForSelector('[data-lista-conversas] .admin-item');
  await a.click('[data-lista-conversas] .admin-item:has-text("Ana")');
  await esperarSalva(a, 'conversa');
  ok((await a.inputValue('#notas-conversa-texto')) === 'Quer loja com Pix. Orçamento enviado.', 'texto carregado');
  ok(await a.$eval('[data-notas="conversa"]', (d) => d.open), 'com nota: bloco aberto');

  console.log('\n[4] Conflito com outra aba: carregar a versão salva / manter a minha');
  psql(`update public.notas set texto = 'Versão do celular', atualizado_em = now() + interval '1 minute' where ${ANA}`);
  await a.fill('#notas-conversa-texto', 'Versão do computador');
  await a.waitForSelector('[data-notas="conversa"] [data-notas-problema]:not([hidden])', { timeout: 8000 });
  ok(/alterada em outra aba ou aparelho/.test(await a.textContent('[data-notas="conversa"] [data-notas-erro]')), 'aviso de conflito (role=alert)');
  ok(await a.isVisible('[data-notas-acao="manter"] >> nth=0') && await a.isVisible('[data-notas="conversa"] [data-notas-acao="recarregar"]'), 'botões manter/carregar');
  ok(nota(ANA) === 'Versão do celular', 'conflito não sobrescreveu');
  await axe(a, 'conflito');
  await a.screenshot({ path: SAIDA + '/notas-conflito-1280.png' });
  await a.click('[data-notas="conversa"] [data-notas-acao="recarregar"]');
  await esperarSalva(a, 'conversa');
  ok((await a.inputValue('#notas-conversa-texto')) === 'Versão do celular', '"Carregar a versão salva" traz o texto do banco');
  psql(`update public.notas set texto = 'Outra mudança', atualizado_em = now() + interval '2 minutes' where ${ANA}`);
  await a.fill('#notas-conversa-texto', 'A minha vale');
  await a.waitForSelector('[data-notas="conversa"] [data-notas-problema]:not([hidden])', { timeout: 8000 });
  await a.click('[data-notas="conversa"] [data-notas-acao="manter"]');
  await esperarSalva(a, 'conversa');
  ok(nota(ANA) === 'A minha vale', '"Manter a minha versão" grava por cima');

  console.log('\n[5] Falha de rede: texto preservado e "Tentar de novo"');
  await a.route('**/rest/v1/rpc/nota_salvar', (r) => r.abort());
  await a.fill('#notas-conversa-texto', 'Escrito sem internet');
  await a.waitForSelector('[data-notas="conversa"] [data-notas-acao="tentar"]:not([hidden])', { timeout: 8000 });
  ok(/Não foi possível salvar/.test(await a.textContent('[data-notas="conversa"] [data-notas-erro]')), 'aviso de erro');
  ok((await a.inputValue('#notas-conversa-texto')) === 'Escrito sem internet', 'texto continua no campo');
  await a.unroute('**/rest/v1/rpc/nota_salvar');
  await a.click('[data-notas="conversa"] [data-notas-acao="tentar"]');
  await esperarSalva(a, 'conversa');
  ok(nota(ANA) === 'Escrito sem internet', '"Tentar de novo" salva');
  // erros de rede simulados aparecem no console do navegador: descartados, só eles
  a.erros = a.erros.filter((e) => !/Failed to load resource|ERR_FAILED|nota_salvar/.test(e));

  console.log('\n[6] Nota do pedido');
  await a.click('[data-aba-link="pedidos"]');
  await a.waitForSelector('[data-lista-pedidos] .admin-item');
  await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-NNNNN2")');
  await a.waitForFunction(() => /^Nenhuma nota ainda/.test(document.querySelector('[data-notas="pedido"] [data-notas-estado]').textContent));
  await a.click('[data-notas="pedido"] summary');
  await a.fill('#notas-pedido-texto', 'Pediu domínio .com.br');
  await esperarSalva(a, 'pedido');
  ok(psql(`select n.texto from public.notas n join public.pedidos p on p.id = n.pedido_id where p.codigo = 'PBR-NNNNN2'`) === 'Pediu domínio .com.br', 'nota do pedido gravada');
  await axe(a, 'pedido com nota');
  await a.screenshot({ path: SAIDA + '/notas-pedido-1280.png' });
  ok(a.erros.length === 0, 'console sem erros' + (a.erros.length ? ': ' + a.erros.join(' | ') : ''));
  await a.context().close();

  console.log('\n[7] Larguras 320, 375 e 768 px');
  for (const w of [320, 375, 768]) {
    const p = await entrar(browser, w);
    await p.click('[data-lista-conversas] .admin-item:has-text("Ana")');
    await esperarSalva(p, 'conversa');
    let sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px conversa sem rolagem horizontal (${sw})`);
    await axe(p, `${w}px conversa`);
    await p.screenshot({ path: SAIDA + `/notas-conversa-${w}.png` });
    await p.click('[data-aba-link="pedidos"]');
    await p.waitForSelector('[data-lista-pedidos] .admin-item');
    await p.click('[data-lista-pedidos] .admin-item');
    await esperarSalva(p, 'pedido');
    sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${w}px pedido sem rolagem horizontal (${sw})`);
    await axe(p, `${w}px pedido`);
    await p.screenshot({ path: SAIDA + `/notas-pedido-${w}.png` });
    ok(p.erros.length === 0, `${w}px console sem erros` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
