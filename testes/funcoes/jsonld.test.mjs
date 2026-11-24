// Dados estruturados estáticos de todo o site (melhoria 61).
// Valida cada <script type="application/ld+json"> do HTML: JSON válido, @context, URLs absolutas
// coerentes com o canonical e nenhum campo que exigiria dado inventado (avaliações, números, prêmios).
// Uso: node --test testes/funcoes/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const raiz = new URL('../../', import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');
const janela = {};
vm.runInNewContext(ler('config.js'), { window: janela });
const SITE = janela.PBR_CONFIG.site.url.replace(/\/?$/, '/');

const paginas = ['', 'blog/', 'segmentos/', 'exemplos/', 'admin/']
  .flatMap((d) => readdirSync(new URL(d || '.', raiz)).filter((f) => f.endsWith('.html')).map((f) => d + f));
const canonical = (html) => (/<link rel="canonical" href="([^"]+)">/.exec(html) || [])[1];
const blocosLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

function nos(valor, lista = []) {
  if (Array.isArray(valor)) valor.forEach((v) => nos(v, lista));
  else if (valor && typeof valor === 'object') {
    if (valor['@type']) lista.push(valor);
    Object.values(valor).forEach((v) => nos(v, lista));
  }
  return lista;
}
// Todos os pares [chave, valor-texto] do grafo, em qualquer profundidade
function textos(valor, chave = '', lista = []) {
  if (Array.isArray(valor)) valor.forEach((v) => textos(v, chave, lista));
  else if (valor && typeof valor === 'object') Object.entries(valor).forEach(([k, v]) => textos(v, k, lista));
  else if (typeof valor === 'string') lista.push([chave, valor]);
  return lista;
}

// Tipos e campos que só fariam sentido com dados reais que o site não tem (CLAUDE.md, "Honestidade").
const TIPOS_PROIBIDOS = ['Review', 'AggregateRating', 'Rating', 'EmployeeRole'];
const CAMPOS_PROIBIDOS = ['review', 'aggregateRating', 'ratingValue', 'reviewCount', 'ratingCount', 'bestRating',
  'award', 'numberOfEmployees', 'foundingDate', 'founder', 'interactionStatistic', 'userInteractionCount'];
// Tipos que descrevem a própria página: url deve ser exatamente o canonical
const TIPOS_PAGINA = ['WebPage', 'CollectionPage', 'ProfilePage', 'AboutPage', 'ContactPage', 'FAQPage', 'Blog', 'Service'];
const CHAVES_URL = ['url', 'item', 'image', 'logo', 'mainEntityOfPage', '@id', 'contentUrl', 'thumbnailUrl'];

test('JSON-LD estático: válido, com @context schema.org e sem [PROVISÓRIO] em nenhuma página', () => {
  let total = 0;
  for (const f of paginas) {
    const html = ler(f);
    const brutos = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const b of brutos) {
      let d;
      assert.doesNotThrow(() => { d = JSON.parse(b); }, `${f}: JSON-LD inválido`);
      assert.equal(d['@context'], 'https://schema.org', `${f}: @context`);
      for (const n of d['@graph'] || [d]) assert.ok(n['@type'], `${f}: nó raiz sem @type`);
      assert.ok(!/PROVIS[ÓO]RIO/i.test(b), `${f}: texto [PROVISÓRIO] vazou para o JSON-LD`);
      total++;
    }
  }
  assert.ok(total >= 20, `blocos JSON-LD encontrados (${total})`);
});

