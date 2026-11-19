// Testes da leitura dos pareceres referenciais da AGU (página do buscador com a lista em JSON). Dados fictícios
// no formato da página real (cgu.agu.gov.br/referenciais, conferida em 18/11/2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dataIso, ehLicitacao, grupoDe, lerReferenciais, recortarArray, textoFeedAgu, vigente } from "./agu.ts";

const item = (o: Record<string, string | null>) => ({
  id_referenciais: "1", orgao: "COJAER", abrangencia: "0", numero: "2", ano: "2025",
  parecer: "PARECER REFERENCIAL n. 00002/2025/COJAER/CGU/AGU ", nup: "67000.000000/2025-00", data: "2025-04-28",
  assunto: "Aquisição de bens comuns [exemplo]", observacao: "I – Licitação.\r\nII – Prazo de validade: 2 anos.",
  tipo: "PARECER REFERENCIAL ", chaves: null, url: "http://sapiens.agu.gov.br/valida_publico?id=1", sts: "0", adot: "0",
  adotv: "", validade: "2027-04-28", ext: "1", ...o,
});

const pagina = (itens: unknown[]) => `<html><script>
  document.getElementById("t").innerHTML = "<h1>MANIFESTAÇÕES JURÍDICAS REFERENCIAIS</h1>";
  async function Carrega(){
    arrDados= ${JSON.stringify(itens, null, 4).replace(/\//g, "\\/")};
    filtrado = arrDados;
  }
  function f(){ const x = [1, 2]; }
</script></html>`;

test("lê a lista da página, com colchetes e aspas dentro dos textos", () => {
  const html = pagina([
    item({}),
    item({ id_referenciais: "2", orgao: "SERVIÇOS", abrangencia: "3", assunto: "Prorrogação de contratos \"contínuos\" [Lei 14.133]",
      data: "7/31/2024", validade: "", url: "" }),
    item({ id_referenciais: "3", orgao: "CONJUR-MCID", assunto: "Minha Casa, Minha Vida: autorização de propostas", observacao: "Programa habitacional.",
      tipo: "", parecer: "MANIFESTAÇÃO JURÍDICA REFERENCIAL Nº 00018/2026/CONJUR-MCID/CGU/AGU", data: "05/01/2023 " }),
    item({}), // repetido: entra uma vez
  ]);
  const r = lerReferenciais(html);
  assert.equal(r.length, 3);
  assert.deepEqual(
    { ...r[0], observacao: undefined },
    { id: 1, orgao: "COJAER", grupo: "aeronautica", numero: 2, ano: 2025, parecer: "PARECER REFERENCIAL n. 00002/2025/COJAER/CGU/AGU",
      nup: "67000.000000/2025-00", data: "2025-04-28", assunto: "Aquisição de bens comuns [exemplo]", observacao: undefined,
      url: "https://sapiens.agu.gov.br/valida_publico?id=1", validade: "2027-04-28", licitacoes: true },
  );
  assert.equal(r[0].observacao, "I – Licitação.\nII – Prazo de validade: 2 anos.");
  assert.equal(r[1].grupo, "ecju");
  assert.equal(r[1].data, "2024-07-31");
  assert.equal(r[1].validade, null);
  assert.equal(r[1].url, null);
  assert.equal(r[2].licitacoes, false, "programa habitacional não é licitação");
  assert.equal(r[2].data, "2023-01-05");
});

test("página sem a lista: erro claro", () => {
  assert.throws(() => lerReferenciais("<html>manutenção</html>"), /página da AGU mudou/);
  assert.equal(recortarArray("arrDados = [1, [2, \"]\"], 3]; x"), "[1, [2, \"]\"], 3]");
});

test("convênios e doações ficam fora de licitações e contratos", () => {
  assert.equal(ehLicitacao("Recebimento de doações de bens móveis", "Doação. Dispensa de manifestação jurídica individualizada."), false);
  assert.equal(ehLicitacao("Termos aditivos aos convênios do Programa Calha Norte", "aquisição de equipamentos"), false);
  assert.equal(ehLicitacao("Dispensa de licitação para doação com encargo", ""), true);
  assert.equal(ehLicitacao("Prorrogação de contratos de serviços contínuos", ""), true);
});

test("datas, grupos, vigência e texto do feed", () => {
  assert.equal(dataIso("5/2/2024"), "2024-05-02");
  assert.equal(dataIso("13/2/2024"), "2024-02-13", "dia 13 não é mês: lê como dia/mês");
  assert.equal(dataIso(""), null);
  assert.equal(grupoDe("CONJUR-MD", "0"), "defesa");
  assert.equal(grupoDe("CONJUR-MAPA", "0"), "outros");
  assert.equal(vigente({ validade: null }, "2026-11-18"), true);
  assert.equal(vigente({ validade: "2026-11-17" }, "2026-11-18"), false);
  assert.equal(textoFeedAgu([{ grupo: "aeronautica", licitacoes: true }, { grupo: "ecju", licitacoes: true }, { grupo: "outros", licitacoes: false }]),
    "AGU: 2 pareceres referenciais novos sobre licitações e contratos (1 da COJAER)");
  assert.equal(textoFeedAgu([{ grupo: "outros", licitacoes: false }]), null);
});
