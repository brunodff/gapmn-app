import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATALOGO_PARECERES, acharNaAgu, alertasDoAditivo, analisarPareceres, citarPareceres, ementaDoParecer, faltandoNoZip, fimPrevisto, fraseObjetoVantajosidade,
  fraseObservacaoParecer, geradosPrevistos, incisosVantajosidade, itensDaLista, limparObjeto, motivosAnuencia, normalizarFormatoAntigo,
  objetoDaFicha, passa1Milhao, pareceresSugeridos, proximoAditivo, resumoPesquisa, temProrrogacao, temReajuste, valorNovo,
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
    const k4 = ex.conferir as { tem_prorrogacao: boolean; motivos_anuencia: string[]; objeto_vantajosidade: string; documentos: string[] };
    assert.equal(temProrrogacao(d), k4.tem_prorrogacao);
    assert.deepEqual(motivosAnuencia(ex.dados as unknown as DadosAditivo), k4.motivos_anuencia);
    assert.equal(fraseObjetoVantajosidade(d), k4.objeto_vantajosidade);
    const mapa: Record<string, string> = { declaracao: "disp_orcamentaria", vantajosidade: "vantajosidade", mapa: "mapa_riscos", pesquisa: "pesquisa_precos", atestado: "atestado_adequacao", ficha: "ficha_autorizacao" };
    assert.deepEqual(geradosPrevistos(d, HOJE).sort(), k4.documentos.filter((x) => x !== "lista").map((x) => mapa[x]).sort());
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
  // objeto da biblioteca de pareceres da SCON (rev. 2), não o resumo da página AGU
  assert.match(s[0].objeto ?? "", /^Prorrogação do prazo de vigência de contratos de serviços continuados sem dedicação exclusiva/);
  assert.deepEqual(pareceresSugeridos(["prorrogacao", "reajuste"], "servico_sem_demo", "8666", [])[0].cobre, ["prorrogacao", "reajuste"]);
  assert.equal(pareceresSugeridos(["prorrogacao"], "outro", "14133", [{ ...agu[0], parecer: "PARECER REFERENCIAL n. 9/2025/X", assunto: "x" }]).length, 0);
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

