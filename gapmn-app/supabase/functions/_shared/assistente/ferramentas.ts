// Ferramentas do assistente do gapmn.app: as consultas que a IA pode pedir. Todas só leem, com o login de quem
// pergunta (as mesmas regras de acesso do app). Cada uma devolve o que vai para a IA (campos curtos, poucas
// linhas, totais calculados aqui) e as "fontes": onde a informação está no app, para os botões do chat.
// "empenhos" e "credito" rodam no navegador (planilhas grandes do Tesouro Gerencial): aqui só o formato.
import { painel, isoDaVigencia, dataBaseDe, ROTULOS, type StatusReajuste } from "../../../../src/lib/apostilamento/painel.ts";
import { comPalavras, corta, GENERICAS, palavras } from "./texto.ts";

export interface Fonte { rotulo: string; link: string; externo?: boolean }
export interface Resultado { paraIA: unknown; fontes: Fonte[] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente do supabase-js (consulta encadeada)
type Db = any;
export interface Contexto { db: Db; hoje: string; buscar?: typeof fetch }
type Args = Record<string, unknown>;

/** Ferramentas que o navegador executa (o servidor devolve o pedido) */
export const DO_NAVEGADOR = new Set(["execucao_contratos", "empenhos", "credito"]);

const s = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
const app = (vista: string, busca?: string) => `/app?vista=${vista}${busca ? `&busca=${encodeURIComponent(busca)}` : ""}`;
const r2 = (v: unknown) => (v == null || v === "" ? null : Math.round(Number(v) * 100) / 100);
const somar = (linhas: Record<string, unknown>[], campo: string) => r2(linhas.reduce((t, l) => t + (Number(l[campo]) || 0), 0));
const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const contem = (alvo: string, texto: string) => palavras(texto).every((p) => semAcento(alvo).includes(semAcento(p)));
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? String(e)); };

// ── Definições (formato de ferramentas da API de chat compatível com a OpenAI) ───────────────────────────────
const obj = (props: Record<string, unknown>) => ({ type: "object", properties: props });
const T = (d: string) => ({ type: "string", description: d });
const B = (d: string) => ({ type: "boolean", description: d });
const E = (d: string, valores: string[]) => ({ type: "string", enum: valores, description: d });
const TEXTO = T("palavras-chave (objeto, empresa, nº, CNPJ); deixe vazio para listar");

export const DEFINICOES = [
  ["contratos", "Cadastro dos contratos da SCON: empresa, objeto, vigência, valor contratual, fiscal, PAG. Empenhos, pagamentos e saldo a empenhar: execucao_contratos.",
    obj({ texto: TEXTO, tipo: E("tipo do contrato", ["DESPESA", "CREDENCIAMENTO", "ADESAO", "RECEITA"]),
      situacao: E("vigência", ["vigente", "encerrado"]), vence_ate: T("vigência termina até (AAAA-MM-DD)"),
      ordem: E("ordenação", ["vencimento", "valor"]) })],
  ["execucao_contratos", "Execução de contrato(s): as notas de empenho do contrato, empenhado, a liquidar, pago e saldo a empenhar — a mesma conta da aba Execução do contrato. Use para quantos/quais empenhos de um contrato e valores executados.",
    obj({ texto: T("nº do contrato (ex.: DESPESA 008/GAPMN-DACTAIV/2025), empresa ou objeto") })],
  ["reajustes", "Reajustes por apostilamento: situação de cada contrato (reajuste devido, próximo, sem data do orçamento), períodos devidos e cadastro.",
    obj({ texto: TEXTO, situacao: E("filtro", ["devido", "pronto_para_gerar", "proximo", "sem_data", "fora_da_automacao", "encerrado"]) })],
  ["licitacoes", "Processos licitatórios do GAP-MN (pregões, dispensas…): objeto, situação, valores estimado e homologado, datas, SRP; com_itens traz os itens.",
    obj({ texto: TEXTO, ano: T("ano"), situacao: E("situação", ["Em andamento", "Homologado", "Homologado parcialmente", "Suspenso", "Cancelado", "Fracassado", "Deserto", "Revogado"]), srp: B("só registro de preços"), com_itens: B("incluir itens (quando poucos processos)") })],
  ["itens", "Itens já licitados ou registrados em ata pelo GAP-MN, com preço unitário e fornecedor (para saber quanto se pagou por algo).",
    obj({ texto: T("descrição do item ou fornecedor"), fonte: E("onde procurar", ["licitacoes", "atas", "ambos"]) })],
  ["atas", "Atas de registro de preços: objeto, fornecedor, valor, vigência, adesão.", obj({ texto: TEXTO, vigentes: B("só vigentes") })],
  ["calendario", "Planejamento/calendário de licitações (PCA): contratações previstas, situação, previsão, valor estimado, OM apoiada.",
    obj({ texto: TEXTO, ano: T("ano"), status: T("parte do status") })],
  ["solicitacoes", "Solicitações de empenho do SILOMS: situação, fornecedor, valor, ND, indicador de lotação, NE gerada.",
    obj({ texto: TEXTO, status: T("parte do status"), ano: T("ano") })],
  ["indicadores", "Indicadores de lotação (crédito por conta corrente): dotação, utilização, saldo, natureza, PI, ação.", obj({ texto: TEXTO })],
  ["dou", "Publicações do Diário Oficial da União capturadas pelos alertas do app.", obj({ texto: TEXTO, desde: T("a partir de (AAAA-MM-DD)") })],
  ["tcu", "TCU: acórdãos, informativos de jurisprudência e empresas/pessoas sancionadas (inidôneas, inabilitadas).",
    obj({ texto: T("tema, palavras ou nome"), cnpj: T("CNPJ/CPF para ver sanção"), tipo: E("o que buscar", ["jurisprudencia", "sancoes", "todos"]) })],
  ["agu", "Pareceres referenciais da AGU (CGU/AGU), com assunto, validade e link.", obj({ texto: T("assunto") })],
  ["pncp", "Busca ao vivo no PNCP (todo o Brasil): editais, atas ou contratos de outros órgãos.",
    obj({ texto: T("objeto"), tipo: E("documento", ["edital", "ata", "contrato"]), uf: T("UF, ex.: AM"), abertos: B("só editais recebendo propostas") })],
  ["empenhos", "Notas de empenho em geral (Tesouro Gerencial, desde 2022) por favorecido, objeto, natureza, PI ou OM. As NEs de um contrato: execucao_contratos.",
    obj({ texto: T("NE, favorecido, CNPJ, objeto ou PI"), ano: T("ano"), om: T("sigla da OM"), natureza: T("natureza de despesa, ex.: 339039"),
      ordem: E("ordenação", ["valor", "data"]) })],
  ["credito", "Crédito orçamentário (Tesouro Gerencial): saldo disponível ou notas de crédito recebidas, por PI, ND, ação e OM.",
    obj({ texto: T("PI, ND, ação ou OM"), tipo: E("o quê", ["disponivel", "recebido"]) })],
].map(([nome, descricao, parametros]) => ({ type: "function", function: { name: nome, description: descricao, parameters: parametros } }));

