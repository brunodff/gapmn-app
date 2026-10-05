/**
 * Background dos subprocessos no SILOMS (siloms/subprocesso.js pede, aqui executa).
 *
 * O SILOMS (GeneXus) só aceita clique "de verdade": a função roda no mundo MAIN da
 * página (chrome.scripting), com o onclick chamado direto e jsEvent liberado. Os
 * quatro primeiros vieram do robô "Criador de Subprocessos" (extensao-siloms-subprocesso):
 *   GAPMN_POPUP_CLICK  link pelo texto no popup GeneXus
 *   GAPMN_PAG_OPEN     seta do PAG no formulário
 *   GAPMN_SAVE_FORM    botão verde de salvar
 *   GAPMN_PAG_SEL      escolhe o PAG no resultado do popup
 * Novos:
 *   SUBPROC_CLICK      clica o elemento marcado com data-gapmn-clique
 *   SUBPROC_EVAL       roda código na página (Chrome bloqueia o <script> injetado)
 *   SUBPROC_SET_FILE   põe o PDF guardado (runner/arquivos.js) no campo de arquivo
 *   SUBPROC_GSHEET     envia o resultado à planilha de controle (Apps Script)
 */
import { lerPdf, paraBase64 } from './arquivos.js';

const POPUP = /gxPopupLevel|GxPopup/i;

function frames(tabId) {
  return new Promise(res => chrome.webNavigation.getAllFrames({ tabId }, f => res(f ?? [])));
}

// O clique que escolhe o item fecha o popup: o frame some antes da resposta e o
// navegador acusa "Frame … was removed". Para quem pediu, isso é sucesso (o robô
// antigo tratava igual: { ok: true } sem `result` = clicou e o popup fechou).
const FRAME_REMOVIDO = Object.assign([], { removido: true });

async function rodar(tabId, frameIds, func, args = []) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames: true };
  try {
    return (await chrome.scripting.executeScript({ target, world: 'MAIN', func, args })) ?? [];
  } catch (e) {
    if (/frame.*(was )?removed|no frame with id/i.test(e?.message ?? '')) return FRAME_REMOVIDO;
    throw e;
  }
}

const resposta = r => (r.removido ? { ok: true } : { ok: true, result: r[0]?.result });

const primeiro = r => r.find(x => x && x.result != null && x.result !== 'nao-achou')?.result ?? 'nao-achou';

// ── Funções que rodam na página (autocontidas: são serializadas) ─────────────

function clicarLinkPorTexto(text) {
  const links = document.querySelectorAll('a');
  for (const el of links) {
    if ((el.textContent || '').trim().toLowerCase().indexOf(text) === -1) continue;
    const href = el.getAttribute('href') || '';
    const oc = el.getAttribute('onclick') || '';
    const code = oc || (href.indexOf('javascript:') === 0 ? href.slice(11) : '');
    try {
      if (code) { (new Function(code)).call(el); return 'gx:' + el.textContent.trim(); }
      el.click(); return 'click:' + el.textContent.trim();
    } catch (e) { return 'err:' + e.message; }
  }
  return 'notfound';
}

function abrirSetaPag() {
  const cells = document.querySelectorAll('td,th,label,span,b,div');
  for (const c of cells) {
    if (!/^pag:?$/i.test((c.textContent || '').trim())) continue;
    const row = c.closest ? c.closest('tr') : c.parentElement;
    if (!row) continue;
    const img = row.querySelector('img[src*="arrow" i],img[src*="seta" i],input[type=image],img');
    if (!img) continue;
    let el = img;
    for (let j = 0; j < 6 && el && el !== document.body; j++, el = el.parentElement) {
      const oc = (el.getAttribute && el.getAttribute('onclick')) || '';
      const href = (el.getAttribute && el.getAttribute('href')) || '';
      const code = oc || (href.indexOf('javascript:') === 0 ? href.slice(11) : '');
      if (code) { try { (new Function(code)).call(el); return 'gx:' + el.tagName; } catch (e) { return 'err:' + e.message; } }
    }
    img.click();
    return 'click:img';
  }
  const seta = document.querySelector('img[src*="arrow" i],img[src*="seta" i],input[type=image]');
  if (seta) { seta.click(); return 'fallback:anyArrow'; }
  return 'notfound';
}

