// src/lib/mcpCompras.ts
// Cliente do MCP Compras.gov.br via Edge Function `pesquisa-precos`, mais a
// estatística da pesquisa de preços (IN SEGES/ME 65/2021) e a leitura do TR.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { supabase } from "./supabase";
import { extrairItensTabela, trechosDaPagina, type Trecho } from "./trParser";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// ── Tipos ────────────────────────────────────────────────────────────────────

export type TipoItem = "material" | "servico";
export type Criterio = "mediana" | "media" | "menor";

export interface ItemTR {
  id: string;
  numero: number;
  tipo: TipoItem;
  codigo: number | null;
  descricao: string;
  unidade: string;
  quantidade: number | null;
  /** Valor unitário estimado que já consta no TR (se houver). */
  valorReferencia: number | null;
}

/** Registro de preço como vem de /modulo-pesquisa-preco (Dados Abertos). */
export interface RegistroPreco {
  idCompraItem?: string;
  idCompra?: number | string;
  dataCompra?: string;
  dataResultado?: string;
  precoUnitario?: number;
  quantidade?: number;
  niFornecedor?: string;
  nomeFornecedor?: string;
  marca?: string | null;
  siglaUnidadeFornecimento?: string | null;
  nomeUnidadeFornecimento?: string | null;
  capacidadeUnidadeFornecimento?: number | null;
  siglaUnidadeMedida?: string | null;
  codigoUasg?: string;
  nomeUasg?: string;
  nomeOrgao?: string;
  estado?: string;
  municipio?: string;
  modalidade?: number;
  forma?: string;
  descricaoDetalhadaItem?: string;
  descricaoItem?: string;
}

export interface Estatisticas {
  n: number;
  media: number;
  mediana: number;
  desvio_padrao: number;
  coeficiente_variacao: number;
  minimo: number;
  maximo: number;
  q1: number;
  q3: number;
  outliers: number;
}

export interface Cluster { n: number; minimo: number; maximo: number; mediana: number; media: number }

/** Payload de `compras_pesquisar_precos_para_etp`. */
export interface ResultadoETP {
  amostra_total: number;
  amostra_efetiva?: number;
  outliers_descartados?: number;
  estatisticas: Omit<Estatisticas, "n" | "outliers"> | null;
  registros: RegistroPreco[];
  clusters?: Cluster[];
  aviso?: string;
  aviso_heterogeneidade?: string;
  aviso_amostra_minima_por_cluster?: string;
  data_inicio?: string;
  data_fim?: string;
  _registros_truncados_em?: number | null;
  _erro_upstream?: { diagnostico?: string; alternativas?: string[] };
  /** UFs cuja consulta falhou numa pesquisa com vários estados (as demais foram somadas). */
  _ufs_com_erro?: string[];
}

/** Uma consulta feita à API de Dados Abertos, com o endereço para conferir no navegador. */
export interface FonteConsulta {
  uf: string | null;        // null = âmbito nacional
  url: string;
  encontrados: number;
  consultadoEm: string;     // ISO
}

export interface ItemCatalogo {
  descricaoItem?: string;
  nomePdm?: string;
  nomeClasse?: string;
  nomeServico?: string;
  descricaoServico?: string;
  statusItem?: boolean;
}

// ── Chamadas ao MCP ──────────────────────────────────────────────────────────

async function invocar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("pesquisa-precos", { body });
  if (error) {
    // FunctionsHttpError traz o corpo em error.context
    let detalhe = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) detalhe = (await ctx.json()).error ?? detalhe;
    } catch { /* corpo não-JSON */ }
    throw new Error(detalhe);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export async function mcpTool<T = unknown>(tool: string, args: Record<string, unknown>): Promise<T> {
  const { result } = await invocar<{ result: T }>({ action: "call", tool, arguments: args });
  return result;
}

export const API_DADOS_ABERTOS = "https://dadosabertos.compras.gov.br";

const isoDia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Endereço da consulta de preços na API de Dados Abertos — mesma chamada que o
 * MCP faz (1ª página), para o analista conferir o resultado no navegador.
 */
