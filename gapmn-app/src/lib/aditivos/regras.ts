// Regras dos Termos Aditivos na tela (as mesmas do kit da SCON, para mostrar na hora o que o kit vai fazer):
// pareceres.py (cobertura por parecer referencial), gerar_lista_verificacao.py (itens da Lista), gerar_ficha_autorizacao.py
// (objeto e valores) e gerar_pesquisa_precos.py (estatística). O teste aditivos.test.ts confere com a resposta do kit.
import {
  type Alerta, type Alteracao, type DadosAditivo, type EstadoAditivo, type ItemPesquisa, type Lei, type NaturezaObjeto,
  type ParecerReferencial, ALTERACOES,
} from "./tipos.ts";
import { BIBLIOTECA_PARECERES } from "./bibliotecaPareceres.ts";

export const NOMES: Record<Alteracao, string> = { prorrogacao: "prorrogação de vigência", reajuste: "reajuste", acrescimo: "acréscimo", supressao: "supressão" };
const COM_ARTIGO: Record<Alteracao, string> = { prorrogacao: "a prorrogação de vigência", reajuste: "o reajuste", acrescimo: "o acréscimo", supressao: "a supressão" };
export const LIMITE_LEI = 25; // art. 125 da Lei 14.133/2021 (50% só para reforma de edifício/equipamento)
export const UM_MILHAO = 1_000_000;

/** Número de "4,724910%", "R$ 1.050.000,00", 25 ou 10.5 (o _num do kit) */
export function numero(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace("%", "").replace("R$", "").replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}
const dataBr = (s: string | null | undefined): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
export const isoParaBr = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : "");
export const brParaIso = (br: string | null | undefined) => dataBr(br) ?? "";
export function listaJuntada(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}
const pct2 = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;
export const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** dados.json no formato antigo do kit (sem o bloco "aditivo"; "reajuste" e "parecer_referencial" soltos) → atual */
export function normalizarFormatoAntigo(bruto: Record<string, unknown>): Record<string, unknown> {
  if (bruto.aditivo) return bruto;
  const d: Record<string, unknown> = { ...bruto };
  d.aditivo = { prorrogacao: { modalidade: "com_valor", meses: null, inicio: null }, reajuste: bruto.reajuste ? { indice: null, percentual: null, valor: null } : null, acrescimo: null, supressao: null };
  if (!d.pareceres_referenciais && bruto.parecer_referencial) d.pareceres_referenciais = [{ cobre: ["prorrogacao", "reajuste"], ...(bruto.parecer_referencial as object) }];
  return d;
}

// ── Alterações e valores (seção 1.3) ────────────────────────────────────────
export function alteracoes(d: Pick<DadosAditivo, "aditivo">): Alteracao[] {
  return ALTERACOES.filter((k) => !!d.aditivo?.[k]);
}
export const temReajuste = (d: Pick<DadosAditivo, "aditivo">) => !!d.aditivo?.reajuste;
/** Prorrogação de vigência marcada (formato antigo, sem bloco "aditivo", é sempre prorrogação) */
export const temProrrogacao = (d: Pick<DadosAditivo, "aditivo">) => (d.aditivo == null ? true : !!d.aditivo.prorrogacao);

export const LIMITE_ANUENCIA = 25; // acima disso a contratada não é obrigada a aceitar (art. 125 da Lei 14.133 / art. 65 § 1º da 8.666)
/** float(str(x).replace(",", ".")) do kit: número ou null */
function pctKit(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const s = String(v).replace(",", ".").trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  return Number(s);
}
/** O que exige a anuência da contratada (motivos_anuencia do kit): prorrogação, acréscimo > 25% ou supressão > 25%.
 *  Percentual não informado num acréscimo/supressão → entra por segurança (e a tela avisa). */
export function motivosAnuencia(d: Pick<DadosAditivo, "aditivo">): string[] {
  const ad = d.aditivo;
  if (ad == null) return ["a prorrogação contratual"];
  const m: string[] = [];
  if (ad.prorrogacao) m.push("a prorrogação contratual");
  for (const [k, nome, art] of [["acrescimo", "acréscimo", "o"], ["supressao", "supressão", "a"]] as const) {
    if (!ad[k]) continue;
    const pct = pctKit(ad[k]!.percentual);
    if (pct == null) m.push(`${art} ${nome} (percentual não informado – conferir)`);
    else if (pct > LIMITE_ANUENCIA) m.push(`${art} ${nome} de ${pct.toFixed(2).replace(".", ",")}% do valor inicial atualizado do contrato`);
  }
  return m;
}

/** Valor que o contrato passará a ter: valor atual + reajuste + acréscimo − supressão (ou o informado) */
export function valorNovo(d: Pick<DadosAditivo, "aditivo" | "valor_atual" | "valor_novo">): number | null {
  const atual = numero(d.valor_atual);
  if (atual == null) return null;
  const informado = numero(d.valor_novo);
  if (informado != null) return Math.round(informado * 100) / 100;
  let novo = atual;
  const ad = d.aditivo ?? {};
  if (ad.reajuste && numero(ad.reajuste.valor) != null) novo += numero(ad.reajuste.valor)!;
  if (ad.acrescimo && numero(ad.acrescimo.valor) != null) novo += numero(ad.acrescimo.valor)!;
  if (ad.supressao && numero(ad.supressao.valor) != null) novo -= numero(ad.supressao.valor)!;
  return Math.round(novo * 100) / 100;
}
export function passa1Milhao(d: Pick<DadosAditivo, "aditivo" | "valor_atual" | "valor_novo">): boolean {
  const n = valorNovo(d);
  return n != null && n > UM_MILHAO;
}

