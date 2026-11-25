'use strict';
/**
 * SILOMS — Nome dos Documentos (background)
 *
 * O content script avisa o assunto do documento clicado ("pendente", vale 120 s). O
 * arquivo que o SILOMS mandar depois, NA MESMA ABA (ou na aba que ela abriu), recebe
 * esse nome — um clique, um arquivo, na ordem:
 *   Chrome  — downloads.onDeterminingFilename troca o nome do download; a resposta do
 *             SILOMS (webRequest, só observando) liga o endereço do arquivo e a ABA em
 *             que ele abriu ao nome, para valer também ao salvar depois pelo
 *             visualizador de PDF (o nome da aba que está na tela). Sem saber de qual
 *             documento é, não renomeia — nome errado é pior que "documento".
 *   Firefox — webRequest bloqueante reescreve o Content-Disposition da resposta
 *             (o Firefox não tem onDeterminingFilename).
 * 1.0.7 (baixando muitos arquivos seguidos os nomes saíam trocados): a fila desalinhava
 * quando um clique não gerava arquivo (duplo clique) ou um arquivo gerava mais de uma
 * resposta (o visualizador de PDF lê em pedaços — HTTP 206 —, ou pede o mesmo endereço de
 * novo). Agora: duplo clique conta uma vez; pedaço ou repetição do mesmo arquivo não gasta
 * o clique seguinte; cada arquivo só pega clique da própria aba; no Chrome cada download
 * pega o nome que a SUA resposta recebeu (fila por endereço), não o do último arquivo.
 * O que acontece fica registrado (últimos 25 eventos) para o painel da extensão.
 */

var api = typeof browser !== 'undefined' ? browser : chrome;
var FIREFOX = !!(api.runtime && api.runtime.getBrowserInfo);
var JANELA_MS = 120000;                // clique → arquivo (relatório do SILOMS pode demorar)
var DUPLO_MS = 2000;                   // mesmo documento clicado de novo nesse tempo = um clique só
var REPETICAO_MS = 20000;              // mesmo endereço pedido de novo sem clique novo = mesmo arquivo
var SEM_ARQUIVO_MS = 15000;            // clique sem arquivo há mais que isso, com clique novo na aba: sai da fila
var FILTRO = { urls: ['*://*.siloms.intraer/*'] };
// Visualizador de PDF do Chrome: o "salvar" dele pode vir com o endereço do próprio
// visualizador em vez do endereço do SILOMS
var VISUALIZADOR = /^(blob:)?chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\//i;
// Pedido feito pelo próprio leitor de PDF (pedaços do arquivo já aberto), não por um clique
var LEITOR_PDF = /^(chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai|resource:\/\/pdf\.js|moz-extension:)/i;

// ── Estado: pendentes (fila), endereço → nome, aba → nome e eventos ─────────────
// storage.session: o service worker/página de evento pode ser encerrado entre o
// clique e o arquivo

