// Regras dos Termos Aditivos na tela (as mesmas do kit da SCON, para mostrar na hora o que o kit vai fazer):
// pareceres.py (cobertura por parecer referencial), gerar_lista_verificacao.py (itens da Lista), gerar_ficha_autorizacao.py
// (objeto e valores) e gerar_pesquisa_precos.py (estatística). O teste aditivos.test.ts confere com a resposta do kit.
import {
  type Alerta, type Alteracao, type DadosAditivo, type EstadoAditivo, type ItemPesquisa, type Lei, type NaturezaObjeto,
  type ParecerReferencial, ALTERACOES,
} from "./tipos.ts";

export const NOMES: Record<Alteracao, string> = { prorrogacao: "prorrogação de vigência", reajuste: "reajuste", acrescimo: "acréscimo", supressao: "supressão" };
const COM_ARTIGO: Record<Alteracao, string> = { prorrogacao: "a prorrogação de vigência", reajuste: "o reajuste", acrescimo: "o acréscimo", supressao: "a supressão" };
export const LIMITE_LEI = 25; // art. 125 da Lei 14.133/2021 (50% só para reforma de edifício/equipamento)
export const UM_MILHAO = 1_000_000;

/** Número de "4,724910%", "R$ 1.050.000,00", 25 ou 10.5 (o _num do kit) */
export function numero(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace("%", "").replace("R$", "").replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}
const dataBr = (s: string | null | undefined): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
export const isoParaBr = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : "");
export const brParaIso = (br: string | null | undefined) => dataBr(br) ?? "";
export function listaJuntada(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}
const pct2 = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;
export const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** dados.json no formato antigo do kit (sem o bloco "aditivo"; "reajuste" e "parecer_referencial" soltos) → atual */
export function normalizarFormatoAntigo(bruto: Record<string, unknown>): Record<string, unknown> {
  if (bruto.aditivo) return bruto;
  const d: Record<string, unknown> = { ...bruto };
  d.aditivo = { prorrogacao: { modalidade: "com_valor", meses: null, inicio: null }, reajuste: bruto.reajuste ? { indice: null, percentual: null, valor: null } : null, acrescimo: null, supressao: null };
  if (!d.pareceres_referenciais && bruto.parecer_referencial) d.pareceres_referenciais = [{ cobre: ["prorrogacao", "reajuste"], ...(bruto.parecer_referencial as object) }];
  return d;
}

// ── Alterações e valores (seção 1.3) ────────────────────────────────────────
export function alteracoes(d: Pick<DadosAditivo, "aditivo">): Alteracao[] {
  return ALTERACOES.filter((k) => !!d.aditivo?.[k]);
}
export const temReajuste = (d: Pick<DadosAditivo, "aditivo">) => !!d.aditivo?.reajuste;

/** Valor que o contrato passará a ter: valor atual + reajuste + acréscimo − supressão (ou o informado) */
export function valorNovo(d: Pick<DadosAditivo, "aditivo" | "valor_atual" | "valor_novo">): number | null {
  const atual = numero(d.valor_atual);
  if (atual == null) return null;
  const informado = numero(d.valor_novo);
  if (informado != null) return Math.round(informado * 100) / 100;
  let novo = atual;
  const ad = d.aditivo ?? {};
  if (ad.reajuste && numero(ad.reajuste.valor) != null) novo += numero(ad.reajuste.valor)!;
  if (ad.acrescimo && numero(ad.acrescimo.valor) != null) novo += numero(ad.acrescimo.valor)!;
  if (ad.supressao && numero(ad.supressao.valor) != null) novo -= numero(ad.supressao.valor)!;
  return Math.round(novo * 100) / 100;
}
export function passa1Milhao(d: Pick<DadosAditivo, "aditivo" | "valor_atual" | "valor_novo">): boolean {
  const n = valorNovo(d);
  return n != null && n > UM_MILHAO;
}

