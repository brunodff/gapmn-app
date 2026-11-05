// Testes da execução dos contratos pelas NEs (casos tirados das planilhas reais de novembro/2026).
// Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aEmpenhar, chaveContrato, citacoes, execucaoPorContrato, juntarNEs, neCanonica, primeiraNE, saldoAEmpenhar, unidadeNorm, vincularNEs,
  type LinhaRP, type LinhaSituacao,
} from "./execucao.ts";
import { mesHoje, projetarContratos, montarHistorico, type ContratoBase } from "../previsaoContratos.ts";

const sit = (ne: string, pag: string, desc: string, v: Partial<LinhaSituacao> = {}): LinhaSituacao => ({
  nota_empenho: ne, info_d: v.info_d ?? "02341467000120", info_e: "FORNECEDOR", info_f: desc, info_g: pag,
  a_liquidar: v.a_liquidar ?? 0, liquidado_pagar: v.liquidado_pagar ?? 0, pago: v.pago ?? 0,
});
const rp = (ne: string, pag: string, v: Partial<LinhaRP>): LinhaRP => ({
  ne, processo: pag, favorecido: "FORNECEDOR", favorecido_codigo: v.favorecido_codigo ?? "", descricao: v.descricao ?? "",
  rp_nao_proc_a_liq: 0, rp_nao_proc_liq_pag: 0, rp_nao_proc_pago: 0, rp_proc_a_pagar: 0, rp_proc_pagos: 0, ...v,
});

test("número do contrato: sequencial, ano e unidade sem GAP-MN nem CIN", () => {
  assert.deepEqual(chaveContrato("DESPESA 055/GAPMN-DACTAIV/2024"), { num: 55, ano: 2024, unidade: "DACTAIV" });
  assert.deepEqual(chaveContrato("ADESÃO 1005321248/DACTAIV/2016"), { num: 1005321248, ano: 2016, unidade: "DACTAIV" });
  assert.deepEqual(chaveContrato("CREDENCIAMENTO 001/2021"), { num: 1, ano: 2021, unidade: "" });
  assert.deepEqual(chaveContrato("DESPESA 025/ GAPMN-PAMN/2024"), { num: 25, ano: 2024, unidade: "PAMN" });
  assert.equal(chaveContrato("sem número"), null);
  assert.equal(unidadeNorm("GAPMN-CINDACTA IV"), "DACTAIV");
  assert.equal(unidadeNorm("GAP-MN"), "");
  assert.equal(neCanonica("120630000012026NE000242"), "2026NE000242");
  assert.equal(neCanonica("2026NE242"), "2026NE000242");
});

test("citações: contrato é forte; ofício, pregão, NUP e telefone não contam como contrato", () => {
  const c = citacoes("SOLICITACAO DE EMPENHO 26S0070. OBS: PAG/NUP: 67615.013639/2024-83 - CONTRATO: DESPESA 055/GAPMN-DACTAIV/2024 - PROCESSO: PE 51/GAP-MN/2024");
  assert.deepEqual(c.map((x) => [x.num, x.ano, x.unidade, x.forte]), [[55, 2024, "DACTAIV", true], [51, 2024, "", false]]);
  assert.deepEqual(citacoes("CONFORME OFICIO 255/SDRS/7312 - FISCAL"), []); // ano impossível
  assert.deepEqual(citacoes("092 36141581/1579"), []);
  assert.equal(citacoes("OFICIO N° 112/DESTAE-UA PE 83/2023")[0]?.forte, false);
  assert.equal(citacoes("CONTRATO DE LAVAGEM E HIGINIENIZACAO DE ROUPAS DE CAMA DE N°037/GAP/2024")[0]?.forte, true);
  assert.equal(citacoes("CONTRATO DE DESPESA 062/GAPMN/2025- MEDIA TENSAO")[0]?.num, 62);
});

test("situação + restos a pagar se completam; RP processado pago entra como pago", () => {
  const nes = juntarNEs(
    [sit("2025NE001793", "67298.000001/2025-11", "X", { pago: 3956.97 })],
    [
      rp("2025NE001793", "67298.000001/2025-11", { rp_nao_proc_pago: 2017.6, rp_proc_pagos: 411.03 }),
      rp("2025NE002332", "67292.002065/2021-11", { rp_nao_proc_a_liq: 100, favorecido_codigo: "5340639000130", descricao: "SÓ NO RP" }),
    ],
  );
  const a = nes.get("2025NE001793")!;
  assert.equal(a.pago.toFixed(2), "6385.60");
  assert.equal(a.empenhado.toFixed(2), "6385.60");
  assert.equal(a.exercicio.pago, 3956.97);
  const b = nes.get("2025NE002332")!; // NE de ano anterior que ficou toda em RP não vem na situação
  assert.equal(b.aLiquidar, 100);
  assert.equal(b.favorecidoCodigo, "5340639000130");
  assert.equal(b.pagChave, "672920020652021");
});