function salvarFormulario() {
  const imgs = document.querySelectorAll('input[type="image"]');
  for (const el of imgs) {
    const src = (el.src || '').toLowerCase();
    if (!/(okay1|okay|confirm|commit|salv|check|btn_ok)/i.test(src)) continue;
    if (typeof gx !== 'undefined' && gx && gx.evt && typeof gx.evt.execEvt === 'function') {
      try { gx.evt.execEvt('EENTER.', el); return 'gx:execEvt:' + src.split('/').pop(); } catch (e) { /* segue */ }
    }
    const oc = el.getAttribute('onclick') || '';
    if (oc) { try { (new Function(oc)).call(el); return 'gx-oc:' + src.split('/').pop(); } catch (e) { /* segue */ } }
    el.click();
    return 'click:' + src.split('/').pop();
  }
  return 'notfound';
}

function escolherPag(pagNr) {
  const needle = pagNr.toLowerCase();
  for (const a of document.querySelectorAll('a[href], a[onclick]')) {
    const t = (a.textContent || '').trim();
    if (t.toLowerCase().indexOf(needle) === -1) continue;
    const href = a.getAttribute('href') || '';
    const oc = a.getAttribute('onclick') || '';
    const code = oc || (href.indexOf('javascript:') === 0 ? href.slice(11) : '');
    if (code) { try { (new Function(code)).call(a); return 'gx-link:' + t.substring(0, 40); } catch (e) { /* segue */ } }
    a.click(); return 'click-link:' + t.substring(0, 40);
  }
  for (const tr of document.querySelectorAll('tr')) {
    if ((tr.textContent || '').toLowerCase().indexOf(needle) === -1) continue;
    const alvo = tr.querySelector('img[onclick]') || tr.querySelector('input[type=image]') || tr.querySelector('img') || tr.querySelector('td[onclick]');
    if (!alvo) continue;
    let el = alvo;
    for (let j = 0; j < 4 && el && el !== document.body; j++, el = el.parentElement) {
      const oc = (el.getAttribute && el.getAttribute('onclick')) || '';
      const href = (el.getAttribute && el.getAttribute('href')) || '';
      const code = oc || (href.indexOf('javascript:') === 0 ? href.slice(11) : '');
      if (code) { try { (new Function(code)).call(el); return 'gx-tr:' + el.tagName; } catch (e) { /* segue */ } }
    }
    alvo.click(); return 'click-tr:' + alvo.tagName;
  }
  return 'notfound';
}

// Clique "GeneXus": jsEvent liberado e window.event com isTrusted
function clicarMarcado(marca) {
  const el = document.querySelector('[data-gapmn-clique="' + marca + '"]');
  if (!el) return null;   // não é este frame
  el.removeAttribute('data-gapmn-clique');
  const rests = [];
  const libera = w => {
    try {
      if (w && w.gx && w.gx.evt && w.gx.evt.jsEvent) {
        const p = w.gx.evt.jsEvent;
        w.gx.evt.jsEvent = function () { return true; };
        rests.push(() => { w.gx.evt.jsEvent = p; });
      }
    } catch (e) { /* frame de outra origem */ }
  };
  libera(window);
  try { libera(parent); } catch (e) { /* idem */ }
  try { libera(top); } catch (e) { /* idem */ }
  let forjado = false;
  try {
    Object.defineProperty(window, 'event', { get: () => ({ isTrusted: true, type: 'click', target: el, currentTarget: el }), configurable: true });
    forjado = true;
  } catch (e) { /* sem window.event */ }
  let como = 'nada';
  try {
    let code = el.getAttribute('onclick') || '';
    const href = el.getAttribute('href') || '';
    if (!code && /^javascript:/i.test(href)) code = href.slice(11);
    if (code) { (new Function(code)).call(el); como = 'onclick'; }
    else { el.click(); como = 'click'; }
  } catch (e) {
    try { el.click(); como = 'click-apos-erro'; } catch (e2) { como = 'falhou:' + e2.message; }
  } finally {
    rests.forEach(r => { try { r(); } catch (e) { /* ok */ } });
    if (forjado) { try { delete window.event; } catch (e) { /* ok */ } }
  }
  return como;
}

