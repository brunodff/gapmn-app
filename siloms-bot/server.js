/**
 * Local Server — porta 3333
 * Bots disponíveis:
 *   SILOMS  — busca subprocesso de NEs (requer VPN)
 *   SICAF   — baixa Situação do Fornecedor (internet pública)
 *
 * Iniciar: node server.js
 * Painel:  http://localhost:3333
 */

const http   = require("http");
const fs     = require("fs");
const path   = require("path");
const { executarBot }             = require("./bot");
const { executarBotSicaf }        = require("./sicaf-bot");
const { executarBotCnetStatus }   = require("./cnet-status-bot");

const PORT       = 3333;
const OUTPUT_DIR = path.join(__dirname, "output");

const SB_URL = "https://fychrtyyqbzlfbzbvzqp.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw";

// ── Estado SILOMS ─────────────────────────────────────────────────────────────
let botRunning = false;
let botLog     = [];
let botResult  = null;
let botError   = null;

// ── Estado SICAF ──────────────────────────────────────────────────────────────
let sicafRunning = false;
let sicafLog     = [];
let sicafResult  = null;
let sicafError   = null;

// ── Estado CNET Status ────────────────────────────────────────────────────────
let cnetRunning = false;
let cnetLog     = [];
let cnetResult  = null;
let cnetError   = null;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Access-Control-Request-Private-Network");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function logSiloms(msg) {
  console.log("[SILOMS]", msg);
  botLog.push({ ts: new Date().toISOString(), msg });
}

function logSicaf(msg) {
  console.log("[SICAF]", msg);
  sicafLog.push({ ts: new Date().toISOString(), msg });
}

function logCnet(msg) {
  console.log("[CNET]", msg);
  cnetLog.push({ ts: new Date().toISOString(), msg });
}

// ── Overlay injetável (bookmarklet) ──────────────────────────────────────────
const PANEL_JS = `(function(){
'use strict';
var PORT = ${PORT};
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
    var cpf   = (document.getElementById('__sp_cpf__').value || '').replace(/\\D/g,'');
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
})();`;

// ── Overlay CNET Status (bookmarklet) ────────────────────────────────────────
const CNET_PANEL_JS = `(function(){
'use strict';
var PORT = ${PORT};
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
})();`;

