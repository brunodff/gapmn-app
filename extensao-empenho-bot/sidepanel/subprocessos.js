/**
 * Tela "Subprocessos no SILOMS": depois da fila de empenhos, um subprocesso por
 * solicitação empenhada, com o PDF da solicitação e o da declaração do SICAF.
 *
 * O trabalho no SILOMS é do content script siloms/subprocesso.js, na aba do SILOMS
 * (lista "Documentos na Unidade"). Aqui: montar a fila a partir dos empenhos
 * gerados, conferir os PDFs guardados, configurar e acompanhar o andamento, que
 * chega pelo storage (subproc_prog / subproc_log / subproc_resultado).
 */
import { pdfsGuardados, chaveSolicitacao, chaveSicaf } from '../runner/arquivos.js';
import { UG_POR_UNIDADE } from './ugPorUnidade.js';
import { abaDoSicaf, conferirNoSicaf, fmtCnpj } from './sicaf.js';

const REGISTRO_KEY = 'empenhosGerados';            // o mesmo de runner/stateMachine.js
const CONFIG_KEY = 'subproc_config';
const PADRAO = {
  epag: 'GAP-MN',
  fluxo: 'SEO/ACI - SOLICITAÇÃO DE EMPENHO / APOIADAS',
  planilha: '',          // endereço do Apps Script da planilha de controle (opcional)
  responsaveis: [],      // [{ nome, peso }] — sorteado por peso para cada subprocesso
};
const DIAS_PADRAO = 7;   // empenhos mais recentes que isso já vêm marcados

let ctx = null;          // { el, showScreen, escHtml, voltar }
let itens = [];
let config = { ...PADRAO };
let rodando = false;
let abaSiloms = null;

const el = id => ctx.el(id);
const esc = s => ctx.escHtml(String(s ?? ''));

const SIGLA_POR_UG = Object.fromEntries(Object.entries(UG_POR_UNIDADE).map(([sigla, ug]) => [ug, sigla]));

// "Solicitação de Empenho 26S1603 - HAMN - 2026NE001547" (a NE só depois de emitida)
function nomePadrao(numero, ugCred, ne) {
  const sigla = SIGLA_POR_UG[String(ugCred ?? '').trim()] ?? String(ugCred ?? '').trim();
  const nota = /^\d{4}NE\d{6}$/.test(String(ne ?? '').trim()) ? String(ne).trim() : '';
  return `Solicitação de Empenho ${numero}${sigla ? ` - ${sigla}` : ''}${nota ? ` - ${nota}` : ''}`;
}

function sortearResponsavel() {
  const lista = config.responsaveis.filter(r => r.nome && r.peso > 0);
  const total = lista.reduce((s, r) => s + r.peso, 0);
  if (!total) return '';
  let n = Math.random() * total;
  for (const r of lista) { if ((n -= r.peso) < 0) return r.nome; }
  return lista[lista.length - 1].nome;
}

// ── Fila: empenhos gerados ──────────────────────────────────────────────────

