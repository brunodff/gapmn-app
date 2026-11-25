// Leitura e gravação das unidades apoiadas (tabela apostilamento_unidades, migração 20261125c). Sem a tabela (migração
// ainda não aplicada) vale a configuração única antiga (apostilamento_config) como unidade padrão.
import { supabase } from "../supabase";
import { CONFIG_VAZIA, type ConfigApostilamento } from "./tipos";
import { normalizarUnidade, siglaLimpa, unidadeDaConfig, type UnidadeApoiada } from "./unidades";

const COLUNAS = "sigla, grafias, nome, ug, artigo, cefa, autoridade_superior, padrao, rascunho, ordenador, aci, ug_apoio, cidade, texto_fixo, dias_alerta, atualizado_em, atualizado_nome";

async function configAntiga(): Promise<ConfigApostilamento | null> {
  const { data } = await supabase.from("apostilamento_config").select("ordenador, aci, cidade, ug_apoio, textos_fixos_om, dias_alerta").eq("id", "padrao").maybeSingle();
  if (!data) return null;
  const g = data as Partial<ConfigApostilamento>;
  return { ...CONFIG_VAZIA, ...g, ordenador: { ...CONFIG_VAZIA.ordenador, ...(g.ordenador ?? {}) }, aci: { ...CONFIG_VAZIA.aci, ...(g.aci ?? {}) },
    ug_apoio: { ...CONFIG_VAZIA.ug_apoio, ...(g.ug_apoio ?? {}) }, textos_fixos_om: g.textos_fixos_om ?? {} };
}

/** Todas as unidades, a padrão primeiro. `tabela` = false quando a migração ainda não foi aplicada. */
export async function carregarUnidades(): Promise<{ unidades: UnidadeApoiada[]; tabela: boolean }> {
  const { data, error } = await supabase.from("apostilamento_unidades").select(COLUNAS).order("sigla");
  if (error) {
    const antiga = await configAntiga();
    return { unidades: antiga ? [unidadeDaConfig(antiga)] : [], tabela: false };
  }
  const lista = ((data ?? []) as (Partial<UnidadeApoiada> & { sigla: string })[]).map(normalizarUnidade);
  return { unidades: lista.sort((a, b) => Number(b.padrao) - Number(a.padrao) || a.sigla.localeCompare(b.sigla)), tabela: true };
}

/** Salva a unidade (nova ou editada). `siglaAntes` = a sigla de antes, se ela foi trocada na edição. */
export async function salvarUnidade(u: UnidadeApoiada, quem: string, siglaAntes?: string | null): Promise<void> {
  const sigla = siglaLimpa(u.sigla);
  if (!sigla) throw new Error("Informe a sigla da unidade.");
  const { data: s } = await supabase.auth.getSession();
  const linha = {
    sigla, grafias: u.grafias.map((g) => g.trim()).filter(Boolean), nome: u.nome?.trim() || null, ug: (u.ug ?? "").replace(/\D/g, "") || null,
    artigo: u.artigo, cefa: u.cefa, autoridade_superior: u.autoridade_superior?.trim() || null, padrao: u.padrao, rascunho: false,
    ordenador: { ...u.ordenador, om_sigla: sigla }, aci: u.aci, ug_apoio: { ...u.ug_apoio, sigla: u.ug_apoio.sigla || sigla }, cidade: u.cidade || "Manaus",
    texto_fixo: u.texto_fixo?.trim() || null, dias_alerta: u.padrao ? u.dias_alerta : null,
    atualizado_em: new Date().toISOString(), atualizado_por: s.session?.user.id ?? null, atualizado_nome: quem || null,
  };
  const { error } = await supabase.from("apostilamento_unidades").upsert(linha, { onConflict: "sigla" });
  if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? "A tabela das unidades apoiadas ainda não existe no banco (migração 20261125c_aditivos_rev4)." : error.message);
  if (siglaAntes && siglaLimpa(siglaAntes) !== sigla) {
    const { error: e2 } = await supabase.from("apostilamento_unidades").delete().eq("sigla", siglaLimpa(siglaAntes)).eq("padrao", false);
    if (e2) throw new Error(`Salvou como ${sigla}, mas não removeu o cadastro antigo (${siglaAntes}): ${e2.message}`);
  }
}

export async function removerUnidade(sigla: string): Promise<void> {
  const { error } = await supabase.from("apostilamento_unidades").delete().eq("sigla", siglaLimpa(sigla)).eq("padrao", false);
  if (error) throw new Error(error.message);
}
