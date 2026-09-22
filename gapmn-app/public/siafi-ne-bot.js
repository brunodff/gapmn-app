/*!
 * SIAFI NE Bot — GAPMN v1.0
 * Navega o CONNE, captura PDFs das NEs assinadas e faz upload para o GAPMN.
 *
 * Pré-requisito: usuário já logado no SIAFI manualmente.
 * Na 1ª execução: informe e-mail + senha do GAPMN para autorizar uploads.
 *
 * Bookmarklet:
 *   javascript:(function(){var s=document.createElement('script');s.src='https://gapmn.app/siafi-ne-bot.js?_='+Date.now();document.head.appendChild(s);})();
 */
(async function SIAFINEBot () {
  'use strict';

  // ── Constantes ──────────────────────────────────────────────────────────────
  var VERSION        = '1.0.0';
  var SUPA_URL       = 'https://fychrtyyqbzlfbzbvzqp.supabase.co';
  var SUPA_KEY       = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';
  var LSKEY          = 'siafi_ne_bot_cfg';
  var DATA_CORTE_PAD = '2026-06-15';

  // ── Config ──────────────────────────────────────────────────────────────────
  function loadCfg () { try { return JSON.parse(localStorage.getItem(LSKEY) || '{}'); } catch (e) { return {}; } }
  function saveCfg (c) { try { localStorage.setItem(LSKEY, JSON.stringify(c)); } catch (e) {} }
  var cfg = loadCfg();

  // ── UI ──────────────────────────────────────────────────────────────────────
  var OV = null, logEl = null;

  function buildUI () {
    var existing = document.getElementById('__siafi_ne_bot__');
    if (existing) existing.remove();

    OV = document.createElement('div');
    OV.id = '__siafi_ne_bot__';
    OV.style.cssText = [
      'position:fixed','bottom:16px','right:16px','width:340px',
      'max-height:480px','display:flex','flex-direction:column',
      'background:#0f172a','color:#e2e8f0',
      'border:1px solid #334155','border-radius:12px',
      'font:13px/1.5 system-ui,sans-serif',
      'z-index:2147483647','box-shadow:0 8px 32px rgba(0,0,0,.75)'
    ].join(';');

    var hd = document.createElement('div');
    hd.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-bottom:1px solid #1e293b;flex-shrink:0';

    var ttl = document.createElement('span');
    ttl.style.cssText = 'font-weight:600;color:#60a5fa;font-size:14px';
    ttl.innerHTML = 'SIAFI NE Bot&nbsp;<span style="font-size:11px;font-weight:400;color:#64748b">v' + VERSION + '</span>';

    var closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:none;border:none;color:#64748b;cursor:pointer;font-size:20px;line-height:1;padding:0';
    closeBtn.textContent = '×';
    closeBtn.onclick = function () { OV.remove(); OV = null; };
    hd.appendChild(ttl);
    hd.appendChild(closeBtn);

    logEl = document.createElement('div');
    logEl.style.cssText = 'overflow-y:auto;padding:6px 10px;flex:1;min-height:120px;max-height:260px';

    var ft = document.createElement('div');
    ft.id = '__snb_ft__';
    ft.style.cssText = 'padding:8px 10px;border-top:1px solid #1e293b;flex-shrink:0;display:flex;gap:6px;flex-wrap:wrap';

    OV.appendChild(hd);
    OV.appendChild(logEl);
    OV.appendChild(ft);
    document.body.appendChild(OV);
  }

  var COLORS = { ok: '#4ade80', err: '#f87171', warn: '#fbbf24', info: '#94a3b8', hi: '#60a5fa' };
  function log (msg, type) {
    if (!logEl) return;
    var d = document.createElement('div');
    d.style.cssText = 'font-size:12px;margin-bottom:2px;color:' + (COLORS[type] || '#e2e8f0');
    d.textContent = msg;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
    console.log('[SIAFI NE Bot]', msg);
  }

  function setFooter (btns) {
    var ft = document.getElementById('__snb_ft__');
    if (!ft) return;
    ft.innerHTML = '';
    btns.forEach(function (b) {
      var btn = document.createElement('button');
      btn.style.cssText = 'padding:5px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;' + (b.style || 'background:#1e40af;color:#fff');
      btn.textContent = b.label;
      if (b.id) btn.id = b.id;
      btn.onclick = b.onclick;
      ft.appendChild(btn);
    });
  }

  // ── Supabase ────────────────────────────────────────────────────────────────
  var _token = cfg.token || '';

  async function supaSignIn (email, pass) {
    var r = await fetch(SUPA_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: pass })
    });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.msg || 'Login falhou');
    return d.access_token;
  }

  async function fetchPendingNEs () {
    var corte = cfg.dataCorte || DATA_CORTE_PAD;
    var r = await fetch(
      SUPA_URL + '/rest/v1/solicitacoes_empenho' +
      '?select=id,numero,ne_siafi,email,responsavel,pag,fornecedor,valor,nd,pregao,subprocesso,obs_atraso,pdf_ne_url' +
      '&status=eq.ASSINADA' +
      '&notificado_assinada_em=is.null' +
      '&ne_siafi=not.is.null' +
      '&revisado_em=is.null' +
      '&updated_at=gte.' + encodeURIComponent(corte) +
      '&order=ne_siafi.asc',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, Accept: 'application/json' } }
    );
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // Busca as últimas 10 NEs assinadas (sem filtros de já-processadas) — modo teste
  async function fetchUltimas10NEs () {
    var r = await fetch(
      SUPA_URL + '/rest/v1/solicitacoes_empenho' +
      '?select=id,numero,ne_siafi,email,responsavel,pag,fornecedor,valor,nd,pregao,subprocesso,obs_atraso,pdf_ne_url' +
      '&status=eq.ASSINADA' +
      '&ne_siafi=not.is.null' +
      '&order=updated_at.desc' +
      '&limit=10',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + (_token || SUPA_KEY), Accept: 'application/json' } }
    );
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function uploadPDF (ne, pdfBlob) {
    var path = ne.numero + '/' + Date.now() + '_ne_assinada.pdf';
    var upR = await fetch(SUPA_URL + '/storage/v1/object/empenhos-pdf/' + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + _token,
        apikey: SUPA_KEY,
        'Content-Type': 'application/pdf',
        'x-upsert': 'true'
      },
      body: pdfBlob
    });
    if (!upR.ok) {
      var txt = await upR.text();
      throw new Error('Storage ' + upR.status + ': ' + txt.slice(0, 80));
    }
    var publicUrl = SUPA_URL + '/storage/v1/object/public/empenhos-pdf/' + path;
    var pR = await fetch(SUPA_URL + '/rest/v1/solicitacoes_empenho?id=eq.' + ne.id, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + _token,
        apikey: SUPA_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ pdf_ne_url: publicUrl, updated_at: new Date().toISOString() })
    });
    if (!pR.ok) throw new Error('DB PATCH ' + pR.status);
    return publicUrl;
  }

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  // SIAFI pode usar frames — busca o documento com o form de NE
  function getMainDoc () {
    var frames = document.querySelectorAll('frame, iframe');
    for (var i = 0; i < frames.length; i++) {
      try {
        var fd = frames[i].contentDocument;
        if (!fd) continue;
        var t = (fd.title || '').toLowerCase();
        var b = (fd.body && fd.body.textContent || '').toLowerCase();
        if (t.includes('empenho') || t.includes('conne') || b.includes('nota de empenho') ||
            fd.querySelector('input[id*="umero"]') || fd.querySelector('input[name*="umero"]')) {
          return fd;
        }
      } catch (e) {}
    }
    return document;
  }

  function findByText (ctx, selector, text) {
    var els = ctx.querySelectorAll(selector);
    var lc = text.toLowerCase();
    for (var i = 0; i < els.length; i++) {
      var v = (els[i].value || els[i].textContent || '').toLowerCase();
      if (v.includes(lc)) return els[i];
    }
    return null;
  }

  function findBtn (ctx, label) {
    return (
      ctx.querySelector('input[value="' + label + '"]') ||
      ctx.querySelector('input[value*="' + label + '"]') ||
      findByText(ctx, 'input[type="submit"],input[type="button"]', label) ||
      findByText(ctx, 'button', label) ||
      findByText(ctx, 'a', label)
    );
  }

  function fillInput (el, val) {
    try {
      var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (s && s.set) s.set.call(el, val);
    } catch (e) {}
    el.value = val;
    ['input', 'change', 'blur'].forEach(function (ev) {
      el.dispatchEvent(new Event(ev, { bubbles: true }));
    });
  }

  function click (el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
    if (el.tagName === 'INPUT' || el.tagName === 'BUTTON') el.click();
  }

  function sleep (ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Extrai dígitos significativos: "2026NE000123" → "123", "2026NE012345" → "12345"
  function extractNEDigits (neSiafi) {
    var m = String(neSiafi || '').match(/NE(\d+)$/i);
    return m ? String(parseInt(m[1], 10)) : '';
  }

  // ── Detecção da página CONNE ────────────────────────────────────────────────

  function isConnePage (ctx) {
    ctx = ctx || document;
    var t = (ctx.title || '').toLowerCase();
    var b = (ctx.body && ctx.body.textContent || '').slice(0, 500).toLowerCase();
    return t.includes('conne') || t.includes('nota de empenho') ||
           b.includes('consultar nota de empenho') || b.includes('conne');
  }

  // Busca input de navegação em todos os frames (SIAFI usa frameset)
  function findNavInput () {
    var selectors = [
      'input[name*="transacao"]', 'input[id*="transacao"]',
      'input[id*="PesqNav"]',     'input[id*="pesqNav"]',
      'input[id*="navegacao"]',   'input[placeholder*="ransaç"]',
      'input[placeholder*="ransac"]'
    ];
    function tryDoc (d, depth) {
      if (!d || depth > 4) return null;
      for (var si = 0; si < selectors.length; si++) {
        try { var el = d.querySelector(selectors[si]); if (el) return el; } catch (e) {}
      }
      var frames = d.querySelectorAll('frame, iframe');
      for (var fi = 0; fi < frames.length; fi++) {
        try { var found = tryDoc(frames[fi].contentDocument, depth + 1); if (found) return found; } catch (e) {}
      }
      return null;
    }
    return tryDoc(document, 0);
  }

  async function navigateToCONNE () {
    if (isConnePage(getMainDoc())) { log('Já na página CONNE.', 'ok'); return true; }

    var navInput = findNavInput();

    if (!navInput) {
      log('⚠ Campo de navegação não encontrado.', 'warn');
      log('Navegue manualmente até CONNE e execute novamente.', 'warn');
      return false;
    }

    log('Navegando para CONNE…', 'info');
    fillInput(navInput, 'CONNE');
    ['keydown', 'keypress', 'keyup'].forEach(function (ev) {
      navInput.dispatchEvent(new KeyboardEvent(ev, { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    });

    var form = navInput.closest('form');
    if (form) {
      try { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } catch (e) {}
      try { HTMLFormElement.prototype.__snb_origSubmit__
              ? HTMLFormElement.prototype.__snb_origSubmit__.call(form)
              : HTMLFormElement.prototype.submit.call(form);
      } catch (e) {}
    }

    // Aguarda CONNE carregar (poll até 10s)
    for (var wi = 0; wi < 20; wi++) {
      await sleep(500);
      if (isConnePage(getMainDoc())) { log('CONNE carregado.', 'ok'); return true; }
    }

    log('⚠ Não foi possível navegar automaticamente.', 'warn');
    log('Vá até CONNE manualmente e execute o bot novamente.', 'warn');
    return false;
  }

  // ── Interceptação do PDF ─────────────────────────────────────────────────────

  var _captured = null;
  var _intercepting = false;

  function startIntercept () {
    _captured = null;
    _intercepting = true;

    // Estratégia 1 — window.open (PDF em popup/nova aba)
    window.__snb_origOpen__ = window.open;
    window.open = function (url, name, feat) {
      if (!_intercepting) return window.__snb_origOpen__.apply(window, arguments);
      var u = String(url || '');
      if (u && (u.includes('pdf') || u.includes('imprimir') || u.includes('relatorio') || u.includes('print') || u.includes('report'))) {
        log('  PDF detectado via popup: ' + u.slice(-50), 'info');
        fetch(u, { credentials: 'include' })
          .then(function (r) { return r.blob(); })
          .then(function (b) {
            if (b.size > 1000) { _captured = b; log('  PDF capturado (' + Math.round(b.size / 1024) + ' KB).', 'ok'); }
          })
          .catch(function (e) { log('  Fetch popup falhou: ' + e.message, 'warn'); });
        return { closed: false, close: function () {}, focus: function () {}, location: { href: u } };
      }
      return window.__snb_origOpen__.apply(window, arguments);
    };

    // Estratégia 2 — form.submit() → resposta PDF
    HTMLFormElement.prototype.__snb_origSubmit__ = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      if (!_intercepting) { return this.__snb_origSubmit__(); }
      var form = this;
      var action = form.action || location.href;
      var method = (form.method || 'GET').toUpperCase();
      var fd = new FormData(form);
      fetch(action, { method: method, body: method === 'POST' ? fd : undefined, credentials: 'include' })
        .then(function (r) {
          var ct = r.headers.get('content-type') || '';
          if (ct.includes('pdf') || ct.includes('octet-stream')) {
            log('  PDF capturado via form POST.', 'ok');
            return r.blob().then(function (b) { if (b.size > 1000) _captured = b; });
          }
          // Não era PDF — submete normalmente
          form.__snb_origSubmit__();
        })
        .catch(function () { form.__snb_origSubmit__(); });
    };

    // Estratégia 3 — <a download> ou anchor com href de PDF
    document.__snb_origAnchorClick__ = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (_intercepting) {
        var href = this.href || '';
        var dl   = this.download || '';
        if (dl || href.includes('.pdf') || href.includes('imprimir')) {
          log('  PDF detectado via anchor download.', 'info');
          var self = this;
          fetch(href, { credentials: 'include' })
            .then(function (r) { return r.blob(); })
            .then(function (b) { if (b.size > 1000) _captured = b; })
            .catch(function () { document.__snb_origAnchorClick__.call(self); });
          return;
        }
      }
      document.__snb_origAnchorClick__.call(this);
    };
  }

  function stopIntercept () {
    _intercepting = false;
    if (window.__snb_origOpen__) { window.open = window.__snb_origOpen__; delete window.__snb_origOpen__; }
    if (HTMLFormElement.prototype.__snb_origSubmit__) {
      HTMLFormElement.prototype.submit = HTMLFormElement.prototype.__snb_origSubmit__;
      delete HTMLFormElement.prototype.__snb_origSubmit__;
    }
    if (document.__snb_origAnchorClick__) {
      HTMLAnchorElement.prototype.click = document.__snb_origAnchorClick__;
      delete document.__snb_origAnchorClick__;
    }
  }

  // ── Processamento de uma NE ─────────────────────────────────────────────────

  async function processNE (ne) {
    var digits = extractNEDigits(ne.ne_siafi);
    if (!digits) { log('  ⚠ Não extraiu número de: ' + ne.ne_siafi, 'warn'); return 'skip'; }

    var ctx = getMainDoc();

    // 1. Encontra o campo "Número"
    var numInput = (
      ctx.querySelector('input[id*="umero"]:not([type="hidden"])') ||
      ctx.querySelector('input[name*="umero"]:not([type="hidden"])') ||
      ctx.querySelector('input[id*="UMERO"]:not([type="hidden"])')
    );

    if (!numInput) {
      // Fallback: procura por label vizinho
      var lbls = ctx.querySelectorAll('label, td, th');
      for (var li = 0; li < lbls.length; li++) {
        if (/^n[úu]mero$/i.test(lbls[li].textContent.trim())) {
          var sib = lbls[li].nextElementSibling;
          var inp = sib && sib.querySelector ? (sib.querySelector('input') || (sib.tagName === 'INPUT' ? sib : null)) : null;
          if (inp) { numInput = inp; break; }
        }
      }
    }

    if (!numInput) { log('  ❌ Campo "Número" não encontrado.', 'err'); return 'fail'; }

    // Limpa e preenche
    fillInput(numInput, '');
    await sleep(200);
    fillInput(numInput, digits);
    await sleep(400);

    // 2. Clica em Pesquisar
    var pesqBtn = findBtn(ctx, 'Pesquisar');
    if (!pesqBtn) { log('  ❌ Botão "Pesquisar" não encontrado.', 'err'); return 'fail'; }

    click(pesqBtn);

    // Aguarda resultado: botão Imprimir OU mensagem de não encontrado (até 20s)
    var impBtn = null;
    for (var wi = 0; wi < 40; wi++) {
      await sleep(500);
      ctx = getMainDoc();
      var bodyTxt = (ctx.body && ctx.body.textContent || '').toLowerCase();
      if (bodyTxt.includes('nenhum registro') || bodyTxt.includes('não encontrado') || bodyTxt.includes('nao encontrado')) {
        log('  ⚠ NE não encontrada no SIAFI: ' + ne.ne_siafi, 'warn');
        return 'skip';
      }
      impBtn = findBtn(ctx, 'Imprimir');
      if (impBtn) break;
    }

    // 3. Ativa interceptação e clica Imprimir
    if (!impBtn) { log('  ❌ Botão "Imprimir" não apareceu (timeout 20s).', 'err'); return 'fail'; }

    startIntercept();
    click(impBtn);

    // Aguarda diálogo de confirmação aparecer (até 10s)
    var confBtn = null;
    for (var wj = 0; wj < 20; wj++) {
      await sleep(500);
      ctx = getMainDoc();
      confBtn = findBtn(ctx, 'Confirmar');
      if (confBtn) break;
    }

    // 4. Garante seleção "Completa" e clica Confirmar
    if (!confBtn) {
      stopIntercept();
      log('  ❌ Botão "Confirmar" não apareceu (timeout 10s).', 'err');
      return 'fail';
    }

    var radios = ctx.querySelectorAll('input[type="radio"]');
    for (var ri = 0; ri < radios.length; ri++) {
      var rv = (radios[ri].value || '').toLowerCase();
      var rl = (radios[ri].labels && radios[ri].labels[0] ? radios[ri].labels[0].textContent : '').toLowerCase();
      if (rv.includes('completa') || rl.includes('completa')) {
        if (!radios[ri].checked) {
          radios[ri].checked = true;
          radios[ri].dispatchEvent(new Event('change', { bubbles: true }));
        }
        break;
      }
    }
    if (!radios.length && ctx.querySelector('input[type="radio"]')) {
      ctx.querySelector('input[type="radio"]').checked = true;
    }

    click(confBtn);

    // 5. Aguarda captura do PDF (até 20s)
    // Se a página ficar presa em "aguarde" por mais de 5s sem PDF, desiste cedo
    var aguardeCount = 0;
    for (var w = 0; w < 40; w++) {
      await sleep(500);
      if (_captured) break;
      var wCtx = getMainDoc();
      var wTxt = (wCtx.body && wCtx.body.textContent || '').toLowerCase();
      if (wTxt.includes('aguarde') && !wTxt.includes('imprimir')) {
        aguardeCount++;
        if (aguardeCount >= 6) { // 3s em "aguarde" sem PDF → desiste
          log('  ⚠ SIAFI preso em "Aguarde" — NE pode não estar assinada.', 'warn');
          break;
        }
      } else {
        aguardeCount = 0;
      }
    }
    stopIntercept();

    var pdfOk = false;
    if (_captured && _captured.size > 1000) {
      try {
        await uploadPDF(ne, _captured);
        log('  ✓ PDF enviado ao GAPMN.', 'ok');
        pdfOk = true;
      } catch (e) {
        log('  ❌ Upload: ' + e.message, 'err');
      }
    } else {
      log('  ⚠ PDF não interceptado — NE pode estar pendente de ratificação.', 'warn');
    }

    // 6. Volta ao CONNE limpo para a próxima NE
    // Tenta Retornar → Filtros; se falhar vai direto pelo campo de navegação
    await sleep(800);
    if (!isConnePage(getMainDoc())) {
      ctx = getMainDoc();
      var retBtn = findBtn(ctx, 'Retornar');
      if (retBtn) { click(retBtn); await sleep(1500); ctx = getMainDoc(); }
      var filtBtn = findBtn(ctx, 'Filtros');
      if (filtBtn) { click(filtBtn); await sleep(1000); }
    }

    if (!isConnePage(getMainDoc())) {
      log('  ↻ Resetando para CONNE…', 'info');
      await navigateToCONNE();
    }

    return pdfOk ? 'ok' : 'partial';
  }

  // ── Autenticação GAPMN ──────────────────────────────────────────────────────

  async function ensureAuth () {
    // Valida token existente
    if (cfg.token) {
      try {
        var chk = await fetch(SUPA_URL + '/auth/v1/user', {
          headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + cfg.token }
        });
        if (chk.ok) { _token = cfg.token; log('✓ Sessão GAPMN ativa.', 'ok'); return true; }
      } catch (e) {}
      log('Sessão expirada. Entre novamente.', 'warn');
      cfg.token = '';
      saveCfg(cfg);
    }

    // Solicita credenciais
    return new Promise(function (resolve) {
      var authDiv = document.createElement('div');
      authDiv.style.cssText = 'padding:8px 10px;border-top:1px solid #1e293b;flex-shrink:0';

      function mk (type, placeholder, val) {
        var inp = document.createElement('input');
        inp.type = type; inp.placeholder = placeholder; inp.value = val || '';
        inp.style.cssText = 'width:100%;padding:5px 8px;margin-bottom:5px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;font-size:12px;box-sizing:border-box';
        return inp;
      }

      var emailInp = mk('email', 'E-mail GAPMN', cfg.email || '');
      var passInp  = mk('password', 'Senha GAPMN');

      var loginBtn = document.createElement('button');
      loginBtn.style.cssText = 'width:100%;padding:6px;background:#1d4ed8;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600';
      loginBtn.textContent = 'Entrar no GAPMN';

      async function doLogin () {
        loginBtn.disabled = true; loginBtn.textContent = 'Entrando…';
        try {
          _token = await supaSignIn(emailInp.value.trim(), passInp.value);
          cfg.token = _token; cfg.email = emailInp.value.trim(); saveCfg(cfg);
          authDiv.remove();
          log('✓ Login GAPMN OK.', 'ok');
          resolve(true);
        } catch (e) {
          log('❌ ' + e.message, 'err');
          loginBtn.disabled = false; loginBtn.textContent = 'Entrar no GAPMN';
        }
      }

      loginBtn.onclick = doLogin;
      passInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

      authDiv.appendChild(emailInp);
      authDiv.appendChild(passInp);
      authDiv.appendChild(loginBtn);
      var ft = document.getElementById('__snb_ft__');
      if (ft) OV.insertBefore(authDiv, ft); else OV.appendChild(authDiv);
      setTimeout(function () { emailInp.focus(); }, 100);
    });
  }

  // ── Modo teste: últimas 10 NEs assinadas ────────────────────────────────────

  async function executarTeste () {
    log('─── MODO TESTE ───', 'hi');
    log('Buscando últimas 10 NEs assinadas…', 'info');

    var lista;
    try { lista = await fetchUltimas10NEs(); } catch (e) {
      log('❌ Erro ao buscar NEs: ' + e.message, 'err'); return;
    }

    if (!lista.length) {
      log('Nenhuma NE com status=ASSINADA + ne_siafi encontrada.', 'warn');
      return;
    }

    log(lista.length + ' NE(s) encontrada(s):', 'ok');
    lista.forEach(function (ne) { log('  ' + ne.ne_siafi + (ne.pdf_ne_url ? ' ✓ PDF já existe' : ''), 'info'); });

    var connOk = await navigateToCONNE();
    if (!connOk) { log('❌ Navegue até CONNE manualmente e tente novamente.', 'err'); return; }

    setFooter([{
      label: '⏹ Parar',
      style: 'background:#991b1b;color:#fff;flex:1',
      onclick: function () { window.__snb_stop__ = true; log('Parando…', 'warn'); }
    }]);

    window.__snb_stop__ = false;
    var ok = 0, fail = 0;

    for (var i = 0; i < lista.length; i++) {
      if (window.__snb_stop__) { log('Parado.', 'warn'); break; }
      var ne = lista[i];
      log('[' + (i + 1) + '/' + lista.length + '] ' + ne.ne_siafi, 'hi');
      var res = await processNE(ne);
      if (res === 'ok') ok++;
      else fail++;
      // Garante CONNE limpo antes da próxima NE
      if (!isConnePage(getMainDoc())) { await navigateToCONNE(); }
      await sleep(1200);
    }

    log('─── Teste concluído ───', 'hi');
    if (ok)   log('✓ ' + ok + ' PDF(s) capturado(s) e enviado(s)', 'ok');
    if (fail) log('❌ ' + fail + ' falha(s)', 'err');

    setFooter([{ label: '✕ Fechar', onclick: function () { OV && OV.remove(); }, style: 'background:#1e293b;color:#94a3b8;flex:1' }]);
  }

  // ── Extrato 7 dias ──────────────────────────────────────────────────────────

  async function gerarExtrato7d () {
    var ate = new Date();
    var de  = new Date(ate.getTime() - 7 * 24 * 60 * 60 * 1000);
    var deStr = de.toISOString().slice(0, 10);

    log('Buscando NEs assinadas dos últimos 7 dias…', 'info');

    var r = await fetch(
      SUPA_URL + '/rest/v1/solicitacoes_empenho' +
      '?select=numero,ne_siafi,email,responsavel,fornecedor,valor,nd,pag,subprocesso,status,updated_at,pdf_ne_url,notificado_assinada_em,revisado_em' +
      '&status=eq.ASSINADA' +
      '&updated_at=gte.' + encodeURIComponent(deStr + 'T00:00:00') +
      '&order=updated_at.desc',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + _token, Accept: 'application/json' } }
    );

    if (!r.ok) { log('❌ Erro: HTTP ' + r.status, 'err'); return; }
    var data = await r.json();

    if (!data.length) { log('Nenhuma NE assinada nos últimos 7 dias.', 'warn'); return; }

    log(data.length + ' NE(s) encontrada(s). Abrindo relatório…', 'ok');

    var fmtDate = function (iso) {
      if (!iso) return '—';
      var d = new Date(iso);
      return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    var fmtVal = function (v) {
      if (v == null) return '—';
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v));
    };

    var rows = data.map(function (ne, i) {
      var temPdf    = ne.pdf_ne_url ? '✓ Sim' : '✗ Não';
      var temPdfCls = ne.pdf_ne_url ? 'color:#15803d;font-weight:600' : 'color:#dc2626';
      var notif     = ne.notificado_assinada_em ? '✓ ' + fmtDate(ne.notificado_assinada_em) : '—';
      var revisado  = ne.revisado_em ? '✓ ' + fmtDate(ne.revisado_em) : '—';
      var bg        = i % 2 === 0 ? '#ffffff' : '#f8fafc';
      return '<tr style="background:' + bg + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td style="font-family:monospace;font-weight:600;color:#1e40af">' + (ne.ne_siafi || '—') + '</td>' +
        '<td style="font-size:11px;color:#475569">' + (ne.numero || '—') + '</td>' +
        '<td>' + (ne.fornecedor || '—') + '</td>' +
        '<td style="text-align:right;font-family:monospace">' + fmtVal(ne.valor) + '</td>' +
        '<td style="font-family:monospace;font-size:11px">' + (ne.nd || '—') + '</td>' +
        '<td style="font-size:11px;color:#475569">' + (ne.pag || '—') + '</td>' +
        '<td style="font-size:11px">' + (ne.responsavel || '—') + '</td>' +
        '<td style="font-size:11px">' + (ne.email || '—') + '</td>' +
        '<td style="' + temPdfCls + '">' + temPdf + '</td>' +
        '<td style="font-size:11px;color:#475569">' + notif + '</td>' +
        '<td style="font-size:11px;color:#475569">' + revisado + '</td>' +
        '<td style="font-size:11px">' + fmtDate(ne.updated_at) + '</td>' +
        '</tr>';
    }).join('');

    var totalVal = data.reduce(function (s, ne) { return s + (Number(ne.valor) || 0); }, 0);
    var comPdf   = data.filter(function (ne) { return ne.pdf_ne_url; }).length;
    var semPdf   = data.length - comPdf;

    var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
      '<title>Extrato NEs Assinadas — Últimos 7 dias</title>' +
      '<style>' +
        'body{font-family:system-ui,sans-serif;margin:0;padding:20px;color:#0f172a;font-size:12px}' +
        'h1{font-size:16px;margin:0 0 2px;color:#1e3a5f}' +
        'p.sub{font-size:11px;color:#64748b;margin:0 0 12px}' +
        '.kpis{display:flex;gap:12px;margin-bottom:14px}' +
        '.kpi{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;min-width:110px}' +
        '.kpi .v{font-size:18px;font-weight:700;color:#1e40af}' +
        '.kpi .l{font-size:10px;color:#64748b;margin-top:1px}' +
        'table{width:100%;border-collapse:collapse;font-size:11px}' +
        'th{background:#1e3a5f;color:#fff;padding:6px 8px;text-align:left;white-space:nowrap}' +
        'td{padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top}' +
        'tr:hover td{background:#eff6ff!important}' +
        '.footer{margin-top:10px;font-size:10px;color:#94a3b8}' +
        '@media print{body{padding:8px}.no-print{display:none}}' +
      '</style></head><body>' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
        '<div>' +
          '<h1>Extrato — Notas de Empenho Assinadas</h1>' +
          '<p class="sub">UASG 120630 · Período: ' + fmtDate(de.toISOString()) + ' a ' + fmtDate(ate.toISOString()) + ' · Gerado em ' + fmtDate(ate.toISOString()) + '</p>' +
        '</div>' +
        '<button class="no-print" onclick="window.print()" style="padding:6px 14px;background:#1e40af;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">Imprimir / Salvar PDF</button>' +
      '</div>' +
      '<div class="kpis">' +
        '<div class="kpi"><div class="v">' + data.length + '</div><div class="l">NEs Assinadas</div></div>' +
        '<div class="kpi"><div class="v" style="color:#15803d">' + comPdf + '</div><div class="l">Com PDF capturado</div></div>' +
        '<div class="kpi"><div class="v" style="color:#dc2626">' + semPdf + '</div><div class="l">Sem PDF</div></div>' +
        '<div class="kpi"><div class="v" style="font-size:13px">' + fmtVal(totalVal) + '</div><div class="l">Valor Total</div></div>' +
      '</div>' +
      '<table><thead><tr>' +
        '<th>#</th><th>NE SIAFI</th><th>Nº Solicitação</th><th>Fornecedor</th>' +
        '<th>Valor</th><th>ND</th><th>PAG/NUP</th><th>Responsável</th><th>E-mail</th>' +
        '<th>PDF?</th><th>Notificado em</th><th>Revisado em</th><th>Assinado em</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="footer">GAPMN · SIAFI NE Bot v' + VERSION + ' · ' + data.length + ' registro(s)</div>' +
      '</body></html>';

    var w = window.open('', '_blank', 'width=1100,height=750,scrollbars=yes');
    if (!w) { log('⚠ Popup bloqueado. Permita popups para este site.', 'warn'); return; }
    w.document.write(html);
    w.document.close();
  }

  // ── Fluxo principal ─────────────────────────────────────────────────────────

  buildUI();
  log('SIAFI NE Bot v' + VERSION, 'hi');
  log('UG 120630 | Corte: ' + (cfg.dataCorte || DATA_CORTE_PAD), 'info');

  var authOk = await ensureAuth();
  if (!authOk) {
    setFooter([{ label: '🔄 Reiniciar', onclick: function () { SIAFINEBot(); }, style: 'background:#1e40af;color:#fff' }]);
    return;
  }

  log('Buscando NEs assinadas pendentes…', 'info');
  var nes;
  try {
    nes = await fetchPendingNEs();
  } catch (e) {
    log('❌ Erro ao buscar NEs: ' + e.message, 'err');
    return;
  }

  if (!nes.length) {
    log('✓ Nenhuma NE pendente. Tudo em dia!', 'ok');
    log('Use 🧪 Testar 10 para rodar o bot com as últimas NEs assinadas.', 'info');
    setFooter([
      { label: '🧪 Testar 10', style: 'background:#7c3aed;color:#fff;flex:1', onclick: function () { executarTeste(); } },
      { label: '📄 Extrato', style: 'background:#1e40af;color:#fff;padding:5px 10px', onclick: function () { gerarExtrato7d(); } },
      { label: '✕', onclick: function () { OV && OV.remove(); }, style: 'background:#1e293b;color:#94a3b8;padding:5px 10px' }
    ]);
    return;
  }

  log(nes.length + ' NE(s) assinada(s) sem PDF enviado:', 'ok');
  nes.slice(0, 8).forEach(function (ne) {
    var tag = ne.email ? '' : ' ⚠ sem e-mail';
    log('  ' + ne.ne_siafi + tag, ne.email ? 'info' : 'warn');
  });
  if (nes.length > 8) log('  … e mais ' + (nes.length - 8) + ' NE(s).', 'info');

  var connOk = await navigateToCONNE();
  if (!connOk) {
    setFooter([{ label: '🔄 Tentar CONNE', onclick: async function () { var r = await navigateToCONNE(); if (r) log('Pronto — clique Iniciar.', 'ok'); }, style: 'background:#1e40af;color:#fff' }]);
    return;
  }

  // ── Botão Iniciar ─────────────────────────────────────────────────────────
  var _running = false;
  setFooter([
    {
      label: '▶ Iniciar (' + nes.length + ')',
      id: '__snb_start__',
      style: 'background:#166534;color:#fff;flex:1',
      onclick: async function () {
        if (_running) return;
        _running = true;
        window.__snb_stop__ = false;
        setFooter([{
          label: '⏹ Parar',
          style: 'background:#991b1b;color:#fff;flex:1',
          onclick: function () { window.__snb_stop__ = true; log('Parando após NE atual…', 'warn'); }
        }]);

        var ok = 0, partial = 0, fail = 0, skip = 0;

        for (var i = 0; i < nes.length; i++) {
          if (window.__snb_stop__) { log('Parado pelo usuário.', 'warn'); break; }
          var ne = nes[i];
          log('[' + (i + 1) + '/' + nes.length + '] ' + ne.ne_siafi, 'hi');
          var res = await processNE(ne);
          if      (res === 'ok')      ok++;
          else if (res === 'partial') partial++;
          else if (res === 'skip')    skip++;
          else                        fail++;
          // Garante CONNE limpo antes da próxima NE
          if (!isConnePage(getMainDoc())) { await navigateToCONNE(); }
          await sleep(1500);
        }

        log('─── Concluído ───', 'hi');
        if (ok)      log('✓ ' + ok + ' PDF(s) enviado(s) ao GAPMN', 'ok');
        if (partial) log('⚠ ' + partial + ' sem captura automática (PDF pode estar no disco)', 'warn');
        if (skip)    log('⏭ ' + skip + ' pulado(s) (não encontrado no SIAFI)', 'info');
        if (fail)    log('❌ ' + fail + ' falha(s)', 'err');
        if (partial) log('Para NEs parciais: anexe o PDF manualmente na página Solicitações do GAPMN.', 'info');

        setFooter([{ label: '✕ Fechar', onclick: function () { OV && OV.remove(); }, style: 'background:#1e293b;color:#94a3b8;flex:1' }]);
      }
    },
    {
      label: '🧪',
      style: 'background:#7c3aed;color:#fff;padding:5px 10px',
      title: 'Testar com últimas 10 NEs assinadas',
      onclick: function () { executarTeste(); }
    },
    {
      label: '📄',
      style: 'background:#1e40af;color:#fff;padding:5px 10px',
      title: 'Extrato 7 dias',
      onclick: function () { gerarExtrato7d(); }
    },
    {
      label: '⚙',
      style: 'background:#1e293b;color:#94a3b8;padding:5px 10px',
      onclick: function () {
        var d = prompt('Data de corte (AAAA-MM-DD):\nSó processa NEs com updated_at >= esta data.', cfg.dataCorte || DATA_CORTE_PAD);
        if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
          cfg.dataCorte = d; saveCfg(cfg);
          log('Data de corte atualizada: ' + d + '. Reinicie o bot.', 'info');
        }
      }
    }
  ]);

})();
