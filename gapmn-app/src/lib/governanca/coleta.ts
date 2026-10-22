// Chamadas ao banco da coleta mensal dos indicadores (migração 20261022_governanca_coleta).
// Formulário (sem login): gov_formulario, gov_autorizar_anexo + envio ao depósito, gov_salvar — todas
// conferem o código do link. Quem administra (ADMIN/DEV) lê as tabelas direto e abre/fecha a coleta.

import { supabase } from "../supabase";
import type {
  CompetenciaAdmin, ContratoAdmin, ContratoGov, Formulario, HistoricoGov, Identificacao, IndicadorGov, ItemParaSalvar,
  LancamentoAdmin,
} from "./tipos.ts";

export const DEPOSITO_ANEXOS = "governanca-anexos";
export const TAMANHO_MAXIMO_ANEXO = 10 * 1024 * 1024;
const TIPOS_ANEXO: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };

const MENSAGENS: Record<string, string> = {
  link_invalido: "Este link não vale mais. Peça o link atualizado a quem enviou.",
  coleta_encerrada: "A coleta deste mês já foi encerrada. Fale com a Assessoria de Planejamento e Governança se precisar corrigir algo.",
  identificacao_incompleta: "Preencha posto/graduação e nome de guerra.",
  divisao_invalida: "Escolha a divisão ou assessoria.",
  indicador_de_outra_divisao: "Há indicador de outra divisão no envio. Recarregue a página e tente de novo.",
  valor_invalido: "Algum valor não é um número válido.",
  tipo_de_arquivo: "O comprovante precisa ser imagem (PNG, JPG, WEBP) ou PDF.",
  anexo_invalido: "Um comprovante não foi aceito. Anexe de novo.",
  muitos_anexos: "Muitos comprovantes enviados na última hora. Tente de novo mais tarde.",
  contratos_so_da_doc: "Só a DOC informa os contratos e atas essenciais.",
  status_invalido: "Situação de contrato inválida.",
  sem_permissao: "Seu perfil não tem permissão para isso.",
};

function mensagem(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? "";
  for (const [codigo, texto] of Object.entries(MENSAGENS)) if (m.includes(codigo)) return texto;
  if (/could not find the function|does not exist/i.test(m)) return "A coleta ainda não está habilitada no banco.";
  if (/Failed to fetch|NetworkError|fetch/i.test(m)) return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  return m || "Não foi possível falar com o servidor.";
}

// ── formulário (sem login) ───────────────────────────────────────────────────

export async function carregarFormulario(token: string): Promise<Formulario> {
  const { data, error } = await supabase.rpc("gov_formulario", { p_token: token });
  if (error) throw new Error(mensagem(error));
  const f = data as Formulario;
  return {
    ...f,
    indicadores: (f.indicadores ?? []).map((i: IndicadorGov) => ({ ...i, variaveis: Array.isArray(i.variaveis) ? i.variaveis : [] })),
    lancamentos: f.lancamentos ?? [],
    anteriores: f.anteriores ?? [],
  };
}

export function extensaoDe(nome: string): string {
  return (nome.split(".").pop() ?? "").toLowerCase();
}

/** Confere tipo e tamanho antes de tentar enviar; devolve a mensagem do problema ou null. */
export function problemaDoAnexo(arquivo: { name: string; size: number }): string | null {
  if (!TIPOS_ANEXO[extensaoDe(arquivo.name)]) return "O comprovante precisa ser imagem (PNG, JPG, WEBP) ou PDF.";
  if (arquivo.size > TAMANHO_MAXIMO_ANEXO) return "O comprovante passa de 10 MB. Reduza a imagem ou envie só a página que interessa.";
  return null;
}

/** Pede um caminho autorizado e envia o comprovante ao depósito privado. */
export async function enviarAnexo(token: string, arquivo: File): Promise<{ caminho: string; nome: string }> {
  const problema = problemaDoAnexo(arquivo);
  if (problema) throw new Error(problema);
  const ext = extensaoDe(arquivo.name);
  const { data, error } = await supabase.rpc("gov_autorizar_anexo", { p_token: token, p_ext: ext });
  if (error) throw new Error(mensagem(error));
  const caminho = String(data);
  const up = await supabase.storage.from(DEPOSITO_ANEXOS).upload(caminho, arquivo, { contentType: TIPOS_ANEXO[ext], upsert: false });
  if (up.error) throw new Error(`Não consegui enviar o comprovante "${arquivo.name}". ${mensagem(up.error)}`);
  return { caminho, nome: arquivo.name.slice(0, 200) };
}

