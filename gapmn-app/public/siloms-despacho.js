// siloms-despacho.js — Despachante SILOMS v2 (sync Supabase por nome de guerra)
// Bookmarklet: javascript:(function(){var s=document.createElement('script');s.src='https://gapmn.app/siloms-despacho.js?v='+Date.now();document.body.appendChild(s);})();
(function () {
  'use strict';

  var LS_KEY   = 'gapmn_despachos';
  var LS_USER  = 'gapmn_silas_user';
  var SB_URL   = 'https://fychrtyyqbzlfbzbvzqp.supabase.co';
  var SB_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';

  var DEFAULT_PHRASES = [
    'Encaminho para providências. Respeitosamente.',
    'Encaminho para análise e prosseguimento. Respeitosamente.',
  ];

  // Toggle: se painel já existe, remove
  var existing = document.getElementById('__sdPanel__');
  if (existing) {
    existing.remove();
    var existBd = document.getElementById('__sdBackdrop__');
    if (existBd) existBd.remove();
    return;
  }

  // ─── Funções findTarget / fillDespacho ────────────────────────────────────────
  // Detecta: textarea de avanço de subprocesso  OU  input[name=vTX_OBS] de "Enviar para Unidade"

  function findTarget(doc, depth) {
    if (!doc || depth > 4) return null;
    try {
      // Prioridade 1 — "Enviar para Unidade": input#vTX_OBS / input[name=vTX_OBS]
      var obs = doc.querySelector('input[name="vTX_OBS"], input#vTX_OBS');
      if (obs && !obs.disabled && !obs.readOnly && (obs.offsetWidth > 0 || obs.offsetHeight > 0)) return obs;

      function validTas(d) {
        return [...d.querySelectorAll('textarea')].filter(function (ta) {
          return ta.id !== '__sdNew__' && !ta.readOnly && !ta.disabled;
        });
      }
      // Prioridade 2 — textarea próxima de "movimentar fluxo"
      try {
        var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
        var tnode;
        while ((tnode = walker.nextNode())) {
          if (/movimentar\s+fluxo/i.test((tnode.textContent || '').trim())) {
            var cont = tnode.parentElement;
            for (var ci = 0; ci < 15; ci++) {
              if (!cont || cont === doc.body) break;
              var mta = validTas(cont)[0];
              if (mta) return mta;
              cont = cont.parentElement;
            }
            break;
          }
        }
      } catch (e2) {}

      // Prioridade 3 — busca em iframes (inclui vTX_OBS em frames filhos)
      var frames = [...doc.querySelectorAll('frame, iframe')];
      for (var i = 0; i < frames.length; i++) {
        try {
          var fd = frames[i].contentDocument;
          var found = findTarget(fd, depth + 1);
          if (found) return found;
        } catch (e) {}
      }
      // Fallback — qualquer textarea visível
      var tas = validTas(doc);
      return tas.find(function (ta) { return ta.offsetWidth > 0 || ta.offsetHeight > 0; }) || null;
    } catch (e) {}
    return null;
  }

  function fillDespacho(text) {
    var target = findTarget(document, 0);
    if (!target) { try { target = findTarget(window.parent.document, 0); } catch (e) {} }
    if (!target) {
      showFeedback('⚠ Caixa não encontrada.\nAbra a janela de despacho ou "Enviar para Unidade".', '#f87171');
      return;
    }
    target.focus();
    var isInput = target.tagName === 'INPUT';
    var proto = isInput
      ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,   'value')
      : Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (proto && proto.set) { proto.set.call(target, text); } else { target.value = text; }
    target.dispatchEvent(new Event('input',  { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    target.dispatchEvent(new Event('blur',   { bubbles: true }));
    var prev = target.style.outline;
    target.style.outline = '2px solid #4ade80';
    setTimeout(function () { target.style.outline = prev; }, 1200);
    showFeedback('✓ Preenchido!', '#4ade80');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getUserKey() {
    try { return localStorage.getItem(LS_USER) || null; } catch(e) { return null; }
  }
  function setUserKey(k) {
    try { localStorage.setItem(LS_USER, k); } catch(e) {} }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) && arr.length ? arr : null;
    } catch(e) { return null; }
  }
  function saveLocal(phrases) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(phrases)); } catch(e) {} }

  // ─── Supabase sync ────────────────────────────────────────────────────────────

  var SB_HDRS = {
    'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json',
  };

  function sbLoad(userKey, cb) {
    fetch(SB_URL + '/rest/v1/silas_frases?user_key=eq.' + encodeURIComponent(userKey) + '&select=frases', { headers: SB_HDRS })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        // data[0] existe → usuário tem frases; data=[] → usuário novo (sem row ainda)
        var frases = (data && data[0] && Array.isArray(data[0].frases)) ? data[0].frases : [];
        cb(null, frases);
      })
      .catch(function(e) { cb(e, null); });
  }

  function sbSave(userKey, phrases) {
    return fetch(SB_URL + '/rest/v1/silas_frases', {
      method: 'POST',
      headers: Object.assign({}, SB_HDRS, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ user_key: userKey, frases: phrases, updated_at: new Date().toISOString() }),
    })
    .then(function(r) { return r.ok; })
    .catch(function() { return false; });
  }

  // ─── Panel ────────────────────────────────────────────────────────────────────

  var panel = document.createElement('div');
  panel.id = '__sdPanel__';
  panel.style.cssText = [
    'position:fixed;top:14px;right:14px;z-index:2147483647',
    'width:318px;border-radius:12px;overflow:hidden',
    'background:#0f172a;color:#e2e8f0',
    'font-family:system-ui,-apple-system,Arial,sans-serif;font-size:13px',
    'box-shadow:0 8px 32px rgba(0,0,0,.65)',
    'border:1px solid rgba(255,255,255,0.09)',
  ].join(';');
  document.body.appendChild(panel);

  function showFeedback(msg, color) {
    var fb = document.getElementById('__sdFb__');
    if (!fb) return;
    fb.textContent = msg;
    fb.style.color = color || '#4ade80';
    fb.style.display = 'block';
    clearTimeout(fb._t);
    fb._t = setTimeout(function () { fb.style.display = 'none'; }, 2200);
  }

  function setSyncStatus(state) {
    var el = document.getElementById('__sdSync__');
    if (!el) return;
    if (state === 'ok')      { el.textContent = '☁ sincronizado'; el.style.color = 'rgba(74,222,128,0.55)'; }
    if (state === 'saving')  { el.textContent = '↻ salvando…';    el.style.color = 'rgba(148,163,184,0.5)'; }
    if (state === 'offline') { el.textContent = '⚠ offline — salvo localmente'; el.style.color = 'rgba(251,191,36,0.6)'; }
    if (state === 'nouser')  { el.textContent = '• sem conta — frases locais apenas'; el.style.color = 'rgba(100,116,139,0.5)'; }
  }

  function persistPhrases(phrases, userKey) {
    saveLocal(phrases);
    if (!userKey) return;
    setSyncStatus('saving');
    sbSave(userKey, phrases).then(function(ok) {
      setSyncStatus(ok ? 'ok' : 'offline');
    });
  }

  // ─── Render principal ─────────────────────────────────────────────────────────

  function render(phrases, userKey) {
    var listHtml = phrases.map(function (p, i) {
      return '<div style="display:flex;align-items:flex-start;gap:5px;padding:4px 10px;border-bottom:1px solid rgba(255,255,255,0.04)">' +
        '<button class="__sdP__" data-i="' + i + '" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid transparent;' +
          'color:#cbd5e1;cursor:pointer;text-align:left;padding:6px 8px;border-radius:7px;font-size:12px;line-height:1.45;' +
          'transition:background .12s,border-color .12s">' + escHtml(p) + '</button>' +
        '<button class="__sdX__" data-i="' + i + '" style="background:none;border:none;color:#475569;cursor:pointer;' +
          'font-size:15px;padding:2px 4px;flex-shrink:0;margin-top:3px;line-height:1" title="Remover">×</button>' +
      '</div>';
    }).join('');

    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;' +
        'padding:10px 14px;background:#0f172a;border-bottom:1px solid rgba(255,255,255,0.08)">' +
        '<div>' +
          '<span style="font-weight:700;color:#38bdf8;font-size:13px">✍️ Silas, o Despachante</span>' +
          (userKey
            ? '<div style="font-size:10px;color:#64748b;margin-top:2px">' + escHtml(userKey) +
                ' · <button id="__sdTrocarUser__" style="background:none;border:none;color:#475569;' +
                'cursor:pointer;font-size:10px;text-decoration:underline;padding:0">trocar</button></div>'
            : '<div style="font-size:10px;color:#475569;margin-top:2px">sem conta</div>') +
        '</div>' +
        '<button id="__sdClose__" style="background:none;border:none;color:#475569;cursor:pointer;' +
          'font-size:18px;line-height:1;padding:0 2px" title="Fechar">×</button>' +
      '</div>' +
      '<div id="__sdList__" style="max-height:260px;overflow-y:auto">' +
        (listHtml || '<div style="padding:12px 14px;color:#475569;font-size:12px">Nenhuma frase salva.</div>') +
      '</div>' +
      '<div style="padding:9px 10px;border-top:1px solid rgba(255,255,255,0.07);display:flex;gap:6px">' +
        '<textarea id="__sdNew__" rows="2" placeholder="Nova frase… (Ctrl+Enter para salvar)" ' +
          'style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.11);' +
          'border-radius:8px;color:#e2e8f0;font-size:12px;padding:6px 8px;resize:none;outline:none;' +
          'font-family:inherit;line-height:1.4"></textarea>' +
        '<button id="__sdAdd__" style="background:#0ea5e9;border:none;color:#fff;border-radius:8px;' +
          'padding:6px 10px;cursor:pointer;font-size:12px;white-space:nowrap;align-self:flex-end;font-weight:600">' +
          '+ Salvar</button>' +
      '</div>' +
      '<div id="__sdFb__" style="display:none;padding:4px 14px 8px;font-size:11px;font-weight:600"></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 12px 6px">' +
        '<span id="__sdSync__" style="font-size:9px"></span>' +
        '<span style="font-size:9px;color:rgba(100,116,139,0.4);letter-spacing:0.03em">dev · 2T Bruno · gapmn</span>' +
      '</div>';

    if (!userKey) setSyncStatus('nouser');

    function closePanel() {
      panel.remove();
      var bd = document.getElementById('__sdBackdrop__');
      if (bd) bd.remove();
    }

    document.getElementById('__sdClose__').onclick = closePanel;

    // Backdrop invisível para fechar ao clicar fora
    var oldBd = document.getElementById('__sdBackdrop__');
    if (oldBd) oldBd.remove();
    var backdrop = document.createElement('div');
    backdrop.id = '__sdBackdrop__';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483646';
    backdrop.onclick = closePanel;
    document.body.appendChild(backdrop);

    var trocarBtn = document.getElementById('__sdTrocarUser__');
    if (trocarBtn) {
      trocarBtn.onclick = function(e) {
        e.stopPropagation();
        showNomePrompt(true, function(nome) {
          if (nome) {
            setUserKey(nome);
            saveLocal([]);  // limpa cache do usuário anterior
          }
          init(nome);
        });
      };
    }

    panel.querySelectorAll('.__sdP__').forEach(function (btn) {
      btn.onmouseenter = function () { btn.style.background = 'rgba(14,165,233,0.2)'; btn.style.borderColor = 'rgba(14,165,233,0.35)'; };
      btn.onmouseleave = function () { btn.style.background = 'rgba(255,255,255,0.05)'; btn.style.borderColor = 'transparent'; };
      btn.onclick = function () { fillDespacho(phrases[+btn.getAttribute('data-i')]); };
    });

    panel.querySelectorAll('.__sdX__').forEach(function (btn) {
      btn.onmouseenter = function () { btn.style.color = '#f87171'; };
      btn.onmouseleave = function () { btn.style.color = '#475569'; };
      btn.onclick = function () {
        phrases.splice(+btn.getAttribute('data-i'), 1);
        persistPhrases(phrases, userKey);
        render(phrases, userKey);
      };
    });

    var addBtn = document.getElementById('__sdAdd__');
    var newTa  = document.getElementById('__sdNew__');
    addBtn.onclick = function () {
      var txt = newTa.value.trim();
      if (!txt) return;
      phrases.push(txt);
      persistPhrases(phrases, userKey);
      newTa.value = '';
      render(phrases, userKey);
    };
    newTa.onkeydown = function (e) {
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); addBtn.click(); }
    };
  }

  // ─── Tela de nome de guerra ───────────────────────────────────────────────────

  function showNomePrompt(isTrocar, onConfirm) {
    panel.innerHTML =
      '<div style="padding:18px 16px 16px">' +
        '<div style="font-weight:700;color:#38bdf8;font-size:13px;margin-bottom:10px">✍️ Silas, o Despachante</div>' +
        '<div style="font-size:12px;color:#94a3b8;margin-bottom:14px;line-height:1.6">' +
          (isTrocar
            ? 'Informe seu nome de guerra para carregar suas frases:'
            : 'Para salvar suas frases na nuvem e recuperá-las mesmo após reiniciar o PC, informe seu <b style="color:#e2e8f0">nome de guerra</b>:') +
        '</div>' +
        '<input id="__sdNomeInput__" type="text" placeholder="Ex: 2T BRUNO..." maxlength="30" ' +
          'style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.07);' +
          'border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#e2e8f0;' +
          'font-size:13px;font-weight:600;padding:9px 11px;outline:none;font-family:inherit;' +
          'text-transform:uppercase;margin-bottom:12px" />' +
        '<button id="__sdNomeOk__" style="width:100%;background:#0ea5e9;border:none;color:#fff;' +
          'border-radius:8px;padding:9px;cursor:pointer;font-size:13px;font-weight:700;margin-bottom:8px">' +
          '☁ Confirmar e sincronizar' +
        '</button>' +
        (!isTrocar
          ? '<div style="text-align:center">' +
              '<button id="__sdNomeSkip__" style="background:none;border:none;color:#475569;' +
              'cursor:pointer;font-size:11px;text-decoration:underline">' +
              'Usar sem conta (frases ficam só neste PC)</button>' +
            '</div>'
          : '') +
      '</div>';

    var inp = document.getElementById('__sdNomeInput__');
    inp.focus();
    inp.oninput = function() { inp.value = inp.value.toUpperCase(); };

    function confirmar() {
      var nome = inp.value.trim().toUpperCase();
      if (!nome) { inp.style.borderColor = '#f87171'; inp.focus(); return; }
      setUserKey(nome);
      onConfirm(nome);
    }

    document.getElementById('__sdNomeOk__').onclick = confirmar;
    inp.onkeydown = function(e) { if (e.key === 'Enter') confirmar(); };

    var skipBtn = document.getElementById('__sdNomeSkip__');
    if (skipBtn) skipBtn.onclick = function() { onConfirm(null); };
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────

  function init(userKey) {
    var localPhrases = loadLocal() || DEFAULT_PHRASES.slice();
    render(localPhrases, userKey);

    if (!userKey) return;

    setSyncStatus('saving');
    sbLoad(userKey, function(err, cloud) {
      if (err) {
        // Erro de rede ou tabela não existe → continua com local
        setSyncStatus('offline');
      } else if (cloud.length) {
        // Nuvem tem frases → usa como fonte de verdade
        saveLocal(cloud);
        render(cloud, userKey);
        setSyncStatus('ok');
      } else {
        // Usuário novo (sem row ainda) → sobe frases locais para nuvem
        sbSave(userKey, localPhrases).then(function(ok) {
          setSyncStatus(ok ? 'ok' : 'offline');
        });
      }
    });
  }

  // ─── Entry point ──────────────────────────────────────────────────────────────

  var userKey = getUserKey();
  if (userKey === null) {
    showNomePrompt(false, function(nome) { init(nome); });
  } else {
    init(userKey);
  }

})();
