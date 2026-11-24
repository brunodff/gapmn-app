// Ingestão da DNR (Módulo C) e leitura de e-mails (Módulos E e G).
// - Leitura do TR e do Ofício de Abertura de PAG (texto do PDF): PAG, nº da DNR, contratação do PCA, itens do PCA,
//   objeto e quem assinou o TR. Calibrada nos TRs do GAP-MN (modelo da AGU): "(Processo Administrativo n° …)",
//   item 2.2 "V) Identificador da Futura Contratação: 120630-262/2026" e "III) Id do item no PCA: 770", e as
//   assinaturas do SILOMS ("Assinado via ASSINATURA CADASTRAL por 1º Ten FULANO …").
// - Cruzamento DNR × PCA: o PAG do Ofício prevalece sobre o do TR; contratação ausente, inválida ou com objeto
//   incompatível vai para a fila de decisão humana (nunca vincula sozinho).
// - Planilha exportada do SILOMS: acha as colunas pelo nome.
// - Assuntos de e-mail da caixa licita.guarnaemn@gmail.com (CJU, impugnação, esclarecimento).
import { type Contratacao, type NovaIrregularidade } from "./tipos.ts";
import { RX_PAG, normalizarIdContratacao, normalizarPag, semAcento, semelhanca } from "./regras.ts";

export type TipoDocumento = "TR" | "OFICIO" | "OUTRO";
export interface LeituraDocumento {
  tipo: TipoDocumento;
  pag: string | null;
  /** todos os PAG diferentes no documento (o TR copiado de outro processo costuma ter dois) */
  pags: string[];
  numero_dnr: string | null;
  numero_contratacao: string | null;
  itens_pca: number[];
  objeto: string | null;
  assinante: string | null;
  data: string | null;
}

const limpo = (s: string) => s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
const umaLinha = (s: string) => s.replace(/\s+/g, " ").trim();

export function tipoDocumento(texto: string): TipoDocumento {
  const ini = semAcento(texto.slice(0, 4000));
  if (/termo de referencia|projeto basico/.test(ini)) return "TR";
  if (/oficio|abertura de (pag|processo)|autuacao/.test(ini)) return "OFICIO";
  return "OUTRO";
}

/** PAG preferido: no TR, o do "(Processo Administrativo nº …)"; no Ofício, o que aparece junto de PAG/NUP/processo */
function pagPreferido(texto: string, tipo: TipoDocumento): { pag: string | null; pags: string[] } {
  const todos: string[] = [];
  const rx = new RegExp(RX_PAG.source, "g");
  for (const m of texto.matchAll(rx)) { const p = normalizarPag(m[0]); if (p && !todos.includes(p)) todos.push(p); }
  if (!todos.length) return { pag: null, pags: [] };
  const perto = (rotulo: RegExp) => {
    const r = new RegExp(rotulo.source + "[^0-9]{0,40}(" + RX_PAG.source + ")", "i");
    const m = r.exec(texto);
    return m ? normalizarPag(m[1]) : null;
  };
  const pag = tipo === "TR"
    ? perto(/processo administrativo\s*n/) ?? perto(/\b(?:PAG|NUP)\b/) ?? todos[0]
    : perto(/\b(?:PAG|NUP)\b/) ?? perto(/processo administrativo/) ?? perto(/processo/) ?? todos[0];
  return { pag, pags: todos };
}

/** Quem assinou o TR: o Presidente/Integrante da Equipe de Planejamento; senão, a primeira assinatura eletrônica */
export function assinanteTr(texto: string): string | null {
  const linhas = texto.split(/\n/).map(umaLinha).filter(Boolean);
  for (let i = 1; i < linhas.length; i++) {
    if (/^(presidente|membro|integrante)( requisitante| t[eé]cnico| administrativo)?( d[ae] equipe de planejamento)?\b|equipe de planejamento$/i.test(linhas[i])) {
      const nome = linhas[i - 1].replace(/\s{2,}/g, " ");
      if (/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}( [A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}){1,}/.test(nome) && nome.length < 90) return nome;
    }
  }
  const m = /Assinado (?:via [A-ZÇÃ ]+ )?por (.{5,80}?) no dia/i.exec(umaLinha(texto));
  return m ? m[1].trim() : null;
}

