// Tipos do Painel de Governança (aba BD da planilha de indicadores).
// Só tipos: nada aqui existe em tempo de execução.

export type Direcao = "Maior é melhor" | "Menor é melhor" | "Monitoramento";
export type TipoLinha = "Realizado" | "Planejado";

/** Uma linha da aba BD: um indicador numa competência (formato longo). */
export type LinhaBD = {
  ID: string;
  DIVISAO: string;
  CATEGORIA: string;
  INDICADOR: string;
  UNIDADE: string;
  FORMULA: string;
  META_TXT: string | null;
  META_NUM: number | null;
  DIRECAO: Direcao;
  TIPO: TipoLinha;
  ANO: number;
  MES_NUM: number;
  MES: string;
  /** Primeiro dia da competência, 'yyyy-MM-dd'. JAN-JUN/26 → 2026-06-01. */
  DATA: string;
  VALOR: number | null;
  VAR1_NOME: string | null; VAR1_VALOR: number | null;
  VAR2_NOME: string | null; VAR2_VALOR: number | null;
  VAR3_NOME: string | null; VAR3_VALOR: number | null;
  /** Justificativa da divisão (coleta pelo formulário do app). */
  COMENTARIO?: string | null;
  /** A divisão anexou comprovante. */
  TEM_ANEXO?: boolean;
};

/** Contrato ou ata essencial informado pela DOC (checklist da coleta mensal). */
export type ContratoPainel = {
  competencia: string;
  ordem: number;
  servico: string;
  nup: string | null;
  termino: string | null;
  status: "Seguro" | "Atenção" | "Crítico" | null;
  providencias: string | null;
  atualizado_em: string | null;
};

export type PayloadBD = {
  ok: true;
  gerado_em: string;
  timezone?: string;
  planilha?: string;
  bd: LinhaBD[];
  /** Segunda fase: ainda não usado. */
  bd_integridade: unknown[];
  /** Ficha técnica por ID (aba CATALOGO da planilha); vazio se a aba não existir. */
  catalogo: Record<string, FichaCatalogo>;
  /** Contratos e atas essenciais da DOC, por competência (vem do banco do app). */
  contratos?: ContratoPainel[];
};

/** Ficha técnica do Catálogo de Indicadores de Desempenho (aba CATALOGO). */
export type FichaCatalogo = {
  objetivo: string | null;
  origem: string | null;
  periodicidade: string | null;
  unidade: string | null;
  meta: string | null;
};

export type Status =
  | "Adequado"
  | "Atenção"
  | "Crítico"
  | "Aguardando informação"
  | "Sem dados no mês de referência"
  | "Sem meta";

export type Competencia = {
  /** 'JUL/26' ou 'JAN-JUN/26'. */
  label: string;
  data: string;
  ano: number;
  mesNum: number;
  mes: string;
  /** true para competências como JAN-JUN (não são um mês). */
  semestral: boolean;
};

export type Variavel = { nome: string; valor: number };

/** Só para os IDs 16 e 22: sentido da variação entre o valor anterior e o atual. */
export type Variacao = {
  de: number;
  para: number;
  /** (para − de) ÷ de × 100; null quando o anterior é 0. */
  percentual: number | null;
  houveReducao: boolean;
};

export type Tendencia = {
  /** Variação média por competência, na unidade do indicador: (último − primeiro) ÷ 2. */
  media: number;
  pontos: { label: string; valor: number }[];
  /** Melhora ou piora conforme a direção do indicador; null quando não se aplica. */
  sentido: "melhora" | "piora" | "estável" | null;
};

