/**
 * Máquina de estados — GAPMN Empenho Bot v2.0
 *
 * Dois fluxos:
 *   1. COLETA: Navega no SILOMS, coleta todas as solicitações assinadas (comum a ambos os modos)
 *   2. EMPENHO-CNET: Preenche minuta no Contratos.gov.br (8 etapas existentes)
 *   2b. EMPENHO-SILOMS: (Phase 3 — a implementar)
 *
 * Estado persistido em chrome.storage.local (chave: STORAGE_KEY):
 *   state          = 'idle' | 'running' | 'paused' | 'checkpoint' | 'done' | 'error'
 *   flow           = null | 'coleta' | 'empenho-cnet' | 'empenho-siloms'
 *   mode           = null | 'siloms' | 'contratosgov'   (escolha do usuário)
 *   coletaPhase    = 'navegar' | 'filtrar' | 'lista' | 'detalhe' | 'done'
 *   coletaIndex    = number   (solicitação atual sendo processada)
 *   coletaTotal    = number
 *   solicitacoes   = []       (lista básica da tabela)
 *   solDetalhes    = []       (dados completos de cada uma)
 *   step           = 0-8      (0=pré-navegação minuta→etapa1; 1-8=etapas CNET)
 *   payload        = object   (solicitação atual em empenho)
 *   queue          = []
 *   log            = []
 *   silomsTabId    = number
 *   cnetTabId      = number
 *   dryRun         = boolean
 */

import { step1Runner } from './steps/step1.js';
import { step3Runner } from './steps/step3.js';
import { maximizarTabelasRunner } from './steps/tabelas.js';
import { step4Runner } from './steps/step4.js';
import { step5Runner } from './steps/step5.js';
import { step6Runner } from './steps/step6.js';
import {
  step0ClickAdicionarMinuta,
  step0PesquisarContrato,
  step0SelecionarContrato,
} from './steps/step0.js';
import {
  silomsCheckListPage,
  silomsClickMenuEmpenho,
  silomsClickSubmenu,
  silomsSetFiltroEBuscar,
  silomsParseListaSolicitacoes,
  silomsAbrirSolicitacao,
  silomsExtrairDocumento,
  silomsVoltar,
} from './steps/step-siloms-coleta.js';

const STORAGE_KEY = 'empenhoBot';
const COMPRASNET_URL = 'https://contratos.comprasnet.gov.br/empenho/buscacompra';
// Empenhos emitidos (solicitação → NE), guardados entre execuções
export const REGISTRO_KEY = 'empenhosGerados';

// ── Persistência ──────────────────────────────────────────────────────────────

export async function getState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] ?? {
    state: 'idle', flow: null, mode: null,
    coletaPhase: null, coletaIndex: 0, coletaTotal: 0,
    solicitacoes: [], solDetalhes: [],
    step: 0, payload: null, queue: [], log: [],
    silomsTabId: null, cnetTabId: null, dryRun: false,
  };
}

export async function setState(patch) {
  const current = await getState();
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...current, ...patch } });
}

export async function appendLog(msg, level = 'info') {
  const s = await getState();
  const log = [...(s.log ?? []), { ts: Date.now(), msg, level }];
  await setState({ log: log.slice(-200) });
}

// ── Execução na página ────────────────────────────────────────────────────────

async function execInPage(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    world: 'MAIN',
    func,
    args,
  });
  return results?.[0]?.result ?? null;
}

