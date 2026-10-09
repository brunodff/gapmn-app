'use strict';
const $ = (id) => document.getElementById(id);

function quando(iso) {
  if (!iso) return '';
  const d = new Date(iso), min = Math.round((Date.now() - d) / 60000);
  const rel = min < 1 ? 'agora' : min < 60 ? 'há ' + min + ' min' : min < 1440 ? 'há ' + Math.round(min / 60) + ' h' : 'há ' + Math.round(min / 1440) + ' dia(s)';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) + ' (' + rel + ')';
}

async function mostrar() {
  const { sessao, envio = {}, config = {} } = await chrome.storage.local.get(['sessao', 'envio', 'config']);
  $('entrar').hidden = !!sessao;
  $('conectado').hidden = !sessao;
  if (!sessao) return;
  $('quem').textContent = '✅ ' + sessao.nome + ' · ' + sessao.setor;
  $('intervalo').value = String(config.intervaloH || 3);

  const st = $('status');
  if (envio.emCurso) { st.className = 'aviso'; st.textContent = '⏳ Enviando… (começou ' + quando(envio.inicio) + ')'; }
  else if (!envio.fim) { st.className = 'mudo'; st.textContent = 'Ainda não enviou. Abra a Área de Trabalho do ComprasNet.'; }
  else if (envio.ok) { st.className = 'ok'; st.textContent = '✓ Último envio ' + quando(envio.fim); }
  else { st.className = 'erro'; st.textContent = '❌ ' + (envio.erro || 'Falhou') + ' — ' + quando(envio.fim); }

  const r = envio.resumo;
  $('resumo').textContent = r && envio.ok
    ? r.processos + ' processos na Área de Trabalho · ' + r.detalhados + ' detalhados (' + r.itens + ' itens, ' + r.participantes + ' participantes)' +
      (r.pendentes ? ' · ' + r.pendentes + ' continuam no próximo envio' : '') + (r.erros?.length ? ' · ' + r.erros.length + ' aviso(s)' : '')
    : '';
  $('btn-enviar').disabled = !!envio.emCurso;
  $('log').textContent = (envio.log || []).join('\n') + (r?.erros?.length ? '\n\nAvisos:\n' + r.erros.join('\n') : '');
}

$('btn-entrar').addEventListener('click', async () => {
  $('btn-entrar').disabled = true; $('msg-entrar').textContent = '';
  const r = await chrome.runtime.sendMessage({ tipo: 'ENTRAR', email: $('email').value.trim(), senha: $('senha').value });
  $('btn-entrar').disabled = false;
  if (!r?.ok) { $('msg-entrar').textContent = r?.erro || 'Não foi possível entrar.'; return; }
  $('senha').value = '';
  mostrar();
});
$('senha').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-entrar').click(); });
$('btn-sair').addEventListener('click', async () => { await chrome.runtime.sendMessage({ tipo: 'SAIR' }); mostrar(); });
$('btn-enviar').addEventListener('click', async () => {
  $('btn-enviar').disabled = true;
  const r = await chrome.runtime.sendMessage({ tipo: 'ENVIAR_AGORA' });
  if (r && !r.ok && r.erro) { $('status').className = 'erro'; $('status').textContent = '❌ ' + r.erro; }
  mostrar();
});
$('intervalo').addEventListener('change', async () => {
  const { config = {} } = await chrome.storage.local.get('config');
  await chrome.storage.local.set({ config: { ...config, intervaloH: Number($('intervalo').value) } });
});
chrome.storage.onChanged.addListener((m) => { if (m.envio || m.sessao) mostrar(); });
mostrar();