export function lerDocumento(textoBruto: string, uasgPadrao = "120630"): LeituraDocumento {
  const texto = limpo(textoBruto);
  const tipo = tipoDocumento(texto);
  const { pag, pags } = pagPreferido(texto, tipo);
  const plano = umaLinha(texto);
  const dnr = /\b(?:DNR|Demanda N[ãa]o Recorrente)\s*(?:n[º°o.]*\s*)?[:-]?\s*(\d{1,6}(?:\s*\/\s*\d{4})?)/i.exec(plano);
  let contratacao = normalizarIdContratacao(/Identificador da Futura Contrata[çc][ãa]o\s*:?\s*([\d\s-]+\/\s*\d{4})/i.exec(plano)?.[1]);
  if (!contratacao) {
    const m = /(?:contrata[çc][ãa]o|PGC|PCA)[^.]{0,40}?\b(\d{6})\s*-\s*(\d{1,6})\s*\/\s*(\d{4})/i.exec(plano);
    if (m) contratacao = normalizarIdContratacao(`${m[1]}-${m[2]}/${m[3]}`);
  }
  if (!contratacao) {
    const m = /n[ºo°]?\s*da contrata[çc][ãa]o (?:no )?(?:PGC|PCA)\s*:?\s*(\d{1,6})\s*\/\s*(\d{4})/i.exec(plano);
    if (m) contratacao = `${uasgPadrao}-${Number(m[1])}/${m[2]}`;
  }
  const itens = /Id do item no PCA\s*:?\s*([\d,\s;e]+)/i.exec(plano)?.[1].match(/\d+/g)?.map(Number) ?? [];
  // objeto: a primeira cláusula 1.1 do documento (o TR repete "1.1." em anexos), até "nos termos da tabela"
  let objeto: string | null = null;
  const ini = /(?:^|\n)\s*1\.1\.?\s+/.exec(texto);
  if (ini) {
    const resto = texto.slice(ini.index + ini[0].length, ini.index + ini[0].length + 1500);
    const fim = /,?\s*nos termos d|,?\s*conforme condi|\.\s*\n|\n\s*1\.1\.1|\n\s*1\.2/.exec(resto);
    objeto = umaLinha(fim ? resto.slice(0, fim.index) : resto).replace(/\s*\[[^\]]*\]/g, "").slice(0, 400) || null;
  }
  // data do documento: "Manaus, 5 de fevereiro de 2027"; senão a última assinatura eletrônica (não a data de uma lei citada)
  const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const d = /Manaus\s*(?:-\s*AM|\/AM)?\s*,?\s*(?:em\s*)?(\d{1,2}) de (janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de (\d{4})/i.exec(plano);
  const assinaturas = [...plano.matchAll(/Assinado[^.]{0,120}? no dia (\d{2})\/(\d{2})\/(\d{4})/gi)];
  const ult = assinaturas[assinaturas.length - 1];
  const data = d ? `${d[3]}-${String(MESES.indexOf(semAcento(d[2])) + 1).padStart(2, "0")}-${d[1].padStart(2, "0")}`
    : ult ? `${ult[3]}-${ult[2]}-${ult[1]}` : null;
  return {
    tipo, pag, pags,
    numero_dnr: dnr ? dnr[1].replace(/\s+/g, "") : null,
    numero_contratacao: contratacao,
    itens_pca: [...new Set(itens)],
    objeto,
    assinante: tipo === "TR" ? assinanteTr(texto) : null,
    data,
  };
}

// ── DNR consolidada (TR + Ofício + o que a SLIC digitou) ─────────────────────
export interface DadosDnr {
  numero_dnr: string | null;
  data_chegada: string | null;
  pag_oficio: string | null;
  pag_tr: string | null;
  numero_contratacao: string | null;
  itens_pca: number[];
  objeto: string | null;
  assinante_tr: string | null;
  om_apoiada?: string | null;
  fonte: "upload" | "planilha" | "siloms" | "manual";
}

export function juntarLeituras(leituras: LeituraDocumento[]): Omit<DadosDnr, "data_chegada" | "fonte"> {
  const tr = leituras.find((l) => l.tipo === "TR");
  const of = leituras.find((l) => l.tipo === "OFICIO");
  const primeiro = <K extends keyof LeituraDocumento>(k: K) => leituras.map((l) => l[k]).find((v) => v != null && (!Array.isArray(v) || v.length)) ?? null;
  return {
    numero_dnr: (of?.numero_dnr ?? primeiro("numero_dnr")) as string | null,
    pag_oficio: of?.pag ?? null,
    pag_tr: tr?.pag ?? null,
    numero_contratacao: (tr?.numero_contratacao ?? primeiro("numero_contratacao")) as string | null,
    itens_pca: tr?.itens_pca ?? [],
    objeto: tr?.objeto ?? null,
    assinante_tr: tr?.assinante ?? null,
  };
}

export interface ResultadoCruzamento {
  /** contratação a vincular (só quando tudo bate) */
  contratacao: Contratacao | null;
  /** contratação provável, para a SLIC decidir */
  candidata: Contratacao | null;
  pag: string | null;
  irregularidades: NovaIrregularidade[];
}

/**
 * Cruzamento DNR × PCA (Módulo C). PAG: o do Ofício prevalece; divergência com o TR gera alerta, mas não impede o
 * vínculo. Contratação ausente, inválida, sem correspondência no PCA ou com objeto incompatível: fila de decisão.
 */
