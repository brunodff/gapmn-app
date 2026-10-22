// Testes do Painel de Execução: leitura da planilha de empenhos por item, classificação,
// vínculo com contratos e filtros. Dados fictícios. Rodar na pasta gapmn-app:  npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { classificar, nomeDoItem } from "./categorias.ts";
import { chavePAG, favorecidoDe, lerEmpenhos, type NotaEmpenho } from "./empenhos.ts";
import {
  FILTROS_VAZIOS, filtrar, financeiroDo, financeiroPorNE, porCategoria, porContrato, porMes, porObjeto,
  resumir, vincular, type ContratoResumo, type Financeiro, type ProcessoResumo,
} from "./painel.ts";

/** Uma linha de 21 colunas no layout da planilha. */
function linha(p: {
  data: string; ne?: string; seq?: string; item?: string; valor?: string; obs?: string; ug?: string; ugNome?: string;
  nd?: string; ndNome?: string; pi?: string; pag?: string; fav?: string; favNome?: string; assinante?: string; lanc?: string;
}): string[] {
  return [
    p.data, p.ne ? `12063000001${p.ne}` : "", p.seq ?? "", p.item ?? "", "2026", "1", p.valor ?? "",
    p.obs ?? "SOLICITACAO DE EMPENHO 26S0101. OBS: TESTE", p.ug ?? "120630", p.ugNome ?? "GRUPAMENTO DE APOIO DE MANAUS",
    p.nd ?? "339030", p.ndNome ?? "MATERIAL DE CONSUMO", p.pi ?? "PI0001", "PI DE TESTE",
    p.pag ?? "67298.000123/2026-45", p.fav ?? "12345678000199", p.favNome ?? "EMPRESA FICTICIA LTDA",
    "11122233344", p.assinante ?? "FULANO DE TAL", "ASSINADA", p.lanc ?? "100",
  ];
}

const PLANILHA: string[][] = [
  ["Notas de Empenho", ...Array(20).fill("")],
  // NE com dois itens no mesmo lançamento; a 2ª linha sem NE é o item 2
  linha({ data: "15/01/2026", ne: "2026NE000001", seq: "1", item: "Item compra: 00027 - CARNE BOVINA IN NATURA, TIPO CORTE", valor: "50" }),
  linha({ data: "15/01/2026", seq: "2", item: "Item compra: 00031 - TUBO PVC, DIAMETRO 50MM", valor: "50" }),
  // repetição do item 2 (o relatório multiplica linhas): não pode somar de novo
  linha({ data: "15/01/2026", item: "", valor: "50", lanc: "999" }),
  // outra NE no mesmo dia, de energia, com PAG de dígito cortado e favorecido com zero perdido
  linha({ data: "15/01/2026", ne: "2026NE000002", seq: "1", item: "Item compra: 00001 - ENERGIA ELETRICA - FORNECIMENTO MERCADO", valor: "1000",
    nd: "339039", pag: "67298.000999/2025-8", fav: "1234567000189", favNome: "DISTRIBUIDORA FICTICIA SA" }),
  // linha sem NE de outro dia: não pertence a ninguém
  linha({ data: "16/01/2026", seq: "9", item: "Item compra: 00099 - SOLTA", valor: "77" }),
  // reforço da NE 1 em março: valor atual do item 1 sobe para 80
  linha({ data: "10/03/2026", ne: "2026NE000001", seq: "1", item: "Item compra: 00027 - CARNE BOVINA IN NATURA, TIPO CORTE", valor: "80", lanc: "30" }),
  // diárias: categoria pela natureza; favorecido é a própria UG
  linha({ data: "20/02/2026", ne: "2026NE000003", seq: "1", item: "Solicitacao de Empenho para atender a necessidade de Diarias", valor: "500",
    nd: "339015", ndNome: "DIARIAS - PESSOAL MILITAR", fav: "120630", favNome: "GRUPAMENTO DE APOIO DE MANAUS", ug: "120154", ugNome: "HOSPITAL DE AERONAUTICA DE MANAUS" }),
  // favorecido pessoa física: nome e documento não podem sair
  linha({ data: "21/02/2026", ne: "2026NE000004", seq: "1", item: "Solicitacao de Empenho para ressarcimento", valor: "200",
    nd: "339093", fav: "9876543210", favNome: "BELTRANO DA SILVA" }),
];

const nes = lerEmpenhos(PLANILHA);
const ne = (n: string) => nes.find((x) => x.ne === n)!;

test("lê uma NE por número, com itens do mesmo dia e sem somar repetições", () => {
  assert.equal(nes.length, 4);
  const n1 = ne("2026NE000001");
  assert.deepEqual(n1.itens.map((i) => [i.seq, i.itemCompra, i.valor]), [["1", "27", 80], ["2", "31", 50]]);
  assert.equal(n1.valor, 130);
  assert.deepEqual(n1.lancamentos, ["2026-01-15", "2026-03-10"]);
  assert.equal(n1.emissao, "2026-01-15");
  assert.equal(n1.solicitacao, "26S0101");
});

