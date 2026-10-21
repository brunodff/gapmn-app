// Leitura e gravação da minuta do PTA e dos comentários (tabelas pta_minutas e pta_comentarios).
// O banco só deixa ADMIN e DEV lerem e comentarem, e só o DEV gravar a minuta (migração 20261021_pta_minuta).

import { supabase } from "../supabase";
import type { ComposicaoPTA } from "./pta.ts";

export type ConteudoCap7 = ComposicaoPTA & { primeiroArtigo: number };

export type Minuta = {
  ano: number;
  secao: string;
  conteudo: ConteudoCap7;
  versao: number;
  atualizado_nome: string | null;
  atualizado_em: string;
};

export type Comentario = {
  id: string;
  ano: number;
  secao: string;
  alvo: string | null;
  alvo_rotulo: string | null;
  tipo: "comentario" | "de_acordo";
  texto: string;
  autor_id: string;
  autor_nome: string | null;
  criado_em: string;
  resolvido: boolean;
  resolvido_em: string | null;
};

const msg = (e: { message?: string } | null) => {
  const m = e?.message ?? "";
  if (/relation .* does not exist|could not find the table/i.test(m)) return "A minuta ainda não está habilitada no banco (falta aplicar a migração).";
  if (/row-level security|permission denied|42501/i.test(m)) return "Seu perfil não tem permissão para isso.";
  return m || "Erro ao falar com o banco.";
};

export async function lerMinuta(ano: number, secao: string): Promise<Minuta | null> {
  const { data, error } = await supabase.from("pta_minutas")
    .select("ano,secao,conteudo,versao,atualizado_nome,atualizado_em")
    .eq("ano", ano).eq("secao", secao).maybeSingle();
  if (error) throw new Error(msg(error));
  return (data as Minuta | null) ?? null;
}

/** Cria a minuta. Falha se ela já existir (outra pessoa criou antes). */
export async function criarMinuta(ano: number, secao: string, conteudo: ConteudoCap7): Promise<Minuta> {
  const { data, error } = await supabase.from("pta_minutas")
    .insert({ ano, secao, conteudo, versao: 1 })
    .select("ano,secao,conteudo,versao,atualizado_nome,atualizado_em").single();
  if (error) throw new Error(/duplicate key/i.test(error.message) ? "A minuta já foi criada. Recarregue a página." : msg(error));
  return data as Minuta;
}

/**
 * Salva por cima da versão `versao`. Se alguém salvou antes (versão mudou), não grava e avisa,
 * para ninguém apagar sem querer o trabalho do outro.
 */
export async function salvarMinuta(ano: number, secao: string, conteudo: ConteudoCap7, versao: number): Promise<Minuta> {
  const { data, error } = await supabase.from("pta_minutas")
    .update({ conteudo, versao: versao + 1 })
    .eq("ano", ano).eq("secao", secao).eq("versao", versao)
    .select("ano,secao,conteudo,versao,atualizado_nome,atualizado_em");
  if (error) throw new Error(msg(error));
  if (!data?.length) throw new Error("A minuta foi alterada por outra pessoa depois que você abriu. Recarregue para ver a versão nova antes de salvar.");
  return data[0] as Minuta;
}

export async function lerComentarios(ano: number, secao: string): Promise<Comentario[]> {
  const { data, error } = await supabase.from("pta_comentarios")
    .select("id,ano,secao,alvo,alvo_rotulo,tipo,texto,autor_id,autor_nome,criado_em,resolvido,resolvido_em")
    .eq("ano", ano).eq("secao", secao).order("criado_em", { ascending: true });
  if (error) throw new Error(msg(error));
  return (data as Comentario[]) ?? [];
}

export async function comentar(c: { ano: number; secao: string; alvo: string | null; alvo_rotulo: string | null; tipo: "comentario" | "de_acordo"; texto: string }): Promise<Comentario> {
  const { data, error } = await supabase.from("pta_comentarios")
    .insert(c)
    .select("id,ano,secao,alvo,alvo_rotulo,tipo,texto,autor_id,autor_nome,criado_em,resolvido,resolvido_em").single();
  if (error) throw new Error(msg(error));
  return data as Comentario;
}

export async function marcarResolvido(id: string, resolvido: boolean): Promise<void> {
  const { data, error } = await supabase.from("pta_comentarios").update({ resolvido }).eq("id", id).select("id");
  if (error) throw new Error(msg(error));
  if (!data?.length) throw new Error("Só quem escreveu ou o DEV pode marcar como resolvido.");
}

export async function apagarComentario(id: string): Promise<void> {
  const { data, error } = await supabase.from("pta_comentarios").delete().eq("id", id).select("id");
  if (error) throw new Error(msg(error));
  if (!data?.length) throw new Error("Só quem escreveu pode apagar o comentário.");
}
