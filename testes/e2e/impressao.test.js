// Uso: veja testes/README.md (precisa só do servidor estático em :8080; o Supabase é simulado aqui mesmo)
// Melhoria 77: impressão limpa de termos.html, privacidade.html, pedido.html e obrigado.html.
//  - com emulateMedia({ media: 'print' }): sem cabeçalho fixo, chat, abertura, tema nem botões; cores claras mesmo
//    com o sistema ou o botão no modo escuro; links do conteúdo com o endereço impresso (sem query/token);
//  - nada passa da largura útil de uma folha A4 (sem cortes) e o PDF gerado tem páginas legíveis;
//  - obrigado/pedido: o comprovante (código, plano, valor, etapas) aparece; o link pessoal com token não;
//  - na tela nada muda (cabeçalho sticky, chat e botões continuam), zero erros no console.
// Saída: testes/e2e/saida/impressao-*.pdf e impressao-*-p1.png (1ª página, se houver pdftoppm).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const RAIZ = path.resolve(__dirname, '../..');
const SAIDA = path.join(__dirname, 'saida');
fs.mkdirSync(SAIDA, { recursive: true });

const configOriginal = fs.readFileSync(RAIZ + '/config.js', 'utf8');
const configTeste = configOriginal
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');
const janela = {};
require('vm').runInNewContext(configOriginal, { window: janela });
const PLANO = janela.PBR_CONFIG.planos[0];

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

const CODIGO = 'PBR-PAGA22';
const TOKEN = 'a'.repeat(64);
const PEDIDOS = { 'id-teste-1': { codigo: CODIGO, token: TOKEN, plano_id: PLANO.id, plano_nome: PLANO.nome } };
const AGORA = '2026-11-20T13:00:00Z';
const RPC = {
  pedido_consultar: [{ codigo: CODIGO, status: 'aprovado', plano_id: PLANO.id, plano_nome: PLANO.nome, valor_centavos: 12345 }],
  pedido_acompanhar: [{ codigo: CODIGO, pedido_status: 'aprovado', etapa: 'em_producao', etapa_em: AGORA, pago_em: '2026-11-18T13:00:00Z',
    briefing_em: '2026-11-19T13:00:00Z', briefing_status: 'recebido', plano_id: PLANO.id, plano_nome: PLANO.nome }]
};

// Largura útil de uma A4 com as margens do @page (21 cm − 2 × 1,4 cm) em px CSS a 96 dpi
const LARGURA_UTIL = Math.floor((21 - 2.8) / 2.54 * 96);

