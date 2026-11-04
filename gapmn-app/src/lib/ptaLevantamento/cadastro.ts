// Levantamento dos projetos e atividades do PTA: o que cada setor cadastra no formulário (/pta-levantamento),
// as listas de escolha, os exemplos e a conferência (os mesmos avisos da planilha que este formulário substitui).
// Fontes: Of nº 37/CGOV/17513 (DIRAD, 03/11/2026), Instruções para Lançamento no GPAer – PTA 2027 (Anexo C),
// Matriz de Atividades e Tarefas Comuns – PTA 2027 (Anexo D) e DCA 11-1/2020, Anexo G.

export type Tipo = "projeto" | "atividade";

/** Divisões e assessorias que respondem (espelho de pta_lev_setor_valido, na migração 20261104). */
export const SETORES: { sigla: string; nome: string }[] = [
  { sigla: "DA", nome: "Divisão de Administração" },
  { sigla: "DRH", nome: "Divisão de Recursos Humanos" },
  { sigla: "DIE", nome: "Divisão de Infraestrutura" },
  { sigla: "DOC", nome: "Divisão de Obtenções e Contratos" },
  { sigla: "SEC", nome: "Secretaria da Chefia" },
  { sigla: "ACI", nome: "Assessoria de Controle Interno" },
  { sigla: "AJUR", nome: "Assessoria Jurídica e de Investigação e Justiça" },
  { sigla: "APLG", nome: "Assessoria de Planejamento e Governança" },
  { sigla: "ARC", nome: "Assessoria de Riscos Contratuais" },
  { sigla: "ASESO", nome: "Assessoria de Serviço Social" },
];
export const nomeSetor = (sigla: string) => {
  const s = SETORES.find((x) => x.sigla === sigla);
  return s ? `${s.nome} (${s.sigla})` : sigla;
};

export const POSTOS = [
  "Cel", "Ten Cel", "Maj", "Cap", "1º Ten", "2º Ten", "Asp",
  "SO", "1S", "2S", "3S", "Cb", "S1", "S2", "Servidor civil",
] as const;

/** Meses do ano do PTA ("jan/2027" … "dez/2027"). */
export const mesesDoAno = (ano: number) =>
  ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"].map((m) => `${m}/${ano}`);

export const SIM_NAO = ["Sim", "Não", "Não sei"] as const;
export const CONTRATACAO = [
  "Não precisa comprar ou contratar", "Já tem contrato ou ata vigente", "Processo de contratação em andamento",
  "Está no PCA, sem processo ainda", "Não está no PCA", "Não sei",
] as const;
export const PRIORIDADE = ["Alta — essencial no ano", "Média — importante", "Baixa — se houver recurso"] as const;
export const FREQUENCIA = ["Diária", "Semanal", "Quinzenal", "Mensal", "Bimestral", "Trimestral", "Semestral", "Anual", "Sob demanda", "Uma vez no ano"] as const;
export const UNIDADE = ["%", "dias", "horas", "quantidade", "R$", "nota de 0 a 10"] as const;
export const MATRIZ_OPC = ["Não, é uma atividade nova", "Sim, quero acrescentar tarefas", "Sim, quero mudar algo nela", "Não sei"] as const;
export const jaExisteNaMatriz = (opcao: string) => opcao.startsWith("Sim");

// ── o que se cadastra ────────────────────────────────────────────────────────

export type Etapa = {
  tipo: "Tarefa" | "Marco";
  descricao: string;
  inicio: string;      // só tarefa
  fim: string;         // término da tarefa ou mês do marco
  responsavel: string;
  comprova: string;
};

export type TarefaRotina = {
  tarefa: string;
  frequencia: string;
  quando: string;
  responsavel: string;
  comprova: string;
};

export type DadosProjeto = {
  entrega: string; porque: string; seNaoFizer: string;
  inicio: string; termino: string; responsavel: string; ramal: string;
  precisaDinheiro: string; valor: number | null; compra: string; contratacao: string; prioridade: string;
  observacoes: string;
};

