/*
 * admin-avisos.js — avisos do painel (/admin/), melhoria 8.
 *   - contador de mensagens não lidas no título da aba ("(3) Painel — Portfólio BR") e no favicon (selo desenhado
 *     num <canvas>; a CSP permite img-src data:);
 *   - notificações do navegador (com permissão, opcionais, desligáveis) para conversa nova, pedido pago e briefing novo,
 *     só quando o painel não está à vista. Clicar na notificação traz o painel para frente e abre o item.
 * Sem service worker (worker-src 'none'): onde o navegador exige um (ex.: Chrome no Android), o botão nem aparece.
 * O som continua no admin.js (botão de som). Uso pelos outros módulos: window.PBRAdminAvisos.
 */
(function () {
  'use strict';
  var CHAVE = 'pbr_admin_notificacoes';
  var TITULO = document.title;
  var naoLidas = 0;

  // ------------------------------------------------------------ título e favicon
  var links = Array.prototype.slice.call(document.querySelectorAll('link[rel~="icon"]')).map(function (l) {
    return { el: l, href: l.getAttribute('href'), type: l.getAttribute('type') };
  });
  var logo = null;
  var logoPronto = false;
  function carregarLogo(pronto) {
    if (logo) { if (logoPronto) pronto(); return; }
    logo = new Image();
    logo.onload = function () { logoPronto = true; pronto(); };
    logo.src = new URL('../assets/img/favicon.svg', location.href).href;
  }
  function cor(nome, reserva) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    return v || reserva;
  }
  function desenharFavicon(n) {
    if (!links.length) return;
    if (!n) {
      links.forEach(function (l) {
        l.el.setAttribute('href', l.href);
        if (l.type) l.el.setAttribute('type', l.type); else l.el.removeAttribute('type');
      });
      return;
    }
    carregarLogo(function () {
      if (naoLidas !== n) return; // mudou enquanto carregava
      var c = document.createElement('canvas');
      c.width = c.height = 64;
      var g = c.getContext('2d');
      if (!g) return;
      g.drawImage(logo, 0, 0, 64, 64);
      g.beginPath();
      g.arc(44, 20, 19, 0, 2 * Math.PI);
      g.fillStyle = cor('--cor-erro', '#b42318');
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = cor('--cor-branco', '#ffffff');
      g.stroke();
      g.fillStyle = cor('--cor-branco', '#ffffff');
      g.font = 'bold ' + (n > 9 ? 20 : 26) + 'px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(n > 9 ? '9+' : String(n), 44, 21);
      var url = c.toDataURL('image/png');
      links.forEach(function (l) {
        l.el.setAttribute('href', url);
        l.el.setAttribute('type', 'image/png');
      });
    });
  }
  function tituloBase() { return (naoLidas ? '(' + naoLidas + ') ' : '') + TITULO; }
  var aoMudarBase = null;
  function definirNaoLidas(n) {
    n = Math.max(0, Number(n) || 0);
    if (n === naoLidas) return;
    naoLidas = n;
    desenharFavicon(n);
    if (aoMudarBase) aoMudarBase(tituloBase()); else document.title = tituloBase();
  }

  // ------------------------------------------------------------ notificações do navegador
  var suportado = 'Notification' in window && typeof window.Notification === 'function';
  var ligadas = false;
  try { ligadas = localStorage.getItem(CHAVE) === 'on'; } catch (e) { /* ignora */ }
  var botao = document.querySelector('[data-botao-notificar]');

  function permitido() { return suportado && Notification.permission === 'granted'; }
  function atualizarBotao() {
    if (!botao) return;
    if (!suportado) { botao.hidden = true; return; }
    botao.hidden = false;
    var ativo = ligadas && permitido();
    var negado = Notification.permission === 'denied';
    botao.setAttribute('aria-pressed', String(ativo));
    botao.querySelector('use').setAttribute('href', ativo ? '#i-sino' : '#i-sino-mudo');
    botao.title = negado ? 'Notificações bloqueadas nas configurações do navegador'
      : ativo ? 'Notificações ligadas' : 'Notificações desligadas';
    var dica = botao.querySelector('[data-notificar-dica]');
    if (dica) dica.textContent = negado ? ' (bloqueadas no navegador)' : '';
  }
  function salvar() { try { localStorage.setItem(CHAVE, ligadas ? 'on' : 'off'); } catch (e) { /* ignora */ } }

  if (botao) {
    botao.addEventListener('click', function () {
      if (!suportado) return;
      if (Notification.permission === 'denied') { atualizarBotao(); return; }
      if (ligadas && permitido()) { ligadas = false; salvar(); atualizarBotao(); return; }
      var pedir = Notification.permission === 'granted' ? Promise.resolve('granted') : Promise.resolve(Notification.requestPermission());
      pedir.then(function (p) {
        ligadas = p === 'granted';
        salvar();
        atualizarBotao();
      }).catch(function () { atualizarBotao(); });
    });
  }
  // Teste rápido de suporte: onde new Notification() exige service worker, esconde o botão.
  if (suportado && Notification.permission === 'granted') {
    try { new Notification('', { silent: true, tag: 'pbr-teste' }).close(); } catch (e) { suportado = false; }
  }
  atualizarBotao();

  function atento() { return !document.hidden && document.hasFocus(); }

  // { titulo, corpo, tag, aoClicar } — só quando ligado, permitido e o painel não está à vista
  function notificar(o) {
    if (!ligadas || !permitido() || atento()) return null;
    try {
      var n = new Notification(o.titulo, {
        body: (o.corpo || '').slice(0, 140),
        tag: o.tag,
        icon: new URL('../assets/img/icon-192.png', location.href).href
      });
      n.onclick = function () {
        window.focus();
        if (o.aoClicar) o.aoClicar();
        n.close();
      };
      return n;
    } catch (e) {
      return null;
    }
  }

  window.PBRAdminAvisos = {
    definirNaoLidas: definirNaoLidas,
    tituloBase: tituloBase,
    aoMudarTitulo: function (fn) { aoMudarBase = fn; },
    notificar: notificar
  };
})();
