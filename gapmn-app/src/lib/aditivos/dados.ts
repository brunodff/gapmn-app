// Termos Aditivos: leitura e gravação (contratos_aditivos) e o aditivo inicial montado com o cadastro do contrato nos
// Reajustes (contratos_apostilamento: dados do motor + carga do SILOMS). A OM que assina vem do cadastro de unidades
// apoiadas (Reajustes › Configurações, revisão 4 da SCON, seção 6.2).
import { supabase } from "../supabase";
import type { DadosReajuste } from "../apostilamento/tipos";
import { acharUnidade, unidadePadrao, type UnidadeApoiada } from "../apostilamento/unidades";
import { carregarUnidades } from "../apostilamento/unidadesBanco";
import { AUTORIDADE_CEFA, eCefa, isoParaBr, proximoAditivo, type AguParecer } from "./regras.ts";
import type { DadosAditivo, EstadoAditivo, Lei, NaturezaObjeto, PesquisaPrecosAditivo, RegistroAditivo } from "./tipos.ts";

/** Nomes por extenso das OMs mais comuns, quando a unidade ainda não tem cadastro */
const NOMES_OM: Record<string, string> = {
  "GAP-MN": "Grupamento de Apoio de Manaus", "BAMN": "Base Aérea de Manaus", "HAMN": "Hospital de Aeronáutica de Manaus",
  "PAMN": "Prefeitura de Aeronáutica de Manaus", "DACTA IV": "Quarto Centro Integrado de Defesa Aérea e Controle de Tráfego Aéreo",
  "CINDACTA IV": "Quarto Centro Integrado de Defesa Aérea e Controle de Tráfego Aéreo", "COMARA": "Comissão de Aeroportos da Região Amazônica",
  "VII COMAR": "Sétimo Comando Aéreo Regional", "COMAR VII": "Sétimo Comando Aéreo Regional", "2GDAAE": "2º Grupo de Defesa Antiaérea",
};
export const artigoProvavel = (nome: string) => (/^(base|prefeitura|ala|comiss|escola|diretoria|se[cç][aã]o|ag[eê]ncia|divis)/i.test(nome.trim()) ? "da" : "do");
const siglaNorm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

export interface ContratoParaAditivo {
  numero_contrato: string; contrato: string; objeto: string; empresa: string; om: string; vigencia_fim: string | null; aditivos: number;
}
export async function contratosParaAditivo(): Promise<ContratoParaAditivo[]> {
  const [c, a] = await Promise.all([
    supabase.from("contratos_apostilamento").select("numero_contrato, dados, carga").limit(2000),
    supabase.from("contratos_aditivos").select("numero_contrato").limit(5000),
  ]);
  if (c.error) throw new Error(c.error.message);
  const contagem = new Map<string, number>();
  for (const x of (a.data ?? []) as { numero_contrato: string }[]) contagem.set(x.numero_contrato, (contagem.get(x.numero_contrato) ?? 0) + 1);
  return ((c.data ?? []) as { numero_contrato: string; dados: Partial<DadosReajuste> | null; carga: Record<string, any> | null }[]).map((r) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    numero_contrato: r.numero_contrato, contrato: r.dados?.contrato || r.numero_contrato,
    objeto: r.dados?.objeto_resumido || r.carga?.siloms?.descricao_resumida || "", empresa: r.dados?.empresa?.nome || r.carga?.siloms?.empresa_nome_contrato || "",
    om: r.carga?.siloms?.ug_responsavel || r.dados?.om_contratante_sigla || "", vigencia_fim: r.carga?.siloms?.vigencia_fim ?? null,
    aditivos: contagem.get(r.numero_contrato) ?? 0,
  })).sort((x, y) => x.contrato.localeCompare(y.contrato));
}

export async function aditivosEmAndamento(): Promise<Pick<RegistroAditivo, "id" | "numero_contrato" | "numero_aditivo" | "situacao" | "atualizado_em" | "atualizado_nome">[]> {
  const { data, error } = await supabase.from("contratos_aditivos").select("id, numero_contrato, numero_aditivo, situacao, atualizado_em, atualizado_nome").order("atualizado_em", { ascending: false }).limit(200);
  if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? "As tabelas dos Termos Aditivos ainda não existem no banco (migração 20261125b_termos_aditivos)." : error.message);
  return data ?? [];
}
/** OM signatária do aditivo pelo cadastro da unidade apoiada (nome, sigla, UG, artigo; CEFA/autoridade do campo 19) */
export function omDaUnidade(u: UnidadeApoiada): { om: DadosAditivo["om_signataria"]; autoridade_superior: string | null } {
  const nome = u.nome || NOMES_OM[siglaNorm(u.sigla)] || u.sigla;
  const om = { nome, sigla: u.sigla, ug: u.ug ?? "", artigo: u.artigo };
  // unidade do CEFA que o kit não reconhece pelo nome: a autoridade do campo 19 vai pronta (DIRAD)
  const autoridade = u.cefa ? (eCefa(om) ? null : AUTORIDADE_CEFA) : (u.autoridade_superior ?? null);
  return { om, autoridade_superior: autoridade };
}
export async function pareceresAgu(): Promise<AguParecer[]> {
  const { data } = await supabase.from("agu_referenciais").select("id, parecer, numero, ano, assunto, data, validade, url").eq("licitacoes", true).limit(2000);
  return (data ?? []) as AguParecer[];
}

