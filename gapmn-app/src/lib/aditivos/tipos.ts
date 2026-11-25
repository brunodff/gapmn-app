// Termos Aditivos (pedido do Chefe da SCON, Ten Thiago, 24/11/2026): o objeto DadosAditivo é o mesmo "dados.json"
// que o kit da SCON (src/lib/aditivos/kit) lê; o app guarda em contratos_aditivos.dados e o entrega ao kit no
// navegador (Pyodide). Campos e regras: ESPECIFICACAO - Automacao-Aditivos (gapmn.app).md, seções 1 a 5.

export type Alteracao = "prorrogacao" | "reajuste" | "acrescimo" | "supressao";
export const ALTERACOES: Alteracao[] = ["prorrogacao", "reajuste", "acrescimo", "supressao"];

export interface Prorrogacao { modalidade: "com_valor" | "sem_valor"; meses: number | null; inicio: string | null; fim?: string | null }
export interface ReajusteAditivo { indice: string | null; percentual: string | null; valor: number | null }
export interface AlteracaoValor { valor: number | null; percentual: number | null; descricao: string | null }

export interface OmSignataria { nome: string; sigla: string; ug: string; artigo: "do" | "da" }
export interface Empenho {
  numero?: string | null; gestao_unidade: string; fonte: string; programa_trabalho: string; acao: string | null;
  plano_interno: string; natureza_despesa: string; exercicio: number | string | null;
}
export interface ParecerReferencial {
  numero: string; objeto?: string | null; data?: string | null; validade?: string | null;
  cobre: Alteracao[]; limite_percentual?: number | null; motivo?: string | null;
  /** o fiscal editou o objeto: o site (e o kit) não troca pelo da biblioteca de pareceres */
  objeto_fixo?: boolean;
  orgao_consultivo?: string | null; pdf?: string | null; fonte_objeto?: string | null;
}
/** Declaração de Vantajosidade Econômica (seção 3I): motivos do fiscal em incisos; cabeçalho e objeto só se ajustados */
export interface Vantajosidade { motivos: string[]; om_cabecalho?: string | null; objeto?: string | null }
export interface PrecoPesquisa { fonte: string; data: string; valor: number; valor_atualizado: number; excluido?: boolean; motivo_exclusao?: string }
export interface ItemPesquisa {
  item: number; descricao: string; codigo: string; unidade: string; quantidade: number; preco_contratado: number | null; precos: PrecoPesquisa[];
}
export interface PesquisaPrecosAditivo { fonte_tr: string; data_pesquisa: string; atualizacao: string; criterio: "mediana" | "media" | "menor"; itens: ItemPesquisa[] }
export interface Risco {
  nome: string; probabilidade: string; impacto: string; dano: string; acao_preventiva: string; acao_contingencia: string;
  responsavel_preventiva?: string; responsavel_contingencia?: string;
}
export interface Aprovacao { numero: string; data: string }

/** O "dados.json" do kit da SCON (seção 5 da especificação) */
export interface DadosAditivo {
  contrato: string;
  pag: string;
  om_nome: string;
  om_signataria: OmSignataria;
  numero_aditivo: number | null;
  empenho: Empenho;
  aditivo: { prorrogacao: Prorrogacao | null; reajuste: ReajusteAditivo | null; acrescimo: AlteracaoValor | null; supressao: AlteracaoValor | null };
  valor_atual: number | null;
  valor_novo?: number | null;
  merito_administrativo: string;
  parecer_juridico: Aprovacao | null;
  ratificacao: Aprovacao | null;
  aprovacao_superior: Aprovacao | null;
  autoridade_superior: string | null;
  consulta_socio: boolean;
  representante_mudou: boolean;
  inexigibilidade: boolean;
  pareceres_referenciais: ParecerReferencial[];
  nao_anexados: Record<string, string>;
  observacao: string;
  pesquisa_precos: PesquisaPrecosAditivo | null;
  riscos: Risco[];
  /** vai no Atestado de adequação e na Declaração de Vantajosidade (o site copia do estado ao gerar) */
  objeto_contrato?: string;
  vantajosidade?: Vantajosidade | null;
}

