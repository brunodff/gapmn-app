// Leitura das três planilhas do Painel Orçamentário (CSV exportado do Google Sheets).
// Reproduz os passos do Power Query do BI: cabeçalho, "preencher para baixo" e,
// nos empenhos, a soma por nota usando o último valor de cada item.

import type { Empenho, LinhaDisponivel, LinhaRecebido } from "./tipos.ts";
import { REGRAS_DISPONIVEL, REGRAS_RECEBIDO, siglaDe } from "./unidades.ts";

export class ErroFormato extends Error {}

/** CSV do Google Sheets: vírgula, aspas duplas, quebra de linha dentro de aspas. */
export function parseCSV(texto: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo.replace(/\r$/, "")); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo.replace(/\r$/, "")); linhas.push(linha); }
  return linhas;
}

/** Número no formato brasileiro ("1.234,56", "-10,5", "R$ 3,00") ou simples ("5000000"). */
export function numeroBR(v: unknown): number | null {
  let s = String(v ?? "").replace(/R\$/g, "").replace(/\s/g, "");
  if (!s || s === "-") return null;
  const negativoParenteses = /^\(.*\)$/.test(s);
  if (negativoParenteses) s = s.slice(1, -1);
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativoParenteses ? -n : n;
}

/** "9/10/2026" ou "09/10/2026 00:00" → "2026-10-09". */
export function dataBR(v: unknown): string | null {
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mes, a] = m;
  if (+mes < 1 || +mes > 12 || +d < 1 || +d > 31) return null;
  return `${a}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

const txt = (v: unknown) => String(v ?? "").trim();

/**
 * Crédito recebido (aba "Dados" da planilha de movimentação; no BI, tabela "Dados (2)").
 * Cabeçalho: RO - Doc Web, Emissão - Dia, Emitente - UG, (nome), UG Responsável, (nome),
 * Esfera, (nome), Ação Governo, (nome), PI, (nome), PTRES, Natureza Despesa, (nome), …, Movim. Líquido.
 */
export function lerRecebido(linhas: string[][]): LinhaRecebido[] {
  const iCab = linhas.findIndex((l) => l.some((c) => /emiss/i.test(c)));
  if (iCab < 0) throw new ErroFormato("Planilha de crédito recebido sem o cabeçalho \"Emissão - Dia\".");
  const cab = linhas[iCab].map(txt);
  const col = (rx: RegExp) => cab.findIndex((c) => rx.test(c));
  const cData = col(/emiss/i), cUG = col(/^UG Respons/i), cPI = col(/^PI$/i), cND = col(/^Natureza/i), cValor = col(/^Movim/i);
  const cAcao = col(/^A[çc][ãa]o Governo/i);
  if ([cData, cUG, cPI, cND, cValor].some((c) => c < 0)) {
    throw new ErroFormato("Planilha de crédito recebido com colunas diferentes das esperadas.");
  }
  // O SIAFI só escreve data, UG, ação, PI e ND quando mudam; o BI preenche para baixo.
  const preencher = [cData, cUG, cUG + 1, cAcao, cAcao + 1, cPI, cPI + 1, cND, cND + 1].filter((c) => c >= 0);
  const ultimo = new Map<number, string>();
  const saida: LinhaRecebido[] = [];
  for (const bruta of linhas.slice(iCab + 1)) {
    const l = bruta.map((v, i) => (txt(v) === "" && preencher.includes(i) ? ultimo.get(i) ?? "" : v));
    l.forEach((v, i) => { if (txt(v) !== "") ultimo.set(i, v); });
    const valor = numeroBR(l[cValor]);
    const data = dataBR(l[cData]);
    if (valor === null || !data) continue;
    const ugNome = txt(l[cUG + 1]);
    saida.push({
      data, ugNome, sigla: siglaDe(ugNome, REGRAS_RECEBIDO),
      nd: txt(l[cND]), ndNome: txt(l[cND + 1]), pi: txt(l[cPI]), piNome: txt(l[cPI + 1]), valor,
    });
  }
  return saida;
}

// Colunas da aba de empenhos (sem cabeçalho útil; posições fixas, como no Power Query do BI).
// As colunas de favorecido (CNPJ/CPF e nome) existem na planilha e NÃO são lidas.
const E = { data: 0, ne: 1, item: 2, valorItem: 6, ugNome: 9, nd: 10, piNome: 13 } as const;

/**
 * Empenhos (aba "Dados" da planilha de NE; no BI, tabela "Dados").
 * Cada nota tem vários itens e cada item pode aparecer em várias linhas (inclusão, reforço,
 * anulação); vale o último valor informado do item, e a nota é a soma dos itens.
 */
export function lerEmpenhos(linhas: string[][]): Empenho[] {
  const corpo = linhas.filter((l) => dataBR(l[E.data]) !== null);
  if (corpo.length && corpo[0].length <= E.piNome) {
    throw new ErroFormato("Planilha de empenhos com menos colunas do que o esperado.");
  }
  let ne = "", item = "";
  const valorDoItem = new Map<string, number>();
  const primeira = new Map<string, string[]>();
  for (const l of corpo) {
    if (txt(l[E.ne])) ne = txt(l[E.ne]);
    if (txt(l[E.item])) item = txt(l[E.item]);
    if (!ne) continue;
    const v = numeroBR(l[E.valorItem]);
    if (v !== null) valorDoItem.set(ne + "\u0000" + item, v);
    if (!primeira.has(ne)) primeira.set(ne, l);
  }
  const totalDaNota = new Map<string, number>();
  for (const [chave, v] of valorDoItem) {
    const n = chave.split("\u0000")[0];
    totalDaNota.set(n, (totalDaNota.get(n) ?? 0) + v);
  }
  return [...primeira].map(([n, l]) => {
    const ugNome = txt(l[E.ugNome]);
    return {
      ne: n, data: dataBR(l[E.data]) as string, ugNome, sigla: siglaDe(ugNome, REGRAS_RECEBIDO),
      nd: txt(l[E.nd]), piNome: txt(l[E.piNome]), valor: totalDaNota.get(n) ?? 0,
    };
  });
}

/**
 * Crédito disponível (planilha de saldo por PTRES/PI/ND/UG).
 * Cabeçalho: PTRES, PI, (nome), Natureza Despesa, (nome), UG Responsável, (nome), Saldo.
 */
export function lerDisponivel(linhas: string[][]): LinhaDisponivel[] {
  const iCab = linhas.findIndex((l) => txt(l[0]).toUpperCase() === "PTRES");
  if (iCab < 0) throw new ErroFormato("Planilha de crédito disponível sem o cabeçalho \"PTRES\".");
  let anterior: string[] = [];
  const saida: LinhaDisponivel[] = [];
  for (const bruta of linhas.slice(iCab + 1)) {
    if (!bruta.some((v) => txt(v) !== "")) continue;
    if (/^total/i.test(txt(bruta[0]))) continue;
    const l = bruta.map((v, i) => (txt(v) === "" && i < 7 ? anterior[i] ?? "" : v));
    anterior = l;
    const valor = numeroBR(l[7]);
    if (valor === null) continue;
    const ugNome = txt(l[6]);
    saida.push({
      ptres: txt(l[0]), pi: txt(l[1]), piNome: txt(l[2]), nd: txt(l[3]), ndNome: txt(l[4]),
      ugNome, sigla: siglaDe(ugNome, REGRAS_DISPONIVEL), valor,
    });
  }
  return saida;
}
