// Composição orçamentária (cap. VII) da minuta do PTA, gerada só com os dados do Painel de Execução:
// empenhos do ano por item, da UG do GAP-MN, agrupados em artigos (natureza de despesa + PI) e tarefas
// (contrato do PAG ou grupo de objetos). Regras do capítulo: DCA 11-1/2020, Anexo G, item IV, tópico 7
// (granularidade de tarefa; até 10% em "diversos") e item VI (código de tarefa ano + setor + sequencial).
// A ação orçamentária não está no painel: fica marcada para confirmar.

import { categoria, normalizar, type CategoriaId } from "./categorias.ts";
import type { ItemEmpenho, NotaEmpenho } from "./empenhos.ts";
import type { ContratoResumo, Vinculo } from "./painel.ts";

export type TarefaPTA = {
  id: string;
  codigo: string;
  periodo: string;
  descricao: string;
  /** Valor proposto para o ano do PTA (começa igual à base e é ajustado na minuta). */
  valor: number;
  /** Empenhado no ano de base (Painel de Execução). */
  base: number;
  nes: number;
  contrato: string | null;
  observacao: string;
};

export type ArtigoPTA = {
  id: string;
  nd: string;
  ndNome: string;
  pi: string;
  piNome: string;
  titulo: string;
  acao: string;
  tarefas: TarefaPTA[];
};

export type ComposicaoPTA = {
  ano: number;
  anoBase: number;
  ug: string;
  geradoEm: string;
  /** Data da emissão mais recente nos dados usados (até onde vai a base). */
  recorte: string;
  artigos: ArtigoPTA[];
  /** Naturezas que ficaram fora do capítulo (pessoal, benefícios, exercícios anteriores). */
  excluidos: { nd: string; ndNome: string; valor: number; nes: number }[];
  pontos: string[];
};

export const ACAO_A_CONFIRMAR = "a confirmar";

/** Naturezas fora da composição do PTA: folha, benefícios, indenizações e exercícios anteriores. */
const FORA = /^(319|339008|339046|339049|339093|339092)/;

