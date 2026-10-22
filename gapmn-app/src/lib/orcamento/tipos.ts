// Tipos do Painel Orçamentário (aba Crédito), réplica do Power BI "Painel de Controle | DOC-MN".

/** Um lançamento de crédito recebido (planilha "Dados (2)" do Power BI). */
export type LinhaRecebido = {
  /** Número da nota de crédito ("RO - Doc Web", ex.: 120002000012026NC011361). */
  nc: string;
  /** Descrição da nota de crédito ("Doc - Observação"). */
  obs: string;
  /** Data de emissão (AAAA-MM-DD). */
  data: string;
  /** Código da UG responsável. */
  ug: string;
  ugNome: string;
  sigla: string | null;
  nd: string;
  ndNome: string;
  pi: string;
  piNome: string;
  valor: number;
};

/** Uma nota de empenho já somada por item (planilha "Dados" do Power BI). */
export type Empenho = {
  ne: string;
  /** Data da nota (AAAA-MM-DD). */
  data: string;
  ugNome: string;
  sigla: string | null;
  nd: string;
  piNome: string;
  valor: number;
};

/** Uma linha de saldo de crédito disponível (planilha "Crédito Disponível"). */
export type LinhaDisponivel = {
  ptres: string;
  pi: string;
  piNome: string;
  nd: string;
  ndNome: string;
  /** Código da UG responsável. */
  ug: string;
  ugNome: string;
  sigla: string | null;
  valor: number;
};

/** Há quanto tempo chegou o crédito que forma um saldo. */
export type IdadeCredito = {
  /** Data do crédito mais antigo que ainda compõe o saldo (os empenhos gastam primeiro o mais antigo). */
  desde: string;
  /** Dias corridos de `desde` até hoje. */
  dias: number;
  /** Data do último crédito recebido na mesma UG, PI e ND. */
  ultimo: string;
  /** O saldo é maior que todo o crédito da planilha: parte veio antes dela (a idade é mínima). */
  parcial: boolean;
};

/** Uma nota de crédito recebida (as linhas da mesma nota na mesma UG, PI e ND somadas). */
export type NotaCredito = {
  nc: string;
  data: string;
  valor: number;
  obs: string;
  pi: string;
  piNome: string;
  nd: string;
};

/** Nota de crédito que ainda forma um saldo; `noSaldo` é a parte dela que sobra (a mais antiga pode já estar em parte empenhada). */
export type NotaNoSaldo = NotaCredito & { noSaldo: number };

export type LinhaSaldo = LinhaDisponivel & {
  idade: IdadeCredito | null;
  /** Notas de crédito que formam o saldo, da mais nova para a mais antiga. */
  notas: NotaNoSaldo[];
};

export type DadosOrcamento = {
  recebido: LinhaRecebido[];
  empenhos: Empenho[];
  disponivel: LinhaDisponivel[];
};

export type FiltroCredito = {
  /** Sigla da OM ("Selecione a OM"); null = todas. */
  om: string | null;
  /** Código da natureza de despesa ("Selecione a ND"); null = todas. */
  nd: string | null;
};

export type ValorRotulado = { rotulo: string; valor: number; dica?: string };

export type CartaoUnidade = { sigla: string; logo: string | null; valor: number };

export type UnidadeDisponivel = {
  rank: number;
  sigla: string;
  logo: string | null;
  valor: number;
  /** Crédito recebido pela unidade no último dia com lançamento (null = nenhum). */
  recebidoUltimoDia: number | null;
  /** Saldos por PI e ND, do crédito que chegou há menos tempo para o mais antigo. */
  linhas: LinhaSaldo[];
};

export type OpcaoND = { codigo: string; nome: string };

export type PainelCredito = {
  /** Data de referência da idade do crédito (hoje em Manaus, AAAA-MM-DD). */
  hoje: string;
  ano: number | null;
  /** Data do lançamento de crédito mais recente (AAAA-MM-DD), como o "Atualizado em" do BI. */
  atualizadoEm: string | null;
  recebido: number;
  empenhado: number;
  /** Empenhado ÷ recebido (null quando não houve crédito). */
  pctEmpenhado: number | null;
  /** Faixa "Crédito Recebido por Unidade": todas as apoiadas, maior para menor. */
  faixa: CartaoUnidade[];
  /** "Crédito Recebido por meses": só meses com lançamento, maior para menor (como no BI). */
  porMes: ValorRotulado[];
  porPI: ValorRotulado[];
  porOM: ValorRotulado[];
  disponivel: UnidadeDisponivel[];
  totalDisponivel: number;
  opcoesOM: string[];
  opcoesND: OpcaoND[];
};
