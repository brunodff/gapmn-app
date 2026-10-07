/**
 * Subprocessos no SILOMS — motor que roda na aba do SILOMS (content script).
 *
 * Veio do robô "Criador de Subprocessos SILOMS" (extensao-siloms-subprocesso), que já
 * funcionava, e mantém os mesmos passos:
 *   lista "Documentos na Unidade" → Novo Subprocesso → Nome e Assunto → Unidade do
 *   ePAG → PAG → salvar → Nr. Documento → Associar Fluxo
 * Novo aqui:
 *   - a fila vem do painel do robô de empenhos (solicitações empenhadas), não da planilha;
 *   - depois do fluxo, anexa ao subprocesso o PDF da solicitação e o da declaração
 *     do SICAF (guardados pelo painel; o background entrega o arquivo).
 *
 * A página navega a cada passo: o estado fica no storage e cada carregamento retoma
 * de onde parou. Log, andamento e resultado são espelhados no storage para o painel.
 */
(function () {
'use strict';
if (window.__gapmnSubprocesso) return;
window.__gapmnSubprocesso = true;

var STATE_KEY  = 'subproc_state';
var LOG_KEY    = 'subproc_log';
var PROG_KEY   = 'subproc_prog';
var RESULT_KEY = 'subproc_resultado';
var LOG_MAX    = 400;

// ── Utilitários ───────────────────────────────────────────────────────────────

function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function readState() {
  return new Promise(function (res) { chrome.storage.local.get(STATE_KEY, function (d) { res(d[STATE_KEY] || null); }); });
}
function saveState(state) {
  return new Promise(function (res) { var o = {}; o[STATE_KEY] = state; chrome.storage.local.set(o, res); });
}
function clearState() {
  return new Promise(function (res) { chrome.storage.local.remove(STATE_KEY, res); });
}
function msg(m) {
  return new Promise(function (res) {
    try {
      chrome.runtime.sendMessage(m, function (r) {
        if (chrome.runtime.lastError) { res({ ok: false, erro: chrome.runtime.lastError.message }); return; }
        res(r || { ok: false, erro: 'sem resposta' });
      });
    } catch (e) { res({ ok: false, erro: e.message }); }
  });
}

// ── Log, andamento e barra na página ─────────────────────────────────────────

var logPendente = [], logTimer = null, logGravando = Promise.resolve();

function log(texto, lvl) {
  var hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  var linha = '[' + hora + '] ' + texto;
  console.log('[GAPMN subprocesso] ' + texto);
  logPendente.push({ line: linha, lvl: lvl || 'info' });
  if (!logTimer) logTimer = setTimeout(descarregarLog, 250);
}

// Grava já o log pendente (antes de navegar, senão as últimas linhas se perdem)
function descarregarLog() {
  if (logTimer) { clearTimeout(logTimer); logTimer = null; }
  var novas = logPendente;
  logPendente = [];
  if (!novas.length) return logGravando;
  logGravando = logGravando.then(function () {
    return new Promise(function (res) {
      chrome.storage.local.get(LOG_KEY, function (d) {
        var o = {}; o[LOG_KEY] = (d[LOG_KEY] || []).concat(novas).slice(-LOG_MAX);
        chrome.storage.local.set(o, res);
      });
    });
  });
  return logGravando;
}

var progAtual = {};
function espelharProg(patch) {
  progAtual = Object.assign({}, progAtual, patch, { ts: Date.now() });
  var o = {}; o[PROG_KEY] = progAtual;
  try { chrome.storage.local.set(o); } catch (_) {}
  barra(progAtual.running ? (progAtual.total ? progAtual.cur + '/' + progAtual.total + ' · ' : '') + (progAtual.sub || '') : '');
}
function setSub(t) { espelharProg({ sub: t }); }
function setProgress(cur, total) { espelharProg({ running: true, concluido: false, cur: cur, total: total }); }

// Faixa discreta no topo da página enquanto o robô trabalha
function barra(texto) {
  var id = '__gapmn_subproc_barra__';
  var b = document.getElementById(id);
  if (!texto) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('div');
    b.id = id;
    b.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;background:#1e3a8a;color:#dbeafe;' +
      'font:600 11px system-ui,sans-serif;padding:4px 10px;border-bottom-left-radius:6px;pointer-events:none;opacity:.92';
    (document.body || document.documentElement).appendChild(b);
  }
  b.textContent = '🤖 GAPMN subprocessos — ' + texto;
}

// ── DOM do SILOMS (GeneXus, com iframes) ─────────────────────────────────────

function allDocs() {
  var list = [], visited = [];
  function collect(doc) {
    if (!doc) return;
    for (var v = 0; v < visited.length; v++) { if (visited[v] === doc) return; }
    visited.push(doc); list.push(doc);
    try {
      var frames = doc.querySelectorAll('iframe, frame');
      for (var i = 0; i < frames.length; i++) { try { collect(frames[i].contentDocument); } catch (_) {} }
    } catch (_) {}
  }
  collect(document);
  return list;
}

function getPopupDoc() {
  var docs = allDocs();
  for (var di = 0; di < docs.length; di++) {
    try { if (/gxPopupLevel|GxPopup/i.test(docs[di].location ? docs[di].location.href : '')) return docs[di]; } catch (_) {}
  }
  return null;
}

async function waitPopup(ms, beforeDocs) {
  var end = Date.now() + (ms || 10000);
  while (Date.now() < end) {
    if (beforeDocs) {
      var current = allDocs();
      for (var i = 0; i < current.length; i++) {
        if (beforeDocs.indexOf(current[i]) !== -1) continue;
        try {
          var href = '';
          try { href = current[i].location ? current[i].location.href : ''; } catch (_) {}
          if (!href || href === 'about:blank') continue;
          if (current[i].body && current[i].body.children.length > 1) return current[i];
        } catch (_) {}
      }
    } else {
      var pd = getPopupDoc();
      if (pd && pd.body && pd.body.children.length > 1) return pd;
    }
    await delay(300);
  }
  return null;
}

function findEl(sel, text, skipPopup) {
  var docs = allDocs();
  for (var di = 0; di < docs.length; di++) {
    var d = docs[di];
    if (skipPopup) { try { if (/gxPopupLevel|GxPopup/i.test(d.location.href)) continue; } catch (_) {} }
    try {
      var els = d.querySelectorAll(sel);
      for (var ei = 0; ei < els.length; ei++) {
        if (!text) return els[ei];
        var t = (els[ei].value || els[ei].textContent || '');
        if (t.toLowerCase().indexOf(text.toLowerCase()) !== -1) return els[ei];
      }
    } catch (_) {}
  }
  return null;
}

async function waitEl(sel, text, ms, skipPopup) {
  var end = Date.now() + (ms || 15000);
  while (Date.now() < end) {
    var el = findEl(sel, text, skipPopup);
    if (el) return el;
    await delay(150);
  }
  return null;
}

function fill(el, value) {
  try { el.focus(); } catch (_) {}
  try { el.value = value; } catch (_) {}
  ['input', 'change', 'blur'].forEach(function (ev) {
    try { el.dispatchEvent(new Event(ev, { bubbles: true })); } catch (_) {}
  });
}

function docDe(el) {
  var docs = allDocs();
  for (var i = 0; i < docs.length; i++) { try { if (docs[i].contains(el)) return docs[i]; } catch (_) {} }
  return document;
}

/**
 * Roda `code` no contexto da página. No Firefox o <script> injetado roda; no Chrome
 * a CSP da extensão o bloqueia em silêncio — aí o mesmo código vai pelo background
 * (chrome.scripting, mundo MAIN). Devolve true se tentou.
 */
function rodarNaPagina(doc, code) {
  var marca = 'gp' + Date.now() + Math.random().toString(36).slice(2, 7);
  try {
    var s = doc.createElement('script');
    s.textContent = '(function(){document.documentElement.setAttribute("data-gapmn-rodou","' + marca + '");' + code + '})();';
    (doc.head || doc.body || doc.documentElement).appendChild(s);
    try { s.parentNode.removeChild(s); } catch (_) {}
  } catch (_) {}
  var rodou = false;
  try { rodou = doc.documentElement.getAttribute('data-gapmn-rodou') === marca; } catch (_) {}
  if (!rodou) {
    var url = '';
    try { url = doc.location.href; } catch (_) {}
    msg({ type: 'SUBPROC_EVAL', code: code, frameUrl: url });
  }
  return true;
}

// Clique como o GeneXus espera (onclick/href no mundo MAIN, com isTrusted forjado)
async function clicarNoMain(el) {
  var marca = 'gc' + Date.now() + Math.random().toString(36).slice(2, 7);
  try { el.setAttribute('data-gapmn-clique', marca); } catch (_) {}
  var r = await msg({ type: 'SUBPROC_CLICK', alvo: marca });
  if (!r.ok || r.result === 'nao-achou') { try { el.click(); } catch (_) {} return 'click-direto'; }
  return r.result;
}

function injectClickByText(pd, searchText) {
  var safe = JSON.stringify(searchText);
  return rodarNaPagina(pd,
    'var needle=' + safe + '.toLowerCase();' +
    'var all=document.querySelectorAll("a,td[onclick],tr[onclick]");' +
    'for(var i=0;i<all.length;i++){' +
      'var t=(all[i].textContent||"").trim();' +
      'if(t.toLowerCase().indexOf(needle)!==-1){' +
        'var el=all[i];var href=el.getAttribute("href")||"";var oc=el.getAttribute("onclick")||"";' +
        'var code=oc||(href.indexOf("javascript:")===0?href.slice(11):"");' +
        'if(code){try{(new Function(code)).call(el);}catch(e){el.click();}}else{el.click();}' +
        'return;' +
      '}' +
    '}');
}

async function waitPopupClosed(ms) {
  var end = Date.now() + (ms || 8000);
  while (Date.now() < end) {
    var pd = getPopupDoc();
    if (!pd) return true;
    try { if (!pd.body || !pd.body.isConnected) return true; } catch (_) { return true; }
    await delay(150);
  }
  return false;
}

function forceClosePopup() {
  rodarNaPagina(document,
    'if(typeof gxClosePopup==="function"){gxClosePopup(0);return;}' +
    'if(typeof gx!=="undefined"&&gx&&gx.popup&&gx.popup.Close){gx.popup.Close(0);return;}' +
    'var iframes=document.querySelectorAll("iframe,frame");' +
    'for(var i=0;i<iframes.length;i++){if(/gxPopupLevel|GxPopup/i.test(iframes[i].src||"")){' +
      'iframes[i].parentNode&&iframes[i].parentNode.removeChild(iframes[i]);break;}}' +
    'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",keyCode:27,bubbles:true}));');
}

function findArrowNear(labelText, excludeTexts) {
  var docs = allDocs();
  excludeTexts = excludeTexts || [];
  for (var di = 0; di < docs.length; di++) {
    try {
      var cells = docs[di].querySelectorAll('td, th, label, span, b, div');
      for (var ci = 0; ci < cells.length; ci++) {
        var txt = (cells[ci].textContent || '').trim().toLowerCase();
        if (txt.indexOf(labelText.toLowerCase()) === -1 || txt.length > 60) continue;
        if (excludeTexts.some(function (x) { return txt.indexOf(x) !== -1; })) continue;
        var row = cells[ci].closest ? cells[ci].closest('tr') : cells[ci].parentElement;
        if (row) {
          var arr = row.querySelector('input[type="image"], img[onclick], img[src*="seta" i], img[src*="arrow" i], img[src*="lupa" i]');
          if (arr) return arr;
        }
      }
    } catch (_) {}
  }
  return null;
}

function clickSearchBtn(pd) {
  var btn = pd.querySelector('input[value*="Renovar" i], input[value*="Pesquisar" i], input[value*="Buscar" i],' +
    'button[title*="Renovar" i], button[title*="Pesquisar" i]');
  if (!btn) {
    var refInp = (pd.getElementById && pd.getElementById('vCSG_UNIDADE')) || pd.querySelector('input[name="vCSG_UNIDADE"]');
    if (refInp) {
      var parentRow = refInp.closest ? refInp.closest('tr') : null;
      if (parentRow) btn = parentRow.querySelector('input[type="image"], img[onclick]');
    }
  }
  if (!btn) {
    var imgs = pd.querySelectorAll('input[type="image"]');
    for (var i = 0; i < imgs.length; i++) {
      if (!/fechar|close|sair|exit|cancel|volta|voltar/i.test((imgs[i].src || '').toLowerCase())) { btn = imgs[i]; break; }
    }
  }
  if (btn) { log('    Lupa: ' + (btn.src || btn.value || btn.tagName).split('/').pop()); btn.click(); return true; }
  return false;
}

function findInputUnderHeader(pd, colLabel) {
  var headers = pd.querySelectorAll('th, td');
  for (var hi = 0; hi < headers.length; hi++) {
    if ((headers[hi].textContent || '').trim().toLowerCase() !== colLabel.toLowerCase()) continue;
    var colIdx = 0, s = headers[hi];
    while (s.previousElementSibling) { colIdx++; s = s.previousElementSibling; }
    var trs = pd.querySelectorAll('tr');
    for (var ti = 0; ti < trs.length; ti++) {
      var tds = trs[ti].querySelectorAll('td, th');
      if (tds.length > colIdx) {
        var inp = tds[colIdx].querySelector('input[type="text"], input:not([type])');
        if (inp) return inp;
      }
    }
  }
  return null;
}

// Pesquisa e escolhe um item num popup GeneXus (ex.: a sigla da unidade do ePAG)
async function gxSelectInPopup(pd, searchTerm, displayTerm, colHint) {
  await delay(400);
  var allInputs = pd.querySelectorAll('input[type="text"], input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="image"]):not([type="button"]):not([type="submit"])');
  var sinp = colHint ? findInputUnderHeader(pd, colHint) : null;
  if (!sinp && allInputs.length > 1) {
    for (var fi = 0; fi < allInputs.length; fi++) {
      if ((allInputs[fi].name || '').toUpperCase() !== 'HELP') { sinp = allInputs[fi]; break; }
    }
  }
  if (!sinp) sinp = allInputs[0] || null;
  if (sinp) { fill(sinp, searchTerm); await delay(300); }
  else log('    ⚠ Nenhum campo de busca no popup', 'warn');

  var clicked = clickSearchBtn(pd);
  if (!clicked && sinp) {
    try { sinp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })); } catch (_) {}
  }
  await delay(2000);
  try { if (!pd.body || !pd.body.isConnected) { log('    ⚠ Popup fechou inesperadamente', 'warn'); return false; } } catch (_) {}

  var allLinks = pd.querySelectorAll('a');
  for (var li = 0; li < allLinks.length; li++) {
    if ((allLinks[li].textContent || '').trim().toLowerCase().indexOf(displayTerm.toLowerCase()) === -1) continue;
    var linkTxt = allLinks[li].textContent.trim();
    var href = allLinks[li].getAttribute('href') || '';
    var oc = allLinks[li].getAttribute('onclick') || '';
    if (href.indexOf('javascript:') === 0 || oc) {
      var r = await msg({ type: 'GAPMN_POPUP_CLICK', text: linkTxt });
      log('    ← popup: ' + JSON.stringify(r));
    } else {
      injectClickByText(pd, linkTxt);
      try { allLinks[li].click(); } catch (_) {}
    }
    log('    "' + displayTerm + '" escolhido ✓', 'ok');
    await delay(1000);
    return true;
  }
  var trs = pd.querySelectorAll('tr');
  for (var ri = 0; ri < trs.length; ri++) {
    if ((trs[ri].textContent || '').toLowerCase().indexOf(displayTerm.toLowerCase()) === -1) continue;
    injectClickByText(pd, displayTerm);
    log('    "' + displayTerm + '" escolhido ✓ (linha)', 'ok');
    await delay(1000);
    return true;
  }
  return false;
}

