// Dados do config.js gravados em termos.html e privacidade.html (melhoria 125).
// O legal.js preenche os marcadores [data-cfg], [data-cfg-email] e [data-cfg-whatsapp] com os dados do config.js.
// Como ele roda com `defer`, a página podia ser pintada antes com "[PROVISÓRIO: data]" e depois trocar para a data
// (a 320 px a linha "Última atualização" encolhia de 2 para 1 linha e empurrava o texto: CLS ≈ 0,016).
// Este script grava no HTML exatamente o que o legal.js produziria: a página já nasce certa (inclusive sem JS) e o
// legal.js não muda nada na carga. Mudou um desses dados no config.js? Rode:
//   node testes/legal/gravar.mjs --gravar
// O teste testes/funcoes/legal-gravado.test.mjs falha se o HTML estiver diferente do que este script geraria.
// A lista de planos ([data-cfg-planos]) fica fora: está bem abaixo da dobra e continua montada pelo legal.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const raiz = new URL('../../', import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');
export const PAGINAS = ['termos.html', 'privacidade.html'];

export function lerConfig() {
  const janela = {};
  vm.runInNewContext(ler('config.js'), { window: janela });
  return janela.PBR_CONFIG;
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const valor = (config, caminho) => caminho.split('.').reduce((o, k) => (o == null ? undefined : o[k]), config);

/** Mesmo resultado do legal.js: { html interno, provisório? } para um marcador. */
function conteudo(attrs, config) {
  const cfg = /\sdata-cfg="([^"]+)"/.exec(attrs);
  const rotulo = (/\sdata-cfg-rotulo="([^"]*)"/.exec(attrs) || [])[1];
  if (cfg) {
    const v = valor(config, cfg[1]);
    if (v === undefined || v === null || v === '') return { provisorio: true, html: `[PROVISÓRIO: ${rotulo || 'a preencher'}]` };
    return { provisorio: false, html: esc(v) };
  }
  if (/\sdata-cfg-email(?=[\s=]|$)/.test(attrs)) {
    const email = config.contato && config.contato.email;
    if (!email) return { provisorio: true, html: '[PROVISÓRIO: e-mail]' };
    return { provisorio: false, html: `<a href="mailto:${esc(email)}">${esc(email)}</a>` };
  }
  if (/\sdata-cfg-whatsapp(?=[\s=]|$)/.test(attrs)) {
    const zap = config.contato && config.contato.whatsapp;
    if (!zap) return { provisorio: true, html: '[PROVISÓRIO: WhatsApp]' };
    const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(zap);
    const texto = m ? `(${m[1]}) ${m[2]}-${m[3]}` : zap;
    return { provisorio: false, html: `<a href="https://wa.me/${esc(zap)}" target="_blank" rel="noopener">${esc(texto)}</a>` };
  }
  return null;
}

/** HTML da página com os marcadores gravados. */
export function gravarHtml(html, config) {
  return html.replace(/<span((?:\s+[\w-]+(?:="[^"]*")?)*)>([\s\S]*?)<\/span>/g, (todo, attrs) => {
    if (!/\sdata-cfg(?:="|-email|-whatsapp)/.test(attrs)) return todo;
    const c = conteudo(attrs, config);
    if (!c) return todo;
    const semClasse = attrs.replace(/\sclass="legal__provisorio"/, '');
    return `<span${c.provisorio ? ' class="legal__provisorio"' : ''}${semClasse}>${c.html}</span>`;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = lerConfig();
  const gravar = process.argv.includes('--gravar');
  let diferentes = 0;
  for (const p of PAGINAS) {
    const atual = ler(p);
    const novo = gravarHtml(atual, config);
    if (novo === atual) { console.log('  ok  ' + p); continue; }
    diferentes++;
    if (gravar) { writeFileSync(new URL(p, raiz), novo); console.log('  gravado  ' + p); }
    else console.log('  diferente  ' + p + ' (rode com --gravar)');
  }
  if (!gravar && diferentes) process.exit(1);
}
