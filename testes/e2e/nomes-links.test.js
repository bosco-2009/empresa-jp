// Uso: veja testes/README.md (servidor estático + Supabase falso + Postgres local, como o alvos-toque.test.js).
// Links e botões com o mesmo nome e destinos diferentes (item 72 do MELHORIAS.md; WCAG 2.4.4 e 2.4.9).
// Em cada página (320 e 1280 px, para pegar os dois menus), agrupa os links e botões expostos às tecnologias
// assistivas pelo NOME ACESSÍVEL (calculado pelo axe-core, como o leitor de tela anuncia) e acusa nomes iguais com
// destinos diferentes: quem navega pela lista de links do leitor de tela ouviria dois "Saiba mais" sem saber a diferença.
//   - Link: destino = endereço absoluto (sem o ?v= dos arquivos, "index.html" = pasta); o WhatsApp vale pelo número
//     (a mensagem pronta muda conforme a página, mas o destino é o mesmo).
//   - Botão: destino = o que ele controla/escolhe (aria-controls, value, formaction e atributos data-*).
// Ignora o que está fora da árvore de acessibilidade (display:none, hidden, aria-hidden, inert), como a abertura e as
// telas decorativas de exemplo. O 404.html é servido num caminho profundo, como o GitHub Pages faz.
// Além das páginas carregadas, confere os estados montados pelo JS: menu móvel aberto, chat aberto, simulador
// respondido, plano escolhido e comparativo, e o painel com dados (conversas, pedido aberto, briefing aberto, resumo).
// Um controle no fim prova que o teste acusa dois "Saiba mais" com destinos diferentes e aceita o complemento oculto.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITE = process.env.SITE || 'http://localhost:8080/';
const API = 'http://localhost:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InRlc3RlIn0.assinatura';
const RAIZ = path.resolve(__dirname, '../..');
const AXE = require.resolve('axe-core/axe.min.js');
const configTeste = fs.readFileSync(RAIZ + '/config.js', 'utf8')
  .replace(/(supabase:\s*\{\s*url:\s*)'[^']*'/, `$1'${API}'`)
  .replace(/(anonKey:\s*)'[^']*'/, `$1'${ANON}'`);
if (!configTeste.includes(API)) throw new Error('substituição do config falhou');

const PAGINAS = [
  ['home', ''], ['planos', 'planos.html'], ['obrigado', 'obrigado.html'], ['briefing', 'briefing.html'], ['pedido', 'pedido.html'],
  ['termos', 'termos.html'], ['privacidade', 'privacidade.html'], ['portfolio', 'portfolio.html'], ['exemplos', 'exemplos.html'],
  ['blog', 'blog/'], ['blog-autor', 'blog/autor.html'],
  ...['site-ou-instagram', 'o-que-um-site-profissional-precisa-ter', 'como-funciona-a-criacao-do-seu-site'].map((x) => ['blog-' + x.split('-')[0], `blog/${x}.html`]),
  ...['moda', 'restaurante', 'beleza', 'saude', 'servicos', 'pet'].map((x) => ['exemplo-' + x, `exemplos/${x}.html`]),
  ...['restaurante', 'moda', 'beleza', 'saude', 'servicos', 'pet'].map((x) => ['segmento-' + x, `segmentos/${x}.html`]),
  ['404', 'empresa-jp/uma/pagina/que/nao/existe'], ['admin-login', 'admin/'],
];
const LARGURAS = [320, 1280];

function psql(sql) {
  return execSync(process.env.PSQL || `psql -At -d ${process.env.BANCO || 'pbr_e2e'}`, { input: sql }).toString().trim();
}
let falhas = 0, conferidos = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

// Roda na página: devolve quantos nomes foram conferidos e { nome: [destinos] } dos nomes repetidos com destinos diferentes.
function coletar() {
  axe.setup(document);
  const SEL = 'a[href], button, input[type=submit], input[type=button], input[type=reset], [role=link], [role=button]';
  const foraDaArvore = (el) => {
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return true;
    return el.checkVisibility && !el.checkVisibility({ visibilityProperty: true });
  };
  const destinoLink = (el) => {
    const u = new URL(el.href, location.href);
    u.searchParams.delete('v');
    if (/^(wa\.me|api\.whatsapp\.com)$/.test(u.hostname)) return 'whatsapp:' + (u.pathname + (u.searchParams.get('phone') || '')).replace(/\D/g, '');
    u.pathname = u.pathname.replace(/\/index\.html$/, '/');
    return u.href;
  };
  const destinoBotao = (el) => {
    const partes = [];
    for (const a of el.attributes) {
      if (a.name === 'aria-controls' || a.name === 'value' || a.name === 'formaction' || a.name.startsWith('data-')) partes.push(`${a.name}=${a.value}`);
    }
    return 'botão[' + partes.sort().join(' ') + ']';
  };
  const mapa = new Map();
  for (const el of document.querySelectorAll(SEL)) {
    if (foraDaArvore(el)) continue;
    const nome = axe.commons.text.accessibleText(el).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!nome) continue; // nome vazio já é violação do axe (link-name/button-name)
    const ehLink = el.matches('a[href], [role=link]') && el.href;
    const destino = ehLink ? destinoLink(el) : destinoBotao(el);
    if (!mapa.has(nome)) mapa.set(nome, new Set());
    mapa.get(nome).add(destino);
  }
  axe.teardown();
  const repetidos = {};
  for (const [nome, destinos] of mapa) if (destinos.size > 1) repetidos[nome] = [...destinos];
  return { total: mapa.size, repetidos };
}

