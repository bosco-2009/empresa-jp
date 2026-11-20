/*
 * admin-notas.js — notas internas do dono em cada conversa e em cada pedido (melhoria 27).
 *
 *   PBRNotas.iniciar(clienteSupabase)   -> depois do login de admin (admin.js)
 *   PBRNotas.abrir('conversa' | 'pedido', id)
 *   PBRNotas.encerrar()                 -> ao sair
 *
 * Leitura: tabela public.notas (RLS só admin). Gravação: RPC nota_salvar, que recusa a gravação
 * se outra aba/aparelho mudou a nota desde que ela foi carregada ("nota_alterada"); aí o dono
 * escolhe manter a própria versão ou carregar a salva. Salva sozinho 1,2 s depois de parar de digitar
 * e ao sair do campo. Estado em role="status"; erros em role="alert", com o texto preservado no campo.
 */
(function () {
  'use strict';

  var ESPERA_MS = 1200;
  var MAX = 5000;
  var fData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  var sb = null;
  var instancias = {};

  function preparar(tipo) {
    var raiz = document.querySelector('[data-notas="' + tipo + '"]');
    if (!raiz) return null;
    var inst = {
      tipo: tipo,
      raiz: raiz,
      campo: raiz.querySelector('[data-notas-texto]'),
      estadoEl: raiz.querySelector('[data-notas-estado]'),
      selo: raiz.querySelector('[data-notas-selo]'),
      problema: raiz.querySelector('[data-notas-problema]'),
      erro: raiz.querySelector('[data-notas-erro]'),
      botoes: {},
      alvo: null,        // id da conversa/pedido aberto
      carimbo: null,     // atualizado_em que o servidor devolveu (texto exato, para comparar no banco)
      salvo: '',         // último texto confirmado pelo servidor
      carregado: false,
      timer: null,
      salvando: false,
      repetir: false,
      conflito: false,   // outra aba mudou a nota: só os botões decidem (nada salva sozinho)
      geracao: 0         // muda a cada carga; respostas de gravações antigas são ignoradas
    };
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-notas-acao]'), function (b) {
      inst.botoes[b.getAttribute('data-notas-acao')] = b;
    });

    inst.campo.addEventListener('input', function () {
      if (!inst.carregado || inst.conflito) return;
      limparProblema(inst);
      estado(inst, inst.campo.value === inst.salvo ? textoSalvo(inst) : 'Alterações ainda não salvas…');
      clearTimeout(inst.timer);
      inst.timer = setTimeout(function () { salvar(inst, false); }, ESPERA_MS);
    });
    inst.campo.addEventListener('blur', function () {
      if (inst.carregado && !inst.conflito && inst.campo.value !== inst.salvo) { clearTimeout(inst.timer); salvar(inst, false); }
    });
    inst.botoes.tentar.addEventListener('click', function () {
      if (inst.carregado) salvar(inst, false); else carregar(inst);
    });
    inst.botoes.manter.addEventListener('click', function () { salvar(inst, true); });
    inst.botoes.recarregar.addEventListener('click', function () { carregar(inst); inst.campo.focus(); });
    return inst;
  }

  function estado(inst, texto) { inst.estadoEl.textContent = texto; }
  function textoSalvo(inst) {
    if (!inst.carimbo) return 'Nenhuma nota ainda. Ela é salva sozinha enquanto você escreve.';
    return 'Salva · última edição em ' + fData.format(new Date(inst.carimbo));
  }
  function atualizarSelo(inst) { inst.selo.hidden = !inst.salvo.trim(); }

  function limparProblema(inst) {
    inst.problema.hidden = true;
    inst.erro.textContent = '';
    Object.keys(inst.botoes).forEach(function (k) { inst.botoes[k].hidden = true; });
  }
  function mostrarProblema(inst, texto, acoes) {
    inst.erro.textContent = texto;
    acoes.forEach(function (k) { inst.botoes[k].hidden = false; });
    inst.problema.hidden = false;
    inst.raiz.open = true;
  }

  function coluna(tipo) { return tipo === 'pedido' ? 'pedido_id' : 'conversa_id'; }
  function sujo(inst) { return inst.carregado && (inst.campo.value !== inst.salvo || inst.salvando); }

  function carregar(inst) {
    var id = inst.alvo;
    var geracao = ++inst.geracao;
    clearTimeout(inst.timer);
    inst.carregado = false;
    inst.repetir = false;
    inst.conflito = false;
    inst.salvando = false;
    inst.campo.readOnly = true;
    limparProblema(inst);
    estado(inst, 'Carregando a nota…');
    return sb.from('notas').select('texto, atualizado_em').eq(coluna(inst.tipo), id).maybeSingle()
      .then(function (r) {
        if (r.error) throw r.error;
        if (inst.geracao !== geracao) return;
        var n = r.data;
        inst.salvo = (n && n.texto) || '';
        inst.carimbo = (n && n.atualizado_em) || null;
        inst.campo.value = inst.salvo;
        inst.campo.readOnly = false;
        inst.carregado = true;
        inst.raiz.open = !!inst.salvo.trim();
        atualizarSelo(inst);
        estado(inst, textoSalvo(inst));
      })
      .catch(function () {
        if (inst.geracao !== geracao) return;
        estado(inst, '');
        mostrarProblema(inst, 'Não foi possível carregar a nota. Verifique a conexão.', ['tentar']);
      });
  }

  function salvar(inst, forcar) {
    if (!inst.carregado || !inst.alvo) return;
    clearTimeout(inst.timer);
    if (inst.salvando) { inst.repetir = true; return; }
    var texto = inst.campo.value;
    if (texto === inst.salvo && !forcar) { if (!inst.conflito) estado(inst, textoSalvo(inst)); return; }
    if (texto.length > MAX) {
      mostrarProblema(inst, 'A nota passou de 5.000 caracteres. Encurte o texto para salvar.', []);
      return;
    }
    var id = inst.alvo;
    var geracao = inst.geracao;
    inst.salvando = true;
    limparProblema(inst);
    estado(inst, 'Salvando…');
    sb.rpc('nota_salvar', {
      p_conversa_id: inst.tipo === 'conversa' ? id : null,
      p_pedido_id: inst.tipo === 'pedido' ? id : null,
      p_texto: texto,
      p_esperado: inst.carimbo,
      p_forcar: !!forcar
    }).then(function (r) {
      if (r.error) throw r.error;
      if (inst.geracao !== geracao) return;
      inst.conflito = false;
      inst.carimbo = r.data;
      inst.salvo = texto;
      atualizarSelo(inst);
      estado(inst, inst.campo.value === texto ? textoSalvo(inst) : 'Alterações ainda não salvas…');
    }).catch(function (e) {
      if (inst.geracao !== geracao) return;
      inst.repetir = false;
      if (e && /nota_alterada/.test(e.message || '')) {
        inst.conflito = true;
        estado(inst, 'Não salva.');
        mostrarProblema(inst, 'Esta nota foi alterada em outra aba ou aparelho depois que você abriu. ' +
          'Escolha manter a sua versão (substitui a outra) ou carregar a versão salva (descarta o que você escreveu aqui).',
          ['manter', 'recarregar']);
      } else {
        estado(inst, 'Não salva.');
        mostrarProblema(inst, 'Não foi possível salvar a nota. O texto continua aqui; tente de novo.', ['tentar']);
      }
    }).then(function () {
      if (inst.geracao !== geracao) return;
      inst.salvando = false;
      if (inst.repetir) { inst.repetir = false; salvar(inst, false); }
    });
  }

  function abrir(tipo, id) {
    var inst = instancias[tipo];
    if (!inst || !sb || !id) return;
    if (inst.alvo === id && inst.carregado) return;
    // Trocou de conversa/pedido com algo por salvar: grava a nota anterior antes de trocar.
    if (inst.alvo && inst.carregado && inst.campo.value !== inst.salvo && !inst.salvando) salvar(inst, false);
    inst.alvo = id;
    inst.carimbo = null;
    inst.salvo = '';
    inst.campo.value = '';
    inst.selo.hidden = true;
    carregar(inst);
  }

  function iniciar(cliente) {
    sb = cliente;
    ['conversa', 'pedido'].forEach(function (t) { if (!instancias[t]) instancias[t] = preparar(t); });
  }

  function encerrar() {
    Object.keys(instancias).forEach(function (t) {
      var inst = instancias[t];
      if (!inst) return;
      clearTimeout(inst.timer);
      inst.geracao++;
      inst.alvo = null;
      inst.carregado = false;
      inst.campo.value = '';
      inst.salvo = '';
      inst.carimbo = null;
      limparProblema(inst);
      estado(inst, '');
    });
    sb = null;
  }

  // Avisa antes de fechar a página com nota ainda não salva.
  window.addEventListener('beforeunload', function (e) {
    var pendente = Object.keys(instancias).some(function (t) { return instancias[t] && sujo(instancias[t]); });
    if (pendente) { e.preventDefault(); e.returnValue = ''; }
  });

  window.PBRNotas = { iniciar: iniciar, abrir: abrir, encerrar: encerrar };
})();