/** Fim do novo período: início + meses − 1 dia (dd/mm/aaaa) */
export function fimPrevisto(inicio: string | null | undefined, meses: number | null | undefined): string | null {
  const iso = dataBr(inicio);
  if (!iso || !meses) return null;
  const [a, m, d] = iso.split("-").map(Number);
  const alvoMes = m - 1 + meses;
  const ano = a + Math.floor(alvoMes / 12), mes = (alvoMes % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const fim = new Date(Date.UTC(ano, mes - 1, Math.min(d, ultimo)) - 86400000);
  return fim.toISOString().slice(0, 10).split("-").reverse().join("/");
}

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta"];
export function extenso(n: number): string {
  if (n < 20) return UNIDADES[n];
  const d = Math.floor(n / 10), u = n % 10;
  return DEZENAS[d] + (u ? ` e ${UNIDADES[u]}` : "");
}

/** Campo 8 da Ficha (objeto e finalidade): uma linha por opção marcada */
export function objetoDaFicha(d: Pick<DadosAditivo, "aditivo" | "contrato">): string {
  const ad = d.aditivo ?? {}, ct = d.contrato;
  const linhas: string[] = [];
  if (ad.prorrogacao) {
    const meses = Number(ad.prorrogacao.meses) || 0;
    const prazo = meses ? `${meses} (${extenso(meses)}) meses` : "__ meses";
    const exc = ad.prorrogacao.excepcional ? "excepcionalmente " : "";
    linhas.push(ad.prorrogacao.modalidade === "sem_valor"
      ? `Prorrogar ${exc}a vigência do Contrato nº ${ct} por mais ${prazo}, em sentido estrito, sem renovação do valor contratual`
      : `Prorrogar ${exc}o Contrato nº ${ct} por mais ${prazo}, com renovação do valor contratual`);
  }
  if (ad.reajuste) linhas.push(`Reajustar o Contrato nº ${ct}, conforme índice ${ad.reajuste.indice || "_____"}${ad.reajuste.percentual ? ` (${ad.reajuste.percentual})` : ""}`);
  for (const [chave, verbo] of [["acrescimo", "Acrescer"], ["supressao", "Suprimir"]] as const) {
    const x = ad[chave];
    if (!x) continue;
    const partes: string[] = [];
    if (x.valor != null) partes.push(brl(numero(x.valor)!));
    if (x.percentual != null) partes.push(pct2(numero(x.percentual)!));
    linhas.push(`${verbo} o valor do Contrato nº ${ct}${partes.length ? ` em ${partes.join(" – ")}` : ""}${x.descricao ? `, referente a ${x.descricao}` : ""}`);
  }
  const R = ["I", "II", "III", "IV", "V", "VI"];
  return linhas.map((t, i) => `${R[i]} - ${t}${i < linhas.length - 1 ? ";" : "."}`).join("\n");
}

// ── Pareceres referenciais (seção 2.4; pareceres.py) ─────────────────────────
/** 'PARECER REFERENCIAL n. 00004/2024/CGSEM/SCGP/...' → '4|2024|CGSEM' (a chave() do kit) */
export function chaveParecer(numero: string | null | undefined): string | null {
  const m = /(\d+)\s*\/\s*(\d{4})\s*\/\s*([A-Z]+)/.exec(String(numero ?? "").toUpperCase().replace(/ /g, ""));
  return m ? `${Number(m[1])}|${m[2]}|${m[3]}` : null;
}
export type ParecerBiblioteca = (typeof BIBLIOTECA_PARECERES)[number];
export function daBiblioteca(numero: string | null | undefined): ParecerBiblioteca | null {
  const k = chaveParecer(numero);
  return (k && BIBLIOTECA_PARECERES.find((b) => chaveParecer(b.numero) === k)) || null;
}
/** Tira do texto da página AGU as anotações que não são objeto (limpar_objeto do kit) */
export function limparObjeto(t: string | null | undefined): string {
  let s = String(t ?? "").trim();
  s = s.replace(/\s*(PARECER\s+n\.?[\s\S]{0,80}substitu[ií]do[\s\S]*|Renovado pelo PARECER[\s\S]*|Vig[eê]ncia renovada pelo[\s\S]*|Obs\.?:[\s\S]*|-?\s*NUP\s*:[\s\S]*)$/iu, "").trim();
  s = s.replace(/servi[cç]os cont[ií]nua(?![\p{L}\p{N}_])/giu, "serviços continuados");
  s = s.replace(/\s+/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
const vazioKit = (v: unknown) => v == null || v === "" || (Array.isArray(v) && !v.length);
/** Pareceres do aditivo como o kit os usa: completa pela biblioteca e troca o objeto pelo de lá (salvo objeto_fixo) */
export function pareceresDoAditivo(lista: ParecerReferencial[]): ParecerReferencial[] {
  const saida: ParecerReferencial[] = [];
  for (const p0 of lista) {
    if (!p0 || !String(p0.numero ?? "").trim()) continue;
    const p: ParecerReferencial = { ...p0 };
    const b = daBiblioteca(p.numero);
    if (b) {
      const q = p as unknown as Record<string, unknown>;
      for (const k of ["cobre", "limite_percentual", "validade", "data", "orgao_consultivo", "pdf"] as const) {
        if (vazioKit(q[k])) q[k] = Array.isArray(b[k]) ? [...(b[k] as readonly string[])] : b[k];
      }
      if (!p.objeto_fixo) { p.objeto = b.objeto; p.fonte_objeto = b.fonte_objeto; }
    }
    p.objeto = limparObjeto(p.objeto);
    saida.push(p);
  }
  return saida;
}
// Parecer fora da biblioteca (seção 2.4.1, item 2): o objeto sai da EMENTA do próprio PDF, sem a parte padrão
// (manifestação jurídica referencial, ON AGU nº 55, portaria, validade), mais a frase do parecer sobre a alteração.
const PALAVRAS_ALTERACAO: Record<Alteracao, RegExp> = {
  prorrogacao: /prorroga[çc][ãa]o|vig[êe]ncia/i, reajuste: /reajuste/i, acrescimo: /acr[ée]scimo|supress[ãa]o|25\s?%/i, supressao: /acr[ée]scimo|supress[ãa]o|25\s?%/i,
};
const PADRAO_EMENTA = /manifesta[çc][ãa]o jur[ií]dica referencial|^mjr$|orienta[çc][ãa]o normativa|portaria normativa|^direito administrativo$|^licita[çc][õo]es e contratos$|validade|advocacia-geral da uni[ãa]o/i;
function caixaDeFrase(s: string): string {
  if (!ehMaiuscula(s)) return s;
  const t = s.toLowerCase().replace(/\binciso ([ivxl]+)\b/g, (_, r: string) => `inciso ${r.toUpperCase()}`).replace(/\blei\b/g, "Lei");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const frases = (t: string) => t.split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9])/).map((x) => x.trim()).filter(Boolean);
export function ementaDoParecer(texto: string, cobre: Alteracao[]): string | null {
  const t = String(texto ?? "").replace(/\s+/g, " ");
  const i = t.search(/EMENTA\s*:?/i);
  if (i < 0) return null;
  const resto = t.slice(i).replace(/^EMENTA\s*:?\s*/i, "");
  const fimEmenta = resto.search(/\s(?:I\s*[.–-]\s*)?(?:RELAT[ÓO]RIO|INTRODU[ÇC][ÃA]O)\b|\s1\.\s/i);
  const cabeca = (fimEmenta > 0 ? resto.slice(0, fimEmenta) : resto.slice(0, 600)).trim();
  const partes = cabeca.split(/\.\s+(?=\S)|\.$/).map((x) => x.trim()).filter((x) => x && !PADRAO_EMENTA.test(x));
  let objeto = partes.map((x) => caixaDeFrase(x.replace(/\s*-\s*MJR\b/i, ""))).join(". ").trim();
  if (objeto && !/[.;]$/.test(objeto)) objeto += ".";
  const corpo = fimEmenta > 0 ? resto.slice(fimEmenta) : "";
  const extras: string[] = [];
  for (const alt of cobre) {
    const rx = PALAVRAS_ALTERACAO[alt];
    // só quando a ementa não fala da alteração; nunca um trecho de inaplicabilidade (diria o contrário)
    if (!rx || rx.test(objeto) || extras.some((x) => rx.test(x))) continue;
    const f = frases(corpo).find((x) => rx.test(x) && x.length >= 40 && x.length <= 420 && !PADRAO_EMENTA.test(x)
      && !/inaplicab|n[ãa]o se aplica|n[ãa]o alcan[çc]a|hip[óo]teses|vedad|exceto|salvo/i.test(x));
    if (f) extras.push(f.replace(/^\d+\.\s*/, ""));
  }
  const final = [objeto, ...extras].filter(Boolean).join(" ").trim();
  return final ? limparObjeto(final) : null;
}

/** 'PARECER REFERENCIAL Nº. 00006/2025/CONSER/...' → 'nº 00006/2025/CONSER/...' */
export function numeroCurto(numero: string): string {
  let t = String(numero).replace(/^\s*PARECER\s+REFERENCIAL\s*/i, "").trim();
  t = t.replace(/^(n[º°o]?\.?|N[º°O]?\.?)\s*/, "").trim();
  return `nº ${t}`;
}
/** 'ao PARECER REFERENCIAL nº X' ou 'aos PARECERES REFERENCIAIS nº X e nº Y' (citar do kit) */
export function citarPareceres(ps: { numero: string }[]): string {
  const nums = ps.map((p) => numeroCurto(p.numero));
  return nums.length === 1 ? `ao PARECER REFERENCIAL ${nums[0]}` : `aos PARECERES REFERENCIAIS ${listaJuntada(nums)}`;
}

export const PRORROGACAO_EXCEPCIONAL = "prorrogação excepcional (art. 57, § 4º, da Lei nº 8.666/1993 – exige análise jurídica)";
export interface AnalisePareceres {
  alteracoes: Alteracao[];
  pareceres: (ParecerReferencial & { fundamenta: Alteracao[]; motivo_texto: string })[];
  vencidos: ParecerReferencial[];
  descobertas: string[];
  vai_para_cju: boolean;
}
export function analisarPareceres(d: Pick<DadosAditivo, "aditivo" | "pareceres_referenciais">, hoje: string): AnalisePareceres {
  const alts = alteracoes(d);
  const ad = d.aditivo ?? {};
  // o campo antigo "parecer_referencial" (um só) ainda vale para prorrogação e reajuste, como no kit
  const antigo = (d as { parecer_referencial?: ParecerReferencial }).parecer_referencial;
  const lista = d.pareceres_referenciais ?? (antigo ? [{ ...antigo, cobre: antigo.cobre ?? (["prorrogacao", "reajuste"] as Alteracao[]) }] : []);
  const todos = pareceresDoAditivo(lista);
  const vigentes: ParecerReferencial[] = [], vencidos: ParecerReferencial[] = [];
  for (const p of todos) { const v = dataBr(p.validade); (v && v < hoje ? vencidos : vigentes).push(p); }
  const cobertura: Partial<Record<Alteracao, string>> = {};
  const descobertas: string[] = [];
  for (const alt of alts) {
    const pct = alt === "acrescimo" || alt === "supressao" ? numero((ad[alt] as { percentual?: unknown } | null)?.percentual) : null;
    // prorrogação EXCEPCIONAL (art. 57, § 4º, da Lei 8.666; revisão 7): nenhum parecer referencial cobre → CJU
    if (alt === "prorrogacao" && ad.prorrogacao?.excepcional) { descobertas.push(PRORROGACAO_EXCEPCIONAL); continue; }
    let ok: ParecerReferencial | null = null;
    for (const p of vigentes.filter((x) => (x.cobre ?? []).includes(alt))) {
      let lim = numero(p.limite_percentual);
      if (lim == null && (alt === "acrescimo" || alt === "supressao")) lim = LIMITE_LEI;
      if (pct != null && lim != null && pct > lim) continue;
      ok = p; break;
    }
    if (ok) { cobertura[alt] = ok.numero; continue; }
    let motivo = NOMES[alt];
    const venc = vencidos.find((p) => (p.cobre ?? []).includes(alt));
    if (pct != null && pct > LIMITE_LEI) motivo += ` (${pct2(pct)}, acima do limite de ${LIMITE_LEI}%)`;
    else if (venc) motivo += ` (o ${venc.numero.trim()} teve validade até ${venc.validade})`;
    descobertas.push(motivo);
  }
  const usados: AnalisePareceres["pareceres"] = [];
  for (const p of vigentes) {
    const cobre = alts.filter((a) => cobertura[a] === p.numero);
    if (!cobre.length) continue;
    usados.push({ ...p, fundamenta: cobre, motivo_texto: p.motivo || `Fundamenta ${listaJuntada(cobre.map((a) => COM_ARTIGO[a]))} deste termo aditivo.` });
  }
  return { alteracoes: alts, pareceres: usados, vencidos, descobertas, vai_para_cju: descobertas.length > 0 || !alts.length };
}
export function fraseObservacaoParecer(an: AnalisePareceres): string | null {
  if (!an.descobertas.length) return null;
  if (!an.pareceres.length) {
    const base = "não há parecer referencial vigente para este aditivo";
    if (an.vencidos.length && an.descobertas.length === an.alteracoes.length && an.descobertas.every((x) => x.includes("validade até"))) {
      const p = an.vencidos[0];
      return `${base} (o ${p.numero.trim()} teve validade até ${p.validade})`;
    }
    return `${base} (${listaJuntada(an.descobertas)}); o termo aditivo deve ser submetido à análise jurídica`;
  }
  return `não há parecer referencial vigente que fundamente: ${listaJuntada(an.descobertas)}; o termo aditivo deve ser submetido à análise jurídica`;
}

// Catálogo da SCON (seção 2.4, lido na página AGU do site em 23/11/2026): a tela confere a validade e a ementa na
// tabela agu_referenciais (sync-agu) e a SCON pode trocar ou incluir pareceres no aditivo.
export interface ParecerCatalogo {
  numero: string; num: number; ano: number; sigla: string; situacao: string;
  naturezas: NaturezaObjeto[]; leis: Lei[]; cobre: Alteracao[]; limite?: number; validade: string;
}
export const CATALOGO_PARECERES: ParecerCatalogo[] = [
  { numero: "PARECER REFERENCIAL n. 00004/2024/CGSEM/SCGP/CGU/AGU", num: 4, ano: 2024, sigla: "CGSEM", situacao: "Prorrogação de serviço contínuo sem DEMO (Lei 14.133), com ou sem reajuste; renovado pelo Parecer 18/2026/CONSER", naturezas: ["servico_sem_demo"], leis: ["14133"], cobre: ["prorrogacao", "reajuste"], validade: "01/11/2028" },
  { numero: "PARECER REFERENCIAL n. 00001/2023/CGSEM/SCGP/CGU/AGU", num: 1, ano: 2023, sigla: "CGSEM", situacao: "Prorrogação de serviço contínuo sem DEMO (Lei 8.666), com ou sem reajuste", naturezas: ["servico_sem_demo"], leis: ["8666"], cobre: ["prorrogacao", "reajuste"], validade: "27/09/2027" },
  { numero: "PARECER REFERENCIAL n. 3/2024/CGCOM-BSB/SCGP/CGU/AGU", num: 3, ano: 2024, sigla: "CGCOM", situacao: "Prorrogação de serviço contínuo com DEMO (Lei 14.133); não se aplica a reequilíbrio", naturezas: ["servico_com_demo"], leis: ["14133"], cobre: ["prorrogacao"], validade: "12/11/2028" },
  { numero: "PARECER REFERENCIAL n. 2/2024/DICOMEX/SCGP/CGU/AGU", num: 2, ano: 2024, sigla: "DICOMEX", situacao: "Prorrogação de serviço contínuo com DEMO (Lei 8.666)", naturezas: ["servico_com_demo"], leis: ["8666"], cobre: ["prorrogacao"], validade: "29/10/2028" },
  { numero: "PARECER REFERENCIAL n. 00005/2025/DISEMEX/SCGP/CGU/AGU", num: 5, ano: 2025, sigla: "DISEMEX", situacao: "Prorrogação de contrato de TIC sem DEMO", naturezas: ["tic"], leis: ["14133"], cobre: ["prorrogacao"], validade: "21/05/2027" },
  { numero: "PARECER REFERENCIAL n. 00001/2024/CGSEM/SCGP/CGU/AGU", num: 1, ano: 2024, sigla: "CGSEM", situacao: "Prorrogação de TIC / aluguel de equipamentos (Lei 8.666)", naturezas: ["tic"], leis: ["8666"], cobre: ["prorrogacao"], validade: "30/01/2028" },
  { numero: "PARECER REFERENCIAL Nº. 00007/2026/CONAQ/SCGP/CGU/AGU", num: 7, ano: 2026, sigla: "CONAQ", situacao: "Prorrogação de contrato de aquisição de bens", naturezas: ["bens"], leis: ["14133"], cobre: ["prorrogacao"], validade: "21/05/2027" },
  { numero: "PARECER REFERENCIAL Nº. 00002/2026/CONSER/SCGP/CGU/AGU", num: 2, ano: 2026, sigla: "CONSER", situacao: "Prorrogação de locação de imóvel (Administração locatária)", naturezas: ["locacao_imovel"], leis: ["14133"], cobre: ["prorrogacao"], validade: "31/03/2028" },
  { numero: "PARECER REFERENCIAL Nº. 00006/2025/CONSER/SCGP/CGU/AGU", num: 6, ano: 2025, sigla: "CONSER", situacao: "Acréscimo/supressão unilateral de serviço contínuo sem DEMO (art. 124, I, b), até 25%", naturezas: ["servico_sem_demo"], leis: ["14133"], cobre: ["acrescimo", "supressao"], limite: 25, validade: "03/09/2027" },
  { numero: "PARECER REFERENCIAL n. 00002/2023/CGSEM/SCGP/CGU/AGU", num: 2, ano: 2023, sigla: "CGSEM", situacao: "Alteração unilateral de serviço contínuo sem DEMO (Lei 8.666), até 25%", naturezas: ["servico_sem_demo"], leis: ["8666"], cobre: ["acrescimo", "supressao"], limite: 25, validade: "03/11/2027" },
];
export interface AguParecer { id: number; parecer: string | null; numero: number | null; ano: number | null; assunto: string | null; data: string | null; validade: string | null; url: string | null }
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
/** O mesmo parecer na tabela da AGU (pelo nº, ano e sigla do órgão) */
export function acharNaAgu(p: Pick<ParecerCatalogo, "num" | "ano" | "sigla">, agu: AguParecer[]): AguParecer | null {
  const rx = new RegExp(`(^|\\D)0*${p.num}\\s*/\\s*${p.ano}\\s*/\\s*${p.sigla}`);
  return agu.find((a) => rx.test(semAcento(a.parecer ?? ""))) ?? null;
}
/** Pareceres do catálogo para as alterações marcadas, a natureza do objeto e a lei do contrato (validade e ementa da AGU, se achar) */
export function pareceresSugeridos(alts: Alteracao[], natureza: NaturezaObjeto, lei: Lei, agu: AguParecer[]): (ParecerReferencial & { conferido: boolean; url?: string | null })[] {
  const escolhidos: (ParecerReferencial & { conferido: boolean; url?: string | null })[] = [];
  for (const alt of alts) {
    if (escolhidos.some((p) => p.cobre.includes(alt))) continue;
    const c = CATALOGO_PARECERES.find((x) => x.cobre.includes(alt) && x.naturezas.includes(natureza) && x.leis.includes(lei));
    if (!c) continue;
    const a = acharNaAgu(c, agu);
    // objeto: o da biblioteca de pareceres da SCON (redigido do próprio parecer); fora dela, a ementa da AGU limpa
    const b = daBiblioteca(c.numero);
    escolhidos.push({
      numero: c.numero, objeto: b?.objeto || limparObjeto(a?.assunto) || c.situacao, data: isoParaBr(a?.data) || b?.data || null,
      validade: isoParaBr(a?.validade) || c.validade, cobre: c.cobre, ...(c.limite ? { limite_percentual: c.limite } : {}),
      conferido: !!a, url: a?.url ?? null,
    });
  }
  return escolhidos;
}

// ── Lista de Verificação (seção 2.3; itens_da_lista do kit) ──────────────────
export interface ItemLista { chave: string; texto: string; obrigatorioAnexar?: boolean }
/** INCC e IGP: FGV; os outros índices: Calculadora do Cidadão (item da Lista, revisão 7) */
export const fonteDoIndice = (indice: string) => (/^(INCC|IGP)/i.test(indice.trim()) ? "FGV" : "Calculadora do Cidadão (Banco Central do Brasil)");
export function itensDaLista(d: DadosAditivo, hoje: string): ItemLista[] {
  const L: ItemLista[] = [];
  const add = (chave: string, texto: string, cond = true) => { if (cond) L.push({ chave, texto }); };
  // anuência: só com prorrogação, acréscimo > 25% ou supressão > 25% (no resto a contratada é obrigada a aceitar)
  const ma = motivosAnuencia(d);
  const para = ma.length ? `para ${listaJuntada(ma)}` : "";
  add("anuencia_consulta", `Consulta formal à contratada quanto à anuência ${para}.`, ma.length > 0);
  add("anuencia_resposta", `Resposta da contratada contendo a anuência ${para}.`, ma.length > 0);
  add("disp_orcamentaria", "Declaração de Disponibilidade Orçamentária.");
  add("vantajosidade", "Declaração quanto à vantajosidade da prorrogação contratual.", temProrrogacao(d));
  add("demonstrativo_saldo", "Demonstrativo de Execução e Saldo do Período de Vigência, elaborado pela fiscalização (notas de empenho do período, serviços executados pendentes de pagamento e saldo a ser retirado do SILOMS e anulado no SIAFI).", temProrrogacao(d));
  add("parecer_tecnico", "Parecer Técnico sobre Alteração de Contrato aprovado pelo Ordenador de Despesas da UG Signatária.");
  add("mapa_riscos", "Mapa de Riscos para Termo Aditivo (Gerenciamento de Riscos da fase de Gestão do Contrato, conforme arts. 20 e 26 da IN nº 05/2017 SEGES/MP).");
  add("pesquisa_precos", "Pesquisa de Preços – pesquisa de preços praticados pelo mercado do ramo do objeto, baseada em critérios aceitáveis, observando-se a IN SEGES/ME nº 65/2021, contendo os documentos comprobatórios para calcular o custo global, com a verificação da congruência entre os preços das propostas, de forma a evitar valores desarrazoados ou evidentemente inexequíveis.");
  const idx = String(d.aditivo?.reajuste?.indice || (d as { reajuste?: { indice?: string } }).reajuste?.indice || "").trim();
  add("calculadora", `Comprovante do índice de reajuste${idx ? ` ${idx}` : ""} – ${fonteDoIndice(idx)} (consulta anexada ao Parecer Técnico).`, temReajuste(d));
  add("memoria_calculo", "Memória de Cálculo – Reajuste.", temReajuste(d));
  add("bol_aci", "Boletim de Designação do Agente de Controle Interno.");
  add("bol_od", "Boletim de Designação do Ordenador de Despesas.");
  add("bol_fiscalizacao", "Boletim de Designação da Fiscalização atualizado.");
  add("sicaf", "Comprovante de consulta à situação da contratada junto ao SICAF (a contratada deverá, ao menos, não estar impedida de licitar; possuir os níveis cadastrados I e II; nível III com certidões da Receita Federal, FGTS e Trabalhista válidas; e nível IV ao menos com certidão municipal válida).");
  add("consulta_cnpj", "Comprovante de consulta de regularidade junto ao CEIS, CNJ e Lista de Licitantes Inidôneos (TCU) para o CNPJ da contratada.");
  add("consulta_cpf_socio", "Comprovante de consulta de regularidade junto ao CEIS, CNJ e Lista de Licitantes Inidôneos (TCU) para o CPF do sócio majoritário.", !!d.consulta_socio);
  add("procuracao", "Procuração do representante competente para assinatura do Termo Aditivo.", !!d.representante_mudou);
  add("exclusividade", "Atestado de Exclusividade válido.", !!d.inexigibilidade);
  add("ficha_autorizacao", "Ficha para a Autorização da Prorrogação Contratual (atividade de custeio acima de R$ 1.000.000,00).", passa1Milhao(d));
  const an = analisarPareceres(d, hoje);
  an.pareceres.forEach((p, i) => {
    const num = p.numero.trim();
    const vig = [p.data ? `de ${p.data}` : "", p.validade ? `válido até ${p.validade}` : ""].filter(Boolean).join(", ");
    add(`parecer_referencial${i === 0 ? "" : `_${i + 1}`}`, `${num}${p.objeto ? `\nObjeto: ${p.objeto.trim()}` : ""}${vig ? `\nVigência: ${vig}.` : ""}\nMotivo: ${p.motivo_texto}`);
  });
  // UM único atestado para todos os pareceres – só quando todas as alterações estão fundamentadas (senão vai para a CJU)
  if (an.pareceres.length && !an.descobertas.length) add("atestado_adequacao", `Atestado de adequação do processo ${citarPareceres(an.pareceres)}.`);
  return L;
}

// ── Pesquisa de preços (gerar_pesquisa_precos.py) ────────────────────────────
export function estatistica(it: ItemPesquisa, criterio: string): { n: number; media: number; mediana: number; menor: number; referencia: number } | null {
  const v = (it.precos ?? []).filter((p) => !p.excluido && p.valor_atualizado != null).map((p) => Number(p.valor_atualizado)).sort((a, b) => a - b);
  if (!v.length) return null;
  const media = v.reduce((s, x) => s + x, 0) / v.length;
  const meio = Math.floor(v.length / 2);
  const mediana = v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
  const menor = v[0];
  const referencia = criterio === "media" ? media : criterio === "menor" ? menor : mediana;
  return { n: v.length, media, mediana, menor, referencia };
}
export function resumoPesquisa(d: DadosAditivo): { totalContratado: number; totalReferencia: number; vantajosa: boolean; poucos: number[]; acima: number[] } | null {
  const pp = d.pesquisa_precos;
  if (!pp?.itens?.length) return null;
  let tc = 0, tr = 0;
  const poucos: number[] = [], acima: number[] = [];
  for (const it of pp.itens) {
    const e = estatistica(it, pp.criterio ?? "mediana");
    if (!e || it.preco_contratado == null) continue;
    const q = Number(it.quantidade) || 1;
    tc += it.preco_contratado * q; tr += e.referencia * q;
    if (e.n < 3) poucos.push(it.item);
    if (it.preco_contratado > e.referencia) acima.push(it.item);
  }
  return { totalContratado: tc, totalReferencia: tr, vantajosa: tc <= tr, poucos, acima };
}

// ── Declaração de Vantajosidade Econômica (seção 3I; gerar_declaracao_vantajosidade.py) ──
const MASC_EM_A = new Set(["sistema", "programa", "problema", "tema", "mapa", "dia", "clima", "esquema", "projeto"]);
const ehMaiuscula = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();
const tirarPontas = (s: string, chars: string) => { let a = 0, b = s.length; while (a < b && chars.includes(s[a])) a++; while (b > a && chars.includes(s[b - 1])) b--; return s.slice(a, b); };
/** Artigo definido pelo 1º substantivo do objeto ('Serviço' → o, 'Contratação' → a, 'Serviços' → os) */
export function artigoPara(palavra: string): string {
  const w = tirarPontas(palavra.toLowerCase(), " ,.;:–-");
  const plural = w.endsWith("s") && w.length > 3;
  let base = w;
  if (plural) base = base.replace(/ções$/, "ção").replace(/ões$/, "ão").replace(/s$/, "");
  const fem = !MASC_EM_A.has(base) && /(ção|são|dade|gem|ura|eza|ça|a)$/.test(base);
  return (fem ? "a" : "o") + (plural ? "s" : "");
}
/** Objeto do contrato como entra em "cujo objeto é …" (frase_objeto do kit) */
export function fraseObjetoVantajosidade(d: Pick<DadosAditivo, "vantajosidade" | "objeto_contrato">): string {
  const v = d.vantajosidade;
  if (String(v?.objeto ?? "").trim()) return String(v!.objeto).trim().replace(/\.+$/, "");
  let obj = String(d.objeto_contrato ?? "").trim().replace(/\.+$/, "");
  if (!obj) return "";
  if (ehMaiuscula(obj)) obj = obj.toLowerCase();
  const primeira = obj.split(/\s+/)[0];
  if (["o", "a", "os", "as"].includes(primeira.toLowerCase())) return obj.charAt(0).toLowerCase() + obj.slice(1);
  if (!ehMaiuscula(primeira)) obj = obj.charAt(0).toLowerCase() + obj.slice(1);
  return `${artigoPara(primeira)} ${obj}`;
}
const ROMANOS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];
/** Motivos em incisos I –, II – …: ';' nos intermediários e '.' no último; tira numeração digitada pelo fiscal */
export function incisosVantajosidade(motivos: string[] | null | undefined): [string, string][] {
  const limpos = (motivos ?? []).filter((m) => String(m ?? "").trim()).map((m) => String(m).replace(/\s+/g, " ").trim())
    .map((m) => m.replace(/^(?:[IVX]+|\d+|[a-z])\s*[–\-).]\s*/, ""));
  return limpos.map((m, i) => [i < ROMANOS.length ? ROMANOS[i] : String(i + 1), m.replace(/[ ;.]+$/, "") + (i === limpos.length - 1 ? "." : ";")]);
}
export const SUGESTOES_VANTAJOSIDADE = (indice: string) => [
  `O índice oficial ${indice || "[índice do contrato]"} fixado no contrato é adequado e suficiente para refletir os valores atuais de mercado dos serviços prestados.`,
  "Os preços do setor abarcado pela contratação estão atrelados às variações inflacionárias ordinárias, e não sujeitos a flutuações abruptas e imprevisíveis.",
  "Os preços praticados no mercado, conforme a Pesquisa de Preços juntada aos autos, são superiores aos preços do contrato vigente.",
];

