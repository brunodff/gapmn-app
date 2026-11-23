// Carga de contratos do SILOMS (arquivo carga_contratos_AAAA-MM-DD.json que a SCON gera com a skill
// "alimentar-site-hpmn"; formato em docs/CARGA_SILOMS.md do pacote da SCON). Porta para o app das
// regras do carga.py: leitura, pendências do cadastro, junção com o que já está no banco e o casamento
// de cada contrato da carga com o número usado no app (contratos_scon.numero_contrato).
import type { DadosReajuste } from "./tipos.ts";

export interface DocumentoCarga {
  tipo: string;                 // CONTRATO | TERMO_ADITIVO | APOSTILAMENTO
  numero?: string;
  natureza?: string[] | null;
  data_assinatura?: string | null;
  valor_resultante?: number | null;
  resumo?: string;
  origem?: string;
}

export interface SilomsCarga {
  codigo?: string; numero_oficial?: string; pag?: string; status?: string; dedicacao_exclusiva?: boolean;
  /** motivo de não haver reajuste por índice (adesão: tarifa regulada; credenciamento: tabela de referência) */
  reajuste_nao_aplicavel?: string;
  vigencia_inicio?: string; vigencia_fim?: string; valor_total_siloms?: number; fornecedor_resumido?: string;
  descricao_resumida?: string; vigencia_vencida_no_siloms?: boolean; [k: string]: unknown;
}

/** De onde veio a data do orçamento (busca da SCON no SILOMS, desde a carga de 23/11/2026) */
export interface FonteDataBase { fonte?: string; documento?: string; subprocesso?: string | number; trecho?: string; conferir?: boolean | string }

export interface RegistroCarga {
  chave: string;
  data_base_fonte?: FonteDataBase;
  atualizado_em?: string;
  siloms?: SilomsCarga;
  coleta?: { etapa?: string; documentos_lidos?: boolean };
  documentos?: DocumentoCarga[];
  ultimo_empenho?: Record<string, unknown>;
  dados?: Partial<DadosReajuste> & Record<string, unknown>;
  pendencias?: string[];
  /** o que a coleta da SCON pede para conferir (ex.: índice achado no TR) */
  avisos?: string[];
  situacao?: string;
}

export interface Carga {
  versao: number; gerado_em?: string; uasg?: string; fonte?: string; lista_completa?: boolean;
  contratos: RegistroCarga[];
}

/** O que fica guardado em contratos_apostilamento.carga (tudo menos os dados do motor) */
export interface CargaGuardada {
  chave: string; atualizado_em?: string; gerado_em?: string; fonte?: string;
  siloms?: SilomsCarga; coleta?: RegistroCarga["coleta"]; documentos?: DocumentoCarga[];
  ultimo_empenho?: Record<string, unknown>; avisos?: string[]; data_base_fonte?: FonteDataBase; fora_da_carga?: boolean;
}

export type SituacaoCadastro = "COMPLETO" | "PENDENTE" | "NAO_SE_APLICA";

/** Por que o contrato fica fora do reajuste automático (situação NAO_SE_APLICA), ou null: dedicação
 *  exclusiva de mão de obra (repactuação) ou o motivo que a carga trouxe (tarifa regulada, tabela). */
export function motivoForaDaAutomacao(siloms: SilomsCarga | null | undefined, dedicacao?: boolean): string | null {
  if (dedicacao || siloms?.dedicacao_exclusiva) return "dedicação exclusiva de mão de obra (repactuação)";
  return siloms?.reajuste_nao_aplicavel ? String(siloms.reajuste_nao_aplicavel) : null;
}

const vazio = (v: unknown) => v == null || v === "" || (Array.isArray(v) && !v.length) ||
  (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);