export function cruzarDnr(d: DadosDnr, pca: Contratacao[], limiar = 0.25): ResultadoCruzamento {
  const irr: NovaIrregularidade[] = [];
  const pag = d.pag_oficio ?? d.pag_tr;
  if (d.pag_oficio && d.pag_tr && d.pag_oficio !== d.pag_tr) {
    irr.push({ contratacao_id: null, tipo: "pag_divergente", descricao: `PAG do TR (${d.pag_tr}) diferente do PAG do Ofício de Abertura (${d.pag_oficio}). Vale o do Ofício; conferir e pedir a correção do TR.`, detalhe: { pag_oficio: d.pag_oficio, pag_tr: d.pag_tr } });
  }
  const id = normalizarIdContratacao(d.numero_contratacao);
  const porPag = pag ? pca.find((c) => c.numero_pag === pag) ?? null : null;
  const porId = id ? pca.find((c) => c.id_contratacao_pgc === id) ?? null : null;
  // candidata pelo objeto, para ajudar a SLIC quando o número falta ou não bate
  const porObjeto = d.objeto ? [...pca].map((c) => ({ c, s: semelhanca(d.objeto!, c.objeto) })).sort((a, b) => b.s - a.s)[0] : undefined;
  const candidata = porId ?? porPag ?? (porObjeto && porObjeto.s >= limiar ? porObjeto.c : null);

  if (porPag && porId && porPag.id !== porId.id) {
    irr.push({ contratacao_id: porId.id, tipo: "pag_em_uso", descricao: `O PAG ${pag} já está vinculado à contratação ${porPag.id_contratacao_pgc ?? porPag.objeto_resumido}, mas o TR indica a ${id}.`, detalhe: { pag, contratacao_do_pag: porPag.id, contratacao_do_tr: porId.id } });
    return { contratacao: null, candidata, pag, irregularidades: irr };
  }
  if (!d.numero_contratacao) {
    if (porPag) return { contratacao: porPag, candidata: porPag, pag, irregularidades: irr };
    irr.push({ contratacao_id: candidata?.id ?? null, tipo: "contratacao_ausente", descricao: "O TR não informa o número da contratação do PCA (item 2.2, \"Identificador da Futura Contratação\")." + (candidata ? ` Provável: ${candidata.id_contratacao_pgc ?? candidata.objeto_resumido}.` : ""), detalhe: { objeto: d.objeto } });
    return { contratacao: null, candidata, pag, irregularidades: irr };
  }
  if (!id) {
    irr.push({ contratacao_id: candidata?.id ?? null, tipo: "contratacao_invalida", descricao: `Número de contratação inválido no TR: "${d.numero_contratacao}" (esperado UASG-número/ano, ex.: 120630-110/2027).`, detalhe: { numero: d.numero_contratacao } });
    return { contratacao: null, candidata, pag, irregularidades: irr };
  }
  if (!porId) {
    irr.push({ contratacao_id: candidata?.id ?? null, tipo: "contratacao_invalida", descricao: `A contratação ${id} indicada no TR não está entre as contratações do PCA acompanhado${pca[0] ? ` (${pca[0].ano})` : ""}.` + (candidata ? ` Provável: ${candidata.id_contratacao_pgc ?? candidata.objeto_resumido}.` : ""), detalhe: { numero: id } });
    return { contratacao: null, candidata, pag, irregularidades: irr };
  }
  if (d.objeto) {
    const s = semelhanca(d.objeto, `${porId.objeto} ${porId.objeto_resumido ?? ""}`);
    if (s < limiar) {
      irr.push({ contratacao_id: porId.id, tipo: "objeto_incompativel", descricao: `O objeto do TR não parece o da contratação ${id} no PCA (semelhança ${Math.round(s * 100)}%). TR: "${d.objeto.slice(0, 120)}"; PCA: "${porId.objeto.slice(0, 120)}".`, detalhe: { semelhanca: s } });
      return { contratacao: null, candidata: porId, pag, irregularidades: irr };
    }
  }
  if (d.itens_pca.length && porId.itens_pca.length) {
    const fora = d.itens_pca.filter((n) => !porId.itens_pca.includes(n));
    if (fora.length) irr.push({ contratacao_id: porId.id, tipo: "item_fora_da_contratacao", descricao: `Item(ns) do PCA ${fora.join(", ")} citado(s) no TR não pertence(m) à contratação ${id}. Conferir o item 2.2 do TR.`, detalhe: { fora } });
  }
  if (porPag && porPag.id !== porId.id) {
    irr.push({ contratacao_id: porId.id, tipo: "pag_em_uso", descricao: `O PAG ${pag} já está em outra contratação.`, detalhe: { pag } });
    return { contratacao: null, candidata: porId, pag, irregularidades: irr };
  }
  return { contratacao: porId, candidata: porId, pag, irregularidades: irr.map((i) => ({ ...i, contratacao_id: i.contratacao_id ?? porId.id })) };
}