async function lerEstado() {
  var d = await api.storage.session.get(['pendentes', 'porUrl', 'porAba', 'filaDownload', 'eventos']);
  var agora = Date.now();
  return {
    pendentes: (d.pendentes || []).filter(function (p) { return agora - p.ts < JANELA_MS; }),
    porUrl: d.porUrl || {},               // endereço → { nome, ts } (último nome que o endereço recebeu)
    porAba: d.porAba || {},               // aba em que um arquivo do SILOMS abriu → nome
    filaDownload: d.filaDownload || {},   // endereço → nomes das respostas ainda sem download (Chrome)
    eventos: d.eventos || [],
  };
}
function gravarEstado(e) {
  // Guarda só os 50 endereços e os 25 eventos mais recentes
  var urls = Object.keys(e.porUrl);
  if (urls.length > 50) urls.slice(0, urls.length - 50).forEach(function (u) { delete e.porUrl[u]; });
  var filas = Object.keys(e.filaDownload);
  if (filas.length > 50) filas.slice(0, filas.length - 50).forEach(function (u) { delete e.filaDownload[u]; });
  return api.storage.session.set({ pendentes: e.pendentes, porUrl: e.porUrl, porAba: e.porAba, filaDownload: e.filaDownload, eventos: e.eventos.slice(-25) });
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
function nomeDaUrl(e, url) { var x = e.porUrl[url]; return x ? (typeof x === 'string' ? x : x.nome) : ''; }
function dar(e, url, nome, aba) {
  if (url) e.porUrl[url] = { nome: nome, ts: Date.now() };
  if (aba >= 0) e.porAba[aba] = nome;
}

// Aba que abriu esta (PDF aberto em aba nova pelo SILOMS): o clique foi na de origem
function abaDeOrigem(aba) {
  if (!(aba >= 0) || !api.tabs || !api.tabs.get) return Promise.resolve(-1);
  return Promise.resolve(api.tabs.get(aba)).then(function (t) { return t && t.openerTabId >= 0 ? t.openerTabId : -1; }, function () { return -1; });
}
// O clique (mais antigo, ainda sem arquivo) da aba do arquivo ou da que a abriu; sem aba conhecida, o mais antigo
function tirarPendente(e, aba, origem) {
  var i = aba >= 0 ? e.pendentes.findIndex(function (p) { return p.aba === aba || (origem >= 0 && p.aba === origem) || !(p.aba >= 0); }) : 0;
  if (i < 0 || !e.pendentes.length) return '';
  return e.pendentes.splice(i, 1)[0].nome;
}
// Mesmo arquivo de novo (o leitor de PDF pedindo outra vez, salvar…): o endereço já tem nome
// recente e não houve clique depois dele nesta aba
function repeticao(e, url, aba, origem) {
  var x = e.porUrl[url];
  if (!x || typeof x === 'string' || Date.now() - x.ts > REPETICAO_MS) return false;
  return !e.pendentes.some(function (p) { return p.ts > x.ts && (p.aba === aba || p.aba === origem || !(p.aba >= 0) || !(aba >= 0)); });
}

api.runtime.onMessage.addListener(function (m, remetente) {
  if (!m || m.tipo !== 'SILOMS_NOME_DOC') return;
  var aba = remetente && remetente.tab ? remetente.tab.id : -1;
  comEstado(function (e) {
    // Clique numa lista que o content script não soube nomear: zera a fila desta aba, para
    // o próximo arquivo não herdar o nome de um clique anterior
    if (!m.nome) {
      e.pendentes = e.pendentes.filter(function (p) { return p.aba !== aba; });
      evento(e, 'clique', 'Clique numa lista sem assunto/número reconhecido (colunas: ' + (m.colunas || '?') + ') — o próximo arquivo fica com o nome do SILOMS');
      return;
    }
    var nome = String(m.nome).slice(0, 150);
    var ultimo = e.pendentes.filter(function (p) { return p.aba === aba; }).pop();
    if (ultimo && ultimo.nome === nome && Date.now() - ultimo.ts < DUPLO_MS) return;   // duplo clique: um só
    // clique anterior desta aba que não trouxe arquivo (abriu uma tela, deu erro…): não passa o nome adiante
    var antes = e.pendentes.length;
    e.pendentes = e.pendentes.filter(function (p) { return p.aba !== aba || Date.now() - p.ts < SEM_ARQUIVO_MS; });
    if (e.pendentes.length < antes) evento(e, 'clique', (antes - e.pendentes.length) + ' clique(s) anterior(es) sem arquivo saíram da fila');
    e.pendentes.push({ nome: nome, ts: Date.now(), aba: aba });
    evento(e, 'clique', 'Clique: "' + nome + '"' + (e.pendentes.length > 1 ? ' (' + e.pendentes.length + ' na fila)' : ''));
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
// Pedaço de um arquivo já aberto (o leitor de PDF lê em partes) — não é um arquivo novo
function ehPedaco(det) {
  return det.statusCode === 206 || LEITOR_PDF.test(det.initiator || det.originUrl || '');
}
function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '_'); }

// ── Resposta do SILOMS com um arquivo: liga ao clique pendente ────────────────

if (FIREFOX) {
  // Firefox: troca o nome no próprio Content-Disposition (vale para baixar e para
  // salvar a partir do visualizador de PDF)
  api.webRequest.onHeadersReceived.addListener(function (det) {
    if (!ehArquivo(det.responseHeaders)) return {};
    return comEstado(async function (e) {
        var origem = await abaDeOrigem(det.tabId);
        var cd = cabecalho(det.responseHeaders, 'content-disposition');
        var original = cd ? nomeDoCabecalho(cd.value) : '';
        var nome, como;
        if (ehPedaco(det) || repeticao(e, det.url, det.tabId, origem)) { nome = nomeDaUrl(e, det.url); como = 'mesmo arquivo'; }
        else { nome = tirarPendente(e, det.tabId, origem); como = 'clique'; }
        if (!nome) {
          if (como === 'clique') evento(e, 'arquivo', 'Arquivo do SILOMS sem clique antes nesta aba: fica "' + (original || curta(det.url)) + '"');
          return {};
        }
        if (como === 'clique') dar(e, det.url, nome);
        var hs = det.responseHeaders.filter(function (h) { return h.name.toLowerCase() !== 'content-disposition'; });
        var arquivo = nome + extensao(original, (cabecalho(det.responseHeaders, 'content-type') || {}).value);
        var modo = cd && /^\s*attachment/i.test(cd.value) ? 'attachment' : 'inline';
        hs.push({ name: 'Content-Disposition',
          value: modo + '; filename="' + semAcento(arquivo).replace(/"/g, "'") + '"; filename*=UTF-8\'\'' + encodeURIComponent(arquivo) });
        if (como === 'clique') evento(e, 'renomeado', '"' + (original || curta(det.url)) + '" → "' + arquivo + '"');
        return { responseHeaders: hs };
    });
  }, FILTRO, ['blocking', 'responseHeaders']);
} else {
  // Chrome: só observa a resposta para ligar o endereço ao nome; quem troca o nome é
  // o onDeterminingFilename abaixo
  api.webRequest.onHeadersReceived.addListener(function (det) {
    if (!ehArquivo(det.responseHeaders)) return;
    // Aba em que o arquivo abre (PDF na tela): só para documento da aba inteira
    var aba = det.type === 'main_frame' ? det.tabId : -1;
    var cd = String((cabecalho(det.responseHeaders, 'content-disposition') || {}).value || '');
    var ct = String((cabecalho(det.responseHeaders, 'content-type') || {}).value || '').toLowerCase();
    var vaiBaixar = /attachment/i.test(cd) || !/pdf|image\//.test(ct);   // PDF/imagem sem "attachment" abre na tela
    comEstado(async function (e) {
        var origem = await abaDeOrigem(det.tabId);
        // pedaço do PDF já aberto ou o mesmo arquivo pedido de novo: mantém o nome, não gasta clique
        if (ehPedaco(det) || repeticao(e, det.url, det.tabId, origem)) {
          if (aba >= 0 && nomeDaUrl(e, det.url)) e.porAba[aba] = nomeDaUrl(e, det.url);
          return;
        }
        var nome = tirarPendente(e, det.tabId, origem);
        if (nome) {
          dar(e, det.url, nome, aba);
          // cada download deste endereço pega o nome da SUA resposta, na ordem em que chegaram
          if (vaiBaixar) (e.filaDownload[det.url] = e.filaDownload[det.url] || []).push(nome);
          evento(e, 'arquivo', 'Arquivo do SILOMS (' + curta(det.url) + ') vai se chamar "' + nome + '"');
        } else {
          if (aba >= 0) delete e.porAba[aba];   // a aba agora mostra outro arquivo, sem nome
          evento(e, 'arquivo', 'Arquivo do SILOMS sem clique antes nesta aba (' + curta(det.url) + '): fica com o nome do SILOMS');
        }
    });
  }, FILTRO, ['responseHeaders']);

  // PDF gerado pela página (blob:https://…siloms.intraer/…) aberto numa aba: liga a aba
  // ao clique pendente (da aba que a abriu) na hora em que ela abre
  api.tabs.onUpdated.addListener(function (aba, mud, tab) {
    if (!/^blob:https?:\/\/[^/]*\.siloms\.intraer/i.test(mud.url || '')) return;
    var origem = tab && tab.openerTabId >= 0 ? tab.openerTabId : -1;
    comEstado(function (e) {
      var nome = tirarPendente(e, aba, origem);
      if (!nome) return;
      dar(e, mud.url, nome, aba);
      evento(e, 'arquivo', 'PDF do SILOMS aberto numa aba vai se chamar "' + nome + '"');
    });
  });
  api.tabs.onRemoved.addListener(function (aba) {
    comEstado(function (e) { delete e.porAba[aba]; e.pendentes = e.pendentes.filter(function (p) { return p.aba !== aba; }); });
  });

  // Arquivo do SILOMS: endereço do SILOMS (inclusive blob:https://…siloms.intraer/…,
  // gerado na página), baixado a partir de uma página do SILOMS ou salvo pelo
  // visualizador de PDF do Chrome. Outros sites: não mexe.
  var doSiloms = function (u) { return /^(blob:)?https?:\/\/[^/]*\.siloms\.intraer(?:[:/]|$)/i.test(String(u || '')); };
  api.downloads.onDeterminingFilename.addListener(function (item, suggest) {
    var siloms = doSiloms(item.url) || doSiloms(item.finalUrl) || doSiloms(item.referrer);
    var visualizador = VISUALIZADOR.test(item.url || '') || VISUALIZADOR.test(item.referrer || '');
    if (!siloms && !visualizador) { suggest(); return; }
    var original = String(item.filename || '').split(/[\\/]/).pop();
    // Aba que está na tela (quem salva pelo visualizador de PDF está olhando para ela)
    var abaNaTela = api.tabs.query({ active: true, lastFocusedWindow: true }).then(function (t) { return t[0] ? t[0].id : -1; }, function () { return -1; });
    comEstado(async function (e) {
      var aba = await abaNaTela;
      var nome = '';
      if (visualizador && !siloms) nome = e.porAba[aba] || '';   // vale só o nome da aba que está na tela
      else {
        // o nome que a resposta DESTE download recebeu (fila por endereço); senão o do endereço
        // (o mesmo arquivo baixado de novo); senão um clique da aba ainda sem arquivo
        var fila = e.filaDownload[item.url] || e.filaDownload[item.finalUrl];
        if (fila && fila.length) nome = fila.shift();
        else nome = nomeDaUrl(e, item.url) || nomeDaUrl(e, item.finalUrl) || tirarPendente(e, aba, -1);
      }
      if (!nome) {
        evento(e, 'download', 'Download "' + (original || curta(item.url)) + '" não renomeado: nenhum clique do SILOMS antes' +
          (visualizador ? ' (salvo pelo visualizador de PDF)' : ''));
        suggest();
        return;
      }
      if (siloms && item.url && !e.porUrl[item.url]) dar(e, item.url, nome);
      var arquivo = nome + extensao(original, item.mime);
      evento(e, 'renomeado', '"' + (original || curta(item.url)) + '" → "' + arquivo + '"' + (visualizador ? ' (visualizador de PDF)' : ''));
      suggest({ filename: arquivo, conflictAction: 'uniquify' });
    }).catch(function () { suggest(); });
    return true;   // resposta assíncrona
  });
}

// Para os testes
self.__silomsNomes = { lerEstado: lerEstado, nomeDoCabecalho: nomeDoCabecalho, extensao: extensao };
