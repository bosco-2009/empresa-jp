// Uso: servidor estático em :8080 (python3 -m http.server 8080 na raiz) e: node testes/e2e/continuar-plano.test.js
// Melhoria 116: "Continuar com o plano X" no bloco "Plano indicado" dos artigos e segmentos.
//  [1] Sem rascunho de contratação (visitante novo), rascunho de plano inexistente, vencido (> 30 dias), dispensado
//      na home há menos de 7 dias ou JSON quebrado: nada aparece e nada é gravado no localStorage.
//  [2] Com rascunho (pbr_checkout_rascunho_v1 da melhoria 60): o link aparece em todos os artigos e segmentos, com o
//      plano do rascunho (não o indicado), planos.html?plano=<id>&retomar=1 e data-origem-cta da própria página.
//  [3] 4 larguras: sem rolagem horizontal, console limpo, axe sem violações sérias, alvo ≥ 24 px, a altura reservada
//      pelo content-visibility (artigos) nunca menor que o bloco, e screenshots (claro e escuro).
//  [4] O clique abre planos.html com o plano marcado, o formulário preenchido e a origem "cta: ..." registrada.
const { chromium } = require('playwright');
const fs = require('fs');
const vm = require('vm');

const BASE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const RAIZ = require('path').resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const LARGURAS = [320, 375, 768, 1280];

const janela = {};
vm.runInNewContext(fs.readFileSync(RAIZ + '/config.js', 'utf8'), { window: janela });
const config = janela.PBR_CONFIG;
const caminho = (chave) => { const [t, s] = chave.split(':'); return (t === 'blog' ? 'blog/' : 'segmentos/') + s + '.html'; };
const CHAVES = Object.keys(config.planoIndicado);
const PLANO = config.planos[config.planos.length - 1]; // um plano que não é o indicado da maioria das páginas

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

const DIA = 864e5;
function rascunho(planoId, diasAtras) {
  return JSON.stringify({ plano_id: planoId, nome: 'Fulana Teste', whatsapp: '(11) 90000-0000', email: 'teste@exemplo.com',
    negocio: 'Loja Teste', salvo_em: new Date(Date.now() - diasAtras * DIA).toISOString() });
}

async function contexto(browser, w, itens, opcoes = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: w, height: 800 } }, opcoes));
  await ctx.addInitScript((dados) => {
    try {
      sessionStorage.setItem('pbr_abertura_vista', '1');
      if (!sessionStorage.getItem('__semeado')) {
        sessionStorage.setItem('__semeado', '1');
        Object.keys(dados).forEach((k) => localStorage.setItem(k, dados[k]));
      }
    } catch (e) { /* */ }
  }, itens);
  return ctx;
}

async function abrir(ctx, url) {
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.goto(new URL(url, BASE).href, { waitUntil: 'networkidle' });
  return p;
}

