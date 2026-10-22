// Busca das três planilhas do Painel Orçamentário (as mesmas que o Power BI lê).
// São planilhas publicadas por link; o navegador baixa o CSV direto do Google, sem servidor no meio.
// Guarda o último resultado bom para a tela abrir na hora e para quando o Google não responder.

import { lerDisponivel, lerEmpenhos, lerRecebido, parseCSV } from "./leitura.ts";
import type { DadosOrcamento } from "./tipos.ts";

const csv = (id: string, gid: string) => `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;

export const PLANILHAS_ORCAMENTO = {
  /** Movimentação de crédito (aba "Dados"); no BI, tabela "Dados (2)". */
  recebido: csv("1ZA22vgi7L511h6BX8ngfOknNceDPy5xmZszgvcxC1jA", "263182411"),
  /** Saldo de crédito disponível; no BI, tabela "Crédito Disponível". */
  disponivel: csv("1u_C28gNt0klzmSaaTWg9wK9YJAvnSImmvDmc65V8aDo", "1376861542"),
  /** Notas de empenho; no BI, tabela "Dados". */
  empenhos: csv("1XQ5CGcB0dTVADeEGfKjtXRhqtHxsNf1J1H_9VKjBklM", "1297815245"),
};

export type ResultadoOrcamento = {
  dados: DadosOrcamento;
  /** Quando as planilhas foram lidas (ISO). */
  lidoEm: string;
};

const CHAVE = "gapmn_orcamento_credito_v3";
const TEMPO_LIMITE_MS = 45_000;

async function baixar(url: string, sinal: AbortSignal): Promise<string[][]> {
  let r: Response;
  try {
    r = await fetch(url, { cache: "no-store", signal: sinal });
  } catch (e) {
    // sem rede (ou bloqueado) o navegador só diz "Failed to fetch", em inglês
    if ((e as Error)?.name === "AbortError") throw e;
    throw new Error("Sem conexão com o Google Planilhas.");
  }
  if (!r.ok) throw new Error(`A planilha respondeu ${r.status}.`);
  const texto = await r.text();
  if (/^\s*<(!doctype|html)/i.test(texto)) throw new Error("A planilha não está mais publicada por link.");
  return parseCSV(texto);
}

export async function buscarOrcamento(): Promise<ResultadoOrcamento> {
  const ctl = new AbortController();
  const relogio = setTimeout(() => ctl.abort(), TEMPO_LIMITE_MS);
  try {
    const [rec, disp, emp] = await Promise.all([
      baixar(PLANILHAS_ORCAMENTO.recebido, ctl.signal),
      baixar(PLANILHAS_ORCAMENTO.disponivel, ctl.signal),
      baixar(PLANILHAS_ORCAMENTO.empenhos, ctl.signal),
    ]);
    const res: ResultadoOrcamento = {
      dados: { recebido: lerRecebido(rec), disponivel: lerDisponivel(disp), empenhos: lerEmpenhos(emp) },
      lidoEm: new Date().toISOString(),
    };
    try { localStorage.setItem(CHAVE, JSON.stringify(res)); } catch { /* cota cheia ou navegação privada */ }
    return res;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw new Error("As planilhas demoraram demais para responder.");
    throw e;
  } finally {
    clearTimeout(relogio);
  }
}

export function orcamentoGuardado(): ResultadoOrcamento | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const r = JSON.parse(bruto) as ResultadoOrcamento;
    return Array.isArray(r?.dados?.recebido) && Array.isArray(r?.dados?.empenhos) && Array.isArray(r?.dados?.disponivel) ? r : null;
  } catch {
    return null;
  }
}
