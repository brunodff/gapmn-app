// Testes do levantamento do PTA: conferência (os avisos da planilha), conversão banco ↔ tela e planilhas da APLG.
// Rodar na pasta gapmn-app:  npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  avisosEtapa, avisosNecessidade, avisosTarefa, doBanco, entregasPorTrimestre, exemploAtividade, exemploNecessidade, exemploProjeto, lerReais, necessidadeVazia, novoCadastro,
  paraBanco, pendencias, SETORES, totalNecessidades, trimestreDe, valorDoCadastro, type CadastroAtividade, type CadastroNecessidade, type CadastroProjeto,
} from "./cadastro.ts";
import { abasDoLevantamento, resumo } from "./exportar.ts";
import { MATRIZ_PREVISTA } from "./matrizPrevista.ts";

test("os exemplos estão completos (sem pendência)", () => {
  assert.deepEqual(pendencias(exemploProjeto(2027)), []);
  assert.deepEqual(pendencias(exemploAtividade()), []);
  assert.deepEqual(pendencias(exemploNecessidade()), []);
});

test("lista de necessidades: o que falta, ida e volta ao banco e nome gerado", () => {
  const nova = novoCadastro("necessidade") as CadastroNecessidade;
  assert.equal(nova.etapas.length, 1, "já abre com um item em branco");
  assert.deepEqual(pendencias(nova), ["Falta a divisão ou assessoria", "Falta a seção", "Falta cadastrar as necessidades", "1 necessidade com aviso"]);
  assert.deepEqual(avisosNecessidade(necessidadeVazia()), ["Diga se é material ou serviço", "Falta descrever a necessidade", "Falta a quantidade"]);
  // valor e justificativa são opcionais
  assert.deepEqual(avisosNecessidade({ natureza: "Material", descricao: "Cadeiras", quantidade: "12", valor: null, justificativa: "" }), []);

  const c: CadastroNecessidade = {
    ...nova, id: "9", setor: "DIE", secao: "  Seção   de Transporte ", posto: "2S", nomeGuerra: " silva ",
    dados: { observacoes: " urgente " },
    etapas: [
      { natureza: "Material", descricao: " Pneus  para viatura ", quantidade: "8 unidades", valor: 4000.5, justificativa: " desgaste " },
      { natureza: "Serviço", descricao: "Alinhamento", quantidade: "1 serviço", valor: null, justificativa: "" },
      necessidadeVazia(), // item em branco não vai para o banco
    ],
  };
  const b = paraBanco(c);
  assert.equal(b.tipo, "necessidade");
  assert.equal(b.nome, "Lista de necessidades — Seção de Transporte");
  assert.equal(b.secao, "Seção de Transporte");
  assert.equal(b.nome_guerra, "SILVA");
  assert.deepEqual(b.dados, { observacoes: "urgente" });
  assert.equal(b.etapas.length, 2);
  assert.equal((b.etapas[0] as { descricao: string }).descricao, "Pneus para viatura");

  const volta = doBanco({ id: "9", tipo: "necessidade", setor: b.setor, secao: b.secao, nome: b.nome, posto: b.posto, nome_guerra: b.nome_guerra, dados: b.dados, etapas: b.etapas }) as CadastroNecessidade;
  assert.equal(volta.tipo, "necessidade");
  assert.deepEqual(volta.etapas[0], { natureza: "Material", descricao: "Pneus para viatura", quantidade: "8 unidades", valor: 4000.5, justificativa: "desgaste" });
  assert.equal(volta.etapas[1].valor, null);
  assert.deepEqual(pendencias(volta), []);
  assert.equal(totalNecessidades(volta.etapas), 4000.5);
  assert.equal(valorDoCadastro(volta), 4000.5);
});

