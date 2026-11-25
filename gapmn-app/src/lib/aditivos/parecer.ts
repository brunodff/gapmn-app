// Parecer Técnico de Alteração Contratual (item 5 da Lista; revisão 5.1 da SCON, seção 3J): as mesmas regras do
// kit/gerar_parecer_tecnico.py, para a tela mostrar na hora os itens 5 a 11 e as sugestões dos motivos. O que falta
// sai entre ⟦ ⟧ (no documento, em amarelo). O teste aditivos.test.ts confere com a prévia do kit (ponte_aditivo.previa_parecer).
import type { Alerta, DadosAditivo, ItemParecer } from "./tipos.ts";
import { fimPrevisto, numero, valorNovo } from "./regras.ts";

type Lei = "14133" | "8666";
const falta = (t: string) => `⟦${t}⟧`;
/** float(str(x).replace("R$","").replace(".","").replace(",",".")) do kit; número fica como está */
const num = (v: unknown): number => (typeof v === "number" ? v : Number(String(v).replace("R$", "").replace(/\./g, "").replace(",", ".").trim()));
const vazio = (v: unknown) => v == null || v === "";
const r2 = (v: number) => Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
export const brlP = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── por extenso ─────────────────────────────────────────────────────────────
const U = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const D = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const C = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  const partes = c ? [C[c]] : [];
  if (r) partes.push(r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ` e ${U[r % 10]}` : ""));
  return partes.join(" e ");
}
export function inteiroExtenso(n: number): string {
  if (n === 0) return "zero";
  const grupos: number[] = [];
  for (let x = n; x; x = Math.floor(x / 1000)) grupos.push(x % 1000);
  const nomes = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];
  const partes: [number, string][] = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    let txt = i === 1 && g === 1 ? "mil" : ate999(g);
    if (i && !(i === 1 && g === 1)) txt += " " + (g === 1 ? nomes[i][0] : nomes[i][1]);
    partes.push([g, txt]);
  }
  let out = "";
  partes.forEach(([g, txt], k) => {
    if (k === 0) { out = txt; return; }
    const ult = k === partes.length - 1;
    out += (ult && (g < 100 || g % 100 === 0) ? " e " : ", ") + txt;
  });
  return out;
}
export function reaisExtenso(v: number): string {
  const x = Math.round((v + 1e-9) * 100) / 100;
  const r = Math.trunc(x);
  const c = Math.round((x - r) * 100);
  const partes: string[] = [];
  if (r) partes.push(inteiroExtenso(r) + (r >= 1_000_000 && r % 1_000_000 === 0 ? " de" : "") + (r === 1 ? " real" : " reais"));
  if (c) partes.push(inteiroExtenso(c) + (c === 1 ? " centavo" : " centavos"));
  return partes.length ? partes.join(" e ") : "zero real";
}
export const brlExt = (v: number) => `${brlP(v)} (${reaisExtenso(v)})`;
const mesesExt = (m: number) => `${m} (${inteiroExtenso(m)}) ${m === 1 ? "mês" : "meses"}`;
function pctTxt(p: unknown, casas = 2): string | null {
  if (p == null) return null;
  if (typeof p === "string") { const s = p.trim(); if (!s) return null; return s.endsWith("%") ? s : `${s}%`; }
  return `${Number(p).toFixed(casas).replace(".", ",")}%`;
}

// ── leis e artigos ───────────────────────────────────────────────────────────
const LEIS: Record<Lei, string> = { "14133": "da Lei nº 14.133/2021", "8666": "da Lei nº 8.666/1993" };
const ART: Record<Lei, Record<string, string>> = {
  "14133": { prorrogacao: "art. 107", prorrogacao_escopo: "art. 111", prorrogacao_com_alteracao: "art. 106, art. 107", reajuste: "art. 92, § 4º",
    acrescimo: "art. 124, inciso I, alínea \"b\", e art. 125", supressao: "art. 124, inciso I, alínea \"b\", e art. 125",
    supressao_acordo: "art. 124, inciso II, alínea \"a\" (acordo entre as partes)", limite: "art. 125" },
  "8666": { prorrogacao: "art. 57, inciso II", prorrogacao_escopo: "art. 57, § 1º", prorrogacao_com_alteracao: "art. 57, inciso II",
    reajuste: "art. 40, inciso XI, e art. 55, inciso III", acrescimo: "art. 65, inciso I, alínea \"b\", e § 1º", supressao: "art. 65, inciso I, alínea \"b\", e § 1º",
    supressao_acordo: "art. 65, § 2º, inciso II (acordo entre as partes)", limite: "art. 65, § 1º" },
};
const LIMITE_ANUENCIA = 25;
export function leiDoParecer(d: Pick<DadosAditivo, "lei" | "pareceres_referenciais">): Lei {
  const l = String(d.lei ?? "").replace(/\D/g, "");
  if (l.startsWith("14133")) return "14133";
  if (l.startsWith("8666")) return "8666";
  for (const p of d.pareceres_referenciais ?? []) {
    const lp = String((p as { lei?: string }).lei ?? "").replace(/\D/g, "");
    if (lp === "14133" || lp === "8666") return lp;
  }
  return "14133";
}
const pctDe = (x: { percentual?: unknown } | null | undefined) => (x && !vazio(x.percentual) ? num(x.percentual) : null);
const escopo = (d: DadosAditivo) => d.parecer_tecnico?.natureza === "escopo";

