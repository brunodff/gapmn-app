// empenho-bot.js — Robô do Empenho v2 (modo assistido)
// Bookmarklet: javascript:(function(){var s=document.createElement('script');s.src='https://gapmn.app/empenho-bot.js?v='+Date.now();document.body.appendChild(s);})();
(function () {
  'use strict';

  var existing = document.getElementById('__empBot__');
  if (existing) { existing.remove(); return; }

  // ─── Config ───────────────────────────────────────────────────────────────────
  var PDFJS_SRC    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var SS_KEY   = '__empBotSession__';
  var SUPA_URL = 'https://fychrtyyqbzlfbzbvzqp.supabase.co';
  var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';

  // ─── Session (sobrevive ao reload da página) ──────────────────────────────────
  function saveSession(step, data) {
    var s = JSON.stringify({ step: step, data: data });
    try { localStorage.setItem(SS_KEY, s); } catch(e) {}
    try { sessionStorage.setItem(SS_KEY, s); } catch(e) {}
  }
  function loadSession() {
    try {
      var s = localStorage.getItem(SS_KEY) || sessionStorage.getItem(SS_KEY);
      return s ? JSON.parse(s) : null;
    } catch(e) { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(SS_KEY); } catch(e) {}
    try { sessionStorage.removeItem(SS_KEY); } catch(e) {}
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function poll(fn, interval, timeout) {
    return new Promise(function(resolve, reject) {
      var start = Date.now();
      (function check() {
        var r = fn();
        if (r) return resolve(r);
        if (Date.now() - start > timeout) return reject(new Error('Timeout: ' + fn.toString().slice(0, 60)));
        setTimeout(check, interval);
      })();
    });
  }

  // Preenche input/textarea/select respeitando frameworks (React/Angular/JSF)
  function fillInput(el, value) {
    if (!el) return;
    try {
      var proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      var nv = Object.getOwnPropertyDescriptor(proto, 'value');
      if (nv && nv.set) nv.set.call(el, value); else el.value = value;
    } catch(e) { el.value = value; }
    ['input', 'change'].forEach(function(ev) {
      el.dispatchEvent(new Event(ev, { bubbles: true }));
    });
  }

  // Encontra botão por texto (parcial, case-insensitive)
  function btn(text) {
    var lc = text.toLowerCase();
    return Array.from(document.querySelectorAll(
      'button, input[type=submit], input[type=button], a[onclick], a[href]'
    )).find(function(el) {
      return (el.textContent || el.value || '').trim().toLowerCase().includes(lc);
    });
  }

  // Encontra input próximo de uma label com o texto informado
  function inputNear(labelText) {
    var lc = labelText.toLowerCase();
    var label = Array.from(document.querySelectorAll('label')).find(function(l) {
      return l.textContent.toLowerCase().includes(lc);
    });
    if (label) {
      if (label.htmlFor) { var el = document.getElementById(label.htmlFor); if (el) return el; }
      var inp = label.querySelector('input, textarea, select');
      if (inp) return inp;
      var sib = label.nextElementSibling;
      while (sib) {
        var s2 = (sib.tagName === 'INPUT' || sib.tagName === 'TEXTAREA' || sib.tagName === 'SELECT')
          ? sib : sib.querySelector('input:not([type=hidden]), textarea, select');
        if (s2) return s2;
        sib = sib.nextElementSibling;
      }
    }
    var cell = Array.from(document.querySelectorAll('td, th, span, div')).find(function(c) {
      return c.textContent.trim().toLowerCase().includes(lc) && !c.querySelector('input, textarea, select');
    });
    if (cell) {
      var next = cell.nextElementSibling;
      if (next) {
        var s3 = (next.tagName === 'INPUT' || next.tagName === 'TEXTAREA' || next.tagName === 'SELECT')
          ? next : next.querySelector('input:not([type=hidden]), textarea, select');
        if (s3) return s3;
      }
      var row = cell.closest('tr');
      if (row) { var ri = row.querySelector('input:not([type=hidden]), textarea, select'); if (ri) return ri; }
    }
    return null;
  }

  // ─── PAG → Contrato (lookup no Supabase) ─────────────────────────────────────
  async function lookupContratoPorPag(pag) {
    if (!pag) return null;
    var SH = { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, Accept: 'application/json' };
    var enc = encodeURIComponent(pag);
    try {
      var r = await fetch(
        SUPA_URL + '/rest/v1/contratos_scon?select=numero_contrato&pag_nup=eq.' + enc + '&limit=1',
        { headers: SH }
      );
      if (r.ok) {
        var rows = await r.json();
        if (rows && rows.length && rows[0].numero_contrato)
          return formatContratoDisplay(rows[0].numero_contrato);
      }
    } catch(e) {}
    return null;
  }

  function formatContratoDisplay(s) {
    if (!s) return '';
    var m = s.match(/(\d+)\/[A-Z]+\/(\d{4})/i);
    if (m) return m[1].replace(/^0+/, '').padStart(3, '0') + '/' + m[2];
    var m2 = s.match(/(\d+)\/(\d{4})/);
    if (m2) return m2[1] + '/' + m2[2];
    return s;
  }

  function formatCnpj(cnpj) {
    if (!cnpj || cnpj.length !== 14) return cnpj;
    return cnpj.slice(0,2)+'.'+cnpj.slice(2,5)+'.'+cnpj.slice(5,8)+'/'+cnpj.slice(8,12)+'-'+cnpj.slice(12);
  }

  // ─── PDF: extrai texto com posições ───────────────────────────────────────────
  async function extractPdfText(buffer) {
    var lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    var pdf = await lib.getDocument({ data: buffer }).promise;
    var result = { lines: [], items: [] };

    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var vp = page.getViewport({ scale: 1 });
      var content = await page.getTextContent();

      var rowMap = {};
      content.items.forEach(function(item) {
        var y = Math.round(vp.height - item.transform[5]);
        var key = Math.round(y / 3) * 3;
        if (!rowMap[key]) rowMap[key] = [];
        rowMap[key].push({ str: item.str.trim(), x: item.transform[4], y: y });
      });

      Object.keys(rowMap).sort(function(a, b) { return +a - +b; }).forEach(function(k) {
        var row = rowMap[k].sort(function(a, b) { return a.x - b.x; });
        result.lines.push(row.map(function(i) { return i.str; }).join(' '));
        result.items = result.items.concat(row);
      });
    }
    result.full = result.lines.join('\n');
    return result;
  }

  // ─── Parseia campos da solicitação ────────────────────────────────────────────
  function parsePdf(extracted) {
    var full = extracted.full;
    var lines = extracted.lines;
    var d = {};

    var seIdx = lines.findIndex(function(l) { return /^solicitação\s+de\s+empenho$/i.test(l.trim()); });
    if (seIdx >= 0) {
      for (var i = seIdx + 1; i < lines.length; i++) {
        var l = lines[i].trim();
        if (l && !/telefone|cnpj|fax/i.test(l)) { d.local_entrega = l; break; }
      }
    }

    var fornIdx = lines.findIndex(function(l) { return /^FORNECEDOR$/i.test(l.trim()); });
    if (fornIdx >= 0) {
      for (var i = fornIdx + 1; i < lines.length; i++) {
        var l = lines[i].trim();
        if (l) { d.fornecedor = l; break; }
      }
    }

    var cnpjM = full.match(/CNPJ[\s:]+(\d{2}[\.\d]{0,3}\d{3}[\.\d]{0,3}\d{3}[\/\d]{0,5}\d{2}[-\d]{2})/);
    if (cnpjM) d.cnpj = cnpjM[1].replace(/\D/g, '');

    var seNumM = full.match(/\b(\d{2}[SM]\d{4,6})\b/i);
    if (seNumM) d.se_num = seNumM[1].toUpperCase();

    var ctM = full.match(/Contrato[\s:]+DESPESA\s+(\d+)\/([A-Z]+)\/(\d{2,4})/i);
    if (ctM) {
      d.contrato_num   = ctM[1];
      d.contrato_orgao = ctM[2];
      d.contrato_ano   = ctM[3];
      d.contrato_search = ctM[1] + '/' + ctM[3].slice(0, 2);
    }

    var ilM = full.match(/I\/L[\s:]+([A-Z]\d+)/i)
           || full.match(/Contrato[\s:]+DESPESA\s+[\d\/A-Z]+\s+([A-Z]\d{4,})/i);
    if (ilM) d.il = ilM[1];

    d.licit = '';
    var licitFM = full.match(/Licit\s*:\s*(\d[\d\/\.\-]+\d)/i);
    if (licitFM) d.licit = licitFM[1];

    var pagM = full.match(/\bP\.?A\.?G\.?\b[.:\s\n\r]+(\d[\d\.\/\-]+\d)/i)
            || full.match(/\bNUP\b[.:\s\n\r]+(\d[\d\.\/\-]+\d)/i);
    if (pagM) d.pag = pagM[1].trim();

    var ugM = full.match(/UG\s*Cred[\s:]+(\d{5,6})/i);
    if (ugM) d.ug_cred = ugM[1];

    var codM = full.match(/CODEMP[\s:]+([A-Z0-9\$]+)/i);
    if (codM) d.codemp = codM[1];

    var ptresM = full.match(/PTRES[\s:]+(\d+)/i);
    if (ptresM) d.ptres = ptresM[1];

    var fonteM = full.match(/FONTE[\s:]+(\d+)/i);
    if (fonteM) d.fonte = fonteM[1];

    var piM = full.match(/\bPI[\s:]+([A-Z0-9]+)/i);
    if (piM) d.pi = piM[1];

    var ndM = full.match(/\bND[\s:]+(\d{6})/i);
    if (ndM) d.nd = ndM[1];

    d.sub  = '';
    d.qtde = '';
    d.valor = '';
    d.item = '';

    var isContrato = !!(full.match(/Contrato\s*:\s*(?:DESPESA|\d)/i)) || (!d.licit && full.match(/Contrato\s*:/i));

    (function detectTableColumns() {
      var subHdr = null;
      for (var ii = 0; ii < extracted.items.length; ii++) {
        var it = extracted.items[ii];
        if (it.str !== 'SUB') continue;
        var hasItemNearby = extracted.items.some(function(o) {
          return o.str === 'ITEM' && Math.abs(o.y - it.y) < 8;
        });
        if (hasItemNearby) { subHdr = it; break; }
      }
      if (!subHdr) return;

      var subColX = subHdr.x;
      var headerY = subHdr.y;

      var subVals = extracted.items.filter(function(o) {
        return o.y > headerY + 4 && Math.abs(o.x - subColX) < 45 && /^\d{1,4}$/.test(o.str);
      });
      if (subVals.length) d.sub = subVals[0].str;

      if (isContrato) {
        var descItemM = full.match(/\bITEM\s*(?:N[ºo°\.]?\s*)?(\d+)/i);
        if (descItemM) d.item = descItemM[1];
      } else {
        var itemHdr = extracted.items.find(function(o) {
          return o.str === 'ITEM' && Math.abs(o.y - headerY) < 8;
        });
        if (itemHdr) {
          var itemColX = itemHdr.x;
          var itemVals = extracted.items.filter(function(o) {
            return o.y > headerY + 4 && Math.abs(o.x - itemColX) < 45 && /^\d{1,3}$/.test(o.str);
          });
          if (itemVals.length) d.item = itemVals.map(function(o) { return o.str; }).join(',');
        }
      }
    })();

    if (!d.sub) {
      var tblHdrPos = full.search(/\bITEM\b[^\n]*\bSUB\b/i);
      if (tblHdrPos >= 0) {
        var tblLines = full.slice(tblHdrPos).split('\n');
        var dataLine = tblLines.length > 1 ? tblLines[1].trim() : '';
        var subFbM = dataLine.match(/\S{6,}\s+(\d{1,4})\s+[^\s\d]/);
        if (subFbM) d.sub = subFbM[1];
      }
    }

    var qtM = full.match(/(\d+[,\.]\d+)\s+UN\b/i);
    if (qtM) d.qtde = qtM[1];

    var matches = [];
    var re = /(\d{1,3}(?:\.\d{3})+,\d{4})/g;
    var m;
    while ((m = re.exec(full))) matches.push(m[1]);
    if (matches.length) {
      d.valor = matches.reduce(function(max, v) {
        return parseFloat(v.replace(/\./g,'').replace(',','.')) > parseFloat(max.replace(/\./g,'').replace(',','.')) ? v : max;
      });
    }

    var obsM = full.match(/\bOBS\b[.:\s]+(.+?)(?=\s*(?:Documento\s*:|Hash\s*MD5\s*:|P[aá]gina\s+\d+\/\d+|Assinado\s+eletronicamente|MINIST[EÉ]RIO\s+DA\s+DEFESA)|$)/si);
    var cleanObs = obsM ? obsM[1].replace(/\s+/g, ' ').trim() : '';

    var isM = d.se_num && d.se_num[2] === 'M';
    var seType;
    if (isM) {
      var vNum = parseFloat((d.valor || '0').replace(/\./g, '').replace(',', '.')) || 0;
      seType = vNum < 0 ? 'SOLICITAÇÃO DE ANULAÇÃO' : 'SOLICITAÇÃO DE REFORÇO';
    } else {
      seType = 'SOLICITAÇÃO DE EMPENHO';
    }
    d.obs = seType + (d.se_num ? ' ' + d.se_num : '') + (cleanObs ? '\n' + cleanObs : '');

    return d;
  }

  // ─── Painel UI ────────────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.id = '__empBot__';
  panel.style.cssText = [
    'position:fixed;top:14px;right:14px;z-index:2147483647',
    'width:360px;border-radius:12px;overflow:hidden',
    'background:#0f172a;color:#e2e8f0',
    'font-family:system-ui,-apple-system,Arial,sans-serif;font-size:13px',
    'box-shadow:0 8px 32px rgba(0,0,0,.7)',
    'border:1px solid rgba(255,255,255,0.09)',
  ].join(';');
  document.body.appendChild(panel);

  var _panelIntentionallyRemoved = false;
  var _bodyObserver = new MutationObserver(function(mutations) {
    if (_panelIntentionallyRemoved) return;
    for (var mi = 0; mi < mutations.length; mi++) {
      var removed = mutations[mi].removedNodes;
      for (var ri = 0; ri < removed.length; ri++) {
        if (removed[ri] === panel) { document.body.appendChild(panel); statusEl = null; break; }
      }
    }
  });
  _bodyObserver.observe(document.body, { childList: true });
  setInterval(function() {
    if (_panelIntentionallyRemoved) return;
    if (!document.body.contains(panel)) { document.body.appendChild(panel); statusEl = null; }
  }, 300);

  var statusEl;
  function setStatus(msg, isErr) {
    if (!statusEl) statusEl = document.getElementById('__empStatus__');
    if (statusEl) { statusEl.innerHTML = msg; statusEl.style.color = isErr ? '#f87171' : '#94a3b8'; }
    console.log('[EmpBot]', msg);
  }

  function header(title) {
    return '<div style="padding:12px 14px 10px;background:#0f172a;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between">'
      + '<span style="font-weight:700;color:#38bdf8;font-size:13px">🤖 ' + esc(title) + '</span>'
      + '<button id="__empClose__" style="background:none;border:none;color:#475569;cursor:pointer;font-size:18px;line-height:1;padding:0 2px">×</button>'
      + '</div>';
  }
  function bindClose() {
    var c = document.getElementById('__empClose__');
    if (c) c.onclick = function() {
      _panelIntentionallyRemoved = true;
      _bodyObserver.disconnect();
      if (_observerInterval) clearInterval(_observerInterval);
      clearSession();
      panel.remove();
    };
  }

  // ─── Fase 1: Upload ───────────────────────────────────────────────────────────
  function renderUpload() {
    panel.innerHTML = header('Robô do Empenho')
      + '<div style="padding:14px">'
      + '<div id="__empDrop__" style="border:2px dashed rgba(56,189,248,0.4);border-radius:10px;padding:28px 16px;text-align:center;cursor:pointer">'
      + '<div style="font-size:30px;margin-bottom:8px">📄</div>'
      + '<div style="color:#94a3b8;font-size:12px;line-height:1.7">Arraste a <b>Solicitação de Empenho (PDF)</b><br>ou clique para selecionar</div>'
      + '<input type="file" id="__empFile__" accept=".pdf" style="display:none">'
      + '</div>'
      + '<div id="__empStatus__" style="margin-top:10px;font-size:11px;text-align:center;color:#64748b"></div>'
      + '</div>';

    bindClose();
    statusEl = document.getElementById('__empStatus__');
    var drop = document.getElementById('__empDrop__');
    var fileInp = document.getElementById('__empFile__');
    drop.onclick = function() { fileInp.click(); };
    drop.ondragover = function(e) { e.preventDefault(); drop.style.borderColor='rgba(56,189,248,.8)'; drop.style.background='rgba(56,189,248,.04)'; };
    drop.ondragleave = function() { drop.style.borderColor='rgba(56,189,248,.4)'; drop.style.background=''; };
    drop.ondrop = function(e) { e.preventDefault(); drop.style.borderColor='rgba(56,189,248,.4)'; drop.style.background=''; var f=e.dataTransfer.files[0]; if(f) readPdf(f); };
    fileInp.onchange = function() { if (fileInp.files[0]) readPdf(fileInp.files[0]); };
  }

  async function readPdf(file) {
    setStatus('⏳ Lendo PDF…', false);
    try {
      var buffer = await file.arrayBuffer();
      var extracted = await extractPdfText(buffer);
      var data = parsePdf(extracted);
      if (data.pag) {
        setStatus('🔍 Buscando contrato pelo PAG…', false);
        data.contrato_display = await lookupContratoPorPag(data.pag) || '';
      }
      if (!data.contrato_display && data.contrato_search) data.contrato_display = data.contrato_search;
      renderConfirm(data);
    } catch(e) {
      setStatus('❌ ' + e.message, true);
    }
  }

  // ─── Fase 2: Confirmação ──────────────────────────────────────────────────────
  function fieldRow(label, key, val, hint) {
    var hintHtml = hint ? ' <span style="color:#475569;font-size:9px">' + esc(hint) + '</span>' : '';
    return '<div style="margin-bottom:7px">'
      + '<div style="font-size:10px;color:#64748b;margin-bottom:2px">' + esc(label) + hintHtml + '</div>'
      + '<input data-key="' + key + '" value="' + esc(val || '') + '" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;font-size:12px;padding:5px 8px;outline:none;font-family:inherit">'
      + '</div>';
  }
  function sectionTitle(t) {
    return '<div style="font-size:10px;font-weight:700;color:#38bdf8;margin:10px 0 6px;text-transform:uppercase;letter-spacing:.05em">' + t + '</div>';
  }

  function renderConfirm(data) {
    panel.innerHTML = header('Confirmar Dados do PDF')
      + '<div style="padding:10px 14px;max-height:420px;overflow-y:auto">'
      + '<div style="font-size:10px;color:#64748b;margin-bottom:8px">Verifique e edite se necessário. O robô usará estes valores para preencher os campos.</div>'
      + sectionTitle('Fornecedor')
      + fieldRow('Razão Social', 'fornecedor', data.fornecedor)
      + fieldRow('CNPJ (só dígitos)', 'cnpj', data.cnpj)
      + sectionTitle('Contrato / Compra')
      + fieldRow('PAG/NUP', 'pag', data.pag)
      + fieldRow('Nº Contrato', 'contrato_display', data.contrato_display, 'ex: 013/2025 — editável')
      + fieldRow('Nº Licitação', 'licit', data.licit, 'preenchido para compras')
      + sectionTitle('Item')
      + fieldRow('Nº do Item', 'item', data.item, 'vazio = 1º da lista')
      + sectionTitle('Linha de Crédito')
      + fieldRow('PTRES', 'ptres', data.ptres)
      + fieldRow('Fonte', 'fonte', data.fonte)
      + fieldRow('PI', 'pi', data.pi)
      + fieldRow('ND', 'nd', data.nd)
      + fieldRow('UG Cred', 'ug_cred', data.ug_cred)
      + sectionTitle('Empenho')
      + fieldRow('Subelemento', 'sub', data.sub)
      + fieldRow('Quantidade', 'qtde', data.qtde)
      + fieldRow('Valor Total', 'valor', data.valor)
      + sectionTitle('Informações')
      + fieldRow('Local de Entrega', 'local_entrega', data.local_entrega)
      + '<div style="margin-bottom:7px">'
      + '<div style="font-size:10px;color:#64748b;margin-bottom:2px">Descrição / OBS</div>'
      + '<textarea data-key="obs" rows="3" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;font-size:12px;padding:5px 8px;outline:none;font-family:inherit;resize:vertical;line-height:1.4">' + esc(data.obs || '') + '</textarea>'
      + '</div>'
      + '</div>'
      + '<div style="padding:10px 14px;border-top:1px solid rgba(255,255,255,0.07)">'
      + '<button id="__empRun__" style="width:100%;background:#0ea5e9;border:none;color:#fff;border-radius:8px;padding:10px;cursor:pointer;font-size:13px;font-weight:700">▶ Iniciar Modo Assistido</button>'
      + '<div id="__empStatus__" style="margin-top:8px;font-size:11px;color:#64748b;text-align:center"></div>'
      + '</div>';

    bindClose();
    statusEl = document.getElementById('__empStatus__');

    document.getElementById('__empRun__').onclick = function() {
      panel.querySelectorAll('[data-key]').forEach(function(el) {
        data[el.getAttribute('data-key')] = el.value.trim();
      });
      if (!data.item) data.item = '1';
      startObserverMode(data);
    };
  }

  // ─── Fase 3: Modo Assistido ───────────────────────────────────────────────────

  var _observerInterval = null;
  var _lastFilledStep   = null;   // evita re-preencher a mesma tela
  var _lastFilledUrl    = null;

  function stepLabel(step) {
    var labels = {
      step_contrato:    'Passo 1 — Buscacompra (Contrato/Compra)',
      step_fornecedor:  'Passo 2 — Seleção de Fornecedor',
      step_item:        'Passo 3 — Seleção de Item',
      step_credito:     'Passo 4 — Linha de Crédito',
      step_valores:     'Passo 5 — Subelemento / Quantidade / Valor',
      step_informacoes: 'Passo 6 — Informações / OBS',
      done:             '✅ Concluído',
    };
    return labels[step] || step;
  }

  function renderObserverPanel(data, currentStep) {
    var stepHtml = currentStep
      ? '<div style="background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.2);border-radius:8px;padding:8px 10px;margin-bottom:10px">'
        + '<div style="font-size:10px;color:#38bdf8;font-weight:700;margin-bottom:1px">Tela detectada</div>'
        + '<div style="font-size:12px;color:#e2e8f0">' + esc(stepLabel(currentStep)) + '</div>'
        + '</div>'
      : '<div style="font-size:12px;color:#64748b;margin-bottom:10px;line-height:1.5">'
        + '⏳ Aguardando… navegue até a tela de empenho no ComprasNet.'
        + '</div>';

    var instrHtml = '<div style="margin-top:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;font-size:11px;color:#475569;line-height:1.7">'
      + '<b style="color:#94a3b8">Modo assistido ativo:</b> navegue pelas telas manualmente.<br>'
      + 'O robô preenche os campos automaticamente em cada tela.'
      + '</div>';

    // Mini resumo dos dados
    var cnpjFmt = formatCnpj(data.cnpj || '');
    var resumo = '<div style="margin-top:10px">'
      + '<details>'
      + '<summary style="cursor:pointer;font-size:10px;color:#475569;user-select:none">▸ Ver dados do PDF</summary>'
      + '<div style="margin-top:6px;font-size:10px;color:#64748b;line-height:1.8;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px">'
      + (data.fornecedor ? '<b style="color:#94a3b8">Fornecedor:</b> ' + esc(data.fornecedor) + '<br>' : '')
      + (cnpjFmt ? '<b style="color:#94a3b8">CNPJ:</b> ' + esc(cnpjFmt) + '<br>' : '')
      + (data.contrato_display ? '<b style="color:#94a3b8">Contrato:</b> ' + esc(data.contrato_display) + '<br>' : '')
      + (data.licit ? '<b style="color:#94a3b8">Licitação:</b> ' + esc(data.licit) + '<br>' : '')
      + (data.ptres ? '<b style="color:#94a3b8">PTRES:</b> ' + esc(data.ptres) + ' | <b style="color:#94a3b8">ND:</b> ' + esc(data.nd||'') + ' | <b style="color:#94a3b8">PI:</b> ' + esc(data.pi||'') + '<br>' : '')
      + (data.sub   ? '<b style="color:#94a3b8">SUB:</b> ' + esc(data.sub) + ' | <b style="color:#94a3b8">Qtde:</b> ' + esc(data.qtde||'') + ' | <b style="color:#94a3b8">Valor:</b> ' + esc(data.valor||'') + '<br>' : '')
      + '</div></details>'
      + '</div>';

    panel.innerHTML = header('Robô do Empenho — Assistido')
      + '<div style="padding:12px 14px">'
      + stepHtml
      + '<div id="__empStatus__" style="font-size:11px;color:#94a3b8;min-height:28px;line-height:1.6"></div>'
      + instrHtml
      + resumo
      + '<button id="__empNewPdf__" style="margin-top:10px;width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;border-radius:6px;padding:7px;cursor:pointer;font-size:11px">🔄 Carregar outro PDF</button>'
      + '</div>';

    bindClose();
    statusEl = document.getElementById('__empStatus__');
    var newPdfBtn = document.getElementById('__empNewPdf__');
    if (newPdfBtn) newPdfBtn.onclick = function() {
      if (_observerInterval) clearInterval(_observerInterval);
      clearSession();
      renderUpload();
    };
  }

  function ensurePanelInDom() {
    if (!document.body.contains(panel)) { document.body.appendChild(panel); statusEl = null; }
  }

  function log(msg) { setStatus(msg, false); console.log('[EmpBot]', msg); }

  function startObserverMode(data) {
    saveSession('observer', data);
    _lastFilledStep = null;
    _lastFilledUrl  = null;

    renderObserverPanel(data, null);

    if (_observerInterval) clearInterval(_observerInterval);
    _observerInterval = setInterval(function() {
      ensurePanelInDom();
      var curUrl  = location.href;
      var curStep = detectStep(null);

      // Only re-fill if URL changed or step changed (avoids repeated fill on same page)
      if (curUrl !== _lastFilledUrl || curStep !== _lastFilledStep) {
        _lastFilledUrl  = curUrl;
        _lastFilledStep = curStep;

        renderObserverPanel(data, curStep);

        if (curStep) {
          autoFillStep(data, curStep);
        } else {
          setStatus('Navegue até a tela de empenho.', false);
        }
      }
    }, 700);
  }

  async function autoFillStep(data, step) {
    try {
      if (step === 'step_contrato')    await fillContrato(data);
      if (step === 'step_fornecedor')  await fillFornecedor(data);
      if (step === 'step_item')        await fillItem(data);
      if (step === 'step_credito')     await fillCredito(data);
      if (step === 'step_valores')     await fillValores(data);
      if (step === 'step_informacoes') await fillInformacoes(data);
    } catch(e) {
      setStatus('⚠ ' + e.message + '<br><small style="color:#475569">Preencha manualmente e avance.</small>', true);
    }
  }

  // ─── Fill functions (preenchem sem navegar) ───────────────────────────────────

  // Buscacompra: preenche número + clica Pesquisar, destaca linha correspondente
  async function fillContrato(data) {
    log('📋 Aguardando campos…');
    await poll(function() { return document.querySelectorAll('input, button').length > 3; }, 300, 8000);
    await wait(500);

    var isCompra   = !!(data.licit && data.licit.trim());
    var searchNum  = isCompra ? data.licit : (data.contrato_display || data.contrato_search || '');

    // Seleciona o radio Contrato ou Compra conforme o tipo
    var radios = Array.from(document.querySelectorAll('input[type=radio]'));
    var radioInfo = radios.map(function(r) {
      var ctx = r.closest('label') || r.closest('mat-radio-button') || r.closest('tr') || r.parentElement;
      return { el: r, txt: ((ctx && (ctx.innerText || ctx.textContent)) || r.value || '').toLowerCase().replace(/\s+/g,' ').trim() };
    });
    var typeRadio = isCompra
      ? radioInfo.find(function(r) { return /compra|pregão|pregao|licitaç/i.test(r.txt); })
      : radioInfo.find(function(r) { return /\bcontrato\b/i.test(r.txt); });
    if (typeRadio && !typeRadio.el.checked) { typeRadio.el.click(); await wait(500); }

    // Preenche número
    var inpNum = document.querySelector('input[name=opc_contrato]')
              || document.querySelector('input[name*=contrato][type=text], input[name*=numero][type=text]')
              || Array.from(document.querySelectorAll('input[type=text]')).filter(function(i) {
                   return i.offsetWidth > 0 && !i.readOnly && !i.disabled;
                 })[0];
    if (inpNum && searchNum) { fillInput(inpNum, searchNum); log('  Número: ' + searchNum); await wait(300); }
    else if (!searchNum) { setStatus('⚠ Nº contrato não disponível. Preencha manualmente.', true); return; }

    // Clica Pesquisar (permanece na mesma página — resultados aparecem abaixo)
    var pesqBtn = btn('Pesquisar') || btn('Buscar') || btn('Localizar');
    if (pesqBtn) {
      pesqBtn.click();
      log('🔎 Buscando… aguarde os resultados.');
      await wait(1500);

      // Destaca (fundo azul) a linha correspondente no resultado para facilitar seleção manual
      var rows = Array.from(document.querySelectorAll('tr')).filter(function(r) {
        return r.querySelector('input[type=radio], input[type=checkbox], a[onclick], input[type=image]')
            && (r.innerText || '').trim().length > 5 && r.offsetHeight > 0;
      });
      if (rows.length > 0 && searchNum) {
        var numClean = searchNum.replace(/[^\d]/g, '');
        var match = rows.find(function(r) {
          var t = r.innerText || '';
          return t.includes(searchNum) || (numClean.length > 3 && t.replace(/[^\d]/g,'').includes(numClean));
        }) || rows[0];
        match.style.background = 'rgba(56,189,248,0.15)';
        match.style.outline    = '2px solid rgba(56,189,248,0.5)';
        match.scrollIntoView({ behavior: 'smooth', block: 'center' });
        log('✅ Linha destacada. Selecione-a e clique em <b>Próxima Etapa</b>.');
      } else if (rows.length === 0) {
        log('⚠ Nenhum resultado. Verifique o número e pesquise novamente.');
      } else {
        log('✅ Resultados carregados. Selecione e clique em <b>Próxima Etapa</b>.');
      }
    } else {
      setStatus('⚠ Botão Pesquisar não encontrado. Preencha e pesquise manualmente.', true);
    }
  }

  // Fornecedor: seleciona o radio/checkbox com o CNPJ correto
  async function fillFornecedor(data) {
    var cnpjAlvo = data.cnpj;
    var cnpjFmt  = formatCnpj(cnpjAlvo);
    log('🔍 Selecionando fornecedor (CNPJ ' + cnpjFmt + ')…');

    await poll(function() {
      var t = document.body.innerText || '';
      return t.includes(cnpjAlvo) || t.includes(cnpjFmt) || document.querySelectorAll('tr').length > 2;
    }, 300, 10000);
    await wait(400);

    var allRows = Array.from(document.querySelectorAll('tr'));
    var targetRow = allRows.find(function(row) {
      var t = row.innerText || '';
      return (cnpjAlvo && t.replace(/\D/g,'').includes(cnpjAlvo)) || (cnpjFmt && t.includes(cnpjFmt));
    });

    if (!targetRow) {
      setStatus('⚠ CNPJ ' + cnpjFmt + ' não encontrado. Selecione manualmente.', true);
      return;
    }

    var sel = targetRow.querySelector('input[type=radio], input[type=checkbox]')
           || targetRow.querySelector('a, button, input[type=image], img[onclick]');
    if (sel) { sel.click(); await wait(300); }

    targetRow.style.background = 'rgba(52,211,153,0.15)';
    targetRow.style.outline    = '2px solid rgba(52,211,153,0.5)';
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    log('✅ Fornecedor selecionado: <b>' + esc(data.fornecedor || cnpjFmt) + '</b>. Clique em <b>Próxima Etapa</b>.');
  }

  // Item: seleciona o item pelo número
  async function fillItem(data) {
    var itemNum = (data.item || '1').trim();
    log('📦 Selecionando item ' + itemNum + '…');

    await poll(function() {
      return document.querySelectorAll('input[type=radio], input[type=checkbox]').length > 0
          || document.querySelectorAll('tr').length > 3;
    }, 300, 8000);
    await wait(400);

    var alvo = null;
    var targetRow = null;

    if (itemNum !== '1') {
      var rows = Array.from(document.querySelectorAll('tr'));
      targetRow = rows.find(function(r) {
        var first = r.querySelector('td:first-child, td:nth-child(1)');
        return first && first.textContent.trim() === itemNum;
      });
      if (targetRow) alvo = targetRow.querySelector('input[type=radio], input[type=checkbox]');
    }
    if (!alvo) {
      alvo = document.querySelector('input[type=radio], input[type=checkbox]');
      if (alvo) targetRow = alvo.closest('tr');
    }

    if (alvo) {
      alvo.click();
      await wait(300);
      if (targetRow) {
        targetRow.style.background = 'rgba(52,211,153,0.15)';
        targetRow.style.outline    = '2px solid rgba(52,211,153,0.5)';
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      log('✅ Item ' + itemNum + ' selecionado. Clique em <b>Próxima Etapa</b>.');
    } else {
      log('⚠ Nenhum item encontrado. Selecione manualmente.');
    }
  }

  // Crédito: seleciona a linha com PTRES+ND+PI correspondente
  async function fillCredito(data) {
    log('💳 Aguardando tabela de linhas de crédito…');
    await poll(function() { return document.querySelectorAll('tr').length > 3; }, 300, 10000);
    await wait(500);

    // Tenta expandir para 100 resultados
    var pagSel = document.querySelector('select[name*=tamPagina], select[name*=pagina], select[id*=tamPagina], select[id*=qtdLinhas]');
    if (pagSel) {
      var opt = Array.from(pagSel.options).find(function(o) { return o.value === '100' || o.text === '100'; });
      if (opt) { pagSel.value = opt.value; pagSel.dispatchEvent(new Event('change', { bubbles: true })); await wait(1200); }
    } else {
      var btn100 = Array.from(document.querySelectorAll('a, button')).find(function(el) { return el.textContent.trim() === '100'; });
      if (btn100) { btn100.click(); await wait(1200); }
    }

    var rows = Array.from(document.querySelectorAll('tr'));
    var targetRow = rows.find(function(r) {
      var t = r.innerText || '';
      var ok = data.ptres ? t.includes(data.ptres) : true;
      if (ok && data.nd) ok = t.includes(data.nd);
      if (ok && data.pi) ok = t.includes(data.pi);
      return ok && r.querySelector('input[type=radio], input[type=checkbox], a, button, input[type=image]');
    });

    if (!targetRow) {
      setStatus('⚠ Linha PTRES=' + data.ptres + ' ND=' + data.nd + ' não encontrada. Selecione manualmente.', true);
      return;
    }

    var sel = targetRow.querySelector('input[type=radio], input[type=checkbox]')
           || targetRow.querySelector('a[onclick], button, input[type=image]');
    if (sel) { sel.click(); await wait(300); }

    targetRow.style.background = 'rgba(56,189,248,0.15)';
    targetRow.style.outline    = '2px solid rgba(56,189,248,0.5)';
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    log('✅ Linha de crédito selecionada (PTRES=' + esc(data.ptres) + ' ND=' + esc(data.nd) + '). Clique em <b>Próxima Etapa</b>.');
  }

  // Valores: preenche SUB, QTDE e Valor Total
  async function fillValores(data) {
    log('💰 Aguardando campos de valores…');
    await poll(function() {
      return document.querySelector('input[name*=sub], input[id*=sub], input[name*=element]')
          || inputNear('subelemento') || inputNear('sub');
    }, 300, 10000);
    await wait(400);

    var subInp = document.querySelector('input[name*=subElem], input[name*=subelem], input[id*=sub], input[name*=sub]')
              || inputNear('subelemento') || inputNear('sub');
    if (subInp && data.sub) { fillInput(subInp, data.sub); log('  SUB = ' + data.sub); }
    else if (!subInp) log('⚠ Campo subelemento não encontrado');
    await wait(300);

    var qtInp = document.querySelector('input[name*=qtd], input[name*=quant], input[id*=qtd], input[id*=quant]')
             || inputNear('quantidade') || inputNear('qtde');
    if (qtInp && data.qtde) { fillInput(qtInp, data.qtde); log('  Qtde = ' + data.qtde); }
    await wait(300);

    var valInp = document.querySelector('input[name*=valor], input[name*=vl_total], input[id*=valor], input[id*=vl]')
              || inputNear('valor total') || inputNear('valor');
    if (valInp && data.valor) { fillInput(valInp, data.valor); log('  Valor = ' + data.valor); }
    await wait(1200);

    // Corrige arredondamento se necessário
    var corrigir = Array.from(document.querySelectorAll('a, button, span[onclick]')).find(function(el) {
      return /corrigir\s+agora/i.test(el.textContent || '');
    });
    if (corrigir) { log('⚠ Corrigindo arredondamento…'); corrigir.click(); await wait(800); }

    log('✅ Campos preenchidos. Revise e clique em <b>Próxima Etapa</b>.');
  }

  // Informações: preenche Local de Entrega e OBS
  async function fillInformacoes(data) {
    log('📋 Aguardando campos de informações…');
    await poll(function() {
      return inputNear('local') || inputNear('entrega')
          || document.querySelector('input[name*=local], textarea[name*=obs], textarea[name*=descri]');
    }, 300, 10000);
    await wait(400);

    var localInp = document.querySelector('input[name*=local], input[id*=local]')
                || inputNear('local de entrega') || inputNear('local');
    if (localInp && data.local_entrega) { fillInput(localInp, data.local_entrega); log('  Local = ' + data.local_entrega); }
    else if (!localInp) log('⚠ Campo "Local de Entrega" não encontrado');
    await wait(300);

    var obsInp = document.querySelector('textarea[name*=obs], textarea[name*=descri], textarea[name*=observ]')
              || document.querySelector('textarea[id*=obs], textarea[id*=descri]')
              || inputNear('observação') || inputNear('descrição') || inputNear('obs')
              || document.querySelector('textarea');
    if (obsInp && data.obs) { fillInput(obsInp, data.obs); log('  OBS preenchida'); }
    else if (!obsInp) log('⚠ Campo OBS não encontrado');

    // Para o observer — não há mais telas para preencher
    if (_observerInterval) { clearInterval(_observerInterval); _observerInterval = null; }
    log('✅ Tudo preenchido! Revise e clique em <b>Salvar / Finalizar</b>.');
  }

  // ─── Detecta a etapa atual pela URL e conteúdo da página ─────────────────────
  function detectStep(savedStep) {
    var url  = location.href.toLowerCase();
    var path = location.pathname.toLowerCase();
    var body = (document.body.innerText || '').toLowerCase();

    if (url.includes('buscacompra'))                      return 'step_contrato';
    if (url.includes('fornecedor'))                       return 'step_fornecedor';
    if (path.includes('/item') || url.includes('/item'))  return 'step_item';
    if (url.includes('credito') || url.includes('dotac')) return 'step_credito';
    if (url.includes('valor') || url.includes('dado'))    return 'step_valores';
    if (url.includes('informac') || url.includes('observ') || url.includes('entrega')) return 'step_informacoes';

    if (body.includes('local de entrega') || body.includes('descrição/observação'))
      return 'step_informacoes';
    if (body.includes('subelemento') || (body.includes('valor total') && body.includes('quantidade')))
      return 'step_valores';
    if (body.includes('ptres') || (body.includes('fonte') && body.includes('pi') && body.includes('nd')))
      return 'step_credito';
    if (body.includes('quantidade solicitada') && document.querySelector('input[type=radio], input[type=checkbox]'))
      return 'step_item';
    if (body.includes('cnpj') && body.includes('fornecedor') && document.querySelectorAll('tr').length > 2)
      return 'step_fornecedor';
    if (body.includes('buscacompra') || (body.includes('contrato') && inputNear('contrato')))
      return 'step_contrato';

    return savedStep || null;
  }

  // ─── Entry point ──────────────────────────────────────────────────────────────
  function loadPdfJs(cb) {
    if (window.pdfjsLib) { cb(); return; }
    var s = document.createElement('script');
    s.src = PDFJS_SRC;
    s.onload = cb;
    s.onerror = function() { cb(); setStatus('⚠ PDF.js não carregou — verifique a conexão.', true); };
    document.head.appendChild(s);
  }

  // Auto-resume: se havia sessão de modo assistido, retoma imediatamente
  var _session = loadSession();
  if (_session && _session.step === 'observer' && _session.data) {
    loadPdfJs(function() {
      startObserverMode(_session.data);
      // Preenche a página atual imediatamente
      var curStep = detectStep(null);
      if (curStep) autoFillStep(_session.data, curStep);
    });
  } else {
    clearSession();
    loadPdfJs(renderUpload);
  }

})();
