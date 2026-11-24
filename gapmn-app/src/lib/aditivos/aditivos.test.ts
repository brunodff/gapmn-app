import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATALOGO_PARECERES, acharNaAgu, alertasDoAditivo, analisarPareceres, fimPrevisto, fraseObservacaoParecer, itensDaLista,
  normalizarFormatoAntigo, objetoDaFicha, passa1Milhao, pareceresSugeridos, proximoAditivo, resumoPesquisa, temReajuste, valorNovo,
} from "./regras.ts";
import { fonteDoRegistro, pesquisaParaAditivo } from "./pesquisa.ts";
import type { DadosAditivo, EstadoAditivo } from "./tipos.ts";

// Resposta do kit da SCON (Python, ponte_aditivo.conferir) para os exemplos do pacote de 24/11/2026
const fixture = JSON.parse(readFileSync(new URL("./fixtures/exemplos.json", import.meta.url), "utf8")) as {
  hoje: string; exemplos: { nome: string; dados: Record<string, unknown>; conferir: Record<string, unknown> }[];
};
const HOJE = fixture.hoje;

for (const ex of fixture.exemplos) {
  test(`mesma resposta do kit da SCON: ${ex.nome}`, () => {
    const d = normalizarFormatoAntigo(ex.dados) as unknown as DadosAditivo;
    const k = ex.conferir as {
      pareceres: { alteracoes: string[]; pareceres: { numero: string; fundamenta: string[]; motivo_texto: string }[]; descobertas: string[]; vai_para_cju: boolean };
      observacao_parecer: string | null; itens: { chave: string; texto: string }[]; objeto: string; valor_atual: number | null; valor_novo: number | null;
      passa_1_milhao: boolean; tem_reajuste: boolean;
    };
    const an = analisarPareceres(d, HOJE);
    assert.deepEqual(an.alteracoes, k.pareceres.alteracoes);
    assert.deepEqual(an.pareceres.map((p) => [p.numero, p.fundamenta, p.motivo_texto]), k.pareceres.pareceres.map((p) => [p.numero, p.fundamenta, p.motivo_texto]));
    assert.deepEqual(an.descobertas, k.pareceres.descobertas);
    assert.equal(an.vai_para_cju, k.pareceres.vai_para_cju);
    assert.equal(fraseObservacaoParecer(an), k.observacao_parecer);
    assert.deepEqual(itensDaLista(d, HOJE).map((i) => [i.chave, i.texto]), k.itens.map((i) => [i.chave, i.texto]));
    assert.equal(temReajuste(d), k.tem_reajuste);
    if (ex.dados.aditivo) {
      assert.equal(valorNovo(d), k.valor_novo);
      assert.equal(passa1Milhao(d), k.passa_1_milhao);
      assert.equal(objetoDaFicha(d), k.objeto);
    }
  });
}

test("fim do novo período, nº do próximo aditivo e catálogo de pareceres", () => {
  assert.equal(fimPrevisto("01/01/2027", 12), "31/12/2027");
  assert.equal(fimPrevisto("31/01/2027", 1), "27/02/2027");
  assert.equal(fimPrevisto("15/03/2027", 6), "14/09/2027");
  assert.equal(proximoAditivo([{ tipo: "CONTRATO", numero: "010/2025" }, { tipo: "TERMO_ADITIVO", numero: "00002/2026" }, { tipo: "APOSTILAMENTO", numero: "1/2026" }]), 3);
  assert.equal(proximoAditivo([]), 1);
  const agu = [{ id: 1, parecer: "PARECER REFERENCIAL n. 00004/2024/CGSEM/SCGP/CGU/AGU", numero: 4, ano: 2024, assunto: "Prorrogação (ementa da AGU)", data: "2024-11-01", validade: "2028-11-01", url: "https://x" }];
  assert.equal(acharNaAgu(CATALOGO_PARECERES[0], agu)?.id, 1);
  assert.equal(acharNaAgu(CATALOGO_PARECERES[1], agu), null);
  const s = pareceresSugeridos(["prorrogacao", "reajuste", "acrescimo"], "servico_sem_demo", "14133", agu);
  assert.deepEqual(s.map((p) => p.numero), ["PARECER REFERENCIAL n. 00004/2024/CGSEM/SCGP/CGU/AGU", "PARECER REFERENCIAL Nº. 00006/2025/CONSER/SCGP/CGU/AGU"]);
  assert.equal(s[0].conferido, true);
  assert.equal(s[0].objeto, "Prorrogação (ementa da AGU)");
  assert.equal(s[0].validade, "01/11/2028");
  assert.equal(s[1].limite_percentual, 25);
  assert.equal(pareceresSugeridos(["prorrogacao"], "servico_com_demo", "8666", [])[0].numero, "PARECER REFERENCIAL n. 2/2024/DICOMEX/SCGP/CGU/AGU");
  assert.equal(pareceresSugeridos(["reajuste"], "outro", "14133", []).length, 0);
});

