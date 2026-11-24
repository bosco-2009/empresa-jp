// Versão nos arquivos estáticos (melhoria 69).
//
// O GitHub Pages não deixa configurar cabeçalhos de cache: o navegador pode reaproveitar um CSS/JS velho por um
// tempo depois de uma publicação. Para isso nunca acontecer, toda referência local a CSS, JS e fonte leva um sufixo
// `?v=<hash curto do conteúdo>`. Mudou o arquivo, muda o endereço, e o navegador baixa de novo.
//
// Sem build: este script só reescreve os atributos `href`/`src` das páginas HTML e os `url()` de fonte dentro dos CSS.
// Rode antes de cada commit que mexa em CSS, JS, fonte ou config.js:
//
//   node testes/cache/versionar.mjs             # grava
//   node testes/cache/versionar.mjs --conferir  # só confere (sai com erro se houver referência desatualizada)
//
// O teste testes/funcoes/versao-arquivos.test.mjs usa a mesma conferência.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Prefixo absoluto usado pelo 404.html (o GitHub Pages o serve em qualquer URL do subcaminho).
const PREFIXO_ABSOLUTO = '/empresa-jp/';
const IGNORAR = new Set(['.git', 'testes', 'supabase', 'node_modules']);
const EXTENSOES = /\.(css|js|woff2)$/;
const TAMANHO_HASH = 8;

const posix = (p) => p.split(sep).join('/');

export function paginasHtml(dir = RAIZ) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (IGNORAR.has(e.name)) return [];
    const caminho = join(dir, e.name);
    if (e.isDirectory()) return paginasHtml(caminho);
    return e.isFile() && e.name.endsWith('.html') ? [caminho] : [];
  });
}

export function folhasCss() {
  const dir = join(RAIZ, 'assets/css');
  return readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => join(dir, f));
}

const cacheHash = new Map();
export function hashDe(arquivo) {
  if (!cacheHash.has(arquivo)) {
    cacheHash.set(arquivo, createHash('sha256').update(readFileSync(arquivo)).digest('hex').slice(0, TAMANHO_HASH));
  }
  return cacheHash.get(arquivo);
}

// Resolve o caminho de uma referência (relativa à página/folha ou absoluta no subcaminho) para o arquivo no disco.
// Devolve null para o que não é deste site (http, data:, outro domínio) ou não é CSS/JS/fonte.
function alvo(origem, caminho) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(caminho)) return null;
  if (!EXTENSOES.test(caminho)) return null;
  if (caminho.startsWith(PREFIXO_ABSOLUTO)) return join(RAIZ, caminho.slice(PREFIXO_ABSOLUTO.length));
  if (caminho.startsWith('/')) return join(RAIZ, caminho.slice(1));
  return resolve(dirname(origem), caminho);
}

// Padrões das referências: atributos href/src em HTML e url() em CSS. O grupo "caminho" não inclui o ?v= atual.
const PADRAO_HTML = /(\s(?:href|src)=")([^"?#]+)(?:\?v=([0-9a-f]*))?(")/g;
const PADRAO_CSS = /(url\(\s*['"]?)([^'")?#]+)(?:\?v=([0-9a-f]*))?(['"]?\s*\))/g;

// Reescreve o texto de um arquivo; devolve { texto, problemas } (problemas = referências desatualizadas ou quebradas).
function processar(origem, texto, padrao) {
  const problemas = [];
  const novo = texto.replace(padrao, (inteiro, antes, caminho, versao, depois) => {
    const arquivo = alvo(origem, caminho);
    if (!arquivo) return inteiro;
    if (!existsSync(arquivo)) {
      problemas.push(`${posix(relative(RAIZ, origem))}: ${caminho} não existe`);
      return inteiro;
    }
    const certo = hashDe(arquivo);
    if (versao !== certo) {
      problemas.push(`${posix(relative(RAIZ, origem))}: ${caminho} ${versao ? `?v=${versao} desatualizado` : 'sem ?v='} (esperado ?v=${certo})`);
    }
    return `${antes}${caminho}?v=${certo}${depois}`;
  });
  return { texto: novo, problemas };
}

// Ordem importa: fontes → CSS (que cita as fontes) → HTML (que cita CSS, JS e fontes).
export function versionar({ gravar = false } = {}) {
  cacheHash.clear();
  const problemas = [];
  const alterados = [];
  const passo = (arquivos, padrao) => {
    for (const f of arquivos) {
      const antes = readFileSync(f, 'utf8');
      const r = processar(f, antes, padrao);
      problemas.push(...r.problemas);
      if (r.texto !== antes) {
        alterados.push(posix(relative(RAIZ, f)));
        if (gravar) {
          writeFileSync(f, r.texto);
          cacheHash.delete(f); // o CSS mudou: o hash dele (usado pelo HTML) tem de ser recalculado
        }
      }
    }
  };
  passo(folhasCss(), PADRAO_CSS);
  passo(paginasHtml(), PADRAO_HTML);
  return { problemas, alterados };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const conferir = process.argv.includes('--conferir');
  const { problemas, alterados } = versionar({ gravar: !conferir });
  if (conferir) {
    if (problemas.length) {
      console.error(problemas.join('\n'));
      console.error(`\n${problemas.length} referência(s) desatualizada(s). Rode: node testes/cache/versionar.mjs`);
      process.exit(1);
    }
    console.log('Versões em dia.');
  } else {
    const quebradas = problemas.filter((p) => p.endsWith('não existe'));
    if (quebradas.length) { console.error(quebradas.join('\n')); process.exit(1); }
    console.log(alterados.length ? `Atualizados:\n  ${alterados.join('\n  ')}` : 'Nada a atualizar.');
  }
}
