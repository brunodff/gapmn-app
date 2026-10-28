// Formatação pt-BR do Painel de Governança. Funções puras, sem React.
// Regra: número formatado (com vírgula) nunca entra em CSS; para CSS use larguraCss().

import type { Direcao, Tendencia } from "./tipos.ts";

const MESES: Record<string, string> = {
  JAN: "janeiro", FEV: "fevereiro", MAR: "março", ABR: "abril", MAI: "maio", JUN: "junho",
  JUL: "julho", AGO: "agosto", SET: "setembro", OUT: "outubro", NOV: "novembro", DEZ: "dezembro",
};

/** 'JUL/26' → 'julho de 2026'; 'JAN-JUN/26' → '1º semestre de 2026'. */
export function competenciaPorExtenso(label: string): string {
  const per = label.match(/^([A-Z]{3})-([A-Z]{3})\/(\d{2})$/);
  if (per) {
    const ano = `20${per[3]}`;
    if (per[1] === "JAN" && per[2] === "JUN") return `1º semestre de ${ano}`;
    if (per[1] === "JUL" && per[2] === "DEZ") return `2º semestre de ${ano}`;
    return `${MESES[per[1]] ?? per[1]} a ${MESES[per[2]] ?? per[2]} de ${ano}`;
  }
  const mes = label.match(/^([A-Z]{3})\/(\d{2})$/);
  if (mes) return `${MESES[mes[1]] ?? mes[1]} de 20${mes[2]}`;
  return label;
}

export function fmtNumero(v: number | null | undefined, maxCasas = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: maxCasas });
}

/** Fração → percentual pt-BR: 43 → '4.300%', 1.214 → '121%'. */
export function fmtPercentual(fracao: number | null | undefined, casas = 0): string {
  if (fracao === null || fracao === undefined || !Number.isFinite(fracao)) return "—";
  // com casas > 0, fixas: saúde e nota sempre como "100,0%", "30,0%" (igual ao Power BI)
  return fracao.toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/**
 * Largura de barra para CSS, sempre com ponto decimal.
 * A trilha vai de 0 a `teto` (150% por padrão); o número real fica no rótulo.
 */
export function larguraCss(fracao: number | null, teto = 1.5): string {
  const f = fracao === null || !Number.isFinite(fracao) ? 0 : Math.max(0, Math.min(fracao, teto));
  return `${((f / teto) * 100).toFixed(1)}%`;
}

const UNIDADES_CURTAS: Record<string, string> = {
  "Percentual (%)": "%",
  "Dias": "dias",
  "Dias úteis": "dias úteis",
  "Dias corridos": "dias corridos",
  "Horas": "h",
  "Meses": "meses",
  "Anos": "anos",
  "Razão (Vezes)": "×",
  "Unidade (Número Absoluto)": "",
  "Quantidade": "",
  "Militares / Auxiliar": "militares/auxiliar",
  "Homem-Hora / Chamado": "HH/chamado",
  "Homem-Hora / OS": "HH/OS",
};

const SINGULARES: Record<string, string> = {
  "dias": "dia", "dias úteis": "dia útil", "dias corridos": "dia corrido", "meses": "mês", "anos": "ano",
};

export function unidadeCurta(unidade: string, valor?: number): string {
  const u = unidade in UNIDADES_CURTAS ? UNIDADES_CURTAS[unidade] : unidade.toLowerCase();
  return valor !== undefined && Math.abs(valor) === 1 && u in SINGULARES ? SINGULARES[u] : u;
}

/** Reais: 'R$ 19.692,83'. */
export function fmtReais(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Valor com unidade: '12,4 dias úteis', '1 dia útil', '98,9%', 'R$ 19.692,83', '—'. */
export function fmtValor(valor: number | null, unidade: string, maxCasas = 2): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  if (unidade === "R$") return fmtReais(valor);
  const u = unidadeCurta(unidade, valor);
  const n = fmtNumero(valor, maxCasas);
  if (!u) return n;
  if (u === "%" || u === "×") return `${n}${u}`;
  return `${n} ${u}`;
}

/**
 * Meta como deve aparecer. A planilha grava algumas metas de percentual como fração
 * ('0.99', '1'); nesses casos a meta é montada a partir de META_NUM: '≥ 99%'.
 */
export function metaExibida(metaTxt: string | null, metaNum: number | null, unidade: string, direcao: Direcao): string {
  const txt = (metaTxt ?? "").trim();
  const soNumero = /^-?\d+([.,]\d+)?$/.test(txt);
  if (txt && !soNumero) return txt;
  if (metaNum === null) return txt || "—";
  const simbolo = direcao === "Maior é melhor" ? "≥ " : direcao === "Menor é melhor" ? "≤ " : "";
  return `${simbolo}${fmtValor(metaNum, unidade)}`;
}

/** Redação neutra dos IDs 16 e 22: 'Variação de −43,3% no período (de 90 para 51)'. */
export function fraseVariacao(de: number, para: number): string {
  const faixa = `(de ${fmtNumero(de)} para ${fmtNumero(para)})`;
  if (de === 0) return `Variação no período ${faixa}`;
  const pct = ((para - de) / de) * 100;
  const sinal = pct > 0 ? "+" : pct < 0 ? "−" : "";
  const abs = Math.abs(pct).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `Variação de ${sinal}${abs}% no período ${faixa}`;
}

export function fmtTendencia(t: Tendencia | null, unidade: string): string {
  if (!t) return "—";
  const sinal = t.media > 0 ? "+" : t.media < 0 ? "−" : "";
  const u = unidadeCurta(unidade);
  const n = fmtNumero(Math.abs(t.media));
  const corpo = !u ? n : u === "%" || u === "×" ? `${n}${u}` : `${n} ${u}`;
  return `${sinal}${corpo} por competência`;
}

/** '2026-10-16T20:08:20' → '16/10 às 20:08'. */
export function fmtGeradoEm(iso: string | null | undefined): string {
  const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} às ${m[4]}:${m[5]}` : "—";
}

/**
 * Quanto um percentual subiu ou desceu, já em %: a saúde foi de 60% para 70% → "+10,0%".
 * (Antes saía em pontos percentuais, "p.p."; trocado a pedido em 20/10/2026.)
 */
export function fmtVariacaoPct(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "—";
  const v = delta * 100;
  const sinal = v > 0.05 ? "+" : v < -0.05 ? "−" : "";
  return `${sinal}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
