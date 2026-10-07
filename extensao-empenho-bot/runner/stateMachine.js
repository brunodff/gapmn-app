/**
 * Máquina de estados — GAPMN Empenho Bot v2.0
 *
 * Dois fluxos:
 *   1. COLETA: Navega no SILOMS, coleta todas as solicitações assinadas (comum a ambos os modos)
 *   2. EMPENHO-CNET: Preenche minuta no Contratos.gov.br (8 etapas existentes)
 *   2b. EMPENHO-SILOMS: (Phase 3 — a implementar)
 *   3. ALTERACAO-CNET: reforço/anulação de NE já emitida e os "irrisórios" que
 *      completam o arredondamento (altStep 0-4; ver runner/steps/alteracao.js)
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
  paginaMinutas, buscarNEnaLista, removerFiltros, adicionarAlteracao,
  alteracaoSubelementoRunner, alteracaoPassivo, lerListaAlteracoes,
} from './steps/alteracao.js';
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
// Lista de minutas (palpite: o robô prefere o link do menu da própria tela)
const MINUTAS_URL = 'https://contratos.comprasnet.gov.br/empenho/minuta';
// Empenhos emitidos (solicitação → NE), guardados entre execuções
export const REGISTRO_KEY = 'empenhosGerados';
// Painel: "parar para confirmar antes de emitir" (desligado = emite sozinho)
const CONFIRMAR_ANTES_KEY = 'empenhoConfirmarAntes';

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

// Grava no histórico e mostra na hora no painel
async function logVisivel(msg, level = 'info') {
  await appendLog(msg, level);
  notifySidePanel({ type: 'LOG', msg, level });
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
    state: 'running', ...estadoInicialDoPayload(payload),
    payload, queue: initialQueue, cnetTabId: tabId, dryRun, log: [],
    inicioFila: new Date().toISOString(), valorEmpenhado: null, valorNaTela: null, arredondado: false, degrauArredondamento: null, falhasSeguidas: 0,
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
  if (s.state === 'checkpoint' && s.flow === 'alteracao-cnet' && s.altStep === 4) {
    if (maquinaAtiva) return { ok: false, error: 'O robô ainda está executando' };
    await setState({ state: 'running' });
    maquinaAtiva = true;
    let proximo = false;
    try { proximo = await emitirAlteracao(s.cnetTabId, await getState()); } finally { maquinaAtiva = false; }
    if (proximo) {
      runStateMachine().catch(async err => {
        await appendLog(`❌ Erro fatal: ${err.message}`, 'error');
        await setState({ state: 'error' });
        notifySidePanel({ type: 'ERROR', message: err.message });
      });
    }
    return { ok: true };
  }
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
    : s.flow === 'alteracao-cnet'
      ? `${s.alteracao?.operacao ?? 'alteração'} da ${s.alteracao?.ne ?? 'NE'}, ${ROTULO_ALT[s.altStep] ?? ''}`
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
    } else if (s.flow === 'alteracao-cnet') {
      const shouldContinue = await runAlteracaoStep(s);
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
      case 8: result = await runStep8(tabId, payload, dryRun); break;
      default:
        await setState({ state: 'done' });
        notifySidePanel({ type: 'DONE' });
        return false;
    }

    // Problema desta solicitação: registra o motivo e segue para a próxima
    if (!result.ok) return pularSolicitacao(tabId, step, result.error, { url: result.urlMinuta ?? null });

    if (result.checkpoint) {
      await setState({ state: 'checkpoint', step: 8 });
      notifySidePanel({ type: 'CHECKPOINT', step: 8, summary: result.summary });
      return false;
    }

    // Etapa 8 conferida: emite, finaliza, registra a NE e segue a fila
    if (result.emitir) {
      const r = await emitirEFinalizar(tabId, payload);
      if (!r.ok) return pularSolicitacao(tabId, 8, r.error, { status: r.talvezEmitido ? 'conferir' : 'falhou', url: r.url ?? null });
      return depoisDoEmpenho(tabId, payload, r);
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
      // Depois da Etapa 5 o aviso de arredondamento pode abrir na própria tela: olha
      // por ele enquanto espera a navegação (antes esperava os 25 s inteiros)
      const espera = step === 5
        ? await esperarNavegacaoOuAviso(tabId, 25000)
        : await waitForNavigation(tabId, 25000).then(() => 'navegou', () => 'tempo');
      if (espera === 'navegou') await delay(800);

      // Verifica modal de arredondamento (aparece após Etapa 5 em alguns casos)
      const rounding = await handleRoundingModal(tabId);
      if (rounding?.handled) {
        // O valor exato que falta sai do Valor Total da Etapa 8; aqui, a conta pelo aviso
        const falta = faltaDoArredondamento(rounding, payload.itensEmpenho, valorSolicitadoDe(payload));
        await logVisivel(textoArredondamento(rounding, falta, 'reforço irrisório'), 'warn');
        const degrau = await concluirArredondamento(tabId, rounding);
        await setState({ valorEmpenhado: rounding.totalEmpenhado || null, arredondado: true,
          degrauArredondamento: degrau > 0 ? Math.round(degrau * 100) / 100 : null });
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
        if (parada) return pularSolicitacao(tabId, step, `cliquei em "Próxima", mas ${parada}`);
      }
    }

    return true;

  } catch (err) {
    // Na Etapa 8 a exceção pode ter vindo depois do clique em Emitir: conferir no CNET
    return pularSolicitacao(tabId, step, `Exceção: ${err.message}`, { status: step === 8 ? 'conferir' : 'falhou' });
  }
}

// ── Problema numa solicitação: registra o motivo e segue a fila ──────────────

// Instruções de "Retomar" não servem no relatório: a fila já seguiu
function limparMotivo(m) {
  return String(m ?? '')
    .replace(/\s*(?:—|-)\s*escolha[^.]*?use Retomar\.?/gi, '')
    .replace(/\s*Volte à Etapa[^.]*\.?/gi, '')
    .replace(/\s*Aborte,[^.]*\.?/gi, '')
    .replace(/[,;\s—-]*(?:e\s+)?(?:depois\s+)?use Retomar[^.]*\.?/gi, '')
    .replace(/\s+/g, ' ').replace(/[\s,;—-]+$/, '').trim();
}

// Falha "do sistema" (aba, sessão, CNET fora do ar) e não da solicitação: se
// repetir, pular só criaria uma falha atrás da outra na fila inteira
const RX_SISTEMICO = /Script não retornou|Exceção|timeout|não carregaram|bloqueada por um aviso|Não consegui ler a tela|sem resposta|sessão expirou/i;
const RX_SESSAO = /\/login\b|acesso\.gov\.br|\bsso\./i;
const LIMITE_FALHAS_SISTEMA = 3;

/**
 * A solicitação atual não deu para empenhar: grava no registro (status 'falhou',
 * ou 'conferir' se a emissão pode ter acontecido) com etapa e motivo e segue a
 * fila. Pausa só em sessão expirada ou falhas de sistema repetidas.
 */
async function pularSolicitacao(tabId, etapa, erro, { status = 'falhou', url = null } = {}) {
  const s = await getState();
  const payload = s.payload ?? {};
  const sol = payload.numeroSolicitacao ?? '';

  const aba = await chrome.tabs.get(tabId).catch(() => null);
  if (RX_SESSAO.test(aba?.url ?? '')) {
    const msg = `A sessão do CNET expirou (${sol || 'solicitação'}, Etapa ${etapa}). Entre de novo no CNET e use Retomar — o robô recomeça esta solicitação.`;
    await appendLog(`❌ ${msg}`, 'error');
    await setState({ state: 'paused', step: 0 });
    notifySidePanel({ type: 'PAUSED', error: msg, step: 0 });
    return false;
  }

  const motivo = limparMotivo(erro) || 'erro sem descrição';
  await registrarEmpenho({
    id:          `${Date.now()}-${sol}`,
    data:        new Date().toISOString(),
    solicitacao: sol,
    ne:          null,
    status,
    etapa,
    motivo,
    url,
    fornecedor:  payload.fornecedorNome ?? '',
    cnpj:        String(payload.fornecedorCnpj ?? payload.fornecedorCNPJ ?? '').replace(/\D/g, ''),
    origem:      payload.tipoOrigem === 'compra' ? `Compra ${payload.numeroCompra ?? ''}` : (payload.contrato ?? ''),
    pag:         payload.pag ?? '',      // para o subprocesso no SILOMS
    ugCred:      payload.ugCred ?? '',
    operacao:    payload.operacao || undefined,
    neAlterar:   payload.neAlterar || undefined,
    valorSolicitado: valorSolicitadoDe(payload),
    valorEmpenhado:  0,
    verificacaoFornecedor: payload.verificacaoFornecedor?.resumo ?? '',
  });
  await logVisivel(
    `${status === 'conferir' ? '⚠' : '⛔'} ${sol || 'Solicitação'} ${status === 'conferir' ? 'precisa ser conferida no CNET' : 'NÃO empenhada'} (Etapa ${etapa}): ${motivo}${s.queue?.length ? ' — seguindo para a próxima' : ''}`,
    'error',
  );
  notifySidePanel({ type: 'SKIPPED', numero: sol, etapa, motivo, status });

  const falhas = RX_SISTEMICO.test(erro ?? '') ? (s.falhasSeguidas ?? 0) + 1 : (s.falhasSeguidas ?? 0);
  await setState({ falhasSeguidas: falhas });
  if (falhas >= LIMITE_FALHAS_SISTEMA && s.queue?.length) {
    await prepararProximoDaFila(tabId);
    const msg = `${falhas} falhas de sistema seguidas (aba, sessão ou CNET fora do ar) — confira o CNET e use Retomar para seguir com a próxima.`;
    await appendLog(`⏸ ${msg}`, 'warn');
    await setState({ state: 'paused', falhasSeguidas: 0 });
    notifySidePanel({ type: 'PAUSED', error: msg, step: 0 });
    return false;
  }
  return seguirFila(tabId);
}

