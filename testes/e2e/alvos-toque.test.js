// Uso: veja testes/README.md (servidor estático + Supabase falso + Postgres local, como o checklist-pedido.test.js)
// Alvos de toque de 24 px (item 68 do MELHORIAS.md; WCAG 2.2, critério 2.5.8 "Tamanho do alvo (mínimo)").
// Em 320 e 375 px, em todas as páginas, no chat aberto e no painel (login e as quatro abas com dados):
//   cada link/botão/campo visível mede pelo menos 24×24 CSS px OU tem espaçamento suficiente: um círculo de 24 px
//   de diâmetro centrado nele não encosta em outro alvo nem no círculo de outro alvo pequeno.
// Mais rígido: fora de texto corrido, todo alvo tem 24 px de verdade (não só espaçamento), para não regredir.
// Exceções da WCAG aplicadas: link no meio de texto corrido ("inline"), controle equivalente que cumpre o critério
// (ex.: checkbox cujo <label> clicável tem 24 px) e elementos inertes/aria-hidden (telas de exemplo decorativas).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const RAIZ = path.resolve(__dirname, '../..');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });
const configTeste = fs.readFileSync(RAIZ + '/config.js', 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

const PAGINAS = [
  ['home', ''], ['planos', 'planos.html'], ['obrigado', 'obrigado.html'], ['briefing', 'briefing.html'], ['pedido', 'pedido.html'],
  ['termos', 'termos.html'], ['privacidade', 'privacidade.html'], ['portfolio', 'portfolio.html'], ['exemplos', 'exemplos.html'],
  ['blog', 'blog/'], ['blog-autor', 'blog/autor.html'],
  ...['site-ou-instagram', 'o-que-um-site-profissional-precisa-ter', 'como-funciona-a-criacao-do-seu-site'].map((x) => ['blog-' + x.split('-')[0], `blog/${x}.html`]),
  ...['moda', 'restaurante', 'beleza', 'saude', 'servicos', 'pet'].map((x) => ['exemplo-' + x, `exemplos/${x}.html`]),
  ...['restaurante', 'moda', 'beleza', 'saude', 'servicos', 'pet'].map((x) => ['segmento-' + x, `segmentos/${x}.html`]),
  ['404', 'empresa-jp/uma/pagina/que/nao/existe'], ['admin-login', 'admin/'],
];
const LARGURAS = [320, 375];

function psql(sql) {
  return execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
}
let falhas = 0, medidos = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

// Roda na página: devolve os alvos que falham no 2.5.8 (tamanho e espaçamento), com o motivo.
function medirAlvos() {
  const MIN = 24, TOL = 0.5;
  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], '
    + '[role=checkbox], [role=switch], [role=menuitem], [role=option], [tabindex]:not([tabindex="-1"])';
  const blocos = new Set(['block', 'flex', 'grid', 'list-item', 'table-cell', 'table', 'flow-root']);
  const visivel = (el) => {
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false; // visualmente oculto (ex.: "Pular para o conteúdo" sem foco)
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.clipPath && /inset\(50%|circle\(0/.test(cs.clipPath)) return false;
      if (/rect\(0px,? 0px,? 0px,? 0px\)/.test(cs.clip)) return false;
    }
    // Coberto por outra camada (ex.: menu móvel aberto por cima do índice da página): não é alvo agora.
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    if (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
      const topo = document.elementFromPoint(cx, cy);
      if (topo && !el.contains(topo) && !topo.contains(el) && !(el.labels && [...el.labels].some((lb) => lb.contains(topo)))) return false;
    }
    return true;
  };
  // Exceção "inline": o alvo está numa frase, com texto em volta no mesmo bloco.
  const emTextoCorrido = (el) => {
    if (getComputedStyle(el).display !== 'inline') return false;
    let bloco = el.parentElement;
    while (bloco && !blocos.has(getComputedStyle(bloco).display)) bloco = bloco.parentElement;
    if (!bloco) return false;
    const resto = bloco.textContent.replace(el.textContent, '').replace(/\s+/g, '');
    return resto.length >= 3;
  };
  const descrever = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
    const nome = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.name || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return s + (nome ? ` "${nome}"` : '');
  };
  const alvos = [...document.querySelectorAll(SEL)]
    .filter((el) => !el.matches('label *') || el.matches('input, select, textarea, button, a'))
    .filter(visivel)
    // um <summary>/<a> dentro de outro alvo conta como o mesmo alvo
    .filter((el, _, todos) => !todos.some((o) => o !== el && o.contains(el) && !o.matches('[tabindex]')))
    .map((el) => {
      let r = el.getBoundingClientRect();
      // "Link esticado": ::after absoluto com inset 0 torna o cartão inteiro clicável; o alvo é o cartão.
      const depois = getComputedStyle(el, '::after');
      if (depois.content !== 'none' && depois.position === 'absolute' && depois.top === '0px' && depois.left === '0px') {
        let cartao = el.parentElement;
        while (cartao && getComputedStyle(cartao).position === 'static') cartao = cartao.parentElement;
        if (cartao) r = cartao.getBoundingClientRect();
      }
      let rect = { l: r.left, t: r.top, r: r.right, b: r.bottom };
      // Controle equivalente: o <label> clicável do campo (checkbox/radio) também aciona o mesmo controle.
      let equivalente = false;
      if (el.labels && el.labels.length) {
        for (const lb of el.labels) {
          const q = lb.getBoundingClientRect();
          if (q.width >= MIN - TOL && q.height >= MIN - TOL && lb.checkVisibility()) equivalente = true;
        }
      }
      return { el, rect, w: r.width, h: r.height, inline: emTextoCorrido(el), equivalente };
    });
  const pequenos = alvos.filter((a) => !a.inline && !a.equivalente && (a.w < MIN - TOL || a.h < MIN - TOL));
  const centro = (a) => ({ x: (a.rect.l + a.rect.r) / 2, y: (a.rect.t + a.rect.b) / 2 });
  const distRet = (p, q) => {
    const dx = Math.max(q.l - p.x, 0, p.x - q.r), dy = Math.max(q.t - p.y, 0, p.y - q.b);
    return Math.hypot(dx, dy);
  };
  const ruins = [];
  for (const a of pequenos) {
    const c = centro(a);
    let conflito = null;
    for (const o of alvos) {
      if (o === a || o.el.contains(a.el) || a.el.contains(o.el)) continue;
      if (o.equivalente && o.el.labels && [...o.el.labels].some((lb) => lb.contains(a.el))) continue;
      const d = pequenos.includes(o) ? Math.hypot(c.x - centro(o).x, c.y - centro(o).y) : distRet(c, o.rect);
      const limite = pequenos.includes(o) ? MIN : MIN / 2;
      if (d < limite - TOL) { conflito = o; break; }
    }
    if (conflito) ruins.push(`${descrever(a.el)} (${a.w.toFixed(1)}×${a.h.toFixed(1)}) perto de ${descrever(conflito.el)}`);
  }
  return { total: alvos.length, ruins, pequenos: pequenos.map((a) => `${descrever(a.el)} (${a.w.toFixed(1)}×${a.h.toFixed(1)})`) };
}