test("alertas da seção 4: o que impede e o que só avisa", () => {
  const completo = fixture.exemplos.find((e) => e.nome.startsWith("completo"))!.dados as unknown as DadosAditivo;
  const estado: EstadoAditivo = { natureza: "servico_sem_demo", lei: "14133", cnpj: "", objeto_contrato: "", tipo_risco: "todos",
    sicaf: { ok: true, alertas: [], cnpj: null, emitido_em: null, data_referencia: "", certidoes: {}, ocorrencias: {}, niveis: {}, arquivo: "x", em: "" },
    regularidade: { cnpj: null, cadastros: { cnj_cnia: { orgao: "CNJ", cadastro: "CNIA", situacao: "indisponivel", manual: "", automatico: true } }, alertas: [], fonte: "pdf", em: "", complementos: {} } };
  const a = alertasDoAditivo({ ...completo, nao_anexados: {}, merito_administrativo: "x" } as DadosAditivo, estado, HOJE, { sicaf: true, regularidade: true });
  assert.ok(!a.some((x) => x.bloqueia), JSON.stringify(a.filter((x) => x.bloqueia)));
  assert.ok(a.some((x) => /CNIA/.test(x.texto) && x.nivel === "atencao"));
  const semNada = alertasDoAditivo({ ...completo, riscos: [], nao_anexados: { sicaf: "" }, merito_administrativo: "", om_signataria: { ...completo.om_signataria, ug: "" } } as DadosAditivo,
    { ...estado, sicaf: undefined, regularidade: undefined }, HOJE, { sicaf: false, regularidade: false });
  const textos = semNada.filter((x) => x.bloqueia).map((x) => x.texto).join(" | ");
  for (const t of ["sem nenhum risco", "NÃO anexado sem justificativa", "mérito administrativo", "UG signatária"]) assert.match(textos, new RegExp(t));
  // SICAF e regularidade (certidões) só avisam: nunca impedem a geração
  assert.ok(semNada.some((x) => /consulta de regularidade/.test(x.texto) && !x.bloqueia));
  assert.ok(!semNada.some((x) => /SICAF/.test(x.texto) && x.bloqueia));
  const acrescimo = fixture.exemplos.find((e) => e.nome.startsWith("acrescimo"))!.dados as unknown as DadosAditivo;
  const cju = alertasDoAditivo(acrescimo, estado, HOJE, { sicaf: true, regularidade: true });
  assert.ok(cju.some((x) => /Acréscimo \(32,00%, acima do limite de 25%\) sem parecer referencial vigente/.test(x.texto)));
  assert.ok(cju.some((x) => /passa de 25%/.test(x.texto)));
  const rp = resumoPesquisa(completo)!;
  assert.equal(rp.vantajosa, true);
});

test("pesquisa de preços → pesquisa_precos do kit (fonte, preços considerados e desconsiderados, preço contratado mantido)", () => {
  assert.equal(fonteDoRegistro({ idCompra: "16000105900122026", codigoUasg: "160001" }), "Compras.gov.br – UASG 160001 – Pregão 90012/2026");
  assert.equal(fonteDoRegistro({ codigoUasg: "120630", origem: "ata", numeroAta: "00012/2026" }), "Compras.gov.br – UASG 120630 – Ata de RP 00012/2026");
  const a = { idCompra: "16000105900122026", dataResultado: "2026-05-12", precoUnitario: 1371.2, precoOriginal: 1350 };
  const b = { idCompra: "16000205900132026", dataResultado: "2026-06-01", precoUnitario: 9000 };
  const item = { id: "x", numero: 1, tipo: "servico" as const, codigo: 12345, descricao: "Serviço", unidade: "mês", quantidade: 12, valorReferencia: null };
  const anterior = { fonte_tr: "", data_pesquisa: "", atualizacao: "", criterio: "mediana" as const, itens: [{ item: 1, descricao: "", codigo: "", unidade: "", quantidade: 12, preco_contratado: 1300, precos: [] }] };
  const p = pesquisaParaAditivo([{ item, validos: [a, b], considerados: [a], criterio: "media" }], { fonteTr: "TR do contrato", atualizacao: "IPCA", hoje: "24/11/2026" }, anterior);
  assert.equal(p.criterio, "media");
  assert.equal(p.itens[0].codigo, "CATSER 12345");
  assert.equal(p.itens[0].preco_contratado, 1300);
  assert.deepEqual(p.itens[0].precos.map((x) => [x.data, x.valor, x.valor_atualizado, !!x.excluido]), [["12/05/2026", 1350, 1371.2, false], ["01/06/2026", 9000, 9000, true]]);
});