async function novaPagina(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  await ctx.addInitScript((d) => {
    try {
      sessionStorage.setItem('pbr_abertura_vista', '1');
      localStorage.setItem('pbr_pedidos_v1', JSON.stringify(d.pedidos));
      localStorage.setItem('pbr_ultimo_pedido', 'id-teste-1');
    } catch (e) { /* */ }
  }, { pedidos: PEDIDOS });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route(API + '/rest/v1/rpc/*', (r) => {
    const nome = r.request().url().split('/').pop().split('?')[0];
    if (!RPC[nome]) return r.fulfill({ status: 404, body: '[]', contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
    return r.fulfill({ status: 200, body: JSON.stringify(RPC[nome]), contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  });
  return p;
}

const PAGINAS = [
  { url: 'termos.html', pronto: '[data-cfg-planos] *' },
  { url: 'privacidade.html', pronto: 'main h2' },
  { url: 'pedido.html?pedido=' + CODIGO, nome: 'pedido', pronto: '[data-etapas]:not([hidden]) .etapas__item' },
  { url: 'obrigado.html?external_reference=id-teste-1&collection_status=approved', nome: 'obrigado', pronto: '[data-resultado-pedido]:not([hidden])' }
];

(async () => {
  const browser = await chromium.launch();
  let temPdftoppm = true;
  try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); } catch (e) { temPdftoppm = false; }

  for (const pg of PAGINAS) {
    const nome = pg.nome || pg.url.replace('.html', '');
    console.log(`\n[${nome}]`);
    for (const tema of ['light', 'dark']) {
      const p = await novaPagina(browser, { viewport: { width: 375, height: 800 }, colorScheme: tema });
      await p.goto(SITE + pg.url, { waitUntil: 'load' });
      await p.waitForSelector(pg.pronto, { state: 'attached', timeout: 8000 });
      if (tema === 'dark') await p.click('[data-tema-botao]').catch(() => {}); // alterna; volta a clicar se ficou claro
      if (tema === 'dark' && await p.getAttribute('html', 'data-tema') !== 'escuro') await p.click('[data-tema-botao]');

      // Na tela: nada muda
      const tela = await p.evaluate(() => ({
        topo: getComputedStyle(document.querySelector('.topo')).position,
        chat: !!document.querySelector('.chat') && getComputedStyle(document.querySelector('.chat')).display !== 'none'
      }));
      ok(tela.topo === 'sticky', `${tema}: na tela o cabeçalho continua fixo`);

      await p.emulateMedia({ media: 'print' });
      await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      const r = await p.evaluate(() => {
        const vis = (s) => [...document.querySelectorAll(s)].filter((e) => getComputedStyle(e).display !== 'none' && e.getClientRects().length).length;
        const fundo = getComputedStyle(document.body).backgroundColor;
        const texto = getComputedStyle(document.querySelector('main h1')).color;
        const links = [...document.querySelectorAll('main a[data-endereco-impresso]')].map((a) => ({
          end: a.getAttribute('data-endereco-impresso'), depois: getComputedStyle(a, '::after').content }));
        const ancorasMarcadas = [...document.querySelectorAll('main a[href^="#"][data-endereco-impresso]')].length;
        return {
          topo: getComputedStyle(document.querySelector('.topo')).position,
          visiveis: vis('.topo__nav, .topo__menu-botao, .tema-botao, .chat, .abertura, .pular-link, main .botao, main button'),
          marca: vis('.topo .marca'), fundo, texto, links, ancorasMarcadas,
          linkPessoal: vis('.resultado__link-briefing, .acompanhar__outro'),
          token: document.body.innerText.includes('t=' + 'a'.repeat(64))
        };
      });
      ok(r.topo === 'static', `${tema}: impresso sem cabeçalho fixo`);
      ok(r.visiveis === 0, `${tema}: impresso sem menu, chat, abertura, tema nem botões (${r.visiveis} visíveis)`);
      ok(r.marca === 1, `${tema}: a marca continua no topo do impresso`);
      ok(r.fundo === 'rgb(255, 255, 255)', `${tema}: fundo branco no papel (${r.fundo})`);
      const [cr, cg, cb] = r.texto.match(/\d+/g).map(Number);
      ok(cr + cg + cb < 150, `${tema}: título escuro no papel (${r.texto})`);
      ok(r.ancorasMarcadas === 0, `${tema}: âncoras da própria página sem endereço`);
      ok(r.links.every((l) => l.depois.includes(l.end) && !/[?#]/.test(l.end)), `${tema}: ${r.links.length} link(s) com o endereço impresso, sem query/token`);
      if (nome === 'termos') ok(r.links.some((l) => l.end === 'instagram.com/portifolio_br'), `${tema}: Instagram com o endereço no papel`);
      if (nome === 'pedido' || nome === 'obrigado') {
        ok(r.linkPessoal === 0 && !r.token, `${tema}: link pessoal com token fora do impresso`);
        const txt = await p.evaluate(() => document.querySelector('main').innerText);
        ok(txt.includes(CODIGO) && txt.includes(PLANO.nome), `${tema}: comprovante com o código e o plano`);
      }

      // Sem cortes: na largura útil da A4 nada passa da borda
      await p.setViewportSize({ width: LARGURA_UTIL, height: 1000 });
      const corte = await p.evaluate((w) => {
        const largos = [...document.querySelectorAll('main *')].filter((e) => {
          const b = e.getBoundingClientRect();
          return b.width && getComputedStyle(e).display !== 'none' && b.right > w + 1;
        }).map((e) => e.tagName.toLowerCase() + '.' + e.className).slice(0, 3);
        return { sw: document.documentElement.scrollWidth, largos };
      }, LARGURA_UTIL);
      ok(corte.sw <= LARGURA_UTIL && corte.largos.length === 0, `${tema}: nada cortado na largura da A4 (${corte.sw}px de ${LARGURA_UTIL}) ${corte.largos.join(' ')}`);

      if (tema === 'dark') {
        const arq = path.join(SAIDA, `impressao-${nome}.pdf`);
        await p.pdf({ path: arq, format: 'A4', preferCSSPageSize: true });
        const tam = fs.statSync(arq).size;
        let paginas = 0;
        try { paginas = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [arq]).toString())[1]); } catch (e) { paginas = tam > 0 ? 1 : 0; }
        ok(tam > 5000 && paginas >= 1 && paginas <= 12, `PDF gerado (${paginas} página(s), ${Math.round(tam / 1024)} KB)`);
        if (nome === 'pedido' || nome === 'obrigado') ok(paginas === 1, `comprovante cabe numa folha, sem folha em branco (${paginas})`);
        if (temPdftoppm) execFileSync('pdftoppm', ['-png', '-r', '60', '-f', '1', '-l', '1', '-singlefile', arq, path.join(SAIDA, `impressao-${nome}-p1`)]);
      }
      ok(p.erros.length === 0, `${tema}: zero erros no console` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
      await p.context().close();
    }
  }
  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
