// Tipos da coleta mensal dos indicadores (tabelas gov_* e funções gov_formulario / gov_salvar).

import type { Direcao } from "../indicadores/tipos.ts";
import type { Calculo } from "./formulas.ts";

export type TipoLancamento = "Realizado" | "Planejado";
export type StatusContrato = "Seguro" | "Atenção" | "Crítico";

export type IndicadorGov = {
  id: string;
  divisao: string;
  categoria: string;
  indicador: string;
  unidade: string;
  formula: string;
  calculo: Calculo;
  /** Nomes das variáveis, na ordem v1, v2, v3 (vazio nos de valor direto). */
  variaveis: string[];
  meta_txt: string | null;
  meta_num: number | null;
  direcao: Direcao;
  /** Tem linha Planejado além do Realizado (Plano de Contratações Anual). */
  planejado: boolean;
  ordem: number;
};

export type LancamentoGov = {
  indicador_id: string;
  tipo: TipoLancamento;
  v1: number | null;
  v2: number | null;
  v3: number | null;
  valor: number | null;
  comentario: string | null;
  anexo_nome: string | null;
  tem_anexo: boolean;
  posto: string | null;
  nome_guerra: string | null;
  atualizado_em: string;
  versao: number;
};

/** Último valor de cada indicador antes da competência (referência no formulário). */
export type AnteriorGov = {
  indicador_id: string;
  tipo: TipoLancamento;
  competencia: string;
  rotulo: string | null;
  valor: number | null;
  v1: number | null;
  v2: number | null;
};

export type ContratoGov = {
  id: string | null;
  ordem: number;
  servico: string;
  nup: string | null;
  /** 'AAAA-MM-DD' */
  termino: string | null;
  status: StatusContrato | null;
  providencias: string | null;
  /** Um dos serviços essenciais padrão (não sai da lista). */
  padrao: boolean;
  posto?: string | null;
  nome_guerra?: string | null;
  atualizado_em?: string | null;
};

export type CompetenciaFormulario = { codigo: string; rotulo: string; aberta: boolean; prazo: string | null };

export type Formulario = {
  competencia: CompetenciaFormulario;
  indicadores: IndicadorGov[];
  lancamentos: LancamentoGov[];
  anteriores: AnteriorGov[];
  contratos: {
    /** 'competencia' = já salvos nesta; 'anterior' = trazidos da última que tinha; 'padrao' = lista inicial. */
    origem: "competencia" | "anterior" | "padrao";
    de?: string;
    itens: ContratoGov[];
  };
};

export type Identificacao = { posto: string; nome: string; divisao: string };

/** O que vai para gov_salvar por indicador (o valor é calculado no banco). */
export type ItemParaSalvar = {
  indicador_id: string;
  tipo: TipoLancamento;
  v1: number | null;
  v2: number | null;
  v3: number | null;
  comentario: string | null;
  anexo?: string | null;
  anexo_nome?: string | null;
};

/** Competência vista por quem administra (tabela gov_competencias). */
export type CompetenciaAdmin = {
  codigo: string;
  rotulo: string;
  semestral: boolean;
  token: string | null;
  aberta: boolean;
  prazo: string | null;
  origem: "formulario" | "planilha";
  aberta_em: string | null;
  fechada_em: string | null;
};

/** Lançamento completo, com o caminho do anexo (só ADMIN e DEV leem). */
export type LancamentoAdmin = Omit<LancamentoGov, "tem_anexo"> & { competencia: string; anexo: string | null; divisao: string | null };

export type HistoricoGov = {
  id: number;
  competencia: string;
  indicador_id: string;
  tipo: TipoLancamento;
  antes: Partial<Record<"v1" | "v2" | "v3" | "valor" | "comentario" | "anexo_nome", number | string | null>> | null;
  depois: Partial<Record<"v1" | "v2" | "v3" | "valor" | "comentario" | "anexo_nome", number | string | null>> | null;
  posto: string | null;
  nome_guerra: string | null;
  quando: string;
};

export type ContratoAdmin = ContratoGov & { competencia: string };