export type DadosAtividade = {
  oQueE: string; matriz: string; matrizAtividade: string;
  itemControle: string; indicador: string; calculo: string; unidade: string; meta: string; medicao: string; fonteDados: string;
  responsavel: string; ramal: string; precisaDinheiro: string; valor: number | null; compra: string; observacoes: string;
};

type Base = {
  id: string | null;
  setor: string; secao: string; nome: string;
  posto: string; nomeGuerra: string;            // quem preencheu
  atualizadoEm?: string | null; criadoEm?: string | null; versao?: number; excluidoEm?: string | null;
};
export type CadastroProjeto = Base & { tipo: "projeto"; dados: DadosProjeto; etapas: Etapa[] };
export type CadastroAtividade = Base & { tipo: "atividade"; dados: DadosAtividade; etapas: TarefaRotina[] };
export type Cadastro = CadastroProjeto | CadastroAtividade;

export const PROJETO_VAZIO: DadosProjeto = {
  entrega: "", porque: "", seNaoFizer: "", inicio: "", termino: "", responsavel: "", ramal: "",
  precisaDinheiro: "", valor: null, compra: "", contratacao: "", prioridade: "", observacoes: "",
};
export const ATIVIDADE_VAZIA: DadosAtividade = {
  oQueE: "", matriz: "", matrizAtividade: "", itemControle: "", indicador: "", calculo: "", unidade: "", meta: "", medicao: "",
  fonteDados: "", responsavel: "", ramal: "", precisaDinheiro: "", valor: null, compra: "", observacoes: "",
};
export const etapaVazia = (tipo: Etapa["tipo"], responsavel = ""): Etapa => ({ tipo, descricao: "", inicio: "", fim: "", responsavel, comprova: "" });
export const tarefaVazia = (responsavel = ""): TarefaRotina => ({ tarefa: "", frequencia: "", quando: "", responsavel, comprova: "" });

export function novoCadastro(tipo: Tipo, quem: { setor?: string; secao?: string; posto?: string; nomeGuerra?: string } = {}): Cadastro {
  const base = { id: null, setor: quem.setor ?? "", secao: quem.secao ?? "", nome: "", posto: quem.posto ?? "", nomeGuerra: quem.nomeGuerra ?? "" };
  return tipo === "projeto"
    ? { ...base, tipo, dados: { ...PROJETO_VAZIO }, etapas: [] }
    : { ...base, tipo, dados: { ...ATIVIDADE_VAZIA }, etapas: [] };
}

// ── exemplos (os mesmos da planilha; valores e nomes ilustrativos) ───────────

export function exemploProjeto(ano: number): CadastroProjeto {
  const m = mesesDoAno(ano);
  return {
    id: null, tipo: "projeto", setor: "DA", secao: "Hotel de trânsito", nome: "Reforma dos apartamentos do hotel de trânsito",
    posto: "Cap", nomeGuerra: "EXEMPLO",
    dados: {
      entrega: "12 apartamentos reformados no padrão REPOUSAR",
      porque: "Os apartamentos têm infiltrações e mobiliário danificado; as pesquisas de satisfação apontam queda.",
      seNaoFizer: "Apartamentos interditados e perda de receita do hotel.",
      inicio: m[1], termino: m[10], responsavel: "Cap Exemplo", ramal: "0000",
      precisaDinheiro: "Sim", valor: 350000, compra: "Empresa de engenharia para a reforma",
      contratacao: "Está no PCA, sem processo ainda", prioridade: "Alta — essencial no ano", observacoes: "",
    },
    etapas: [
      { tipo: "Tarefa", descricao: "Elaborar o projeto básico e o orçamento da reforma", inicio: m[1], fim: m[2], responsavel: "Cap Exemplo", comprova: "Projeto básico assinado" },
      { tipo: "Marco", descricao: "Projeto básico aprovado", inicio: "", fim: m[2], responsavel: "Cap Exemplo", comprova: "Despacho de aprovação" },
      { tipo: "Tarefa", descricao: "Contratar a empresa de engenharia", inicio: m[3], fim: m[5], responsavel: "Cap Exemplo", comprova: "Contrato publicado" },
      { tipo: "Marco", descricao: "Contrato da reforma assinado", inicio: "", fim: m[5], responsavel: "Cap Exemplo", comprova: "Extrato no DOU" },
      { tipo: "Tarefa", descricao: "Executar e fiscalizar a reforma", inicio: m[6], fim: m[9], responsavel: "Cap Exemplo", comprova: "Relatórios de fiscalização" },
      { tipo: "Marco", descricao: "Reforma recebida e apartamentos liberados", inicio: "", fim: m[10], responsavel: "Cap Exemplo", comprova: "Termo de recebimento definitivo" },
    ],
  };
}