// ── Planilha exportada do SILOMS ─────────────────────────────────────────────
const COLUNAS: Record<keyof Omit<DadosDnr, "fonte" | "itens_pca" | "pag_tr">, string[]> = {
  numero_dnr: ["dnr", "numero da demanda", "n demanda", "demanda"],
  data_chegada: ["data de chegada", "data chegada", "chegada", "data de entrada", "data entrada", "recebimento", "data"],
  pag_oficio: ["pag", "nup", "processo"],
  numero_contratacao: ["contratacao", "pgc", "id pca", "identificador"],
  objeto: ["objeto", "descricao", "assunto"],
  assinante_tr: ["assinante", "responsavel", "requisitante"],
  om_apoiada: ["om", "unidade", "setor", "apoiada", "solicitante"],
};

/** Linhas da planilha (primeira linha com 2+ cabeçalhos conhecidos) → DNRs */
export function lerPlanilhaSiloms(linhas: unknown[][]): DadosDnr[] {
  const norm = (v: unknown) => semAcento(String(v ?? "")).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  let cab = -1; let mapa: Partial<Record<keyof typeof COLUNAS, number>> = {};
  for (let i = 0; i < Math.min(15, linhas.length) && cab < 0; i++) {
    const h = linhas[i].map(norm);
    const m: typeof mapa = {};
    for (const [campo, nomes] of Object.entries(COLUNAS) as [keyof typeof COLUNAS, string[]][]) {
      for (const nome of nomes) { const j = h.findIndex((x, k) => x === nome || (x.includes(nome) && !Object.values(m).includes(k))); if (j >= 0 && m[campo] == null) { m[campo] = j; break; } }
    }
    if (Object.keys(m).length >= 2 && (m.numero_dnr != null || m.pag_oficio != null)) { cab = i; mapa = m; }
  }
  if (cab < 0) return [];
  const val = (l: unknown[], k: keyof typeof COLUNAS) => (mapa[k] != null ? l[mapa[k]!] : null);
  const data = (v: unknown): string | null => {
    if (v == null || v === "") return null;
    if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); // serial do Excel
    const s = String(v).trim();
    const br = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  };
  const out: DadosDnr[] = [];
  for (const l of linhas.slice(cab + 1)) {
    const pag = normalizarPag(String(val(l, "pag_oficio") ?? ""));
    const dnr = String(val(l, "numero_dnr") ?? "").replace(/^dnr\s*/i, "").trim() || null;
    if (!pag && !dnr) continue;
    out.push({
      numero_dnr: dnr, data_chegada: data(val(l, "data_chegada")), pag_oficio: pag, pag_tr: null,
      numero_contratacao: normalizarIdContratacao(String(val(l, "numero_contratacao") ?? "")) ?? (String(val(l, "numero_contratacao") ?? "").trim() || null),
      itens_pca: [], objeto: String(val(l, "objeto") ?? "").trim() || null, assinante_tr: String(val(l, "assinante_tr") ?? "").trim() || null,
      om_apoiada: String(val(l, "om_apoiada") ?? "").trim() || null, fonte: "planilha",
    });
  }
  return out;
}

// ── E-mails da caixa da SLIC (Módulos E e G) ─────────────────────────────────
export type TipoEmail = "cju_envio" | "cju_retorno" | "impugnacao" | "esclarecimento" | null;
/** Tipo do e-mail pelo assunto (padrões combinados com a SLIC) */
export function tipoDoEmail(assunto: string, caixa: "enviados" | "entrada"): TipoEmail {
  const a = semAcento(assunto).toUpperCase();
  if (caixa === "enviados" && /SOLICITACAO DE ANALISE JURIDICA/.test(a)) return "cju_envio";
  if (caixa === "entrada" && /DEVOLUCAO DA ANALISE DO PROCESSO/.test(a)) return "cju_retorno";
  if (caixa === "entrada" && /IMPUGNA/.test(a)) return "impugnacao";
  if (caixa === "entrada" && /ESCLARECIMENTO/.test(a)) return "esclarecimento";
  return null;
}
/** PAG e nº do certame citados no assunto ou no corpo */
export function referenciasDoEmail(texto: string): { pag: string | null; certame: { numero: number; ano: number } | null } {
  const pag = normalizarPag(texto);
  const m = /(?:preg[ãa]o|dispensa|concorr[êe]ncia|certame|licita[çc][ãa]o)[^0-9]{0,40}?n?[º°o.]*\s*(\d{1,6})\s*\/\s*(\d{4})/i.exec(texto);
  return { pag, certame: m ? { numero: Number(m[1]), ano: Number(m[2]) } : null };
}
