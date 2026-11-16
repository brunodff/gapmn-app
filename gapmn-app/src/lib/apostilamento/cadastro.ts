// Cadastro do reajuste de um contrato: o que vem pronto do contratos_scon e o que a SCON completa.
import { dataBaseDe, statusContrato } from "./painel.ts";
import type { DadosReajuste, ItemContrato } from "./tipos.ts";

export type ContratoScon = {
  id: string;
  numero_contrato: string;
  pag_nup: string | null;
  fornecedor: string | null;
  cnpj: string | null;
  descricao: string | null;
  data_orcamento: string | null;
  data_final: string | null;
  vl_contratual: number | null;
};

export const fmtCnpj = (c: string | null | undefined) => {
  const d = String(c ?? "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : String(c ?? "");
};

/** Sigla da OM apoiada pelo número do contrato ("999/GAPMN-BAMN/2025" → "BAMN"); só sugestão. */
export function omDoNumero(numero: string): string {
  const m = /\/GAPMN-([A-Z0-9º°]+)\//i.exec(numero ?? "");
  return m ? m[1].toUpperCase() : "GAP-MN";
}

/** Primeiro cadastro: o que o app já sabe do contrato; o resto a SCON preenche (o motor aponta o que falta). */
export function dadosIniciais(c: ContratoScon, ano = new Date().getFullYear()): DadosReajuste {
  const dataBase = dataBaseDe(c.data_orcamento) ?? "";
  const devidos = dataBase ? statusContrato({ contrato: c.numero_contrato, data_base: dataBase }).reajustes_devidos : [];
  return {
    contrato: c.numero_contrato,
    nup: c.pag_nup ?? "",
    om_contratante_sigla: omDoNumero(c.numero_contrato),
    om_contratante_nome: "",
    empresa: { nome: c.fornecedor ?? "", cnpj: fmtCnpj(c.cnpj), endereco: "", representante: "", representante_feminino: false },
    objeto_completo: c.descricao ?? "",
    objeto_resumido: "",
    indice: { nome: "", clausula: "", fonte_curta: "pesquisa abaixo" },
    data_base: dataBase,
    base: "ANUAL",
    mostrar_unitario: true,
    reajustes: devidos.map((d) => ({ n: d.n, indice_pct: null, novo: true })),
    numero_instrumento: null,
    instrumento: "Termo de Apostilamento",
    parecer_numero: "",
    itens: [],
    itens_total_inicial: null,
    historico_valores: c.vl_contratual != null ? [{ documento: "Contrato inicial", valor: c.vl_contratual }] : [],
    alteracoes_quantitativas: [],
    complemento_supressao: true,
    orcamento: { gestao_unidade: "", fonte: "", programa_trabalho: "", acao: "", plano_interno: "", natureza_despesa: "", exercicio: ano },
    fiscal: { funcao: "Gestor do Contrato" },
    data_declaracao: "",
    observacoes_extras: [],
  };
}

/** Itens colados de uma planilha (Excel/Calc): uma linha por item, colunas separadas por tabulação.
 *  Ordem: item, descrição, CATSER, quantidade, valor unitário mensal, valor do item na base (ex.: anual). */
export function itensColados(texto: string): ItemContrato[] {
  const num = (s: string | undefined) => {
    const t = String(s ?? "").replace(/R\$\s*/i, "").trim();
    if (!t) return null;
    const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
    return Number.isFinite(n) ? n : null;
  };
  return texto.split(/\r?\n/).map((l) => l.split("\t")).filter((c) => c.length >= 4 && /^\d+$/.test(c[0].trim()))
    .map((c) => ({ item: Number(c[0]), descricao: (c[1] ?? "").trim(), catser: (c[2] ?? "").trim(), qtd: num(c[3]), valor_unit: num(c[4]), valor_base: num(c[5]) }));
}

/** Para o banco e o painel: quantos reajustes já foram aplicados (marcados como não novos). */
export const reajustesAplicados = (d: DadosReajuste) => d.reajustes.filter((r) => !r.novo).length;

/** Dados para o motor: tira campos vazios opcionais que o motor trataria como preenchidos. */
export function paraMotor(d: DadosReajuste): DadosReajuste {
  const x = structuredClone(d) as DadosReajuste & Record<string, unknown>;
  for (const k of ["contratante_paragrafo", "contratada_paragrafo", "om_ordenador", "data_declaracao"] as const) if (!x[k]) delete x[k];
  if (!x.orcamento.acao) delete x.orcamento.acao;
  if (!x.orcamento.ug_texto) delete x.orcamento.ug_texto;
  if (x.itens_total_inicial == null) delete (x as Record<string, unknown>).itens_total_inicial;
  x.itens = x.itens.map((it) => {
    const i = { ...it } as Record<string, unknown>;
    if (i.qtd_inicial == null) delete i.qtd_inicial;
    if (i.valor_atual_documentado == null) delete i.valor_atual_documentado;
    if (!i.catser) delete i.catser;
    return i as unknown as ItemContrato;
  });
  x.reajustes = x.reajustes.map((r) => (r.novo ? { n: r.n, indice_pct: r.indice_pct, novo: true } : r));
  x.observacoes_extras = x.observacoes_extras.filter((s) => s.trim());
  return x;
}