async function gxSelect(arrow, searchTerm, displayTerm, colHint) {
  if (!arrow) { log('⚠ Seta não encontrada — preencha manualmente', 'warn'); return false; }
  var beforeDocs = allDocs();
  arrow.click();
  var pd = await waitPopup(12000, beforeDocs);
  if (!pd) { log('    ⚠ Popup não carregou', 'warn'); return false; }
  var found = await gxSelectInPopup(pd, searchTerm, displayTerm, colHint);
  if (!found) { log('    ⚠ "' + displayTerm + '" não encontrado no popup', 'warn'); return false; }
  var closed = await waitPopupClosed(6000);
  if (!closed) { forceClosePopup(); await delay(800); closed = !getPopupDoc(); }
  log('    Popup ' + (closed ? 'fechado ✓' : 'ainda aberto ⚠'), closed ? 'ok' : 'warn');
  return true;
}

async function searchPAGInPopup(pd, pagNr) {
  await delay(400);
  var allInps = pd.querySelectorAll('input[type="text"]');
  if (allInps.length) { fill(allInps[0], pagNr); await delay(200); }
  else log('    ⚠ Campo PAG não encontrado no popup', 'warn');
  var clicked = clickSearchBtn(pd);
  log('    Lupa PAG ' + (clicked ? 'clicada ✓' : '⚠ não encontrada'), clicked ? 'info' : 'warn');
  await delay(2500);
  var sel = await msg({ type: 'GAPMN_PAG_SEL', pagNr: pagNr });
  log('    ← PAG: ' + JSON.stringify(sel));
  if (sel && sel.result && sel.result !== 'notfound') { await delay(400); return true; }
  if (sel && sel.ok && !('result' in sel)) {
    await delay(700);
    if (!getPopupDoc()) return true;
  }
  return false;
}

