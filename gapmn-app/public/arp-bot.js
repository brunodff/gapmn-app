// arp-bot.js — Robô de sincronização de ATAs + Itens
// Bookmarklet: javascript:(function(){var s=document.createElement('script');s.src='https://processoscae.vercel.app/arp-bot.js?v='+Date.now();document.body.appendChild(s);})();
//
// Fluxo: abre UMA aba-worker sincronamente (dentro do gesto do bookmarklet).
// Para cada ATA, clica expand + eye DENTRO da worker tab → Angular navega
// internamente para /arp/{id}/show → lê tabela → volta para lista.

(function () {
  'use strict';

  // ── Worker tab: DEVE ser aberta ANTES de qualquer await ──────────────────
  // Dentro do gesto de clique do bookmarklet → popup liberado pelo browser.
  // A aba permanece aberta durante todo o processo e é fechada ao concluir.
  var _workerWin = null;
  try {
    _workerWin = window.open(location.href, '_blank');
  } catch(e) {}

  var SUPA_URL = 'https://fychrtyyqbzlfbzbvzqp.supabase.co';
  var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';

  // ── overlay ────────────────────────────────────────────────────────────────
  var ov = document.getElementById('__arpbot__');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = '__arpbot__';
  ov.style.cssText = [
    'position:fixed;top:20px;right:20px;z-index:2147483647',
    'background:#0f172a;color:#e2e8f0;padding:16px 18px',
    'border-radius:12px;font-family:monospace;font-size:12px',
    'min-width:360px;max-width:520px;box-shadow:0 8px 32px rgba(0,0,0,.55)',
    'max-height:85vh;overflow-y:auto;line-height:1.6'
  ].join(';');
  ov.innerHTML =
    '<div style="font-weight:700;color:#38bdf8;font-size:14px;margin-bottom:8px">⟳ Sync ATAs — GAP-MN</div>' +
    '<div id="__arplog__"></div>' +
    '<div id="__arpprog__" style="margin-top:8px;display:none">' +
      '<div style="background:#1e293b;border-radius:4px;height:6px;overflow:hidden">' +
        '<div id="__arpbar__" style="height:100%;background:#38bdf8;width:0%;transition:width .3s"></div>' +
      '</div>' +
      '<div id="__arppct__" style="font-size:10px;color:#64748b;margin-top:3px"></div>' +
    '</div>' +
    '<button id="__arpstop__" style="margin-top:10px;background:#7f1d1d;border:none;color:#fca5a5;' +
      'padding:4px 14px;border-radius:6px;cursor:pointer;font-size:11px;margin-right:6px">⏹ Parar</button>' +
    '<button onclick="document.getElementById(\'__arpbot__\').remove()" style="margin-top:10px;' +
      'background:#334155;border:none;color:#94a3b8;padding:4px 14px;border-radius:6px;' +
      'cursor:pointer;font-size:11px">✕ Fechar</button>';
  document.body.appendChild(ov);

  if (!_workerWin) {
    log('⚠ Popup bloqueado! Autorize popups para contratos.sistema.gov.br e recarregue.', '#f87171');
  }

  var _stopped = false;
  var _lastExpandBtn = null; // colapsa a row anterior antes de expandir a próxima
  document.getElementById('__arpstop__').onclick = function() {
    _stopped = true;
    log('⏹ Parado.', '#fbbf24');
    try { if (_workerWin && !_workerWin.closed) _workerWin.close(); } catch(e) {}
  };

  function log(msg, color) {
    var el = document.getElementById('__arplog__');
    if (!el) return;
    var d = document.createElement('div');
    d.style.cssText = 'padding:2px 0;border-bottom:1px solid #1e293b;color:'+(color||'#e2e8f0');
    d.textContent = msg;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
    console.log('[ARP-BOT]', msg);
  }
  function setLast(msg, color) {
    var el = document.getElementById('__arplog__');
    if (!el || !el.lastChild) { log(msg, color); return; }
    el.lastChild.textContent = msg;
    if (color) el.lastChild.style.color = color;
  }
  function prog(cur, total, label) {
    var p = document.getElementById('__arpprog__');
    var bar = document.getElementById('__arpbar__');
    var pct = document.getElementById('__arppct__');
    if (!p) return;
    p.style.display = 'block';
    var pc = total ? Math.round(cur/total*100) : 0;
    if (bar) bar.style.width = pc+'%';
    if (pct) pct.textContent = (label?label+' — ':'')+cur+'/'+total+' ('+pc+'%)';
  }
  function wait(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

  // ── helpers ────────────────────────────────────────────────────────────────
  function brToISO(s) {
    var m = s && s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? m[3]+'-'+m[2]+'-'+m[1] : null;
  }
  function parseBR(s) {
    if (!s) return null;
    var c = s.trim().replace(/\s/g,'');
    c = c.indexOf(',')!==-1 ? c.replace(/\./g,'').replace(',','.') : c;
    var n = parseFloat(c);
    return isNaN(n) ? null : n;
  }
  function colIdx(arr, kw) {
    for (var i=0;i<arr.length;i++) if (arr[i].indexOf(kw)!==-1) return i;
    return -1;
  }

  // ── Supabase ───────────────────────────────────────────────────────────────
  var H = { apikey: SUPA_KEY, Authorization: 'Bearer '+SUPA_KEY, Accept: 'application/json' };
  async function sGet(path) {
    var r = await fetch(SUPA_URL+path, {headers:H});
    if (!r.ok) throw new Error('GET '+r.status+': '+await r.text());
    return r.json();
  }
  async function sPost(table, rows, upsert) {
    if (!rows.length) return;
    var prefer = upsert ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal';
    var r = await fetch(SUPA_URL+'/rest/v1/'+table, {
      method:'POST',
      headers:Object.assign({},H,{'Content-Type':'application/json',Prefer:prefer}),
      body:JSON.stringify(rows),
    });
    if (!r.ok) throw new Error('POST '+table+' '+r.status+': '+await r.text());
  }
  async function sPostBatch(table, rows, upsert) {
    for (var i=0;i<rows.length;i+=100) {
      await sPost(table, rows.slice(i,i+100), upsert);
      if (rows.length>100) log('  ✓ lote '+Math.min(i+100,rows.length)+'/'+rows.length);
    }
  }
  async function sPatch(table, filter, body) {
    var r = await fetch(SUPA_URL+'/rest/v1/'+table+'?'+filter, {
      method:'PATCH',
      headers:Object.assign({},H,{'Content-Type':'application/json',Prefer:'return=minimal'}),
      body:JSON.stringify(body),
    });
    if (!r.ok) throw new Error('PATCH '+table+' '+r.status+': '+await r.text());
  }

  // ── extração de linhas da lista (página principal) ─────────────────────────
  function extractRows() {
    var rows = [...document.querySelectorAll(
      'table tbody tr, mat-table mat-row, [role="row"]:not([role="rowheader"])'
    )].filter(function(r){
      return r.offsetWidth>0 && !ov.contains(r) && /\d{4,5}\/\d{4}/.test(r.textContent||'');
    });
    var seen = new Set();
    return rows.map(function(row){
      var txt = row.textContent||'';
      var m = txt.match(/\b(\d{4,5}\/\d{4})\b/);
      if (!m||seen.has(m[1])) return null;
      seen.add(m[1]);
      var dates = [...txt.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map(function(x){return x[1];});
      var sitEl = row.querySelector('[class*="badge"],[class*="chip"],[class*="situac"],[class*="status"]');
      var sit = sitEl ? sitEl.textContent.trim()
                      : (txt.match(/\b(Ativa|Cancelada|Encerrada|Suspensa|Expirada)\b/i)||[''])[0];
      var tipo = txt.match(/\b(Gerenciadora|Participante|Aderente)\b/i);
      return {
        numero_ata: m[1], situacao: sit.trim()||null,
        tipo_uasg: tipo?tipo[1]:null,
        vigencia_inicial: dates[0]?brToISO(dates[0]):null,
        vigencia_final: dates[1]?brToISO(dates[1]):null,
      };
    }).filter(Boolean);
  }

  async function tryExpandAll() {
    var btn = [...document.querySelectorAll('button,a,span,li')]
      .find(function(el){ return /exibir\s*todos|ver\s*todos/i.test(el.textContent||''); });
    if (btn) { btn.click(); await wait(2000); return; }
    var sel = document.querySelector('mat-select[aria-label*="page" i],mat-select[aria-label*="página" i]');
    if (!sel) return;
    sel.click(); await wait(400);
    var opts = [...document.querySelectorAll('mat-option')];
    var best = opts.reduce(function(b,o){
      if (/todos|all/i.test(o.textContent||'')) return o;
      var n=parseInt(o.textContent||'');
      return n>(parseInt((b&&b.textContent)||'0'))?o:b;
    }, null);
    if (best) { best.click(); await wait(2000); }
    else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
  }

  // ── encontra elemento DOM com exatamente o texto da ATA ───────────────────
  // Aceita doc opcional (para buscar na worker tab)
  function findAtaTextEl(numeroAta, searchDoc) {
    searchDoc = searchDoc || document;
    var body = searchDoc.body;
    if (!body) return null;
    var walker = searchDoc.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      if ((node.textContent||'').trim()===numeroAta) {
        var p = node.parentElement;
        // Ignora elementos do overlay da página principal
        if (p && p.offsetWidth && !ov.contains(p)) return p;
      }
    }
    return null;
  }

  // ── sobe do elemento texto ATA até encontrar a row (<tr> / mat-row) ────────
  function findRowForAta(ataEl, doc) {
    var el = ataEl;
    for (var i = 0; i < 20; i++) {
      if (!el || el === doc.body) return null;
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'tr' || tag === 'mat-row') return el;
      if ((el.getAttribute('role') || '') === 'row') return el;
      el = el.parentElement;
    }
    return null;
  }

  // ── botão expand dentro da row — por ícone (sem getBoundingClientRect) ─────
  function findExpandBtnInRow(row) {
    if (!row) return null;
    var btns = [...row.querySelectorAll('button,[role="button"]')];
    var exp = btns.find(function(b) {
      var i = b.querySelector('i');
      var ic = (i ? i.className : '').toLowerCase();
      var mi = b.querySelector('mat-icon,.material-icons');
      var mt = mi ? mi.textContent.trim().toLowerCase() : '';
      return /angle.?down|chevron.?down|expand_more|keyboard_arrow_down/i.test(ic + mt);
    });
    return exp || (btns.length ? btns[btns.length - 1] : null);
  }

  // ── testa se um botão é o visualizar (olho/globo/tooltip) ────────────────
  function isEyeBtn(b) {
    var href = b.getAttribute('href') || b.getAttribute('ng-reflect-router-link') || '';
    if (/\/arp\/\d+\/show/i.test(href)) return true;
    var lbl = (b.getAttribute('aria-label') || b.getAttribute('mattooltip') || b.title || '').toLowerCase();
    if (/visualiz/.test(lbl)) return true;
    var iEl = b.querySelector('i');
    var ic = (iEl ? iEl.className : '').toLowerCase();
    if (/eye.?slash|la-eye-slash/i.test(ic)) return false; // cancelada
    if (/\bla-eye\b|\bfa-eye\b/i.test(ic)) return true;
    if (/\bla-globe\b|\bfa-globe\b/i.test(ic)) return true;
    var mi = b.querySelector('mat-icon,.material-icons');
    var mt = mi ? mi.textContent.trim() : '';
    if (/visibility|remove_red_eye|language|public|open_in_new|launch/.test(mt)) return true;
    return false;
  }

  // ── botão visualizar: procura em siblings da row, fallback doc todo ────────
  async function findVisualizeBtnNearRow(row, doc, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await wait(300);
      // 1. Siblings imediatos da row (onde Angular Material coloca o expanded panel)
      var el = row.nextElementSibling;
      for (var si = 0; si < 4 && el; si++) {
        var cands = [...el.querySelectorAll('button,[role="button"],a')];
        var eye = cands.find(isEyeBtn);
        if (eye) return eye;
        el = el.nextElementSibling;
      }
      // 2. Dentro da própria row (alguns layouts injetam dentro)
      var inRow = [...row.querySelectorAll('button,[role="button"],a')].find(isEyeBtn);
      if (inRow) return inRow;
      // 3. Fallback: documento inteiro (evita perder em estruturas não-padrão)
      var all = [...doc.querySelectorAll('button,[role="button"],a')].find(isEyeBtn);
      if (all) return all;
    }
    return null;
  }

  // ── scraping de itens a partir de um Document ──────────────────────────────
  // A tabela usa Angular CDK + CSS Grid: cabeçalhos e células de dados ficam
  // em ordens DOM DIFERENTES, alinhados apenas pelo CSS (grid-column).
  // Solução: usar as classes "cdk-column-X" / "mat-column-X" que o CDK adiciona
  // a TODOS os elementos de cada coluna (header E data cells).
  function scrapeItens(doc, numeroAta) {
    // Items table: aceita + quant + unit. Participants table only has aceita.
    function hasItemCols(t) {
      var hTxt = [...t.querySelectorAll(
        'mat-header-cell,th,[role="columnheader"]'
      )].map(function(h){ return (h.textContent||'').toLowerCase(); }).join(' ');
      return hTxt.includes('aceita') && hTxt.includes('quant') && hTxt.includes('unit');
    }

    // Strategy 1: find table near "Item da ata:" heading
    var table = null;
    try {
      var walker2 = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
      var node2;
      while ((node2 = walker2.nextNode())) {
        if (/item\s+da\s+ata/i.test(node2.textContent||'') &&
            (node2.textContent||'').trim().length < 40) {
          var headEl = node2.parentElement;
          var search = headEl;
          for (var up2 = 0; up2 < 8 && search && search !== doc.body; up2++) {
            var sib2 = search.nextElementSibling;
            for (var s2 = 0; s2 < 10 && sib2; s2++) {
              var tblCands = [sib2, ...sib2.querySelectorAll(
                'table,mat-table,[role="table"],[role="grid"]'
              )];
              for (var tc = 0; tc < tblCands.length; tc++) {
                var rr = (tblCands[tc].getAttribute('role')||'');
                var tt = (tblCands[tc].tagName||'').toLowerCase();
                if ((tt==='table'||tt==='mat-table'||rr==='table'||rr==='grid') &&
                    hasItemCols(tblCands[tc])) {
                  table = tblCands[tc]; break;
                }
              }
              if (table) break;
              sib2 = sib2.nextElementSibling;
            }
            if (table) break;
            search = search.parentElement;
          }
          if (table) break;
        }
      }
    } catch(e2) {}

    // Strategy 2: fallback — scan all tables for unique column combination
    if (!table) {
      table = [...doc.querySelectorAll(
        'table,mat-table,[role="table"],[role="grid"]'
      )].find(hasItemCols);
    }

    if (!table) {
      log('  ⚠ Tabela itens não encontrada', '#fbbf24');
      return [];
    }

    // ── Cabeçalhos ──────────────────────────────────────────────────────────
    var hdrCells = [...table.querySelectorAll(
      'mat-header-cell,th,thead td,[role="columnheader"]'
    )].filter(function(h){ return parseInt(h.getAttribute('colspan')||'1') <= 1; });

    var hdrTexts = hdrCells.map(function(h){ return (h.textContent||'').trim().toLowerCase(); });
    log('  🔬 hdrs['+hdrCells.length+']: '+hdrTexts.slice(0,6).join(' | '), '#475569');
    console.log('[ARP-BOT] headers ('+numeroAta+'):', hdrTexts);

    // ── Mapeia classe CDK → campo ────────────────────────────────────────────
    // Ex.: classe "cdk-column-cnpjFornecedor" → campo 'cnpj'
    var colClassMap = {}; // 'cdk-column-xyz' → fieldName
    hdrCells.forEach(function(h) {
      var txt = (h.textContent || '').trim().toLowerCase();
      var cdkCls = (h.className || '').split(/\s+/).find(function(c){
        return /^(cdk|mat)-column-/.test(c);
      });
      if (!cdkCls) return;
      if (/\bcnpj\b/i.test(txt))                                               colClassMap[cdkCls] = 'cnpj';
      else if (/fornec/i.test(txt))                                             colClassMap[cdkCls] = 'fornecedor';
      else if (/^n[uúoôº°]|^n[uú]mero|^nr\.?$/i.test(txt.trim())
               && !/cnpj/i.test(txt))                                          colClassMap[cdkCls] = 'numero';
      else if (/\bitem\b/i.test(txt) && !/da\s*ata|informad/i.test(txt))       colClassMap[cdkCls] = 'item';
      else if (/quant/i.test(txt))                                              colClassMap[cdkCls] = 'quantidade';
      else if (/unit[aá]/i.test(txt))                                           colClassMap[cdkCls] = 'valor_unitario';
      else if (/total/i.test(txt) && !/unit/i.test(txt))                       colClassMap[cdkCls] = 'valor_total';
      else if (/limt[ei]|limite/i.test(txt) && !/informad/i.test(txt))        colClassMap[cdkCls] = 'qtd_limite';
      else if (/aceita/i.test(txt))                                             colClassMap[cdkCls] = 'aceita';
    });
    var hasCdk = Object.keys(colClassMap).length > 0;
    console.log('[ARP-BOT] colClassMap:', colClassMap, 'hasCdk:', hasCdk);

    // ── Índices fallback (para tabelas <table> tradicionais sem CDK) ─────────
    var hdrs = hdrTexts;
    var iC = colIdx(hdrs,'cnpj');
    var iF = colIdx(hdrs,'fornec');
    var iN = hdrs.findIndex(function(h){
      return /^n[uúoôº°]|^nr\.?$/i.test(h.trim()) && !/cnpj/i.test(h);
    });
    if (iN<0) iN = hdrs.findIndex(function(h,i){
      return i!==iC && i!==iF && /n[uú]mer/i.test(h);
    });
    var iD = hdrs.findIndex(function(h,i){
      return i!==iN && i!==iC && i!==iF && /\bitem\b/i.test(h) && !/da\s*ata|informad/i.test(h);
    });
    if (iD<0) iD = hdrs.findIndex(function(h,i){
      return i!==iN && i!==iC && i!==iF && /descri/i.test(h);
    });
    var iQ = colIdx(hdrs,'quant');
    var iU = hdrs.findIndex(function(h){ return /unit[aá]/i.test(h); });
    var iT = hdrs.findIndex(function(h,i){ return i!==iU && /total/i.test(h); });
    var iL = hdrs.findIndex(function(h){
      return /limt[ei]|limite/i.test(h) && !/informada/i.test(h);
    });
    var iA = colIdx(hdrs,'aceita');

    // ── Linhas de dados ──────────────────────────────────────────────────────
    var dataRows = [...table.querySelectorAll(
      'tbody tr,mat-row,[role="row"]'
    )].filter(function(r){
      var tag = (r.tagName||'').toLowerCase();
      if (tag === 'mat-header-row') return false;
      if (r.hasAttribute('mat-header-row')) return false;
      if ((r.getAttribute('role')||'') === 'rowheader') return false;
      if (r.querySelector('th,mat-header-cell,[role="columnheader"]')) return false;
      return true;
    });
    if (!dataRows.length) {
      dataRows = [...table.querySelectorAll('tr')].filter(function(r){
        return r.parentElement && (r.parentElement.tagName||'').toLowerCase() !== 'thead';
      });
    }

    if (dataRows[0]) {
      var cs0 = [...dataRows[0].querySelectorAll(
        'td,mat-cell,[role="cell"],[role="gridcell"]'
      )].map(function(c){ return c.textContent.trim().slice(0,15); });
      log('  🔬 rows:'+dataRows.length+' row0['+cs0.length+']: '+cs0.slice(0,5).join(' | '), '#475569');
      console.log('[ARP-BOT] first row cells:', cs0);
    }

    // ── Extrai valor de célula pelo nome CDK da coluna ────────────────────────
    function byCdk(row, field) {
      for (var cls in colClassMap) {
        if (colClassMap[cls] !== field) continue;
        var cell = row.querySelector('.'+cls);
        if (cell) return (cell.textContent||'').trim()||null;
      }
      return null;
    }

    return dataRows.map(function(row){
      var cs = [...row.querySelectorAll(
        'td,mat-cell,[role="cell"],[role="gridcell"]'
      )].map(function(c){ return c.textContent.trim(); });
      if (cs.length < 3 && !hasCdk) return null;
      function g(i){ return (i>=0 && i<cs.length) ? cs[i] : undefined; }

      var cnpj  = hasCdk ? byCdk(row,'cnpj')          : g(iC);
      var forn  = hasCdk ? byCdk(row,'fornecedor')     : g(iF);
      var num   = hasCdk ? byCdk(row,'numero')         : g(iN);
      var desc  = hasCdk ? byCdk(row,'item')           : g(iD);
      var qtd   = hasCdk ? byCdk(row,'quantidade')     : g(iQ);
      var vu    = hasCdk ? byCdk(row,'valor_unitario') : g(iU);
      var vt    = hasCdk ? byCdk(row,'valor_total')    : g(iT);
      var limte = hasCdk ? byCdk(row,'qtd_limite')     : g(iL);
      var acei  = hasCdk ? byCdk(row,'aceita')         : g(iA);

      if (!num && !cnpj) return null;
      return {
        ata_numero:            numeroAta,        // "00164/2026" — FK da ATA-mãe
        numero_ata:            num  || null,     // "00016" — coluna "Número" do site
        descricao:             desc || null,
        cnpj_fornecedor:       cnpj || null,
        fornecedor_nome:       (forn||'').replace(/\s*\(\d+\)\s*$/,'').trim()||null,
        quantidade_registrada: parseBR(qtd)   || null,
        valor_unitario:        parseBR(vu)    || null,
        valor_total:           parseBR(vt)    || null,
        qtd_limite_adesao:     parseInt(limte||'0')||null,
        aceita_adesao:         acei || null,
      };
    }).filter(Boolean);
  }

  // ── scrapa ATA na WORKER TAB: eye na row → /show → scrape → back ───────────
  // Sem expand: o botão fas fa-eye está visível diretamente na row.
  async function scrapeViaWorkerTab(ata) {
    if (!_workerWin || _workerWin.closed) {
      log('  ⚠ Worker tab fechada', '#f87171');
      return [];
    }

    // 1. Aguarda ATA aparecer no DOM da worker tab
    var wAtaEl = null;
    for (var wi = 0; wi < 20; wi++) {
      try { wAtaEl = findAtaTextEl(ata.numero_ata, _workerWin.document); } catch(e) {}
      if (wAtaEl) break;
      await wait(400);
    }
    if (!wAtaEl) { log('  ⚠ '+ata.numero_ata+' não encontrada', '#fbbf24'); return []; }

    // 2. Sobe até a row
    var wRow = findRowForAta(wAtaEl, _workerWin.document);
    if (!wRow) { log('  ⚠ Row não encontrada', '#fbbf24'); return []; }

    // 3. Busca botão eye DIRETAMENTE na row (sem expand)
    var wEyeBtn = [...wRow.querySelectorAll('button,[role="button"],a')].find(isEyeBtn);

    if (!wEyeBtn) {
      // Fallback: expand e procura nos siblings
      var wExpandBtn = findExpandBtnInRow(wRow);
      if (wExpandBtn) {
        wExpandBtn.click();
        log('  ↓ expand (eye não estava na row)', '#475569');
        await wait(700);
        wEyeBtn = await findVisualizeBtnNearRow(wRow, _workerWin.document, 5000);
      }
    }

    if (!wEyeBtn) {
      log('  ⚠ Sem btn visualizar', '#94a3b8');
      return [];
    }

    var eyeDesc = ((wEyeBtn.querySelector('i')||{className:''}).className ||
                   wEyeBtn.getAttribute('aria-label') || wEyeBtn.getAttribute('mattooltip') ||
                   '?').trim().slice(0, 40);
    log('  👁 ['+eyeDesc+']', '#475569');

    // 4. Clica o eye — Angular Router navega para /show
    var wUrlBefore = '';
    try { wUrlBefore = _workerWin.location.href; } catch(e) {}
    wEyeBtn.click();
    log('  → aguardando /show…', '#475569');

    // 5. Aguarda /show URL + tabela renderizar (até 40s)
    var k = 0;
    for (; k < 100; k++) {
      await wait(400);
      try {
        var wLoc = _workerWin.location.href;
        var wTxt = (_workerWin.document.body||{textContent:''}).textContent||'';
        if (/\/show/i.test(wLoc) && wTxt.length > 2000 &&
            /aceita|quantidade\s*registrada|valor\s*unit/i.test(wTxt)) break;
      } catch(e) {}
    }

    var finalUrl = '?';
    try { finalUrl = _workerWin.location.href; } catch(e) {}

    if (k >= 100) {
      log('  ⏱ TIMEOUT — '+finalUrl.slice(-50), '#f87171');
      return [];
    }
    log('  📄 '+finalUrl.slice(-45)+' ('+k+' polls)', '#4ade80');

    // 6. Guard + scrape + captura numero_compra
    var itens = [];
    var numeroCompra = null;
    try {
      if (!/\/show/i.test(finalUrl)) {
        log('  ⚠ URL não é /show — skip', '#f87171');
        return [];
      }
      // Extrai "Compra: 90049/2025" do texto da página
      var pgTxt = (_workerWin.document.body||{innerText:''}).innerText||'';
      var compraM = pgTxt.match(/Compra\s*:\s*([\d]+\/\d{4})/i);
      if (compraM) { numeroCompra = compraM[1]; log('  🛒 Compra: '+numeroCompra, '#a3e635'); }
      itens = scrapeItens(_workerWin.document, ata.numero_ata);
    } catch(e) { log('  ⚠ scrape: '+e.message, '#f87171'); }

    // 7. Salva numero_compra na ATA
    if (numeroCompra) {
      try {
        await sPatch('atas_gap_mn',
          'numero_ata=eq.'+encodeURIComponent(ata.numero_ata),
          { numero_compra: numeroCompra });
      } catch(e) { log('  ⚠ compra PATCH: '+e.message, '#fbbf24'); }
    }

    // 8. Volta para a lista
    try { _workerWin.history.back(); } catch(e) {}
    await wait(1500);

    return itens;
  }

  // ── loop principal ────────────────────────────────────────────────────────
  async function processAtasLoop(pending, startIdx) {
    prog(startIdx, pending.length);
    for (var i=startIdx; i<pending.length; i++) {
      if (_stopped) return;
      var ata = pending[i];
      log('▶ '+ata.numero_ata+' ('+(i+1)+'/'+pending.length+')');
      prog(i, pending.length, ata.numero_ata);

      var itens = await scrapeViaWorkerTab(ata);

      if (itens.length) {
        try {
          await sPost('itens_ata_gap_mn', itens, true);
          setLast('✅ '+itens.length+' itens → '+ata.numero_ata, '#4ade80');
        } catch(e) {
          log('❌ Salvar: '+e.message, '#f87171');
        }
      } else {
        setLast('⚠ Sem itens: '+ata.numero_ata, '#94a3b8');
      }
      prog(i+1, pending.length, ata.numero_ata);
    }
    log('🎉 Concluído! '+(pending.length-startIdx)+' ATA(s).', '#4ade80');
    try { if (_workerWin && !_workerWin.closed) _workerWin.close(); } catch(e) {}
  }

  // ── modo LISTA ─────────────────────────────────────────────────────────────
  async function runList() {
    if (!_workerWin) {
      log('❌ Worker tab não abriu. Autorize popups e recarregue o bookmarklet.', '#f87171');
      return;
    }
    log('Aguardando worker tab carregar…');
    await wait(2500); // dá tempo da worker tab inicializar o Angular

    log('Carregando todas as ATAs…');
    await tryExpandAll();

    var pageItems = extractRows();
    log(pageItems.length+' ATA(s) na página.');
    if (!pageItems.length) { log('⚠ Nenhuma linha reconhecida.', '#fbbf24'); return; }

    log('Consultando Supabase…');
    var existing   = await sGet('/rest/v1/atas_gap_mn?select=numero_ata&limit=10000');
    var existSet   = new Set((existing||[]).map(function(x){return x.numero_ata;}));
    var existItens = await sGet('/rest/v1/itens_ata_gap_mn?select=ata_numero&limit=10000');
    var existItSet = new Set((existItens||[]).map(function(x){return x.ata_numero;}));

    var newAtas  = pageItems.filter(function(a){return !existSet.has(a.numero_ata);});
    var semItens = pageItems.filter(function(a){
      return existSet.has(a.numero_ata) && !existItSet.has(a.numero_ata);
    });
    log(existSet.size+' registradas · '+newAtas.length+' novas · '+semItens.length+' sem itens.');

    if (newAtas.length) {
      log('Inserindo '+newAtas.length+' ATA(s)…');
      await sPostBatch('atas_gap_mn', newAtas, true);
      log('✅ Metadados salvos!', '#4ade80');
    }

    var toProcess = newAtas.concat(semItens);
    if (!toProcess.length) {
      log('✅ Tudo sincronizado!', '#4ade80');
      try { if (_workerWin && !_workerWin.closed) _workerWin.close(); } catch(e) {}
      return;
    }

    log('Iniciando captura de '+toProcess.length+' ATA(s)… (~'+Math.ceil(toProcess.length*8/60)+' min)', '#38bdf8');
    await processAtasLoop(toProcess, 0);
  }

  // ── dispatch ───────────────────────────────────────────────────────────────
  (async function() {
    try {
      await wait(400);
      await runList();
    } catch(e) {
      log('❌ '+(e&&e.message?e.message:String(e)), '#f87171');
      console.error('[ARP-BOT]', e);
    }
  })();
})();