// ── Implementações de etapas CNET ─────────────────────────────────────────────

// As listas do CNET mostram 10 linhas por padrão; o que estiver na página 2 não
// existe para o robô. Toda etapa que procura linha numa tabela chama isto antes.
async function maximizarTabelas(tabId, etapa) {
  const r = await execInPage(tabId, maximizarTabelasRunner);
  if (r?.ajustes?.length) await appendLog(`[Etapa ${etapa}] Tabela ampliada (${r.ajustes.join(', ')})`, 'info');
}

async function runStep0(tabId, payload) {
  // Nova minuta pelo botão "Adicionar Minuta de Empenho", como o usuário faz. Aberto
  // pelo endereço logo depois de um empenho, o formulário pode vir preso à minuta
  // anterior, com o Número/Ano bloqueado.
  // Com tempo limite: depois de uma solicitação que falhou, um alert() do CNET pode
  // ter ficado aberto e travaria o script; aí abre o formulário pelo endereço
  const comLimite = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);
  const r = await comLimite(execInPage(tabId, step0ClickAdicionarMinuta), 8000).catch(() => null);
  if (r?.ok) {
    await appendLog('[Pré] Abrindo nova minuta ("Adicionar Minuta de Empenho")…', 'info');
    notifySidePanel({ type: 'LOG', msg: '[Pré] Abrindo nova minuta…', level: 'info' });
    try { await waitForNavigation(tabId, 25000); } catch { await delay(3000); }
    await delay(800);
    return { ok: true };
  }

  const pageUrl = (await chrome.tabs.get(tabId).catch(() => null))?.url ?? '';
  if (pageUrl.includes('buscacompra')) {
    await appendLog('[Pré] Já está no formulário de empenho (buscacompra).', 'info');
    return { ok: true };
  }

  // Sem o botão nesta tela: abre o formulário pelo endereço
  await appendLog('[Pré] Botão "Adicionar Minuta" não está nesta tela — abrindo o formulário pelo endereço…', 'warn');
  const navegou = waitForNavigation(tabId, 30000).catch(() => {});
  try { await chrome.tabs.update(tabId, { url: COMPRASNET_URL }); } catch {}
  await navegou;
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

  for (const f of result?.feitos ?? []) await logVisivel(`[Etapa 4] ${f}`, 'info');
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
  for (const f of result.feitos ?? []) await logVisivel(`[Etapa 5] ${f}`, 'info');
  await appendLog('[Etapa 5] Subelemento e valores preenchidos ✓', 'info');
  return { ok: true };
}

async function runStep6(tabId, payload) {
  await appendLog('[Etapa 6] Preenchendo dados do empenho…', 'info');
  notifySidePanel({ type: 'LOG', msg: '[Etapa 6] Preenchendo dados…', level: 'info' });

  const result = await execInPage(tabId, step6Runner, [payload]);

  for (const f of result?.feitos ?? []) await logVisivel(`[Etapa 6] ${f}`, 'info');
  if (!result?.ok) return { ok: false, error: result?.error ?? 'Erro na Etapa 6' };
  await appendLog('[Etapa 6] Dados preenchidos ✓', 'info');
  return { ok: true };
}

// Detecta e trata o modal "Diferença de arredondamento identificada": escolhe a
// opção "para menos" de cada item (pelo texto; sem ele, a de menor valor — ex.:
// "Quantidade: 0,02873 = Valor calculado: R$ 22.984,00") e clica "Corrigir agora",
// que troca o valor do item pelo escolhido. "Avançar e ajustar depois" (só se não
// houver o outro botão) segue com o valor digitado e o SIAFI recusa (ER0462: valor ≠
// quantidade × unitário). A escolha é um clique de verdade (marcar `checked` antes do
// clique não dispara o "change").
async function handleRoundingModal(tabId) {
  return execInPage(tabId, () => {
    const bodyText = document.body?.textContent ?? '';
    if (!bodyText.toLowerCase().includes('arredondamento')) return { handled: false };

    // Só o modal aberto: um modelo escondido na página não conta
    const caixas = Array.from(document.querySelectorAll('.modal, .swal2-popup, [role="dialog"]'))
      .filter(m => /arredondamento/i.test(m.textContent ?? ''));
    const caixa = caixas.find(m => m.offsetParent !== null || getComputedStyle(m).display !== 'none');
    if (caixas.length && !caixa) return { handled: false };
    const radios = Array.from((caixa ?? document).querySelectorAll('input[type="radio"]')).filter(r => !r.disabled);
    if (!radios.length) return { handled: false };

    const textoDe = r => {
      const l = r.closest('label') ?? (r.id ? document.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null) ?? r.parentElement;
      return (l?.textContent ?? '').replace(/\s+/g, ' ').trim();
    };
    const valorDe = r => {
      const m = /R\$\s*([\d.,]+)/.exec(textoDe(r));
      return m ? (parseFloat(m[1].replace(/\./g, '').replace(',', '.')) || 0) : null;
    };
    const grupos = new Map();
    for (const r of radios) {
      const key = r.name || `g_${r.closest('[data-item]')?.dataset?.item ?? r.id}`;
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push(r);
    }

    // Nº do item do grupo ("Item 00001"): no bloco que só tem os radios dele, ou no
    // título logo antes; com um item só, o único "Item NNNNN" do aviso
    const raiz = caixa ?? document.body;
    const itemDoGrupo = grupo => {
      const nome = grupo[0].name;
      for (let el = grupo[0].parentElement; el && el !== raiz.parentElement; el = el.parentElement) {
        const nomes = new Set(Array.from(el.querySelectorAll('input[type="radio"]')).map(r => r.name));
        if (nomes.size > 1 || (nome && !nomes.has(nome))) break;
        const m = /Item\s+(\d{1,6})/i.exec(el.textContent ?? '');
        if (m) return m[1];
      }
      let bloco = grupo[0];
      while (bloco.parentElement && bloco.parentElement !== raiz) bloco = bloco.parentElement;
      for (let s = bloco.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.querySelector?.('input[type="radio"]')) break;
        const m = /Item\s+(\d{1,6})/i.exec(s.textContent ?? '');
        if (m) return m[1];
      }
      const todos = (raiz.textContent ?? '').match(/Item\s+\d{1,6}/gi) ?? [];
      return grupos.size === 1 && todos.length === 1 ? /\d+/.exec(todos[0])[0] : null;
    };

    const escolhidos = [], escolhas = [], itens = [];
    let totalMais = 0;
    for (const grupo of grupos.values()) {
      const comValor = grupo.filter(r => valorDe(r) !== null).sort((x, y) => valorDe(x) - valorDe(y));
      const menos = grupo.find(r => /\bmenos\b|\bmenor\b|abaixo|inferior/i.test(textoDe(r)) && !/\bmais\b|\bmaior\b/i.test(textoDe(r)))
        ?? comValor[0] ?? grupo[0];
      // Maior opção do grupo ("para mais"): a distância até ela é o degrau do
      // arredondamento — o irrisório nunca passa disso
      if (comValor.length) totalMais += valorDe(comValor[comValor.length - 1]);
      const jaMarcado = menos.checked;
      if (!jaMarcado) menos.click();
      if (!menos.checked) { menos.checked = true; menos.dispatchEvent(new Event('change', { bubbles: true })); }
      else if (jaMarcado) menos.dispatchEvent(new Event('change', { bubbles: true }));
      escolhidos.push(menos);
      escolhas.push(textoDe(menos).slice(0, 60));
      itens.push({ numeroItem: itemDoGrupo(grupo), menos: valorDe(menos), mais: comValor.length ? valorDe(comValor[comValor.length - 1]) : null });
    }
    const valores = escolhidos.map(valorDe).filter(v => v !== null);
    const totalEmpenhado = valores.reduce((s, v) => s + v, 0);

    const botoes = Array.from((caixa ?? document).querySelectorAll('button, a.btn, input[type="button"]'));
    const rotulo = b => String(b.textContent || b.value || '');
    const btnCorrigir = botoes.find(b => /corrigir/i.test(rotulo(b)));
    const btnAvancar = botoes.find(b => /avan[cç]ar/i.test(rotulo(b)));
    const btn = btnCorrigir ?? btnAvancar;
    if (btn) btn.click();

    return { handled: true, totalEmpenhado, totalMais, count: escolhidos.length, escolhas, itens,
      acao: btnCorrigir ? 'corrigir' : btnAvancar ? 'avancar' : null };
  });
}

// O aviso de arredondamento está aberto na tela? (função da página)
function avisoArredondamentoAberto() {
  const visivel = e => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && e.getClientRects().length > 0; };
  const caixas = Array.from(document.querySelectorAll('.modal, .swal2-popup, [role="dialog"], .bootbox'));
  if (caixas.some(m => /arredondamento/i.test(m.textContent ?? '') && visivel(m))) return true;
  return !caixas.length && /Diferen[çc]a de arredondamento identificada/i.test(document.body?.innerText ?? '');
}