export function urlConsultaPreco(p: {
  tipo: TipoItem; codigo: number; dataInicio: string; dataFim: string; uf?: string | null;
}): string {
  const rota = p.tipo === "material" ? "1_consultarMaterial" : "3_consultarServico";
  const q = new URLSearchParams({ pagina: "1", tamanhoPagina: "500" });
  if (p.tipo === "material") { q.set("tipo", "codigoItemCatalogo"); q.set("codigo", String(p.codigo)); }
  else q.set("codigoItemCatalogo", String(p.codigo));
  q.set("dataCompraInicio", p.dataInicio);
  q.set("dataCompraFim", p.dataFim);
  if (p.uf) q.set("estado", p.uf);
  return `${API_DADOS_ABERTOS}/modulo-pesquisa-preco/${rota}?${q.toString()}`;
}

export function urlCatalogo(tipo: TipoItem, codigo: number): string {
  return tipo === "material"
    ? `${API_DADOS_ABERTOS}/modulo-material/4_consultarItemMaterial?pagina=1&tamanhoPagina=10&codigoItem=${codigo}`
    : `${API_DADOS_ABERTOS}/modulo-servico/6_consultarItemServico?pagina=1&tamanhoPagina=10&codigoServico=${codigo}`;
}

/** Agrupa valores em até 3 faixas pelos maiores saltos relativos (≥30%) — mesmo critério do MCP. */
function clusterizarPorGap(valores: number[]): Cluster[] {
  const s = [...valores].sort((a, b) => a - b);
  const resumir = (v: number[]): Cluster => ({
    n: v.length, minimo: v[0], maximo: v[v.length - 1], mediana: mediana(v), media: v.reduce((a, b) => a + b, 0) / v.length,
  });
  if (s.length < 4) return [resumir(s)];
  const saltos: [number, number][] = [];
  for (let i = 1; i < s.length; i++) {
    if (s[i - 1] > 0 && (s[i] - s[i - 1]) / s[i - 1] >= 0.3) saltos.push([(s[i] - s[i - 1]) / s[i - 1], i]);
  }
  if (!saltos.length) return [resumir(s)];
  const cortes = saltos.sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, i]) => i).sort((a, b) => a - b);
  const faixas: Cluster[] = [];
  let ini = 0;
  for (const c of cortes) { faixas.push(resumir(s.slice(ini, c))); ini = c; }
  faixas.push(resumir(s.slice(ini)));
  return faixas;
}

/** Soma as pesquisas de vários estados e recalcula as estatísticas sobre o conjunto. */
function mesclarETP(parciais: { uf: string; etp: ResultadoETP }[], falhas: string[]): ResultadoETP {
  const vistos = new Set<string>();
  const registros: RegistroPreco[] = [];
  for (const { etp } of parciais) {
    for (const r of etp.registros ?? []) {
      const k = r.idCompraItem;
      if (k && vistos.has(k)) continue;
      if (k) vistos.add(k);
      registros.push(r);
    }
  }
  const amostraTotal = parciais.reduce((s, p) => s + (p.etp.amostra_total ?? 0), 0);
  const valores = registros.map((r) => r.precoUnitario).filter((v): v is number => typeof v === "number");
  const base: ResultadoETP = {
    amostra_total: amostraTotal,
    registros,
    estatisticas: null,
    data_inicio: parciais[0]?.etp.data_inicio,
    data_fim: parciais[0]?.etp.data_fim,
    ...(falhas.length ? { _ufs_com_erro: falhas } : {}),
  };
  const est = calcularEstatisticas(valores);
  if (!est) return { ...base, aviso: "Nenhum preço unitário encontrado nos estados selecionados." };

  const { n, outliers, ...resto } = est;
  const { filtrados } = filtrarOutliers(valores);
  const razao = est.minimo > 0 ? est.maximo / est.minimo : 1;
  const heterogenea = (est.coeficiente_variacao > 0.5 || razao > 3) && filtrados.length >= 4;
  return {
    ...base,
    estatisticas: resto,
    amostra_efetiva: n,
    outliers_descartados: outliers,
    ...(heterogenea ? {
      clusters: clusterizarPorGap(filtrados),
      aviso_heterogeneidade: `Amostra heterogênea (CV=${(est.coeficiente_variacao * 100).toFixed(0)}%).`,
    } : {}),
  };
}

/**
 * Pesquisa de preços de um item. Com 0 ou 1 UF é uma chamada só (estatística do
 * MCP); com várias UFs faz uma consulta por estado e junta os resultados.
 */
