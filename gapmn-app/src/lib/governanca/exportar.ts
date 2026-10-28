// Planilha consolidada da coleta (todos os meses), para o levantamento do ano.
// montarAbas é puro (testável); baixarPlanilha só converte para .xlsx com o SheetJS.

import { calcularAtingimento, calcularStatus } from "../indicadores/calculo.ts";
import { metaExibida } from "../indicadores/formato.ts";
import type { Status } from "../indicadores/tipos.ts";
import { DIVISOES, nomeSecao } from "./cadastros.ts";
import type { DadosColeta } from "./coleta.ts";
import { linhaDoIndicador } from "./previa.ts";
import type { IndicadorGov, LancamentoAdmin } from "./tipos.ts";

export type Aba = { nome: string; linhas: Record<string, string | number | null>[] };

const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Manaus", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const dataBR = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const arred = (v: number | null | undefined, casas = 4) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** casas) / 10 ** casas);

/** Classificação do lançamento gravado, pela regra do painel (com o valor que está no banco). */
export function classificar(ind: IndicadorGov, l: Pick<LancamentoAdmin, "v1" | "v2" | "v3" | "valor" | "tipo">): { status: Status; atingimento: number | null } {
  const linha = { ...linhaDoIndicador(ind, l, l.tipo), VALOR: l.valor };
  const atingimento = calcularAtingimento(linha);
  return { status: calcularStatus(linha, atingimento), atingimento };
}

const rotuloStatus = (s: Status) => (s === "Sem dados no mês de referência" ? "Sem evento no mês" : s === "Aguardando informação" ? "Incompleto" : s);

