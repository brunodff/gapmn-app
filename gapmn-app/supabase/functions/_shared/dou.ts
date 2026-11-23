// Busca no Diário Oficial da União, no mesmo jeito do Ro-dou (gestaogovbr/Ro-dou, clipping do DOU do Ministério
// da Gestão): a página de busca pública da Imprensa Nacional traz os resultados num JSON dentro do HTML
// (script ..._BuscaDouPortlet_params, campo jsonArray). Sem login e sem chave.

export const DOU_BUSCA = "https://www.in.gov.br/consulta/-/buscar/dou";
export type PeriodoDou = "dia" | "semana" | "mes" | "ano";

/** Busca exata (entre aspas) nas três seções; `delta` = resultados por página (a página padrão traz só 20) */
export function urlBuscaDou(termo: string, periodo: PeriodoDou = "semana", delta = 75): string {
  const q = new URLSearchParams({ q: `"${termo.replace(/"/g, "").trim()}"`, s: "todos", exactDate: periodo, sortType: "0", delta: String(delta) });
  return `${DOU_BUSCA}?${q}`;
}

export interface PublicacaoDou {
  id: string; titulo: string; tipo: string | null; secao: string | null; data: string | null;
  edicao: string | null; pagina: string | null; orgao: string | null; resumo: string; url: string | null;
}

const ENTIDADES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const textoLimpo = (s: unknown) =>
  String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTIDADES[e] ?? e).replace(/\s+/g, " ").trim();

/** "19/11/2026" → "2026-11-19" */
const isoDaData = (s: unknown) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? "").trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

/** Publicações da página de busca. Lança erro se a página não tiver a lista (layout mudou). */
export function lerBuscaDou(html: string): PublicacaoDou[] {
  const m = /<script[^>]*id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("a página de busca do DOU mudou: não achei a lista de resultados");
  const dados = JSON.parse(m[1]);
  const lista: Record<string, unknown>[] = Array.isArray(dados?.jsonArray) ? dados.jsonArray : [];
  return lista
    .filter((r) => r?.classPK || r?.urlTitle)
    .map((r) => ({
      id: String(r.classPK ?? r.urlTitle),
      titulo: textoLimpo(r.title),
      tipo: textoLimpo(r.artType) || null,
      secao: textoLimpo(r.pubName) || null,
      data: isoDaData(r.pubDate),
      edicao: textoLimpo(r.editionNumber) || null,
      pagina: textoLimpo(r.numberPage) || null,
      orgao: textoLimpo(r.hierarchyStr) || null,
      resumo: textoLimpo(r.content).slice(0, 600),
      url: r.urlTitle ? `https://www.in.gov.br/web/dou/-/${String(r.urlTitle)}` : null,
    }));
}
