/**
 * Certidões do fornecedor pelo SICAF, com a sessão do próprio usuário.
 *
 * As certidões (Receita Federal/PGFN, FGTS, Trabalhista, estadual e municipal)
 * só aparecem na "Situação do Fornecedor" do SICAF, que exige login gov.br — o
 * MCP só dá a situação cadastral do CNPJ, que é outra coisa. Duas formas:
 *   1. Aba do SICAF aberta e logada: o robô abre Consultar Situação do
 *      Fornecedor, pesquisa o CNPJ, guarda os avisos do SICAF (ex.: "Fornecedor
 *      não possui certidão vigente na Receita Federal do Brasil.") e baixa o PDF
 *      da declaração pela própria página;
 *   2. PDF da declaração arrastado para o painel (consultarSituacaoFornecedor_*.pdf).
 */
import { extractPdfText } from '../runner/pdfParser.js';

export const SICAF_ORIGEM = 'https://www3.comprasnet.gov.br';
export const SICAF_CONSULTA = `${SICAF_ORIGEM}/sicaf-web/private/geral/consultarSituacaoFornecedor.jsf`;

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const dorme = ms => new Promise(r => setTimeout(r, ms));
export const fmtCnpj = c => String(c ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

// Fim do dia (a certidão vale até o último dia da validade)
function dataBR(s) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s ?? ''));
  return m ? new Date(+m[3], +m[2] - 1, +m[1], 23, 59, 59) : null;
}

// ── Declaração (PDF "Situação do Fornecedor") ─────────────────────────────────

const CERTIDOES = [
  // chave, nome, rótulo no PDF, federal (exigida para empenhar)
  ['receita',     'Receita Federal/PGFN',       /^Receita Federal e PGFN\b/i, true],
  ['fgts',        'FGTS',                       /^FGTS\b/i,                   true],
  ['trabalhista', 'Trabalhista (CNDT)',         /^Trabalhista\b/i,            true],
  ['estadual',    'Receita Estadual/Distrital', /^Receita Estadual/i,         false],
  ['municipal',   'Receita Municipal',          /^Receita Municipal/i,        false],
];

/** Lê o texto da declaração do SICAF. Devolve null se o texto não for uma. */
export function lerDeclaracaoSicaf(texto) {
  const t = String(texto ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  if (!/Situa[çc][ãa]o do Fornecedor\s*:/i.test(t) || !/N[íi]veis cadastrados/i.test(t)) return null;
  const linhas = t.split('\n').map(l => l.trim()).filter(Boolean);
  const valor = re => { for (const l of linhas) { const m = re.exec(l); if (m) return m[1].trim(); } return ''; };

  const certidoes = CERTIDOES.map(([chave, nome, rotulo, federal]) => {
    const i = linhas.findIndex(l => rotulo.test(l));
    if (i < 0) return { chave, nome, federal, estado: 'ausente' };
    if (/\(Isent[oa]\)/i.test(linhas[i])) return { chave, nome, federal, estado: 'isenta' };
    // A validade às vezes cai na linha de baixo
    const proxima = /^Validade:/i.test(linhas[i + 1] ?? '') ? linhas[i + 1] : '';
    const trecho = /Validade:/i.test(linhas[i]) ? linhas[i] : proxima;
    const validade = /Validade:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(trecho)?.[1] ?? '';
    return { chave, nome, federal, validade, marcadaVencida: /\(\*\)/.test(trecho), estado: validade ? 'lida' : 'sem-data' };
  });

  return {
    cnpj:               (/CNPJ:\s*([\d.\/-]{14,18})/.exec(t)?.[1] ?? '').replace(/\D/g, ''),
    razaoSocial:        valor(/^Raz[ãa]o Social:\s*(.+)$/i),
    situacao:           valor(/^Situa[çc][ãa]o do Fornecedor:\s*(.+?)(?:\s+Data de Vencimento.*)?$/i),
    vencimentoCadastro: /Data de Vencimento do Cadastro:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1] ?? '',
    ocorrencia:         valor(/^Ocorr[êe]ncia:\s*(.+)$/i),
    impedimento:        valor(/^Impedimento de Licitar:\s*(.+)$/i),
    indiretas:          valor(/^Ocorr[êe]ncias Impeditivas indiretas:\s*(.+)$/i),
    vinculo:            valor(/^V[íi]nculo com .Servi[çc]o P[úu]blico.:\s*(.+)$/i),
    emitidoEm:          /Emitido em:\s*(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2})?)/i.exec(t)?.[1] ?? '',
    certidoes,
  };
}

