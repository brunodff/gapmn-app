/**
 * Side Panel — GAPMN Empenho Bot v2.0
 * Telas: perfil → menu → upload → revisão → automação
 */

import { extractPdfText, parseSolicitacaoEmpenho } from '../runner/pdfParser.js';
import { UG_POR_UNIDADE } from './ugPorUnidade.js';

// ── Lista de unidades da FAB ──────────────────────────────────────────────────
const FAB_UNITS = [
  "AFA","FAYS","EDA","SIV","1° EIA","2° EIA","PAYS",
  "GAP-BE","I COMAR","BABE","COMARA","HABE","PABE",
  "SERIPA I","SEREP-BE","SERINFRA-BE","CTRB","1° ETA",
  "3°/7° GAV","DTCEA-BE","DTCEA-AA","DTCEA-MQ","DTCEA-SN",
  "BAFL","BAFZ","CO-FZ","BANT","CLBI","PANT","SERINFRA-NT","DECO-NT",
  "1°/11° GAV","1°/8° GAV","1°/5° GAV","2°/5° GAV",
  "2° ETA","3°/1° GCC","GITE","NuHANT",
  "GAP-RF","PARF","II COMAR","HARF","CINDACTA III","OARF",
  "SERIPA II","SEREP-RF","DTCEA-PS","DTCEA-LP","DTCEA-FZ","DTCEA-PL",
  "DTCEA-AR","DTCEA-MO","DTCEA-NT","DTCEA-SV","DTCEA-SL","DTCEA-FN","DTCEA-IZ",
  "BASV","CEMCOHA","BASC","1°/7° GAV","1° GAVCA","3°/8° GAV","1°/1° GCC",
  "GAP-AF","BAAF","HAAF","BREVET","SDPP/PAÍS","PAAF",
  "UNIFA","SDPP/EXTERIOR","SDAB","CENDOC","DIRAD","IPA",
  "CDA","MUSAL","EAOAR","ECEMAR","IMAE","SEREP-RJ","SDAP",
  "GALC","IEFA","CLA","DECO-AK","ECE","CABW","MTAB",
  "ADIAER-ARG","ADIAER-BOL","ADIAER-COL","ADIAER-VEN","ADIAER-CHI",
  "ADIAER-EQU","ADIAER-PAR","ADIAER-PER","ADIAER-URU","ADIAER-EUA",
  "ADIFA-MEX","MTAB-PARAGUAI","MTAB-BOLIVIA","CABE","COMF CASA","REMABI","GAC-EC",
  "ADIDEFNAVEXAERSENEG","ADIDEFNAVEXAERINDIA","ADIDEFNAVEXAESUECIA",
  "ADIDEFNAVEXAETIOPIA","ADIDEFNAVEXAEMIRADOS","ADIDEFNAVEXATURQUCR",
  "ADIAER-GBR","ADIAER-FRA","ADIAER-ITA","ADIFA-ANG","ADIFA-ISR",
  "ADIAER-CHN","ADIFA-ESP","ADIFA-RUS","ADIFA-IRA","ADIFA-JAP",
  "ADIEXAER-APO","ADIEXAER-AFS","ADIEXAER-ALE","CONMILCONFDESMT-GE","ADIDEFEXAER-RT",
  "EEAR","PAGW","EPCAR","GABAER","COJAER","CECOMSAER","ASPAER","SAGAB",
  "BAAN","3° GDAAE","GAC INFRA-AN","1° GDA","1° GTT","2°/6° GAV","PAAN",
  "BABV","DECO-UQ","1°/3° GAV","DTCEA-BV",
  "GAP-BR","DIREF","CCA BR","COPAC","SECPROM","EMAER","OABR","CIAER",
  "COMGEP","DIRENS","CENCIAR","CCISE","CDCAER","SEFA",
  "DIREF SEDE","DIREF/SUCONT","DIREF/SUCONV","DIREF - F.AER",
  "BACG","EAS","1°/15° GAV","2°/10° GAV","3°/3° GAV",
  "GAP-CO","VCOMAR","BACO","HACO","SERIPA V","1° GDAAE",
  "SEREP CO","SERINFRA-CO","1°/14° GAV","2°/7° GAV","5° ETA","2°/1° GCC","PACO",
  "GAP-LS","CIAAR","PAMA LS","PALS",
  "GAP-MN","BAMN","VII COMAR","CINDACTA IV","HAMN","SERIPA VII",
  "EACEA-HT","EACEA-BRL","EACEA-CA","EACEA-JI","EACEA-JD","EACEA-MB",
  "EACEA-TB","EACEA-TK","EACEA-VS",
  "2° GDAAE","DSM-MN","DACO-UA","DESTAE-UA","DESTAE-EI","DACO-MN","DACO-TT",
  "DECO-El","DACO-OW","DECO-EE","DECO-YA","SEREP MN","SERINFRA-MN","DECO-KO","DECO-UA",
  "1°/9° GAV","7°/8° GAV","7° ETA",
  "DTCEA-EG","DTCEA-MN","DTCEA-OI","DTCEA-TT","DTCEA-TS","DTCEA-EK",
  "DTCEA-MY","DTCEA-UA","DTCEA-FX","DTCEA-TF","DTCEA-EI","PAMN",
  "BAPV","DESTAE-VH","DACO-CZ","DECO-MH","2°/8° GAV","2°/3° GAV",
  "DTCEA-GM","DTCEA-PV","DTCEA-RB","5°/1° GCC","DTCEA-VH","DTCEA-CZ",
  "BASM","1°/12° GAV","1°/10° GAV","5°/5° GAV","3°/10° GAV","4°/1° GCC",
  "GAP-SJ","ICEA","DCTA","ITA","IAE","IEAV","IFI",
  "CCA-SJ","IAOP","SERINFRA-SJ","GSD-SJ","CPORAER-SJ","IPEV","GAC-PAC",
  "GAP-SP","DTI","DIRMAB","IV COMAR","BAST","BASP","HFASP","PAMA-SP",
  "CRCEA-SE","CELOG","PASP","DIRINFRA","COMGAP","ILA","CECAT","SERIPA-IV",
  "CEPE","GECAMP","DTCEA-MT","DTCEA-GL","DTCEA-GW","DTCEA-SC","DTCEA-ST",
  "DTCEA-SJ","SEREP-SP","DTCEA-AF",
  "GAP-DF","VI COMAR","BABR","PABR","CINDACTA I","HFAB","CENIPA",
  "COMPREP","COMAE","CPBV","SERIPA-VI","COPE-P","DTS","SEREP-BR",
  "SERINFRA-BR","COPE-S","AR DEFESA","GTE","6° ETA",
  "DTCEA-PCO","DTCEA-TRM","DTCEA-STA","DTCEA-SRO","DTCEA-TNB","DTCEA-GA",
  "DTCEA-GI","DTCEA-BW","DTCEA-AN","DTCEA-BR","DTCEA-CC","DTCEA-CY",
  "DTCEA-BQ","DTCEA-CF","DTCEA-LS","DTCEA-YS","DTCEA-FA","DTCEA-SI","DTCEA-EP",
  "GAP-GL","BAGL","CTLA","HFAG","LAQFA","PAGL","PAMB","PAMA-GL",
  "SARAM","CGABEG","DIRSA","CCA RJ","CEMAL","DIRAP","SERIPA III","CAE","CBNB",
  "1°/1° GT","1°/2° GT","2°/2° GT","3° ETA","1° GCC",
  "GAP-RJ","III COMAR","DECEA","HCA","PAME","ICA","CGNA","INCAER",
  "ASOCEA","CISCEA","OASD","CERNAI","SERINFRA-RJ","JJAER","GEIV",
  "DTCEATM-RJ","CIMAER","CINDACTA II",
  "DTCEA-MDI","DTCEA-CGU","DTCEA-STI","DTCEA-CDT","DTCEA-CG","DTCEA-CO",
  "DTCEA-CT","DTCEA-CR","DTCEA-FL","DTCEA-SM","DTCEA-FI","DTCEA-UG","PACT",
];