export function exemploAtividade(): CadastroAtividade {
  return {
    id: null, tipo: "atividade", setor: "DIE", secao: "Seção de manutenção", nome: "Manutenção preventiva dos aparelhos de ar-condicionado",
    posto: "1S", nomeGuerra: "EXEMPLO",
    dados: {
      oQueE: "Limpeza, revisão e troca de peças dos aparelhos conforme o plano de manutenção", matriz: "Não sei", matrizAtividade: "",
      itemControle: "Aparelhos de ar-condicionado com manutenção preventiva em dia",
      indicador: "Percentual de aparelhos com preventiva no prazo",
      calculo: "Aparelhos com preventiva no prazo ÷ total de aparelhos × 100", unidade: "%", meta: "95%", medicao: "Mensal",
      fonteDados: "Planilha de ordens de serviço da seção", responsavel: "1S Exemplo", ramal: "0000",
      precisaDinheiro: "Sim", valor: 60000, compra: "Peças e materiais de reposição", observacoes: "",
    },
    etapas: [
      { tarefa: "Atualizar o inventário dos aparelhos de ar-condicionado", frequencia: "Semestral", quando: "em janeiro e julho", responsavel: "1S Exemplo", comprova: "Inventário atualizado" },
      { tarefa: "Executar a manutenção preventiva conforme o plano", frequencia: "Mensal", quando: "até o último dia útil", responsavel: "1S Exemplo", comprova: "Ordens de serviço fechadas" },
      { tarefa: "Registrar o indicador e encaminhar à chefia da divisão", frequencia: "Mensal", quando: "até o 5º dia útil", responsavel: "1S Exemplo", comprova: "Planilha do indicador" },
    ],
  };
}

// ── conferência ──────────────────────────────────────────────────────────────

const vazio = (s: string | null | undefined) => !s || !s.trim();
/** "mar/2027" → 3 (0 se não for mês). */
export const numeroDoMes = (mes: string) => {
  const i = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"].indexOf((mes ?? "").slice(0, 3));
  return i + 1;
};
/** 1º = jan a mar; 2º = abr a jun; 3º = jul a set; 4º = out a dez (0 = sem mês). */
export const trimestreDe = (mes: string) => Math.ceil(numeroDoMes(mes) / 3);

/** O que falta numa etapa de projeto (lista vazia = OK). */
export function avisosEtapa(e: Etapa, projeto?: DadosProjeto): string[] {
  const a: string[] = [];
  if (vazio(e.descricao)) a.push(e.tipo === "Marco" ? "Falta descrever a entrega" : "Falta descrever a tarefa");
  if (vazio(e.fim)) a.push(e.tipo === "Marco" ? "Falta o mês do marco" : "Falta o mês de término");
  if (e.tipo === "Tarefa") {
    if (vazio(e.inicio)) a.push("Falta o mês de início");
    else if (!vazio(e.fim) && numeroDoMes(e.fim) < numeroDoMes(e.inicio)) a.push("Término antes do início");
  }
  if (vazio(e.responsavel)) a.push("Falta o responsável");
  if (projeto && !vazio(e.fim) && !vazio(projeto.termino) && numeroDoMes(e.fim) > numeroDoMes(projeto.termino)) {
    a.push("Termina depois do fim do projeto");
  }
  if (projeto && !vazio(projeto.inicio)) {
    const comeco = e.tipo === "Tarefa" ? e.inicio : e.fim;
    if (!vazio(comeco) && numeroDoMes(comeco) < numeroDoMes(projeto.inicio)) a.push("Começa antes do início do projeto");
  }
  return a;
}