test('JSON-LD estático: URLs absolutas, do próprio site, e páginas apontando para o próprio canonical', () => {
  for (const f of paginas) {
    const html = ler(f);
    const can = canonical(html);
    for (const d of blocosLd(html)) {
      for (const [k, v] of textos(d)) {
        if (!CHAVES_URL.includes(k)) continue;
        if (k === '@id' && v.startsWith('#')) continue;
        assert.match(v, /^https:\/\//, `${f}: ${k} precisa ser URL absoluta (${v})`);
        assert.ok(v.startsWith(SITE), `${f}: ${k} fora do site (${v})`);
        assert.ok(!/\.\.\/|\/\.\//.test(v), `${f}: ${k} com caminho relativo (${v})`);
      }
      for (const n of nos(d)) {
        // nós "desta página" (com @id ancorado no canonical) carregam o canonical como url
        if (can && typeof n['@id'] === 'string' && n['@id'].startsWith(can + '#') && n.url) {
          assert.equal(n.url, can, `${f}: url de ${n['@type']} ≠ canonical`);
        }
        if (can && TIPOS_PAGINA.includes(n['@type']) && n.url && n['@id'] && !n['@id'].startsWith(SITE + '#')) {
          assert.equal(n.url, can, `${f}: ${n['@type']}.url ≠ canonical`);
        }
        if (n['@type'] === 'BreadcrumbList' && can) {
          const ultimo = n.itemListElement[n.itemListElement.length - 1];
          assert.equal(ultimo.item, can, `${f}: último item da trilha ≠ canonical`);
        }
      }
    }
  }
});

test('JSON-LD estático: sem avaliações, números ou campos que exigiriam dados inventados', () => {
  for (const f of paginas) {
    for (const d of blocosLd(ler(f))) {
      for (const n of nos(d)) {
        assert.ok(!TIPOS_PROIBIDOS.includes(n['@type']), `${f}: tipo proibido ${n['@type']}`);
        for (const c of CAMPOS_PROIBIDOS) assert.ok(!(c in n), `${f}: campo proibido ${c} em ${n['@type']}`);
      }
    }
  }
});

test('exemplos.html: CollectionPage + ItemList com os 6 exemplos da página, todos marcados como exemplo', () => {
  const html = ler('exemplos.html');
  const can = canonical(html);
  const todos = blocosLd(html).flatMap((d) => nos(d));
  const pagina = todos.find((n) => n['@type'] === 'CollectionPage');
  assert.ok(pagina, 'CollectionPage presente');
  assert.equal(pagina.url, can);
  assert.equal(pagina['@id'], can + '#pagina');
  assert.match(pagina.description, /fictício/, 'descrição deixa claro que são fictícios');
  const lista = pagina.mainEntity;
  assert.equal(lista['@type'], 'ItemList');
  const links = [...html.matchAll(/<a class="ex-cartao__link" href="([^"]+)"/g)].map((m) => SITE + m[1]);
  assert.equal(links.length, 6, 'seis cartões de exemplo na página');
  assert.equal(lista.numberOfItems, links.length);
  assert.deepEqual(lista.itemListElement.map((i) => i.url), links, 'itens = links dos cartões, na mesma ordem');
  lista.itemListElement.forEach((it, i) => {
    assert.equal(it.position, i + 1);
    assert.match(it.name, /\(site de exemplo\)$/, `item ${i + 1}: nome marcado como exemplo`);
    assert.match(it.description, /^Site de exemplo fictício:/, `item ${i + 1}: descrição marcada como fictícia`);
  });
});

test('portfolio.html: sem JSON-LD de projetos no HTML (só o JS gera, e só com projetos reais do config.js)', () => {
  const html = ler('portfolio.html');
  const tipos = blocosLd(html).flatMap((d) => nos(d)).map((n) => n['@type']);
  assert.ok(!tipos.includes('ItemList') && !tipos.includes('CreativeWork'), 'nenhuma lista de projetos estática');
  const js = ler('assets/js/main.js');
  assert.match(js, /data-ld-portfolio/, 'main.js gera o JSON-LD do portfólio');
  assert.match(js, /projetos\.length > 0\)[\s\S]{0,4000}data-ld-portfolio/, 'JSON-LD do portfólio só dentro do bloco com projetos reais');
});
