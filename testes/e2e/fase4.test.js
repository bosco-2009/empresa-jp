// Uso: veja testes/README.md
// Fase 4 de ponta a ponta: termos, privacidade, portfólio, briefing (com upload real para o Storage falso,
// Postgres com RLS real) e aba Briefings do painel.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const MP = 'http://localhost:' + (process.env.PORTA_MP || 54400);
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const AXE = require.resolve('axe-core/axe.min.js');
const RAIZ = path.resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

const configOriginal = fs.readFileSync(RAIZ + '/config.js', 'utf8');
const configTeste = configOriginal
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
const configComProjeto = configTeste.replace('projetos: []',
  "projetos: [{ nome: 'Projeto de teste', segmento: 'Teste', url: 'https://example.com', imagem: 'assets/img/og-image.png', alt: 'Captura do projeto de teste' }]");
const configComDados = configTeste
  .replace("razaoSocial: '',", "razaoSocial: 'Empresa Teste Ltda',")
  .replace("email: '' //", "email: 'contato@teste.local' //");
if (!configTeste.includes(API) || configComProjeto === configTeste || configComDados === configTeste) throw new Error('substituição do config falhou');

const psql = (sql) => execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function novaPagina(browser, opcoes, cfg) {
  const ctx = await browser.newContext(opcoes);
  const p = await ctx.newPage();
  // a abertura de marca tem teste próprio (movimento.test.js); aqui ela é marcada como já vista
  await p.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  // axe servido como arquivo da mesma origem (a CSP das páginas bloqueia scripts inline)
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js', (r) => r.fulfill({ body: cfg || configTeste, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  return p;
}
async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}
const semRolagem = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function comprar(browser, resultado, dados) {
  const p = await novaPagina(browser, { viewport: { width: 375, height: 800 } });
  await p.goto(SITE + 'planos.html?plano=profissional', { waitUntil: 'networkidle' });
  await p.fill('#checkout-nome', dados.nome);
  await p.fill('#checkout-email', dados.email);
  await p.fill('#checkout-whatsapp', dados.whatsapp);
  await p.check('#checkout-aceite');
  await Promise.all([p.waitForURL(MP + '/checkout**'), p.click('[data-botao-pagar]')]);
  const rotulo = { aprovado: 'Pagar com cartão (aprovar)', pendente: 'Gerar Pix (pendente)' }[resultado];
  await Promise.all([p.waitForURL('**/obrigado.html**'), p.click(`button:has-text("${rotulo}")`)]);
  await p.waitForFunction((e) => document.querySelector('[data-resultado]').getAttribute('data-estado') === e, resultado === 'aprovado' ? 'aprovado' : 'pendente', { timeout: 15000 });
  return p;
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

(async () => {
  psql('truncate public.pedidos cascade; delete from storage.objects; delete from realtime.enviados;');
  const browser = await chromium.launch();

  console.log('\n[1] Termos e privacidade');
  for (const pagina of ['termos.html', 'privacidade.html']) {
    for (const w of [320, 1280]) {
      const p = await novaPagina(browser, { viewport: { width: w, height: 800 } });
      await p.goto(SITE + pagina, { waitUntil: 'networkidle' });
      ok(await semRolagem(p), `${pagina} sem rolagem horizontal em ${w}px`);
      if (w === 320) {
        const texto = await p.textContent('main');
        ok(texto.includes('[PROVISÓRIO: razão social]') && texto.includes('[PROVISÓRIO: CNPJ]') && texto.includes('[PROVISÓRIO: e-mail]'),
          `${pagina}: dados do dono ausentes aparecem como [PROVISÓRIO]`);
        ok(await p.locator('h1').count() === 1, `${pagina}: um único h1`);
        await axe(p, pagina);
      }
      ok(p.erros.length === 0, `${pagina} console limpo em ${w}px` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
      await p.context().close();
    }
  }
  {
    const p = await novaPagina(browser, { viewport: { width: 1280, height: 800 } }, configComDados);
    await p.goto(SITE + 'termos.html', { waitUntil: 'networkidle' });
    const t = await p.textContent('main');
    ok(t.includes('Empresa Teste Ltda') && !t.includes('[PROVISÓRIO: razão social]'), 'termos: razão social vem do config.js');
    ok((await p.getAttribute('[data-cfg-email] a', 'href')) === 'mailto:contato@teste.local', 'termos: e-mail do controlador vem do config.js');
    ok(t.includes('7 (sete) dias') && t.includes('art. 49'), 'termos: direito de arrependimento (CDC art. 49)');
    ok(await p.locator('[data-cfg-planos] li').count() === 3 && t.includes('Profissional') && t.includes('997'), 'termos: planos, preços e prazos do config.js');
    ok(t.includes('por conta do cliente') && t.includes('é seu'), 'termos: domínio/hospedagem por conta do cliente e propriedade do site');
    ok(/30.{0,5}dias/.test(t) && t.includes('Depois desse prazo'), 'termos: suporte e cancelamento após 7 dias vindos do config.legal');
    await p.goto(SITE + 'privacidade.html', { waitUntil: 'networkidle' });
    const pr = await p.textContent('main');
    for (const trecho of ['Chat ao vivo', 'Pedido', 'Briefing', 'art. 7º', 'Supabase', 'Mercado Pago', 'art. 18', 'ANPD', '12 meses', '5 anos', 'localStorage']) {
      ok(pr.includes(trecho), `privacidade cita: ${trecho}`);
    }
    await p.screenshot({ path: SAIDA + '/privacidade-1280.png', fullPage: false });
    await p.context().close();
  }

  console.log('\n[2] Links legais e portfólio');
  {
    const p = await novaPagina(browser, { viewport: { width: 375, height: 800 } });
    for (const pagina of ['', 'planos.html', 'obrigado.html', 'briefing.html', 'termos.html', 'privacidade.html', 'portfolio.html']) {
      await p.goto(SITE + pagina, { waitUntil: 'domcontentloaded' });
      const links = await p.$$eval('footer a', (as) => as.map((a) => a.getAttribute('href')));
      ok(links.includes('termos.html') && links.includes('privacidade.html'), `rodapé de /${pagina} com termos e privacidade`);
    }
    await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
    ok((await p.getAttribute('label[for=checkout-aceite] a:nth-of-type(1)', 'href')) === 'termos.html' &&
       (await p.getAttribute('label[for=checkout-aceite] a:nth-of-type(2)', 'href')) === 'privacidade.html', 'aceite do checkout aponta para termos e privacidade');
    await p.goto(SITE, { waitUntil: 'networkidle' });
    ok(await p.locator('[data-link-portfolio]').first().isHidden(), 'sem projetos: link "Portfólio" oculto no menu');
    await p.goto(SITE + 'portfolio.html', { waitUntil: 'networkidle' });
    ok(await p.locator('[data-portfolio-vazio]').isVisible() && await p.locator('[data-lista-portfolio] li').count() === 0, 'portfolio.html sem projetos: mensagem "em breve"');
    await axe(p, 'portfolio vazio');
    await p.context().close();

    const q = await novaPagina(browser, { viewport: { width: 1280, height: 800 } }, configComProjeto);
    await q.goto(SITE, { waitUntil: 'networkidle' });
    ok(await q.locator('.topo__links [data-link-portfolio]').isVisible(), 'com projeto: link "Portfólio" aparece no menu');
    await q.goto(SITE + 'portfolio.html', { waitUntil: 'networkidle' });
    ok(await q.locator('[data-lista-portfolio] li').count() === 1 && await q.locator('[data-portfolio-vazio]').isHidden(), 'portfolio.html lista o projeto do config.js');
    ok((await q.getAttribute('[data-lista-portfolio] img', 'alt')) === 'Captura do projeto de teste' && (await q.getAttribute('[data-lista-portfolio] a', 'href')) === 'https://example.com', 'projeto com imagem, alt e link');
    ok(await semRolagem(q), 'portfolio sem rolagem horizontal');
    await axe(q, 'portfolio com projeto');
    await q.context().close();
  }

  console.log('\n[3] Briefing: compra aprovada → obrigado → briefing em etapas');
  const c = await comprar(browser, 'aprovado', { nome: 'Iara Lopes', email: 'iara@exemplo.com', whatsapp: '11922221111' });
  ok(await c.locator('[data-link-briefing]').isVisible(), 'obrigado.html (aprovado): botão "Preencher o briefing agora"');
  const linkOutro = await c.inputValue('#link-briefing');
  ok(/briefing\.html#c=PBR-[A-Z2-9]{6}&t=[0-9a-f]{64}$/.test(linkOutro), 'link pessoal para outro aparelho, com o token só no fragmento (#)');
  const codigo = /c=(PBR-[A-Z2-9]{6})/.exec(linkOutro)[1];
  await axe(c, 'obrigado com link do briefing');
  await c.click('[data-link-briefing]');
  await c.waitForSelector('[data-form-briefing]:not([hidden])');
  ok((await c.textContent('[data-briefing-pedido]')).includes(codigo), 'briefing abre com o pedido do navegador');
  ok(await semRolagem(c), 'briefing sem rolagem horizontal (375px)');
  await axe(c, 'briefing etapa 1');

  await c.click('[data-etapa-proxima]');
  ok(await c.evaluate(() => document.activeElement.id) === 'b-nome_negocio' && await c.isVisible('#b-nome_negocio-erro'), 'etapa 1: nome do negócio obrigatório');
  await c.fill('#b-nome_negocio', 'Ateliê da Iara');
  await c.fill('#b-segmento', 'Costura sob medida');
  await c.fill('#b-cidade', 'Santos/SP');
  await c.click('[data-etapa-proxima]');
  ok(await c.isVisible('[data-etapa="2"]') && await c.evaluate(() => document.activeElement.classList.contains('briefing__legenda')), 'etapa 2: foco no título da etapa');
  await c.fill('#b-objetivo', 'Receber pedidos de ajustes pelo WhatsApp');
  await c.fill('#b-referencias-1', 'exemplo.com');
  await c.click('[data-etapa-proxima]');
  ok(await c.isVisible('#b-referencias-1-erro'), 'etapa 2: link sem https:// é recusado');
  await c.fill('#b-referencias-1', 'https://exemplo.com/inspiracao');
  await c.click('[data-etapa-proxima]');
  await c.fill('#b-textos_servicos', 'Ajustes de roupas\nVestidos sob medida');
  await c.fill('#b-contatos_redes', 'Instagram @ateliedaiara');

  // recarregar no meio: rascunho local preservado
  await c.reload({ waitUntil: 'networkidle' });
  await c.waitForSelector('[data-form-briefing]:not([hidden])');
  ok((await c.inputValue('#b-nome_negocio')) === 'Ateliê da Iara' && (await c.inputValue('#b-textos_servicos')).includes('Vestidos'), 'rascunho restaurado depois de recarregar');
  ok((await c.textContent('[data-rascunho-status]')).includes('rascunho'), 'aviso de rascunho salvo neste aparelho');

  // Desde a melhoria 43 o rascunho retoma na etapa onde parou (3): avança até a etapa 4.
  while (!(await c.isVisible('[data-etapa="4"]'))) await c.click('[data-etapa-proxima]');
  ok(await c.isVisible('[data-etapa="4"]'), 'etapa 4 (domínio e arquivos)');
  await c.check('input[name=tem_dominio][value=sim]');
  ok(await c.isVisible('#b-dominio'), 'campo do domínio aparece ao marcar "Sim"');
  await c.fill('#b-dominio', 'AtelieDaIara.com.br');
  await c.setInputFiles('#b-arquivos', [{ name: 'Logo Ateliê.png', mimeType: 'image/png', buffer: PNG }]);
  await c.waitForSelector('[data-lista-arquivos] li[data-caminho]', { timeout: 10000 });
  ok((await c.textContent('[data-lista-arquivos]')).includes('Logo Ateliê.png'), 'logo enviado pelo Storage (URL assinada) aparece na lista');
  await c.setInputFiles('#b-arquivos', [{ name: 'grande.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(5 * 1024 * 1024 + 10) }]);
  await c.waitForSelector('.arquivos__item--erro');
  ok((await c.textContent('.arquivos__item--erro')).includes('5 MB'), 'arquivo > 5 MB recusado');
  await c.setInputFiles('#b-arquivos', [{ name: 'script.html', mimeType: 'text/html', buffer: Buffer.from('<script>1</script>') }]);
  ok((await c.textContent('[data-lista-arquivos]')).includes('Tipo não aceito'), 'tipo não permitido recusado');
  ok(Number(psql("select count(*) from storage.objects where bucket_id = 'briefings'")) === 1, 'só o arquivo válido foi parar no bucket');
  await c.fill('#b-links_arquivos-1', 'https://drive.google.com/drive/folders/abc');
  await axe(c, 'briefing etapa 4');
  await c.click('[data-etapa-proxima]');
  await c.fill('#b-observacoes', 'Prefiro tons de verde.');
  const resumo = await c.textContent('[data-resumo-briefing]');
  ok(resumo.includes('Ateliê da Iara') && resumo.includes('Logo Ateliê.png') && resumo.includes('AtelieDaIara.com.br'), 'etapa 5: resumo para conferência');
  await c.screenshot({ path: SAIDA + '/briefing-resumo-375.png', fullPage: true });
  await c.click('[data-enviar-briefing]');
  await c.waitForFunction(() => document.querySelector('[data-briefing-aviso]').getAttribute('data-tipo') === 'sucesso', null, { timeout: 10000 });
  ok(true, 'briefing enviado: mensagem de sucesso');
  const linha = psql(`select b.nome_negocio || '|' || b.dominio || '|' || b.tem_dominio || '|' || jsonb_array_length(b.arquivos) || '|' || b.referencias[1] || '|' || b.links_arquivos[1] || '|' || b.status
    from public.briefings b join public.pedidos p on p.id = b.pedido_id where p.codigo = '${codigo}'`);
  ok(linha === 'Ateliê da Iara|ateliedaiara.com.br|sim|1|https://exemplo.com/inspiracao|https://drive.google.com/drive/folders/abc|novo', 'banco: briefing completo ligado ao pedido → ' + linha);

  console.log('\n[4] Outro aparelho (link com #) e acessos negados');
  const outro = await novaPagina(browser, { viewport: { width: 1280, height: 800 } });
  await outro.goto(linkOutro, { waitUntil: 'networkidle' });
  await outro.waitForSelector('[data-form-briefing]:not([hidden])');
  ok((await outro.inputValue('#b-nome_negocio')) === 'Ateliê da Iara', 'outro aparelho carrega o briefing do servidor');
  ok(!outro.url().includes('#'), 'token removido da barra de endereço');
  await outro.screenshot({ path: SAIDA + '/briefing-1280.png' });
  await outro.context().close();

  const semAcesso = await novaPagina(browser, { viewport: { width: 375, height: 800 } });
  await semAcesso.goto(SITE + 'briefing.html', { waitUntil: 'networkidle' });
  ok(await semAcesso.getAttribute('[data-briefing-aviso]', 'data-tipo') === 'erro' && await semAcesso.locator('[data-form-briefing]').isHidden(), 'sem código/token: aviso e formulário oculto');
  await semAcesso.goto(SITE + 'briefing.html#c=' + codigo + '&t=' + 'f'.repeat(64), { waitUntil: 'networkidle' });
  await semAcesso.waitForFunction(() => document.querySelector('[data-briefing-aviso]').getAttribute('data-tipo') === 'erro');
  ok(await semAcesso.locator('[data-form-briefing]').isHidden(), 'token errado: não abre o briefing de outra pessoa');
  await axe(semAcesso, 'briefing sem acesso');
  await semAcesso.context().close();

  const pend = await comprar(browser, 'pendente', { nome: 'João Pix', email: 'joao@exemplo.com', whatsapp: '11911110000' });
  ok(await pend.locator('[data-link-briefing]').count() === 0, 'pedido pendente: obrigado.html não oferece o briefing');
  const codPend = JSON.parse((await pend.context().storageState()).origins.find((o) => o.origin === new URL(SITE).origin).localStorage.find((x) => x.name === 'pbr_pedidos_v1').value);
  await pend.goto(SITE + 'briefing.html?pedido=' + Object.values(codPend)[0].codigo, { waitUntil: 'networkidle' });
  await pend.waitForFunction(() => document.querySelector('[data-briefing-aviso]').getAttribute('data-tipo') === 'pendente');
  ok(true, 'briefing de pedido pendente: "pagamento ainda não confirmado"');
  await pend.context().close();

  console.log('\n[5] Painel: aba Briefings');
  const a = await novaPagina(browser, { viewport: { width: 1280, height: 800 } });
  await a.goto(SITE + 'admin/#briefings', { waitUntil: 'networkidle' });
  await a.fill('#login-email', 'dono@teste.local');
  await a.fill('#login-senha', 'senha-de-teste');
  await a.click('[data-form-login] button[type=submit]');
  await a.waitForSelector('[data-lista-briefings] .admin-item');
  ok(await a.locator('.admin-briefings').isVisible() && (await a.textContent('[data-selo-aba="briefings"]')) === '1', 'aba Briefings com selo de 1 novo');
  await a.click('[data-lista-briefings] .admin-item');
  await a.waitForSelector('[data-briefing-detalhe]:not([hidden])');
  const ficha = await a.textContent('[data-briefing-dados]');
  ok(ficha.includes('Costura sob medida') && ficha.includes('Vestidos sob medida') && ficha.includes('ateliedaiara.com.br') && ficha.includes('iara@exemplo.com'), 'ficha completa com dados do cliente');
  ok((await a.getAttribute('[data-briefing-dados] a[href^="https://drive"]', 'rel')).includes('noopener'), 'links do cliente abrem com rel=noopener');
  await a.evaluate(() => { window.__links = []; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('data-download')) window.__links.push(this.href); else o.call(this); }; });
  await a.click('[data-briefing-arquivos] button');
  await a.waitForFunction(() => window.__links.length === 1);
  const baixado = await a.evaluate(async () => { const r = await fetch(window.__links[0]); return [r.status, (await r.arrayBuffer()).byteLength, r.headers.get('content-type')]; });
  ok(baixado[0] === 200 && baixado[1] === PNG.length && baixado[2] === 'image/png', 'admin baixa o arquivo do bucket privado por link temporário');
  await axe(a, 'aba Briefings');
  await a.screenshot({ path: SAIDA + '/admin-briefings-1280.png' });

  await a.selectOption('[data-briefing-status]', 'em_producao');
  await a.waitForFunction(() => document.querySelector('[data-filtro-briefing="em_producao"]').textContent.includes('(1)'));
  ok(psql(`select status from public.briefings`) === 'em_producao', 'admin muda o status para "em produção"');
  await a.click('[data-briefing-ver-pedido]');
  await a.waitForSelector('[data-pedido-detalhe]:not([hidden])');
  ok(a.url().endsWith('#pedidos') && (await a.textContent('[data-pedido-titulo]')).includes(codigo), '"Ver o pedido" abre o pedido na aba Pedidos');
  ok((await a.textContent('[data-pedido-dados]')).includes('Recebido (em produção)'), 'aba Pedidos mostra o briefing do pedido');
  ok((await a.textContent('[data-lista-pedidos]')).includes('briefing ✓') && (await a.textContent('[data-lista-pedidos]')).includes('João Pix'), 'lista de pedidos indica quem tem briefing');

  console.log('\n[6] Depois de "em produção", o cliente não edita mais');
  await c.goto(SITE + 'briefing.html?pedido=' + codigo, { waitUntil: 'networkidle' });
  await c.waitForFunction(() => document.querySelector('[data-briefing-aviso]').getAttribute('data-tipo') === 'bloqueado');
  ok((await c.textContent('[data-briefing-aviso]')).includes('Em produção') && await c.locator('[data-form-briefing]').isHidden(), 'briefing travado mostra o status ao cliente');
  const up = await c.evaluate(async (args) => {
    const r = await fetch(args.api + '/functions/v1/briefing-upload', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: args.anon },
      body: JSON.stringify({ codigo: args.codigo, token: args.token, nome: 'x.png', tipo: 'image/png', tamanho: 10 }) });
    return [r.status, (await r.json()).erro];
  }, { api: API, anon: ANON, codigo, token: /t=([0-9a-f]{64})/.exec(linkOutro)[1] });
  ok(up[0] === 409 && up[1] === 'briefing_bloqueado', 'upload recusado depois de travado (409)');

  console.log('\n[7] Console');
  // o 409 do cliente é a tentativa de upload feita de propósito na etapa [6]
  c.erros = c.erros.filter((e) => !/status of 409/.test(e));
  for (const [nome, p] of [['cliente', c], ['admin', a]]) {
    ok(p.erros.length === 0, `console limpo (${nome})` + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
  }
  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DA FASE 4 PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
