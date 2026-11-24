// Otimizador de SVG com regras próprias (melhoria 42). Sem dependências: só texto.
// Usado por testes/imagens/otimizar.mjs (grava) e testes/funcoes/imagens.test.mjs (confere).
//
// Regras, todas sem mudar o desenho:
//  1. remove prólogo XML, DOCTYPE, comentários e <metadata>;
//  2. remove elementos e atributos de editores (Inkscape, Sodipodi, Illustrator, Sketch, Figma: data-name);
//  3. remove atributos que não fazem nada no navegador (version, xml:space, enable-background, xmlns:xlink sem uso);
//  4. arredonda números com mais de 2 casas decimais em coordenadas, caminhos e transformações;
//  5. encurta cores #RRGGBB → #RGB quando possível (#FFFFFF → #FFF), mantendo maiúsculas/minúsculas;
//  6. junta espaços: nada entre tags, um espaço entre atributos, sem espaços sobrando antes de "/>".
// Mantém <title>, <desc>, role e aria-* (acessibilidade) e não reescreve comandos de caminho.

const ATRIBUTOS_NUMERICOS = /^(d|points|viewBox|transform|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|stroke-width|offset|fx|fy)$/;
const ATRIBUTOS_INUTEIS = /^(version|xml:space|enable-background|data-name|sketch:type|xmlns:(inkscape|sodipodi|sketch|serif|i|x|graph|a|dc|cc|rdf))$/;
const PREFIXOS_EDITOR = /^(inkscape|sodipodi|sketch|serif|i):/;

function arredondar(valor) {
  return valor.replace(/-?\d*\.\d{3,}(?:e-?\d+)?/gi, (n) => {
    const r = Number(Number(n).toFixed(2));
    return String(r).replace(/^(-?)0\./, '$1.');
  });
}

function encurtarCor(valor) {
  return valor.replace(/#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3\b/gi, '#$1$2$3');
}

function limparAtributos(tag) {
  // tag: conteúdo entre "<" e ">" (sem eles), ex.: 'rect width="48" fill="#FFFFFF"/'
  const m = /^([\w:-]+)([\s\S]*?)(\/?)$/.exec(tag);
  if (!m) return tag;
  const [, nome, resto, auto] = m;
  const attrs = [];
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let a;
  while ((a = re.exec(resto))) {
    const chave = a[1];
    let valor = a[3] !== undefined ? a[3] : a[4];
    if (ATRIBUTOS_INUTEIS.test(chave) || PREFIXOS_EDITOR.test(chave)) continue;
    if (chave === 'xmlns:xlink') continue; // decidido depois, conforme o uso de xlink:
    if (ATRIBUTOS_NUMERICOS.test(chave)) valor = arredondar(valor).replace(/\s+/g, ' ').trim();
    if (/^(fill|stroke|stop-color|color|flood-color|lighting-color)$/.test(chave) || chave === 'style') valor = encurtarCor(valor);
    attrs.push(`${chave}="${valor.replace(/"/g, '&quot;')}"`);
  }
  if (/xmlns:xlink/.test(resto) && nome === 'svg') attrs.push('xmlns:xlink="__XLINK__"');
  return nome + (attrs.length ? ' ' + attrs.join(' ') : '') + auto;
}

export function otimizarSvg(texto) {
  let s = String(texto);
  const usaXlink = /\sxlink:[\w-]+\s*=/.test(s);
  s = s.replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, '')
    .replace(/<(sodipodi|inkscape|sketch):[\w-]+[\s\S]*?(\/>|<\/\1:[\w-]+>)/gi, '');
  // Só mexe em tags; o texto (title, desc, text) fica como está, só sem espaços nas pontas.
  s = s.replace(/<(?![!?/])([^<>]+)>/g, (_, dentro) => '<' + limparAtributos(dentro.trim()) + '>');
  s = s.replace(/<\/\s*([\w:-]+)\s*>/g, '</$1>');
  s = s.replace(/xmlns:xlink="__XLINK__"/, usaXlink ? 'xmlns:xlink="http://www.w3.org/1999/xlink"' : '').replace(/\s+>/g, '>').replace(/\s+\/>/g, '/>');
  s = s.replace(/>\s+</g, '><').trim();
  return s + '\n';
}

// Conteúdo perigoso ou que depende de fora: proibido em SVG servido pelo site.
export function problemasSvg(texto) {
  const p = [];
  if (/<script/i.test(texto)) p.push('<script>');
  if (/\son[a-z]+\s*=/i.test(texto)) p.push('atributo de evento (on*)');
  if (/<foreignObject/i.test(texto)) p.push('<foreignObject>');
  if (/(href|src)\s*=\s*["'](?!#|data:image\/)/i.test(texto)) p.push('link para recurso externo');
  if (/@import|url\(\s*["']?(?!#)/i.test(texto)) p.push('CSS com recurso externo');
  if (!/viewBox=/.test(texto)) p.push('sem viewBox (não escala)');
  return p;
}
