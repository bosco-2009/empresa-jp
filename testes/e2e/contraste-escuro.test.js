// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Contraste no modo escuro (item 52 do MELHORIAS.md), com cálculo próprio além do axe:
//   - textos (WCAG 1.4.3): 4,5:1, ou 3:1 em texto grande (≥ 24 px, ou ≥ 18,66 px com peso ≥ 700);
//   - bordas de campos, ícones e aba ativa (WCAG 1.4.11): 3:1 com o fundo em volta.
// O axe não decide sobre fundos com gradiente (deixa "incompleto"); aqui cada cor de parada do gradiente
// é composta sobre o fundo de baixo e vale o PIOR caso. Páginas: home, planos e blog (lista, autor e artigos).
// Também roda no claro, para não consertar o escuro estragando o claro.
const { chromium } = require('playwright');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const PAGINAS = ['', 'planos.html', 'blog/', 'blog/autor.html', 'blog/site-ou-instagram.html',
  'blog/o-que-um-site-profissional-precisa-ter.html', 'blog/como-funciona-a-criacao-do-seu-site.html'];
const LARGURAS = [320, 375, 768, 1280];
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

// Fase 1 (na página): lista o que medir — cor da frente, mínimo e as áreas onde o fundo deve ser lido.
function coletar() {
  const tela = document.createElement('canvas');
  tela.width = tela.height = 1;
  const c2d = tela.getContext('2d', { willReadFrequently: true });
  // Converte qualquer cor CSS (rgb, hex, color(srgb ...), oklch...) em [r, g, b, a] pelo próprio navegador.
  function cor(txt) {
    c2d.clearRect(0, 0, 1, 1);
    c2d.fillStyle = '#000';
    c2d.fillStyle = txt;
    c2d.fillRect(0, 0, 1, 1);
    const d = c2d.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  const descrever = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
    const pai = el.parentElement && el.parentElement.closest('[class]');
    return (pai ? '.' + pai.classList[0] + ' ' : '') + s;
  };
  function visivel(el) {
    if (!el.getClientRects().length) return false;
    // checkVisibility cobre o conteúdo de <details> fechado (content-visibility: hidden)
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      if (cs.clipPath && /inset\(50%|circle\(0/.test(cs.clipPath)) return false;
      if (/rect\(0px,? 0px,? 0px,? 0px\)/.test(cs.clip)) return false;
    }
    return true;
  }
  const opacidade = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const sx = scrollX, sy = scrollY;
  // Recorta pela parte realmente visível: ancestrais com overflow (abas roláveis, listas) e a própria página.
  let recorteAtual = null;
  const caixa = (r) => {
    let x0 = r.left, y0 = r.top, x1 = r.right ?? r.left + r.width, y1 = r.bottom ?? r.top + r.height;
    if (recorteAtual) { x0 = Math.max(x0, recorteAtual.left); y0 = Math.max(y0, recorteAtual.top); x1 = Math.min(x1, recorteAtual.right); y1 = Math.min(y1, recorteAtual.bottom); }
    x0 = Math.max(x0, 0); y0 = Math.max(y0, -sy); x1 = Math.min(x1, innerWidth);
    return { x: x0 + sx, y: y0 + sy, w: x1 - x0, h: y1 - y0 };
  };
  const recorte = (el) => {
    let r = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 };
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const q = e.getBoundingClientRect();
        r = { left: Math.max(r.left, q.left), top: Math.max(r.top, q.top), right: Math.min(r.right, q.right), bottom: Math.min(r.bottom, q.bottom) };
      }
    }
    return r;
  };
  const cabe = (a) => a.w >= 2 && a.h >= 2;
  const itens = [];

  // Elementos desativados ficam de fora (exceção da WCAG); aria-hidden também (decorativos).
  const todos = [...document.body.querySelectorAll('*')].filter((el) => !el.closest('[aria-hidden="true"]') && !el.closest('[disabled]'));

  // 1) Textos (1.4.3): cada linha de texto direto. O fundo é lido na faixa central da linha (onde fica o corpo das
  //    letras), para um sublinhado decorativo atrás das descendentes não contar como fundo do texto.
  for (const el of todos) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'OPTION'].includes(el.tagName) || !visivel(el)) continue;
    const cs = getComputedStyle(el);
    const tam = parseFloat(cs.fontSize), peso = Number(cs.fontWeight) || 400;
    const minimo = tam >= 24 || (tam >= 18.66 && peso >= 700) ? 3 : 4.5;
    recorteAtual = recorte(el);
    const frente = cor(cs.color);
    frente[3] *= opacidade(el);
    const linhas = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (q.width >= 2 && q.height >= 4) { const a = caixa(q); if (cabe(a)) linhas.push(a); }
    }
    if (linhas.length) itens.push({ tipo: 'texto', nome: descrever(el), frente, minimo, areas: linhas, faixa: true });
    const campoTexto = el.tagName === 'INPUT' && !['checkbox', 'radio', 'hidden', 'range', 'color', 'file', 'submit', 'button'].includes(el.type);
    if ((campoTexto && (el.value || el.placeholder)) || el.tagName === 'SELECT' || (el.tagName === 'TEXTAREA' && (el.value || el.placeholder))) {
      const r = el.getBoundingClientRect();
      const pl = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), pt = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
      const area = caixa({ left: r.left + pl, top: r.top + pt, width: Math.max(4, r.width - 2 * pl), height: Math.max(4, r.height - 2 * pt) });
      const usaPh = !el.value && el.placeholder;
      const k = usaPh ? cor(getComputedStyle(el, '::placeholder').color) : frente;
      if (cabe(area)) itens.push({ tipo: usaPh ? 'placeholder' : 'texto-campo', nome: descrever(el), frente: k, minimo: 4.5, areas: [area], faixa: false });
    }
  }

  // 2) Bordas de campos (1.4.11): a cor da borda contra o fundo logo FORA do campo.
  for (const el of todos) {
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || ['hidden', 'submit', 'button'].includes(el.type) || !visivel(el)) continue;
    const cs = getComputedStyle(el);
    const lado = ['Top', 'Right', 'Bottom', 'Left'].find((l) => parseFloat(cs['border' + l + 'Width']) > 0 && cs['border' + l + 'Style'] !== 'none');
    if (!lado) continue;
    recorteAtual = null;
    const r = el.getBoundingClientRect();
    const fora = [{ left: r.left, top: r.top - 3, width: r.width, height: 2 }, { left: r.left, top: r.bottom + 1, width: r.width, height: 2 },
      { left: r.left - 3, top: r.top, width: 2, height: r.height }, { left: r.right + 1, top: r.top, width: 2, height: r.height }].map(caixa);
    itens.push({ tipo: 'borda', nome: descrever(el), frente: cor(cs['border' + lado + 'Color']), minimo: 3, areas: fora, faixa: false, mediana: true });
  }

  // 3) Ícones SVG (1.4.11): a cor principal do ícone contra o fundo atrás dele (ilustrações grandes ficam de fora).
  for (const svg of todos.filter((e) => e.tagName === 'svg')) {
    if (!visivel(svg)) continue;
    const r = svg.getBoundingClientRect();
    if (r.width < 10 || r.height < 10 || r.width > 96 || r.height > 96) continue;
    let principal = null;
    for (const f of svg.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse')) {
      const cs = getComputedStyle(f);
      const usa = cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0 && Number(cs.strokeOpacity) > 0.5 ? cs.stroke
        : (cs.fill !== 'none' && !/url\(/.test(cs.fill) && Number(cs.fillOpacity) > 0.5 ? cs.fill : null);
      if (usa && cor(usa)[3] > 0) { principal = cor(usa); break; }
    }
    recorteAtual = recorte(svg);
    if (principal && cabe(caixa(r))) { principal[3] *= opacidade(svg); itens.push({ tipo: 'icone', nome: descrever(svg), frente: principal, minimo: 3, areas: [caixa(r)], faixa: false, mediana: true }); }
  }
  // 4) Aba ativa (1.4.11): o fundo da aba selecionada contra o fundo de uma aba não selecionada ao lado.
  for (const aba of todos.filter((e) => e.getAttribute('role') === 'tab' && e.getAttribute('aria-selected') === 'true')) {
    const outra = [...aba.parentElement.children].find((e) => e !== aba && e.getAttribute('role') === 'tab' && visivel(e));
    if (!visivel(aba) || !outra) continue;
    const cs = getComputedStyle(aba);
    if (parseFloat(cs.borderTopWidth) > 1 || parseFloat(cs.borderBottomWidth) > 1) continue; // indicada por borda
    recorteAtual = recorte(aba);
    const k = cor(cs.backgroundColor);
    if (k[3] > 0) itens.push({ tipo: 'aba-ativa', nome: descrever(aba), frente: k, minimo: 3, areas: [caixa(outra.getBoundingClientRect())], faixa: false, mediana: true });
  }
  return itens;
}