/** Confere o arquivo (versão 1, chave em todo contrato, sem repetição). Lança Error com a explicação. */
export function lerCarga(json: unknown): Carga {
  const c = json as Carga;
  if (!c || typeof c !== "object" || c.versao !== 1 || !Array.isArray(c.contratos)) {
    throw new Error("Este arquivo não é uma carga de contratos do SILOMS (esperado versao 1 com a lista de contratos).");
  }
  const vistos = new Set<string>();
  for (const r of c.contratos) {
    const ch = String(r.chave || r.dados?.contrato || "").trim();
    if (!ch) throw new Error("Há um contrato sem 'chave' (nº do contrato) na carga.");
    if (vistos.has(ch)) throw new Error(`Contrato repetido na carga: ${ch}`);
    vistos.add(ch);
    r.chave = ch;
  }
  return c;
}

/** Pendências do cadastro para gerar os documentos (regra do validar_registro da SCON). Vazia = completo.
 *  `dedicacao`: contrato fora da automação (repactuação, tarifa regulada ou tabela), sem pendências. */
export function pendenciasCadastro(d: Partial<DadosReajuste> | null | undefined,
  op: { dedicacao?: boolean; textosFixos: Record<string, string>; omPadrao: string }): string[] {
  if (op.dedicacao) return [];
  const x = (d ?? {}) as Partial<DadosReajuste> & Record<string, unknown>;
  const p: string[] = [];
  const campos: [keyof DadosReajuste, string][] = [["contrato", "Nº do contrato"], ["nup", "NUP/PAG"],
    ["om_contratante_sigla", "Sigla da OM contratante"], ["om_contratante_nome", "Nome da OM contratante"],
    ["objeto_completo", "Objeto completo"], ["objeto_resumido", "Objeto resumido"],
    ["data_base", "Data do orçamento"], ["base", "Base do reajuste (anual/mensal/total)"]];
  for (const [k, nome] of campos) if (vazio(x[k])) p.push(`Falta ${nome}`);
  if (x.data_base && !/^\d{2}\/\d{4}$/.test(String(x.data_base))) p.push("Data do orçamento fora do formato MM/AAAA");
  const emp = x.empresa ?? ({} as DadosReajuste["empresa"]);
  for (const [k, nome] of [["nome", "razão social"], ["cnpj", "CNPJ"], ["endereco", "endereço"]] as const) if (vazio(emp[k])) p.push(`Falta o ${nome} da empresa`);
  if (vazio(emp.representante) && vazio(emp.representantes)) p.push("Falta o representante da empresa");
  if (vazio(x.indice?.nome) || vazio(x.indice?.clausula)) p.push("Falta o índice de reajuste e/ou a cláusula");
  const omOrd = x.om_ordenador || x.ordenador?.om_sigla || op.omPadrao;
  if (!op.textosFixos[omOrd] && vazio(x.contratante_paragrafo)) p.push(`OM ${omOrd} sem texto fixo: falta o parágrafo I – CONTRATANTE do contrato`);
  const itens = x.itens ?? [];
  if (!itens.length) p.push("Falta a tabela de itens");
  let soma = 0;
  for (const it of itens) {
    for (const k of ["descricao", "qtd", "valor_unit", "valor_base"] as const) {
      if (vazio(it[k]) && it[k] !== 0) p.push(`Item ${it.item ?? "?"}: falta ${k === "valor_base" ? "o valor na base" : k === "valor_unit" ? "o unitário" : k === "qtd" ? "a quantidade" : "a descrição"}`);
    }
    soma += Number(it.valor_base) || 0;
  }
  if (vazio(x.historico_valores)) p.push("Falta o histórico de valores (contrato inicial e termos assinados)");
  if (itens.length && x.itens_total_inicial != null && vazio(x.alteracoes_quantitativas)
      && Math.abs(Math.round(soma * 100) - Math.round(Number(x.itens_total_inicial) * 100)) > 5) {
    p.push(`Soma dos itens (${brl(soma)}) diferente do valor do contrato na base (${brl(Number(x.itens_total_inicial))})`);
  }
  const orc = x.orcamento ?? ({} as DadosReajuste["orcamento"]);
  const nomesOrc: Record<string, string> = { gestao_unidade: "Gestão/Unidade", fonte: "fonte", programa_trabalho: "PTRES",
    plano_interno: "plano interno", natureza_despesa: "natureza de despesa", exercicio: "exercício" };
  for (const k of Object.keys(nomesOrc) as (keyof typeof orc)[]) if (vazio(orc[k])) p.push(`Falta ${nomesOrc[k]} do último empenho`);
  for (const r of x.reajustes ?? []) {
    if (!r.novo && (r.indice_pct == null || vazio(r.documento))) p.push(`${r.n}º reajuste já aplicado sem o índice ou sem o documento`);
  }
  return p;
}
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const situacaoCadastro = (pendencias: string[], dedicacao: boolean): SituacaoCadastro =>
  dedicacao ? "NAO_SE_APLICA" : pendencias.length ? "PENDENTE" : "COMPLETO";

