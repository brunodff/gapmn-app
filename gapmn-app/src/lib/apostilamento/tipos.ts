// Dados de um contrato para o motor de reajuste por apostilamento da SCON (motor/gerar_apostilamento.py).
// Mesmos campos do docs/ESQUEMA_DE_DADOS.md do pacote da SCON: o app guarda este objeto em
// contratos_apostilamento.dados e o entrega ao motor como JSON.

export type BaseValor = "ANUAL" | "MENSAL" | "TOTAL";

export interface Empresa {
  nome: string;
  cnpj: string;
  endereco: string;
  representante: string;
  representante_feminino?: boolean;
}

export interface Indice {
  nome: string;      // IPCA, INPC, IGP-M, IGP-DI, IPCA-E, INCC…
  clausula: string;  // "a CLÁUSULA SÉTIMA, item 7.2, do Contrato"
  fonte_curta?: string;
}

export interface Reajuste {
  n: number;                 // 1º, 2º… reajuste desde a data do orçamento
  indice_pct: number | null; // percentual acumulado dos 12 meses (6 casas)
  novo: boolean;             // true = pedido agora; false = já aplicado em apostilamento anterior
  documento?: string;        // reajuste já aplicado: documento que o aplicou
}

export interface ItemContrato {
  item: number;              // mesma numeração do contrato
  descricao: string;
  catser?: string;
  qtd: number | null;        // quantidade atual
  qtd_inicial?: number | null; // só se houve supressão ou acréscimo
  valor_unit: number | null; // unitário mensal
  valor_base: number | null; // valor do item na base escolhida, com a quantidade atual
  valor_atual_documentado?: number | null;
}

export interface HistoricoValor { documento: string; valor: number | null }
export interface AlteracaoQuantitativa { documento: string; data_assinatura: string; descricao: string }

export interface Orcamento {
  gestao_unidade: string;
  fonte: string;
  programa_trabalho: string; // PTRES
  acao?: string;
  plano_interno: string;
  natureza_despesa: string;
  exercicio: number | string;
  ug_texto?: string;
}

export interface DadosReajuste {
  contrato: string;
  nup: string;
  om_contratante_sigla: string;
  om_contratante_nome: string;
  empresa: Empresa;
  objeto_completo: string;
  objeto_resumido: string;
  om_ordenador?: string;
  contratante_paragrafo?: string;
  contratada_paragrafo?: string;
  indice: Indice;
  data_base: string; // MM/AAAA (data do orçamento)
  base: BaseValor;
  mostrar_unitario: boolean;
  reajustes: Reajuste[];
  numero_instrumento: number | null;
  instrumento: string; // "Termo de Apostilamento" | "Termo Aditivo"
  parecer_numero: string;
  itens: ItemContrato[];
  itens_total_inicial: number | null;
  historico_valores: HistoricoValor[];
  alteracoes_quantitativas: AlteracaoQuantitativa[];
  complemento_supressao: boolean;
  orcamento: Orcamento;
  fiscal: { funcao: string };
  data_declaracao?: string; // AAAA-MM-DD; vazio = "data conforme assinatura eletrônica"
  observacoes_extras: string[];
}

/** Configuração do app que o motor usa no lugar dos dados que não podem ficar no código. */
export interface ConfigApostilamento {
  ordenador: { nome: string; posto: string; feminino: boolean; portaria: string; publicacao: string; matricula: string; om_sigla: string };
  aci: { nome: string; posto: string; funcao: string };
  cidade: string;
  ug_apoio: { nome: string; sigla: string; endereco: string; cnpj: string };
  textos_fixos_om: Record<string, string>;
  dias_alerta: number;
}

export interface ItemChecagem { campo: string; status: "OK" | "ATENCAO" | "FALTA"; valor: unknown; mensagem: string }
export interface ResultadoChecagem { pode_gerar: boolean; itens: ItemChecagem[] }

export interface ResumoReajuste {
  regra_periodo: string;
  reajustes: { n: number; novo: boolean; inicio: string; fim: string; indice_pct: number; efeitos: string }[];
  valor_atual: number;
  valor_reajustado: number;
  diferenca_anual: number;
  complemento_supressao: number;
  valor_termo: number;
  valor_termo_extenso: string;
  efeitos_financeiros: string;
}
export interface ResultadoGeracao { resumo: ResumoReajuste; avisos: string[]; arquivos: string[] }

export const CONFIG_VAZIA: ConfigApostilamento = {
  ordenador: { nome: "", posto: "", feminino: false, portaria: "", publicacao: "", matricula: "", om_sigla: "GAP-MN" },
  aci: { nome: "", posto: "", funcao: "Agente de Controle Interno do GAP-MN" },
  cidade: "Manaus",
  ug_apoio: { nome: "GRUPAMENTO DE APOIO DE MANAUS", sigla: "GAP-MN", endereco: "Avenida Rodrigo Otávio, 780, Bairro Crespo, CEP 69073-177", cnpj: "00.394.429/0188-24" },
  textos_fixos_om: {},
  dias_alerta: 60,
};
