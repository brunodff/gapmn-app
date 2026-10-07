/**
 * Side Panel — GAPMN Empenho Bot v2.0
 * Telas: perfil → menu → upload → revisão → automação
 */

import { extractPdfText, parseSolicitacaoEmpenho } from '../runner/pdfParser.js';
import { UG_POR_UNIDADE } from './ugPorUnidade.js';
import { verificarFornecedor } from './fornecedor.js';
import { problemasDaSolicitacao, temErro, normalizarNE } from './conferencia.js';
import { conferirContratosNoCnet } from './cnet.js';
import {
  abaDoSicaf, conferirNoSicaf, lerDeclaracaoSicaf, resultadoSicaf, textoDiagnostico, fmtCnpj, SICAF_CONSULTA,
} from './sicaf.js';
import { guardarPdf, chaveSolicitacao, chaveSicaf } from '../runner/arquivos.js';
import { setupSubprocessos, abrirSubprocessos } from './subprocessos.js';

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

// Tipos de empenho do Contratos.gov.br (o robô escolhe a opção pelo texto)
const TIPOS_EMPENHO = ['Ordinário', 'Estimativo', 'Global'];
// Contrato de serviço público medido por consumo
const RX_SERVICO_PUBLICO = /ENERGIA\s+EL[ÉE]TRICA|ESGOTO|SANEAMENTO|FORNECIMENTO\s+DE\s+[ÁA]GUA(?!\s+MINERAL)|TELEFONIA|\bSTFC\b|G[ÁA]S\s+CANALIZADO/i;

// Padrão: Global (compra e contrato); contrato de serviço público = Estimativo
function tipoEmpenhoPadrao(sol) {
  if (sol.tipoOrigem === 'compra') return 'Global';
  const texto = [sol.obs, sol.contratoRaw, ...(sol.itens ?? []).map(it => it.descricao ?? it.desc ?? '')].join(' ');
  return RX_SERVICO_PUBLICO.test(texto) ? 'Estimativo' : 'Global';
}

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
  setupEmpenhosGerados();
  setupSubprocessos({ el, showScreen, escHtml, voltar: showMenuScreen });
  el('btn-subprocessos').addEventListener('click', () => abrirSubprocessos());

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
const SCREENS = ['profile', 'menu', 'upload', 'review', 'solicitacoes', 'automation', 'subprocessos'];

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

  enviar({ type: 'START_COLETA', mode });
}

// ── Tela de Upload de PDFs ────────────────────────────────────────────────────

function setupUploadScreen() {
  const zone      = el('drop-zone');
  const fileInput = el('file-input');

  el('btn-back-upload').addEventListener('click', () => showMenuScreen());
  el('btn-browse').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    await processarArquivos(Array.from(fileInput.files));
    fileInput.value = '';   // permite escolher o mesmo arquivo de novo (ex.: depois de Limpar)
  });

  // Arrastar vale no painel inteiro (não só na caixa): soltar fora dela fazia o
  // navegador ignorar ou abrir o PDF. Na revisão, os PDFs entram na lista atual.
  const ativa = nome => el(`screen-${nome}`)?.classList.contains('active');
  const pdfs = e => Array.from(e.dataTransfer?.files ?? []).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  document.addEventListener('dragover', e => {
    e.preventDefault();
    if (ativa('upload')) zone.classList.add('drag-over');
  });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) zone.classList.remove('drag-over'); });
  document.addEventListener('drop', async e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const naRevisao = ativa('review');
    if (!naRevisao && !ativa('upload')) return;
    const files = pdfs(e);
    if (!files.length) return;
    await processarArquivos(files);
    if (naRevisao) abrirRevisao();
  });

  el('btn-ver-revisao').addEventListener('click', () => abrirRevisao());

  el('btn-limpar-upload').addEventListener('click', () => {
    solicitacoesParsed = [];
    declaracoesSicaf.clear();
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
      const copia  = buf.slice(0);   // o original vai para o pdf.js; a cópia é o arquivo do subprocesso
      const text   = await extractPdfText(buf);

      // F12 → Console: texto bruto extraído do PDF para inspeção
      console.group('[GAPMN PDF] ' + file.name);
      console.log(text);
      console.groupEnd();

      // Declaração do SICAF (Situação do Fornecedor): vale para as solicitações do CNPJ
      const declaracao = lerDeclaracaoSicaf(text);
      if (declaracao) {
        const r = resultadoSicaf({ declaracao, origem: 'pdf' });
        declaracoesSicaf.set(declaracao.cnpj, r);
        // Vai para o subprocesso do SILOMS junto com a solicitação
        guardarPdf(chaveSicaf(declaracao.cnpj), file.name, copia).catch(e => console.warn('[GAPMN] PDF do SICAF não guardado:', e));
        const doCnpj = solicitacoesParsed.filter(s => s.ok && soDigitos(s.fornecedorCnpj) === declaracao.cnpj);
        doCnpj.forEach(s => { s._sicaf = r; atualizarBadgeFornecedor(s); });
        const statusEl = item.querySelector('.ufi-status');
        statusEl.className = 'ufi-status ufi-ok';
        statusEl.textContent = `✓ SICAF ${fmtCnpj(declaracao.cnpj)}${doCnpj.length ? '' : ' (ainda sem solicitação)'}`;
        continue;
      }

      const parsed = parseSolicitacaoEmpenho(text);
      parsed._rawText = text;
      parsed._fileName = file.name;

      if (parsed.ok) {
        // Formata OBS: "SOLICITAÇÃO DE EMPENHO {NUMERO} {obs original}" sem ponto e vírgula
        const prefixo = 'SOLICITAÇÃO DE EMPENHO ' + (parsed.solicitacao ?? '');
        const textoObs = parsed.obs ? ' ' + parsed.obs : '';
        parsed.obs = (prefixo + textoObs).replace(/;/g, '').trim();

        // Reforço/anulação: sem TOTAL legível, vale o valor escrito na OBS
        if (parsed.operacao && !parsed.total && parsed.valorOperacao) {
          parsed.total = parsed.valorOperacao;
          (parsed._deduzidos ??= {}).total = true;
        }

        // Contrato tem prioridade; sem contrato e com "Licit:", é empenho de compra
        parsed.tipoOrigem    = parsed.contrato ? 'contrato' : (parsed.licit ? 'compra' : 'contrato');
        parsed.numeroCompra  = parsed.licit ?? '';
        parsed.modalidade    = parsed.modalidadeSugerida ?? '';
        parsed.unidadeCompra = unidadeCompraDoPerfil();
        parsed.tipoEmpenho   = tipoEmpenhoPadrao(parsed);
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
              valor: m[2].replace(/\./g, '').replace(',', '.'), // "4891.66"
              valorFmt: m[2],                    // "4891,66" (exibição)
            });
          }
          parsed.itensEmpenho = fromObs;
        } else {
          // Monta itensEmpenho a partir dos itens do PDF
          // N.Item = coluna ITEM do PDF ou linha "ITEM 14 - … - Ref a REQ" (é o nº do
          // item na compra/contrato no CNET). Sem ele fica vazio, nunca adivinhado:
          // um nº chutado marca e empenha outro item do contrato.
          parsed.itensEmpenho = (parsed.itens ?? []).map(it => ({
            numeroItem: it.item ? String(it.item).padStart(5, '0') : '',
            valor: (it.valorTotal ?? '').replace(/\./g, '').replace(',', '.'),
            valorFmt: it.valorTotal ?? '',
            subelemento: it.subelemento ?? '',
            quantidade: it.quant ?? '',  // coluna QUANT — é o que o robô digita numa compra
          }));
        }
      }

      // PDF original da solicitação: é anexado ao subprocesso no SILOMS (também quando
      // ela é arrastada de novo — serve para guardar o PDF de uma já empenhada)
      if (parsed.ok && parsed.solicitacao) {
        guardarPdf(chaveSolicitacao(parsed.solicitacao), file.name, copia).catch(e => console.warn('[GAPMN] PDF da solicitação não guardado:', e));
      }

      // Mesma solicitação arrastada de novo: não duplica o empenho
      if (parsed.ok && parsed.solicitacao && solicitacoesParsed.some(s => s.ok && s.solicitacao === parsed.solicitacao)) {
        const statusEl = item.querySelector('.ufi-status');
        statusEl.className = 'ufi-status ufi-ok';
        statusEl.textContent = `↺ ${parsed.solicitacao} já carregada`;
        continue;
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
  el('review-lista').addEventListener('click', aoClicarBadge);
  // PDF arrastado na revisão: tratado no painel inteiro (setupUploadScreen)
}