// ── Constantes ────────────────────────────────────────────────────────────────
const STEP_LABELS = [
  'Navegação', 'Contrato/Compra', 'Fornecedor', 'Itens', 'Crédito disponível',
  'Subelemento', 'Dados Empenho', 'Passivo Anterior', 'Finalizar',
];

// ── Estado da aplicação ───────────────────────────────────────────────────────
let userProfile   = null;   // { posto, nome, unidade, savedAt }
let currentMode   = null;   // 'siloms' | 'contratosgov'
let port          = null;
let uploadDest    = null;   // destino escolhido no menu: 'siloms' | 'contratosgov'
let solicitacoesParsed = []; // [ { ok, solicitacao, fornecedorNome, ... } ] — review queue

// Unidade da compra usada no fluxo "Compra" do Contratos.gov.br: vem da UG da
// OM do perfil (ugPorUnidade.js). Se o usuário corrigir na revisão, a correção
// fica salva para aquela OM e passa a ter prioridade.
const UNIDADE_COMPRA_KEY = 'empenho_unidade_compra_por_om';
let unidadesCompraSalvas = {}; // { 'GAP-XX': '1200NN' } informadas pelo usuário

function unidadeCompraDoPerfil() {
  const om = userProfile?.unidade ?? '';
  return unidadesCompraSalvas[om] || UG_POR_UNIDADE[om] || '';
}

// Modalidades de compra do Contratos.gov.br (o robô casa pelo código inicial)
const MODALIDADES = [
  '01 - Convite',
  '02 - Tomada de Preços',
  '03 - Concorrência',
  '04 - Concorrência Internacional',
  '05 - Pregão',
  '06 - Dispensa',
  '07 - Inexigibilidade',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  setupProfileForm();
  setupAutocomplete();
  setupMenuActions();
  setupUploadScreen();
  setupReviewScreen();
  setupAutomationControls();
  setupDevPanel();
  setupFeedbackWidget();

  const data = await chrome.storage.local.get(['empenho_profile', UNIDADE_COMPRA_KEY]);
  userProfile = data.empenho_profile ?? null;
  unidadesCompraSalvas = data[UNIDADE_COMPRA_KEY] ?? {};

  if (!userProfile) {
    showScreen('profile');
  } else {
    showMenuScreen();
  }

  // Conecta ao background e sincroniza estado (pode haver automação já em curso)
  connectPort();
}

// ── Gerenciamento de telas ────────────────────────────────────────────────────
const SCREENS = ['profile', 'menu', 'upload', 'review', 'solicitacoes', 'automation'];

function showScreen(name) {
  SCREENS.forEach(s => el(`screen-${s}`)?.classList.remove('active'));
  el(`screen-${name}`)?.classList.add('active');
  el('status-badge').style.display = (name === 'profile' || name === 'menu') ? 'none' : '';
}

function showMenuScreen() {
  if (!userProfile) { showScreen('profile'); return; }
  el('menu-user-name').textContent = `${userProfile.posto} ${userProfile.nome}`;
  el('menu-user-unit').textContent = userProfile.unidade;
  showScreen('menu');
}

// ── Tela de perfil ────────────────────────────────────────────────────────────
function setupProfileForm() {
  el('inp-nome').addEventListener('input', function () {
    this.value = this.value.toUpperCase();
  });

  el('btn-salvar-perfil').addEventListener('click', async () => {
    const posto    = el('inp-posto').value.trim();
    const nome     = el('inp-nome').value.trim();
    const unidade  = el('inp-unidade-value').value.trim();

    if (!posto || !nome || !unidade) {
      setProfileError('Preencha todos os campos antes de continuar.');
      return;
    }

    userProfile = { posto, nome, unidade, savedAt: Date.now() };
    await chrome.storage.local.set({ empenho_profile: userProfile });
    await logActivity('PROFILE_SAVED', { posto, unidade });

    el('profile-error').style.display = 'none';
    showMenuScreen();
  });

  el('btn-editar-perfil').addEventListener('click', () => {
    if (userProfile) {
      el('inp-posto').value            = userProfile.posto;
      el('inp-nome').value             = userProfile.nome;
      el('inp-unidade-search').value   = userProfile.unidade;
      el('inp-unidade-value').value    = userProfile.unidade;
    }
    el('profile-error').style.display = 'none';
    showScreen('profile');
  });
}

function setProfileError(msg) {
  const e = el('profile-error');
  e.textContent = msg;
  e.style.display = '';
}

// ── Autocomplete de unidade ───────────────────────────────────────────────────
function setupAutocomplete() {
  const searchInput = el('inp-unidade-search');
  const dropdown    = el('unidade-dropdown');
  const hiddenInput = el('inp-unidade-value');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    hiddenInput.value = ''; // limpa seleção ao editar

    if (!q) { dropdown.style.display = 'none'; return; }

    const matches = FAB_UNITS.filter(u => u.toLowerCase().includes(q)).slice(0, 18);
    if (!matches.length) { dropdown.style.display = 'none'; return; }

    dropdown.innerHTML = '';
    matches.forEach(unit => {
      const item = document.createElement('div');
      item.className = 'ac-item';
      item.textContent = unit;
      item.addEventListener('mousedown', () => {
        searchInput.value = unit;
        hiddenInput.value = unit;
        dropdown.style.display = 'none';
        el('profile-error').style.display = 'none';
      });
      dropdown.appendChild(item);
    });
    dropdown.style.display = '';
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 200);
    // Se o texto digitado bater exatamente com uma unidade, aceita
    const q = searchInput.value.trim();
    const exact = FAB_UNITS.find(u => u.toLowerCase() === q.toLowerCase());
    if (exact) { hiddenInput.value = exact; searchInput.value = exact; }
  });
}

// ── Menu principal ────────────────────────────────────────────────────────────
function setupMenuActions() {
  el('btn-siloms').addEventListener('click', async () => {
    uploadDest = 'siloms';
    await logActivity('SELECT_SILOMS');
    abrirUpload('siloms');
  });

  el('btn-contratosgov').addEventListener('click', async () => {
    uploadDest = 'contratosgov';
    await logActivity('SELECT_CONTRATOSGOV');
    abrirUpload('contratosgov');
  });

  el('btn-back-menu').addEventListener('click', () => showMenuScreen());
  el('btn-back-menu2').addEventListener('click', () => showMenuScreen());
}

function abrirUpload(dest) {
  // Se mudou de destino, limpa tudo. Se mesmo destino (ou voltando), preserva.
  if (dest !== uploadDest) {
    solicitacoesParsed = [];
    el('upload-file-list').innerHTML = '';
    el('btn-ver-revisao').style.display = 'none';
  }
  uploadDest = dest;
  el('upload-dest-label').textContent = dest === 'siloms' ? 'SILOMS' : 'CONTRATOSGOV';
  // Restaura visibilidade dos botões se já há arquivos parseados
  if (solicitacoesParsed.length > 0) {
    el('btn-ver-revisao').style.display = '';
    el('btn-limpar-upload').style.display = '';
  }
  showScreen('upload');
}