async function carregarItens() {
  const d = await chrome.storage.local.get([REGISTRO_KEY, CONFIG_KEY]);
  config = { ...PADRAO, ...(d[CONFIG_KEY] ?? {}) };
  // Todas as solicitações do registro — empenhadas e também as não empenhadas (o
  // subprocesso pode ser aberto mesmo sem NE). De cada solicitação vale o melhor
  // registro (emitida > em processamento > conferir > não empenhada) e, no empate, o
  // mais recente.
  const PRIORIDADE = { emitido: 4, pendente: 3, conferir: 2, falhou: 1 };
  const porSol = new Map();
  for (const r of d[REGISTRO_KEY] ?? []) {
    const st = r.status ?? 'conferir';
    if (!r.solicitacao || !PRIORIDADE[st]) continue;
    const atual = porSol.get(r.solicitacao);
    if (!atual || PRIORIDADE[st] >= PRIORIDADE[atual.status ?? 'conferir']) porSol.set(r.solicitacao, r);
  }
  const lista = [...porSol.values()].sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const antigos = itens;
  itens = lista.map(r => {
    const ja = antigos.find(i => i.numero === r.solicitacao);
    const st = r.status ?? 'conferir';
    const empenhada = st === 'emitido' || st === 'pendente';
    const ne = st === 'emitido' ? r.ne : st === 'pendente' ? 'NE em processamento' : st === 'falhou' ? 'não empenhada' : 'conferir no CNET';
    const neReal = st === 'emitido' && /^\d{4}NE\d{6}$/.test(String(r.ne ?? '')) ? r.ne : '';
    // Nome editado à mão fica; o padrão acompanha a NE (que chega depois da emissão)
    const padrao = nomePadrao(r.solicitacao, r.ugCred, neReal);
    return {
      id: r.id, numero: r.solicitacao, ne, neReal, empenhada,
      motivo: empenhada ? '' : String(r.motivo ?? '').replace(/\s+/g, ' ').slice(0, 110),
      fornecedor: r.fornecedor ?? '', cnpj: String(r.cnpj ?? '').replace(/\D/g, ''),
      pag: ja?.pag ?? r.pag ?? '', nome: ja && ja.nome !== ja.padrao ? ja.nome : padrao, padrao,
      subprocesso: r.subprocesso ?? '', data: r.data,
      // Acabou de ganhar subprocesso: desmarca (outro clique em Criar duplicaria).
      // Não empenhada vem desmarcada: só vai se a pessoa marcar.
      marcado: r.subprocesso && !ja?.subprocesso ? false
        : ja ? ja.marcado : (empenhada && !r.subprocesso && Date.now() - new Date(r.data).getTime() < DIAS_PADRAO * 86400000),
    };
  });
  const guardados = await pdfsGuardados(itens.flatMap(i => [chaveSolicitacao(i.numero), chaveSicaf(i.cnpj)]));
  for (const i of itens) {
    i.temSol = !!guardados[chaveSolicitacao(i.numero)];
    i.temSicaf = !!(i.cnpj && guardados[chaveSicaf(i.cnpj)]);
  }
}

function renderLista() {
  const box = el('sp-lista');
  if (!itens.length) {
    box.innerHTML = '<div class="sp-vazio">Nenhuma solicitação registrada. As solicitações processadas pelo robô (empenhadas ou não) aparecem aqui.</div>';
    renderResumo();
    return;
  }
  box.innerHTML = itens.map((i, k) => `
    <div class="sp-item${i.marcado ? '' : ' sp-off'}" data-k="${k}">
      <label class="sp-l1"><input type="checkbox" class="sp-chk" ${i.marcado ? 'checked' : ''} ${rodando ? 'disabled' : ''}>
        <b>${esc(i.numero)}</b> → ${i.empenhada ? esc(i.ne) : `<span class="sp-nao-emp">${esc(i.ne)}</span>`}<span class="sp-forn">${esc(i.fornecedor)}</span></label>
      ${!i.empenhada ? `<div class="sp-aviso">${i.motivo ? `motivo: ${esc(i.motivo)} — ` : ''}marque se quiser abrir o subprocesso mesmo assim</div>` : ''}
      ${i.subprocesso ? `<div class="sp-aviso">já tem subprocesso ${esc(i.subprocesso)} — marque só se quiser criar outro</div>` : ''}
      <div class="sp-campos">
        <label>PAG <input class="sp-pag form-input" value="${esc(i.pag)}" placeholder="não veio no PDF" ${rodando ? 'disabled' : ''}></label>
        <label>Nome <input class="sp-nome form-input" value="${esc(i.nome)}" ${rodando ? 'disabled' : ''}></label>
      </div>
      <div class="sp-docs">
        <span class="${i.temSol ? 'sp-ok' : 'sp-falta'}">📄 Solicitação ${i.temSol ? '✓' : '— PDF não guardado'}</span>
        <span class="${i.temSicaf ? 'sp-ok' : 'sp-falta'}">🧾 SICAF ${i.temSicaf ? '✓' : (i.cnpj ? '— falta' : '— sem CNPJ')}</span>
      </div>
    </div>`).join('');
  renderResumo();
}

function renderResumo() {
  const sel = itens.filter(i => i.marcado);
  const semPag = sel.filter(i => !i.pag.trim()).length;
  const semSol = sel.filter(i => !i.temSol).length;
  const semSicaf = sel.filter(i => !i.temSicaf).length;
  const partes = [`${sel.length} selecionada(s)`];
  if (semPag) partes.push(`<b class="sp-falta">${semPag} sem PAG</b>`);
  if (semSol) partes.push(`${semSol} sem o PDF da solicitação`);
  if (semSicaf) partes.push(`${semSicaf} sem a declaração do SICAF`);
  el('sp-resumo').innerHTML = partes.join(' · ');
  el('sp-btn-sicaf').style.display = semSicaf && !rodando ? '' : 'none';
  el('sp-btn-criar').disabled = rodando || !sel.length || !!semPag;
}