// ── Execução no servidor ─────────────────────────────────────────────────────────────────────────────────────
export async function executarServidor(nome: string, a: Args, ctx: Contexto): Promise<Resultado> {
  const f = EXECUTORES[nome];
  if (!f) throw new Error(`ferramenta desconhecida: ${nome}`);
  const r = await f(a ?? {}, ctx);
  // nada com todas as palavras: tenta sem uma delas (a mais curta sai primeiro) e avisa a IA do que mudou
  const ps = palavras(s(a?.texto));
  if (!vazio(r.paraIA) || ps.length < 2) return r;
  const peso = (p: string) => (GENERICAS.has(semAcento(p)) ? 0 : p.length);
  const tentativas = [...ps].sort((x, y) => peso(x) - peso(y)).map((fora) => ps.filter((p) => p !== fora).join(" "));
  for (const texto of tentativas) {
    const r2 = await f({ ...a, texto }, ctx);
    if (!vazio(r2.paraIA)) return { ...r2, paraIA: { ...(r2.paraIA as object), obs_busca: `nada com todas as palavras de "${s(a.texto)}"; resultado da busca por "${texto}"` } };
  }
  return r;
}

/** A consulta não trouxe nada (total 0 e nenhuma lista com itens) */
function vazio(p: unknown): boolean {
  if (!p || typeof p !== "object") return true;
  const o = p as Record<string, unknown>;
  if (typeof o.total === "number") return o.total === 0;
  if (typeof o.total_no_filtro === "number") return o.total_no_filtro === 0;
  return !Object.values(o).some((v) => Array.isArray(v) && v.length > 0);
}