async function gxSelectPAG(arrow, pagNr) {
  if (!arrow) { log('  ⚠ Seta do PAG não encontrada', 'warn'); return false; }
  var arrowDoc = docDe(arrow);
  var iframeState = [];
  allDocs().forEach(function (d) { try { iframeState.push({ doc: d, href: d.location ? d.location.href : '' }); } catch (_) {} });
  var arrowFrameUrl = '';
  try { arrowFrameUrl = arrowDoc.location ? arrowDoc.location.href : ''; } catch (_) {}
  var r = await msg({ type: 'GAPMN_PAG_OPEN', frameUrl: arrowFrameUrl });
  log('  ← PAG (abrir): ' + JSON.stringify(r));

  // Popup novo ou iframe reaproveitado com outra URL
  var pd = null, endMs = Date.now() + 12000;
  while (Date.now() < endMs && !pd) {
    var cur = allDocs();
    for (var i = 0; i < cur.length; i++) {
      try {
        var href = '';
        try { href = cur[i].location ? cur[i].location.href : ''; } catch (_) {}
        if (!href || href === 'about:blank' || !cur[i].body || cur[i].body.children.length < 2) continue;
        var known = iframeState.filter(function (x) { return x.doc === cur[i]; })[0];
        if (!known || known.href !== href) { pd = cur[i]; break; }
      } catch (_) {}
    }
    if (!pd) await delay(300);
  }
  if (!pd) { log('  ⚠ Popup do PAG não carregou (12 s)', 'warn'); return false; }

  if (await searchPAGInPopup(pd, pagNr)) { await waitPopupClosed(6000); return true; }
  log('  ⚠ PAG não encontrado — tentando o tipo "Outros"…', 'warn');
  var sels = pd.querySelectorAll('select'), mudou = false;
  for (var si = 0; si < sels.length && !mudou; si++) {
    for (var oi = 0; oi < sels[si].options.length; oi++) {
      if (/outros/i.test(sels[si].options[oi].text)) {
        sels[si].value = sels[si].options[oi].value;
        sels[si].dispatchEvent(new Event('change', { bubbles: true }));
        mudou = true; break;
      }
    }
  }
  await delay(300);
  if (await searchPAGInPopup(pd, pagNr)) { await waitPopupClosed(6000); return true; }
  log('  ✗ PAG "' + pagNr + '" não encontrado', 'err');
  try {
    var closeBtn = pd.querySelector('input[type="image"][src*="fechar" i], input[type="image"][src*="close" i]') ||
                   pd.querySelector('img[onclick*="close" i], a[onclick*="close" i]');
    if (closeBtn) closeBtn.click();
  } catch (_) {}
  return false;
}