// Depois de "Próxima Etapa": a página muda OU o aviso de arredondamento abre na
// própria tela. Antes o robô esperava a navegação até o tempo limite (25 s) para só
// então olhar o aviso. `navPronta`: espera de navegação já ligada antes do clique.
async function esperarNavegacaoOuAviso(tabId, ms, navPronta = null) {
  let acabou = false;
  const nav = (navPronta ?? waitForNavigation(tabId, ms).then(() => true, () => false)).then(ok => (ok ? 'navegou' : 'tempo'));
  const olhar = (async () => {
    const fim = Date.now() + ms;
    await delay(600);
    while (!acabou && Date.now() < fim) {
      if (await comLimite(execInPage(tabId, avisoArredondamentoAberto), 2500) === true) return 'aviso';
      await delay(600);
    }
    return 'tempo';
  })();
  const r = await Promise.race([nav, olhar]);
  acabou = true;
  return r;
}

// Quanto falta depois do "para menos": para cada item do aviso, o valor pedido na
// solicitação − o corrigido; sem o nº do item, com um item só, total pedido − corrigido
function faltaDoArredondamento(rounding, itensPedidos, totalPedido) {
  const num = s => parseFloat(String(s ?? '').replace(',', '.'));
  const numItem = n => parseInt(String(n ?? '').replace(/\D/g, ''), 10);
  let falta = 0;
  const itens = rounding.itens ?? [];
  const todosAchados = itens.length > 0 && itens.every(it => {
    const ped = (itensPedidos ?? []).find(p => numItem(p.numeroItem) === numItem(it.numeroItem));
    if (!ped || !(num(ped.valor) > 0) || it.menos == null) return false;
    falta += num(ped.valor) - it.menos;
    return true;
  });
  if (!todosAchados) {
    if (rounding.count === 1 && (itensPedidos?.length ?? 0) <= 1 && totalPedido > 0) falta = totalPedido - rounding.totalEmpenhado;
    else return null;
  }
  falta = Math.round(falta * 100) / 100;
  return falta >= 0.005 ? falta : null;
}

// Linha do log no "Corrigir agora": o valor de cada item e o que falta para o irrisório
function textoArredondamento(rounding, falta, complemento) {
  const itens = (rounding.itens ?? []).filter(i => i.menos != null);
  const descr = itens.length
    ? itens.map(i => `${i.numeroItem ? `item ${i.numeroItem}` : 'item'} → R$ ${fmtR$(i.menos)}`).join('; ')
    : (rounding.escolhas?.join('; ') || `${rounding.count} item(ns)`);
  const botao = rounding.acao === 'corrigir' ? 'Corrigir agora' : 'Avançar e ajustar depois';
  return `⚠ Arredondamento "para menos" (${descr}) + "${botao}"`
    + (falta ? ` — faltam R$ ${fmtR$(falta)}, que vão de ${complemento} logo depois da emissão` : ` — o que faltar vai de ${complemento} logo depois da emissão`);
}

