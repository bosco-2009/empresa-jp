// Uso: veja testes/README.md
// Auditoria de TODAS as páginas em 320, 375, 768 e 1280 px:
//   rolagem horizontal, console (inclui violações de CSP), axe (falha em serious/critical) e teclado
//   (Tab passa por todos os controles com foco visível e o link "Pular para o conteúdo" vem primeiro).
// O 404.html é servido num caminho profundo, como o GitHub Pages faz.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const RAIZ = path.resolve(__dirname, '../..');
const AXE = require.resolve('axe-core/axe.min.js');
const configTeste = fs.readFileSync(RAIZ + '/config.js', 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);

const PAGINAS = [
  ['home', ''], ['planos', 'planos.html'], ['obrigado', 'obrigado.html'], ['briefing', 'briefing.html'],
  ['termos', 'termos.html'], ['privacidade', 'privacidade.html'], ['portfolio', 'portfolio.html'],
  ['exemplos', 'exemplos.html'],
  ...['moda', 'restaurante', 'beleza', 'saude', 'servicos', 'pet'].map((x) => ['exemplo-' + x, `exemplos/${x}.html`]),
  ['404', 'empresa-jp/uma/pagina/que/nao/existe'], ['admin', 'admin/'],
];
const LARGURAS = [320, 375, 768, 1280];

let falhas = 0;
const menores = new Set();
function ok(cond, msg) { if (!cond) { falhas++; console.log('  ✘ ' + msg); } return cond; }

(async () => {
  const browser = await chromium.launch();
  const html404 = fs.readFileSync(RAIZ + '/404.html', 'utf8');
  let verificacoes = 0;

  for (const [nome, caminho] of PAGINAS) {
    for (const w of LARGURAS) {
      // reducedMotion: sem a rolagem suave, o foco já está na tela quando medimos (e testa esse modo também)
      const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, reducedMotion: 'reduce' });
      const p = await ctx.newPage();
      const erros = [];
      p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') erros.push(m.text()); });
      p.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
      await p.route('**/config.js', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
      await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
      if (nome === '404') {
        // GitHub Pages: qualquer caminho inexistente recebe o 404.html; os recursos usam /empresa-jp/...
        await p.route('**/empresa-jp/uma/pagina/**', (r) => r.fulfill({ status: 404, body: html404, contentType: 'text/html; charset=utf-8' }));
        await p.route('**/empresa-jp/**', (r) => {
          const u = new URL(r.request().url());
          const arquivo = path.join(RAIZ, decodeURIComponent(u.pathname.replace(/^\/empresa-jp\//, '')));
          if (fs.existsSync(arquivo) && fs.statSync(arquivo).isFile()) return r.fulfill({ path: arquivo });
          return r.fallback();
        });
      }
      await p.goto(SITE + caminho, { waitUntil: 'networkidle' });
      await p.waitForTimeout(150);
      const rotulo = `${nome} @${w}px`;

      // 1. rolagem horizontal
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${rotulo}: rolagem horizontal`);

      // 2. axe
      await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
      const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
        .violations.map((x) => ({ id: x.id, impacto: x.impact, alvos: x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ') })));
      v.filter((x) => x.impacto === 'serious' || x.impacto === 'critical').forEach((x) => ok(false, `${rotulo}: axe ${x.impacto} ${x.id} → ${x.alvos}`));
      v.filter((x) => x.impacto !== 'serious' && x.impacto !== 'critical').forEach((x) => menores.add(`${nome}: ${x.impacto} ${x.id} → ${x.alvos}`));

      // 3. teclado (só em 375 e 1280 para não alongar demais)
      if (w === 375 || w === 1280) {
        const paradas = [];
        for (let i = 0; i < 80; i++) {
          await p.keyboard.press('Tab');
          // espera (até 300 ms) o elemento focado terminar a transição e ficar visível; sem tempo fixo
          await p.waitForFunction(() => {
            const e = document.activeElement;
            if (!e || e === document.body) return true;
            const r = e.getBoundingClientRect();
            return r.bottom > 0 && r.top < innerHeight;
          }, null, { timeout: 300 }).catch(() => {});
          const info = await p.evaluate(() => {
            const e = document.activeElement;
            if (!e || e === document.body) return null;
            const cs = getComputedStyle(e);
            const r = e.getBoundingClientRect();
            const visivelFoco = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || (cs.boxShadow && cs.boxShadow !== 'none')
              || (e.closest('label') && getComputedStyle(e.closest('label')).outlineStyle !== 'none');
            const rotulo = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('name') || e.id || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
            return { tag: e.tagName, rotulo, visivelFoco, tamanho: r.width > 0 && r.height > 0, dentro: r.bottom > 0 && r.top < innerHeight };
          });
          if (!info) break;
          const chave = info.tag + ':' + info.rotulo;
          if (paradas.length && paradas[0] === chave) break; // deu a volta
          paradas.push(chave);
          verificacoes++;
          ok(info.tamanho && info.dentro, `${rotulo}: foco em elemento invisível ou fora da tela (${chave})`);
          ok(info.visivelFoco, `${rotulo}: foco sem indicador visível (${chave})`);
        }
        if (nome !== 'admin') ok(/Pular para o conteúdo/.test(paradas[0] || ''), `${rotulo}: primeiro Tab não é "Pular para o conteúdo" (${paradas[0]})`);
        ok(paradas.length >= 3, `${rotulo}: poucas paradas de teclado (${paradas.length})`);
        if (w === 1280) console.log(`  ${nome}: ${paradas.length} paradas de Tab com foco visível`);
      }

      // 4. console
      const relevantes = erros.filter((e) => !(nome === '404' && /status of 404/.test(e)));
      ok(relevantes.length === 0, `${rotulo}: console → ${relevantes.join(' | ')}`);
      verificacoes += 3;
      await ctx.close();
    }
  }

  // "Pular para o conteúdo" leva o foco ao <main>
  {
    const p = await browser.newPage({ viewport: { width: 375, height: 800 } });
    await p.route('**/config.js', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await p.keyboard.press('Tab');
    await p.keyboard.press('Enter');
    ok(await p.evaluate(() => document.activeElement.id) === 'conteudo', 'Pular para o conteúdo não leva o foco ao <main>');
    // menu móvel por teclado
    await p.focus('[data-menu-botao]');
    await p.keyboard.press('Enter');
    ok(await p.isVisible('#menu-principal'), 'menu móvel não abre pelo teclado');
    await p.keyboard.press('Escape');
    ok(await p.isHidden('#menu-principal') && await p.evaluate(() => document.activeElement.hasAttribute('data-menu-botao')), 'Esc não fecha o menu ou não devolve o foco');
    // FAQ por teclado
    await p.focus('.faq__pergunta');
    await p.keyboard.press('Enter');
    ok(await p.evaluate(() => document.querySelector('.faq__item').open), 'FAQ não abre pelo teclado');
    verificacoes += 4;
    await p.close();
  }

  await browser.close();
  if (menores.size) {
    console.log('\nAvisos menores do axe (moderate/minor, não bloqueiam):');
    [...menores].forEach((m) => console.log('  · ' + m));
  }
  console.log(`\n${PAGINAS.length} páginas × ${LARGURAS.length} larguras, ${verificacoes} verificações`);
  console.log(falhas ? `${falhas} FALHA(S)` : 'AUDITORIA OK: sem rolagem horizontal, sem erros no console, axe sem violações sérias/críticas, teclado com foco visível');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
