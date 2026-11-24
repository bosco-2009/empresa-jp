// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Melhoria 64: elemento LCP de cada página e prioridade das imagens.
//  [1] HTML: nenhuma imagem estática com fetchpriority="high" (nenhuma é LCP hoje); logo do cabeçalho com
//      decoding="async" (sem lazy: está acima da dobra); logo do rodapé com loading="lazy" + decoding="async";
//      toda <img> com width/height e decoding.
//  [2] Navegador (375 e 1280 px): o LCP de cada página é TEXTO (h1/p/aviso), nunca uma imagem; nenhuma imagem
//      é pedida com prioridade alta.
//  [3] portfolio.html com um projeto FALSO só neste teste (o config.js real continua sem projetos): a 1ª foto
//      vira o LCP, sai com loading="eager" + fetchpriority="high"; as demais e as da home continuam lazy.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const RAIZ = path.join(__dirname, '..', '..');
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

function paginas(dir, prefixo = '') {
  return fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory() && ['blog', 'exemplos', 'segmentos', 'admin'].includes(e.name) && !prefixo) return paginas(e.name, e.name + '/');
    return e.isFile() && e.name.endsWith('.html') ? [prefixo + e.name] : [];
  });
}

// Elemento LCP esperado por página (medido a 375 e 1280 px). Todas as páginas públicas têm LCP de texto; o seletor
// aceita as variações por largura (no celular um parágrafo do topo pode ser maior que o h1). Se uma página nova ou
// uma imagem nova mudar o LCP, este mapa precisa ser revisto de propósito.
// Melhoria 106: em blog/index.html a miniatura do 1º cartão (imagem estática, sem lazy e com fetchpriority="high")
// é maior que o título e passou a ser o LCP; é a única imagem estática do site com prioridade alta.
const LCP_IMAGEM = { 'blog/index.html': '.blog-cartao .miniatura img' };
const PRIORIDADE_ESTATICA = { 'blog/index.html': 'miniaturas/blog-site-ou-instagram-400.png' };
const TEXTO = 'h1, h2, p, li, aside, div, span, dd, dt, label, legend, a';
const ESPERADO = {
  'index.html': 'h1.hero__titulo',
  'planos.html': 'h1, .pagina-topo__texto',
  'termos.html': 'h1, p',
};

