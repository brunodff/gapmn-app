'use strict';
/**
 * SILOMS — Nome dos Documentos (página do SILOMS, todas as molduras)
 *
 * Quando a pessoa clica para abrir/baixar um documento numa lista do SILOMS que tem a
 * coluna "Assunto", guarda o assunto daquela linha (e o tipo de documento). O
 * background dá esse nome ao arquivo que o SILOMS mandar em seguida, no lugar de
 * "DOCUMENTO - 1" / "DOCUMENTO ASSINADO 3".
 */
(function () {
  if (window.__silomsNomes) return;
  window.__silomsNomes = true;
  var api = typeof browser !== 'undefined' ? browser : chrome;

  var norm = function (s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  };
  var textoDe = function (el) { return String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim(); };

  // Cabeçalho da tabela da linha: <th> da própria tabela ou a 1ª linha dela.
  // [{ t: 'UG Cred', n: 'ug cred' }, …]
  function cabecalho(tabela, linha) {
    var celulas = Array.prototype.filter.call(tabela.querySelectorAll('th'), function (th) { return th.closest('table') === tabela; });
    if (celulas.length < 2) {
      var primeira = tabela.rows[0];
      if (!primeira || primeira === linha) return null;
      celulas = Array.prototype.slice.call(primeira.cells);
    }
    var cab = celulas.map(function (c) { var t = textoDe(c); return { t: t, n: norm(t) }; });
    // Lista de verdade: pelo menos 3 colunas com nome
    return cab.filter(function (c) { return c.n; }).length >= 3 ? cab : null;
  }

  // Sobe pelas linhas (o GeneXus aninha tabelas) até achar a da lista (com cabeçalho);
  // null = o clique não foi numa linha de lista
  function linhaDaLista(alvo) {
    var tr = alvo.closest && alvo.closest('tr');
    for (var nivel = 0; tr && nivel < 6; nivel++) {
      var tabela = tr.closest('table');
      var cab = tabela ? cabecalho(tabela, tr) : null;
      if (cab && tr.cells.length >= cab.length - 1 && !tr.querySelector('th')) {
        var celula = alvo.closest('td');
        return { tr: tr, cab: cab, col: celula && celula.parentElement === tr ? cab[celula.cellIndex] || null : null, celula: celula };
      }
      tr = tr.parentElement && tr.parentElement.closest('tr');
    }
    return null;
  }

  // Valor da coluna cujo cabeçalho é (ou começa com) um dos nomes
  function valor(l, nomes) {
    for (var i = 0; i < nomes.length; i++) {
      for (var k = 0; k < l.cab.length; k++) {
        var n = l.cab[k].n;
        if ((n === nomes[i] || n.indexOf(nomes[i] + ' ') === 0) && l.tr.cells[k]) {
          var v = textoDe(l.tr.cells[k]);
          if (v) return v;
        }
      }
    }
    return '';
  }

  var limpa = function (s) {
    return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150).replace(/[.\s]+$/, '');
  };
  var generico = function (s) { return /^documento\s*(assinado)?\s*-?\s*\d*$/i.test(String(s).trim()); };

  // Nome do arquivo pela linha clicada; '' = não sei dar nome
  //   lista de documentos  → "Despacho - Encaminhamento ao SEO" (tipo só se o assunto não o diz)
  //   lista de solicitações → "Solicitação de Empenho 26S1599 - GAP-MN" (número + UG Cred)
  //   outras listas         → "<coluna> <número clicado>" ("Nota Fiscal 1770")
  function nomeDaLinha(l) {
    var tipo = valor(l, ['tipo de documento', 'tipo do documento']);
    var tipoUtil = tipo && !/^(outros?|selecione|diversos|-+)$/i.test(tipo) ? tipo : '';
    var comTipo = function (t) { return tipoUtil && norm(t).indexOf(norm(tipoUtil)) < 0 ? tipoUtil + ' - ' + t : t; };

    var assunto = valor(l, ['assunto', 'descricao', 'descricao do documento']);
    if (assunto && !generico(assunto)) return limpa(comTipo(assunto));

    var sol = valor(l, ['solicitacao', 'solicitacao de empenho', 'nr solicitacao', 'n solicitacao', 'numero da solicitacao']);
    if (/^\d{2}[A-Z]\d{3,6}$/i.test(sol)) {
      var ug = valor(l, ['ug cred', 'ug credito', 'ug solicitante', 'unidade solicitante']);
      return limpa('Solicitação de Empenho ' + sol.toUpperCase() + (ug ? ' - ' + ug : ''));
    }

    var doc = valor(l, ['documento', 'nome do documento', 'nome', 'arquivo']);
    if (doc && !generico(doc)) return limpa(comTipo(doc));
    if (doc && tipoUtil) return limpa(tipoUtil + ' - ' + doc);

    // Clique num número/código da lista: "<nome da coluna> <texto clicado>"
    var clicado = l.celula ? textoDe(l.celula) : '';
    if (l.col && l.col.t && /\d/.test(clicado) && clicado.length <= 40) return limpa(l.col.t + ' ' + clicado);
    return '';
  }

  document.addEventListener('click', function (e) {
    var alvo = e.target;
    if (!alvo || !alvo.closest) return;
    // Só o que pode abrir/baixar: link, imagem, botão, ícone com onclick (não caixas de marcar)
    var acao = alvo.closest('a, img, input[type="image"], button, [onclick]');
    if (!acao || alvo.matches('input[type="checkbox"], input[type="radio"], select, textarea, input[type="text"]')) return;
    var l = linhaDaLista(acao);
    if (!l) return;                                           // fora de lista: não mexe
    if (l.col && /^(editar|excluir|alterar|remover|assinar)$/.test(l.col.n)) return;
    // Lista que não sei nomear: avisa mesmo assim (nome vazio), para o arquivo seguinte
    // não herdar o nome de um clique anterior
    var nome = nomeDaLinha(l);
    try { console.debug('[SILOMS — Nome dos Documentos]', nome || '(sem nome: lista não reconhecida)', l.cab.map(function (c) { return c.t; })); } catch (_) {}
    try { api.runtime.sendMessage({ tipo: 'SILOMS_NOME_DOC', nome: nome }); } catch (_) { /* extensão recarregada: recarregue a página */ }
  }, true);
})();
