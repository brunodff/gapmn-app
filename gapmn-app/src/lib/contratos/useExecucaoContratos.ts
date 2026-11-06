// Carrega as planilhas do SIAFI e devolve a execução de cada contrato, pelas regras de ./execucao.ts:
//  - "Situação de empenhos" e restos a pagar: valores de cada NE (empenhado, a liquidar, liquidado, pago);
//  - "Notas de Empenho" (de 2022 em diante): valor, itens, lançamentos e data de emissão de cada NE.
// Usado pela lista de contratos, Dados Gerais, aba Execução, previsão e apostilamento, para que todos mostrem
// os mesmos números. As planilhas são baixadas uma vez por sessão (relidas depois de 5 minutos), mesmo com
// várias telas abertas. Sem a planilha de itens, os valores aparecem do mesmo jeito (só faltam os itens).

import { useEffect, useMemo, useState } from "react";
import { fetchCSV, toEmpenhosNF, toExecucaoLinhas, toRPNEs, SHEET_URLS, type ExecucaoLinha, type LinhaRPNE } from "../gsheets";
import { juntarAnos, lerEmpenhos, type NotaEmpenho } from "../execucao/empenhos.ts";
import {
  execucaoPorContrato, juntarNEs, neCanonica, notaItensDe, primeiraNE, saldoAEmpenhar, vincularNEs,
  type ContratoVinculo, type ExecucaoContrato, type NotaContrato, type SaldoAEmpenhar, type Vinculo,
} from "./execucao.ts";

export type EstadoPlanilhas = "carregando" | "ok" | "erro";
export type Lancamento = { data: string; valor: number };

type Itens = {
  itens: Map<string, NotaEmpenho>;
  lancamentos: Map<string, Lancamento[]>;
  emissao: Map<string, string>;
  /** primeiro e último ano da planilha de itens */
  desde: number;
  ate: number;
};
type Planilhas = { situacao: ExecucaoLinha[]; rps: LinhaRPNE[]; itens: Itens | null };
let cache: { em: number; promessa: Promise<Planilhas> } | null = null;
const VALIDADE_MS = 5 * 60_000;

/** Itens, lançamentos (valor já corrigido da coluna U) e emissão de cada NE da planilha "Notas de Empenho". */
function lerItens(rows: string[][]): Itens {
  const itens = new Map<string, NotaEmpenho>();
  const emissao = new Map<string, string>();
  for (const n of lerEmpenhos(rows)) {
    const k = neCanonica(n.ne);
    if (!k) continue;
    itens.set(k, n);
    if (n.emissao) emissao.set(k, n.emissao);
  }
  const lancamentos = new Map<string, Lancamento[]>();
  for (const l of toEmpenhosNF(rows, { todosOsAnos: true })) {
    const k = neCanonica(l.nota_empenho);
    if (!k || Math.abs(l.valor) < 0.005) continue;
    const data = l.data.split("/").reverse().map((p) => p.padStart(2, "0")).join("-");
    const arr = lancamentos.get(k) ?? [];
    if (!arr.some((x) => x.data === data && x.valor === l.valor)) arr.push({ data, valor: l.valor });
    lancamentos.set(k, arr);
  }
  for (const arr of lancamentos.values()) arr.sort((a, b) => a.data.localeCompare(b.data));
  const anos = [...itens.keys()].map((k) => Number(k.slice(0, 4)));
  return { itens, lancamentos, emissao, desde: Math.min(...anos), ate: Math.max(...anos) };
}

function baixar(): Promise<Planilhas> {
  if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.promessa;
  const promessa = Promise.all([
    fetchCSV(SHEET_URLS.execucao).then((rows) => toExecucaoLinhas(rows).linhas),
    fetchCSV(SHEET_URLS.rpNE).then(toRPNEs).catch(() => [] as LinhaRPNE[]),
    // sem a aba dos anos anteriores, os contratos seguem com o exercício e o saldo antigo vem do SILOMS
    Promise.all([fetchCSV(SHEET_URLS.empenhosNF), fetchCSV(SHEET_URLS.empenhosNFAnteriores).catch(() => [] as string[][])])
      .then(([atual, anteriores]) => lerItens(juntarAnos(atual, anteriores))).catch(() => null),
  ]).then(([situacao, rps, itens]) => ({ situacao, rps, itens }));
  cache = { em: Date.now(), promessa };
  promessa.catch(() => { cache = null; }); // falhou: a próxima tela tenta de novo
  return promessa;
}