function abrirRevisao() {
  el('review-dest-label').textContent = uploadDest === 'siloms' ? 'SILOMS' : 'CONTRATOSGOV';
  renderReviewLista();
  showScreen('review');
  verificarFornecedoresDaRevisao();
  conferirSicafDaRevisao();
  conferirContratosDaRevisao();
}

// ── Verificação do fornecedor (sanções, impedimentos SICAF, Receita) ─────────

let proximoIdSol = 1;
const idSol = sol => (sol._id ??= proximoIdSol++);

const soDigitos = s => String(s ?? '').replace(/\D/g, '');

// Declarações do SICAF arrastadas como PDF: CNPJ → resultado
const declaracoesSicaf = new Map();

function textoSicafPendente(s) {
  switch (s?.estado) {
    case 'sem-aba':   return 'Certidões não conferidas — abra o SICAF (logado) e clique em "Conferir no SICAF", ou arraste aqui o PDF da Situação do Fornecedor';
    case 'sem-login': return `Certidões não conferidas — ${s.detalhe ?? 'o SICAF pediu login'}`;
    case 'erro':      return `Certidões não conferidas no SICAF — ${s.detalhe ?? 'falha na consulta'}`;
    default:          return 'Certidões ainda não conferidas no SICAF';
  }
}

/**
 * Veredito do fornecedor: MCP (sanções, impedimentos, CNPJ ativo) + SICAF
 * (certidões). Sem as certidões conferidas nunca fica "regular".
 */
function vereditoFornecedor(sol) {
  const m = sol._fornecedor, s = sol._sicaf;
  if (!m || m.nivel === 'verificando' || s?.estado === 'consultando') return { nivel: 'verificando', itens: [] };
  const itens = (m.itens ?? []).filter(i => i.nivel !== 'ok');
  if (m.nivel === 'erro') itens.push({ nivel: 'atencao', texto: m.resumo });
  for (const i of s?.itens ?? []) if (!itens.some(x => x.texto === i.texto)) itens.push(i);
  if (s?.estado !== 'ok') itens.push({ nivel: 'atencao', texto: textoSicafPendente(s) });
  const nivel = itens.some(i => i.nivel === 'bloqueio') ? 'bloqueio' : itens.some(i => i.nivel === 'atencao') ? 'atencao' : 'ok';
  const resumo = nivel === 'ok'
    ? `CNPJ ativo, sem sanções ou impedimentos · ${s.resumo}`
    : itens.filter(i => i.nivel === nivel).map(i => i.texto).join(' · ');
  return { nivel, resumo, itens, consultadoEm: s?.consultadoEm ?? m.consultadoEm ?? null };
}

function badgeFornecedor(sol) {
  if (!sol.ok) return '';
  if (sol.operacao === 'anulacao') return '<span class="rcf rcf-ok">Fornecedor: não conferido (anulação só reduz o empenho)</span>';
  const s = sol._sicaf;
  if (!sol._fornecedor) return '<span class="rcf rcf-verificando">Fornecedor: aguardando verificação</span>';
  const v = vereditoFornecedor(sol);
  if (v.nivel === 'verificando') {
    const oQue = s?.estado === 'consultando'
      ? `Certidões no SICAF: ${s.etapa ?? 'conferindo'}…`
      : 'Verificando fornecedor (sanções, impedimentos, CNPJ)…';
    return `<span class="rcf rcf-verificando">⏳ ${oQue}</span>`;
  }
  const icone = { ok: '✓', atencao: '⚠', bloqueio: '⛔' }[v.nivel] ?? '';
  const titulo = v.nivel === 'ok' ? 'Fornecedor regular' : v.nivel === 'bloqueio' ? 'Fornecedor impedido' : 'Fornecedor — atenção';
  const origem = s?.estado === 'ok'
    ? (s.origem === 'pdf' ? `SICAF: PDF emitido em ${s.emitidoEm || '?'}` : 'SICAF: consultado agora')
    : '';
  const id = idSol(sol);
  const botoes = [
    s?.estado !== 'ok'
      ? `<button class="btn-sicaf" data-sol="${id}" type="button">Conferir no SICAF</button>`
      : `<button class="btn-sicaf" data-sol="${id}" type="button" title="Consultar o SICAF de novo">↻ SICAF</button>`,
    s?.diagnostico ? `<button class="btn-sicaf-diag" data-sol="${id}" type="button">Copiar diagnóstico</button>` : '',
  ].join('');
  return `<span class="rcf rcf-${v.nivel}" title="${escHtml(v.resumo)}">${icone} ${titulo}${v.nivel === 'ok' ? `: ${escHtml(v.resumo)}` : ''}</span>
    ${v.itens.length ? `<ul class="rcf-lista">${v.itens.map(i => `<li class="rcf-${i.nivel}">${escHtml(i.texto)}</li>`).join('')}</ul>` : ''}
    <div class="rcf-acoes">${origem ? `<span class="rcf-origem">${escHtml(origem)}</span>` : ''}${botoes}</div>`;
}

function atualizarBadgeFornecedor(sol) {
  const alvo = document.getElementById(`rcf-${idSol(sol)}`);
  if (alvo) alvo.innerHTML = badgeFornecedor(sol);
}

// Consulta o MCP para cada fornecedor da revisão (no máximo 3 ao mesmo tempo)
async function verificarFornecedoresDaRevisao() {
  // Anulação só reduz o empenho: fornecedor não é conferido (decisão do usuário)
  const fila = solicitacoesParsed.filter(s => s.ok && !s._fornecedor && s.operacao !== 'anulacao');
  for (const sol of fila) { sol._fornecedor = { nivel: 'verificando' }; atualizarBadgeFornecedor(sol); }
  const trabalhador = async () => {
    for (let sol = fila.shift(); sol; sol = fila.shift()) {
      sol._fornecedor = await verificarFornecedor(sol.fornecedorCnpj);
      atualizarBadgeFornecedor(sol);
    }
  };
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
}

/**
 * Certidões no SICAF: PDF da declaração já arrastado, senão a aba do SICAF
 * aberta (uma consulta por vez). Sem aba, o badge pede para abrir.
 * `sols` + `forcar`: reconsulta (botão do cartão).
 */