test("planilhas da APLG: a lista de necessidades tem aba própria, um item por linha", () => {
  const n = { ...exemploNecessidade(), id: "1", versao: 3 };
  const fora = { ...exemploNecessidade(), id: "2", excluidoEm: "2026-11-05T10:00:00Z" };
  const p = { ...exemploProjeto(2027), id: "3" };
  const abas = abasDoLevantamento([n, fora, p]);
  assert.equal(abas["Lista de necessidades"].length, 2);
  assert.equal(abas["Lista de necessidades"][1]["Nº da lista"], "N01");
  assert.equal(abas["Lista de necessidades"][1]["Item"], 2);
  assert.equal(abas["Lista de necessidades"][1]["Material ou serviço"], "Serviço");
  assert.equal(abas["Lista de necessidades"][0]["Valor estimado (R$)"], 9600);
  assert.equal(abas.Projetos.length, 1, "os projetos não mudam");
  const r = resumo([n, fora, p]);
  assert.equal(r.itensNecessidade, 2);
  assert.equal(r.projetos, 1);
  assert.equal(r.valor, 350000 + 9600 + 4500);
  assert.equal(r.porSetor.get("DA")?.necessidades, 2);
});

test("trimestres e entregas por trimestre", () => {
  assert.equal(trimestreDe("jan/2027"), 1);
  assert.equal(trimestreDe("mar/2027"), 1);
  assert.equal(trimestreDe("abr/2027"), 2);
  assert.equal(trimestreDe("set/2027"), 3);
  assert.equal(trimestreDe("dez/2027"), 4);
  assert.equal(trimestreDe(""), 0);
  // exemplo: tarefas e marcos terminam em mar, mar, jun, jun, out, nov
  assert.deepEqual(entregasPorTrimestre(exemploProjeto(2027).etapas), [2, 2, 0, 2]);
});

test("projeto novo lista o que falta, na ordem do formulário", () => {
  const c = novoCadastro("projeto") as CadastroProjeto;
  const p = pendencias(c);
  assert.equal(p[0], "Falta a divisão ou assessoria");
  assert.ok(p.includes("Falta pelo menos um marco"));
  assert.ok(p.includes("Falta cadastrar as tarefas"));
  assert.ok(p.includes("Diga se precisa de dinheiro"));
});

test("projeto: término antes do início, dinheiro e situação da contratação", () => {
  const c = exemploProjeto(2027);
  c.dados.inicio = "nov/2027"; c.dados.termino = "fev/2027";
  assert.ok(pendencias(c).includes("Término antes do início"));
  const d = exemploProjeto(2027);
  d.dados.valor = null; d.dados.contratacao = "";
  assert.deepEqual(pendencias(d), ["Falta o valor estimado", "Falta a situação da contratação"]);
  d.dados.precisaDinheiro = "Não";
  assert.deepEqual(pendencias(d), []);
});

test("etapas: marco sem duração, mês, ordem e fora do período do projeto", () => {
  const p = exemploProjeto(2027);
  assert.deepEqual(avisosEtapa({ tipo: "Marco", descricao: "Obra recebida", inicio: "", fim: "nov/2027", responsavel: "Cap X", comprova: "" }, p.dados), []);
  assert.deepEqual(avisosEtapa({ tipo: "Tarefa", descricao: "Executar", inicio: "", fim: "", responsavel: "", comprova: "" }),
    ["Falta o mês de término", "Falta o mês de início", "Falta o responsável"]);
  assert.deepEqual(avisosEtapa({ tipo: "Tarefa", descricao: "Executar", inicio: "out/2027", fim: "mar/2027", responsavel: "Cap X", comprova: "" }),
    ["Término antes do início"]);
  assert.deepEqual(avisosEtapa({ tipo: "Marco", descricao: "Entrega", inicio: "", fim: "dez/2027", responsavel: "Cap X", comprova: "" }, p.dados),
    ["Termina depois do fim do projeto"]);
  assert.deepEqual(avisosEtapa({ tipo: "Tarefa", descricao: "Planejar", inicio: "jan/2027", fim: "fev/2027", responsavel: "Cap X", comprova: "" }, p.dados),
    ["Começa antes do início do projeto"]);
  p.etapas[0].responsavel = "";
  assert.ok(pendencias(p).includes("1 etapa com aviso"));
});

test("atividade: item de controle, indicador e tarefas", () => {
  const a = exemploAtividade();
  a.dados.meta = "";
  assert.deepEqual(pendencias(a), ["Falta o indicador (nome, cálculo e meta)"]);
  const b = exemploAtividade();
  b.etapas = [];
  assert.deepEqual(pendencias(b), ["Falta cadastrar as tarefas"]);
  assert.deepEqual(avisosTarefa({ tarefa: "", frequencia: "", quando: "", responsavel: "", comprova: "" }),
    ["Falta a tarefa", "Falta a frequência", "Falta o responsável"]);
});