const consta = v => !!v && norm(v) !== 'NADA CONSTA';

/**
 * Regras sobre a declaração. Certidão federal (Receita/PGFN, FGTS, Trabalhista)
 * vencida bloqueia o empenho; estadual/municipal vencida e ocorrências não
 * impeditivas só pedem atenção.
 */
export function classificarDeclaracao(d, hoje = new Date()) {
  const itens = [];
  const add = (nivel, texto) => itens.push({ nivel, texto });

  if (consta(d.impedimento)) add('bloqueio', `SICAF: impedimento de licitar — ${d.impedimento}`);
  const validas = [];
  for (const c of d.certidoes) {
    if (c.estado === 'isenta') continue;
    if (c.estado !== 'lida') {
      if (c.federal) add('atencao', `SICAF: certidão ${c.nome} não consta na declaração — confira no site emissor`);
      continue;
    }
    if (c.marcadaVencida || dataBR(c.validade) < hoje) {
      add(c.federal ? 'bloqueio' : 'atencao', `SICAF: certidão ${c.nome} vencida (validade ${c.validade})`);
    } else if (c.federal) {
      validas.push(`${c.nome} até ${c.validade}`);
    }
  }
  if (consta(d.ocorrencia)) add('atencao', 'SICAF: há ocorrência registrada (não impeditiva) — veja "Ocorrências Ativas" no SICAF');
  if (consta(d.indiretas)) add('atencao', `SICAF: ocorrências impeditivas indiretas — ${d.indiretas}`);
  if (consta(d.vinculo)) add('atencao', `SICAF: vínculo com serviço público — ${d.vinculo}`);
  const fimCadastro = dataBR(d.vencimentoCadastro);
  if (fimCadastro && fimCadastro < hoje) add('atencao', `SICAF: cadastro vencido em ${d.vencimentoCadastro}`);
  // A declaração vale para o dia em que foi emitida (PDF antigo arrastado)
  const emitida = dataBR(d.emitidoEm);
  if (emitida && hoje - emitida > 2 * 86400000) add('atencao', `Declaração do SICAF emitida em ${d.emitidoEm.slice(0, 10)} — emita uma atual`);

  return { itens, validas };
}

/** Avisos que o SICAF mostra ao pesquisar o CNPJ (growl/mensagens da página). */
export function classificarMensagensSicaf(mensagens) {
  const itens = [];
  for (const { texto, tipo } of mensagens ?? []) {
    const n = norm(texto);
    if (!n) continue;
    const grave = /CERTIDAO|IMPEDID|INIDONE|SUSPENS|IRREGULAR|VENCID|PENDENCI/.test(n);
    if (tipo === 'info' && !grave) continue;
    // Certidão federal (Receita/PGFN, FGTS, Trabalhista) ou impedimento: bloqueia
    const bloqueia = /IMPEDID|INIDONE|SUSPENS/.test(n) ||
      (/NAO POSSUI CERTIDAO|CERTIDAO .*VENCID/.test(n) && !/ESTADUAL|MUNICIPAL|DISTRITAL/.test(n));
    const texto2 = `SICAF: ${String(texto).trim()}`;
    if (!itens.some(i => i.texto === texto2)) itens.push({ nivel: bloqueia ? 'bloqueio' : 'atencao', texto: texto2 });
  }
  return itens;
}

