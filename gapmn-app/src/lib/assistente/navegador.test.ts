import { test } from "node:test";
import assert from "node:assert/strict";
import { acharContratos, consultarCredito, consultarEmpenhos, consultarExecucaoContratos, termos, type ContratoInfo } from "./navegador.ts";
import type { NotaEmpenho } from "../execucao/empenhos.ts";
import type { ExecucaoContrato, NotaContrato } from "../contratos/execucao.ts";

const ne = (x: Partial<NotaEmpenho>): NotaEmpenho => ({
  ne: "2026NE000001", emissao: "2026-03-10", ultimoLancamento: "2026-03-10", ug: "120630", ugNome: "GAP-MN", natureza: "339039", naturezaNome: "OUTROS SERV",
  pi: "DC060401600", piNome: "CONTRATOS CONTINUADOS", pag: "67298.000001/2026-00", pagChave: null, favorecido: { tipo: "empresa", documento: "11.111.111/0001-11", nome: "LIMPA BEM LTDA" },
  observacao: "Serviço de limpeza", solicitacao: null, assinada: true, itens: [], lancamentos: [], valor: 1000, categoria: "servicos" as NotaEmpenho["categoria"], ...x,
});

test("empenhos: busca sem acento, ano, natureza, somas de todas e CPF de pessoa física fora", () => {
  const nes = [ne({}), ne({ ne: "2026NE000002", valor: 300, observacao: "Diárias de missão", favorecido: { tipo: "pessoa", documento: "123.456.789-00", nome: "FULANO DE TAL" } }),
    ne({ ne: "2025NE000009", emissao: "2025-05-01", valor: 50 })];
  const fin = new Map([["2026NE000001", { aLiquidar: 400, liquidadoPagar: 100, pago: 500 }]]);
  const r = consultarEmpenhos(nes, fin, { texto: "limpeza", ano: "2026" }, () => "GAP-MN");
  const p = r.paraIA as { total: number; somas_de_todas: { empenhado: number; pago: number }; notas: { ne: string; favorecido: string; cnpj?: string }[] };
  assert.equal(p.total, 1);
  assert.equal(p.somas_de_todas.pago, 500);
  assert.equal(p.notas[0].cnpj, "11.111.111/0001-11");
  const d = consultarEmpenhos(nes, fin, { texto: "diarias" }, () => "GAP-MN");
  const nota = (d.paraIA as { notas: { favorecido: string; cnpj?: string }[] }).notas[0];
  assert.equal(nota.favorecido, "pessoa física");
  assert.equal(nota.cnpj, undefined);
  assert.ok(!JSON.stringify(d.paraIA).includes("123.456.789-00") && !JSON.stringify(d.paraIA).includes("FULANO"));
  assert.equal((consultarEmpenhos(nes, fin, { natureza: "3390.39" }, () => "GAP-MN").paraIA as { total: number }).total, 3);
  assert.equal(r.fontes[0].link, "/app?vista=painel-execucao&busca=limpeza");
});

test("crédito disponível: busca por PI/OM, soma e maiores PIs", () => {
  const linhas = [
    { ptres: "1", pi: "DC060401600", piNome: "CONTRATOS CONTINUADOS", nd: "339039", ndNome: "SERV", ug: "120630", ugNome: "GAP-MN", sigla: "GAP-MN", valor: 1000.555 },
    { ptres: "1", pi: "CF0000000", piNome: "COMBUSTÍVEL", nd: "339030", ndNome: "MAT", ug: "120091", ugNome: "BAMN", sigla: "BAMN", valor: 50 },
  ];
  const r = consultarCredito("disponivel", linhas, { texto: "continuados" });
  const p = r.paraIA as { soma: number; linhas: { om: string }[]; por_pi: { pi: string }[] };
  assert.equal(p.soma, 1000.56);
  assert.deepEqual(p.linhas.map((l) => l.om), ["GAP-MN"]);
  assert.equal(consultarCredito("disponivel", linhas, { texto: "combustivel" }).paraIA && (consultarCredito("disponivel", linhas, { texto: "combustivel" }).paraIA as { soma: number }).soma, 50);
  assert.deepEqual(termos("Qual o saldo de combustível?"), ["saldo", "combustivel"]);
});

const contrato = (x: Partial<ContratoInfo>): ContratoInfo => ({ id: "c1", numero_contrato: "DESPESA 008/GAPMN-DACTAIV/2025", pag_nup: "67615.026507/2024-11", cnpj: "11111111000111",
  data_inicio: "2025-04-23", data_final: "2030-04-23", vl_contratual: 1000, vl_a_empenhar: null, fornecedor: "VIAGENS LTDA", descricao: "PASSAGENS RODOVIARIAS", ...x });