// ── .zip final (seção 3H; montar_zip.py) ─────────────────────────────────────
export const NOMES_ITEM: Record<string, string> = {
  anuencia_consulta: "Consulta de anuência à contratada", anuencia_resposta: "Resposta de anuência da contratada",
  disp_orcamentaria: "Declaração de Disponibilidade Orçamentária", vantajosidade: "Declaração de Vantajosidade Econômica",
  demonstrativo_saldo: "Demonstrativo de Execução e Saldo",
  parecer_tecnico: "Parecer Técnico de Alteração Contratual", mapa_riscos: "Mapa de Riscos", pesquisa_precos: "Pesquisa de Preços",
  calculadora: "Calculadora do Cidadão", sicaf: "SICAF", consulta_cnpj: "Regularidade CEIS-CNEP-CNJ-TCU (CNPJ)",
  consulta_cpf_socio: "Regularidade do CPF do sócio", procuracao: "Procuração", exclusividade: "Atestado de Exclusividade",
  ficha_autorizacao: "Ficha de Autorização da Prorrogação", atestado_adequacao: "Atestado de Adequação ao Parecer Referencial",
  memoria_calculo: "Memória de Cálculo – Reajuste",
};
/** Itens que o site gera (o resto é anexo do fiscal); boletins ficam no SILOMS e a Calculadora vai dentro do Parecer Técnico */
export const GERADOS_PELO_SITE = ["disp_orcamentaria", "vantajosidade", "demonstrativo_saldo", "parecer_tecnico", "mapa_riscos", "pesquisa_precos", "ficha_autorizacao", "atestado_adequacao"];
const SEM_ARQUIVO = ["bol_aci", "bol_od", "bol_fiscalizacao", "calculadora"];
/** O que o .zip vai deixar de fora: item obrigatório sem arquivo e sem justificativa de NÃO anexado (montar_zip.py) */
export function faltandoNoZip(d: DadosAditivo, hoje: string, temArquivo: (chave: string) => boolean): { n: number; chave: string; nome: string }[] {
  const nao = d.nao_anexados ?? {};
  return itensDaLista(d, hoje).map((it, i) => ({ n: i + 1, chave: it.chave, nome: NOMES_ITEM[it.chave] ?? it.chave }))
    .filter((x) => !x.chave.startsWith("parecer_referencial") && !SEM_ARQUIVO.includes(x.chave) && !(x.chave in nao) && !temArquivo(x.chave));
}
/** Documentos que o site vai gerar para o caso (aplicaveis da ponte, em chaves da Lista) */
export function geradosPrevistos(d: DadosAditivo, hoje: string): string[] {
  const g = ["disp_orcamentaria"];
  if (temProrrogacao(d) && d.vantajosidade?.motivos?.some((m) => String(m ?? "").trim())) g.push("vantajosidade");
  if (temProrrogacao(d) && d.saldo_periodo) g.push("demonstrativo_saldo");
  g.push("parecer_tecnico"); // item 5: sempre (rev5.1)
  if (d.riscos?.length) g.push("mapa_riscos");
  if (d.pesquisa_precos) g.push("pesquisa_precos");
  const an = analisarPareceres(d, hoje);
  if (an.pareceres.length && !an.descobertas.length) g.push("atestado_adequacao");
  if (passa1Milhao(d)) g.push("ficha_autorizacao");
  return g;
}