export function avisosTarefa(t: TarefaRotina): string[] {
  const a: string[] = [];
  if (vazio(t.tarefa)) a.push("Falta a tarefa");
  if (vazio(t.frequencia)) a.push("Falta a frequência");
  if (vazio(t.responsavel)) a.push("Falta o responsável");
  return a;
}

/** Pendências do cadastro, na ordem em que aparecem no formulário (lista vazia = completo). */
export function pendencias(c: Cadastro): string[] {
  const p: string[] = [];
  if (vazio(c.setor)) p.push("Falta a divisão ou assessoria");
  if (vazio(c.nome)) p.push(c.tipo === "projeto" ? "Falta o nome do projeto" : "Falta o nome da atividade");
  if (c.tipo === "projeto") {
    const d = c.dados;
    if (vazio(d.entrega)) p.push("Falta dizer o que vai ficar pronto");
    if (vazio(d.porque)) p.push("Falta dizer por que é necessário");
    if (vazio(d.inicio)) p.push("Falta o mês de início");
    if (vazio(d.termino)) p.push("Falta o mês de término");
    if (!vazio(d.inicio) && !vazio(d.termino) && numeroDoMes(d.termino) < numeroDoMes(d.inicio)) p.push("Término antes do início");
    if (vazio(d.responsavel)) p.push("Falta o responsável pelo acompanhamento");
    p.push(...pendenciasDinheiro(d.precisaDinheiro, d.valor, d.compra));
    if (d.precisaDinheiro === "Sim" && vazio(d.contratacao)) p.push("Falta a situação da contratação");
    if (vazio(d.prioridade)) p.push("Falta a prioridade");
    const tarefas = c.etapas.filter((e) => e.tipo === "Tarefa").length;
    const marcos = c.etapas.filter((e) => e.tipo === "Marco").length;
    if (!tarefas) p.push("Falta cadastrar as tarefas");
    if (!marcos) p.push("Falta pelo menos um marco");
    const comAviso = c.etapas.filter((e) => avisosEtapa(e, d).length).length;
    if (comAviso) p.push(comAviso === 1 ? "1 etapa com aviso" : `${comAviso} etapas com aviso`);
  } else {
    const d = c.dados;
    if (vazio(d.oQueE)) p.push("Falta dizer o que é feito");
    if (vazio(d.itemControle)) p.push("Falta o item de controle");
    if (vazio(d.indicador) || vazio(d.calculo) || vazio(d.meta)) p.push("Falta o indicador (nome, cálculo e meta)");
    if (vazio(d.responsavel)) p.push("Falta o responsável pelo acompanhamento");
    p.push(...pendenciasDinheiro(d.precisaDinheiro, d.valor, d.compra));
    if (!c.etapas.length) p.push("Falta cadastrar as tarefas");
    const comAviso = c.etapas.filter((t) => avisosTarefa(t).length).length;
    if (comAviso) p.push(comAviso === 1 ? "1 tarefa com aviso" : `${comAviso} tarefas com aviso`);
  }
  return p;
}

function pendenciasDinheiro(precisa: string, valor: number | null, compra: string): string[] {
  if (vazio(precisa)) return ["Diga se precisa de dinheiro"];
  if (precisa !== "Sim") return [];
  const p: string[] = [];
  if (valor === null || !Number.isFinite(valor) || valor <= 0) p.push("Falta o valor estimado");
  if (vazio(compra)) p.push("Falta dizer o que será comprado ou contratado");
  return p;
}

