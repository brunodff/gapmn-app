// arp-bot.js — Robô de sincronização de ATAs + Itens
// Bookmarklet: javascript:(function(){var s=document.createElement('script');s.src='https://gapmn.app/arp-bot.js?v='+Date.now();document.body.appendChild(s);})();
//
// Fluxo: abre UMA aba-worker sincronamente (dentro do gesto do bookmarklet).
// Para cada ATA, clica expand + eye DENTRO da worker tab → Angular navega
// internamente para /arp/{id}/show → lê tabela → volta para lista.

(function () {
  'use strict';

  var _externalOnly = !!window.__arpBotExternalOnly;

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
  var _sheetsUrl = null; // null = Supabase mode; string = Sheets/Apps-Script mode
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
    var prefer = upsert ? 'resolution=ignore-duplicates,return=minimal' : 'return=minimal';
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

  // ── Sheets / Apps-Script helpers ──────────────────────────────────────────
  async function sheetsPost(type, rows) {
    if (!rows.length || !_sheetsUrl) return;
    var r = await fetch(_sheetsUrl, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain'}, // text/plain evita preflight CORS
      body: JSON.stringify({type: type, rows: rows}),
      redirect: 'follow',
    });
    if (!r.ok) throw new Error('Sheets HTTP '+r.status);
  }
  async function sheetsPostBatch(type, rows) {
    for (var i = 0; i < rows.length; i += 50) {
      await sheetsPost(type, rows.slice(i, i+50));
      if (rows.length > 50) log('  ✓ lote '+(Math.min(i+50, rows.length))+'/'+rows.length);
    }
  }

  // ── Painel de configuração: escolha do destino ─────────────────────────────
  function showConfigPanel() {
    return new Promise(function(resolve) {
      var logEl  = document.getElementById('__arplog__');
      var progEl = document.getElementById('__arpprog__');
      var stopEl = document.getElementById('__arpstop__');
      if (logEl)  logEl.style.display  = 'none';
      if (progEl) progEl.style.display = 'none';
      if (stopEl) stopEl.style.display = 'none';

      var cfg = document.createElement('div');
      cfg.id = '__arpcfg__';
      cfg.style.cssText = 'padding:4px 0 8px';

      if (_externalOnly) {
        // Usuários sem setor: somente modo planilha — sem opção Supabase
        cfg.innerHTML =
          '<div style="font-size:12px;color:#94a3b8;margin-bottom:10px">Destino dos dados:</div>' +
          '<div style="padding:8px 12px;background:#1a2e1a;border:1px solid #4ade80;border-radius:8px;' +
            'color:#e2e8f0;font-size:12px;margin-bottom:10px">' +
            '📊 Minha Planilha <span style="color:#64748b;font-size:10px">(Google Sheets via Apps Script)</span></div>' +
          '<input id="__arp_urlinp__" placeholder="Cole aqui a URL do Web App (doPost)" ' +
            'style="width:100%;box-sizing:border-box;background:#0f172a;border:1px solid #4ade80;' +
            'border-radius:6px;color:#e2e8f0;font-size:11px;padding:6px 10px;margin-bottom:6px"/>' +
          '<button id="__arp_go__" style="width:100%;background:#4ade80;border:none;' +
            'color:#0f172a;font-size:12px;font-weight:700;padding:7px;border-radius:6px;' +
            'cursor:pointer">Iniciar →</button>';

        ov.insertBefore(cfg, logEl || ov.firstChild);
        setTimeout(function() {
          var inp = document.getElementById('__arp_urlinp__');
          if (inp) inp.focus();
        }, 50);

        document.getElementById('__arp_go__').onclick = function() {
          var url = (document.getElementById('__arp_urlinp__').value||'').trim();
          if (!url) {
            document.getElementById('__arp_urlinp__').style.borderColor = '#f87171';
            return;
          }
          cfg.remove();
          if (logEl)  logEl.style.display  = '';
          if (stopEl) stopEl.style.display = '';
          resolve({mode:'sheets', url: url});
        };
      } else {
        // Usuários com setor (SEO/SCON/SLIC/ADMIN/DEV): escolha Supabase ou Planilha
        cfg.innerHTML =
          '<div style="font-size:12px;color:#94a3b8;margin-bottom:10px">Destino dos dados:</div>' +
          '<button id="__arp_supa__" style="display:block;width:100%;text-align:left;padding:8px 12px;' +
            'background:#1e3a5f;border:1px solid #38bdf8;border-radius:8px;color:#e2e8f0;' +
            'font-size:12px;cursor:pointer;margin-bottom:8px">' +
            '🗄 Supabase GAP-MN ' +
            '<span style="color:#64748b;font-size:10px">(uso interno)</span></button>' +
          '<button id="__arp_sheets__" style="display:block;width:100%;text-align:left;padding:8px 12px;' +
            'background:#1a2e1a;border:1px solid #4ade80;border-radius:8px;color:#e2e8f0;' +
            'font-size:12px;cursor:pointer;margin-bottom:8px">' +
            '📊 Minha Planilha ' +
            '<span style="color:#64748b;font-size:10px">(Google Sheets via Apps Script)</span></button>' +
          '<div id="__arp_urlwrap__" style="display:none;margin-top:4px">' +
            '<input id="__arp_urlinp__" placeholder="Cole aqui a URL do Web App (doPost)" ' +
              'style="width:100%;box-sizing:border-box;background:#0f172a;border:1px solid #4ade80;' +
              'border-radius:6px;color:#e2e8f0;font-size:11px;padding:6px 10px;margin-bottom:6px"/>' +
            '<button id="__arp_go__" style="width:100%;background:#4ade80;border:none;' +
              'color:#0f172a;font-size:12px;font-weight:700;padding:7px;border-radius:6px;' +
              'cursor:pointer">Iniciar →</button>' +
          '</div>';

        ov.insertBefore(cfg, logEl || ov.firstChild);

        document.getElementById('__arp_supa__').onclick = function() {
          cfg.remove();
          if (logEl)  logEl.style.display  = '';
          if (stopEl) stopEl.style.display = '';
          resolve({mode:'supabase'});
        };

        document.getElementById('__arp_sheets__').onclick = function() {
          document.getElementById('__arp_urlwrap__').style.display = 'block';
          document.getElementById('__arp_urlinp__').focus();
        };

        document.getElementById('__arp_go__').onclick = function() {
          var url = (document.getElementById('__arp_urlinp__').value||'').trim();
          if (!url) {
            document.getElementById('__arp_urlinp__').style.borderColor = '#f87171';
            return;
          }
          cfg.remove();
          if (logEl)  logEl.style.display  = '';
          if (stopEl) stopEl.style.display = '';
          resolve({mode:'sheets', url: url});
        };
      }
    });
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

      // Tenta CDK column para número da ATA (mais confiável que primeiro match do regex,
      // evita capturar número de processo que aparece em outra coluna da mesma linha)
      var cdkCell = row.querySelector(
        '[class*="cdk-column-numero"],[class*="mat-column-numero"],' +
        '[class*="cdk-column-ata"],[class*="mat-column-ata"],' +
        '[class*="cdk-column-numeroAta"],[class*="mat-column-numeroAta"]'
      );
      var ataNum = null;
      if (cdkCell) {
        var m2 = (cdkCell.textContent||'').trim().match(/^(\d{4,5}\/\d{4})$/);
        if (m2) ataNum = m2[1];
      }
      if (!ataNum) {
        var m = txt.match(/\b(\d{4,5}\/\d{4})\b/);
        if (!m) return null;
        ataNum = m[1];
      }
      if (seen.has(ataNum)) return null;
      seen.add(ataNum);

      var dates = [...txt.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map(function(x){return x[1];});
      var sitEl = row.querySelector('[class*="badge"],[class*="chip"],[class*="situac"],[class*="status"]');
      var sit = sitEl ? sitEl.textContent.trim()
                      : (txt.match(/\b(Ativa|Cancelada|Encerrada|Suspensa|Expirada)\b/i)||[''])[0];

      // Guarda: linha sem datas E sem situação conhecida não é uma ATA real.
      // Acontece quando número de processo (ex: 90078/2025) aparece no DOM mas a linha
      // não tem os campos vigência / situação de uma ATA.
      if (!dates.length && !/Ativa|Cancelada|Encerrada|Suspensa|Expirada/i.test(sit||'')) {
        console.log('[ARP-BOT] skip (sem dados mínimos): '+ataNum);
        return null;
      }

      var tipo = txt.match(/\b(Gerenciadora|Participante|Aderente)\b/i);

      // Extrai URL da página de detalhe diretamente da linha (evita depender de paginação na worker tab)
      var detailUrl = null;
      var linkEls = [...row.querySelectorAll('a,[href]')];
      for (var li = 0; li < linkEls.length; li++) {
        var lh = linkEls[li].getAttribute('href') || linkEls[li].getAttribute('ng-reflect-router-link') || '';
        if (/\/arp\/\d+\/show/i.test(lh)) { detailUrl = lh; break; }
      }
      // Fallback: também verifica botões com ng-reflect-router-link
      if (!detailUrl) {
        var btnEls = [...row.querySelectorAll('button,[role="button"]')];
        for (var bi = 0; bi < btnEls.length; bi++) {
          var bh = btnEls[bi].getAttribute('ng-reflect-router-link') || btnEls[bi].getAttribute('href') || '';
          if (/\/arp\/\d+\/show/i.test(bh)) { detailUrl = bh; break; }
        }
      }

      return {
        numero_ata: ataNum, situacao: sit.trim()||null,
        tipo_uasg: tipo?tipo[1]:null,
        vigencia_inicial: dates[0]?brToISO(dates[0]):null,
        vigencia_final: dates[1]?brToISO(dates[1]):null,
        detailUrl: detailUrl,
      };
    }).filter(Boolean);
  }

  // Aceita qualquer Document (aba principal ou worker)
  async function tryExpandAllIn(doc) {
    try {
      // 1. Botão "Exibir todos" / "Ver todos"
      var btn = [...doc.querySelectorAll('button,a,span,li')]
        .find(function(el){ return /exibir\s*todos|ver\s*todos/i.test(el.textContent||''); });
      if (btn) { btn.click(); await wait(3000); return; }

      // 2. Seletor do paginador — tenta várias variantes de classe/aria-label
      var sel = doc.querySelector('.mat-paginator-page-size-select')      // Angular Material (v13-)
             || doc.querySelector('.mat-mdc-paginator-page-size-select')   // Angular Material (MDC/v15+)
             || doc.querySelector('mat-paginator mat-select')              // qualquer mat-select dentro do paginador
             || doc.querySelector('[class*="paginator"] mat-select')
             || doc.querySelector('mat-select[aria-label*="página" i]')
             || doc.querySelector('mat-select[aria-label*="registro" i]')
             || doc.querySelector('mat-select[aria-label*="page" i]')
             || doc.querySelector('mat-select[aria-label*="item" i]');

      if (!sel) {
        log('  ℹ expand: paginador não encontrado', '#475569');
        return;
      }

      log('  ↪ abrindo dropdown de paginação…', '#475569');
      // Foca a janela antes de clicar (abas em background podem precisar)
      try { if (doc.defaultView) doc.defaultView.focus(); } catch(e2) {}
      sel.click();

      // Aguarda opções renderizarem — Angular pode ser lento em aba oculta (RAF throttled)
      var opts = [];
      for (var t = 0; t < 15; t++) {
        await wait(400);
        opts = [...doc.querySelectorAll('mat-option')];
        if (opts.length > 0) break;
      }

      if (!opts.length) {
        log('  ⚠ expand: dropdown sem opções após 6s', '#fbbf24');
        return;
      }
      log('  ↪ opções: ['+opts.map(function(o){return o.textContent.trim();}).join(', ')+']', '#475569');

      var todoOpt = opts.find(function(o){ return /\btodos\b|\ball\b/i.test((o.textContent||'').trim()); });
      if (todoOpt) {
        todoOpt.click();
        log('  ✓ "Todos" selecionado — aguardando renderização…', '#4ade80');
        await wait(5000); // 800 ATAs precisam de tempo para renderizar
        return;
      }

      // Fallback: maior opção numérica disponível
      var numOpts = opts
        .map(function(o){ return { el:o, n:parseInt((o.textContent||'').trim()||'0') }; })
        .filter(function(x){ return x.n > 25; })
        .sort(function(a,b){ return b.n - a.n; });
      if (numOpts.length) {
        numOpts[0].el.click();
        log('  ✓ '+numOpts[0].n+' por página selecionado', '#4ade80');
        await wait(4000);
      } else {
        sel.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
        log('  ⚠ expand: sem "Todos" nem opção > 25 — paginação mantida', '#fbbf24');
      }
    } catch(e) { log('⚠ expand: '+(e&&e.message||e), '#fbbf24'); }
  }
  async function tryExpandAll() { await tryExpandAllIn(document); }

  // ── encontra elemento DOM com exatamente o texto da ATA ───────────────────
  // allowHidden=true: não exige offsetWidth>0 (necessário para aba em background)
  function findAtaTextEl(numeroAta, searchDoc, allowHidden) {
    searchDoc = searchDoc || document;
    var body = searchDoc.body;
    if (!body) return null;
    var walker = searchDoc.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      if ((node.textContent||'').trim()===numeroAta) {
        var p = node.parentElement;
        if (!p) continue;
        if (ov && ov.contains && ov.contains(p)) continue; // ignora overlay
        if (!allowHidden && !p.offsetWidth) continue;
        return p;
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

  // ── scrapa ATA na WORKER TAB: navega direto para /show → scrape ─────────────
  // Estratégia primária: usa detailUrl extraída da lista principal (sem depender de paginação).
  // Fallback: busca a ATA na lista da worker tab e clica no botão eye.
  async function scrapeViaWorkerTab(ata) {
    if (!_workerWin || _workerWin.closed) {
      log('  ⚠ Worker tab fechada', '#f87171');
      return [];
    }

    // ── ESTRATÉGIA A: navegação direta pela URL (não depende de paginação) ─────
    if (ata.detailUrl) {
      var detPath = ata.detailUrl;
      var absUrl = /^https?:\/\//i.test(detPath)
        ? detPath
        : (location.origin + (detPath.startsWith('/') ? '' : '/') + detPath);
      log('  → '+absUrl.slice(-55)+'…', '#475569');

      // ID numérico da ATA esperada (ex: /arp/4521/show → "4521")
      var expectedAid = (absUrl.match(/\/arp\/(\d+)\/show/i) || [])[1] || '';

      try { _workerWin.location.replace(absUrl); } catch(navErr) {
        log('  ⚠ navigate: '+(navErr&&navErr.message||navErr), '#f87171');
        return await _scrapeViaList(ata);
      }

      // Aguarda Angular renderizar a página da ATA CORRETA (verifica ID exato)
      var k = 0;
      for (; k < 125; k++) {
        await wait(400);
        try {
          var wUrl = _workerWin.location.href;
          var wTxt = (_workerWin.document.body||{textContent:''}).textContent||'';
          // Checa o ID exato — evita aceitar página anterior ainda carregada
          var urlOk = expectedAid
            ? wUrl.indexOf('/arp/'+expectedAid+'/show') !== -1
            : /\/arp\/\d+\/show/i.test(wUrl);
          if (urlOk && wTxt.length > 2000 &&
              /aceita|quantidade\s*registrada|valor\s*unit/i.test(wTxt)) break;
        } catch(e) {}
      }
      if (k >= 125) { log('  ⏱ TIMEOUT', '#f87171'); return []; }
      log('  📄 ('+k+' polls)', '#4ade80');

      return _scrapeCurrentShow(ata);
    }

    // ── ESTRATÉGIA B: busca ATA na lista da worker tab (fallback) ─────────────
    return await _scrapeViaList(ata);
  }

  // ── extrai itens + numero_compra do /show já carregado na worker tab ─────────
  async function _scrapeCurrentShow(ata) {
    var itens = [];
    var numeroCompra = null;

    // ── Guarda: confirma que a worker tab mostra a ATA CORRETA ────────────────
    try {
      var safeTxt = (_workerWin.document.body||{textContent:''}).textContent||'';
      var ataNum  = (ata.numero_ata||'').split('/')[0]; // ex: "90005"
      if (ataNum && safeTxt.indexOf(ataNum) === -1) {
        log('  ⚠ GUARDA: página não contém '+ata.numero_ata+' — ATA trocada, abortando scrape', '#f87171');
        return [];
      }
    } catch(ge) {}

    try {
      try {
        var labelEls = [..._workerWin.document.querySelectorAll('td,th,dt,label,span,div,p,li')];
        for (var ci = 0; ci < labelEls.length; ci++) {
          var lbl = (labelEls[ci].textContent||'').trim();
          if (/^(?:N[ºo°\.]\s*)?Compra\s*:?\s*$/i.test(lbl)) {
            var valEl = labelEls[ci].nextElementSibling;
            if (!valEl && labelEls[ci].parentElement) {
              var parNext = labelEls[ci].parentElement.nextElementSibling;
              if (parNext) valEl = parNext.querySelector('td,dd,span') || parNext;
            }
            if (valEl) {
              var vtx = (valEl.textContent||'').trim();
              if (/^\d{4,6}\/\d{4}$/.test(vtx)) { numeroCompra = vtx; break; }
            }
            // também tenta extrair do próprio elemento se label e valor estão juntos
            var lblFull = (labelEls[ci].parentElement ? labelEls[ci].parentElement.textContent : lbl)||'';
            var inlineM = lblFull.match(/(?:Compra)\s*:?\s*(\d{4,6}\/\d{4})/i);
            if (inlineM) { numeroCompra = inlineM[1]; break; }
          }
        }
      } catch(ce) {}
      if (!numeroCompra) {
        var pgTxt = (_workerWin.document.body||{textContent:''}).textContent||'';
        var compraM = pgTxt.match(/\bCompra\s*:?\s*(\d{4,6}\/\d{4})/i)
                   || pgTxt.match(/N[ºo°\.]\s*Compra\s*:?\s*(\d{4,6}\/\d{4})/i);
        if (compraM) numeroCompra = compraM[1];
      }
      if (numeroCompra) log('  🛒 Compra: '+numeroCompra, '#a3e635');
      else log('  ⚠ numero_compra não encontrado', '#fbbf24');
      itens = scrapeItens(_workerWin.document, ata.numero_ata);
    } catch(e) { log('  ⚠ scrape: '+e.message, '#f87171'); }

    if (numeroCompra && itens.length) {
      itens.forEach(function(it) { it.numero_compra = numeroCompra; });
    }
    // Sem history.back() — próxima ATA navegará direto para seu próprio URL
    return itens;
  }

  // ── fallback: encontra ATA na lista e clica botão eye (requer paginação expandida) ──
  async function _scrapeViaList(ata) {
    // 1. Aguarda ATA aparecer no DOM da worker tab (allowHidden=true para aba background)
    var wAtaEl = null;
    for (var wi = 0; wi < 20; wi++) {
      try { wAtaEl = findAtaTextEl(ata.numero_ata, _workerWin.document, true); } catch(e) {}
      if (wAtaEl) break;
      await wait(400);
    }
    if (!wAtaEl) { log('  ⚠ '+ata.numero_ata+' não encontrada na worker tab', '#fbbf24'); return []; }

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
    // Verifica que URL MUDOU em relação a antes do clique (evita aceitar página anterior)
    var ataNumOnly = (ata.numero_ata||'').split('/')[0]; // ex: "90005"
    var k = 0;
    for (; k < 100; k++) {
      await wait(400);
      try {
        var wLoc = _workerWin.location.href;
        var wTxt = (_workerWin.document.body||{textContent:''}).textContent||'';
        var urlChanged = wLoc !== wUrlBefore;
        var hasContent = wTxt.length > 2000 && /aceita|quantidade\s*registrada|valor\s*unit/i.test(wTxt);
        // Confirma que o número da ATA aparece na página (guarda anti-troca)
        var hasAta = ataNumOnly ? wTxt.indexOf(ataNumOnly) !== -1 : true;
        if (urlChanged && /\/show/i.test(wLoc) && hasContent && hasAta) break;
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
      // Extrai "Compra: 90049/2025" — DOM approach (innerText falha em aba oculta)
      // Abordagem 1: acha o <td>/<th> com texto exato "Compra:" e lê o próximo sibling
      try {
        var labelEls = [..._workerWin.document.querySelectorAll('td,th,dt,label,span,div,p,li')];
        for (var ci = 0; ci < labelEls.length; ci++) {
          var lbl = (labelEls[ci].textContent||'').trim();
          if (/^(?:N[ºo°\.]\s*)?Compra\s*:?\s*$/i.test(lbl)) {
            var valEl = labelEls[ci].nextElementSibling;
            if (!valEl && labelEls[ci].parentElement) {
              var parNext = labelEls[ci].parentElement.nextElementSibling;
              if (parNext) valEl = parNext.querySelector('td,dd,span') || parNext;
            }
            if (valEl) {
              var vt = (valEl.textContent||'').trim();
              if (/^\d{4,6}\/\d{4}$/.test(vt)) { numeroCompra = vt; break; }
            }
            var lblFull = (labelEls[ci].parentElement ? labelEls[ci].parentElement.textContent : lbl)||'';
            var inlineM2 = lblFull.match(/(?:Compra)\s*:?\s*(\d{4,6}\/\d{4})/i);
            if (inlineM2) { numeroCompra = inlineM2[1]; break; }
          }
        }
      } catch(ce) {}
      // Abordagem 2 (fallback): textContent do body — NÃO innerText (vazio em aba oculta)
      if (!numeroCompra) {
        var pgTxt = (_workerWin.document.body||{textContent:''}).textContent||'';
        var compraM = pgTxt.match(/\bCompra\s*:?\s*(\d{4,6}\/\d{4})/i)
                   || pgTxt.match(/N[ºo°\.]\s*Compra\s*:?\s*(\d{4,6}\/\d{4})/i);
        if (compraM) numeroCompra = compraM[1];
      }
      if (numeroCompra) log('  🛒 Compra: '+numeroCompra, '#a3e635');
      else log('  ⚠ numero_compra não encontrado', '#fbbf24');
      itens = scrapeItens(_workerWin.document, ata.numero_ata);
    } catch(e) { log('  ⚠ scrape: '+e.message, '#f87171'); }

    // 7. Anexa numero_compra a cada item
    if (numeroCompra && itens.length) {
      itens.forEach(function(it) { it.numero_compra = numeroCompra; });
    }

    // 8. Volta para a lista
    try { _workerWin.history.back(); } catch(e) {}
    await wait(1800);
    // Re-expande se Angular resetou a paginação ao voltar
    try {
      var wVisible = (_workerWin.document.body.textContent||'').match(/\d{4,5}\/\d{4}/g);
      if (!wVisible || wVisible.length < 30) {
        await tryExpandAllIn(_workerWin.document);
      }
    } catch(e) {}

    return itens;
  }

  // ── helpers de paginação (worker tab) ────────────────────────────────────

  // Retorna números de ATA visíveis na worker tab (sem filtro de offsetWidth)
  function extractWorkerAtaNumbers() {
    if (!_workerWin || _workerWin.closed) return [];
    try {
      var seen = new Set(), res = [];
      var walker = _workerWin.document.createTreeWalker(
        _workerWin.document.body, NodeFilter.SHOW_TEXT, null, false
      );
      var nd;
      while ((nd = walker.nextNode())) {
        var t = (nd.textContent || '').trim();
        if (/^\d{4,5}\/\d{4}$/.test(t) && !seen.has(t)) { seen.add(t); res.push(t); }
      }
      return res;
    } catch(e) { return []; }
  }

  // Clica no botão "próxima página" da worker tab. Retorna true se funcionou.
  async function clickNextPageOnWorker() {
    try {
      var doc = _workerWin.document;
      var btn = doc.querySelector('button[aria-label*="Próxima" i]')
             || doc.querySelector('button[aria-label*="Next" i]')
             || doc.querySelector('.mat-paginator-navigation-next')
             || doc.querySelector('.mat-mdc-paginator-navigation-next');
      if (!btn) {
        btn = [...doc.querySelectorAll('mat-paginator button,[class*="paginator"] button')]
          .find(function(b) {
            if (b.disabled || b.hasAttribute('disabled')) return false;
            var mi = b.querySelector('mat-icon,.material-icons');
            return mi && /^navigate_next$|^chevron_right$/.test((mi.textContent || '').trim());
          });
      }
      if (!btn || btn.disabled || btn.hasAttribute('disabled')) return false;
      btn.click();
      for (var w = 0; w < 15; w++) { await wait(300); if (extractWorkerAtaNumbers().length > 0) break; }
      return true;
    } catch(e) { return false; }
  }

  // Navega a worker tab até que expectedNums apareçam (ignora tamanho da página).
  // Se expectedNums vazio: navega exatamente targetPage-1 cliques a partir do início.
  // Retorna true se chegou na página certa, false se esgotou cliques ou não há próxima.
  async function goToWorkerPage(targetPage, expectedNums) {
    if (!_workerWin || _workerWin.closed) return false;
    // Atalho: já estamos na página certa
    if (expectedNums && expectedNums.length) {
      var vis = new Set(extractWorkerAtaNumbers());
      if (expectedNums.some(function(n) { return vis.has(n); })) return true;
    }
    // Vai para primeira página
    try {
      var doc = _workerWin.document;
      var firstBtn = doc.querySelector('.mat-paginator-navigation-first')
                  || doc.querySelector('.mat-mdc-paginator-navigation-first')
                  || doc.querySelector('button[aria-label*="Primeira" i]')
                  || doc.querySelector('button[aria-label*="First" i]');
      if (firstBtn && !firstBtn.disabled && !firstBtn.hasAttribute('disabled')) {
        firstBtn.click();
        for (var w = 0; w < 10; w++) { await wait(300); if (extractWorkerAtaNumbers().length > 0) break; }
      }
    } catch(e) {}
    // Com expectedNums: clica "próxima" até elas aparecerem (agnóstico ao tamanho da página)
    if (expectedNums && expectedNums.length) {
      var maxClicks = targetPage + 8;
      for (var c = 0; c < maxClicks; c++) {
        var vis2 = new Set(extractWorkerAtaNumbers());
        if (expectedNums.some(function(n) { return vis2.has(n); })) return true;
        var ok = await clickNextPageOnWorker();
        if (!ok) return false;
      }
      return false;
    }
    // Sem expectedNums: clica exatamente targetPage-1 vezes
    for (var p = 1; p < targetPage; p++) {
      var ok = await clickNextPageOnWorker();
      if (!ok) { log('  ⚠ Não alcancei página '+targetPage+' (parei em '+p+')', '#fbbf24'); return false; }
    }
    return true;
  }

  // ── loop principal — página a página ────────────────────────────────────────
  async function processAllPagesOnWorker(toProcess) {
    var synced = 0;
    var pendingMap = {};
    toProcess.forEach(function(a) { pendingMap[a.numero_ata] = a; });
    var done = new Set();
    var currentPage = 1;
    var consecEmpty = 0;

    while (done.size < toProcess.length && !_stopped) {
      var visNums = extractWorkerAtaNumbers();
      var onPage  = visNums.filter(function(n) { return pendingMap[n]; });
      log('Pg.'+currentPage+': '+visNums.length+' visíveis, '+onPage.length+' pendentes', '#475569');

      if (onPage.length === 0) {
        if (++consecEmpty > 3) { log('⚠ Sem progresso — encerrando.', '#f87171'); break; }
        var ok = await clickNextPageOnWorker();
        if (!ok) { log('⚠ '+( toProcess.length - done.size)+' ATAs não encontradas em nenhuma página.', '#fbbf24'); break; }
        currentPage++;
        continue;
      }
      consecEmpty = 0;

      for (var i = 0; i < onPage.length; i++) {
        if (_stopped) return synced;
        var ata = pendingMap[onPage[i]];
        log('▶ '+ata.numero_ata+' ('+(done.size+1)+'/'+toProcess.length+')');
        prog(done.size, toProcess.length, ata.numero_ata);

        var itens = await _scrapeViaList(ata);
        // Após _scrapeViaList: worker voltou para lista (history.back + re-expand se necessário)
        // Pode ter resetado para página 1 caso Angular não restaure o estado do paginador.

        if (itens.length) {
          try {
            if (_sheetsUrl) {
              await sheetsPost('itens', itens);
            } else {
              await sPost('itens_ata_gap_mn', itens, true);
            }
            setLast('✅ '+itens.length+' → '+ata.numero_ata, '#4ade80'); synced++;
          }
          catch(e) { log('❌ '+e.message, '#f87171'); }
        } else {
          setLast('⚠ Sem itens: '+ata.numero_ata, '#94a3b8');
        }
        done.add(ata.numero_ata);
        delete pendingMap[ata.numero_ata];
        prog(done.size, toProcess.length, ata.numero_ata);

        // Se há mais ATAs a processar nesta página, garante que a worker está na página certa
        if (i < onPage.length - 1) {
          await goToWorkerPage(currentPage, onPage.slice(i + 1));
        }
      }

      if (done.size >= toProcess.length) break;

      // Avança para próxima página.
      // Tenta clicar "next" de onde estamos. Se falhar (ex: disabled porque estamos no fim
      // ou ainda na página 1), navega até currentPage e tenta novamente.
      var ok = await clickNextPageOnWorker();
      if (!ok) {
        // Talvez estejamos em outra página (ex: página 1 após reset). Navega para currentPage.
        await goToWorkerPage(currentPage, []);
        ok = await clickNextPageOnWorker();
      }
      if (!ok) { log('⚠ '+( toProcess.length - done.size)+' ATAs restantes após última página.', '#fbbf24'); break; }
      currentPage++;
    }

    log('🎉 Concluído! '+done.size+'/'+toProcess.length+' ATAs processadas.', '#4ade80');
    try { if (_workerWin && !_workerWin.closed) _workerWin.close(); } catch(e) {}
    return synced;
  }

  // ── coleta URLs de detalhe pela ABA PRINCIPAL (evita expand em background) ──
  // Fase 1 — estática: href / ng-reflect-router-link já no DOM
  // Fase 2 — dinâmica: clica o olho na aba principal, captura URL, volta
  async function gatherDetailUrls(toProcess) {
    var missing = toProcess.filter(function(a){ return !a.detailUrl; });
    if (!missing.length) return;
    log('Extraindo URLs ('+missing.length+' ATAs)…', '#38bdf8');

    // Fase 1 — estática
    var staticFound = 0;
    missing.forEach(function(ata) {
      var ataEl = findAtaTextEl(ata.numero_ata, document, false);
      if (!ataEl) return;
      var row = findRowForAta(ataEl, document);
      if (!row) return;
      var els = row.querySelectorAll('*');
      for (var i = 0; i < els.length; i++) {
        var h = els[i].getAttribute('href') || els[i].getAttribute('ng-reflect-router-link') || '';
        if (/\/arp\/\d+\/show/i.test(h)) {
          ata.detailUrl = /^https?:\/\//.test(h) ? h
                        : location.origin + (h.startsWith('/') ? h : '/'+h);
          staticFound++;
          break;
        }
      }
    });
    log('  Estático: '+staticFound+'/'+missing.length+' URLs.', '#475569');

    // Fase 2 — dinâmica: clique + captura na aba principal
    var stillMissing = toProcess.filter(function(a){ return !a.detailUrl; });
    if (!stillMissing.length) return;
    log('  Dinâmico: '+stillMissing.length+' ATAs — clique na aba principal…', '#fbbf24');

    for (var mi = 0; mi < stillMissing.length && !_stopped; mi++) {
      var ata = stillMissing[mi];
      if (mi % 25 === 0 && mi > 0)
        log('  URLs: '+mi+'/'+stillMissing.length, '#475569');

      var ataEl = findAtaTextEl(ata.numero_ata, document, false);
      if (!ataEl) continue;
      var row = findRowForAta(ataEl, document);
      if (!row) continue;

      // Tenta encontrar o botão olho (direto na row ou após expand)
      var eye = [...row.querySelectorAll('button,[role="button"],a')].find(isEyeBtn);
      if (!eye) {
        var expBtn = findExpandBtnInRow(row);
        if (expBtn) {
          expBtn.click();
          await wait(400);
          eye = await findVisualizeBtnNearRow(row, document, 2500);
        }
      }
      if (!eye) continue;

      // Tenta estático no próprio botão
      var eh = eye.getAttribute('href') || eye.getAttribute('ng-reflect-router-link') || '';
      if (/\/arp\/\d+\/show/i.test(eh)) {
        ata.detailUrl = /^https?:\/\//.test(eh) ? eh
                      : location.origin + (eh.startsWith('/') ? eh : '/'+eh);
        continue;
      }

      // Clica na aba principal e captura URL resultante
      var urlBefore = location.href;
      eye.click();
      for (var k = 0; k < 30; k++) {
        await wait(200);
        if (/\/arp\/\d+\/show/i.test(location.href) && location.href !== urlBefore) break;
      }
      if (/\/arp\/\d+\/show/i.test(location.href)) {
        ata.detailUrl = location.href;
        history.back();
        // Aguarda lista restaurar
        for (var wb = 0; wb < 20; wb++) {
          await wait(250);
          if (!/\/show/i.test(location.href)) break;
        }
        // Re-expande se Angular resetou o paginador
        try {
          var cnt = (document.body.textContent||'').match(/\d{4,5}\/\d{4}/g);
          if (!cnt || cnt.length < 30) { await tryExpandAll(); await wait(3000); }
        } catch(e) {}
      }
    }

    var found = toProcess.filter(function(a){ return a.detailUrl; }).length;
    log('✓ '+found+'/'+toProcess.length+' URLs prontas.', '#4ade80');
  }

  // ── loop principal com URLs diretas (sem paginação na worker tab) ──────────
  async function processWithDirectUrls(toProcess) {
    var synced = 0;
    for (var i = 0; i < toProcess.length && !_stopped; i++) {
      var ata = toProcess[i];
      log('▶ '+ata.numero_ata+' ('+(i+1)+'/'+toProcess.length+')');
      prog(i, toProcess.length, ata.numero_ata);

      var itens = ata.detailUrl
        ? await scrapeViaWorkerTab(ata)   // Strategy A: URL direta
        : await _scrapeViaList(ata);      // fallback (25 ATAs — pode falhar)

      if (itens.length) {
        try {
          if (_sheetsUrl) {
            await sheetsPost('itens', itens);
          } else {
            await sPost('itens_ata_gap_mn', itens, true);
          }
          setLast('✅ '+itens.length+' itens → '+ata.numero_ata, '#4ade80');
          synced++;
        } catch(e) { log('❌ '+e.message, '#f87171'); }
      } else {
        setLast('⚠ Sem itens: '+ata.numero_ata, '#94a3b8');
      }
      prog(i+1, toProcess.length, ata.numero_ata);
    }
    log('🎉 Concluído! '+synced+'/'+toProcess.length+' ATAs com itens.', '#4ade80');
    try { if (_workerWin && !_workerWin.closed) _workerWin.close(); } catch(e) {}
    return synced;
  }

  // ── coleta ATAs de TODAS as páginas da aba principal ─────────────────────────
  // Tenta expand-all primeiro; se o paginador permanecer ativo, itera por todas as páginas.
  // Ao final navega de volta para pg.1 e tenta expand-all novamente (necessário para gatherDetailUrls).
  async function collectAllATAsMainTab() {
    log('Carregando ATAs (expand + paginação)…');
    await tryExpandAll();
    await wait(2000);

    var allMap = {};
    function addFromPage() {
      var items = extractRows();
      var added = 0;
      items.forEach(function(a) {
        if (!allMap[a.numero_ata]) { allMap[a.numero_ata] = a; added++; }
      });
      return { total: items.length, added: added };
    }

    var r0 = addFromPage();
    log('Pg.1: '+r0.total+' na página · '+Object.keys(allMap).length+' acumuladas', '#475569');

    for (var pg = 2; pg <= 200; pg++) {
      var nextBtn = document.querySelector('button[aria-label*="Próxima" i]')
                 || document.querySelector('button[aria-label*="Next" i]')
                 || document.querySelector('.mat-paginator-navigation-next')
                 || document.querySelector('.mat-mdc-paginator-navigation-next');
      if (!nextBtn || nextBtn.disabled || nextBtn.hasAttribute('disabled')) break;

      nextBtn.click();
      await wait(2500);

      var rN = addFromPage();
      log('Pg.'+pg+': '+rN.total+' na página · '+rN.added+' novas · '+Object.keys(allMap).length+' total', '#475569');
      if (rN.added === 0 && rN.total > 0) break; // proteção contra loop sem progresso
    }

    // Volta para pg.1 e tenta expand-all novamente (gatherDetailUrls precisa das linhas visíveis)
    try {
      var firstBtn = document.querySelector('.mat-paginator-navigation-first')
                  || document.querySelector('.mat-mdc-paginator-navigation-first')
                  || document.querySelector('button[aria-label*="Primeira" i]')
                  || document.querySelector('button[aria-label*="First" i]');
      if (firstBtn && !firstBtn.disabled && !firstBtn.hasAttribute('disabled')) {
        firstBtn.click();
        await wait(2000);
      }
      await tryExpandAll();
      await wait(3000);
    } catch(e) {}

    var all = Object.values(allMap);
    log(all.length+' ATA(s) encontradas no total.', '#4ade80');
    return all;
  }

  // ── modo LISTA ─────────────────────────────────────────────────────────────
  async function runList() {
    if (!_workerWin) {
      log('❌ Worker tab não abriu. Autorize popups e recarregue o bookmarklet.', '#f87171');
      return;
    }
    log('Aguardando worker tab carregar…');
    await wait(3000); // dá tempo da worker tab inicializar o Angular

    var pageItems = await collectAllATAsMainTab();
    if (!pageItems.length) { log('⚠ Nenhuma linha reconhecida.', '#fbbf24'); return; }

    var toProcess;

    if (_sheetsUrl) {
      // Modo Planilha: envia metadados de TODAS as ATAs e processa todas
      log('Modo Planilha — enviando metadados de '+pageItems.length+' ATAs…', '#38bdf8');
      var atasMeta = pageItems.map(function(a){
        return {
          numero_ata:      a.numero_ata,
          situacao:        a.situacao,
          tipo_uasg:       a.tipo_uasg,
          vigencia_inicial: a.vigencia_inicial,
          vigencia_final:  a.vigencia_final,
        };
      });
      try { await sheetsPostBatch('atas', atasMeta); log('✅ Metadados enviados!', '#4ade80'); }
      catch(e) { log('❌ '+e.message, '#f87171'); }
      toProcess = pageItems;
    } else {
      // Modo Supabase: verifica existentes e processa apenas novas/sem itens
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
        // Strip detailUrl — campo interno, não existe na tabela Supabase
        var atasToInsert = newAtas.map(function(a){
          return {
            numero_ata:       a.numero_ata,
            situacao:         a.situacao,
            tipo_uasg:        a.tipo_uasg,
            vigencia_inicial: a.vigencia_inicial,
            vigencia_final:   a.vigencia_final,
          };
        });
        await sPostBatch('atas_gap_mn', atasToInsert, true);
        log('✅ Dados salvos!', '#4ade80');
      }
      toProcess = newAtas.concat(semItens);
    }
    if (!toProcess.length) {
      log('✅ Tudo sincronizado!', '#4ade80');
      try { if (_workerWin && !_workerWin.closed) _workerWin.close(); } catch(e) {}
      return;
    }

    // Coleta URL direta de cada ATA pela aba principal (não depende do worker tab)
    await gatherDetailUrls(toProcess);
    var withUrl = toProcess.filter(function(a){ return a.detailUrl; }).length;
    log('Capturando '+toProcess.length+' ATA(s) ('+withUrl+' URL direta)…', '#38bdf8');
    var synced = await processWithDirectUrls(toProcess);
    // Feed omitido: bookmarklet usa chave anon sem permissão de escrita no feed_items.
  }

  // ── dispatch ───────────────────────────────────────────────────────────────
  (async function() {
    try {
      await wait(300);
      var cfg = await showConfigPanel();
      if (cfg.mode === 'sheets') {
        _sheetsUrl = cfg.url;
        // Atualiza título do overlay
        var titleEl = ov.querySelector('[style*="38bdf8"]');
        if (titleEl) titleEl.textContent = '⟳ Sync ATAs — Minha Planilha';
      }
      await runList();
    } catch(e) {
      log('❌ '+(e&&e.message?e.message:String(e)), '#f87171');
      console.error('[ARP-BOT]', e);
    }
  })();
})();