export type IndicadorPainel = {
  id: string;
  /** Sigla gravada na planilha. */
  divisao: string;
  /** Sigla exibida (ID 35 → COMSOC). */
  divisaoExibida: string;
  categoria: string;
  /** Categoria sem o prefixo "N. ". */
  categoriaExibida: string;
  indicador: string;
  unidade: string;
  formula: string;
  metaTxt: string | null;
  metaNum: number | null;
  direcao: Direcao;
  valor: number | null;
  /** Valor na competência anterior com dados (não somado, só para comparação). */
  valorAnterior: number | null;
  variaveis: Variavel[];
  atingimento: number | null;
  status: Status;
  /** Pontos da nota (1 / 0,5 / 0); null quando o indicador não entra na nota. */
  pontos: number | null;
  /** Fora do ranking e dos cards: ID 35, EXTRAS e sem meta. */
  foraDaNota: boolean;
  variacao: Variacao | null;
  tendencia: Tendencia | null;
  /** Preenchido pela divisão (inclui "sem dados no mês", que é zero informado). */
  preenchido: boolean;
  /** O mesmo indicador na competência anterior com dados (ex.: AGO/26 quando a exibida é SET/26). */
  mesAnterior: PontoHistorico | null;
  /** Comparação do resultado com o mês anterior, conforme a direção; null quando não dá para comparar. */
  comparacaoMesAnterior: "melhora" | "piora" | "igual" | null;
  /** Todas as competências com dado, da mais antiga à mais recente. */
  historico: PontoHistorico[];
  /** Ficha técnica do catálogo (objetivo, origem dos dados…), quando a planilha tiver a aba CATALOGO. */
  catalogo: FichaCatalogo | null;
  /** Justificativa da divisão para o resultado da competência. */
  comentario?: string | null;
  temAnexo?: boolean;
};

/** O indicador numa competência, para o histórico. */
export type PontoHistorico = {
  label: string;
  data: string;
  valor: number | null;
  atingimento: number | null;
  status: Status;
  variaveis: Variavel[];
};

export type ContagemStatus = Record<Status, number>;


export type ItemContagem = {
  id: string;
  indicador: string;
  realizado: number | null;
  planejado: number | null;
  /** realizado ÷ planejado, quando planejado > 0. */
  execucao: number | null;
};

export type GrupoContagem = {
  categoria: string;
  divisao: string;
  /** true no Plano de Contratações Anual: planejado × realizado. */
  emparelhado: boolean;
  itens: ItemContagem[];
  total: number | null;
  totalPlanejado: number | null;
};

export type ResumoPainel = {
  /** Σ pontos ÷ n, sobre os indicadores que entram na nota. */
  saudeGeral: number | null;
  n: number;
  adequados: number;
  atencao: number;
  criticos: number;
  aguardando: number;
  semDados: number;
  completude: {
    preenchidos: number;
    comResultado: number;
    esperados: number;
    percentual: number | null;
  };
};

export type Painel = {
  competencias: Competencia[];
  competenciasComDados: Competencia[];
  /** Referência global (D.1), independente de filtro. */
  referenciaPadrao: Competencia | null;
  /** Competência exibida: a padrão ou a escolhida no seletor. */
  referencia: Competencia | null;
  anterior: Competencia | null;
  /** Divisões filtradas (vazio = todas). O filtro vale para o painel inteiro. */
  filtroDivisoes: string[];
  /** Todas as divisões com indicador na competência (opções do filtro). */
  siglasDivisoes: string[];
  /** Indicadores com meta de todas as divisões (para "x de y"). */
  totalIndicadores: number;
  /** Indicadores com meta (já filtrados por divisão), na ordem de D.7. */
  indicadores: IndicadorPainel[];
  /** Indicadores sem meta (fora de nota e ranking). */
  monitoramento: IndicadorPainel[];
  piores: IndicadorPainel[];
  /** Indicadores que mais melhoraram o atingimento em relação ao mês anterior. */
  avancos: IndicadorPainel[];
  grupos: GrupoContagem[];
  resumo: ResumoPainel;
  /** Saúde geral em cada competência com dado até a exibida (mesmo filtro de divisão). */
  serieSaude: { label: string; data: string; saude: number | null }[];
  /** Saúde na competência anterior com dados. */
  saudeAnterior: number | null;
  /** Variação média da saúde nos últimos 3 pontos, (último − primeiro) ÷ 2; null com menos de 3. */
  tendenciaSaude: number | null;
};

export type Filtros = {
  divisoes: string[];
  categorias: string[];
  status: Status[];
  busca: string;
};