test("linha sem NE de outro dia é descartada", () => {
  assert.ok(nes.every((n) => n.itens.every((i) => i.valor !== 77)));
});

test("assinante (CPF e nome) e favorecido pessoa física não aparecem em nenhum campo", () => {
  const tudo = JSON.stringify(nes);
  assert.ok(!tudo.includes("FULANO"));
  assert.ok(!tudo.includes("11122233344"));
  assert.ok(!tudo.includes("BELTRANO"));
  assert.ok(!tudo.includes("9876543210"));
  assert.deepEqual(ne("2026NE000004").favorecido, { tipo: "pessoa", documento: null, nome: "Pessoa física" });
});

test("favorecido: UG, CNPJ com zero recuperado e pessoa física", () => {
  assert.equal(favorecidoDe("120630", "GAP").tipo, "orgao");
  assert.deepEqual(favorecidoDe("1234567000189", "X"), { tipo: "empresa", documento: "01234567000189", nome: "X" });
  assert.equal(favorecidoDe("12345678901", "Y").tipo, "pessoa");
});

test("PAG casa pela parte fixa, mesmo com o dígito verificador cortado", () => {
  assert.equal(chavePAG("67298.000999/2025-8"), chavePAG("67298.000999/2025-87"));
  assert.equal(chavePAG("67298.000999/2025-87"), "672980009992025");
  assert.equal(chavePAG("-8"), null);
});

test("classificação por natureza e por palavra do item", () => {
  assert.equal(classificar("339015", "qualquer coisa"), "deslocamento");
  assert.equal(classificar("339040", "OUTSOURCING DE IMPRESSAO"), "tic");
  assert.equal(classificar("339030", "Item compra: 00001 - CARNE BOVINA IN NATURA, TIPO X"), "alimentacao");
  assert.equal(classificar("339039", "Item compra: 00001 - MANUTENCAO / REFORMA PREDIAL"), "engenharia");
  assert.equal(classificar("339039", "Item compra: 00001 - ENERGIA ELETRICA - FORNECIMENTO"), "utilidades");
  // "REFRIGERADOR" tem "GERADOR" dentro e não é obra
  assert.equal(classificar("449052", "Item compra: 00001 - REFRIGERADOR DOMESTICO, 300 L"), "equipamentos");
  assert.equal(classificar("339030", "Item compra: 00001 - TUBO PARA COLETA DE AMOSTRA BIOLOGICA"), "saude");
  assert.equal(classificar("339030", "Item compra: 00001 - COISA SEM REGRA"), "outros");
  assert.equal(nomeDoItem("Item compra: 00027 - BISCOITO, TIPO DOCE"), "BISCOITO");
});

const ctr = (p: Partial<ContratoResumo>): ContratoResumo => ({
  id: "c1", numero: "001/2026", objeto: "OBJETO", fornecedor: "F", cnpj: null, pagChave: null, inicio: null, fim: null, valor: null, status: null, ...p,
});

test("vínculo pelo PAG; com mais de um contrato no PAG vale o do mesmo CNPJ", () => {
  const contratos = [
    ctr({ id: "carne", pagChave: "672980001232026" }),
    ctr({ id: "energia-a", pagChave: "672980009992025", cnpj: "11.111.111/0001-11" }),
    ctr({ id: "energia-b", pagChave: "672980009992025", cnpj: "01.234.567/0001-89" }),
  ];
  const processos: ProcessoResumo[] = [{ id: "p1", modalidade: "Pregão", numero: "1/2026", objeto: "x", situacao: null, pagChave: "672980001232026" }];
  const v = vincular(nes, contratos, processos);
  assert.equal(v.get("2026NE000001")?.contrato?.id, "carne");
  assert.equal(v.get("2026NE000001")?.processo?.id, "p1");
  assert.equal(v.get("2026NE000002")?.contrato?.id, "energia-b");
});

test("PAG com vários contratos e nenhum do mesmo CNPJ: vale o vigente na emissão; sem isso, nenhum", () => {
  const dois = [
    ctr({ id: "velho", pagChave: "672980009992025", inicio: "2024-01-01", fim: "2025-12-31" }),
    ctr({ id: "novo", pagChave: "672980009992025", inicio: "2026-01-01", fim: "2026-12-31" }),
  ];
  const so = nes.filter((n) => n.ne === "2026NE000002").map((n) => ({ ...n, favorecido: { ...n.favorecido, documento: "99999999000199" } }));
  assert.equal(vincular(so, dois, []).get("2026NE000002")?.contrato?.id, "novo");
  const semData = dois.map((c) => ({ ...c, inicio: null, fim: null }));
  assert.equal(vincular(so, semData, []).get("2026NE000002")?.contrato, null);
});

