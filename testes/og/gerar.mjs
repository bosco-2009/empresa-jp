// Gera as imagens Open Graph por página (melhoria 14).
// Fonte: um SVG por página em testes/og/svg/ (editável à mão) → PNG 1200×630 em assets/img/og/.
//
//   node testes/og/gerar.mjs          (precisa do Playwright de testes/ e de python3 + Pillow para compactar)
//
// Só textos que já estão no site (títulos das páginas). Sem preços, números ou clientes: nada de [PROVISÓRIO] aqui.
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

const raiz = new URL('../../', import.meta.url);
const pastaSvg = new URL('testes/og/svg/', raiz);
const pastaPng = new URL('assets/img/og/', raiz);
mkdirSync(pastaSvg, { recursive: true });
mkdirSync(pastaPng, { recursive: true });

// Paleta da marca (tokens.css)
const NOITE = '#0B1630', VERDE = '#077A57', SOL = '#FFC83D', CINZA = '#A9B3C7';

// Cada linha do título é uma lista de trechos [texto, destaque?]
const IMAGENS = [
  {
    nome: 'planos', selo: 'Planos', enfeite: 'planos',
    titulo: [[['Escolha seu plano', false]], [['e contrate em ', false]], [['poucos minutos', true]]],
    linha: 'Pix, boleto ou cartão pelo Mercado Pago',
    alt: 'Planos da Portfólio BR: escolha seu plano e contrate em poucos minutos',
  },
  {
    nome: 'exemplos', selo: 'Sites de exemplo', enfeite: 'celular',
    titulo: [[['Veja como o site', false]], [['do ', false], ['seu negócio', true]], [['pode ficar', false]]],
    linha: 'Moda · Restaurante · Beleza · Saúde · Serviços · Pet',
    alt: 'Sites de exemplo da Portfólio BR para seis segmentos',
  },
  {
    nome: 'blog', selo: 'Blog', enfeite: 'texto',
    titulo: [[['Dicas para colocar', false]], [['o seu negócio', true]], [['na internet', false]]],
    linha: 'Artigos práticos para pequenos negócios',
    alt: 'Blog da Portfólio BR: dicas para colocar o seu negócio na internet',
  },
  {
    nome: 'blog-site-ou-instagram', selo: 'Blog', enfeite: 'texto',
    titulo: [[['Site ou', false]], [['só Instagram?', true]]],
    linha: 'O que faz sentido para o seu negócio',
    alt: 'Artigo: Site ou só Instagram? O que faz sentido para o seu negócio',
  },
  {
    nome: 'blog-o-que-um-site-profissional-precisa-ter', selo: 'Blog', enfeite: 'lista',
    titulo: [[['O que um ', false], ['site', true]], [['profissional', true], [' precisa', false]], [['ter: o checklist', false]]],
    linha: 'O que não pode faltar no site do pequeno negócio',
    alt: 'Artigo: O que um site profissional precisa ter, o checklist do pequeno negócio',
  },
  {
    nome: 'blog-como-funciona-a-criacao-do-seu-site', selo: 'Blog', enfeite: 'etapas',
    titulo: [[['Como funciona', false]], [['a criação do', false]], [['seu site', true]]],
    linha: 'Do pagamento ao site no ar, passo a passo',
    alt: 'Artigo: Como funciona a criação do seu site com a Portfólio BR',
  },
];