async function captureNrDoc() {
  var end = Date.now() + 15000;
  while (Date.now() < end) {
    var docs = allDocs();
    for (var di = 0; di < docs.length; di++) {
      try {
        var cells = docs[di].querySelectorAll('td, span, div, b, label');
        for (var ci = 0; ci < cells.length; ci++) {
          var txt = (cells[ci].textContent || '').trim();
          if (!/nr\.?\s*documento/i.test(txt)) continue;
          var m = txt.match(/nr\.?\s*documento\s+(\d[\d\.\/\-]{1,20})/i);
          if (m && m[1] !== '0') return m[1].trim();
          var next = cells[ci].nextElementSibling;
          if (next) {
            var v = (next.textContent || next.value || '').trim();
            if (v && v !== '0' && /\d/.test(v) && v.length < 30) return v;
          }
        }
      } catch (_) {}
    }
    await delay(200);
  }
  return '(verificar)';
}

// ── Fila ─────────────────────────────────────────────────────────────────────

function detectPage() {
  var body = document.body ? document.body.textContent : '';
  if (findEl('input[type="button"], button, a', 'Novo Subprocesso', true)) return 'list';
  if (/nr\.?\s*documento/i.test(body)) return 'form';
  // Frameset: o conteúdo está nos frames
  var docs = allDocs();
  for (var i = 1; i < docs.length; i++) {
    try { if (/nr\.?\s*documento/i.test(docs[i].body ? docs[i].body.textContent : '')) return 'form'; } catch (_) {}
  }
  return 'unknown';
}

async function startAutomation(items, config) {
  var state = {
    running: true, queue: items, current: 0, results: [], step: 'list',
    config: config || {}, inicio: Date.now(),
  };
  await saveState(state);
  setProgress(1, items.length);
  log('Iniciando com ' + items.length + ' subprocesso(s)…', 'ok');
  await executePage(state);
}

async function executePage(state) {
  if (!state || !state.running) return;
  var item = state.queue[state.current];
  if (!item) { await finalize(state); return; }
  setSub(item.numero + ' (' + (state.current + 1) + '/' + state.queue.length + ')');
  setProgress(state.current + 1, state.queue.length);
  if (state.step === 'list') await execListPage(state, item);
  else if (state.step === 'form') await execFormPage(state, item);
}

async function execListPage(state, item) {
  log('━━ [' + (state.current + 1) + '/' + state.queue.length + '] ' + item.numero);
  var btn = await waitEl('input[type="button"], button, a, input[type="submit"]', 'Novo Subprocesso', 12000, true);
  if (!btn) {
    log('  ✗ Botão "Novo Subprocesso" não encontrado — abra Documentos na Unidade', 'err');
    espelharProg({ running: false, sub: 'Parado: abra a lista "Documentos na Unidade" (botão Novo Subprocesso) e clique em Criar de novo' });
    await clearState();
    return;
  }
  state.step = 'form';
  await saveState(state);
  await descarregarLog();
  btn.click();
  // A página navega → o próximo carregamento lê o storage e segue no formulário
}

