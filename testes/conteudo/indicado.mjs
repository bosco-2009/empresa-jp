// Bloco "Plano indicado" no fim dos artigos do blog e das páginas de segmento (melhoria 65)
// e faixa final "Gostou deste exemplo?" nas páginas de exemplo (melhoria 95).
// A regra fica em config.js → planoIndicado ('blog:<arquivo>' | 'segmento:<id>' → id do plano).
// O bloco é gravado no HTML entre <!-- indicado:inicio --> e <!-- indicado:fim -->, para funcionar sem JS
// e sem deslocar nada na carga. Quando a regra ou um plano mudar no config.js, rode:
//   node testes/conteudo/indicado.mjs --gravar
// O teste testes/funcoes/indicado.test.mjs falha se o HTML estiver diferente do que este script geraria.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const raiz = new URL('../../', import.meta.url);
export const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');
export const INICIO = '<!-- indicado:inicio -->';
export const FIM = '<!-- indicado:fim -->';

export function lerConfig() {
  const janela = {};
  vm.runInNewContext(ler('config.js'), { window: janela });
  return janela.PBR_CONFIG;
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 'blog:site-ou-instagram' → 'blog/site-ou-instagram.html'; 'segmento:moda' → 'segmentos/moda.html' */
export function arquivoDa(chave) {
  const [tipo, slug] = chave.split(':');
  if (tipo === 'blog') return `blog/${slug}.html`;
  if (tipo === 'segmento') return `segmentos/${slug}.html`;
  throw new Error('chave inválida em planoIndicado: ' + chave);
}

/** Markup do bloco para uma página (recuo igual ao do marcador). */
export function bloco(chave, html, config) {
  const [tipo, slug] = chave.split(':');
  const plano = config.planos.find((p) => p.id === config.planoIndicado[chave]);
  if (!plano) throw new Error(`plano "${config.planoIndicado[chave]}" de ${chave} não existe em config.planos`);
  let rotulo = 'Por onde começar';
  let simulador = '../index.html#simulador';
  let nivel = 'h2';
  if (tipo === 'segmento') {
    const trilha = /<p class="seg__selo">.*?<span>Sites para ([^<]+)<\/span>/.exec(html);
    if (!trilha) throw new Error('selo do segmento não encontrado em ' + chave);
    rotulo = 'Plano indicado para ' + trilha[1];
    simulador = `../index.html?segmento=${slug}#simulador`;
    nivel = 'h3'; // dentro da seção "Qual plano escolher?"
  }
  const id = 'indicado-titulo';
  const r = tipo === 'segmento' ? '          ' : '        ';
  return [
    `<aside class="indicado" aria-labelledby="${id}" data-indicado="${esc(chave)}">`,
    `  <p class="indicado__rotulo">${esc(rotulo)}</p>`,
    `  <${nivel} id="${id}" class="indicado__titulo">Plano <span data-indicado-nome>${esc(plano.nome)}</span></${nivel}>`,
    `  <p class="indicado__resumo" data-indicado-resumo>${esc(plano.resumo)}</p>`,
    `  <p class="indicado__acoes">`,
    `    <a class="botao botao--primario" href="../planos.html?plano=${esc(plano.id)}" data-indicado-link data-origem-cta="${esc(tipo + '/' + slug)}">Ver o plano ${esc(plano.nome)}</a>`,
    `    <a class="indicado__link" href="../planos.html#comparativo">Comparar todos os planos</a>`,
    `  </p>`,
    `  <p class="indicado__nota">É uma indicação geral. Para o seu caso, responda o <a href="${simulador}">simulador de planos</a>.</p>`,
    `</aside>`
  ].map((l) => r + l).join('\n');
}

/** HTML da página com o bloco atualizado. */
export function aplicar(chave, html, config) {
  const i = html.indexOf(INICIO);
  const f = html.indexOf(FIM);
  if (i < 0 || f < i) throw new Error('marcadores do bloco indicado não encontrados em ' + arquivoDa(chave));
  const recuo = html.slice(html.lastIndexOf('\n', i) + 1, i);
  return html.slice(0, i) + INICIO + '\n' + bloco(chave, html, config) + '\n' + recuo + html.slice(f);
}

export function paginas() {
  const config = lerConfig();
  return Object.keys(config.planoIndicado).map((chave) => {
    const arquivo = arquivoDa(chave);
    const atual = ler(arquivo);
    return { chave, arquivo, atual, esperado: aplicar(chave, atual, config) };
  });
}

// ---------- Faixa final das páginas de exemplo (melhoria 95) ----------
// exemplos/<segmento>.html ganha, antes do rodapé, a faixa "Gostou deste exemplo?" com o plano indicado pela MESMA
// regra da página de segmento ('segmento:<id>'). Fixa no HTML (sem JS), entre os marcadores abaixo.
export const EX_INICIO = '<!-- exemplo-chamada:inicio -->';
export const EX_FIM = '<!-- exemplo-chamada:fim -->';

/** "Sites para lojas de moda" (selo de segmentos/<slug>.html) → "lojas de moda" */
function publicoDoSegmento(slug) {
  const m = /<p class="seg__selo">.*?<span>Sites para ([^<]+)<\/span>/.exec(ler(`segmentos/${slug}.html`));
  if (!m) throw new Error('selo do segmento não encontrado em segmentos/' + slug + '.html');
  return m[1];
}

export function blocoExemplo(slug, config) {
  const chave = 'segmento:' + slug;
  const plano = config.planos.find((p) => p.id === config.planoIndicado[chave]);
  if (!plano) throw new Error(`sem plano indicado para ${chave} (exemplos/${slug}.html)`);
  const id = 'exemplo-chamada-titulo';
  return [
    `<aside class="ex-chamada-final" aria-labelledby="${id}" data-exemplo-chamada="${esc(slug)}">`,
    `  <div class="container ex-chamada-final__grade">`,
    `    <div class="ex-chamada-final__texto">`,
    `      <p class="ex-chamada-final__rotulo">Fim do site de exemplo</p>`,
    `      <h2 id="${id}" class="ex-chamada-final__titulo">Gostou deste exemplo? Um site assim para o seu negócio</h2>`,
    `      <p class="ex-chamada-final__resumo">Indicação geral para ${esc(publicoDoSegmento(slug))}: plano <strong>${esc(plano.nome)}</strong>. ${esc(plano.resumo)}</p>`,
    `    </div>`,
    `    <p class="ex-chamada-final__acoes">`,
    `      <a class="botao botao--primario" href="../planos.html?plano=${esc(plano.id)}" data-origem-cta="exemplo/${esc(slug)}">Ver o plano ${esc(plano.nome)}</a>`,
    `      <a class="ex-chamada-final__link" href="../index.html?segmento=${esc(slug)}#simulador">Responder o simulador de planos</a>`,
    `    </p>`,
    `  </div>`,
    `</aside>`
  ].map((l) => '  ' + l).join('\n');
}

export function aplicarExemplo(slug, html, config) {
  const i = html.indexOf(EX_INICIO);
  const f = html.indexOf(EX_FIM);
  if (i < 0 || f < i) throw new Error('marcadores da faixa final não encontrados em exemplos/' + slug + '.html');
  return html.slice(0, i) + EX_INICIO + '\n' + blocoExemplo(slug, config) + '\n  ' + html.slice(f);
}

export function paginasExemplo() {
  const config = lerConfig();
  return readdirSync(new URL('exemplos/', raiz)).filter((f) => f.endsWith('.html')).sort().map((f) => {
    const slug = f.replace('.html', '');
    const arquivo = 'exemplos/' + f;
    const atual = ler(arquivo);
    return { chave: 'segmento:' + slug, slug, arquivo, atual, esperado: aplicarExemplo(slug, atual, config) };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const p of [...paginas(), ...paginasExemplo()]) {
    if (p.atual === p.esperado) { console.log('  igual   ' + p.arquivo); continue; }
    if (process.argv.includes('--gravar')) { writeFileSync(new URL(p.arquivo, raiz), p.esperado); console.log('  gravado ' + p.arquivo); }
    else console.log('  DIFERENTE ' + p.arquivo + ' (rode com --gravar)');
  }
}