const EXECUTORES: Record<string, (a: Args, ctx: Contexto) => Promise<Resultado>> = {
  async contratos(a, { db, hoje }) {
    // empenhado/liquidado/saldo do cadastro (SILOMS) divergem da aba Execução: esses valores vêm de execucao_contratos
    const COLS = "numero_contrato,fornecedor,cnpj,descricao,status,data_inicio,data_final,vl_contratual,vl_atual,fiscal,pag_nup,ugr,categoria";
    const filtrar = (q: Db) => {
      q = comPalavras(q, ["numero_contrato", "fornecedor", "descricao", "cnpj", "pag_nup", "fiscal", "ugr", "categoria"], s(a.texto));
      const tipo = s(a.tipo).toUpperCase();
      if (tipo === "DESPESA") q = q.ilike("numero_contrato", "DESPESA*");
      if (tipo === "RECEITA") q = q.ilike("numero_contrato", "RECEITA*");
      if (tipo === "ADESAO") q = q.ilike("numero_contrato", "ADES_O*");
      if (tipo === "CREDENCIAMENTO") q = q.ilike("numero_contrato", "CRED*");
      if (a.situacao === "vigente") q = q.gte("data_final", hoje);
      if (a.situacao === "encerrado") q = q.lt("data_final", hoje);
      if (s(a.vence_ate)) q = q.gte("data_final", hoje).lte("data_final", s(a.vence_ate));
      return q;
    };
    let q = filtrar(db.from("contratos_scon").select(COLS, { count: "exact" }));
    q = a.ordem === "valor" ? q.order("vl_contratual", { ascending: false, nullsFirst: false })
      : q.order("data_final", { ascending: true, nullsFirst: false });
    const { data, count, error } = await q.limit(12);
    erro(error);
    const { data: todos } = await filtrar(db.from("contratos_scon").select("vl_contratual,vl_atual")).limit(1000);
    const linhas = (data ?? []) as Record<string, unknown>[];
    const t = (todos ?? []) as Record<string, unknown>[];
    return {
      paraIA: {
        tela: "Contratos › Contratos SCON", total: count ?? linhas.length, mostrados: linhas.length,
        somas_de_todos: { contratual: somar(t, "vl_contratual"), atual: somar(t, "vl_atual") },
        obs: "empenhos, pagamentos e saldo a empenhar: consulte execucao_contratos",
        contratos: linhas.map((c) => ({ numero: c.numero_contrato, empresa: c.fornecedor, cnpj: c.cnpj, objeto: corta(c.descricao, 140), status: c.status,
          inicio: c.data_inicio, fim: c.data_final, valor_contratual: r2(c.vl_contratual), valor_atual: r2(c.vl_atual),
          fiscal: c.fiscal || undefined, pag: c.pag_nup || undefined, ugr: c.ugr || undefined })),
      },
      fontes: [
        ...(s(a.texto) ? [{ rotulo: `Contratos SCON: "${s(a.texto)}"`, link: app("contratos", s(a.texto)) }] : []),
        ...linhas.slice(0, 3).map((c) => ({ rotulo: `Contrato ${c.numero_contrato}`, link: app("contratos", String(c.numero_contrato)) })),
      ],
    };
  },

  async reajustes(a, { db }) {
    const [{ data: ctr, error: e1 }, { data: cad, error: e2 }] = await Promise.all([
      db.from("contratos_scon").select("numero_contrato,fornecedor,descricao,data_final,data_orcamento").limit(2000),
      db.from("contratos_apostilamento").select("numero_contrato, data_base:dados->>data_base, indice:dados->indice->>nome, reajustes_aplicados, dedicacao_exclusiva, situacao_cadastro, pendencias, nao_aplicavel:carga->siloms->>reajuste_nao_aplicavel, vig_siloms:carga->siloms->>vigencia_fim").limit(2000),
    ]);
    erro(e1); erro(e2);
    const cads = new Map(((cad ?? []) as Record<string, unknown>[]).map((c) => [String(c.numero_contrato), c]));
    const contratos = ((ctr ?? []) as Record<string, unknown>[]).filter((c) => !s(a.texto) || contem(`${c.numero_contrato} ${c.fornecedor} ${c.descricao}`, s(a.texto)));
    const linhas = painel(contratos.map((c) => {
      const k = cads.get(String(c.numero_contrato));
      return { contrato: String(c.numero_contrato), data_base: (k?.data_base as string) || dataBaseDe(c.data_orcamento as string),
        reajustes_aplicados: Number(k?.reajustes_aplicados ?? 0), dedicacao_exclusiva: !!k?.dedicacao_exclusiva,
        nao_aplicavel: (k?.nao_aplicavel as string) ?? null, vigencia_fim: isoDaVigencia(k?.vig_siloms as string) ?? (c.data_final as string) };
    }));
    const conta = (st: StatusReajuste) => linhas.filter((l) => l.status === st).length;
    const pronto = (l: (typeof linhas)[number]) => l.status === "VERMELHO" && cads.get(l.contrato)?.situacao_cadastro === "COMPLETO";
    const FILTRO: Record<string, StatusReajuste[]> = { devido: ["VERMELHO", "AGUARDANDO_INDICE"], pronto_para_gerar: ["VERMELHO"], proximo: ["AMARELO"],
      sem_data: ["SEM_DATA_BASE"], fora_da_automacao: ["NAO_SE_APLICA"], encerrado: ["VIGENCIA_ENCERRADA"] };
    const quer = FILTRO[s(a.situacao)];
    const escolhidas = linhas.filter((l) => (!quer || quer.includes(l.status)) && (a.situacao !== "pronto_para_gerar" || pronto(l)));
    const ctrDe = new Map(contratos.map((c) => [String(c.numero_contrato), c]));
    return {
      paraIA: {
        tela: "Contratos › Reajustes",
        resumo_de_todos: { reajuste_devido_com_indice_divulgado: conta("VERMELHO"), devido_aguardando_indice: conta("AGUARDANDO_INDICE"),
          prontos_para_gerar_devido_e_cadastro_completo: linhas.filter(pronto).length, proximos_60_dias: conta("AMARELO"), em_dia: conta("VERDE"),
          sem_data_do_orcamento: conta("SEM_DATA_BASE"), fora_da_automacao: conta("NAO_SE_APLICA"), vigencia_encerrada: conta("VIGENCIA_ENCERRADA") },
        filtro: s(a.situacao) || "nenhum", total_no_filtro: escolhidas.length,
        contratos: escolhidas.slice(0, 10).map((l) => {
          const k = cads.get(l.contrato), c = ctrDe.get(l.contrato);
          const pend = (k?.pendencias as string[] | null) ?? [];
          return { contrato: l.contrato, empresa: c?.fornecedor, situacao: ROTULOS[l.status], motivo: l.motivo,
            data_do_orcamento: k?.data_base ?? dataBaseDe(c?.data_orcamento as string), indice: k?.indice || undefined,
            reajustes_devidos: l.reajustes_devidos.map((d) => `${d.n}º (${d.periodo}; efeitos ${d.efeitos}${d.indice_divulgado ? "" : "; índice ainda não divulgado"})`),
            proximo_aniversario: l.proximo_aniversario, cadastro: !k ? "não iniciado" : k.situacao_cadastro === "COMPLETO" ? "completo (pode gerar)" : k.situacao_cadastro === "NAO_SE_APLICA" ? "fora da automação" : `${pend.length} pendência(s): ${pend.slice(0, 2).join("; ")}` };
        }),
      },
      fontes: [{ rotulo: "Painel de reajustes", link: "/app?vista=reajustes" },
        ...escolhidas.slice(0, 3).map((l) => ({ rotulo: `Reajuste do ${l.contrato}`, link: `/app?vista=reajustes&contrato=${encodeURIComponent(l.contrato)}` }))],
    };
  },

  async licitacoes(a, { db }) {
    let q = db.from("processos_licitatorios").select("id_compra,numero_processo,ano,modalidade,objeto,situacao,situacao_manual,situacao_cnet,situacao_api,valor_estimado,valor_homologado,valor_homologado_manual,data_publicacao,abertura_proposta,srp,processo_nup,link_pncp,qtd_itens,qtd_itens_homologados", { count: "exact" });
    q = comPalavras(q, ["numero_processo", "objeto", "processo_nup", "modalidade"], s(a.texto));
    if (Number(a.ano)) q = q.eq("ano", Number(a.ano));
    // sinônimos que a IA usa para as situações do app (Em andamento, Homologado…)
    const sit = semAcento(s(a.situacao)).replace(/^(aberto|aberta|em curso|abertos|abertas|vigente|ativo|ativa)$/, "andamento").replace(/^(concluido|concluida|finalizado|finalizada)$/, "homologado").replace(/[*,()]/g, "").replace(/\s+/g, "_");
    if (sit) q = q.or(["situacao", "situacao_manual", "situacao_cnet", "situacao_api"].map((c) => `${c}.ilike.*${sit}*`).join(","));
    if (a.srp === true) q = q.eq("srp", true);
    const { data, count, error } = await q.order("data_publicacao", { ascending: false, nullsFirst: false }).limit(12);
    erro(error);
    const linhas = (data ?? []) as Record<string, unknown>[];
    const itens: Record<string, unknown[]> = {};
    if (a.com_itens && linhas.length && linhas.length <= 3) {
      const { data: its } = await db.from("processos_itens").select("id_compra,numero_item,descricao,unidade,quantidade,valor_unitario_estimado,valor_unitario_homologado,fornecedor_nome,situacao")
        .in("id_compra", linhas.map((l) => l.id_compra).filter(Boolean)).order("valor_total_estimado", { ascending: false, nullsFirst: false }).limit(30);
      for (const i of (its ?? []) as Record<string, unknown>[]) (itens[String(i.id_compra)] ??= []).push({ item: i.numero_item, descricao: corta(i.descricao, 90),
        un: i.unidade, qtd: i.quantidade, estimado: r2(i.valor_unitario_estimado), homologado: r2(i.valor_unitario_homologado), fornecedor: i.fornecedor_nome || undefined, situacao: i.situacao });
    }
    return {
      paraIA: { tela: "Licitações › Processos", total: count ?? linhas.length, mostrados: linhas.length,
        processos: linhas.map((p) => ({ numero: p.numero_processo, modalidade: p.modalidade, objeto: corta(p.objeto, 150),
          situacao: p.situacao_manual || p.situacao || p.situacao_cnet || p.situacao_api, publicacao: p.data_publicacao, abertura: p.abertura_proposta,
          estimado: r2(p.valor_estimado), homologado: r2(p.valor_homologado_manual ?? p.valor_homologado), srp: p.srp || undefined, pag: p.processo_nup || undefined,
          itens: p.qtd_itens, itens_homologados: p.qtd_itens_homologados, ...(itens[String(p.id_compra)] ? { lista_itens: itens[String(p.id_compra)] } : {}) })) },
      fontes: [
        ...(s(a.texto) ? [{ rotulo: `Processos: "${s(a.texto)}"`, link: app("processos", s(a.texto)) }] : []),
        ...linhas.slice(0, 3).map((p) => ({ rotulo: `Processo ${p.numero_processo}`, link: app("processos", String(p.numero_processo)) })),
        ...linhas.slice(0, 2).filter((p) => p.link_pncp).map((p) => ({ rotulo: `PNCP: ${p.numero_processo}`, link: String(p.link_pncp), externo: true })),
      ],
    };
  },

  async itens(a, { db }) {
    const onde = s(a.fonte) || "ambos";
    const saida: Record<string, unknown> = { tela: "Licitações › Processos e Atas de RP" };
    const fontes: Fonte[] = [];
    if (onde !== "atas") {
      const { data, error } = await comPalavras(db.from("processos_itens").select("id_compra,numero_item,descricao,unidade,quantidade,valor_unitario_estimado,valor_unitario_homologado,fornecedor_nome,situacao,data_resultado"),
        ["descricao", "fornecedor_nome"], s(a.texto)).order("data_resultado", { ascending: false, nullsFirst: false }).limit(10);
      erro(error);
      const its = (data ?? []) as Record<string, unknown>[];
      const ids = [...new Set(its.map((i) => i.id_compra).filter(Boolean))];
      const { data: procs } = ids.length ? await db.from("processos_licitatorios").select("id_compra,numero_processo").in("id_compra", ids) : { data: [] };
      const nProc = new Map(((procs ?? []) as Record<string, unknown>[]).map((p) => [p.id_compra, p.numero_processo]));
      saida.itens_licitados = its.map((i) => ({ processo: nProc.get(i.id_compra), item: i.numero_item, descricao: corta(i.descricao, 110), un: i.unidade, qtd: i.quantidade,
        estimado: r2(i.valor_unitario_estimado), homologado: r2(i.valor_unitario_homologado), fornecedor: i.fornecedor_nome || undefined, resultado: i.data_resultado, situacao: i.situacao }));
      fontes.push(...[...new Set(its.map((i) => nProc.get(i.id_compra)).filter(Boolean))].slice(0, 2).map((p) => ({ rotulo: `Processo ${p}`, link: app("processos", String(p)) })));
    }
    if (onde !== "licitacoes") {
      const { data, error } = await comPalavras(db.from("itens_ata_gap_mn").select("numero_ata,descricao,fornecedor_nome,valor_unitario,quantidade_registrada,aceita_adesao"),
        ["descricao", "fornecedor_nome"], s(a.texto)).limit(10);
      erro(error);
      const its = (data ?? []) as Record<string, unknown>[];
      saida.itens_em_ata = its.map((i) => ({ ata: i.numero_ata, descricao: corta(i.descricao, 110), fornecedor: i.fornecedor_nome, unitario: r2(i.valor_unitario), qtd_registrada: i.quantidade_registrada, adesao: i.aceita_adesao }));
      fontes.push(...[...new Set(its.map((i) => i.numero_ata).filter(Boolean))].slice(0, 2).map((x) => ({ rotulo: `Ata ${x}`, link: app("atas", String(x)) })));
    }
    return { paraIA: saida, fontes };
  },

  async atas(a, { db, hoje }) {
    let q = db.from("atas_registro_preco").select("numero_ata,objeto,fornecedor_nome,fornecedor_cnpj,valor_total,vigencia_inicio,vigencia_fim,situacao,permite_adesao,numero_processo,cancelado", { count: "exact" });
    q = comPalavras(q, ["numero_ata", "objeto", "fornecedor_nome", "fornecedor_cnpj", "numero_processo"], s(a.texto));
    if (a.vigentes) q = q.gte("vigencia_fim", hoje).eq("cancelado", false);
    const { data, count, error } = await q.order("vigencia_fim", { ascending: false, nullsFirst: false }).limit(12);
    erro(error);
    const linhas = (data ?? []) as Record<string, unknown>[];
    return {
      paraIA: { tela: "Licitações › Atas de RP", total: count ?? linhas.length, mostrados: linhas.length,
        atas: linhas.map((x) => ({ numero: x.numero_ata, objeto: corta(x.objeto, 140), fornecedor: x.fornecedor_nome, cnpj: x.fornecedor_cnpj, valor: r2(x.valor_total),
          inicio: x.vigencia_inicio, fim: x.vigencia_fim, situacao: x.cancelado ? "cancelada" : x.situacao, adesao: x.permite_adesao })) },
      fontes: [...(s(a.texto) ? [{ rotulo: `Atas de RP: "${s(a.texto)}"`, link: app("atas", s(a.texto)) }] : []),
        ...linhas.slice(0, 3).map((x) => ({ rotulo: `Ata ${x.numero_ata}`, link: app("atas", String(x.numero_ata)) }))],
    };
  },

  async calendario(a, { db }) {
    let q = db.from("calendario_licitacoes").select("ano,num_contratacao,num_dfd,descricao_objeto,modalidade,apoiada,valor_estimado,chegada_doc,previsao_finalizacao,status,situacao_detalhada,num_pag,homologado,data_homologacao", { count: "exact" });
    q = comPalavras(q, ["descricao_objeto", "num_contratacao", "num_pag", "apoiada", "modalidade", "num_dfd"], s(a.texto));
    if (Number(a.ano)) q = q.eq("ano", Number(a.ano));
    if (s(a.status)) q = q.ilike("status", `*${s(a.status).replace(/[*,()]/g, "")}*`);
    const { data, count, error } = await q.order("previsao_finalizacao", { ascending: true, nullsFirst: false }).limit(12);
    erro(error);
    const linhas = (data ?? []) as Record<string, unknown>[];
    return {
      paraIA: { tela: "Licitações › Planejamento", total: count ?? linhas.length, mostrados: linhas.length,
        contratacoes: linhas.map((c) => ({ ano: c.ano, numero: c.num_contratacao, objeto: corta(c.descricao_objeto, 130), modalidade: c.modalidade, om: c.apoiada,
          estimado: r2(c.valor_estimado), chegada_doc: c.chegada_doc, previsao: c.previsao_finalizacao, status: c.status, situacao: corta(c.situacao_detalhada, 100) || undefined,
          pag: c.num_pag || undefined, homologado: c.homologado || undefined, homologacao: c.data_homologacao || undefined })) },
      fontes: [{ rotulo: s(a.texto) ? `Planejamento: "${s(a.texto)}"` : "Planejamento de licitações", link: app("calendario", s(a.texto)) }],
    };
  },

  async solicitacoes(a, { db }) {
    const filtrar = (q: Db) => {
      q = comPalavras(q, ["solicitacao", "fornecedor", "historico", "pag", "indicador_lotacao", "empenho_siafi", "pregao", "subprocesso", "nd"], s(a.texto));
      if (s(a.status)) q = q.ilike("status", `*${s(a.status).replace(/[*,()]/g, "")}*`);
      if (Number(a.ano)) q = q.eq("ano", Number(a.ano));
      return q;
    };
    const { data, count, error } = await filtrar(db.from("siloms_solicitacoes_empenho").select("solicitacao,status,fornecedor,valor,dt_solicitacao,nd,indicador_lotacao,empenho_siafi,pag,perfil_atual,historico,ano", { count: "exact" }))
      .order("ano", { ascending: false }).order("solicitacao", { ascending: false }).limit(12);
    erro(error);
    const { data: todos } = await filtrar(db.from("siloms_solicitacoes_empenho").select("valor")).limit(2000);
    const linhas = (data ?? []) as Record<string, unknown>[];
    return {
      paraIA: { tela: "Exec. Orçamentária › Solicitações", total: count ?? linhas.length, mostrados: linhas.length, soma_valor_de_todos: somar((todos ?? []) as Record<string, unknown>[], "valor"),
        solicitacoes: linhas.map((x) => ({ numero: x.solicitacao, status: x.status, fornecedor: x.fornecedor, valor: r2(x.valor), data: x.dt_solicitacao, nd: x.nd,
          il: x.indicador_lotacao, ne_siafi: x.empenho_siafi || undefined, pag: x.pag || undefined, com_quem: x.perfil_atual || undefined, historico: corta(x.historico, 120) })) },
      fontes: [...(s(a.texto) ? [{ rotulo: `Solicitações: "${s(a.texto)}"`, link: app("solicitacoes", s(a.texto)) }] : []),
        ...linhas.slice(0, 3).map((x) => ({ rotulo: `Solicitação ${x.solicitacao}`, link: app("solicitacoes", String(x.solicitacao)) }))],
    };
  },

  async indicadores(a, { db }) {
    const filtrar = (q: Db) => comPalavras(q, ["conta_corrente", "descricao", "natureza", "plano_interno", "acao", "ptres", "ug_cred", "uge"], s(a.texto));
    const { data, count, error } = await filtrar(db.from("indicadores_lotacao").select("conta_corrente,descricao,ano,uge,natureza,plano_interno,acao,ptres,dotacao,utilizacao,saldo", { count: "exact" }))
      .order("saldo", { ascending: false, nullsFirst: false }).limit(12);
    erro(error);
    const { data: todos } = await filtrar(db.from("indicadores_lotacao").select("dotacao,utilizacao,saldo")).limit(3000);
    const t = (todos ?? []) as Record<string, unknown>[];
    const linhas = (data ?? []) as Record<string, unknown>[];
    return {
      paraIA: { tela: "Exec. Orçamentária › Indicadores de Lotação", total: count ?? linhas.length, mostrados: linhas.length,
        somas_de_todos: { dotacao: somar(t, "dotacao"), utilizacao: somar(t, "utilizacao"), saldo: somar(t, "saldo") },
        indicadores: linhas.map((x) => ({ il: x.conta_corrente, descricao: corta(x.descricao, 90), ano: x.ano, ug: x.uge, natureza: x.natureza, pi: x.plano_interno,
          acao: x.acao, ptres: x.ptres, dotacao: r2(x.dotacao), utilizacao: r2(x.utilizacao), saldo: r2(x.saldo) })) },
      fontes: [{ rotulo: s(a.texto) ? `Indicadores de lotação: "${s(a.texto)}"` : "Indicadores de lotação", link: app("indicadores", s(a.texto)) }],
    };
  },

  async dou(a, { db }) {
    let q = comPalavras(db.from("dou_publicacoes").select("titulo,tipo,secao,data,orgao,resumo,url", { count: "exact" }), ["titulo", "resumo", "orgao"], s(a.texto));
    if (s(a.desde)) q = q.gte("data", s(a.desde));
    const { data, count, error } = await q.order("data", { ascending: false }).limit(10);
    erro(error);
    const linhas = (data ?? []) as Record<string, unknown>[];
    return {
      paraIA: { tela: "Licitações › DOU: alertas do Diário Oficial", total: count ?? linhas.length,
        publicacoes: linhas.map((x) => ({ titulo: x.titulo, tipo: x.tipo, secao: x.secao, data: x.data, orgao: x.orgao, resumo: corta(x.resumo, 220) })) },
      fontes: [{ rotulo: "Alertas do DOU", link: app("dou", s(a.texto)) }, ...linhas.slice(0, 2).filter((x) => x.url).map((x) => ({ rotulo: `DOU: ${corta(x.titulo, 50)}`, link: String(x.url), externo: true }))],
    };
  },

  async tcu(a, { db }) {
    const tipo = s(a.tipo) || (s(a.cnpj) ? "sancoes" : "jurisprudencia");
    const out: Record<string, unknown> = { tela: "Licitações › TCU: jurisprudência e sanções" };
    const fontes: Fonte[] = [{ rotulo: "TCU no app", link: app("tcu", s(a.texto)) }];
    if (tipo !== "sancoes" && s(a.texto)) {
      const [{ data: ac }, { data: inf }] = await Promise.all([
        comPalavras(db.from("tcu_acordaos").select("numero,ano,colegiado,data_sessao,relator,titulo,sumario,url_acordao"), ["titulo", "sumario"], s(a.texto)).order("data_sessao", { ascending: false }).limit(6),
        db.from("tcu_informativos").select("numero,ano,colegiado,acordao,enunciado").textSearch("busca", s(a.texto), { type: "websearch", config: "portuguese" }).order("ano", { ascending: false }).limit(6),
      ]);
      out.acordaos = ((ac ?? []) as Record<string, unknown>[]).map((x) => ({ acordao: `${x.numero}/${x.ano}`, colegiado: x.colegiado, sessao: x.data_sessao, relator: x.relator, titulo: corta(x.titulo, 120), sumario: corta(x.sumario, 260) }));
      out.informativos = ((inf ?? []) as Record<string, unknown>[]).map((x) => ({ informativo: `${x.numero}/${x.ano}`, colegiado: x.colegiado, acordao: x.acordao, enunciado: corta(x.enunciado, 300) }));
      fontes.push(...((ac ?? []) as Record<string, unknown>[]).slice(0, 2).filter((x) => x.url_acordao).map((x) => ({ rotulo: `Acórdão ${x.numero}/${x.ano}`, link: String(x.url_acordao), externo: true })));
    }
    if (tipo !== "jurisprudencia" && (s(a.cnpj) || s(a.texto))) {
      const doc = s(a.cnpj).replace(/\D/g, "");
      let q = db.from("tcu_sancoes").select("nome,cnpj,lista,acordao,data_final,ativo,link_deliberacao");
      q = doc ? q.ilike("cnpj", `*${doc.slice(0, 8)}*`) : comPalavras(q, ["nome", "cnpj"], s(a.texto));
      const { data } = await q.order("ativo", { ascending: false }).limit(10);
      out.sancoes = ((data ?? []) as Record<string, unknown>[]).map((x) => ({ nome: x.nome, cnpj: x.cnpj, lista: x.lista, acordao: x.acordao, ate: x.data_final, vigente: x.ativo }));
      if (!(data ?? []).length) out.sancoes_obs = "nenhuma sanção do TCU encontrada para esse nome/CNPJ na base do app";
    }
    return { paraIA: out, fontes };
  },

  async agu(a, { db }) {
    const primeira = s(a.texto)
      ? await db.from("agu_referenciais").select("orgao,grupo,numero,ano,parecer,assunto,data,validade,url,licitacoes").textSearch("busca", s(a.texto), { type: "websearch", config: "portuguese" }).order("data", { ascending: false }).limit(8)
      : await db.from("agu_referenciais").select("orgao,grupo,numero,ano,parecer,assunto,data,validade,url,licitacoes").order("data", { ascending: false }).limit(8);
    erro(primeira.error);
    let data = primeira.data;
    if (!(data ?? []).length && s(a.texto)) ({ data } = await comPalavras(db.from("agu_referenciais").select("orgao,grupo,numero,ano,parecer,assunto,data,validade,url,licitacoes"), ["assunto", "parecer", "observacao"], s(a.texto)).limit(8));
    const linhas = (data ?? []) as Record<string, unknown>[];
    return {
      paraIA: { tela: "Licitações › AGU: pareceres referenciais", total: linhas.length,
        pareceres: linhas.map((x) => ({ parecer: x.parecer || `${x.numero}/${x.ano}`, orgao: x.orgao, grupo: x.grupo, assunto: corta(x.assunto, 220), data: x.data, validade: x.validade || "sem validade informada", licitacoes: x.licitacoes || undefined })) },
      fontes: [{ rotulo: "Pareceres da AGU no app", link: app("agu", s(a.texto)) },
        ...linhas.slice(0, 2).filter((x) => x.url).map((x) => ({ rotulo: `Parecer ${x.parecer || `${x.numero}/${x.ano}`}`, link: String(x.url), externo: true }))],
    };
  },

  async pncp(a, { buscar = fetch }) {
    const tipo = ["ata", "contrato"].includes(s(a.tipo)) ? s(a.tipo) : "edital";
    const p = new URLSearchParams({ tipos_documento: tipo, ordenacao: "-data", pagina: "1", tam_pagina: "10" });
    if (tipo === "edital") p.set("status", a.abertos ? "recebendo_proposta" : "todos");
    if (s(a.texto)) p.set("q", s(a.texto).slice(0, 120));
    if (/^[A-Za-z]{2}$/.test(s(a.uf))) p.set("ufs", s(a.uf).toUpperCase());
    const url = `https://pncp.gov.br/api/search/?${p}`;
    let j: { items?: Record<string, unknown>[]; total?: number } = {};
    for (let t = 1; t <= 3; t++) {
      const r = await buscar(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; gapmn.app assistente)" }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (r?.ok) { j = await r.json(); break; }
      if (t === 3) throw new Error(`o PNCP não respondeu${r ? ` (HTTP ${r.status})` : ""}`);
    }
    const itens = j.items ?? [];
    const link = (i: Record<string, unknown>) => `https://pncp.gov.br/app${String(i.item_url ?? "").replace(/^\/compras/, "/editais")}`;
    return {
      paraIA: { tela: "PNCP (fora do app); no app: Licitações › Mapa das compras", total: j.total ?? itens.length,
        resultados: itens.map((i) => ({ titulo: i.title, objeto: corta(i.description, 160), orgao: i.orgao_nome, unidade: i.unidade_nome, municipio: i.municipio_nome, uf: i.uf,
          modalidade: i.modalidade_licitacao_nome || undefined, situacao: i.situacao_nome || undefined, publicacao: String(i.data_publicacao_pncp ?? "").slice(0, 10),
          vigencia: i.data_fim_vigencia ? `${String(i.data_inicio_vigencia ?? "").slice(0, 10)} a ${String(i.data_fim_vigencia).slice(0, 10)}` : undefined,
          valor: r2(i.valor_global), fornecedor: i.fornecedor_nome || undefined })) },
      fontes: [{ rotulo: "Mapa das compras (PNCP)", link: "/app?vista=mapa-compras" }, ...itens.slice(0, 3).map((i) => ({ rotulo: `PNCP: ${corta(i.title, 50)}`, link: link(i), externo: true }))],
    };
  },
};