function rodarCodigo(code) {
  try { (new Function(code))(); return 'ok'; } catch (e) { return 'err:' + e.message; }
}

// Arquivo no input sem disparar change: o "validaPdf" do SILOMS navega no change.
// O GeneXus lê fileInput.files no envio (botão verde).
function porArquivo(marca, base64, nome) {
  const el = document.querySelector('[data-gapmn-arquivo="' + marca + '"]');
  if (!el) return null;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], nome, { type: 'application/pdf' }));
  el.files = dt.files;
  return 'arquivo:' + nome + ' (' + bytes.length + ' bytes)';
}

// ── Mensagens ─────────────────────────────────────────────────────────────────

async function tratar(msg, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) return { ok: false, erro: 'sem aba' };
  const todos = await frames(tabId);
  const popup = todos.find(f => POPUP.test(f.url));
  const porUrl = url => todos.find(f => url && f.url === url);

  switch (msg.type) {
    case 'GAPMN_POPUP_CLICK': {
      if (!popup) return { ok: false, reason: 'no popup frame' };
      return resposta(await rodar(tabId, [popup.frameId], clicarLinkPorTexto, [(msg.text || '').toLowerCase()]));
    }
    case 'GAPMN_PAG_OPEN': {
      const f = porUrl(msg.frameUrl) ?? todos.find(x => !POPUP.test(x.url));
      if (!f) return { ok: false, reason: 'frame not found' };
      return resposta(await rodar(tabId, [f.frameId], abrirSetaPag));
    }
    case 'GAPMN_SAVE_FORM': {
      const f = porUrl(msg.frameUrl) ?? todos.find(x => !POPUP.test(x.url) && x.frameId !== 0) ?? todos[0];
      if (!f) return { ok: false, reason: 'frame not found' };
      return resposta(await rodar(tabId, [f.frameId], salvarFormulario));
    }
    case 'GAPMN_PAG_SEL': {
      if (!popup) return { ok: false, reason: 'no popup' };
      return resposta(await rodar(tabId, [popup.frameId], escolherPag, [msg.pagNr || '']));
    }
    case 'SUBPROC_CLICK':
      return { ok: true, result: primeiro(await rodar(tabId, null, clicarMarcado, [msg.alvo])) };
    case 'SUBPROC_EVAL': {
      const f = porUrl(msg.frameUrl);
      return { ok: true, result: primeiro(await rodar(tabId, f ? [f.frameId] : [0], rodarCodigo, [msg.code])) };
    }
    case 'SUBPROC_SET_FILE': {
      const pdf = await lerPdf(msg.chave);
      if (!pdf) return { ok: false, erro: 'PDF não guardado (' + msg.chave + ')' };
      const result = primeiro(await rodar(tabId, null, porArquivo, [msg.alvo, paraBase64(pdf.dados), msg.nome || pdf.nome]));
      return result === 'nao-achou' ? { ok: false, erro: 'campo de arquivo não encontrado na página' } : { ok: true, result };
    }
    default:
      return null;
  }
}

export function registrarMensagensSubprocesso() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'SUBPROC_GSHEET') {
      // Apps Script: POST text/plain sem preflight; no-cors basta para entregar os dados
      fetch(msg.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(msg.corpo) })
        .then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, erro: e.message }));
      return true;
    }
    if (!/^(GAPMN_(POPUP_CLICK|PAG_OPEN|SAVE_FORM|PAG_SEL)|SUBPROC_(CLICK|EVAL|SET_FILE))$/.test(msg.type)) return false;
    tratar(msg, sender).then(r => sendResponse(r ?? { ok: false }), e => sendResponse({ ok: false, erro: e.message }));
    return true;
  });
}
