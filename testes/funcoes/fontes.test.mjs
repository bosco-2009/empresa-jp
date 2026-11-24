// Melhoria 58: fonte servida mais leve (subconjunto pt-BR, eixo de peso 400–800) e travada aqui.
// Lê o WOFF2 sem dependências (o Node já descomprime Brotli) e compara com tokens.css e com o script gerador.
// Falhou? Ajuste a lista em testes/fontes/subconjunto.py, rode-o e copie o unicode-range para tokens.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

const raiz = new URL('../../', import.meta.url);
const ler = (c) => readFileSync(new URL(c, raiz), 'utf8');
const ARQUIVO = 'assets/fonts/plus-jakarta-sans-latin-wght.woff2';
const PESO_MAXIMO = 14 * 1024; // bytes (a origem "latin" completa tinha 27 348)

// ---------- leitura mínima de WOFF2 (só o necessário: cmap e fvar) ----------
const TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
  'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE',
  'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx',
  'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

function lerWoff2(buf) {
  assert.equal(buf.toString('latin1', 0, 4), 'wOF2', 'assinatura WOFF2');
  const numTabelas = buf.readUInt16BE(12);
  const comprimido = buf.readUInt32BE(20);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) { const b = buf[p++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; }
    throw new Error('UIntBase128 inválido');
  };
  const dir = [];
  for (let i = 0; i < numTabelas; i++) {
    const flags = buf[p++];
    const tag = (flags & 0x3f) === 0x3f ? buf.toString('latin1', p, (p += 4)) : TAGS[flags & 0x3f];
    const versao = flags >> 6;
    const orig = base128();
    const transformada = (tag === 'glyf' || tag === 'loca') ? versao === 0 : versao !== 0;
    dir.push({ tag, tamanho: transformada ? base128() : orig });
  }
  const dados = brotliDecompressSync(buf.subarray(p, p + comprimido));
  const tabelas = {};
  let o = 0;
  for (const { tag, tamanho } of dir) { tabelas[tag] = dados.subarray(o, o + tamanho); o += tamanho; }
  return tabelas;
}

function codigosDoCmap(t) {
  const n = t.readUInt16BE(2);
  const sub = [];
  for (let i = 0; i < n; i++) sub.push({ pid: t.readUInt16BE(4 + i * 8), eid: t.readUInt16BE(6 + i * 8), off: t.readUInt32BE(8 + i * 8) });
  const escolhido = sub.find((s) => s.pid === 3 && s.eid === 10) || sub.find((s) => s.pid === 3 && s.eid === 1);
  const s = t.subarray(escolhido.off);
  const codigos = new Set();
  const formato = s.readUInt16BE(0);
  if (formato === 12) {
    const grupos = s.readUInt32BE(12);
    for (let g = 0; g < grupos; g++) {
      const ini = s.readUInt32BE(16 + g * 12), fim = s.readUInt32BE(20 + g * 12);
      for (let c = ini; c <= fim; c++) codigos.add(c);
    }
  } else {
    assert.equal(formato, 4, 'cmap formato 4 ou 12');
    const segX2 = s.readUInt16BE(6), seg = segX2 / 2;
    const fins = 14, inis = fins + segX2 + 2, deltas = inis + segX2, offs = deltas + segX2;
    for (let i = 0; i < seg; i++) {
      const fim = s.readUInt16BE(fins + i * 2), ini = s.readUInt16BE(inis + i * 2);
      const delta = s.readInt16BE(deltas + i * 2), ro = s.readUInt16BE(offs + i * 2);
      for (let c = ini; c <= fim && c !== 0xffff; c++) {
        let glifo;
        if (ro === 0) glifo = (c + delta) & 0xffff;
        else { const g = s.readUInt16BE(offs + i * 2 + ro + (c - ini) * 2); glifo = g ? (g + delta) & 0xffff : 0; }
        if (glifo) codigos.add(c);
      }
    }
  }
  return codigos;
}

function eixos(t) {
  const inicio = t.readUInt16BE(4), qtd = t.readUInt16BE(8), tam = t.readUInt16BE(10);
  const fixo = (o) => t.readInt32BE(o) / 65536;
  return Array.from({ length: qtd }, (_, i) => {
    const o = inicio + i * tam;
    return { tag: t.toString('latin1', o, o + 4), min: fixo(o + 4), padrao: fixo(o + 8), max: fixo(o + 12) };
  });
}