async function conferirSicafDaRevisao({ sols = null, forcar = false } = {}) {
  const alvo = (sols ?? solicitacoesParsed.filter(s => !s._sicaf)).filter(s => s.ok && s.operacao !== 'anulacao');
  const porCnpj = new Map();
  for (const s of alvo) {
    const c = soDigitos(s.fornecedorCnpj);
    if (!porCnpj.has(c)) porCnpj.set(c, []);
    porCnpj.get(c).push(s);
  }
  const marcar = (lista, r) => lista.forEach(s => { s._sicaf = r; atualizarBadgeFornecedor(s); });

  let aba = null;
  try { aba = await abaDoSicaf(); } catch { /* sem permissão de abas */ }
  const consultar = [];
  for (const [cnpj, lista] of porCnpj) {
    const doPdf = declaracoesSicaf.get(cnpj);
    if (doPdf && !(forcar && aba)) marcar(lista, doPdf);
    else if (!aba) marcar(lista, { estado: 'sem-aba' });
    else consultar.push([cnpj, lista]);
  }
  // Uma consulta por vez na aba do SICAF: cada cartão mostra a vez e o andamento
  consultar.forEach(([, lista], i) => marcar(lista, {
    estado: 'consultando', etapa: consultar.length > 1 ? `aguardando a vez (${i + 1} de ${consultar.length})` : 'começando',
  }));
  for (const [cnpj, lista] of consultar) {
    const r = await conferirNoSicaf(cnpj, { forcar, aoAvancar: etapa => marcar(lista, { estado: 'consultando', etapa }) });
    marcar(lista, r);
  }
}

// Botões do badge: conferir no SICAF (abre o SICAF se não houver aba) e diagnóstico
async function aoClicarBadge(e) {
  const btn = e.target.closest('.btn-sicaf, .btn-sicaf-diag');
  if (!btn) return;
  e.stopPropagation();
  const sol = solicitacoesParsed.find(s => String(s._id) === btn.dataset.sol);
  if (!sol) return;
  if (btn.classList.contains('btn-sicaf-diag')) {
    try { await navigator.clipboard.writeText(textoDiagnostico(sol._sicaf ?? {})); btn.textContent = '✓ Copiado'; }
    catch { btn.textContent = 'Não consegui copiar'; }
    return;
  }
  const mesmos = solicitacoesParsed.filter(s => s.ok && soDigitos(s.fornecedorCnpj) === soDigitos(sol.fornecedorCnpj));
  if (!(await abaDoSicaf().catch(() => null))) {
    await chrome.tabs.create({ url: SICAF_CONSULTA, active: true });
    mesmos.forEach(s => {
      s._sicaf = { estado: 'sem-login', detalhe: 'abri o SICAF numa aba nova — entre com sua conta gov.br e clique em "Conferir no SICAF" de novo' };
      atualizarBadgeFornecedor(s);
    });
    return;
  }
  await conferirSicafDaRevisao({ sols: mesmos, forcar: true });
}

function renderReviewLista() {
  const lista = el('review-lista');
  lista.innerHTML = '';

  const validas = solicitacoesParsed.filter(s => s.ok);

  atualizarContadorRevisao();
  el('btn-iniciar-fila').disabled = validas.length === 0;
  el('btn-iniciar-fila').textContent =
    `▶ Iniciar ${validas.length} empenho(s)`;

  solicitacoesParsed.forEach((sol, idx) => {
    lista.appendChild(criarReviewCard(sol, idx));
  });

  bindReviewInputs();
}

// ── Conferência na revisão (o que vai travar o robô, visto antes de iniciar) ──

function htmlProblemas(sol) {
  if (!sol.ok) return '';
  const ps = problemasDaSolicitacao(sol);
  const erros = ps.filter(p => p.nivel === 'erro');
  const avisos = ps.filter(p => p.nivel === 'aviso');
  const k = sol.tipoOrigem !== 'compra' ? sol._cnetContrato : null;
  const notaCnet =
      k?.estado === 'ok'            ? `<div class="rp-ok">✓ Contrato encontrado no CNET: ${escHtml(String(k.texto).slice(0, 90))}</div>`
    : k?.estado === 'consultando'   ? '<div class="rp-nota">⏳ Conferindo o contrato no CNET…</div>'
    : k?.estado === 'sem-aba'       ? '<div class="rp-nota">Contrato não conferido no CNET — abra o CNET (logado) e reabra a revisão para conferir antes</div>'
    : k?.estado === 'sem-login'     ? '<div class="rp-nota">Contrato não conferido — o CNET pediu login</div>'
    : k?.estado === 'nao-conferido' ? `<div class="rp-nota">Contrato não conferido no CNET (${escHtml(k.texto)})</div>`
    : '';
  if (!ps.length) return `<div class="rp-ok">✓ Dados conferidos — nada impede o empenho</div>${notaCnet}`;
  const titulo = erros.length
    ? `<div class="rp-titulo rp-erro">⛔ ${erros.length} problema(s) que impedem o empenho${avisos.length ? ` · ⚠ ${avisos.length} para conferir` : ''}</div>`
    : `<div class="rp-titulo rp-aviso">⚠ ${avisos.length} ponto(s) para conferir</div>`;
  return `${titulo}<ul class="rp-lista">${[...erros, ...avisos].map(p => `<li class="rp-${p.nivel}">${escHtml(p.texto)}</li>`).join('')}</ul>${notaCnet}`;
}

function atualizarContadorRevisao() {
  const validas = solicitacoesParsed.filter(s => s.ok);
  const comErro = validas.filter(temErro).length;
  el('review-counter').textContent =
    `${solicitacoesParsed.length} arquivo(s) carregado(s) — ${validas.length} lido(s) com sucesso` +
    (comErro ? ` · ${comErro} com problema` : '');
}

// Soma dos itens x TOTAL da solicitação: quanto falta (o que o robô não identificou)
function htmlSomaItens(sol) {
  const num = s => {
    const t = String(s ?? '').trim().replace(/\s/g, '');
    if (!t) return NaN;
    return t.includes(',') ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t);
  };
  const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const itens = sol.itensEmpenho ?? [];
  const soma = itens.reduce((s, it) => s + (num(it.valor) || 0), 0);
  const total = num(sol.total);
  const qtd = `${itens.length} ite${itens.length === 1 ? 'm' : 'ns'}`;
  // TOTAL que veio da própria soma dos itens não serve de referência
  if (!(total > 0) || sol._deduzidos?.total) {
    return `Soma dos ${qtd}: <b>R$ ${fmt(soma)}</b> · <span class="is-falta">TOTAL da solicitação não lido no PDF — preencha o campo Total para conferir</span>`;
  }
  const dif = Math.round((total - soma) * 100) / 100;
  const situacao = Math.abs(dif) < 0.01 ? '<span class="is-ok">✓ bate com o TOTAL</span>'
    : dif > 0 ? `<span class="is-falta">Falta R$ ${fmt(dif)}</span>`
    : `<span class="is-falta">Passou R$ ${fmt(-dif)}</span>`;
  return `Soma dos ${qtd}: <b>R$ ${fmt(soma)}</b> de R$ ${fmt(total)} · ${situacao}`;
}

// Refaz o quadro de conferência do cartão (depois de editar campos ou itens)
function atualizarProblemas(sol) {
  if (!sol) return;
  const somaEl = document.getElementById(`itens-soma-${solicitacoesParsed.indexOf(sol)}`);
  if (somaEl) somaEl.innerHTML = htmlSomaItens(sol);
  const alvo = document.getElementById(`rcp-${idSol(sol)}`);
  if (alvo) {
    alvo.innerHTML = htmlProblemas(sol);
    alvo.closest('.review-card')?.classList.toggle('review-card-problema', temErro(sol));
  }
  atualizarContadorRevisao();
}

/**
 * Contratos da revisão conferidos no CNET (número + ano + CNPJ), uma vez por
 * combinação. Sem o CNET aberto, o cartão só avisa que não conferiu.
 */
