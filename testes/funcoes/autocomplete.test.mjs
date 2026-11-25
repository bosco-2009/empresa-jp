// Melhoria 123: autocomplete, inputmode e teclado certos em todos os formulários (WCAG 1.3.5).
// Cada campo de texto do site (HTML e os criados pelo chat.js/briefing.js) está listado aqui com o valor esperado.
// Campo novo sem entrada nesta tabela faz o teste falhar: decida o token antes de publicar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../../', import.meta.url));
const ler = (f) => readFileSync(join(raiz, f), 'utf8');

// null = atributo ausente de propósito (nenhum token do HTML descreve o dado).
const ESPERADO = {
  'index.html': {
    // Busca do FAQ filtra ao digitar: a lista de sugestões do navegador cobriria os resultados.
    'faq-busca': { type: 'search', autocomplete: 'off', enterkeyhint: 'search' },
  },
  'planos.html': {
    'checkout-nome': { type: 'text', autocomplete: 'name', autocapitalize: 'words', enterkeyhint: 'next' },
    'checkout-email': { type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'none' },
    'checkout-whatsapp': { type: 'tel', autocomplete: 'tel-national', inputmode: 'tel' },
  },
  'briefing.html': {
    'b-nome_negocio': { type: 'text', autocomplete: 'organization', autocapitalize: 'words' },
    'b-segmento': { type: 'text', autocomplete: null },
    'b-cidade': { type: 'text', autocomplete: 'address-level2', autocapitalize: 'words' },
    'b-publico': { autocomplete: null },
    'b-objetivo': { autocomplete: null },
    'b-paginas': { autocomplete: null },
    'b-cores_estilo': { autocomplete: null },
    'b-textos_servicos': { autocomplete: null },
    'b-contatos_redes': { autocomplete: null },
    'b-dominio': { type: 'text', autocomplete: 'url', inputmode: 'url', autocapitalize: 'none', spellcheck: 'false' },
    'b-arquivos': { type: 'file' },
    'b-observacoes': { autocomplete: null },
  },
  'admin/index.html': {
    'login-email': { type: 'email', autocomplete: 'username' },
    'login-senha': { type: 'password', autocomplete: 'current-password' },
    // Busca do painel: sugestões antigas do navegador atrapalham o atalho "/" e os resultados ao vivo.
    'busca-global': { type: 'search', autocomplete: 'off' },
    'busca-pedidos': { type: 'search' },
    'resposta-texto': {},
    'recuperar-mensagem': {},
  },
};

// Campos criados pelo JS: o objeto de atributos logo depois do marcador no código.
const ESPERADO_JS = {
  'assets/js/chat.js': {
    "campo('chat-nome'": { type: 'text', autocomplete: 'name', autocapitalize: 'words', enterkeyhint: 'next' },
    "campo('chat-whatsapp'": { type: 'tel', autocomplete: 'tel-national', inputmode: 'tel' },
    "id: 'chat-texto'": { autocomplete: null, enterkeyhint: 'send' },
  },
  'assets/js/briefing.js': {
    "id: id, type: 'url'": { type: 'url', inputmode: 'url', autocapitalize: 'none', spellcheck: 'false' },
  },
};

// Únicos campos onde autocomplete="off" é justificado.
const AUTOCOMPLETE_OFF_PERMITIDO = new Set(['index.html#faq-busca', 'admin/index.html#busca-global']);

function paginas(dir = raiz) {
  const fora = new Set(['.git', 'testes', 'supabase', 'node_modules']);
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return fora.has(n) ? [] : paginas(p);
    return n.endsWith('.html') ? [relative(raiz, p)] : [];
  });
}

function atributos(tag) {
  const a = {};
  const re = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
  const corpo = tag.replace(/^<\w+/, '').replace(/\/?>$/, '');
  for (const m of corpo.matchAll(re)) a[m[1].toLowerCase()] = m[2] ?? '';
  return a;
}

function camposDoHtml(html) {
  return [...html.matchAll(/<(input|textarea|select)\b[^>]*>/g)].map((m) => ({ tag: m[1], a: atributos(m[0]) }));
}

function conferir(onde, real, esperado) {
  for (const [k, v] of Object.entries(esperado)) {
    if (v === null) assert.equal(real[k], undefined, `${onde}: sem ${k}`);
    else assert.equal(real[k], v, `${onde}: ${k}="${v}" (veio ${JSON.stringify(real[k])})`);
  }
}

test('campos de texto do HTML: todos listados e com autocomplete/inputmode esperados', () => {
  const vistos = new Set();
  for (const pagina of paginas()) {
    for (const { tag, a } of camposDoHtml(ler(pagina))) {
      if (tag === 'select' || ['radio', 'checkbox', 'hidden', 'submit', 'button'].includes(a.type)) continue;
      const chave = `${pagina}#${a.id}`;
      const esperado = ESPERADO[pagina]?.[a.id];
      assert.ok(esperado, `${chave}: campo novo sem entrada em ESPERADO (decida autocomplete/inputmode)`);
      conferir(chave, a, esperado);
      vistos.add(chave);
    }
  }
  for (const [pagina, campos] of Object.entries(ESPERADO)) {
    for (const id of Object.keys(campos)) assert.ok(vistos.has(`${pagina}#${id}`), `${pagina}#${id} existe`);
  }
});

test('campos criados pelo JS (chat e links do briefing) com os tokens esperados', () => {
  for (const [arquivo, campos] of Object.entries(ESPERADO_JS)) {
    const src = ler(arquivo);
    for (const [marca, esperado] of Object.entries(campos)) {
      const i = src.indexOf(marca);
      assert.ok(i !== -1, `${arquivo}: achei ${marca}`);
      // campo('id', ...) → o objeto vem depois do marcador; "id: ..." → o marcador está dentro do objeto.
      const ini = marca.startsWith('campo(') ? src.indexOf('{', i) : src.lastIndexOf('{', i);
      const trecho = src.slice(ini, src.indexOf('}', ini) + 1);
      const real = {};
      for (const m of trecho.matchAll(/'?([a-zA-Z-]+)'?:\s*'([^']*)'/g)) real[m[1]] = m[2];
      conferir(`${arquivo} ${marca}`, real, esperado);
    }
  }
});

test('WhatsApp e e-mail: teclado certo em todo lugar (tel/email), nunca autocomplete="tel" com exemplo nacional', () => {
  for (const pagina of paginas()) {
    for (const { a } of camposDoHtml(ler(pagina))) {
      if (a.type === 'tel') assert.equal(a.inputmode, 'tel', `${pagina}#${a.id}: inputmode tel`);
      if (a.type === 'email' && !pagina.startsWith('admin/')) assert.equal(a.inputmode, 'email', `${pagina}#${a.id}: inputmode email`);
    }
  }
});

test('autocomplete="off" só onde é justificado', () => {
  for (const pagina of paginas()) {
    for (const { a } of camposDoHtml(ler(pagina))) {
      if (a.autocomplete === 'off') assert.ok(AUTOCOMPLETE_OFF_PERMITIDO.has(`${pagina}#${a.id}`), `${pagina}#${a.id}: autocomplete="off" sem motivo`);
    }
  }
  for (const arquivo of ['assets/js/chat.js', 'assets/js/briefing.js', 'assets/js/planos.js']) {
    assert.doesNotMatch(ler(arquivo), /autocomplete['"]?\s*[:=,]\s*['"]off/, `${arquivo}: sem autocomplete off`);
  }
});
