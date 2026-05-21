(function () {
  'use strict';
  console.log('[CNET Bot] v2026-05-21c — detailUrl+retry fix');
  var UASG = '120630';
  var LSKEY = 'cnet_bot_cfg';

  function loadCfg() {
    try {
      var bot = JSON.parse(localStorage.getItem(LSKEY) || '{}');
      var dash = JSON.parse(localStorage.getItem('cnetdb_bot') || '{}');
      return { uasg: bot.uasg || dash.uasg || '', scriptUrl: bot.scriptUrl || dash.scriptUrl || '', anos: bot.anos || '' };
    } catch(e) { return {}; }
  }
  function saveCfg(c) { try { localStorage.setItem(LSKEY, JSON.stringify(c)); } catch(e) {} }

  // ── Overlay (sem innerHTML para evitar problemas de escaping) ──────────────
  var OV = null;
  function getOV() {
    if (!OV || !document.body.contains(OV)) {
      OV = document.createElement('div');
      OV.id = '__cbot__';
      OV.style.cssText = [
        'position:fixed', 'bottom:16px', 'right:16px', 'width:310px',
        'max-height:360px', 'display:flex', 'flex-direction:column',
        'background:#0f172a', 'color:#e2e8f0',
        'border:1px solid #334155', 'border-radius:12px',
        'font:13px/1.5 system-ui,sans-serif',
        'z-index:2147483647', 'box-shadow:0 8px 32px rgba(0,0,0,.7)'
      ].join(';');

      var hd = document.createElement('div');
      hd.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-bottom:1px solid #1e293b;flex-shrink:0';

      var ttl = document.createElement('span');
      ttl.style.cssText = 'font-weight:600;color:#60a5fa;font-size:14px;display:flex;align-items:center;gap:10px';
      ttl.innerHTML = 'CNET Bot <span id="__ctimer__" style="font-size:12px;font-weight:400;color:#94a3b8;font-variant-numeric:tabular-nums"></span>';

      var hdBtns = document.createElement('div');
      hdBtns.style.cssText = 'display:flex;gap:6px;align-items:center';

      var pauseBtn = document.createElement('button');
      pauseBtn.id = '__cpause__';
      pauseBtn.style.cssText = 'background:#1e40af;border:none;color:#fff;cursor:pointer;font-size:11px;padding:3px 8px;border-radius:6px;font-weight:600';
      pauseBtn.textContent = '⏸ Pausar';
      pauseBtn.onclick = function () {
        window.__cnet_paused__ = !window.__cnet_paused__;
        pauseBtn.textContent = window.__cnet_paused__ ? '▶ Retomar' : '⏸ Pausar';
        pauseBtn.style.background = window.__cnet_paused__ ? '#166534' : '#1e40af';
      };

      var btn = document.createElement('button');
      btn.style.cssText = 'background:none;border:none;color:#64748b;cursor:pointer;font-size:22px;line-height:1;padding:0';
      btn.textContent = 'x';
      btn.onclick = function () { OV.remove(); OV = null; };

      hdBtns.appendChild(pauseBtn);
      hdBtns.appendChild(btn);
      hd.appendChild(ttl);
      hd.appendChild(hdBtns);

      var logDiv = document.createElement('div');
      logDiv.id = '__cl';
      logDiv.style.cssText = 'overflow-y:auto;padding:6px 10px;flex:1;min-height:0';

      OV.appendChild(hd);
      OV.appendChild(logDiv);
      document.body.appendChild(OV);
    }
    return OV;
  }

  // Cronômetro de execução
  var _timerStart = 0, _timerInterval = null;
  function startTimer() {
    _timerStart = Date.now();
    _timerInterval = setInterval(function(){
      var el = document.getElementById('__ctimer__');
      if (!el) return;
      var s = Math.floor((Date.now() - _timerStart) / 1000);
      var mm = Math.floor(s / 60), ss = s % 60;
      el.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
    }, 1000);
  }
  function stopTimer() {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
  }

  // Expande overlay para full-screen (esconde ComprasNet durante execução)
  var _ovFullscreen = false;
  function expandOV(totalItems) {
    var ov = getOV();
    _ovFullscreen = true;
    ov.style.cssText = [
      'position:fixed','inset:0','width:100%','height:100%',
      'max-height:100%','display:flex','flex-direction:column',
      'background:rgba(15,23,42,.96)','color:#e2e8f0',
      'border:none','border-radius:0',
      'font:13px/1.5 system-ui,sans-serif',
      'z-index:2147483647','box-shadow:none','overflow:hidden'
    ].join(';');
    // Barra de progresso
    var pg = ov.querySelector('#__cpg__');
    if (!pg) {
      pg = document.createElement('div');
      pg.id = '__cpg__';
      pg.style.cssText = 'padding:8px 16px;flex-shrink:0;border-bottom:1px solid #1e293b';
      pg.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:4px">'
        + '<span id="__cpg_lbl__" style="font-size:12px;color:#94a3b8">Iniciando…</span>'
        + '<span id="__cpg_pct__" style="font-size:12px;color:#60a5fa;font-weight:600">0%</span>'
        + '</div>'
        + '<div style="background:#1e293b;border-radius:4px;height:6px;overflow:hidden">'
        + '<div id="__cpg_bar__" style="background:linear-gradient(90deg,#3b82f6,#2dd4bf);height:100%;width:0%;transition:width .3s"></div>'
        + '</div>'
        + '<div id="__cpg_sub__" style="font-size:10px;color:#475569;margin-top:3px"></div>';
      ov.insertBefore(pg, ov.querySelector('#__cl'));
    }
    pg.style.display = 'block';
    if (totalItems) ov.querySelector('#__cpg_sub__').textContent = '0 / ' + totalItems + ' itens';
  }
  function collapseOV() {
    var ov = getOV();
    _ovFullscreen = false;
    ov.style.cssText = [
      'position:fixed','bottom:16px','right:16px','width:310px',
      'max-height:360px','display:flex','flex-direction:column',
      'background:#0f172a','color:#e2e8f0',
      'border:1px solid #334155','border-radius:12px',
      'font:13px/1.5 system-ui,sans-serif',
      'z-index:2147483647','box-shadow:0 8px 32px rgba(0,0,0,.7)'
    ].join(';');
    var pg = ov.querySelector('#__cpg__');
    if (pg) pg.style.display = 'none';
  }
  function setProgress(current, total, label, status) {
    var ov = document.getElementById('__cbot__');
    if (!ov) return;
    var lbl = ov.querySelector('#__cpg_lbl__');
    var pct = ov.querySelector('#__cpg_pct__');
    var bar = ov.querySelector('#__cpg_bar__');
    var sub = ov.querySelector('#__cpg_sub__');
    if (!lbl) return;
    var pctVal = total > 0 ? Math.round(current / total * 100) : 0;
    lbl.textContent = (label || '').slice(0, 80);
    lbl.style.color = status === 'ok' ? '#4ade80' : status === 'warn' ? '#fbbf24' : '#94a3b8';
    pct.textContent = pctVal + '%';
    bar.style.width = pctVal + '%';
    sub.textContent = current + ' / ' + total + ' itens' + (status === 'ok' ? ' ✓' : '');
  }

  function log(msg, t) {
    var ov = getOV();
    var el = ov.querySelector('#__cl');
    var r = document.createElement('div');
    var c = t === 'ok' ? '#4ade80' : t === 'err' ? '#f87171' : t === 'warn' ? '#fbbf24' : '#94a3b8';
    r.style.cssText = 'padding:2px 0;border-bottom:1px solid #1e293b;word-break:break-word;color:' + c;
    r.textContent = msg;
    el.appendChild(r);
    el.scrollTop = el.scrollHeight;
    console.log('[CNET]', msg);
  }

  // ── Lê texto da página excluindo overlay ──────────────────────────────────
  function appTxt() {
    var ov = document.getElementById('__cbot__');
    if (!ov) return document.body.innerText || '';
    var txt = document.body.innerText || '';
    var ovt = ov.innerText || '';
    return ovt ? txt.split(ovt).join('') : txt;
  }

  // ── TreeWalker que pula nós do overlay ────────────────────────────────────
  function makeWalker(root) {
    var ov = document.getElementById('__cbot__');
    return document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_TEXT,
      { acceptNode: function (n) { return (ov && ov.contains(n)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } }
    );
  }

  // ── Utilidades ────────────────────────────────────────────────────────────
  function parse(s) {
    s = s.trim().replace(/\D/g, '');
    if (s.length < 5) return null;
    var ano = parseInt(s.slice(-4), 10);
    var num = s.slice(0, -4).padStart(5, '0'); // sempre 5 dígitos
    return (num && !isNaN(ano)) ? { num: num, ano: ano } : null;
  }
  // Converte "1-19" ou "1,5,12" ou "2-5,8" num Set de inteiros; null se vazio
  function parseNumFilter(str) {
    if (!str || !str.trim()) return null;
    var s = new Set();
    str.split(/[,;\s]+/).forEach(function(p) {
      p = p.trim();
      var r = p.match(/^(\d+)\s*-\s*(\d+)$/);
      if (r) { for (var i = +r[1]; i <= +r[2]; i++) s.add(i); }
      else if (/^\d+$/.test(p)) s.add(+p);
    });
    return s.size ? s : null;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Aguarda o texto da página parar de mudar por `stabMs` ms (DOM estabilizado)
  // Evita ler conteúdo stale do Angular durante transições de rota
  async function waitDOMStable(stabMs, maxMs) {
    stabMs = stabMs || 600; maxMs = maxMs || 12000;
    var prev = appTxt();
    var stableUntil = Date.now() + stabMs;
    var deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      await wait(200);
      var cur = appTxt();
      if (cur !== prev) { prev = cur; stableUntil = Date.now() + stabMs; }
      else if (Date.now() >= stableUntil) return; // estável por stabMs ms
    }
  }

  function poll(fn, ms, to) {
    ms = ms || 400; to = to || 28000;
    // Aba escondida: Chrome throttle timers (400ms → 1000ms mínimo) — dobra timeout para compensar
    if (document.hidden) to = to * 2.5;
    return new Promise(function (res, rej) {
      var t0 = Date.now();
      var id = setInterval(function () {
        var r = fn();
        if (r) { clearInterval(id); res(r); }
        else if (Date.now() - t0 > to) { clearInterval(id); rej(new Error('timeout')); }
      }, ms);
    });
  }

  // ── Progresso na aba e notificação ao terminar ────────────────────────────
  var _origTitle = document.title;
  function setTabProgress(msg) {
    document.title = msg ? '⚙ ' + msg + ' — CNET Bot' : _origTitle;
  }
  function notifyDone(msg) {
    setTabProgress('');
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification('CNET Bot — Concluído', { body: msg, silent: false });
    }
  }
  function pedirPermissaoNotif() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
  function ri(el, v) {
    var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(el, v);
    // InputEvent é necessário no Firefox para Angular detectar a mudança
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: 'insertText' }));
    } catch(e) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  var SHEET_HEADERS = [
    'Processo','Ano','UASG','Grupo','Item','Nome Item',
    'CNPJ','Razão Social','UF','Status','ME/EPP',
    'Valor Ofertado','Valor Negociado','Situação Item',
    'Qtde Solicitada','Descrição Item',
    'Critério Julgamento','Sit. Processo','Valor Estimado'
  ];

  // app-dirad: cnet_propostas (CAE e demais UASGs)
  var SUPA_URL = 'https://uhkkparwcayrbvvbjple.supabase.co';
  var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoa2twYXJ3Y2F5cmJ2dmJqcGxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3ODk1MTIsImV4cCI6MjA3MjM2NTUxMn0.AQC2SdFMbas3MhmW7jRBXrFLkiMreQpUI14eCUVELP8';
  // gapmn-app: cnet_propostas_gapmn (UASG 120630)
  var SUPA_URL_GAPMN = 'https://fychrtyyqbzlfbzbvzqp.supabase.co';
  var SUPA_KEY_GAPMN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';

  function toNum(v) {
    if (v === '' || v == null) return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    var str = String(v).replace(/R\$|\s/g, '').trim();
    if (str.includes(',')) { str = str.replace(/\./g, '').replace(',', '.'); }
    var n = parseFloat(str);
    return isNaN(n) ? null : n;
  }

  // Roteia para a tabela correta conforme UASG configurada no bot
  function supaTable(uasg) {
    return String(uasg || '').trim() === '120630' ? 'cnet_propostas_gapmn' : 'cnet_propostas';
  }

  async function postToSupabase(aba, rows, uasg) {
    if (!rows.length) return true;
    var table = supaTable(uasg);
    var isGapmn = (table === 'cnet_propostas_gapmn');
    var url  = isGapmn ? SUPA_URL_GAPMN : SUPA_URL;
    var key  = isGapmn ? SUPA_KEY_GAPMN : SUPA_KEY;
    try {
      // cnet_propostas_gapmn não tem coluna "aba" — apaga por processo
      if (isGapmn) {
        var procs = [];
        rows.forEach(function(r){ if (r[0] && procs.indexOf(r[0]) < 0) procs.push(r[0]); });
        for (var pi = 0; pi < procs.length; pi++) {
          var dr = await fetch(url + '/rest/v1/' + table + '?processo=eq.' + encodeURIComponent(procs[pi]), {
            method: 'DELETE',
            headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
          });
          if (!dr.ok && dr.status !== 404) log('Supa DEL ' + dr.status + ': ' + (await dr.text()).slice(0,80), 'err');
        }
      } else {
        var delResp = await fetch(url + '/rest/v1/' + table + '?aba=eq.' + encodeURIComponent(aba), {
          method: 'DELETE',
          headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
        });
        if (!delResp.ok && delResp.status !== 404) {
          var delErr = await delResp.text();
          log('Supa DELETE ' + delResp.status + ': ' + delErr.slice(0,120), 'err');
        }
      }

      // Mapeia array posicional → objeto com nomes das colunas
      var body = rows.map(function(r) {
        if (isGapmn) {
          // cnet_propostas_gapmn: sem "aba", valores de moeda como texto
          return {
            processo: r[0]||null, ano: r[1]||null, uasg: r[2]||null,
            grupo: String(r[3]||''), item: String(r[4]||''), nome_item: r[5]||null,
            cnpj: r[6]||null, razao_social: r[7]||null, uf: r[8]||null,
            status: r[9]||null, me_epp: r[10]||null,
            valor_ofertado: r[11]!=null ? String(r[11]) : null,
            valor_negociado: r[12]!=null ? String(r[12]) : null,
            situacao_item: r[13]||null, qtde_solicitada: r[14]||null,
            descricao_item: r[15]||null, criterio_julgamento: r[16]||null,
            sit_processo: r[17]||null,
            valor_estimado: r[18]!=null ? String(r[18]) : null
          };
        }
        return {
          aba: aba,
          processo: r[0]  || null, ano:      r[1]  || null, uasg:  r[2]  || null,
          grupo:    String(r[3]||''), item: String(r[4]||''), nome_item: r[5]||null,
          cnpj:     r[6]  || null, razao_social: r[7]||null, uf:    r[8]  || null,
          status:   r[9]  || null, me_epp:  r[10] || null,
          valor_ofertado:  toNum(r[11]), valor_negociado: toNum(r[12]),
          situacao_item:   r[13] || null, qtde_solicitada: r[14]||null,
          descricao_item:  r[15] || null, criterio_julgamento: r[16]||null,
          sit_processo:    r[17] || null, valor_estimado: toNum(r[18])
        };
      });

      var resp = await fetch(url + '/rest/v1/' + table, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key,
          'Authorization': 'Bearer ' + key,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        var errText = await resp.text();
        log('Supa INSERT ' + resp.status + ': ' + errText.slice(0,200), 'err');
        return false;
      }
      log('Tabela: ' + table, 'ok');
      return true;
    } catch(e) { log('ERRO Supabase: ' + e.message, 'err'); return false; }
  }

  async function postToSheets(scriptUrl, aba, rows) {
    if (!rows.length) return true;
    try {
      // no-cors: evita preflight CORS; resposta é opaca mas request chega
      await fetch(scriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({ aba: aba, headers: SHEET_HEADERS, rows: rows, clear: true })
      });
      return true; // opaque response — assume ok
    } catch(e) { log('ERRO Sheets: ' + e.message, 'err'); return false; }
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function visInputs() {
    return [...document.querySelectorAll('input[type=text],input:not([type])')].filter(function (i) {
      return i.offsetWidth > 0 && i.offsetHeight > 0 && !i.disabled && !i.readOnly;
    });
  }
  function findAttr(root, frag) {
    var attrs = ['aria-label', 'mattooltip', 'ng-reflect-message', 'title'];
    for (var a of attrs) {
      var el = (root || document).querySelector('[' + a + '*="' + frag + '"]');
      if (el) return el;
    }
    var btns = [...(root || document).querySelectorAll('button,a,[role=button]')];
    for (var b of btns) {
      if (new RegExp(frag, 'i').test([...b.attributes].map(function (a) { return a.value; }).join(' '))) return b;
    }
    return null;
  }
  function findAllAttr(root, frag) {
    var re = new RegExp(frag, 'i');
    return [...(root || document).querySelectorAll('button,a,[role=button]')].filter(function (b) {
      return b.offsetWidth > 0 && re.test([...b.attributes].map(function (a) { return a.value; }).join(' '));
    });
  }
  function findAcompBtn(num, ano, modalidade) {
    var pat = num + '/' + ano;
    // Coleta todos os cards de resultado que contêm num/ano
    var candidates = [];
    var walker = makeWalker(); var node;
    var seen = new Set();
    while ((node = walker.nextNode())) {
      if ((node.textContent || '').includes(pat)) {
        var p = node.parentElement;
        for (var i = 0; i < 12; i++) {
          if (!p) break;
          var b2 = findAttr(p, 'companhar');
          if (b2 && !seen.has(b2)) { seen.add(b2); candidates.push({ btn: b2, card: p }); }
          p = p.parentElement;
        }
      }
    }
    if (!candidates.length) {
      // fallback simples: primeiro botão "Acompanhar" na página
      var b = findAttr(document, 'companhar');
      return b || null;
    }
    if (candidates.length === 1 || !modalidade) return candidates[0].btn;
    // Filtra pelo texto da modalidade (ex: "Pregão Eletrônico", "Dispensa")
    var modLower = modalidade.toLowerCase();
    var match = candidates.find(function(c) {
      return (c.card.innerText || '').toLowerCase().includes(modLower);
    });
    return (match || candidates[0]).btn;
  }
  function findGrupos() {
    var res = []; var seen = new Set();
    var walker = makeWalker(); var node;
    while ((node = walker.nextNode())) {
      var t = (node.textContent || '').trim().toUpperCase();
      var m = t.match(/^(?:GRUPO|LOTE)\s+(\d+)$/)
            || t.match(/^(?:GRUPO|LOTE)\s+(\d+)\s*[-–|]/)
            || t.match(/^(?:GRUPO|LOTE)\s+(\d+)\s/);
      if (m) {
        var n = parseInt(m[1]);
        if (!seen.has(n)) { seen.add(n); res.push({ num: n, el: node.parentElement }); }
      }
    }
    if (!res.length) {
      // fallback: procura em elementos com role=tab, mat-tab, h3/h4 contendo "Grupo" ou "Lote"
      var els = [...document.querySelectorAll('[role=tab],mat-tab-label,h3,h4,mat-expansion-panel-header,.grupo,.lote')];
      for (var el of els) {
        var t2 = (el.textContent || '').trim().toUpperCase();
        var m2 = t2.match(/(?:GRUPO|LOTE)\s+(\d+)/);
        if (m2) {
          var n2 = parseInt(m2[1]);
          if (!seen.has(n2)) { seen.add(n2); res.push({ num: n2, el: el }); }
        }
      }
    }
    if (!res.length) {
      console.log('[CNET grupos] page text sample:', appTxt().slice(0, 800));
      log('DEBUG pg: ' + appTxt().replace(/\s+/g, ' ').slice(0, 300), 'warn');
    }
    return res;
  }
  function readGrupoInfo(el) {
    var total_itens = null, situacao = null;
    // Matches any line that starts with a known ComprasNet group situation keyword
    var SIT_PAT = /^(Homologad[ao]|Desert[ao]|Cancelad[ao]|Julgad[ao]\s+e\s+habilit|Julgad[ao]|Fracassad[ao]|Aguardando\s+\w|Em\s+andamento|Encerrad[ao]|Suspen[sa][ao]|Anulad[ao]|Revogar|Revogad[ao])/i;
    var p = el;
    for (var i = 0; i < 12; i++) {
      if (!p) break;
      var txt = p.textContent || '';
      if (!total_itens) { var it = txt.match(/(\d+)\s*iten?s?/i); if (it) total_itens = parseInt(it[1]); }
      if (!situacao) {
        var lines = txt.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
        for (var li = 0; li < lines.length; li++) {
          if (SIT_PAT.test(lines[li]) && lines[li].length < 60) { situacao = lines[li]; break; }
        }
      }
      if (total_itens && situacao) break;
      p = p.parentElement;
    }
    return { total_itens: total_itens, situacao: situacao };
  }

  function readProcessInfo() {
    var txt = appTxt();
    var mc = txt.match(/Menor\s+Pre[çc]o(?:\s*\/\s*Maior\s+Desconto)?|Maior\s+Desconto|Maior\s+Lance|Melhor\s+T[eé]cnica\s+e\s+Pre[çc]o/i);
    var criterio = mc ? mc[0].replace(/\s+/g, ' ').trim() : '';
    var ms = txt.match(/Contrata[çc][ãa]o\s+na\s+etapa\s+de\s+[^.\n?]{5,80}|COMPRA\s+ENCERRADA|EM\s+ANDAMENTO|SUSPEN[SA]A|CANCELAD[AO]|HOMOLOGAD[AO]|Encerrad[ao]\s+[^.\n]{3,60}|Aguardando\s+[^.\n]{3,60}/i);
    var sitProcesso = ms ? ms[0].replace(/\s+/g, ' ').trim() : '';
    console.log('[CNET procInfo]', { criterio: criterio, sitProcesso: sitProcesso });
    return { criterio: criterio, sitProcesso: sitProcesso };
  }


  // ── Propostas ─────────────────────────────────────────────────────────────
  function parseBRL(s) { return parseFloat(s.replace(/\./g, '').replace(',', '.')); }

  // Isola o card de cada fornecedor: sobe até achar nó que contenha outro CNPJ
  function cardBoundary(startEl, allCnpjs, thisCnpj) {
    var prev = startEl;
    var el = startEl.parentElement;
    while (el && el !== document.body) {
      var txt = el.textContent || '';
      if (allCnpjs.some(function (c) { return c !== thisCnpj && txt.includes(c); })) return prev;
      var tag = el.tagName.toLowerCase();
      if (/^(mat-card|li|article|tr)$/.test(tag)) return el;
      prev = el;
      el = el.parentElement;
    }
    return prev; // único CNPJ na página — usa maior container disponível (cnpjIdx windowing isola os dados)
  }

  function readPropostas() {
    var res = []; var seen = new Set();
    var cnpjRe = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|ESTRANG\d{5,}/g;
    var allCnpjs = [...new Set((appTxt()).match(cnpjRe) || [])];
    var STATUS_RE = /^(Adjudicad[ao]|Desclassificad[ao]|Vencedor[a]?|Coberto[a]?|Aceita(?:\s+e\s+habilitada)?|Inabilitad[ao]|Recusad[ao]|Em\s+an[aá]lise|Habilitad[ao]|Suspens[ao])$/i;
    var UF_RE = /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/;

    for (var cnpj of allCnpjs) {
      if (seen.has(cnpj)) continue; seen.add(cnpj);
      var walker = makeWalker(); var node;
      while ((node = walker.nextNode())) {
        if (!(node.textContent || '').includes(cnpj)) continue;

        var card = cardBoundary(node.parentElement, allCnpjs, cnpj);

        // innerText preserva quebras de linha entre elementos — essencial para
        // separar "Adjudicada" de "Desclassificada" em cards distintos
        var fullText = card.innerText || card.textContent || '';
        var lines = fullText.split(/\n+/).map(function(s){ return s.trim(); }).filter(Boolean);

        // Ancora a busca no índice da linha que contém o CNPJ deste card
        var cnpjIdx = 0;
        for (var li = 0; li < lines.length; li++) {
          if (lines[li].includes(cnpj)) { cnpjIdx = li; break; }
        }
        var wStart = cnpjIdx;
        var wEnd   = Math.min(lines.length, cnpjIdx + 15);
        var local  = lines.slice(wStart, wEnd);

        // Status: primeira linha que é EXATAMENTE uma palavra de status
        var status = '';
        for (var ln of local) { if (STATUS_RE.test(ln)) { status = ln; break; } }

        // UF: linha que é exatamente o código de estado
        var uf = null;
        for (var ln of local) { if (UF_RE.test(ln)) { uf = ln; break; } }

        // Razão social: primeira linha com texto de empresa
        var razao = '';
        for (var ln of local) {
          if (ln.includes(cnpj)) continue;
          if (STATUS_RE.test(ln) || UF_RE.test(ln)) continue;
          if (/^(Valor|R\$|ME\/|Equid|Progra|Histor|Clique|Os detalhes)/i.test(ln)) continue;
          if (/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(ln)) continue;
          if (ln.length >= 5 && ln.length <= 100 && /[A-Za-z]{3}/.test(ln)) { razao = ln; break; }
        }

        // Valores monetários — ancora na janela a partir do CNPJ para não capturar
        // "Valor estimado" do cabeçalho do item que aparece acima das propostas
        var localText = local.join('\n');
        var vals = [...localText.matchAll(/R\$\s*([\d.]+,\d+)/g)]
          .map(function(m){ return parseBRL(m[1]); }).filter(function(v){ return v > 0; });
        var semNeg = /Valor negociado[^R\n]{0,15}[-–]/.test(localText);
        var meEpp  = /ME\/EPP|MEI|Microempresa|Pequeno Porte/i.test(fullText);

        res.push({
          cnpj: cnpj, razao_social: razao.slice(0, 100), uf: uf,
          status: status, me_epp: meEpp,
          valor_ofertado: vals[0] || null,
          valor_negociado: semNeg ? null : (vals[1] || null)
        });
        break;
      }
    }
    return res;
  }

  // Botão de próxima página (paginação Angular Material e texto ">" )
  function getNextPageBtn() {
    return [...document.querySelectorAll('button,a,[role=button]')].find(function(b) {
      if (!b.offsetWidth || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      var arLbl = (b.getAttribute('aria-label') || b.getAttribute('mattooltip') || '').toLowerCase();
      if (/próxima|next.*page|navegar.*próx|siguiente/i.test(arLbl)) return true;
      var ic = b.querySelector('mat-icon,.material-icons');
      if (ic && /navigate_next|chevron_right/i.test((ic.textContent || '').trim())) return true;
      var txt = (b.innerText || b.textContent || '').trim();
      return txt === '>' || txt === '›';
    });
  }

  // Salta direto para a página N do paginador: Angular component → página visível → último+voltar → sequencial
  async function goToPageDirect(targetPage) {
    if (targetPage <= 1) return;

    // Método 1: Angular __ngContext__ — acessa componente MatPaginator diretamente
    var pEls = [...document.querySelectorAll('mat-paginator,[class*=paginator]')].filter(function(el) { return el.offsetWidth; });
    for (var pEl of pEls) {
      var ctx = pEl.__ngContext__;
      if (!ctx || !Array.isArray(ctx)) continue;
      for (var i = 0; i < Math.min(ctx.length, 40); i++) {
        var c = ctx[i];
        if (c && typeof c === 'object' && typeof c.pageIndex === 'number' && typeof c.pageSize === 'number') {
          var prevIdx = c.pageIndex;
          c.pageIndex = targetPage - 1;
          try {
            if (c.page && c.page.next) {
              c.page.next({ pageIndex: targetPage - 1, pageSize: c.pageSize, length: c.length || 0, previousPageIndex: prevIdx });
              await wait(350);
              try { await poll(function(){ return getItemDetBtns().length > 0; }, 100, 3000); } catch(e2) {}
              if (getItemDetBtns().length > 0) return;
            }
            if (c._emitPageEvent) {
              c._emitPageEvent(prevIdx);
              await wait(350);
              try { await poll(function(){ return getItemDetBtns().length > 0; }, 100, 3000); } catch(e2) {}
              if (getItemDetBtns().length > 0) return;
            }
          } catch(e) {}
          break;
        }
      }
    }

    // Método 2: botão de número de página visível — clica direto
    function findPageBtn(pg) {
      return [...document.querySelectorAll('button,a,[role=button]')].find(function(b) {
        return b.offsetWidth && !b.disabled && b.getAttribute('aria-disabled') !== 'true'
          && b.textContent.trim() === String(pg);
      });
    }
    var directBtn = findPageBtn(targetPage);
    if (directBtn) {
      directBtn.click();
      await wait(350);
      try { await poll(function(){ return getItemDetBtns().length > 0; }, 100, 3000); } catch(e) {}
      return;
    }

    // Método 3: pula para última página → a partir daí targetPage fica visível, clica
    var lastBtn = [...document.querySelectorAll('button')].find(function(b) {
      if (!b.offsetWidth || b.disabled) return false;
      var ic = b.querySelector('mat-icon,.material-icons');
      if (ic && /last_page|skip_next/i.test((ic.textContent || '').trim())) return true;
      var lbl = (b.getAttribute('aria-label') || b.getAttribute('mattooltip') || '').toLowerCase();
      return /última.*p[áa]gina|last.*page/i.test(lbl);
    });
    if (lastBtn) {
      lastBtn.click();
      await wait(350);
      try { await poll(function(){ return getItemDetBtns().length > 0; }, 100, 3000); } catch(e) {}
      // Tenta clicar targetPage a partir da última página (deve estar visível como N-1)
      directBtn = findPageBtn(targetPage);
      if (directBtn) {
        directBtn.click();
        await wait(350);
        try { await poll(function(){ return getItemDetBtns().length > 0; }, 100, 3000); } catch(e) {}
        return;
      }
      // Navega para trás até targetPage ficar visível
      for (var bk = 0; bk < 8; bk++) {
        var prevBtn = [...document.querySelectorAll('button')].find(function(b) {
          if (!b.offsetWidth || b.disabled) return false;
          var ic = b.querySelector('mat-icon,.material-icons');
          if (ic && /navigate_before|chevron_left/i.test((ic.textContent || '').trim())) return true;
          var t = b.textContent.trim();
          return t === '<' || t === '‹';
        });
        if (!prevBtn) break;
        prevBtn.click();
        await wait(200);
        try { await poll(function(){ return getItemDetBtns().length > 0; }, 100, 2000); } catch(e) {}
        directBtn = findPageBtn(targetPage);
        if (directBtn) {
          directBtn.click();
          await wait(350);
          try { await poll(function(){ return getItemDetBtns().length > 0; }, 100, 3000); } catch(e) {}
          return;
        }
      }
    }

    // Método 4: cliques sequenciais (fallback — lento)
    log('↩ Restaurando pág. ' + targetPage + ' (sequencial)...', 'warn');
    for (var p = 1; p < targetPage; p++) {
      var nxt = getNextPageBtn();
      if (!nxt) break;
      nxt.click();
      await wait(200);
      try { await poll(function(){ return getItemDetBtns().length > 0; }, 100, 2000); } catch(e) {}
    }
  }

  // Retorna todos os botões "Mostrar detalhes do item" visíveis na página (um por item, incl. desertos)
  function getItemDetBtns() {
    var ov = document.getElementById('__cbot__');
    return [...document.querySelectorAll('button,[role=button]')].filter(function(b) {
      // Firefox pode reportar offsetWidth=0 para botões visíveis; usa offsetHeight como fallback
      if (!(b.offsetWidth || b.offsetHeight) || (ov && ov.contains(b))) return false;
      var av = [...b.attributes].map(function(a) { return a.value; }).join(' ');
      if (/etalhes/i.test(av)) return true;
      var ic = b.querySelector('mat-icon,.material-icons');
      return ic && /expand_more|keyboard_arrow_down/i.test((ic.textContent || '').trim());
    });
  }

  // Encontra aba "Itens" visível (Angular tab ou botão)
  function findItensTab() {
    return [...document.querySelectorAll('button,[role=tab],a,mat-tab-label')].find(function(b) {
      return b.offsetWidth && /^itens$/i.test((b.textContent || '').trim());
    });
  }

  // Restaura a lista de itens após navegação (proposta → voltar)
  // Garante: aba correta ativa, página correta, botões suficientes visíveis
  async function restoreItemsList(detailUrl, currentPage, nBtns, isHybridFlow) {
    // 1. Se sem botões: tenta reabrir aba Itens
    if (getItemDetBtns().length === 0) {
      var _rt = findItensTab();
      if (_rt) { _rt.click(); await wait(700); }
      try { await poll(function(){ return getItemDetBtns().length > 0; }, 200, 20000); } catch(e) {}
      // Híbrido paginado: avança páginas até encontrar itens
      if (isHybridFlow && getItemDetBtns().length === 0) {
        for (var _hpi = 0; _hpi < 15; _hpi++) {
          var _hpN = getNextPageBtn();
          if (!_hpN) break;
          _hpN.click();
          await wait(400);
          try { await poll(function(){ return getItemDetBtns().length > 0; }, 150, 4000); } catch(e) {}
          if (getItemDetBtns().length > 0) break;
        }
      }
    }
    // 2. Navega para página correta (SEMPRE para page > 1 — Angular reseta para pág. 1 após history.back)
    if (currentPage > 1) {
      await goToPageDirect(currentPage);
    }
    // 3. Aguarda renderização completa (timeout longo para processos com muitos itens)
    var _exp = Math.max(nBtns, 1);
    try { await poll(function(){ return getItemDetBtns().length >= _exp; }, 200, 25000); } catch(e) {
      var _nb = getItemDetBtns().length;
      if (_nb > 0) return _nb; // aceita o que há
    }
    return getItemDetBtns().length;
  }

  // ── Fluxo principal ───────────────────────────────────────────────────────

  // Tenta buscar propostas via PNCP API (evita scraping da UI)
  // Retorna array no formato de readPropostas(), ou null se API falhar
  async function tryPNCPProposals(cnpj, ano, seq, itemNum) {
    try {
      var url = 'https://processoscae.vercel.app/api/proposals'
        + '?cnpj=' + encodeURIComponent(cnpj)
        + '&ano=' + ano
        + '&seq=' + encodeURIComponent(seq)
        + '&item=' + itemNum;
      var r = await fetch(url);
      if (!r.ok) return null;
      var data = await r.json();
      if (data.error) return null;
      var arr = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : null);
      if (!arr || !arr.length) return null;
      return arr.map(function(p) {
        var cnpjForn = p.niFornecedor || p.cpfCnpjFornecedor || '';
        if (cnpjForn.length === 14) cnpjForn = cnpjForn.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');
        return {
          cnpj: cnpjForn,
          razao_social: p.nomeRazaoSocialFornecedor || '',
          uf: p.ufFornecedorEstrangeiro || p.ufFornecedor || '',
          status: p.descricaoSituacaoProposta || p.situacaoProposta || '',
          me_epp: !!(p.microEmpresaEmpresaPequenoPorte),
          valor_ofertado: p.valorUnitarioOfertado != null ? String(p.valorUnitarioOfertado) : '',
          valor_negociado: p.valorUnitarioNegociado != null ? String(p.valorUnitarioNegociado) : ''
        };
      });
    } catch(e) { return null; }
  }

  // Busca todos os itens do processo via PNCP API (1 chamada = até 500 itens, sem paginação de UI)
  async function tryPNCPItems(cnpj, ano, seq) {
    if (!cnpj || !ano || !seq) return null;
    var cnpjClean = (cnpj || '').replace(/\D/g, '');
    var url = 'https://processoscae.vercel.app/api/items'
      + '?cnpj=' + encodeURIComponent(cnpjClean)
      + '&ano=' + ano
      + '&seq=' + encodeURIComponent(seq)
      + '&pg=1&size=500';
    try {
      var r = await fetch(url);
      if (!r.ok) return null;
      var data = await r.json();
      if (data && data.error) return null;
      var arr = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : null);
      if (!arr || !arr.length) return null;
      return arr.map(function(it) {
        var sit = it.situacaoCompraItem;
        var sitStr = (sit && sit.descricao) ? sit.descricao : (typeof sit === 'string' ? sit : (it.situacaoCompraItemNome || ''));
        var crit = it.criterioJulgamento;
        var critStr = (crit && crit.descricao) ? crit.descricao : (typeof crit === 'string' ? crit : '');
        return {
          numeroItem:      it.numeroItem || 0,
          nomeItem:        it.descricao || '',
          descItem:        it.informacaoComplementar || it.descricaoDetalhada || '',
          qtde:            it.quantidade != null ? String(it.quantidade) : '',
          valorEstimado:   it.valorUnitarioEstimado != null ? String(it.valorUnitarioEstimado).replace('.', ',') : '',
          situacao:        sitStr,
          criterio:        critStr
        };
      });
    } catch(e) { return null; }
  }

  // Processa grupo com sub-itens:
  //  1. Lê propostas do grupo → push N linhas de fornecedor (sem dados de item)
  //  2. Volta → abre "Mostrar itens do grupo" → itera itens com paginação
  //  3. Por item: push UMA linha de item (sem dados de fornecedor)
  //  Resultado: N + 78 linhas (não N × 78). Valor Estimado nunca multiplicado.
  // processItensGrupo — fluxo correto para grupos:
  // FASE 1: Expande grupo → para cada item: ▼ (ler detalhes) → push linha item (sem CNPJ) → fecha ▼
  // FASE 2: Re-encontra grupo → clica ≡ no HEADER DO GRUPO → lê propostas → push linhas de fornecedor
  async function processItensGrupo(g, detailUrl, sheetRows, procInfo, num, ano, cont, pncpSeq, pncpCnpj) {
    var info = readGrupoInfo(g.el);

    // ── 1. Expande o grupo ─────────────────────────────────────────────────
    var itensBtn = findAttr(cont, 'tens do grupo');
    if (!itensBtn) {
      var _clEl = g.el;
      for (var _cd = 0; _cd < 20 && _clEl && _clEl !== document.body; _cd++) {
        var _found = findAttr(_clEl, 'tens do grupo');
        if (_found) { itensBtn = _found; break; }
        _clEl = _clEl.parentElement;
      }
    }
    if (!itensBtn) { log('G' + g.num + ': botão "Mostrar itens do grupo" não encontrado', 'warn'); return; }

    log('G' + g.num + ': expandindo ' + (info.total_itens || '?') + ' item(ns)...');
    // Captura botões ▼ de itens AVULSOS visíveis ANTES de expandir o grupo (excluídos em todas as páginas)
    var _standaloneBtns = new Set(getItemDetBtns());
    itensBtn.click();
    await wait(600);
    try { await poll(function(){ return getItemDetBtns().length > _standaloneBtns.size; }, 150, 12000); }
    catch(e) { log('Timeout G' + g.num + ': itens não apareceram', 'warn'); return; }
    await wait(300);

    // ── FASE 1: Lê todos os itens — push linha por item (sem fornecedor) ──
    var pageNum = 1, maxPages = 50, totalSeen = 0;

    while (pageNum <= maxPages) {
      var detBtns = getItemDetBtns();
      // Exclui botões de itens avulsos (visíveis na mesma página que o grupo, porém fora dele)
      var grpDetBtns = detBtns.filter(function(b) { return !_standaloneBtns.has(b); });
      if (!grpDetBtns.length) { log('G' + g.num + ' pág.' + pageNum + ': sem itens', 'warn'); break; }
      log('G' + g.num + ' pág.' + pageNum + ': ' + grpDetBtns.length + ' item(ns)');

      for (var iPos = 0; iPos < grpDetBtns.length; iPos++) {
        totalSeen++;
        if (window.__cnet_paused__) {
          log('⏸ Pausado...', 'warn');
          try { await poll(function(){ return !window.__cnet_paused__; }, 500, 600000); } catch(e) {}
          log('▶ Retomando...', 'ok');
        }

        var freshDets = getItemDetBtns().filter(function(b) { return !_standaloneBtns.has(b); });
        var detBtn = freshDets[iPos];
        if (!detBtn || !document.body.contains(detBtn)) continue;

        // Sobe até card do item
        var iCard = detBtn;
        for (var ck = 0; ck < 12; ck++) {
          if (!iCard || iCard === document.body) break;
          if (/Qtde\s+solicitada/i.test(iCard.innerText || '')) break;
          iCard = iCard.parentElement;
        }

        var cardLines = (iCard && iCard !== document.body)
          ? (iCard.innerText||'').split('\n').map(function(s){return s.trim();}).filter(Boolean) : [];
        var nomeItem = '', itemNum = 0, sitItem = '';
        var qtdeItem = (iCard && iCard !== document.body)
          ? ((iCard.innerText||'').match(/Qtde\s+solicitada\s+([\d.,]+)/i)||[])[1]||'' : '';
        var _pastNome = false, _sitLines = [];
        for (var cli = 0; cli < cardLines.length; cli++) {
          var _cl = cardLines[cli];
          if (!nomeItem) {
            var mm2 = _cl.match(/^(\d+)\s+(.{3,100})$/);
            if (mm2) { itemNum = parseInt(mm2[1]); nomeItem = mm2[2].trim(); _pastNome = true; }
          } else if (_pastNome) {
            if (/Qtde\s+solicitada|Valor\s+unit/i.test(_cl)) break;
            if (_cl.length < 120 && !/R\$|\d{2}\/\d{2}/.test(_cl)) _sitLines.push(_cl);
          }
        }
        sitItem = _sitLines.join(' | ');
        if (!itemNum) itemNum = iPos + 1;

        var _fG = window.__cnet_filter__;
        if (_fG && _fG.onlyNonHomologated && /homologad/i.test(sitItem||'') && !/deserto/i.test(sitItem||'')) {
          log('G' + g.num + ' item ' + itemNum + ' homologado — ignorado', 'warn'); continue;
        }

        // ── Expande ▼ para ler desc/qtde/valorEst ──────────────────────
        var descItem = '', valorEstimado = '';
        detBtn.click();
        await wait(300);
        try { await poll(function(){
          return /Descri[çc][aã]o\s*[Dd]etalhada|Quantidade\s+solicitada/i.test(
            (iCard && iCard !== document.body) ? (iCard.innerText||'') : appTxt()
          );
        }, 100, 2500); } catch(e) {}
        var expTxt = (iCard && iCard !== document.body) ? (iCard.innerText||'') : appTxt();
        var expLines = expTxt.split('\n').map(function(s){return s.trim();}).filter(Boolean);
        for (var eli = 0; eli < expLines.length; eli++) {
          if (/Descri[çc][aã]o\s*[Dd]etalhada/i.test(expLines[eli])) descItem = (expLines[eli+1]||'').slice(0,300);
          if (/Valor\s+estimado\s*\(unit[aá]rio\)/i.test(expLines[eli])) {
            var _vu = (expLines[eli+1]||'').replace(/^R\$\s*/,'').trim();
            if (_vu && !/sigiloso/i.test(_vu)) valorEstimado = _vu;
          }
          if (!qtdeItem && /Quantidade\s+solicitada/i.test(expLines[eli])) {
            var _qv = (expLines[eli+1]||'').trim();
            if (/^\d[\d.,]*$/.test(_qv)) qtdeItem = _qv;
          }
        }
        if (!qtdeItem) qtdeItem = (expTxt.match(/Qtde\s+solicitada\s+([\d.,]+)/i)||[])[1]||'';

        // ── Fecha ▼ ───────────────────────────────────────────────────
        detBtn.click();
        await wait(100);

        log('G' + g.num + ' item ' + itemNum + ': ' + (nomeItem||'?') + (descItem ? ' [desc]' : ''));

        // Push linha do item — colunas de fornecedor vazias
        sheetRows.push([
          num, ano, UASG, g.num, itemNum, nomeItem,
          '', '', '', '', '',
          '', '',
          info.situacao||sitItem||'',
          qtdeItem||'', descItem||'',
          procInfo.criterio||'', procInfo.sitProcesso||'', valorEstimado||''
        ]);
      }

      // ── Paginação dentro do grupo ──────────────────────────────────────
      // Para quando já leu todos os itens esperados (evita pegar paginador dos itens separados)
      if (info.total_itens && totalSeen >= info.total_itens) break;
      var nxtBtn = getNextPageBtn();
      if (nxtBtn) {
        log('G' + g.num + ' → pág.' + (pageNum + 1));
        nxtBtn.click();
        await wait(700);
        try { await poll(function(){ return getItemDetBtns().length > 0; }, 150, 6000); } catch(e) {}
        await wait(200);
        pageNum++;
      } else { break; }
    }

    // ── FASE 2: Propostas do GRUPO ────────────────────────────────────────
    // URL pattern: grupos têm índice NEGATIVO (/item/-11 = G1 com 11 grupos)
    // Sobe a partir de g.el até achar o container que CONTÉM o botão ≡ (ropostas)

    // Re-encontra g.el se Angular re-renderizou
    if (!document.body.contains(g.el)) {
      var _freshGs = findGrupos();
      var _fg = _freshGs.find(function(fg){ return fg.num === g.num; });
      if (_fg) g.el = _fg.el;
    }

    // Sobe até encontrar o container que TEM o botão ≡ deste grupo especificamente
    var cont2 = g.el, grpPropBtn = null;
    for (var ci2 = 0; ci2 < 20; ci2++) {
      if (!cont2 || !document.body.contains(cont2) || cont2 === document.body) { cont2 = null; break; }
      var _pb = findAttr(cont2, 'ropostas');
      if (_pb) { grpPropBtn = _pb; break; }
      cont2 = cont2.parentElement;
    }

    // Fallback: qualquer link com /item/- (índice negativo = grupo) no documento
    if (!grpPropBtn) {
      grpPropBtn = [...document.querySelectorAll('a,button,[role=button]')].find(function(el) {
        if (!el.offsetWidth) return false;
        var attrs = [...el.attributes].map(function(a){ return a.value; }).join(' ');
        return /\/item\/-\d+/.test(attrs) || (/ropostas/i.test(attrs) && /grupo/i.test((el.closest('[class*=grupo],[class*=group],[class*=lote]') || document.body).textContent || ''));
      });
    }

    if (!grpPropBtn) {
      log('G' + g.num + ': botão propostas do grupo não encontrado — pulando propostas', 'warn');
    } else {
      log('G' + g.num + ': carregando propostas do grupo...');
      var urlAntesPropG = location.href;
      grpPropBtn.click();
      // Aguarda URL mudar para /item/- (Angular roteou para propostas do grupo)
      try { await poll(function(){ return /\/item\/-\d+/.test(location.href); }, 150, 8000); } catch(e) {}
      log('propGrpURL: …' + location.href.slice(-50));
      // Aguarda DOM estabilizar completamente (evita ler cache do grupo anterior)
      await waitDOMStable(700, 18000);
      // Aguarda CNPJs aparecerem (Angular pode estabilizar antes de renderizar lista)
      var CNPJ_RE_G = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|ESTRANG\d{5,}/;
      if (!CNPJ_RE_G.test(appTxt())) {
        try { await poll(function(){ return CNPJ_RE_G.test(appTxt()); }, 200, 8000); } catch(e) {}
      }

      var hasCnpjsG = CNPJ_RE_G.test(appTxt());
      if (!hasCnpjsG) log('G' + g.num + ': sem CNPJs nas propostas do grupo', 'warn');

      if (hasCnpjsG) {
        var propsG = readPropostas();
        log(propsG.length + ' proposta(s) do grupo ' + g.num, 'ok');
        for (var prG of propsG) {
          sheetRows.push([
            num, ano, UASG,
            g.num, '', '',
            prG.cnpj, prG.razao_social, prG.uf, prG.status,
            prG.me_epp ? 'Sim' : 'Não',
            prG.valor_ofertado||'', prG.valor_negociado||'',
            info.situacao||procInfo.sitProcesso||'',
            '', '',
            procInfo.criterio||'', procInfo.sitProcesso||'', ''
          ]);
        }
      }

      if (location.href !== urlAntesPropG) {
        history.back();
        await wait(400);
        try { await poll(function(){ return location.href === urlAntesPropG; }, 150, 10000); } catch(e) {}
        // Aguarda DOM estabilizar após voltar: elimina CNPJs residuais do Angular
        await waitDOMStable(600, 10000);
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, keyCode: 27 }));
        await wait(200);
        await waitDOMStable(500, 6000);
      }
    }

    // ── Colapsa o grupo (evita interferência quando próximo grupo expandir) ──
    if (getItemDetBtns().length > 0) {
      // Re-encontra container do grupo para achar botão de colapso
      var colCont = g.el;
      var colBtn = null;
      if (document.body.contains(colCont)) {
        for (var ci3 = 0; ci3 < 20; ci3++) {
          if (!colCont || colCont === document.body) break;
          colBtn = findAttr(colCont, 'tens do grupo');
          if (colBtn) break;
          colCont = colCont.parentElement;
        }
      }
      if (colBtn) {
        colBtn.click();
        await wait(500);
        try { await poll(function(){ return getItemDetBtns().length === 0; }, 150, 5000); } catch(e) {}
        await wait(200);
      }
    }

    // ── Volta para página de detalhes ─────────────────────────────────────
    var backTries = 0;
    while (location.href !== detailUrl && backTries++ < 8) {
      history.back();
      await wait(500);
    }
    await wait(200);
  }

  // Volta para página de busca usando um único history.back()
  async function goSearch() {
    history.back();
    try { await poll(function () { return visInputs().length >= 1; }, 150, 12000); }
    catch (e) { log('Aviso: timeout voltando para busca', 'warn'); }
    await wait(500);
    // Confirma que página de detalhes/propostas foi desmontada (sem CNPJs visíveis)
    try { await poll(function () {
      return !/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|ESTRANG\d{5,}/.test(appTxt());
    }, 150, 4000); }
    catch (e) {}
    await wait(250);
  }

  async function processOne(p, cfg) {
    var num = p.num, ano = p.ano;
    setTabProgress(num + '/' + ano);
    var numShort = String(parseInt(num, 10)); // sem zeros à esquerda: '00234' → '234'
    function hasProc(t) {
      return t.includes(num + '/' + ano) || t.includes(numShort + '/' + ano);
    }
    var searchUrl = location.href;
    log('Processo ' + num + ' (' + ano + ')');

    var radios = [...document.querySelectorAll('input[type=radio],[role=radio],mat-radio-button')];
    var fin = radios.find(function (r) { return /finalizada/i.test(r.value || r.getAttribute('value') || r.textContent || ''); });
    if (fin) { fin.click(); await wait(500); }

    var checks = [...document.querySelectorAll('input[type=checkbox],mat-checkbox,[role=checkbox]')];
    for (var c of checks) {
      var lbl = (c.getAttribute('aria-label') || c.id || c.value || c.textContent || '').toLowerCase();
      if (/homologad|deserta/.test(lbl) && (c.getAttribute('aria-checked') || String(c.checked)) === 'false') {
        c.click(); await wait(200);
      }
    }

    var ins = visInputs();
    if (!ins.length) { log('Nenhum input encontrado', 'err'); return; }
    ri(ins[0], UASG); await wait(250);
    ri(ins[1] || ins[0], num + String(ano)); await wait(250);
    log('UASG: ' + ins[0].value + ' | Nr: ' + (ins[1] || ins[0]).value);

    var pesqBtn = [...document.querySelectorAll('button')].find(function (b) { return /pesquisar|buscar/i.test(b.textContent || ''); });
    if (!pesqBtn) { log('Botao Pesquisar nao encontrado', 'err'); return; }
    log('Pesquisando...');
    pesqBtn.click();

    try {
      await poll(function () {
        var t = appTxt();
        return hasProc(t) || /nenhum|sem resultado/i.test(t);
      }, 200, 35000);
    } catch (e) { log('Timeout na pesquisa', 'err'); return; }

    if (!hasProc(appTxt())) { log('Nao encontrado: ' + num + '/' + ano, 'warn'); return; }
    log('Resultado encontrado', 'ok');

    // p.modalidade tem prioridade (processo específico); cfg.modalidade como fallback global
    var _mod = (p && p.modalidade) || (cfg && cfg.modalidade);
    var ab = findAcompBtn(num, ano, _mod) || findAcompBtn(numShort, ano, _mod);
    if (!ab) {
      log('Botao Acompanhar nao encontrado', 'err');
      [...document.querySelectorAll('button,a,[role=button]')].slice(0, 20).forEach(function (b) {
        console.log(b.tagName, [...b.attributes].map(function (a) { return a.name + '=' + a.value; }).join(' | '));
      });
      return;
    }
    log('Abrindo detalhes...'); ab.click();

    try { await poll(function () {
      if (location.href === searchUrl) return false;
      var t = appTxt().toUpperCase();
      var hasContent = t.includes('GRUPO') || t.includes('LOTE') || t.includes('PROPOSTA') || t.includes('SITUAÇÃO') || t.includes('SITUACAO') || t.includes('FORNECEDOR') || t.includes('ITENS');
      return hasContent && hasProc(appTxt());
    }, 200, 45000); }
    catch (e) { log('Timeout pagina de detalhes', 'err'); await goSearch(); return; }
    log('Detalhes carregados: ' + num + '/' + ano, 'ok');
    await wait(800); // aguarda renderização completa do Angular

    var procInfo = readProcessInfo();
    log('Critério: ' + (procInfo.criterio || '–'));

    // Tenta extrair identif. PNCP da página (sequencial + CNPJ do órgão)
    var pncpSeq = null, pncpCnpj = null;
    var _txt = appTxt();
    var _seqM = _txt.match(/Contrata[çc][aã]o\s+PNCP[:\s]+(\d{4,})/i)
             || _txt.match(/Nr\.?\s*PNCP[:\s]+(\d{4,})/i)
             || _txt.match(/PNCP[:\s\-]+(\d{4,})/i);
    if (_seqM) pncpSeq = _seqM[1];
    var _cnpjM = _txt.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    if (_cnpjM) pncpCnpj = _cnpjM[1];
    if (pncpSeq) log('PNCP seq=' + pncpSeq + (pncpCnpj ? ' cnpj=' + pncpCnpj : '') + ' — API ativa');

    var detailUrl = location.href; // URL da página de detalhes

    var grupos = findGrupos();
    var sheetRows = [];

    // Filtro de grupos (processo por grupo)
    var _f = window.__cnet_filter__;
    if (grupos.length && _f && _f.groupNums) {
      grupos = grupos.filter(function(g) { return _f.groupNums.has(g.num); });
      log('Filtro grupos: ' + grupos.length + ' selecionado(s)', 'ok');
    }

    // Fallback: página usa "Itens" em vez de grupos numerados
    var isItemByItemFlow = !grupos.length;
    var isHybridFlow = false; // true = processo misto (grupos + itens avulsos) — sem paginação de itens
    var currentPage = 1; // página atual (incrementa na paginação)
    var totalBase = 0;   // total de itens vistos (para numeração absoluta cross-páginas)
    var nBtns = 0;       // botões "Mostrar detalhes" na página (para poll estabilização)
    if (isItemByItemFlow) {
      var itensTab = [...document.querySelectorAll('button,[role=tab],a,mat-tab-label')].find(function(b){
        return /^itens$/i.test((b.textContent||'').trim());
      });
      if (itensTab) {
        log('Aba Itens, clicando...');
        itensTab.click();
        await wait(800);
        // Aguarda itens aparecerem (Angular pode demorar alguns segundos para renderizar)
        try { await poll(function(){ return getItemDetBtns().length > 0; }, 200, 12000); } catch(e) {
          await waitDOMStable(600, 6000);
        }
        await wait(300);
        // CRÍTICO: Angular muda a URL ao ativar a aba Itens
        // detailUrl precisa refletir este URL para que history.back() saiba onde deve voltar
        detailUrl = location.href;
      }
      var detBtns0 = getItemDetBtns();
      nBtns = detBtns0.length;
      log(nBtns + ' item(ns) encontrado(s) (incl. desertos)');
      for (var ii = 0; ii < detBtns0.length; ii++) {
        var iNum = totalBase + ii + 1;
        if (_f && _f.itemNums && !_f.itemNums.has(iNum)) continue;
        grupos.push({ num: iNum, el: document.body, _idx: ii });
      }
      totalBase += detBtns0.length;
    }

    // Processo misto: tem grupos E itens avulsos fora dos grupos (abaixo dos grupos)
    // Registra quantos grupos reais existem para detectar itens avulsos após processar grupos
    var originalGruposLen = grupos.length;

    log(grupos.length + ' grupo(s)/item(ns)');

    // ── Modo PNCP API puro: desabilitado — propostas via UI scraping são mais confiáveis ──
    if (false && isItemByItemFlow && pncpSeq && pncpCnpj) {
      log('Tentando modo PNCP API (zero paginação de UI)...', 'ok');
      var pncpItens = await tryPNCPItems(pncpCnpj, ano, pncpSeq);
      if (pncpItens && pncpItens.length) {
        log('PNCP API: ' + pncpItens.length + ' item(ns) carregados', 'ok');
        for (var pni = 0; pni < pncpItens.length; pni++) {
          var pnIt = pncpItens[pni];
          var pnNum = pnIt.numeroItem || (pni + 1);
          var _fPn = window.__cnet_filter__;
          if (_fPn && _fPn.itemNums && !_fPn.itemNums.has(pnNum)) continue;
          if (_fPn && _fPn.onlyNonHomologated && /homologad/i.test(pnIt.situacao || '') && !/deserto/i.test(pnIt.situacao || '')) continue;
          setProgress(pni + 1, pncpItens.length, 'Item ' + pnNum, 'API');
          log('Item ' + pnNum + ': ' + (pnIt.nomeItem || '?'));
          sheetRows.push([
            num, ano, UASG, '', pnNum, pnIt.nomeItem,
            '', '', '', '', '', '', '',
            pnIt.situacao || procInfo.sitProcesso || '',
            pnIt.qtde || '', pnIt.descItem || '',
            pnIt.criterio || procInfo.criterio || '', procInfo.sitProcesso || '', pnIt.valorEstimado || ''
          ]);
          var pnProps = await tryPNCPProposals(pncpCnpj, ano, pncpSeq, pnNum);
          if (pnProps && pnProps.length) {
            log('  ' + pnProps.length + ' proposta(s)', 'ok');
            for (var pnPr of pnProps) {
              sheetRows.push([
                num, ano, UASG, '', pnNum, pnIt.nomeItem,
                pnPr.cnpj, pnPr.razao_social, pnPr.uf, pnPr.status,
                pnPr.me_epp ? 'Sim' : 'Não',
                pnPr.valor_ofertado || '', pnPr.valor_negociado || '',
                pnIt.situacao || procInfo.sitProcesso || '',
                pnIt.qtde || '', '',
                pnIt.criterio || procInfo.criterio || '', procInfo.sitProcesso || '', pnIt.valorEstimado || ''
              ]);
            }
          } else {
            log('  Item ' + pnNum + ': sem propostas API', 'warn');
          }
        }
        if (cfg.scriptUrl) {
          log('Enviando ' + sheetRows.length + ' linha(s) para Sheets...');
          var okPN = await postToSheets(cfg.scriptUrl, num + '-' + ano, sheetRows);
          log('Sheets: ' + (okPN ? 'OK' : 'ERRO'), okPN ? 'ok' : 'err');
        }
        var okSPN = await postToSupabase(num + '-' + ano, sheetRows, UASG);
        log('Supabase: ' + (okSPN ? 'OK' : 'ERRO'), okSPN ? 'ok' : 'err');
        await goSearch();
        await wait(1500);
        return;
      }
      log('PNCP API indisponível — usando raspagem de UI', 'warn');
    }

    // while em vez de for-of: permite adicionar novos itens (paginação) sem duplicar código
    var gi = 0;
    while (gi < grupos.length) {
      // ── Pausa ────────────────────────────────────────────────────────────────
      if (window.__cnet_paused__) {
        log('⏸ Pausado — clique Retomar para continuar', 'warn');
        try { await poll(function(){ return !window.__cnet_paused__; }, 500, 600000); } catch(e) {}
        log('▶ Retomando...', 'ok');
      }
      var g = grupos[gi++];
      setProgress(gi, grupos.length, 'Item/Grupo ' + g.num, '');
      var info = readGrupoInfo(g.el);
      log('Item/Grupo ' + g.num + ': ' + (info.situacao || '?'));

      // Filtro não-homologado para GRUPOS (info já lida acima)
      var _filt = window.__cnet_filter__;
      if (!isItemByItemFlow && _filt && _filt.onlyNonHomologated && /homologad/i.test(info.situacao || '')) {
        log('Grupo ' + g.num + ' homologado — ignorado (filtro)', 'warn');
        continue;
      }

      // ── Processa item (item-a-item) ou grupo ─────────────────────────────────
      if ('_idx' in g) {
        // Item-a-item: itera por botão "Mostrar detalhes" (um por item, inclusive desertos)
        var freshDetBtns = getItemDetBtns();
        var iibDetBtn = freshDetBtns[g._idx] || null;

        // RECUPERAÇÃO: se o botão esperado não está disponível (DOM não renderizou ainda ou aba errada)
        // Aguarda vigorosamente antes de desistir — crítico para processos grandes (100+ itens / 13+ páginas)
        if (!iibDetBtn) {
          log('detBtn idx=' + g._idx + ' | detBtns=' + freshDetBtns.length + ' — aguardando renderização...', 'warn');
          // Passo 1: reativa aba Itens se sem botões
          if (freshDetBtns.length === 0) {
            var _rt0 = findItensTab();
            if (_rt0) { _rt0.click(); await wait(700); }
          }
          // Passo 2: aguarda botões suficientes (timeout longo)
          try { await poll(function(){ return getItemDetBtns().length > g._idx; }, 250, 20000); } catch(e) {}
          // Passo 3: para página > 1, certifica que está na página certa
          // (Angular reseta para pág.1 após history.back — índice correto só vale na página correta)
          if (currentPage > 1) { await goToPageDirect(currentPage); }
          // Passo 4: aguarda novamente após navegação
          try { await poll(function(){ return getItemDetBtns().length > g._idx; }, 250, 15000); } catch(e) {}
          freshDetBtns = getItemDetBtns();
          iibDetBtn = freshDetBtns[g._idx] || null;
          if (freshDetBtns.length > 0) nBtns = Math.max(nBtns, freshDetBtns.length);
        }

        log('detBtn idx=' + g._idx + ' | detBtns=' + freshDetBtns.length + (iibDetBtn ? '' : ' ← FALHOU'), iibDetBtn ? undefined : 'err');

        if (iibDetBtn) {
          // Sobe a partir do detBtn para encontrar o card do item
          var itemCard = iibDetBtn;
          for (var ci2 = 0; ci2 < 12; ci2++) {
            if (!itemCard || itemCard === document.body) break;
            var _iCTxt = itemCard.innerText || '';
            // Para no PRIMEIRO ancestral com exatamente 1 "Qtde solicitada" = card individual
            if ((_iCTxt.match(/Qtde\s+solicitada/gi) || []).length === 1) break;
            itemCard = itemCard.parentElement;
          }
          log('card[' + g._idx + ']: ' + (_iCTxt ? _iCTxt.slice(0, 60).replace(/\n/g, ' ') : 'nulo'));

          // Lê nome, qtde, sit ANTES de expandir (visíveis sem clique)
          var cardLines = (itemCard && itemCard !== document.body)
            ? (itemCard.innerText || '').split('\n').map(function(s) { return s.trim(); }).filter(Boolean) : [];
          var nomeItem = '', sitItem = '', cardItemNum = 0;
          var qtdeItem = (itemCard && itemCard !== document.body)
            ? ((itemCard.innerText || '').match(/Qtde\s+solicitada\s+([\d.,]+)/i) || [])[1] || '' : '';
          // Coleta todas as linhas de status (laranja) entre o nome do item e "Qtde solicitada"
          var _pastNome = false, _sitLines = [];
          for (var cli = 0; cli < cardLines.length; cli++) {
            var _cl = cardLines[cli];
            if (!nomeItem) {
              var mm2 = _cl.match(/^(\d+)\s+(.{3,300})$/);
              if (mm2) { cardItemNum = parseInt(mm2[1]); nomeItem = mm2[2].trim(); _pastNome = true; }
            } else if (_pastNome) {
              if (/Qtde\s+solicitada|Valor\s+estimado|Valor\s+unit/i.test(_cl)) break;
              if (_cl.length < 120 && !/R\$|\d{2}\/\d{2}/.test(_cl)) _sitLines.push(_cl);
            }
          }
          sitItem = _sitLines.join(' | ');

          // Filtro não-homologado (exclui homologados normais, mas NÃO desertos)
          var _skipNH = _filt && _filt.onlyNonHomologated && /homologad/i.test(sitItem || '') && !/deserto/i.test(sitItem || '');
          if (_skipNH) {
            log('Item ' + g.num + ' homologado — ignorado (filtro)', 'warn');
            // fall to pagination
          } else {
            // Expande detalhes para ler Descrição Detalhada + Valor Estimado — fecha após ler
            var descItem = '', valorEstimado = '';
            iibDetBtn.click();
            await wait(300);
            try { await poll(function(){ return /Descri[çc][aã]o\s*[Dd]etalhada/i.test((itemCard && itemCard !== document.body ? itemCard.innerText : appTxt())); }, 100, 2500); } catch(e) {}
            var expandedTxt = (itemCard && itemCard !== document.body) ? (itemCard.innerText || '') : appTxt();
            var detLines2 = expandedTxt.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
            for (var di = 0; di < detLines2.length; di++) {
              if (/Descri[çc][aã]o\s*[Dd]etalhada/i.test(detLines2[di])) { descItem = (detLines2[di + 1] || '').slice(0, 300); }
              if (/Valor\s+estimado\s*\(unit[aá]rio\)/i.test(detLines2[di])) {
                var _vu = (detLines2[di + 1] || '').replace(/^R\$\s*/, '').trim();
                if (_vu) valorEstimado = _vu;
              }
              // "Quantidade solicitada" (label expandido) + próxima linha = valor
              if (!qtdeItem && /Quantidade\s+solicitada/i.test(detLines2[di])) {
                var _qv = (detLines2[di + 1] || '').trim();
                if (/^\d[\d.,]*$/.test(_qv)) qtdeItem = _qv;
              }
            }
            // Fallback regex: tenta "Qtde solicitada N" (compacto) e "Quantidade solicitada\nN" (expandido)
            if (!qtdeItem) {
              var _qm = expandedTxt.match(/Qtde\s+solicitada\s+([\d.,]+)/i)
                     || expandedTxt.match(/Quantidade\s+solicitada[\s\S]{0,10}?([\d.,]+)/i);
              if (_qm) qtdeItem = _qm[1];
            }
            iibDetBtn.click(); // fecha painel (toggle) para não empurrar itens fora da viewport
            await wait(100);

            setProgress(gi, grupos.length, (nomeItem || 'Item ' + g.num).slice(0, 60), '');
          log('Item ' + g.num + ': ' + (nomeItem || '?') + (descItem ? ' [desc ok]' : ' [sem desc]') + (sitItem ? ' | ' + sitItem : ''));

            var _itemNum = cardItemNum || g.num;
            if (/deserto/i.test(sitItem || '')) {
              // Item deserto: sem proposta — registra linha com CNPJ = "DESERTO"
              sheetRows.push([
                num, ano, UASG,
                '', _itemNum, nomeItem,
                'DESERTO', '', '', 'Deserto', '',
                '', '',
                sitItem || 'Homologado (deserto)', qtdeItem, descItem || '',
                procInfo.criterio || '', procInfo.sitProcesso || '', valorEstimado || ''
              ]);
              // fall to pagination
            } else {
              // Encontra propBtn dentro do mesmo card
              var propBtn = (itemCard && itemCard !== document.body) ? findAttr(itemCard, 'ropostas') : null;
              if (!propBtn) {
                // Sem botão de propostas (ex: Homologado deserto sem concorrentes) → DESERTO
                log('Item ' + _itemNum + ': sem propBtn — registrado como DESERTO', 'warn');
                sheetRows.push([
                  num, ano, UASG,
                  '', _itemNum, nomeItem,
                  'DESERTO', '', '', 'Deserto', '',
                  '', '',
                  sitItem || 'Homologado (deserto)', qtdeItem, descItem || '',
                  procInfo.criterio || '', procInfo.sitProcesso || '', valorEstimado || ''
                ]);
              } else {
                log('Carregando propostas item ' + _itemNum + '...');
                var urlAntesProp = location.href;
                var props = null;
                {
                  propBtn.click();
                  // Passo 1: URL muda (Angular roteou para página de propostas deste item)
                  try { await poll(function(){ return location.href !== urlAntesProp; }, 150, 8000); } catch(e) {}
                  log('propURL: …' + location.href.slice(-50));
                  // Passo 2: aguarda DOM estabilizar COMPLETAMENTE antes de ler
                  // (evita ler conteúdo da página anterior em cache do Angular)
                  await waitDOMStable(700, 18000);
                  // Passo 3: Angular pode estabilizar DOM antes de renderizar a lista de CNPJs
                  // — aguarda explicitamente um CNPJ aparecer antes de declarar hasCnpjs=false
                  var CNPJ_RE_P = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|ESTRANG\d{5,}/;
                  if (!CNPJ_RE_P.test(appTxt())) {
                    log('Aguardando CNPJs item ' + g.num + '...', 'warn');
                    try { await poll(function(){ return CNPJ_RE_P.test(appTxt()); }, 200, 8000); } catch(e) {}
                  }
                  var hasCnpjs = CNPJ_RE_P.test(appTxt());
                  if (!hasCnpjs) log('Sem CNPJs item ' + g.num + ' — item sem licitantes ou deserto', 'warn');
                  if (hasCnpjs) props = readPropostas();
                  log('Lidas: ' + (props ? props.length : 0) + ' proposta(s) item ' + _itemNum, props && props.length ? 'ok' : 'warn');
                }

                if (props && props.length) {
                  for (var pr of props) {
                    sheetRows.push([
                      num, ano, UASG,
                      '', _itemNum, nomeItem,
                      pr.cnpj, pr.razao_social, pr.uf, pr.status,
                      pr.me_epp ? 'Sim' : 'Não',
                      pr.valor_ofertado || '', pr.valor_negociado || '',
                      sitItem || info.situacao || '',
                      qtdeItem || '', descItem || '',
                      procInfo.criterio || '', procInfo.sitProcesso || '', valorEstimado || ''
                    ]);
                    log('  ' + pr.cnpj.slice(-11) + ' [' + (pr.status||'–') + ']', 'ok');
                  }
                }

                // ── Retorna da página de propostas para a lista de itens ──────────────
                if (location.href !== urlAntesProp) {
                  history.back();
                  await wait(500);
                  // Aguarda retorno: detailUrl foi atualizado para URL da aba Itens após clicar nela
                  try { await poll(function() {
                    return location.href === detailUrl || !location.href.includes('/propostas');
                  }, 150, 12000); } catch(e) { log('Timeout retornando item ' + g.num, 'warn'); }
                  await wait(300);
                } else {
                  // Proposta foi modal/dialog (URL não mudou) — fecha com Escape
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, keyCode: 27 }));
                  await wait(300);
                  if (/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|ESTRANG\d{5,}/.test(appTxt())) {
                    propBtn.click(); await wait(300); // toggle-fecha o painel se ainda aberto
                  }
                }

                // ── Restaura lista de itens (via helper — robusto para processos grandes) ──
                if (isItemByItemFlow) {
                  var _nb2 = await restoreItemsList(detailUrl, currentPage, nBtns, isHybridFlow);
                  if (_nb2 > 0) nBtns = _nb2;
                  if (nBtns === 0) log('Aviso: sem botões de detalhes após restauração item ' + g.num, 'warn');
                }
                await wait(300);
              }
            }
          }
        }
      } else {
        // Modo grupos: re-detecta g.el se Angular re-renderizou o DOM após navegação
        if (!document.body.contains(g.el)) {
          // Aguarda DOM estabilizar (history.back() pode levar o Angular a recarregar página anterior dos grupos)
          await waitDOMStable(500, 5000);
          var _freshGs = findGrupos();
          var _fg = _freshGs.find(function(fg){ return fg.num === g.num; });
          if (!_fg) {
            // Grupo pode estar em outra página — avança páginas de grupos até encontrá-lo
            for (var _grpRet = 0; _grpRet < 8 && !_fg; _grpRet++) {
              var _nxtGrpR = getNextPageBtn();
              if (!_nxtGrpR) break;
              log('G' + g.num + ': não visível — avançando página de grupos...', 'warn');
              _nxtGrpR.click();
              await wait(700);
              try { await poll(function(){ return findGrupos().length > 0; }, 200, 6000); } catch(e) {}
              await waitDOMStable(400, 4000);
              _freshGs = findGrupos();
              _fg = _freshGs.find(function(fg){ return fg.num === g.num; });
            }
          }
          if (_fg) { g.el = _fg.el; }
          else { log('G' + g.num + ': não encontrado no DOM — pulando', 'warn'); continue; }
        }
        var cont = g.el;
        for (var ci = 0; ci < 8; ci++) { if (!cont) break; if (cont.querySelectorAll('button,[role=button]').length > 1) break; cont = cont.parentElement; }
        // Se cont ainda não está no DOM (stale), usa document
        if (!document.body.contains(cont)) cont = document;
        // Fallback: climb from g.el if cont doesn't expose the button (happens for G1 when DOM hasn't expanded yet)
        if (!findAttr(cont, 'tens do grupo')) {
          var _clEl2 = g.el;
          for (var _cd2 = 0; _cd2 < 20 && _clEl2 && _clEl2 !== document.body; _cd2++) {
            if (findAttr(_clEl2, 'tens do grupo')) { cont = _clEl2; break; }
            _clEl2 = _clEl2.parentElement;
          }
        }
        if (findAttr(cont, 'tens do grupo')) {
          await processItensGrupo(g, detailUrl, sheetRows, procInfo, num, ano, cont, pncpSeq, pncpCnpj);
          // Após último grupo da página: itens avulsos na página atual OU próxima página de grupos
          if (!isItemByItemFlow && gi === grupos.length) {
            // Garante que todos os grupos estão colapsados antes de detectar itens avulsos
            // (grupo expandido contamina getItemDetBtns() com botões de itens do grupo)
            try { await poll(function(){ return getItemDetBtns().length === 0; }, 200, 6000); } catch(e) {}
            await waitDOMStable(400, 5000);
            // Verifica itens avulsos na PÁGINA ATUAL antes de buscar próxima página de grupos
            var _curMix = getItemDetBtns();
            if (_curMix.length > 0) {
              log('Processo misto: ' + _curMix.length + ' item(ns) avulso(s) na página atual');
              nBtns = _curMix.length;
              var _fMC = window.__cnet_filter__;
              for (var _mci = 0; _mci < _curMix.length; _mci++) {
                var _mcN = totalBase + _mci + 1;
                if (_fMC && _fMC.itemNums && !_fMC.itemNums.has(_mcN)) continue;
                grupos.push({ num: _mcN, el: document.body, _idx: _mci });
              }
              totalBase += _curMix.length;
              isItemByItemFlow = grupos.length > originalGruposLen;
              if (isItemByItemFlow) isHybridFlow = true;
            } else {
              // Sem itens avulsos na página atual: busca próxima página de grupos (loop: pula páginas já processadas)
              for (var _pgTry2 = 0; _pgTry2 < 10; _pgTry2++) {
                var _nxtGrp = getNextPageBtn();
                if (!_nxtGrp) break;
                log('Grupos → próxima página de grupos...');
                _nxtGrp.click();
                await wait(700);
                // Aguarda grupos OU itens (página pode ter só itens)
                try { await poll(function(){ return findGrupos().length > 0 || getItemDetBtns().length > 0; }, 150, 5000); } catch(e) {}
                await wait(400);
                var _newGs2 = findGrupos().filter(function(ng){
                  return !grupos.some(function(og){ return og.num === ng.num; });
                });
                if (_newGs2.length) {
                  log('Nova página: ' + _newGs2.length + ' grupo(s) adicionado(s)');
                  grupos = grupos.concat(_newGs2);
                  originalGruposLen = grupos.length;
                  break;
                }
                if (getItemDetBtns().length > 0) { log('Pág. sem novos grupos mas com itens — detectando...', 'ok'); break; }
                log('Pág. sem novos grupos — buscando próxima...', 'warn');
              }
              // Verifica itens avulsos na nova página (se não encontrou novos grupos)
              if (gi === grupos.length) {
                var _mixD = getItemDetBtns();
                if (!_mixD.length) {
                  var _iTab = [...document.querySelectorAll('button,[role=tab],mat-tab-label,a')].find(function(b){
                    return b.offsetWidth && /^itens$/i.test((b.textContent||'').trim());
                  });
                  if (_iTab) {
                    log('Processo híbrido: abrindo aba Itens...', 'ok');
                    _iTab.click();
                    await wait(700);
                    try { await poll(function(){ return getItemDetBtns().length > 0; }, 150, 8000); } catch(e) {}
                    await wait(300);
                    _mixD = getItemDetBtns();
                  }
                }
                if (_mixD.length) {
                  log('Processo misto: ' + _mixD.length + ' item(ns) avulso(s)');
                  nBtns = _mixD.length;
                  var _fMD = window.__cnet_filter__;
                  for (var _mdi = 0; _mdi < _mixD.length; _mdi++) {
                    var _mdN = totalBase + _mdi + 1;
                    if (_fMD && _fMD.itemNums && !_fMD.itemNums.has(_mdN)) continue;
                    grupos.push({ num: _mdN, el: document.body, _idx: _mdi });
                  }
                  totalBase += _mixD.length;
                  isItemByItemFlow = grupos.length > originalGruposLen;
                  if (isItemByItemFlow) isHybridFlow = true;
                }
              }
            }
          }
          continue;
        }
        var grpPropBtn = findAttr(cont, 'ropostas') || findAttr(document, 'ropostas');
        if (!grpPropBtn) {
          log('Botao propostas nao encontrado grupo ' + g.num, 'warn');
        } else {
          log('Carregando propostas G' + g.num + '...');
          var urlAntesPropG = location.href;
          grpPropBtn.click();
          await wait(150);

          var hasCnpjsG = true;
          try {
            await poll(function () { return /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|ESTRANG\d{5,}/.test(appTxt()); }, 150, 15000);
          } catch (e) { log('Sem CNPJs G' + g.num + ' — pulando', 'warn'); hasCnpjsG = false; }

          if (hasCnpjsG) {
            var propsG = readPropostas();
            log(propsG.length + ' proposta(s) a registrar');
            for (var prG of propsG) {
              sheetRows.push([
                num, ano, UASG,
                g.num, '', '',
                prG.cnpj, prG.razao_social, prG.uf, prG.status,
                prG.me_epp ? 'Sim' : 'Não',
                prG.valor_ofertado || '', prG.valor_negociado || '',
                info.situacao || '', '', '',
                procInfo.criterio || '', procInfo.sitProcesso || '', ''
              ]);
              log('  ' + prG.cnpj.slice(-11) + ' ' + prG.status, 'ok');
            }
          }

          if (location.href !== urlAntesPropG) {
            history.back();
            try { await poll(function () { return location.href === detailUrl; }, 150, 8000); }
            catch (e) { log('Timeout voltando G' + g.num, 'warn'); }
          } else {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, keyCode: 27 }));
            await wait(200);
            if (/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|ESTRANG\d{5,}/.test(appTxt())) {
              grpPropBtn.click();
              await wait(200);
            }
          }
          try { await poll(function () { return !/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|ESTRANG\d{5,}/.test(appTxt()); }, 150, 3000); } catch (e) {}
          await wait(150);
        }
      }

      // Paginação de GRUPOS: se acabaram os grupos da página atual, vai para próxima página de grupos (loop: pula páginas já processadas)
      if (!isItemByItemFlow && gi === grupos.length) {
        var _addedGrps = false;
        for (var _pgTry = 0; _pgTry < 10; _pgTry++) {
          var nxtGrpPage = getNextPageBtn();
          if (!nxtGrpPage) break;
          log('Grupos → próxima página de grupos...');
          nxtGrpPage.click();
          await wait(700);
          try { await poll(function(){ return findGrupos().length > 0; }, 150, 8000); } catch(e) {}
          await wait(400);
          var _newGs = findGrupos().filter(function(ng){
            return !grupos.some(function(og){ return og.num === ng.num; });
          });
          if (_newGs.length) {
            log('Nova página: ' + _newGs.length + ' grupo(s) adicionado(s)');
            grupos = grupos.concat(_newGs);
            originalGruposLen = grupos.length; // adia detecção de itens avulsos
            _addedGrps = true;
            break;
          }
          if (getItemDetBtns().length > 0) break; // itens avulsos na página — bloco híbrido abaixo detecta
          log('Pág. sem novos grupos — buscando próxima...', 'warn');
        }
        if (_addedGrps) continue; // volta ao topo do while para processar novos grupos
      }

      // Processo misto/híbrido: após TODOS os grupos (todas as páginas), procura itens avulsos
      if (!isItemByItemFlow && gi === originalGruposLen && gi === grupos.length) {
        var mixDetBtns = getItemDetBtns();

        // Tenta clicar aba "Itens" se não há det-btns na página atual
        if (!mixDetBtns.length) {
          var itensTabH = [...document.querySelectorAll('button,[role=tab],mat-tab-label,a')].find(function(b){
            if (!b.offsetWidth) return false;
            var t = (b.textContent || '').trim();
            return /^itens$/i.test(t);
          });
          if (itensTabH) {
            log('Processo híbrido: abrindo aba Itens...', 'ok');
            itensTabH.click();
            await wait(700);
            try { await poll(function(){ return getItemDetBtns().length > 0; }, 150, 8000); } catch(e) {}
            await wait(300);
            mixDetBtns = getItemDetBtns();
          }
        }

        if (mixDetBtns.length) {
          log('Processo misto: ' + mixDetBtns.length + ' item(ns) avulso(s)');
          nBtns = mixDetBtns.length;
          var _fMix = window.__cnet_filter__;
          for (var mii = 0; mii < mixDetBtns.length; mii++) {
            var mNum = totalBase + mii + 1;
            if (_fMix && _fMix.itemNums && !_fMix.itemNums.has(mNum)) continue;
            grupos.push({ num: mNum, el: document.body, _idx: mii });
          }
          totalBase += mixDetBtns.length;
          isItemByItemFlow = grupos.length > originalGruposLen;
          if (isItemByItemFlow) isHybridFlow = true;
        }
      }

      // Paginação — SEMPRE verifica (mesmo quando item foi deserto ou sem CNPJs)
      // Híbrido (grupos + itens avulsos): aba Itens não tem paginação própria — nunca pagina
      if (isItemByItemFlow && !isHybridFlow && gi === grupos.length) {
        var nxtPg = getNextPageBtn();
        if (nxtPg) {
          log('→ próxima página (' + gi + ' itens processados)');
          // Salva referência do primeiro botão ANTES de clicar — para detectar mudança real de página
          var _oldDetBtns = getItemDetBtns();
          var _firstOldBtn = _oldDetBtns[0] || null;
          var _oldCount = _oldDetBtns.length;
          nxtPg.click();
          await wait(700);
          // Espera Angular destruir os botões antigos (sinal de que a nova página carregou)
          try {
            await poll(function() {
              if (_firstOldBtn && document.body.contains(_firstOldBtn)) return false;
              return getItemDetBtns().length > 0;
            }, 150, 10000);
          } catch(e) {
            // Fallback: aguarda DOM estabilizar
            await waitDOMStable(500, 6000);
          }
          await wait(250);
          var pgDetBtns = getItemDetBtns();
          if (pgDetBtns.length) {
            currentPage++;
            nBtns = pgDetBtns.length;
            log('Nova página ' + currentPage + ': ' + pgDetBtns.length + ' item(ns)');
            var _fPg = window.__cnet_filter__;
            var addedPg = 0;
            for (var pgii = 0; pgii < pgDetBtns.length; pgii++) {
              var pgINum = totalBase + pgii + 1;
              if (_fPg && _fPg.itemNums && !_fPg.itemNums.has(pgINum)) continue;
              grupos.push({ num: pgINum, el: document.body, _idx: pgii });
              addedPg++;
            }
            totalBase += pgDetBtns.length;
            if (!addedPg) log('Filtro: nenhum item desta página no filtro — encerrando');
          }
        }
      }
    } // fim while gi

    // Deduplicar linhas (previne duplicatas do fluxo híbrido — primeiro item avulso após grupos)
    var _seen = new Set();
    sheetRows = sheetRows.filter(function(r) {
      var k = String(r[3]) + '|' + String(r[4]) + '|' + String(r[5]) + '|' + String(r[6]);
      if (_seen.has(k)) { log('Dedup: linha duplicada removida item=' + r[4] + ' cnpj=' + r[6], 'warn'); return false; }
      _seen.add(k);
      return true;
    });

    // Envia para Sheets (opcional)
    if (cfg.scriptUrl) {
      log('Enviando ' + sheetRows.length + ' linha(s) para Sheets...');
      var ok = await postToSheets(cfg.scriptUrl, num + '-' + ano, sheetRows);
      log('Sheets: ' + (ok ? 'OK' : 'ERRO'), ok ? 'ok' : 'err');
    }

    // Envia para Supabase (dashboard) — tabela escolhida pelo UASG
    log('Enviando para Supabase (' + UASG + ')...');
    var okSupa = await postToSupabase(num + '-' + ano, sheetRows, UASG);
    log('Supabase: ' + (okSupa ? 'OK' : 'ERRO'), okSupa ? 'ok' : 'err');

    // Volta para busca usando history.back() (sem recarregar)
    await goSearch();
    await wait(1500);
  }

  var SCRIPT_CODE = 'function doPost(e) {\n  if (!e || !e.postData) return ContentService.createTextOutput("no data");\n  var data = JSON.parse(e.postData.contents);\n  var ss = SpreadsheetApp.getActiveSpreadsheet();\n  var sh = ss.getSheetByName(data.aba) || ss.insertSheet(data.aba);\n  if (data.clear) sh.clearContents();\n  if (data.moveFirst) { ss.setActiveSheet(sh); ss.moveActiveSheet(1); }\n  if (sh.getLastRow() === 0) sh.appendRow(data.headers);\n  data.rows.forEach(function(r) { sh.appendRow(r); });\n  return ContentService.createTextOutput("ok");\n}';

  // ── PNCP ─────────────────────────────────────────────────────────────────
  var PNCP_HEADERS = [
    'Nº Bot','Processo','Ano','UASG','Modalidade','SRP',
    'Objeto','Data Publicação','Data Abertura','Data Encerramento',
    'Valor Estimado','Valor Homologado','Situação','Processo Admin'
  ];
  var PNCP_MODS    = [1,2,3,4,5,6,7,12,20,22,33,44,57];

  async function fetchPNCP(uasg, ano, mod, pg) {
    var url = 'https://processoscae.vercel.app/api/pncp?uasg=' + uasg
            + '&ano=' + ano + '&mod=' + mod + '&pg=' + pg;
    try {
      var r = await fetch(url);
      if (!r.ok) {
        if (pg === 1) log('PNCP mod=' + mod + ' HTTP ' + r.status, 'warn');
        return null;
      }
      return await r.json();
    } catch(e) {
      if (pg === 1) log('PNCP mod=' + mod + ' erro: ' + e.message, 'err');
      return null;
    }
  }

  async function syncPNCP(uasg, anos, cfg) {
    var seen = new Set(), allRows = [];

    for (var ano of anos) {
      log('PNCP ' + ano + ' — buscando...');
      var countAno = 0;
      for (var mod of PNCP_MODS) {
        var pg = 1;
        while (true) {
          var data = await fetchPNCP(uasg, ano, mod, pg);
          if (!data) break;
          var items = Array.isArray(data.resultado) ? data.resultado : [];
          for (var r of items) {
            var num  = String(r.numeroCompra || r.numeroCompraPncp || '').trim();
            var anoC = String(r.anoCompraPncp || r.anoCompra || ano).trim();
            if (!num) continue;
            var key = num + '/' + anoC;
            if (seen.has(key)) continue;
            seen.add(key);
            var srpRaw = r.srp != null ? r.srp : (r.registroPrecos != null ? r.registroPrecos : null);
            var srp    = srpRaw === true || srpRaw === 'true' || srpRaw === 1 ? 'Sim'
                       : srpRaw === false || srpRaw === 'false' || srpRaw === 0 ? 'Não' : '';
            allRows.push([
              num.padStart(5, '0') + anoC,   // Nº Bot — sempre 9 dígitos (5 num + 4 ano)
              num, anoC, uasg,
              r.modalidadeNome || r.modalidadeNomePncp || '',
              srp,
              (r.objetoCompra || r.objeto || '').slice(0, 200),
              (r.dataPublicacaoPncp || '').slice(0, 10),
              (r.dataAberturaPropostaPncp || r.dataAberturaProposta || '').slice(0, 10),
              (r.dataEncerramentoPropostaPncp || '').slice(0, 10),
              r.valorTotalEstimado   || r.valorEstimadoTotal   || '',
              r.valorTotalHomologado || r.valorHomologadoTotal || '',
              r.situacaoCompraNomePncp || r.situacaoCompra || '',
              r.processo || ''
            ]);
            countAno++;
          }
          if (!items.length) break;
          var totalPag = data.totalPaginas || 0;
          if (totalPag && pg >= totalPag) break;
          if (!totalPag && data.paginasRestantes === 0) break;
          pg++;
          await wait(100);
        }
      }
      log('PNCP ' + ano + ': ' + countAno + ' processo(s)');
    }

    if (!allRows.length) { log('PNCP: nenhum processo encontrado', 'warn'); return []; }

    var abaName = 'PNCP-' + uasg;
    if (cfg.scriptUrl) {
      log('Salvando ' + allRows.length + ' linha(s) na aba ' + abaName + '...');
      try {
        await fetch(cfg.scriptUrl, {
          method: 'POST', mode: 'no-cors',
          body: JSON.stringify({ aba: abaName, headers: PNCP_HEADERS, rows: allRows, clear: true, moveFirst: true })
        });
        log('Salvo: ' + allRows.length + ' processo(s)', 'ok');
      } catch(e) { log('ERRO Sheets: ' + e.message, 'err'); }
    } else {
      log('Sheets não configurado — apenas Supabase.', 'warn');
    }

    // r[0] = "Nº Bot" = num+ano pronto para o scraper
    return allRows.map(function(r) { return r[0]; });
  }

  function showGuia(body, onBack) {
    body.innerHTML = '';
    body.style.padding = '10px';

    var steps = [
      '1. Abra a planilha Google Sheets desejada',
      '2. Menu: Extensões → Apps Script',
      '3. Apague o código existente e cole o código abaixo',
      '4. Salve (Ctrl+S)',
      '5. Clique em "Implantar" → "Nova implantação"',
      '6. Tipo: App da Web | Executar como: Eu | Acesso: Qualquer pessoa',
      '7. Clique em "Implantar" e copie a URL gerada (termina em /exec)',
      '8. Cole a URL no campo "Apps Script URL" do bot'
    ];

    steps.forEach(function(s) {
      var p = document.createElement('p');
      p.textContent = s;
      p.style.cssText = 'margin:4px 0;font-size:11px;color:#cbd5e1;line-height:1.4';
      body.appendChild(p);
    });

    var codeBox = document.createElement('pre');
    codeBox.textContent = SCRIPT_CODE;
    codeBox.style.cssText = 'background:#0f172a;border:1px solid #334155;border-radius:6px;padding:6px;font-size:9px;color:#7dd3fc;overflow-x:auto;white-space:pre-wrap;margin:8px 0;cursor:pointer';
    codeBox.title = 'Clique para copiar';
    codeBox.onclick = function() {
      navigator.clipboard.writeText(SCRIPT_CODE).then(function() {
        codeBox.style.borderColor = '#22c55e';
        setTimeout(function(){ codeBox.style.borderColor = '#334155'; }, 1500);
      });
    };
    body.appendChild(codeBox);

    var hint = document.createElement('p');
    hint.textContent = '↑ Clique no código para copiar';
    hint.style.cssText = 'font-size:10px;color:#64748b;margin:0 0 8px';
    body.appendChild(hint);

    var back = document.createElement('button');
    back.textContent = '← Já tenho a URL';
    back.style.cssText = 'width:100%;padding:6px;background:#1e293b;color:#60a5fa;border:1px solid #334155;border-radius:6px;cursor:pointer;font-size:12px';
    back.onclick = onBack;
    body.appendChild(back);
  }

  function showForm(onSubmit, skipGuia) {
    var ov = getOV();
    var cfg = loadCfg();
    var body = ov.querySelector('#__cl');
    body.style.padding = '10px';
    body.innerHTML = '';

    function mkField(label, id, val, placeholder, isArea) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:8px';
      var lb = document.createElement('label');
      lb.textContent = label;
      lb.style.cssText = 'display:block;font-size:11px;color:#94a3b8;margin-bottom:2px';
      var inp = document.createElement(isArea ? 'textarea' : 'input');
      inp.id = id;
      inp.value = val || '';
      if (placeholder) inp.placeholder = placeholder;
      inp.style.cssText = 'width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:12px;padding:5px 7px;' + (isArea ? 'height:55px;resize:vertical' : '');
      wrap.appendChild(lb); wrap.appendChild(inp);
      return wrap;
    }

    function mkSelect(label, id, val, options) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:8px';
      var lb = document.createElement('label');
      lb.textContent = label;
      lb.style.cssText = 'display:block;font-size:11px;color:#94a3b8;margin-bottom:2px';
      var sel = document.createElement('select');
      sel.id = id;
      sel.style.cssText = 'width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:12px;padding:5px 7px';
      options.forEach(function(o) {
        var opt = document.createElement('option');
        opt.value = o.v; opt.textContent = o.l;
        if (o.v === val) opt.selected = true;
        sel.appendChild(opt);
      });
      wrap.appendChild(lb); wrap.appendChild(sel);
      return wrap;
    }

    var MODS = [
      { v: '', l: 'Todas as modalidades' },
      { v: 'Pregão Eletrônico', l: 'Pregão Eletrônico' },
      { v: 'Dispensa Eletrônica', l: 'Dispensa Eletrônica' },
      { v: 'Concorrência Eletrônica', l: 'Concorrência Eletrônica' },
      { v: 'Credenciamento', l: 'Credenciamento' },
      { v: 'Diálogo Competitivo', l: 'Diálogo Competitivo' }
    ];

    body.appendChild(mkField('UASG', 'f_uasg', cfg.uasg || '120630', '120630'));
    body.appendChild(mkField('Apps Script URL (opcional)', 'f_url', cfg.scriptUrl || '', 'Opcional'));
    body.appendChild(mkField('Anos PNCP', 'f_anos', cfg.anos || String(new Date().getFullYear()), '2025,2026'));
    body.appendChild(mkSelect('Modalidade', 'f_mod', cfg.modalidade || '', MODS));
    body.appendChild(mkField('Processos (um por linha)', 'f_proc', '', '900602025\n900302025', true));

    var dicaProc = document.createElement('div');
    dicaProc.style.cssText = 'font-size:10px;color:#64748b;line-height:1.5;margin-top:-6px;margin-bottom:4px;padding:5px 7px;background:#1e293b;border-radius:4px;border:1px solid #334155';
    dicaProc.innerHTML = '⚡ <b style="color:#94a3b8">Recomendado:</b> processe até <b style="color:#e2e8f0">10 processos</b> por sessão para garantir estabilidade. Para lotes maiores, divida em grupos de 10.';
    body.appendChild(dicaProc);

    var guiaLink = document.createElement('button');
    guiaLink.textContent = '? Como obter a URL do Apps Script';
    guiaLink.style.cssText = 'width:100%;padding:5px;background:none;color:#64748b;border:none;cursor:pointer;font-size:11px;text-align:left;margin-bottom:6px;text-decoration:underline';
    guiaLink.onclick = function() { showGuia(body, function() { showForm(onSubmit, true); }); };
    body.appendChild(guiaLink);

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px';

    var btnExec = document.createElement('button');
    btnExec.textContent = '▶ Executar';
    btnExec.style.cssText = 'flex:1;padding:7px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600';
    btnExec.onclick = function () {
      var c = {
        uasg:      ov.querySelector('#f_uasg').value.trim() || '120630',
        scriptUrl: ov.querySelector('#f_url').value.trim(),
        anos:      ov.querySelector('#f_anos').value.trim() || String(new Date().getFullYear()),
        modalidade: ov.querySelector('#f_mod').value,
        processos: ov.querySelector('#f_proc').value
      };
      saveCfg({ uasg: c.uasg, scriptUrl: c.scriptUrl, anos: c.anos, modalidade: c.modalidade });
      body.innerHTML = '';
      body.style.padding = '';
      onSubmit(c);
    };
    btnRow.appendChild(btnExec);

    var btnPncp = document.createElement('button');
    btnPncp.textContent = '⟳ PNCP';
    btnPncp.style.cssText = 'flex:1;padding:7px;background:#0f766e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600';
    btnPncp.onclick = async function () {
      var uasg    = ov.querySelector('#f_uasg').value.trim() || '120630';
      var url     = ov.querySelector('#f_url').value.trim();
      var anosStr = ov.querySelector('#f_anos').value.trim() || String(new Date().getFullYear());
      var anos = anosStr.split(/[,;\s]+/).map(function(s){ return parseInt(s.trim(), 10); }).filter(function(n){ return !isNaN(n) && n > 2000; });
      if (!anos.length) anos = [new Date().getFullYear()];
      UASG = uasg;
      saveCfg({ uasg: uasg, scriptUrl: url, anos: anosStr });
      body.innerHTML = '';
      body.style.padding = '';
      var processos = await syncPNCP(uasg, anos, { scriptUrl: url });
      if (processos.length) {
        var dica = document.createElement('div');
        dica.style.cssText = 'margin-top:10px;padding:8px;background:#1e293b;border:1px solid #334155;border-radius:6px;font-size:11px;color:#94a3b8;line-height:1.6';
        dica.innerHTML = '<span style="color:#4ade80;font-weight:600">✓ ' + processos.length + ' processo(s) na aba PNCP-' + uasg + '</span><br>'
          + 'Copie os números da coluna <b style="color:#e2e8f0">Nº Bot</b> e cole no campo "Processos" para pesquisar no CNET.';
        var btnTodos = document.createElement('button');
        btnTodos.textContent = '▶ Pesquisar todos no CNET';
        btnTodos.style.cssText = 'width:100%;padding:6px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;margin-top:6px';
        btnTodos.onclick = function() {
          var logDiv = ov.querySelector('#__cl');
          logDiv.innerHTML = '';
          logDiv.style.padding = '';
          onSubmit({ uasg: uasg, scriptUrl: url, anos: anosStr, processos: processos.join('\n') });
        };
        var logDiv = ov.querySelector('#__cl');
        logDiv.appendChild(dica);
        logDiv.appendChild(btnTodos);
      }
    };
    btnRow.appendChild(btnPncp);
    body.appendChild(btnRow);

    // Apps Script URL é opcional — guia só abre se o usuário clicar manualmente
  }

  function showFilterPanel(onStart) {
    var ov = getOV();
    var body = ov.querySelector('#__cl');
    body.innerHTML = '';
    body.style.padding = '10px';

    var ttl = document.createElement('div');
    ttl.textContent = '⚙ Filtros (opcional)';
    ttl.style.cssText = 'font-weight:600;color:#60a5fa;margin-bottom:8px;font-size:12px';
    body.appendChild(ttl);

    // Checkbox não homologados
    var cbRow = document.createElement('label');
    cbRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px;cursor:pointer;font-size:12px;color:#e2e8f0';
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = '__f_nh__';
    cb.style.cssText = 'cursor:pointer;width:14px;height:14px;accent-color:#3b82f6';
    cbRow.appendChild(cb);
    cbRow.appendChild(document.createTextNode('Apenas não homologados'));
    body.appendChild(cbRow);

    function mkFilt(label, id, ph) {
      var w = document.createElement('div'); w.style.cssText = 'margin-bottom:8px';
      var lb = document.createElement('label'); lb.textContent = label; lb.htmlFor = id;
      lb.style.cssText = 'display:block;font-size:10px;color:#94a3b8;margin-bottom:2px';
      var inp = document.createElement('input'); inp.id = id; inp.placeholder = ph;
      inp.style.cssText = 'width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;border-radius:5px;color:#e2e8f0;font-size:11px;padding:4px 6px';
      w.appendChild(lb); w.appendChild(inp); return w;
    }
    body.appendChild(mkFilt('Itens (item-a-item) — ex: 1-19 ou 1,12,78 (vazio = todos)', '__f_itens__', '1-19 ou 1,12,78'));
    body.appendChild(mkFilt('Grupos — ex: 2 ou 1,3-5 (vazio = todos)', '__f_grupos__', '2'));
    body.appendChild(mkFilt('Itens do grupo — ex: 1,5,7 (vazio = todos)', '__f_gitens__', '1,5,7'));

    var btn = document.createElement('button');
    btn.textContent = '▶ Iniciar Leitura';
    btn.style.cssText = 'width:100%;padding:8px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;margin-top:4px';
    btn.onclick = function() {
      window.__cnet_filter__ = {
        onlyNonHomologated: document.getElementById('__f_nh__').checked,
        itemNums:      parseNumFilter(document.getElementById('__f_itens__').value),
        groupNums:     parseNumFilter(document.getElementById('__f_grupos__').value),
        groupItemNums: parseNumFilter(document.getElementById('__f_gitens__').value)
      };
      var f = window.__cnet_filter__;
      var summary = [];
      if (f.onlyNonHomologated)  summary.push('não homologados');
      if (f.itemNums)            summary.push('itens: ' + [...f.itemNums].slice(0,5).join(',') + (f.itemNums.size > 5 ? '...' : ''));
      if (f.groupNums)           summary.push('grupos: ' + [...f.groupNums].join(','));
      if (f.groupItemNums)       summary.push('itens/grupo: ' + [...f.groupItemNums].join(','));
      body.innerHTML = ''; body.style.padding = '';
      if (summary.length) log('Filtros ativos: ' + summary.join(' | '), 'ok');
      onStart();
    };
    body.appendChild(btn);
  }

  async function main() {
    getOV();
    pedirPermissaoNotif();
    showForm(async function(cfg) {
      UASG = cfg.uasg;
      var lista = cfg.processos.split(/[\n,;]+/).map(function(s){ return s.trim(); }).filter(Boolean).map(parse).filter(Boolean);
      if (!lista.length) { log('Nenhum processo valido', 'err'); return; }
      log('UASG: ' + UASG + ' | ' + lista.length + ' processo(s): ' + lista.map(function(p){ return p.num+'/'+p.ano; }).join(', '));
      log('💡 Pode usar outras abas — o robô continua rodando em segundo plano.', 'ok');
      window.__cnet_filter__ = { onlyNonHomologated: false, itemNums: null, groupNums: null, groupItemNums: null };
      (async function() {
        expandOV(lista.length);
        startTimer();
        setProgress(0, lista.length, 'Iniciando…', '');
        var erros = 0;
        for (var i = 0; i < lista.length; i++) {
          var p = lista[i];
          setTabProgress((i+1) + '/' + lista.length + ' — ' + p.num + '/' + p.ano);
          setProgress(i, lista.length, 'Processo ' + p.num + '/' + p.ano, '');
          try { await processOne(p, cfg); } catch (e) { log('ERRO: ' + e.message, 'err'); console.error(e); erros++; }
          setProgress(i + 1, lista.length, 'Processo ' + p.num + '/' + p.ano, 'ok');
          if (i < lista.length - 1) await wait(800);
        }
        var resumo = lista.length + ' processo(s) concluído(s)' + (erros ? ' — ' + erros + ' com erro' : ' sem erros');
        stopTimer();
        collapseOV();
        log('✅ ' + resumo + '. Pode fechar esta janela.', 'ok');
        notifyDone(resumo);
      })();
    });
  }

  main();
})();