/** Junta declaração + avisos num resultado para o painel. */
export function resultadoSicaf({ declaracao = null, mensagens = [], origem, hoje = new Date() }) {
  const itens = classificarMensagensSicaf(mensagens);
  let validas = [];
  if (declaracao) {
    const r = classificarDeclaracao(declaracao, hoje);
    validas = r.validas;
    for (const i of r.itens) if (!itens.some(x => x.texto === i.texto)) itens.push(i);
  } else {
    itens.push({ nivel: 'atencao', texto: 'SICAF: declaração (PDF) não obtida — certidões não conferidas uma a uma' });
  }
  const nivel = itens.some(i => i.nivel === 'bloqueio') ? 'bloqueio' : itens.some(i => i.nivel === 'atencao') ? 'atencao' : 'ok';
  const resumo = nivel === 'ok'
    ? `certidões federais válidas no SICAF (${validas.join(' · ')})`
    : itens.filter(i => i.nivel === nivel).map(i => i.texto).join(' · ');
  return {
    estado: 'ok', origem, nivel, resumo, itens, validas,
    emitidoEm: declaracao?.emitidoEm ?? '', razaoSocial: declaracao?.razaoSocial ?? '',
    consultadoEm: new Date().toISOString(),
  };
}

// ── Automação da aba do SICAF ─────────────────────────────────────────────────
// As funções "pagina*" rodam no mundo MAIN da aba via chrome.scripting: precisam
// ser autocontidas (são serializadas), sem nada de fora delas.

