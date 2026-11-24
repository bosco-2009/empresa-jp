// Leitura estimada dos artigos do blog (melhoria 57).
// Conta as palavras do corpo do artigo (do primeiro parágrafo até antes da chamada final) e calcula
// "Leitura de N min" a 200 palavras por minuto (arredondado, mínimo 1).
// O teste testes/funcoes/blog-leitura.test.mjs trava os valores; quando um artigo mudar, rode:
//   node testes/blog/leitura.mjs --gravar
// para atualizar o texto visível, o wordCount/timeRequired do JSON-LD, o cartão em blog/index.html
// e os cartões de "Leia também" dos outros artigos.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PALAVRAS_POR_MINUTO = 200;
export const ARTIGOS = ['site-ou-instagram', 'o-que-um-site-profissional-precisa-ter', 'como-funciona-a-criacao-do-seu-site'];

const raiz = new URL('../../', import.meta.url);
export const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');

/** Texto do corpo do artigo, sem tags, sem a chamada final e sem os relacionados. */
export function corpoDoArtigo(html) {
  const inicio = html.indexOf('artigo__corpo">');
  // o corpo termina no bloco "Plano indicado" (melhoria 65) ou, sem ele, na chamada final
  const indicado = html.indexOf('<!-- indicado:inicio -->', inicio);
  const fim = indicado >= 0 ? indicado : html.indexOf('<aside class="artigo__chamada"', inicio);
  if (inicio < 0 || fim < 0) throw new Error('corpo do artigo não encontrado');
  return html.slice(inicio + 'artigo__corpo">'.length, fim)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ');
}

export function contarPalavras(html) {
  return (corpoDoArtigo(html).match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length;
}

export const minutos = (palavras) => Math.max(1, Math.round(palavras / PALAVRAS_POR_MINUTO));

export function medir() {
  return ARTIGOS.map((slug) => {
    const palavras = contarPalavras(ler(`blog/${slug}.html`));
    return { slug, palavras, minutos: minutos(palavras) };
  });
}

function gravar() {
  for (const { slug, palavras, minutos: n } of medir()) {
    const f = `blog/${slug}.html`;
    let h = ler(f);
    h = h.replace(/leitura de \d+ min/i, `leitura de ${n} min`)
      .replace(/"wordCount": \d+(,\s*"timeRequired": "PT\d+M")?/, `"wordCount": ${palavras},\n        "timeRequired": "PT${n}M"`);
    writeFileSync(new URL(f, raiz), h);
    let idx = ler('blog/index.html');
    idx = idx.replace(new RegExp(`(data-leitura="${slug}">)Leitura de \\d+ min`), `$1Leitura de ${n} min`);
    writeFileSync(new URL('blog/index.html', raiz), idx);
    // cartões de "Leia também" dos outros artigos
    for (const outro of ARTIGOS.filter((a) => a !== slug)) {
      const g = `blog/${outro}.html`;
      writeFileSync(new URL(g, raiz), ler(g).replace(new RegExp(`(data-leitura-rel="${slug}">)leitura de \\d+ min`), `$1leitura de ${n} min`));
    }
    console.log(`${slug}: ${palavras} palavras → ${n} min`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--gravar')) gravar();
  else for (const m of medir()) console.log(`${m.slug}: ${m.palavras} palavras → ${m.minutos} min`);
}
