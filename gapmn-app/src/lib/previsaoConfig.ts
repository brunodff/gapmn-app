/**
 * Leitura e gravação dos ajustes manuais da previsão (tabela contratos_previsao).
 * Sem a tabela (migração ainda não executada) a previsão funciona no automático
 * e só a gravação de ajustes fica indisponível.
 */
import { supabase } from "./supabase";
import type { CfgPrevisao, Regime } from "./previsaoContratos";

const COLUNAS = "numero_contrato, regime, valor_mensal, observacao, updated_nome, updated_at";

export async function carregarCfgs(): Promise<{ cfgs: Map<string, CfgPrevisao>; disponivel: boolean }> {
  const { data, error } = await supabase.from("contratos_previsao").select(COLUNAS);
  if (error) return { cfgs: new Map(), disponivel: false };
  const cfgs = new Map<string, CfgPrevisao>();
  for (const r of (data ?? []) as CfgPrevisao[]) cfgs.set(r.numero_contrato, r);
  return { cfgs, disponivel: true };
}

/**
 * Grava o ajuste do contrato. Sem regime, sem valor e sem observação, o ajuste é
 * removido e o contrato volta ao automático. Retorna o registro gravado (ou null).
 */
export async function salvarCfg(
  numero_contrato: string,
  regime: Regime | null,
  valor_mensal: number | null,
  observacao: string | null,
): Promise<{ ok: true; cfg: CfgPrevisao | null } | { ok: false; erro: string }> {
  if (regime === null && valor_mensal === null && !observacao) {
    const { error } = await supabase.from("contratos_previsao").delete().eq("numero_contrato", numero_contrato);
    return error ? { ok: false, erro: error.message } : { ok: true, cfg: null };
  }
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("nome_guerra").eq("id", user?.id ?? "").maybeSingle();
  const { data, error } = await supabase
    .from("contratos_previsao")
    .upsert({
      numero_contrato, regime, valor_mensal, observacao,
      updated_by: user?.id ?? null,
      updated_nome: (profile as { nome_guerra?: string } | null)?.nome_guerra ?? user?.email ?? "Usuário",
      updated_at: new Date().toISOString(),
    }, { onConflict: "numero_contrato" })
    .select(COLUNAS)
    .single();
  return error ? { ok: false, erro: error.message } : { ok: true, cfg: data as CfgPrevisao };
}
