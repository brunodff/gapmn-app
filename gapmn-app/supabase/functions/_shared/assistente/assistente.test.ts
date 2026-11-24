import { test } from "node:test";
import assert from "node:assert/strict";
import { padrao, palavras } from "./texto.ts";
import { DEFINICOES, DO_NAVEGADOR, executarServidor } from "./ferramentas.ts";
import { caber, juntarResultados, rodar, type MsgIA } from "./conversa.ts";
import { chamarGroq, escolherModelo, segundosDeEspera, cotaDoDia } from "./groq.ts";

// ── Banco falso: o mínimo do PostgREST que as ferramentas usam (ilike com * e _, or, gte/lte/lt/eq/in, order, limit)
type Linha = Record<string, unknown>;
const comoRegex = (p: string) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/%/g, ".*").replace(/_/g, ".")}$`, "is");
function bancoFalso(tabelas: Record<string, Linha[]>) {
  return {
    from(t: string) {
      let linhas = [...(tabelas[t] ?? [])];
      let contar = false;
      const q = {
        select(_c: string, op?: { count?: string }) { contar = !!op?.count; return q; },
        ilike(c: string, p: string) { const rx = comoRegex(p); linhas = linhas.filter((l) => rx.test(String(l[c] ?? ""))); return q; },
        or(f: string) {
          const conds = f.split(",").map((x) => { const [c, op, ...v] = x.split("."); return { c, op, v: v.join(".") }; });
          linhas = linhas.filter((l) => conds.some(({ c, op, v }) => (op === "ilike" && comoRegex(v).test(String(l[c] ?? "")))
            || (op === "imatch" && new RegExp(v.replace(/^"|"$/g, ""), "i").test(String(l[c] ?? "")))));
          return q;
        },
        gte(c: string, v: unknown) { linhas = linhas.filter((l) => l[c] != null && String(l[c]) >= String(v)); return q; },
        lte(c: string, v: unknown) { linhas = linhas.filter((l) => l[c] != null && String(l[c]) <= String(v)); return q; },
        lt(c: string, v: unknown) { linhas = linhas.filter((l) => l[c] != null && String(l[c]) < String(v)); return q; },
        eq(c: string, v: unknown) { linhas = linhas.filter((l) => l[c] === v); return q; },
        in(c: string, v: unknown[]) { linhas = linhas.filter((l) => v.includes(l[c])); return q; },
        textSearch() { return q; },
        order(c: string, op?: { ascending?: boolean }) {
          const asc = op?.ascending !== false;
          linhas.sort((a, b) => (a[c] == null ? 1 : b[c] == null ? -1 : (a[c]! < b[c]! ? -1 : a[c]! > b[c]! ? 1 : 0) * (asc ? 1 : -1)));
          return q;
        },
        limit(n: number) { const total = linhas.length; linhas = linhas.slice(0, n); return Promise.resolve({ data: linhas, count: contar ? total : null, error: null }); },
        then(ok: (v: unknown) => unknown) { return Promise.resolve({ data: linhas, count: contar ? linhas.length : null, error: null }).then(ok); },
      };
      return q;
    },
  };
}

test("palavras e padrão: sem as vazias, nº inteiro, acento e plural nos dois sentidos", () => {
  assert.deepEqual(palavras("Quais os contratos de manutenção predial que vencem?"), ["contratos", "manutenção", "predial", "vencem"]);
  assert.deepEqual(palavras("DESPESA 015/GAPMN-SRINFRA/2024"), ["DESPESA", "015/GAPMN-SRINFRA/2024"]);
  const casa = (p: string, t: string) => new RegExp(padrao(p), "i").test(t);
  assert.ok(casa("manutencao", "SERVIÇO DE MANUTENÇÃO PREDIAL"));
  assert.ok(casa("combustível", "AQUISICAO DE COMBUSTIVEL"), "acento na pergunta, sem acento no cadastro");
  assert.ok(casa("material", "Materiais de limpeza"), "radical: singular acha plural");
  assert.ok(casa("licitações", "LICITAÇÃO 12/2026"));
  assert.ok(!casa("limpeza", "vigilância armada"));
  assert.ok(casa("015/GAPMN-SRINFRA/2024", "DESPESA 015/GAPMN-SRINFRA/2024"));
});

const ATAS = [
  { numero_ata: "00141/2026", objeto: "Aquisição de materiais de limpeza", fornecedor_nome: "X", vigencia_fim: "2027-05-01", cancelado: false },
  { numero_ata: "00044/2026", objeto: "Aquisição de material de expediente", fornecedor_nome: "Y", vigencia_fim: "2027-05-01", cancelado: false },
];

test("recuo: sem resultado com todas as palavras, sai primeiro a genérica (material) e avisa", async () => {
  const db = bancoFalso({ atas_registro_preco: ATAS });
  const r = await executarServidor("atas", { texto: "material de limpeza hospitalar" }, { db, hoje: "2026-11-24" });
  const p = r.paraIA as { total: number; atas: { numero: string }[]; obs_busca?: string };
  assert.equal(p.total, 1);
  assert.equal(p.atas[0].numero, "00141/2026");
  assert.match(p.obs_busca ?? "", /limpeza/);
});

const CONTRATOS = [
  { numero_contrato: "DESPESA 015/GAPMN-SRINFRA/2024", fornecedor: "LIMPA BEM LTDA", descricao: "Serviço de limpeza e conservação", data_final: "2027-01-31", vl_contratual: 1000, vl_a_empenhar: 100, data_orcamento: "2024-03-01" },
  { numero_contrato: "DESPESA 020/GAPMN/2025", fornecedor: "MANUTEC SA", descricao: "Manutenção predial preventiva", data_final: "2026-12-20", vl_contratual: 5000, vl_a_empenhar: 0, data_orcamento: "2025-06-01" },
  { numero_contrato: "CREDENCIAMENTO 014/2022", fornecedor: "CLÍNICA X", descricao: "Exames", data_final: "2025-05-01", vl_contratual: 200, vl_a_empenhar: 0, data_orcamento: null },
];

test("contratos: palavra sem acento, tipo, vigência, somas de todos e links para a tela", async () => {
  const db = bancoFalso({ contratos_scon: CONTRATOS });
  const r = await executarServidor("contratos", { texto: "manutencao", situacao: "vigente" }, { db, hoje: "2026-11-24" });
  const p = r.paraIA as { total: number; contratos: { numero: string }[]; somas_de_todos: { contratual: number } };
  assert.equal(p.total, 1);
  assert.equal(p.contratos[0].numero, "DESPESA 020/GAPMN/2025");
  assert.equal(p.somas_de_todos.contratual, 5000);
  assert.deepEqual(r.fontes[0], { rotulo: 'Contratos SCON: "manutencao"', link: "/app?vista=contratos&busca=manutencao" });
  assert.equal(r.fontes[1].link, "/app?vista=contratos&busca=DESPESA%20020%2FGAPMN%2F2025");
  const cred = await executarServidor("contratos", { tipo: "CREDENCIAMENTO" }, { db, hoje: "2026-11-24" });
  assert.equal((cred.paraIA as { total: number }).total, 1);
  const vence = await executarServidor("contratos", { vence_ate: "2026-12-31" }, { db, hoje: "2026-11-24" });
  assert.deepEqual((vence.paraIA as { contratos: { numero: string }[] }).contratos.map((c) => c.numero), ["DESPESA 020/GAPMN/2025"]);
});

test("reajustes: a mesma regra do painel (devido, sem data, encerrado) e link para o contrato", async () => {
  const db = bancoFalso({ contratos_scon: CONTRATOS, contratos_apostilamento: [
    { numero_contrato: "DESPESA 015/GAPMN-SRINFRA/2024", data_base: "03/2024", reajustes_aplicados: 1, situacao_cadastro: "COMPLETO", pendencias: [] },
  ] });
  const r = await executarServidor("reajustes", { situacao: "devido" }, { db, hoje: "2026-11-24" });
  const p = r.paraIA as { resumo_de_todos: Record<string, number>; contratos: { contrato: string; reajustes_devidos: string[]; cadastro: string }[] };
  assert.equal(p.contratos.length, 2, "015 (2º reajuste, efeitos 03/2026) e 020 (1º, efeitos 06/2026)");
  assert.match(p.contratos.find((c) => c.contrato.startsWith("DESPESA 015"))!.reajustes_devidos[0], /^2º \(03\/2025 a 02\/2026; efeitos 01\/03\/2026\)/);
  assert.equal(p.contratos.find((c) => c.contrato.startsWith("DESPESA 015"))!.cadastro, "completo (pode gerar)");
  assert.equal(p.resumo_de_todos.prontos_para_gerar_devido_e_cadastro_completo, 1);
  assert.equal(p.resumo_de_todos.sem_data_do_orcamento, 0);
  assert.ok(r.fontes.some((f) => f.link === "/app?vista=reajustes&contrato=DESPESA%20015%2FGAPMN-SRINFRA%2F2024"));
});

test("definições: as ferramentas do navegador existem e todas têm parâmetros de objeto", () => {
  const nomes = DEFINICOES.map((d) => d.function.name);
  for (const n of DO_NAVEGADOR) assert.ok(nomes.includes(n));
  assert.ok(DEFINICOES.every((d) => (d.function.parameters as { type: string }).type === "object"));
  assert.ok(JSON.stringify(DEFINICOES).length < 7000, "as definições custam tokens em toda chamada");
});

test("conversa: ferramenta do servidor, depois a do navegador (pausa e continua) e resposta final", async () => {
  const respostas = [
    { content: null, tool_calls: [{ id: "a", type: "function" as const, function: { name: "contratos", arguments: '{"texto":"limpeza"}' } }] },
    { content: null, tool_calls: [{ id: "b", type: "function" as const, function: { name: "empenhos", arguments: '{"texto":"LIMPA BEM"}' } }] },
    { content: "O contrato DESPESA‑015 é da LIMPA BEM; empenhado R$ 1.000,00.", tool_calls: undefined },
  ];
  const vistas: MsgIA[][] = [];
  const chamarIA = async (m: MsgIA[]) => { vistas.push(structuredClone(m)); return respostas.shift()!; };
  const executar = async () => ({ paraIA: { total: 1 }, fontes: [{ rotulo: "Contrato 015", link: "/app?vista=contratos&busca=015" }] });
  const estado = { mensagens: [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "limpeza?" }], fontes: [], consultas: [], rodadas: 0 };
  const s1 = await rodar(estado, { chamarIA, executar, doNavegador: DO_NAVEGADOR });
  assert.equal(s1.tipo, "pendente");
  if (s1.tipo !== "pendente") return;
  assert.deepEqual(s1.pendentes, [{ id: "b", nome: "empenhos", args: { texto: "LIMPA BEM" } }]);
  juntarResultados(s1.estado, [{ id: "b", paraIA: { total: 2 }, fontes: [{ rotulo: "Painel de Execução", link: "/app?vista=painel-execucao" }] }, { id: "zz", paraIA: { injetado: true } }]);
  const s2 = await rodar(s1.estado, { chamarIA, executar, doNavegador: DO_NAVEGADOR });
  assert.equal(s2.tipo, "final");
  if (s2.tipo !== "final") return;
  assert.equal(s2.resposta, "O contrato DESPESA-015 é da LIMPA BEM; empenhado R$ 1.000,00.");
  assert.deepEqual(s2.consultas, ["contratos", "empenhos"]);
  assert.deepEqual(s2.fontes.map((f) => f.link), ["/app?vista=contratos&busca=015", "/app?vista=painel-execucao"]);
  const ult = vistas[2];
  assert.ok(ult.some((m) => m.role === "tool" && m.tool_call_id === "b"), "o resultado do navegador chegou à IA");
  assert.ok(!ult.some((m) => m.content?.includes("injetado")), "resultado de consulta que a IA não pediu não entra");
});

test("caber: lista grande é encurtada e avisada", () => {
  const t = caber({ total: 500, itens: Array.from({ length: 500 }, (_, i) => ({ i, texto: "x".repeat(40) })) }, 2000);
  assert.ok(t.length <= 2000);
  assert.match(t, /"total":500/);
  assert.match(t, /encurtada/);
});

test("Groq: espera pedida, cota do dia e escolha do modelo", async () => {
  assert.equal(segundosDeEspera("Please try again in 7.52s."), 7.52);
  assert.equal(segundosDeEspera("try again in 1m3.5s"), 63.5);
  assert.ok(cotaDoDia("Rate limit reached for model on tokens per day (TPD): Limit 200000"));
  assert.equal(escolherModelo(["llama-3.1-8b-instant", "openai/gpt-oss-20b", "openai/gpt-oss-120b"], new Set()), "openai/gpt-oss-120b");
  assert.equal(escolherModelo(["openai/gpt-oss-20b", "openai/gpt-oss-120b"], new Set(["openai/gpt-oss-120b"])), "openai/gpt-oss-20b");

  const chamadas: string[] = [];
  const esperas: number[] = [];
  const respostas = [
    new Response('{"error":{"message":"The model `llama-3.3-70b-versatile` does not exist","code":"model_not_found"}}', { status: 404 }),
    new Response('{"data":[{"id":"whisper-large-v3"},{"id":"openai/gpt-oss-120b"}]}', { status: 200 }),
    new Response('{"error":{"message":"Rate limit reached ... tokens per minute (TPM). Please try again in 2.1s."}}', { status: 429 }),
    new Response('{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":10}}', { status: 200 }),
  ];
  const buscar = (async (url: string, init?: RequestInit) => { chamadas.push(`${url.split("/v1/")[1]} ${init?.body ? JSON.parse(String(init.body)).model : ""}`); return respostas.shift()!; }) as typeof fetch;
  const r = await chamarGroq([{ role: "user", content: "oi" }], { chave: "k", modelo: "llama-3.3-70b-versatile", buscar, esperar: async (ms) => { esperas.push(ms); } });
  assert.equal(r.content, "ok");
  assert.equal(r.modelo, "openai/gpt-oss-120b");
  assert.deepEqual(chamadas, ["chat/completions llama-3.3-70b-versatile", "models ", "chat/completions openai/gpt-oss-120b", "chat/completions openai/gpt-oss-120b"]);
  assert.deepEqual(esperas, [2400]);
});
