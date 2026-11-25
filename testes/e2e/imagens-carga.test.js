// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Melhoria 130: imagens fora do caminho crítico.
//  [1] HTML: nenhuma página cita imagem de assets/img/og/ fora das metatags/JSON-LD (og:image, twitter:image,
//      "image"), nem com <link rel="preload|prefetch"> ou <img>; toda <img> estática de miniaturas/ que não é a
//      LCP do blog (melhoria 106) tem loading="lazy".
//  [2] Navegador (320, 375, 768 e 1280 px; altura 800), carga SEM rolar, até o networkidle: nenhuma página pede
//      imagem de og/; toda imagem pedida é visível na 1ª tela ou tem loading="lazy" (neste caso quem decide a
//      distância de antecipação é o navegador). Isto pega <img> estática esquecida sem lazy abaixo da dobra.
//  [3] Rolando até o fim, as miniaturas lazy chegam (o lazy não quebrou nada) e continua sem pedir og/.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const RAIZ = path.join(__dirname, '..', '..');
const LARGURAS = [320, 375, 768, 1280];
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

function paginas(dir, prefixo = '') {
  return fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory() && ['blog', 'exemplos', 'segmentos'].includes(e.name) && !prefixo) return paginas(e.name, e.name + '/');
    return e.isFile() && e.name.endsWith('.html') ? [prefixo + e.name] : [];
  });
}
// Única miniatura estática sem lazy (é o LCP de blog/index.html; travada também em lcp.test.js).
const MINIATURA_LCP = { 'blog/index.html': 'miniaturas/blog-site-ou-instagram-400.png' };

(async () => {
  const publicas = paginas('.');
  console.log('\n[1] HTML: og/ só em metatags e JSON-LD; miniaturas com lazy');
  for (const p of publicas) {
    const html = fs.readFileSync(path.join(RAIZ, p), 'utf8');
    const semMeta = html
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
      .replace(/<meta (?:property|name)="(?:og|twitter):image(?::[a-z]+)?" content="[^"]*">/g, '');
    ok(!/assets\/img\/og\//.test(semMeta), `${p}: og/ não aparece fora de og:image/twitter:image/JSON-LD`);
    const minis = [...html.matchAll(/<img\b[^>]*miniaturas\/[^>]*>/g)].map((m) => m[0]);
    for (const tag of minis) {
      const lcp = MINIATURA_LCP[p] && tag.includes(MINIATURA_LCP[p]);
      if (lcp) ok(!/loading=/.test(tag), `${p}: miniatura LCP sem loading="lazy"`);
      else ok(/loading="lazy"/.test(tag), `${p}: miniatura com loading="lazy" (${(/src="([^"]+)"/.exec(tag) || [])[1]})`);
    }
  }

  const browser = await chromium.launch();
  console.log('\n[2] Carga sem rolar: nada de og/; imagem pedida = visível na 1ª tela ou lazy');
  for (const url of publicas) {
    for (const largura of LARGURAS) {
      const ctx = await browser.newContext({ viewport: { width: largura, height: 800 }, deviceScaleFactor: 1 });
      const pg = await ctx.newPage();
      const erros = [];
      const pedidas = [];
      pg.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
      pg.on('pageerror', (e) => erros.push(e.message));
      pg.on('request', (r) => { if (r.resourceType() === 'image') pedidas.push(r.url()); });
      await pg.route('**/empresa-jp/**', (r) => r.continue({ url: r.request().url().replace('/empresa-jp/', '/') }));
      await pg.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* sem storage */ } });
      await pg.goto(SITE + (url === 'index.html' ? '' : url), { waitUntil: 'networkidle' });
      await pg.waitForTimeout(300);
      const nome = `${url} @${largura}`;
      const og = pedidas.filter((u) => u.includes('/assets/img/og/'));
      ok(og.length === 0, `${nome}: nenhuma imagem og/ pedida` + (og.length ? ': ' + og.join(', ') : ''));
      // Para cada imagem pedida (não data:), acha o <img> e confere: na 1ª tela, ou com loading="lazy".
      const urls = [...new Set(pedidas.filter((u) => !u.startsWith('data:')))];
      const fora = await pg.evaluate((lista) => {
        const alturaTela = innerHeight;
        const ruins = [];
        for (const u of lista) {
          const imgs = [...document.images].filter((i) => i.currentSrc === u || i.src === u);
          if (!imgs.length) continue; // favicon, ícone do manifest, sprite etc.: não são <img>
          const aceitavel = imgs.some((i) => {
            if (i.loading === 'lazy') return true;
            const r = i.getBoundingClientRect();
            return r.top < alturaTela && r.bottom > 0;
          });
          if (!aceitavel) ruins.push(u.replace(location.origin, '') + ' @' + Math.round(imgs[0].getBoundingClientRect().top) + 'px');
        }
        return ruins;
      }, urls);
      ok(fora.length === 0, `${nome}: toda imagem pedida está na 1ª tela ou é lazy` + (fora.length ? ': ' + fora.join(', ') : ''));
      ok(erros.length === 0, `${nome}: sem erros no console` + (erros.length ? ': ' + erros.join(' | ') : ''));

      if (largura === 375) {
        // [3] rolar até o fim: as lazy chegam, e og/ continua fora.
        const lazy = await pg.evaluate(() => [...document.images].filter((i) => i.loading === 'lazy' && i.getClientRects().length).length);
        if (lazy) {
          await pg.evaluate(async () => {
            for (let y = 0; y <= document.documentElement.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
          });
          await pg.waitForLoadState('networkidle');
          await pg.waitForFunction(() => [...document.images]
            .filter((i) => i.loading === 'lazy' && i.getClientRects().length)
            .every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 5000 }).catch(() => {});
          const r = await pg.evaluate(() => [...document.images]
            .filter((i) => i.loading === 'lazy' && i.getClientRects().length)
            .map((i) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 })));
          const faltam = r.filter((i) => !i.ok).map((i) => i.src);
          ok(faltam.length === 0, `${nome}: depois de rolar, as ${r.length} imagens lazy carregaram` + (faltam.length ? ': ' + faltam.join(', ') : ''));
          ok(!pedidas.some((u) => u.includes('/assets/img/og/')), `${nome}: depois de rolar, nenhuma og/`);
        }
      }
      await ctx.close();
    }
  }
  console.log('\n[4] Avatar do chat: lazy no painel oculto, carrega quando o painel aparece');
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const pg = await ctx.newPage();
    const pedidas = [];
    pg.on('request', (r) => { if (r.resourceType() === 'image') pedidas.push(r.url()); });
    await pg.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* sem storage */ } });
    await pg.goto(SITE + 'exemplos/moda.html', { waitUntil: 'networkidle' });
    await pg.waitForSelector('.chat__avatar', { state: 'attached' });
    const antes = await pg.evaluate(() => { const a = document.querySelector('.chat__avatar'); return { lazy: a.loading, dec: a.decoding }; });
    ok(antes.lazy === 'lazy' && antes.dec === 'async', 'avatar com loading="lazy" e decoding="async"');
    ok(!pedidas.some((u) => u.includes('logo-icone.svg')), 'exemplo (sem logo no cabeçalho): o avatar não é pedido na carga');
    await pg.evaluate(() => { document.getElementById('chat-painel').hidden = false; });
    const carregou = await pg.waitForFunction(() => { const a = document.querySelector('.chat__avatar'); return a.complete && a.naturalWidth > 0; }, null, { timeout: 5000 }).then(() => true, () => false);
    ok(carregou, 'com o painel visível, o avatar carrega');
    await ctx.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