(async () => {
  console.log('\n[1] Atributos das imagens no HTML');
  const todas = paginas('.');
  for (const p of todas) {
    const html = fs.readFileSync(path.join(RAIZ, p), 'utf8');
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    const altas = imgs.filter((t) => /fetchpriority="high"/.test(t));
    if (PRIORIDADE_ESTATICA[p]) {
      ok(altas.length === 1 && altas[0].includes(PRIORIDADE_ESTATICA[p]) && !/loading=/.test(altas[0]),
        p + ': só a imagem LCP tem fetchpriority="high" estático, sem loading="lazy"');
    } else if (altas.length) ok(false, p + ': fetchpriority="high" estático (nenhuma imagem estática desta página é LCP)');
    for (const tag of imgs) {
      if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) ok(false, p + ': <img> sem width/height: ' + tag);
      if (!/\sdecoding="async"/.test(tag)) ok(false, p + ': <img> sem decoding="async": ' + tag);
    }
    const logos = imgs.filter((t) => /class="marca__icone"/.test(t));
    if (logos.length) {
      ok(logos.length === 2 && !/loading=/.test(logos[0]) && /loading="lazy"/.test(logos[1]),
        p + ': logo do cabeçalho sem lazy (acima da dobra) e do rodapé com loading="lazy"');
    }
  }
  const mainJs = fs.readFileSync(path.join(RAIZ, 'assets/js/main.js'), 'utf8');
  ok(/fetchpriority', 'high'/.test(mainJs) && /ehPaginaPortfolio && indice === 0/.test(mainJs),
    'main.js: só a 1ª foto de portfolio.html recebe fetchpriority="high"');

  const browser = await chromium.launch();
  async function medir(url, largura, rotaConfig) {
    const ctx = await browser.newContext({ viewport: { width: largura, height: 800 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const erros = [];
    p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
    p.on('pageerror', (e) => erros.push(e.message));
    // 404.html usa caminhos absolutos /empresa-jp/... (GitHub Pages): servidos da raiz local, como na auditoria.
    await p.route('**/empresa-jp/**', (r) => r.continue({ url: r.request().url().replace('/empresa-jp/', '/') }));
    if (rotaConfig) await rotaConfig(p);
    await p.addInitScript(() => {
      try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* sem sessionStorage */ }
      window.__lcp = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp.push(e); })
        .observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await p.goto(SITE + url, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => {
      const e = window.__lcp[window.__lcp.length - 1];
      if (!e || !e.element) return null;
      const el = e.element;
      return {
        tag: el.tagName.toLowerCase(), classe: String(el.className || ''), url: e.url || '',
        altas: [...document.querySelectorAll('img[fetchpriority="high"]')].map((i) => i.currentSrc || i.src),
      };
    });
    const seletorOk = async (sel) => p.evaluate(([s]) => {
      const e = window.__lcp[window.__lcp.length - 1];
      return !!(e && e.element && e.element.matches(s));
    }, [sel]);
    return { ctx, p, r, erros, seletorOk };
  }

  console.log('\n[2] LCP de texto em todas as páginas públicas (375 e 1280 px)');
  const publicas = todas.filter((p) => !p.startsWith('admin/'));
  for (const url of publicas) {
    for (const largura of [375, 1280]) {
      const m = await medir(url === 'index.html' ? '' : url, largura);
      const nome = `${url} @${largura}`;
      if (!m.r) { ok(false, nome + ': nenhum LCP medido'); await m.ctx.close(); continue; }
      const desc = m.r.tag + (m.r.classe ? '.' + m.r.classe.split(' ')[0] : '');
      if (LCP_IMAGEM[url]) {
        ok(!!m.r.url && await m.seletorOk(LCP_IMAGEM[url]), `${nome}: LCP é a miniatura do 1º cartão (${desc})`);
        ok(m.r.altas.length === 1 && m.r.altas[0].includes('blog-site-ou-instagram-'), `${nome}: só a imagem LCP com fetchpriority="high"`);
      } else {
        ok(!m.r.url && await m.seletorOk(ESPERADO[url] || TEXTO), `${nome}: LCP é texto (${desc})`);
        ok(m.r.altas.length === 0, `${nome}: nenhuma imagem com fetchpriority="high"`);
      }
      ok(m.erros.length === 0, `${nome}: sem erros no console` + (m.erros.length ? ': ' + m.erros.join(' | ') : ''));
      await m.ctx.close();
    }
  }

  console.log('\n[3] portfolio.html com projetos (falsos, só no teste): 1ª foto é o LCP e tem prioridade alta');
  const configBase = fs.readFileSync(path.join(RAIZ, 'config.js'), 'utf8');
  const projeto = (n) => `{ nome: 'Projeto de teste ${n}', segmento: 'Teste automatizado', foto: 'projeto-teste-${n}', alt: 'Captura do projeto de teste ${n}' }`;
  const configComProjetos = configBase.replace(/projetos:\s*\[\]/, `projetos: [${[1, 2, 3, 4].map(projeto).join(', ')}]`);
  // PNG 4:3 de 1200×900 gerado em memória (sem arquivo no repositório). Precisa ter "detalhe" (ruído): o Chrome
  // descarta do LCP imagens de baixa entropia, como um quadro de cor única.
  const zlib = require('zlib');
  function png(w, h) {
    const crcTab = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const bloco = (tipo, dados) => {
      const t = Buffer.concat([Buffer.from(tipo), dados]);
      const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
      const c = Buffer.alloc(4); c.writeUInt32BE(crc(t));
      return Buffer.concat([len, t, c]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    let semente = 64;
    const aleatorio = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente >>> 16; };
    const cru = Buffer.concat(Array.from({ length: h }, () => {
      const linha = Buffer.alloc(1 + w * 3);
      for (let i = 1; i < linha.length; i++) linha[i] = aleatorio() & 0xff;
      return linha;
    }));
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(cru)), bloco('IEND', Buffer.alloc(0))]);
  }
  const imagem = png(1200, 900);
  const rotas = async (p) => {
    await p.route('**/config.js*', (r) => r.fulfill({ body: configComProjetos, contentType: 'application/javascript' }));
    // O mesmo PNG responde por todas as larguras/formatos (o teste do portfólio cobre a escolha do WebP).
    await p.route('**/assets/img/portfolio/*', (r) => r.fulfill({ body: imagem, contentType: 'image/png' }));
  };
  for (const largura of [375, 1280]) {
    const m = await medir('portfolio.html', largura, rotas);
    const fotos = await m.p.$$eval('.projeto img', (is) => is.map((i) => ({ loading: i.loading, prio: i.getAttribute('fetchpriority'), dec: i.decoding })));
    ok(fotos.length === 4, `@${largura}: 4 fotos montadas`);
    ok(fotos[0] && fotos[0].loading === 'eager' && fotos[0].prio === 'high', `@${largura}: 1ª foto eager + fetchpriority="high"`);
    ok(fotos.slice(1).every((f) => f.loading === 'lazy' && !f.prio), `@${largura}: demais fotos lazy, sem prioridade`);
    ok(fotos.every((f) => f.dec === 'async'), `@${largura}: todas com decoding="async"`);
    ok(m.r && /projeto-teste-1-/.test(m.r.url) && await m.seletorOk('.projeto:first-child img'), `@${largura}: LCP é a 1ª foto` + (m.r ? ` (${m.r.tag} ${m.r.url.split('/').pop()})` : ''));
    await m.ctx.close();
  }
  // Home com os mesmos projetos: nenhuma foto com prioridade alta (a seção fica abaixo da dobra).
  const h = await medir('', 1280, rotas);
  const fotosHome = await h.p.$$eval('.projeto img', (is) => is.map((i) => ({ loading: i.loading, prio: i.getAttribute('fetchpriority') })));
  ok(fotosHome.length > 0 && fotosHome.every((f) => f.loading === 'lazy' && !f.prio), 'home: fotos do portfólio todas lazy, sem prioridade alta');
  ok(h.r && !h.r.url, 'home: LCP continua sendo o título (texto)');
  await h.ctx.close();

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