export function enquadramento(d: DadosAditivo, lei: Lei): string {
  const ad = d.aditivo ?? {}, A = ART[lei];
  const frags: string[] = [];
  const altValor = !!(ad.acrescimo || ad.supressao);
  if (ad.prorrogacao) frags.push(escopo(d) ? A.prorrogacao_escopo : altValor ? A.prorrogacao_com_alteracao : A.prorrogacao);
  if (ad.reajuste) frags.push(A.reajuste);
  for (const k of ["acrescimo", "supressao"] as const) {
    if (!ad[k]) continue;
    const pct = pctDe(ad[k]);
    frags.push(k === "supressao" && pct != null && pct > LIMITE_ANUENCIA ? A.supressao_acordo : A[k]);
  }
  const unicos = frags.filter((f, i) => frags.indexOf(f) === i);
  if (!unicos.length) return "";
  if (unicos.length === 1) return `${unicos[0]}, ${LEIS[lei]}`;
  return `${unicos.slice(0, -1).join("; ")}; e ${unicos[unicos.length - 1]}, todos ${LEIS[lei]}`;
}
function artDe(chave: "prorrogacao" | "reajuste" | "acrescimo" | "supressao", d: DadosAditivo, lei: Lei): string {
  const A = ART[lei];
  let f: string;
  if (chave === "prorrogacao") f = escopo(d) ? A.prorrogacao_escopo : A.prorrogacao;
  else if (chave === "supressao") f = (pctDe(d.aditivo?.supressao) ?? 0) > LIMITE_ANUENCIA ? A.supressao_acordo : A.supressao;
  else f = A[chave];
  return `${f}, ${LEIS[lei]}`;
}
export function periodoParecer(d: DadosAditivo): { ini: string | null; fim: string | null } {
  const pr = d.aditivo?.prorrogacao;
  const ini = pr?.inicio ?? null;
  let fim = pr?.fim ?? null;
  if (ini && !fim && pr?.meses) fim = fimPrevisto(ini, Number(pr.meses));
  return { ini, fim };
}

/** Item 5: valor que o contrato passou a ter depois de cada documento (variacao soma ao anterior) */
export function historicoLinhas(d: DadosAditivo): [string, number | null][] {
  const linhas: [string, number | null][] = [];
  let anterior: number | null = null;
  for (const h of d.historico ?? []) {
    const rot = String(h.documento ?? "").trim().toUpperCase();
    let v: number | null = vazio(h.valor) ? null : num(h.valor);
    if (v == null && !vazio(h.variacao) && anterior != null) v = anterior + num(h.variacao);
    if (v == null) { linhas.push([rot, null]); anterior = null; }
    else { v = r2(v); linhas.push([rot, v]); anterior = v; }
  }
  return linhas;
}