let conferenciaCnetEmCurso = null;
async function conferirContratosDaRevisao() {
  const chave = s => `${String(s.contrato ?? '').trim()}|${soDigitos(s.fornecedorCnpj)}|${s.credenciamento ? 'cred' : ''}`;
  // Ainda não conferido, dados mudaram, ou da vez anterior não deu (CNET fechado / sem login)
  // Reforço/anulação não escolhem contrato no CNET (vão direto à NE)
  const precisa = s => s.ok && !s.operacao && s.tipoOrigem !== 'compra' && /^\d+/.test(String(s.contrato ?? '').trim()) &&
    (!s._cnetContrato || s._cnetContrato.chave !== chave(s) || ['sem-aba', 'sem-login', 'nao-conferido'].includes(s._cnetContrato.estado));
  if (!solicitacoesParsed.some(precisa)) return;
  await conferenciaCnetEmCurso;   // uma conferência por vez (abre uma aba do CNET)
  const pendentes = solicitacoesParsed.filter(precisa).filter(s => s._cnetContrato?.estado !== 'consultando');
  if (!pendentes.length) return;
  pendentes.forEach(s => { s._cnetContrato = { estado: 'consultando', chave: chave(s) }; atualizarProblemas(s); });
  const pedidos = [...new Map(pendentes.map(s => [chave(s), { chave: chave(s), contrato: String(s.contrato).trim(), cnpj: soDigitos(s.fornecedorCnpj), credenciamento: !!s.credenciamento }])).values()];
  conferenciaCnetEmCurso = conferirContratosNoCnet(pedidos).catch(e => ({ estado: 'erro', detalhe: e.message }));
  const r = await conferenciaCnetEmCurso;
  conferenciaCnetEmCurso = null;
  for (const s of pendentes) {
    if (s._cnetContrato?.chave !== chave(s)) continue;   // editado durante a consulta: a próxima rodada confere
    s._cnetContrato = r.estado === 'ok'
      ? { ...(r.resultados.get(chave(s)) ?? { estado: 'nao-conferido', texto: 'sem resposta' }), chave: chave(s) }
      : { estado: r.estado === 'erro' ? 'nao-conferido' : r.estado, texto: r.detalhe ?? '', chave: chave(s) };
    atualizarProblemas(s);
  }
}

function criarReviewCard(sol, idx) {
  const card = document.createElement('div');
  card.className = 'review-card' + (!sol.ok ? ' review-card-error' : temErro(sol) ? ' review-card-problema' : '');
  card.dataset.idx = idx;

  const omAbrev = abreviarOM(sol.localEntrega ?? '');

  card.innerHTML = `
    <div class="review-card-head">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="rc-numero">${sol.solicitacao || sol._fileName || '—'}</span>
          <span class="rc-total">R$ ${sol.total || '—'}</span>
        </div>
        ${sol.operacao ? `<div class="rc-operacao rc-op-${sol.operacao}">${sol.operacao === 'anulacao' ? '➖ ANULAÇÃO' : '➕ REFORÇO'} da ${escHtml(sol.neAlterar || 'NE ? (informe abaixo)')}${sol.identOperacao ? ` · Ident/OC ${escHtml(sol.identOperacao)}` : ''}</div>` : ''}
        <div class="rc-forn">${sol.fornecedorNome || '—'}</div>
        ${sol.ok && soDigitos(sol.fornecedorCnpj).length === 14 ? `<div class="rc-cnpj">CNPJ ${fmtCnpj(soDigitos(sol.fornecedorCnpj))}</div>` : ''}
        <div class="rc-fornecedor" id="rcf-${idSol(sol)}">${badgeFornecedor(sol)}</div>
        <div class="rc-problemas" id="rcp-${idSol(sol)}">${htmlProblemas(sol)}</div>
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
    ['Operação',       'operacao'],
    ['NE a alterar',   'neAlterar'],
    ['Solicitação',    'solicitacao'],
    ['Data',           'data'],
    ['Local Entrega',  'localEntrega'],
    ['Fornecedor',     'fornecedorNome'],
    ['CNPJ',           'fornecedorCnpj'],
    ['PAG',            'pag'],
    ['Tipo',           'tipoOrigem'],
    ['Tipo Empenho',   'tipoEmpenho'],
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

    if (key === 'operacao') {
      const op = sol.operacao || '';
      return `
    <div class="rf-label" title="Reforço e anulação alteram uma NE já emitida (Alterar Empenho no CNET)">${label}</div>
    <select class="rf-input" data-idx="${idx}" data-key="operacao">
      <option value=""${!op ? ' selected' : ''}>Empenho novo</option>
      <option value="reforco"${op === 'reforco' ? ' selected' : ''}>Reforço de empenho</option>
      <option value="anulacao"${op === 'anulacao' ? ' selected' : ''}>Anulação de empenho</option>
    </select>`;
    }
    if (key === 'neAlterar') {
      const vis = sol.operacao ? '' : ' style="display:none"';
      return `
    <div class="rf-label" data-alt="${idx}"${vis} title="Não vem no PDF da solicitação">${label}</div>
    <input class="rf-input" data-idx="${idx}" data-key="neAlterar" data-alt="${idx}"${vis}
           value="${escHtml(sol.neAlterar ?? '')}" placeholder="ex: 2026NE000552" />`;
    }
    if (key === 'tipoOrigem') {
      return `
    <div class="rf-label">${label}</div>
    <select class="rf-input rf-tipo" data-idx="${idx}" data-key="tipoOrigem">
      <option value="contrato"${!ehCompra ? ' selected' : ''}>Contrato</option>
      <option value="compra"${ehCompra ? ' selected' : ''}>Compra</option>
    </select>`;
    }
    if (key === 'tipoEmpenho') {
      const atual = sol.tipoEmpenho || tipoEmpenhoPadrao(sol);
      return `
    <div class="rf-label" title="Padrão: Global; contrato de serviço público (energia, água, esgoto, telefonia) = Estimativo">${label}</div>
    <select class="rf-input" data-idx="${idx}" data-key="tipoEmpenho">
      ${TIPOS_EMPENHO.map(t => `<option value="${escHtml(t)}"${t === atual ? ' selected' : ''}>${escHtml(t)}</option>`).join('')}
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
    // Após o campo Contrato: a caixa "Credenciamento" e o texto bruto do PDF
    const afterRow = key === 'contrato'
      ? `</div><div${attrGrupo} style="font-size:10px;color:#94a3b8;margin:1px 0 4px;padding-left:2px;">
           <label title="No CNET o credenciamento tem o número com 2 na frente (004/2023 → 20004/2023); o robô escolhe pelo CNPJ do fornecedor" style="cursor:pointer;">
             <input type="checkbox" class="rf-cred" data-idx="${idx}"${sol.credenciamento ? ' checked' : ''} style="vertical-align:middle;">
             Credenciamento (pesquisa ${escHtml(parseInt(sol.contrato, 10) ? String(20000 + parseInt(sol.contrato, 10)) : '2NNNN')}/${escHtml(/\/(\d{4})$/.exec(String(sol.contrato ?? ''))?.[1] ?? '2')} e escolhe pelo CNPJ)
           </label>
         </div>${sol.contratoRaw ? `<div${attrGrupo} style="font-size:9px;color:#64748b;margin:1px 0 6px;padding-left:2px;">
           📄 PDF (original): <span style="color:#94a3b8;font-family:monospace;">${escHtml(sol.contratoRaw)}</span>
         </div>` : ''}<div class="rf-grid">`
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
        <span style="font-weight:400;color:#64748b;">(N.Item do CNET · Qtd · Valor R$)</span>
      </div>
      <div class="itens-soma" id="itens-soma-${idx}">${htmlSomaItens(sol)}</div>
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
    <input class="rf-input item-emp-qtd" placeholder="Qtd"
           title="Quantidade (numa compra, é o que o robô digita no CNET)"
           value="${escHtml(it.quantidade ?? '')}"
           data-idx="${idx}" data-iidx="${iidx}" data-ikey="quantidade"
           style="width:64px;flex:none;" />
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
  // Caixa "Credenciamento" (abaixo do Contrato)
  document.querySelectorAll('.rf-cred').forEach(chk => {
    chk.addEventListener('change', () => {
      const sol = solicitacoesParsed[Number(chk.dataset.idx)];
      if (!sol) return;
      sol.credenciamento = chk.checked;
      atualizarProblemas(sol);
      conferirContratosDaRevisao();
    });
  });
  // Campos principais
  document.querySelectorAll('.rf-input').forEach(inp => {
    if (inp.dataset.ikey) return; // tratado abaixo (itens empenho)
    inp.addEventListener('change', () => {
      const idx = Number(inp.dataset.idx);
      const key = inp.dataset.key;
      let valor = inp.value.trim();
      if (key === 'neAlterar' && valor) { valor = normalizarNE(valor) || valor; inp.value = valor; }
      if (key === 'contrato' && /^(?:DESPESA\s+)?CRED(?:ENCIAMENTO)?\.?\s+\d/i.test(valor)) {
        valor = valor.replace(/^(?:DESPESA\s+)?CRED(?:ENCIAMENTO)?\.?\s+/i, '');
        inp.value = valor;
        if (solicitacoesParsed[idx]) solicitacoesParsed[idx].credenciamento = true;
        const chk = document.querySelector(`.rf-cred[data-idx="${idx}"]`);
        if (chk) chk.checked = true;
      }
      if (solicitacoesParsed[idx]) solicitacoesParsed[idx][key] = valor;

      if (key === 'operacao' || key === 'neAlterar') {
        const sol = solicitacoesParsed[idx];
        document.querySelectorAll(`[data-alt="${idx}"]`).forEach(n => { n.style.display = sol?.operacao ? '' : 'none'; });
        if (sol) delete sol._deduzidos?.operacao;
        // Cabeçalho (tipo/NE) e verificação do fornecedor mudam com a operação
        renderReviewLista();
        verificarFornecedoresDaRevisao();
        conferirSicafDaRevisao();
        return;
      }

      if (key === 'tipoOrigem') {
        const compra = valor === 'compra';
        document.querySelectorAll(`[data-gidx="${idx}"]`).forEach(n => {
          n.style.display = (n.dataset.grupo === 'compra') === compra ? '' : 'none';
        });
        // Tipo de empenho acompanha a troca, a menos que o usuário já o tenha escolhido
        const sol = solicitacoesParsed[idx];
        if (sol && !sol._tipoEmpenhoManual) {
          sol.tipoEmpenho = tipoEmpenhoPadrao(sol);
          const selTipo = document.querySelector(`select[data-idx="${idx}"][data-key="tipoEmpenho"]`);
          if (selTipo) selTipo.value = sol.tipoEmpenho;
        }
      }
      if (key === 'tipoEmpenho' && solicitacoesParsed[idx]) solicitacoesParsed[idx]._tipoEmpenhoManual = true;
      // CNPJ corrigido: verifica o fornecedor de novo
      if (key === 'fornecedorCnpj' && solicitacoesParsed[idx]) {
        solicitacoesParsed[idx]._fornecedor = null;
        solicitacoesParsed[idx]._sicaf = null;
        verificarFornecedoresDaRevisao();
        conferirSicafDaRevisao();
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
      // Conferência do cartão na hora; contrato/CNPJ/tipo novos: confere no CNET de novo
      atualizarProblemas(solicitacoesParsed[idx]);
      if (['contrato', 'fornecedorCnpj', 'tipoOrigem'].includes(key)) conferirContratosDaRevisao();
    });
  });

  // Itens empenho (campos e ✕ de cada linha)
  solicitacoesParsed.forEach((_, idx) => bindItensEmp(idx));

  // Botão adicionar item
  document.querySelectorAll('.btn-add-item-emp').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      const sol = solicitacoesParsed[idx];
      if (!sol) return;
      if (!sol.itensEmpenho) sol.itensEmpenho = [];
      sol.itensEmpenho.push({ numeroItem: '', valor: '' });
      redesenharItensEmp(idx);
    });
  });
}

