// Estado dos filtros do Painel de Governança na URL, para o painel poder ser
// compartilhado por link já filtrado. Os filtros não mexem na competência de referência.

import type { Filtros, Status } from "./tipos.ts";

export const SLUG_STATUS: Record<Status, string> = {
  "Adequado": "adequado",
  "Atenção": "atencao",
  "Crítico": "critico",
  "Aguardando informação": "aguardando",
  "Sem dados no mês de referência": "sem-dados",
  "Sem meta": "sem-meta",
};

const STATUS_DO_SLUG = Object.fromEntries(
  Object.entries(SLUG_STATUS).map(([s, slug]) => [slug, s as Status]),
) as Record<string, Status>;

export type EstadoFiltros = Filtros & { competencia: string | null };

const lista = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export function lerFiltros(sp: URLSearchParams): EstadoFiltros {
  return {
    divisoes: lista(sp.get("div")),
    categorias: lista(sp.get("cat")),
    status: lista(sp.get("st")).map((s) => STATUS_DO_SLUG[s]).filter((s): s is Status => !!s),
    busca: sp.get("q") ?? "",
    competencia: sp.get("comp") || null,
  };
}

/** Devolve uma cópia de `sp` com os filtros gravados; vazios saem da URL. */
export function gravarFiltros(sp: URLSearchParams, f: Partial<EstadoFiltros>): URLSearchParams {
  const out = new URLSearchParams(sp);
  const por = (chave: string, valor: string) => (valor ? out.set(chave, valor) : out.delete(chave));
  if (f.divisoes !== undefined) por("div", f.divisoes.join(","));
  if (f.categorias !== undefined) por("cat", f.categorias.join(","));
  if (f.status !== undefined) por("st", f.status.map((s) => SLUG_STATUS[s]).join(","));
  // sem trim aqui: o campo de busca está ligado à URL e precisa aceitar espaço entre palavras
  if (f.busca !== undefined) por("q", f.busca.trim() ? f.busca : "");
  if (f.competencia !== undefined) por("comp", f.competencia ?? "");
  return out;
}

export function temFiltro(f: Filtros): boolean {
  return f.divisoes.length > 0 || f.categorias.length > 0 || f.status.length > 0 || f.busca.trim() !== "";
}