const nota = (ne: string, empenhado: number, pago: number): NotaContrato => ({ ne, ano: Number(ne.slice(0, 4)), pag: "", pagChave: null, favorecidoCodigo: "", favorecidoNome: "",
  descricao: "CONTRATO: DESPESA 008/GAPMN-DACTAIV/2025", pi: "", unidade: "", exercicio: { aLiquidar: 0, liquidadoPagar: 0, pago }, rp: null, valorItens: empenhado,
  aLiquidar: empenhado - pago, liquidadoPagar: 0, pago, pagoAnterior: 0, empenhado, completo: true });
const execucao = (nes: NotaContrato[]): ExecucaoContrato => ({ nes, citamOutro: [], empenhadoIncompleto: false,
  totais: { nNE: nes.length, empenhado: nes.reduce((t, n) => t + n.empenhado, 0), aLiquidar: nes.reduce((t, n) => t + n.aLiquidar, 0), liquidadoPagar: 0, pago: nes.reduce((t, n) => t + n.pago, 0), empenhadoAno: 0 } });

test("execução de contratos: acha pelo número (com ou sem a unidade) e pelas palavras", () => {
  const cs = [contrato({}), contrato({ id: "c2", numero_contrato: "DESPESA 008/GAPMN-COMARA/2025", fornecedor: "OUTRA LTDA", descricao: "LIMPEZA" }),
    contrato({ id: "c3", numero_contrato: "DESPESA 008/GAPMN-DACTAIV/2024", fornecedor: "TERCEIRA", descricao: "LIMPEZA" })];
  assert.deepEqual(acharContratos(cs, "DESPESA 008/GAPMN-DACTAIV/2025").map((c) => c.id), ["c1"]);
  assert.deepEqual(acharContratos(cs, "quantos empenhos tem o contrato 8/2025?").map((c) => c.id), ["c1", "c2"]);
  assert.deepEqual(acharContratos(cs, "limpeza").map((c) => c.id), ["c2", "c3"]);
  assert.deepEqual(acharContratos(cs, "passagens rodoviárias").map((c) => c.id), ["c1"]);
});

test("execução de contratos: as NEs e os totais são os da aba Execução (inclusive NE zerada)", () => {
  const nes = [nota("2026NE000405", 467340.07, 353136.09), nota("2025NE002133", 38478.89, 38478.89), nota("2025NE002120", 0, 0), nota("2025NE001380", 197581.76, 197581.76), nota("2025NE000019", 0, 0)];
  const cs = [contrato({ vl_contratual: 2023377 })];
  const r = consultarExecucaoContratos(cs, new Map([["c1", execucao(nes)]]), { texto: "DESPESA 008/GAPMN-DACTAIV/2025" });
  const p = r.paraIA as { totais: { quantidade_de_nes: number; empenhado: number }; notas_de_empenho: { ne: string }[]; saldo_a_empenhar: number };
  assert.equal(p.totais.quantidade_de_nes, 5);
  assert.deepEqual(p.notas_de_empenho.map((n) => n.ne), ["2026NE000405", "2025NE002133", "2025NE002120", "2025NE001380", "2025NE000019"]);
  assert.equal(p.totais.empenhado, 703400.72);
  assert.equal(p.saldo_a_empenhar, 1319976.28);
  assert.equal(r.fontes[0].link, "/app?vista=contratos&busca=DESPESA%20008%2FGAPMN-DACTAIV%2F2025");
  const v = consultarExecucaoContratos(cs, new Map(), { texto: "contrato 99/2030" }).paraIA as { total: number };
  assert.equal(v.total, 0);
});

test("execução de contratos: vários contratos trazem a conta de cada um e a soma", () => {
  const cs = [contrato({}), contrato({ id: "c2", numero_contrato: "DESPESA 010/GAPMN-DACTAIV/2025" })];
  const m = new Map([["c1", execucao([nota("2026NE000001", 100, 40)])], ["c2", execucao([nota("2026NE000002", 50, 50), nota("2026NE000003", 25, 0)])]]);
  const p = consultarExecucaoContratos(cs, m, { texto: "viagens" }).paraIA as { total: number; somas_de_todos: { empenhado: number; pago: number }; contratos: { nes: number }[] };
  assert.equal(p.total, 2);
  assert.deepEqual(p.contratos.map((c) => c.nes), [1, 2]);
  assert.deepEqual([p.somas_de_todos.empenhado, p.somas_de_todos.pago], [175, 90]);
});
