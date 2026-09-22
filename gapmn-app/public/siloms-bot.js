(function(){
'use strict';
var PORT = 3333;
var BASE = 'http://localhost:' + PORT;

var existing = document.getElementById('__siloms_panel__');
if (existing) { existing.remove(); return; }

var ov = document.createElement('div');
ov.id = '__siloms_panel__';
ov.style.cssText = [
  'position:fixed;bottom:16px;right:16px;width:340px',
  'background:#0f172a;color:#e2e8f0',
  'border:1px solid #334155;border-radius:12px',
  'font:13px/1.5 system-ui,sans-serif',
  'z-index:2147483647;box-shadow:0 8px 32px rgba(0,0,0,.75)',
  'overflow:hidden'
].join(';');

function h(tag, css, html) {
  var el = document.createElement(tag);
  if (css) el.style.cssText = css;
  if (html) el.innerHTML = html;
  return el;
}

var header = h('div','padding:9px 14px;background:#0f172a;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center',
  '<span style="font-weight:700;color:#60a5fa;font-size:14px">⚙ Robô SILOMS</span>');
var closeBtn = h('button','background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;line-height:1;padding:0 2px','×');
closeBtn.onclick = function() { ov.remove(); };
header.appendChild(closeBtn);
ov.appendChild(header);

var body = h('div','padding:14px');
ov.appendChild(body);
document.body.appendChild(ov);

function inp(id, label, type, val, ph) {
  return '<div style="margin-bottom:10px"><div style="font-size:10px;color:#64748b;margin-bottom:3px">' + label + '</div>' +
    '<input id="__sp_' + id + '__" type="' + type + '" value="' + (val||'') + '" placeholder="' + (ph||'') + '" ' +
    'style="width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;border-radius:6px;' +
    'color:#e2e8f0;font-size:12px;padding:6px 8px;outline:none"></div>';
}

function logLine(msg, color) {
  var logEl = document.getElementById('__sp_log__');
  if (!logEl) return;
  var d = document.createElement('div');
  d.style.cssText = 'padding:2px 0;color:' + (color || '#e2e8f0');
  d.textContent = msg;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function msgClass(m) {
  if (m.startsWith('✅') || m.startsWith('🎉')) return '#4ade80';
  if (m.startsWith('❌') || m.toLowerCase().includes('erro') || m.toLowerCase().includes('falh')) return '#f87171';
  if (m.startsWith('⚠')) return '#facc15';
  if (m.startsWith('━') || m.startsWith('📋') || m.startsWith('↻')) return '#60a5fa';
  return '#cbd5e1';
}

var lastLogLen = 0;
var pollTimer = null;

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function startPoll() {
  lastLogLen = 0;
  pollTimer = setInterval(async function() {
    try {
      var r = await fetch(BASE + '/status');
      var d = await r.json();
      var novos = (d.log || []).slice(lastLogLen);
      novos.forEach(function(e) { logLine(e.msg, msgClass(e.msg)); });
      lastLogLen = (d.log || []).length;
      if (!d.running) {
        stopPoll();
        var btn = document.getElementById('__sp_run__');
        if (btn) { btn.disabled = false; btn.textContent = '▶ Iniciar Robô'; }
        if (d.error) logLine('❌ ' + d.error, '#f87171');
        else logLine('🎉 Concluído! Abra o GAPMN → aba Empenhos e clique Atualizar.', '#4ade80');
      }
    } catch(e) { logLine('⚠ Servidor não respondeu.', '#facc15'); stopPoll(); }
  }, 2000);
}

async function checkServer() {
  try {
    var r = await fetch(BASE + '/status', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch(e) { return false; }
}

async function renderForm() {
  var ok = await checkServer();
  if (!ok) {
    body.innerHTML = '<div style="color:#f87171;font-size:12px;line-height:1.6;padding:4px 0">' +
      '❌ Servidor não encontrado em localhost:' + PORT + '.<br>' +
      '<span style="color:#94a3b8">Inicie com: <code style="color:#60a5fa">node server.js</code></span></div>';
    return;
  }
  body.innerHTML =
    inp('cpf','CPF (só números)','text','','12345678901') +
    inp('senha','Senha SILOMS / SSO','password','','••••••••') +
    inp('ano','Ano','text','2026','2026') +
    '<button id="__sp_run__" style="width:100%;background:#1e3a8a;border:none;color:#fff;border-radius:8px;' +
      'padding:9px;cursor:pointer;font-size:13px;font-weight:700;margin-bottom:10px">▶ Iniciar Robô</button>' +
    '<div id="__sp_log__" style="background:#0a0f1a;border-radius:8px;padding:8px 10px;' +
      'min-height:60px;max-height:200px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.6"></div>';

  document.getElementById('__sp_run__').onclick = async function() {
    var cpf   = (document.getElementById('__sp_cpf__').value || '').replace(/\D/g,'');
    var senha = (document.getElementById('__sp_senha__').value || '').trim();
    var ano   = (document.getElementById('__sp_ano__').value || '2026').trim();
    if (cpf.length < 11) { logLine('⚠ CPF deve ter 11 dígitos.','#facc15'); return; }
    if (!senha)          { logLine('⚠ Preencha a senha.','#facc15'); return; }
    var btn = document.getElementById('__sp_run__');
    btn.disabled = true; btn.textContent = 'Iniciando…';
    var logEl = document.getElementById('__sp_log__');
    if (logEl) logEl.innerHTML = '';
    lastLogLen = 0;
    try {
      var r = await fetch(BASE + '/rodar', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({cpf,senha,ano})
      });
      var d = await r.json();
      if (!r.ok) { logLine('❌ ' + d.error,'#f87171'); btn.disabled=false; btn.textContent='▶ Iniciar Robô'; return; }
      logLine('✅ Robô iniciado! Aguarde…','#4ade80');
      btn.textContent = '⏳ Rodando…';
      startPoll();
    } catch(e) {
      logLine('❌ Servidor não respondeu: ' + e.message,'#f87171');
      btn.disabled=false; btn.textContent='▶ Iniciar Robô';
    }
  };

  var statusR = await fetch(BASE + '/status').then(r=>r.json()).catch(()=>({running:false,log:[]}));
  if (statusR.running) {
    logLine('↻ Robô já em execução — acompanhe abaixo','#60a5fa');
    lastLogLen = 0;
    var btn = document.getElementById('__sp_run__');
    if (btn) { btn.disabled=true; btn.textContent='⏳ Rodando…'; }
    startPoll();
  } else if (statusR.log && statusR.log.length) {
    logLine('— Última execução —','#334155');
    statusR.log.slice(-5).forEach(function(e) { logLine(e.msg, msgClass(e.msg)); });
  }
}

renderForm();
})();