// Páginas por segmento (melhoria 25): textos em testes/segmentos/og.json, gerado por testes/segmentos/gerar.py
for (const s of JSON.parse(readFileSync(new URL('testes/segmentos/og.json', raiz), 'utf8'))) {
  IMAGENS.push({ nome: s.nome, selo: 'Para quem é', enfeite: 'celular', titulo: s.titulo, linha: s.linha, alt: s.alt });
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Enfeites à direita (formas abstratas, sem nomes de clientes nem números)
function enfeite(tipo) {
  const g = (conteudo) => `<g transform="translate(860 150)">${conteudo}</g>`;
  if (tipo === 'celular') {
    return g(`
      <rect x="20" y="-10" width="230" height="400" rx="34" fill="#13224A" stroke="#2A3B66" stroke-width="3"/>
      <rect x="38" y="16" width="194" height="348" rx="20" fill="#F6F7FA"/>
      <rect x="38" y="16" width="194" height="120" rx="20" fill="${VERDE}"/>
      <rect x="38" y="116" width="194" height="20" fill="${VERDE}"/>
      <rect x="58" y="48" width="110" height="14" rx="7" fill="#FFFFFF" opacity=".9"/>
      <rect x="58" y="74" width="80" height="10" rx="5" fill="#FFFFFF" opacity=".6"/>
      <rect x="58" y="100" width="70" height="22" rx="11" fill="${SOL}"/>
      <rect x="56" y="156" width="74" height="74" rx="12" fill="#DCE1EA"/>
      <rect x="140" y="156" width="74" height="74" rx="12" fill="#DCE1EA"/>
      <rect x="56" y="242" width="74" height="10" rx="5" fill="#566074" opacity=".5"/>
      <rect x="140" y="242" width="60" height="10" rx="5" fill="#566074" opacity=".5"/>
      <rect x="56" y="276" width="158" height="40" rx="20" fill="${NOITE}"/>
      <rect x="0" y="330" width="96" height="34" rx="17" fill="${SOL}"/>
      <text x="48" y="353" text-anchor="middle" font-size="17" font-weight="800" fill="${NOITE}">exemplo</text>`);
  }
  if (tipo === 'planos') {
    const card = (x, y, dest) => `
      <rect x="${x}" y="${y}" width="210" height="260" rx="22" fill="${dest ? '#FFFFFF' : '#13224A'}" stroke="${dest ? SOL : '#2A3B66'}" stroke-width="3"/>
      <rect x="${x + 24}" y="${y + 28}" width="90" height="14" rx="7" fill="${dest ? NOITE : '#3A4C78'}"/>
      <rect x="${x + 24}" y="${y + 62}" width="130" height="26" rx="8" fill="${dest ? VERDE : '#2A3B66'}"/>
      ${[0, 1, 2].map((i) => `<circle cx="${x + 32}" cy="${y + 122 + i * 30}" r="7" fill="${dest ? VERDE : '#3A4C78'}"/><rect x="${x + 48}" y="${y + 116 + i * 30}" width="${120 - i * 20}" height="11" rx="5.5" fill="${dest ? '#DCE1EA' : '#2A3B66'}"/>`).join('')}
      <rect x="${x + 24}" y="${y + 206}" width="162" height="32" rx="16" fill="${dest ? VERDE : '#2A3B66'}"/>`;
    return g(card(0, 20, false) + card(70, 70, true));
  }
  if (tipo === 'lista') {
    return g([0, 1, 2, 3, 4].map((i) => `
      <rect x="0" y="${i * 72}" width="270" height="56" rx="16" fill="#13224A" stroke="#2A3B66" stroke-width="2"/>
      <circle cx="30" cy="${i * 72 + 28}" r="14" fill="${VERDE}"/>
      <path d="M23 ${i * 72 + 28} l5 5 l9 -10" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="58" y="${i * 72 + 22}" width="${170 - (i % 3) * 30}" height="12" rx="6" fill="#3A4C78"/>`).join(''));
  }
  if (tipo === 'etapas') {
    return g(`<path d="M30 20 V340" stroke="#2A3B66" stroke-width="4" stroke-dasharray="2 12" stroke-linecap="round"/>` +
      [0, 1, 2, 3].map((i) => `
      <circle cx="30" cy="${20 + i * 106}" r="24" fill="${i === 3 ? SOL : VERDE}"/>
      <text x="30" y="${28 + i * 106}" text-anchor="middle" font-size="22" font-weight="800" fill="${i === 3 ? NOITE : '#FFFFFF'}">${i + 1}</text>
      <rect x="74" y="${6 + i * 106}" width="${180 - i * 18}" height="13" rx="6.5" fill="#3A4C78"/>
      <rect x="74" y="${28 + i * 106}" width="${120 - i * 10}" height="10" rx="5" fill="#2A3B66"/>`).join(''));
  }
  // 'texto': página de artigo
  return g(`
    <rect x="20" y="0" width="250" height="330" rx="22" fill="#13224A" stroke="#2A3B66" stroke-width="3"/>
    <rect x="48" y="34" width="150" height="18" rx="9" fill="${SOL}"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="48" y="${80 + i * 28}" width="${[194, 180, 194, 120, 194, 170, 194, 90][i]}" height="10" rx="5" fill="#3A4C78"/>`).join('')}`);
}

function svg(img) {
  const linhas = img.titulo.map((trechos, i) => {
    const tspans = trechos.map(([t, d]) => `<tspan fill="${d ? SOL : '#FFFFFF'}">${esc(t)}</tspan>`).join('');
    return `<text x="90" y="${300 + i * 78}" font-size="68" font-weight="800" letter-spacing="-1.5">${tspans}</text>`;
  }).join('\n  ');
  const largSelo = 40 + img.selo.length * 15;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <!-- Gerado por testes/og/gerar.mjs (melhoria 14). Edite lá e rode de novo. -->
  <style>
    @font-face { font-family: "PJS"; src: url("../../../assets/fonts/plus-jakarta-sans-latin-wght.woff2") format("woff2"); font-weight: 200 800; }
    text { font-family: "PJS", "Plus Jakarta Sans", sans-serif; }
  </style>
  <defs>
    <radialGradient id="brilho1" cx="1" cy="0" r="0.7"><stop offset="0" stop-color="${VERDE}" stop-opacity=".45"/><stop offset="1" stop-color="${VERDE}" stop-opacity="0"/></radialGradient>
    <radialGradient id="brilho2" cx="0" cy="1" r="0.45"><stop offset="0" stop-color="${SOL}" stop-opacity=".18"/><stop offset="1" stop-color="${SOL}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${NOITE}"/>
  <rect width="1200" height="630" fill="url(#brilho1)"/>
  <rect width="1200" height="630" fill="url(#brilho2)"/>
  <g transform="translate(90 70)">
    <rect width="64" height="64" rx="16" fill="${VERDE}"/>
    <path d="M22.7 48V16h12a10 10 0 0 1 0 20h-12" fill="none" stroke="#FFFFFF" stroke-width="6.7" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="44.7" cy="46" r="5.3" fill="${SOL}"/>
    <text x="84" y="44" font-size="36" font-weight="700" fill="#FFFFFF">Portfólio</text>
    <rect x="262" y="13" width="56" height="40" rx="8" fill="${SOL}"/>
    <text x="290" y="44" font-size="28" font-weight="800" fill="${NOITE}" text-anchor="middle">BR</text>
  </g>
  <rect x="90" y="176" width="${largSelo}" height="44" rx="22" fill="none" stroke="${SOL}" stroke-width="2"/>
  <text x="${90 + largSelo / 2}" y="205" font-size="22" font-weight="700" fill="${SOL}" text-anchor="middle">${esc(img.selo)}</text>
  ${linhas}
  <text x="90" y="${300 + (img.titulo.length - 1) * 78 + 84}" font-size="28" font-weight="500" fill="${CINZA}">${esc(img.linha)}</text>
  ${enfeite(img.enfeite)}
</svg>
`;
}

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const img of IMAGENS) {
  const arqSvg = new URL(`${img.nome}.svg`, pastaSvg);
  writeFileSync(arqSvg, svg(img));
  await pagina.goto(arqSvg.href);
  await pagina.evaluate(() => document.fonts.ready);
  const larguraTexto = await pagina.evaluate(() => Math.max(...[...document.querySelectorAll('text[font-size="68"]')].map((t) => t.getBBox().x + t.getBBox().width)));
  if (larguraTexto > 760) throw new Error(`${img.nome}: título invade o enfeite (${Math.round(larguraTexto)} px)`);
  const arqPng = fileURLToPath(new URL(`${img.nome}.png`, pastaPng));
  await pagina.screenshot({ path: arqPng });
  // Compacta em 256 cores (fica bem abaixo de 100 KB e sem perda visível no fundo liso)
  execFileSync('python3', ['-I', '-c', 'import sys;from PIL import Image;p=sys.argv[1];Image.open(p).convert("RGB").quantize(256,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.FLOYDSTEINBERG).save(p,optimize=True)', arqPng]);
  console.log(`${img.nome}.png  ${Math.round(statSync(arqPng).size / 1024)} KB  (título até ${Math.round(larguraTexto)} px)`);
}
await navegador.close();