/** Nº do próximo apostilamento: os já assinados (documentos da carga) + 1. */
export const proximoApostilamento = (documentos: DocumentoCarga[] | undefined) =>
  1 + (documentos ?? []).filter((x) => String(x.tipo).toUpperCase() === "APOSTILAMENTO").length;

// ── Casamento com os contratos do app ────────────────────────────────────────
/** "DESPESA 001/GAP-MN/2024" → "001/GAPMN/2024"; "CREDENCIAMENTO 014/2022" → "014/2022" */
export function nucleoNumero(s: string | null | undefined): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase()
    .replace(/^(DESPESA|RECEITA|CRED(ENCIAMENTO)?|ADES[AÃ]O|CONTRATO)\s+/, "")
    .replace(/GAP-MN/g, "GAPMN");
}
const digitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
const primeiroNumero = (s: string) => { const m = /(\d+)/.exec(nucleoNumero(s)); return m ? Number(m[1]) : NaN; };

export interface ContratoApp { numero_contrato: string; pag_nup: string | null }
export interface Par { reg: RegistroCarga; numero_contrato: string; como: "exato" | "numero" | "pag" }

/** Cada contrato da carga com o do app: nº igual; senão o nº sem o prefixo (DESPESA, CRED…); senão o PAG
 *  com o mesmo número. Contrato do app já usado não recebe outro. */
export function casarContratos(regs: RegistroCarga[], contratos: ContratoApp[]): { pares: Par[]; semPar: RegistroCarga[] } {
  const exatos = new Map(contratos.map((c) => [c.numero_contrato, c]));
  const porNucleo = new Map<string, ContratoApp[]>();
  const porPag = new Map<string, ContratoApp[]>();
  for (const c of contratos) {
    const n = nucleoNumero(c.numero_contrato);
    porNucleo.set(n, [...(porNucleo.get(n) ?? []), c]);
    const p = digitos(c.pag_nup);
    if (p) porPag.set(p, [...(porPag.get(p) ?? []), c]);
  }
  const usados = new Set<string>();
  const pares: Par[] = [], semPar: RegistroCarga[] = [];
  const usar = (reg: RegistroCarga, c: ContratoApp | undefined, como: Par["como"]) => {
    if (!c || usados.has(c.numero_contrato)) return false;
    usados.add(c.numero_contrato); pares.push({ reg, numero_contrato: c.numero_contrato, como }); return true;
  };
  for (const reg of regs) {
    if (usar(reg, exatos.get(reg.chave), "exato")) continue;
    const porN = (porNucleo.get(nucleoNumero(reg.chave)) ?? []).filter((c) => !usados.has(c.numero_contrato));
    if (porN.length === 1 && usar(reg, porN[0], "numero")) continue;
    const num = primeiroNumero(reg.chave);
    const porP = (porPag.get(digitos(reg.siloms?.pag)) ?? [])
      .filter((c) => !usados.has(c.numero_contrato) && primeiroNumero(c.numero_contrato) === num);
    if (porP.length === 1 && usar(reg, porP[0], "pag")) continue;
    semPar.push(reg);
  }
  return { pares, semPar };
}