test("vínculo: citação vale até em outro PAG; PAG de laboratório com outros contratos do processo", () => {
  const contratos = [
    { id: "054", numero_contrato: "DESPESA 054/GAPMN-DACTAIV/2024", pag_nup: "67615.013639/2024-83", cnpj: "02.341.467/0001-20" },
    { id: "055", numero_contrato: "DESPESA 055/GAPMN-DACTAIV/2024", pag_nup: "67615.013639/2024-83", cnpj: "02.341.467/0001-20" },
    { id: "009", numero_contrato: "DESPESA 009/BAMN-HAMN/2022", pag_nup: "67436.006543/2021-24", cnpj: "11.111.111/0001-11" },
    { id: "cred", numero_contrato: "CREDENCIAMENTO 001/2021", pag_nup: "67436.001396/2021-04", cnpj: "22.222.222/0001-22" },
    { id: "019", numero_contrato: "DESPESA 019/GAPMN-BAMN/2024", pag_nup: "67298.001000/2024-10", cnpj: "33.333.333/0001-33" },
  ];
  const nes = juntarNEs([
    sit("2026NE000091", "67615.013639/2024-83", "CONTRATO: DESPESA 055/GAPMN-DACTAIV/2024 - PROCESSO: PE 51/GAP-MN/2024"),
    sit("2026NE000441", "67615.013639/2024-83", "CONTRATO: DESPESA 054/GAPMN-DACTAIV/2024"),
    sit("2026NE001268", "67615.013639/2024-83", "TOTAL: 80.000,00 CONTRATO: DESPESA 055/GAPMN-CINDACTA IV/2024"),
    sit("2026NE009999", "67615.013639/2024-83", "SOL. PARA ATENDER O CINDACTA IV"), // sem citação, mesmo CNPJ dos dois
    sit("2026NE000030", "67436.006543/2021-24", "REQUISICAO GERADA A PARTIR DO CONTRATO DESPESA 005/BAMN-HAMN/2022."),
    sit("2024NE001439", "67436.006543/2021-24", "REQUISICAO GERADA A PARTIR DO CONTRATO DESPESA 009/BAMN-HAMN/2022."),
    sit("2022NE000099", "67436.006543/2021-24", "EM FAVOR DO LABORATORIO"),
    sit("2021NE000269", "67436.001396/2021-04", "APLIC.: CREDENCIAMENTO 001/2020 PAG: 67436.001396/2021-04"),
    sit("2026NE000500", "67298.000783/2025-71", "PARA ATENDER O CONTRATO DESPESA 019/GAPMN-BAMN/2024"), // outro PAG
  ]);
  const v = vincularNEs(contratos, nes.values());
  assert.deepEqual([v.get("2026NE000091")!.contratoId, v.get("2026NE000091")!.motivo], ["055", "cita o contrato"]);
  assert.equal(v.get("2026NE000441")!.contratoId, "054");
  assert.equal(v.get("2026NE001268")!.contratoId, "055");
  assert.deepEqual([v.get("2026NE009999")!.contratoId, v.get("2026NE009999")!.motivo], [null, "PAG compartilhado"]);
  assert.deepEqual(v.get("2026NE009999")!.candidatos, ["054", "055"]);
  assert.deepEqual([v.get("2026NE000030")!.contratoId, v.get("2026NE000030")!.motivo], [null, "cita outro contrato"]);
  assert.equal(v.get("2024NE001439")!.contratoId, "009");
  // o PAG também paga outros contratos do laboratório (a 2026NE000030 cita o 005): NE sem citação fica sem contrato
  assert.deepEqual([v.get("2022NE000099")!.contratoId, v.get("2022NE000099")!.motivo, v.get("2022NE000099")!.candidatos], [null, "PAG compartilhado", ["009"]]);
  assert.equal(v.get("2021NE000269")!.contratoId, "cred"); // "001/2020" no PAG do 001/2021: erro de digitação
  assert.deepEqual([v.get("2026NE000500")!.contratoId, v.get("2026NE000500")!.motivo], ["019", "cita o contrato"]);
});