async function execFormPage(state, item) {
  log('  [form] Formulário carregado ✓');
  await delay(400);
  var nomeVal = item.nome;

  log('  [1] Nome: ' + nomeVal);
  var nomeEl = null;
  var docs = allDocs();
  outer:
  for (var di = 0; di < docs.length; di++) {
    var cells = docs[di].querySelectorAll('td, th, label, span, b');
    for (var ci = 0; ci < cells.length; ci++) {
      var ct = (cells[ci].textContent || '').trim().toLowerCase();
      if (ct !== 'nome' && ct !== 'nome:') continue;
      var next = cells[ci].nextElementSibling || (cells[ci].parentElement && cells[ci].parentElement.nextElementSibling);
      var inp = next ? (next.tagName === 'INPUT' ? next : next.querySelector('input[type="text"]')) : null;
      if (inp && !inp.readOnly) { nomeEl = inp; break outer; }
    }
    var inputs = docs[di].querySelectorAll('input[type="text"]');
    for (var ii = 0; ii < inputs.length; ii++) {
      if (!inputs[ii].readOnly && !inputs[ii].disabled) { nomeEl = inputs[ii]; break outer; }
    }
  }
  if (nomeEl) { fill(nomeEl, nomeVal); await delay(200); }
  else log('  ⚠ Campo Nome não encontrado', 'warn');

  log('  [2] Assunto…');
  var ta = findEl('textarea', null, true);
  if (ta) { fill(ta, nomeVal); await delay(200); }

  var epag = (state.config && state.config.epag) || 'GAP-MN';
  log('  [3] Unidade do ePAG → ' + epag + '…');
  var epagArrow = findArrowNear('epag', []) || findArrowNear('unidade do epag', []);
  if (!(await gxSelect(epagArrow, epag, epag, 'Sigla'))) log('  ⚠ ePAG não selecionado — verifique', 'warn');
  await delay(1000);

  log('  [4] PAG: ' + item.pag + '…');
  var pagArrow = findArrowNear('pag', ['epag', 'origem', 'uasg', 'unidade']);
  var pagOk = pagArrow ? await gxSelectPAG(pagArrow, item.pag) : false;
  if (!pagOk) {
    await avancar(state, item, { docNr: 'ERRO: PAG não encontrado', docs: [] }, 'erro');
    return;
  }
  await delay(800);

  log('  [5] Salvando…');
  var docs3 = allDocs();
  var isSaveBtn = function (el) {
    var src = (el.src || '').toLowerCase(), alt = (el.alt || el.title || el.value || '').toLowerCase();
    return /(\bok\b|okay|okay1|commit|check|salv|gravar|confirm|btn_ok|verde|certo|tick|confirma)/.test(src) ||
           /(\bok\b|salvar|gravar|confirmar|commit)/.test(alt);
  };
  var isCancelBtn = function (el) {
    return /(cancel|fechar|close|sair|exit|volta|discard|nao\b|desfaz|arrow|seta|lupa|binocul)/i.test((el.src || '').toLowerCase());
  };
  var saveBtn = null;
  for (var d3 = 0; d3 < docs3.length && !saveBtn; d3++) {
    var imgs3 = docs3[d3].querySelectorAll('input[type="image"]');
    for (var i3 = 0; i3 < imgs3.length; i3++) { if (isSaveBtn(imgs3[i3])) { saveBtn = imgs3[i3]; break; } }
    if (!saveBtn) {
      var btns3 = docs3[d3].querySelectorAll('input[type="button"],input[type="submit"],button');
      for (var b3 = 0; b3 < btns3.length; b3++) {
        if (/^(salvar|confirmar|gravar|ok|commit)$/.test((btns3[b3].value || btns3[b3].textContent || '').toLowerCase().trim())) { saveBtn = btns3[b3]; break; }
      }
    }
  }
  if (!saveBtn) {
    outer4:
    for (var d4 = 0; d4 < docs3.length; d4++) {
      var imgs4 = docs3[d4].querySelectorAll('input[type="image"]');
      for (var i4 = 0; i4 < imgs4.length; i4++) {
        if (!isCancelBtn(imgs4[i4])) { saveBtn = imgs4[i4]; log('  ⚠ Salvar (alternativo): ' + (saveBtn.src || '').split('/').pop(), 'warn'); break outer4; }
      }
    }
  }
  if (!saveBtn) {
    await avancar(state, item, { docNr: 'ERRO: botão salvar não encontrado', docs: [] }, 'erro');
    return;
  }

  // Estado ANTES do clique: se a página navegar, o próximo carregamento segue daqui
  var stateAssoc = Object.assign({}, state, { step: 'associar' });
  await saveState(stateAssoc);
  await descarregarLog();
  var saveUrl = '';
  try { saveUrl = docDe(saveBtn).location.href; } catch (_) {}
  var resp = await Promise.race([msg({ type: 'GAPMN_SAVE_FORM', frameUrl: saveUrl }), delay(3000)]);
  log('  ← salvar: ' + JSON.stringify(resp || {}));
  await execAssociarPage(stateAssoc, item);
}

async function execAssociarPage(state, item) {
  if (state.step !== 'associar') return;
  await delay(800);
  log('  [6] Capturando Nr. Documento…');
  var docNr = await captureNrDoc();
  log('  Nr. Documento: ' + docNr, 'ok');

  log('  [7] Associando fluxo…');
  await associarFluxo((state.config && state.config.fluxo) || 'SEO/ACI - SOLICITAÇÃO DE EMPENHO / APOIADAS');
  await waitPopupClosed(4000);
  await delay(500);

  var st = Object.assign({}, state, { step: 'documentos', docNr: docNr, docIdx: 0, docsRes: [] });
  await saveState(st);
  await execDocumentosPage(st, item);
}

async function associarFluxo(fluxoNome) {
  var assocBtn = await waitEl('input[type="button"], input[type="submit"], button, a, td', 'Associar Fluxo', 10000, true);
  if (!assocBtn) { log('  ⚠ Botão "Associar Fluxo" não encontrado', 'warn'); return; }
  var before = allDocs();
  var btnDoc = docDe(assocBtn);
  var oc = (assocBtn.getAttribute && assocBtn.getAttribute('onclick')) || '';
  if (oc) rodarNaPagina(btnDoc, 'try{' + oc + '}catch(e){console.error("[GAPMN assoc]",e);}');
  else await clicarNoMain(assocBtn);

  await delay(500);
  var pd = await waitPopup(10000, before);
  if (!pd) { log('  ⚠ Popup do fluxo não abriu', 'warn'); return; }
  await delay(500);
  var fluxoInp = pd.querySelector('input[type="text"]');
  if (fluxoInp) { fill(fluxoInp, fluxoNome); await delay(300); }
  clickSearchBtn(pd);
  await delay(2000);
  if (injectClickByText(pd, fluxoNome)) { log('  Fluxo associado ✓', 'ok'); await delay(800); return; }
  var rows = pd.querySelectorAll('a, tr');
  for (var ri = 0; ri < rows.length; ri++) {
    var rt = (rows[ri].textContent || '').toLowerCase();
    if (rt.indexOf('seo/aci') !== -1 && rt.indexOf('empenho') !== -1) {
      (rows[ri].tagName === 'TR' ? (rows[ri].querySelector('a') || rows[ri]) : rows[ri]).click();
      log('  Fluxo associado ✓ (alternativo)', 'ok');
      await delay(800);
      return;
    }
  }
  log('  ⚠ Fluxo não encontrado no popup — associe manualmente', 'warn');
}

// ── Documentos: PDF da solicitação e da declaração do SICAF ──────────────────

// Botão que abre a inclusão de documento no subprocesso (nome exato ainda a
// confirmar no SILOMS real: procura pelos textos usuais e registra os botões da tela)
var RX_BOTAO_DOC = /(incluir|inserir|anexar|adicionar|novo|upload)\s*(de\s+)?(documento|arquivo|anexo|doc\b)|^anexar$|^anexos?$/i;

