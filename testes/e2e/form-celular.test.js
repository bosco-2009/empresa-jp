// Uso: veja testes/README.md (só precisa do servidor estático: python3 -m http.server 8080 na raiz)
// Melhoria 46: formulário de contratação mais rápido no celular.
// Atributos de preenchimento automático e teclado, máscara leve do WhatsApp (digitar, apagar, colar, DDI),
// validação ao sair do campo (nada enquanto digita), erro lido pelo leitor de tela (aria-describedby,
// conferido na árvore de acessibilidade do Chromium) e axe/rolagem/console em 4 larguras.
const { chromium } = require('playwright');
const fs = require('fs');

const SITE = process.env.SITE || 'http://localhost:8080/';
const AXE = require.resolve('axe-core/axe.min.js');
const SAIDA = __dirname + '/saida';
fs.mkdirSync(SAIDA, { recursive: true });

let falhas = 0;
function ok(cond, msg) { if (cond) console.log('  ✔ ' + msg); else { falhas++; console.log('  ✘ ' + msg); } }

async function abrir(browser, opcoes) {
  const ctx = await browser.newContext(opcoes);
  await ctx.addInitScript(() => { try { sessionStorage.setItem('pbr_abertura_vista', '1'); } catch (e) { /* */ } });
  const p = await ctx.newPage();
  await p.route('**/__axe.min.js', (r) => r.fulfill({ path: AXE, contentType: 'application/javascript' }));
  p.erros = [];
  p.on('console', (m) => { if (m.type() === 'error') p.erros.push(m.text()); });
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  await p.goto(SITE + 'planos.html', { waitUntil: 'networkidle' });
  return p;
}
async function axe(p, rotulo) {
  await p.addScriptTag({ url: new URL('/__axe.min.js', p.url()).href });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
    .violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `axe sem violações sérias (${rotulo})` + (v.length ? ' -> ' + v.join('; ') : ''));
}
const valor = (p, s) => p.$eval(s, (e) => e.value);
const erroVisivel = (p, k) => p.$eval('#checkout-' + k + '-erro', (e) => !e.hidden && e.textContent.trim().length > 0);
const invalido = (p, k) => p.$eval('#checkout-' + k, (e) => e.getAttribute('aria-invalid') === 'true');

// Descrição acessível calculada pelo próprio Chromium (o que o leitor de tela anuncia)
async function descricao(p, seletor) {
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: seletor });
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  await cdp.detach();
  const n = nodes[0] || {};
  return { nome: (n.name && n.name.value) || '', descricao: (n.description && n.description.value) || '',
    invalido: (n.properties || []).some((x) => x.name === 'invalid' && x.value.value !== 'false') };
}