async function waitForNavigation(tabId, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('waitForNavigation timeout'));
    }, timeout);

    function listener(tId, changeInfo) {
      if (tId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function delay(ms) { await new Promise(r => setTimeout(r, ms)); }

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Inicia o fluxo de COLETA no SILOMS.
 * mode: 'siloms' | 'contratosgov' — determina o que fazer após a coleta.
 */
export async function startColeta(mode, silomsTabId) {
  await setState({
    state: 'running',
    flow: 'coleta',
    mode,
    coletaPhase: 'navegar',
    coletaIndex: 0,
    coletaTotal: 0,
    solicitacoes: [],
    solDetalhes: [],
    silomsTabId,
    log: [],
  });

  runStateMachine().catch(async err => {
    await appendLog(`❌ Erro fatal: ${err.message}`, 'error');
    await setState({ state: 'error' });
    notifySidePanel({ type: 'ERROR', message: err.message });
  });

  return { ok: true, started: true };
}

/**
 * Inicia empenho no CONTRATOSGOV com payload específico (fluxo legado / via gapmn.app).
 */
export async function startEmpenho(payload, tabId, dryRun = false, initialQueue = []) {
  const orfa = await recuperarExecucaoOrfa();
  const s = await getState();

  if (s.state === 'running' || s.state === 'checkpoint') {
    await setState({ queue: [...(s.queue ?? []), payload, ...initialQueue] });
    return { ok: true, queued: true };
  }

  await setState({
    state: 'running', flow: 'empenho-cnet',
    step: 0, payload, queue: initialQueue, cnetTabId: tabId, dryRun, log: [],
  });
  if (orfa) {
    await appendLog(`⚠ A execução anterior (${orfa}) tinha sido interrompida e foi descartada.`, 'warn');
  }

  runStateMachine().catch(async err => {
    await appendLog(`❌ Erro fatal: ${err.message}`, 'error');
    await setState({ state: 'error' });
    notifySidePanel({ type: 'ERROR', message: err.message });
  });

  return { ok: true, started: true };
}

export async function pauseEmpenho() {
  await setState({ state: 'paused' });
  await appendLog('⏸ Pausado pelo usuário', 'warn');
  notifySidePanel({ type: 'PAUSED' });
}

export async function resumeEmpenho() {
  const s = await getState();
  if (s.state !== 'paused') return { ok: false, error: 'Não está pausado' };
  await setState({ state: 'running' });
  await appendLog('▶ Retomado', 'info');
  runStateMachine().catch(async err => {
    await appendLog(`❌ Erro ao retomar: ${err.message}`, 'error');
    await setState({ state: 'error' });
  });
  return { ok: true };
}

export async function abortEmpenho() {
  await setState({ state: 'idle', step: 0, coletaPhase: null });
  await appendLog('🛑 Abortado pelo usuário', 'warn');
  notifySidePanel({ type: 'ABORTED' });
}

export async function confirmEmissao() {
  const s = await getState();
  if (s.state !== 'checkpoint' || s.step !== 8) {
    return { ok: false, error: 'Não está no checkpoint da Etapa 8' };
  }
  if (maquinaAtiva) return { ok: false, error: 'O robô ainda está executando' };
  await setState({ state: 'running' });
  // Marca a máquina como ativa: durante a emissão o estado é "running" sem laço, e
  // um GET_STATE do painel nesse meio a trataria como execução órfã.
  maquinaAtiva = true;
  let proximo = false;
  try {
    proximo = await runStep8Confirm(s.cnetTabId, s.payload);
  } finally {
    maquinaAtiva = false;
  }
  if (proximo) {
    runStateMachine().catch(async err => {
      await appendLog(`❌ Erro fatal: ${err.message}`, 'error');
      await setState({ state: 'error' });
      notifySidePanel({ type: 'ERROR', message: err.message });
    });
  }
  return { ok: true };
}

// ── Máquina de estados principal ──────────────────────────────────────────────

// O estado fica no storage e sobrevive a recarregar a extensão ou ao navegador
// encerrar o service worker; o laço que o executava, não. Por isso "running"
// no storage não prova que há algo rodando — este flag, em memória, prova.
let maquinaAtiva = false;

/**
 * Se o storage diz "running" mas nenhum laço está ativo, a execução ficou órfã:
 * marca como pausada (o usuário pode Retomar da mesma etapa ou Abortar).
 * Retorna a identificação da execução órfã, ou null.
 */
export async function recuperarExecucaoOrfa() {
  const s = await getState();
  if (s.state !== 'running' || maquinaAtiva) return null;
  const id = s.flow === 'coleta'
    ? 'coleta do SILOMS'
    : `${s.payload?.numeroSolicitacao ?? 'solicitação'}, Etapa ${s.step}`;
  await setState({ state: 'paused' });
  await appendLog(`⚠ Execução interrompida (${id}) — a extensão foi recarregada ou o navegador a encerrou. Use Retomar ou Abortar.`, 'warn');
  return id;
}

async function runStateMachine() {
  // Um laço por vez: um laço pausado continua vivo aguardando, e Retomar não
  // pode abrir um segundo que executaria as mesmas etapas em paralelo.
  if (maquinaAtiva) return;
  maquinaAtiva = true;
  try {
    await laçoDaMaquina();
  } finally {
    maquinaAtiva = false;
  }
}

async function laçoDaMaquina() {
  while (true) {
    const s = await getState();
    if (s.state === 'paused') { await delay(1000); continue; }
    if (s.state !== 'running') break;

    if (s.flow === 'coleta') {
      const shouldContinue = await runColetaStep(s);
      if (!shouldContinue) break;
    } else if (s.flow === 'empenho-cnet') {
      const shouldContinue = await runEmpenhoStep(s);
      if (!shouldContinue) break;
    } else {
      break;
    }
  }
}

// ── Fluxo COLETA ──────────────────────────────────────────────────────────────

async function runColetaStep(s) {
  const { coletaPhase, silomsTabId: tabId } = s;

  switch (coletaPhase) {

    case 'navegar': {
      await appendLog('🔍 Verificando página do SILOMS…', 'info');
      notifySidePanel({ type: 'LOG', msg: '🔍 Verificando página do SILOMS…', level: 'info' });

      let check = null;
      try { check = await execInPage(tabId, silomsCheckListPage); } catch {}

      if (!check) {
        await appendLog('❌ Não foi possível acessar o SILOMS. Abra o SILOMS na aba ativa.', 'error');
        await setState({ state: 'paused' });
        notifySidePanel({ type: 'PAUSED', error: 'Aba do SILOMS não acessível. Confirme que está logado.' });
        return false;
      }

      if (!check.onListPage) {
        await appendLog('📂 Navegando para Empenho → Solicitação de Empenho (Recebidas)…', 'info');
        notifySidePanel({ type: 'LOG', msg: '📂 Abrindo menu Empenho…', level: 'info' });

        const r1 = await execInPage(tabId, silomsClickMenuEmpenho);
        if (!r1?.ok) {
          await appendLog(`❌ ${r1?.error ?? 'Menu Empenho não encontrado'}`, 'error');
          await setState({ state: 'paused' });
          notifySidePanel({ type: 'PAUSED', error: r1?.error ?? 'Menu Empenho não encontrado' });
          return false;
        }

        await delay(700);
        const r2 = await execInPage(tabId, silomsClickSubmenu);
        if (!r2?.ok) {
          await appendLog(`❌ ${r2?.error ?? 'Submenu não encontrado'}`, 'error');
          await setState({ state: 'paused' });
          notifySidePanel({ type: 'PAUSED', error: r2?.error ?? 'Submenu não encontrado' });
          return false;
        }

        await appendLog('⏳ Aguardando página de solicitações…', 'info');
        try { await waitForNavigation(tabId, 30000); } catch { await delay(3000); }
        await delay(800);
      } else {
        await appendLog('✅ Já está na página de solicitações.', 'info');
      }

      await setState({ coletaPhase: 'filtrar' });
      return true;
    }

    case 'filtrar': {
      await appendLog('🔎 Filtrando por "Assinada OD UGCred" e buscando…', 'info');
      notifySidePanel({ type: 'LOG', msg: '🔎 Aplicando filtro e buscando…', level: 'info' });

      const r = await execInPage(tabId, silomsSetFiltroEBuscar);
      if (!r?.ok) {
        await appendLog(`❌ ${r?.error ?? 'Erro ao filtrar'}`, 'error');
        await setState({ state: 'paused' });
        notifySidePanel({ type: 'PAUSED', error: r?.error ?? 'Erro ao filtrar' });
        return false;
      }

      await appendLog('⏳ Aguardando resultados…', 'info');
      try { await waitForNavigation(tabId, 30000); } catch { await delay(3000); }
      await delay(800);
      await setState({ coletaPhase: 'lista' });
      return true;
    }

    case 'lista': {
      await appendLog('📋 Lendo lista de solicitações…', 'info');
      notifySidePanel({ type: 'LOG', msg: '📋 Lendo lista de solicitações…', level: 'info' });

      const r = await execInPage(tabId, silomsParseListaSolicitacoes);
      if (!r?.ok) {
        await appendLog('❌ Erro ao ler lista', 'error');
        await setState({ state: 'paused' });
        notifySidePanel({ type: 'PAUSED', error: 'Erro ao ler lista de solicitações' });
        return false;
      }

      if (r.count === 0) {
        await appendLog('ℹ Nenhuma solicitação "Assinada OD UGCred" encontrada.', 'warn');
        await setState({ state: 'done', coletaPhase: 'done', solDetalhes: [] });
        notifySidePanel({ type: 'COLETA_DONE', solicitacoes: [], mode: s.mode });
        return false;
      }

      await appendLog(`✅ ${r.count} solicitações encontradas. Iniciando coleta de detalhes…`, 'info');
      notifySidePanel({ type: 'LOG', msg: `✅ ${r.count} solicitação(ões) encontrada(s)`, level: 'success' });
      notifySidePanel({ type: 'COLETA_TOTAL', total: r.count });

      await setState({
        coletaPhase: 'detalhe',
        coletaIndex: 0,
        coletaTotal: r.count,
        solicitacoes: r.solicitacoes,
        solDetalhes: [],
      });
      return true;
    }

    case 'detalhe': {
      const { solicitacoes: sols, coletaIndex: idx, solDetalhes: detalhes } = s;

      if (idx >= sols.length) {
        // Todas coletadas
        await appendLog(`🎉 Coleta concluída! ${detalhes.length} solicitação(ões) prontas para empenho.`, 'success');
        await setState({ state: 'checkpoint', coletaPhase: 'done' });
        notifySidePanel({
          type: 'COLETA_DONE',
          solicitacoes: detalhes,
          mode: s.mode,
        });
        return false;
      }

      const current = sols[idx];
      await appendLog(`📄 [${idx + 1}/${sols.length}] Abrindo solicitação ${current.numero}…`, 'info');
      notifySidePanel({
        type: 'COLETA_PROGRESS',
        current: idx + 1,
        total:   sols.length,
        numero:  current.numero,
      });

      // Abre a solicitação
      const r1 = await execInPage(tabId, silomsAbrirSolicitacao, [current.numero]);
      if (!r1?.ok) {
        await appendLog(`⚠ ${r1?.error ?? 'Não encontrou link'} — pulando.`, 'warn');
        await setState({ coletaIndex: idx + 1 });
        return true;
      }

      try { await waitForNavigation(tabId, 20000); } catch { await delay(2000); }
      await delay(600);

      // Extrai dados do documento
      const doc = await execInPage(tabId, silomsExtrairDocumento);
      const detalhe = doc?.ok
        ? { ...current, ...doc }
        : { ...current, ok: false, error: doc?.error ?? 'Falha ao extrair' };

      await appendLog(
        doc?.ok
          ? `  ✓ ${current.numero} — ${doc.fornecedorNome} — R$ ${doc.total}`
          : `  ⚠ ${current.numero} — erro ao extrair: ${doc?.error}`,
        doc?.ok ? 'success' : 'warn'
      );

      // Volta para a lista
      await execInPage(tabId, silomsVoltar);
      try { await waitForNavigation(tabId, 20000); } catch { await delay(2000); }
      await delay(600);

      await setState({
        coletaIndex: idx + 1,
        solDetalhes: [...detalhes, detalhe],
      });
      return true;
    }

    default:
      return false;
  }
}

// ── Fluxo EMPENHO-CNET (8 etapas — existente) ─────────────────────────────────

// Identifica a tela atual (caminho + título). Com tempo limite: um alert() do
// CNET bloqueia a página e o executeScript ficaria esperando para sempre.
async function impressaoDaPagina(tabId) {
  const ler = execInPage(tabId, () => {
    const visivel = e => e && e.offsetParent !== null && (e.textContent ?? '').trim();
    const erros = Array.from(document.querySelectorAll(
      '.alert-danger, .has-error .help-block, .invalid-feedback, .swal2-html-container, .toast-message, .error'
    )).filter(visivel).map(e => e.textContent.replace(/\s+/g, ' ').trim()).slice(0, 3);
    const titulo = (document.querySelector('.content-header h1, section.content-header, h1')?.textContent ?? '')
      .replace(/\s+/g, ' ').trim().slice(0, 80);
    return { caminho: location.pathname, titulo, erros };
  }).catch(() => null);
  const limite = new Promise(r => setTimeout(() => r({ bloqueada: true }), 6000));
  return (await Promise.race([ler, limite])) ?? { bloqueada: true };
}

async function runEmpenhoStep(s) {
  const { step, payload, cnetTabId: tabId, dryRun } = s;
  await appendLog(`━ Iniciando Etapa ${step}`, 'info');
  notifySidePanel({ type: 'STEP', step });
  // Etapas 1–7 terminam clicando "Próxima"; guardo a tela para conferir o avanço
  const antes = step >= 1 && step <= 7 ? await impressaoDaPagina(tabId) : null;

  try {
    let result;
    switch (step) {
      case 0: result = await runStep0(tabId, payload); break;
      case 1: result = await runStep1(tabId, payload); break;
      case 2: result = await runStep2(tabId, payload); break;
      case 3: result = await runStep3(tabId, payload); break;
      case 4: result = await runStep4(tabId, payload); break;
      case 5: result = await runStep5(tabId, payload); break;
      case 6: result = await runStep6(tabId, payload); break;
      case 7: result = await runStep7(tabId); break;
      case 8: result = await runStep8Checkpoint(tabId, payload, dryRun); break;
      default:
        await setState({ state: 'done' });
        notifySidePanel({ type: 'DONE' });
        return false;
    }

    if (!result.ok) {
      await appendLog(`❌ Etapa ${step}: ${result.error}`, 'error');
      await setState({ state: 'paused' });
      notifySidePanel({ type: 'PAUSED', error: result.error, step });
      return false;
    }

    if (result.checkpoint) {
      await setState({ state: 'checkpoint', step: 8 });
      notifySidePanel({ type: 'CHECKPOINT', step: 8, summary: result.summary });
      return false;
    }

    await appendLog(`✅ Etapa ${step} concluída`, 'info');

    if (step === 8) {
      // Só no modo simulação (sem checkpoint): segue para o próximo da fila
      notifySidePanel({ type: 'DONE', ne: result.ne });
      if (await prepararProximoDaFila(tabId)) return true;
      await setState({ state: 'done' });
      return false;
    }

    await setState({ step: step + 1 });

    if (step === 0) {
      // Após step 0 (navegação para buscacompra), aguarda select2 e jQuery inicializarem
      await delay(1500);
    } else if (step > 0 && step < 8) {
      await appendLog('⏳ Aguardando carregamento da próxima etapa…', 'info');
      try { await waitForNavigation(tabId, 25000); await delay(800); } catch {}

      // Verifica modal de arredondamento (aparece após Etapa 5 em alguns casos)
      const rounding = await handleRoundingModal(tabId);
      if (rounding?.handled) {
        await appendLog(`⚠ Arredondamento detectado — selecionado "para menos" (${rounding.count} item(ns))`, 'warn');
        notifySidePanel({ type: 'LOG', msg: `⚠ Arredondamento → "para menos" selecionado. Reforço irrisório será necessário.`, level: 'warn' });
        await setState({ valorEmpenhado: rounding.totalEmpenhado || null });
        try { await waitForNavigation(tabId, 20000); await delay(800); } catch {}
      }

      // "Próxima" clicado não prova avanço: com um campo inválido o CNET fica na
      // mesma tela e a etapa seguinte rodaria na tela errada, também "com sucesso".
      if (antes && !antes.bloqueada) {
        const depois = await impressaoDaPagina(tabId);
        const parada = depois.bloqueada
          ? 'a página está bloqueada por um aviso (alert) do CNET'
          : (depois.caminho === antes.caminho && depois.titulo === antes.titulo)
            ? `a página não avançou${depois.erros?.length ? ` — CNET: ${depois.erros.join(' | ').replace(/[.\s]+$/, '')}` : ''}`
            : null;
        if (parada) {
          const msg = `Etapa ${step}: cliquei em "Próxima", mas ${parada}. Corrija o que o CNET apontar (sem clicar em Próxima) e use Retomar — o robô refaz esta etapa.`;
          await appendLog(`❌ ${msg}`, 'error');
          await setState({ state: 'paused', step });
          notifySidePanel({ type: 'PAUSED', error: msg, step });
          return false;
        }
      }
    }

    return true;

  } catch (err) {
    await appendLog(`❌ Exceção na Etapa ${step}: ${err.message}`, 'error');
    await setState({ state: 'paused' });
    notifySidePanel({ type: 'PAUSED', error: err.message, step });
    return false;
  }
}

// ── Implementações de etapas CNET ─────────────────────────────────────────────

// As listas do CNET mostram 10 linhas por padrão; o que estiver na página 2 não
// existe para o robô. Toda etapa que procura linha numa tabela chama isto antes.
async function maximizarTabelas(tabId, etapa) {
  const r = await execInPage(tabId, maximizarTabelasRunner);
  if (r?.ajustes?.length) await appendLog(`[Etapa ${etapa}] Tabela ampliada (${r.ajustes.join(', ')})`, 'info');
}

async function runStep0(tabId, payload) {
  // buscacompra É a Etapa 1 — step 0 só precisa navegar até ela
  const pageUrl = await execInPage(tabId, () => window.location.href);
  const onBusca = (pageUrl ?? '').includes('buscacompra');

  if (onBusca) {
    await appendLog('[Pré] Já está no formulário de empenho (buscacompra).', 'info');
    return { ok: true };
  }

  await appendLog('[Pré] Clicando "Adicionar Minuta de Empenho"…', 'info');
  notifySidePanel({ type: 'LOG', msg: '[Pré] Abrindo formulário de empenho…', level: 'info' });
  const r = await execInPage(tabId, step0ClickAdicionarMinuta);
  if (!r?.ok) return { ok: false, error: r?.error ?? 'Botão "Adicionar Minuta" não encontrado' };

  await appendLog('[Pré] Aguardando formulário (Etapa 1)…', 'info');
  try { await waitForNavigation(tabId, 25000); } catch { await delay(3000); }
  await delay(800);

  return { ok: true };
}

async function runStep1(tabId, payload) {
  await appendLog('[Etapa 1] Preenchendo Contrato/Compra…', 'info');
  const alvo = payload.tipoOrigem === 'compra'
    ? `compra ${payload.numeroCompra} (${payload.modalidade}, unidade ${payload.unidadeCompra})`
    : `contrato ${payload.contrato ?? '—'}`;
  notifySidePanel({ type: 'LOG', msg: `[Etapa 1] Preenchendo ${alvo}…`, level: 'info' });

  const result = await execInPage(tabId, step1Runner, [payload]);
  if (!result) return { ok: false, error: 'Script não retornou — aba pode ter recarregado ou sessão expirou' };
  if (result.ok) {
    await appendLog('[Etapa 1] Preenchido ✓', 'info');
    notifySidePanel({ type: 'LOG', msg: `[Etapa 1] ${payload.tipoOrigem === 'compra' ? 'Compra' : 'Contrato'} selecionado ✓`, level: 'success' });
  }
  return result;
}

async function runStep2(tabId, payload) {
  await appendLog('[Etapa 2] Selecionando fornecedor…', 'info');
  notifySidePanel({ type: 'LOG', msg: '[Etapa 2] Selecionando fornecedor…', level: 'info' });

  // Verifica se a navegação chegou na página correta
  const pageUrl = await execInPage(tabId, () => window.location.href);
  if (!(pageUrl ?? '').includes('/empenho/fornecedor')) {
    return {
      ok: false,
      error: payload.tipoOrigem === 'compra'
        ? `Etapa 1 não concluída — CNET está em "${pageUrl ?? '?'}". Verifique: (1) a compra ${payload.numeroCompra} existe na modalidade "${payload.modalidade}" para a unidade ${payload.unidadeCompra}, (2) sessão não expirou.`
        : `Etapa 1 não concluída — CNET está em "${pageUrl ?? '?'}". Verifique: (1) contrato "${payload.contrato}" existe no CNET com saldo, (2) sessão não expirou, (3) há minutas anteriores abertas para o mesmo contrato.`,
    };
  }

  await maximizarTabelas(tabId, 2);
  const cnpjRaw = (payload.fornecedorCnpj ?? '').replace(/\D/g, '');

  const result = await execInPage(tabId, (cnpj) => {
    // Todos os botões "Selecionar este fornecedor" (attr selecionar ou title)
    const btns = Array.from(document.querySelectorAll(
      'a[selecionar], a[title*="Selecionar"], a[href*="/empenho/item/"]'
    ));
    if (!btns.length) {
      const debug = Array.from(document.querySelectorAll('a.btn')).map(a => `"${a.title}"[${a.href}]`).join(' | ');
      return { ok: false, error: `Nenhum botão de seleção encontrado. Links: ${debug}` };
    }

    // Localiza a linha do CNPJ correto
    let target = null;
    if (cnpj) {
      for (const btn of btns) {
        const row = btn.closest('tr');
        const rowText = (row?.textContent ?? '').replace(/\D/g, '');
        if (rowText.includes(cnpj)) { target = btn; break; }
      }
    }
    if (!target) {
      // Só aceita "o único da lista"; com vários, escolher um ao acaso
      // empenharia no fornecedor errado.
      const linhas = new Set(btns.map(b => b.closest('tr')));
      if (linhas.size === 1) target = btns[0];
      else return {
        ok: false,
        error: cnpj
          ? `Fornecedor CNPJ ${cnpj} não está entre os ${linhas.size} fornecedores listados — confira o CNPJ na revisão.`
          : `Solicitação sem CNPJ e há ${linhas.size} fornecedores na lista — informe o CNPJ na revisão.`,
      };
    }

    // Navega diretamente pelo href (evita problema com event handlers do CNET)
    if (target.href) {
      window.location.href = target.href;
      return { ok: true, href: target.href };
    }
    target.click();
    return { ok: true };
  }, [cnpjRaw]);

  if (!result?.ok) return { ok: false, error: result?.error ?? 'Erro na Etapa 2' };
  await appendLog(`[Etapa 2] Navegando para ${result.href ?? 'item'}…`, 'info');
  return { ok: true };
}

async function runStep3(tabId, payload) {
  const itensEmpenho = payload.itensEmpenho ?? [];
  await appendLog('[Etapa 3] Aguardando carregamento dos itens (AJAX)…', 'info');
  notifySidePanel({ type: 'LOG', msg: '[Etapa 3] Aguardando itens carregarem…', level: 'info' });

  await maximizarTabelas(tabId, 3);
  const result = await execInPage(tabId, step3Runner, [itensEmpenho, payload.tipoOrigem]);

  if (!result?.ok) return { ok: false, error: result?.error ?? 'Erro na Etapa 3' };
  await appendLog('[Etapa 3] Itens selecionados ✓', 'info');
  return { ok: true };
}

async function runStep4(tabId, payload) {
  await appendLog('[Etapa 4] Buscando linha de crédito orçamentário…', 'info');
  notifySidePanel({ type: 'LOG', msg: '[Etapa 4] Selecionando crédito…', level: 'info' });
  // Sem isto, crédito na página 2 levava a cadastrar uma célula orçamentária duplicada
  await maximizarTabelas(tabId, 4);

  const result = await execInPage(tabId, step4Runner, [payload]);

  for (const f of result?.feitos ?? []) await appendLog(`[Etapa 4] ${f}`, 'info');
  if (!result?.ok) return { ok: false, error: result?.error ?? 'Erro na Etapa 4' };
  await appendLog('[Etapa 4] Crédito selecionado ✓', 'info');
  return { ok: true };
}

async function runStep5(tabId, payload) {
  await appendLog('[Etapa 5] Preenchendo subelemento e valores…', 'info');
  notifySidePanel({ type: 'LOG', msg: '[Etapa 5] Preenchendo subelemento e valores…', level: 'info' });
  await maximizarTabelas(tabId, 5);

  const result = await execInPage(tabId, step5Runner, [payload]);

  if (!result?.ok) return { ok: false, error: result?.error ?? 'Erro na Etapa 5' };
  for (const f of result.feitos ?? []) await appendLog(`[Etapa 5] ${f}`, 'info');
  await appendLog('[Etapa 5] Subelemento e valores preenchidos ✓', 'info');
  return { ok: true };
}

async function runStep6(tabId, payload) {
  await appendLog('[Etapa 6] Preenchendo dados do empenho…', 'info');
  notifySidePanel({ type: 'LOG', msg: '[Etapa 6] Preenchendo dados…', level: 'info' });

  const result = await execInPage(tabId, step6Runner, [payload]);

  for (const f of result?.feitos ?? []) await appendLog(`[Etapa 6] ${f}`, 'info');
  if (!result?.ok) return { ok: false, error: result?.error ?? 'Erro na Etapa 6' };
  await appendLog('[Etapa 6] Dados preenchidos ✓', 'info');
  return { ok: true };
}

// Detecta e trata o modal "Diferença de arredondamento identificada"
// Seleciona sempre a opção "para menos" (primeiro radio de cada item) e clica "Avançar e ajustar depois"
async function handleRoundingModal(tabId) {
  return execInPage(tabId, () => {
    const bodyText = document.body?.textContent ?? '';
    if (!bodyText.toLowerCase().includes('arredondamento')) return { handled: false };

    const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
    if (!radios.length) return { handled: false };

    // Agrupa radios por name; seleciona o PRIMEIRO de cada grupo (valor menor = "para menos")
    const seenGroups = new Set();
    const selectedValues = [];

    for (const r of radios) {
      const key = r.name || ('g_' + r.closest('div, li, p')?.dataset?.item ?? r.id);
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      r.checked = true;
      r.click();
      // Extrai o valor R$ do label desta opção
      const label = r.closest('label') ?? r.parentElement;
      const m = /R\$\s*([\d.,]+)/.exec(label?.textContent ?? '');
      if (m) selectedValues.push(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) || 0);
    }

    const totalEmpenhado = selectedValues.reduce((s, v) => s + v, 0);

    const btnAvancar = Array.from(document.querySelectorAll('button, a.btn'))
      .find(b => /avan[cç]ar/i.test(b.textContent ?? ''));
    if (btnAvancar) btnAvancar.click();

    return { handled: true, totalEmpenhado, count: selectedValues.length };
  });
}

// Passivo Anterior: normalmente só avançar. Se a tela exigir alguma escolha, a
// conferência de avanço em runEmpenhoStep para e mostra a mensagem do CNET.
async function runStep7(tabId) {
  await appendLog('[Etapa 7] Passivo Anterior — avançando…', 'info');
  notifySidePanel({ type: 'LOG', msg: '[Etapa 7] Passivo Anterior — avançando…', level: 'info' });
  const r = await execInPage(tabId, () => {
    const btn =
      document.querySelector('button.submeter') ||
      Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().includes('Próxima'));
    if (!btn) return { ok: false, error: 'Botão "Próxima Etapa" não encontrado na Etapa 7' };
    btn.click();
    return { ok: true };
  });
  return r ?? { ok: false, error: 'Script não retornou na Etapa 7' };
}