function textoDe(el) {
  return String(el.value || el.textContent || el.alt || el.title || '').replace(/\s+/g, ' ').trim();
}

function botoesDaTela(incluirPopup) {
  var lista = [];
  allDocs().forEach(function (d) {
    if (!incluirPopup) { try { if (/gxPopupLevel|GxPopup/i.test(d.location.href)) return; } catch (_) {} }
    try {
      d.querySelectorAll('input[type="button"], input[type="submit"], button, a, td[onclick], span[onclick], input[type="image"], img[onclick]')
        .forEach(function (el) { lista.push(el); });
    } catch (_) {}
  });
  return lista;
}

function acharBotaoDocumento() {
  var botoes = botoesDaTela(false);
  for (var i = 0; i < botoes.length; i++) {
    var t = textoDe(botoes[i]);
    if (/novo\s+subprocesso/i.test(t)) continue;
    var arq = String(botoes[i].src || '').split('/').pop();
    if (RX_BOTAO_DOC.test(t) || /incluir_?doc|anexar|upload/i.test(arq)) return botoes[i];
  }
  return null;
}

function listarBotoes(titulo) {
  log('  ── ' + titulo + ' ──');
  var vistos = {};
  botoesDaTela(true).slice(0, 80).forEach(function (el) {
    var t = textoDe(el).slice(0, 50);
    var arq = String(el.src || '').split('/').pop();
    var rotulo = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.name ? '[' + el.name + ']' : '') +
      (t ? ' "' + t + '"' : '') + (arq ? ' ' + arq : '');
    if (vistos[rotulo] || (!t && !arq)) return;
    vistos[rotulo] = true;
    log('  · ' + rotulo);
  });
}

function camposDe(pd) {
  var out = [];
  pd.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach(function (el) {
    var tr = el.closest ? el.closest('tr') : null;
    var rot = tr ? (tr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    out.push(el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : '') + (el.id ? '#' + el.id : '') +
      (el.name ? ' name=' + el.name : '') + (rot ? ' "' + rot + '"' : ''));
  });
  return out;
}

function arquivosNaTela() {
  var out = [];
  allDocs().forEach(function (d) { try { d.querySelectorAll('input[type="file"]').forEach(function (i) { out.push(i); }); } catch (_) {} });
  return out;
}

function acharAssunto(pd) {
  var rotulos = pd.querySelectorAll('td, th, label, span, b, div');
  for (var i = 0; i < rotulos.length; i++) {
    if (!/^assunto\s*:?$/i.test((rotulos[i].textContent || '').trim())) continue;
    var prox = rotulos[i].nextElementSibling || (rotulos[i].parentElement && rotulos[i].parentElement.nextElementSibling);
    var campo = prox ? (/^(TEXTAREA|INPUT)$/.test(prox.tagName) ? prox : prox.querySelector('textarea, input[type="text"]')) : null;
    if (campo && !campo.readOnly && !campo.disabled) return campo;
  }
  var areas = pd.querySelectorAll('textarea');
  for (var a = 0; a < areas.length; a++) if (!areas[a].readOnly && !areas[a].disabled) return areas[a];
  return null;
}

// Campo pelo rótulo da linha ("Nome do Documento", "Data de Elaboração"…): o campo
// fica na mesma linha (tr) do rótulo ou logo depois dele
function campoPorRotulo(pd, rx, seletor) {
  var rotulos = pd.querySelectorAll('td, th, label, span, b, div, font');
  for (var i = 0; i < rotulos.length; i++) {
    var t = (rotulos[i].textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length > 45 || !rx.test(t)) continue;
    var campo = null;
    var tr = rotulos[i].closest ? rotulos[i].closest('tr') : null;
    if (tr) {
      var lista = tr.querySelectorAll(seletor);
      if (lista.length === 1) campo = lista[0];
    }
    if (!campo) {
      var prox = rotulos[i].nextElementSibling || (rotulos[i].parentElement && rotulos[i].parentElement.nextElementSibling);
      if (prox) campo = prox.matches && prox.matches(seletor) ? prox : prox.querySelector(seletor);
    }
    if (campo && !campo.disabled && !campo.readOnly) return campo;
  }
  return null;
}

function hojeBR(curto) {
  var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + (curto ? String(d.getFullYear()).slice(2) : d.getFullYear());
}

// Campos obrigatórios da janela de inclusão: Nome do Documento, Data de Elaboração e
// Tipo de Documento (Sigilo e Tipo de Conferência ficam no padrão: OSTENSIVO / ORIGINAL)
function preencherCabecalhoDoc(pd, doc) {
  var nome = campoPorRotulo(pd, /^nome\s+do\s+documento\s*:?$/i, 'input[type="text"], input:not([type])');
  if (nome) { fill(nome, String(doc.nome || doc.assunto).slice(0, nome.maxLength > 0 ? nome.maxLength : 100)); log('    Nome do Documento: ' + nome.value, 'ok'); }
  else log('    ⚠ Campo "Nome do Documento" não encontrado', 'warn');

  var data = campoPorRotulo(pd, /^data\s+de\s+elabora/i, 'input[type="text"], input:not([type])');
  if (data && !/\d/.test(data.value || '')) { fill(data, hojeBR(data.maxLength > 0 && data.maxLength <= 8)); log('    Data de Elaboração: ' + data.value, 'ok'); }

  var tipo = campoPorRotulo(pd, /^tipo\s+de\s+documento\s*:?$/i, 'select');
  if (!tipo) return;
  var opcoes = Array.prototype.map.call(tipo.options, function (o) { return o.text.trim(); });
  var rx = doc.tipo === 'sicaf' ? /sicaf|declara|certid|regularidade|habilita/i : /solicita|empenho|requisi/i;
  var escolher = function (re) {
    for (var i = 0; i < tipo.options.length; i++) if (re.test(tipo.options[i].text)) { tipo.selectedIndex = i; return true; }
    return false;
  };
  if (escolher(rx) || escolher(/^outros?\b|diversos|anexo/i)) {
    tipo.dispatchEvent(new Event('change', { bubbles: true }));
    log('    Tipo de Documento: ' + tipo.options[tipo.selectedIndex].text.trim(), 'ok');
  } else {
    log('    ⚠ Tipo de Documento sem opção que combine: ' + opcoes.slice(0, 15).join(' | '), 'warn');
  }
}