(async () => {
  const browser = await chromium.launch();

  console.log('Atributos de teclado e preenchimento automático');
  {
    const p = await abrir(browser, { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const attrs = await p.evaluate(() => ['nome', 'email', 'whatsapp'].map((k) => {
      const e = document.getElementById('checkout-' + k);
      return { k, type: e.type, ac: e.getAttribute('autocomplete'), im: e.getAttribute('inputmode'), ek: e.getAttribute('enterkeyhint'),
        cap: e.getAttribute('autocapitalize'), sc: e.getAttribute('spellcheck') };
    }));
    const [nome, email, zap] = attrs;
    ok(nome.ac === 'name' && nome.ek === 'next' && nome.cap === 'words' && nome.sc === 'false', 'nome: autocomplete=name, enterkeyhint=next, maiúsculas por palavra, sem corretor');
    ok(email.type === 'email' && email.ac === 'email' && email.im === 'email' && email.ek === 'next' && email.cap === 'none' && email.sc === 'false',
      'e-mail: type/inputmode email, autocomplete=email, sem maiúscula nem corretor');
    ok(zap.type === 'tel' && zap.ac === 'tel-national' && zap.im === 'tel' && zap.ek === 'done', 'WhatsApp: type/inputmode tel, autocomplete=tel-national, enterkeyhint=done');

    console.log('Máscara do WhatsApp');
    const z = '#checkout-whatsapp';
    await p.click(z);
    await p.keyboard.type('11912345678');
    ok(await valor(p, z) === '(11) 91234-5678', 'digitando 11 dígitos → (11) 91234-5678 (' + await valor(p, z) + ')');
    ok(!(await erroVisivel(p, 'whatsapp')), 'nenhuma mensagem enquanto digita');
    for (let i = 0; i < 4; i++) await p.keyboard.press('Backspace');
    ok(await valor(p, z) === '(11) 91234-', 'Backspace apaga um caractere por vez, inclusive o hífen, sem reformatar (' + await valor(p, z) + ')');
    await p.keyboard.press('Backspace');
    ok(await valor(p, z) === '(11) 91234', 'Backspace atravessa o hífen');
    await p.fill(z, '');
    await p.keyboard.type('1133334444');
    ok(await valor(p, z) === '(11) 3333-4444', 'fixo com 10 dígitos → (11) 3333-4444');
    // colar / autopreencher o texto inteiro de uma vez com o cursor no fim
    await p.fill(z, '');
    await p.focus(z);
    await p.keyboard.insertText('21 98765 4321');
    ok(await valor(p, z) === '(21) 98765-4321', 'colar "21 98765 4321" → (21) 98765-4321 (' + await valor(p, z) + ')');
    await p.fill(z, '');
    await p.keyboard.insertText('+55 11 91234-5678');
    ok(await valor(p, z) === '+55 11 91234-5678', 'número com DDI (+55) fica como foi digitado');
    // editar no meio não pula o cursor
    await p.fill(z, '');
    await p.keyboard.type('11912345678');
    await p.$eval(z, (e) => e.setSelectionRange(5, 5));
    await p.keyboard.type('0');
    const cursor = await p.$eval(z, (e) => e.selectionStart);
    ok(cursor === 6, 'digitar no meio mantém o cursor no lugar (posição ' + cursor + ')');
    await p.fill(z, '11912345678');
    await p.$eval(z, (e) => e.blur());
    ok(await valor(p, z) === '(11) 91234-5678', 'autopreenchimento sem formatação é formatado ao sair do campo');
    await p.close();
  }

  console.log('Validação ao sair do campo');
  {
    const p = await abrir(browser, { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    await p.focus('#checkout-nome');
    await p.keyboard.press('Tab');
    await p.keyboard.press('Tab');
    ok(!(await erroVisivel(p, 'nome')) && !(await erroVisivel(p, 'email')), 'passar com Tab por campos vazios não mostra erro');
    await p.click('#checkout-email');
    await p.keyboard.type('joao@');
    ok(!(await erroVisivel(p, 'email')), 'e-mail incompleto: nada enquanto digita');
    await p.keyboard.press('Tab');
    ok(await erroVisivel(p, 'email') && await invalido(p, 'email'), 'ao sair do campo: erro visível e aria-invalid');
    const d = await descricao(p, '#checkout-email');
    ok(d.invalido && d.descricao.includes('Informe um e-mail válido') && d.descricao.includes('comprovante'),
      'leitor de tela: e-mail inválido com dica + erro na descrição (' + d.descricao + ')');
    await p.click('#checkout-email');
    await p.keyboard.type('gmail');
    ok(await erroVisivel(p, 'email'), 'enquanto ainda inválido, o erro continua (sem piscar)');
    await p.keyboard.type('.com');
    ok(!(await erroVisivel(p, 'email')) && !(await invalido(p, 'email')), 'o erro some assim que o valor fica certo');
    const d2 = await descricao(p, '#checkout-email');
    ok(!d2.invalido && !d2.descricao.includes('Informe'), 'leitor de tela: erro sai da descrição');
    await p.click('#checkout-whatsapp');
    await p.keyboard.type('119123');
    await p.keyboard.press('Tab');
    ok(await erroVisivel(p, 'whatsapp'), 'WhatsApp curto: erro ao sair');
    const d3 = await descricao(p, '#checkout-whatsapp');
    ok(d3.descricao.includes('DDD'), 'leitor de tela: erro do WhatsApp na descrição');

    console.log('Envio com campos faltando');
    await p.click('[data-botao-pagar]');
    const foco = await p.evaluate(() => document.activeElement.id);
    // Melhoria 59: o foco vai para o resumo "Corrija N campos", cujo 1º link leva ao primeiro campo com erro
    ok(foco === 'checkout-resumo-erros', 'envio foca o resumo de erros (' + foco + ')');
    ok(await p.$eval('#checkout-resumo-erros a', (a) => a.getAttribute('href')) === '#checkout-nome', '1º link do resumo leva ao primeiro campo com erro');
    ok(await erroVisivel(p, 'nome') && await erroVisivel(p, 'aceite'), 'envio mostra os erros de todos os campos');
    await p.check('#checkout-aceite');
    ok(!(await erroVisivel(p, 'aceite')), 'marcar o aceite tira o erro dele');
    await p.screenshot({ path: SAIDA + '/form-celular-erros-375.png', fullPage: false });
    ok(p.erros.length === 0, 'console sem erros' + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.close();
  }

  console.log('Larguras');
  for (const w of [320, 375, 768, 1280]) {
    const p = await abrir(browser, { viewport: { width: w, height: 900 } });
    await p.click('#checkout-email');
    await p.keyboard.type('x');
    await p.keyboard.press('Tab');
    await p.keyboard.type('1191234');
    await p.keyboard.press('Tab');
    await p.$eval('#checkout-email', (e) => e.scrollIntoView({ block: 'center' }));
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sem rolagem horizontal (${w}px)`);
    await axe(p, w + 'px com erros visíveis');
    await p.screenshot({ path: SAIDA + `/form-celular-${w}.png` });
    ok(p.erros.length === 0, `console sem erros (${w}px)` + (p.erros.length ? ' -> ' + p.erros.join(' | ') : ''));
    await p.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