// Some com o que está na frente (texto, placeholder, ícones, bordas de campos) para fotografar só o fundo.
const SO_FUNDO = `*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important;
  text-shadow: none !important; caret-color: transparent !important; text-decoration-color: transparent !important; transition: none !important; }
  ::placeholder { color: transparent !important; } svg { visibility: hidden !important; }
  input, select, textarea { border-color: transparent !important; outline: none !important; }`;

// Fase 2 (numa página em branco, sem CSP): lê os pixels do fundo e calcula a pior razão de cada item.
function calcular({ png, itens }) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const lum = (k) => { const l = k.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
      const razao = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const hex = (k) => '#' + k.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
      const problemas = [];
      for (const it of itens) {
        const rs = [];
        let piorFundo = null, pior = Infinity;
        for (const a of it.areas) {
          let y0 = a.y, h = a.h;
          if (it.faixa) { y0 = a.y + a.h * 0.25; h = a.h * 0.5; }
          const x = Math.max(0, Math.round(a.x)), y = Math.max(0, Math.round(y0));
          const w = Math.min(c.width - x, Math.max(1, Math.round(a.w))), hh = Math.min(c.height - y, Math.max(1, Math.round(h)));
          if (w <= 0 || hh <= 0) continue;
          const d = g.getImageData(x, y, w, hh).data;
          const passo = Math.max(1, Math.floor((w * hh) / 4000));
          for (let i = 0; i < w * hh; i += passo) {
            const f = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
            const al = it.frente[3];
            const t = it.frente.slice(0, 3).map((v, j) => v * al + f[j] * (1 - al));
            const r = razao(t, f);
            rs.push(r);
            if (r < pior) { pior = r; piorFundo = f; }
          }
        }
        if (!rs.length) continue;
        rs.sort((a, b) => a - b);
        // texto: 2º percentil (ignora pixels soltos de borda/antisserrilhado); bordas e ícones: mediana do entorno
        const valor = it.mediana ? rs[Math.floor(rs.length / 2)] : rs[Math.floor(rs.length * 0.02)];
        if (valor + 1e-6 < it.minimo) problemas.push(`${it.tipo} ${it.nome}: ${valor.toFixed(2)}:1 (mín. ${it.minimo}) cor ${hex(it.frente.slice(0, 3))} sobre ~${hex(piorFundo)}`);
      }
      resolve([...new Set(problemas)]);
    };
    img.src = 'data:image/png;base64,' + png;
  });
}