// alert() do SILOMS ("Nome do documento é obrigatório."): guarda o texto em vez de
// travar a janela (vale 60 s, em todas as molduras da tela)
function capturarAlertas() {
  allDocs().forEach(function (d) {
    try { d.documentElement.removeAttribute('data-gapmn-alerta'); } catch (_) {}
    rodarNaPagina(d,
      'var w=window,o=w.alert;w.alert=function(m){document.documentElement.setAttribute("data-gapmn-alerta",String(m==null?"":m));};' +
      'setTimeout(function(){w.alert=o;},60000);');
  });
}
function alertaCapturado() {
  var docs = allDocs();
  for (var i = 0; i < docs.length; i++) {
    try { var a = docs[i].documentElement.getAttribute('data-gapmn-alerta'); if (a) return a; } catch (_) {}
  }
  return null;
}

function acharConfirmar(pd) {
  var el = pd.querySelector('#IMAGE2') || pd.querySelector('input[type="image"][src*="okay" i]') ||
           pd.querySelector('input[type="image"][src*="confirm" i]');
  if (el) return el;
  var botoes = pd.querySelectorAll('input[type="button"], input[type="submit"], button');
  for (var i = 0; i < botoes.length; i++) {
    if (/^(confirmar|salvar|gravar|incluir|ok|enviar)$/i.test(textoDe(botoes[i]))) return botoes[i];
  }
  return null;
}

async function inserirDocumento(item, doc) {
  if (!doc.disponivel) return { status: 'faltou', motivo: 'PDF não estava guardado no robô' };

  var botao = acharBotaoDocumento();
  if (!botao) {
    listarBotoes('botões na tela (inclusão de documento não encontrada)');
    return { status: 'erro', motivo: 'botão de inserir documento não encontrado — veja a lista de botões no log' };
  }
  log('    Botão: ' + textoDe(botao).slice(0, 40) + ' ' + String(botao.src || '').split('/').pop());

  var antes = arquivosNaTela();
  await clicarNoMain(botao);
  var campoArq = null, pd = null, fim = Date.now() + 15000;
  while (Date.now() < fim && !campoArq) {
    var agora = arquivosNaTela();
    for (var i = 0; i < agora.length; i++) {
      if (antes.indexOf(agora[i]) === -1) { campoArq = agora[i]; break; }
    }
    if (!campoArq) await delay(300);
  }
  if (!campoArq) {
    listarBotoes('botões depois do clique (a janela de inclusão não abriu)');
    return { status: 'erro', motivo: 'a janela de inclusão de documento não abriu' };
  }
  pd = campoArq.ownerDocument;
  await delay(800);
  log('    Janela de inclusão aberta — campos: ' + camposDe(pd).join(' ; ').slice(0, 400));

  capturarAlertas();
  preencherCabecalhoDoc(pd, doc);
  await delay(200);
  var assunto = acharAssunto(pd);
  if (assunto) { fill(assunto, doc.assunto); await delay(200); }
  else log('    ⚠ Campo Assunto não encontrado', 'warn');

  var marca = 'ga' + Date.now() + Math.random().toString(36).slice(2, 7);
  campoArq.setAttribute('data-gapmn-arquivo', marca);
  var r = await msg({ type: 'SUBPROC_SET_FILE', chave: doc.chave, nome: doc.arquivo, alvo: marca });
  if (!r.ok) return { status: 'erro', motivo: 'não consegui colocar o arquivo: ' + (r.erro || r.result || '?') };
  log('    Arquivo ' + doc.arquivo + ' colocado (' + (r.result || '') + ')');
  await delay(800);

  var confirmar = acharConfirmar(pd);
  if (!confirmar) return { status: 'erro', motivo: 'botão de confirmar não encontrado na janela de inclusão' };
  await descarregarLog();
  await clicarNoMain(confirmar);

  // Fechou a janela (o campo de arquivo saiu da tela) = documento incluído. Um aviso do
  // SILOMS (campo obrigatório etc.) volta como erro, com os campos da janela no log.
  fim = Date.now() + 20000;
  while (Date.now() < fim) {
    await delay(500);
    var alerta = alertaCapturado();
    if (alerta) {
      log('    Campos da janela: ' + camposDe(pd).join(' ; ').slice(0, 500), 'warn');
      return { status: 'erro', motivo: 'o SILOMS recusou: "' + alerta.replace(/\s+/g, ' ').trim().slice(0, 160) + '"' };
    }
    var aberto = false;
    try { aberto = campoArq.isConnected && arquivosNaTela().indexOf(campoArq) !== -1; } catch (_) {}
    if (!aberto) return { status: 'ok' };
  }
  return { status: 'conferir', motivo: 'a janela de inclusão não fechou — confira no SILOMS se o arquivo entrou' };
}

async function execDocumentosPage(state, item) {
  var docs = item.docs || [];
  var res = (state.docsRes || []).slice();
  for (var i = state.docIdx || 0; i < docs.length; i++) {
    log('  [8.' + (i + 1) + '] Inserindo ' + docs[i].rotulo + '…');
    setSub(item.numero + ' — inserindo ' + docs[i].rotulo);
    // Antes de confirmar: se a página recarregar, o próximo carregamento segue do próximo documento
    var provisorio = res.concat([{ tipo: docs[i].tipo, status: 'enviado', motivo: 'a página recarregou ao confirmar — confira no SILOMS' }]);
    await saveState(Object.assign({}, state, { docIdx: i + 1, docsRes: provisorio }));
    var r = await inserirDocumento(item, docs[i]);
    res.push(Object.assign({ tipo: docs[i].tipo }, r));
    log('    ' + docs[i].rotulo + ': ' + (r.status === 'ok' ? 'inserido ✓' : r.status + (r.motivo ? ' — ' + r.motivo : '')),
        r.status === 'ok' ? 'ok' : r.status === 'faltou' ? 'warn' : 'err');
    await saveState(Object.assign({}, state, { docIdx: i + 1, docsRes: res }));
    await delay(800);
  }
  await avancar(state, item, { docNr: state.docNr, docs: res }, 'ok');
}

// ── Próximo item ─────────────────────────────────────────────────────────────

