// Otimiza as imagens do site (melhoria 42). Roda só na máquina de quem mantém o site; nada disso vai para o ar.
//
//   node testes/imagens/otimizar.mjs              # grava as versões otimizadas
//   node testes/imagens/otimizar.mjs --verificar  # só confere; sai com erro se algo ainda puder ser otimizado
//
// - SVG: regras próprias de testes/imagens/svg.mjs (sem dependências).
// - PNG: recompressão SEM PERDA com oxipng (pip install pyoxipng), tirando metadados. Se o pyoxipng não estiver
//   instalado, os PNGs são pulados com um aviso. Depois de cada PNG, os pixels são comparados com os de antes
//   (Pillow); qualquer diferença desfaz a troca.
// - WebP do portfólio: já sai otimizado do testes/portfolio/gerar.py (só é medido aqui).
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { otimizarSvg } from './svg.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const verificar = process.argv.includes('--verificar');

export function listarImagens(pasta = join(RAIZ, 'assets/img')) {
  const saida = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) saida.push(...listarImagens(caminho));
    else if (/\.(svg|png|webp|jpe?g|ico|gif|avif)$/i.test(nome)) saida.push(caminho);
  }
  return saida.sort();
}

const PY_PNG = `
import sys, oxipng
from PIL import Image, ImageChops
origem, copia = sys.argv[1], sys.argv[2]
oxipng.optimize(copia, level=6, strip=oxipng.StripChunks.safe())
a = Image.open(origem).convert('RGBA'); b = Image.open(copia).convert('RGBA')
print('igual' if a.size == b.size and ImageChops.difference(a, b).getbbox() is None else 'diferente')
`;

let temOxipng = true;
try { execFileSync('python3', ['-I', '-c', 'import oxipng, PIL'], { stdio: 'ignore' }); } catch { temOxipng = false; }

let antes = 0, depois = 0, pendentes = 0;
for (const arq of [...listarImagens(), join(RAIZ, 'favicon.ico')]) {
  const rel = relative(RAIZ, arq);
  const ext = extname(arq).toLowerCase();
  const b0 = statSync(arq).size;
  let b1 = b0;
  if (ext === '.svg') {
    const original = readFileSync(arq, 'utf8');
    const novo = otimizarSvg(original);
    if (novo !== original) {
      b1 = Buffer.byteLength(novo);
      if (verificar) { pendentes++; console.log(`✘ ${rel}: pode cair de ${b0} para ${b1} bytes (rode sem --verificar)`); }
      else writeFileSync(arq, novo);
    }
  } else if (ext === '.png' && temOxipng && !verificar) {
    const copia = join(tmpdir(), `pbr-otimizar-${process.pid}.png`);
    copyFileSync(arq, copia);
    const r = execFileSync('python3', ['-I', '-c', PY_PNG, arq, copia], { encoding: 'utf8' }).trim();
    const tam = statSync(copia).size;
    if (r === 'igual' && tam < b0) { copyFileSync(copia, arq); b1 = tam; }
    else if (r !== 'igual') console.log(`! ${rel}: pixels mudaram, mantido o original`);
    unlinkSync(copia);
  }
  antes += b0; depois += b1;
  if (!verificar) console.log(`${rel.padEnd(58)} ${String(b0).padStart(7)} → ${String(b1).padStart(7)} bytes${b1 < b0 ? `  (−${Math.round((1 - b1 / b0) * 100)}%)` : ''}`);
}
if (!temOxipng && !verificar) console.log('\n(pyoxipng não instalado: PNGs não foram recomprimidos. pip install pyoxipng)');
if (verificar) {
  if (pendentes) process.exit(1);
  console.log('✔ todas as imagens já estão otimizadas');
} else {
  console.log(`\nTotal: ${antes} → ${depois} bytes (−${antes - depois})`);
}
