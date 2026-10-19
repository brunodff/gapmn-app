// Regras de negócio do Painel de Governança (Parte D da especificação).
// Funções puras: entra LinhaBD[], sai o objeto do painel. Sem React e sem fetch.
// Cada regra tem o "porquê" ao lado, porque todas nasceram de um erro real.

import type {
  Competencia, ContagemStatus, Direcao, DivisaoPainel, Filtros, GrupoContagem, IndicadorPainel,
  ItemContagem, LinhaBD, Painel, PayloadBD, PontoHistorico, ResumoPainel, Status, Tendencia, Variacao, Variavel,
} from "./tipos.ts";

// ── Parâmetros (um lugar só) ─────────────────────────────────────────────────

export const CORTE_ADEQUADO = 1.0;
export const CORTE_ATENCAO = 0.7;
export const N_PIORES = 5;
export const Z_WILSON = 1.96;
export const UNIDADE_CONTAGEM = "Quantidade";
/** Variação mensal (16 e 22): o desejável é a redução; o sentido vem de VAR1 × VAR2. */
export const IDS_VARIACAO = new Set(["16", "22"]);
/** Eventos para o Efetivo: gravado em ASESO, pertence à Comunicação Social, fora do ranking. */
export const ID_COMSOC = "35";
export const ORDEM_DIVISOES = ["DRH", "DIE", "DA", "AJUR", "ASESO", "DOC", "ACI", "COMSOC"];
export const ORDEM_GRUPOS = ["Pendências do e-Pessoal", "Plano de Contratações Anual", "Ressarcimento ao Erário"];

export const STATUS: Status[] = [
  "Aguardando informação", "Sem dados no mês de referência", "Crítico", "Atenção", "Adequado", "Sem meta",
];

const TOLERANCIA = 1e-9;

// ── Utilidades ───────────────────────────────────────────────────────────────

/** Ordena IDs por partes: 17 < 17.1 < 17.2 < 18. Nunca converte o ID para número. */
export function compararId(a: string, b: string): number {
  const pa = a.split("."), pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  return 0;
}

function indiceDivisao(sigla: string): number {
  const i = ORDEM_DIVISOES.indexOf(sigla);
  return i < 0 ? ORDEM_DIVISOES.length : i;
}

export function nomeCategoria(categoria: string): string {
  return categoria.replace(/^\s*\d+\.\s*/, "");
}

export function divisaoExibida(id: string, divisao: string): string {
  return id === ID_COMSOC ? "COMSOC" : divisao;
}

export function ehContagem(l: Pick<LinhaBD, "UNIDADE">): boolean {
  return l.UNIDADE === UNIDADE_CONTAGEM;
}

function ultimo<T>(lista: T[]): T | undefined {
  return lista[lista.length - 1];
}

function contagemVazia(): ContagemStatus {
  return Object.fromEntries(STATUS.map((s) => [s, 0])) as ContagemStatus;
}

// ── Normalização do payload ──────────────────────────────────────────────────

const CAMPOS_NUMERICOS = ["META_NUM", "ANO", "MES_NUM", "VALOR", "VAR1_VALOR", "VAR2_VALOR", "VAR3_VALOR"] as const;
const CAMPOS_TEXTO = [
  "DIVISAO", "CATEGORIA", "INDICADOR", "UNIDADE", "FORMULA", "META_TXT", "DIRECAO", "TIPO", "MES", "DATA",
  "VAR1_NOME", "VAR2_NOME", "VAR3_NOME",
] as const;