test("valor em reais digitado de vários jeitos", () => {
  assert.equal(lerReais("350000"), 350000);
  assert.equal(lerReais("350.000"), 350000);
  assert.equal(lerReais("R$ 1.200,50"), 1200.5);
  assert.equal(lerReais("1200,5"), 1200.5);
  assert.equal(lerReais("12.5"), 12.5);
  assert.equal(lerReais(""), null);
  assert.equal(lerReais("abc"), null);
  assert.equal(lerReais("-5"), null);
});

test("ida e volta ao banco preserva o cadastro e limpa o que não vale", () => {
  const p = exemploProjeto(2027);
  p.etapas.push({ tipo: "Marco", descricao: "  Entrega   final ", inicio: "jan/2027", fim: "nov/2027", responsavel: "Cap X", comprova: "" });
  p.etapas.push({ tipo: "Tarefa", descricao: "", inicio: "", fim: "", responsavel: "Cap X", comprova: "" });
  const b = paraBanco(p);
  assert.equal(b.etapas.length, 7, "etapa vazia sai");
  assert.equal(b.etapas[6].descricao, "Entrega final");
  assert.equal(b.etapas[6].inicio, "", "marco não tem mês de início");
  assert.equal(b.nome_guerra, "EXEMPLO");
  const volta = doBanco({ id: "x", tipo: "projeto", setor: b.setor, secao: b.secao, nome: b.nome, posto: b.posto, nome_guerra: b.nome_guerra,
    dados: b.dados as Record<string, unknown>, etapas: b.etapas, versao: 3 }) as CadastroProjeto;
  assert.equal(volta.dados.valor, 350000);
  assert.equal(volta.etapas.length, 7);
  assert.equal(volta.versao, 3);
  // banco com campo faltando ou de outro tipo não quebra a tela
  const torta = doBanco({ id: "y", tipo: "atividade", setor: "DIE", secao: null, nome: "Controle", posto: "1S", nome_guerra: "X",
    dados: { valor: "abc", meta: 95 }, etapas: [{ tarefa: "Executar" }] }) as CadastroAtividade;
  assert.equal(torta.dados.valor, null);
  assert.equal(torta.dados.meta, "95");
  assert.equal(torta.dados.itemControle, "");
  assert.equal(torta.etapas[0].frequencia, "");
});

test("planilhas da APLG: abas, numeração e excluídos fora", () => {
  const p = { ...exemploProjeto(2027), id: "1", versao: 2 };
  const a = { ...exemploAtividade(), id: "2" };
  const x = { ...exemploProjeto(2027), id: "3", nome: "Excluído", excluidoEm: "2026-11-05T10:00:00Z" };
  const abas = abasDoLevantamento([p, a, x]);
  assert.deepEqual(Object.keys(abas), ["Projetos", "Etapas dos projetos", "Atividades", "Tarefas das atividades", "Lista de necessidades"]);
  assert.equal(abas.Projetos.length, 1);
  assert.equal(abas.Projetos[0]["Nº"], "P01");
  assert.equal(abas.Projetos[0]["Situação"], "OK");
  assert.equal(abas.Projetos[0]["Entregas 1º/2º/3º/4º tri"], "2/2/0/2");
  assert.equal(abas["Etapas dos projetos"].length, 6);
  assert.equal(abas["Etapas dos projetos"][5]["Trimestre"], "4º trimestre");
  assert.equal(abas.Atividades[0]["Nº"], "A01");
  assert.equal(abas["Tarefas das atividades"].length, 3);
  const r = resumo([p, a, x]);
  assert.equal(r.projetos, 1);
  assert.equal(r.atividades, 1);
  assert.equal(r.excluidos, 1);
  assert.equal(r.valor, 410000);
  assert.deepEqual(r.trimestres, [2, 2, 0, 2]);
});

test("Matriz prevista: 136 tarefas, todas de setores da lista", () => {
  assert.equal(MATRIZ_PREVISTA.length, 136);
  const siglas = new Set(SETORES.map((s) => s.sigla));
  assert.ok(MATRIZ_PREVISTA.every((t) => siglas.has(t.setor)));
});