export function tiposAlteracao(d: DadosAditivo, ini: string | null, fim: string | null): string[] {
  const ad = d.aditivo ?? {}, pt = d.parecer_tecnico ?? {};
  const base = ({ anual: "anual", mensal: "mensal", total: "total" } as Record<string, string>)[String(pt.base ?? "anual")] ?? "anual";
  const linhas: string[] = [];
  const pr = ad.prorrogacao;
  if (pr) {
    const m = Number(pr.meses) || 0;
    linhas.push(`Prorrogação contratual por mais ${m ? mesesExt(m) : falta("__ meses")}, de ${ini || falta("__/__/____")} a ${fim || falta("__/__/____")}, `
      + (pr.modalidade === "sem_valor" ? "sem renovação do valor contratual (prorrogação em sentido estrito, apenas da vigência)" : "com renovação do valor contratual"));
  }
  const rj = ad.reajuste;
  if (rj) linhas.push(`Reajuste de ${pctTxt(rj.percentual, 6) || falta("XX,XXXXXX%")}, conforme índice ${rj.indice || falta("XXXX")}, sobre o valor ${base} do contrato`);
  for (const [k, nome] of [["acrescimo", "Acréscimo"], ["supressao", "Supressão"]] as const) {
    const x = ad[k];
    if (!x) continue;
    const p = pctTxt(pctDe(x));
    let l = `${nome} de ${p || falta("XX,XX%")} sobre o valor inicial atualizado do contrato, no valor de ${!vazio(x.valor) ? brlExt(num(x.valor)) : falta("R$ ___")}`;
    if (x.descricao) l += `, referente a ${x.descricao.trim().replace(/\.+$/, "")}`;
    linhas.push(l);
  }
  return linhas;
}

/** Item 9: um parágrafo por alteração (o fiscal edita, apaga ou acrescenta) */
export function motivosSugeridos(d: DadosAditivo, lei: Lei, ini: string | null, fim: string | null, atual: number | null, novo: number | null): string[] {
  const ad = d.aditivo ?? {}, pt = d.parecer_tecnico ?? {};
  const cv = pt.clausula_vigencia, cr = pt.clausula_reajuste;
  const out: string[] = [];
  const pr = ad.prorrogacao;
  if (pr) {
    const m = Number(pr.meses) || 0;
    const abre = escopo(d)
      ? "A celebração do presente Termo Aditivo justifica-se pela necessidade de conclusão do objeto contratado, cuja execução ainda não foi finalizada, não sendo conveniente a sua interrupção. "
      : "A celebração do presente Termo Aditivo justifica-se pela necessidade de continuidade dos serviços contratados, os quais se mostram essenciais ao atendimento das demandas da Contratante, não sendo conveniente a interrupção de sua execução. ";
    out.push(`${abre}O referido Termo Aditivo decorre da prorrogação do prazo de vigência da contratação por mais ${m ? mesesExt(m) : falta("__ meses")}, contemplando-se, nesta ocasião, o período de ${ini || falta("__/__/____")} a ${fim || falta("__/__/____")}, na forma do ${artDe("prorrogacao", d, lei)}, conforme previsto na ${cv || falta("CLÁUSULA ___, item ___ (cláusula de vigência)")} do contrato${pr.modalidade === "sem_valor" ? ", sem renovação do valor contratual." : ", com renovação do valor contratual."}`);
  }
  const rj = ad.reajuste;
  if (rj) {
    const pct = pctTxt(rj.percentual, 6);
    const valorRj = vazio(rj.valor) ? null : num(rj.valor);
    const corrigido = atual != null && valorRj != null ? r2(atual + valorRj) : null;
    const abre = pr ? "O presente Termo Aditivo contempla, ainda, a necessidade de reajuste pelo índice " : "A celebração do presente Termo Aditivo decorre da necessidade de reajuste pelo índice ";
    out.push(`${abre}${rj.indice || falta("XXXX")}, conforme estabelece a ${cr || falta("CLÁUSULA ___, item ___ (cláusula de reajuste)")} do ajuste contratual. O reajuste corresponde ao percentual de ${pct || falta("XX,XXXXXX%")} sobre o valor nominal de ${atual != null ? brlExt(atual) : falta("R$ ___")}, resultando no valor corrigido de ${corrigido != null ? brlExt(corrigido) : falta("R$ ___")}, fonte de pesquisa: Calculadora do Cidadão (Banco Central do Brasil).`);
  }
  for (const [k, nome, verbo] of [["acrescimo", "O acréscimo", "justifica-se pela necessidade de"], ["supressao", "A supressão", "decorre de"]] as const) {
    const x = ad[k];
    if (!x) continue;
    const pctn = pctDe(x);
    let p = `${nome} de ${pctn != null ? pctTxt(pctn) : falta("XX,XX%")} sobre o valor inicial atualizado do contrato, no montante de ${!vazio(x.valor) ? brlExt(num(x.valor)) : falta("R$ ___")}, ${verbo} `;
    p += x.descricao ? x.descricao.trim().replace(/\.+$/, "") : falta("[descrever a necessidade]");
    p += k === "supressao" && pctn != null && pctn > LIMITE_ANUENCIA
      ? `, mediante acordo entre as partes, nos termos do ${artDe("supressao", d, lei)}.`
      : `, observado o limite de 25% (vinte e cinco por cento) previsto no ${ART[lei].limite}, ${LEIS[lei]}.`;
    out.push(p);
  }
  if (out.length && atual != null && novo != null && r2(novo - atual) !== 0)
    out[out.length - 1] += ` Com as alterações deste Termo Aditivo, o valor do contrato passa de ${brlExt(atual)} para ${brlExt(novo)}.`;
  return out;
}