// Liga os campos e o ✕ das linhas de item de uma solicitação. Antes, adicionar
// item religava a tela inteira (botões com o clique em dobro) e remover não
// renumerava as linhas — o ✕ ou a edição seguinte caíam no item errado.
function bindItensEmp(idx) {
  const container = document.getElementById(`itens-emp-${idx}`);
  if (!container) return;
  container.querySelectorAll('.item-emp-num, .item-emp-qtd, .item-emp-val').forEach(inp => {
    // 'input': a soma "falta R$…" acompanha a digitação
    for (const evento of ['input', 'change']) inp.addEventListener(evento, () => {
      const sol = solicitacoesParsed[idx];
      const iidx = Number(inp.dataset.iidx);
      if (!sol) return;
      if (!sol.itensEmpenho) sol.itensEmpenho = [];
      if (!sol.itensEmpenho[iidx]) sol.itensEmpenho[iidx] = {};
      sol.itensEmpenho[iidx][inp.dataset.ikey] = inp.value;
      atualizarProblemas(sol);
    });
  });
  container.querySelectorAll('.btn-rm-item-emp').forEach(btn => {
    btn.addEventListener('click', () => {
      solicitacoesParsed[idx]?.itensEmpenho?.splice(Number(btn.dataset.iidx), 1);
      redesenharItensEmp(idx);
    });
  });
}

// Lista de itens redesenhada a partir dos dados (índices sempre certos)
function redesenharItensEmp(idx) {
  const sol = solicitacoesParsed[idx];
  const container = document.getElementById(`itens-emp-${idx}`);
  if (!sol || !container) return;
  container.innerHTML = (sol.itensEmpenho ?? []).map((it, i) => renderItemEmpRow(it, idx, i)).join('');
  bindItensEmp(idx);
  atualizarProblemas(sol);
}

// ── Iniciar fila de empenho ───────────────────────────────────────────────────

