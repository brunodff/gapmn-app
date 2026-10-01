/**
 * Background (service worker no Chrome / event page no Firefox) — GAPMN Empenho Bot v2.0 (MV3)
 *
 * Responsabilidades:
 * - Detecta aba do SILOMS e do Contratos.gov.br
 * - Recebe comandos do side panel via porta (connect)
 * - Recebe payloads do gapmn.app via chrome.runtime.onMessageExternal
 * - Orquestra a máquina de estados (stateMachine.js)
 */

import {
  getState, setState, appendLog,
  startColeta, startEmpenho,
  pauseEmpenho, resumeEmpenho, abortEmpenho,
  confirmEmissao, setSidePanelPort, recuperarExecucaoOrfa, resolverPendentesAgora,
} from './runner/stateMachine.js';

const COMPRASNET_ORIGIN = 'https://contratos.comprasnet.gov.br';
const SILOMS_PATTERNS   = ['mac1.siloms.intraer', 'siloms.intraer', '/siloms_mac/', 'fab.mil.br', 'siloms'];

// ── Painel lateral (Chrome: sidePanel · Firefox: sidebarAction) ───────────────
// Sem falhar: o Firefox exige gesto do usuário para abrir a sidebar, então
// chamadas vindas de mensagens (sem gesto) são apenas ignoradas.

async function openPanel(tabId) {
  try {
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId });
    } else if (typeof browser !== 'undefined' && browser.sidebarAction?.open) {
      await browser.sidebarAction.open();
    }
  } catch { /* sem gesto do usuário ou painel já aberto */ }
}

// ── Detectores de aba ─────────────────────────────────────────────────────────

async function getSilomsTab() {
  const tabs = await chrome.tabs.query({});
  // Aba com SILOMS: URL contém padrões do SILOMS ou está ativa numa aba com título SILOMS
  const match = tabs.find(t => {
    const url   = (t.url   ?? '').toLowerCase();
    const title = (t.title ?? '').toLowerCase();
    return SILOMS_PATTERNS.some(p => url.includes(p) || title.includes('siloms'));
  });
  return match ?? null;
}

async function getActiveComprasnetTab() {
  const tabs = await chrome.tabs.query({ url: `${COMPRASNET_ORIGIN}/*` });
  return tabs.find(t => t.active) ?? tabs[0] ?? null;
}

// ── Side panel port (comunicação bidirecional) ────────────────────────────────

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'empenho-sidepanel') return;

  setSidePanelPort(port);

  port.onMessage.addListener(async msg => {
    switch (msg.type) {

      case 'GET_STATE': {
        await recuperarExecucaoOrfa();
        const s = await getState();
        port.postMessage({ type: 'STATE', state: s });
        break;
      }

      case 'PAUSE':  await pauseEmpenho();  break;
      case 'RESUME': await resumeEmpenho(); break;
      case 'ABORT':  await abortEmpenho();  break;

      case 'CONFIRM_EMISSAO': {
        const r = await confirmEmissao();
        if (!r.ok) port.postMessage({ type: 'ERROR', message: r.error });
        break;
      }

      // Revisita as minutas "em processamento" para anotar o número da NE
      case 'RESOLVER_PENDENTES': {
        const tab = await getActiveComprasnetTab();
        if (!tab) {
          port.postMessage({ type: 'ERROR', message: 'Abra o Contratos.gov.br (logado) para buscar as NEs pendentes.' });
          break;
        }
        const r = await resolverPendentesAgora(tab.id);
        port.postMessage({
          type: 'LOG',
          level: r.ocupado ? 'warn' : 'info',
          msg: r.ocupado
            ? '⚠ O robô está executando — busque as pendentes quando ele parar.'
            : `🔎 NEs pendentes: ${r.achadas} encontrada(s)${r.restantes ? `, ${r.restantes} ainda em processamento` : ''}`,
        });
        break;
      }

      // ── Inicia coleta de solicitações no SILOMS (ambos os modos) ──────────
      case 'START_COLETA': {
        const mode = msg.mode ?? 'contratosgov'; // 'siloms' | 'contratosgov'

        const silomsTab = await getSilomsTab();
        if (!silomsTab) {
          port.postMessage({
            type: 'ERROR',
            message: 'Aba do SILOMS não encontrada. Abra o SILOMS em uma aba e faça login.',
          });
          break;
        }

        // Garante que o painel está aberto
        await openPanel(silomsTab.id);

        const r = await startColeta(mode, silomsTab.id);
        port.postMessage({ type: 'COLETA_STARTED', ...r });
        break;
      }

      // ── Inicia empenho CNET (legado — via side panel direto) ──────────────
      case 'START_EMPENHO': {
        const tab = await getActiveComprasnetTab();
        if (!tab) {
          port.postMessage({
            type: 'ERROR',
            message: 'Nenhuma aba do Contratos.gov.br encontrada. Abra o site e faça login.',
          });
          break;
        }
        const r = await startEmpenho(msg.payload, tab.id, msg.dryRun ?? false, msg.queue ?? []);
        port.postMessage({ type: 'STARTED', ...r });
        break;
      }

      case 'PING':
        port.postMessage({ type: 'PONG', ok: true });
        break;
    }
  });

  port.onDisconnect.addListener(() => setSidePanelPort(null));
});

// ── Mensagens externas do gapmn.app ──────────────────────────────────────────

// Firefox não suporta mensagens de páginas web (externally_connectable) — a API
// pode não existir lá; o painel lateral continua funcionando normalmente.
chrome.runtime.onMessageExternal?.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
      return;
    }

    if (msg.type === 'START_EMPENHO') {
      const tab = await getActiveComprasnetTab();
      if (!tab) {
        sendResponse({ ok: false, error: 'Abra o Contratos.gov.br antes de enviar.' });
        return;
      }
      const r = await startEmpenho(msg.payload, tab.id, msg.dryRun ?? false);
      await openPanel(tab.id);
      sendResponse({ ok: true, ...r });
    }

    if (msg.type === 'GET_STATE') {
      const s = await getState();
      sendResponse({ ok: true, state: s });
    }
  })();
  return true; // mantém canal aberto para sendResponse assíncrono
});

// ── Ação de clique (ícone na toolbar) ────────────────────────────────────────

chrome.action.onClicked.addListener(async tab => {
  if (tab?.id) await openPanel(tab.id);
});

// ── Instalação ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setOptions?.({ enabled: true });
});