// Depois do aviso de arredondamento. "Corrigir agora" troca o valor do item pelo
// escolhido e fecha o aviso: a etapa pode avançar sozinha ou ficar na tela — aí o
// robô clica "Próxima Etapa" de novo (o aviso pode voltar para outro item). Devolve o
// degrau somado de todos os avisos tratados (limite do irrisório).
async function concluirArredondamento(tabId, rounding, tentativa = 1) {
  const degrau = r => (r.totalMais > r.totalEmpenhado ? r.totalMais - r.totalEmpenhado : 0);
  const soma = degrau(rounding);
  if (rounding.acao !== 'corrigir') {
    try { await waitForNavigation(tabId, 20000); } catch {}
    await delay(800);
    return soma;
  }
  // "Corrigir agora" é na própria tela: se em 2,5 s não navegou, segue com "Próxima"
  if (await waitForNavigation(tabId, 2500).then(() => true, () => false)) { await delay(800); return soma; }
  const navegou = waitForNavigation(tabId, 25000).then(() => true, () => false);
  const clicou = await execInPage(tabId, () => {
    const btn = document.querySelector('button.submeter') ||
      Array.from(document.querySelectorAll('button, a.btn')).find(b => /pr[óo]xima/i.test(b.textContent ?? ''));
    if (!btn) return 'sem-botao';
    btn.click();
    return 'ok';
  }).catch(() => 'navegou');
  if (clicou === 'ok') {
    await logVisivel('[Arredondamento] Valor corrigido — clicando "Próxima Etapa" de novo…', 'info');
    const r = await esperarNavegacaoOuAviso(tabId, 25000, navegou);
    if (r === 'navegou') { await delay(800); return soma; }
    // o aviso voltou (outro item)
    if (r === 'aviso' && tentativa < 3) {
      const r2 = await handleRoundingModal(tabId);
      if (r2?.handled) return soma + await concluirArredondamento(tabId, r2, tentativa + 1);
    }
  }
  await delay(800);
  return soma;
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

// ── Etapa 8: conferência, emissão no SIAFI e finalização ─────────────────────

const RX_JA_ENVIADO = /PROCESSAMENTO|EMITID|EMPENHAD|ENVIAD|SUCESSO/i;
const RX_ERRO_SIAFI = /ERRO|REJEIT|RECUSAD|FALH|CANCELAD|INVALID/i;
const extrairNE = s => (String(s ?? '').match(/\d{4}NE\d{6}(?!\d)/) ?? [null])[0];
const numBR = s => {
  const t = String(s ?? '').replace(/[^\d,.-]/g, '');
  if (!t) return null;
  const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
};
const fmtR$ = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Valor pedido na solicitação: soma dos itens, senão o total
function valorSolicitadoDe(payload) {
  const itens = payload.itensEmpenho ?? [];
  if (itens.length) return itens.reduce((s, it) => s + (parseFloat(String(it.valor).replace(',', '.')) || 0), 0);
  return numBR(payload.total) ?? 0;
}

// Resumo da tela da Etapa 8 (função serializada — autocontida)
function lerEtapa8() {
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const limpa = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const valorDe = (...rotulos) => {
    const alvos = rotulos.map(norm);
    for (const tr of document.querySelectorAll('tr')) {
      const c = tr.querySelectorAll('th, td');
      if (c.length >= 2 && alvos.includes(norm(c[0].textContent))) return limpa(c[1].textContent);
    }
    for (const r of document.querySelectorAll('dt, label, strong, b')) {
      if (!alvos.includes(norm(r.textContent))) continue;
      const v = r.nextElementSibling?.textContent ?? r.parentElement?.nextElementSibling?.textContent;
      if (v != null) return limpa(v);
    }
    return null;
  };
  const botao = re => Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'))
    .find(b => re.test(limpa(b.textContent || b.value)));
  const emitir = botao(/Emitir\s+Empenho/i);
  return {
    url: location.href.split('#')[0],
    situacao:  valorDe('Situação'),
    mensagem:  valorDe('Mensagem SIAFI'),
    numero:    valorDe('Número Empenho', 'Número do Empenho', 'Nº Empenho', 'N° Empenho', 'Número da NE', 'Nota de Empenho', 'Número NE'),
    valor:     valorDe('Valor Total'),
    tipo:      valorDe('Tipo de Empenho', 'Tipo Empenho'),
    descricao: valorDe('Descrição', 'Descricao'),
    temEmitir: !!emitir,
    emitirHabilitado: !!emitir && !emitir.disabled && !emitir.classList.contains('disabled'),
  };
}

// Clica o botão cujo texto casa com `fonte` (regex) e retorna logo: se a página
// navegar em seguida, o script já terminou (função serializada — autocontida)
function clicarBotaoEtapa8(fonte) {
  const re = new RegExp(fonte, 'i');
  const btn = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'))
    .find(b => re.test(String(b.textContent || b.value || '').replace(/\s+/g, ' ')));
  if (!btn) return { ok: false, error: `botão não encontrado (${fonte})` };
  if (btn.disabled || btn.classList.contains('disabled')) return { ok: false, desabilitado: true, error: 'botão desabilitado' };
  // confirm()/alert() nativos travariam a página até alguém responder: aceitam sozinhos
  const conf = window.confirm, al = window.alert;
  window.confirm = () => true;
  window.alert = () => {};
  setTimeout(() => { window.confirm = conf; window.alert = al; }, 5000);
  btn.click();
  return { ok: true };
}

// Aceita a confirmação em modal (SweetAlert / Bootstrap), se aparecer
async function confirmarModalEtapa8() {
  for (let t = 0; t < 8; t++) {
    await new Promise(r => setTimeout(r, 250));
    const ok = Array.from(document.querySelectorAll('.swal2-confirm, .modal.show .btn-primary, .modal.show .btn-success, .modal.in .btn-primary, .bootbox .btn-primary'))
      .find(b => b.offsetParent !== null);
    if (ok) { ok.click(); return { confirmou: String(ok.textContent).trim() }; }
  }
  return { confirmou: null };
}

// Clica e aceita a confirmação. A página recarregar logo após o clique não é falha.
async function clicarEConfirmar(tabId, fonte) {
  const navegou = e => /destroyed|navigat|unload|removed|no frame|closed/i.test(String(e?.message ?? e));
  let r;
  try {
    r = await execInPage(tabId, clicarBotaoEtapa8, [fonte]);
  } catch (e) {
    return navegou(e) ? { ok: true, navegou: true } : { ok: false, error: e.message };
  }
  if (!r?.ok) return r ?? { ok: false, error: 'sem resposta da página' };
  await delay(300);
  await execInPage(tabId, confirmarModalEtapa8).catch(() => null);
  return r;
}

/** Confere a tela; sem divergência (e sem confirmação manual ligada), segue para emitir */
async function runStep8(tabId, payload, dryRun) {
  if (dryRun) {
    await appendLog('[DRY-RUN] Simulação completa. Emissão NÃO foi efetuada.', 'warn');
    return { ok: true, ne: 'DRY-RUN', summary: { dryRun: true } };
  }
  const tela = await execInPage(tabId, lerEtapa8).catch(() => null);
  if (!tela) return { ok: false, error: 'Não consegui ler a tela da Etapa 8' };

  const motivos = [];
  if (!tela.temEmitir && !RX_JA_ENVIADO.test(tela.situacao ?? '')) motivos.push('botão "Emitir Empenho SIAFI" não encontrado');
  // Compara com o pedido na solicitação. O arredondamento "para menos" deixa a tela
  // alguns centavos abaixo (dentro da tolerância); a diferença vira reforço irrisório.
  const esperado = valorSolicitadoDe(payload);
  const naTela = numBR(tela.valor);
  await setState({ valorNaTela: naTela });
  if (naTela !== null && esperado > 0 && Math.abs(naTela - esperado) > Math.max(1, esperado * 0.005)) {
    motivos.push(`valor na tela R$ ${fmtR$(naTela)} ≠ solicitado R$ ${fmtR$(esperado)}`);
  }
  // Sem ler o valor não há conferência: pede confirmação em vez de emitir no escuro
  if (naTela === null) motivos.push('não consegui ler o Valor Total na tela');
  const semAcento = x => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (payload.tipoEmpenho && tela.tipo && !semAcento(tela.tipo).includes(semAcento(payload.tipoEmpenho))) {
    motivos.push(`tipo de empenho na tela "${tela.tipo}" ≠ escolhido "${payload.tipoEmpenho}"`);
  }
  const sol = String(payload.numeroSolicitacao ?? '').toUpperCase();
  if (sol && tela.descricao && !tela.descricao.toUpperCase().includes(sol)) motivos.push(`a descrição não cita a solicitação ${sol}`);

  // Confirmação manual ligada no painel: para em toda solicitação. Desligada, uma
  // divergência não trava a fila: a minuta fica pronta no CNET, sem emitir, e vai
  // para o relatório com o motivo.
  const { [CONFIRMAR_ANTES_KEY]: confirmarAntes } = await chrome.storage.local.get(CONFIRMAR_ANTES_KEY);
  if (confirmarAntes) {
    const motivo = motivos.length ? `Conferência automática: ${motivos.join('; ')} — confira e confirme` : 'Confirmação manual ligada no painel';
    await appendLog(`[Etapa 8] ⚠ CHECKPOINT — ${motivo}`, 'warn');
    return { ok: true, checkpoint: true, summary: { ...tela, payload, motivo } };
  }
  if (motivos.length) {
    return { ok: false, error: `conferência antes de emitir: ${motivos.join('; ')} — minuta ficou pronta no CNET, sem emitir`, urlMinuta: tela.url };
  }
  await logVisivel(`[Etapa 8] Conferido: valor R$ ${fmtR$(naTela ?? esperado)}${sol ? `, solicitação ${sol}` : ''}`, 'info');
  return { ok: true, emitir: true };
}

/** Guarda o empenho (solicitação → NE) na lista permanente da extensão */
async function registrarEmpenho(registro) {
  const data = await chrome.storage.local.get(REGISTRO_KEY);
  const lista = [...(data[REGISTRO_KEY] ?? []), registro];
  await chrome.storage.local.set({ [REGISTRO_KEY]: lista.slice(-1000) });
}

// Solicitação que já tem esta NE registrada (outra que não `solicitacao`), ou null.
// Uma NE nunca vale para duas solicitações: se a tela mostrar uma assim, não é desta.
async function donoDaNE(ne, solicitacao) {
  const data = await chrome.storage.local.get(REGISTRO_KEY);
  const r = (data[REGISTRO_KEY] ?? []).find(x => x.ne === ne && x.solicitacao !== solicitacao && (x.status ?? 'emitido') === 'emitido');
  return r ? (r.solicitacao || '?') : null;
}

async function lerRegistro(id) {
  const data = await chrome.storage.local.get(REGISTRO_KEY);
  return (data[REGISTRO_KEY] ?? []).find(r => r.id === id) ?? null;
}

async function atualizarRegistro(id, patch) {
  const data = await chrome.storage.local.get(REGISTRO_KEY);
  const lista = (data[REGISTRO_KEY] ?? []).map(r => (r.id === id ? { ...r, ...patch } : r));
  await chrome.storage.local.set({ [REGISTRO_KEY]: lista });
}

// Recarrega a minuta por GET (nunca reenvia formulário) e lê a tela
async function recarregarMinuta(tabId, url) {
  const navegou = waitForNavigation(tabId, 30000).catch(() => {});
  try { await chrome.tabs.update(tabId, { url }); } catch { return null; }
  await navegou;
  await delay(800);
  return execInPage(tabId, lerEtapa8).catch(() => null);
}

/**
 * Emite no SIAFI (se ainda não foi), espera o número da NE, finaliza e registra.
 * Retorna { ok, status } — status: 'emitido' | 'pendente' | 'erro'.
 */
async function emitirEFinalizar(tabId, payload) {
  const antes = await execInPage(tabId, lerEtapa8).catch(() => null);
  if (!antes) return { ok: false, error: 'Não consegui ler a tela da Etapa 8' };
  const url = antes.url;

  if (RX_JA_ENVIADO.test(antes.situacao ?? '')) {
    // Retomar depois da emissão: nunca emite duas vezes
    await logVisivel(`[Etapa 8] Já enviado ao SIAFI (situação: ${antes.situacao}) — não emito de novo`, 'warn');
  } else if (!antes.emitirHabilitado) {
    return { ok: false, url, error: `"Emitir Empenho SIAFI" ${antes.temEmitir ? 'está desabilitado' : 'não foi encontrado'} (situação: ${antes.situacao || '—'}) — confira no CNET` };
  } else {
    await logVisivel('[Etapa 8] Emitindo empenho no SIAFI…', 'info');
    const r = await clicarEConfirmar(tabId, 'Emitir\\s+Empenho');
    if (!r?.ok) return { ok: false, url, error: `Não consegui clicar em "Emitir Empenho SIAFI": ${r?.error ?? 'sem resposta'}` };
  }

  // O SIAFI devolve o número depois ("EM PROCESSAMENTO"): relê a minuta por ~1,5 min
  let ne = null, situacao = antes.situacao, mensagem = null, erro = false;
  const ignoradas = new Set();
  for (let i = 1; i <= 12 && !ne && !erro; i++) {
    await delay(4000);
    const r = i % 2 === 0
      ? await recarregarMinuta(tabId, url)
      : await execInPage(tabId, lerEtapa8).catch(() => null);
    if (!r) continue;
    situacao = r.situacao ?? situacao;
    mensagem = r.mensagem || mensagem;
    // Só o número do campo da própria minuta ou da mensagem do SIAFI: a página mostra
    // NEs de outros empenhos, e "qualquer NE nova na tela" já anotou a de outra solicitação
    ne = extrairNE(r.numero) ?? extrairNE(r.mensagem);
    if (ne) {
      const dono = await donoDaNE(ne, payload.numeroSolicitacao ?? '');
      if (dono) {
        if (!ignoradas.has(ne)) await logVisivel(`⚠ A tela mostrou a NE ${ne}, já registrada para ${dono} — ignorada`, 'warn');
        ignoradas.add(ne);
        ne = null;
      }
    }
    // erro só depois de reler a minuta (uma situação "ERRO" antiga ainda pode estar na tela)
    erro = !ne && i >= 3 && RX_ERRO_SIAFI.test(situacao ?? '');
  }
  const status = ne ? 'emitido' : erro ? 'erro' : 'pendente';
  // Sem número e sem situação de envio, a emissão não aconteceu: não finaliza
  if (status === 'pendente' && !RX_JA_ENVIADO.test(situacao ?? '')) {
    return { ok: false, url, talvezEmitido: true, error: `cliquei em Emitir, mas o CNET não mostrou a emissão (situação: ${situacao || '—'}) — confira a minuta antes de empenhar de novo` };
  }

  // Finaliza a minuta (não quando o SIAFI recusou: ela precisa ser corrigida)
  if (status !== 'erro') {
    const f = await clicarEConfirmar(tabId, '\\bFinalizar\\b');
    if (f?.ok) {
      await logVisivel('[Etapa 8] Minuta finalizada ✓', 'info');
      try { await waitForNavigation(tabId, 15000); } catch {}
    } else {
      await logVisivel(`⚠ [Etapa 8] Não finalizei a minuta (${f?.error ?? 'sem resposta'}) — finalize no CNET depois`, 'warn');
    }
  }

  // Empenhado = Valor Total da minuta (lido na tela); o que faltar para o
  // solicitado é o reforço irrisório
  const st = await getState();
  const valorSolicitado = valorSolicitadoDe(payload);
  const valorEmpenhado = numBR(antes.valor) ?? st.valorNaTela ?? st.valorEmpenhado ?? valorSolicitado;
  const falta = Math.round((valorSolicitado - valorEmpenhado) * 100) / 100;
  const reforco = falta >= 0.01 ? falta : 0;
  const registro = {
    id:          `${Date.now()}-${payload.numeroSolicitacao ?? ''}`,
    data:        new Date().toISOString(),
    solicitacao: payload.numeroSolicitacao ?? '',
    ne,
    status,
    situacao:    situacao ?? '',
    mensagem:    mensagem ?? '',
    url,
    fornecedor:  payload.fornecedorNome ?? '',
    cnpj:        String(payload.fornecedorCnpj ?? payload.fornecedorCNPJ ?? '').replace(/\D/g, ''),
    origem:      payload.tipoOrigem === 'compra' ? `Compra ${payload.numeroCompra ?? ''}` : (payload.contrato ?? ''),
    pag:         payload.pag ?? '',      // para o subprocesso no SILOMS
    ugCred:      payload.ugCred ?? '',
    valorSolicitado,
    valorEmpenhado,
    reforco,
    reforcoStatus: reforco && status !== 'erro' ? 'a-fazer' : undefined,
    arredondado: !!st.arredondado,
    motivo:      status === 'erro' ? `SIAFI recusou${mensagem ? `: ${mensagem}` : ''}` : '',
    verificacaoFornecedor: payload.verificacaoFornecedor?.resumo ?? "",
  };
  await registrarEmpenho(registro);
  // Chegou ao SIAFI: a sequência de falhas de sistema acabou
  await setState({ falhasSeguidas: 0 });

  const resumo = status === 'emitido' ? `NE ${ne}`
    : status === 'erro' ? `ERRO SIAFI${mensagem ? `: ${mensagem}` : ''}`
    : 'NE em processamento no SIAFI — o número será buscado no fim da fila';
  await appendLog(
    `${status === 'emitido' ? '✅' : status === 'erro' ? '❌' : '⏳'} ${registro.solicitacao || 'Solicitação'} → ${resumo} | Empenhado: R$ ${fmtR$(valorEmpenhado)}`,
    status === 'emitido' ? 'success' : status === 'erro' ? 'error' : 'warn',
  );
  if (reforco && status !== 'erro') {
    await logVisivel(`⚠ ${registro.solicitacao || 'Solicitação'}: faltou R$ ${fmtR$(reforco)} para o solicitado (R$ ${fmtR$(valorSolicitado)} pedido, R$ ${fmtR$(valorEmpenhado)} empenhado) — reforço irrisório`, 'warn');
  }
  notifySidePanel({ type: 'DONE', ne, status, mensagem, payload, valorEmpenhado, valorSolicitado, reforco });
  return { ok: true, status, ne, reforco, registroId: registro.id };
}

/**
 * Revisita as minutas que ficaram "em processamento" e anota o número da NE.
 * `desde` (ISO) limita aos registros desta fila; null = todos os pendentes.
 */
async function resolverPendentes(tabId, desde = null) {
  const data = await chrome.storage.local.get(REGISTRO_KEY);
  const pendentes = (data[REGISTRO_KEY] ?? []).filter(r => r.status === 'pendente' && r.url && (!desde || r.data >= desde));
  if (!pendentes.length) return { achadas: 0, restantes: 0 };
  await appendLog(`🔎 Buscando o número de ${pendentes.length} NE(s) que ficaram em processamento…`, 'info');
  notifySidePanel({ type: 'LOG', msg: `🔎 Buscando ${pendentes.length} NE(s) em processamento…`, level: 'info' });
  let achadas = 0;
  for (const reg of pendentes) {
    const r = await recarregarMinuta(tabId, reg.url);
    if (!r) continue;
    let ne = extrairNE(r.numero) ?? extrairNE(r.mensagem);
    // Alteração (reforço/anulação) fica com o número da própria NE alterada
    if (reg.neAlterar) { if (ne !== reg.neAlterar || !/EMITID|SUCESSO/i.test(r.situacao ?? '')) ne = null; }
    else if (ne && await donoDaNE(ne, reg.solicitacao)) ne = null;
    if (ne) {
      achadas++;
      await atualizarRegistro(reg.id, { ne, status: 'emitido', situacao: r.situacao ?? '', mensagem: r.mensagem ?? '' });
      await logVisivel(`✅ ${reg.solicitacao} → NE ${ne}`, 'success');
      // Finaliza se tinha ficado aberta
      await clicarEConfirmar(tabId, '\\bFinalizar\\b');
      try { await waitForNavigation(tabId, 10000); } catch {}
    } else if (RX_ERRO_SIAFI.test(r.situacao ?? '')) {
      await atualizarRegistro(reg.id, { status: 'erro', situacao: r.situacao ?? '', mensagem: r.mensagem ?? '' });
      await logVisivel(`❌ ${reg.solicitacao} → ERRO SIAFI${r.mensagem ? `: ${r.mensagem}` : ''}`, 'error');
    }
  }
  return { achadas, restantes: pendentes.length - achadas };
}

/** Botão do painel: busca as NEs pendentes (só com o robô parado) */
export async function resolverPendentesAgora(tabId) {
  if (maquinaAtiva) return { ocupado: true };
  maquinaAtiva = true;
  try {
    return await resolverPendentes(tabId, null);
  } finally {
    maquinaAtiva = false;
  }
}

/** Se há solicitação na fila: abre o formulário de nova minuta e a põe para rodar */
async function prepararProximoDaFila(tabId) {
  const s = await getState();
  if (!s.queue?.length) return false;
  const [next, ...rest] = s.queue;
  await appendLog(`▶ Próxima da fila: ${next.numeroSolicitacao}${rest.length ? ` (depois dela, mais ${rest.length})` : ''}`, 'info');
  // A Etapa 0 abre a nova minuta (botão "Adicionar Minuta de Empenho" na tela atual)
  await delay(1000);
  await setState({ state: 'running', ...estadoInicialDoPayload(next), payload: next, queue: rest, valorEmpenhado: null, valorNaTela: null, arredondado: false, degrauArredondamento: null });
  notifySidePanel({ type: 'NEXT_AVAILABLE', numero: next.numeroSolicitacao, payload: next, restantes: rest.length });
  return true;
}

/** Depois de um empenho: próximo da fila, ou fim (buscando as NEs pendentes) */
async function seguirFila(tabId) {
  if (await prepararProximoDaFila(tabId)) return true;
  const s = await getState();
  const r = await resolverPendentes(tabId, s.inicioFila ?? null);
  if (r.restantes) {
    await logVisivel(`⏳ ${r.restantes} NE(s) ainda em processamento — use "Buscar pendentes" na lista de empenhos gerados mais tarde`, 'warn');
  }
  await setState({ state: 'done' });
  // Resumo da fila: empenhadas, reforço irrisório e as que tiveram problema
  const data = await chrome.storage.local.get(REGISTRO_KEY);
  const daFila = (data[REGISTRO_KEY] ?? []).filter(r => !s.inicioFila || r.data >= s.inicioFila);
  const emitidas = daFila.filter(r => r.status === 'emitido' || r.status === 'pendente');
  // Reforço irrisório que o robô não conseguiu fazer (os feitos não contam)
  const comReforco = emitidas.filter(r => (r.reforco ?? 0) > 0 && r.reforcoStatus !== 'feito');
  const problemas = daFila.filter(r => ['falhou', 'erro', 'conferir'].includes(r.status));
  const totalReforco = comReforco.reduce((t, r) => t + r.reforco, 0);
  await logVisivel(
    `🏁 Fila concluída: ${emitidas.length} empenhada(s)` +
    (comReforco.length ? ` · ${comReforco.length} com irrisório a fazer (R$ ${fmtR$(totalReforco)})` : '') +
    (problemas.length ? ` · ${problemas.length} com problema` : ''),
    'success',
  );
  notifySidePanel({ type: 'QUEUE_DONE', inicioFila: s.inicioFila ?? null });
  return false;
}

/** Emite depois da confirmação manual no checkpoint; true se o próximo da fila ficou pronto */
async function runStep8Confirm(tabId, payload) {
  await appendLog('[Etapa 8] Usuário confirmou — emitindo empenho…', 'info');
  const r = await emitirEFinalizar(tabId, payload);
  if (!r.ok) return pularSolicitacao(tabId, 8, r.error, { status: r.talvezEmitido ? 'conferir' : 'falhou', url: r.url ?? null });
  return depoisDoEmpenho(tabId, payload, r);
}

// ── Fluxo ALTERAÇÃO: reforço, anulação e irrisórios ──────────────────────────
// Reforço e anulação vêm de solicitações ("Anulação Ident/OC …"); a NE a alterar
// o usuário informa na revisão. Os irrisórios completam o arredondamento "para
// menos": depois de um empenho novo ou de um reforço → REFORÇO IRRISÓRIO; depois
// de uma anulação → ANULAÇÃO SALDO IRRISÓRIO (o que faltou anular).

const OPERACAO_CNET = { reforco: 'REFORÇO', anulacao: 'ANULAÇÃO' };
const COMPLEMENTO_CNET = { reforco: 'REFORÇO IRRISÓRIO', anulacao: 'ANULAÇÃO SALDO IRRISÓRIO' };
const ROTULO_ALT = ['A1 busca da NE', 'A2 Adicionar Alteração', 'A3 Subelemento', 'A4 Passivo Anterior', 'A5 emissão'];
const STEP_PAINEL_ALT = [1, 2, 5, 7, 8];   // pontos do indicador de etapas do painel
// A diferença do arredondamento nunca passa de um "degrau" (para mais − para menos,
// lido no modal): acima disso algum valor está errado e o robô não faz sozinho.
// Sem o degrau, vale este teto.
const LIMITE_IRRISORIO = 10;
const limiteIrrisorio = degrau => (degrau > 0 ? degrau + 0.01 : LIMITE_IRRISORIO);

// Lista "Alteração do empenho": quantas emitidas / com erro (para achar a nova)
const RX_EMITIDA = /EMITID|EMPENHAD/i;
const resumoLista = l => ({
  total: l.linhas.length,
  emitidos: l.linhas.filter(x => RX_EMITIDA.test(x.situacao)).length,
  erros: l.linhas.filter(x => RX_ERRO_SIAFI.test(x.situacao)).length,
});
// Compara com a lista de antes de "Adicionar Alteração": uma emitida a mais = a nossa
function avaliarLista(lista, antes, ne) {
  const agora = resumoLista(lista);
  if (antes && agora.emitidos > antes.emitidos) {
    const nes = lista.linhas.filter(x => RX_EMITIDA.test(x.situacao)).map(x => extrairNE(x.mensagem)).filter(Boolean);
    return { ne: nes.includes(ne) ? ne : (nes[nes.length - 1] ?? ne), situacao: 'EMPENHO EMITIDO' };
  }
  if (antes && agora.erros > antes.erros) {
    const l = lista.linhas.filter(x => RX_ERRO_SIAFI.test(x.situacao)).pop();
    return { erro: true, situacao: l.situacao, mensagem: l.mensagem };
  }
  const proc = lista.linhas.find(x => /PROCESSAMENTO|ENVIAD|AGUARD/i.test(x.situacao));
  return { situacao: proc?.situacao ?? null, semReferencia: !antes };
}
const comLimite = (p, ms = 10000) => Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);