function iniciarColeta(mode) {
  el('coleta-mode-label').textContent = mode === 'siloms' ? 'SILOMS' : 'CONTRATOSGOV';
  el('coleta-counter').textContent    = '0 / ?';
  el('coleta-current').textContent    = 'Iniciando…';
  el('coleta-bar').style.width        = '0%';
  el('sol-lista').innerHTML           = '<div id="sol-vazia" style="padding:24px;text-align:center;color:#475569;font-size:12px;">Aguardando conclusão da coleta…</div>';
  el('sol-acoes').style.display       = 'none';
  showScreen('solicitacoes');

  if (port) port.postMessage({ type: 'START_COLETA', mode });
}

// ── Tela de Upload de PDFs ────────────────────────────────────────────────────

function setupUploadScreen() {
  const zone      = el('drop-zone');
  const fileInput = el('file-input');

  el('btn-back-upload').addEventListener('click', () => showMenuScreen());
  el('btn-browse').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => processarArquivos(Array.from(fileInput.files)));

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (files.length) processarArquivos(files);
  });

  el('btn-ver-revisao').addEventListener('click', () => abrirRevisao());

  el('btn-limpar-upload').addEventListener('click', () => {
    solicitacoesParsed = [];
    el('upload-file-list').innerHTML = '';
    el('btn-ver-revisao').style.display = 'none';
    el('btn-limpar-upload').style.display = 'none';
  });
}

async function processarArquivos(files) {
  const list = el('upload-file-list');

  for (const file of files) {
    // Cria item na lista com spinner
    const item = document.createElement('div');
    item.className = 'upload-file-item';
    item.innerHTML = `
      <span class="ufi-icon">📄</span>
      <span class="ufi-name">${file.name}</span>
      <span class="ufi-status ufi-spin" id="ufi-${sanitize(file.name)}">⏳ Lendo…</span>`;
    list.appendChild(item);

    try {
      const buf    = await file.arrayBuffer();
      const text   = await extractPdfText(buf);

      // F12 → Console: texto bruto extraído do PDF para inspeção
      console.group('[GAPMN PDF] ' + file.name);
      console.log(text);
      console.groupEnd();

      const parsed = parseSolicitacaoEmpenho(text);
      parsed._rawText = text;
      parsed._fileName = file.name;

      if (parsed.ok) {
        // Formata OBS: "SOLICITAÇÃO DE EMPENHO {NUMERO} {obs original}" sem ponto e vírgula
        const prefixo = 'SOLICITAÇÃO DE EMPENHO ' + (parsed.solicitacao ?? '');
        const textoObs = parsed.obs ? ' ' + parsed.obs : '';
        parsed.obs = (prefixo + textoObs).replace(/;/g, '').trim();

        // Contrato tem prioridade; sem contrato e com "Licit:", é empenho de compra
        parsed.tipoOrigem    = parsed.contrato ? 'contrato' : (parsed.licit ? 'compra' : 'contrato');
        parsed.numeroCompra  = parsed.licit ?? '';
        parsed.modalidade    = parsed.modalidadeSugerida ?? '';
        parsed.unidadeCompra = unidadeCompraDoPerfil();
        if (parsed.modalidadeSugerida) (parsed._deduzidos ??= {}).modalidade = true;

        // Extrai itens empenho da OBS ("ITEM 1: 4891,66 - ITEM 2: 7333,06")
        // Prioridade: itens do PDF (tabela); fallback: OBS
        if (!parsed.itens?.length && parsed.obs) {
          const reItem = /\bITEM\s+(\d+)\s*:\s*([\d.,]+)/gi;
          let m;
          const fromObs = [];
          while ((m = reItem.exec(parsed.obs)) !== null) {
            fromObs.push({
              numeroItem: m[1].padStart(5, '0'), // "00001", "00002"
              valor: m[2].replace('.', '').replace(',', '.'), // "4891.66"
              valorFmt: m[2],                    // "4891,66" (exibição)
            });
          }
          parsed.itensEmpenho = fromObs;
        } else {
          // Monta itensEmpenho a partir dos itens do PDF
          parsed.itensEmpenho = (parsed.itens ?? []).map((it, i) => ({
            numeroItem: String(i + 1).padStart(5, '0'),
            valor: (it.valorTotal ?? '').replace('.', '').replace(',', '.'),
            valorFmt: it.valorTotal ?? '',
          }));
        }
      }

      solicitacoesParsed.push(parsed);

      const statusEl = item.querySelector('.ufi-status');
      if (parsed.ok) {
        statusEl.className = 'ufi-status ufi-ok';
        statusEl.textContent = `✓ ${parsed.solicitacao || 'lida'}`;
      } else {
        statusEl.className = 'ufi-status ufi-err';
        statusEl.textContent = `⚠ ${parsed.error ?? 'Erro'}`;
      }
    } catch (e) {
      const statusEl = item.querySelector('.ufi-status');
      statusEl.className = 'ufi-status ufi-err';
      statusEl.textContent = `✗ ${e.message?.slice(0, 40)}`;
      solicitacoesParsed.push({ ok: false, _fileName: file.name, error: e.message });
    }
  }

  if (solicitacoesParsed.length > 0) {
    el('btn-ver-revisao').style.display = '';
    el('btn-limpar-upload').style.display = '';
  }
}

function sanitize(s) { return s.replace(/[^a-zA-Z0-9]/g, '_'); }

// ── Tela de Revisão ───────────────────────────────────────────────────────────

function setupReviewScreen() {
  el('btn-back-review').addEventListener('click', () => showScreen('upload'));
  el('btn-iniciar-fila').addEventListener('click', () => iniciarFila());
}

function abrirRevisao() {
  el('review-dest-label').textContent = uploadDest === 'siloms' ? 'SILOMS' : 'CONTRATOSGOV';
  renderReviewLista();
  showScreen('review');
}

function renderReviewLista() {
  const lista = el('review-lista');
  lista.innerHTML = '';

  const validas = solicitacoesParsed.filter(s => s.ok);
  const total   = solicitacoesParsed.length;

  el('review-counter').textContent =
    `${total} arquivo(s) carregado(s) — ${validas.length} lido(s) com sucesso`;
  el('btn-iniciar-fila').disabled = validas.length === 0;
  el('btn-iniciar-fila').textContent =
    `▶ Iniciar ${validas.length} empenho(s)`;

  solicitacoesParsed.forEach((sol, idx) => {
    lista.appendChild(criarReviewCard(sol, idx));
  });

  bindReviewInputs();
}

function criarReviewCard(sol, idx) {
  const card = document.createElement('div');
  card.className = 'review-card' + (!sol.ok ? ' review-card-error' : '');
  card.dataset.idx = idx;

  const omAbrev = abreviarOM(sol.localEntrega ?? '');

  card.innerHTML = `
    <div class="review-card-head">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="rc-numero">${sol.solicitacao || sol._fileName || '—'}</span>
          <span class="rc-total">R$ ${sol.total || '—'}</span>
        </div>
        <div class="rc-forn">${sol.fornecedorNome || '—'}</div>
        <div class="rc-om">${omAbrev}</div>
        ${!sol.ok ? `<div class="rc-err">⚠ ${sol.error ?? 'Erro ao ler PDF'}</div>` : ''}
        <div class="rc-toggle" data-idx="${idx}">▼ Ver / editar campos</div>
      </div>
      <button class="btn-rc-remove" data-idx="${idx}" title="Remover">✕</button>
    </div>
    <div class="review-card-body" id="rcb-${idx}">
      ${sol.ok ? renderCamposEditable(sol, idx) : ''}
    </div>`;

  // Toggle expand
  card.querySelector('.rc-toggle').addEventListener('click', () => toggleReviewCard(idx));

  // Remove
  card.querySelector('.btn-rc-remove').addEventListener('click', e => {
    e.stopPropagation();
    solicitacoesParsed.splice(idx, 1);
    renderReviewLista();
  });

  return card;
}