export function montarAbas(d: DadosColeta): Aba[] {
  const porId = new Map(d.indicadores.map((i) => [i.id, i]));
  const comps = [...d.competencias].sort((a, b) => a.codigo.localeCompare(b.codigo));
  const rotulo = new Map(comps.map((c) => [c.codigo, c.rotulo]));
  const ordem = (l: LancamentoAdmin) => porId.get(l.indicador_id)?.ordem ?? 999;
  const lancs = [...d.lancamentos].sort((a, b) => a.competencia.localeCompare(b.competencia) || ordem(a) - ordem(b) || a.tipo.localeCompare(b.tipo));

  const linhaLonga = (l: LancamentoAdmin) => {
    const ind = porId.get(l.indicador_id);
    const c = ind ? classificar(ind, l) : null;
    const semMeta = !ind || ind.direcao === "Monitoramento";
    // lançado com a regra anterior do catálogo (IDs 26, 27 e 28 até SET/26): as variáveis não têm os nomes de hoje
    const regraAntiga = !!ind && !!l.calculo && l.calculo !== ind.calculo;
    const nomeVar = (i: number) => (regraAntiga ? `Variável ${i + 1} (regra anterior do catálogo)` : ind?.variaveis[i] ?? "");
    return {
      "Competência": rotulo.get(l.competencia) ?? l.competencia,
      "Mês (AAAA-MM)": l.competencia,
      "Divisão": ind?.divisao ?? l.divisao ?? "",
      "Seção": ind ? nomeSecao(ind.categoria) : "",
      "ID": l.indicador_id,
      "Indicador": ind?.indicador ?? "",
      "Tipo": l.tipo,
      "Unidade": ind?.unidade ?? "",
      "Variável 1": regraAntiga ? nomeVar(0) : ind?.variaveis[0] ?? (ind?.calculo === "direto" ? "Valor informado" : ""),
      "Valor 1": arred(l.v1),
      "Variável 2": nomeVar(1),
      "Valor 2": arred(l.v2),
      "Variável 3": nomeVar(2),
      "Valor 3": arred(l.v3),
      "Resultado": arred(l.valor),
      "Meta": ind ? (semMeta ? "" : metaExibida(ind.meta_txt, ind.meta_num, ind.unidade, ind.direcao)) : "",
      "Classificação": c && !semMeta ? rotuloStatus(c.status) : "",
      "Atingimento da meta (%)": c && c.atingimento !== null && !semMeta ? arred(c.atingimento * 100, 1) : null,
      "Justificativa": l.comentario ?? "",
      "Comprovante": l.anexo_nome ?? (l.anexo ? "anexado" : ""),
      "Lançado por": [l.posto, l.nome_guerra].filter(Boolean).join(" "),
      "Atualizado em": l.posto || l.nome_guerra ? dataHora(l.atualizado_em) : "importado da planilha",
      "Alterações": l.versao > 1 ? l.versao - 1 : 0,
    };
  };

  // matrizes indicador × mês
  const matriz = (campo: "valor" | "status") => {
    const linhas: Aba["linhas"] = [];
    for (const ind of [...d.indicadores].sort((a, b) => a.ordem - b.ordem)) {
      for (const tipo of ind.planejado ? (["Planejado", "Realizado"] as const) : (["Realizado"] as const)) {
        if (campo === "status" && (ind.direcao === "Monitoramento")) continue;
        const r: Aba["linhas"][number] = {
          "Divisão": ind.divisao, "Seção": nomeSecao(ind.categoria), "ID": ind.id,
          "Indicador": ind.planejado ? `${ind.indicador} (${tipo})` : ind.indicador, "Unidade": ind.unidade,
          "Meta": ind.direcao === "Monitoramento" ? "" : metaExibida(ind.meta_txt, ind.meta_num, ind.unidade, ind.direcao),
        };
        for (const c of comps) {
          const l = d.lancamentos.find((x) => x.competencia === c.codigo && x.indicador_id === ind.id && x.tipo === tipo);
          r[c.rotulo] = !l ? null : campo === "valor" ? arred(l.valor, 2) : rotuloStatus(classificar(ind, l).status);
        }
        linhas.push(r);
      }
    }
    return linhas;
  };

  const abas: Aba[] = [
    { nome: "Resultados por mês", linhas: matriz("valor") },
    { nome: "Classificação por mês", linhas: matriz("status") },
    { nome: "Lançamentos", linhas: lancs.map(linhaLonga) },
  ];
  for (const div of DIVISOES) {
    const daDiv = lancs.filter((l) => (porId.get(l.indicador_id)?.divisao ?? l.divisao) === div.sigla);
    if (daDiv.length) abas.push({ nome: div.sigla, linhas: daDiv.map(linhaLonga) });
  }
  abas.push({
    nome: "Contratos essenciais",
    linhas: [...d.contratos].sort((a, b) => a.competencia.localeCompare(b.competencia) || a.ordem - b.ordem).map((c) => ({
      "Competência": rotulo.get(c.competencia) ?? c.competencia,
      "Serviço essencial": c.servico,
      "NUP": c.nup ?? "",
      "Término da vigência": dataBR(c.termino),
      "Situação (risco)": c.status ?? "",
      "Providências da Administração": c.providencias ?? "",
      "Padrão": c.padrao ? "sim" : "não",
      "Lançado por": [c.posto, c.nome_guerra].filter(Boolean).join(" "),
      "Atualizado em": c.posto || c.nome_guerra ? dataHora(c.atualizado_em) : "",
    })),
  });
  const fmtH = (o: Record<string, unknown> | null) =>
    !o ? "" : (["v1", "v2", "v3", "valor", "comentario", "anexo_nome"] as const)
      .filter((k) => o[k] !== null && o[k] !== undefined && o[k] !== "")
      .map((k) => `${k === "anexo_nome" ? "comprovante" : k}: ${typeof o[k] === "number" ? arred(o[k] as number, 2) : o[k]}`).join(" · ");
  abas.push({
    nome: "Histórico de alterações",
    linhas: d.historico.map((h) => ({
      "Quando": dataHora(h.quando),
      "Competência": rotulo.get(h.competencia) ?? h.competencia,
      "ID": h.indicador_id,
      "Indicador": porId.get(h.indicador_id)?.indicador ?? "",
      "Tipo": h.tipo,
      "Antes": fmtH(h.antes as Record<string, unknown> | null),
      "Depois": fmtH(h.depois as Record<string, unknown> | null),
      "Quem": [h.posto, h.nome_guerra].filter(Boolean).join(" "),
    })),
  });
  return abas;
}

export async function baixarPlanilha(d: DadosColeta, nomeArquivo = "indicadores-gapmn-consolidado.xlsx"): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const aba of montarAbas(d)) {
    const ws = XLSX.utils.json_to_sheet(aba.linhas.length ? aba.linhas : [{ "": "Sem dados" }]);
    // larguras de coluna razoáveis
    const cab = Object.keys(aba.linhas[0] ?? { "": "" });
    ws["!cols"] = cab.map((c) => ({ wch: Math.min(60, Math.max(8, c.length + 2, ...aba.linhas.slice(0, 200).map((l) => String(l[c] ?? "").length))) }));
    XLSX.utils.book_append_sheet(wb, ws, aba.nome.slice(0, 31));
  }
  XLSX.writeFile(wb, nomeArquivo);
}
