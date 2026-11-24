// Auditoria de peso e dimensões das imagens (melhoria 42). Sem dependências: lê os cabeçalhos dos arquivos.
// Uso: node --test testes/funcoes/*.test.mjs
// Medição no navegador (tamanho real × exibido em cada página): node testes/imagens/auditar.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { otimizarSvg, problemasSvg } from '../imagens/svg.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const ler = (f) => readFileSync(join(RAIZ, f));

function listar(pasta, filtro, fora = /^(\.git|node_modules|testes|supabase)$/) {
  const saida = [];
  for (const nome of readdirSync(pasta)) {
    if (fora.test(nome)) continue;
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) saida.push(...listar(caminho, filtro, fora));
    else if (filtro.test(nome)) saida.push(caminho);
  }
  return saida.sort();
}

// Dimensões reais lidas do cabeçalho de cada formato
export function dimensoes(buf, ext) {
  if (ext === '.png') {
    assert.equal(buf.toString('latin1', 1, 4), 'PNG', 'assinatura PNG');
    return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
  }
  if (ext === '.webp') {
    assert.equal(buf.toString('latin1', 0, 4) + buf.toString('latin1', 8, 12), 'RIFFWEBP', 'assinatura WebP');
    const tipo = buf.toString('latin1', 12, 16);
    if (tipo === 'VP8X') return { largura: 1 + buf.readUIntLE(24, 3), altura: 1 + buf.readUIntLE(27, 3) };
    if (tipo === 'VP8L') { const b = buf.readUInt32LE(21); return { largura: (b & 0x3fff) + 1, altura: ((b >> 14) & 0x3fff) + 1 }; }
    return { largura: buf.readUInt16LE(26) & 0x3fff, altura: buf.readUInt16LE(28) & 0x3fff };
  }
  if (ext === '.ico') {
    // ICO guarda vários tamanhos: vale o maior (o HTML declara sizes="32x32")
    const n = buf.readUInt16LE(4);
    let maior = { largura: 0, altura: 0 };
    for (let i = 0; i < n; i++) {
      const l = buf[6 + 16 * i] || 256, a = buf[7 + 16 * i] || 256;
      if (l > maior.largura) maior = { largura: l, altura: a };
    }
    return maior;
  }
  if (ext === '.svg') {
    const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(buf.toString('utf8'));
    return vb ? { largura: Number(vb[1]), altura: Number(vb[2]) } : null;
  }
  return null;
}

// Limites de bytes por tipo/uso. Passou disso: otimize (node testes/imagens/otimizar.mjs) ou reduza a imagem.
const KB = 1024;
function limite(rel) {
  const ext = extname(rel).toLowerCase();
  if (ext === '.svg') return 2 * KB;
  if (ext === '.ico') return 4 * KB;
  if (rel.startsWith('assets/img/portfolio/')) return ext === '.webp' ? 150 * KB : 450 * KB;
  // Melhoria 84: OG em 64–96 cores (testes/og/paleta.py). Melhoria 104: + Zopfli sem perda (otimizar.mjs --zopfli)
  // → a maior tem 32 171 bytes (era 32 590); limite = maior + 10%. JPEG/WebP medidos e piores: continuam PNG.
  if (rel.startsWith('assets/img/og/') || rel === 'assets/img/og-image.png') return 34.6 * KB;
  // Melhoria 106: miniaturas do blog (testes/blog/miniaturas.py). Maiores: WebP 800 = 16 886 B, PNG 400 = 14 216 B; + 10%
  if (rel.startsWith('assets/img/miniaturas/')) return ext === '.webp' ? 18.6 * KB : 15.7 * KB;
  if (ext === '.png') return 4.25 * KB; // ícones: o maior (icon-512) tem ~3,8 KB; limite = maior + 10%
  return 0; // tipo não previsto (jpg, gif, avif...): use WebP/PNG/SVG
}

const IMAGENS = [...listar(join(RAIZ, 'assets/img'), /\.\w+$/), join(RAIZ, 'favicon.ico')].map((f) => relative(RAIZ, f));
const HTML = listar(RAIZ, /\.html$/).map((f) => relative(RAIZ, f));
const JS = listar(join(RAIZ, 'assets/js'), /\.js$/).map((f) => relative(RAIZ, f));

test('cada imagem fica dentro do limite de bytes do seu tipo', () => {
  assert.ok(IMAGENS.length >= 10, 'encontrou as imagens');
  for (const rel of IMAGENS) {
    const max = limite(rel);
    assert.ok(max > 0, `${rel}: tipo de imagem não previsto (use SVG, PNG ou WebP)`);
    const bytes = statSync(join(RAIZ, rel)).size;
    assert.ok(bytes <= max, `${rel}: ${bytes} bytes passa do limite de ${max}`);
  }
});

