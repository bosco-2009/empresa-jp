// Uso: veja testes/README.md (precisa só do servidor estático em :8080)
// Comparativo de planos para leitor de tela (melhoria 92): lê a árvore de acessibilidade do Chromium e confere
// <caption>, cabeçalho de cada coluna e de cada linha, o nome acessível de cada célula ("Incluído"/"Não incluído"
// ou o texto) e as abas do celular navegadas só pelo teclado (Tab, setas, Home/End, Enter).
const { chromium } = require('playwright');

const BASE = process.env.SITE || 'http://localhost:8080/';
const SITE = new URL('planos.html', BASE).href;
let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, largura) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 800 } });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.goto(SITE, { waitUntil: 'networkidle' });
  return p;
}

// Árvore de acessibilidade (CDP) de um elemento: papel, nome e filhos
async function arvore(p, seletor) {
  const cdp = await p.context().newCDPSession(p);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: seletor });
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  const { nodes: todos } = await cdp.send('Accessibility.getFullAXTree');
  const porId = new Map(todos.map((n) => [n.nodeId, n]));
  // Nós ignorados (ex.: rowgroup sem semântica) somem, mas os filhos sobem; espaços antes da vírgula
  // (fronteira entre <span>s em bloco) não mudam o que o leitor de tela fala
  const filhos = (n) => (n.childIds || []).map((id) => porId.get(id)).filter(Boolean)
    .flatMap((f) => (f.ignored ? filhos(f) : [f]));
  const no = (n) => ({
    papel: n.role && n.role.value,
    nome: ((n.name && n.name.value) || '').replace(/\s+/g, ' ').replace(/ ,/g, ',').trim(),
    filhos: filhos(n).map(no),
  });
  return no(porId.get(nodes[0].nodeId) || nodes[0]);
}
function achar(n, papel, saida = []) {
  if (n.papel === papel) saida.push(n);
  n.filhos.forEach((f) => achar(f, papel, saida));
  return saida;
}