test("vínculo: contrato de receita não recebe NE", () => {
  const contratos = [{ id: "rec", numero_contrato: "RECEITA 001/BAMN-HAMN/2022", pag_nup: "67436.000001/2022-11", cnpj: null }];
  const nes = juntarNEs([sit("2022NE000500", "67436.000001/2022-11", "AQUISICAO QUALQUER")]);
  assert.deepEqual(vincularNEs(contratos, nes.values()).get("2022NE000500"), { contratoId: null, motivo: "sem contrato", candidatos: [] });
});

test("vínculo: PAG compartilhado se resolve pelo CNPJ do fornecedor", () => {
  const contratos = [
    { id: "fogas", numero_contrato: "DESPESA 016/GAPMN/2023", pag_nup: "67298.000220/2023-11", cnpj: "04.563.672/0001-66" },
    { id: "mc", numero_contrato: "DESPESA 002/GAP-MN/2024", pag_nup: "67298.000220/2023-11", cnpj: "06.191.586/0002-86" },
  ];
  const nes = juntarNEs([
    sit("2026NE000010", "67298.000220/2023-11", "GAS", { info_d: "4563672000166" }), // a planilha perde o zero à esquerda
    sit("2026NE000011", "67298.000220/2023-11", "GAS", { info_d: "29091842000188" }), // fornecedor de nenhum dos dois
  ]);
  const v = vincularNEs(contratos, nes.values());
  assert.deepEqual([v.get("2026NE000010")!.contratoId, v.get("2026NE000010")!.motivo], ["fogas", "mesmo fornecedor no PAG"]);
  assert.equal(v.get("2026NE000011")!.contratoId, null);
});

test("execução por contrato: totais só das NEs dele; avisos das que ficaram de fora; a empenhar", () => {
  const contratos = [
    { id: "054", numero_contrato: "DESPESA 054/GAPMN-DACTAIV/2024", pag_nup: "67615.013639/2024-83", cnpj: "02341467000120", data_inicio: "2025-10-03" },
    { id: "055", numero_contrato: "DESPESA 055/GAPMN-DACTAIV/2024", pag_nup: "67615.013639/2024-83", cnpj: "02341467000120", data_inicio: "2025-10-03" },
  ];
  const nes = juntarNEs(
    [
      sit("2026NE000441", "67615.013639/2024-83", "CONTRATO: DESPESA 054/GAPMN-DACTAIV/2024", { a_liquidar: 1000, pago: 9573 }),
      sit("2026NE000091", "67615.013639/2024-83", "CONTRATO: DESPESA 055/GAPMN-DACTAIV/2024", { a_liquidar: 3000, liquidado_pagar: 500, pago: 240372 }),
      sit("2026NE009999", "67615.013639/2024-83", "SEM CITACAO", { a_liquidar: 77 }),
    ],
    [],
  );
  const ex = execucaoPorContrato(contratos, nes, vincularNEs(contratos, nes.values()), 2026);
  const e54 = ex.get("054")!, e55 = ex.get("055")!;
  assert.deepEqual([e54.totais.nNE, e54.totais.empenhado, e54.totais.aLiquidar, e54.totais.empenhadoAno], [1, 10573, 1000, 10573]);
  assert.deepEqual([e55.totais.aLiquidar, e55.totais.liquidadoPagar, e55.totais.pago], [3000, 500, 240372]);
  assert.equal(e54.semContratoNoPag.length, 1);
  assert.equal(e55.semContratoNoPag[0].ne, "2026NE009999");
  assert.equal(e54.empenhadoIncompleto, false);
  assert.equal(aEmpenhar(651076.9, e54.totais)!.toFixed(2), "640503.90");
  assert.equal(aEmpenhar(null, e54.totais), null);
});

test("previsão: parcela fixa = valor total ÷ meses de vigência, mesmo com liquidação diferente", () => {
  const c: ContratoBase = {
    id: "lim", numero_contrato: "DESPESA 018/GAPMN/2026", descricao: "SERVIÇO DE LIMPEZA E CONSERVAÇÃO",
    vl_contratual: 120000, vl_empenhado: 0, vl_a_empenhar: 120000, data_inicio: "2026-01-01", data_final: "2027-01-01",
    data_orcamento: null, pag_nup: "67298.000001/2026-11",
  };
  // liquidado no ano muito acima da parcela: a parcela continua 10 mil, e vem um aviso
  const linhas = [{ pi: "", pi_desc: "", unidade: "", nota_empenho: "2026NE000001", info_d: "", info_e: "", info_f: "", info_g: c.pag_nup!, a_liquidar: 0, liquidado_pagar: 0, pago: 160000 }];
  const porContrato = montarHistorico(linhas, [], 2026, () => "lim");
  const p = projetarContratos([c], new Map(), new Map(), { hoje: new Date(2026, 10, 5), reajustePct: 0, suporProrrogacao: false, historicoContrato: porContrato }).get("lim")!;
  assert.equal(p.regime, "fixo");
  assert.equal(p.mensal, 10000);
  assert.match(p.base, /Valor total R\$\s?120\.000,00 ÷ 12 meses de vigência/);
  assert.ok(p.alertas.some((a) => /acima da parcela/.test(a)), p.alertas.join(" | "));
  assert.equal(p.execAno(2026).liquidado, 160000);
  assert.equal(mesHoje(new Date(2026, 10, 5)), 2026 * 12 + 10);
});