// ── Página de controle HTML ───────────────────────────────────────────────────
const HTML_PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GAP-MN · Robô SILOMS</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f1f5f9;min-height:100vh;padding:32px 16px;}
.card{background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.10);padding:28px;max-width:560px;margin:0 auto;}
h1{font-size:1.25rem;color:#1e3a8a;margin-bottom:4px;}
.sub{font-size:.82rem;color:#64748b;margin-bottom:24px;}
label{display:block;font-size:.82rem;font-weight:600;color:#374151;margin-bottom:4px;}
input[type=text],input[type=password]{width:100%;padding:9px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:.9rem;margin-bottom:14px;outline:none;transition:border-color .15s;}
input:focus{border-color:#3b82f6;}
.row{display:flex;gap:10px;}
.row input{flex:1;}
button{padding:10px 22px;border:none;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;transition:background .15s;}
.btn-primary{background:#1e3a8a;color:#fff;}
.btn-primary:hover{background:#1d4ed8;}
.btn-primary:disabled{background:#94a3b8;cursor:not-allowed;}
.btn-secondary{background:#e2e8f0;color:#374151;}
.btn-secondary:hover{background:#cbd5e1;}
#status{margin-top:20px;display:none;}
#log{background:#0f172a;color:#cbd5e1;font-family:'Cascadia Code','Fira Mono',monospace;font-size:.78rem;line-height:1.6;padding:14px 16px;border-radius:10px;min-height:100px;max-height:380px;overflow-y:auto;white-space:pre-wrap;margin-bottom:14px;}
.ok{color:#4ade80;}
.err{color:#f87171;}
.info{color:#60a5fa;}
.warn{color:#facc15;}
.done{background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:16px;text-align:center;}
.done h3{color:#15803d;font-size:1rem;margin-bottom:6px;}
.done p{font-size:.82rem;color:#166534;}
.badge{display:inline-block;background:#dcfce7;color:#166534;font-weight:700;padding:2px 10px;border-radius:999px;font-size:.8rem;margin:0 3px;}
.err-card{background:#fef2f2;border:1.5px solid #fca5a5;border-radius:10px;padding:16px;text-align:center;}
.err-card h3{color:#dc2626;margin-bottom:6px;}
.divider{border:none;border-top:1px solid #e2e8f0;margin:18px 0;}
.hint{font-size:.75rem;color:#94a3b8;margin-top:8px;}
</style>
</head>
<body>
<div class="card">
  <h1>⚙️ GAP-MN · Robô SILOMS</h1>
  <p class="sub">Busca automaticamente os subprocessos de NEs sem registro &nbsp;·&nbsp; Requer VPN ativa</p>

  <div id="form-section">
    <label>CPF (somente números)</label>
    <input type="text" id="cpf" maxlength="11" placeholder="Ex: 12345678901" autocomplete="username">

    <label>Senha SILOMS / SSO</label>
    <input type="password" id="senha" placeholder="••••••••" autocomplete="current-password">

    <div class="row">
      <div style="flex:1">
        <label>Ano</label>
        <input type="text" id="ano" value="2026" maxlength="4">
      </div>
    </div>

    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <button class="btn-primary" id="btn-iniciar" onclick="iniciar()">▶ Iniciar Robô</button>
      <span class="hint" id="status-hint">O robô abre o navegador automaticamente.</span>
    </div>
  </div>

  <div id="status">
    <hr class="divider">
    <div id="log"></div>
    <div id="result-card"></div>
  </div>
</div>

<script>
const SB = '${SB_URL}';
const SK = '${SB_KEY}';

let logLines = 0;
let polling  = null;

function appendLog(msg, cls) {
  const div = document.getElementById('log');
  const s   = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = msg + '\\n';
  div.appendChild(s);
  div.scrollTop = div.scrollHeight;
}

function classForMsg(m) {
  if (m.startsWith('✅') || m.startsWith('🎉')) return 'ok';
  if (m.startsWith('❌') || m.startsWith('Erro') || m.toLowerCase().includes('falh')) return 'err';
  if (m.startsWith('⚠️') || m.startsWith('⚪')) return 'warn';
  if (m.startsWith('━') || m.startsWith('📋') || m.startsWith('↻')) return 'info';
  return '';
}

async function iniciar() {
  const cpf   = document.getElementById('cpf').value.replace(/\\D/g, '');
  const senha = document.getElementById('senha').value.trim();
  const ano   = document.getElementById('ano').value.trim() || '2026';

  if (!cpf || cpf.length < 11) { alert('CPF deve ter 11 dígitos.'); return; }
  if (!senha) { alert('Preencha a senha.'); return; }

  document.getElementById('btn-iniciar').disabled = true;
  document.getElementById('status-hint').textContent = 'Robô em execução...';
  document.getElementById('status').style.display = 'block';
  document.getElementById('log').innerHTML = '';
  document.getElementById('result-card').innerHTML = '';
  logLines = 0;

  appendLog('▶ Conectando ao servidor...', 'info');

  try {
    const r = await fetch('/rodar', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({cpf, senha, ano})
    });
    const data = await r.json();
    if (!r.ok) {
      appendLog('❌ ' + data.error, 'err');
      document.getElementById('btn-iniciar').disabled = false;
      document.getElementById('status-hint').textContent = '';
      return;
    }
    appendLog('✅ Robô SILOMS iniciado! Acompanhe abaixo.', 'ok');
    polling = setInterval(checarStatus, 2000);
  } catch(e) {
    appendLog('❌ Servidor não respondeu. Verifique se "node server.js" está rodando.', 'err');
    document.getElementById('btn-iniciar').disabled = false;
    document.getElementById('status-hint').textContent = '';
  }
}

async function checarStatus() {
  try {
    const r    = await fetch('/status');
    const data = await r.json();

    const novos = (data.log || []).slice(logLines);
    novos.forEach(entry => appendLog(entry.msg, classForMsg(entry.msg)));
    logLines = (data.log || []).length;

    if (!data.running) {
      clearInterval(polling);
      polling = null;

      if (data.error) {
        mostrarErro(data.error);
      } else {
        await sincronizarSupabase();
      }
      document.getElementById('btn-iniciar').disabled = false;
      document.getElementById('status-hint').textContent = '';
    }
  } catch(e) {
    appendLog('⚠️ Falha ao consultar status: ' + e.message, 'warn');
  }
}

async function sincronizarSupabase() {
  appendLog('\\n↻ Sincronizando resultados com o Supabase...', 'info');
  try {
    const r    = await fetch('/dados');
    const data = await r.json();
    const docs = (data.docs || []).filter(d => d.ne_siafi && d.subprocesso !== undefined);

    if (!docs.length) {
      appendLog('⚠️ Nenhum resultado encontrado para sincronizar.', 'warn');
      mostrarConcluido(0, 0);
      return;
    }

    let salvos = 0, erros = 0;
    const headers = {
      'apikey': SK,
      'Authorization': 'Bearer ' + SK,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };

    for (const doc of docs) {
      try {
        const resp = await fetch(
          SB + '/rest/v1/siloms_ne_identificadores?ne_siafi=eq.' + encodeURIComponent(doc.ne_siafi),
          { method: 'PATCH', headers, body: JSON.stringify({ subprocesso: doc.subprocesso || '' }) }
        );
        if (resp.ok) salvos++; else erros++;
      } catch(e) { erros++; }
    }

    appendLog('\\n✅ Supabase: ' + salvos + ' NEs atualizadas' + (erros ? ', ' + erros + ' erros' : '') + '.', 'ok');
    const encontrados = docs.filter(d => d.subprocesso && d.subprocesso !== '').length;
    mostrarConcluido(encontrados, docs.length);
  } catch(e) {
    appendLog('❌ Erro ao sincronizar: ' + e.message, 'err');
    mostrarConcluido(0, 0);
  }
}

function mostrarConcluido(encontrados, total) {
  document.getElementById('result-card').innerHTML =
    '<div class="done">' +
      '<h3>🎉 Concluído!</h3>' +
      '<p><span class="badge">' + encontrados + ' / ' + total + '</span> subprocessos encontrados e salvos.</p>' +
      '<p style="margin-top:8px">Abra o <strong>GAP-MN → aba Empenhos</strong> e clique <strong>Atualizar</strong>.</p>' +
    '</div>';
}

function mostrarErro(msg) {
  document.getElementById('result-card').innerHTML =
    '<div class="err-card">' +
      '<h3>❌ Erro</h3>' +
      '<p>' + msg + '</p>' +
    '</div>';
}
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── Página de controle ────────────────────────────────────────────────────────
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    cors(res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML_PAGE);
    return;
  }

  // ── Overlay injetável via bookmarklet (SILOMS) ───────────────────────────────
  if (req.method === "GET" && url.pathname === "/panel.js") {
    cors(res);
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    res.end(PANEL_JS);
    return;
  }

  // ── Overlay injetável via bookmarklet (CNET Status) ──────────────────────────
  if (req.method === "GET" && url.pathname === "/cnet-status-panel.js") {
    cors(res);
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    res.end(CNET_PANEL_JS);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  SILOMS
  // ════════════════════════════════════════════════════════════════════════════

  // GET /status
  if (req.method === "GET" && url.pathname === "/status") {
    const jsonAnterior = fs.existsSync(OUTPUT_DIR)
      ? (fs.readdirSync(OUTPUT_DIR).find(f => f.startsWith("siloms_") && f.endsWith(".json")) ?? null)
      : null;
    return json(res, {
      running: botRunning,
      log: botLog,
      result: botResult,
      error: botError,
      jsonAnterior: jsonAnterior ? path.join(OUTPUT_DIR, jsonAnterior) : null,
    });
  }

  // GET /dados — retorna o JSON do último resultado
  if (req.method === "GET" && url.pathname === "/dados") {
    const jsonFile = fs.existsSync(OUTPUT_DIR)
      ? fs.readdirSync(OUTPUT_DIR).map(f => path.join(OUTPUT_DIR, f)).find(f => /siloms_.*\.json$/.test(path.basename(f)))
      : null;
    if (!jsonFile || !fs.existsSync(jsonFile)) return json(res, { registros: [], docs: [] });
    try {
      const conteudo = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
      return json(res, { registros: conteudo.registros || [], docs: conteudo.docs || [] });
    } catch { return json(res, { registros: [], docs: [] }); }
  }

  // GET /download — baixa o arquivo JSON de resultado
  if (req.method === "GET" && url.pathname === "/download") {
    const jsonFile = fs.existsSync(OUTPUT_DIR)
      ? fs.readdirSync(OUTPUT_DIR).map(f => path.join(OUTPUT_DIR, f)).find(f => /siloms_.*\.json$/.test(path.basename(f)))
      : null;
    if (!jsonFile || !fs.existsSync(jsonFile))
      return json(res, { error: "Nenhum resultado disponível." }, 404);
    cors(res);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${path.basename(jsonFile)}"`,
    });
    fs.createReadStream(jsonFile).pipe(res);
    return;
  }

  // POST /rodar
  if (req.method === "POST" && url.pathname === "/rodar") {
    if (botRunning) return json(res, { error: "Robô SILOMS já está em execução." }, 409);

    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      let params;
      try { params = JSON.parse(body); } catch { return json(res, { error: "JSON inválido" }, 400); }

      const { cpf, senha, ano = "2026" } = params;
      if (!cpf || !senha) return json(res, { error: "CPF e senha são obrigatórios." }, 400);

      botRunning = true; botLog = []; botResult = null; botError = null;
      json(res, { ok: true, message: "Robô SILOMS iniciado." });

      try {
        botResult = await executarBot({ cpf, senha, ano, onStatus: logSiloms });
        logSiloms(`✅ Concluído! ${botResult.docs ?? botResult.registros ?? 0} subprocessos buscados.`);
      } catch (err) {
        botError = err.message;
        logSiloms(`❌ Erro: ${err.message}`);
      } finally {
        botRunning = false;
      }
    });
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  SICAF
  // ════════════════════════════════════════════════════════════════════════════

  // GET /status-sicaf
  if (req.method === "GET" && url.pathname === "/status-sicaf") {
    return json(res, {
      running: sicafRunning,
      log: sicafLog,
      result: sicafResult,
      error: sicafError,
    });
  }

  // GET /download-sicaf — serve o PDF gerado
  if (req.method === "GET" && url.pathname === "/download-sicaf") {
    const arquivo = sicafResult?.pdfFile;
    if (!arquivo || !fs.existsSync(arquivo))
      return json(res, { error: "PDF não encontrado. Execute o bot primeiro." }, 404);
    cors(res);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${path.basename(arquivo)}"`,
    });
    fs.createReadStream(arquivo).pipe(res);
    return;
  }

  // POST /rodar-sicaf
  if (req.method === "POST" && url.pathname === "/rodar-sicaf") {
    if (sicafRunning) return json(res, { error: "Bot SICAF já está em execução." }, 409);

    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      let params;
      try { params = JSON.parse(body); } catch { return json(res, { error: "JSON inválido" }, 400); }

      const { cpf, senha, cnpj } = params;
      if (!cpf || !senha || !cnpj) return json(res, { error: "CPF, senha e CNPJ são obrigatórios." }, 400);

      sicafRunning = true; sicafLog = []; sicafResult = null; sicafError = null;
      json(res, { ok: true, message: "Bot SICAF iniciado." });

      try {
        sicafResult = await executarBotSicaf({ cpf, senha, cnpj, onStatus: logSicaf });
        logSicaf(`✅ PDF gerado: ${path.basename(sicafResult.pdfFile)}`);
      } catch (err) {
        sicafError = err.message;
        logSicaf(`❌ Erro: ${err.message}`);
      } finally {
        sicafRunning = false;
      }
    });
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  CNET STATUS
  // ════════════════════════════════════════════════════════════════════════════

  // GET /status-cnet-status
  if (req.method === "GET" && url.pathname === "/status-cnet-status") {
    return json(res, {
      running: cnetRunning,
      log: cnetLog,
      result: cnetResult,
      error: cnetError,
    });
  }

  // POST /rodar-cnet-status  — body: { ano?: number, dryRun?: boolean }
  if (req.method === "POST" && url.pathname === "/rodar-cnet-status") {
    if (cnetRunning) return json(res, { error: "Bot CNET Status já está em execução." }, 409);

    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      let params = {};
      try { params = body ? JSON.parse(body) : {}; } catch { return json(res, { error: "JSON inválido" }, 400); }

      const { ano, dryRun = false } = params;
      const anoFiltro = ano ? parseInt(ano, 10) : null;

      cnetRunning = true; cnetLog = []; cnetResult = null; cnetError = null;
      json(res, { ok: true, message: "Bot CNET Status iniciado." });

      try {
        cnetResult = await executarBotCnetStatus({ dryRun, anoFiltro, onStatus: logCnet });
        logCnet(`✅ Concluído: ${cnetResult.ok} verificados, ${cnetResult.skip} pulados, ${cnetResult.err} erros.`);
      } catch (err) {
        cnetError = err.message;
        logCnet(`❌ Erro: ${err.message}`);
      } finally {
        cnetRunning = false;
      }
    });
    return;
  }

  json(res, { error: "Rota não encontrada" }, 404);
});

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n🤖 Bot Server iniciado!`);
  console.log(`   👉 Abra no navegador: http://localhost:${PORT}`);
  console.log(`\n   API SILOMS:       /rodar  /status  /dados  /download`);
  console.log(`   API SICAF:        /rodar-sicaf  /status-sicaf  /download-sicaf`);
  console.log(`   API CNET Status:  /rodar-cnet-status  /status-cnet-status\n`);
});
