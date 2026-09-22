(function(){
'use strict';
var PORT = 3333;
var BASE = 'http://localhost:' + PORT;

var existing = document.getElementById('__cnet_status_panel__');
if (existing) { existing.remove(); return; }

var ov = document.createElement('div');
ov.id = '__cnet_status_panel__';
ov.style.cssText = [
  'position:fixed;bottom:16px;right:16px;width:320px',
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
  '<span style="font-weight:700;color:#34d399;font-size:14px">🔄 Verificador CNET</span>');
var closeBtn = h('button','background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;line-height:1;padding:0 2px','×');
closeBtn.onclick = function() { ov.remove(); };
header.appendChild(closeBtn);
ov.appendChild(header);

var body = h('div','padding:14px');
ov.appendChild(body);
document.body.appendChild(ov);

function logLine(msg, color) {
  var logEl = document.getElementById('__csp_log__');
  if (!logEl) return;
  var d = document.createElement('div');
  d.style.cssText = 'padding:2px 0;color:' + (color || '#e2e8f0');
  d.textContent = msg;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}
function msgClass(m) {
  if (m.startsWith('✅') || m.startsWith('🎉')) return '#4ade80';
  if (m.startsWith('❌') || m.toLowerCase().includes('erro')) return '#f87171';
  if (m.startsWith('⚠')) return '#facc15';
  if (m.startsWith('━') || m.startsWith('↻') || m.startsWith('[')) return '#60a5fa';
  return '#cbd5e1';
}

var lastLogLen = 0;
var pollTimer = null;
function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function startPoll() {
  lastLogLen = 0;
  pollTimer = setInterval(async function() {
    try {
      var r = await fetch(BASE + '/status-cnet-status');
      var d = await r.json();
      var novos = (d.log || []).slice(lastLogLen);
      novos.forEach(function(e) { logLine(e.msg, msgClass(e.msg)); });
      lastLogLen = (d.log || []).length;
      if (!d.running) {
        stopPoll();
        var btn = document.getElementById('__csp_run__');
        if (btn) { btn.disabled = false; btn.textContent = '▶ Verificar Processos CNET'; }
        if (d.error) logLine('❌ ' + d.error, '#f87171');
        else if (d.result) logLine('🎉 Concluído: ' + d.result.ok + ' atualizados, ' + d.result.skip + ' pulados.', '#4ade80');
      }
    } catch(e) { logLine('⚠ Servidor não respondeu.', '#facc15'); stopPoll(); }
  }, 2000);
}

async function checkServer() {
  try {
    var r = await fetch(BASE + '/status-cnet-status', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch(e) { return false; }
}

async function renderBody() {
  var ok = await checkServer();
  if (!ok) {
    body.innerHTML = '<div style="color:#f87171;font-size:12px;line-height:1.6;padding:4px 0">' +
      '❌ Servidor não encontrado em localhost:' + PORT + '.<br>' +
      '<span style="color:#94a3b8">Inicie com: <code style="color:#60a5fa">node server.js</code></span></div>';
    return;
  }
  body.innerHTML =
    '<div style="margin-bottom:10px"><div style="font-size:10px;color:#64748b;margin-bottom:3px">Ano (opcional — deixe vazio para todos)</div>' +
    '<input id="__csp_ano__" type="text" placeholder="2026" ' +
    'style="width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:12px;padding:6px 8px;outline:none;margin-bottom:8px"></div>' +
    '<button id="__csp_run__" style="width:100%;background:#065f46;border:none;color:#fff;border-radius:8px;' +
      'padding:9px;cursor:pointer;font-size:13px;font-weight:700;margin-bottom:10px">▶ Verificar Processos CNET</button>' +
    '<div id="__csp_log__" style="background:#0a0f1a;border-radius:8px;padding:8px 10px;' +
      'min-height:60px;max-height:220px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.6"></div>';

  document.getElementById('__csp_run__').onclick = async function() {
    var ano = (document.getElementById('__csp_ano__').value || '').trim();
    var btn = document.getElementById('__csp_run__');
    btn.disabled = true; btn.textContent = 'Verificando…';
    var logEl = document.getElementById('__csp_log__');
    if (logEl) logEl.innerHTML = '';
    lastLogLen = 0;
    try {
      var r = await fetch(BASE + '/rodar-cnet-status', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ano: ano ? parseInt(ano) : undefined })
      });
      var d = await r.json();
      if (!r.ok) { logLine('❌ ' + d.error,'#f87171'); btn.disabled=false; btn.textContent='▶ Verificar Processos CNET'; return; }
      logLine('✅ Verificação iniciada!','#4ade80');
      startPoll();
    } catch(e) {
      logLine('❌ Servidor não respondeu: ' + e.message,'#f87171');
      btn.disabled=false; btn.textContent='▶ Verificar Processos CNET';
    }
  };

  var statusR = await fetch(BASE + '/status-cnet-status').then(r=>r.json()).catch(()=>({running:false,log:[]}));
  if (statusR.running) {
    logLine('↻ Verificação em execução — acompanhe abaixo','#60a5fa');
    lastLogLen = 0;
    var btn = document.getElementById('__csp_run__');
    if (btn) { btn.disabled=true; btn.textContent='⏳ Verificando…'; }
    startPoll();
  } else if (statusR.log && statusR.log.length) {
    logLine('— Última execução —','#334155');
    statusR.log.slice(-5).forEach(function(e) { logLine(e.msg, msgClass(e.msg)); });
  }
}

renderBody();
})();