// ── SILOMS e SICAF ───────────────────────────────────────────────────────────

async function conferirSiloms() {
  const abas = await chrome.tabs.query({ url: '*://*.siloms.intraer/*' });
  abaSiloms = abas.find(a => a.active) ?? abas[0] ?? null;
  let texto, tipo;
  if (!abaSiloms) {
    texto = 'Abra o SILOMS numa aba e entre em "Documentos na Unidade" (a lista com o botão Novo Subprocesso).'; tipo = 'aviso';
  } else {
    const r = await chrome.tabs.sendMessage(abaSiloms.id, { type: 'SUBPROC_PING' }).catch(() => null);
    if (!r?.ok) { texto = 'A aba do SILOMS não respondeu — recarregue-a (F5) depois de recarregar a extensão.'; tipo = 'aviso'; }
    else if (r.running) { texto = 'Criando subprocessos na aba do SILOMS…'; tipo = 'info'; }
    else if (r.pagina === 'list') { texto = 'SILOMS pronto: lista "Documentos na Unidade" aberta.'; tipo = 'ok'; }
    else { texto = 'Na aba do SILOMS, abra "Documentos na Unidade" (a lista com o botão Novo Subprocesso).'; tipo = 'aviso'; }
  }
  const m = el('sp-siloms');
  m.textContent = texto;
  m.className = 'sp-msg sp-' + tipo;
}

async function baixarSicafQueFaltam() {
  const faltam = [...new Set(itens.filter(i => i.marcado && !i.temSicaf && i.cnpj.length === 14).map(i => i.cnpj))];
  if (!faltam.length) return;
  if (!(await abaDoSicaf())) {
    alert('Abra o SICAF numa aba e faça login (gov.br). O robô baixa a declaração de cada fornecedor por lá.');
    return;
  }
  const b = el('sp-btn-sicaf');
  b.disabled = true;
  for (let n = 0; n < faltam.length; n++) {
    b.textContent = `🔎 SICAF ${n + 1}/${faltam.length} — ${fmtCnpj(faltam[n])}…`;
    await conferirNoSicaf(faltam[n], { forcar: true, aoAvancar: e => { b.textContent = `🔎 SICAF ${n + 1}/${faltam.length} — ${e}…`; } });
  }
  b.disabled = false;
  b.textContent = '🔎 Baixar do SICAF as declarações que faltam';
  await carregarItens();
  renderLista();
}

// ── Configuração ─────────────────────────────────────────────────────────────

