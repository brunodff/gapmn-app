// Planilhas do levantamento para a APLG: as mesmas abas e colunas da planilha que o formulário substituiu
// (com as colunas da APLG em branco), para montar a minuta do PTA.

import { entregasPorTrimestre, nomeSetor, pendencias, trimestreDe, valorDoCadastro, type Cadastro, type CadastroAtividade, type CadastroNecessidade, type CadastroProjeto } from "./cadastro.ts";

type Linha = Record<string, string | number>;

const quando = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Manaus", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const situacao = (c: Cadastro) => {
  const p = pendencias(c);
  return p.length ? p.join("; ") : "OK";
};
const APLG_PROJETO = { "Tipo de projeto (APLG)": "", "Código do projeto (APLG)": "", "Objetivo orgânico e diretriz (APLG)": "", "Natureza de despesa, ação e PI (APLG)": "" };
const APLG_ATIVIDADE = { "Tipo de atividade (APLG)": "", "Código da atividade (APLG)": "", "Atividade correspondente na Matriz (APLG)": "", "Natureza de despesa, ação e PI (APLG)": "" };

export function abasDoLevantamento(itens: Cadastro[]): Record<string, Linha[]> {
  const ativos = itens.filter((c) => !c.excluidoEm);
  const projetos = ativos.filter((c): c is CadastroProjeto => c.tipo === "projeto");
  const atividades = ativos.filter((c): c is CadastroAtividade => c.tipo === "atividade");
  const nP = new Map(projetos.map((c, i) => [c, `P${String(i + 1).padStart(2, "0")}`]));
  const nA = new Map(atividades.map((c, i) => [c, `A${String(i + 1).padStart(2, "0")}`]));

  const Projetos = projetos.map((c) => {
    const d = c.dados;
    const t = entregasPorTrimestre(c.etapas);
    return {
      "Nº": nP.get(c)!, "Divisão ou assessoria": nomeSetor(c.setor), "Seção": c.secao, "Nome do projeto": c.nome,
      "O que vai ficar pronto no fim": d.entrega, "Por que é necessário": d.porque, "O que acontece se não for feito": d.seNaoFizer,
      "Mês de início": d.inicio, "Mês de término": d.termino, "Responsável pelo acompanhamento": d.responsavel, "Ramal": d.ramal,
      "Precisa de dinheiro?": d.precisaDinheiro, "Valor estimado (R$)": d.valor ?? "", "O que será comprado ou contratado": d.compra,
      "Situação da contratação": d.contratacao, "Prioridade": d.prioridade, "Observações": d.observacoes,
      "Tarefas": c.etapas.filter((e) => e.tipo === "Tarefa").length, "Marcos": c.etapas.filter((e) => e.tipo === "Marco").length,
      "Entregas 1º/2º/3º/4º tri": t.join("/"), "Situação": situacao(c),
      "Preenchido por": `${c.posto} ${c.nomeGuerra}`.trim(), "Atualizado em": quando(c.atualizadoEm), "Versão": c.versao ?? 1,
      ...APLG_PROJETO,
    };
  });
  const Etapas = projetos.flatMap((c) => c.etapas.map((e, i) => ({
    "Nº do projeto": nP.get(c)!, "Projeto": c.nome, "Ordem": i + 1, "Tarefa ou marco": e.tipo, "Descrição": e.descricao,
    "Mês de início": e.tipo === "Tarefa" ? e.inicio : "", "Mês de término (ou do marco)": e.fim,
    "Trimestre": trimestreDe(e.fim) ? `${trimestreDe(e.fim)}º trimestre` : "", "Responsável": e.responsavel, "Como comprovar": e.comprova,
    "Código da tarefa (APLG)": "",
  })));
  const Atividades = atividades.map((c) => {
    const d = c.dados;
    return {
      "Nº": nA.get(c)!, "Divisão ou assessoria": nomeSetor(c.setor), "Seção": c.secao, "Nome da atividade": c.nome, "O que é feito": d.oQueE,
      "Já existe na Matriz da DIRAD?": d.matriz, "Rotina da Matriz": d.matrizAtividade, "Item de controle": d.itemControle,
      "Nome do indicador": d.indicador, "Como calcular": d.calculo, "Unidade": d.unidade, "Meta": d.meta, "Medição": d.medicao,
      "De onde vêm os dados": d.fonteDados, "Responsável pelo acompanhamento": d.responsavel, "Ramal": d.ramal,
      "Precisa de dinheiro?": d.precisaDinheiro, "Valor estimado no ano (R$)": d.valor ?? "", "O que será comprado ou contratado": d.compra,
      "Observações": d.observacoes, "Tarefas": c.etapas.length, "Situação": situacao(c),
      "Preenchido por": `${c.posto} ${c.nomeGuerra}`.trim(), "Atualizado em": quando(c.atualizadoEm), "Versão": c.versao ?? 1,
      ...APLG_ATIVIDADE,
    };
  });
  const Tarefas = atividades.flatMap((c) => c.etapas.map((t, i) => ({
    "Nº da atividade": nA.get(c)!, "Atividade": c.nome, "Ordem": i + 1, "Tarefa": t.tarefa, "Frequência": t.frequencia,
    "Prazo ou quando": t.quando, "Responsável": t.responsavel, "Como comprovar": t.comprova, "Código da tarefa (APLG)": "",
  })));
  const necessidades = ativos.filter((c): c is CadastroNecessidade => c.tipo === "necessidade");
  const Necessidades = necessidades.flatMap((c, l) => c.etapas.map((n, i) => ({
    "Nº da lista": `N${String(l + 1).padStart(2, "0")}`, "Item": i + 1, "Divisão ou assessoria": nomeSetor(c.setor), "Seção": c.secao,
    "Material ou serviço": n.natureza, "Necessidade": n.descricao, "Quantidade": n.quantidade, "Valor estimado (R$)": n.valor ?? "", "Por que é necessário": n.justificativa,
    "Observações da lista": c.dados.observacoes, "Preenchido por": `${c.posto} ${c.nomeGuerra}`.trim(), "Atualizado em": quando(c.atualizadoEm), "Versão": c.versao ?? 1,
    "Natureza de despesa, ação e PI (APLG)": "", "Código da tarefa (APLG)": "",
  })));
  return { "Projetos": Projetos, "Etapas dos projetos": Etapas, "Atividades": Atividades, "Tarefas das atividades": Tarefas, "Lista de necessidades": Necessidades };
}

