// Remanejamento de saldo entre contratos de um grupo (pedido do Bruno, 26/11/2026): para cobrir X meses de faturas,
// o saldo a liquidar que sobra num contrato (além dos meses dele) é anulado na NE e empenhado nos contratos sem
// saldo, desde que tenham a mesma adequação orçamentária (UGR, natureza de despesa e PI).
//
// Regras:
//  - só NE do exercício corrente é anulada para reempenhar (anular resto a pagar não devolve crédito ao ano);
//  - quem cede fica com o necessário para os meses dele (fatura × meses); só o que passa disso é remanejado;
//  - quem recebe ganha mês a mês: primeiro todos chegam a 1 fatura, depois a 2… (nenhum fica sem o mês seguinte
//    enquanto outro recebe o terceiro);
//  - o contrato recebe nas adequações que já usa no exercício (a da NE mais recente primeiro); sem NE no exercício,
//    na da NE mais recente; sem NE com UGR, ND e PI, fica de fora.
// Fonte e PTRES não estão nas planilhas: a tela pede para conferir no SIAFI antes de anular.

export interface Dotacao { ugr: string; nd: string; pi: string }
export interface NeDoContrato {
  ne: string;
  ano: number;
  /** saldo a liquidar da NE no exercício dela (só conta para anular se a NE é do exercício corrente) */
  aLiquidarExercicio: number;
  dotacao: Dotacao | null;
}
export interface ContratoRemanejamento {
  id: string;
  numero: string;
  fatura: number;
  /** fatura × meses que o contrato precisa cobrir (limitado à vigência, como na tabela) */
  necessario: number;
  /** saldo a liquidar de todas as NEs do contrato (exercício + restos a pagar) */
  saldo: number;
  nes: NeDoContrato[];
}
export interface Anulacao { contratoId: string; numero: string; ne: string; valor: number; dotacao: Dotacao }
export interface Empenho { contratoId: string; numero: string; valor: number; dotacao: Dotacao; /** NE do exercício na mesma adequação: reforçar em vez de emitir outra */ reforcar: string | null }
export interface ResultadoContrato {
  cede: number; recebe: number; saldoDepois: number; falta: number;
  /** adequações em que o contrato pode receber (a 1ª é a principal) */
  dotacoes: Dotacao[];
}
export interface PlanoRemanejamento {
  porContrato: Map<string, ResultadoContrato>;
  anulacoes: Anulacao[];
  empenhos: Empenho[];
  total: number;
  avisos: string[];
}

const cent = (v: number) => Math.round(v * 100) / 100;
const limpo = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
/** UGR, ND e PI completos (sem algum deles a NE não entra) */
export const dotacaoValida = (d: Dotacao | null | undefined): d is Dotacao => !!d && !!limpo(d.ugr) && !!limpo(d.nd) && !!limpo(d.pi);
/** a natureza conta pelo elemento (6 dígitos: 339039), sem o subitem */
export const chaveDotacao = (d: Dotacao) => `${limpo(d.ugr)}|${limpo(d.nd).replace(/\D/g, "").slice(0, 6) || limpo(d.nd)}|${limpo(d.pi)}`;
export const textoDotacao = (d: Dotacao) => `UGR ${d.ugr} · ND ${d.nd} · PI ${d.pi}`;

/** Adequações em que o contrato pode receber: as das NEs do exercício (a mais recente primeiro); sem NE no exercício,
 *  a da NE mais recente com UGR, ND e PI */
export function dotacoesDoContrato(c: Pick<ContratoRemanejamento, "nes">, anoAtual: number): Dotacao[] {
  const validas = c.nes.filter((n) => dotacaoValida(n.dotacao)).sort((a, b) => b.ne.localeCompare(a.ne));
  const doAno = validas.filter((n) => n.ano === anoAtual);
  const out: Dotacao[] = [];
  for (const n of doAno.length ? doAno : validas.slice(0, 1)) if (!out.some((d) => chaveDotacao(d) === chaveDotacao(n.dotacao!))) out.push(n.dotacao!);
  return out;
}