export async function pesquisarPrecosETP(p: {
  tipo: TipoItem; codigo: number; periodoMeses: number; ufs: string[]; maxPaginas: number;
}): Promise<{ etp: ResultadoETP; consultas: FonteConsulta[] }> {
  const hoje = new Date();
  const ini = new Date(hoje.getTime() - p.periodoMeses * 30 * 86400000);
  const alvos: (string | null)[] = p.ufs.length ? p.ufs : [null];

  const chamar = (uf: string | null) => mcpTool<ResultadoETP>("compras_pesquisar_precos_para_etp", {
    tipo: p.tipo,
    codigo_item_catalogo: p.codigo,
    periodo_meses: p.periodoMeses,
    max_paginas: p.maxPaginas,
    ...(uf ? { uf } : {}),
  });

  // No máximo 4 estados ao mesmo tempo, para não sobrecarregar o MCP.
  const saidas: PromiseSettledResult<ResultadoETP>[] = new Array(alvos.length);
  let prox = 0;
  await Promise.all(Array.from({ length: Math.min(4, alvos.length) }, async () => {
    while (prox < alvos.length) {
      const i = prox++;
      try { saidas[i] = { status: "fulfilled", value: await chamar(alvos[i]) }; }
      catch (reason) { saidas[i] = { status: "rejected", reason }; }
    }
  }));

  const consultadoEm = new Date().toISOString();
  const consultas: FonteConsulta[] = [];
  const ok: { uf: string; etp: ResultadoETP }[] = [];
  const falhas: string[] = [];
  saidas.forEach((s, i) => {
    const uf = alvos[i];
    if (s.status === "fulfilled" && !s.value._erro_upstream) {
      ok.push({ uf: uf ?? "", etp: s.value });
      consultas.push({
        uf,
        url: urlConsultaPreco({
          tipo: p.tipo, codigo: p.codigo, uf,
          dataInicio: s.value.data_inicio ?? isoDia(ini), dataFim: s.value.data_fim ?? isoDia(hoje),
        }),
        encontrados: s.value.amostra_total ?? 0,
        consultadoEm,
      });
    } else falhas.push(uf ?? "Nacional");
  });

  if (!ok.length) {
    const primeira = saidas[0];
    if (primeira.status === "fulfilled") return { etp: primeira.value, consultas: [] };
    throw primeira.reason;
  }
  if (alvos.length === 1) return { etp: ok[0].etp, consultas };
  return { etp: mesclarETP(ok, falhas), consultas };
}

export async function consultarCatalogo(tipo: TipoItem, codigo: number): Promise<ItemCatalogo | null> {
  const tool = tipo === "material" ? "compras_catmat_consultar" : "compras_catser_consultar";
  const r = await mcpTool<{ encontrado: boolean; item: ItemCatalogo | null }>(tool, { codigo_item: codigo });
  return r.encontrado ? r.item : null;
}

export async function extrairItensIA(texto: string): Promise<{ objeto: string | null; itens: ItemTR[] }> {
  const r = await invocar<{ objeto: string | null; itens: Array<Record<string, unknown>> }>({
    action: "extrair_itens",
    texto: selecionarTrechosRelevantes(texto, 12000),
  });
  const itens = r.itens.map((it, i) => normalizarItem({
    numero: Number(it.numero) || i + 1,
    tipo: it.tipo === "servico" ? "servico" : "material",
    codigo: it.codigo == null ? null : Number(String(it.codigo).replace(/\D/g, "")) || null,
    descricao: String(it.descricao ?? "").trim(),
    unidade: String(it.unidade ?? "").trim(),
    quantidade: parseNumero(it.quantidade),
    valorReferencia: parseNumero(it.valor_unitario),
  }));
  return { objeto: r.objeto, itens };
}

// ── Estatística (mesmo método do MCP: quartis por mediana das metades + Tukey) ──