/** Item 11: texto fixo + "manifesta-se favoravelmente" a todas as alterações numa frase */
export function parecerFiscal(d: DadosAditivo, lei: Lei, ini: string | null, fim: string | null, atual: number | null, novo: number | null): string {
  const ad = d.aditivo ?? {};
  const partes: string[] = [];
  const pr = ad.prorrogacao;
  if (pr) partes.push(`à prorrogação da vigência do contrato, cuja nova vigência passará a ser do dia ${ini || falta("__/__/____")} até o dia ${fim || falta("__/__/____")}`
    + (pr.modalidade === "sem_valor" ? ", em sentido estrito, sem renovação do valor contratual" : ", com renovação do valor contratual") + `, nos termos do ${artDe("prorrogacao", d, lei)}`);
  const rj = ad.reajuste;
  if (rj) partes.push(`ao reajuste de ${pctTxt(rj.percentual, 6) || falta("XX,XXXXXX%")}, conforme índice ${rj.indice || falta("XXXX")}`
    + (vazio(rj.valor) ? "" : `, no valor de ${brlExt(num(rj.valor))}`) + `, nos termos do ${artDe("reajuste", d, lei)}`);
  for (const [k, t] of [["acrescimo", "ao acréscimo"], ["supressao", "à supressão"]] as const) {
    const x = ad[k];
    if (!x) continue;
    const pctn = pctDe(x);
    partes.push(`${t} de ${pctn != null ? pctTxt(pctn) : falta("XX,XX%")} sobre o valor inicial atualizado do contrato, no valor de ${!vazio(x.valor) ? brlExt(num(x.valor)) : falta("R$ ___")}, nos termos do ${artDe(k, d, lei)}`);
  }
  let frase = "A fiscalização do contrato atesta que a contratada vem cumprindo regularmente suas obrigações contratuais, exercendo suas atividades de forma satisfatória e prestando os serviços a contento da Administração. Diante disso, considerando o interesse da Administração na continuidade da prestação dos serviços, bem como a vantajosidade da manutenção da contratação, esta Fiscalização manifesta-se favoravelmente ";
  partes.forEach((p, i) => { if (i) frase += i === partes.length - 1 ? "; e " : "; "; frase += p; });
  if (atual != null && novo != null && r2(novo - atual) !== 0) frase += `, resultando no valor total do contrato de ${brlExt(novo)}`;
  return `${frase}.`;
}

/** Item 10: valor após = proporcional ao valor novo (o que o fiscal digitou fica); centavos no item de maior valor */
export function itensTabela(itens0: ItemParecer[] | undefined, atual: number | null, novo: number | null): ItemParecer[] {
  const itens = (itens0 ?? []).map((i) => ({ ...i, valor_atual: vazio(i.valor_atual) ? null : r2(num(i.valor_atual)), valor_apos: vazio(i.valor_apos) ? null : r2(num(i.valor_apos)) }));
  const somaAtual = r2(itens.reduce((s, i) => s + (i.valor_atual ?? 0), 0));
  const faltam = itens.filter((i) => i.valor_apos == null);
  if (faltam.length && novo != null && somaAtual) {
    const fator = novo / somaAtual;
    for (const i of faltam) i.valor_apos = r2((i.valor_atual ?? 0) * fator);
    const dif = r2(novo - itens.reduce((s, i) => s + (i.valor_apos ?? 0), 0));
    if (dif) {
      let maior = faltam[0];
      for (const i of faltam) if ((i.valor_apos ?? 0) > (maior.valor_apos ?? 0)) maior = i;
      maior.valor_apos = r2((maior.valor_apos ?? 0) + dif);
    }
  }
  return itens;
}

