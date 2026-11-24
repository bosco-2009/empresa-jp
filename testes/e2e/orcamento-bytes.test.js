// Uso: veja testes/README.md (precisa só do servidor estático em :8080). `node e2e/orcamento-bytes.test.js --medir`
// imprime o mapa ORCAMENTO novo (medido + 10 %), para colar aqui quando uma página crescer DE PROPÓSITO.
// Melhoria 73: orçamento de bytes por página, para o site não engordar sem ninguém perceber.
//  Soma o que cada página pública carrega até o evento `load` (a primeira pintura e o que ela precisa):
//  o HTML da página, os CSS, os JS e as fontes da própria origem (config.js incluído). Fica de fora o que é
//  sob demanda (supabase-js do CDN, que só vem ao abrir o chat; prefetch de outras páginas; imagens, que já têm
//  limite por arquivo em funcoes/imagens.test.mjs). Mede o corpo SEM compressão (estável entre servidores).
//  [1] Cada página medida tem orçamento e cabe nele (em 375 e 1280 px; o pior dos dois vale).
//  [2] Nenhum script externo nem supabase-js na carga (seria um "peso escondido" fora do orçamento).
//  [3] Toda página pública descoberta no disco tem orçamento (página nova precisa entrar aqui de propósito).
//  [4] Os orçamentos não ficam frouxos: cada um é no máximo o medido + 25 % (senão, rode --medir e atualize).
// A 404.html fica de fora: usa caminhos absolutos /empresa-jp/ e só funciona no GitHub Pages (tem teste próprio).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const RAIZ = path.join(__dirname, '..', '..');
const MEDIR = process.argv.includes('--medir');
const FOLGA = 0.10;
const FOLGA_MAXIMA = 0.25;
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

// Orçamento em bytes (HTML + CSS + JS + fontes, sem compressão) = medido em 2026-11-24 + 10 %, arredondado para cima
// ao KB. Página cresceu de propósito? `node e2e/orcamento-bytes.test.js --medir` e cole o mapa novo.
const ORCAMENTO = {
  'blog/autor.html': 216064,
  'blog/como-funciona-a-criacao-do-seu-site.html': 220160,
  'blog/index.html': 216064,
  'blog/o-que-um-site-profissional-precisa-ter.html': 221184,
  'blog/site-ou-instagram.html': 221184,
  'briefing.html': 316416,
  'exemplos.html': 249856,
  'exemplos/beleza.html': 153600,
  'exemplos/moda.html': 153600,
  'exemplos/pet.html': 153600,
  'exemplos/restaurante.html': 153600,
  'exemplos/saude.html': 153600,
  'exemplos/servicos.html': 153600,
  'index.html': 265216,
  'obrigado.html': 268288,
  'pedido.html': 279552,
  'planos.html': 311296,
  'portfolio.html': 228352,
  'privacidade.html': 219136,
  'segmentos/beleza.html': 238592,
  'segmentos/moda.html': 238592,
  'segmentos/pet.html': 238592,
  'segmentos/restaurante.html': 238592,
  'segmentos/saude.html': 238592,
  'segmentos/servicos.html': 238592,
  'termos.html': 216064,
};

function paginas(dir, prefixo = '') {
  return fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory() && ['blog', 'exemplos', 'segmentos'].includes(e.name) && !prefixo) return paginas(e.name, e.name + '/');
    return e.isFile() && e.name.endsWith('.html') && e.name !== '404.html' ? [prefixo + e.name] : [];
  }).sort();
}

const TIPOS = new Set(['document', 'stylesheet', 'script', 'font']);

(async () => {
  const lista = paginas('.');
  const browser = await chromium.launch();
  const medidas = {};

  async function medir(pagina, largura) {
    const ctx = await browser.newContext({ viewport: { width: largura, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    const url = SITE + pagina;
    const pendentes = [];
    const itens = [];
    const externos = [];
    p.on('response', (r) => {
      const req = r.request();
      const tipo = req.resourceType();
      if (!TIPOS.has(tipo)) return;
      if (tipo === 'document' && req.frame() !== p.mainFrame()) return;
      if (!r.url().startsWith(SITE)) { if (tipo === 'script') externos.push(r.url()); return; }
      if (r.status() >= 300) return;
      pendentes.push(r.body().then((b) => itens.push({ tipo, url: r.url().slice(SITE.length), bytes: b.length })).catch(() => {}));
    });
    await p.goto(url, { waitUntil: 'load' });
    await Promise.all(pendentes);
    await ctx.close();
    const total = itens.reduce((s, i) => s + i.bytes, 0);
    return { total, itens, externos };
  }

  console.log('\n[1] e [2] Bytes da carga de cada página (HTML + CSS + JS + fontes)');
  for (const pagina of lista) {
    const m375 = await medir(pagina, 375);
    const m1280 = await medir(pagina, 1280);
    const pior = m375.total >= m1280.total ? m375 : m1280;
    medidas[pagina] = pior.total;
    const docs = pior.itens.filter((i) => i.tipo === 'document').length;
    if (docs !== 1) ok(false, pagina + ': esperava 1 documento medido, veio ' + docs);
    ok(!m375.externos.length && !m1280.externos.length,
      pagina + ': nenhum script externo na carga' + (m375.externos.length ? ' (' + m375.externos.join(', ') + ')' : ''));
    if (MEDIR) continue;
    const limite = ORCAMENTO[pagina];
    if (limite === undefined) continue;
    const kb = (n) => (n / 1024).toFixed(1) + ' KB';
    ok(pior.total <= limite, `${pagina}: ${kb(pior.total)} ≤ orçamento ${kb(limite)}`);
    if (pior.total > limite) {
      const maiores = pior.itens.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 5);
      console.log('      maiores: ' + maiores.map((i) => `${i.url.split('?')[0]} ${kb(i.bytes)}`).join(' · '));
    }
  }
  await browser.close();

  if (MEDIR) {
    console.log('\nconst ORCAMENTO = {');
    for (const pagina of lista) console.log(`  '${pagina}': ${Math.ceil(medidas[pagina] * (1 + FOLGA) / 1024) * 1024},`);
    console.log('};');
    process.exit(0);
  }

  console.log('\n[3] Toda página pública tem orçamento (e nenhum orçamento sobra)');
  for (const pagina of lista) ok(ORCAMENTO[pagina] !== undefined, pagina + ': tem orçamento');
  for (const pagina of Object.keys(ORCAMENTO)) ok(lista.includes(pagina), pagina + ': orçamento de página que existe');

  console.log('\n[4] Orçamentos justos (no máximo medido + 25 %)');
  for (const pagina of lista) {
    const limite = ORCAMENTO[pagina];
    if (limite === undefined) continue;
    ok(limite <= medidas[pagina] * (1 + FOLGA_MAXIMA) + 1024,
      `${pagina}: orçamento ${limite} não passa de ${Math.round(medidas[pagina] * (1 + FOLGA_MAXIMA))} (medido ${medidas[pagina]})`);
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