async function runStepStub(tabId, step) {
  await appendLog(`[Etapa ${step}] ⚠ HTML pendente — pausando`, 'warn');
  return {
    ok: false,
    error: `Etapa ${step} ainda não implementada. Compartilhe o HTML desta etapa para adicionar os seletores.`,
  };
}

async function runStep8Checkpoint(tabId, payload, dryRun) {
  await appendLog('[Etapa 8] ⚠ CHECKPOINT — aguardando confirmação humana', 'warn');
  if (dryRun) {
    await appendLog('[DRY-RUN] Simulação completa. Emissão NÃO foi efetuada.', 'warn');
    return { ok: true, ne: 'DRY-RUN', summary: { dryRun: true } };
  }
  const summary = await execInPage(tabId, () => ({ url: window.location.href }), []);
  return { ok: true, checkpoint: true, summary: { ...summary, payload } };
}

// Número da NE emitida, lido na página (função serializada — autocontida).
// Vale só um número que não estava na tela antes de emitir; se aparecerem vários
// (ex.: lista de minutas), o da linha que cita a solicitação ou o CNPJ.
function lerNumeroNE(antes, ref) {
  const novos = txt => [...new Set(String(txt ?? '').match(/\d{4}NE\d{6}(?!\d)/g) ?? [])]
    .filter(n => !antes.includes(n));
  const mensagens = document.querySelectorAll('.alert-success, .callout-success, .swal2-popup, .toast-success, .toast-message, .alert-info');
  for (const m of mensagens) {
    const n = novos(m.textContent);
    if (n.length) return { ne: n[0] };
  }
  const n = novos(document.body?.textContent);
  if (n.length <= 1) return n.length ? { ne: n[0] } : null;
  const chaves = [ref.solicitacao, ref.cnpj].filter(k => k && k.length >= 5);
  for (const ne of n) {
    const linha = Array.from(document.querySelectorAll('tr')).find(tr => tr.textContent.includes(ne));
    const txt = linha?.textContent ?? '';
    if (chaves.some(k => txt.includes(k) || txt.replace(/\D/g, '').includes(k))) return { ne };
  }
  return { ne: n[0], duvida: true };
}