(async () => {
  const browser = await chromium.launch();
  const calculadora = await browser.newPage();
  for (const tema of ['escuro', 'claro']) {
    console.log(`\n[${tema}] contraste de textos, bordas de campos e ícones`);
    for (const w of LARGURAS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, colorScheme: tema === 'escuro' ? 'dark' : 'light', reducedMotion: 'reduce' });
      await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
      for (const c of PAGINAS) {
        const p = await ctx.newPage();
        const erros = [];
        p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
        await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
        await p.route('**/__so-fundo.css', (r) => r.fulfill({ body: SO_FUNDO, contentType: 'text/css' }));
        await p.goto(SITE + c, { waitUntil: 'networkidle' });
        await p.waitForTimeout(100);
        // abre os <details> (FAQ etc.) para medir também as respostas
        await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
        // viewport da altura da página: as caixas medidas e a foto usam o mesmo layout (fixos no lugar certo)
        const altura = await p.evaluate(() => Math.min(document.documentElement.scrollHeight, 16000));
        await p.setViewportSize({ width: w, height: altura });
        await p.waitForTimeout(100);
        const itens = await p.evaluate(coletar);
        const estilo = await p.addStyleTag({ url: new URL('/__so-fundo.css', p.url()).href }); // a CSP só aceita CSS da origem
        await p.waitForTimeout(50);
        const png = (await p.screenshot()).toString('base64');
        await estilo.evaluate((e) => e.remove());
        const prob = await calculadora.evaluate(calcular, { png, itens });
        await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
        const ax = await p.evaluate(async () => (await axe.run(document, { runOnly: ['color-contrast'] })).violations.flatMap((v) => v.nodes.map((n) => 'axe ' + n.target.join(' '))));
        const todos = prob.concat(ax);
        ok(todos.length === 0 && erros.length === 0, `${w}px ${c || 'home'}: ${todos.length ? todos.length + ' problema(s)' : 'tudo ≥ mínimo'}` + (todos.length ? '\n      ' + todos.slice(0, 12).join('\n      ') : '') + (erros.length ? ' | console: ' + erros.join(' ') : ''));
        await p.close();
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nCONTRASTE OK NO ESCURO E NO CLARO');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
