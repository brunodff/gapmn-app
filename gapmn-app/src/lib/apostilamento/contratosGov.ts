// Cadastro do reajuste a partir da API pública do Contratos.gov.br (contratos.comprasnet.gov.br/api),
// sem robô no SILOMS: partes, NUP, itens, histórico de valores (contrato e termos), reajustes já
// aplicados por apostila e a dotação do último empenho. O que só existe nos PDFs (representante,
// índice e cláusula, data do orçamento, endereço) vem da leitura dos PDFs (lerPdfs.ts).
// Conferido em 18/11/2026 com o CT 037/GAPMN-CINDACTAIV/2025, que a SCON cadastrou à mão: mesmos
// itens, valores, histórico e dotação.
import { historicoEntra, proximoApostilamento, type DocumentoCarga } from "./carga.ts";
import type { AlteracaoQuantitativa, DadosReajuste, HistoricoValor, ItemContrato, Orcamento, Reajuste } from "./tipos.ts";

export interface ContratoGov {
  id: number; numero: string; processo: string | null; objeto: string | null; categoria?: string | null;
  fornecedor: { tipo?: string; cnpj_cpf_idgener: string; nome: string };
  vigencia_inicio: string | null; vigencia_fim: string | null; data_assinatura: string | null;
  valor_inicial: string | null; valor_global: string | null; valor_parcela?: string | null; num_parcelas?: number | null;
  situacao?: string;
  /** compra que originou o contrato (para achar o TR no PNCP) */
  unidade_compra?: string | null; licitacao_numero?: string | null; codigo_modalidade?: string | null; modalidade?: string | null;
  contratante?: { orgao?: { codigo?: string; nome?: string; unidade_gestora?: { codigo?: string; nome_resumido?: string; nome?: string } } };
}
export interface ItemGov { numero_item_compra: string | null; descricao_complementar: string | null; quantidade: string | null; valorunitario: string | null; valortotal: string | null }
export interface HistoricoGov {
  tipo: string; numero: string; data_assinatura: string | null; vigencia_inicio?: string | null; vigencia_fim?: string | null;
  valor_global: string | null; novo_valor_global?: string | null; observacao?: string | null; qualificacao_termo?: { descricao: string }[] | null;
}
export interface EmpenhoGov {
  numero: string; data_emissao: string | null; unidade_gestora: string | null; gestao: string | null; fonte_recurso: string | null;
  programa_trabalho: string | null; planointerno: string | null; naturezadespesa: string | null;
}

/** "1.234,56" → 1234.56 · "20700" → 20700 */
/** "Pregão" + "00007/2020" → "Pregão nº 07/2020" (licitação de origem, para o Termo Aditivo da SCON) */
export function licitacaoDoGov(modalidade: string | null | undefined, numeroLic: string | null | undefined): string | null {
  const m = String(modalidade ?? "").trim(), n = String(numeroLic ?? "").trim();
  if (!m || !n) return null;
  const x = /^0*(\d+)\/(\d{4})$/.exec(n);
  const num = x ? `${x[1].padStart(2, "0")}/${x[2]}` : n;
  const nome = m.charAt(0).toUpperCase() + m.slice(1).toLowerCase().replace(/eletr[oô]nico/, "Eletrônico");
  return `${nome} nº ${num}`;
}

export function numBR(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

// ── Casamento: nº do app × nº do Contratos.gov.br ────────────────────────────
/** Nº e ano do contrato no padrão do Contratos.gov.br. Credenciamento lá é "2" + 4 dígitos
 *  (004/2023 → 20004/2023), como no CNET. "037/GAPMN-CINDACTAIV/2025" → { n: 37, ano: "2025" } */
export function numeroEAno(s: string | null | undefined): { n: number; ano: string } | null {
  const t = String(s ?? "").toUpperCase().trim();
  const ano = /(\d{4})\s*$/.exec(t)?.[1];
  const m = /(\d{1,6})\s*\//.exec(t.replace(/^\D+?(?=\d)/, ""));
  if (!ano || !m) return null;
  let n = Number(m[1]);
  if (/^CRED/.test(t) && n < 10000) n += 20000;
  return { n, ano };
}
const so = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

/** Acha o contrato do app na lista da UG: nº e ano; com mais de um, o mesmo processo (PAG) e depois o início da vigência */
export function acharContratoGov(numeroApp: string, pag: string | null | undefined, inicio: string | null | undefined, lista: ContratoGov[]): ContratoGov | null {
  const alvo = numeroEAno(numeroApp);
  if (!alvo) return null;
  const mesmos = lista.filter((c) => { const x = numeroEAno(c.numero); return !!x && x.n === alvo.n && x.ano === alvo.ano; });
  if (mesmos.length <= 1) return mesmos[0] ?? null;
  const porPag = mesmos.filter((c) => so(pag) && so(c.processo) === so(pag));
  if (porPag.length === 1) return porPag[0];
  const porInicio = mesmos.filter((c) => inicio && c.vigencia_inicio === inicio.slice(0, 10));
  return porInicio.length === 1 ? porInicio[0] : null;
}

// ── Conversão ────────────────────────────────────────────────────────────────
const ORD = (k: number) => `${k}º`;
const iso = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);
const brData = (d: string | null | undefined) => { const x = iso(d); return x ? `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}` : null; };