async function salvarConfig() {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

function renderConfig() {
  el('sp-cfg-epag').value = config.epag;
  el('sp-cfg-fluxo').value = config.fluxo;
  el('sp-cfg-planilha').value = config.planilha;
  const total = config.responsaveis.reduce((s, r) => s + (r.peso || 0), 0);
  el('sp-resp-lista').innerHTML = config.responsaveis.length
    ? config.responsaveis.map((r, k) => `<div class="sp-resp"><span>${esc(r.nome)}</span>
        <span class="sp-pct">${total ? Math.round(r.peso / total * 100) : 0}%</span>
        <button class="sp-resp-rm eg-btn eg-btn-danger" data-k="${k}" title="Remover">✕</button></div>`).join('')
    : '<div class="sp-dica">Nenhum responsável — o subprocesso vai sem responsável para a planilha.</div>';
}

// ── Criar ────────────────────────────────────────────────────────────────────

async function criar() {
  const sel = itens.filter(i => i.marcado);
  if (!sel.length) return;
  if (sel.some(i => !i.pag.trim())) { alert('Preencha o PAG das solicitações marcadas.'); return; }
  const semDoc = sel.filter(i => !i.temSol || !i.temSicaf);
  if (semDoc.length && !confirm(`${semDoc.length} subprocesso(s) vão sem algum dos documentos:\n\n` +
      semDoc.map(i => `• ${i.numero}: ${[!i.temSol && 'solicitação', !i.temSicaf && 'SICAF'].filter(Boolean).join(' e ')}`).join('\n') +
      '\n\nOK: criar assim mesmo · Cancelar: voltar')) return;
  await conferirSiloms();
  if (!abaSiloms) { alert(el('sp-siloms').textContent); return; }

  const fila = sel.map(i => ({
    numero: i.numero, nome: i.nome.trim(), pag: i.pag.trim(), ne: i.neReal, responsavel: sortearResponsavel(),
    docs: [
      { tipo: 'sol', rotulo: 'solicitação', chave: chaveSolicitacao(i.numero), disponivel: i.temSol,
        arquivo: `Solicitacao_de_Empenho_${i.numero}.pdf`, assunto: `Solicitação de Empenho ${i.numero}` },
      { tipo: 'sicaf', rotulo: 'declaração do SICAF', chave: chaveSicaf(i.cnpj), disponivel: i.temSicaf,
        arquivo: `SICAF_${i.cnpj || 'sem_cnpj'}.pdf`, assunto: `Declaração SICAF - ${i.fornecedor}`.slice(0, 120) },
    ],
  }));
  // Aba em primeiro plano: em segundo plano o navegador atrasa os tempos do robô
  try { await chrome.tabs.update(abaSiloms.id, { active: true }); } catch { /* segue */ }
  const r = await chrome.tabs.sendMessage(abaSiloms.id, {
    type: 'SUBPROC_INICIAR', items: fila,
    config: { epag: config.epag, fluxo: config.fluxo, planilha: config.planilha },
  }).catch(e => ({ ok: false, erro: e.message }));
  if (!r?.ok) { mostrarMsg('Não iniciou: ' + (r?.erro || 'a aba do SILOMS não respondeu — recarregue-a (F5)'), 'erro'); return; }
  el('sp-resultado').innerHTML = '';
  mostrarMsg(`Criando ${fila.length} subprocesso(s)… acompanhe abaixo. Não mexa na aba do SILOMS enquanto o robô trabalha.`, 'info');
}

async function parar() {
  const abas = await chrome.tabs.query({ url: '*://*.siloms.intraer/*' });
  for (const a of abas) await chrome.tabs.sendMessage(a.id, { type: 'SUBPROC_ABORTAR' }).catch(() => {});
}

function mostrarMsg(texto, tipo) {
  const m = el('sp-andamento');
  m.textContent = texto;
  m.className = 'sp-msg sp-' + tipo;
  m.style.display = texto ? '' : 'none';
}

// ── Andamento (vem da aba do SILOMS pelo storage) ────────────────────────────

function mostrarProg(p) {
  rodando = !!p?.running;
  el('sp-btn-criar').style.display = rodando ? 'none' : '';
  el('sp-btn-parar').style.display = rodando ? '' : 'none';
  const barra = el('sp-barra');
  barra.style.display = rodando ? '' : 'none';
  if (p?.total) barra.firstElementChild.style.width = Math.round(p.cur / p.total * 100) + '%';
  if (p?.sub) mostrarMsg((rodando && p.total ? `${p.cur} de ${p.total} — ` : '') + p.sub, rodando ? 'info' : p.concluido ? 'ok' : 'aviso');
  renderLista();
}

function mostrarLog(linhas) {
  const box = el('sp-log');
  box.style.display = linhas?.length ? '' : 'none';
  box.innerHTML = (linhas ?? []).map(l => `<div class="log-line log-${l.lvl === 'err' ? 'error' : l.lvl === 'ok' ? 'success' : l.lvl === 'warn' ? 'warn' : 'info'}">${esc(l.line)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

const ROTULO_DOC = { sol: 'Solicitação', sicaf: 'SICAF' };
const ICONE = { ok: '✓', faltou: '— faltou o PDF', erro: '✗', conferir: '⚠ conferir', enviado: '⚠ conferir' };

async function mostrarResultado(r) {
  const box = el('sp-resultado');
  if (!r?.results?.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="sp-res-titulo">RESULTADO</div>` + r.results.map(x => {
    const erro = String(x.docNr).startsWith('ERRO');
    return `<div class="sp-res ${erro ? 'sp-res-erro' : ''}">
      <div><b>${esc(x.numero)}</b> → ${erro ? `<span class="sp-falta">${esc(x.docNr.replace(/^ERRO:\s*/, ''))}</span>` : `subprocesso <b>${esc(x.docNr)}</b>`}
        ${x.responsavel ? `<span class="sp-forn">${esc(x.responsavel)}</span>` : ''}</div>
      ${(x.docs ?? []).map(d => `<div class="sp-res-doc ${d.status === 'ok' ? 'sp-ok' : 'sp-falta'}">${ROTULO_DOC[d.tipo] ?? d.tipo}: ${ICONE[d.status] ?? d.status}${d.motivo ? ` — ${esc(d.motivo)}` : ''}</div>`).join('')}
    </div>`;
  }).join('');
  // Anota o subprocesso no registro dos empenhos (a fila seguinte já sabe)
  const d = await chrome.storage.local.get(REGISTRO_KEY);
  const criados = new Map(r.results.filter(x => !String(x.docNr).startsWith('ERRO')).map(x => [x.numero, x]));
  if (criados.size) {
    // Todos os registros da solicitação (também os de não empenhada: a lista avisa
    // "já tem subprocesso" e não deixa criar outro sem querer)
    const lista = (d[REGISTRO_KEY] ?? []).map(reg => criados.has(reg.solicitacao)
      ? { ...reg, subprocesso: criados.get(reg.solicitacao).docNr,
          subprocessoDocs: (criados.get(reg.solicitacao).docs ?? []).map(x => `${ROTULO_DOC[x.tipo] ?? x.tipo}: ${x.status}`).join(', ') }
      : reg);
    await chrome.storage.local.set({ [REGISTRO_KEY]: lista });
  }
}

// ── Montagem ─────────────────────────────────────────────────────────────────

export function setupSubprocessos(contexto) {
  ctx = contexto;
  el('sp-voltar').addEventListener('click', () => ctx.voltar());
  el('sp-btn-criar').addEventListener('click', criar);
  el('sp-btn-parar').addEventListener('click', parar);
  el('sp-btn-sicaf').addEventListener('click', baixarSicafQueFaltam);
  el('sp-btn-recarregar').addEventListener('click', async () => { await carregarItens(); renderLista(); conferirSiloms(); });

  el('sp-lista').addEventListener('change', e => {
    const card = e.target.closest('.sp-item');
    if (!card) return;
    const i = itens[Number(card.dataset.k)];
    if (e.target.classList.contains('sp-chk')) { i.marcado = e.target.checked; card.classList.toggle('sp-off', !i.marcado); }
    renderResumo();
  });
  el('sp-lista').addEventListener('input', e => {
    const card = e.target.closest('.sp-item');
    if (!card) return;
    const i = itens[Number(card.dataset.k)];
    if (e.target.classList.contains('sp-pag')) i.pag = e.target.value;
    if (e.target.classList.contains('sp-nome')) i.nome = e.target.value;
    renderResumo();
  });

  for (const [id, campo] of [['sp-cfg-epag', 'epag'], ['sp-cfg-fluxo', 'fluxo'], ['sp-cfg-planilha', 'planilha']]) {
    el(id).addEventListener('change', () => { config[campo] = el(id).value.trim() || PADRAO[campo]; salvarConfig(); });
  }
  el('sp-resp-add').addEventListener('click', () => {
    const nome = el('sp-resp-nome').value.trim().toUpperCase();
    const peso = Math.max(1, parseInt(el('sp-resp-peso').value, 10) || 0);
    if (!nome) return;
    config.responsaveis = [...config.responsaveis.filter(r => r.nome !== nome), { nome, peso }];
    el('sp-resp-nome').value = '';
    salvarConfig();
    renderConfig();
  });
  el('sp-resp-lista').addEventListener('click', e => {
    const b = e.target.closest('.sp-resp-rm');
    if (!b) return;
    config.responsaveis.splice(Number(b.dataset.k), 1);
    salvarConfig();
    renderConfig();
  });

  chrome.storage.onChanged.addListener((mud, area) => {
    if (area !== 'local') return;
    if (mud.subproc_prog) mostrarProg(mud.subproc_prog.newValue);
    if (mud.subproc_log) mostrarLog(mud.subproc_log.newValue);
    if (mud.subproc_resultado) mostrarResultado(mud.subproc_resultado.newValue).then(async () => { await carregarItens(); renderLista(); });
  });
}

export async function abrirSubprocessos() {
  ctx.showScreen('subprocessos');
  await carregarItens();
  renderConfig();
  const d = await chrome.storage.local.get(['subproc_prog', 'subproc_log', 'subproc_resultado']);
  mostrarLog(d.subproc_log);
  await mostrarResultado(d.subproc_resultado);
  // Andamento salvo de antes só vale como "em andamento" se a aba confirmar
  rodando = false;
  renderLista();
  await conferirSiloms();
  const r = abaSiloms ? await chrome.tabs.sendMessage(abaSiloms.id, { type: 'SUBPROC_PING' }).catch(() => null) : null;
  mostrarProg({ ...(d.subproc_prog ?? {}), running: !!r?.running });
}