test('imagens Open Graph em PNG indexado (paleta), como sai do testes/og/paleta.py', () => {
  const og = IMAGENS.filter((rel) => rel.startsWith('assets/img/og/') || rel === 'assets/img/og-image.png');
  assert.ok(og.length >= 13, 'encontrou as imagens OG');
  for (const rel of og) {
    const png = ler(rel);
    // IHDR: byte 25 = tipo de cor (3 = paleta). Em RGB/RGBA o arquivo volta a passar de 300 KB.
    assert.equal(png[25], 3, `${rel}: não está em paleta; rode node testes/og/gerar.mjs (ou testes/og/paleta.py)`);
  }
});

test('dimensões reais: ícones, manifest e imagens Open Graph', () => {
  const esperado = {
    'assets/img/icon-192.png': [192, 192], 'assets/img/icon-512.png': [512, 512],
    'assets/img/icon-maskable-512.png': [512, 512], 'assets/img/apple-touch-icon.png': [180, 180],
    'assets/img/og-image.png': [1200, 630], 'favicon.ico': [32, 32],
  };
  for (const rel of IMAGENS) {
    const d = dimensoes(ler(rel), extname(rel).toLowerCase());
    assert.ok(d && d.largura > 0 && d.altura > 0, `${rel}: dimensões ilegíveis`);
    if (rel.startsWith('assets/img/og/')) esperado[rel] = [1200, 630];
    if (esperado[rel]) assert.deepEqual([d.largura, d.altura], esperado[rel], `${rel}: dimensões`);
  }
  const manifest = JSON.parse(ler('manifest.webmanifest'));
  for (const i of manifest.icons) {
    const rel = i.src;
    assert.ok(existsSync(join(RAIZ, rel)), `manifest: ${rel} não existe`);
    if (i.sizes === 'any') continue;
    const d = dimensoes(ler(rel), extname(rel));
    assert.equal(`${d.largura}x${d.altura}`, i.sizes, `manifest: ${rel} declara ${i.sizes}`);
  }
});

test('toda <img> do HTML tem width, height e alt, na proporção real do arquivo', () => {
  let total = 0;
  for (const pagina of HTML) {
    const html = ler(pagina).toString('utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
      total++;
      const attr = (n) => (new RegExp(`\\s${n}="([^"]*)"`, 'i').exec(tag) || [])[1];
      const w = attr('width'), h = attr('height'), src = attr('src');
      assert.ok(/^\d+$/.test(w || '') && /^\d+$/.test(h || '') && +w > 0 && +h > 0, `${pagina}: <img> sem width/height numéricos → ${tag}`);
      assert.ok(attr('alt') !== undefined, `${pagina}: <img> sem alt → ${tag}`);
      if (!src || /^(https?:|data:)/.test(src)) continue;
      const arquivo = src.startsWith('/empresa-jp/') ? join(RAIZ, src.slice('/empresa-jp/'.length)) : resolve(RAIZ, dirname(pagina), src);
      assert.ok(existsSync(arquivo), `${pagina}: ${src} não existe`);
      const d = dimensoes(readFileSync(arquivo), extname(arquivo).toLowerCase());
      if (!d) continue;
      const erro = Math.abs(w / h - d.largura / d.altura) / (d.largura / d.altura);
      assert.ok(erro < 0.01, `${pagina}: ${src} declarado ${w}×${h}, arquivo ${d.largura}×${d.altura} (proporção diferente)`);
    }
  }
  assert.ok(total > 20, `encontrou as <img> (${total})`);
});