/** Tarefas e marcos que terminam em cada trimestre: [1º, 2º, 3º, 4º]. */
export function entregasPorTrimestre(etapas: Etapa[]): [number, number, number, number] {
  const t: [number, number, number, number] = [0, 0, 0, 0];
  for (const e of etapas) {
    const q = trimestreDe(e.fim);
    if (q >= 1 && q <= 4) t[q - 1]++;
  }
  return t;
}

/** Valor digitado em reais ("350.000", "350000,50", "R$ 1.200") → número, ou null se vazio/ inválido. */
export function lerReais(texto: string): number | null {
  const t = (texto ?? "").replace(/R\$|\s/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/\.(?=\d{3}(\D|$))/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
export const moeda = (v: number | null | undefined) =>
  typeof v === "number" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

// ── banco ↔ tela ─────────────────────────────────────────────────────────────

export type ItemDoBanco = {
  id: string; ano?: number; tipo: Tipo; setor: string; secao: string | null; nome: string; posto: string; nome_guerra: string;
  dados: Record<string, unknown> | null; etapas: unknown[] | null;
  criado_em?: string | null; atualizado_em?: string | null; versao?: number; excluido_em?: string | null;
};

const texto = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function doBanco(i: ItemDoBanco): Cadastro {
  const base = {
    id: i.id, setor: texto(i.setor), secao: texto(i.secao), nome: texto(i.nome), posto: texto(i.posto), nomeGuerra: texto(i.nome_guerra),
    atualizadoEm: i.atualizado_em ?? null, criadoEm: i.criado_em ?? null, versao: i.versao ?? 1, excluidoEm: i.excluido_em ?? null,
  };
  const d = (i.dados ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(i.etapas) ? (i.etapas as Record<string, unknown>[]) : [];
  if (i.tipo === "projeto") {
    const dados = Object.fromEntries(Object.keys(PROJETO_VAZIO).map((k) => [k, k === "valor" ? numero(d[k]) : texto(d[k])])) as DadosProjeto;
    const etapas: Etapa[] = lista.map((e) => ({
      tipo: e.tipo === "Marco" ? "Marco" : "Tarefa", descricao: texto(e.descricao), inicio: e.tipo === "Marco" ? "" : texto(e.inicio),
      fim: texto(e.fim), responsavel: texto(e.responsavel), comprova: texto(e.comprova),
    }));
    return { ...base, tipo: "projeto", dados, etapas };
  }
  const dados = Object.fromEntries(Object.keys(ATIVIDADE_VAZIA).map((k) => [k, k === "valor" ? numero(d[k]) : texto(d[k])])) as DadosAtividade;
  const etapas: TarefaRotina[] = lista.map((t) => ({
    tarefa: texto(t.tarefa), frequencia: texto(t.frequencia), quando: texto(t.quando), responsavel: texto(t.responsavel), comprova: texto(t.comprova),
  }));
  return { ...base, tipo: "atividade", dados, etapas };
}

const limpo = (s: string) => s.replace(/\s+/g, " ").trim();

/** O que vai para pta_lev_salvar: textos aparados, etapas vazias fora, marco sem mês de início. */
export function paraBanco(c: Cadastro) {
  const dados = Object.fromEntries(Object.entries(c.dados).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
  const etapas = c.tipo === "projeto"
    ? c.etapas.filter((e) => !vazio(e.descricao) || !vazio(e.fim) || !vazio(e.inicio))
      .map((e) => ({ ...e, descricao: limpo(e.descricao), inicio: e.tipo === "Marco" ? "" : e.inicio, responsavel: limpo(e.responsavel), comprova: limpo(e.comprova) }))
    : c.etapas.filter((t) => !vazio(t.tarefa))
      .map((t) => ({ ...t, tarefa: limpo(t.tarefa), quando: limpo(t.quando), responsavel: limpo(t.responsavel), comprova: limpo(t.comprova) }));
  return {
    tipo: c.tipo, setor: c.setor, secao: limpo(c.secao), nome: limpo(c.nome), posto: c.posto, nome_guerra: limpo(c.nomeGuerra).toUpperCase(),
    dados, etapas,
  };
}