// NE de ano anterior = restos a pagar: o CNET pode não oferecer a alteração dela
function dicaRestosAPagar(ne) {
  const ano = parseInt(String(ne ?? '').slice(0, 4), 10);
  return ano && ano < new Date().getFullYear()
    ? ` — a ${ne} é de ${ano} (restos a pagar): a alteração de RP costuma ser feita no SIAFI Web, não no CNET`
    : '';
}

function estadoInicialDoPayload(payload) {
  if (!payload?.operacao) return { flow: 'empenho-cnet', step: 0, altStep: null, alteracao: null, altValorFeito: null, altDegrau: null, altRestos: null };
  return {
    flow: 'alteracao-cnet', step: 0, altStep: 0, altValorFeito: null, altDegrau: null, altRestos: null,
    alteracao: {
      ne: payload.neAlterar, tipo: payload.operacao, operacao: OPERACAO_CNET[payload.operacao],
      operacaoIrrisoria: COMPLEMENTO_CNET[payload.operacao],
      valor: valorSolicitadoDe(payload), itens: payload.itensEmpenho ?? [],
      origem: 'solicitacao', solicitacao: payload.numeroSolicitacao ?? '',
    },
  };
}

async function navegarPara(tabId, url) {
  const navegou = waitForNavigation(tabId, 30000).catch(() => {});
  await chrome.tabs.update(tabId, { url });
  await navegou;
  await delay(900);
}