test('<img> criadas pelo JavaScript recebem width e height', () => {
  for (const arq of JS) {
    const linhas = ler(arq).toString('utf8').split('\n');
    linhas.forEach((l, i) => {
      // new Image() sem ir para o DOM (ex.: desenhar o favicon no canvas) não conta
      if (!/createElement\(\s*['"]img['"]\s*\)|criar\(\s*['"]img['"]/.test(l)) return;
      const nome = (/var\s+(\w+)\s*=/.exec(l) || [])[1];
      assert.ok(nome, `${arq}:${i + 1}: atribua a <img> a uma variável`);
      const depois = linhas.slice(i, i + 20).join('\n');
      assert.ok(new RegExp(`${nome}\\.width\\s*=`).test(depois) && new RegExp(`${nome}\\.height\\s*=`).test(depois),
        `${arq}:${i + 1}: <img> criada sem width/height (CLS)`);
    });
  }
});

test('SVGs otimizados e seguros (sem script, eventos ou recursos externos)', () => {
  for (const rel of IMAGENS.filter((f) => f.endsWith('.svg'))) {
    const t = ler(rel).toString('utf8');
    assert.deepEqual(problemasSvg(t), [], `${rel}: ${problemasSvg(t).join(', ')}`);
    assert.equal(otimizarSvg(t), t, `${rel}: ainda pode ser otimizado → node testes/imagens/otimizar.mjs`);
  }
});

test('nenhuma imagem órfã em assets/img (todas usadas em alguma página, CSS, JS ou manifest)', () => {
  const fontes = [...HTML, ...JS, ...listar(join(RAIZ, 'assets/css'), /\.css$/).map((f) => relative(RAIZ, f)), 'config.js', 'manifest.webmanifest']
    .map((f) => ler(f).toString('utf8')).join('\n');
  for (const rel of IMAGENS) {
    if (rel.startsWith('assets/img/portfolio/')) continue; // usadas pelo config.js via campo "foto" (melhoria 21)
    assert.ok(fontes.includes(basename(rel)), `${rel}: não é usada em lugar nenhum (apague ou use)`);
  }
});

test('otimizador de SVG: regras próprias sem mudar o desenho', () => {
  const sujo = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Criado no editor -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" viewBox="0 0 24.000001 24" xml:space="preserve">
  <metadata><rdf:RDF/></metadata>
  <sodipodi:namedview id="nv" pagecolor="#ffffff"/>
  <title>Ícone</title>
  <path inkscape:label="Camada" d="M 1.23456,2.5 L 10.98765 3" fill="#FFFFFF" stroke="#077A57"  data-name="x" />
  <circle cx="12.3333333" cy="4" r="2"></circle>
</svg>`;
  const limpo = otimizarSvg(sujo);
  assert.equal(limpo, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Ícone</title>'
    + '<path d="M 1.23,2.5 L 10.99 3" fill="#FFF" stroke="#077A57"/><circle cx="12.33" cy="4" r="2"></circle></svg>\n');
  assert.equal(otimizarSvg(limpo), limpo, 'idempotente');
  // xlink só fica se for usado; acessibilidade preservada
  const comUso = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 2 2" role="img" aria-label="A"><use xlink:href="#a"/></svg>';
  assert.match(otimizarSvg(comUso), /xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/);
  assert.match(otimizarSvg(comUso), /role="img" aria-label="A"/);
  assert.deepEqual(problemasSvg('<svg viewBox="0 0 1 1" onload="x()"><script/></svg>'), ['<script>', 'atributo de evento (on*)']);
  assert.ok(problemasSvg('<svg viewBox="0 0 1 1"><image href="https://x.y/a.png"/></svg>').includes('link para recurso externo'));
});

// Melhoria 104: o que as metatags prometem às redes sociais bate com o arquivo de verdade.
// og:image:type pelo conteúdo (assinatura), largura/altura reais, imagem do próprio site e leve o bastante
// para o WhatsApp mostrar a prévia grande (ele ignora imagens pesadas; aqui o limite é ~35 KB).
const ASSINATURAS = {
  'image/png': (b) => b.toString('latin1', 1, 4) === 'PNG',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.toString('latin1', 0, 4) + b.toString('latin1', 8, 12) === 'RIFFWEBP',
};
const EXT_DO_TIPO = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

test('og:image: tipo, dimensões e arquivo batem com as metatags em todas as páginas', () => {
  const meta = (h, nome) => {
    const tag = [...h.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0])
      .find((t) => new RegExp(`\\s(?:property|name)="${nome.replace(/[.:]/g, '\\$&')}"`).test(t));
    return tag ? (/\scontent="([^"]*)"/.exec(tag) || [])[1] : undefined;
  };
  let conferidas = 0;
  for (const pagina of HTML) {
    const h = ler(pagina).toString('utf8').replace(/<!--[\s\S]*?-->/g, '');
    const url = meta(h, 'og:image');
    if (!url) continue;
    conferidas++;
    const rel = (/\/(assets\/img\/[^?#"]+)$/.exec(url) || [])[1];
    assert.ok(rel && existsSync(join(RAIZ, rel)), `${pagina}: og:image ${url} não é um arquivo de assets/img`);
    const tipo = meta(h, 'og:image:type');
    assert.ok(ASSINATURAS[tipo], `${pagina}: og:image:type "${tipo}" não é PNG nem JPEG (formatos que toda rede social lê)`);
    if (tipo === 'image/webp') assert.fail(`${pagina}: og:image em WebP não aparece em todas as redes; use PNG ou JPEG`);
    const buf = ler(rel);
    assert.ok(ASSINATURAS[tipo](buf), `${pagina}: og:image:type ${tipo}, mas ${rel} não é desse tipo`);
    assert.equal(extname(rel).replace('.jpeg', '.jpg'), EXT_DO_TIPO[tipo], `${pagina}: extensão de ${rel} diferente do tipo ${tipo}`);
    const d = dimensoes(buf, tipo === 'image/png' ? '.png' : extname(rel));
    if (d) {
      assert.equal(String(d.largura), meta(h, 'og:image:width'), `${pagina}: og:image:width ≠ largura real de ${rel}`);
      assert.equal(String(d.altura), meta(h, 'og:image:height'), `${pagina}: og:image:height ≠ altura real de ${rel}`);
    }
    const tw = meta(h, 'twitter:image');
    if (tw) assert.equal(tw, url, `${pagina}: twitter:image diferente do og:image`);
  }
  assert.ok(conferidas >= 13, `conferiu ${conferidas} páginas com og:image`);
});