export interface PreviaParecer {
  lei: Lei; inicio: string | null; fim: string | null; valor_atual: number | null; valor_novo: number | null;
  historico: [string, number | null][]; enquadramento: string; tipos: string[]; motivos: string[]; sugestoes: string[];
  parecer_fiscal: string; itens: ItemParecer[]; valor_novo_extenso: string | null;
}
export function previaParecer(d: DadosAditivo): PreviaParecer {
  const atual = numero(d.valor_atual);
  const novo = valorNovo(d);
  const lei = leiDoParecer(d);
  const { ini, fim } = periodoParecer(d);
  const pt = d.parecer_tecnico ?? {};
  const sugestoes = motivosSugeridos(d, lei, ini, fim, atual == null ? null : r2(atual), novo);
  const motivos = pt.motivos?.length ? pt.motivos.map((m) => String(m ?? "").trim()).filter(Boolean) : sugestoes;
  return {
    lei, inicio: ini, fim, valor_atual: atual == null ? null : r2(atual), valor_novo: novo, historico: historicoLinhas(d),
    enquadramento: enquadramento(d, lei), tipos: tiposAlteracao(d, ini, fim), motivos, sugestoes,
    parecer_fiscal: parecerFiscal(d, lei, ini, fim, atual == null ? null : r2(atual), novo),
    itens: escopo(d) ? [] : itensTabela(d.itens, atual == null ? null : r2(atual), novo), valor_novo_extenso: novo == null ? null : brlExt(novo),
  };
}

/** Alertas do Parecer Técnico (seção 5 da 3J): todos só avisam — o documento sai com o trecho em amarelo */
export function alertasParecer(d: DadosAditivo, prints: number): Alerta[] {
  const a: Alerta[] = [];
  const add = (texto: string) => a.push({ nivel: "atencao", texto: `Parecer Técnico: ${texto}`, secao: "parecer" });
  const pt = d.parecer_tecnico ?? {};
  const ad = d.aditivo ?? {};
  const p = previaParecer(d);
  if (!String(pt.numero ?? "").trim()) add("informe o nº do parecer (controle da OM ou do fiscal).");
  if (!(d.historico ?? []).length) add("histórico de valores (item 5) vazio — traga do cadastro dos Reajustes.");
  const semValor = p.historico.filter(([, v]) => v == null).map(([r]) => r.toLowerCase());
  if (semValor.length) add(`falta o valor do contrato depois de: ${semValor.join(", ")} (item 5).`);
  if (ad.prorrogacao && !String(pt.clausula_vigencia ?? "").trim()) add("informe a cláusula de vigência do contrato (item 9).");
  if (ad.reajuste) {
    if (!String(pt.clausula_reajuste ?? "").trim()) add("informe a cláusula de reajuste do contrato (item 9).");
    if (!String(ad.reajuste.percentual ?? "").trim()) add("reajuste sem o percentual (todas as casas da Calculadora do Cidadão).");
    if (!prints) add("faltam os prints da Calculadora do Cidadão (faça no módulo Reajustes, instrumento Termo Aditivo).");
  }
  if (p.motivos.some((m) => /⟦|___/.test(m))) add("há motivo (item 9) com dado a preencher.");
  if (pt.natureza === "escopo") {
    if (!(pt.cronograma_escopo ?? []).length) add("contrato por escopo sem as etapas do cronograma (item 10).");
  } else if (!p.itens.length) add("sem os itens do contrato (item 10) — traga do cadastro dos Reajustes.");
  else {
    const soma = (k: "valor_atual" | "valor_apos") => r2(p.itens.reduce((s, i) => s + (Number(i[k]) || 0), 0));
    if (p.valor_atual != null && Math.abs(soma("valor_atual") - p.valor_atual) > 0.009) add(`a soma dos valores atuais dos itens (${brlP(soma("valor_atual"))}) difere do valor atual do contrato (${brlP(p.valor_atual)}).`);
    if (p.valor_novo != null && Math.abs(soma("valor_apos") - p.valor_novo) > 0.009) add(`a soma dos itens após o aditivo (${brlP(soma("valor_apos"))}) difere do valor do termo (${brlP(p.valor_novo)}).`);
  }
  return a;
}

/** "a CLÁUSULA SÉTIMA, item 7.2, do Contrato" (cadastro dos Reajustes) → "CLÁUSULA SÉTIMA, item 7.2"; texto genérico → vazio */
export function clausulaParaParecer(c: string | null | undefined): string | null {
  const t = String(c ?? "").trim();
  if (!/CL[ÁA]USULA\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{4,}/.test(t)) return null;
  return t.replace(/^(a|à)\s+/i, "").replace(/,?\s+d[oa]\s+(Contrato|Termo de Refer[êe]ncia)\s*$/i, "").trim() || null;
}