/** Guarda o empenho emitido (solicitação → NE) na lista permanente da extensão */
async function registrarEmpenho(registro) {
  const data = await chrome.storage.local.get(REGISTRO_KEY);
  const lista = [...(data[REGISTRO_KEY] ?? []), registro];
  await chrome.storage.local.set({ [REGISTRO_KEY]: lista.slice(-1000) });
}

/** Se há solicitação na fila: abre o formulário de nova minuta e a põe para rodar */
async function prepararProximoDaFila(tabId) {
  const s = await getState();
  if (!s.queue?.length) return false;
  const [next, ...rest] = s.queue;
  await appendLog(`▶ Próxima da fila: ${next.numeroSolicitacao}${rest.length ? ` (depois dela, mais ${rest.length})` : ''}`, 'info');
  const navegou = waitForNavigation(tabId, 30000).catch(() => {});
  try { await chrome.tabs.update(tabId, { url: COMPRASNET_URL }); } catch {}
  await navegou;
  await delay(1500);
  await setState({ state: 'running', flow: 'empenho-cnet', step: 0, payload: next, queue: rest, valorEmpenhado: null });
  notifySidePanel({ type: 'NEXT_AVAILABLE', numero: next.numeroSolicitacao, payload: next, restantes: rest.length });
  return true;
}