function paraNumero(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    // aceita '52,21', '52.21' e '1.058,5'
    const norm = /,\d+$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s;
    const n = Number(norm);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Converte o JSON do Apps Script em LinhaBD[]. O ID vira SEMPRE texto (17.1 lido
 * como número vira data no parse ingênuo). '' vira null; null nunca vira 0.
 */
export function normalizarLinhas(bruto: unknown[]): { linhas: LinhaBD[]; avisos: string[] } {
  const linhas: LinhaBD[] = [];
  const avisos: string[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const idBruto = r.ID;
    if (idBruto === null || idBruto === undefined || idBruto === "") continue;
    const id = String(idBruto).trim().replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(id)) avisos.push(`ID fora do padrão: ${JSON.stringify(idBruto)}`);
    const o: Record<string, unknown> = { ID: id };
    for (const c of CAMPOS_TEXTO) {
      const v = r[c];
      o[c] = v === null || v === undefined || v === "" ? null : String(v);
    }
    for (const c of CAMPOS_NUMERICOS) {
      const n = paraNumero(r[c]);
      if (n === undefined) {
        avisos.push(`ID ${id} ${String(r.MES)}/${String(r.ANO)}: ${c} não numérico (${JSON.stringify(r[c])})`);
        o[c] = null;
      } else {
        o[c] = n;
      }
    }
    linhas.push(o as LinhaBD);
  }
  return { linhas, avisos };
}

/** Valida a resposta do endpoint e devolve o payload com as linhas normalizadas. */
export function prepararPayload(json: unknown): { payload: PayloadBD; avisos: string[] } {
  const j = json as Partial<PayloadBD> & { erro?: string };
  if (!j || j.ok !== true || !Array.isArray(j.bd)) {
    throw new Error(`Resposta inválida da BD${j && j.erro ? ` (${j.erro})` : ""}`);
  }
  const { linhas, avisos } = normalizarLinhas(j.bd);
  return {
    payload: {
      ok: true,
      gerado_em: String(j.gerado_em ?? ""),
      timezone: j.timezone,
      planilha: j.planilha,
      bd: linhas,
      bd_integridade: Array.isArray(j.bd_integridade) ? j.bd_integridade : [],
    },
    avisos,
  };
}

// ── D.1 Competências ─────────────────────────────────────────────────────────

function rotulo(l: Pick<LinhaBD, "MES" | "ANO">): string {
  return `${l.MES}/${String(l.ANO).slice(2)}`;
}