test("busca por objeto recorta só os itens que casam; busca pela NE traz todos", () => {
  const v = vincular(nes, [], []);
  const carne = filtrar(nes, { ...FILTROS_VAZIOS, busca: "carne bovina" }, v);
  assert.equal(carne.length, 1);
  assert.equal(carne[0].valor, 80);
  assert.equal(carne[0].parcial, true);
  const pelaNE = filtrar(nes, { ...FILTROS_VAZIOS, busca: "2026NE000001" }, v);
  assert.equal(pelaNE[0].valor, 130);
  assert.equal(pelaNE[0].parcial, false);
});

test("filtro de categoria é por item e soma só os itens da categoria", () => {
  const v = vincular(nes, [], []);
  const eng = filtrar(nes, { ...FILTROS_VAZIOS, categoria: "engenharia" }, v);
  assert.deepEqual(eng.map((r) => [r.nota.ne, r.valor]), [["2026NE000001", 50]]);
  const cats = porCategoria(filtrar(nes, FILTROS_VAZIOS, v));
  assert.deepEqual(cats.map((c) => [c.chave, c.valor]), [
    ["utilidades", 1000], ["deslocamento", 500], ["pessoal", 200], ["alimentacao", 80], ["engenharia", 50],
  ]);
});

test("liquidação e pagamento proporcionais quando só parte dos itens entra", () => {
  const fin = new Map<string, Financeiro>([["2026NE000001", { aLiquidar: 30, liquidadoPagar: 0, pago: 100 }]]);
  const v = vincular(nes, [], []);
  const [carne] = filtrar(nes, { ...FILTROS_VAZIOS, busca: "carne" }, v);
  const f = financeiroDo(carne, fin);
  assert.ok(Math.abs(f.pago - 100 * 80 / 130) < 1e-9);
  const r = resumir(filtrar(nes, FILTROS_VAZIOS, v), fin, v);
  assert.equal(r.valor, 1830);
  assert.equal(r.nes, 4);
  assert.equal(r.itens, 5);
  assert.equal(r.pago, 100);
  assert.equal(r.semSituacao, 3);
});

test("filtro 'só com saldo a liquidar': fica só a NE com saldo; sem linha na situação, fica de fora", () => {
  const fin = new Map<string, Financeiro>([
    ["2026NE000001", { aLiquidar: 30, liquidadoPagar: 0, pago: 100 }],
    ["2026NE000002", { aLiquidar: 0, liquidadoPagar: 500, pago: 500 }],
  ]);
  const v = vincular(nes, [], []);
  const so = filtrar(nes, { ...FILTROS_VAZIOS, soALiquidar: true }, v, fin);
  assert.deepEqual(so.map((r) => r.nota.ne), ["2026NE000001"]);
  assert.equal(filtrar(nes, { ...FILTROS_VAZIOS, soALiquidar: true }, v).length, 0, "sem a planilha de situação, nenhuma");
  assert.equal(filtrar(nes, FILTROS_VAZIOS, v, fin).length, 4, "desligado, não muda nada");
});

test("planilha de situação: soma as linhas da mesma NE pelo número curto", () => {
  const m = financeiroPorNE([
    { nota_empenho: "2026NE000001", a_liquidar: 10, liquidado_pagar: 1, pago: 5 },
    { nota_empenho: "120630000012026NE000001", a_liquidar: 5, liquidado_pagar: 0, pago: 5 },
  ]);
  assert.deepEqual(m.get("2026NE000001"), { aLiquidar: 15, liquidadoPagar: 1, pago: 10 });
});

test("por mês usa a emissão; por contrato soma o empenhado e o pago", () => {
  const contratos = [ctr({ id: "carne", numero: "005/2026", pagChave: "672980001232026" })];
  const v = vincular(nes, contratos, []);
  const rs = filtrar(nes, FILTROS_VAZIOS, v);
  assert.deepEqual(porMes(rs).map((m) => [m.chave, m.valor]), [["2026-01", 1130], ["2026-02", 700]]);
  const fin = new Map<string, Financeiro>([["2026NE000001", { aLiquidar: 0, liquidadoPagar: 0, pago: 60 }]]);
  // as NEs 3 e 4 usam o PAG padrão da linha de teste, então também caem no contrato
  const linhaCarne = porContrato(rs, v, fin)[0];
  assert.equal(linhaCarne.contrato.numero, "005/2026");
  assert.equal(linhaCarne.pago, 60);
  const objetos = porObjeto(rs);
  assert.equal(objetos[0].nome, "ENERGIA ELETRICA - FORNECIMENTO MERCADO");
});

// Uso de tipo só para o TS não reclamar de import não usado em alguns editores
export type _N = NotaEmpenho;
