// Chamadas ao banco do levantamento do PTA (migração 20261104_pta_levantamento).
// Formulário (sem login): pta_lev_formulario, pta_lev_salvar, pta_lev_excluir — conferem o código do link e a
// chave pessoal de quem cadastrou. Quem administra (ADMIN/DEV): pta_lev_painel, pta_lev_abrir/fechar/novo_link.

import { supabase } from "../supabase";
import { doBanco, paraBanco, type Cadastro, type ItemDoBanco } from "./cadastro.ts";

const MENSAGENS: Record<string, string> = {
  link_invalido: "Este link não vale mais. Peça o link atualizado à Assessoria de Planejamento e Governança (APLG).",
  levantamento_encerrado: "O levantamento já foi encerrado. Fale com a APLG se precisar incluir ou corrigir algo.",
  chave_invalida: "Não consegui reconhecer este navegador. Recarregue a página e tente de novo.",
  cadastro_invalido: "O cadastro está incompleto. Recarregue a página e tente de novo.",
  setor_invalido: "Escolha a divisão ou assessoria.",
  secao_obrigatoria: "Informe a sua seção.",
  nome_invalido: "Escreva o nome (pelo menos 3 letras).",
  identificacao_incompleta: "Preencha o seu posto ou graduação e o nome de guerra.",
  cadastro_grande_demais: "O cadastro ficou grande demais. Divida as etapas ou encurte os textos.",
  muitos_cadastros: "Você já tem 60 cadastros. Fale com a APLG.",
  cadastro_nao_encontrado: "Este cadastro não foi encontrado (ele pode ter sido feito em outro navegador ou já ter sido excluído).",
  sem_permissao: "Seu perfil não tem permissão para isso.",
};

function mensagem(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? "";
  for (const [codigo, texto] of Object.entries(MENSAGENS)) if (m.includes(codigo)) return texto;
  if (/could not find the function|does not exist/i.test(m)) return "O levantamento ainda não está habilitado no banco.";
  if (/Failed to fetch|NetworkError|fetch/i.test(m)) return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  return m || "Não foi possível falar com o servidor.";
}

// ── chave pessoal: identifica quem cadastrou, sem login ──────────────────────

const CHAVE_LOCAL = "gapmn_pta_lev_chave_v1";
const ALFABETO = /^[A-Za-z0-9_-]{20,200}$/;

export function gerarChave(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Chave deste navegador. Se o endereço trouxer ?k= (link pessoal), ela passa a valer aqui também. */
export function chaveDoNavegador(daUrl: string | null): { chave: string; guardada: boolean } {
  let guardada = false;
  let chave = daUrl && ALFABETO.test(daUrl) ? daUrl : "";
  try {
    if (!chave) chave = localStorage.getItem(CHAVE_LOCAL) ?? "";
    if (!ALFABETO.test(chave)) chave = gerarChave();
    localStorage.setItem(CHAVE_LOCAL, chave);
    guardada = localStorage.getItem(CHAVE_LOCAL) === chave;
  } catch {
    if (!ALFABETO.test(chave)) chave = gerarChave();
  }
  return { chave, guardada };
}

export const linkPessoal = (base: string, token: string, chave: string) =>
  `${base}/pta-levantamento?c=${encodeURIComponent(token)}&k=${encodeURIComponent(chave)}`;

// ── formulário ───────────────────────────────────────────────────────────────

export type Levantamento = { ano: number; aberta: boolean; prazo: string | null };

export async function carregarFormulario(token: string, chave: string): Promise<{ levantamento: Levantamento; meus: Cadastro[] }> {
  const { data, error } = await supabase.rpc("pta_lev_formulario", { p_token: token, p_chave: chave });
  if (error) throw new Error(mensagem(error));
  const d = data as { levantamento: Levantamento; meus: ItemDoBanco[] | null };
  return { levantamento: d.levantamento, meus: (d.meus ?? []).map(doBanco) };
}

export async function salvarCadastro(token: string, chave: string, c: Cadastro): Promise<Cadastro> {
  const { data, error } = await supabase.rpc("pta_lev_salvar", { p_token: token, p_chave: chave, p_id: c.id, p_item: paraBanco(c) });
  if (error) throw new Error(mensagem(error));
  return doBanco(data as ItemDoBanco);
}

export async function excluirCadastro(token: string, chave: string, id: string): Promise<void> {
  const { error } = await supabase.rpc("pta_lev_excluir", { p_token: token, p_chave: chave, p_id: id });
  if (error) throw new Error(mensagem(error));
}

// ── quem administra ──────────────────────────────────────────────────────────

export type LevantamentoAdmin = Levantamento & { token: string | null; aberta_em: string | null; fechada_em: string | null };

export async function carregarPainel(ano: number): Promise<{ levantamento: LevantamentoAdmin | null; itens: Cadastro[]; geradoEm: string }> {
  const { data, error } = await supabase.rpc("pta_lev_painel", { p_ano: ano });
  if (error) throw new Error(mensagem(error));
  const d = data as { levantamento: LevantamentoAdmin | null; itens: ItemDoBanco[] | null; gerado_em: string };
  return { levantamento: d.levantamento, itens: (d.itens ?? []).map(doBanco), geradoEm: d.gerado_em };
}

export async function abrirLevantamento(ano: number, prazo: string | null): Promise<LevantamentoAdmin> {
  const { data, error } = await supabase.rpc("pta_lev_abrir", { p_ano: ano, p_prazo: prazo || null });
  if (error) throw new Error(mensagem(error));
  return data as LevantamentoAdmin;
}

export async function fecharLevantamento(ano: number): Promise<LevantamentoAdmin> {
  const { data, error } = await supabase.rpc("pta_lev_fechar", { p_ano: ano });
  if (error) throw new Error(mensagem(error));
  return data as LevantamentoAdmin;
}

export async function trocarLink(ano: number): Promise<LevantamentoAdmin> {
  const { data, error } = await supabase.rpc("pta_lev_novo_link", { p_ano: ano });
  if (error) throw new Error(mensagem(error));
  return data as LevantamentoAdmin;
}
