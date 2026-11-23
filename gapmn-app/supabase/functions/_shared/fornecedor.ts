// Regras da verificação de fornecedor (função verificar-fornecedor, usada pelo Robô de Empenhos).

/** CNPJ da matriz (0001) do mesmo CNPJ básico, com os dígitos verificadores; null se já é a matriz ou é inválido.
 *  Sanção é da pessoa jurídica: a registrada na matriz vale para a filial que vende. */
export function cnpjDaMatriz(cnpj: string): string | null {
  const d = String(cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14 || d.slice(8, 12) === "0001") return null;
  const base = d.slice(0, 8) + "0001";
  const dv = (s: string) => {
    const pesos = s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = s.split("").reduce((soma, c, i) => soma + Number(c) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  return `${base}${d1}${dv(base + d1)}`;
}

/** Situação na Receita a partir do cadastro público de CNPJ (BrasilAPI ou Minha Receita, mesmos campos) */
export function situacaoReceita(j: Record<string, unknown> | null): { situacao_cadastral: string; razao_social: string } | null {
  const situacao = String(j?.descricao_situacao_cadastral ?? "").trim();
  return situacao ? { situacao_cadastral: situacao, razao_social: String(j?.razao_social ?? "") } : null;
}

/** Junta as listas das consultas (CNPJ da filial e da matriz) sem repetir a mesma sanção */
export function juntarSancoes(listas: unknown[][]): Record<string, unknown>[] {
  const vistos = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const lista of listas) {
    for (const r of (lista ?? []) as Record<string, unknown>[]) {
      const k = String(r?.id ?? JSON.stringify(r));
      if (vistos.has(k)) continue;
      vistos.add(k);
      out.push(r);
    }
  }
  return out;
}

/** CEPIM traz o órgão em `orgaoSuperior`: o robô lê `orgaoSancionador`, como no CEIS e no CNEP */
export function cepimComOrgao(r: Record<string, unknown>): Record<string, unknown> {
  const sup = (r?.orgaoSuperior ?? {}) as Record<string, unknown>;
  return r?.orgaoSancionador ? r : { ...r, orgaoSancionador: { nome: sup.nome ?? sup.sigla ?? undefined } };
}