/** Dia seguinte a uma data dd/mm/aaaa (início do novo período = fim da vigência + 1) */
function diaSeguinte(br: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br ?? ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]) + 1));
  return d.toISOString().slice(0, 10).split("-").reverse().join("/");
}
function naturezaProvavel(objeto: string, demo: boolean): NaturezaObjeto {
  if (demo) return "servico_com_demo";
  if (/loca[cç][aã]o\s+de\s+im[oó]vel|aluguel\s+de\s+im[oó]vel/i.test(objeto)) return "locacao_imovel";
  if (/\b(software|licen[cç]a|solu[cç][aã]o de ti|tecnologia da informa|nuvem|datacenter)/i.test(objeto)) return "tic";
  if (/^(aquisi|fornecimento)/i.test(objeto.trim())) return "bens";
  return "servico_sem_demo";
}

/** Aditivo inicial com o que o app já sabe do contrato (seção 1.1: o site preenche sozinho) */
export function montarAditivo(numero_contrato: string, dados: Partial<DadosReajuste> | null, carga: Record<string, any> | null, unidades: UnidadeApoiada[]): { dados: DadosAditivo; estado: EstadoAditivo } { // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = carga?.siloms ?? {};
  const solicitante = String(s.ug_responsavel || s.ug_fiscal || "").trim();
  // OM que assina = a "OM do Ordenador" do cadastro do contrato (vazia = a unidade padrão), a mesma dos Reajustes
  const sigSigla = String(dados?.om_ordenador || dados?.ordenador?.om_sigla || unidadePadrao(unidades)?.sigla || "GAP-MN").trim();
  const sigCad = acharUnidade(unidades, sigSigla);
  const doCadastro = sigCad ? omDaUnidade(sigCad) : null;
  const sigNome = doCadastro?.om.nome || NOMES_OM[siglaNorm(sigSigla)] || sigSigla;
  const nomeSolicitante = acharUnidade(unidades, solicitante)?.nome;
  const historico = (dados?.historico_valores ?? []).filter((h) => h.valor != null);
  const valorAtual = historico.length ? historico[historico.length - 1].valor : (dados?.itens?.length ? dados.itens.reduce((t, i) => t + (i.valor_base ?? 0), 0) || null : null);
  const orc = dados?.orcamento;
  const objeto = dados?.objeto_completo || s.descricao_resumida || "";
  const ano = Number(/(\d{4})\s*$/.exec(dados?.contrato || numero_contrato)?.[1]) || new Date().getFullYear();
  const natureza = naturezaProvavel(objeto, !!s.dedicacao_exclusiva);
  const lei: Lei = ano >= 2024 ? "14133" : "8666";
  return {
    dados: {
      contrato: (dados?.contrato || numero_contrato).replace(/^(DESPESA|CREDENCIAMENTO|CRED|ADES[AÃ]O|RECEITA)\s+/i, ""),
      pag: dados?.nup || s.pag || "",
      om_nome: nomeSolicitante || NOMES_OM[siglaNorm(solicitante)] || solicitante || sigNome,
      om_signataria: doCadastro?.om ?? { nome: sigNome, sigla: sigSigla, ug: "", artigo: artigoProvavel(sigNome) },
      numero_aditivo: proximoAditivo(carga?.documentos),
      empenho: {
        numero: carga?.ultimo_empenho?.ne ?? null,
        gestao_unidade: orc?.gestao_unidade ?? "", fonte: orc?.fonte ?? "", programa_trabalho: orc?.programa_trabalho ?? "", acao: orc?.acao || null,
        plano_interno: orc?.plano_interno ?? "", natureza_despesa: orc?.natureza_despesa ?? "", exercicio: orc?.exercicio ?? new Date().getFullYear(),
      },
      aditivo: { prorrogacao: { modalidade: "com_valor", meses: 12, inicio: diaSeguinte(s.vigencia_fim) }, reajuste: null, acrescimo: null, supressao: null },
      valor_atual: valorAtual ?? null,
      merito_administrativo: "", parecer_juridico: null, ratificacao: null, aprovacao_superior: null, autoridade_superior: doCadastro?.autoridade_superior ?? null,
      consulta_socio: false, representante_mudou: false, inexigibilidade: false,
      pareceres_referenciais: [], nao_anexados: {}, observacao: "", pesquisa_precos: null, riscos: [],
      objeto_contrato: objeto, vantajosidade: { motivos: [] },
    },
    estado: {
      natureza, lei, cnpj: dados?.empresa?.cnpj ?? "", objeto_contrato: objeto,
      tipo_risco: natureza === "servico_com_demo" ? "demo" : natureza === "bens" ? "fornecimento" : "servicos",
      ultimo_empenho: carga?.ultimo_empenho ? { ne: carga.ultimo_empenho.ne ?? undefined, origem: carga.ultimo_empenho.fonte_dos_dados ?? "SILOMS" } : null,
    },
  };
}