// Clique que pode navegar: a página sumir junto com o script não é falha
async function execQuePodeNavegar(tabId, func, args = []) {
  try {
    return await execInPage(tabId, func, args);
  } catch (e) {
    if (/destroyed|navigat|unload|removed|no frame|closed/i.test(String(e?.message ?? e))) return { ok: true, navegou: true };
    throw e;
  }
}

async function runAlteracaoStep(s) {
  const { altStep: passo = 0, alteracao: a, cnetTabId: tabId } = s;
  notifySidePanel({ type: 'STEP', step: STEP_PAINEL_ALT[passo] ?? 8 });
  await appendLog(`━ ${a.operacao} da ${a.ne} — ${ROTULO_ALT[passo]}`, 'info');
  const antes = passo === 2 || passo === 3 ? await impressaoDaPagina(tabId) : null;
  // Ouve a navegação ANTES do clique: numa tela rápida ela termina antes de o
  // robô começar a esperar, e a espera ia até o tempo limite
  const navegacao = passo === 2 || passo === 3 ? waitForNavigation(tabId, 25000).then(() => true, () => false) : null;
  try {
    let r;
    if (passo === 0) r = await altAbrirNE(tabId, a);
    else if (passo === 1) r = await altAdicionar(tabId);
    else if (passo === 2) r = await altSubelemento(tabId, a);
    else if (passo === 3) r = await altPassivo(tabId);
    else return await altFinalizar(tabId, s);
    if (!r?.ok) return falhaAlteracao(tabId, s, passo, r?.error ?? 'sem resposta da página');

    await setState({ altStep: passo + 1, ...(r.patch ?? {}) });
    if (r.esperarNavegacao) {
      await appendLog('⏳ Aguardando a próxima tela…', 'info');
      // tela do Subelemento: o aviso de arredondamento pode abrir nela mesma
      if (passo === 2) { if (await esperarNavegacaoOuAviso(tabId, 25000, navegacao) === 'navegou') await delay(800); }
      else { await navegacao; await delay(800); }
    }
    if (passo === 2) {
      // O robô já digitou o "para menos". Se o CNET ainda abrir o modal de
      // arredondamento: "para menos" de novo; o que faltar vira o irrisório logo
      // depois da emissão
      const rounding = await handleRoundingModal(tabId);
      if (rounding?.handled) {
        await logVisivel(textoArredondamento(rounding, faltaDoArredondamento(rounding, a.itens, a.valor), COMPLEMENTO_CNET[a.tipo]), 'warn');
        const degrauModal = await concluirArredondamento(tabId, rounding);
        const st = await getState();
        await setState({ altValorFeito: rounding.totalEmpenhado || null, altRestos: null,
          altDegrau: Math.round(((st.altDegrau ?? 0) + degrauModal) * 100) / 100 || null });
      }
    }
    if (antes && !antes.bloqueada && r.esperarNavegacao) {
      const depois = await impressaoDaPagina(tabId);
      const parada = depois.bloqueada
        ? 'a página está bloqueada por um aviso (alert) do CNET'
        : (depois.caminho === antes.caminho && depois.titulo === antes.titulo)
          ? `a página não avançou${depois.erros?.length ? ` — CNET: ${depois.erros.join(' | ').replace(/[.\s]+$/, '')}` : ''}`
          : null;
      if (parada) return falhaAlteracao(tabId, s, passo, `cliquei em "Próxima", mas ${parada}`);
    }
    return true;
  } catch (err) {
    return falhaAlteracao(tabId, s, passo, `Exceção: ${err.message}`, { status: passo === 4 ? 'conferir' : 'falhou' });
  }
}

/** A1: lista de minutas → pesquisa a NE → "Alterar Empenho" */
async function altAbrirNE(tabId, a) {
  if (!/^\d{4}NE\d{6}$/.test(a.ne ?? '')) return { ok: false, error: `NE a alterar inválida ("${a.ne ?? ''}") — informe na revisão (ex: 2026NE000552)` };
  // Depois de emitir, o CNET fica na lista de alterações desta NE: o irrisório começa dali
  const aqui = await comLimite(execInPage(tabId, lerListaAlteracoes));
  if (aqui?.naLista && aqui.linhas.some(x => extrairNE(x.mensagem) === a.ne)) {
    await logVisivel(`[Alteração] ${a.ne}: já na lista de alterações ✓`, 'info');
    return { ok: true };
  }
  let p = await execInPage(tabId, paginaMinutas).catch(() => null);
  if (!p?.naLista) {
    const url = p?.menuHref || MINUTAS_URL;
    await logVisivel('[Alteração] Abrindo a lista de Minutas de Empenho…', 'info');
    await navegarPara(tabId, url);
    p = await execInPage(tabId, paginaMinutas).catch(() => null);
    if (!p?.naLista) return { ok: false, error: `não achei a lista de Minutas de Empenho (abri ${url}) — abra Gestão Orçamentária › Minuta Empenho › Minutas no CNET e use Retomar` };
  }
  await logVisivel(`[Alteração] Pesquisando a ${a.ne} nas minutas…`, 'info');
  let r = await execInPage(tabId, buscarNEnaLista, [a.ne]).catch(e => ({ ok: false, error: e.message }));
  if (!r?.ok && r?.removerFiltros) {
    await logVisivel('[Alteração] A NE não apareceu — removendo os filtros da lista e pesquisando de novo…', 'warn');
    const f = await execQuePodeNavegar(tabId, removerFiltros);
    if (f?.href) await navegarPara(tabId, f.href);
    else { try { await waitForNavigation(tabId, 8000); } catch {} await delay(1500); }
    r = await execInPage(tabId, buscarNEnaLista, [a.ne]).catch(e => ({ ok: false, error: e.message }));
  }
  if (!r?.ok) return { ok: false, error: (r?.error ?? 'sem resposta da lista de minutas') + dicaRestosAPagar(a.ne) };
  if (r.href) await navegarPara(tabId, r.href);
  else { try { await waitForNavigation(tabId, 20000); } catch {} await delay(800); }
  const tela = await impressaoDaPagina(tabId);
  if (!/altera/i.test(`${tela.titulo ?? ''} ${tela.caminho ?? ''}`)) {
    return { ok: false, error: `cliquei em "Alterar Empenho", mas a tela é "${tela.titulo || tela.caminho || '?'}"` };
  }
  await logVisivel(`[Alteração] ${a.ne}: "Alteração do empenho" aberta ✓`, 'info');
  return { ok: true };
}

/** A2: "Adicionar Alteração do empenho" */
async function altAdicionar(tabId) {
  // A lista de antes: depois de emitir, a alteração nova é a linha emitida a mais
  const lista = await comLimite(execInPage(tabId, lerListaAlteracoes));
  const patch = lista?.naLista ? { altListaAntes: resumoLista(lista), altListaUrl: lista.url } : { altListaAntes: null, altListaUrl: null };
  const r = await execQuePodeNavegar(tabId, adicionarAlteracao);
  if (!r?.ok) return r ?? { ok: false, error: 'sem resposta da página' };
  if (r.href) await navegarPara(tabId, r.href);
  else { try { await waitForNavigation(tabId, 20000); } catch {} await delay(800); }
  return { ok: true, patch };
}

/**
 * A3: Tipo Operação + valor/quantidade + Próxima Etapa. O valor que não fecha com
 * quantidade (5 casas) × unitário já vai "para menos"; a diferença (e o degrau,
 * que limita o irrisório) fica no estado para o irrisório logo depois da emissão.
 */