test("revisões 2 a 4 da SCON: objeto do parecer limpo, anuência, vantajosidade, atestado único e o que falta no .zip", () => {
  // 1º teste (CT 020/GAPMN/2022): anotação de substituição e "serviços contínua" saem do objeto
  assert.equal(limparObjeto("Prorrogação do prazo de vigência de contratos de serviços contínua sem dedicação exclusiva de mão de obra, celebrados sob a égide da Lei nº 8.666/93. PARECER n. 00002/2024/COORD/E-CJU/SSEM/CGU/AGU, substituído pelo PARECER REFERENCIAL n. 00001/2023/CGSEM/SCGP/CGU/AGU, conforme DESPACHO Nº 00018/2026/CONSER/SCGP/CGU/AGU constante do NUP 00688.000881/2020-39"),
    "Prorrogação do prazo de vigência de contratos de serviços continuados sem dedicação exclusiva de mão de obra, celebrados sob a égide da Lei nº 8.666/93.");
  assert.equal(limparObjeto("alteração unilateral. Obs.: ver NUP"), "Alteração unilateral.");
  assert.equal(citarPareceres([{ numero: "PARECER REFERENCIAL Nº. 00006/2025/CONSER/SCGP/CGU/AGU" }]), "ao PARECER REFERENCIAL nº 00006/2025/CONSER/SCGP/CGU/AGU");
  assert.equal(citarPareceres([{ numero: "PARECER REFERENCIAL n. 00001/2023/CGSEM/SCGP/CGU/AGU" }, { numero: "PARECER REFERENCIAL n. 00002/2023/CGSEM/SCGP/CGU/AGU" }]),
    "aos PARECERES REFERENCIAIS nº 00001/2023/CGSEM/SCGP/CGU/AGU e nº 00002/2023/CGSEM/SCGP/CGU/AGU");
  const ad = (x: Partial<DadosAditivo["aditivo"]>) => ({ aditivo: { prorrogacao: null, reajuste: null, acrescimo: null, supressao: null, ...x } }) as DadosAditivo;
  assert.deepEqual(motivosAnuencia(ad({ reajuste: { indice: "IPCA", percentual: "4%", valor: 1 } })), []);
  assert.deepEqual(motivosAnuencia(ad({ acrescimo: { valor: 1, percentual: 25, descricao: null } })), []);
  assert.deepEqual(motivosAnuencia(ad({ supressao: { valor: null, percentual: null, descricao: null } })), ["a supressão (percentual não informado – conferir)"]);
  assert.deepEqual(incisosVantajosidade(["a) Primeiro motivo.", "  ", "2 - segundo;", "III – terceiro"]), [["I", "Primeiro motivo;"], ["II", "segundo;"], ["III", "terceiro."]]);
  assert.equal(fraseObjetoVantajosidade({ objeto_contrato: "PRESTAÇÃO DE SERVIÇOS DE LIMPEZA." }), "a prestação de serviços de limpeza");
  assert.equal(fraseObjetoVantajosidade({ objeto_contrato: "Serviços de vigilância" }), "os serviços de vigilância");
  assert.equal(fraseObjetoVantajosidade({ objeto_contrato: "SMP para a OM", vantajosidade: { motivos: [], objeto: "o serviço X." } }), "o serviço X");
  // parecer fora da biblioteca: objeto pela EMENTA do PDF (texto como o do 00006/2025/CONSER), sem a parte padrão
  const pdf = `PARECER REFERENCIAL Nº. 00006/2025/CONSER/SCGP/CGU/AGU ASSUNTOS: ALTERAÇÃO CONTRATUAL. EMENTA: MANIFESTAÇÃO JURÍDICA REFERENCIAL. ORIENTAÇÃO NORMATIVA AGU Nº 55, DE
23 DE MAIO DE 2014, E PORTARIA NORMATIVA CGU/AGU Nº 05, DE 31 DE MARÇO DE 2022. DIREITO ADMINISTRATIVO. LICITAÇÕES E CONTRATOS. SERVIÇOS DE NATUREZA
CONTINUADA SEM MÃO DE OBRA EXCLUSIVA. ACRÉSCIMO OU SUPRESSÃO DE VALOR, COM FULCRO NO ART. 124, INCISO I, ALÍNEA "B", DA LEI Nº 14.133, DE 1º DE ABRIL DE 2021.
1. BASE LEGAL: Lei nº 14.133, de 2021. 2. HIPÓTESES DE INAPLICABILIDADE: e) alteração contratual que supere o limite legal de 25% (vinte e cinco por cento). I. RELATÓRIO 1. Trata-se de...`;
  assert.equal(ementaDoParecer(pdf, ["acrescimo"]), "Serviços de natureza continuada sem mão de obra exclusiva. Acréscimo ou supressão de valor, com fulcro no art. 124, inciso I, alínea \"b\", da Lei nº 14.133, de 1º de abril de 2021.");
  assert.equal(ementaDoParecer("sem a palavra", ["prorrogacao"]), null);
  // CLARO: com todas as alterações fundamentadas, um atestado só; o .zip lista o que falta (anuência, parecer técnico, pesquisa)
  const claro = normalizarFormatoAntigo(fixture.exemplos.find((e) => e.nome.startsWith("CLARO"))!.dados) as unknown as DadosAditivo;
  const itens = itensDaLista(claro, HOJE);
  assert.equal(itens.filter((i) => i.chave.startsWith("atestado")).length, 1);
  assert.equal(itens.find((i) => i.chave === "atestado_adequacao")!.texto, "Atestado de adequação do processo aos PARECERES REFERENCIAIS nº 00001/2023/CGSEM/SCGP/CGU/AGU e nº 00002/2023/CGSEM/SCGP/CGU/AGU.");
  const gerados = geradosPrevistos(claro, HOJE);
  const falta = faltandoNoZip(claro, HOJE, (c) => gerados.includes(c) || c === "sicaf" || c === "consulta_cnpj");
  assert.deepEqual(falta.map((x) => `${x.n} ${x.chave}`), ["1 anuencia_consulta", "2 anuencia_resposta", "5 parecer_tecnico", "7 pesquisa_precos"]);
  // CJU: sem atestado
  const cju = normalizarFormatoAntigo(fixture.exemplos.find((e) => e.nome.startsWith("acrescimo"))!.dados) as unknown as DadosAditivo;
  assert.ok(!itensDaLista(cju, HOJE).some((i) => i.chave.startsWith("atestado")));
  // sem motivo da vantajosidade a geração para; marcada como não anexada (com justificativa), não
  const est = { natureza: "servico_sem_demo", lei: "8666", cnpj: "", objeto_contrato: "", tipo_risco: "todos" } as EstadoAditivo;
  const sem = alertasDoAditivo({ ...claro, vantajosidade: { motivos: [""] } }, est, HOJE, { sicaf: true, regularidade: true });
  assert.ok(sem.some((x) => /Vantajosidade: escreva/.test(x.texto) && x.bloqueia));
  const nao = alertasDoAditivo({ ...claro, vantajosidade: null, nao_anexados: { vantajosidade: "já juntada" } }, est, HOJE, { sicaf: true, regularidade: true });
  assert.ok(!nao.some((x) => /Vantajosidade: escreva/.test(x.texto) && x.bloqueia));
  assert.ok(alertasDoAditivo(claro, est, HOJE, { sicaf: true, regularidade: true }, { unidadeCadastrada: false }).some((x) => /não está cadastrada/.test(x.texto) && !x.bloqueia));
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
