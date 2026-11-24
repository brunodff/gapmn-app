import { test } from "node:test";
import assert from "node:assert/strict";
import { consultarCredito, consultarEmpenhos, termos } from "./navegador.ts";
import type { NotaEmpenho } from "../execucao/empenhos.ts";

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