function toggleReviewCard(idx) {
  const body   = el(`rcb-${idx}`);
  const toggle = document.querySelector(`.rc-toggle[data-idx="${idx}"]`);
  if (!body) return;
  const open = body.classList.toggle('open');
  if (toggle) toggle.textContent = open ? '▲ Ocultar campos' : '▼ Ver / editar campos';
}

const AVISOS_DEDUZIDOS = {
  modalidade: 'Deduzida pelo número da compra — confira',
  ugCred:     'Número não estava junto do rótulo "UG Cred" no PDF — confira',
  total:      'TOTAL não legível no PDF; soma dos itens — confira',
};
function avisoDeduzido(sol, key) {
  if (!sol._deduzidos?.[key]) return '';
  return ` <span class="rf-aviso" style="color:#fbbf24" title="${escHtml(AVISOS_DEDUZIDOS[key] ?? 'Valor deduzido — confira')}">⚠</span>`;
}

function renderCamposEditable(sol, idx) {
  const campos = [
    ['Solicitação',    'solicitacao'],
    ['Data',           'data'],
    ['Local Entrega',  'localEntrega'],
    ['Fornecedor',     'fornecedorNome'],
    ['CNPJ',           'fornecedorCnpj'],
    ['PAG',            'pag'],
    ['Tipo',           'tipoOrigem'],
    ['Contrato',       'contrato'],
    ['Nº Compra',      'numeroCompra'],
    ['Modalidade',     'modalidade'],
    ['Unidade Compra', 'unidadeCompra'],
    ['Subelemento',    'subelemento'],
    ['UG Cred',        'ugCred'],
    ['PTRES',          'ptres'],
    ['Fonte',          'fonte'],
    ['PI',             'pi'],
    ['ND',             'nd'],
    ['Total',          'total'],
    ['OBS',            'obs'],
  ];

  const CAMPOS_COMPRA   = ['numeroCompra', 'modalidade', 'unidadeCompra'];
  const CAMPOS_CONTRATO = ['contrato'];
  const ehCompra = sol.tipoOrigem === 'compra';

  const rows = campos.map(([label, key]) => {
    const val = escHtml(sol[key] ?? '');
    // Campos que só valem para um dos tipos ficam ocultos no outro
    const grupo = CAMPOS_COMPRA.includes(key) ? 'compra' : CAMPOS_CONTRATO.includes(key) ? 'contrato' : '';
    const oculto = (grupo === 'compra' && !ehCompra) || (grupo === 'contrato' && ehCompra);
    const attrGrupo = grupo ? ` data-grupo="${grupo}" data-gidx="${idx}"${oculto ? ' style="display:none"' : ''}` : '';

    if (key === 'tipoOrigem') {
      return `
    <div class="rf-label">${label}</div>
    <select class="rf-input rf-tipo" data-idx="${idx}" data-key="tipoOrigem">
      <option value="contrato"${!ehCompra ? ' selected' : ''}>Contrato</option>
      <option value="compra"${ehCompra ? ' selected' : ''}>Compra</option>
    </select>`;
    }
    if (key === 'modalidade') {
      return `
    <div class="rf-label"${attrGrupo}>${label}${avisoDeduzido(sol, key)}</div>
    <select class="rf-input" data-idx="${idx}" data-key="modalidade"${attrGrupo}>
      <option value="">Selecione…</option>
      ${MODALIDADES.map(m => `<option value="${escHtml(m)}"${m === sol.modalidade ? ' selected' : ''}>${escHtml(m)}</option>`).join('')}
    </select>`;
    }
    // Após o campo Contrato, injeta uma linha de inspeção com o texto bruto do PDF
    const afterRow = key === 'contrato' && sol.contratoRaw && !ehCompra
      ? `</div><div style="font-size:9px;color:#64748b;margin:1px 0 6px;padding-left:2px;">
           📄 PDF (original): <span style="color:#94a3b8;font-family:monospace;">${escHtml(sol.contratoRaw)}</span>
         </div><div class="rf-grid">`
      : '';
    // OBS usa textarea para não truncar texto longo
    const input = key === 'obs'
      ? `<textarea class="rf-input" data-idx="${idx}" data-key="${key}"
                   rows="3" style="resize:vertical;line-height:1.3;">${val}</textarea>`
      : `<input class="rf-input" data-idx="${idx}" data-key="${key}"
               value="${val}" title="${val}"${key === 'unidadeCompra' ? ' placeholder="UASG da compra (ex: 120630)"' : ''} />`;
    const inputGrupo = attrGrupo ? input.replace(/^(\s*<(?:input|textarea))/, `$1${attrGrupo}`) : input;
    return `
    <div class="rf-label"${attrGrupo}>${label}${avisoDeduzido(sol, key)}</div>
    ${inputGrupo}
    ${afterRow}`;
  }).join('');

  // Itens p/ Empenho (editáveis — N.Item + Valor)
  const itensEmp = sol.itensEmpenho ?? [];
  const itensEmpHtml = `
    <div class="itens-empenho-wrap" style="margin-top:8px;">
      <div style="font-size:10px;font-weight:600;color:#94a3b8;margin-bottom:4px;letter-spacing:.5px;">
        ITENS P/ EMPENHO
        <span style="font-weight:400;color:#64748b;">(N.Item do CNET → Valor R$)</span>
      </div>
      <div id="itens-emp-${idx}">
        ${itensEmp.map((it, i) => renderItemEmpRow(it, idx, i)).join('')}
      </div>
      <button class="btn-add-item-emp" data-idx="${idx}"
              style="margin-top:4px;font-size:10px;padding:2px 8px;background:rgba(99,102,241,0.12);
                     border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;cursor:pointer;">
        + Adicionar item
      </button>
    </div>`;

  return `<div class="rf-grid">${rows}</div>${itensEmpHtml}`;
}

function renderItemEmpRow(it, idx, iidx) {
  return `<div class="item-emp-row" data-idx="${idx}" data-iidx="${iidx}"
               style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
    <input class="rf-input item-emp-num" placeholder="N.Item (ex: 00001)"
           value="${escHtml(it.numeroItem ?? '')}"
           data-idx="${idx}" data-iidx="${iidx}" data-ikey="numeroItem"
           style="width:90px;flex:none;" />
    <input class="rf-input item-emp-val" placeholder="Valor (ex: 4891.66)"
           value="${escHtml(it.valor ?? '')}"
           data-idx="${idx}" data-iidx="${iidx}" data-ikey="valor"
           style="flex:1;" />
    <button class="btn-rm-item-emp" data-idx="${idx}" data-iidx="${iidx}"
            style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);
                   color:#f87171;padding:2px 6px;cursor:pointer;">✕</button>
  </div>`;
}