/** Fim do novo período: início + meses − 1 dia (dd/mm/aaaa) */
export function fimPrevisto(inicio: string | null | undefined, meses: number | null | undefined): string | null {
  const iso = dataBr(inicio);
  if (!iso || !meses) return null;
  const [a, m, d] = iso.split("-").map(Number);
  const alvoMes = m - 1 + meses;
  const ano = a + Math.floor(alvoMes / 12), mes = (alvoMes % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const fim = new Date(Date.UTC(ano, mes - 1, Math.min(d, ultimo)) - 86400000);
  return fim.toISOString().slice(0, 10).split("-").reverse().join("/");
}

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta"];
export function extenso(n: number): string {
  if (n < 20) return UNIDADES[n];
  const d = Math.floor(n / 10), u = n % 10;
  return DEZENAS[d] + (u ? ` e ${UNIDADES[u]}` : "");
}

/** Campo 8 da Ficha (objeto e finalidade): uma linha por opção marcada */
export function objetoDaFicha(d: Pick<DadosAditivo, "aditivo" | "contrato">): string {
  const ad = d.aditivo ?? {}, ct = d.contrato;
  const linhas: string[] = [];
  if (ad.prorrogacao) {
    const meses = Number(ad.prorrogacao.meses) || 0;
    const prazo = meses ? `${meses} (${extenso(meses)}) meses` : "__ meses";
    linhas.push(ad.prorrogacao.modalidade === "sem_valor"
      ? `Prorrogar a vigência do Contrato nº ${ct} por mais ${prazo}, em sentido estrito, sem renovação do valor contratual`
      : `Prorrogar o Contrato nº ${ct} por mais ${prazo}, com renovação do valor contratual`);
  }
  if (ad.reajuste) linhas.push(`Reajustar o Contrato nº ${ct}, conforme índice ${ad.reajuste.indice || "_____"}${ad.reajuste.percentual ? ` (${ad.reajuste.percentual})` : ""}`);
  for (const [chave, verbo] of [["acrescimo", "Acrescer"], ["supressao", "Suprimir"]] as const) {
    const x = ad[chave];
    if (!x) continue;
    const partes: string[] = [];
    if (x.valor != null) partes.push(brl(numero(x.valor)!));
    if (x.percentual != null) partes.push(pct2(numero(x.percentual)!));
    linhas.push(`${verbo} o valor do Contrato nº ${ct}${partes.length ? ` em ${partes.join(" – ")}` : ""}${x.descricao ? `, referente a ${x.descricao}` : ""}`);
  }
  const R = ["I", "II", "III", "IV", "V", "VI"];
  return linhas.map((t, i) => `${R[i]} - ${t}${i < linhas.length - 1 ? ";" : "."}`).join("\n");
}

// ── Pareceres referenciais (seção 2.4; pareceres.py) ─────────────────────────
export interface AnalisePareceres {
  alteracoes: Alteracao[];
  pareceres: (ParecerReferencial & { fundamenta: Alteracao[]; motivo_texto: string })[];
  vencidos: ParecerReferencial[];
  descobertas: string[];
  vai_para_cju: boolean;
}
export function analisarPareceres(d: Pick<DadosAditivo, "aditivo" | "pareceres_referenciais">, hoje: string): AnalisePareceres {
  const alts = alteracoes(d);
  const ad = d.aditivo ?? {};
  // o campo antigo "parecer_referencial" (um só) ainda vale para prorrogação e reajuste, como no kit
  const antigo = (d as { parecer_referencial?: ParecerReferencial }).parecer_referencial;
  const lista = d.pareceres_referenciais ?? (antigo ? [{ ...antigo, cobre: antigo.cobre ?? (["prorrogacao", "reajuste"] as Alteracao[]) }] : []);
  const todos = lista.filter((p) => p && String(p.numero ?? "").trim());
  const vigentes: ParecerReferencial[] = [], vencidos: ParecerReferencial[] = [];
  for (const p of todos) { const v = dataBr(p.validade); (v && v < hoje ? vencidos : vigentes).push(p); }
  const cobertura: Partial<Record<Alteracao, string>> = {};
  const descobertas: string[] = [];
  for (const alt of alts) {
    const pct = alt === "acrescimo" || alt === "supressao" ? numero((ad[alt] as { percentual?: unknown } | null)?.percentual) : null;
    let ok: ParecerReferencial | null = null;
    for (const p of vigentes.filter((x) => (x.cobre ?? []).includes(alt))) {
      let lim = numero(p.limite_percentual);
      if (lim == null && (alt === "acrescimo" || alt === "supressao")) lim = LIMITE_LEI;
      if (pct != null && lim != null && pct > lim) continue;
      ok = p; break;
    }
    if (ok) { cobertura[alt] = ok.numero; continue; }
    let motivo = NOMES[alt];
    const venc = vencidos.find((p) => (p.cobre ?? []).includes(alt));
    if (pct != null && pct > LIMITE_LEI) motivo += ` (${pct2(pct)}, acima do limite de ${LIMITE_LEI}%)`;
    else if (venc) motivo += ` (o ${venc.numero.trim()} teve validade até ${venc.validade})`;
    descobertas.push(motivo);
  }
  const usados: AnalisePareceres["pareceres"] = [];
  for (const p of vigentes) {
    const cobre = alts.filter((a) => cobertura[a] === p.numero);
    if (!cobre.length) continue;
    usados.push({ ...p, fundamenta: cobre, motivo_texto: p.motivo || `Fundamenta ${listaJuntada(cobre.map((a) => COM_ARTIGO[a]))} deste termo aditivo.` });
  }
  return { alteracoes: alts, pareceres: usados, vencidos, descobertas, vai_para_cju: descobertas.length > 0 || !alts.length };
}
export function fraseObservacaoParecer(an: AnalisePareceres): string | null {
  if (!an.descobertas.length) return null;
  if (!an.pareceres.length) {
    const base = "não há parecer referencial vigente para este aditivo";
    if (an.vencidos.length && an.descobertas.length === an.alteracoes.length && an.descobertas.every((x) => x.includes("validade até"))) {
      const p = an.vencidos[0];
      return `${base} (o ${p.numero.trim()} teve validade até ${p.validade})`;
    }
    return `${base} (${listaJuntada(an.descobertas)}); o termo aditivo deve ser submetido à análise jurídica`;
  }
  return `não há parecer referencial vigente que fundamente: ${listaJuntada(an.descobertas)}; o termo aditivo deve ser submetido à análise jurídica`;
}

// Catálogo da SCON (seção 2.4, lido na página AGU do site em 23/11/2026): a tela confere a validade e a ementa na
// tabela agu_referenciais (sync-agu) e a SCON pode trocar ou incluir pareceres no aditivo.
export interface ParecerCatalogo {
  numero: string; num: number; ano: number; sigla: string; situacao: string;
  naturezas: NaturezaObjeto[]; leis: Lei[]; cobre: Alteracao[]; limite?: number; validade: string;
}
export const CATALOGO_PARECERES: ParecerCatalogo[] = [
  { numero: "PARECER REFERENCIAL n. 00004/2024/CGSEM/SCGP/CGU/AGU", num: 4, ano: 2024, sigla: "CGSEM", situacao: "Prorrogação de serviço contínuo sem DEMO (Lei 14.133), com ou sem reajuste; renovado pelo Parecer 18/2026/CONSER", naturezas: ["servico_sem_demo"], leis: ["14133"], cobre: ["prorrogacao", "reajuste"], validade: "01/11/2028" },
  { numero: "PARECER REFERENCIAL n. 00001/2023/CGSEM/SCGP/CGU/AGU", num: 1, ano: 2023, sigla: "CGSEM", situacao: "Prorrogação de serviço contínuo sem DEMO (Lei 8.666)", naturezas: ["servico_sem_demo"], leis: ["8666"], cobre: ["prorrogacao"], validade: "27/09/2027" },
  { numero: "PARECER REFERENCIAL n. 3/2024/CGCOM-BSB/SCGP/CGU/AGU", num: 3, ano: 2024, sigla: "CGCOM", situacao: "Prorrogação de serviço contínuo com DEMO (Lei 14.133); não se aplica a reequilíbrio", naturezas: ["servico_com_demo"], leis: ["14133"], cobre: ["prorrogacao"], validade: "12/11/2028" },
  { numero: "PARECER REFERENCIAL n. 2/2024/DICOMEX/SCGP/CGU/AGU", num: 2, ano: 2024, sigla: "DICOMEX", situacao: "Prorrogação de serviço contínuo com DEMO (Lei 8.666)", naturezas: ["servico_com_demo"], leis: ["8666"], cobre: ["prorrogacao"], validade: "29/10/2028" },
  { numero: "PARECER REFERENCIAL n. 00005/2025/DISEMEX/SCGP/CGU/AGU", num: 5, ano: 2025, sigla: "DISEMEX", situacao: "Prorrogação de contrato de TIC sem DEMO", naturezas: ["tic"], leis: ["14133"], cobre: ["prorrogacao"], validade: "21/05/2027" },
  { numero: "PARECER REFERENCIAL n. 00001/2024/CGSEM/SCGP/CGU/AGU", num: 1, ano: 2024, sigla: "CGSEM", situacao: "Prorrogação de TIC / aluguel de equipamentos (Lei 8.666)", naturezas: ["tic"], leis: ["8666"], cobre: ["prorrogacao"], validade: "30/01/2028" },
  { numero: "PARECER REFERENCIAL Nº. 00007/2026/CONAQ/SCGP/CGU/AGU", num: 7, ano: 2026, sigla: "CONAQ", situacao: "Prorrogação de contrato de aquisição de bens", naturezas: ["bens"], leis: ["14133"], cobre: ["prorrogacao"], validade: "21/05/2027" },
  { numero: "PARECER REFERENCIAL Nº. 00002/2026/CONSER/SCGP/CGU/AGU", num: 2, ano: 2026, sigla: "CONSER", situacao: "Prorrogação de locação de imóvel (Administração locatária)", naturezas: ["locacao_imovel"], leis: ["14133"], cobre: ["prorrogacao"], validade: "31/03/2028" },
  { numero: "PARECER REFERENCIAL Nº. 00006/2025/CONSER/SCGP/CGU/AGU", num: 6, ano: 2025, sigla: "CONSER", situacao: "Acréscimo/supressão unilateral de serviço contínuo sem DEMO (art. 124, I, b), até 25%", naturezas: ["servico_sem_demo"], leis: ["14133"], cobre: ["acrescimo", "supressao"], limite: 25, validade: "03/09/2027" },
  { numero: "PARECER REFERENCIAL n. 00002/2023/CGSEM/SCGP/CGU/AGU", num: 2, ano: 2023, sigla: "CGSEM", situacao: "Alteração unilateral de serviço contínuo sem DEMO (Lei 8.666), até 25%", naturezas: ["servico_sem_demo"], leis: ["8666"], cobre: ["acrescimo", "supressao"], limite: 25, validade: "03/11/2027" },
];
export interface AguParecer { id: number; parecer: string | null; numero: number | null; ano: number | null; assunto: string | null; data: string | null; validade: string | null; url: string | null }
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
/** O mesmo parecer na tabela da AGU (pelo nº, ano e sigla do órgão) */
export function acharNaAgu(p: Pick<ParecerCatalogo, "num" | "ano" | "sigla">, agu: AguParecer[]): AguParecer | null {
  const rx = new RegExp(`(^|\\D)0*${p.num}\\s*/\\s*${p.ano}\\s*/\\s*${p.sigla}`);
  return agu.find((a) => rx.test(semAcento(a.parecer ?? ""))) ?? null;
}
/** Pareceres do catálogo para as alterações marcadas, a natureza do objeto e a lei do contrato (validade e ementa da AGU, se achar) */
export function pareceresSugeridos(alts: Alteracao[], natureza: NaturezaObjeto, lei: Lei, agu: AguParecer[]): (ParecerReferencial & { conferido: boolean; url?: string | null })[] {
  const escolhidos: (ParecerReferencial & { conferido: boolean; url?: string | null })[] = [];
  for (const alt of alts) {
    if (escolhidos.some((p) => p.cobre.includes(alt))) continue;
    const c = CATALOGO_PARECERES.find((x) => x.cobre.includes(alt) && x.naturezas.includes(natureza) && x.leis.includes(lei));
    if (!c) continue;
    const a = acharNaAgu(c, agu);
    escolhidos.push({
      numero: c.numero, objeto: a?.assunto?.trim() || c.situacao, data: isoParaBr(a?.data) || null,
      validade: isoParaBr(a?.validade) || c.validade, cobre: c.cobre, ...(c.limite ? { limite_percentual: c.limite } : {}),
      conferido: !!a, url: a?.url ?? null,
    });
  }
  return escolhidos;
}

// ── Lista de Verificação (seção 2.3; itens_da_lista do kit) ──────────────────
export interface ItemLista { chave: string; texto: string; obrigatorioAnexar?: boolean }
export function itensDaLista(d: DadosAditivo, hoje: string): ItemLista[] {
  const L: ItemLista[] = [];
  const add = (chave: string, texto: string, cond = true) => { if (cond) L.push({ chave, texto }); };
  add("anuencia_consulta", "Consulta formal à contratada quanto à anuência para a prorrogação contratual.");
  add("anuencia_resposta", "Resposta da contratada contendo a anuência para a prorrogação contratual.");
  add("disp_orcamentaria", "Declaração de Disponibilidade Orçamentária.");
  add("vantajosidade", "Declaração quanto à vantajosidade da prorrogação contratual.");
  add("parecer_tecnico", "Parecer Técnico sobre Alteração de Contrato aprovado pelo Ordenador de Despesas da UG Signatária.");
  add("mapa_riscos", "Mapa de Riscos para Termo Aditivo (Gerenciamento de Riscos da fase de Gestão do Contrato, conforme arts. 20 e 26 da IN nº 05/2017 SEGES/MP).");
  add("pesquisa_precos", "Pesquisa de Preços – pesquisa de preços praticados pelo mercado do ramo do objeto, baseada em critérios aceitáveis, observando-se a IN SEGES/ME nº 65/2021, contendo os documentos comprobatórios para calcular o custo global, com a verificação da congruência entre os preços das propostas, de forma a evitar valores desarrazoados ou evidentemente inexequíveis.");
  add("calculadora", "Calculadora do Cidadão (consulta anexada ao Parecer Técnico).", temReajuste(d));
  add("bol_aci", "Boletim de Designação do Agente de Controle Interno.");
  add("bol_od", "Boletim de Designação do Ordenador de Despesas.");
  add("bol_fiscalizacao", "Boletim de Designação da Fiscalização atualizado.");
  add("sicaf", "Comprovante de consulta à situação da contratada junto ao SICAF (a contratada deverá, ao menos, não estar impedida de licitar; possuir os níveis cadastrados I e II; nível III com certidões da Receita Federal, FGTS e Trabalhista válidas; e nível IV ao menos com certidão municipal válida).");
  add("consulta_cnpj", "Comprovante de consulta de regularidade junto ao CEIS, CNJ e Lista de Licitantes Inidôneos (TCU) para o CNPJ da contratada.");
  add("consulta_cpf_socio", "Comprovante de consulta de regularidade junto ao CEIS, CNJ e Lista de Licitantes Inidôneos (TCU) para o CPF do sócio majoritário.", !!d.consulta_socio);
  add("procuracao", "Procuração do representante competente para assinatura do Termo Aditivo.", !!d.representante_mudou);
  add("exclusividade", "Atestado de Exclusividade válido.", !!d.inexigibilidade);
  add("ficha_autorizacao", "Ficha para a Autorização da Prorrogação Contratual (atividade de custeio acima de R$ 1.000.000,00).", passa1Milhao(d));
  analisarPareceres(d, hoje).pareceres.forEach((p, i) => {
    const suf = i === 0 ? "" : `_${i + 1}`;
    const num = p.numero.trim();
    const vig = [p.data ? `de ${p.data}` : "", p.validade ? `válido até ${p.validade}` : ""].filter(Boolean).join(", ");
    add(`parecer_referencial${suf}`, `${num}${p.objeto ? `\nObjeto: ${p.objeto.trim()}` : ""}${vig ? `\nVigência: ${vig}.` : ""}\nMotivo: ${p.motivo_texto}`);
    add(`atestado_adequacao${suf}`, `Atestado de adequação ao ${num}.`);
  });
  add("memoria_calculo", "Memória de Cálculo – Reajuste.", temReajuste(d));
  return L;
}

// ── Pesquisa de preços (gerar_pesquisa_precos.py) ────────────────────────────
export function estatistica(it: ItemPesquisa, criterio: string): { n: number; media: number; mediana: number; menor: number; referencia: number } | null {
  const v = (it.precos ?? []).filter((p) => !p.excluido && p.valor_atualizado != null).map((p) => Number(p.valor_atualizado)).sort((a, b) => a - b);
  if (!v.length) return null;
  const media = v.reduce((s, x) => s + x, 0) / v.length;
  const meio = Math.floor(v.length / 2);
  const mediana = v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
  const menor = v[0];
  const referencia = criterio === "media" ? media : criterio === "menor" ? menor : mediana;
  return { n: v.length, media, mediana, menor, referencia };
}
export function resumoPesquisa(d: DadosAditivo): { totalContratado: number; totalReferencia: number; vantajosa: boolean; poucos: number[]; acima: number[] } | null {
  const pp = d.pesquisa_precos;
  if (!pp?.itens?.length) return null;
  let tc = 0, tr = 0;
  const poucos: number[] = [], acima: number[] = [];
  for (const it of pp.itens) {
    const e = estatistica(it, pp.criterio ?? "mediana");
    if (!e || it.preco_contratado == null) continue;
    const q = Number(it.quantidade) || 1;
    tc += it.preco_contratado * q; tr += e.referencia * q;
    if (e.n < 3) poucos.push(it.item);
    if (it.preco_contratado > e.referencia) acima.push(it.item);
  }
  return { totalContratado: tc, totalReferencia: tr, vantajosa: tc <= tr, poucos, acima };
}

// ── OM signatária e autoridade (Ficha) ───────────────────────────────────────
const OMS_CEFA = ["GAP-MN", "PAMN", "PREFEITURA"];
export const eCefa = (om: { sigla?: string; nome?: string }) => {
  const alvo = `${om.sigla ?? ""} ${om.nome ?? ""}`.toUpperCase();
  return OMS_CEFA.some((x) => alvo.includes(x)) || alvo.includes("GRUPAMENTO DE APOIO DE MANAUS");
};

// ── Número do termo aditivo (aditivos já assinados + 1) ──────────────────────
export function proximoAditivo(documentos: { tipo?: string; numero?: string | null }[] | undefined): number {
  let maior = 0;
  for (const d of documentos ?? []) {
    if (!/ADITIVO/i.test(String(d.tipo ?? ""))) continue;
    const n = /^0*(\d{1,3})\s*\//.exec(String(d.numero ?? "").trim());
    maior = Math.max(maior, n ? Number(n[1]) : maior + 1);
  }
  return maior + 1;
}

// ── Alertas (seção 4) ────────────────────────────────────────────────────────
const EMPENHO: [keyof DadosAditivo["empenho"], string][] = [["gestao_unidade", "Gestão/Unidade"], ["fonte", "Fonte de Recursos"], ["programa_trabalho", "Programa de Trabalho"], ["plano_interno", "Plano Interno"], ["natureza_despesa", "Natureza de Despesa"]];
export function alertasDoAditivo(d: DadosAditivo, e: EstadoAditivo, hoje: string, anexos: { sicaf: boolean; regularidade: boolean }): Alerta[] {
  const a: Alerta[] = [];
  const alts = alteracoes(d);
  if (!alts.length) a.push({ nivel: "critico", texto: "Marque o que o aditivo vai fazer (prorrogação, reajuste, acréscimo ou supressão).", bloqueia: true, secao: "alteracoes" });
  if (numero(d.valor_atual) == null) a.push({ nivel: "critico", texto: "Informe o valor atual do contrato (seção 1.3).", bloqueia: true, secao: "alteracoes" });
  if (d.aditivo.prorrogacao && (!d.aditivo.prorrogacao.meses || !d.aditivo.prorrogacao.inicio)) a.push({ nivel: "critico", texto: "Prorrogação sem o nº de meses ou a data de início do novo período.", bloqueia: true, secao: "alteracoes" });
  for (const k of ["acrescimo", "supressao"] as const) {
    const pct = numero(d.aditivo[k]?.percentual);
    if (pct != null && pct > LIMITE_LEI) a.push({ nivel: "critico", texto: `${k === "acrescimo" ? "Acréscimo" : "Supressão"} de ${pct2(pct)}: passa de ${LIMITE_LEI}% (art. 125 da Lei 14.133/2021; 50% só para reforma de edifício/equipamento).`, secao: "alteracoes" });
  }
  if (d.aditivo.reajuste && numero(d.aditivo.reajuste.valor) == null) a.push({ nivel: "atencao", texto: "Reajuste sem o valor em R$: traga o total da memória de cálculo (seção Memória de Cálculo).", secao: "memoria" });
  const an = analisarPareceres(d, hoje);
  for (const x of an.descobertas) a.push({ nivel: "critico", texto: `${x.charAt(0).toUpperCase()}${x.slice(1)} sem parecer referencial vigente – este termo aditivo deverá ir para análise jurídica (CJU).`, secao: "pareceres" });
  const chaves = itensDaLista(d, hoje).map((i) => i.chave);
  for (const [k, j] of Object.entries(d.nao_anexados ?? {})) {
    if (chaves.includes(k) && !String(j ?? "").trim()) a.push({ nivel: "critico", texto: `Item "${k}" marcado como NÃO anexado sem justificativa.`, bloqueia: true, secao: "lista" });
  }
  const vazios = EMPENHO.filter(([k]) => !String(d.empenho?.[k] ?? "").trim()).map(([, n]) => n);
  if (vazios.length) a.push({ nivel: "critico", texto: `Dados do empenho incompletos (${vazios.join(", ")}): a Declaração de Disponibilidade Orçamentária não é gerada.`, bloqueia: true, secao: "declaracao" });
  if (!d.empenho?.acao) a.push({ nivel: "info", texto: "Empenho sem a Ação: a Declaração sai com \"não se aplica\" (confira).", secao: "declaracao" });
  if (!d.empenho?.exercicio) a.push({ nivel: "critico", texto: "Informe o exercício da Declaração Orçamentária.", bloqueia: true, secao: "declaracao" });
  // Mapa de Riscos
  if (!d.riscos.length) a.push({ nivel: "critico", texto: "Mapa de Riscos sem nenhum risco.", bloqueia: true, secao: "riscos" });
  else {
    if (d.riscos.length === 1) a.push({ nivel: "atencao", texto: "Mapa de Riscos com só 1 risco: o modelo prevê pelo menos 2.", secao: "riscos" });
    const incompletos = d.riscos.map((r, i) => (!r.nome?.trim() || !r.probabilidade || !r.impacto || !r.dano?.trim() || !r.acao_preventiva?.trim() || !r.acao_contingencia?.trim() ? i + 1 : 0)).filter(Boolean);
    if (incompletos.length) a.push({ nivel: "critico", texto: `Risco(s) ${incompletos.join(", ")} com campo obrigatório vazio.`, bloqueia: true, secao: "riscos" });
  }
  // SICAF (item 12) e regularidade (item 13)
  if (!e.sicaf && !("sicaf" in (d.nao_anexados ?? {}))) a.push({ nivel: "critico", texto: "Falta o PDF do SICAF (item 12): anexe, ou marque o item como NÃO anexado com justificativa. Sem ele o .zip sai sem o item 12.", secao: "sicaf" });
  if (e.sicaf && !e.sicaf.ok) a.push({ nivel: "critico", texto: `SICAF com pendências: ${e.sicaf.alertas.filter((x) => !x.startsWith("🟡")).join(" ")}`, secao: "sicaf" });
  if (e.sicaf && !anexos.sicaf) a.push({ nivel: "info", texto: "O PDF do SICAF foi conferido antes, mas não está anexado nesta sessão: anexe de novo para ir junto no .zip.", secao: "sicaf" });
  if (!e.regularidade && !("consulta_cnpj" in (d.nao_anexados ?? {}))) a.push({ nivel: "critico", texto: "Falta a consulta de regularidade (item 13): faça a consulta, ou marque o item como NÃO anexado com justificativa. Sem ela o .zip sai sem o item 13.", secao: "regularidade" });
  if (e.regularidade) {
    for (const [k, c] of Object.entries(e.regularidade.cadastros)) {
      if (c.situacao === "consta") a.push({ nivel: "critico", texto: `Consta sanção no ${c.cadastro} – verificar antes do aditivo.`, secao: "regularidade" });
      else if (c.situacao !== "nada_consta" && !e.regularidade.complementos?.[k]) a.push({ nivel: "atencao", texto: `A consulta ao ${c.cadastro} falhou na Consulta Consolidada: anexe a certidão desse cadastro${c.automatico ? " (ou busque automaticamente)" : ""}.`, secao: "regularidade" });
    }
  }
  // Ficha (> R$ 1 milhão)
  if (passa1Milhao(d)) {
    if (!d.merito_administrativo?.trim()) a.push({ nivel: "critico", texto: "Ficha de Autorização: escreva o mérito administrativo (campo 9).", bloqueia: true, secao: "ficha" });
    if (!String(d.om_signataria?.ug ?? "").trim()) a.push({ nivel: "critico", texto: "Ficha de Autorização: informe o código da UG signatária (campo 2).", bloqueia: true, secao: "ficha" });
    if (!eCefa(d.om_signataria ?? {}) && !d.autoridade_superior?.trim()) a.push({ nivel: "critico", texto: "Ficha de Autorização: informe o cargo da autoridade do campo 19 (OM fora do CEFA).", bloqueia: true, secao: "ficha" });
  }
  // Pesquisa de preços (obrigatória)
  const rp = resumoPesquisa(d);
  if (!rp && !("pesquisa_precos" in (d.nao_anexados ?? {}))) a.push({ nivel: "atencao", texto: "Pesquisa de Preços ainda não feita (obrigatória em todo aditivo): faça na aba Pesquisa de Preços ou marque NÃO com justificativa.", secao: "pesquisa" });
  if (rp) {
    if (rp.poucos.length) a.push({ nivel: "atencao", texto: `Item(ns) ${rp.poucos.join(", ")} com menos de 3 preços válidos: justificar.`, secao: "pesquisa" });
    if (!rp.vantajosa) a.push({ nivel: "critico", texto: "Total contratado acima do mercado: negociar redução com a contratada ou justificar a vantajosidade antes da prorrogação.", secao: "pesquisa" });
    if (d.pesquisa_precos?.itens.some((i) => i.preco_contratado == null)) a.push({ nivel: "critico", texto: "Pesquisa de Preços com item sem o preço contratado do novo período.", bloqueia: true, secao: "pesquisa" });
  }
  if (!d.om_nome?.trim() || !d.pag?.trim() || !d.contrato?.trim() || !d.om_signataria?.sigla?.trim()) a.push({ nivel: "critico", texto: "Faltam dados do contrato (OM solicitante, PAG, nº do contrato ou OM signatária).", bloqueia: true, secao: "alteracoes" });
  if (!d.numero_aditivo) a.push({ nivel: "critico", texto: "Informe o nº do termo aditivo.", bloqueia: true, secao: "alteracoes" });
  return a;
}
