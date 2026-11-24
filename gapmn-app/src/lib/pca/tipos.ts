// Acompanhamento do PCA (pedido da SLIC, Ten Gabriela, nov/2026): tipos, status e fluxos.
// Este arquivo e os outros de src/lib/pca são usados pela tela e pela função pca-automacao (Deno):
// imports relativos sempre com ".ts" e nada de navegador ou Supabase aqui.

export const CATEGORIAS = ["Aquisição", "Serviço Comum", "Serviço de Engenharia", "Obra", "TIC", "Locação"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const MODALIDADES = [
  "Pregão Eletrônico", "Dispensa Eletrônica", "Concorrência", "Inexigibilidade", "Credenciamento", "Leilão", "Diálogo Competitivo",
] as const;

export const ENQUADRAMENTOS = ["Pendente de Triagem", "Parecer Referencial AGU", "Análise CJU - Art. 53"] as const;
export type Enquadramento = (typeof ENQUADRAMENTOS)[number];

// ── Máquina de estados ───────────────────────────────────────────────────────
// Fluxo normal (a automação só anda para frente) e estados de exceção (só a SLIC põe, com justificativa;
// Deserto, Fracassado, Revogado, Cancelado e Suspenso também chegam pelo PNCP).
export const S = {
  PLANEJADO: "Planejado no PCA",
  DNR: "DNR recebida - Conferência documental",
  IRREGULAR: "Irregularidade documental",
  MINUTAS: "Fase interna - Elaboração de minutas",
  MJR: "Aprovado com MJR - Aguardando Publicação SLIC",
  CJU: "Em Análise Jurídica (CJU)",
  RETORNO_CJU: "Retornado da CJU - Aguardando Saneamento",
  POS_CJU: "Saneamento pós-CJU (ACI/OD)",
  LIBERADO: "Liberado para Publicação (SLIC)",
  PUBLICADO: "Publicado - Fase Externa",
  HOMOLOGADO: "Homologado",
  ENCAMINHADO: "Encaminhado para Ata/Contrato",
  SUSPENSO: "Suspenso",
  ADIADO: "Adiado",
  REVOGADO: "Revogado",
  ANULADO: "Anulado",
  CANCELADO: "Cancelado",
  DESERTO: "Deserto",
  FRACASSADO: "Fracassado",
} as const;
export type Status = (typeof S)[keyof typeof S];

/** Ordem do fluxo normal (fase); exceções ficam fora */
export const FLUXO: Status[] = [S.PLANEJADO, S.DNR, S.IRREGULAR, S.MINUTAS, S.MJR, S.CJU, S.RETORNO_CJU, S.POS_CJU, S.LIBERADO, S.PUBLICADO, S.HOMOLOGADO, S.ENCAMINHADO];
export const EXCECOES: Status[] = [S.SUSPENSO, S.ADIADO, S.REVOGADO, S.ANULADO, S.CANCELADO, S.DESERTO, S.FRACASSADO];
export const TODOS_STATUS: Status[] = [...FLUXO, ...EXCECOES];
/** Encerrados: não contam prazo nem alertas de andamento */
export const ENCERRADOS: Status[] = [S.ENCAMINHADO, S.REVOGADO, S.ANULADO, S.CANCELADO, S.DESERTO, S.FRACASSADO];

/** Fase de cada status do fluxo (exceções = -1). IRREGULAR fica na fase da DNR. */
export function fase(s: string | null | undefined): number {
  const FASES: Record<string, number> = {
    [S.PLANEJADO]: 0, [S.DNR]: 1, [S.IRREGULAR]: 1, [S.MINUTAS]: 2, [S.MJR]: 3, [S.CJU]: 3, [S.RETORNO_CJU]: 4, [S.POS_CJU]: 5,
    [S.LIBERADO]: 6, [S.PUBLICADO]: 7, [S.HOMOLOGADO]: 8, [S.ENCAMINHADO]: 9,
  };
  return s != null && s in FASES ? FASES[s] : -1;
}

/** Macroalterações avisadas ao Elo (Módulo I) */
export function macroDe(s: string): string | null {
  const M: Record<string, string> = {
    [S.DNR]: "Chegada da DNR", [S.IRREGULAR]: "Irregularidade documental", [S.CJU]: "Envio à CJU",
    [S.RETORNO_CJU]: "Retorno da CJU para saneamento", [S.PUBLICADO]: "Publicação no PNCP", [S.SUSPENSO]: "Suspensão",
    [S.HOMOLOGADO]: "Homologação", [S.ENCAMINHADO]: "Encaminhamento para Ata/Contrato",
    [S.ADIADO]: "Adiamento", [S.REVOGADO]: "Revogação", [S.ANULADO]: "Anulação", [S.CANCELADO]: "Cancelamento",
    [S.DESERTO]: "Licitação deserta", [S.FRACASSADO]: "Licitação fracassada",
  };
  return M[s] ?? null;
}

/** Próxima ação esperada, no e-mail ao Elo e na tela */
export function proximaAcao(s: string, srp: boolean | null): string {
  const P: Record<string, string> = {
    [S.PLANEJADO]: "Unidade requisitante: enviar a DNR com a instrução completa (listas de verificação) até a data prevista de chegada.",
    [S.DNR]: "SLIC: conferir a documentação inicial e designar o AUX SLIC responsável pelas minutas.",
    [S.IRREGULAR]: "Unidade requisitante: sanear a irregularidade documental apontada pela SLIC.",
    [S.MINUTAS]: "SLIC: elaborar as minutas (Edital, Contrato e Ata) e seguir o fluxo de conferência do ACI e assinatura do OD.",
    [S.MJR]: "SLIC: publicar o certame (enquadrado em Manifestação Jurídica Referencial).",
    [S.CJU]: "CJU: análise jurídica (art. 53 da Lei nº 14.133/2021), prazo de referência de 15 dias.",
    [S.RETORNO_CJU]: "Equipe de Planejamento: sanear os apontamentos do parecer da CJU.",
    [S.POS_CJU]: "ACI e OD: conferir o saneamento e assinar para liberar a publicação.",
    [S.LIBERADO]: "SLIC: publicar no Compras.gov.br/PNCP, DOU e EBC.",
    [S.PUBLICADO]: "Pregoeiro/Agente de Contratação: conduzir a sessão pública e a fase externa.",
    [S.HOMOLOGADO]: srp ? "Formalizar a Ata de Registro de Preços (AUX SLIC de Atas)." : "SCON: elaborar o Termo de Contrato.",
    [S.ENCAMINHADO]: srp ? "Assinatura e publicação da Ata de Registro de Preços." : "Assinatura e publicação do Termo de Contrato.",
    [S.SUSPENSO]: "Aguardar a decisão sobre a suspensão (impugnação, recurso ou determinação superior).",
    [S.ADIADO]: "Unidade requisitante: enviar expediente formal com a nova data para alteração do PCA.",
  };
  return P[s] ?? "Nenhuma: processo encerrado.";
}

// ── Subprocessos da fase interna (SILOMS) ────────────────────────────────────
export interface Fluxo { id: number; nome: string; tramite: string[]; posCju: boolean }
export const FLUXOS: Fluxo[] = [
  { id: 1, nome: "FASE INTERNA DA LICITAÇÃO GAP-MN - PÓS PARECER ACI", tramite: ["ACI", "SOLICITANTE", "OD", "SLIC"], posCju: false },
  { id: 2, nome: "FASE INTERNA DA LICITAÇÃO APOIADA - PÓS PARECER ACI", tramite: ["ACI", "APOIADA", "SLIC", "ACI", "OD", "SLIC"], posCju: false },
  { id: 3, nome: "FASE INTERNA DA LICITAÇÃO APOIADA - PÓS CJU", tramite: ["SLIC", "ACI", "OD", "SLIC"], posCju: true },
  { id: 4, nome: "FASE INTERNA DA LICITAÇÃO GAP-MN - PÓS CJU", tramite: ["SLIC", "SOLICITANTE", "ACI", "OD", "SLIC"], posCju: true },
  { id: 5, nome: "FASE INTERNA DA LICITAÇÃO GAP-MN E APOIADAS - ELABORAÇÃO DE MINUTA CONTRATUAL", tramite: ["SLIC", "SCON", "SLIC"], posCju: false },
];
/** Marcos internos rastreados (Módulo D) */
export const MARCOS = [
  { id: "minutas", nome: "Elaboração de minutas" },
  { id: "irp", nome: "Abertura/Divulgação de IRP (se aplicável)" },
  { id: "aci", nome: "Conferência do ACI" },
  { id: "od", nome: "Assinatura do Ordenador de Despesas (OD)" },
] as const;
export type MarcoId = (typeof MARCOS)[number]["id"];

export interface Subprocesso {
  /** "DNR 1234 - LIMPEZA" (nome no SILOMS) */
  nome: string;
  fluxo: number;
  /** marco → data (AAAA-MM-DD) em que foi cumprido; IRP pode ser "não se aplica" */
  marcos: Partial<Record<MarcoId, string | "nao_se_aplica">>;
  /** etapa atual do trâmite no SILOMS (ex.: "ACI"), quando o robô do SILOMS informar */
  etapa?: string | null;
  atualizado_em?: string;
}

// ── Linha principal (tabela pca_contratacoes) ────────────────────────────────
export interface Contratacao {
  id: string;
  ano: number;
  chave_pgc: string | null;
  id_contratacao_pgc: string | null;
  numeros_dfd: string[];
  itens_pca: number[];
  numero_pag: string | null;
  numero_certame: string | null;
  id_compra: string | null;
  objeto: string;
  objeto_resumido: string | null;
  categoria: Categoria | null;
  categoria_origem: "pgc" | "manual" | null;
  sistema_srp: boolean | null;
  modalidade: string | null;
  modalidade_origem: "sugerida" | "manual" | "publicada" | null;
  modalidade_motivo: string | null;
  valor_estimado: number | null;
  valor_origem: "pca" | "edital" | "manual" | null;
  om_apoiada: string | null;
  area_pgc: string | null;
  data_estimada_chegada: string | null;
  data_estimada_conclusao: string | null;
  numero_dnr: string | null;
  data_chegada_dnr: string | null;
  responsavel_apoiada: string | null;
  responsavel_gapmn: string | null;
  pregoeiro_responsavel: string | null;
  documentacao_inicial_ok: boolean;
  subprocesso_fase_interna: Subprocesso | null;
  subprocesso_pos_cju: Subprocesso | null;
  enquadramento_juridico: Enquadramento;
  mjr_id: number | null;
  enquadramento_motivo: string | null;
  data_envio_cju: string | null;
  data_retorno_cju: string | null;
  liberado_publicacao_em: string | null;
  pncp_publicado_em: string | null;
  link_pncp: string | null;
  status_publicacao_dou: boolean;
  dou_data: string | null;
  dou_link: string | null;
  status_publicacao_ebc: boolean;
  ebc_data: string | null;
  ebc_link: string | null;
  subprocesso_fase_externa: string | null;
  data_homologacao: string | null;
  encaminhado_em: string | null;
  status_atual: Status;
  status_origem: "automatico" | "manual";
  status_desde: string;
  alertas_ativos: Alerta[];
  pgc_ausente_desde: string | null;
  email_d30_em: string | null;
  observacao: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface Alerta { codigo: string; nivel: "info" | "atencao" | "critico"; texto: string }

export interface Elo { id: number; om: string; nome_om: string | null; elo_nome: string | null; elo_email: string | null; areas_pgc: string[]; interno: boolean; ativo: boolean }
export interface MembroEquipe { id: number; nome: string; email: string | null; funcao: string; ativo: boolean }
export interface RegraMjr {
  id: number; titulo: string; agu_id: number | null; categorias: string[]; modalidades: string[]; valor_maximo: number | null;
  palavras: string[]; srp: boolean | null; vigencia_fim: string | null; ativo: boolean;
}
export interface ConfigPca {
  ano: number;
  envio_automatico: boolean;
  email_slic: string | null;
  email_atas: string;
  email_scon: string;
  link_listas: string;
  sla_cju_dias: number;
  dias_alerta_chegada: number;
  /** art. 75, I (obras, serviços de engenharia e manutenção de veículos) e II (demais) no ano do PCA */
  limite_dispensa_engenharia: number;
  limite_dispensa_demais: number;
}

export const CONFIG_PADRAO: ConfigPca = {
  ano: 2027,
  envio_automatico: false,
  email_slic: null,
  email_atas: "atas.guarnaemn@gmail.com",
  email_scon: "dctr.gapmn@gmail.com",
  link_listas: "https://www.gapmn.intraer/index.php/setores/divisao-de-obtencao-e-contratos#listas-de-verificacao",
  sla_cju_dias: 15,
  dias_alerta_chegada: 30,
  // valores de 2026 (Decreto nº 12.807/2025): trocar quando sair o decreto com os valores de 2027
  limite_dispensa_engenharia: 130984.20,
  limite_dispensa_demais: 65492.11,
};

/** Registro novo no histórico imutável */
export interface NovoHistorico {
  contratacao_id: string;
  origem: "manual" | "pgc" | "pncp" | "dou" | "email" | "siloms" | "sistema";
  campo: string;
  de: unknown;
  para: unknown;
  justificativa?: string | null;
  usuario_id?: string | null;
  usuario_nome?: string | null;
}
export interface NovoEmail {
  contratacao_id: string | null;
  tipo: "d30" | "macro" | "homologacao_srp" | "homologacao_contrato" | "sla_cju" | "impugnacao";
  para: string[];
  assunto: string;
  html: string;
  texto: string;
  chave: string;
}
export interface NovaIrregularidade {
  contratacao_id: string | null;
  dnr_id?: string | null;
  tipo: "pag_divergente" | "contratacao_ausente" | "contratacao_invalida" | "objeto_incompativel" | "pag_em_uso" | "evento_sem_processo" | "item_fora_da_contratacao" | "documental";
  descricao: string;
  detalhe?: Record<string, unknown>;
}
