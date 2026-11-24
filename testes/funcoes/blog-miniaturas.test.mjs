// Miniaturas dos cartões do blog e do "Leia também" (melhoria 106).
// Geradas por testes/blog/miniaturas.py a partir das imagens OG do próprio site. Uso: node --test testes/funcoes/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// largura/altura pelo cabeçalho (PNG e WebP com VP8/VP8L/VP8X), sem importar outro arquivo de teste
function dimensoes(b, ext) {
  if (ext === '.png') return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
  const tipo = b.toString('latin1', 12, 16);
  if (tipo === 'VP8X') return { largura: 1 + b.readUIntLE(24, 3), altura: 1 + b.readUIntLE(27, 3) };
  if (tipo === 'VP8L') { const v = b.readUInt32LE(21); return { largura: (v & 0x3fff) + 1, altura: ((v >> 14) & 0x3fff) + 1 }; }
  return { largura: b.readUInt16LE(26) & 0x3fff, altura: b.readUInt16LE(28) & 0x3fff };
}

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const ler = (f) => readFileSync(join(RAIZ, f), 'utf8');
const MINIATURA_LARGURAS = [400, 800]; // iguais a LARGURAS em testes/blog/miniaturas.py
const PAGINAS = ['blog/index.html', 'blog/site-ou-instagram.html', 'blog/o-que-um-site-profissional-precisa-ter.html',
  'blog/como-funciona-a-criacao-do-seu-site.html'];

// nome da imagem OG da página para onde o cartão aponta
function ogDoDestino(pagina, href) {
  const destino = resolve(RAIZ, dirname(pagina), href);
  const html = readFileSync(destino, 'utf8');
  return /property="og:image" content="[^"]*\/og\/([a-z-]+)\.png"/.exec(html)[1];
}

for (const pagina of PAGINAS) {
  test(`${pagina}: cada cartão tem a miniatura do próprio destino, decorativa e preguiçosa`, () => {
    const html = ler(pagina);
    const lista = pagina.endsWith('index.html');
    const cartoes = [...html.matchAll(lista ? /<li class="blog-cartao">[\s\S]*?<\/li>/g : /<li class="relacionado[^"]*">[\s\S]*?<\/li>/g)].map((m) => m[0]);
    assert.ok(cartoes.length >= 2, `${pagina}: encontrou os cartões`);
    cartoes.forEach((c, i) => {
      // Na lista do blog a 1ª miniatura é o LCP da página (testes/e2e/lcp.test.js): sem lazy e com prioridade alta.
      const lcp = lista && i === 0;
      const href = /__titulo"><a href="([^"]+)"/.exec(c)[1];
      const nome = ogDoDestino(pagina, href);
      const pic = /<picture class="miniatura [^"]+">([\s\S]*?)<\/picture>/.exec(c);
      assert.ok(pic, `${pagina} → ${href}: cartão sem <picture class="miniatura">`);
      assert.ok(c.indexOf('<picture') < c.indexOf('__titulo'), `${pagina} → ${href}: miniatura antes do título no HTML`);
      const img = /<img\b[^>]*>/.exec(pic[1])[0];
      const attr = (n) => (new RegExp(`\\s${n}="([^"]*)"`).exec(img) || [])[1];
      assert.equal(attr('alt'), '', `${pagina} → ${href}: miniatura é decorativa (alt vazio)`);
      assert.equal(attr('loading'), lcp ? undefined : 'lazy', `${pagina} → ${href}: loading`);
      assert.equal(attr('decoding'), 'async');
      assert.equal(attr('fetchpriority'), lcp ? 'high' : undefined, `${pagina} → ${href}: prioridade alta só na imagem LCP`);
      assert.equal(attr('src'), `../assets/img/miniaturas/${nome}-400.png`, `${pagina} → ${href}: imagem do destino certo`);
      assert.deepEqual([attr('width'), attr('height')], ['400', '210']);
      const fonte = /<source type="image\/webp" srcset="([^"]+)" sizes="[^"]+">/.exec(pic[1]);
      assert.ok(fonte, `${pagina} → ${href}: <source> WebP com srcset e sizes`);
      assert.equal(fonte[1], MINIATURA_LARGURAS.map((l) => `../assets/img/miniaturas/${nome}-${l}.webp ${l}w`).join(', '));
      assert.doesNotMatch(c, /aria-hidden|tabindex/, 'nada de foco ou ARIA extra na imagem decorativa');
    });
  });
}

test('arquivos das miniaturas existem nas larguras certas, proporção da imagem OG', () => {
  const usados = new Set();
  for (const p of PAGINAS) for (const m of ler(p).matchAll(/miniaturas\/([a-z-]+-\d+\.(?:webp|png))/g)) usados.add(m[1]);
  assert.ok(usados.size >= 12, `miniaturas usadas (${usados.size})`);
  for (const arq of usados) {
    const caminho = join(RAIZ, 'assets/img/miniaturas', arq);
    assert.ok(existsSync(caminho), `${arq} não existe: rode python3 testes/blog/miniaturas.py`);
    const largura = Number(/-(\d+)\./.exec(arq)[1]);
    const d = dimensoes(readFileSync(caminho), arq.endsWith('.png') ? '.png' : '.webp');
    assert.deepEqual([d.largura, d.altura], [largura, Math.round(largura * 630 / 1200)], `${arq}: dimensões`);
  }
});
