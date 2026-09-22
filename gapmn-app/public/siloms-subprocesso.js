// siloms-subprocesso.js — Criador de Subprocessos SILOMS v3
// Popup SILOMS = iframe GeneXus (gxp0_ifrm) embutido na mesma página, NÃO window.open().
// Bookmarklet: javascript:(function(){var top=window.top||window;if(top.document.getElementById('__sspPanel__')){top.document.getElementById('__sspPanel__').remove();return;}var s=top.document.createElement('script');s.src='https://gapmn.app/siloms-subprocesso.js?v='+Date.now();top.document.body.appendChild(s);})();
(function (W, D) {
  'use strict';

  var PANEL_ID   = '__sspPanel__';
  var GSHEET_URL = 'https://script.google.com/macros/s/AKfycbwoOq1T7CgvCVMBDlgW9iepeJKWzcmg-ZruM5Ct2qBbMN7vrInAk4bkWfperulUxXw6/exec';
  var FLUXO_NOME = 'SEO/ACI - SOLICITAÇÃO DE EMPENHO / APOIADAS';

  // ── Painel UI ─────────────────────────────────────────────────────────────
  var panel = D.createElement('div');
  panel.id  = PANEL_ID;
  panel.style.cssText = [
    'position:fixed;bottom:16px;right:16px;width:390px;max-height:92vh',
    'background:#0f172a;color:#e2e8f0',
    'border:1px solid #334155;border-radius:12px',
    'font:12px/1.5 system-ui,sans-serif',
    'z-index:2147483647;box-shadow:0 8px 32px rgba(0,0,0,.85)',
    'overflow:hidden;display:flex;flex-direction:column'
  ].join(';');

  panel.innerHTML = [
    '<div style="padding:10px 14px;background:#0f172a;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">',
      '<div>',
        '<div style="font-weight:700;color:#60a5fa;font-size:13px">📋 Criador de Subprocessos</div>',
        '<div id="__ssp_sub__" style="font-size:10px;color:#475569">Aguardando planilha…</div>',
      '</div>',
      '<button id="__ssp_close__" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;padding:0 2px;line-height:1">×</button>',
    '</div>',
    '<div style="flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px">',
      '<div id="__ssp_import__">',
        '<p style="color:#94a3b8;font-size:11px;margin-bottom:8px">',
          'Coluna <b style="color:#60a5fa">A</b> = Nº Solicitação &nbsp;|&nbsp; Coluna <b style="color:#60a5fa">J</b> = PAG',
        '</p>',
        '<div id="__ssp_drop__" style="border:2px dashed #334155;border-radius:8px;padding:18px;text-align:center;cursor:pointer;color:#64748b;font-size:11px;transition:border-color .2s">',
          '📎 Clique aqui ou arraste o arquivo .xlsx',
          '<input type="file" id="__ssp_file__" accept=".xlsx,.xls" style="display:none">',
        '</div>',
        '<div id="__ssp_preview__" style="display:none;margin-top:8px">',
          '<div id="__ssp_list__" style="background:#1e293b;border-radius:6px;padding:8px;font-size:10px;color:#94a3b8;max-height:110px;overflow-y:auto;margin-bottom:8px"></div>',
          '<button id="__ssp_start__" style="width:100%;padding:9px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">▶ Iniciar criação dos subprocessos</button>',
        '</div>',
      '</div>',
      '<div id="__ssp_prog__" style="display:none">',
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">',
          '<span id="__ssp_pt__" style="font-size:10px;color:#94a3b8">0/0</span>',
          '<button id="__ssp_pause__" style="font-size:10px;padding:2px 8px;background:#78350f;color:#fcd34d;border:none;border-radius:4px;cursor:pointer">⏸ Pausar</button>',
        '</div>',
        '<div style="background:#1e293b;border-radius:3px;height:5px;overflow:hidden">',
          '<div id="__ssp_bar__" style="height:100%;background:#2563eb;width:0%;transition:width .3s"></div>',
        '</div>',
      '</div>',
      '<div id="__ssp_log__" style="background:#0a0f1a;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;min-height:80px;max-height:280px;overflow-y:auto;font-family:monospace;font-size:10px;line-height:1.7;flex:1"></div>',
    '</div>',
  ].join('');

  D.body.appendChild(panel);
  function g(id) { return D.getElementById(id); }
  var logEl = g('__ssp_log__');
  g('__ssp_close__').onclick = function () { panel.remove(); };

  // ── Log ──────────────────────────────────────────────────────────────────
  function log(msg, lvl) {
    var c = { info:'#cbd5e1', ok:'#4ade80', warn:'#fcd34d', err:'#f87171' };
    var d = D.createElement('div');
    d.style.color = c[lvl] || c.info;
    var ts = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    d.textContent = '[' + ts + '] ' + msg;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setSub(t) { g('__ssp_sub__').textContent = t; }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ── Travessia de frames ───────────────────────────────────────────────────
  // Retorna todos os {win, doc} acessíveis: top + todos os frames/iframes recursivos
  function allCtx() {
    var list = [];
    function walk(win) {
      try {
        if (win.document && win.document.body) list.push({ win: win, doc: win.document });
        var n = win.frames ? win.frames.length : 0;
        for (var i = 0; i < n; i++) { try { walk(win.frames[i]); } catch (_) {} }
      } catch (_) {}
    }
    walk(W);
    return list;
  }

  // Retorna o contexto do popup GeneXus aberto (iframe cujo URL tem 'gxPopupLevel' ou 'Popup')
  function getPopupCtx() {
    var ctxs = allCtx();
    for (var ci = 0; ci < ctxs.length; ci++) {
      try {
        var url = ctxs[ci].win.location.href;
        if (/gxPopupLevel|GxPopup|Popup/i.test(url) && ctxs[ci].doc.body) {
          // Verifica se tem conteúdo (mais de 1 elemento no body)
          if (ctxs[ci].doc.body.children.length > 0) return ctxs[ci];
        }
      } catch (_) {}
    }
    return null;
  }

  // Aguarda popup GeneXus aparecer (depois de clicar seta ↑)
  async function waitForPopup(ms) {
    var end = Date.now() + (ms || 12000);
    while (Date.now() < end) {
      var p = getPopupCtx();
      if (p) return p;
      await delay(300);
    }
    return null;
  }

  // Busca elemento em todos os frames (exceto popups, se excludePopup=true)
  function findEl(sels, textMatch, excludePopup) {
    if (typeof sels === 'string') sels = [sels];
    var ctxs = allCtx();
    for (var ci = 0; ci < ctxs.length; ci++) {
      var c = ctxs[ci];
      if (excludePopup) {
        try {
          var url = c.win.location.href;
          if (/gxPopupLevel|GxPopup|Popup/i.test(url)) continue;
        } catch (_) {}
      }
      for (var si = 0; si < sels.length; si++) {
        try {
          var els = c.doc.querySelectorAll(sels[si]);
          for (var ei = 0; ei < els.length; ei++) {
            var el = els[ei];
            if (!textMatch) return { el: el, ctx: c };
            var txt = (el.value || el.textContent || el.innerText || '');
            if (txt.toLowerCase().indexOf(textMatch.toLowerCase()) !== -1) return { el: el, ctx: c };
          }
        } catch (_) {}
      }
    }
    return null;
  }

  function waitForEl(sels, textMatch, ms, excludePopup) {
    var end = Date.now() + (ms || 20000);
    return new Promise(function (res, rej) {
      (function poll() {
        var f = findEl(sels, textMatch, excludePopup);
        if (f) return res(f);
        if (Date.now() > end) return rej(new Error('Timeout: ' + (typeof sels === 'string' ? sels : sels[0]) + (textMatch ? ' "' + textMatch + '"' : '')));
        setTimeout(poll, 400);
      })();
    });
  }

  // Preenche input com eventos nativos (compatível com GeneXus)
  function fill(el, value, ctx) {
    try { el.focus(); } catch (_) {}
    try {
      var win = (ctx && ctx.win) || W;
      var proto = (win.HTMLInputElement || HTMLInputElement).prototype;
      var descr = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descr && descr.set) descr.set.call(el, value);
      else el.value = value;
    } catch (_) { try { el.value = value; } catch (__) {} }
    ['input', 'change', 'blur'].forEach(function (ev) {
      try { el.dispatchEvent(new Event(ev, { bubbles: true })); } catch (_) {}
    });
  }

  // ── Popup GeneXus (iframe embutido) ───────────────────────────────────────
  // SILOMS usa popup = div overlay + iframe (gxp0_ifrm), NÃO window.open().
  // A URL do iframe contém 'gxPopupLevel'.
  async function gxPopupSelect(arrowEl, searchTerm, displayTerm) {
    // 1. Clica na seta ↑ (abre overlay GeneXus)
    arrowEl.click();
    log('    Aguardando popup GeneXus…');

    // 2. Aguarda iframe do popup carregar
    var popCtx = await waitForPopup(12000);
    if (!popCtx) {
      log('    ⚠ Popup não carregou — preencha manualmente', 'warn');
      return false;
    }
    log('    Popup carregado ✓');
    await delay(500);

    // 3. Preenche campo de pesquisa no popup
    //    GeneXus popup de lookup tem um ou mais inputs de filtro
    var searchInp = popCtx.doc.querySelector('input[type="text"], input:not([type])');
    if (searchInp) {
      fill(searchInp, searchTerm, popCtx);
      await delay(200);
    }

    // 4. Clica no botão de pesquisa (input image ou button)
    var searchBtn = popCtx.doc.querySelector(
      'input[type="image"], input[type="submit"], input[type="button"][value*="Pesq" i], button'
    );
    if (searchBtn) { searchBtn.click(); await delay(1500); }

    // 5. Clica no resultado que contém displayTerm
    var rows = popCtx.doc.querySelectorAll('tr, a, td[onclick], span[onclick]');
    for (var ri = 0; ri < rows.length; ri++) {
      var rowTxt = (rows[ri].textContent || rows[ri].value || '').toLowerCase();
      if (rowTxt.indexOf(displayTerm.toLowerCase()) === -1) continue;
      // Prefere link/button dentro da row; fallback: a row em si
      var target = (rows[ri].tagName === 'TR')
        ? (rows[ri].querySelector('a, input[type="button"], td[onclick]') || rows[ri])
        : rows[ri];
      target.click();
      log('    "' + displayTerm + '" selecionado ✓', 'ok');
      await delay(800);
      return true;
    }
    log('    ⚠ "' + displayTerm + '" não encontrado no popup', 'warn');
    return false;
  }

  // Encontra seta ↑ (input[type=image] ou img) próxima a um rótulo com keyword
  function findArrowNear(labelKeyword, excludeWords) {
    excludeWords = excludeWords || [];
    var ctxs = allCtx();
    for (var ci = 0; ci < ctxs.length; ci++) {
      var c = ctxs[ci];
      try {
        // Pular o popup (seta está na página principal, não no popup)
        var url = c.win.location.href;
        if (/gxPopupLevel|GxPopup|Popup/i.test(url)) continue;
      } catch (_) {}
      try {
        var cells = c.doc.querySelectorAll('td, th, label, span, div, b');
        for (var li = 0; li < cells.length; li++) {
          var txt = (cells[li].textContent || '').trim().toLowerCase();
          if (txt.indexOf(labelKeyword.toLowerCase()) === -1 || txt.length > 60) continue;
          var skip = excludeWords.some(function(w) { return txt.indexOf(w) !== -1; });
          if (skip) continue;

          var row = cells[li].closest ? cells[li].closest('tr') : cells[li].parentElement;
          if (!row) row = cells[li].parentElement;
          var arrows = (row || c.doc).querySelectorAll(
            'input[type="image"], img[src*="seta" i], img[src*="arrow" i], img[src*="lupa" i], img[onclick]'
          );
          if (arrows.length) return { el: arrows[0], ctx: c };
        }
      } catch (_) {}
    }
    return null;
  }

  // ── Botão salvar (check verde GeneXus) ────────────────────────────────────
  function findSaveBtn() {
    var ctxs = allCtx();
    for (var ci = 0; ci < ctxs.length; ci++) {
      var c = ctxs[ci];
      try {
        var url = c.win.location.href;
        if (/gxPopupLevel|GxPopup|Popup/i.test(url)) continue;
      } catch (_) {}
      try {
        var imgs = c.doc.querySelectorAll('input[type="image"]');
        for (var ii = 0; ii < imgs.length; ii++) {
          var src = (imgs[ii].src || '').toLowerCase();
          var alt = (imgs[ii].alt || imgs[ii].title || '').toLowerCase();
          // GeneXus commit buttons: check, ok, commit, gravar, salvar, v.gif, btn_v
          if (/check|commit|ok_|_ok|salv|gravar|btn_v|v\.gif|confirmar/.test(src) ||
              /salvar|gravar|ok|confirmar/.test(alt)) {
            return { el: imgs[ii], ctx: c };
          }
        }
        var btns = c.doc.querySelectorAll('input[type="button"],input[type="submit"],button');
        for (var bi = 0; bi < btns.length; bi++) {
          var v = (btns[bi].value || btns[bi].textContent || '').toLowerCase();
          if (/salvar|confirmar|gravar|\bok\b/.test(v)) return { el: btns[bi], ctx: c };
        }
      } catch (_) {}
    }
    return null;
  }

  // Busca input adjacente a rótulo (excluindo popups)
  function findByLabel(keyword, excludeWords) {
    excludeWords = excludeWords || [];
    var ctxs = allCtx();
    for (var ci = 0; ci < ctxs.length; ci++) {
      var c = ctxs[ci];
      try {
        var url = c.win.location.href;
        if (/gxPopupLevel|GxPopup|Popup/i.test(url)) continue;
      } catch (_) {}
      try {
        var cells = c.doc.querySelectorAll('td, th, label, span, div, b');
        for (var li = 0; li < cells.length; li++) {
          var cellTxt = (cells[li].textContent || '').trim().toLowerCase();
          if (cellTxt.indexOf(keyword.toLowerCase()) === -1 || cellTxt.length > 50) continue;
          var skip = excludeWords.some(function(w) { return cellTxt.indexOf(w) !== -1; });
          if (skip) continue;

          var candidates = [
            cells[li].nextElementSibling,
            cells[li].parentElement && cells[li].parentElement.nextElementSibling,
          ];
          for (var ki = 0; ki < candidates.length; ki++) {
            if (!candidates[ki]) continue;
            var inp = candidates[ki].tagName === 'INPUT' ? candidates[ki] :
                      candidates[ki].tagName === 'TEXTAREA' ? candidates[ki] : null;
            if (!inp) inp = candidates[ki].querySelector('input[type="text"], input:not([type]), textarea');
            if (inp && !inp.readOnly && !inp.disabled) return { el: inp, ctx: c };
          }
        }
        // Fallback: name/id
        var inputs = c.doc.querySelectorAll('input[type="text"], input:not([type]), textarea');
        for (var ii = 0; ii < inputs.length; ii++) {
          var name = (inputs[ii].name || inputs[ii].id || '').toLowerCase();
          if (name.indexOf(keyword.toLowerCase()) === -1 || inputs[ii].readOnly || inputs[ii].disabled) continue;
          var skipThis = excludeWords.some(function(w) { return name.indexOf(w) !== -1; });
          if (!skipThis) return { el: inputs[ii], ctx: c };
        }
      } catch (_) {}
    }
    return null;
  }

  // ── Captura Nr. Documento ──────────────────────────────────────────────────
  async function captureNrDoc() {
    var end = Date.now() + 15000;
    var previous = '0';
    while (Date.now() < end) {
      var ctxs = allCtx();
      for (var ci = 0; ci < ctxs.length; ci++) {
        var c = ctxs[ci];
        try {
          if (/gxPopupLevel|GxPopup|Popup/i.test(c.win.location.href)) continue;
        } catch (_) {}
        try {
          var cells = c.doc.querySelectorAll('td, span, div, label, b, strong');
          for (var li = 0; li < cells.length; li++) {
            var txt = (cells[li].textContent || '').trim();
            if (!/nr\.?\s*documento/i.test(txt)) continue;
            // Extrai número do texto da própria célula: "Nr. Documento 12345"
            var m = txt.match(/nr\.?\s*documento\s+(\d[\d\.\-\/]{1,25})/i);
            if (m && m[1] !== '0') return m[1].trim();
            // Verifica próximo irmão
            var next = cells[li].nextElementSibling;
            if (next) {
              var v = (next.value || next.textContent || '').trim();
              if (v && v !== '0' && /\d/.test(v) && v.length < 30) return v;
            }
          }
        } catch (_) {}
      }
      await delay(500);
    }
    return '(verificar manualmente)';
  }

  // ── Associar Fluxo ────────────────────────────────────────────────────────
  async function associarFluxo() {
    // Clica "Associar Fluxo"
    var btn = await waitForEl(
      ['input[type="button"]', 'input[type="submit"]', 'button', 'a', 'input[type="image"]'],
      'Associar Fluxo', 12000, true  // excludePopup = true
    );
    btn.el.click();
    log('  [8a] Aguardando popup de fluxos…');
    await delay(1500);

    // Verifica se abriu popup GeneXus ou carregou nova página
    var popCtx = await waitForPopup(8000);

    if (popCtx) {
      // Modo popup GeneXus
      log('  [8b] Pesquisando fluxo no popup…');
      var sinp = popCtx.doc.querySelector('input[type="text"], input:not([type])');
      if (sinp) { fill(sinp, 'SEO/ACI', popCtx); await delay(300); }
      var sbtn = popCtx.doc.querySelector('input[type="image"], input[type="submit"], input[type="button"], button');
      if (sbtn) { sbtn.click(); await delay(1500); }

      var rows = popCtx.doc.querySelectorAll('tr, a, td[onclick]');
      var found = false;
      for (var ri = 0; ri < rows.length; ri++) {
        if ((rows[ri].textContent || '').toLowerCase().indexOf('seo/aci') !== -1 &&
            (rows[ri].textContent || '').toLowerCase().indexOf('empenho') !== -1) {
          var t = rows[ri].tagName === 'TR'
            ? (rows[ri].querySelector('a, td[onclick], input[type="button"]') || rows[ri]) : rows[ri];
          t.click();
          found = true;
          log('  Fluxo associado ✓', 'ok');
          await delay(1000);
          break;
        }
      }
      if (!found) log('  ⚠ Fluxo SEO/ACI não encontrado — associe manualmente', 'warn');
    } else {
      // Modo página (busca em todos os frames)
      log('  [8b] Buscando fluxo na página…');
      try {
        var sinp2 = await waitForEl(['input[type="text"]'], null, 8000, true);
        fill(sinp2.el, 'SEO/ACI', sinp2.ctx);
        await delay(300);
        var sbtn2 = findEl(['input[type="image"]', 'input[type="submit"]', 'button'], 'Pesquis', true) ||
                    findEl(['input[type="submit"]', 'input[type="image"]'], null, true);
        if (sbtn2) { sbtn2.el.click(); await delay(1500); }
        var fluxoEl = await waitForEl(['a', 'td', 'tr', 'input[type="button"]'], FLUXO_NOME.slice(0, 10), 10000, true);
        fluxoEl.el.click();
        await delay(1000);
        log('  Fluxo associado ✓', 'ok');
      } catch (e) {
        log('  ⚠ Erro ao associar fluxo: ' + e.message, 'warn');
        log('  Associe manualmente: ' + FLUXO_NOME, 'warn');
      }
    }
  }

  // ── Processamento de um item ───────────────────────────────────────────────
  async function processItem(item) {
    // [1] Clicar "Novo Subprocesso"
    log('  [1] Buscando "Novo Subprocesso"…');
    var novoBtn = await waitForEl(
      ['input[type="button"]', 'button', 'a', 'input[type="submit"]'],
      'Novo Subprocesso', 15000, true
    );
    novoBtn.el.click();
    log('  Clicado. Aguardando formulário…');

    // [2] Aguarda formulário (página 2) — detecta pelo label "Nr. Documento"
    await waitForEl(['td', 'label', 'span', 'div', 'b', 'th'], 'Nr. Documento', 25000, true);
    await delay(800);
    log('  [2] Formulário carregado ✓');

    // [3] Nome
    var nomeVal = 'Solicitação de Empenho ' + item.numero;
    var nomeEl = findByLabel('nome', ['renome', 'sobrenome', 'alternativo']);
    if (!nomeEl) {
      // Se findByLabel falhou, pega o primeiro input text visível (excluindo popups)
      var ctxs = allCtx();
      for (var ci = 0; ci < ctxs.length; ci++) {
        try {
          if (/gxPopupLevel|Popup/i.test(ctxs[ci].win.location.href)) continue;
          var inps = ctxs[ci].doc.querySelectorAll('input[type="text"]');
          for (var ii = 0; ii < inps.length; ii++) {
            if (!inps[ii].readOnly && !inps[ii].disabled) {
              nomeEl = { el: inps[ii], ctx: ctxs[ci] }; break;
            }
          }
          if (nomeEl) break;
        } catch (_) {}
      }
    }
    if (!nomeEl) throw new Error('Campo Nome não encontrado');
    fill(nomeEl.el, nomeVal, nomeEl.ctx);
    await delay(200);

    // [4] Assunto = Nome (textarea)
    var assuntoEl = findByLabel('assunto', []);
    if (!assuntoEl) {
      var ctxs2 = allCtx();
      for (var ci2 = 0; ci2 < ctxs2.length; ci2++) {
        try {
          if (/gxPopupLevel|Popup/i.test(ctxs2[ci2].win.location.href)) continue;
          var ta = ctxs2[ci2].doc.querySelector('textarea');
          if (ta) { assuntoEl = { el: ta, ctx: ctxs2[ci2] }; break; }
        } catch (_) {}
      }
    }
    if (assuntoEl) { fill(assuntoEl.el, nomeVal, assuntoEl.ctx); await delay(200); }
    log('  [3] Nome e Assunto: "' + nomeVal + '"');

    // [5] Unidade ePAG via popup GeneXus
    log('  [4] Unidade ePAG → GAP-MN…');
    var epagArrow = findArrowNear('epag', []) || findArrowNear('unidade do epag', []);
    if (epagArrow) {
      await gxPopupSelect(epagArrow.el, 'GAP-MN', 'GAP-MN');
    } else {
      log('      ⚠ Seta ePAG não encontrada — preencha manualmente', 'warn');
    }
    await delay(400);

    // [6] PAG via popup GeneXus
    log('  [5] PAG: ' + item.pag + '…');
    // Tenta input direto primeiro
    var pagEl = findByLabel('pag', ['epag', 'uasg', 'unidade', 'tipo', 'origem', 'modalidade', 'amparo', 'status']);
    if (pagEl && pagEl.el.tagName === 'INPUT') {
      fill(pagEl.el, item.pag, pagEl.ctx);
      log('      PAG preenchido diretamente ✓');
    } else {
      // Usa popup
      var pagArrow = findArrowNear('pag', ['epag', 'uasg']);
      if (pagArrow) {
        await gxPopupSelect(pagArrow.el, item.pag, item.pag);
      } else {
        log('      ⚠ Campo PAG não encontrado', 'warn');
      }
    }
    await delay(300);

    // [7] Salvar (check verde)
    log('  [6] Salvando…');
    var saveEl = findSaveBtn();
    if (!saveEl) throw new Error('Botão salvar (check verde) não encontrado');
    saveEl.el.click();
    await delay(4000);

    // [8] Captura Nr. Documento
    var docNr = await captureNrDoc();
    log('  [7] Nr. Documento: ' + docNr, 'ok');

    // [9] Associar Fluxo
    log('  [8] Associando fluxo…');
    await associarFluxo();

    // [10] Volta à lista (clica "Documentos na Unidade" no menu)
    await delay(1000);
    var menuLink = findEl(['a', 'td', 'span'], 'Documentos na Unidade', true);
    if (menuLink) { menuLink.el.click(); await delay(2000); }

    return { numero: item.numero, pag: item.pag, docNr: docNr };
  }

  // ── Loop principal ────────────────────────────────────────────────────────
  var running = false;
  var paused  = false;
  var results = [];

  async function runAll(items) {
    running = true;
    g('__ssp_import__').style.display = 'none';
    g('__ssp_prog__').style.display   = '';

    for (var i = 0; i < items.length; i++) {
      if (!running) break;
      while (paused) await delay(500);

      g('__ssp_pt__').textContent = (i+1) + '/' + items.length;
      g('__ssp_bar__').style.width = ((i / items.length) * 100) + '%';
      setSub(items[i].numero + ' (' + (i+1) + '/' + items.length + ')');
      log('━━ [' + (i+1) + '/' + items.length + '] ' + items[i].numero);

      try {
        var res = await processItem(items[i]);
        results.push(res);
      } catch (e) {
        log('✗ Erro: ' + e.message, 'err');
        results.push({ numero: items[i].numero, pag: items[i].pag, docNr: 'ERRO: ' + e.message });
      }
      await delay(1000);
    }

    g('__ssp_bar__').style.width = '100%';
    log('━━ Concluído!', 'ok');
    setSub('Concluído! ' + results.length + ' itens');
    await postResults(results);
    showSummary(results);
    running = false;
  }

  g('__ssp_start__').onclick = function () { if (!pendingItems.length || running) return; results = []; runAll(pendingItems); };
  g('__ssp_pause__').onclick = function () {
    paused = !paused;
    this.textContent      = paused ? '▶ Retomar' : '⏸ Pausar';
    this.style.background = paused ? '#166534'   : '#78350f';
    this.style.color      = paused ? '#86efac'   : '#fcd34d';
  };

  // ── Excel (SheetJS via CDN) ───────────────────────────────────────────────
  var pendingItems = [];

  function loadXLSX(cb) {
    if (W.XLSX) return cb(W.XLSX);
    var s = D.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload  = function () { cb(W.XLSX); };
    s.onerror = function () { log('Erro ao carregar XLSX do CDN', 'err'); };
    D.head.appendChild(s);
  }

  function parseExcel(file) {
    return new Promise(function (res, rej) {
      loadXLSX(function (XLSX) {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            var ws   = wb.Sheets[wb.SheetNames[0]];
            var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            var items = [];
            for (var i = 1; i < rows.length; i++) {
              var numero = String(rows[i][0] || '').trim();
              var pag    = String(rows[i][9] || '').trim();
              // Aceita: 26S1030, 26M0001, 2XSXXXX etc.
              if (/^2\d[A-Za-z]\d{3,}/i.test(numero) && pag) items.push({ numero: numero, pag: pag });
            }
            res(items);
          } catch (e2) { rej(e2); }
        };
        reader.onerror = rej;
        reader.readAsArrayBuffer(file);
      });
    });
  }

  function handleFile(file) {
    if (!file) return;
    log('Lendo ' + file.name + '…');
    parseExcel(file).then(function (items) {
      if (!items.length) { log('Nenhuma solicitação encontrada. Verifique colunas A e J.', 'warn'); return; }
      pendingItems = items;
      var listEl = g('__ssp_list__');
      listEl.innerHTML = items.map(function (it, idx) {
        return '<span style="color:#60a5fa">' + (idx+1) + '.</span> ' + it.numero +
               ' <span style="color:#475569">PAG: ' + it.pag + '</span>';
      }).join('<br>');
      g('__ssp_preview__').style.display = '';
      log(items.length + ' solicitações prontas.', 'ok');
    }).catch(function (e) { log('Erro Excel: ' + e.message, 'err'); });
  }

  var dropEl = g('__ssp_drop__');
  dropEl.onclick = function () { g('__ssp_file__').click(); };
  g('__ssp_file__').onchange = function () { handleFile(this.files[0]); };
  dropEl.ondragover  = function (e) { e.preventDefault(); dropEl.style.borderColor = '#2563eb'; };
  dropEl.ondragleave = function ()  { dropEl.style.borderColor = '#334155'; };
  dropEl.ondrop = function (e) {
    e.preventDefault(); dropEl.style.borderColor = '#334155';
    handleFile(e.dataTransfer.files[0]);
  };

  // ── Google Sheets ─────────────────────────────────────────────────────────
  async function postResults(res) {
    try {
      await fetch(GSHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ acao: 'addSubprocessos', dados: res, dataHora: new Date().toLocaleString('pt-BR') }),
      });
      log('Dados enviados à planilha ✓', 'ok');
    } catch (e) { log('Aviso planilha: ' + e.message, 'warn'); }
  }

  function showSummary(res) {
    var ok = res.filter(function (r) { return !String(r.docNr).startsWith('ERRO'); }).length;
    var rows = res.map(function (r) {
      var err = String(r.docNr).startsWith('ERRO');
      return '<tr><td style="padding:2px 5px;color:#94a3b8">' + r.numero + '</td>' +
             '<td style="padding:2px 5px;color:#64748b">' + r.pag + '</td>' +
             '<td style="padding:2px 5px;color:' + (err?'#f87171':'#4ade80') + '">' + r.docNr + '</td></tr>';
    }).join('');
    var tbl = D.createElement('div');
    tbl.innerHTML = '<div style="color:#4ade80;font-size:11px;margin:6px 0 4px">✅ ' + ok + '/' + res.length + ' criados:</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:10px">' +
      '<tr><th style="text-align:left;color:#64748b;padding:2px 5px">Solicitação</th>' +
      '<th style="text-align:left;color:#64748b;padding:2px 5px">PAG</th>' +
      '<th style="text-align:left;color:#64748b;padding:2px 5px">Nr. Doc.</th></tr>' +
      rows + '</table>';
    logEl.appendChild(tbl);
    logEl.scrollTop = logEl.scrollHeight;
  }

  log('Pronto. Importe a planilha Excel e clique em Iniciar.');

// Roda no window.top para sobreviver navegações de frames filhos
})(window.top || window, (window.top || window).document);