// ── OM signatária e autoridade (Ficha) ───────────────────────────────────────
const OMS_CEFA = ["GAP-MN", "PAMN", "PREFEITURA"];
/** OM do CEFA (autoridade do campo 19 = Diretor de Administração da Aeronáutica): pelo nome (regra do kit) */
export const eCefa = (om: { sigla?: string; nome?: string }) => {
  const alvo = `${om.sigla ?? ""} ${om.nome ?? ""}`.toUpperCase();
  return OMS_CEFA.some((x) => alvo.includes(x)) || alvo.includes("GRUPAMENTO DE APOIO DE MANAUS");
};
export const AUTORIDADE_CEFA = "Diretor de Administração da Aeronáutica";

// ── Número do termo aditivo (maior nº de TA assinado + 1; rev5.1, seção 7.1) ─────
/** Nº de um termo aditivo: "00004/2026", "4º Termo Aditivo", "4º TA" → 4 */
function numeroDoAditivo(t: string): number | null {
  const s = t.trim();
  const m = /^0*(\d{1,3})\s*\//.exec(s) ?? /^0*(\d{1,3})\s*[ºª°o]?\s*(?:termo\s+aditivo|TA)\b/i.exec(s);
  return m ? Number(m[1]) : null;
}
/** Números dos TAs assinados (documentos da carga + histórico de valores), o próximo e os que faltam no meio */
export function aditivosAssinados(documentos: { tipo?: string; numero?: string | null }[] | undefined, historico?: { documento?: string | null }[]): { numeros: number[]; proximo: number; faltando: number[] } {
  const nums = new Set<number>();
  let semNumero = 0;
  for (const d of documentos ?? []) {
    if (!/ADITIVO/i.test(String(d.tipo ?? ""))) continue;
    const n = numeroDoAditivo(String(d.numero ?? ""));
    if (n) nums.add(n); else semNumero++;
  }
  for (const h of historico ?? []) { const n = numeroDoAditivo(String(h.documento ?? "")); if (n) nums.add(n); }
  const numeros = [...nums].sort((a, b) => a - b);
  const maior = Math.max(0, ...numeros, numeros.length ? 0 : semNumero);
  const faltando = Array.from({ length: maior }, (_, i) => i + 1).filter((n) => numeros.length && !nums.has(n));
  return { numeros, proximo: maior + 1, faltando };
}
export function proximoAditivo(documentos: { tipo?: string; numero?: string | null }[] | undefined, historico?: { documento?: string | null }[]): number {
  return aditivosAssinados(documentos, historico).proximo;
}