async function axe(p) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  return p.evaluate(async () => (await axe.run(document.querySelector('.indicado'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.impact} ${v.id}`));
}

// o chat guarda o próprio id anônimo (pbr_chat_v1) em toda página: fica fora da comparação
const chavesLs = (p) => p.evaluate(() => Object.keys(localStorage).filter((k) => k !== 'pbr_chat_v1').sort().join(','));

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Sem rascunho válido, nada aparece');
  const casos = {
    'visitante novo': {},
    'plano inexistente': { pbr_checkout_rascunho_v1: rascunho('nao-existe', 1) },
    'rascunho de 31 dias': { pbr_checkout_rascunho_v1: rascunho(PLANO.id, 31) },
    'JSON quebrado': { pbr_checkout_rascunho_v1: '{quebrado' },
  };
  const r2 = rascunho(PLANO.id, 2);
  casos['dispensado na home há 1 dia'] = { pbr_checkout_rascunho_v1: r2,
    pbr_retomada_dispensada_v1: JSON.stringify({ em: Date.now() - DIA, rascunho: JSON.parse(r2).salvo_em }) };
  for (const [nome, itens] of Object.entries(casos)) {
    const ctx = await contexto(browser, 375, itens);
    for (const chave of ['blog:site-ou-instagram', 'segmento:moda']) {
      const p = await abrir(ctx, caminho(chave));
      const antes = Object.keys(itens).sort().join(',');
      ok(await p.locator('[data-indicado-retomar]').count() === 0 && await chavesLs(p) === antes && p.erros.length === 0,
        `${nome} (${chave}): sem link, nada gravado, console limpo`);
      await p.close();
    }
    await ctx.close();
  }

  console.log('\n[2] Com rascunho: link em todos os artigos e segmentos');
  {
    const ctx = await contexto(browser, 375, { pbr_checkout_rascunho_v1: rascunho(PLANO.id, 3) });
    for (const chave of CHAVES) {
      const p = await abrir(ctx, caminho(chave));
      const a = p.locator('[data-indicado-retomar] a');
      const href = await a.getAttribute('href').catch(() => null);
      const origem = await a.getAttribute('data-origem-cta').catch(() => null);
      const [tipo, slug] = chave.split(':');
      ok(await a.count() === 1 && href === `../planos.html?plano=${PLANO.id}&retomar=1`
        && origem === tipo + '/' + slug && (await a.textContent()) === 'Continuar com o plano ' + PLANO.nome
        && await chavesLs(p) === 'pbr_checkout_rascunho_v1',
        `${chave}: "${await a.textContent().catch(() => '')}" → ${href} (${origem})`);
      await p.close();
    }
    await ctx.close();
  }

  console.log('\n[3] Larguras: rolagem, console, axe, alvo, altura reservada e screenshots');
  for (const w of LARGURAS) {
    for (const escuro of w === 375 ? [false, true] : [false]) {
      const ctx = await contexto(browser, w, { pbr_checkout_rascunho_v1: rascunho(PLANO.id, 1) }, escuro ? { colorScheme: 'dark' } : {});
      for (const chave of escuro ? ['segmento:restaurante', 'blog:o-que-um-site-profissional-precisa-ter'] : CHAVES) {
        const p = await abrir(ctx, caminho(chave));
        const bloco = p.locator('.indicado');
        // a altura reservada é lida ANTES de o bloco chegar à tela (content-visibility: auto ainda pulando)
        const reservada = await bloco.evaluate((el) => {
          const cs = getComputedStyle(el);
          return cs.contentVisibility === 'auto' ? parseFloat(cs.containIntrinsicBlockSize.replace(/^auto\s+/, '')) : null;
        });
        await bloco.scrollIntoViewIfNeeded();
        await p.waitForTimeout(150);
        // como no visibilidade-conteudo.test.js: a altura reservada é a do conteúdo (sem padding nem borda)
        const real = await bloco.evaluate((el) => {
          const cs = getComputedStyle(el);
          const soma = (...k) => k.reduce((t, n) => t + parseFloat(cs[n]), 0);
          return el.getBoundingClientRect().height - soma('paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth');
        });
        const alvo = await p.locator('[data-indicado-retomar] a').boundingBox();
        const largura = await p.evaluate(() => document.documentElement.scrollWidth);
        const v = w === 375 || w === 1280 ? await axe(p) : [];
        const problemas = [];
        if (largura > w) problemas.push('rolagem ' + largura);
        if (!alvo || alvo.height < 24 || alvo.width < 24) problemas.push('alvo pequeno');
        if (reservada !== null && reservada < real - 1) problemas.push(`altura reservada ${reservada} < real ${real.toFixed(1)}`);
        if (reservada !== null && reservada > real * 1.3) problemas.push(`altura reservada ${reservada} > 130% da real ${real.toFixed(1)}`);
        if (p.erros.length) problemas.push('console: ' + p.erros.join(' | '));
        if (v.length) problemas.push('axe: ' + v.join(', '));
        ok(problemas.length === 0, `${w}px${escuro ? ' escuro' : ''} ${chave}` + (reservada !== null ? ` (reservada ${reservada}, real ${real.toFixed(1)})` : '')
          + (problemas.length ? ' → ' + problemas.join('; ') : ''));
        if (escuro || chave === 'blog:site-ou-instagram' || chave === 'segmento:moda') {
          await bloco.screenshot({ path: `${SAIDA}/continuar-plano-${chave.replace(':', '-')}-${w}${escuro ? '-escuro' : ''}.png` });
        }
        await p.close();
      }
      await ctx.close();
    }
  }

  console.log('\n[4] Clique: plano marcado, formulário preenchido e origem registrada');
  {
    const ctx = await contexto(browser, 375, { pbr_checkout_rascunho_v1: rascunho(PLANO.id, 1) });
    const p = await abrir(ctx, 'segmentos/moda.html');
    await p.locator('[data-indicado-retomar] a').scrollIntoViewIfNeeded();
    await Promise.all([p.waitForURL(new RegExp('planos\\.html\\?plano=' + PLANO.id)), p.click('[data-indicado-retomar] a')]);
    await p.waitForLoadState('networkidle');
    ok(await p.locator(`input[name="plano"][value="${PLANO.id}"]`).isChecked().catch(() => false), `plano ${PLANO.nome} marcado`);
    const nome = await p.locator('#nome, input[name="nome"]').first().inputValue().catch(() => '');
    ok(nome === 'Fulana Teste', 'formulário preenchido com o rascunho (nome: ' + nome + ')');
    ok(!/retomar=1/.test(p.url()), '?retomar=1 sai da barra: ' + p.url().replace(BASE, ''));
    ok(await p.evaluate(() => PBROrigem.resumo()) === 'cta: segmento/moda', 'origem: ' + await p.evaluate(() => PBROrigem.resumo()));
    ok(p.erros.length === 0, 'console limpo em planos.html' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await ctx.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