async function altSubelemento(tabId, a) {
  await maximizarTabelas(tabId, 'da alteração');
  const rodar = () => execInPage(tabId, alteracaoSubelementoRunner, [a]).catch(e => ({ ok: false, error: `erro ao rodar na tela da alteração: ${e.message}` }));
  let r = await rodar();
  let navegacao = null;
  if (!r) {
    // A tela recarregou no meio (ou o script morreu sem resposta): mais uma vez
    const tela = await impressaoDaPagina(tabId);
    await logVisivel(`⚠ [Alteração] A tela não respondeu (${tela.titulo || tela.caminho || '?'}) — tentando de novo…`, 'warn');
    await delay(2500);
    navegacao = waitForNavigation(tabId, 25000).then(() => true, () => false);
    r = await rodar();
    if (!r) return { ok: false, error: `a tela da alteração não respondeu (duas tentativas; tela: ${tela.titulo || tela.caminho || '?'})` };
  }
  if (!r.ok) return { ...r, error: `${r.error}${r.semOperacao ? dicaRestosAPagar(a.ne) : ''}` };
  for (const f of r.feitos ?? []) await logVisivel(`[Alteração] ${f}`, 'info');
  if (r.arredondou) {
    await logVisivel(`⚠ [Alteração] R$ ${fmtR$(a.valor)} não fecha com quantidade × unitário: ${a.operacao} de R$ ${fmtR$(r.digitado)} ("para menos") e, logo depois da emissão, ${COMPLEMENTO_CNET[a.tipo]} de R$ ${fmtR$(Math.round((a.valor - r.digitado) * 100) / 100)}`, 'warn');
  }
  const patch = {
    altValorDigitado: r.digitado,
    altValorFeito: r.arredondou ? r.digitado : null,
    altDegrau: r.degrau > 0 ? r.degrau : null,
    altRestos: r.restos?.length ? r.restos : null,
  };
  if (navegacao) {
    await setState(patch);
    await navegacao;
    await delay(800);
    return { ok: true, patch };
  }
  return { ok: true, esperarNavegacao: true, patch };
}

/** A4: Passivo Anterior (pula se a tela já é a de emitir) */
async function altPassivo(tabId) {
  const r = await execQuePodeNavegar(tabId, alteracaoPassivo);
  if (!r?.ok) return r ?? { ok: false, error: 'sem resposta no Passivo Anterior' };
  if (r.jaNoFinal) return { ok: true };
  await logVisivel('[Alteração] Passivo Anterior — avançando…', 'info');
  return { ok: true, esperarNavegacao: true };
}

/** A5: confere e emite (ou para no checkpoint, se a confirmação manual estiver ligada) */
async function altFinalizar(tabId, s) {
  const a = s.alteracao;
  if (s.dryRun) {
    await logVisivel(`[DRY-RUN] ${a.operacao} da ${a.ne} preenchido — emissão NÃO feita`, 'warn');
    return seguirFila(tabId);
  }
  const tela = await execInPage(tabId, lerEtapa8).catch(() => null);
  if (!tela) return falhaAlteracao(tabId, s, 4, 'Não consegui ler a tela de emissão da alteração');
  // Com arredondamento, a tela mostrando ainda o valor pedido = o "para menos" não
  // pegou, e o SIAFI recusaria (ER0462): não emite
  const naTela = numBR(tela.valor);
  if (s.altValorFeito && naTela !== null && Math.abs(naTela - a.valor) < 0.005 && Math.abs(naTela - s.altValorFeito) >= 0.01) {
    return falhaAlteracao(tabId, s, 4, `o CNET ficou com R$ ${fmtR$(naTela)}, não com o "para menos" R$ ${fmtR$(s.altValorFeito)} — o SIAFI recusaria (ER0462); não emiti`, { url: tela.url });
  }
  const valorFeito = s.altValorFeito || a.valor;
  const { [CONFIRMAR_ANTES_KEY]: confirmarAntes } = await chrome.storage.local.get(CONFIRMAR_ANTES_KEY);
  if (confirmarAntes) {
    const motivo = `${a.operacao} de R$ ${fmtR$(valorFeito)} na ${a.ne}${s.altValorFeito ? ` ("para menos" de R$ ${fmtR$(a.valor)}; a diferença vai de ${COMPLEMENTO_CNET[a.tipo]} em seguida)` : ''} — confira e confirme`;
    await appendLog(`[Alteração] ⚠ CHECKPOINT — ${motivo}`, 'warn');
    await setState({ state: 'checkpoint' });
    notifySidePanel({ type: 'CHECKPOINT', step: 8, summary: { ...tela, payload: s.payload, motivo } });
    return false;
  }
  return emitirAlteracao(tabId, s);
}

/**
 * Emite a alteração no SIAFI, espera a confirmação (a Mensagem SIAFI traz o número
 * da própria NE), finaliza, registra e — se o arredondamento deixou diferença —
 * emenda o irrisório. Retorna true se a máquina deve continuar.
 */