function iniciarFila() {
  let validas = solicitacoesParsed.filter(s => s.ok);
  if (!validas.length) return;

  const nome = s => `${s.solicitacao || s._fileName} — ${s.fornecedorNome || ''}`;

  // Problema que impede o empenho (visto na conferência do cartão): fica fora da fila
  const comErro = validas.filter(temErro);
  if (comErro.length) {
    const lista = comErro.map(s => `• ${nome(s)}:\n   ${problemasDaSolicitacao(s).filter(p => p.nivel === 'erro').map(p => p.texto).join('\n   ')}`).join('\n');
    if (comErro.length === validas.length) {
      alert(`Nenhuma solicitação está pronta para empenhar — corrija na revisão:\n\n${lista}`);
      return;
    }
    if (!confirm(`Estas solicitações têm problema que impede o empenho e NÃO entrarão na fila:\n\n${lista}\n\nOK: empenhar só as demais · Cancelar: voltar e corrigir`)) return;
    validas = validas.filter(s => !comErro.includes(s));
  }

  // Fornecedor impedido (sanção, impedimento ou certidão federal vencida) não
  // entra na fila; verificação em curso e certidão não conferida pedem confirmação
  // Anulação não confere fornecedor (só reduz o empenho)
  const conferidas = validas.filter(s => s.operacao !== 'anulacao');
  const veredito = new Map(conferidas.map(s => [s, vereditoFornecedor(s)]));
  const verificando = conferidas.filter(s => veredito.get(s).nivel === 'verificando');
  if (verificando.length && !confirm(`Ainda verificando ${verificando.length} fornecedor(es) (sanções e certidões no SICAF). Iniciar sem esperar o resultado?`)) return;
  const impedidas = conferidas.filter(s => veredito.get(s).nivel === 'bloqueio');
  if (impedidas.length) {
    const lista = impedidas.map(s => `• ${nome(s)}: ${veredito.get(s).resumo}`).join('\n');
    if (!confirm(`Fornecedor impedido — estas solicitações NÃO serão empenhadas:\n\n${lista}\n\nOK: empenhar só as demais · Cancelar: voltar à revisão`)) return;
    validas = validas.filter(s => !impedidas.includes(s));
    if (!validas.length) return;
  }
  const semCertidao = conferidas.filter(s => validas.includes(s) && veredito.get(s).nivel !== 'verificando' && s._sicaf?.estado !== 'ok');
  if (semCertidao.length) {
    const lista = semCertidao.map(s => `• ${nome(s)}`).join('\n');
    if (!confirm(`Certidões NÃO conferidas no SICAF:\n\n${lista}\n\nOK: empenhar assim mesmo · Cancelar: voltar e conferir`)) return;
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
  if (!enviar({ type: 'START_EMPENHO', payload, queue: resto.map(solToPayload) })) return;

  renderPayloadCard(payload);

  el('log').innerHTML = '';
  setBadge('running');
  showScreen('automation');
}

function solToPayload(sol) {
  return {
    numeroSolicitacao: sol.solicitacao,
    operacao:          sol.operacao || '',        // '' | 'reforco' | 'anulacao'
    neAlterar:         sol.operacao ? (sol.neAlterar || '') : '',
    identOperacao:     sol.identOperacao || '',
    fornecedorNome:    sol.fornecedorNome,
    fornecedorCnpj:    sol.fornecedorCnpj,
    localEntrega:      sol.localEntrega,
    compradora:        sol.compradora,
    contrato:          sol.contrato,
    credenciamento:    !!sol.credenciamento,
    tipoOrigem:        sol.tipoOrigem ?? (sol.contrato ? 'contrato' : 'compra'),
    numeroCompra:      sol.numeroCompra ?? '',
    modalidade:        sol.modalidade ?? '',
    unidadeCompra:     sol.unidadeCompra || unidadeCompraDoPerfil(),
    tipoEmpenho:       sol.tipoEmpenho || tipoEmpenhoPadrao(sol),
    verificacaoFornecedor: sol.operacao === 'anulacao' ? null : (() => {
      const v = vereditoFornecedor(sol);
      return v.nivel === 'verificando' ? null : { nivel: v.nivel, resumo: v.resumo, consultadoEm: v.consultadoEm };
    })(),
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
  el('btn-pause') .addEventListener('click', () => enviar({ type: 'PAUSE' }));
  el('btn-resume').addEventListener('click', () => enviar({ type: 'RESUME' }));
  el('btn-abort') .addEventListener('click', () => {
    if (confirm('Abortar a execução atual? O estado será resetado.')) {
      enviar({ type: 'ABORT' });
    }
  });
  // Some no primeiro clique: um segundo clique chegava com a emissão já em curso
  el('btn-confirm').addEventListener('click', () => {
    if (!enviar({ type: 'CONFIRM_EMISSAO' })) return;
    showCheckpoint(false);
    setBadge('running');
    appendLog('▶ Emissão confirmada — emitindo…', 'info');
  });
}

// ── Conexão com background ────────────────────────────────────────────────────
// O Chrome encerra o service worker após ~30s ocioso, o que derruba a porta
// (e o Firefox faz o mesmo com a event page). Enviar sempre por aqui: se a porta
// caiu, reconecta — isso reinicia o background — em vez de descartar o comando.
function enviar(msg) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (!port) connectPort(false);
    try { port.postMessage(msg); return true; }
    catch { port = null; }
  }
  const aviso = 'Sem comunicação com a extensão. Feche e reabra este painel.';
  appendLog('❌ ' + aviso, 'error');
  setBadge('error');
  alert(aviso);
  return false;
}