(async () => {
  const browser = await chromium.launch();
  const cfg = await (async () => {
    const p = await abrir(browser, 1280);
    const c = await p.evaluate(() => ({
      planos: PBR_CONFIG.planos.map((x) => ({ id: x.id, nome: x.nome, selo: x.destaque ? x.selo || '' : '' })),
      linhas: PBR_CONFIG.comparativo,
    }));
    await p.context().close();
    return c;
  })();
  const esperado = (v) => (v === true ? 'Incluído' : v === false || v == null ? 'Não incluído' : String(v));

  console.log('\n[1] Tabela pela árvore de acessibilidade (1280 px)');
  {
    const p = await abrir(browser, 1280);
    await p.locator('.tabela-comparativa').scrollIntoViewIfNeeded();
    const t = await arvore(p, '.tabela-comparativa');
    ok(t.papel === 'table' && /Comparativo dos planos/.test(t.nome), 'tabela com nome vindo do <caption>: "' + t.nome + '"');
    const cols = achar(t, 'columnheader').map((c) => c.nome);
    const nomesCol = cfg.planos.map((x) => x.nome + (x.selo ? ', ' + x.selo : ''));
    ok(cols.length === cfg.planos.length + 1 && cols[0] === 'Recurso', 'coluna dos recursos com cabeçalho "Recurso"');
    ok(JSON.stringify(cols.slice(1)) === JSON.stringify(nomesCol), 'cabeçalhos dos planos com o nome primeiro: ' + cols.slice(1).join(' | '));
    const linhas = achar(t, 'row').slice(1);
    const rotulos = linhas.map((l) => (achar(l, 'rowheader')[0] || { nome: '' }).nome);
    ok(rotulos.every(Boolean), 'toda linha tem cabeçalho de linha (' + rotulos.length + ', inclusive "' + rotulos[rotulos.length - 1] + '")');
    ok(rotulos[rotulos.length - 1] === 'Contratar', 'linha dos botões com cabeçalho "Contratar"');
    // Linhas do config: nome acessível de cada célula = valor esperado
    let certas = 0;
    let total = 0;
    const erradas = [];
    cfg.linhas.forEach((l) => {
      const linha = linhas[rotulos.indexOf(l.recurso)];
      if (!linha) { erradas.push('sem linha: ' + l.recurso); return; }
      const celulas = achar(linha, 'cell');
      cfg.planos.forEach((pl, i) => {
        total++;
        const nome = celulas[i] && celulas[i].nome;
        if (nome === esperado(l.valores[pl.id])) certas++; else erradas.push(`${l.recurso}/${pl.nome}: "${nome}"`);
      });
    });
    ok(certas === total, `${certas}/${total} células com o nome acessível certo` + (erradas.length ? ' → ' + erradas.slice(0, 4).join('; ') : ''));
    const precos = achar(linhas[0], 'cell').map((c) => c.nome);
    ok(precos.length === cfg.planos.length && precos.every((x) => /R\$/.test(x)), 'linha do preço lida com valor: ' + precos.join(' | '));
    const botoes = achar(linhas[linhas.length - 1], 'button').map((b) => b.nome);
    ok(JSON.stringify(botoes) === JSON.stringify(cfg.planos.map((x) => 'Escolher o ' + x.nome)), 'botões com nome do plano: ' + botoes.join(' | '));
    const cabecalhosDom = await p.evaluate(() => {
      const tb = document.querySelector('.tabela-comparativa');
      return [...tb.querySelectorAll('th')].every((th) => th.scope === 'col' || th.scope === 'row') && !tb.querySelector('td:empty');
    });
    ok(cabecalhosDom, 'todo <th> com scope e nenhuma célula vazia');
    const seloVisivel = await p.locator('.tabela-comparativa .tabela-comparativa__selo').first().isVisible();
    ok(!cfg.planos.some((x) => x.selo) || seloVisivel, 'selo continua visível para quem enxerga');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  console.log('\n[2] Abas do celular só pelo teclado (375 px)');
  {
    const p = await abrir(browser, 375);
    // Tab a partir do link "Compare" do formulário... ou do elemento antes da seção: foca o título e segue com Tab
    await p.evaluate(() => { const h = document.querySelector('#comparativo'); h.focus(); });
    let chegou = false;
    for (let i = 0; i < 10 && !chegou; i++) {
      await p.keyboard.press('Tab');
      chegou = await p.evaluate(() => document.activeElement.getAttribute('role') === 'tab');
    }
    ok(chegou, 'Tab entra na lista de abas');
    ok(await p.evaluate(() => document.activeElement.getAttribute('aria-selected') === 'true'), 'o Tab cai na aba selecionada (tabindex móvel)');
    const lista = await arvore(p, '[role="tablist"]');
    ok(lista.papel === 'tablist' && lista.nome === 'Planos', 'tablist com nome "Planos"');
    ok(JSON.stringify(achar(lista, 'tab').map((a) => a.nome)) === JSON.stringify(cfg.planos.map((x) => x.nome)), 'abas com o nome de cada plano');
    const ativa = () => p.evaluate(() => [...document.querySelectorAll('[role="tab"]')].findIndex((a) => a.getAttribute('aria-selected') === 'true'));
    const focoNaAtiva = () => p.evaluate(() => document.activeElement.getAttribute('aria-selected') === 'true');
    await p.keyboard.press('Home');
    ok(await ativa() === 0 && await focoNaAtiva(), 'Home → primeira aba');
    await p.keyboard.press('ArrowRight');
    ok(await ativa() === 1 && await focoNaAtiva(), 'seta → segunda aba');
    await p.keyboard.press('End');
    ok(await ativa() === cfg.planos.length - 1 && await focoNaAtiva(), 'End → última aba');
    await p.keyboard.press('ArrowLeft');
    ok(await ativa() === cfg.planos.length - 2, 'seta ← volta uma aba');
    await p.keyboard.press('Alt+ArrowLeft');
    ok(await ativa() === cfg.planos.length - 2, 'Alt+seta fica para o navegador (aba não muda)');
    const idx = await ativa();
    await p.keyboard.press('Tab');
    ok(await p.evaluate(() => document.activeElement.getAttribute('role') === 'tabpanel' && !document.activeElement.hidden), 'Tab sai das abas para o painel visível');
    const painel = await arvore(p, '.comparativo__painel:not([hidden])');
    ok(painel.papel === 'tabpanel' && painel.nome === cfg.planos[idx].nome, 'painel nomeado pela aba: "' + painel.nome + '"');
    const itens = achar(painel, 'listitem').map((li) => li.nome || '');
    const textos = await p.evaluate(() => [...document.querySelectorAll('.comparativo__painel:not([hidden]) .comparativo__item')].map((li) => li.textContent));
    const pl = cfg.planos[idx];
    const confere = cfg.linhas.every((l) => textos.includes(l.recurso + ': ' + esperado(l.valores[pl.id])));
    ok(confere, 'cada item lido como "recurso: valor" (ex.: "' + textos[textos.length - 1] + '")');
    ok(itens.length === cfg.linhas.length + 2, `${itens.length} itens na lista do painel`);
    await p.keyboard.press('Tab');
    ok(await p.evaluate(() => document.activeElement.matches('[data-escolher-plano]')), 'Tab chega ao "Escolher" do painel');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(700);
    ok(await p.evaluate((id) => { const r = document.querySelector('input[name="plano"]:checked'); return r && r.value === id && document.activeElement === r; }, pl.id), 'Enter marca o plano e leva o foco até ele');
    ok(p.erros.length === 0, 'console limpo' + (p.erros.length ? ': ' + p.erros.join(' | ') : ''));
    await p.context().close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DO COMPARATIVO (LEITOR DE TELA) PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