async function conferir(p, rotulo, { silencioso = false } = {}) {
  if (!(await p.evaluate(() => typeof axe !== 'undefined'))) await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const r = await p.evaluate(coletar);
  conferidos += r.total;
  const lista = Object.entries(r.repetidos).map(([n, d]) => `"${n}" → ${d.join(' | ')}`);
  if (!silencioso) ok(lista.length === 0, `${rotulo}: ${r.total} nomes, nenhum repetido com destino diferente` + (lista.length ? '\n      → ' + lista.join('\n      → ') : ''));
  return r;
}

async function novaPagina(browser, largura, nome) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 800 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.route('**/config.js*', (r) => r.fulfill({ body: configTeste, contentType: 'application/javascript' }));
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  await p.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', (r) => r.fulfill({
    path: require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'application/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  if (nome === '404') {
    const html404 = fs.readFileSync(RAIZ + '/404.html', 'utf8');
    await p.route('**/empresa-jp/uma/pagina/**', (r) => r.fulfill({ status: 404, body: html404, contentType: 'text/html; charset=utf-8' }));
    await p.route('**/empresa-jp/**', (r) => {
      const u = new URL(r.request().url());
      const arquivo = path.join(RAIZ, decodeURIComponent(u.pathname.replace(/^\/empresa-jp\//, '')));
      if (fs.existsSync(arquivo) && fs.statSync(arquivo).isFile()) return r.fulfill({ path: arquivo });
      return r.fallback();
    });
  }
  return p;
}
const consoleLimpo = (p, nome, rotulo) => ok(p.erros.filter((e) => !(nome === '404' && /status of 404/.test(e))).length === 0, `${rotulo}: console limpo ${p.erros.join(' | ')}`);

(async () => {
  // Dados de teste para o painel ter itens nas listas (vários pedidos/conversas = vários botões parecidos)
  psql(`truncate public.mensagens, public.conversas, public.pedidos cascade; delete from realtime.enviados;`);
  const hash = (n) => n.repeat(64).slice(0, 64);
  psql(`
    insert into public.conversas (visitante_id, token_hash, nome, whatsapp, pagina_origem, status) values
      (gen_random_uuid(), '${hash('a')}', 'Joana Teste', '11999990000', '/', 'aberta'),
      (gen_random_uuid(), '${hash('b')}', 'Carlos Teste', '21977776666', '/planos.html', 'aberta');
    insert into public.mensagens (conversa_id, autor, texto) select id, 'visitante', 'Olá, quero um site.' from public.conversas;
    insert into public.pedidos (codigo, token_hash, plano_id, plano_nome, valor_centavos, nome, email, whatsapp, aceite_termos_em, status, criado_em, pago_em) values
      ('PBR-AAAAA2', '${hash('c')}', 'profissional', 'Profissional', 99700, 'Ana Teste', 'ana@teste.local', '11911112222', now(), 'aprovado', now() - interval '3 days', now() - interval '3 days'),
      ('PBR-BBBBB3', '${hash('d')}', 'essencial', 'Essencial', 49700, 'Bruno Teste', 'bruno@teste.local', '11933334444', now(), 'pendente', now() - interval '1 hour', null),
      ('PBR-CCCCC4', '${hash('e')}', 'premium', 'Premium', 149700, 'Carla Teste', 'carla@teste.local', '11955556666', now(), 'aprovado', now() - interval '2 days', now() - interval '2 days');
    insert into public.briefings (pedido_id, nome_negocio) select id, 'Negócio de ' || nome from public.pedidos where status = 'aprovado';
  `);
  const browser = await chromium.launch();

  console.log('\n[1] Páginas como carregam (320 e 1280 px; no celular também com o menu aberto)');
  for (const [nome, caminho] of PAGINAS) {
    for (const w of LARGURAS) {
      const p = await novaPagina(browser, w, nome);
      await p.goto(SITE + caminho, { waitUntil: 'networkidle' });
      await conferir(p, `${nome} @${w}`);
      if (await p.isVisible('[data-menu-botao]').catch(() => false)) {
        await p.click('[data-menu-botao]');
        await conferir(p, `${nome} @${w} menu aberto`);
      }
      consoleLimpo(p, nome, `${nome} @${w}`);
      await p.context().close();
    }
  }

  console.log('\n[2] Estados montados pelo JS');
  for (const w of LARGURAS) {
    // chat aberto
    let p = await novaPagina(browser, w, 'home');
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await p.focus('.chat__lancador');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
    await conferir(p, `home @${w} chat aberto`);
    // simulador respondido (primeira opção de cada pergunta)
    const perguntas = await p.$$eval('[data-simulador] input[type=radio]', (rs) => [...new Set(rs.map((r) => r.name))]);
    for (const n of perguntas) await p.check(`[data-simulador] input[name="${n}"] >> nth=0`);
    await p.waitForTimeout(200);
    await conferir(p, `home @${w} simulador respondido (${perguntas.length} perguntas)`);
    consoleLimpo(p, 'home', `home @${w} estados`);
    await p.context().close();

    // planos com plano escolhido e comparativo (abas no celular)
    p = await novaPagina(browser, w, 'planos');
    await p.goto(SITE + 'planos.html?plano=profissional', { waitUntil: 'networkidle' });
    await conferir(p, `planos @${w} com plano escolhido`);
    const abas = await p.$$('.comparativo__aba');
    if (abas.length > 1 && (await abas[1].isVisible())) {
      await abas[1].click();
      await conferir(p, `planos @${w} comparativo na 2ª aba`);
    }
    consoleLimpo(p, 'planos', `planos @${w} estados`);
    await p.context().close();
  }

  console.log('\n[3] Painel com dados (conversas, pedido aberto, briefing aberto, resumo)');
  for (const w of LARGURAS) {
    const a = await novaPagina(browser, w, 'admin');
    await a.goto(SITE + 'admin/', { waitUntil: 'networkidle' });
    await a.fill('#login-email', 'dono@teste.local');
    await a.fill('#login-senha', 'senha-de-teste');
    await a.click('[data-form-login] button[type=submit]');
    await a.waitForSelector('[data-tela="painel"]:not([hidden])');
    await a.waitForSelector('[data-lista-conversas] .admin-item');
    await conferir(a, `painel conversas @${w}`);
    await a.click('[data-lista-conversas] .admin-item:has-text("Joana")');
    await a.waitForTimeout(300);
    await conferir(a, `painel conversa aberta @${w}`);
    await a.click('[data-aba-link="pedidos"]');
    await a.waitForSelector('[data-lista-pedidos] .admin-item');
    await conferir(a, `painel pedidos @${w}`);
    await a.click('[data-lista-pedidos] .admin-item:has-text("PBR-AAAAA2")');
    await a.waitForSelector('[data-checklist]:not([hidden])');
    await conferir(a, `painel pedido aberto @${w}`);
    await a.click('[data-aba-link="briefings"]');
    await a.waitForSelector('[data-lista-briefings] .admin-item');
    await conferir(a, `painel briefings @${w}`);
    await a.click('[data-lista-briefings] .admin-item >> nth=0');
    await a.waitForTimeout(300);
    await conferir(a, `painel briefing aberto @${w}`);
    await a.click('[data-aba-link="resumo"]');
    await a.waitForTimeout(300);
    await conferir(a, `painel resumo @${w}`);
    consoleLimpo(a, 'admin', `painel @${w}`);
    await a.context().close();
  }

  console.log('\n[4] Controle: o teste acusa nomes iguais com destinos diferentes');
  {
    const p = await novaPagina(browser, 320, 'termos');
    await p.goto(SITE + 'termos.html', { waitUntil: 'networkidle' });
    await p.evaluate(() => {
      const caixa = document.createElement('div');
      caixa.innerHTML = '<a href="planos.html">Saiba mais</a> <a href="exemplos.html">Saiba mais</a>'
        + '<a href="blog/">Leia</a> <a href="blog/index.html">Leia</a>'
        + '<a href="portfolio.html">Veja<span class="visualmente-oculto"> o portfólio</span></a> <a href="exemplos.html">Veja<span class="visualmente-oculto"> os exemplos</span></a>'
        + '<button type="button" data-x="1">Abrir</button><button type="button" data-x="2">Abrir</button>'
        + '<div aria-hidden="true"><a href="termos.html">Ver</a></div><a href="privacidade.html">Ver</a>';
      document.querySelector('main').prepend(caixa);
    });
    const r = await conferir(p, 'controle', { silencioso: true });
    const nomes = Object.keys(r.repetidos);
    ok(nomes.includes('saiba mais'), 'dois "Saiba mais" para páginas diferentes são acusados');
    ok(nomes.includes('abrir'), 'dois botões "Abrir" que controlam coisas diferentes são acusados');
    ok(!nomes.includes('leia'), '"blog/" e "blog/index.html" contam como o mesmo destino');
    ok(!nomes.some((n) => n.startsWith('veja')), 'complemento visualmente-oculto diferencia os nomes');
    ok(!nomes.includes('ver'), 'link dentro de aria-hidden fica de fora');
    await p.context().close();
  }

  await browser.close();
  console.log(`\n${conferidos} nomes conferidos`);
  console.log(falhas ? `${falhas} FALHA(S)` : 'NOMES DE LINKS OK: nenhum nome igual com destino diferente (WCAG 2.4.4/2.4.9)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
