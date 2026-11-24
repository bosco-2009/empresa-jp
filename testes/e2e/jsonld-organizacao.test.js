// Uso: veja testes/README.md (precisa só do servidor estático em :8080).
// Melhoria 80: o JSON-LD da home (HTML fixo + nós do main.js) junta Organization e WebSite só com dados reais.
//  - com o config.js atual (contatos vazios/[PROVISÓRIO]): sem email, telephone, contactPoint, legalName, taxID;
//  - com contatos preenchidos (config simulado): entram no formato certo, com URLs absolutas do canonical;
//  - valores marcados [PROVISÓRIO] ou inválidos nunca entram; zero erros no console.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:8080/';
const RAIZ = path.resolve(__dirname, '../..');
const configOriginal = fs.readFileSync(RAIZ + '/config.js', 'utf8');

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

function trocar(cfg, campo, valor) {
  const re = new RegExp('(\\b' + campo + ":\\s*)'[^']*'");
  if (!re.test(cfg)) throw new Error('campo não encontrado no config: ' + campo);
  return cfg.replace(re, "$1'" + valor + "'");
}

async function grafo(navegador, config) {
  const pagina = await navegador.newPage();
  const erros = [];
  pagina.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  pagina.on('pageerror', (e) => erros.push(String(e)));
  await pagina.route(/\/config\.js(\?|$)/, (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
  await pagina.goto(SITE, { waitUntil: 'load' });
  await pagina.waitForSelector('script[data-ld-servico]', { state: 'attached' });
  const dados = await pagina.$$eval('script[type="application/ld+json"]', (s) => s.map((e) => e.textContent));
  const canonical = await pagina.$eval('link[rel=canonical]', (l) => l.href);
  await pagina.close();
  // Junta os nós com o mesmo @id (como fazem os buscadores)
  const porId = {};
  for (const bruto of dados) {
    const d = JSON.parse(bruto);
    for (const n of d['@graph'] || [d]) {
      const id = n['@id'] || Math.random();
      porId[id] = Object.assign(porId[id] || {}, n);
    }
  }
  return { porId, brutos: dados.join('\n'), erros, canonical };
}

(async () => {
  const navegador = await chromium.launch();

  console.log('config.js atual (contatos ainda [PROVISÓRIO])');
  let r = await grafo(navegador, configOriginal);
  let org = r.porId[r.canonical + '#organizacao'];
  ok(org && org.name === 'Portfólio BR' && org.url === r.canonical, 'Organization com nome e url do canonical');
  ok(org && Array.isArray(org.sameAs) && org.sameAs.length === 1 && /^https:\/\/www\.instagram\.com\/[\w.]+\/$/.test(org.sameAs[0]), 'sameAs = Instagram');
  ok(org && !org.email && !org.telephone && !org.contactPoint && !org.legalName && !org.taxID, 'sem contatos nem dados da empresa provisórios');
  ok(r.porId[r.canonical + '#site'] && r.porId[r.canonical + '#site'].publisher['@id'] === r.canonical + '#organizacao', 'WebSite publicado pela Organization');
  ok(!/provis[óo]rio/i.test(r.brutos), 'nenhum [PROVISÓRIO] no JSON-LD');
  ok(r.erros.length === 0, 'zero erros no console' + (r.erros.length ? ': ' + r.erros.join(' | ') : ''));

  console.log('contatos preenchidos (simulado só neste teste)');
  let cfg = trocar(configOriginal, 'whatsapp', '5511900000000');
  cfg = trocar(cfg, 'email', 'contato@exemplo.com.br');
  cfg = trocar(cfg, 'razaoSocial', 'Empresa Teste LTDA');
  cfg = trocar(cfg, 'cnpj', '00.000.000/0001-00');
  r = await grafo(navegador, cfg);
  org = r.porId[r.canonical + '#organizacao'];
  ok(org.email === 'contato@exemplo.com.br', 'email entra');
  ok(org.telephone === '+5511900000000', 'telephone com +DDI');
  ok(org.contactPoint && org.contactPoint['@type'] === 'ContactPoint' && org.contactPoint.telephone === '+5511900000000' &&
    org.contactPoint.availableLanguage === 'pt-BR', 'contactPoint de atendimento em pt-BR');
  ok(org.legalName === 'Empresa Teste LTDA' && org.taxID === '00.000.000/0001-00', 'legalName e taxID');
  ok(r.erros.length === 0, 'zero erros no console');

  console.log('valores marcados [PROVISÓRIO] ou inválidos');
  cfg = trocar(configOriginal, 'whatsapp', '11 9999');
  cfg = trocar(cfg, 'email', '[PROVISÓRIO] contato@exemplo.com.br');
  cfg = trocar(cfg, 'razaoSocial', '[PROVISÓRIO]');
  cfg = trocar(cfg, 'cnpj', '123');
  r = await grafo(navegador, cfg);
  org = r.porId[r.canonical + '#organizacao'];
  ok(!org.email && !org.telephone && !org.contactPoint && !org.legalName && !org.taxID, 'nada disso entra no JSON-LD');
  ok(!/provis[óo]rio/i.test(r.brutos), 'nenhum [PROVISÓRIO] no JSON-LD');

  await navegador.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