// ── Alertas (seção 4) ────────────────────────────────────────────────────────
const EMPENHO: [keyof DadosAditivo["empenho"], string][] = [["gestao_unidade", "Gestão/Unidade"], ["fonte", "Fonte de Recursos"], ["programa_trabalho", "Programa de Trabalho"], ["plano_interno", "Plano Interno"], ["natureza_despesa", "Natureza de Despesa"]];
export function alertasDoAditivo(d: DadosAditivo, e: EstadoAditivo, hoje: string, anexos: { sicaf: boolean; regularidade: boolean; pesquisaExterna?: boolean },
  extra: { unidadeCadastrada?: boolean | null } = {}): Alerta[] {
  const a: Alerta[] = [];
  const alts = alteracoes(d);
  if (!alts.length) a.push({ nivel: "critico", texto: "Marque o que o aditivo vai fazer (prorrogação, reajuste, acréscimo ou supressão).", bloqueia: true, secao: "alteracoes" });
  if (extra.unidadeCadastrada === false) a.push({ nivel: "atencao", texto: `A OM signatária ${d.om_signataria?.sigla || "?"} não está cadastrada em Reajustes › Configurações: cadastre antes de gerar os documentos (o site não usa os dados de outra unidade no lugar).`, secao: "oms" });
  for (const k of ["acrescimo", "supressao"] as const) {
    if (d.aditivo[k] && pctKit(d.aditivo[k]!.percentual) == null) a.push({ nivel: "atencao", texto: `${k === "acrescimo" ? "Acréscimo" : "Supressão"} sem o percentual: os itens de anuência da contratada entram na Lista por segurança. Informe o percentual.`, secao: "alteracoes" });
  }
  if (temProrrogacao(d)) {
    if (!incisosVantajosidade(d.vantajosidade?.motivos).length) a.push({ nivel: "critico", texto: "Declaração de Vantajosidade: escreva pelo menos 1 motivo (a prorrogação exige a declaração).", bloqueia: !("vantajosidade" in (d.nao_anexados ?? {})), secao: "vantajosidade" });
    const cab = String(d.vantajosidade?.om_cabecalho ?? "").trim();
    if (cab && d.om_signataria?.nome && cab.toUpperCase() !== d.om_signataria.nome.trim().toUpperCase()) a.push({ nivel: "info", texto: `Declaração de Vantajosidade: cabeçalho ajustado manualmente ("${cab}").`, secao: "vantajosidade" });
  }
  if (numero(d.valor_atual) == null) a.push({ nivel: "critico", texto: "Informe o valor atual do contrato (seção 1.3).", bloqueia: true, secao: "alteracoes" });
  if (d.aditivo.prorrogacao && (!d.aditivo.prorrogacao.meses || !d.aditivo.prorrogacao.inicio)) a.push({ nivel: "critico", texto: "Prorrogação sem o nº de meses ou a data de início do novo período.", bloqueia: true, secao: "alteracoes" });
  const pr = d.aditivo.prorrogacao;
  if (pr?.excepcional) {
    if ((Number(pr.meses) || 0) > 12) a.push({ nivel: "critico", texto: "Prorrogação excepcional acima de 12 meses: o art. 57, § 4º, da Lei 8.666/1993 permite até 12 meses.", secao: "alteracoes" });
    if (e.lei === "14133" || d.lei === "14133") a.push({ nivel: "critico", texto: "Prorrogação excepcional marcada em contrato da Lei 14.133: essa figura é do art. 57, § 4º, da Lei 8.666; na 14.133 os contínuos podem ser prorrogados até 10 anos (art. 107) – conferir.", secao: "alteracoes" });
    if (!String(pr.justificativa ?? "").trim()) a.push({ nivel: "atencao", texto: "Prorrogação excepcional sem a justificativa da excepcionalidade (vai para o motivo do Parecer Técnico).", secao: "alteracoes" });
  }
  for (const k of ["acrescimo", "supressao"] as const) {
    const pct = numero(d.aditivo[k]?.percentual);
    if (pct != null && pct > LIMITE_LEI) a.push({ nivel: "critico", texto: `${k === "acrescimo" ? "Acréscimo" : "Supressão"} de ${pct2(pct)}: passa de ${LIMITE_LEI}% (art. 125 da Lei 14.133/2021; 50% só para reforma de edifício/equipamento).`, secao: "alteracoes" });
  }
  if (d.aditivo.reajuste && numero(d.aditivo.reajuste.valor) == null) a.push({ nivel: "atencao", texto: "Reajuste sem o valor em R$: traga o total da memória de cálculo (seção Memória de Cálculo).", secao: "memoria" });
  const an = analisarPareceres(d, hoje);
  for (const x of an.descobertas) a.push({ nivel: "critico", texto: `${x.charAt(0).toUpperCase()}${x.slice(1)} sem parecer referencial vigente – este termo aditivo deverá ir para análise jurídica (CJU).`, secao: "pareceres" });
  const chaves = itensDaLista(d, hoje).map((i) => i.chave);
  for (const [k, j] of Object.entries(d.nao_anexados ?? {})) {
    if (chaves.includes(k) && !String(j ?? "").trim()) a.push({ nivel: "critico", texto: `Item "${k}" marcado como NÃO anexado sem justificativa.`, bloqueia: true, secao: "lista" });
  }
  const vazios = EMPENHO.filter(([k]) => !String(d.empenho?.[k] ?? "").trim()).map(([, n]) => n);
  if (vazios.length) a.push({ nivel: "critico", texto: `Dados do empenho incompletos (${vazios.join(", ")}): a Declaração de Disponibilidade Orçamentária não é gerada.`, bloqueia: true, secao: "declaracao" });
  if (!d.empenho?.acao) a.push({ nivel: "info", texto: "Empenho sem a Ação: a Declaração sai com \"não se aplica\" (confira).", secao: "declaracao" });
  if (!d.empenho?.exercicio) a.push({ nivel: "critico", texto: "Informe o exercício da Declaração Orçamentária.", bloqueia: true, secao: "declaracao" });
  // Mapa de Riscos
  if (!d.riscos.length) a.push({ nivel: "critico", texto: "Mapa de Riscos sem nenhum risco.", bloqueia: true, secao: "riscos" });
  else {
    if (d.riscos.length === 1) a.push({ nivel: "atencao", texto: "Mapa de Riscos com só 1 risco: o modelo prevê pelo menos 2.", secao: "riscos" });
    const incompletos = d.riscos.map((r, i) => (!r.nome?.trim() || !r.probabilidade || !r.impacto || !r.dano?.trim() || !r.acao_preventiva?.trim() || !r.acao_contingencia?.trim() ? i + 1 : 0)).filter(Boolean);
    if (incompletos.length) a.push({ nivel: "critico", texto: `Risco(s) ${incompletos.join(", ")} com campo obrigatório vazio.`, bloqueia: true, secao: "riscos" });
  }
  // SICAF (item 12) e regularidade (item 13)
  if (!e.sicaf && !("sicaf" in (d.nao_anexados ?? {}))) a.push({ nivel: "critico", texto: "Falta o PDF do SICAF (item 12): anexe, ou marque o item como NÃO anexado com justificativa. Sem ele o .zip sai sem o item 12.", secao: "sicaf" });
  if (e.sicaf && !e.sicaf.ok) a.push({ nivel: "critico", texto: `SICAF com pendências: ${e.sicaf.alertas.filter((x) => !x.startsWith("🟡")).join(" ")}`, secao: "sicaf" });
  if (e.sicaf && !anexos.sicaf) a.push({ nivel: "info", texto: "O SICAF foi conferido, mas o PDF não está guardado no aditivo: anexe de novo para ir junto no .zip.", secao: "sicaf" });
  if (!e.regularidade && !("consulta_cnpj" in (d.nao_anexados ?? {}))) a.push({ nivel: "critico", texto: "Falta a consulta de regularidade (item 13): faça a consulta, ou marque o item como NÃO anexado com justificativa. Sem ela o .zip sai sem o item 13.", secao: "regularidade" });
  if (e.regularidade) {
    for (const [k, c] of Object.entries(e.regularidade.cadastros)) {
      if (c.situacao === "consta") a.push({ nivel: "critico", texto: `CONSTA registro no ${c.cadastro} – verificar antes do aditivo.`, secao: "regularidade" });
      else if (/positiva/i.test(e.regularidade.complementos?.[k] ?? "")) a.push({ nivel: "critico", texto: `CONSTA registro no ${c.cadastro} (certidão Positiva) – verificar antes do aditivo.`, secao: "regularidade" });
      else if (c.situacao !== "nada_consta" && !e.regularidade.complementos?.[k]) a.push({ nivel: "atencao", texto: `A consulta ao ${c.cadastro} falhou na Consulta Consolidada: anexe a certidão desse cadastro${c.automatico ? " (ou busque automaticamente)" : ""}.`, secao: "regularidade" });
    }
  }
  // Ficha (> R$ 1 milhão)
  if (passa1Milhao(d)) {
    if (!d.merito_administrativo?.trim()) a.push({ nivel: "critico", texto: "Ficha de Autorização: escreva o mérito administrativo (campo 9).", bloqueia: true, secao: "ficha" });
    if (!String(d.om_signataria?.ug ?? "").trim()) a.push({ nivel: "critico", texto: "Ficha de Autorização: informe o código da UG signatária (campo 2).", bloqueia: true, secao: "ficha" });
    if (!eCefa(d.om_signataria ?? {}) && !d.autoridade_superior?.trim()) a.push({ nivel: "critico", texto: "Ficha de Autorização: informe o cargo da autoridade do campo 19 (OM fora do CEFA).", bloqueia: true, secao: "ficha" });
  }
  // Pesquisa de preços (obrigatória)
  // pesquisa feita fora do site (PDF anexado e escolhido): marca o item e tira o alerta
  const rp = anexos.pesquisaExterna ? null : resumoPesquisa(d);
  if (!rp && !anexos.pesquisaExterna && !("pesquisa_precos" in (d.nao_anexados ?? {}))) a.push({ nivel: "atencao", texto: "Pesquisa de Preços ainda não feita (obrigatória em todo aditivo): faça na aba Pesquisa de Preços ou marque NÃO com justificativa.", secao: "pesquisa" });
  if (rp) {
    if (rp.poucos.length) a.push({ nivel: "atencao", texto: `Item(ns) ${rp.poucos.join(", ")} com menos de 3 preços válidos: justificar.`, secao: "pesquisa" });
    if (!rp.vantajosa) a.push({ nivel: "critico", texto: "Total contratado acima do mercado: negociar redução com a contratada ou justificar a vantajosidade antes da prorrogação.", secao: "pesquisa" });
    if (d.pesquisa_precos?.itens.some((i) => i.preco_contratado == null)) a.push({ nivel: "critico", texto: "Pesquisa de Preços com item sem o preço contratado do novo período.", bloqueia: true, secao: "pesquisa" });
  }
  if (!d.om_nome?.trim() || !d.pag?.trim() || !d.contrato?.trim() || !d.om_signataria?.sigla?.trim()) a.push({ nivel: "critico", texto: "Faltam dados do contrato (OM solicitante, PAG, nº do contrato ou OM signatária).", bloqueia: true, secao: "alteracoes" });
  if (!d.numero_aditivo) a.push({ nivel: "critico", texto: "Informe o nº do termo aditivo.", bloqueia: true, secao: "alteracoes" });
  return a;
}