/** Emite após a confirmação humana; retorna true se deixou o próximo da fila pronto */
async function runStep8Confirm(tabId, payload) {
  await appendLog('[Etapa 8] Usuário confirmou — emitindo empenho…', 'info');
  // NEs já presentes na tela não podem ser confundidas com a nova
  const antes = await execInPage(tabId,
    () => [...new Set((document.body?.textContent ?? '').match(/\d{4}NE\d{6}(?!\d)/g) ?? [])], []).catch(() => []) ?? [];

  const result = await execInPage(tabId, () => {
    const btn = document.querySelector('button[id*="emitir"], button.btn-success:not(.submeter)');
    if (!btn) return { ok: false, error: 'Botão Emitir não encontrado — selecione manualmente' };
    btn.click();
    return { ok: true };
  }, []);

  if (!result?.ok) {
    await appendLog(`❌ Falha ao emitir: ${result?.error}`, 'error');
    await setState({ state: 'error' });
    notifySidePanel({ type: 'ERROR', message: result?.error });
    return false;
  }

  await appendLog('🎉 Emissão enviada — aguardando o número da NE…', 'info');
  // O SIAFI pode demorar: procura por até ~45 s (a página pode estar navegando)
  const ref = {
    solicitacao: String(payload.numeroSolicitacao ?? '').toUpperCase(),
    cnpj: String(payload.fornecedorCnpj ?? payload.fornecedorCNPJ ?? '').replace(/\D/g, ''),
  };
  let achado = null;
  for (let t = 0; t < 15; t++) {
    await delay(3000);
    const r = await execInPage(tabId, lerNumeroNE, [antes, ref]).catch(() => null);
    if (r?.ne) achado = r;
    if (achado && !achado.duvida) break;
  }
  const ne = achado?.ne ?? null;

  // Valor solicitado: soma dos itensEmpenho ou total do payload
  const itensEmp = payload.itensEmpenho ?? [];
  const valorSolicitado = itensEmp.length > 0
    ? itensEmp.reduce((s, it) => s + (parseFloat(String(it.valor).replace(',', '.')) || 0), 0)
    : parseFloat((payload.total ?? '0').replace(/\./g, '').replace(',', '.')) || 0;

  // Valor empenhado: pode ter sido ajustado pelo modal de arredondamento
  const s = await getState();
  const valorEmpenhado = s.valorEmpenhado ?? valorSolicitado;
  const diff = Math.abs(valorSolicitado - valorEmpenhado);

  await registrarEmpenho({
    data:        new Date().toISOString(),
    solicitacao: payload.numeroSolicitacao ?? '',
    ne,
    conferir:    !ne || !!achado?.duvida,
    fornecedor:  payload.fornecedorNome ?? '',
    cnpj:        ref.cnpj,
    origem:      payload.tipoOrigem === 'compra' ? `Compra ${payload.numeroCompra ?? ''}` : (payload.contrato ?? ''),
    valorSolicitado,
    valorEmpenhado,
  });
  await appendLog(
    `✅ ${payload.numeroSolicitacao ?? 'Solicitação'} → NE ${ne ?? '(não lida — conferir no CNET)'}${achado?.duvida ? ' (conferir)' : ''} | Empenhado: R$ ${valorEmpenhado.toFixed(2)} | Solicitado: R$ ${valorSolicitado.toFixed(2)}${diff > 0.005 ? ` | ⚠ Diferença: R$ ${diff.toFixed(2)}` : ''}`,
    ne && !achado?.duvida ? 'success' : 'warn'
  );
  notifySidePanel({ type: 'DONE', ne, payload, valorEmpenhado, valorSolicitado });

  if (await prepararProximoDaFila(tabId)) return true;
  await setState({ state: 'done' });
  return false;
}

// ── Comunicação com Side Panel ────────────────────────────────────────────────

let sidePanelPort = null;

export function setSidePanelPort(port) { sidePanelPort = port; }

function notifySidePanel(msg) {
  if (sidePanelPort) {
    try { sidePanelPort.postMessage(msg); } catch { sidePanelPort = null; }
  }
}
