'use strict';
/**
 * SILOMS — Nome dos Documentos (background)
 *
 * O content script avisa o assunto do documento clicado ("pendente", vale 60 s). O
 * próximo arquivo que o SILOMS mandar recebe esse nome:
 *   Chrome  — downloads.onDeterminingFilename troca o nome do download; a resposta do
 *             SILOMS (webRequest, só observando) liga o endereço do arquivo ao nome,
 *             para valer também ao salvar depois a partir do visualizador de PDF.
 *   Firefox — webRequest bloqueante reescreve o Content-Disposition da resposta
 *             (o Firefox não tem onDeterminingFilename).
 * O que acontece fica registrado (últimos 25 eventos) para o painel da extensão.
 */

var api = typeof browser !== 'undefined' ? browser : chrome;
var FIREFOX = !!(api.runtime && api.runtime.getBrowserInfo);
var JANELA_MS = 60000;                 // clique → arquivo
var VISUALIZADOR_MS = 30 * 60000;      // PDF aberto na aba → "salvar" depois
var FILTRO = { urls: ['*://*.siloms.intraer/*'] };
// Visualizador de PDF do Chrome: o "salvar" dele pode vir com o endereço do próprio
// visualizador em vez do endereço do SILOMS
var VISUALIZADOR = /^(blob:)?chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\//i;

// ── Estado: pendentes (fila), endereço → nome, último nome dado e eventos ───────
// storage.session: o service worker/página de evento pode ser encerrado entre o
// clique e o arquivo

async function lerEstado() {
  var d = await api.storage.session.get(['pendentes', 'porUrl', 'ultimo', 'eventos']);
  var agora = Date.now();
  return {
    pendentes: (d.pendentes || []).filter(function (p) { return agora - p.ts < JANELA_MS; }),
    porUrl: d.porUrl || {},
    ultimo: d.ultimo || null,
    eventos: d.eventos || [],
  };
}
function gravarEstado(e) {
  // Guarda só os 50 endereços e os 25 eventos mais recentes
  var urls = Object.keys(e.porUrl);
  if (urls.length > 50) urls.slice(0, urls.length - 50).forEach(function (u) { delete e.porUrl[u]; });
  return api.storage.session.set({ pendentes: e.pendentes, porUrl: e.porUrl, ultimo: e.ultimo, eventos: e.eventos.slice(-25) });
}
// Fila simples para não perder atualizações quando dois eventos chegam juntos
var trava = Promise.resolve();
function comEstado(fn) {
  var r = trava.then(async function () { var e = await lerEstado(); var v = await fn(e); await gravarEstado(e); return v; });
  trava = r.catch(function () {});
  return r;
}
function evento(e, tipo, texto) { e.eventos.push({ t: Date.now(), tipo: tipo, texto: String(texto).slice(0, 220) }); }
function curta(u) { return String(u || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 70) || '(sem endereço)'; }
function dar(e, url, nome) { if (url) e.porUrl[url] = nome; e.ultimo = { nome: nome, ts: Date.now() }; }

api.runtime.onMessage.addListener(function (m) {
  if (!m || m.tipo !== 'SILOMS_NOME_DOC') return;
  comEstado(function (e) {
    // Clique numa lista que o content script não soube nomear: zera a fila, para o
    // próximo arquivo não herdar o nome de um clique anterior
    if (!m.nome) {
      e.pendentes = [];
      evento(e, 'clique', 'Clique numa lista sem assunto/número reconhecido (colunas: ' + (m.colunas || '?') + ') — o próximo arquivo fica com o nome do SILOMS');
      return;
    }
    e.pendentes.push({ nome: String(m.nome).slice(0, 150), ts: Date.now() });
    evento(e, 'clique', 'Clique: "' + m.nome + '"');
  });
});

// ── Utilitários ───────────────────────────────────────────────────────────────

function cabecalho(headers, nome) {
  nome = nome.toLowerCase();
  return (headers || []).find(function (h) { return h.name.toLowerCase() === nome; });
}
// "attachment; filename="DOCUMENTO - 1.pdf"" → "DOCUMENTO - 1.pdf"
function nomeDoCabecalho(cd) {
  var v = String(cd || '');
  var m = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(v);
  if (m) { try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch (_) {} }
  m = /filename\s*=\s*"?([^";]+)"?/i.exec(v);
  return m ? m[1].trim() : '';
}
function extensao(nomeOriginal, tipo) {
  var m = /\.([a-z0-9]{2,5})$/i.exec(String(nomeOriginal || ''));
  if (m) return '.' + m[1].toLowerCase();
  var t = String(tipo || '').toLowerCase();
  if (/pdf/.test(t)) return '.pdf';
  if (/msword/.test(t)) return '.doc';
  if (/wordprocessingml/.test(t)) return '.docx';
  if (/spreadsheetml/.test(t)) return '.xlsx';
  if (/jpeg/.test(t)) return '.jpg';
  if (/png/.test(t)) return '.png';
  return '.pdf';
}
// Parece arquivo (e não uma tela do SILOMS)?
function ehArquivo(headers) {
  var cd = cabecalho(headers, 'content-disposition');
  var ct = String((cabecalho(headers, 'content-type') || {}).value || '').toLowerCase();
  return !!(cd && /filename|attachment/i.test(cd.value)) ||
    /application\/(pdf|octet-stream|msword|vnd\.|zip|x-download|force-download)|image\/(jpe?g|png|tiff)/.test(ct);
}
function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '_'); }