type ContratoExec = ContratoVinculo & { data_inicio?: string | null; vl_contratual?: number | null; vl_a_empenhar?: number | null };

export type ExecucaoContratos = {
  estado: EstadoPlanilhas;
  erro: string | null;
  situacao: ExecucaoLinha[];
  rps: LinhaRPNE[];
  nes: Map<string, NotaContrato>;
  vinculos: Map<string, Vinculo>;
  /** id do contrato → execução (NEs, totais e avisos) */
  porContrato: Map<string, ExecucaoContrato>;
  /** itens das NEs do ano (null = planilha de itens indisponível) */
  itens: Itens | null;
  anoAtual: number;
  /** saldo a empenhar de um contrato — o mesmo em todas as telas (null enquanto carrega) */
  saldo: (c: ContratoExec) => SaldoAEmpenhar;
  /** emissão da primeira NE do contrato (para a previsão saber se ele já corria antes do início gravado) */
  primeiraNE: (id: string) => string | null;
};

export function useExecucaoContratos(contratos: readonly ContratoExec[]): ExecucaoContratos {
  const [dados, setDados] = useState<Planilhas>({ situacao: [], rps: [], itens: null });
  const [estado, setEstado] = useState<EstadoPlanilhas>("carregando");
  const [erro, setErro] = useState<string | null>(null);
  const anoHoje = useMemo(() => new Date().getFullYear(), []);

  useEffect(() => {
    let vivo = true;
    baixar()
      .then((d) => {
        if (!vivo) return;
        setDados(d);
        setEstado(d.situacao.length ? "ok" : "erro");
        setErro(d.situacao.length ? null : "planilha vazia");
      })
      .catch((e: unknown) => {
        if (!vivo) return;
        setEstado("erro");
        setErro(e instanceof Error ? e.message : "falha ao carregar");
      });
    return () => { vivo = false; };
  }, []);

  // o exercício é o ano mais recente da planilha de itens (no começo do ano ela pode ainda estar no anterior)
  const anoAtual = dados.itens?.ate && Number.isFinite(dados.itens.ate) ? dados.itens.ate : anoHoje;
  const nes = useMemo(
    () => juntarNEs(dados.situacao, dados.rps, [...(dados.itens?.itens.values() ?? [])].map(notaItensDe), anoAtual),
    [dados, anoAtual],
  );
  const vinculos = useMemo(() => vincularNEs(contratos, nes.values()), [contratos, nes]);
  // valor das NEs completo desde o primeiro ano da planilha de itens (sem ela, só o ano e o anterior)
  const cobertura = dados.itens && Number.isFinite(dados.itens.desde) ? `${dados.itens.desde}-01-01` : undefined;
  const porContrato = useMemo(
    () => execucaoPorContrato(contratos, nes, vinculos, anoAtual, cobertura),
    [contratos, nes, vinculos, anoAtual, cobertura],
  );

  const ok = estado === "ok";
  const saldo = useMemo(
    () => (c: ContratoExec) => (ok ? saldoAEmpenhar(c.vl_contratual, porContrato.get(c.id), c.vl_a_empenhar) : { valor: null, fonte: null }),
    [ok, porContrato],
  );
  const emissao = dados.itens?.emissao;
  const primeira = useMemo(
    () => (id: string) => primeiraNE(porContrato.get(id), emissao ?? new Map()),
    [porContrato, emissao],
  );

  return { estado, erro, situacao: dados.situacao, rps: dados.rps, nes, vinculos, porContrato, itens: dados.itens, anoAtual, saldo, primeiraNE: primeira };
}
