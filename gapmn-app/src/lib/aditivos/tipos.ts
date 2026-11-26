// Termos Aditivos (pedido do Chefe da SCON, Ten Thiago, 24/11/2026): o objeto DadosAditivo é o mesmo "dados.json"
// que o kit da SCON (src/lib/aditivos/kit) lê; o app guarda em contratos_aditivos.dados e o entrega ao kit no
// navegador (Pyodide). Campos e regras: ESPECIFICACAO - Automacao-Aditivos (gapmn.app).md, seções 1 a 5.

export type Alteracao = "prorrogacao" | "reajuste" | "acrescimo" | "supressao";
export const ALTERACOES: Alteracao[] = ["prorrogacao", "reajuste", "acrescimo", "supressao"];

export interface Prorrogacao {
  modalidade: "com_valor" | "sem_valor"; meses: number | null; inicio: string | null; fim?: string | null;
  /** prorrogação excepcional (art. 57, § 4º, da Lei 8.666; revisão 7): sempre vai para a CJU */
  excepcional?: boolean; justificativa?: string | null;
}
export interface ReajusteAditivo { indice: string | null; percentual: string | null; valor: number | null }
export interface AlteracaoValor { valor: number | null; percentual: number | null; descricao: string | null }

export interface Ordenador { nome: string; posto: string; feminino: boolean; portaria: string; publicacao: string; matricula: string }
/** OM que assina o contrato: do cadastro da unidade (Reajustes › Configurações). Endereço, CNPJ, cidade e Ordenador só
 *  no Termo Aditivo (revisão 7): o site completa com o cadastro na hora de gerar */
export interface OmSignataria { nome: string; sigla: string; ug: string; artigo: "do" | "da"; endereco?: string; cnpj?: string; cidade?: string; ordenador?: Ordenador }
export interface Contratada { nome: string; cnpj?: string; endereco?: string; representante?: string; representante_feminino?: boolean }
/** Termo Aditivo (documento da SCON, revisão 7, seção 3L) */
export interface TermoAditivoScon {
  numero?: string | null;
  /** null = automático (MINUTA só quando vai para a CJU) */
  minuta?: boolean | null;
  preco_complemento?: string | null;
  /** null = automático ("2026/2027" quando o novo período atravessa o ano) */
  exercicio?: string | null;
  /** fonte e trecho: de onde o site leu (PDF do contrato ou TR), para a SCON conferir */
  garantia?: { exige: boolean | null; percentual?: number | null; base?: "termo" | "contrato"; valor_base?: number | null; fonte?: string | null; trecho?: string | null };
}
/** Demonstrativo de Execução e Saldo do Período de Vigência (seção 3K): preenchido pelo fiscal, só com prorrogação */
export interface EmpenhoPeriodo { numero: string; data: string; empenhado: number | null; liquidado: number | null; pago: number | null; a_liquidar?: number | null; marcado?: boolean; origem?: string }
export interface PendentePeriodo { descricao: string; periodo: string; nf: string; valor: number | null; empenho: string }
export interface SaldoPeriodo {
  inicio?: string | null; fim?: string | null; documento_periodo?: string | null; valor_periodo?: number | null;
  empenhos: EmpenhoPeriodo[]; liquidado?: number | null; pendentes: PendentePeriodo[]; observacoes?: string; om_cabecalho?: string | null;
}
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
  // ── Parecer Técnico de Alteração Contratual (revisão 5.1, seção 3J) ──
  /** "14133" | "8666" (o site copia do estado ao gerar) */
  lei?: string;
  contratada?: Contratada | null;
  // ── Termo Aditivo da SCON e Demonstrativo de Saldo (revisão 7) ──
  tipo_contrato?: string | null;
  /** licitação de origem ("Pregão nº 07/2020"), do cadastro do contrato */
  licitacao?: string | null;
  termo_aditivo?: TermoAditivoScon | null;
  saldo_periodo?: SaldoPeriodo | null;
  objeto_resumido?: string | null;
  /** item 5: contrato inicial e cada documento assinado, com o valor que o contrato passou a ter depois dele */
  historico?: HistoricoParecer[];
  /** item 10: itens do contrato (do cadastro dos Reajustes), valor atual e valor após o aditivo (editáveis) */
  itens?: ItemParecer[];
  parecer_tecnico?: ParecerTecnico | null;
}

export interface HistoricoParecer { documento: string; valor: number | null; variacao?: number | null; data?: string | null }
export interface ItemParecer { item: string; descricao: string; valor_atual: number | null; valor_apos?: number | null }
export interface EtapaEscopo { etapa: string; entrega: string; recebimento: string; pagamento: string; valor: number | null }
export interface ParecerTecnico {
  numero?: string | null;
  natureza?: "continuado" | "escopo";
  base?: "anual" | "mensal" | "total";
  clausula_vigencia?: string | null;
  clausula_reajuste?: string | null;
  /** null = automático (só com reajuste: "Consulta índice <índice>") */
  anexos?: string[] | null;
  /** null = as sugestões do site; lista = sai exatamente essa lista (o que o fiscal deixou na tela) */
  motivos?: string[] | null;
  cronograma_escopo?: EtapaEscopo[];
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
  /** Pesquisa de Preços: "site" (a feita no site) ou "anexo" (PDF feito fora do site, guardado em anexos.pesquisa_precos) */
  pesquisa_vale?: "site" | "anexo" | null;
  /** Termo Aditivo da SCON: quando foi gerado, por quem, e de qual salvamento (versão do registro) */
  termo_gerado?: { em: string; por: string | null; versao: number; arquivo: string } | null;
  /** salvamento usado em cada geração do .zip do fiscal (conferência da SCON) */
  zip_de?: { versao: number; salvo_em: string; salvo_por: string | null } | null;
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