test("previsão: estimativo continua pelo ritmo do liquidado nas NEs", () => {
  const c: ContratoBase = {
    id: "luz", numero_contrato: "DESPESA 062/GAPMN/2025", descricao: "FORNECIMENTO DE ENERGIA ELÉTRICA",
    vl_contratual: 1200000, vl_empenhado: 0, vl_a_empenhar: 0, data_inicio: "2025-01-01", data_final: "2027-01-01",
    data_orcamento: null, pag_nup: "67298.003236/2025-11",
  };
  const linhas = [{ pi: "", pi_desc: "", unidade: "", nota_empenho: "2026NE000002", info_d: "", info_e: "", info_f: "", info_g: c.pag_nup!, a_liquidar: 0, liquidado_pagar: 0, pago: 450000 }];
  const p = projetarContratos([c], new Map(), new Map(), {
    hoje: new Date(2026, 10, 5), reajustePct: 0, suporProrrogacao: false,
    historicoContrato: montarHistorico(linhas, [], 2026, () => "luz"),
  }).get("luz")!;
  assert.equal(p.regime, "estimativo");
  assert.match(p.base, /^Liquidado\/pago nas NEs/);
  assert.notEqual(Math.round(p.mensal), 50000); // não é valor ÷ vigência
});

test("saldo a empenhar: pelas NEs com histórico completo; do SILOMS (identificado) quando há NE de 2024 ou antes", () => {
  const contratos = [
    { id: "obra", numero_contrato: "DESPESA 004/GAPMN-DACTAIV/2024", pag_nup: "67615.014924/2023-31", cnpj: "1", data_inicio: "2026-06-19" },
    { id: "novo", numero_contrato: "DESPESA 017/GAPMN-DACTAIV/2026", pag_nup: "67615.000017/2026-11", cnpj: "2", data_inicio: "2026-10-30" },
  ];
  const nes = juntarNEs([
    sit("2024NE000636", "67615.014924/2023-31", "OBRA DE REFORMA", { pago: 572330 }), // o RP pago em 2025 não está em planilha nenhuma
    sit("2026NE000318", "67615.014924/2023-31", "CONTRATO: DESPESA 004/GAPMN-DACTAIV/2024", { a_liquidar: 105811, pago: 723823 }),
    sit("2026NE001700", "67615.000017/2026-11", "EMPENHO PREVIO", { a_liquidar: 150000 }),
  ]);
  const ex = execucaoPorContrato(contratos, nes, vincularNEs(contratos, nes.values()), 2026);
  assert.equal(ex.get("obra")!.empenhadoIncompleto, true);
  assert.deepEqual(saldoAEmpenhar(3250441.27, ex.get("obra"), 0), { valor: 0, fonte: "SILOMS" });
  assert.deepEqual(saldoAEmpenhar(659999.5, ex.get("novo"), 999), { valor: 509999.5, fonte: "NEs" });
  assert.deepEqual(saldoAEmpenhar(659999.5, undefined, 999), { valor: null, fonte: null });
  // primeira NE: a emissão conhecida; sem ela, 31/12 do ano da NE (nunca adianta o início)
  assert.equal(primeiraNE(ex.get("obra"), new Map([["2026NE000318", "2026-02-10"]])), "2024-12-31");
  assert.equal(primeiraNE(ex.get("novo"), new Map([["2026NE001700", "2026-10-20"]])), "2026-10-20");
});