export function planejarRemanejamento(contratos: readonly ContratoRemanejamento[], anoAtual: number): PlanoRemanejamento {
  const avisos: string[] = [];
  const porContrato = new Map<string, ResultadoContrato>();
  for (const c of contratos) porContrato.set(c.id, { cede: 0, recebe: 0, saldoDepois: cent(c.saldo), falta: cent(Math.max(0, c.necessario - c.saldo)), dotacoes: dotacoesDoContrato(c, anoAtual) });

  // quem pode ceder: sobra acima do necessário, só em NE do exercício com a adequação completa
  type Fonte = { c: ContratoRemanejamento; ne: NeDoContrato; resta: number };
  const sobra = new Map<string, number>();
  const fontes = new Map<string, Fonte[]>();
  for (const c of contratos) {
    const excesso = cent(c.saldo - c.necessario);
    if (excesso <= 0.004) continue;
    sobra.set(c.id, excesso);
    const doAno = c.nes.filter((n) => n.ano === anoAtual && n.aLiquidarExercicio > 0.004);
    const anulavel = cent(doAno.filter((n) => dotacaoValida(n.dotacao)).reduce((s, n) => s + n.aLiquidarExercicio, 0));
    if (anulavel < excesso - 0.004) {
      const semDot = doAno.filter((n) => !dotacaoValida(n.dotacao)).map((n) => n.ne);
      avisos.push(`${c.numero}: sobram ${brl(excesso)}, mas só ${brl(anulavel)} estão em NE do exercício ${anoAtual} com UGR, ND e PI conhecidos`
        + (semDot.length ? ` (sem a adequação completa: ${semDot.join(", ")})` : " (o resto é de exercício anterior, que não volta como crédito)") + ".");
    }
    // anula primeiro a NE com mais saldo (menos operações)
    for (const ne of [...doAno].filter((n) => dotacaoValida(n.dotacao)).sort((a, b) => b.aLiquidarExercicio - a.aLiquidarExercicio)) {
      const k = chaveDotacao(ne.dotacao!);
      fontes.set(k, [...(fontes.get(k) ?? []), { c, ne, resta: cent(ne.aLiquidarExercicio) }]);
    }
  }

  // quem precisa: por adequação, mês a mês
  const anulado = new Map<string, Anulacao>();
  const empenhado = new Map<string, Empenho>();
  const precisam = contratos.filter((c) => c.necessario - c.saldo > 0.004);
  for (const c of precisam) {
    const r = porContrato.get(c.id)!;
    if (!r.dotacoes.length) avisos.push(`${c.numero}: sem NE com UGR, ND e PI conhecidos — não dá para saber a adequação; fica fora do remanejamento.`);
    else if (!r.dotacoes.some((d) => fontes.has(chaveDotacao(d)))) avisos.push(`${c.numero}: nenhum contrato do grupo tem sobra na mesma adequação (${r.dotacoes.map(textoDotacao).join("; ")}).`);
  }
  const maxMeses = Math.max(0, ...precisam.map((c) => (c.fatura > 0 ? Math.ceil(c.necessario / c.fatura - 1e-9) : 0)));
  for (let m = 1; m <= maxMeses; m++) {
    for (const c of precisam) {
      const r = porContrato.get(c.id)!;
      const alvo = cent(Math.min(c.necessario, c.fatura * m));
      let precisa = cent(alvo - c.saldo - r.recebe);
      for (const dot of r.dotacoes) {
      const k = chaveDotacao(dot);
      for (const f of fontes.get(k) ?? []) {
        if (precisa <= 0.004) break;
        const livreDoador = sobra.get(f.c.id) ?? 0;
        const valor = cent(Math.min(precisa, f.resta, livreDoador));
        if (valor <= 0.004) continue;
        f.resta = cent(f.resta - valor);
        sobra.set(f.c.id, cent(livreDoador - valor));
        precisa = cent(precisa - valor);
        r.recebe = cent(r.recebe + valor);
        const d = porContrato.get(f.c.id)!;
        d.cede = cent(d.cede + valor);
        const a = anulado.get(f.ne.ne) ?? { contratoId: f.c.id, numero: f.c.numero, ne: f.ne.ne, valor: 0, dotacao: f.ne.dotacao! };
        a.valor = cent(a.valor + valor);
        anulado.set(f.ne.ne, a);
        const reforcar = c.nes.filter((n) => n.ano === anoAtual && dotacaoValida(n.dotacao) && chaveDotacao(n.dotacao!) === k).sort((x, y) => y.ne.localeCompare(x.ne))[0]?.ne ?? null;
        const e = empenhado.get(`${c.id}|${k}`) ?? { contratoId: c.id, numero: c.numero, valor: 0, dotacao: dot, reforcar };
        e.valor = cent(e.valor + valor);
        empenhado.set(`${c.id}|${k}`, e);
      }
      }
    }
  }
  for (const c of contratos) {
    const r = porContrato.get(c.id)!;
    r.saldoDepois = cent(c.saldo - r.cede + r.recebe);
    r.falta = cent(Math.max(0, c.necessario - r.saldoDepois));
  }
  const anulacoes = [...anulado.values()].sort((a, b) => a.numero.localeCompare(b.numero) || a.ne.localeCompare(b.ne));
  const empenhos = [...empenhado.values()].sort((a, b) => a.numero.localeCompare(b.numero));
  return { porContrato, anulacoes, empenhos, total: cent(anulacoes.reduce((s, a) => s + a.valor, 0)), avisos };
}

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
}