async function avancar(state, item, r, tipo) {
  var resultado = {
    numero: item.numero, pag: item.pag, docNr: r.docNr, responsavel: item.responsavel || '', ne: item.ne || '',
    docs: r.docs || [],
  };
  if (tipo === 'erro') log('  ✗ ' + r.docNr.replace(/^ERRO:\s*/, '') + ' — seguindo para o próximo', 'err');
  var results = (state.results || []).concat([resultado]);
  var next = state.current + 1;
  if (next >= state.queue.length) {
    var fs = Object.assign({}, state, { running: false, results: results, step: 'done' });
    await saveState(fs);
    await finalize(fs);
    return;
  }
  var ns = { running: true, queue: state.queue, current: next, results: results, step: 'list', config: state.config, inicio: state.inicio };
  await saveState(ns);
  log('  Voltando à lista…');
  await descarregarLog();
  voltarParaLista(tipo === 'erro');
}

// Depois de salvar: botão vermelho de sair do subprocesso; com erro no formulário
// (nada salvo): direto pelo menu "Documentos na Unidade" — como no robô antigo
function voltarParaLista(peloMenu) {
  var docs = allDocs();
  for (var d = 0; d < docs.length && !peloMenu; d++) {
    try {
      var imgs = docs[d].querySelectorAll('input[type="image"]');
      for (var i = 0; i < imgs.length; i++) {
        if (/(cancel|sair|fechar|close|exit|voltar|volta\b|back\b|return)/i.test((imgs[i].src || '').toLowerCase())) { imgs[i].click(); return; }
      }
    } catch (_) {}
  }
  for (var d2 = 0; d2 < docs.length; d2++) {
    try {
      var lks = docs[d2].querySelectorAll('a[href], a[onclick], td[onclick]');
      for (var l = 0; l < lks.length; l++) {
        if ((lks[l].textContent || '').toLowerCase().indexOf('documentos na unidade') !== -1) { lks[l].click(); return; }
      }
    } catch (_) {}
  }
  var ml = findEl('a, td, span', 'Documentos na Unidade', true);
  if (ml) { ml.click(); return; }
  log('  ⚠ Não achei como voltar à lista — clique em "Documentos na Unidade"', 'warn');
}

async function finalize(state) {
  var res = state.results || [];
  var ok = res.filter(function (r) { return !String(r.docNr).startsWith('ERRO'); }).length;
  var docsOk = res.reduce(function (s, r) { return s + (r.docs || []).filter(function (d) { return d.status === 'ok'; }).length; }, 0);
  log('━━ Concluído! ' + ok + ' de ' + res.length + ' subprocesso(s) criado(s), ' + docsOk + ' documento(s) inserido(s).', 'ok');
  await descarregarLog();
  var o = {}; o[RESULT_KEY] = { ts: Date.now(), results: res };
  await new Promise(function (r) { chrome.storage.local.set(o, r); });
  espelharProg({ running: false, concluido: true, sub: 'Concluído: ' + ok + ' de ' + res.length + ' subprocesso(s), ' + docsOk + ' documento(s) inserido(s)' });
  // Planilha de controle (a mesma do robô antigo), se o painel tiver o endereço
  if (state.config && state.config.planilha) {
    var r = await msg({
      type: 'SUBPROC_GSHEET', url: state.config.planilha,
      corpo: { acao: 'addSubprocessos', dataHora: new Date().toLocaleString('pt-BR'),
        dados: res.map(function (x) { return { numero: x.numero, pag: x.pag, docNr: x.docNr, responsavel: x.responsavel }; }) },
    });
    log(r.ok ? 'Dados enviados à planilha ✓' : 'Aviso planilha: ' + (r.erro || '?'), r.ok ? 'ok' : 'warn');
    await descarregarLog();
  }
  await clearState();
}

// ── Entrada (cada carregamento de página) ────────────────────────────────────

chrome.runtime.onMessage.addListener(function (m, sender, sendResponse) {
  if (!m || typeof m.type !== 'string' || m.type.indexOf('SUBPROC_') !== 0) return false;
  if (m.type === 'SUBPROC_PING') {
    readState().then(function (s) { sendResponse({ ok: true, pagina: detectPage(), running: !!(s && s.running), url: location.href }); });
    return true;
  }
  if (m.type === 'SUBPROC_INICIAR') {
    readState().then(async function (s) {
      if (s && s.running) { sendResponse({ ok: false, erro: 'Já há subprocessos sendo criados nesta aba' }); return; }
      if (detectPage() !== 'list') {
        sendResponse({ ok: false, erro: 'Abra no SILOMS a lista "Documentos na Unidade" (a que tem o botão Novo Subprocesso)' });
        return;
      }
      var o = {}; o[LOG_KEY] = []; o[RESULT_KEY] = null;
      chrome.storage.local.set(o);
      sendResponse({ ok: true });
      startAutomation(m.items || [], m.config || {}).catch(function (e) {
        log('Erro: ' + e.message, 'err');
        espelharProg({ running: false, sub: 'Erro: ' + e.message });
      });
    });
    return true;
  }
  if (m.type === 'SUBPROC_ABORTAR') {
    clearState().then(function () {
      log('Parado pelo usuário.', 'warn');
      descarregarLog();
      espelharProg({ running: false, concluido: false, sub: 'Parado pelo usuário' });
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});

async function main() {
  var state = await readState();
  if (!state || !state.running) return;
  var item = state.queue[state.current];
  setProgress(state.current + 1, state.queue.length);
  if (item) setSub(item.numero + ' (' + (state.current + 1) + '/' + state.queue.length + ')');
  var page = detectPage();
  log('Página: ' + page + ' | Etapa: ' + state.step + ' | Item: ' + (item ? item.numero : '—'));
  if (state.step === 'list' && page === 'list') { await delay(300); await execListPage(state, item); }
  else if (state.step === 'form' && page === 'form') { await delay(400); await execFormPage(state, item); }
  else if (state.step === 'associar') { await delay(500); await execAssociarPage(state, item); }
  else if (state.step === 'documentos') { await delay(800); await execDocumentosPage(state, item); }
  else if (state.step === 'done') { await finalize(state); }
  else log('Aguardando a página certa (etapa ' + state.step + ', página ' + page + ')…', 'warn');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(main, 800); });
else setTimeout(main, 800);
})();