/** Tipo do termo no histórico do Contratos.gov.br */
function tipoTermo(t: string): "CONTRATO" | "TERMO_ADITIVO" | "APOSTILAMENTO" | null {
  const x = t.toUpperCase();
  // instrumento inicial: os tipos do Contratos.gov.br (Contrato, Credenciamento, Termo de Adesão, Carta Contrato, Empenho, Outros)
  if (/^(CONTRATO|CARTA CONTRATO|CREDENCIAMENTO|TERMO DE ADES|EMPENHO|OUTROS)/.test(x)) return "CONTRATO";
  if (x.includes("ADITIVO")) return "TERMO_ADITIVO";
  if (x.includes("APOSTILAMENTO")) return "APOSTILAMENTO";
  return null; // rescisão, encerramento…
}

/** Objeto resumido sugerido: tira "contratação de empresa especializada na prestação de…" e corta no 1º detalhe */
export function resumirObjeto(objeto: string | null | undefined, max = 90): string {
  let t = String(objeto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  t = t.replace(/^(o\s+)?(presente\s+)?(contrato|instrumento|termo)\s+tem\s+(por|como)\s+objeto\s+(a|o)?\s*/i, "")
    .replace(/^(a\s+)?contrata[çc][ãa]o\s+de\s+(uma\s+)?(empresa|pessoa jur[ií]dica)\s+(especializada\s+)?(para|na|no|em)?\s*(a\s+|o\s+)?/i, "")
    .replace(/^(a\s+)?contrata[çc][ãa]o\s+(de|do|da)\s+/i, "")
    .replace(/^(presta[çc][ãa]o\s+de\s+)/i, "");
  const corte = t.search(/,|;|\.\s| conforme | nos termos | a serem | que ser[ãa]o | para atender | visando /i);
  if (corte > 20) t = t.slice(0, corte);
  if (t.length > max) t = t.slice(0, t.lastIndexOf(" ", max)).trim();
  const minusculo = t === t.toUpperCase() ? t.toLowerCase() : t;
  return minusculo.charAt(0).toUpperCase() + minusculo.slice(1);
}

/** Meses entre duas datas ISO (arredondado) */
function meses(ini: string | null | undefined, fim: string | null | undefined): number | null {
  const a = iso(ini), b = iso(fim);
  if (!a || !b) return null;
  return Math.round((Date.parse(b) - Date.parse(a)) / (30.4375 * 86400000));
}

export interface ResultadoGov {
  dados: Partial<DadosReajuste>;
  documentos: DocumentoCarga[];
  ultimo_empenho: Record<string, unknown> | null;
  avisos: string[];
}

export function dadosDoContratosGov(c: ContratoGov, itens: ItemGov[], historico: HistoricoGov[], empenhos: EmpenhoGov[]): ResultadoGov {
  const avisos: string[] = [];
  const dados: Partial<DadosReajuste> = {};
  if (c.processo) dados.nup = c.processo;
  dados.empresa = { nome: c.fornecedor?.nome ?? "", cnpj: c.fornecedor?.cnpj_cpf_idgener ?? "", endereco: "", representante: "" };
  const lic = licitacaoDoGov(c.modalidade, c.licitacao_numero);
  if (lic) dados.licitacao = lic;
  if (c.objeto) { dados.objeto_completo = c.objeto.replace(/\s+/g, " ").trim(); dados.objeto_resumido = resumirObjeto(c.objeto); }

  // itens: o valor total do item no Contratos.gov.br é o do período do contrato (base ANUAL num contrato de 12 meses)
  const its: ItemContrato[] = itens
    .map((i) => ({ item: Number(so(i.numero_item_compra)) || 0, descricao: (i.descricao_complementar ?? "").replace(/\s+/g, " ").trim(),
      qtd: numBR(i.quantidade), valor_unit: numBR(i.valorunitario), valor_base: numBR(i.valortotal) }))
    .sort((a, b) => a.item - b.item);
  if (its.length) dados.itens = its;
  // conferência do item (valor = unitário × qtd × fator): se unitário × qtd já dá o total do item, a qtd é a do
  // período e o fator é 1 (o padrão da base ANUAL é 12, de preço mensal)
  const bate = (i: ItemContrato) => i.qtd != null && i.valor_unit != null && i.valor_base != null &&
    Math.abs(i.qtd * i.valor_unit - i.valor_base) <= Math.max(0.05, i.valor_base * 0.001);
  if (its.length && its.every(bate)) dados.fator_anual = 1;

  // termos em ordem de assinatura: o contrato, os aditivos e as apostilas. Item 5 pelas regras da SCON
  // (docs/ITEM5_HISTORICO.md, 23/11/2026): nº do termo pelo número dele no Contratos.gov.br ("00002/2025" → 2º);
  // apostila sem reajuste/repactuação fica fora do histórico (não muda o valor); aditivo com a qualificação
  // "ACRÉSCIMO / SUPRESSÃO" também vai para "Supressões e acréscimos".
  const termos = historico
    .map((h) => ({ h, tipo: tipoTermo(h.tipo) }))
    .filter((x): x is { h: HistoricoGov; tipo: NonNullable<ReturnType<typeof tipoTermo>> } => !!x.tipo)
    .sort((a, b) => (iso(a.h.data_assinatura) ?? "").localeCompare(iso(b.h.data_assinatura) ?? ""));
  const historico_valores: HistoricoValor[] = [];
  const alteracoes: AlteracaoQuantitativa[] = [];
  const documentos: DocumentoCarga[] = [];
  const reajustes: Reajuste[] = [];
  let kTa = 0, kAp = 0, supressao = false, semTipo = false;
  for (const { h, tipo } of termos) {
    const novo = numBR(h.novo_valor_global);
    const valor = novo && novo > 0 ? novo : numBR(h.valor_global);
    const nTermo = /^0*(\d{1,3})\s*\//.exec(String(h.numero ?? "").trim());
    const ordem = tipo === "TERMO_ADITIVO" ? ++kTa : tipo === "APOSTILAMENTO" ? ++kAp : 0;
    const k = nTermo && Number(nTermo[1]) > 0 ? Number(nTermo[1]) : ordem;
    if (tipo !== "CONTRATO" && !nTermo) avisos.push(`${h.tipo} ${h.numero || "sem número"}: número do termo não lido, ficou ${ORD(k)} pela ordem de assinatura — confira`);
    const nome = tipo === "CONTRATO" ? "Contrato inicial" : tipo === "TERMO_ADITIVO" ? `${ORD(k)} Termo Aditivo` : `${ORD(k)} Termo de Apostilamento`;
    const natureza = (h.qualificacao_termo ?? []).map((q) => q.descricao);
    const obs = (h.observacao ?? "").replace(/\s+/g, " ").trim();
    const comReajuste = /reajust|repactua/i.test(`${obs} ${natureza.join(" ")}`);
    if (tipo !== "APOSTILAMENTO" || comReajuste) historico_valores.push({ documento: nome, valor });
    if (tipo === "TERMO_ADITIVO" && natureza.some((q) => /acr[ée]scimo|supress/i.test(q))) {
      alteracoes.push({ documento: nome, data_assinatura: brData(h.data_assinatura) ?? "", descricao: obs });
      if (/supress/i.test(obs)) supressao = true;
      else if (!/acr[ée]scimo|acrescent/i.test(obs)) semTipo = true;
    }
    documentos.push({ tipo, numero: h.numero, natureza, data_assinatura: brData(h.data_assinatura),
      valor_resultante: valor, resumo: obs.slice(0, 300), origem: "Contratos.gov.br" });
    if (tipo === "APOSTILAMENTO" && /reajust/i.test(obs) && !/repactua/i.test(obs)) {
      const pct = /(\d{1,2},\d{2,6})\s*%/.exec(obs)?.[1];
      reajustes.push({ n: reajustes.length + 1, indice_pct: pct ? numBR(pct) : null, novo: false, documento: nome });
    }
  }
  if (historico_valores.length) dados.historico_valores = historico_valores;
  if (alteracoes.length) {
    dados.alteracoes_quantitativas = alteracoes;
    // regra da SCON: com supressão, o complemento da supressão entra no termo
    if (supressao) dados.complemento_supressao = true;
    else if (semTipo) avisos.push("Aditivo de acréscimo/supressão: a observação não diz se é supressão — marque \"Incluir o complemento\" se for");
  }
  // nº do próximo apostilamento pelas apostilas registradas (confira: apostila fora do sistema não entra na conta)
  if (termos.length) dados.numero_instrumento = proximoApostilamento(documentos);
  if (reajustes.length) {
    dados.reajustes = reajustes;
    if (reajustes.some((r) => r.indice_pct == null)) avisos.push("Reajuste já aplicado sem o percentual no Contratos.gov.br: confira no termo de apostilamento");
  }

  // base dos valores: contrato de cerca de 12 meses = ANUAL; outro prazo = TOTAL
  const inicial = termos.find((t) => t.tipo === "CONTRATO")?.h;
  const m = meses(inicial?.vigencia_inicio ?? c.vigencia_inicio, inicial?.vigencia_fim ?? c.vigencia_fim);
  if (its.length && m != null) {
    dados.base = m >= 11 && m <= 13 ? "ANUAL" : "TOTAL";
    if (dados.base === "TOTAL") avisos.push(`Contrato de ${m} meses: base TOTAL sugerida — confira (a SCON costuma usar ANUAL)`);
  }

  // dotação: o empenho mais recente; o PTRES às vezes vem vazio nele, então o do empenho anterior do mesmo PI
  const nes = [...empenhos].sort((a, b) => b.numero.localeCompare(a.numero));
  const ultimo = nes.find((e) => e.fonte_recurso && e.naturezadespesa) ?? null;
  let ultimo_empenho: Record<string, unknown> | null = null;
  if (ultimo) {
    const pi = (ultimo.planointerno ?? "").split(" - ")[0].trim();
    const ptres = ultimo.programa_trabalho || nes.find((e) => e.programa_trabalho && (e.planointerno ?? "").startsWith(pi))?.programa_trabalho || "";
    const orc: Orcamento = {
      gestao_unidade: ultimo.gestao && ultimo.unidade_gestora ? `${ultimo.gestao}/${ultimo.unidade_gestora}` : "",
      fonte: ultimo.fonte_recurso ?? "", programa_trabalho: ptres, plano_interno: pi,
      natureza_despesa: (ultimo.naturezadespesa ?? "").split(" - ")[0].trim(),
      exercicio: Number(ultimo.numero.slice(0, 4)) || new Date().getFullYear(),
    };
    dados.orcamento = orc;
    ultimo_empenho = { ne: ultimo.numero, data: ultimo.data_emissao, origem: "Contratos.gov.br" };
    if (!ptres) avisos.push(`Último empenho (${ultimo.numero}) sem PTRES no Contratos.gov.br`);
  }
  return { dados, documentos, ultimo_empenho, avisos };
}

const VAZIO = (v: unknown) => v == null || v === "" || (Array.isArray(v) && !v.length) ||
  (typeof v === "object" && !Array.isArray(v) && !Object.values(v as object).some((x) => x != null && x !== "" && x !== false));

/** Completa o cadastro só onde está vazio (o que a SCON digitou ou a carga trouxe não muda).
 *  Devolve também a lista do que foi preenchido. */
export function completarCadastro(atual: Partial<DadosReajuste>, gov: Partial<DadosReajuste>): { dados: Partial<DadosReajuste>; preenchidos: string[] } {
  const out = structuredClone(atual) as Record<string, unknown>;
  const preenchidos: string[] = [];
  for (const [k, v] of Object.entries(gov as Record<string, unknown>)) {
    if (VAZIO(v)) continue;
    // o fator da conferência só vale para os itens do Contratos.gov.br
    if (k === "fator_anual") {
      if (preenchidos.includes("itens") && VAZIO(out.fator_anual)) { out.fator_anual = v; preenchidos.push(k); }
      continue;
    }
    if (k === "reajustes") {
      const temAplicado = ((out.reajustes ?? []) as Reajuste[]).some((r) => !r.novo);
      if (!temAplicado) { out.reajustes = [...(v as Reajuste[]), ...((out.reajustes ?? []) as Reajuste[]).filter((r) => r.novo)]; preenchidos.push("reajustes já aplicados"); }
      continue;
    }
    // histórico só com o "Contrato inicial" conta como vazio; lista maior nunca é trocada por uma menor
    if (k === "historico_valores") {
      if (historicoEntra(out.historico_valores as HistoricoValor[] | undefined, v as HistoricoValor[], false)) { out.historico_valores = structuredClone(v); preenchidos.push(k); }
      continue;
    }
    // o complemento da supressão acompanha as supressões que entraram agora
    if (k === "complemento_supressao") {
      if (preenchidos.includes("alteracoes_quantitativas")) { out.complemento_supressao = v; preenchidos.push(k); }
      continue;
    }
    if (typeof v === "object" && !Array.isArray(v)) {
      const base = { ...((out[k] ?? {}) as Record<string, unknown>) };
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (VAZIO(v2) || !VAZIO(base[k2])) continue;
        base[k2] = v2;
        preenchidos.push(`${k}.${k2}`);
      }
      out[k] = base;
    } else if (VAZIO(out[k])) {
      out[k] = structuredClone(v);
      preenchidos.push(k);
    }
  }
  return { dados: out as Partial<DadosReajuste>, preenchidos };
}