test("previsão: contrato com NE dele bem antes do início gravado já corria (prorrogação) — o liquidado do ano não se espreme nos meses do período atual", () => {
  const base: ContratoBase = {
    id: "luz", numero_contrato: "DESPESA 062/GAPMN/2025", descricao: "FORNECIMENTO DE ENERGIA ELÉTRICA",
    vl_contratual: 6750923.92, vl_empenhado: 0, vl_a_empenhar: 0, data_inicio: "2026-06-18", data_final: "2031-06-18",
    data_orcamento: null, pag_nup: "67298.003236/2025-47",
  };
  const linhas = [{ pi: "", pi_desc: "", unidade: "", nota_empenho: "2026NE000540", info_d: "", info_e: "", info_f: "", info_g: base.pag_nup!, a_liquidar: 0, liquidado_pagar: 0, pago: 1034142.34 }];
  const op = { hoje: new Date(2026, 10, 5), reajustePct: 0, suporProrrogacao: false, historicoContrato: montarHistorico(linhas, [], 2026, () => "luz") };
  const sem = projetarContratos([base], new Map(), new Map(), op).get("luz")!;
  const com = projetarContratos([{ ...base, primeira_ne: "2026-03-20" }], new Map(), new Map(), op).get("luz")!;
  assert.ok(sem.mensal > 290000, String(sem.mensal));        // 1,03 mi ÷ 3,4 meses (jun–set)
  assert.ok(com.mensal > 90000 && com.mensal < 120000, String(com.mensal)); // 1,03 mi ÷ ~10 meses (dez–set)
  // empenho prévio de contrato novo (menos de 45 dias antes) não conta como "já corria"
  const previo = projetarContratos([{ ...base, primeira_ne: "2026-05-20" }], new Map(), new Map(), op).get("luz")!;
  assert.equal(Math.round(previo.mensal), Math.round(sem.mensal));
});

test("planilha de itens (2022 em diante): valor das NEs antigas, NEs que só existem nela e histórico completo", () => {
  const item = (ne: string, valor: number, pag = "67615.014924/2023-31") => ({
    ne, valor, pag, favorecidoCodigo: "", favorecidoNome: "CONSTRUTORA", descricao: "CONTRATO: DESPESA 004/GAPMN-DACTAIV/2024", pi: "", unidade: "",
  });
  const nes = juntarNEs(
    [
      sit("2024NE000636", "67615.014924/2023-31", "OBRA DE REFORMA", { pago: 572329.72 }), // só o pago em 2024
      sit("2026NE000318", "67615.014924/2023-31", "CONTRATO: DESPESA 004/GAPMN-DACTAIV/2024", { a_liquidar: 105811, pago: 723823 }),
    ],
    [rp("2024NE000636", "67615.014924/2023-31", { rp_nao_proc_a_liq: 1000 })],
    [item("2024NE000636", 1293164.75), item("2026NE000318", 829634), item("2023NE000100", 50000)],
    2026,
  );
  const n24 = nes.get("2024NE000636")!;
  assert.equal(n24.empenhado, 1293164.75);
  assert.equal(n24.aLiquidar, 1000);
  assert.equal(n24.pagoAnterior.toFixed(2), "719835.03"); // pago (ou RP cancelado) em 2025, que nenhuma planilha detalha
  assert.equal((n24.aLiquidar + n24.liquidadoPagar + n24.pago).toFixed(2), "1293164.75");
  assert.equal(n24.completo, true);
  const so = nes.get("2023NE000100")!; // NE toda paga como RP no ano seguinte: só existe na planilha de itens
  assert.deepEqual([so.empenhado, so.pago, so.aLiquidar, so.pagChave], [50000, 50000, 0, "676150149242023"]);
  // contrato com vigência desde 2023: com a planilha de itens desde 2022, o saldo sai das NEs
  const contratos = [{ id: "obra", numero_contrato: "DESPESA 004/GAPMN-DACTAIV/2024", pag_nup: "67615.014924/2023-31", cnpj: null, data_inicio: "2023-06-19" }];
  const ex = execucaoPorContrato(contratos, nes, vincularNEs(contratos, nes.values()), 2026, "2022-01-01");
  assert.equal(ex.get("obra")!.empenhadoIncompleto, false);
  assert.equal(saldoAEmpenhar(2172798.75, ex.get("obra"), 0).fonte, "NEs");
  // sem a planilha de itens (cobertura padrão: ano anterior), o mesmo contrato volta para o SILOMS
  const sem = execucaoPorContrato(contratos, juntarNEs([sit("2024NE000636", "67615.014924/2023-31", "X", { pago: 1 })]), new Map([["2024NE000636", { contratoId: "obra", motivo: "PAG do contrato" as const, candidatos: ["obra"] }]]), 2026);
  assert.equal(sem.get("obra")!.empenhadoIncompleto, true);
});