async function emitirAlteracao(tabId, s) {
  const a = s.alteracao;
  const payload = s.payload ?? {};
  const antes = await execInPage(tabId, lerEtapa8).catch(() => null);
  if (!antes) return falhaAlteracao(tabId, s, 4, 'Não consegui ler a tela de emissão da alteração');
  const url = antes.url;

  if (RX_JA_ENVIADO.test(antes.situacao ?? '')) {
    await logVisivel(`[Alteração] Já enviada ao SIAFI (situação: ${antes.situacao}) — não emito de novo`, 'warn');
  } else if (!antes.emitirHabilitado) {
    return falhaAlteracao(tabId, s, 4, `"Emitir Empenho SIAFI" ${antes.temEmitir ? 'está desabilitado' : 'não foi encontrado'} (situação: ${antes.situacao || '—'}) — confira no CNET`, { url });
  } else {
    await logVisivel(`[Alteração] Emitindo ${a.operacao} de R$ ${fmtR$(s.altValorFeito || a.valor)} na ${a.ne} no SIAFI…`, 'info');
    const r = await clicarEConfirmar(tabId, 'Emitir\\s+Empenho');
    if (!r?.ok) return falhaAlteracao(tabId, s, 4, `Não consegui clicar em "Emitir Empenho SIAFI": ${r?.error ?? 'sem resposta'}`, { url });
  }

  // O SIAFI responde depois ("EM PROCESSAMENTO"): relê por ~1,5 min. O CNET pode
  // ficar na tela da alteração ou voltar para a lista "Alteração do empenho" — aí a
  // nossa é a linha emitida (ou com erro) a mais que a lista de antes
  let ne = null, situacao = antes.situacao, mensagem = null, erro = false, naLista = false;
  for (let i = 1; i <= 15 && !ne && !erro; i++) {
    await delay(4000);
    let lista = await comLimite(execInPage(tabId, lerListaAlteracoes));
    if (lista?.naLista) {
      naLista = true;
      if (i % 3 === 0) {   // relê do servidor
        await comLimite(navegarPara(tabId, lista.url), 35000);
        const nova = await comLimite(execInPage(tabId, lerListaAlteracoes));
        if (nova?.naLista) lista = nova;
      }
      const v = avaliarLista(lista, s.altListaAntes, a.ne);
      if (v.ne) { ne = v.ne; situacao = v.situacao; }
      else if (v.erro) { erro = true; situacao = v.situacao; mensagem = v.mensagem; }
      else if (v.situacao) situacao = v.situacao;
    } else {
      const r = i % 2 === 0 ? await comLimite(recarregarMinuta(tabId, url), 40000) : await comLimite(execInPage(tabId, lerEtapa8));
      if (!r) continue;
      situacao = r.situacao ?? situacao;
      mensagem = r.mensagem || mensagem;
      const lido = extrairNE(r.numero) ?? extrairNE(r.mensagem);
      if (lido === a.ne || (lido && /EMITID|SUCESSO/i.test(situacao ?? ''))) ne = lido;
      erro = !ne && i >= 3 && RX_ERRO_SIAFI.test(situacao ?? '');
    }
    if (i % 4 === 0 && !ne && !erro) await logVisivel(`⏳ [Alteração] Aguardando o SIAFI… (situação: ${situacao || '—'})`, 'info');
  }
  if (ne) await logVisivel(`[Alteração] SIAFI: ${a.operacao} emitida na ${ne} ✓${naLista ? ' (lista de alterações)' : ''}`, 'info');
  const status = ne ? 'emitido' : erro ? 'erro' : 'pendente';
  if (status === 'pendente' && !RX_JA_ENVIADO.test(situacao ?? '')) {
    return falhaAlteracao(tabId, s, 4, `cliquei em Emitir, mas o CNET não mostrou a emissão (situação: ${situacao || '—'}) — confira a alteração antes de fazer de novo`, { status: 'conferir', url });
  }
  if (ne && ne !== a.ne) await logVisivel(`⚠ A alteração voltou com a ${ne}, não a ${a.ne} — confira`, 'warn');

  // De volta à lista de alterações, o CNET já fechou a alteração: não há "Finalizar"
  const naListaAgora = (await comLimite(execInPage(tabId, lerListaAlteracoes)))?.naLista;
  if (status !== 'erro' && naListaAgora) {
    await logVisivel('[Alteração] O CNET voltou para a lista de alterações — finalizada ✓', 'info');
  } else if (status !== 'erro') {
    const f = await clicarEConfirmar(tabId, '\\bFinalizar\\b');
    if (f?.ok) { await logVisivel('[Alteração] Finalizada ✓', 'info'); try { await waitForNavigation(tabId, 15000); } catch {} }
    else await logVisivel(`⚠ [Alteração] Não finalizei (${f?.error ?? 'sem resposta'}) — finalize no CNET depois`, 'warn');
  }

  // O que o arredondamento deixou de fora (valor do modal "para menos")
  const valorFeito = s.altValorFeito || a.valor;
  const falta = Math.round((a.valor - valorFeito) * 100) / 100;
  const complemento = a.origem === 'solicitacao' && falta >= 0.01 ? falta : 0;
  const id = `${Date.now()}-${a.solicitacao}`;

  if (a.origem === 'solicitacao') {
    await registrarEmpenho({
      id, data: new Date().toISOString(), solicitacao: a.solicitacao, ne: ne ?? a.ne, status,
      operacao: a.tipo, neAlterar: a.ne, situacao: situacao ?? '', mensagem: mensagem ?? '', url,
      fornecedor: payload.fornecedorNome ?? '', cnpj: String(payload.fornecedorCnpj ?? '').replace(/\D/g, ''),
      origem: payload.contrato ?? '', pag: payload.pag ?? '', ugCred: payload.ugCred ?? '',
      valorSolicitado: a.valor, valorEmpenhado: valorFeito,
      reforco: complemento, reforcoStatus: complemento && status !== 'erro' ? 'a-fazer' : undefined,
      arredondado: !!s.altValorFeito,
      motivo: status === 'erro' ? `SIAFI recusou${mensagem ? `: ${mensagem}` : ''}` : '',
      verificacaoFornecedor: payload.verificacaoFornecedor?.resumo ?? '',
    });
  } else if (a.registroId) {
    await atualizarRegistro(a.registroId, {
      reforcoStatus: status === 'emitido' ? 'feito' : status, reforcoEm: new Date().toISOString(),
      reforcoMensagem: mensagem ?? '', reforcoOperacao: a.operacao,
    });
  }
  await setState({ falhasSeguidas: 0 });

  const resumo = status === 'emitido' ? `emitido na ${ne}` : status === 'erro' ? `ERRO SIAFI${mensagem ? `: ${mensagem}` : ''}` : 'em processamento no SIAFI — confira depois';
  await logVisivel(`${status === 'emitido' ? '✅' : status === 'erro' ? '❌' : '⏳'} ${a.solicitacao || ''} ${a.operacao} de R$ ${fmtR$(valorFeito)} → ${resumo}`,
    status === 'emitido' ? 'success' : status === 'erro' ? 'error' : 'warn');
  if (a.origem !== 'solicitacao' && a.registroId && status === 'emitido') {
    // Irrisório feito: a solicitação está completa — o painel deixa de mostrar "falta"
    const reg = await lerRegistro(a.registroId);
    const base = Number(reg?.valorEmpenhado ?? 0);
    const pedido = Number(reg?.valorSolicitado ?? 0);
    const total = Math.round((base + a.valor) * 100) / 100;
    const oQue = a.tipo === 'anulacao' ? 'Anulação completa' : a.origem === 'complemento' ? 'Reforço completo' : 'Empenho completo';
    await logVisivel(`✅ ${a.solicitacao || ''}: ${oQue} na ${ne} — R$ ${fmtR$(base)} + ${a.operacao.toLowerCase()} R$ ${fmtR$(a.valor)} = R$ ${fmtR$(total)}`
      + (pedido > 0 && Math.abs(total - pedido) < 0.01 ? ' (o valor solicitado)' : pedido > 0 ? ` (solicitado R$ ${fmtR$(pedido)})` : ''), 'success');
    notifySidePanel({ type: 'DONE', ne, status, mensagem, payload, valorEmpenhado: total, valorSolicitado: pedido || total, reforco: 0,
      irrisorio: { base, valor: a.valor, operacao: a.operacao, tipo: a.tipo } });
  } else {
    notifySidePanel({ type: 'DONE', ne: ne ?? a.ne, status, mensagem, payload, valorEmpenhado: valorFeito, valorSolicitado: a.valor, reforco: complemento });
  }

  // Arredondamento deixou diferença: emenda o irrisório na mesma NE
  if (complemento && status !== 'erro') {
    if (complemento > limiteIrrisorio(s.altDegrau)) {
      await logVisivel(`⚠ Faltaram R$ ${fmtR$(complemento)} — mais que o arredondamento explica; confira e faça o ${COMPLEMENTO_CNET[a.tipo]} no CNET`, 'warn');
      return seguirFila(tabId);
    }
    // Resto de cada item (do arredondamento do robô); sem ele, o item único
    const restos = (s.altRestos ?? []).filter(x => x.valor >= 0.01);
    const somaRestos = restos.reduce((t, x) => t + x.valor, 0);
    const item = restos.length && restos.every(x => x.numeroItem) && Math.abs(somaRestos - complemento) < 0.01
      ? restos.map(x => ({ numeroItem: String(x.numeroItem), valor: String(x.valor) }))
      : a.itens?.length === 1 ? [{ numeroItem: a.itens[0].numeroItem, valor: String(complemento) }] : [];
    await setState({
      altStep: 0, altValorFeito: null, altDegrau: null, altRestos: null,
      alteracao: { ne: ne ?? a.ne, tipo: a.tipo, operacao: COMPLEMENTO_CNET[a.tipo], valor: complemento, itens: item,
        irrisorio: true, origem: 'complemento', registroId: id, solicitacao: a.solicitacao },
    });
    await logVisivel(`▶ Agora o ${COMPLEMENTO_CNET[a.tipo]} de R$ ${fmtR$(complemento)} na ${ne ?? a.ne} (o que o arredondamento deixou de fora)`, 'info');
    return true;
  }
  return seguirFila(tabId);
}

/**
 * Depois de um empenho novo: arredondamento "para menos" deixou diferença →
 * REFORÇO IRRISÓRIO na NE recém-emitida (precisa do número dela).
 */
async function depoisDoEmpenho(tabId, payload, r) {
  const s = await getState();
  const falta = r.reforco ?? 0;
  if (falta >= 0.01 && r.status !== 'erro' && !s.dryRun) {
    const sol = payload.numeroSolicitacao ?? '';
    if (!s.arredondado) {
      // Diferença sem arredondamento não é caso de irrisório: fica no relatório
      await logVisivel(`⚠ ${sol}: faltaram R$ ${fmtR$(falta)} sem arredondamento no CNET — confira (o robô não faz reforço irrisório nesse caso)`, 'warn');
    } else if (r.status !== 'emitido' || !r.ne) {
      await atualizarRegistro(r.registroId, { reforcoStatus: 'pendente-ne' });
      await logVisivel(`⚠ ${sol}: o reforço irrisório de R$ ${fmtR$(falta)} fica para depois — a NE ainda está em processamento no SIAFI`, 'warn');
    } else if (falta > limiteIrrisorio(s.degrauArredondamento)) {
      await logVisivel(`⚠ ${sol}: faltaram R$ ${fmtR$(falta)} — mais que o arredondamento explica; confira e faça o reforço no CNET`, 'warn');
    } else {
      const itens = payload.itensEmpenho ?? [];
      await setState({
        flow: 'alteracao-cnet', altStep: 0, altValorFeito: null, altDegrau: null, altRestos: null,
        alteracao: { ne: r.ne, tipo: 'reforco', operacao: 'REFORÇO IRRISÓRIO', valor: falta,
          itens: itens.length === 1 ? [{ numeroItem: itens[0].numeroItem, valor: String(falta) }] : [],
          irrisorio: true, origem: 'irrisorio', registroId: r.registroId, solicitacao: sol },
      });
      await logVisivel(`▶ ${sol}: fazendo o REFORÇO IRRISÓRIO de R$ ${fmtR$(falta)} na ${r.ne}…`, 'info');
      return true;
    }
  }
  return seguirFila(tabId);
}

/**
 * Falha na alteração. Da solicitação (reforço/anulação): registra e segue a fila,
 * como no empenho. Do irrisório: o principal já foi feito — anota no registro dele.
 */
async function falhaAlteracao(tabId, s, passo, erro, { status = 'falhou', url = null } = {}) {
  const a = s.alteracao ?? {};
  if (a.origem === 'solicitacao') return pularSolicitacao(tabId, ROTULO_ALT[passo] ?? passo, erro, { status, url });

  const aba = await chrome.tabs.get(tabId).catch(() => null);
  if (RX_SESSAO.test(aba?.url ?? '')) {
    const msg = `A sessão do CNET expirou (${a.operacao} da ${a.ne}). Entre de novo no CNET e use Retomar — o robô recomeça o irrisório.`;
    await appendLog(`❌ ${msg}`, 'error');
    await setState({ state: 'paused', altStep: 0 });
    notifySidePanel({ type: 'PAUSED', error: msg, step: 0 });
    return false;
  }
  const motivo = limparMotivo(erro) || 'erro sem descrição';
  if (a.registroId) {
    await atualizarRegistro(a.registroId, { reforcoStatus: status === 'conferir' ? 'conferir' : 'falhou', reforcoMotivo: `${ROTULO_ALT[passo]}: ${motivo}` });
  }
  await logVisivel(`⛔ ${a.operacao} de R$ ${fmtR$(a.valor ?? 0)} na ${a.ne} NÃO feito (${ROTULO_ALT[passo]}): ${motivo} — faça no CNET`, 'error');
  return seguirFila(tabId);
}


// ── Comunicação com Side Panel ────────────────────────────────────────────────

let sidePanelPort = null;

export function setSidePanelPort(port) { sidePanelPort = port; }

function notifySidePanel(msg) {
  if (sidePanelPort) {
    try { sidePanelPort.postMessage(msg); } catch { sidePanelPort = null; }
  }
}