function abreviarOM(nome) {
  if (!nome) return '';
  // Tenta extrair sigla tipo CINDACTA IV, GAP-MN, etc.
  const m = /\b(CINDACTA\s+[IVX]+|GAP-[A-Z]+|COMAR\s+[IVX]+|DECEA|ICA|[A-Z]{2,}-[A-Z]{2,})\b/i.exec(nome);
  if (m) return m[1] + ' — ' + nome.slice(0, 50);
  return nome.slice(0, 60);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

// Salva edições nos inputs de volta para solicitacoesParsed
function bindReviewInputs() {
  // Campos principais
  document.querySelectorAll('.rf-input').forEach(inp => {
    if (inp.dataset.ikey) return; // tratado abaixo (itens empenho)
    inp.addEventListener('change', () => {
      const idx = Number(inp.dataset.idx);
      const key = inp.dataset.key;
      const valor = inp.value.trim();
      if (solicitacoesParsed[idx]) solicitacoesParsed[idx][key] = valor;

      if (key === 'tipoOrigem') {
        const compra = valor === 'compra';
        document.querySelectorAll(`[data-gidx="${idx}"]`).forEach(n => {
          n.style.display = (n.dataset.grupo === 'compra') === compra ? '' : 'none';
        });
      }
      // Campo conferido pelo usuário deixa de ser "deduzido"
      if (solicitacoesParsed[idx]?._deduzidos?.[key]) {
        delete solicitacoesParsed[idx]._deduzidos[key];
        inp.closest('.rf-grid')?.querySelectorAll('.rf-label').forEach(l => {
          if (l.nextElementSibling === inp) l.querySelector('.rf-aviso')?.remove();
        });
      }
      // A unidade informada vira o padrão da OM do perfil
      if (key === 'unidadeCompra' && valor && userProfile?.unidade) {
        unidadesCompraSalvas[userProfile.unidade] = valor;
        chrome.storage.local.set({ [UNIDADE_COMPRA_KEY]: unidadesCompraSalvas });
      }
    });
  });

  // Itens empenho — campos número e valor
  document.querySelectorAll('.item-emp-num, .item-emp-val').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx  = Number(inp.dataset.idx);
      const iidx = Number(inp.dataset.iidx);
      const key  = inp.dataset.ikey;
      const sol  = solicitacoesParsed[idx];
      if (!sol) return;
      if (!sol.itensEmpenho) sol.itensEmpenho = [];
      if (!sol.itensEmpenho[iidx]) sol.itensEmpenho[iidx] = {};
      sol.itensEmpenho[iidx][key] = inp.value;
    });
  });

  // Botão adicionar item
  document.querySelectorAll('.btn-add-item-emp').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      const sol = solicitacoesParsed[idx];
      if (!sol) return;
      if (!sol.itensEmpenho) sol.itensEmpenho = [];
      sol.itensEmpenho.push({ numeroItem: '', valor: '' });
      const iidx = sol.itensEmpenho.length - 1;
      const container = document.getElementById(`itens-emp-${idx}`);
      if (container) {
        const div = document.createElement('div');
        div.innerHTML = renderItemEmpRow({ numeroItem: '', valor: '' }, idx, iidx);
        container.appendChild(div.firstElementChild);
        bindReviewInputs(); // re-bind para novos elementos
      }
    });
  });

  // Botão remover item
  document.querySelectorAll('.btn-rm-item-emp').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx  = Number(btn.dataset.idx);
      const iidx = Number(btn.dataset.iidx);
      const sol  = solicitacoesParsed[idx];
      if (sol?.itensEmpenho) sol.itensEmpenho.splice(iidx, 1);
      btn.closest('.item-emp-row')?.remove();
    });
  });
}

// ── Iniciar fila de empenho ───────────────────────────────────────────────────

// Retorna a lista de pendências que impedem o robô de passar da Etapa 1
function pendenciasEtapa1(sol) {
  const p = [];
  if (sol.tipoOrigem === 'compra') {
    if (!/^\d{4,6}\/\d{4}$/.test(sol.numeroCompra ?? '')) p.push('nº da compra (ex: 90063/2025)');
    if (!sol.modalidade)     p.push('modalidade');
    if (!sol.unidadeCompra)  p.push('unidade da compra');
  } else if (!sol.contrato) {
    p.push('contrato (ou mude o Tipo para Compra)');
  }
  return p;
}

function iniciarFila() {
  const validas = solicitacoesParsed.filter(s => s.ok);
  if (!validas.length) return;

  const incompletas = validas
    .map(s => [s.solicitacao || s._fileName, pendenciasEtapa1(s)])
    .filter(([, p]) => p.length);
  if (incompletas.length) {
    alert('Revise antes de iniciar:\n\n' +
      incompletas.map(([n, p]) => `• ${n}: falta ${p.join(', ')}`).join('\n'));
    return;
  }

  if (uploadDest === 'siloms') {
    // SILOMS ainda não implementado — mostra tela de automação com aviso
    currentMode = 'siloms';
    el('auto-mode-label').textContent  = 'SILOMS';
    el('siloms-soon').style.display    = '';
    el('cnet-auto').style.display      = 'none';
    el('status-badge-auto').style.display = 'none';
    showScreen('automation');
    return;
  }

  // CONTRATOSGOV — envia primeira da fila, as demais ficam em queue
  currentMode = 'contratosgov';
  el('auto-mode-label').textContent  = 'CONTRATOSGOV';
  el('siloms-soon').style.display    = 'none';
  el('cnet-auto').style.display      = 'flex';
  el('status-badge-auto').style.display = '';

  const [primeira, ...resto] = validas;
  const payload = solToPayload(primeira);

  // Enfileira as restantes
  if (port) {
    port.postMessage({ type: 'START_EMPENHO', payload, queue: resto.map(solToPayload) });
  }

  el('inf-numero').textContent = primeira.solicitacao || '—';
  el('inf-forn').textContent   = primeira.fornecedorNome || '—';
  el('inf-cnpj').textContent   = primeira.fornecedorCnpj || '—';
  el('inf-compra').textContent = primeira.tipoOrigem === 'compra'
    ? `Compra ${primeira.numeroCompra} · ${primeira.modalidade}`
    : (primeira.contrato || '—');
  el('inf-total').textContent  = primeira.total || '—';
  el('payload-card').style.display = '';

  el('log').innerHTML = '';
  setBadge('running');
  showScreen('automation');
}

function solToPayload(sol) {
  return {
    numeroSolicitacao: sol.solicitacao,
    fornecedorNome:    sol.fornecedorNome,
    fornecedorCnpj:    sol.fornecedorCnpj,
    localEntrega:      sol.localEntrega,
    compradora:        sol.compradora,
    contrato:          sol.contrato,
    tipoOrigem:        sol.tipoOrigem ?? (sol.contrato ? 'contrato' : 'compra'),
    numeroCompra:      sol.numeroCompra ?? '',
    modalidade:        sol.modalidade ?? '',
    unidadeCompra:     sol.unidadeCompra || unidadeCompraDoPerfil(),
    il:                sol.il,
    ugCred:            sol.ugCred,
    codemp:            sol.codemp,
    ptres:             sol.ptres,
    fonte:             sol.fonte,
    pi:                sol.pi,
    nd:                sol.nd,
    subelemento:       sol.subelemento,
    pag:               sol.pag,
    total:             sol.total,
    obs:               (sol.obs ?? '').replace(/;/g, '').trim(),
    itens:             sol.itens ?? [],
    itensEmpenho:      sol.itensEmpenho ?? [],
  };
}

// ── Controles de automação ────────────────────────────────────────────────────
function setupAutomationControls() {
  el('btn-pause') .addEventListener('click', () => port?.postMessage({ type: 'PAUSE' }));
  el('btn-resume').addEventListener('click', () => port?.postMessage({ type: 'RESUME' }));
  el('btn-abort') .addEventListener('click', () => {
    if (confirm('Abortar a execução atual? O estado será resetado.')) {
      port?.postMessage({ type: 'ABORT' });
    }
  });
  el('btn-confirm').addEventListener('click', () => port?.postMessage({ type: 'CONFIRM_EMISSAO' }));
}