function mediana(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quartis(v: number[]): [number, number, number] {
  if (!v.length) return [0, 0, 0];
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  const metade = Math.floor(n / 2);
  const q1 = metade > 0 ? mediana(s.slice(0, metade)) : s[0];
  const q3 = metade + (n % 2) < n ? mediana(s.slice(metade + (n % 2))) : s[n - 1];
  return [q1, mediana(s), q3];
}

/** Separa outliers pelo critério de Tukey (Q1 − 1,5·IQR, Q3 + 1,5·IQR). */
export function filtrarOutliers(valores: number[]): { filtrados: number[]; descartados: number[] } {
  if (valores.length < 4) return { filtrados: valores, descartados: [] };
  const [q1, , q3] = quartis(valores);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  return {
    filtrados: valores.filter((v) => v >= lo && v <= hi),
    descartados: valores.filter((v) => v < lo || v > hi),
  };
}

export function calcularEstatisticas(valores: number[]): Estatisticas | null {
  if (!valores.length) return null;
  const { filtrados, descartados } = filtrarOutliers(valores);
  const base = filtrados.length ? filtrados : valores;
  const media = base.reduce((a, b) => a + b, 0) / base.length;
  const desvio = base.length > 1
    ? Math.sqrt(base.reduce((a, b) => a + (b - media) ** 2, 0) / base.length)
    : 0;
  const [q1, med, q3] = quartis(base);
  return {
    n: base.length,
    media,
    mediana: med,
    desvio_padrao: desvio,
    coeficiente_variacao: media ? desvio / media : 0,
    minimo: Math.min(...base),
    maximo: Math.max(...base),
    q1, q3,
    outliers: descartados.length,
  };
}

export function valorPorCriterio(e: Estatisticas, c: Criterio): number {
  return c === "media" ? e.media : c === "menor" ? e.minimo : e.mediana;
}

export const CRITERIO_LABEL: Record<Criterio, string> = {
  mediana: "Mediana",
  media: "Média",
  menor: "Menor preço",
};

// ── Leitura do TR ────────────────────────────────────────────────────────────

/**
 * Lê o PDF devolvendo o texto (com quebras de linha, para IA e regras) e os
 * trechos posicionados (para ler a tabela de itens pela geometria).
 */
export async function lerPdf(dados: ArrayBuffer): Promise<{ texto: string; trechos: Trecho[] }> {
  const pdf = await pdfjsLib.getDocument({ data: dados }).promise;
  const paginas: string[] = [];
  const trechos: Trecho[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    trechos.push(...trechosDaPagina(content.items as TextItem[], i));
    let linha = "";
    const linhas: string[] = [];
    for (const it of content.items as TextItem[]) {
      if (typeof it.str !== "string") continue;
      linha += it.str;
      if (it.hasEOL) { linhas.push(linha.trim()); linha = ""; } else if (it.str) linha += " ";
    }
    if (linha.trim()) linhas.push(linha.trim());
    paginas.push(linhas.filter(Boolean).join("\n"));
  }
  return { texto: paginas.join("\n\n"), trechos };
}

/** Itens lidos da tabela do TR (coluna CATMAT/CATSER). [] se não houver tabela reconhecível. */
export function extrairItensDaTabela(trechos: Trecho[]): ItemTR[] {
  return extrairItensTabela(trechos).map((it) => normalizarItem(it));
}

const RX_CODIGO = /\b(CATMAT|CATSER|C[ÓO]D(?:IGO)?\.?\s*(?:SIASG|CATMAT|CATSER|DO\s+ITEM)?)\s*(?:N[º°o.]*)?\s*[:\-–]?\s*(\d{3,6})\b/gi;

/**
 * Mantém o texto dentro do limite do LLM priorizando os trechos com tabela de
 * itens (CATMAT/CATSER, quantidade, unidade). TRs longos têm dezenas de páginas
 * de cláusulas que não ajudam a extrair itens.
 */
export function selecionarTrechosRelevantes(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const blocos = texto.split(/\n{2,}|(?<=\n)(?=\s*\d{1,3}[.)]\s)/).flatMap((b) =>
    b.length > 2000 ? b.match(/[\s\S]{1,2000}/g) ?? [] : [b]);
  const pontuar = (b: string) =>
    (b.match(RX_CODIGO)?.length ?? 0) * 5 +
    (b.match(/\b(quantidade|qtd|unidade|und|item|lote|especifica[çc][ãa]o|valor unit)/gi)?.length ?? 0) +
    (/\bobjeto\b/i.test(b) ? 3 : 0);
  const ranqueados = blocos.map((b, i) => ({ b, i, p: pontuar(b) })).sort((a, b) => b.p - a.p);
  const escolhidos: typeof ranqueados = [];
  let total = 0;
  for (const r of ranqueados) {
    if (r.p === 0 || total + r.b.length > limite) continue;
    escolhidos.push(r);
    total += r.b.length;
  }
  return escolhidos.sort((a, b) => a.i - b.i).map((r) => r.b).join("\n\n");
}