export async function salvarDivisao(
  token: string, ident: Identificacao, itens: ItemParaSalvar[], contratos: ContratoGov[] | null,
): Promise<{ indicadores: number; contratos: number }> {
  const { data, error } = await supabase.rpc("gov_salvar", {
    p_token: token, p_posto: ident.posto, p_nome: ident.nome, p_divisao: ident.divisao,
    p_itens: itens,
    p_contratos: contratos ? contratos.map((c) => ({
      servico: c.servico, nup: c.nup, termino: c.termino, status: c.status, providencias: c.providencias, padrao: c.padrao,
    })) : null,
  });
  if (error) throw new Error(mensagem(error));
  const r = data as { indicadores?: number; contratos?: number };
  return { indicadores: Number(r?.indicadores ?? 0), contratos: Number(r?.contratos ?? 0) };
}

// ── quem administra (ADMIN e DEV) ────────────────────────────────────────────

/** Lê uma tabela inteira, de 1.000 em 1.000 linhas. */
async function lerTudo<T>(tabela: string, colunas: string, ordem: string): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from(tabela).select(colunas).order(ordem, { ascending: true }).range(de, de + 999);
    if (error) throw new Error(mensagem(error));
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

export async function listarCompetencias(): Promise<CompetenciaAdmin[]> {
  const { data, error } = await supabase.from("gov_competencias")
    .select("codigo,rotulo,semestral,token,aberta,prazo,origem,aberta_em,fechada_em").order("codigo", { ascending: false });
  if (error) throw new Error(mensagem(error));
  return (data ?? []) as CompetenciaAdmin[];
}

export async function abrirColeta(codigo: string, prazo: string | null): Promise<CompetenciaAdmin> {
  const { data, error } = await supabase.rpc("gov_abrir", { p_codigo: codigo, p_prazo: prazo || null });
  if (error) throw new Error(mensagem(error));
  return data as CompetenciaAdmin;
}

export async function fecharColeta(codigo: string): Promise<void> {
  const { error } = await supabase.rpc("gov_fechar", { p_codigo: codigo });
  if (error) throw new Error(mensagem(error));
}

export async function trocarLink(codigo: string): Promise<CompetenciaAdmin> {
  const { data, error } = await supabase.rpc("gov_novo_link", { p_codigo: codigo });
  if (error) throw new Error(mensagem(error));
  return data as CompetenciaAdmin;
}

export type DadosColeta = {
  indicadores: IndicadorGov[];
  competencias: CompetenciaAdmin[];
  lancamentos: LancamentoAdmin[];
  historico: HistoricoGov[];
  contratos: ContratoAdmin[];
};

/** Tudo o que a tela de acompanhamento e a planilha consolidada precisam. */
export async function lerDadosColeta(): Promise<DadosColeta> {
  const [indicadores, competencias, lancamentos, historico, contratos] = await Promise.all([
    lerTudo<IndicadorGov>("gov_indicadores", "id,divisao,categoria,indicador,unidade,formula,calculo,variaveis,meta_txt,meta_num,direcao,planejado,ordem", "ordem"),
    listarCompetencias(),
    lerTudo<LancamentoAdmin>("gov_lancamentos",
      "competencia,indicador_id,tipo,v1,v2,v3,valor,comentario,anexo,anexo_nome,posto,nome_guerra,divisao,atualizado_em,versao", "competencia"),
    lerTudo<HistoricoGov>("gov_historico", "id,competencia,indicador_id,tipo,antes,depois,posto,nome_guerra,quando", "id"),
    lerTudo<ContratoAdmin>("gov_contratos", "id,competencia,ordem,servico,nup,termino,status,providencias,padrao,posto,nome_guerra,atualizado_em", "competencia"),
  ]);
  return { indicadores, competencias, lancamentos, historico, contratos };
}

/** Link temporário (5 min) para abrir um comprovante. */
export async function urlDoAnexo(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from(DEPOSITO_ANEXOS).createSignedUrl(caminho, 300);
  if (error || !data?.signedUrl) throw new Error(mensagem(error) || "Não consegui abrir o comprovante.");
  return data.signedUrl;
}

/** Endereço do formulário para mandar no grupo. */
export function linkDoFormulario(token: string, origem = typeof window !== "undefined" ? window.location.origin : "https://gapmn.app"): string {
  return `${origem}/indicadores?c=${encodeURIComponent(token)}`;
}