// ── Conexão com background ────────────────────────────────────────────────────
function connectPort() {
  try {
    port = chrome.runtime.connect({ name: 'empenho-sidepanel' });

    port.onMessage.addListener(msg => {
      switch (msg.type) {

        // ── Coleta SILOMS ────────────────────────────────────────────────────
        case 'COLETA_STARTED':
          appendLog('▶ Coleta iniciada no SILOMS…', 'info');
          break;

        case 'COLETA_TOTAL':
          el('coleta-counter').textContent = `0 / ${msg.total}`;
          break;

        case 'COLETA_PROGRESS': {
          const pct = Math.round((msg.current / msg.total) * 100);
          el('coleta-bar').style.width = `${pct}%`;
          el('coleta-counter').textContent = `${msg.current} / ${msg.total}`;
          el('coleta-current').textContent = `Processando: ${msg.numero}`;
          break;
        }

        case 'COLETA_DONE':
          renderSolicitacoes(msg.solicitacoes ?? [], msg.mode ?? currentMode);
          break;

        // ── Empenho CNET ─────────────────────────────────────────────────────
        case 'STATE':         handleStateMsg(msg.state);                     break;
        case 'STEP':          updateStep(msg.step);                           break;
        case 'LOG':           appendLog(msg.msg, msg.level);                  break;
        case 'PAUSED':        setBadge('paused');  setResumable(true);
                              if (msg.error) appendLog(`❌ ${msg.error}`, 'error'); break;
        case 'ABORTED':       setBadge('idle');   setResumable(false);
                              appendLog('🛑 Abortado', 'warn');               break;
        case 'DONE':          setBadge('done');
                              appendLog(`🎉 Concluído${msg.ne ? ' — NE: ' + msg.ne : ''}`, 'success');
                              showCheckpoint(false);
                              showResultadoEmpenho(msg);
                              logActivity('DONE', { ne: msg.ne ?? null });   break;
        case 'ERROR':         setBadge('error');
                              appendLog(`❌ ${msg.message}`, 'error');
                              // Se erro durante coleta, mostra no painel de solicitações
                              el('coleta-current').textContent = `Erro: ${msg.message}`;
                              logActivity('ERROR', { msg: msg.message });    break;
        case 'STARTED':       setBadge('running'); appendLog('▶ Iniciado', 'info'); break;
        case 'CHECKPOINT':    showCheckpoint(true, msg.summary);             break;
        case 'NEXT_AVAILABLE':
          setBadge('running');
          appendLog(`▶ Iniciando próximo da fila: ${msg.numero}`, 'info');
          el('inf-numero').textContent = msg.numero || '—';
          el('log').innerHTML = '';
          break;
      }
    });

    port.onDisconnect.addListener(() => { port = null; });
    port.postMessage({ type: 'GET_STATE' });
  } catch {}
}

// ── Tratamento de STATE vindo do background ───────────────────────────────────
function handleStateMsg(state) {
  // ── Fluxo COLETA (SILOMS) em andamento ──────────────────────────────────
  if (state.flow === 'coleta' && state.state === 'running') {
    currentMode = state.mode ?? 'contratosgov';
    el('coleta-mode-label').textContent = currentMode === 'siloms' ? 'SILOMS' : 'CONTRATOSGOV';
    if (state.coletaTotal > 0) {
      const pct = Math.round((state.coletaIndex / state.coletaTotal) * 100);
      el('coleta-bar').style.width    = `${pct}%`;
      el('coleta-counter').textContent = `${state.coletaIndex} / ${state.coletaTotal}`;
    }
    showScreen('solicitacoes');

    // Replay de logs na tela de solicitações
    const logs = state.log ?? [];
    el('coleta-current').textContent = logs.length
      ? (logs[logs.length - 1]?.msg ?? 'Em andamento…')
      : 'Em andamento…';
    return;
  }

  // ── Coleta concluída (checkpoint) ────────────────────────────────────────
  if (state.flow === 'coleta' && state.state === 'checkpoint') {
    currentMode = state.mode ?? 'contratosgov';
    el('coleta-mode-label').textContent = currentMode === 'siloms' ? 'SILOMS' : 'CONTRATOSGOV';
    renderSolicitacoes(state.solDetalhes ?? [], currentMode);
    showScreen('solicitacoes');
    return;
  }

  // ── Fluxo EMPENHO-CNET ───────────────────────────────────────────────────
  setBadge(state.state);
  setResumable(state.state === 'paused');

  if (state.dryRun) el('dry-banner').classList.add('visible');

  if (state.payload) {
    if (currentMode !== 'contratosgov') {
      currentMode = 'contratosgov';
      el('auto-mode-label').textContent = 'CONTRATOSGOV';
      el('siloms-soon').style.display   = 'none';
      el('cnet-auto').style.display     = 'flex';
      el('status-badge-auto').style.display = '';
    }
    showScreen('automation');
    renderPayloadCard(state.payload);
    updateStep(state.step);
  }

  if (state.state === 'checkpoint' && state.flow !== 'coleta') {
    showCheckpoint(true, { payload: state.payload });
  }

  const logs = state.log ?? [];
  el('log').innerHTML = '';
  for (const entry of logs) appendLog(entry.msg, entry.level, false);
  el('log').scrollTop = el('log').scrollHeight;
}

// ── Funções de UI — automação ─────────────────────────────────────────────────
function renderPayloadCard(p) {
  el('payload-card').style.display = '';
  el('inf-numero').textContent = p.numeroSolicitacao ?? '–';
  el('inf-forn').textContent   = p.fornecedorNome   ?? '–';
  el('inf-cnpj').textContent   = formatCNPJ(p.fornecedorCNPJ ?? '');
  el('inf-compra').textContent = p.numeroCompra      ?? '–';
  el('inf-total').textContent  = fmtBRL(p._total     ?? 0);
}