export async function iniciarAditivo(numero_contrato: string, quem: string | null): Promise<RegistroAditivo> {
  const [r, u] = await Promise.all([
    supabase.from("contratos_apostilamento").select("dados, carga").eq("numero_contrato", numero_contrato).maybeSingle(),
    carregarUnidades(),
  ]);
  if (r.error) throw new Error(r.error.message);
  const { dados, estado } = montarAditivo(numero_contrato, (r.data?.dados ?? null) as Partial<DadosReajuste> | null, (r.data?.carga ?? null) as Record<string, unknown> | null, u.unidades);
  const { data, error } = await supabase.from("contratos_aditivos").insert({
    numero_contrato, numero_aditivo: dados.numero_aditivo, dados, estado, criado_nome: quem, atualizado_nome: quem,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as RegistroAditivo;
}
export async function carregarAditivo(id: string): Promise<RegistroAditivo> {
  const { data, error } = await supabase.from("contratos_aditivos").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as RegistroAditivo;
}
/** Salva conferindo a versão: se outra pessoa salvou antes, não sobrescreve (avisa para recarregar) */
export async function salvarAditivo(reg: RegistroAditivo, dados: DadosAditivo, estado: EstadoAditivo, quem: string | null, situacao?: RegistroAditivo["situacao"]): Promise<RegistroAditivo> {
  const { data, error } = await supabase.from("contratos_aditivos").update({
    dados, estado, numero_aditivo: dados.numero_aditivo, situacao: situacao ?? reg.situacao, versao: reg.versao + 1,
    atualizado_em: new Date().toISOString(), atualizado_nome: quem,
  }).eq("id", reg.id).eq("versao", reg.versao).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Outra pessoa salvou este aditivo depois que você o abriu. Recarregue (os dados dela ficam) e refaça a alteração.`);
  return data as RegistroAditivo;
}
/** A Pesquisa de Preços devolve o resultado ao aditivo (lê a versão atual e grava por cima só a pesquisa) */
export async function enviarPesquisaAoAditivo(id: string, pesquisa: PesquisaPrecosAditivo, quem: string | null): Promise<RegistroAditivo> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const reg = await carregarAditivo(id);
    try { return await salvarAditivo(reg, { ...reg.dados, pesquisa_precos: pesquisa }, reg.estado, quem); }
    catch (e) { if (tentativa === 2 || !(e instanceof Error) || !/Outra pessoa/.test(e.message)) throw e; }
  }
  throw new Error("Não consegui gravar a pesquisa no aditivo.");
}
export async function apagarAditivo(id: string): Promise<void> {
  const { error } = await supabase.from("contratos_aditivos").delete().eq("id", id);
  if (error) throw new Error(/row-level|permission/i.test(error.message) ? "Só quem criou o aditivo, a SCON, ADMIN e DEV podem apagá-lo." : error.message);
}
/** Itens e reajuste do cadastro dos Reajustes (para a pesquisa de preços e a memória de cálculo) */
export async function cadastroReajuste(numero_contrato: string): Promise<{ dados: DadosReajuste | null; carga: Record<string, unknown> | null }> {
  const { data } = await supabase.from("contratos_apostilamento").select("dados, carga").eq("numero_contrato", numero_contrato).maybeSingle();
  return { dados: (data?.dados ?? null) as DadosReajuste | null, carga: (data?.carga ?? null) as Record<string, unknown> | null };
}
/** TR vinculado ao contrato (Contratos SCON › Documentos › Termo de Referência) */
export async function trDoContrato(numero_contrato: string): Promise<{ nome: string; url: string } | null> {
  const { data } = await supabase.from("contratos_docs").select("nome, url").eq("numero_contrato", numero_contrato).eq("tipo", "tr").is("deleted_at", null).order("created_at", { ascending: false }).limit(1);
  return (data?.[0] as { nome: string; url: string }) ?? null;
}

/** Consultas automáticas do item 13 (função aditivos-consultas) */
export async function consultaAutomatica<T = Record<string, unknown>>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("aditivos-consultas", { body: corpo });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* sem corpo */ }
    throw new Error(msg);
  }
  return data as T;
}
export const bytesDeBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
export { isoParaBr };