/** PDF guardado no aditivo (Storage aditivos-docs), por item da Lista: vai no .zip mesmo em outra sessão */
export interface AnexoGuardado { nome: string; caminho: string; tamanho: number; em: string; por: string | null }

export type NaturezaObjeto = "servico_sem_demo" | "servico_com_demo" | "tic" | "bens" | "locacao_imovel" | "outro";
export const NATUREZAS: [NaturezaObjeto, string][] = [
  ["servico_sem_demo", "Serviço contínuo sem dedicação exclusiva de mão de obra"],
  ["servico_com_demo", "Serviço contínuo com dedicação exclusiva de mão de obra (DEMO)"],
  ["tic", "Tecnologia da informação (TIC) / aluguel de equipamentos"],
  ["bens", "Aquisição de bens (fornecimento contínuo)"],
  ["locacao_imovel", "Locação de imóvel (Administração locatária)"],
  ["outro", "Outro"],
];
export type Lei = "14133" | "8666";

/** Conferência do SICAF (verificar_sicaf.py) */
export interface ResultadoSicaf {
  ok: boolean; alertas: string[]; cnpj: string | null; emitido_em: string | null; data_referencia: string;
  certidoes: Record<string, { nivel: string; obrigatoria: boolean; validade: string | null; situacao: string; dias_para_vencer?: number }>;
  ocorrencias: Record<string, string | null>; niveis: Record<string, boolean>;
}
export type SituacaoCadastro = "nada_consta" | "consta" | "indisponivel" | "nao_encontrado" | "indefinido";
export interface CadastroRegularidade { orgao: string; cadastro: string; situacao: SituacaoCadastro; resultado?: string | null; manual: string; automatico: boolean }
export interface ResultadoRegularidade { cnpj: string | null; cadastros: Record<string, CadastroRegularidade>; alertas: string[]; consulta_em?: string | null; razao_social?: string | null }

/** O que o app guarda além do dados.json: escolhas da tela e o resultado das conferências */
export interface EstadoAditivo {
  natureza: NaturezaObjeto;
  lei: Lei;
  cnpj: string;
  objeto_contrato: string;
  tipo_risco: "todos" | "servicos" | "demo" | "fornecimento";
  /** a SCON editou a lista de pareceres (senão ela segue o catálogo conforme as alterações, a natureza e a lei) */
  pareceres_manuais?: boolean;
  sicaf?: ResultadoSicaf & { arquivo: string; em: string };
  regularidade?: ResultadoRegularidade & { fonte: "api" | "pdf"; em: string; complementos: Record<string, string> };
  ultimo_empenho?: { ne?: string; data?: string; origem: string } | null;
  gerado_em?: string;
  arquivos_gerados?: string[];
  /** PDFs guardados no aditivo, por chave da Lista (sicaf, consulta_cnpj, consulta_cpf_socio, memoria_calculo, procuracao…) */
  anexos?: Record<string, AnexoGuardado[]>;
  /** PDFs que compõem o item 13 (consolidada e certidões complementares), para montar de novo em outra sessão */
  anexos_item13?: { consolidada?: AnexoGuardado | null; complementos?: Record<string, AnexoGuardado> };
}

export interface RegistroAditivo {
  id: string;
  numero_contrato: string;
  numero_aditivo: number | null;
  dados: DadosAditivo;
  estado: EstadoAditivo;
  situacao: "rascunho" | "gerado";
  versao: number;
  criado_em: string;
  criado_nome: string | null;
  atualizado_em: string;
  atualizado_nome: string | null;
}

export interface Alerta { nivel: "critico" | "atencao" | "info"; texto: string; bloqueia?: boolean; secao?: string }