/** Todas as competências da BD, ordenadas por DATA (nunca pelo rótulo). */
export function montarCompetencias(bd: LinhaBD[]): Competencia[] {
  const porData = new Map<string, Competencia>();
  for (const l of bd) {
    if (!l.DATA || !l.MES || !l.ANO || porData.has(l.DATA)) continue;
    porData.set(l.DATA, {
      label: rotulo(l),
      data: l.DATA,
      ano: l.ANO,
      mesNum: l.MES_NUM,
      mes: l.MES,
      semestral: l.MES.includes("-"),
    });
  }
  return [...porData.values()].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

/**
 * Competências que têm dado: VALOR preenchido e UNIDADE ≠ 'Quantidade'.
 * Sem o filtro de Quantidade, um lançamento adiantado dos EXTRAS (e-Pessoal em SET/26)
 * moveria a referência do painel inteiro e 39 indicadores apareceriam "sem dados".
 */
export function competenciasComDados(bd: LinhaBD[]): Competencia[] {
  const datas = new Set(bd.filter((l) => l.VALOR !== null && !ehContagem(l)).map((l) => l.DATA));
  return montarCompetencias(bd).filter((c) => datas.has(c.data));
}

/** Referência global: calculada sobre a BD inteira, antes de qualquer filtro de tela. */
export function competenciaReferencia(bd: LinhaBD[]): Competencia | null {
  return ultimo(competenciasComDados(bd)) ?? null;
}

export function competenciaAnterior(bd: LinhaBD[], data: string): Competencia | null {
  return ultimo(competenciasComDados(bd).filter((c) => c.data < data)) ?? null;
}

// ── D.4 / D.5 Atingimento ────────────────────────────────────────────────────

export function variacaoDoIndicador(l: LinhaBD): Variacao | null {
  if (!IDS_VARIACAO.has(l.ID)) return null;
  const atual = l.VAR1_VALOR, anterior = l.VAR2_VALOR;
  if (atual === null || anterior === null) return null;
  return {
    de: anterior,
    para: atual,
    percentual: anterior === 0 ? null : ((atual - anterior) / anterior) * 100,
    houveReducao: atual < anterior,
  };
}

/**
 * Atingimento sem teto (43 eventos para meta 1 = 4300%).
 * null quando não há meta, não há valor, ou (16/22) não dá para saber o sentido.
 */
export function calcularAtingimento(l: LinhaBD): number | null {
  if (l.META_NUM === null || l.DIRECAO === "Monitoramento" || l.VALOR === null) return null;
  const meta = l.META_NUM, valor = l.VALOR;

  if (IDS_VARIACAO.has(l.ID)) {
    // VALOR vem em módulo; o sentido sai de VAR1 (atual) × VAR2 (anterior).
    const v = variacaoDoIndicador(l);
    if (!v) return null;
    if (!v.houveReducao) return 0;
    return meta > 0 ? Math.abs(valor) / meta : 1;
  }

  if (l.DIRECAO === "Menor é melhor") {
    // valor 0 é o resultado ótimo: adequado, nunca divisão por zero.
    return valor === 0 ? 1 : meta / valor;
  }
  // Maior é melhor
  if (meta === 0) return 1;
  return valor / meta;
}

// ── D.6 Status ───────────────────────────────────────────────────────────────

export function calcularStatus(l: LinhaBD | undefined, atingimento: number | null): Status {
  if (!l) return "Aguardando informação";
  if (l.META_NUM === null || l.DIRECAO === "Monitoramento") return "Sem meta";
  if (l.VALOR === null) {
    // Denominador zero: não houve o evento que serve de base. Não é falha de ninguém.
    if (l.VAR2_VALOR === 0) return "Sem dados no mês de referência";
    // Nada informado, ou variável informada pela metade: o resultado ainda não existe.
    return "Aguardando informação";
  }
  if (atingimento === null) return "Aguardando informação";
  if (atingimento >= CORTE_ADEQUADO - TOLERANCIA) return "Adequado";
  if (atingimento >= CORTE_ATENCAO - TOLERANCIA) return "Atenção";
  return "Crítico";
}

// ── D.8 Pontos e Wilson ──────────────────────────────────────────────────────

export function pontosDoStatus(s: Status): number | null {
  if (s === "Adequado") return 1;
  if (s === "Atenção") return 0.5;
  if (s === "Crítico") return 0;
  return null;
}

/**
 * Limite inferior de Wilson (95%). Média simples foi rejeitada: 1 indicador adequado
 * (100%) não pode ficar à frente de 9 adequados em 10.
 */
export function scoreWilson(pontos: number, n: number, z = Z_WILSON): number | null {
  if (n <= 0) return null;
  const p = pontos / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

// ── D.10 Tendência 3M ────────────────────────────────────────────────────────

/**
 * Últimos 3 pontos com dado até a competência exibida. Com menos de 3, '—' (null):
 * nunca um número calculado em cima de 1 ou 2 pontos. JAN-JUN/26 conta como um ponto.
 * IDs 16 e 22: '—', porque o VALOR é o módulo da variação e a média dele não diz nada.
 */
export function tendencia3M(linhasDoIndicador: LinhaBD[], ateData: string, comps: Competencia[]): Tendencia | null {
  if (linhasDoIndicador.some((l) => IDS_VARIACAO.has(l.ID))) return null;
  const pts = linhasDoIndicador
    .filter((l) => l.TIPO === "Realizado" && l.VALOR !== null && l.DATA <= ateData)
    .sort((a, b) => (a.DATA < b.DATA ? -1 : 1))
    .slice(-3);
  if (pts.length < 3) return null;
  const media = ((pts[2].VALOR as number) - (pts[0].VALOR as number)) / 2;
  const l0 = pts[0];
  let sentido: Tendencia["sentido"] = null;
  if (l0.DIRECAO !== "Monitoramento") {
    if (Math.abs(media) < TOLERANCIA) sentido = "estável";
    else if ((media > 0) === (l0.DIRECAO === "Maior é melhor")) sentido = "melhora";
    else sentido = "piora";
  }
  const lbl = (d: string) => comps.find((c) => c.data === d)?.label ?? d;
  return { media, pontos: pts.map((l) => ({ label: lbl(l.DATA), valor: l.VALOR as number })), sentido };
}

// ── D.7 Ordenação ────────────────────────────────────────────────────────────

/** Aguardando → sem dados → pior atingimento → melhor. Sem meta: null (vai para monitoramento). */
export function chaveOrdem(ind: Pick<IndicadorPainel, "status" | "atingimento">): number | null {
  if (ind.status === "Aguardando informação") return 1;
  if (ind.status === "Sem dados no mês de referência") return 2;
  if (ind.atingimento !== null) return 10 + ind.atingimento;
  return null;
}

function desempate(a: IndicadorPainel, b: IndicadorPainel): number {
  return indiceDivisao(a.divisaoExibida) - indiceDivisao(b.divisaoExibida) || compararId(a.id, b.id);
}

export function ordenarIndicadores(inds: IndicadorPainel[]): IndicadorPainel[] {
  return [...inds].sort((a, b) => {
    const ka = chaveOrdem(a) ?? Number.POSITIVE_INFINITY;
    const kb = chaveOrdem(b) ?? Number.POSITIVE_INFINITY;
    return ka - kb || desempate(a, b);
  });
}

// ── Montagem dos indicadores ─────────────────────────────────────────────────

function variaveisDe(l: LinhaBD): Variavel[] {
  const out: Variavel[] = [];
  const pares: [string | null, number | null][] = [
    [l.VAR1_NOME, l.VAR1_VALOR], [l.VAR2_NOME, l.VAR2_VALOR], [l.VAR3_NOME, l.VAR3_VALOR],
  ];
  for (const [nome, valor] of pares) if (nome && valor !== null) out.push({ nome, valor });
  return out;
}

function montarIndicador(
  linhas: LinhaBD[], ref: Competencia, anterior: Competencia | null, comps: Competencia[],
): IndicadorPainel | null {
  const l = linhas.find((x) => x.DATA === ref.data && x.TIPO === "Realizado");
  if (!l) return null; // o indicador não é esperado nesta competência
  const ant = anterior ? linhas.find((x) => x.DATA === anterior.data && x.TIPO === "Realizado") : undefined;
  const atingimento = calcularAtingimento(l);
  const status = calcularStatus(l, atingimento);
  const foraDaNota = l.ID === ID_COMSOC || ehContagem(l) || status === "Sem meta";
  return {
    id: l.ID,
    divisao: l.DIVISAO,
    divisaoExibida: divisaoExibida(l.ID, l.DIVISAO),
    categoria: l.CATEGORIA,
    categoriaExibida: nomeCategoria(l.CATEGORIA),
    indicador: l.INDICADOR,
    unidade: l.UNIDADE,
    formula: l.FORMULA,
    metaTxt: l.META_TXT,
    metaNum: l.META_NUM,
    direcao: l.DIRECAO as Direcao,
    // D.2: valor ancorado na competência. Nunca somar competências.
    valor: l.VALOR,
    valorAnterior: ant?.VALOR ?? null,
    variaveis: variaveisDe(l),
    atingimento,
    status,
    pontos: foraDaNota ? null : pontosDoStatus(status),
    foraDaNota,
    variacao: variacaoDoIndicador(l),
    tendencia: tendencia3M(linhas, ref.data, comps),
    preenchido: status === "Sem meta" ? l.VALOR !== null : status !== "Aguardando informação",
    mesAnterior: null,
    comparacaoMesAnterior: null,
    historico: [],
  };
}

/**
 * Melhorou ou piorou em relação ao mês anterior, pela direção do indicador.
 * IDs 16 e 22 comparam pelo atingimento (o VALOR deles é módulo e não diz o sentido).
 */
export function compararComAnterior(
  atual: Pick<IndicadorPainel, "id" | "valor" | "atingimento" | "direcao">,
  anterior: Pick<PontoHistorico, "valor" | "atingimento"> | null,
): IndicadorPainel["comparacaoMesAnterior"] {
  if (!anterior) return null;
  if (IDS_VARIACAO.has(atual.id)) {
    if (atual.atingimento === null || anterior.atingimento === null) return null;
    const d = atual.atingimento - anterior.atingimento;
    return Math.abs(d) < TOLERANCIA ? "igual" : d > 0 ? "melhora" : "piora";
  }
  if (atual.valor === null || anterior.valor === null || atual.direcao === "Monitoramento") return null;
  const d = atual.valor - anterior.valor;
  if (Math.abs(d) < TOLERANCIA) return "igual";
  return (d > 0) === (atual.direcao === "Maior é melhor") ? "melhora" : "piora";
}

// ── D.8 / D.9 Divisões ───────────────────────────────────────────────────────

export function ranquearDivisoes(inds: IndicadorPainel[]): DivisaoPainel[] {
  const siglas = [...new Set(inds.map((i) => i.divisaoExibida))]
    .sort((a, b) => indiceDivisao(a) - indiceDivisao(b) || a.localeCompare(b));
  const divs: DivisaoPainel[] = siglas.map((sigla) => {
    const daDiv = inds.filter((i) => i.divisaoExibida === sigla);
    const avaliados = daDiv.filter((i) => i.pontos !== null);
    const pontos = avaliados.reduce((s, i) => s + (i.pontos as number), 0);
    const contagem = contagemVazia();
    for (const i of daDiv) contagem[i.status]++;
    const foraDoRanking = sigla === "COMSOC";
    const n = avaliados.length;
    return {
      sigla, n, pontos,
      score: foraDoRanking ? null : scoreWilson(pontos, n),
      posicao: null, foraDoRanking, contagem, total: daDiv.length,
    };
  });
  divs
    .filter((d) => d.score !== null)
    .sort((a, b) => (b.score as number) - (a.score as number) || b.n - a.n || indiceDivisao(a.sigla) - indiceDivisao(b.sigla))
    .forEach((d, i) => { d.posicao = i + 1; });
  return divs;
}

// ── D.3 Grupos de contagem ───────────────────────────────────────────────────

export function gruposDeContagem(bd: LinhaBD[], data: string): GrupoContagem[] {
  const daComp = bd.filter((l) => ehContagem(l) && l.DATA === data);
  const cats = [...new Set(daComp.map((l) => l.CATEGORIA))].sort((a, b) => {
    const ia = ORDEM_GRUPOS.indexOf(a), ib = ORDEM_GRUPOS.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return cats.map((categoria) => {
    const linhas = daComp.filter((l) => l.CATEGORIA === categoria);
    const emparelhado = linhas.some((l) => l.TIPO === "Planejado");
    const ids = [...new Set(linhas.map((l) => l.ID))].sort(compararId);
    const itens: ItemContagem[] = ids.map((id) => {
      const real = linhas.find((l) => l.ID === id && l.TIPO === "Realizado");
      const plan = linhas.find((l) => l.ID === id && l.TIPO === "Planejado");
      const realizado = real?.VALOR ?? null;
      const planejado = plan?.VALOR ?? null;
      return {
        id,
        indicador: (real ?? plan)!.INDICADOR,
        realizado,
        planejado,
        execucao: realizado !== null && planejado !== null && planejado > 0 ? realizado / planejado : null,
      };
    });
    // Soma de itens da MESMA competência (permitido); null quando nada foi lançado.
    const soma = (vs: (number | null)[]) => (vs.some((v) => v !== null) ? vs.reduce<number>((s, v) => s + (v ?? 0), 0) : null);
    return {
      categoria,
      divisao: linhas[0].DIVISAO,
      emparelhado,
      itens,
      total: soma(itens.map((i) => i.realizado)),
      totalPlanejado: emparelhado ? soma(itens.map((i) => i.planejado)) : null,
    };
  });
}

// ── D.11 Resumo ──────────────────────────────────────────────────────────────

export function resumir(inds: IndicadorPainel[]): ResumoPainel {
  const naNota = inds.filter((i) => i.pontos !== null);
  const n = naNota.length;
  const soma = naNota.reduce((s, i) => s + (i.pontos as number), 0);
  const esperados = inds.length;
  const preenchidos = inds.filter((i) => i.preenchido).length;
  return {
    saudeGeral: n ? soma / n : null,
    n,
    adequados: naNota.filter((i) => i.status === "Adequado").length,
    atencao: naNota.filter((i) => i.status === "Atenção").length,
    criticos: naNota.filter((i) => i.status === "Crítico").length,
    aguardando: inds.filter((i) => i.status === "Aguardando informação").length,
    semDados: inds.filter((i) => i.status === "Sem dados no mês de referência").length,
    completude: {
      preenchidos,
      comResultado: inds.filter((i) => i.valor !== null).length,
      esperados,
      percentual: esperados ? preenchidos / esperados : null,
    },
  };
}

// ── Painel completo ──────────────────────────────────────────────────────────

export type OpcoesPainel = {
  /** DATA ou rótulo da competência escolhida no seletor. */
  competencia?: string | null;
  /** Filtro de divisão: vale para o painel inteiro (cards, listas, contagem). */
  divisoes?: string[];
};

function agruparPorId(bd: LinhaBD[]): Map<string, LinhaBD[]> {
  const porId = new Map<string, LinhaBD[]>();
  for (const l of bd) {
    if (ehContagem(l)) continue;
    const lista = porId.get(l.ID);
    if (lista) lista.push(l); else porId.set(l.ID, [l]);
  }
  return porId;
}

function indicadoresEm(porId: Map<string, LinhaBD[]>, ref: Competencia, anterior: Competencia | null, comps: Competencia[]): IndicadorPainel[] {
  const out: IndicadorPainel[] = [];
  for (const linhas of porId.values()) {
    const ind = montarIndicador(linhas, ref, anterior, comps);
    if (ind) out.push(ind);
  }
  return out;
}

/**
 * Monta o painel. A competência de referência é sempre global (D.1): o filtro de
 * divisão muda cards, listas e contagem, mas nunca a competência nem a posição no
 * ranking, que é calculada sobre todas as divisões.
 */
export function calcularPainel(bd: LinhaBD[], opcoes: OpcoesPainel = {}): Painel {
  const competencias = montarCompetencias(bd);
  const comDados = competenciasComDados(bd);
  const referenciaPadrao = ultimo(comDados) ?? null;
  const escolhida = opcoes.competencia
    ? comDados.find((c) => c.data === opcoes.competencia || c.label === opcoes.competencia)
    : undefined;
  const referencia = escolhida ?? referenciaPadrao;
  const filtro = opcoes.divisoes ?? [];
  const naDivisao = (sigla: string) => !filtro.length || filtro.includes(sigla);

  const vazio: Painel = {
    competencias, competenciasComDados: comDados, referenciaPadrao, referencia, anterior: null,
    filtroDivisoes: filtro, siglasDivisoes: [], divisoesRanqueadas: 0, totalIndicadores: 0,
    indicadores: [], monitoramento: [], divisoes: [], podio: [], piores: [], grupos: [], resumo: resumir([]),
    serieSaude: [], saudeAnterior: null, tendenciaSaude: null,
  };
  if (!referencia) return vazio;

  const anterior = ultimo(comDados.filter((c) => c.data < referencia.data)) ?? null;
  const porId = agruparPorId(bd);
  const todos = indicadoresEm(porId, referencia, anterior, competencias);
  const sel = todos.filter((i) => naDivisao(i.divisaoExibida));

  const comMeta = ordenarIndicadores(sel.filter((i) => i.status !== "Sem meta"));
  const monitoramento = sel.filter((i) => i.status === "Sem meta").sort(desempate);

  // Ranking sempre sobre todas as divisões; o filtro só escolhe quais aparecem.
  const ranking = ranquearDivisoes(todos);
  const podio = ranking
    .filter((d) => d.posicao !== null)
    .sort((a, b) => (a.posicao as number) - (b.posicao as number))
    .slice(0, 3);

  // Atenção prioritária: piores com meta, só entre Crítico e Atenção.
  const piores = comMeta
    .filter((i) => i.status === "Crítico" || i.status === "Atenção")
    .sort((a, b) => (a.atingimento as number) - (b.atingimento as number) || desempate(a, b))
    .slice(0, N_PIORES);

  // Saúde nas competências com dado até a exibida (mesmo filtro), para "vs mês anterior" e 3M.
  // Cada competência com dado calculada uma vez: serve ao histórico e à série de saúde.
  const porCompetencia = new Map<string, IndicadorPainel[]>();
  comDados.forEach((c, k) => {
    porCompetencia.set(c.data, c.data === referencia.data ? todos : indicadoresEm(porId, c, comDados[k - 1] ?? null, competencias));
  });
  const indice = new Map([...porCompetencia].map(([data, inds]) => [data, new Map(inds.map((i) => [i.id, i]))]));
  for (const ind of todos) {
    ind.historico = comDados.flatMap((c) => {
      const i = indice.get(c.data)?.get(ind.id);
      return i ? [{ label: c.label, data: c.data, valor: i.valor, atingimento: i.atingimento, status: i.status, variaveis: i.variaveis }] : [];
    });
    ind.mesAnterior = anterior ? ind.historico.find((h) => h.data === anterior.data) ?? null : null;
    ind.comparacaoMesAnterior = compararComAnterior(ind, ind.mesAnterior);
  }

  const serieSaude = comDados
    .filter((c) => c.data <= referencia.data)
    .map((c) => {
      const inds = (porCompetencia.get(c.data) ?? []).filter((i) => naDivisao(i.divisaoExibida));
      return { label: c.label, data: c.data, saude: resumir(inds).saudeGeral };
    });
  const comSaude = serieSaude.filter((s) => s.saude !== null);
  const saudeAnterior = anterior ? serieSaude.find((s) => s.data === anterior.data)?.saude ?? null : null;
  const ult3 = comSaude.slice(-3);
  const tendenciaSaude = ult3.length === 3 && ult3[2].data === referencia.data
    ? ((ult3[2].saude as number) - (ult3[0].saude as number)) / 2
    : null;

  return {
    competencias,
    competenciasComDados: comDados,
    referenciaPadrao,
    referencia,
    anterior,
    filtroDivisoes: filtro,
    siglasDivisoes: ranking.map((d) => d.sigla),
    divisoesRanqueadas: ranking.filter((d) => d.posicao !== null).length,
    totalIndicadores: todos.filter((i) => i.status !== "Sem meta").length,
    indicadores: comMeta,
    monitoramento,
    divisoes: ranking.filter((d) => naDivisao(d.sigla)),
    podio,
    piores,
    grupos: gruposDeContagem(bd, referencia.data).filter((g) => naDivisao(g.divisao)),
    resumo: resumir(sel),
    serieSaude,
    saudeAnterior,
    tendenciaSaude,
  };
}

// ── E.4 Filtros (só a lista de indicadores; não mexem na referência) ─────────

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filtrarIndicadores(inds: IndicadorPainel[], f: Partial<Filtros>): IndicadorPainel[] {
  const busca = semAcento((f.busca ?? "").trim());
  return inds.filter((i) =>
    (!f.divisoes?.length || f.divisoes.includes(i.divisaoExibida)) &&
    (!f.categorias?.length || f.categorias.includes(i.categoriaExibida)) &&
    (!f.status?.length || f.status.includes(i.status)) &&
    (!busca || semAcento(`${i.id} ${i.indicador}`).includes(busca)),
  );
}