async function novaPagina(browser, largura, nome) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 800 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  if (nome === '404') {
    const html404 = fs.readFileSync(RAIZ + '/404.html', 'utf8');
    await p.route('**/empresa-jp/uma/pagina/**', (r) => r.fulfill({ status: 404, body: html404, contentType: 'text/html; charset=utf-8' }));
    await p.route('**/empresa-jp/**', (r) => {
      const u = new URL(r.request().url());
      const arquivo = path.join(RAIZ, decodeURIComponent(u.pathname.replace(/^\/empresa-jp\//, '')));
      if (fs.existsSync(arquivo) && fs.statSync(arquivo).isFile()) return r.fulfill({ path: arquivo });
      return r.fallback();
    });
  }
  return p;
}

async function conferir(p, rotulo) {
  const { total, ruins, pequenos } = await p.evaluate(medirAlvos);
  medidos += total;
  ok(ruins.length === 0, `${rotulo}: ${total} alvos com 24 px ou espaçamento` + (ruins.length ? '\n      → ' + ruins.join('\n      → ') : ''));
  // Mais rígido que a WCAG (trava a melhoria 68): fora de texto corrido, nenhum alvo depende só do espaçamento,
  // porque uma mudança de layout pode aproximar dois alvos pequenos sem ninguém perceber.
  ok(pequenos.length === 0, `${rotulo}: alvos soltos com 24 px de verdade` + (pequenos.length ? '\n      → ' + pequenos.join('\n      → ') : ''));
}

(async () => {
  // Dados de teste para o painel ter itens nas listas
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  psql(`
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em) values
      ('PBR-AAAAA2', '${hash('a')}', 'profissional', 'Profissional', 99700, 'Ana Teste', 'ana@teste.local', '11911112222', now(), 'aprovado', now() - interval '3 days', now() - interval '3 days'),
      ('PBR-BBBBB3', '${hash('b')}', 'essencial', 'Essencial', 49700, 'Bruno Teste', 'bruno@teste.local', '11933334444', now(), 'pendente', now() - interval '1 hour', null);
    insert into public.briefings (pedido_id, nome_negocio) select id, 'Oficina de Teste' from public.pedidos where codigo = 'PBR-AAAAA2';
  `);
  const browser = await chromium.launch();

  console.log('\n[1] Páginas públicas em 320 e 375 px');
  for (const [nome, caminho] of PAGINAS) {
    for (const w of LARGURAS) {
      const p = await novaPagina(browser, w, nome);
      await p.goto(SITE + caminho, { waitUntil: 'networkidle' });
      await conferir(p, `${nome} @${w}`);
      // menu móvel aberto (links do menu empilhados)
      if (await p.isVisible('[data-menu-botao]').catch(() => false)) {
        await p.click('[data-menu-botao]');
        await conferir(p, `${nome} @${w} menu aberto`);
        await p.keyboard.press('Escape');
      }
      if (w === 320 && ['home', 'planos'].includes(nome)) await p.screenshot({ path: `${SAIDA}/alvos-${nome}-${w}.png`, fullPage: true });
      ok(p.erros.filter((e) => !(nome === '404' && /status of 404/.test(e))).length === 0, `${nome} @${w}: console limpo ${p.erros.join(' | ')}`);
      await p.context().close();
    }
  }

  console.log('\n[1b] Controle: o teste acusa alvos pequenos de verdade');
  {
    const p = await novaPagina(browser, 320, 'home');
    await p.goto(SITE + 'termos.html', { waitUntil: 'networkidle' });
    await p.evaluate(() => {
      const caixa = document.createElement('div');
      caixa.innerHTML = '<button type="button">a</button><button type="button">b</button>'
        + '<a href="#x">solto</a>'
        + '<p>Texto corrido com <a href="#y">link na frase</a> que é exceção.</p>';
      document.querySelector('main').prepend(caixa);
    });
    // tamanhos pelo CSSOM (a CSP do site bloqueia style="" no HTML)
    await p.evaluate(() => {
      const [b1, b2] = document.querySelectorAll('main > div:first-child button');
      for (const b of [b1, b2]) Object.assign(b.style, { display: 'inline-block', boxSizing: 'border-box', padding: '0', border: '0', minWidth: '0', minHeight: '0', width: '16px', height: '16px', fontSize: '10px' });
      Object.assign(document.querySelector('main > div:first-child > a').style, { display: 'block', width: '40px', height: '18px', marginTop: '30px' });
    });
    const r = await p.evaluate(medirAlvos);
    ok(r.ruins.filter((x) => /^button/.test(x)).length === 2, 'dois botões de 16 px colados são acusados (2.5.8)');
    ok(r.pequenos.some((x) => /"solto"/.test(x)) && !r.ruins.some((x) => /"solto"/.test(x)), 'link pequeno mas afastado passa no 2.5.8 e cai só na regra rígida');
    ok(!r.pequenos.some((x) => /link na frase/.test(x)), 'link em texto corrido é exceção');
    await p.context().close();
  }

  console.log('\n[2] Chat aberto');
  for (const w of LARGURAS) {
    const p = await novaPagina(browser, w, 'home');
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await p.focus('.chat__lancador');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
    await conferir(p, `chat aberto @${w}`);
    await p.screenshot({ path: `${SAIDA}/alvos-chat-${w}.png` });
    await p.context().close();
  }

  console.log('\n[3] Painel com dados (conversas, pedidos, briefings, resumo)');
  for (const w of LARGURAS) {
    const a = await novaPagina(browser, w, 'admin');
    await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
    await a.fill('#login-email', 'dono@teste.local');
    await a.fill('#login-senha', 'senha-de-teste');
    await a.click('[data-form-login] button[type=submit]');
    await a.waitForSelector('[data-tela="painel"]:not([hidden])');
    await a.waitForTimeout(300);
    await conferir(a, `painel conversas @${w}`);
    await a.click('[data-aba-link="pedidos"]');
    await a.waitForSelector('[data-lista-pedidos] .admin-item');
    await conferir(a, `painel pedidos @${w}`);
    await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-AAAAA2")');
    await a.waitForSelector('[data-checklist]:not([hidden])');
    await conferir(a, `painel detalhe do pedido @${w}`);
    await a.screenshot({ path: `${SAIDA}/alvos-painel-pedido-${w}.png`, fullPage: true });
    for (const aba of ['briefings', 'resumo']) {
      if (!(await a.$(`[data-aba-link="${aba}"]`))) continue;
      await a.click(`[data-aba-link="${aba}"]`);
      await a.waitForTimeout(300);
      await conferir(a, `painel ${aba} @${w}`);
    }
    ok(a.erros.length === 0, `painel @${w}: console limpo ${a.erros.join(' | ')}`);
    await a.context().close();
  }

  await browser.close();
  console.log(`\n${medidos} medições de alvos`);
  console.log(falhas ? `${falhas} FALHA(S)` : 'ALVOS DE TOQUE OK: todos com 24 px ou espaçamento suficiente (WCAG 2.5.8)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