const TITULO_ND: Record<string, string> = {
  "339030": "MATERIAL DE CONSUMO",
  "339039": "SERVIÇOS DE TERCEIROS – PESSOA JURÍDICA",
  "339139": "SERVIÇOS DE TERCEIROS – PESSOA JURÍDICA (INTRAORÇAMENTÁRIO)",
  "339040": "SERVIÇOS DE TECNOLOGIA DA INFORMAÇÃO E COMUNICAÇÃO",
  "339015": "DIÁRIAS MILITARES",
  "339014": "DIÁRIAS CIVIS",
  "339033": "PASSAGENS E DESPESAS COM LOCOMOÇÃO",
  "339047": "OBRIGAÇÕES TRIBUTÁRIAS E CONTRIBUTIVAS",
  "449052": "MATERIAL PERMANENTE",
  "449051": "OBRAS E INSTALAÇÕES",
  "449030": "MATERIAL DE CONSUMO (INVESTIMENTO)",
  "449040": "SERVIÇOS DE TECNOLOGIA DA INFORMAÇÃO E COMUNICAÇÃO (INVESTIMENTO)",
};

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_EXTENSO = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** "Mensal" quando há emissões em 6 meses ou mais; um mês por extenso; ou a lista dos meses. */
export function periodoDe(datasISO: Iterable<string>, comContrato: boolean): string {
  const meses = [...new Set([...datasISO].map((d) => Number(d.slice(5, 7)) - 1))].sort((a, b) => a - b);
  if (meses.length >= 6) return "Mensal";
  if (comContrato && meses.length >= 2) return "Anual";
  if (meses.length === 1) return MESES_EXTENSO[meses[0]] ?? "Anual";
  if (!meses.length) return "Anual";
  const nomes = meses.map((m) => MESES[m]);
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Texto em caixa de frase: "SERVIÇO CONTINUADO DE LIMPEZA" → "serviço continuado de limpeza". */
function frase(s: string, max = 90): string {
  const t = s.replace(/\s+/g, " ").trim().toLowerCase();
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(" "), 40))}…`;
}

/** Nome do PI em caixa de título curta: "VIDA VEGETATIVA - SEFA" → "Vida Vegetativa - SEFA". */
function nomePI(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase())
    .replace(/\b(Sefa|Sisub|Gabaer|Decea|Sipam|Siseso|Sisht|Op|Ii|Iii)\b/g, (m) => m.toUpperCase());
}

const AQUISICAO: Partial<Record<CategoriaId, string>> = {
  alimentacao: "gêneros alimentícios e material de copa e cozinha",
  limpeza: "material de higiene e limpeza",
  engenharia: "material de manutenção predial e infraestrutura",
  veiculos: "peças, combustíveis e lubrificantes para viaturas",
  tic: "material de informática",
  equipamentos: "fardamento, mobiliário e material individual",
  expediente: "material de expediente",
  vigilancia: "material de segurança e EPI",
  saude: "material de saúde",
  utilidades: "gás e material de utilidades",
  outros: "outros materiais",
};

const SERVICO: Partial<Record<CategoriaId, string>> = {
  engenharia: "manutenção predial e de instalações",
  limpeza: "limpeza, conservação, lavanderia e tratamento de resíduos",
  veiculos: "manutenção e abastecimento de viaturas",
  tic: "tecnologia da informação e telefonia",
  expediente: "apoio administrativo, publicação e almoxarifado",
  vigilancia: "vigilância e segurança",
  alimentacao: "alimentação e apoio ao rancho",
  saude: "saúde",
  capacitacao: "capacitação",
  equipamentos: "manutenção e reparo de equipamentos, mobiliário e fardamento",
  outros: "apoio diverso",
};

/** Setor sugerido para o código da tarefa, pelo costume do PTA GAP-MN 2026. O Bruno ajusta na minuta. */
export function setorSugerido(nd: string, cat: CategoriaId): string {
  if (/^449/.test(nd)) return "DAD";
  if (/^3390(14|15|33)/.test(nd) || cat === "capacitacao" || cat === "deslocamento") return "DRH";
  if (/^339[01]39$/.test(nd)) return ["utilidades", "engenharia", "veiculos"].includes(cat) ? "DIE" : "DOC";
  if (nd === "339030" && (cat === "equipamentos" || cat === "expediente")) return "DAD";
  return "DIE";
}

type Grupo = { chave: string; descricao: string; cat: CategoriaId; contrato: ContratoResumo | null; itens: { nota: NotaEmpenho; item: ItemEmpenho }[] };

function grupoDe(nd: string, piNome: string, nota: NotaEmpenho, item: ItemEmpenho, contrato: ContratoResumo | null): Omit<Grupo, "itens"> {
  if (contrato) {
    return {
      chave: `ctr:${contrato.id}`,
      descricao: `Quitar as despesas do contrato ${contrato.numero}${contrato.objeto ? ` (${frase(contrato.objeto, 80)})` : ""}`,
      cat: item.categoria,
      contrato,
    };
  }
  const cat = item.categoria;
  if (/^3390(14|15)/.test(nd)) return { chave: "diarias", descricao: `Pagar diárias – ${nomePI(piNome)}`, cat, contrato: null };
  if (nd === "339033") return { chave: "passagens", descricao: `Custear passagens e locomoção – ${nomePI(piNome)}`, cat, contrato: null };
  if (/^449/.test(nd) || cat === "utilidades") {
    // permanentes e serviços públicos: um grupo por objeto, que é o que se planeja (energia, água, freezer…)
    const nome = item.nome || nota.observacao;
    const verbo = cat === "utilidades" ? "Quitar as despesas com" : "Adquirir";
    return { chave: `obj:${normalizar(nome).slice(0, 60)}`, descricao: `${verbo} ${frase(nome, 70)}`, cat, contrato: null };
  }
  if (/^339[01]39$|^339040$/.test(nd)) {
    const s = SERVICO[cat] ?? categoria(cat).nome.toLowerCase();
    return { chave: `cat:${cat}`, descricao: `Contratar serviços de ${s}`, cat, contrato: null };
  }
  const a = AQUISICAO[cat] ?? categoria(cat).nome.toLowerCase();
  return { chave: `cat:${cat}`, descricao: `Adquirir ${a}`, cat, contrato: null };
}

const arred = (v: number) => Math.round(v * 100) / 100;

/** Junta em "Despesas diversas" as tarefas pequenas (menos de 2% do artigo), desde que o total delas fique em até 10%. */
function juntarPequenas(tarefas: TarefaPTA[], idArtigo: string): TarefaPTA[] {
  if (tarefas.length <= 3) return tarefas;
  const total = tarefas.reduce((s, t) => s + t.base, 0);
  const pequenas = tarefas.filter((t) => t.base < total * 0.02 && !t.contrato);
  const somaPequenas = pequenas.reduce((s, t) => s + t.base, 0);
  if (pequenas.length < 2 || somaPequenas > total * 0.1) return tarefas;
  const ficam = tarefas.filter((t) => !pequenas.includes(t));
  return [...ficam, {
    id: `${idArtigo}:diversos`, codigo: "", periodo: "Anual", descricao: "Quitar despesas diversas",
    valor: arred(somaPequenas), base: arred(somaPequenas), nes: pequenas.reduce((s, t) => s + t.nes, 0), contrato: null,
    observacao: `Agrupa ${pequenas.length} tarefas pequenas: ${pequenas.map((t) => t.descricao.replace(/^(Adquirir|Contratar serviços de|Quitar as despesas com) /, "")).join("; ")}`,
  }];
}

/**
 * Gera a composição orçamentária do PTA de `ano` com os empenhos do ano anterior da UG (padrão: GAP-MN, 120630).
 * Valor proposto = empenhado no ano de base, sem anualização nem reajuste: a minuta ajusta.
 */
export function gerarComposicao(
  nes: readonly NotaEmpenho[],
  vinculos: ReadonlyMap<string, Vinculo>,
  opcoes: { ano: number; ug?: string; agora?: string },
): ComposicaoPTA {
  const ug = opcoes.ug ?? "120630";
  const anoBase = opcoes.ano - 1;
  const doAno = nes.filter((n) => n.ug === ug && n.emissao.startsWith(String(anoBase)));

  const excluidos = new Map<string, { nd: string; ndNome: string; valor: number; nes: number }>();
  const artigos = new Map<string, { nd: string; ndNome: string; pi: string; piNome: string; grupos: Map<string, Grupo> }>();
  let recorte = "";
  for (const n of doAno) {
    if (n.emissao > recorte) recorte = n.emissao;
    if (FORA.test(n.natureza)) {
      const x = excluidos.get(n.natureza) ?? { nd: n.natureza, ndNome: n.naturezaNome, valor: 0, nes: 0 };
      x.valor += n.valor; x.nes++;
      excluidos.set(n.natureza, x);
      continue;
    }
    const chaveArt = `${n.natureza}|${n.pi}`;
    const art = artigos.get(chaveArt) ?? { nd: n.natureza, ndNome: n.naturezaNome, pi: n.pi, piNome: n.piNome, grupos: new Map<string, Grupo>() };
    artigos.set(chaveArt, art);
    const contrato = vinculos.get(n.ne)?.contrato ?? null;
    for (const item of n.itens) {
      const g0 = grupoDe(n.natureza, n.piNome, n, item, contrato);
      const g = art.grupos.get(g0.chave) ?? { ...g0, itens: [] };
      g.itens.push({ nota: n, item });
      art.grupos.set(g0.chave, g);
    }
  }

  const fimAno = `${opcoes.ano}-12-31`;
  const seq = new Map<string, number>();
  const lista: ArtigoPTA[] = [...artigos.values()]
    .map((a) => {
      const id = `art:${a.nd}:${a.pi}`;
      const tarefas: TarefaPTA[] = [...a.grupos.values()].map((g) => {
        const base = arred(g.itens.reduce((s, x) => s + x.item.valor, 0));
        const nesDoGrupo = new Set(g.itens.map((x) => x.nota.ne));
        const obs: string[] = [];
        if (g.contrato?.fim && g.contrato.fim <= fimAno) obs.push(`contrato vence em ${g.contrato.fim.slice(8, 10)}/${g.contrato.fim.slice(5, 7)}/${g.contrato.fim.slice(0, 4)}`);
        return {
          id: `${id}:${g.chave}`, codigo: "", periodo: periodoDe(g.itens.map((x) => x.nota.emissao), !!g.contrato),
          descricao: g.descricao, valor: base, base, nes: nesDoGrupo.size, contrato: g.contrato?.numero ?? null,
          observacao: obs.join("; "), _cat: g.cat,
        } as TarefaPTA & { _cat: CategoriaId };
      }).filter((t) => t.base > 0).sort((x, y) => y.base - x.base);
      const titulo = `${TITULO_ND[a.nd] ?? a.ndNome.toUpperCase()} – ${a.piNome ? nomePI(a.piNome).toUpperCase() : "PI NÃO INFORMADO"}`;
      return { id, nd: a.nd, ndNome: a.ndNome, pi: a.pi, piNome: a.piNome, titulo, acao: ACAO_A_CONFIRMAR, tarefas: juntarPequenas(tarefas, id) };
    })
    .filter((a) => a.tarefas.length)
    .sort((x, y) => x.nd.localeCompare(y.nd) || totalArtigo(y) - totalArtigo(x));

  // códigos: ano + setor sugerido + sequencial do setor, na ordem dos artigos
  const aa = String(opcoes.ano).slice(-2);
  for (const a of lista) for (const t of a.tarefas) {
    const cat = (t as TarefaPTA & { _cat?: CategoriaId })._cat ?? "outros";
    const setor = setorSugerido(a.nd, cat);
    const n = (seq.get(setor) ?? 0) + 1;
    seq.set(setor, n);
    t.codigo = `${aa}${setor}${String(n).padStart(3, "0")}`;
    delete (t as TarefaPTA & { _cat?: CategoriaId })._cat;
  }

  const total = lista.reduce((s, a) => s + totalArtigo(a), 0);
  const listaExcl = [...excluidos.values()].sort((x, y) => y.valor - x.valor);
  const venc = lista.flatMap((a) => a.tarefas).filter((t) => /contrato vence/.test(t.observacao)).length;
  const pontos = [
    `Base: empenhos de ${anoBase} da UG ${ug} no Painel de Execução, emitidos até ${recorte ? `${recorte.slice(8, 10)}/${recorte.slice(5, 7)}/${recorte.slice(0, 4)}` : "—"}. Valor proposto = empenhado em ${anoBase}, sem anualização nem reajuste.`,
    "Ação orçamentária: o painel não traz a ação. Confirmar a de cada artigo pelo PI.",
    "Códigos de tarefa provisórios: setor sugerido pelo costume do PTA anterior; renumerar a sequência depois dos caps. V e VI (DCA 11-1, Anexo G, item VI).",
  ];
  if (listaExcl.length) pontos.push(`Fora do capítulo, para decidir: ${listaExcl.map((e) => `${e.nd} ${e.ndNome.toLowerCase()} (${fmt(e.valor)})`).join("; ")}.`);
  if (venc) pontos.push(`${venc} tarefa(s) de contrato que vence até o fim de ${opcoes.ano}: prever prorrogação ou nova contratação.`);
  pontos.push(`Total proposto: ${fmt(total)} em ${lista.length} artigos.`);

  return { ano: opcoes.ano, anoBase, ug, geradoEm: opcoes.agora ?? new Date().toISOString(), recorte, artigos: lista, excluidos: listaExcl, pontos };
}

export const totalArtigo = (a: Pick<ArtigoPTA, "tarefas">) => arred(a.tarefas.reduce((s, t) => s + (Number(t.valor) || 0), 0));
export const totalComposicao = (c: Pick<ComposicaoPTA, "artigos">) => arred(c.artigos.reduce((s, a) => s + totalArtigo(a), 0));

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Linha de título do artigo no formato do PTA: "Art. 38 MATERIAL DE CONSUMO – … – ND 339030 – Ação: 2000 – R$ 3.020.000,00". */
export function tituloArtigo(a: ArtigoPTA, numero: number): string {
  const acao = !a.acao || a.acao === ACAO_A_CONFIRMAR ? "«a confirmar»" : a.acao;
  return `Art. ${numero} ${a.titulo} – ND ${a.nd} – Ação: ${acao} – R$ ${fmtNum(totalArtigo(a))}`;
}

/** Texto do capítulo para colar no Word: título, artigos e tabelas separadas por tabulação. */
export function textoCapitulo(c: Pick<ComposicaoPTA, "artigos">, primeiroArtigo: number): string {
  const linhas = ["CAPÍTULO VII", "COMPOSIÇÃO ORÇAMENTÁRIA", ""];
  c.artigos.forEach((a, i) => {
    linhas.push(tituloArtigo(a, primeiroArtigo + i), "", "CÓDIGO\tPERÍODO\tTAREFA\tTOTAL (R$)");
    for (const t of a.tarefas) linhas.push(`${t.codigo}\t${t.periodo}\t${t.descricao}\t${fmtNum(Number(t.valor) || 0)}`);
    linhas.push("");
  });
  return linhas.join("\n");
}

/** Problemas da composição pelas regras do Anexo G: códigos repetidos ou fora do padrão, "diversos" acima de 10%. */
export function conferirComposicao(c: Pick<ComposicaoPTA, "artigos" | "ano">): string[] {
  const avisos: string[] = [];
  const aa = String(c.ano).slice(-2);
  const vistos = new Map<string, string>();
  for (const a of c.artigos) {
    const total = totalArtigo(a);
    const diversos = a.tarefas.filter((t) => /divers|outros/i.test(t.descricao)).reduce((s, t) => s + (Number(t.valor) || 0), 0);
    if (total > 0 && diversos > total * 0.1) avisos.push(`${a.titulo}: "diversos/outros" passa de 10% do artigo.`);
    for (const t of a.tarefas) {
      if (!/^\d{2}[A-Z]{3}\d{3}$/.test(t.codigo)) avisos.push(`Tarefa "${t.descricao}": código "${t.codigo || "vazio"}" fora do padrão ano + setor + sequencial.`);
      else if (!t.codigo.startsWith(aa)) avisos.push(`Tarefa ${t.codigo}: o código deve começar por ${aa}.`);
      const outra = vistos.get(t.codigo);
      if (t.codigo && outra && outra !== t.descricao) avisos.push(`Código ${t.codigo} repetido em tarefas diferentes.`);
      if (t.codigo) vistos.set(t.codigo, t.descricao);
      if (!t.periodo.trim()) avisos.push(`Tarefa ${t.codigo || t.descricao}: sem período.`);
    }
  }
  return avisos;
}
