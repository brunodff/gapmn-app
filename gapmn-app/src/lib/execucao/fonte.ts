// Busca dos dados do Painel de Execução:
//  - empenhos de 2026 por item (planilha "Notas de Empenho" do Tesouro Gerencial, publicada por link);
//  - situação de cada NE: a liquidar, liquidado a pagar e pago (planilha "Situação de empenhos");
//  - contratos e processos licitatórios do app, para ligar o PAG da NE ao contrato e à licitação.
// Sem acesso aos contratos (sessão vencida, por exemplo), o painel abre do mesmo jeito, sem os vínculos.

import { supabase } from "../supabase";
import { SHEET_URLS, toExecucaoLinhas } from "../gsheets";
import { parseCSV } from "../orcamento/leitura.ts";
import { chavePAG, lerEmpenhos, type NotaEmpenho } from "./empenhos.ts";
import { financeiroPorNE, type ContratoResumo, type Financeiro, type ProcessoResumo } from "./painel.ts";

export type DadosExecucao = {
  nes: NotaEmpenho[];
  financeiro: Map<string, Financeiro>;
  contratos: ContratoResumo[];
  processos: ProcessoResumo[];
  /** Avisos que não impedem o painel (ex.: contratos indisponíveis). */
  avisos: string[];
  lidoEm: string;
};

const TEMPO_LIMITE_MS = 60_000;

async function baixarCSV(url: string, sinal: AbortSignal): Promise<string[][]> {
  let r: Response;
  try {
    r = await fetch(url, { cache: "no-store", signal: sinal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new Error("Sem conexão com o Google Planilhas.");
  }
  if (!r.ok) throw new Error(`A planilha respondeu ${r.status}.`);
  const texto = await r.text();
  if (/^\s*<(!doctype|html)/i.test(texto)) throw new Error("A planilha não está mais publicada por link.");
  return parseCSV(texto);
}

/** Lê uma tabela inteira do Supabase, de mil em mil linhas (o limite de cada consulta). */
async function lerTudo<T>(tabela: string, colunas: string, filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q = supabase.from(tabela).select(colunas).range(de, de + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function lerContratos(): Promise<ContratoResumo[]> {
  type Linha = {
    id: string; numero_contrato: string | null; descricao: string | null; fornecedor: string | null; cnpj: string | null;
    pag_nup: string | null; data_inicio: string | null; data_final: string | null; vl_contratual: number | null; status: string | null;
  };
  const linhas = await lerTudo<Linha>(
    "contratos_scon",
    "id,numero_contrato,descricao,fornecedor,cnpj,pag_nup,data_inicio,data_final,vl_contratual,status",
  );
  return linhas.map((c) => ({
    id: c.id,
    numero: c.numero_contrato ?? "",
    objeto: c.descricao ?? "",
    fornecedor: c.fornecedor ?? "",
    cnpj: c.cnpj,
    pagChave: chavePAG(c.pag_nup),
    inicio: c.data_inicio,
    fim: c.data_final,
    valor: c.vl_contratual,
    status: c.status,
  }));
}

async function lerProcessos(): Promise<ProcessoResumo[]> {
  type Linha = {
    id: string; modalidade: string | null; numero_processo: string | null; ano: number | null;
    objeto: string | null; situacao: string | null; processo_nup: string | null;
  };
  const linhas = await lerTudo<Linha>(
    "processos_licitatorios",
    "id,modalidade,numero_processo,ano,objeto,situacao,processo_nup",
    (q) => q.not("processo_nup", "is", null),
  );
  return linhas.map((p) => ({
    id: p.id,
    modalidade: p.modalidade ?? "",
    numero: [p.numero_processo, p.ano].filter(Boolean).join("/"),
    objeto: p.objeto ?? "",
    situacao: p.situacao,
    pagChave: chavePAG(p.processo_nup),
  }));
}

export async function buscarExecucao(): Promise<DadosExecucao> {
  const ctl = new AbortController();
  const relogio = setTimeout(() => ctl.abort(), TEMPO_LIMITE_MS);
  const avisos: string[] = [];
  try {
    const [itens, situacao, contratos, processos] = await Promise.all([
      baixarCSV(SHEET_URLS.empenhosNF, ctl.signal),
      baixarCSV(SHEET_URLS.execucao, ctl.signal).catch(() => {
        avisos.push("A planilha de situação não respondeu: a liquidação e o pagamento aparecem zerados.");
        return [] as string[][];
      }),
      lerContratos().catch(() => {
        avisos.push("Não foi possível ler os contratos do app: os vínculos com contrato ficaram de fora.");
        return [] as ContratoResumo[];
      }),
      lerProcessos().catch(() => {
        avisos.push("Não foi possível ler os processos licitatórios do app.");
        return [] as ProcessoResumo[];
      }),
    ]);
    const nes = lerEmpenhos(itens);
    if (!nes.length) throw new Error("A planilha de empenhos veio sem notas de empenho.");
    return {
      nes,
      financeiro: financeiroPorNE(toExecucaoLinhas(situacao).linhas),
      contratos,
      processos,
      avisos,
      lidoEm: new Date().toISOString(),
    };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw new Error("As planilhas demoraram demais para responder.");
    throw e;
  } finally {
    clearTimeout(relogio);
  }
}