function connectPort(pedirEstado = true) {
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
        case 'DONE': {
          const st = msg.status ?? (msg.ne ? 'emitido' : 'pendente');
          setBadge('done');
          appendLog(
            st === 'emitido' ? `🎉 ${msg.payload?.numeroSolicitacao ?? ''} → NE ${msg.ne}`
              : st === 'erro' ? `❌ ${msg.payload?.numeroSolicitacao ?? ''}: SIAFI recusou${msg.mensagem ? ' — ' + msg.mensagem : ''}`
              : `⏳ ${msg.payload?.numeroSolicitacao ?? ''}: enviado ao SIAFI, NE em processamento (busco no fim da fila)`,
            st === 'emitido' ? 'success' : st === 'erro' ? 'error' : 'warn');
          showCheckpoint(false);
          showResultadoEmpenho(msg);
          renderEmpenhosGerados();
          logActivity('DONE', { ne: msg.ne ?? null, status: st });
          break;
        }
        case 'QUEUE_DONE':
          setBadge('done');
          renderEmpenhosGerados();
          renderRelatorioFila(msg.inicioFila ?? null);
          break;
        case 'ERROR':         setBadge('error');
                              appendLog(`❌ ${msg.message}`, 'error');
                              // Se erro durante coleta, mostra no painel de solicitações
                              el('coleta-current').textContent = `Erro: ${msg.message}`;
                              logActivity('ERROR', { msg: msg.message });    break;
        case 'STARTED':       setBadge('running'); appendLog('▶ Iniciado', 'info'); break;
        case 'CHECKPOINT':    showCheckpoint(true, msg.summary);
                              if (msg.summary?.motivo) appendLog(`⚠ ${msg.summary.motivo}`, 'warn');
                              break;
        case 'NEXT_AVAILABLE':
          setBadge('running');
          showCheckpoint(false);
          document.getElementById('resultado-empenho')?.remove();
          el('log').innerHTML = '';
          if (msg.payload) renderPayloadCard(msg.payload);
          else el('inf-numero').textContent = msg.numero || '—';
          appendLog(`▶ Próxima da fila: ${msg.numero}${msg.restantes ? ` (depois dela, mais ${msg.restantes})` : ''}`, 'info');
          break;
      }
    });

    port.onDisconnect.addListener(() => { port = null; });
    // Ao reconectar para enviar um comando não pede o estado: a resposta chegaria
    // depois e repintaria a execução anterior por cima da nova.
    if (pedirEstado) port.postMessage({ type: 'GET_STATE' });
  } catch { port = null; }
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
    // Alteração (reforço/anulação/irrisório): A1–A5 nos pontos 1, 2, 5, 7 e 8
    updateStep(state.flow === 'alteracao-cnet' ? ([1, 2, 5, 7, 8][state.altStep ?? 0] ?? 8) : state.step);
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
// Payload do PDF (fornecedorCnpj, total em texto) ou da coleta SILOMS (fornecedorCNPJ, _total)
function renderPayloadCard(p) {
  el('payload-card').style.display = '';
  el('inf-numero').textContent = p.numeroSolicitacao || '–';
  el('inf-forn').textContent   = p.fornecedorNome || '–';
  el('inf-cnpj').textContent   = formatCNPJ(String(p.fornecedorCNPJ ?? p.fornecedorCnpj ?? '').replace(/\D/g, '')) || '–';
  el('inf-compra').textContent = p.tipoOrigem === 'compra'
    ? `Compra ${p.numeroCompra ?? ''}${p.modalidade ? ` · ${p.modalidade}` : ''}`
    : (p.contrato || p.numeroCompra || '–');
  el('inf-total').textContent  = p._total != null ? fmtBRL(p._total) : (p.total ? `R$ ${p.total}` : '–');
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
  const st              = msg.status ?? (msg.ne ? 'emitido' : 'pendente');
  const ne              = msg.ne ?? (st === 'erro' ? 'erro no SIAFI' : 'em processamento');
  const titulo          = st === 'emitido' ? '✅ EMPENHO EMITIDO' : st === 'erro' ? '❌ SIAFI RECUSOU' : '⏳ ENVIADO AO SIAFI — NE EM PROCESSAMENTO';
  const corTitulo       = st === 'emitido' ? '#4ade80' : st === 'erro' ? '#f87171' : '#fbbf24';
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
    <div style="color:${corTitulo};font-size:12px;font-weight:700;letter-spacing:.5px;">${titulo}</div>
    <div style="font-size:18px;font-weight:700;color:#fff;margin:4px 0;">${escHtml(ne)}</div>
    ${st === 'erro' && msg.mensagem ? `<div style="font-size:11px;color:#fca5a5;margin-bottom:6px;">${escHtml(msg.mensagem)}</div>` : ''}
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

/**
 * Relatório do fim da fila: empenhadas, as que faltou reforço irrisório (com o
 * valor) e as que não foram empenhadas (com etapa e motivo).
 */
async function renderRelatorioFila(inicio) {
  let lista = [];
  try { lista = (await chrome.storage.local.get(REGISTRO_EMPENHOS_KEY))[REGISTRO_EMPENHOS_KEY] ?? []; } catch {}
  lista = lista.filter(r => !inicio || r.data >= inicio);
  document.getElementById('resultado-empenho')?.remove();
  document.getElementById('relatorio-fila')?.remove();
  if (!lista.length) return;

  const fmtV = v => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const st = statusRegistro;
  const emitidas  = lista.filter(r => st(r) === 'emitido' || st(r) === 'pendente');
  // Irrisório: o robô faz sozinho depois da emissão; aqui só os que ficaram por fazer
  const reforco   = emitidas.filter(r => (r.reforco ?? 0) > 0 && r.reforcoStatus !== 'feito');
  const irrFeitos = emitidas.filter(r => (r.reforco ?? 0) > 0 && r.reforcoStatus === 'feito');
  const op = r => r.operacao === 'anulacao' ? ' <i>(anulação)</i>' : r.operacao === 'reforco' ? ' <i>(reforço)</i>' : '';
  const nomeIrr = r => r.operacao === 'anulacao' ? 'anulação saldo irrisório' : 'reforço irrisório';
  const porque = r => ({ 'pendente-ne': 'NE ainda em processamento', falhou: r.reforcoMotivo || 'o robô não conseguiu', conferir: r.reforcoMotivo || 'confira no CNET', erro: 'SIAFI recusou' })[r.reforcoStatus] ?? 'faça no CNET';
  const problemas = lista.filter(r => ['falhou', 'erro', 'conferir'].includes(st(r)));
  const totalReforco = reforco.reduce((t, r) => t + r.reforco, 0);
  const ne = r => (st(r) === 'emitido' ? r.ne : 'NE em processamento');
  const oQue = r => st(r) === 'erro' ? (r.motivo || `SIAFI recusou${r.mensagem ? `: ${r.mensagem}` : ''}`)
    : `${r.etapa != null ? `Etapa ${r.etapa}: ` : ''}${r.motivo || 'confira no CNET'}`;
  const secao = (titulo, cor, itens, linha) => itens.length ? `
    <div class="rf-sec" style="color:${cor}">${titulo}</div>
    <ul class="rf-lista">${itens.map(r => `<li>${linha(r)}</li>`).join('')}</ul>` : '';

  const div = document.createElement('div');
  div.id = 'relatorio-fila';
  div.innerHTML = `
    <div class="rf-titulo">🏁 RELATÓRIO DA FILA — ${lista.length} solicitação(ões)</div>
    ${secao(`✅ Empenhadas / alteradas (${emitidas.length})`, '#4ade80', emitidas,
      r => `<b>${escHtml(r.solicitacao)}</b>${op(r)} → ${escHtml(ne(r))} · R$ ${fmtV(r.valorEmpenhado)}`)}
    ${secao(`✓ Irrisório feito pelo robô (${irrFeitos.length})`, '#86efac', irrFeitos,
      r => `<b>${escHtml(r.solicitacao)}</b> → ${nomeIrr(r)} de R$ ${fmtV(r.reforco)} na ${escHtml(ne(r))}`)}
    ${secao(`⚠ Irrisório a fazer (${reforco.length}) — total R$ ${fmtV(totalReforco)}`, '#fbbf24', reforco,
      r => `<b>${escHtml(r.solicitacao)}</b> → ${escHtml(ne(r))} · <b>${nomeIrr(r)} de R$ ${fmtV(r.reforco)}</b> — ${escHtml(porque(r))}`)}
    ${secao(`⛔ Não empenhadas / com problema (${problemas.length})`, '#f87171', problemas,
      r => `<b>${escHtml(r.solicitacao || '—')}</b>${st(r) === 'conferir' ? ' <i>(conferir no CNET)</i>' : ''} — ${escHtml(oQue(r))}`)}
    <button id="rf-csv" class="eg-btn" type="button">📥 Baixar relatório da fila (CSV)</button>
    ${emitidas.length ? `<button id="rf-subproc" class="eg-btn" type="button" title="Um subprocesso por solicitação empenhada, com a solicitação e a declaração do SICAF — com o SILOMS aberto">📁 Criar subprocessos no SILOMS (${emitidas.length})</button>` : ''}`;
  const logEl = el('log');
  logEl?.parentElement?.insertBefore(div, logEl.nextSibling);
  el('rf-csv').onclick = () => baixarCsvEmpenhos(lista, 'relatorio_fila');
  if (el('rf-subproc')) el('rf-subproc').onclick = () => abrirSubprocessos();
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

// ── Empenhos gerados (solicitação → NE) ───────────────────────────────────────
// Mesma chave de runner/stateMachine.js (REGISTRO_KEY), que grava a cada emissão
const REGISTRO_EMPENHOS_KEY = 'empenhosGerados';

// Mesma chave de runner/stateMachine.js (CONFIRMAR_ANTES_KEY)
const CONFIRMAR_ANTES_KEY = 'empenhoConfirmarAntes';

function setupEmpenhosGerados() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[REGISTRO_EMPENHOS_KEY]) renderEmpenhosGerados();
  });
  renderEmpenhosGerados();

  // Desligado (padrão): o robô confere a Etapa 8, emite, finaliza e segue a fila
  const opt = el('opt-confirmar-antes');
  if (opt) {
    chrome.storage.local.get(CONFIRMAR_ANTES_KEY).then(d => { opt.checked = !!d[CONFIRMAR_ANTES_KEY]; }).catch(() => {});
    opt.addEventListener('change', () => chrome.storage.local.set({ [CONFIRMAR_ANTES_KEY]: opt.checked }));
  }
}

// Registros sem `status` vêm da versão 2.1.9, que podia anotar a NE de outra solicitação
const statusRegistro = r => r.status ?? 'conferir';

