// Uso: veja testes/README.md (precisa só do servidor estático em :8080, python3 + Pillow)
// Imagens responsivas do portfólio (melhoria 21): o gerador corta em 4:3, grava WebP + PNG em 3 larguras sem
// metadados, e o site monta <picture> com srcset/sizes. Usa um projeto FALSO só dentro do teste (o config.js real
// continua sem projetos e a seção continua oculta).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const RAIZ = path.resolve(__dirname, '../..');
const AXE = require.resolve('axe-core/axe.min.js');
const configBase = fs.readFileSync(RAIZ + '/config.js', 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`).replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
const configComProjeto = configBase.replace(/projetos:\s*\[\]/,
  "projetos: [{ nome: 'Projeto de teste', segmento: 'Teste automatizado', foto: 'projeto-teste', alt: 'Captura do projeto de teste' }]");
let falhas = 0;
function ok(c, m) { if (c) console.log('  ✔ ' + m); else { falhas++; console.log('  ✘ ' + m); } }

(async () => {
  // 1. Gerador: original 1600×1000 (16:10) com EXIF → 6 arquivos 4:3 sem metadados
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbr-portfolio-'));
  const entrada = path.join(tmp, 'originais'), saida = path.join(tmp, 'saida');
  fs.mkdirSync(entrada);
  execFileSync('python3', ['-c', `
from PIL import Image
# parecida com uma captura real: gradiente, ruído e blocos de "texto"
ruido = Image.effect_noise((1600, 1000), 40).convert('RGB')
img = Image.blend(Image.linear_gradient('L').resize((1600, 1000)).convert('RGB'), ruido, 0.35)
for y in range(80, 1000, 120): img.paste((11, 22, 48), (120, y, 900, y + 24))
exif = Image.Exif(); exif[0x010F] = 'CameraTeste'
img.save(r'${path.join(entrada, 'projeto-teste.jpg')}', exif=exif)
`]);
  fs.writeFileSync(path.join(entrada, 'Nome Ruim.png'), '');
  let erroNome = '';
  try { execFileSync('python3', [RAIZ + '/testes/portfolio/gerar.py', '--entrada', entrada, '--saida', saida], { stdio: 'pipe' }); }
  catch (e) { erroNome = String(e.stderr); }
  ok(/minúsculas/.test(erroNome), 'gerador recusa nome de arquivo fora do padrão');
  fs.unlinkSync(path.join(entrada, 'Nome Ruim.png'));
  execFileSync('python3', [RAIZ + '/testes/portfolio/gerar.py', '--entrada', entrada, '--saida', saida], { stdio: 'pipe' });
  const info = JSON.parse(execFileSync('python3', ['-c', `
import json, os
from PIL import Image
d = r'${saida}'
out = {}
for f in sorted(os.listdir(d)):
    with Image.open(os.path.join(d, f)) as i:
        out[f] = [i.width, i.height, len(i.getexif()), 'icc_profile' in i.info, os.path.getsize(os.path.join(d, f))]
print(json.dumps(out))
`]).toString());
  const esperados = [480, 800, 1200].flatMap((l) => ['webp', 'png'].map((e) => `projeto-teste-${l}.${e}`)).sort();
  ok(JSON.stringify(Object.keys(info).sort()) === JSON.stringify(esperados), '6 arquivos: 480/800/1200 em WebP e PNG');
  ok(Object.entries(info).every(([f, [w, h]]) => w === Number(f.match(/-(\d+)\./)[1]) && h * 4 === w * 3), 'todas em 4:3 na largura certa');
  ok(Object.values(info).every(([, , exif, icc]) => exif === 0 && !icc), 'sem EXIF nem perfil ICC');
  ok(info['projeto-teste-800.webp'][4] < info['projeto-teste-800.png'][4], 'WebP menor que o PNG');

  // 2. Site: <picture> com srcset/sizes, WebP escolhido, largura adequada à tela
  const b = await chromium.launch();
  for (const [w, minimo, maximo] of [[320, 480, 800], [375, 480, 800], [768, 480, 800], [1280, 480, 800]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const erros = [];
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') erros.push(m.text()); });
    p.on('pageerror', (e) => erros.push(e.message));
    p.on('response', (r) => { if (r.status() >= 400) erros.push(r.status() + ' ' + r.url()); });
    await p.route('**/config.js', (r) => r.fulfill({ body: configComProjeto, contentType: 'application/javascript' }));
    await p.route('**/assets/img/portfolio/*', (r) => {
      const arq = path.join(saida, path.basename(new URL(r.request().url()).pathname));
      return fs.existsSync(arq) ? r.fulfill({ path: arq }) : r.fulfill({ status: 404 });
    });
    await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
    await p.addInitScript(() => sessionStorage.setItem('pbr_abertura_vista', '1'));
    await p.goto(SITE + 'portfolio.html', { waitUntil: 'networkidle' });
    const img = p.locator('.projeto picture.projeto__foto img');
    await img.scrollIntoViewIfNeeded();
    await p.waitForFunction(() => { const i = document.querySelector('.projeto img'); return i && i.complete && i.naturalWidth > 0; });
    const d = await img.evaluate((i) => ({
      src: i.currentSrc, alt: i.alt, w: i.getAttribute('width'), h: i.getAttribute('height'), loading: i.loading,
      tipo: i.parentElement.querySelector('source').type, caixa: i.getBoundingClientRect(),
    }));
    const larg = Number((d.src.match(/-(\d+)\.webp$/) || [])[1]);
    ok(/\.webp$/.test(d.src), `@${w}px: navegador escolheu o WebP (${path.basename(d.src)})`);
    ok(larg >= minimo && larg <= maximo && larg >= d.caixa.width, `@${w}px: largura ${larg} cobre o card de ${Math.round(d.caixa.width)}px sem exagero`);
    ok(Math.abs(d.caixa.width / d.caixa.height - 4 / 3) < 0.02, `@${w}px: card em 4:3`);
    if (w === 375) {
      ok(d.alt === 'Captura do projeto de teste' && d.w === '1200' && d.h === '900' && d.loading === 'lazy', 'alt, width/height e loading="lazy"');
      ok(d.tipo === 'image/webp', '<source type="image/webp">');
      ok(await p.isVisible('[data-secao-portfolio]') && await p.isHidden('[data-portfolio-vazio]'), 'seção aparece com projeto real; aviso de vazio some');
      // JSON-LD do portfólio (melhoria 61): CollectionPage + ItemList só com os projetos do config.js
      const ld = await p.evaluate(() => { const s = document.querySelector('script[data-ld-portfolio]'); return s ? JSON.parse(s.textContent) : null; });
      const can = await p.getAttribute('link[rel="canonical"]', 'href');
      ok(ld && ld['@type'] === 'CollectionPage' && ld.url === can && ld['@id'] === can + '#pagina', 'JSON-LD CollectionPage com url = canonical');
      ok(ld && ld.mainEntity.numberOfItems === 1 && ld.mainEntity.itemListElement[0].item.name === 'Projeto de teste'
        && ld.mainEntity.itemListElement[0].item.genre === 'Teste automatizado' && !/review|rating/i.test(JSON.stringify(ld)), 'ItemList com o projeto real, sem avaliações');
      await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
      const v = await p.evaluate(async () => (await axe.run()).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => x.id));
      ok(v.length === 0, 'axe sem violações sérias' + (v.length ? ': ' + v.join(', ') : ''));
      await p.screenshot({ path: path.join(__dirname, 'saida', 'portfolio-375.png'), fullPage: false }).catch(() => {});
    }
    if (w === 1280) await p.screenshot({ path: path.join(__dirname, 'saida', 'portfolio-1280.png') }).catch(() => {});
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `@${w}px: sem rolagem horizontal`);
    ok(erros.length === 0, `@${w}px: sem erros no console` + (erros.length ? ': ' + erros.join(' | ') : ''));
    await ctx.close();
  }

  // 3. Retina 2x no celular pede a versão maior
  const ctx2 = await b.newContext({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2 });
  const p2 = await ctx2.newPage();
  await p2.route('**/config.js', (r) => r.fulfill({ body: configComProjeto, contentType: 'application/javascript' }));
  await p2.route('**/assets/img/portfolio/*', (r) => r.fulfill({ path: path.join(saida, path.basename(new URL(r.request().url()).pathname)) }));
  await p2.goto(SITE + 'portfolio.html', { waitUntil: 'networkidle' });
  await p2.locator('.projeto img').scrollIntoViewIfNeeded();
  await p2.waitForFunction(() => document.querySelector('.projeto img').complete);
  ok(/-800\.webp$/.test(await p2.$eval('.projeto img', (i) => i.currentSrc)), 'tela 2x de 375px usa a de 800px');

  // 4. Sem projetos (config real): seção continua oculta e nenhuma imagem do portfólio é pedida
  const pedidas = [];
  const p3 = await ctx2.newPage();
  p3.on('request', (r) => { if (r.url().includes('/assets/img/portfolio/')) pedidas.push(r.url()); });
  await p3.route('**/config.js', (r) => r.fulfill({ body: configBase, contentType: 'application/javascript' }));
  await p3.goto(SITE + 'portfolio.html', { waitUntil: 'networkidle' });
  ok(await p3.locator('.projeto').count() === 0 && await p3.isVisible('[data-portfolio-vazio]'), 'sem projetos: portfolio.html só mostra o aviso de vazio');
  ok(await p3.locator('script[data-ld-portfolio]').count() === 0, 'sem projetos: nenhum JSON-LD de portfólio');
  await p3.goto(SITE, { waitUntil: 'networkidle' });
  ok(await p3.isHidden('[data-secao-portfolio]'), 'sem projetos: seção da home continua oculta');
  ok(pedidas.length === 0, 'sem projetos: nenhuma imagem do portfólio baixada');

  await b.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DO PORTFÓLIO PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