/** Etapa A: preenche o CNPJ e clica em Pesquisar. */
async function paginaPesquisar(cnpj) {
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const visivel = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const emMenu = e => !!e.closest('nav, header, [role="menu"], [role="menubar"], .ui-menu, .ui-menubar, .ui-tieredmenu, .ui-panelmenu, .ui-breadcrumb, .breadcrumb, .menu, .navbar, .dropdown-menu, #menu');
  const rotulo = e => {
    const porFor = e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`) : null;
    return (porFor ?? e.closest('label'))?.textContent ??
      e.closest('td, .form-group, .ui-g-12, [class*="col"]')?.previousElementSibling?.textContent ??
      e.parentElement?.textContent ?? '';
  };
  const diag = () => ({
    url: location.href,
    titulo: document.title,
    campos: Array.from(document.querySelectorAll('input, select, textarea')).filter(i => i.type !== 'hidden').slice(0, 30)
      .map(i => `${i.tagName.toLowerCase()}[type=${i.type}] id=${i.id} name=${i.name} rótulo="${norm(rotulo(i)).slice(0, 40)}"${visivel(i) ? '' : ' (oculto)'}`),
    botoes: Array.from(document.querySelectorAll('button, input[type=submit], input[type=button], a')).filter(visivel).slice(0, 60)
      .map(b => `${b.tagName.toLowerCase()} id=${b.id} "${norm(b.textContent || b.value).slice(0, 40)}"${emMenu(b) ? ' (menu)' : ''}`),
  });

  const cnpjFmt = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

  // Pessoa Jurídica (PrimeFaces desenha a caixa num div; o input fica oculto)
  const pj = Array.from(document.querySelectorAll('input[type=radio]')).find(r => /JURIDICA/.test(norm(rotulo(r))));
  if (pj && !pj.checked) {
    (pj.closest('.ui-radiobutton')?.querySelector('.ui-radiobutton-box') ?? pj).click();
    await dorme(900);
  }

  const campos = () => Array.from(document.querySelectorAll('input[type=text], input:not([type]), input[type=tel], input[type=search]'))
    .filter(i => visivel(i) && !i.disabled && !i.readOnly && !emMenu(i));
  const lista = campos();
  const campo = lista.find(i => /cnpj|cpfcnpj|cpf_cnpj|documento|identifica/i.test(`${i.id} ${i.name}`)) ??
    lista.find(i => /CNPJ/.test(norm(rotulo(i)))) ?? (lista.length === 1 ? lista[0] : null);
  if (!campo) return { ok: false, detalhe: 'não achei o campo do CNPJ na página de consulta', diagnostico: diag() };

  // Campo com máscara: valor direto, API da máscara ou digitação simulada
  const $ = window.jQuery || window.$;
  const ok = () => campo.value.replace(/\D/g, '') === cnpj;
  campo.focus();
  campo.value = cnpjFmt;
  for (const ev of ['input', 'keyup', 'change']) campo.dispatchEvent(new Event(ev, { bubbles: true }));
  await dorme(250);
  if (!ok() && campo.inputmask?.setValue) { campo.inputmask.setValue(cnpjFmt); await dorme(250); }
  if (!ok() && $) { $(campo).val(cnpjFmt).trigger('input').trigger('change'); await dorme(250); }
  if (!ok() && $) {
    $(campo).val('').trigger('focus');
    for (const ch of cnpj) {
      const code = ch.charCodeAt(0);
      $(campo).trigger($.Event('keydown', { which: code, keyCode: code }));
      $(campo).trigger($.Event('keypress', { which: code, keyCode: code, charCode: code }));
      $(campo).trigger($.Event('keyup', { which: code, keyCode: code }));
    }
    await dorme(250);
  }
  if (!ok()) return { ok: false, detalhe: `o campo do CNPJ não aceitou o número (ficou "${campo.value}")`, diagnostico: diag() };
  campo.dispatchEvent(new Event('blur', { bubbles: true }));

  const botoes = Array.from(document.querySelectorAll('button, input[type=submit], input[type=button], a, [role=button]')).filter(b => visivel(b) && !emMenu(b));
  const texto = b => norm(b.textContent || b.value || b.title);
  const btn = botoes.find(b => /^(PESQUISAR|CONSULTAR|BUSCAR)$/.test(texto(b))) ?? botoes.find(b => /PESQUISAR|CONSULTAR/.test(texto(b)));
  if (!btn) return { ok: false, detalhe: 'não achei o botão Pesquisar', diagnostico: diag() };

  // Guarda os avisos que aparecerem (o growl some em poucos segundos)
  window.__gapmnSicafMsgs = [];
  const SEL = '.ui-growl-item, .ui-messages-warn, .ui-messages-error, .ui-messages-fatal, .ui-messages-info, .ui-message, [role="alert"], .alert, .br-message';
  // Avisos de antes da pesquisa não contam (banner fixo da página). Os textos vão
  // para o sessionStorage porque o Pesquisar pode recarregar a página.
  window.__gapmnSicafVistos = new WeakSet(document.querySelectorAll(SEL));
  try {
    const antes = Array.from(document.querySelectorAll(SEL)).map(m => (m.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    sessionStorage.setItem('gapmnSicafAntes', JSON.stringify(antes));
  } catch { /* sessionStorage bloqueado */ }
  const coletar = () => {
    for (const m of document.querySelectorAll(SEL)) {
      if (window.__gapmnSicafVistos.has(m)) continue;
      const t = (m.textContent ?? '').replace(/\s+/g, ' ').trim();
      const c = `${m.className} ${m.closest('[class*="warn"], [class*="error"], [class*="fatal"], [class*="info"]')?.className ?? ''}`;
      const tipo = /error|fatal|danger/i.test(c) ? 'erro' : /warn/i.test(c) ? 'aviso' : /info|success/i.test(c) ? 'info' : 'aviso';
      if (t && !window.__gapmnSicafMsgs.some(x => x.texto === t)) window.__gapmnSicafMsgs.push({ texto: t, tipo });
    }
  };
  new MutationObserver(coletar).observe(document.body, { childList: true, subtree: true, characterData: true });

  // Clica depois de responder: se a página navegar, a resposta já saiu
  setTimeout(() => btn.click(), 50);
  return { ok: true };
}

/** Etapa B: espera o resultado — avisos e o link "Situação do Fornecedor". */
async function paginaResultado() {
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const visivel = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const emMenu = e => !!e.closest('nav, header, [role="menu"], [role="menubar"], .ui-menu, .ui-menubar, .ui-tieredmenu, .ui-panelmenu, .ui-breadcrumb, .breadcrumb, .menu, .navbar, .dropdown-menu, #menu');
  const SEL = '.ui-growl-item, .ui-messages-warn, .ui-messages-error, .ui-messages-fatal, .ui-messages-info, .ui-message, [role="alert"], .alert, .br-message';
  const msgs = window.__gapmnSicafMsgs ?? [];   // página recarregada: começa vazio
  const vistos = window.__gapmnSicafVistos ?? new WeakSet();
  let antes = [];
  try { antes = JSON.parse(sessionStorage.getItem('gapmnSicafAntes') ?? '[]'); } catch { /* sem sessionStorage */ }
  const coletar = () => {
    for (const m of document.querySelectorAll(SEL)) {
      if (vistos.has(m)) continue;
      const t = (m.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (antes.includes(t)) continue;
      const c = `${m.className} ${m.closest('[class*="warn"], [class*="error"], [class*="fatal"], [class*="info"]')?.className ?? ''}`;
      const tipo = /error|fatal|danger/i.test(c) ? 'erro' : /warn/i.test(c) ? 'aviso' : /info|success/i.test(c) ? 'info' : 'aviso';
      if (t && !msgs.some(x => x.texto === t)) msgs.push({ texto: t, tipo });
    }
  };
  const link = () => Array.from(document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], [onclick]'))
    .filter(e => visivel(e) && !emMenu(e) && !/consultarSituacaoFornecedor\.jsf/i.test(e.getAttribute('href') ?? ''))
    .find(e => /^SITUACAO DO FORNECEDOR$/.test(norm(e.textContent || e.value || e.title)));

  for (let t = 0; t < 20000; t += 250) {
    coletar();
    if (link()) { await dorme(500); coletar(); return { ok: true, temLink: true, mensagens: msgs }; }
    // Sem o link, um erro do SICAF (CNPJ inválido, não cadastrado…) encerra a
    // espera — mas o aviso pode chegar antes do link, então espera um pouco
    if (t >= 8000 && msgs.some(m => m.tipo !== 'info')) return { ok: true, temLink: false, mensagens: msgs };
    await dorme(250);
  }
  return {
    ok: true, temLink: false, mensagens: msgs,
    diagnostico: {
      url: location.href,
      botoes: Array.from(document.querySelectorAll('a, button, input[type=submit], input[type=button]')).filter(visivel).slice(0, 60)
        .map(b => `${b.tagName.toLowerCase()} id=${b.id} "${norm(b.textContent || b.value).slice(0, 40)}"${emMenu(b) ? ' (menu)' : ''}`),
    },
  };
}

/**
 * Etapa C: baixa o PDF da declaração sem abrir janela. Intercepta o envio do
 * formulário (JSF: form.submit() ou botão submit), window.open e o redirect da
 * resposta AJAX; refaz a mesma requisição com fetch e devolve o PDF em base64.
 */
async function paginaBaixarDeclaracao() {
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const visivel = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const emMenu = e => !!e.closest('nav, header, [role="menu"], [role="menubar"], .ui-menu, .ui-menubar, .ui-tieredmenu, .ui-panelmenu, .ui-breadcrumb, .breadcrumb, .menu, .navbar, .dropdown-menu, #menu');
  const alvo = Array.from(document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], [onclick]'))
    .filter(e => visivel(e) && !emMenu(e) && !/consultarSituacaoFornecedor\.jsf/i.test(e.getAttribute('href') ?? ''))
    .find(e => /^SITUACAO DO FORNECEDOR$/.test(norm(e.textContent || e.value || e.title)));
  if (!alvo) return { ok: false, detalhe: 'o link "Situação do Fornecedor" sumiu da página' };

  let cap = null;
  const deForm = (form, submitter) => {
    const dados = new FormData(form, submitter ?? undefined);
    return { tipo: 'form', action: form.action || location.href, method: (form.method || 'post').toUpperCase(), multipart: /multipart/i.test(form.enctype), dados };
  };
  const subOriginal = HTMLFormElement.prototype.submit;
  const reqOriginal = HTMLFormElement.prototype.requestSubmit;
  const openOriginal = window.open;
  const xhrOpen = XMLHttpRequest.prototype.open;
  const aoSubmeter = e => { cap = deForm(e.target, e.submitter); e.preventDefault(); e.stopImmediatePropagation(); };
  HTMLFormElement.prototype.submit = function () { cap = deForm(this); };
  HTMLFormElement.prototype.requestSubmit = function (s) { cap = deForm(this, s); };
  window.open = url => { cap = { tipo: 'url', url: new URL(String(url), location.href).href }; return null; };
  // AJAX do JSF que responde com <redirect url="..."> para o PDF
  XMLHttpRequest.prototype.open = function (...a) {
    this.addEventListener('load', () => {
      const m = /<redirect\s+url="([^"]+)"/.exec(this.responseText ?? '');
      if (m) cap = { tipo: 'url', url: new URL(m[1].replace(/&amp;/g, '&'), location.href).href };
    });
    return xhrOpen.apply(this, a);
  };
  document.addEventListener('submit', aoSubmeter, true);

  try {
    const href = alvo.tagName === 'A' ? alvo.getAttribute('href') ?? '' : '';
    if (href && !/^(#|javascript:)/i.test(href)) cap = { tipo: 'url', url: alvo.href };
    else alvo.click();
    for (let i = 0; i < 50 && !cap; i++) await dorme(100);
  } finally {
    HTMLFormElement.prototype.submit = subOriginal;
    HTMLFormElement.prototype.requestSubmit = reqOriginal;
    window.open = openOriginal;
    XMLHttpRequest.prototype.open = xhrOpen;
    document.removeEventListener('submit', aoSubmeter, true);
  }
  if (!cap) {
    return { ok: false, detalhe: 'o clique em "Situação do Fornecedor" não gerou o PDF', diagnostico: { onclick: (alvo.getAttribute('onclick') ?? '').slice(0, 300), tag: alvo.outerHTML.slice(0, 300) } };
  }

  const res = cap.tipo === 'form'
    ? await fetch(cap.action, { method: cap.method, body: cap.multipart ? cap.dados : new URLSearchParams(cap.dados), credentials: 'include' })
    : await fetch(cap.url, { credentials: 'include' });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ehPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;  // %PDF
  if (!ehPdf) {
    return { ok: false, detalhe: `o SICAF respondeu sem PDF (HTTP ${res.status}, ${res.headers.get('content-type') ?? '?'})`, diagnostico: { pedido: cap.tipo === 'form' ? cap.action : cap.url, trecho: new TextDecoder().decode(bytes.slice(0, 300)) } };
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { ok: true, base64: btoa(bin) };
}

/** Aba do SICAF aberta (de preferência já logada). */
export async function abaDoSicaf() {
  const abas = await chrome.tabs.query({ url: `${SICAF_ORIGEM}/sicaf-web/*` });
  return abas.find(a => a.url?.includes('/private/')) ?? abas[0] ?? null;
}

async function esperarCarregar(tabId, ms = 25000) {
  await dorme(500);
  for (let t = 0; t < ms; t += 250) {
    const aba = await chrome.tabs.get(tabId);
    if (aba.status === 'complete') return aba;
    await dorme(250);
  }
  throw new Error('o SICAF demorou demais para carregar');
}

async function consultarNaAba(cnpj) {
  const aba = await abaDoSicaf();
  if (!aba) return { estado: 'sem-aba' };
  const exec = async (func, args = []) => {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: aba.id }, world: 'MAIN', func, args });
    return r?.result;
  };
  const falha = (etapa, detalhe, diagnostico, mensagens = []) => {
    const itens = classificarMensagensSicaf(mensagens);
    return { estado: 'erro', etapa, detalhe, diagnostico, mensagens, itens };
  };

  // 1. Página de consulta recarregada (formulário limpo a cada CNPJ). Se a aba já
  // está na consulta aberta pelo menu do SICAF, usa o endereço dela (GET, sem
  // reenviar formulário); senão, o endereço conhecido.
  const naConsulta = aba.url?.includes('/sicaf-web/private/') && /situacao.*fornecedor/i.test(aba.url);
  await chrome.tabs.update(aba.id, { url: naConsulta ? aba.url.split('#')[0] : SICAF_CONSULTA });
  const carregada = await esperarCarregar(aba.id);
  if (!carregada.url?.includes('/sicaf-web/private/')) return { estado: 'sem-login', detalhe: 'o SICAF pediu login' };

  // 2. Pesquisa o CNPJ
  const a = await exec(paginaPesquisar, [cnpj]);
  if (!a?.ok) {
    return falha('pesquisa', `${a?.detalhe ?? 'não consegui pesquisar o CNPJ'} — abra no SICAF o menu Consulta › Situação do Fornecedor e clique em "Conferir no SICAF" de novo`, a?.diagnostico);
  }
  await dorme(1200);
  await esperarCarregar(aba.id);

  // 3. Resultado (se a página navegar no meio, tenta de novo)
  let b;
  for (let tentativa = 0; tentativa < 2 && !b; tentativa++) {
    try { b = await exec(paginaResultado); } catch { await esperarCarregar(aba.id); }
  }
  if (!b) return falha('resultado', 'não consegui ler o resultado da pesquisa');
  if (!b.temLink) {
    // CNPJ sem cadastro, aviso do SICAF ou página diferente da esperada
    return b.mensagens.length
      ? { ...resultadoSicaf({ mensagens: b.mensagens, origem: 'aba' }), mensagens: b.mensagens }
      : falha('resultado', 'o SICAF não mostrou o link "Situação do Fornecedor"', b.diagnostico);
  }

  // 4. PDF da declaração
  let c;
  try { c = await exec(paginaBaixarDeclaracao); } catch (e) { c = { ok: false, detalhe: e.message }; }
  if (!c?.ok) {
    // Os avisos da pesquisa já dizem algo: mostra com a ressalva do PDF
    return b.mensagens.length
      ? { ...resultadoSicaf({ mensagens: b.mensagens, origem: 'aba' }), detalhe: c?.detalhe, diagnostico: c?.diagnostico }
      : falha('declaracao', c?.detalhe ?? 'não consegui baixar a declaração', c?.diagnostico, b.mensagens);
  }
  const bin = atob(c.base64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const declaracao = lerDeclaracaoSicaf(await extractPdfText(buf.buffer));
  if (!declaracao) return falha('declaracao', 'o PDF baixado não é a declaração do SICAF', null, b.mensagens);
  if (declaracao.cnpj !== cnpj) return falha('declaracao', `a declaração baixada é de outro CNPJ (${fmtCnpj(declaracao.cnpj)})`, null, b.mensagens);
  return { ...resultadoSicaf({ declaracao, mensagens: b.mensagens, origem: 'aba' }), mensagens: b.mensagens };
}

// Uma consulta por vez (a aba é uma só); resultado bom fica guardado na sessão
let filaSicaf = Promise.resolve();
const cacheSicaf = new Map();

/** Confere o CNPJ no SICAF aberto. Nunca rejeita: falha vira estado 'erro'. */
export function conferirNoSicaf(cnpj, { forcar = false } = {}) {
  const c = String(cnpj ?? '').replace(/\D/g, '');
  if (c.length !== 14) return Promise.resolve({ estado: 'erro', detalhe: 'CNPJ ausente ou inválido' });
  if (!forcar && cacheSicaf.has(c)) return Promise.resolve(cacheSicaf.get(c));
  const p = filaSicaf.then(() => consultarNaAba(c)).catch(e => ({ estado: 'erro', detalhe: e.message }));
  filaSicaf = p.then(() => {}, () => {});
  return p.then(r => { if (r.estado === 'ok') cacheSicaf.set(c, r); return r; });
}

/** Texto para o botão "Copiar diagnóstico" quando a automação não acha algo. */
export function textoDiagnostico(r) {
  return [
    `Etapa: ${r.etapa ?? '-'}`,
    `Detalhe: ${r.detalhe ?? '-'}`,
    `Avisos: ${(r.mensagens ?? []).map(m => `[${m.tipo}] ${m.texto}`).join(' | ') || '-'}`,
    JSON.stringify(r.diagnostico ?? {}, null, 1),
  ].join('\n');
}
