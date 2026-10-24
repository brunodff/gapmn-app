// Matriz de Atividades e Tarefas Mínimas dos Grupamentos de Apoio para o PTA 2027 (Anexo B do Ofício
// nº 35/CGOV/17011, da DIRAD, de 22 out. 2026). O código de tarefa passa a ser ano + trigrama do
// macroprocesso + sequencial (27FIN001), no lugar do ano + setor + sequencial da DCA 11-1, Anexo G, item VI.
// As tarefas da Matriz têm código e denominação fixos (001 até o último de cada macroprocesso); as tarefas
// próprias do GAP-MN continuam a numeração do macroprocesso a que pertencem.

import type { CategoriaId } from "./categorias.ts";

export type Macroprocesso = { nome: string; ultimoDaMatriz: number };

/** Trigramas da Matriz (aba CODIFICAÇÃO) e o último sequencial de tarefa da Matriz em cada um. */
export const MACROPROCESSOS: Readonly<Record<string, Macroprocesso>> = {
  FIN: { nome: "Finanças e Orçamento", ultimoDaMatriz: 5 },
  PES: { nome: "Pessoal", ultimoDaMatriz: 6 },
  PAT: { nome: "Patrimônio e Suprimentos", ultimoDaMatriz: 5 },
  INF: { nome: "Infraestrutura", ultimoDaMatriz: 5 },
  TIC: { nome: "Tecnologia da Informação", ultimoDaMatriz: 5 },
  // a aba CODIFICAÇÃO chama de DOC, mas as tarefas da Matriz usam ARQ (27ARQ001)
  ARQ: { nome: "Documental e Arquivo", ultimoDaMatriz: 5 },
  GOV: { nome: "Governança e Controle", ultimoDaMatriz: 7 },
  JUS: { nome: "Investigação e Justiça", ultimoDaMatriz: 5 },
  SES: { nome: "Serviço Social", ultimoDaMatriz: 5 },
  SVP: { nome: "Veteranos e Pensionistas", ultimoDaMatriz: 5 },
  ACS: { nome: "Atendimento e Comunicação Social", ultimoDaMatriz: 5 },
  CON: { nome: "Planejamento e Gerenciamento das Contratações", ultimoDaMatriz: 5 },
  ADM: { nome: "Suporte Administrativo (SISADM)", ultimoDaMatriz: 5 },
  PAG: { nome: "Pagamento de Pessoal (SISPAGAER)", ultimoDaMatriz: 6 },
  SUB: { nome: "Subsistência (SISUB)", ultimoDaMatriz: 5 },
  SFR: { nome: "Fardamento Reembolsável (SIFARE)", ultimoDaMatriz: 5 },
  SPV: { nome: "Provisões da Aeronáutica (SISPROV)", ultimoDaMatriz: 14 },
  SHT: { nome: "Hotéis de Trânsito (SISHT)", ultimoDaMatriz: 6 },
  SPN: { nome: "Próprios Nacionais Residenciais (SISPNR)", ultimoDaMatriz: 6 },
  STR: { nome: "Transporte de Superfície (SISTRAN)", ultimoDaMatriz: 5 },
  CMP: { nome: "Logística de Campanha (SISICAMP)", ultimoDaMatriz: 2 },
};

/** Último sequencial reservado à Matriz no trigrama (0 quando o trigrama não é da Matriz). */
export const ultimoDaMatriz = (trigrama: string) => MACROPROCESSOS[trigrama]?.ultimoDaMatriz ?? 0;

/** A tarefa é da Matriz (código fixo, não renumera)? */
export const ehDaMatriz = (trigrama: string, sequencial: number) => sequencial >= 1 && sequencial <= ultimoDaMatriz(trigrama);

/** Macroprocesso pelo PI, quando ele é de um sistema da Matriz (o hotel de trânsito paga pelo PI do SISHT). */
function macroDoPI(pi: string): string | null {
  if (/SISHT|HOTE/i.test(pi)) return "SHT";
  if (/SISPNR|\bPNR\b/i.test(pi)) return "SPN";
  return null;
}

/**
 * Macroprocesso sugerido para uma tarefa da composição orçamentária, pela natureza de despesa, pela categoria
 * do objeto e, quando for de um sistema da Matriz, pelo PI.
 */
export function macroSugerido(nd: string, cat: CategoriaId, pi = ""): string {
  const peloPI = macroDoPI(pi);
  if (peloPI) return peloPI;
  if (/^319/.test(nd) || /^3390(08|93)$/.test(nd) || cat === "pessoal") return "PAG";
  if (/^3390(14|15|33)$/.test(nd) || cat === "deslocamento" || cat === "capacitacao") return "PES";
  if (nd === "339092" || cat === "exercicios-anteriores" || cat === "tributos" || /^3390(47|36)$/.test(nd)) return "FIN";
  if (cat === "tic") return "TIC";
  if (/^449/.test(nd)) return "PAT";
  if (cat === "veiculos") return "STR";
  if (cat === "engenharia") return "INF";
  if (cat === "alimentacao") return "SUB";
  if (nd === "339030") {
    if (cat === "equipamentos") return "SPV";
    if (cat === "limpeza" || cat === "utilidades") return "ADM";
    return "PAT";
  }
  return "ADM";
}

const sem = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/**
 * Macroprocesso de uma tarefa já escrita (minutas feitas com o código por setor): pela descrição e pela
 * natureza de despesa, nas mesmas regras de `macroSugerido`.
 */
export function macroDaTarefa(nd: string, descricao: string, pi = ""): string {
  const peloPI = macroDoPI(pi);
  if (peloPI) return peloPI;
  const d = sem(descricao);
  if (/^319/.test(nd) || /^3390(08|93)$/.test(nd)) return "PAG";
  if (/diaria|passage|desloca|capacita|curso/.test(d) || /^3390(14|15|33)$/.test(nd)) return "PES";
  if (/exercicios? anteriores/.test(d) || nd === "339092" || /^3390(47|36)$/.test(nd)) return "FIN";
  if (/pesquisas? de preco|\birp|siasg|publicac(ao|oes) em jorna/.test(d)) return "CON";
  if (/correios|\bebct\b/.test(d)) return "ARQ";
  if (/almoxarifado/.test(d)) return "PAT";
  if (/informatica|tecnologia da informacao|telefon|software|internet|impress|servico movel/.test(d) || nd === "339040") return "TIC";
  if (/^449/.test(nd)) return "PAT";
  if (/viatura|combust|veicul|lubrificante|frota/.test(d)) return "STR";
  if (/energia|agua e esgoto|esgoto|servicos publicos|concession/.test(d)) return "ADM";
  if (/predial|infraestrutura|engenharia|obra|reforma|eletric|hidraul|climatiz|ar condicionado|construcao/.test(d)) return "INF";
  if (/alimenti|generos|rancho|copa e cozinha|refeic|hortifrut|carne|padaria|agricultura familiar/.test(d)) return "SUB";
  if (nd === "339030" && /fardamento|uniform/.test(d)) return "SPV";
  if (/limpeza|higiene|conservacao|lavanderia|residuo|vigilancia|energia|agua|esgoto|gas\b|servicos publicos|concession/.test(d)) return "ADM";
  if (nd === "339030") return "PAT";
  return "ADM";
}
