// Carrega as planilhas do SIAFI e devolve a execução de cada contrato, pelas regras de ./execucao.ts:
//  - "Situação de empenhos" e restos a pagar: valores de cada NE (empenhado, a liquidar, liquidado, pago);
//  - "Notas de Empenho" (só o ano corrente): itens, lançamentos e data de emissão de cada NE.
// Usado pela lista de contratos, Dados Gerais, aba Execução, previsão e apostilamento, para que todos mostrem
// os mesmos números. As planilhas são baixadas uma vez por sessão (relidas depois de 5 minutos), mesmo com
// várias telas abertas. Sem a planilha de itens, os valores aparecem do mesmo jeito (só faltam os itens).

import { useEffect, useMemo, useState } from "react";
import { fetchCSV, toEmpenhosNF, toExecucaoLinhas, toRPNEs, SHEET_URLS, type ExecucaoLinha, type LinhaRPNE } from "../gsheets";
import { lerEmpenhos, type NotaEmpenho } from "../execucao/empenhos.ts";
import {
  execucaoPorContrato, juntarNEs, neCanonica, primeiraNE, saldoAEmpenhar, vincularNEs,
  type ContratoVinculo, type ExecucaoContrato, type NotaContrato, type SaldoAEmpenhar, type Vinculo,
} from "./execucao.ts";

export type EstadoPlanilhas = "carregando" | "ok" | "erro";
export type Lancamento = { data: string; valor: number };

type Itens = { itens: Map<string, NotaEmpenho>; lancamentos: Map<string, Lancamento[]>; emissao: Map<string, string> };
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
  for (const l of toEmpenhosNF(rows)) {
    const k = neCanonica(l.nota_empenho);
    if (!k || Math.abs(l.valor) < 0.005) continue;
    const data = l.data.split("/").reverse().map((p) => p.padStart(2, "0")).join("-");
    const arr = lancamentos.get(k) ?? [];
    if (!arr.some((x) => x.data === data && x.valor === l.valor)) arr.push({ data, valor: l.valor });
    lancamentos.set(k, arr);
  }
  for (const arr of lancamentos.values()) arr.sort((a, b) => a.data.localeCompare(b.data));
  return { itens, lancamentos, emissao };
}

function baixar(): Promise<Planilhas> {
  if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.promessa;
  const promessa = Promise.all([
    fetchCSV(SHEET_URLS.execucao).then((rows) => toExecucaoLinhas(rows).linhas),
    fetchCSV(SHEET_URLS.rpNE).then(toRPNEs).catch(() => [] as LinhaRPNE[]),
    fetchCSV(SHEET_URLS.empenhosNF).then(lerItens).catch(() => null),
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
  const anoAtual = useMemo(() => new Date().getFullYear(), []);

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

  const nes = useMemo(() => juntarNEs(dados.situacao, dados.rps), [dados]);
  const vinculos = useMemo(() => vincularNEs(contratos, nes.values()), [contratos, nes]);
  const porContrato = useMemo(() => execucaoPorContrato(contratos, nes, vinculos, anoAtual), [contratos, nes, vinculos, anoAtual]);

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