// "U+0020-007E, U+00A0" → Set de códigos
function expandir(lista) {
  const s = new Set();
  for (const parte of lista.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i.exec(parte);
    assert.ok(m, `faixa inválida: ${parte}`);
    const a = parseInt(m[1], 16), b = parseInt(m[2] || m[1], 16);
    for (let c = a; c <= b; c++) s.add(c);
  }
  return s;
}

const hex = (c) => 'U+' + c.toString(16).toUpperCase().padStart(4, '0');
const fonte = readFileSync(new URL(ARQUIVO, raiz));
const tabelas = lerWoff2(fonte);
const cmap = codigosDoCmap(tabelas.cmap);
const tokens = ler('assets/css/tokens.css');
const face = (/@font-face\s*\{([\s\S]*?)\}/.exec(tokens) || [])[1] || '';

test(`peso: ${ARQUIVO} até ${PESO_MAXIMO} bytes`, () => {
  assert.ok(fonte.length <= PESO_MAXIMO, `${fonte.length} bytes (máximo ${PESO_MAXIMO})`);
  assert.ok(fonte.length > 4000, 'arquivo não ficou vazio/truncado');
});

test('eixo de peso: só 400–800 na fonte, no @font-face e nos tokens --peso-*', () => {
  const wght = eixos(tabelas.fvar).find((e) => e.tag === 'wght');
  assert.deepEqual([wght.min, wght.max], [400, 800]);
  assert.match(face, /font-weight:\s*400 800;/);
  const pesos = [...tokens.matchAll(/--peso-[a-z]+:\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(pesos.length >= 4, 'tokens de peso encontrados');
  for (const p of pesos) assert.ok(p >= 400 && p <= 800, `--peso ${p} fora do eixo 400–800`);
  // Nenhum CSS usa peso numérico fora do eixo (a fonte seria sintetizada ou trocada).
  for (const f of readdirSync(new URL('assets/css/', raiz))) {
    for (const m of ler(`assets/css/${f}`).matchAll(/font-weight:\s*(\d{3})\b(?!\s*\d)/g)) {
      assert.ok(+m[1] >= 400 && +m[1] <= 800, `${f}: font-weight ${m[1]}`);
    }
  }
});

test('unicode-range do @font-face = caracteres da fonte = lista do testes/fontes/subconjunto.py', () => {
  const faixaCss = expandir((/unicode-range:\s*([^;]+);/.exec(face) || [])[1] || '');
  const script = ler('testes/fontes/subconjunto.py');
  const lista = (/UNICODES = \(([\s\S]*?)\n\)/.exec(script) || [])[1] || '';
  const faixaPy = expandir([...lista.matchAll(/'([^']*)'/g)].map((m) => m[1]).join(''));
  assert.deepEqual([...faixaCss].sort((a, b) => a - b), [...faixaPy].sort((a, b) => a - b), 'tokens.css × subconjunto.py');
  const sobra = [...faixaCss].filter((c) => !cmap.has(c)).map(hex);
  const falta = [...cmap].filter((c) => !faixaCss.has(c)).map(hex);
  assert.deepEqual(sobra, [], 'unicode-range promete caracteres que a fonte não tem');
  assert.deepEqual(falta, [], 'fonte tem caracteres fora do unicode-range (peso à toa)');
});

test('todo texto do site (letras latinas e pontuação) está na fonte', () => {
  const publicados = [];
  const andar = (dir) => {
    for (const nome of readdirSync(new URL(dir, raiz))) {
      const rel = dir + nome;
      if (/^(\.|testes|supabase|node_modules)/.test(rel)) continue;
      if (statSync(new URL(rel, raiz)).isDirectory()) andar(rel + '/');
      else if (/\.(html|js|css|xml|webmanifest)$/.test(nome)) publicados.push(rel);
    }
  };
  andar('');
  assert.ok(publicados.length > 30, `${publicados.length} arquivos publicados lidos`);
  const nomes = { amp: 38, lt: 60, gt: 62, quot: 34, nbsp: 160, copy: 169, reg: 174, ndash: 8211, mdash: 8212, hellip: 8230, rarr: 8594 };
  const faltando = new Map();
  for (const f of publicados) {
    let t = ler(f)
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
      .replace(/&([a-z]+);/gi, (m, n) => (n in nomes ? String.fromCodePoint(nomes[n]) : m));
    t += [...t.matchAll(/\\u\{?([0-9a-f]{4,5})\}?/gi)].map((m) => String.fromCodePoint(parseInt(m[1], 16))).join('');
    for (const ch of t) {
      const c = ch.codePointAt(0);
      // Letras latinas e pontuação geral precisam estar na fonte; símbolos (setas, ✓, emoji) e
      // marcas combinantes usadas em regex de normalização caem de propósito na fonte do sistema.
      const latino = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0x24f && c !== 0xfeff);
      const pontuacao = c >= 0x2010 && c <= 0x2027;
      if ((latino || pontuacao || c === 0x20ac) && !cmap.has(c)) faltando.set(hex(c) + ' ' + ch, f);
    }
  }
  assert.deepEqual([...faltando].map(([c, f]) => `${c} (${f})`), []);
});

test('uma única fonte servida (o preload em todas as páginas é conferido em paginas.test.mjs)', () => {
  const css = readdirSync(new URL('assets/css/', raiz)).map((f) => ler(`assets/css/${f}`)).join('\n');
  const faces = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);
  // Melhoria 119: 1 face baixada + 4 faces de reserva só com local() (nada é baixado por elas).
  const baixadas = faces.filter((f) => /url\(/.test(f));
  assert.equal(baixadas.length, 1, 'um único @font-face com url()');
  assert.match(baixadas[0], /font-display:\s*swap;/, 'font-display: swap (texto aparece na reserva, sem FOIT)');
  for (const f of faces.filter((x) => !/url\(/.test(x))) {
    assert.match(f, /font-family:\s*'Plus Jakarta Sans Reserva( Roboto)?';/, 'face sem url() só para a reserva');
    assert.match(f, /src:\s*local\(/, 'reserva só com local()');
  }
  const fontes = readdirSync(new URL('assets/fonts/', raiz)).filter((f) => /\.(woff2?|ttf|otf)$/.test(f));
  assert.deepEqual(fontes, ['plus-jakarta-sans-latin-wght.woff2']);
});

// Melhoria 119: medido com Playwright, a primeira tela de toda página usa os pesos 400, 600, 700 e 800. Quatro
// instâncias estáticas (400/600/700/800) somariam 31 472 bytes em 4 pedidos contra 13 852 bytes num pedido do
// arquivo variável: o preload único continua sendo o mais leve. A troca da reserva pela fonte não mexe no
// layout porque as faces de reserva têm métricas ajustadas (testes/fontes/reserva.py → reserva.json).
test('faces de reserva: métricas em tokens.css = testes/fontes/reserva.json; ordem em --fonte-base', () => {
  const calc = JSON.parse(ler('testes/fontes/reserva.json'));
  const faces = [...tokens.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((m) => m[1]).filter((f) => !/url\(/.test(f));
  assert.equal(faces.length, 4, 'Arial 400/700 e Roboto 400/700');
  const num = (f, d) => Number((new RegExp(d + ':\\s*([\\d.]+)%;').exec(f) || [])[1]);
  for (const f of faces) {
    const chave = (/Roboto'/.test(f) ? 'roboto-' : 'arial-') + (/font-weight:\s*(\d+)/.exec(f) || [])[1];
    assert.ok(calc[chave], `valores calculados para ${chave}`);
    for (const d of ['size-adjust', 'ascent-override', 'descent-override', 'line-gap-override']) {
      assert.equal(num(f, d), calc[chave][d], `${chave}: ${d}`);
    }
    assert.ok(calc[chave]['size-adjust'] > 90 && calc[chave]['size-adjust'] < 115, `${chave}: size-adjust plausível`);
  }
  assert.match(tokens, /--fonte-base:\s*'Plus Jakarta Sans', 'Plus Jakarta Sans Reserva', 'Plus Jakarta Sans Reserva Roboto', system-ui/);
});