function formatCNPJ(d) {
  if (d.length !== 14) return d;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

function fmtBRL(n) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function setBadge(state) {
  const labels = {
    idle: 'IDLE', running: 'EXECUTANDO', paused: 'PAUSADO',
    checkpoint: 'CHECKPOINT', done: 'CONCLUÍDO', error: 'ERRO',
  };
  [el('status-badge'), el('status-badge-auto')].forEach(b => {
    if (!b) return;
    b.className = `badge badge-${state}`;
    b.textContent = labels[state] ?? state.toUpperCase();
  });

  const isRunning = state === 'running';
  const isPaused  = state === 'paused';
  el('btn-pause') .disabled = !isRunning;
  el('btn-resume').disabled = !isPaused;
  el('btn-abort') .disabled = state === 'idle' || state === 'done';
}

function setResumable(yes) {
  el('btn-resume').disabled = !yes;
}

function updateStep(step) {
  if (!step) return;
  el('step-label').textContent = `Etapa ${step} — ${STEP_LABELS[step] ?? ''}`;

  for (let i = 1; i <= 8; i++) {
    const dot = el(`step-${i}`);
    if (!dot) continue;
    dot.className = 'step-dot';
    if (i < step)      dot.classList.add('done');
    else if (i === step) dot.classList.add('active');
  }
}

function appendLog(msg, level = 'info', scroll = true) {
  const div = document.createElement('div');
  div.className = `log-line log-${
    level === 'warn' ? 'warn' : level === 'error' ? 'error' : level === 'success' ? 'success' : 'info'
  }`;
  const ts = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  div.textContent = `[${ts}] ${msg}`;
  el('log').appendChild(div);
  if (scroll) el('log').scrollTop = el('log').scrollHeight;
}

function showCheckpoint(show, summary = null) {
  el('checkpoint-banner').classList.toggle('visible', show);
  el('confirm-controls').style.display = show ? '' : 'none';
  el('btn-pause') .disabled = show;
  el('btn-resume').disabled = show;

  if (show && summary?.payload) {
    renderDiff(summary.payload);
    appendLog('⚠ CHECKPOINT: revise o resumo e confirme a emissão', 'warn');
    setBadge('checkpoint');
  }
}

function showResultadoEmpenho(msg) {
  const ne              = msg.ne ?? '(verificar manualmente)';
  const payload         = msg.payload ?? {};
  const vEmp            = Number(msg.valorEmpenhado ?? 0);
  const vSol            = Number(msg.valorSolicitado ?? 0);
  const diff            = Math.max(0, vSol - vEmp);
  const temDiff         = diff > 0.005;

  const fmtV = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Remove resultado anterior se existir
  document.getElementById('resultado-empenho')?.remove();

  const div = document.createElement('div');
  div.id = 'resultado-empenho';
  div.style.cssText = 'margin:10px 0;padding:12px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.3);border-radius:6px;';
  div.innerHTML = `
    <div style="color:#4ade80;font-size:12px;font-weight:700;letter-spacing:.5px;">✅ EMPENHO EMITIDO</div>
    <div style="font-size:18px;font-weight:700;color:#fff;margin:4px 0;">${ne}</div>
    <div style="display:flex;gap:8px;margin:8px 0;">
      <div style="flex:1;">
        <div style="font-size:9px;color:#94a3b8;letter-spacing:.4px;">SOLICITADO</div>
        <div style="font-size:13px;color:#e2e8f0;">R$ ${fmtV(vSol)}</div>
      </div>
      <div style="flex:1;">
        <div style="font-size:9px;color:#94a3b8;letter-spacing:.4px;">EMPENHADO</div>
        <div style="font-size:13px;color:${temDiff ? '#f87171' : '#4ade80'};">R$ ${fmtV(vEmp)}</div>
      </div>
      ${temDiff ? `<div style="flex:1;">
        <div style="font-size:9px;color:#fbbf24;letter-spacing:.4px;">DIFERENÇA</div>
        <div style="font-size:13px;color:#fbbf24;">R$ ${fmtV(diff)}</div>
      </div>` : ''}
    </div>
    ${temDiff ? `<div style="font-size:10px;color:#fbbf24;padding:4px 8px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:4px;margin-bottom:8px;">
      ⚠ Reforço irrisório necessário: R$ ${fmtV(diff)}
    </div>` : ''}
    <button id="btn-baixar-csv" style="font-size:10px;padding:4px 12px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.4);color:#a5b4fc;cursor:pointer;border-radius:4px;">
      📥 Baixar relatório CSV
    </button>`;

  // Insere logo após o log
  const logEl = el('log');
  logEl?.parentElement?.insertBefore(div, logEl.nextSibling);

  // CSV download
  document.getElementById('btn-baixar-csv')?.addEventListener('click', () => {
    const linhas = [
      ['N° Solicitação', 'PAG', 'Fornecedor', 'CNPJ', 'Descrição/OBS', 'Valor Solicitado', 'Valor Empenhado', 'N° Empenho'],
      [
        payload.numeroSolicitacao ?? '',
        payload.pag               ?? '',
        payload.fornecedorNome    ?? '',
        payload.fornecedorCnpj    ?? '',
        (payload.obs ?? '').replace(/;/g, ' ').replace(/\n/g, ' '),
        fmtV(vSol),
        fmtV(vEmp),
        ne,
      ],
    ];
    const csv = linhas.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `empenho_${payload.numeroSolicitacao ?? 'sem_numero'}_${ne.replace(/\s/g,'_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function renderDiff(p) {
  const rows = [
    ['Fornecedor CNPJ', formatCNPJ(p.fornecedorCNPJ ?? '')],
    ['Nº Processo',     p.numeroProcesso ?? ''],
    ['ND',              p.nd             ?? ''],
    ['PTRES',           p.ptres          ?? ''],
    ['PI',              p.pi             ?? ''],
    ['Total',           fmtBRL(p._total  ?? 0)],
  ];

  el('diff-body').innerHTML = '';
  for (const [label, val] of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="diff-ok">${label}</td><td class="diff-ok">${val}</td><td class="diff-warn">(ler da tela)</td>`;
    el('diff-body').appendChild(tr);
  }
}

// ── Telemetria local ──────────────────────────────────────────────────────────
async function logActivity(action, details = {}) {
  try {
    const data = await chrome.storage.local.get(['empenho_sessions']);
    const sessions = data.empenho_sessions ?? [];
    sessions.push({
      ts: Date.now(),
      user: userProfile
        ? { posto: userProfile.posto, nome: userProfile.nome, unidade: userProfile.unidade }
        : null,
      action,
      ...details,
    });
    if (sessions.length > 300) sessions.splice(0, sessions.length - 300);
    await chrome.storage.local.set({ empenho_sessions: sessions });
  } catch {}
}

// ── Painel DEV (5 cliques no número da versão) ────────────────────────────────
function setupDevPanel() {
  let clicks = 0, timer = null;

  el('dev-trigger').addEventListener('click', () => {
    clicks++;
    clearTimeout(timer);
    timer = setTimeout(() => { clicks = 0; }, 1500);
    if (clicks >= 5) {
      clicks = 0;
      openDevPanel();
    }
  });

  el('btn-dev-close').addEventListener('click', () => {
    el('dev-modal').classList.remove('open');
  });

  el('btn-dev-clear').addEventListener('click', async () => {
    if (confirm('Limpar todo o histórico de atividades?')) {
      await chrome.storage.local.set({ empenho_sessions: [] });
      await renderDevContent();
    }
  });
}

async function openDevPanel() {
  await renderDevContent();
  el('dev-modal').classList.add('open');
}

async function renderDevContent() {
  const data = await chrome.storage.local.get(['empenho_sessions', 'empenho_profile']);
  const sessions = (data.empenho_sessions ?? []).slice().reverse();
  const manifest = chrome.runtime.getManifest();
  const profile  = data.empenho_profile;

  el('dev-info').innerHTML = `
    Versão: <b>${manifest.version}</b> &nbsp;|&nbsp;
    Perfil: <b>${profile ? profile.posto + ' ' + profile.nome + ' / ' + profile.unidade : 'não configurado'}</b><br>
    Sessões registradas: <b>${sessions.length}</b>
  `;

  if (!sessions.length) {
    el('dev-log').innerHTML = '<span style="color:#475569;">Nenhuma atividade registrada.</span>';
    return;
  }

  el('dev-log').innerHTML = sessions.map(s => {
    const d  = new Date(s.ts);
    const ts = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR');
    const user = s.user
      ? `${s.user.posto} ${s.user.nome} (${s.user.unidade})`
      : 'anônimo';
    const extra = Object.entries(s)
      .filter(([k]) => !['ts','user','action'].includes(k))
      .map(([k,v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    return `<div class="dev-log-row">
      <span class="dev-log-ts">${ts}</span>
      &nbsp;<span class="dev-log-act">${s.action}</span>
      &nbsp;<span class="dev-log-user">${user}</span>
      ${extra ? `&nbsp;<span style="color:#475569;font-size:10px;">${extra}</span>` : ''}
    </div>`;
  }).join('');
}

// ── Renderiza lista de solicitações coletadas ─────────────────────────────────
function renderSolicitacoes(sols, mode) {
  const lista    = el('sol-lista');
  const progress = el('coleta-progress-wrap');
  const acoes    = el('sol-acoes');

  // Finaliza barra de progresso
  el('coleta-bar').style.width = '100%';
  el('coleta-current').textContent = sols.length
    ? `✅ ${sols.length} solicitação(ões) coletada(s). Pronta(s) para empenho.`
    : 'Nenhuma solicitação encontrada.';

  if (!sols.length) {
    lista.innerHTML = '<div style="padding:24px;text-align:center;color:#475569;font-size:12px;">Nenhuma solicitação "Assinada OD UGCred" encontrada.</div>';
    return;
  }

  lista.innerHTML = '';
  for (const sol of sols) {
    const card = document.createElement('div');
    card.className = `sol-card${sol.ok === false ? ' sol-card-error' : ''}`;

    const valorFmt = sol.total
      ? `R$ ${sol.total}`
      : (sol.valor ? `R$ ${sol.valor}` : '–');

    card.innerHTML = `
      <div class="sol-card-header">
        <span class="sol-numero">${sol.numero ?? '?'}</span>
        <span class="sol-valor">${valorFmt}</span>
      </div>
      <div class="sol-forn">${sol.fornecedorNome || sol.fornecedor || '–'}</div>
      ${sol.fornecedorCNPJ ? `<div class="sol-forn" style="font-size:10px;">CNPJ: ${sol.fornecedorCNPJ}</div>` : ''}
      <div class="sol-meta">
        ${sol.compradora ? `<span class="sol-tag">UG: ${sol.compradora}</span>` : ''}
        ${sol.nd          ? `<span class="sol-tag">ND: ${sol.nd}</span>` : ''}
        ${sol.sb          ? `<span class="sol-tag">Sub: ${sol.sb}</span>` : ''}
        ${sol.ptres       ? `<span class="sol-tag">PTRES: ${sol.ptres}</span>` : ''}
        ${sol.data        ? `<span class="sol-tag">${sol.data}</span>` : ''}
      </div>
      ${sol.obs ? `<div style="margin-top:5px;font-size:10px;color:#64748b;line-height:1.4;">${sol.obs.slice(0, 120)}${sol.obs.length > 120 ? '…' : ''}</div>` : ''}
      ${sol.ok === false ? `<div class="sol-error-msg">⚠ ${sol.error ?? 'Erro ao extrair dados'}</div>` : ''}
      <button class="btn-sol-empenhar" data-numero="${sol.numero}">
        ${mode === 'siloms' ? '⚡ Empenhar no SILOMS' : '📋 Empenhar no CONTRATOSGOV'}
      </button>
    `;

    // Botão de empenho individual
    card.querySelector('.btn-sol-empenhar').addEventListener('click', () => {
      empenharSolicitacao(sol, mode);
    });

    lista.appendChild(card);
  }

  // Guarda para uso no botão "Empenhar todas"
  el('btn-empenhar-todas').onclick = () => {
    for (const sol of sols) empenharSolicitacao(sol, mode);
  };
  acoes.style.display = 'flex';
}

function empenharSolicitacao(sol, mode) {
  if (mode === 'siloms') {
    // Phase 3: implementar fluxo SILOMS
    appendLog(`⚡ SILOMS: ${sol.numero} — implementação em breve`, 'warn');
    // Mostra tela de automação com mensagem
    el('auto-mode-label').textContent = 'SILOMS';
    el('siloms-soon').style.display   = '';
    el('cnet-auto').style.display     = 'none';
    el('status-badge-auto').style.display = 'none';
    showScreen('automation');
  } else {
    // Envia payload para empenho CONTRATOSGOV
    const payload = buildCnetPayload(sol);
    el('auto-mode-label').textContent = 'CONTRATOSGOV';
    el('siloms-soon').style.display   = 'none';
    el('cnet-auto').style.display     = 'flex';
    el('status-badge-auto').style.display = '';
    el('log').innerHTML = '';
    showScreen('automation');
    appendLog(`📋 Iniciando empenho CONTRATOSGOV para ${sol.numero}…`, 'info');
    if (port) port.postMessage({ type: 'START_EMPENHO', payload });
  }
}

function buildCnetPayload(sol) {
  const item0 = sol.items?.[0] ?? {};
  return {
    numeroSolicitacao: sol.numero,
    fornecedorNome:    sol.fornecedorNome ?? sol.fornecedor ?? '',
    fornecedorCNPJ:    sol.fornecedorCNPJ ?? '',
    numeroCompra:      sol.pag ?? '',
    contrato:          sol.contrato ?? '',
    tipoOrigem:        sol.contrato ? 'contrato' : 'compra',
    unidadeCompra:     sol.ugCred ?? '120630',
    nd:                sol.nd ?? '',
    ptres:             sol.ptres ?? '',
    pi:                sol.pi ?? '',
    fonte:             sol.fonte ?? '',
    ugCred:            sol.ugCred ?? '',
    codemp:            sol.codemp ?? '',
    subelemento:       sol.sb || item0.sub || '',
    quantidade:        item0.quant ?? '',
    valorUnit:         item0.prcUnit ?? '',
    _total:            parseFloat((sol.total ?? '0').replace(/\./g,'').replace(',','.')) || 0,
    descricao:         (`SOLICITAÇÃO DE EMPENHO ${sol.numero} ${sol.obs ?? ''}`).replace(/;/g, '').trim(),
    localEntrega:      sol.localEntrega ?? '',
  };
}

// ── Widget de Sugestões / Feedback ───────────────────────────────────────────
function setupFeedbackWidget() {
  const SUPA_URL = 'https://fychrtyyqbzlfbzbvzqp.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';

  const modal  = el('feedback-modal');
  const btnOpen   = el('btn-feedback');
  const btnCancel = el('btn-fb-cancel');
  const btnSend   = el('btn-fb-send');
  const status    = el('fb-status');

  function openModal() {
    el('fb-mensagem').value = '';
    status.textContent = '';
    btnSend.disabled = false;
    modal.classList.add('open');
  }

  function closeModal() {
    modal.classList.remove('open');
  }

  btnOpen?.addEventListener('click', openModal);
  btnCancel?.addEventListener('click', closeModal);

  // Fechar ao clicar fora do card
  modal?.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });

  btnSend?.addEventListener('click', async () => {
    const msg = el('fb-mensagem').value.trim();
    if (!msg) { status.textContent = '⚠ Escreva algo antes de enviar.'; return; }
    btnSend.disabled = true;
    status.textContent = 'Enviando…';
    try {
      const r = await fetch(SUPA_URL + '/rest/v1/feedback_extensao', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPA_KEY,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          mensagem: msg,
          tipo: el('fb-tipo').value,
          versao_extensao: chrome.runtime.getManifest().version,
          user_agent: navigator.userAgent.slice(0, 200),
        }),
      });
      if (r.ok) {
        status.style.color = '#4ade80';
        status.textContent = '✅ Enviado! Obrigado pela contribuição.';
        el('fb-mensagem').value = '';
        setTimeout(closeModal, 2000);
      } else {
        status.style.color = '#f87171';
        status.textContent = '❌ Erro ao enviar. Tente novamente.';
        btnSend.disabled = false;
      }
    } catch {
      status.style.color = '#f87171';
      status.textContent = '❌ Sem conexão. Tente novamente.';
      btnSend.disabled = false;
    }
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
