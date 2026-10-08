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

  // Cabeçalho da tabela da linha: <th> da própria tabela ou a 1ª linha dela
  function cabecalho(tabela, linha) {
    var ths = Array.prototype.filter.call(tabela.querySelectorAll('th'), function (th) { return th.closest('table') === tabela; });
    if (ths.length >= 2) return ths.map(function (th) { return norm(textoDe(th)); });
    var primeira = tabela.rows[0];
    if (!primeira || primeira === linha) return null;
    return Array.prototype.map.call(primeira.cells, function (c) { return norm(textoDe(c)); });
  }

  // Sobe pelas linhas (o GeneXus aninha tabelas) até achar a da lista, com "Assunto"
  // ou "Documento" no cabeçalho; devolve os dados da linha e a coluna clicada
  function dadosDoClique(alvo) {
    var tr = alvo.closest && alvo.closest('tr');
    for (var nivel = 0; tr && nivel < 6; nivel++) {
      var tabela = tr.closest('table');
      var cab = tabela ? cabecalho(tabela, tr) : null;
      if (cab && (cab.indexOf('assunto') >= 0 || cab.indexOf('documento') >= 0) && tr.cells.length >= cab.length - 1) {
        var celulaClicada = alvo.closest('td, th');
        var col = celulaClicada && celulaClicada.parentElement === tr ? cab[celulaClicada.cellIndex] || '' : '';
        var cel = function (nomes) {
          for (var i = 0; i < nomes.length; i++) {
            var k = cab.indexOf(nomes[i]);
            if (k >= 0 && tr.cells[k]) { var v = textoDe(tr.cells[k]); if (v) return v; }
          }
          return '';
        };
        return {
          coluna: col,
          assunto: cel(['assunto']),
          documento: cel(['documento', 'nome do documento', 'nome']),
          tipo: cel(['tipo de documento', 'tipo']),
        };
      }
      tr = tr.parentElement && tr.parentElement.closest('tr');
    }
    return null;
  }

  // Nome do arquivo: "Despacho - Encaminhamento ao SEO" / "Solicitação de Empenho 26S1603 - HAMN"
  function nomeDoArquivo(d) {
    var assunto = d.assunto || d.documento;
    if (!assunto) return '';
    var tipo = d.tipo && !/^(outros?|selecione|-+)$/i.test(d.tipo) && norm(assunto).indexOf(norm(d.tipo)) < 0 ? d.tipo + ' - ' : '';
    return (tipo + assunto).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150).replace(/[.\s]+$/, '');
  }

  document.addEventListener('click', function (e) {
    var alvo = e.target;
    if (!alvo || !alvo.closest) return;
    // Só o que pode abrir/baixar: link, imagem, botão, ícone com onclick (não caixas de marcar)
    var acao = alvo.closest('a, img, input[type="image"], button, [onclick]');
    if (!acao || alvo.matches('input[type="checkbox"], input[type="radio"], select, textarea, input[type="text"]')) return;
    var d = dadosDoClique(acao);
    if (!d || /^(editar|excluir|alterar|remover|assinar)$/.test(d.coluna)) return;
    var nome = nomeDoArquivo(d);
    if (!nome) return;
    try { api.runtime.sendMessage({ tipo: 'SILOMS_NOME_DOC', nome: nome }); } catch (_) { /* extensão recarregada: recarregue a página */ }
  }, true);
})();