/** Resumo do levantamento: por setor e por trimestre (só os cadastros ativos). */
export function resumo(itens: Cadastro[]) {
  const ativos = itens.filter((c) => !c.excluidoEm);
  const porSetor = new Map<string, { projetos: number; atividades: number; necessidades: number; pendentes: number; valor: number }>();
  const trimestres: [number, number, number, number] = [0, 0, 0, 0];
  let valor = 0, pendentes = 0, itensNecessidade = 0;
  for (const c of ativos) {
    const s = porSetor.get(c.setor) ?? { projetos: 0, atividades: 0, necessidades: 0, pendentes: 0, valor: 0 };
    if (c.tipo === "projeto") {
      s.projetos++;
      entregasPorTrimestre(c.etapas).forEach((n, i) => { trimestres[i] += n; });
    } else if (c.tipo === "atividade") s.atividades++;
    else { s.necessidades += c.etapas.length; itensNecessidade += c.etapas.length; }
    const v = valorDoCadastro(c);
    s.valor += v; valor += v;
    if (pendencias(c).length) { s.pendentes++; pendentes++; }
    porSetor.set(c.setor, s);
  }
  return {
    projetos: ativos.filter((c) => c.tipo === "projeto").length,
    atividades: ativos.filter((c) => c.tipo === "atividade").length,
    itensNecessidade,
    pendentes, valor, trimestres, porSetor,
    excluidos: itens.length - ativos.length,
  };
}
