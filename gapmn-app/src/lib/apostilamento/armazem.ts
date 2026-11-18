// Onde fica o cadastro do reajuste de cada contrato: no banco do app (GAP-MN, contratos_apostilamento,
// com controle de versão) ou no navegador de quem usa (outras OMs da FAB, sem conta e sem servidor).
import { supabase } from "../supabase";
import type { CargaGuardada } from "./carga";
import type { DadosReajuste } from "./tipos";

export interface RegistroCadastro { dados: DadosReajuste | null; dedicacao_exclusiva: boolean; versao: number | null; carga: CargaGuardada | null }
export interface LinhaCadastro {
  numero_contrato: string; dados: DadosReajuste; reajustes_aplicados: number; dedicacao_exclusiva: boolean;
  situacao_cadastro: string; pendencias: string[];
}
export interface Armazem {
  local: boolean;
  carregar(numero: string): Promise<{ registro: RegistroCadastro | null; erro?: string }>;
  /** versao = a que foi lida (null = cadastro novo); devolve a nova versão ou o erro */
  salvar(linha: LinhaCadastro, versao: number | null, nomeUsuario: string): Promise<{ versao?: number; erro?: string }>;
}

export const armazemBanco: Armazem = {
  local: false,
  async carregar(numero) {
    const { data, error } = await supabase.from("contratos_apostilamento").select("dados, dedicacao_exclusiva, versao, carga")
      .eq("numero_contrato", numero).maybeSingle();
    if (error) return { registro: null, erro: error.message };
    if (!data) return { registro: null };
    return { registro: { dados: (data.dados ?? null) as DadosReajuste | null, dedicacao_exclusiva: !!data.dedicacao_exclusiva, versao: data.versao, carga: (data.carga ?? null) as CargaGuardada | null } };
  },
  async salvar(linha, versao, nomeUsuario) {
    const { data: s } = await supabase.auth.getSession();
    const agora = new Date().toISOString();
    const reg = { ...linha, atualizado_por: s.session?.user.id ?? null, atualizado_nome: nomeUsuario, atualizado_em: agora, editado_no_app_em: agora };
    if (versao == null) {
      const { error } = await supabase.from("contratos_apostilamento").insert({ ...reg, versao: 1 });
      if (error) return { erro: error.code === "23505" ? "outra pessoa criou o cadastro deste contrato agora — recarregue a página" : error.message };
      return { versao: 1 };
    }
    const { data, error } = await supabase.from("contratos_apostilamento").update({ ...reg, versao: versao + 1 })
      .eq("numero_contrato", linha.numero_contrato).eq("versao", versao).select("versao");
    if (error) return { erro: error.message };
    if (!data?.length) return { erro: "outra pessoa salvou este cadastro depois que você abriu — recarregue a página para não apagar o que ela fez" };
    return { versao: versao + 1 };
  },
};

/** Cadastro guardado só neste navegador (localStorage), por UG: "reajuste-om:<ug>:<nº do contrato>" */
export function armazemNavegador(ug: string): Armazem {
  const chave = (n: string) => `reajuste-om:${ug}:${n}`;
  return {
    local: true,
    async carregar(numero) {
      try {
        const s = localStorage.getItem(chave(numero));
        return { registro: s ? (JSON.parse(s) as RegistroCadastro) : null };
      } catch { return { registro: null, erro: "o navegador não deixou ler o que foi guardado" }; }
    },
    async salvar(linha, versao) {
      try {
        const reg: RegistroCadastro & { situacao_cadastro: string; pendencias: string[]; salvo_em: string } = {
          dados: linha.dados, dedicacao_exclusiva: linha.dedicacao_exclusiva, versao: (versao ?? 0) + 1, carga: null,
          situacao_cadastro: linha.situacao_cadastro, pendencias: linha.pendencias, salvo_em: new Date().toISOString(),
        };
        localStorage.setItem(chave(linha.numero_contrato), JSON.stringify(reg));
        return { versao: reg.versao ?? 1 };
      } catch { return { erro: "o navegador não deixou guardar (modo anônimo ou sem espaço)" }; }
    },
  };
}

/** Todos os cadastros de uma UG guardados neste navegador (para o painel e para o backup) */
export function cadastrosNoNavegador(ug: string): Record<string, RegistroCadastro & { situacao_cadastro?: string; pendencias?: string[] }> {
  const out: Record<string, RegistroCadastro & { situacao_cadastro?: string; pendencias?: string[] }> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      if (k.startsWith(`reajuste-om:${ug}:`)) out[k.slice(`reajuste-om:${ug}:`.length)] = JSON.parse(localStorage.getItem(k) ?? "null");
    }
  } catch { /* sem armazenamento */ }
  return out;
}