// ── Resposta do SILOMS com um arquivo: liga ao clique pendente ────────────────

if (FIREFOX) {
  // Firefox: troca o nome no próprio Content-Disposition (vale para baixar e para
  // salvar a partir do visualizador de PDF)
  api.webRequest.onHeadersReceived.addListener(function (det) {
    if (!ehArquivo(det.responseHeaders)) return {};
    return comEstado(function (e) {
      // O clique mais recente vale (o mesmo documento pode ser baixado de novo);
      // sem clique, o nome que esse endereço já recebeu
      var nome = e.pendentes.length ? e.pendentes.shift().nome : e.porUrl[det.url];
      var cd = cabecalho(det.responseHeaders, 'content-disposition');
      var original = cd ? nomeDoCabecalho(cd.value) : '';
      if (!nome) { evento(e, 'arquivo', 'Arquivo do SILOMS sem clique antes: fica "' + (original || curta(det.url)) + '"'); return {}; }
      dar(e, det.url, nome);
      var hs = det.responseHeaders.filter(function (h) { return h.name.toLowerCase() !== 'content-disposition'; });
      var arquivo = nome + extensao(original, (cabecalho(det.responseHeaders, 'content-type') || {}).value);
      var modo = cd && /^\s*attachment/i.test(cd.value) ? 'attachment' : 'inline';
      hs.push({ name: 'Content-Disposition',
        value: modo + '; filename="' + semAcento(arquivo).replace(/"/g, "'") + '"; filename*=UTF-8\'\'' + encodeURIComponent(arquivo) });
      evento(e, 'renomeado', '"' + (original || curta(det.url)) + '" → "' + arquivo + '"');
      return { responseHeaders: hs };
    });
  }, FILTRO, ['blocking', 'responseHeaders']);
} else {
  // Chrome: só observa a resposta para ligar o endereço ao nome; quem troca o nome é
  // o onDeterminingFilename abaixo
  api.webRequest.onHeadersReceived.addListener(function (det) {
    if (!ehArquivo(det.responseHeaders)) return;
    comEstado(function (e) {
      // O clique mais recente vale, mesmo que o endereço já tenha sido baixado antes
      if (e.pendentes.length) {
        var nome = e.pendentes.shift().nome;
        dar(e, det.url, nome);
        evento(e, 'arquivo', 'Arquivo do SILOMS (' + curta(det.url) + ') vai se chamar "' + nome + '"');
      } else if (!e.porUrl[det.url]) {
        evento(e, 'arquivo', 'Arquivo do SILOMS sem clique antes (' + curta(det.url) + '): fica com o nome do SILOMS');
      }
    });
  }, FILTRO, ['responseHeaders']);

  // Arquivo do SILOMS: endereço do SILOMS (inclusive blob:https://…siloms.intraer/…,
  // gerado na página), baixado a partir de uma página do SILOMS ou salvo pelo
  // visualizador de PDF do Chrome. Outros sites: não mexe.
  var doSiloms = function (u) { return /^(blob:)?https?:\/\/[^/]*\.siloms\.intraer(?:[:/]|$)/i.test(String(u || '')); };
  api.downloads.onDeterminingFilename.addListener(function (item, suggest) {
    var siloms = doSiloms(item.url) || doSiloms(item.finalUrl) || doSiloms(item.referrer);
    var visualizador = VISUALIZADOR.test(item.url || '') || VISUALIZADOR.test(item.referrer || '');
    if (!siloms && !visualizador) { suggest(); return; }
    var original = String(item.filename || '').split(/[\\/]/).pop();
    comEstado(function (e) {
      var nome = e.porUrl[item.url] || e.porUrl[item.finalUrl] || (siloms && e.pendentes.length ? e.pendentes.shift().nome : '');
      // Salvo pelo visualizador sem o endereço do SILOMS: o último documento aberto
      if (!nome && visualizador && e.ultimo && Date.now() - e.ultimo.ts < VISUALIZADOR_MS) nome = e.ultimo.nome;
      if (!nome) {
        evento(e, 'download', 'Download "' + (original || curta(item.url)) + '" não renomeado: nenhum clique do SILOMS antes' +
          (visualizador ? ' (salvo pelo visualizador de PDF)' : ''));
        suggest();
        return;
      }
      dar(e, item.url, nome);
      var arquivo = nome + extensao(original, item.mime);
      evento(e, 'renomeado', '"' + (original || curta(item.url)) + '" → "' + arquivo + '"' + (visualizador ? ' (visualizador de PDF)' : ''));
      suggest({ filename: arquivo, conflictAction: 'uniquify' });
    }).catch(function () { suggest(); });
    return true;   // resposta assíncrona
  });
}

// Para os testes
self.__silomsNomes = { lerEstado: lerEstado, nomeDoCabecalho: nomeDoCabecalho, extensao: extensao };