async function renderEmpenhosGerados() {
  const box = el('empenhos-gerados');
  if (!box) return;
  let lista = [];
  try { lista = (await chrome.storage.local.get(REGISTRO_EMPENHOS_KEY))[REGISTRO_EMPENHOS_KEY] ?? []; } catch {}
  if (!lista.length) { box.innerHTML = ''; return; }

  const fmtV = v => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const quando = iso => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  };
  const pendentes = lista.filter(r => statusRegistro(r) === 'pendente' && r.url).length;
  const celulaNE = r => {
    const st = statusRegistro(r);
    if (st === 'emitido') return `<td>${escHtml(r.ne)}</td>`;
    if (st === 'erro') return `<td class="eg-erro" title="${escHtml(r.mensagem || r.situacao || 'Erro no SIAFI')}">erro SIAFI</td>`;
    if (st === 'falhou') return `<td class="eg-erro" title="${escHtml(`Etapa ${r.etapa ?? '?'}: ${r.motivo ?? ''}`)}">não empenhada</td>`;
    if (st === 'conferir') return `<td class="eg-conferir" title="${escHtml(r.motivo ? `Etapa ${r.etapa ?? '?'}: ${r.motivo}` : 'Anotada pela versão anterior, que podia pegar a NE de outra solicitação — confira no CNET')}">${escHtml(r.ne ? r.ne + ' ⚠' : 'conferir no CNET')}</td>`;
    return `<td class="eg-conferir" title="${r.url ? 'Ainda em processamento — use Buscar pendentes' : 'Número não lido — confira no CNET'}">${r.url ? 'em processamento' : 'conferir no CNET'}</td>`;
  };
  box.innerHTML = `
    <div class="eg-head">
      <span>EMPENHOS GERADOS (${lista.length})</span>
      <span>
        ${pendentes ? `<button id="eg-pendentes" class="eg-btn" title="Abre cada minuta em processamento no CNET e anota o número da NE">🔄 Buscar pendentes (${pendentes})</button>` : ''}
        <button id="eg-subproc" class="eg-btn" title="Criar no SILOMS os subprocessos das solicitações empenhadas">📁 Subprocessos</button>
        <button id="eg-csv" class="eg-btn" title="Todos os empenhos registrados, com fornecedor e valores">📥 CSV</button>
        <button id="eg-copiar" class="eg-btn" title="Copia solicitação e NE (cola em planilha)">📋 Copiar</button>
        <button id="eg-limpar" class="eg-btn eg-btn-danger">Limpar</button>
      </span>
    </div>
    <table class="eg-table">
      <thead><tr><th>Solicitação</th><th>NE</th><th>Valor R$</th><th>Data</th></tr></thead>
      <tbody>${[...lista].reverse().slice(0, 50).map(r => `<tr>
        <td>${escHtml(r.solicitacao || '–')}</td>
        ${celulaNE(r)}
        <td>${statusRegistro(r) === 'falhou' ? '—' : fmtV(r.valorEmpenhado)}${(r.reforco ?? 0) > 0 ? ` <span class="eg-conferir" title="Reforço irrisório: falta para o solicitado">(falta ${fmtV(r.reforco)})</span>` : ''}</td>
        <td>${escHtml(quando(r.data))}</td>
      </tr>`).join('')}</tbody>
    </table>`;

  if (el('eg-pendentes')) el('eg-pendentes').onclick = () => {
    if (enviar({ type: 'RESOLVER_PENDENTES' })) appendLog('🔎 Buscando as NEs em processamento no CNET…', 'info');
  };
  el('eg-csv').onclick = () => baixarCsvEmpenhos(lista);
  el('eg-subproc').onclick = () => abrirSubprocessos();
  el('eg-copiar').onclick = async () => {
    try {
      // só NE confirmada; as demais vão em branco
      await navigator.clipboard.writeText(lista.map(r => `${r.solicitacao}\t${statusRegistro(r) === 'emitido' ? r.ne : ''}`).join('\n'));
      el('eg-copiar').textContent = '✓ Copiado';
    } catch { el('eg-copiar').textContent = 'Falhou'; }
    setTimeout(() => { const b = el('eg-copiar'); if (b) b.textContent = '📋 Copiar'; }, 1500);
  };
  el('eg-limpar').onclick = async () => {
    if (!confirm('Apagar a lista de empenhos gerados? Baixe o CSV antes, se precisar.')) return;
    await chrome.storage.local.remove(REGISTRO_EMPENHOS_KEY);
  };
}

function baixarCsvEmpenhos(lista, nome = 'empenhos_gerados') {
  const fmtV = v => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const linhas = [
    ['Data', 'Nº Solicitação', 'Nº Empenho', 'Situação', 'Etapa', 'Motivo do problema', 'Mensagem SIAFI', 'Fornecedor', 'CNPJ', 'Contrato/Compra',
      'Valor Solicitado', 'Valor Empenhado', 'Reforço irrisório', 'Verificação do fornecedor'],
    ...lista.map(r => {
      const st = statusRegistro(r);
      return [
        new Date(r.data).toLocaleString('pt-BR'), r.solicitacao, st === 'emitido' ? r.ne : '',
        st === 'emitido' ? 'Emitido' : st === 'erro' ? 'Erro no SIAFI' : st === 'falhou' ? 'Não empenhada'
          : st === 'conferir' ? `Conferir no CNET${r.ne ? ` (anotada: ${r.ne})` : ''}` : 'Em processamento',
        r.etapa ?? '', r.motivo ?? '',
        r.mensagem ?? '', r.fornecedor, r.cnpj, r.origem, fmtV(r.valorSolicitado), st === 'falhou' ? '' : fmtV(r.valorEmpenhado),
        (r.reforco ?? 0) > 0 ? fmtV(r.reforco) : '',
        r.verificacaoFornecedor ?? '',
      ];
    }),
  ];
  const csv = linhas.map(l => l.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nome}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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

async function empenharSolicitacao(sol, mode) {
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
    // Fornecedor impedido: não inicia (o usuário decide no CNET)
    const v = await verificarFornecedor(sol.fornecedorCNPJ);
    if (v.nivel === 'bloqueio') {
      alert(`Fornecedor impedido — empenho de ${sol.numero} não iniciado:\n\n${v.resumo}`);
      return;
    }
    // Certidões: só com o SICAF aberto (senão pede confirmação)
    const sicaf = (await abaDoSicaf().catch(() => null)) ? await conferirNoSicaf(sol.fornecedorCNPJ) : { estado: 'sem-aba' };
    if (sicaf.estado === 'ok' && sicaf.nivel === 'bloqueio') {
      alert(`Fornecedor irregular no SICAF — empenho de ${sol.numero} não iniciado:\n\n${sicaf.resumo}`);
      return;
    }
    if (sicaf.estado !== 'ok' && !confirm(`Certidões do fornecedor NÃO conferidas no SICAF (${textoSicafPendente(sicaf)}).\n\nEmpenhar ${sol.numero} assim mesmo?`)) return;
    // Envia payload para empenho CONTRATOSGOV
    const ordem = ['ok', 'atencao', 'bloqueio'];
    const nivel = ordem[Math.max(ordem.indexOf(v.nivel), ordem.indexOf(sicaf.estado === 'ok' ? sicaf.nivel : 'atencao'))];
    const resumo = `${v.resumo} · ${sicaf.estado === 'ok' ? sicaf.resumo : 'certidões não conferidas no SICAF'}`;
    const payload = { ...buildCnetPayload(sol), verificacaoFornecedor: { nivel, resumo, consultadoEm: sicaf.consultadoEm ?? v.consultadoEm ?? null } };
    el('auto-mode-label').textContent = 'CONTRATOSGOV';
    el('siloms-soon').style.display   = 'none';
    el('cnet-auto').style.display     = 'flex';
    el('status-badge-auto').style.display = '';
    el('log').innerHTML = '';
    showScreen('automation');
    appendLog(`📋 Iniciando empenho CONTRATOSGOV para ${sol.numero}…`, 'info');
    enviar({ type: 'START_EMPENHO', payload });
  }
}

function buildCnetPayload(sol) {
  const item0 = sol.items?.[0] ?? {};
  return {
    numeroSolicitacao: sol.numero,
    fornecedorNome:    sol.fornecedorNome ?? sol.fornecedor ?? '',
    fornecedorCNPJ:    sol.fornecedorCNPJ ?? '',
    numeroCompra:      sol.pag ?? '',
    contrato:          String(sol.contrato ?? '').replace(/^(?:DESPESA\s+)?CRED(?:ENCIAMENTO)?\.?\s+(?=\d)/i, ''),
    credenciamento:    /^(?:DESPESA\s+)?CRED(?:ENCIAMENTO)?\.?\s+\d/i.test(String(sol.contrato ?? '')),
    tipoOrigem:        sol.contrato ? 'contrato' : 'compra',
    unidadeCompra:     sol.ugCred ?? '120630',
    tipoEmpenho:       tipoEmpenhoPadrao({ tipoOrigem: sol.contrato ? 'contrato' : 'compra', obs: sol.obs, itens: sol.items }),
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
