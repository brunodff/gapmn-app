// Matriz de Atividades, Itens de Controle e Tarefas Comuns dos Grupamentos de Apoio para o PTA 2027, revisada e
// atualizada pela DIRAD em 12 nov. 2026 (planilha "Matriz_PTA_2027_GAP_Revisada_e_Atualizada", aba CODIFICAÇÃO),
// que substitui a versão do Anexo D do Ofício nº 37/CGOV/17513. O código de tarefa é ano + trigrama do
// macroprocesso + sequencial (27SFI001), no lugar do ano + setor + sequencial da DCA 11-1, Anexo G, item VI.
// Nesta versão os trigramas passaram a ser os dos Sistemas do COMAER: FIN, PES, TIC, ARQ, GOV, JUS, SES e ACS viraram
// SFI, SPE, STI, SDC, SGI, SJU, SSS e SCS, e PAT, INF, CON e SAD foram reunidos em SAD (SISADM).
// As tarefas da Matriz têm código e denominação fixos (001 até o último de cada macroprocesso); as tarefas
// próprias do GAP-MN continuam a numeração do macroprocesso a que pertencem.

import type { CategoriaId } from "./categorias.ts";

export type Macroprocesso = { nome: string; ultimoDaMatriz: number };

/** Trigramas da Matriz (aba CODIFICAÇÃO) e o último sequencial de tarefa da Matriz em cada um. */
export const MACROPROCESSOS: Readonly<Record<string, Macroprocesso>> = {
  SFI: { nome: "Finanças e Orçamento (SISFINAER)", ultimoDaMatriz: 7 },
  SPE: { nome: "Administração de Pessoal (SISPAER)", ultimoDaMatriz: 7 },
  // manutenção das instalações, contratações e parcerias e suporte administrativo: um trigrama só
  SAD: { nome: "Manutenção das Instalações, Contratações e Suporte Administrativo (SISADM)", ultimoDaMatriz: 30 },
  STI: { nome: "Tecnologia da Informação (STI)", ultimoDaMatriz: 7 },
  SDC: { nome: "Documental e Arquivo (SISDOC)", ultimoDaMatriz: 5 },
  SGI: { nome: "Governança e Controle (SISGI)", ultimoDaMatriz: 9 },
  SJU: { nome: "Investigação e Justiça (SISJUR)", ultimoDaMatriz: 5 },
  SSS: { nome: "Serviço Social (SISESO)", ultimoDaMatriz: 5 },
  SVP: { nome: "Veteranos e Pensionistas (SAVPAR)", ultimoDaMatriz: 6 },
  SCS: { nome: "Atendimento e Comunicação Social (SISCOMSAE)", ultimoDaMatriz: 6 },
  SPP: { nome: "Pagamento de Pessoal (SISPAGAER)", ultimoDaMatriz: 8 },
  SUB: { nome: "Subsistência (SISUB)", ultimoDaMatriz: 8 },
  SFR: { nome: "Fardamento Reembolsável (SIFARE)", ultimoDaMatriz: 7 },
  SPV: { nome: "Provisões da Aeronáutica (SISPROV)", ultimoDaMatriz: 15 },
  SHT: { nome: "Hotéis de Trânsito (SISHT)", ultimoDaMatriz: 8 },
  SPN: { nome: "Próprios Nacionais Residenciais (SISPNR)", ultimoDaMatriz: 8 },
  STR: { nome: "Transporte de Superfície (SISTRAN)", ultimoDaMatriz: 6 },
  SCP: { nome: "Intendência em Campanha (SISICAMP)", ultimoDaMatriz: 5 },
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
  if (/^319/.test(nd) || /^3390(08|93)$/.test(nd) || cat === "pessoal") return "SPP";
  if (/^3390(14|15|33)$/.test(nd) || cat === "deslocamento" || cat === "capacitacao") return "SPE";
  if (nd === "339092" || cat === "exercicios-anteriores" || cat === "tributos" || /^3390(47|36)$/.test(nd)) return "SFI";
  if (cat === "tic") return "STI";
  if (/^449/.test(nd)) return "SAD";
  if (cat === "veiculos") return "STR";
  if (cat === "engenharia") return "SAD";
  if (cat === "alimentacao") return "SUB";
  if (nd === "339030" && cat === "equipamentos") return "SPV";
  return "SAD";
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
  if (/^319/.test(nd) || /^3390(08|93)$/.test(nd)) return "SPP";
  if (/diaria|passage|desloca|capacita|curso/.test(d) || /^3390(14|15|33)$/.test(nd)) return "SPE";
  if (/exercicios? anteriores/.test(d) || nd === "339092" || /^3390(47|36)$/.test(nd)) return "SFI";
  if (/correios|\bebct\b/.test(d)) return "SDC";
  if (/informatica|tecnologia da informacao|telefon|software|internet|impress|servico movel/.test(d) || nd === "339040") return "STI";
  if (/^449/.test(nd)) return "SAD"; // material permanente fica no patrimônio (SISADM)
  if (/viatura|combust|veicul|lubrificante|frota/.test(d)) return "STR";
  if (/alimenti|generos|rancho|copa e cozinha|refeic|hortifrut|carne|padaria|agricultura familiar/.test(d)) return "SUB";
  if (nd === "339030" && /fardamento|uniform/.test(d)) return "SPV";
  return "SAD";
}