/**
 * Extração por regras (sem IA): cada código CATMAT/CATSER encontrado vira um
 * item, com a descrição tirada do texto em volta. Serve de fallback quando o
 * Groq não está disponível — o usuário revisa tudo na etapa de itens.
 */
const UNID = "(UN|UND|UNID\\w*|CX|CAIXA|PCT|PACOTE|KG|LT|LITRO|M2|M²|M|RESMA|FRASCO|GL|GAL[ÃA]O|SV|SERVI[ÇC]O|M[ÊE]S|EMB)";
const NUM = "(\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:,\\d+)?)";
const RX_UNID_QTD = new RegExp(`\\b${UNID}\\b\\W{0,3}${NUM}\\b`, "i");  // "UN 120"
const RX_QTD_UNID = new RegExp(`\\b${NUM}\\s*${UNID}\\b`, "i");         // "120 UN"

export function extrairItensRegras(texto: string): ItemTR[] {
  const vistos = new Set<number>();
  const itens: ItemTR[] = [];
  const linhas = texto.split("\n");
  linhas.forEach((linha, li) => {
    for (const m of linha.matchAll(RX_CODIGO)) {
      const codigo = Number(m[2]);
      if (vistos.has(codigo)) continue;
      vistos.add(codigo);
      // Descrição: o que vem antes do código na mesma linha (sem o nº do item);
      // se for curto demais, a tabela quebrou a linha — junta a anterior.
      let descricao = linha.slice(0, m.index)
        .replace(/^\s*\d{1,3}\s*[.)\-–|]?\s+/, "")
        .replace(/[\s\-–:|]+$/, "")
        .trim();
      if (descricao.length < 15 && li > 0) descricao = `${linhas[li - 1].trim()} ${descricao}`.trim();
      // Unidade e quantidade: só no resto da mesma linha.
      const depois = linha.slice((m.index ?? 0) + m[0].length);
      const uq = depois.match(RX_UNID_QTD);
      const qu = uq ? null : depois.match(RX_QTD_UNID);
      itens.push(normalizarItem({
        numero: itens.length + 1,
        tipo: /CATSER/i.test(m[1]) ? "servico" : "material",
        codigo,
        descricao: descricao.replace(/\s+/g, " ").slice(0, 300),
        unidade: (uq?.[1] ?? qu?.[2] ?? "").toUpperCase(),
        quantidade: parseNumero(uq?.[2] ?? qu?.[1] ?? null),
        valorReferencia: null,
      }));
    }
  });
  return itens;
}

/** Tenta achar o objeto da contratação no início do TR. */
export function extrairObjeto(texto: string): string {
  // Modelo com seção "OBJETO" ou, como no TR do GAP-MN, "1.1. Aquisição de ...".
  const m = texto.match(/OBJETO[^\n]{0,40}\n?([\s\S]{20,500}?)(?:\n\s*\n|\n\s*1\.\d|\n\s*2[.\s])/i)
    ?? texto.match(/\b\d\.\d\.?\s+((?:Aquisi[çc][ãa]o|Contrata[çc][ãa]o|Presta[çc][ãa]o)\b[\s\S]{10,500}?)(?:,\s*nos termos|,\s*conforme|\.\s)/i);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 400) : "";
}

export function extrairNup(texto: string): string {
  return texto.match(/\b(\d{5}\.\d{6}\/\d{4}-\d{2})\b/)?.[1] ?? "";
}

// ── Utilidades ───────────────────────────────────────────────────────────────

export function novoId() {
  return Math.random().toString(36).slice(2, 10);
}

export function normalizarItem(p: Omit<ItemTR, "id">): ItemTR {
  return { id: novoId(), ...p };
}

export function parseNumero(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const n = /,\d+$/.test(s) ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s.replace(/\.(?=\d{3}\b)/g, ""));
  return Number.isFinite(n) ? n : null;
}

export const fmtBRL = (v: number | null | undefined) =>
  v == null ? "–" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export const fmtNum = (v: number | null | undefined, casas = 2) =>
  v == null ? "–" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: casas }).format(v);

export const fmtData = (d?: string | null) =>
  d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "–";

export const UFS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB",
  "PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];
