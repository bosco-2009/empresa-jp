// Auditoria de peso das imagens no navegador (melhoria 42): tamanho real × exibido em todas as páginas.
//
//   python3 -m http.server 8080 &      (na raiz)
//   node testes/imagens/auditar.mjs    (grava testes/e2e/saida/imagens.md e sai com erro se algo falhar)
//
// Para cada página, em 375 e 1280 px com tela de densidade 2 (celular comum e notebook):
// - FALHA: <img> sem width/height (causa CLS) ou cuja proporção declarada difere da exibida;
// - AVISO: imagem rasterizada maior que 2× o necessário (desperdício) ou menor que o necessário (fica borrada).
// SVGs escalam sem perda: só entram na contagem de bytes.
import { readFileSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const configTeste = readFileSync(join(RAIZ, 'config.js'), 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`);

const PAGINAS = [
  '', 'planos.html', 'obrigado.html', 'briefing.html', 'pedido.html', 'termos.html', 'privacidade.html', 'portfolio.html',
  'exemplos.html', 'blog/', 'blog/autor.html',
  ...['site-ou-instagram', 'o-que-um-site-profissional-precisa-ter', 'como-funciona-a-criacao-do-seu-site'].map((x) => `blog/${x}.html`),
  ...['moda', 'restaurante', 'beleza', 'saude', 'servicos', 'pet'].map((x) => `exemplos/${x}.html`),
  ...['restaurante', 'moda', 'beleza', 'saude', 'servicos', 'pet'].map((x) => `segmentos/${x}.html`),
  'admin/',
];
const LARGURAS = [375, 1280];
const DPR = 2;

const falhas = [], avisos = [];
const usos = new Map(); // arquivo → { bytes, real, exibido máx. em px físicos, páginas }
const navegador = await chromium.launch();
for (const caminho of PAGINAS) {
  for (const w of LARGURAS) {
    const ctx = await navegador.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: DPR, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.route('**/config.js', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
    await p.goto(SITE + caminho, { waitUntil: 'networkidle' });
    // Força o carregamento das lazy (rola até o fim) para medir todas
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } });
    await p.waitForLoadState('networkidle');
    const imgs = await p.evaluate(() => [...document.images].map((i) => {
      const r = i.getBoundingClientRect();
      return { src: i.currentSrc || i.src, w: i.getAttribute('width'), h: i.getAttribute('height'), nw: i.naturalWidth, nh: i.naturalHeight, cw: r.width, ch: r.height, visivel: r.width > 0 && r.height > 0 };
    }));
    const rotulo = `${caminho || 'home'} @${w}px`;
    for (const i of imgs) {
      const url = new URL(i.src);
      const rel = decodeURIComponent(url.pathname.replace(/^\/(empresa-jp\/)?/, ''));
      if (!i.w || !i.h) falhas.push(`${rotulo}: ${rel} sem width/height`);
      if (!i.visivel) continue;
      if (Math.abs(i.cw / i.ch - i.w / i.h) / (i.w / i.h) > 0.02) falhas.push(`${rotulo}: ${rel} declarado ${i.w}×${i.h}, exibido ${Math.round(i.cw)}×${Math.round(i.ch)} (distorcido)`);
      const arquivo = join(RAIZ, rel);
      const u = usos.get(rel) || { bytes: existsSync(arquivo) ? statSync(arquivo).size : 0, real: `${i.nw}×${i.nh}`, maxFisico: 0, paginas: new Set() };
      u.maxFisico = Math.max(u.maxFisico, Math.round(i.cw * DPR));
      u.paginas.add(caminho || 'home');
      usos.set(rel, u);
      if (!rel.endsWith('.svg')) {
        const necessario = i.cw * DPR;
        if (i.nw > 2 * necessario && i.nw - necessario > 64) avisos.push(`${rotulo}: ${rel} tem ${i.nw} px de largura para ${Math.round(necessario)} px exibidos (desperdício)`);
        if (i.nw < necessario * 0.9) avisos.push(`${rotulo}: ${rel} tem ${i.nw} px para ${Math.round(necessario)} px exibidos (pode ficar borrada)`);
      }
    }
    await ctx.close();
  }
}
await navegador.close();

const linhas = ['# Imagens: tamanho real × exibido', '', `Gerado por testes/imagens/auditar.mjs em ${new Date().toISOString().slice(0, 16)} UTC, telas de 375 e 1280 px com densidade ${DPR}.`, '',
  '| Arquivo | Bytes | Real (px) | Maior exibição (px físicos) | Páginas |', '|---|---:|---|---:|---:|'];
for (const [rel, u] of [...usos].sort()) linhas.push(`| ${rel} | ${u.bytes} | ${u.real} | ${u.maxFisico} | ${u.paginas.size} |`);
linhas.push('', `Falhas: ${falhas.length}`, ...falhas.map((f) => `- ${f}`), '', `Avisos: ${avisos.length}`, ...avisos.map((a) => `- ${a}`), '');
const saida = join(RAIZ, 'testes/e2e/saida');
mkdirSync(saida, { recursive: true });
writeFileSync(join(saida, 'imagens.md'), linhas.join('\n'));
console.log(linhas.join('\n'));
console.log(`${PAGINAS.length} páginas × ${LARGURAS.length} larguras. Relatório: testes/e2e/saida/imagens.md`);
process.exit(falhas.length ? 1 : 0);