// ── Junção com o cadastro que já está no banco ───────────────────────────────
const OBJETOS = ["empresa", "indice", "orcamento", "ordenador", "aci", "fiscal"];

/** Junta os dados da carga ao cadastro do app. `cargaManda`: a carga é mais nova que a última edição
 *  no app, então o que ela traz substitui; senão ela só preenche o que está vazio (a correção feita no
 *  app depois da coleta não se perde). Reajustes: os já aplicados vêm da carga; os pedidos agora (novo)
 *  que o app já tinha continuam. */
export function mesclarDados(atual: Partial<DadosReajuste> | null | undefined, daCarga: Partial<DadosReajuste> | null | undefined,
  cargaManda: boolean): Partial<DadosReajuste> {
  const out = structuredClone((atual ?? {}) as Record<string, unknown>);
  const nova = (daCarga ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(nova)) {
    if (vazio(v)) continue;
    if (k === "reajustes") continue;
    const tem = !vazio(out[k]);
    if (OBJETOS.includes(k) && typeof v === "object" && !Array.isArray(v)) {
      const base = (tem ? out[k] : {}) as Record<string, unknown>;
      const junto: Record<string, unknown> = { ...base };
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (vazio(v2)) continue;
        if (cargaManda || vazio(base[k2])) junto[k2] = v2;
      }
      out[k] = junto;
    } else if (cargaManda || !tem) {
      out[k] = structuredClone(v);
    }
  }
  const aplicadosCarga = ((nova.reajustes ?? []) as DadosReajuste["reajustes"]).filter((r) => !r.novo);
  const atuais = (out.reajustes ?? []) as DadosReajuste["reajustes"];
  if (aplicadosCarga.length) {
    const ns = new Set(aplicadosCarga.map((r) => r.n));
    out.reajustes = [...aplicadosCarga, ...atuais.filter((r) => r.novo && !ns.has(r.n))].sort((a, b) => a.n - b.n);
  }
  return out as Partial<DadosReajuste>;
}

/** Parte do registro da carga que fica guardada junto do cadastro (para conferência na tela). */
export function cargaGuardada(reg: RegistroCarga, carga: Carga): CargaGuardada {
  return { chave: reg.chave, atualizado_em: reg.atualizado_em ?? carga.gerado_em, gerado_em: carga.gerado_em, fonte: carga.fonte,
    siloms: reg.siloms, coleta: reg.coleta, documentos: reg.documentos ?? [], ultimo_empenho: reg.ultimo_empenho,
    ...(reg.avisos?.length ? { avisos: reg.avisos } : {}),
    ...(fonteDaDataBase(reg) ? { data_base_fonte: fonteDaDataBase(reg) } : {}) };
}

/** A origem da data do orçamento vem no registro ou dentro dos dados, conforme a versão da coleta */
export function fonteDaDataBase(reg: RegistroCarga): FonteDataBase | undefined {
  const f = reg.data_base_fonte ?? (reg.dados?.data_base_fonte as FonteDataBase | undefined);
  return f && typeof f === "object" && Object.keys(f).length ? f : undefined;
}

/** A carga é mais nova que a última edição do cadastro no app? A coleta só tem o dia: se o cadastro foi
 *  mexido no app no mesmo dia ou depois, vale o app (a carga só preenche o que estiver vazio). */
export function cargaMaisNova(regAtualizadoEm: string | undefined, appAtualizadoEm: string | null | undefined): boolean {
  if (!appAtualizadoEm) return true;
  if (!regAtualizadoEm) return false;
  return regAtualizadoEm.slice(0, 10) > new Date(appAtualizadoEm).toISOString().slice(0, 10);
}
