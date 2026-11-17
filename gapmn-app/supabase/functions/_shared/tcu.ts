// Regras da sincronização com os Dados Abertos do TCU (função sync-tcu), sem rede nem banco: o que
// é acórdão de licitação e contrato, os temas, o CSV do TCU e o cruzamento das listas de sanção com
// os fornecedores do GAP-MN. Testes em tcu.test.ts.

/** Sem acento, minúsculo, espaços simples (para os testes de palavra-chave). */
export function normalizar(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export const soDigitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

/** "11/11/2026" → "2026-11-11"; outra coisa → null. */
export function dataISO(br: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(br ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// ── Temas de licitação e contrato ────────────────────────────────────────────
// A ordem é a da tela. Cada tema casa com o sumário do acórdão ou com o enunciado do informativo.
export const TEMAS: { tema: string; re: RegExp }[] = [
  { tema: "Licitação", re: /licitac|licitant|pregao|concorrencia|edital|certame|habilitac|julgamento das propostas|exequibilidade/ },
  { tema: "Contratação direta", re: /dispensa(?!c)|inexigib|contratacao direta/ },
  { tema: "Registro de preços", re: /registro de precos|ata de registro|adesao a ata|carona/ },
  { tema: "Preços e orçamento", re: /sobrepreco|superfaturamento|pesquisa de precos|preco estimado|orcamento estimado|precos de referencia|bdi\b/ },
  { tema: "Execução do contrato", re: /aditivo|reajust|repactua|reequilibr|fiscaliza\w* do contrato|fiscal do contrato|gestao contratual|execucao contratual|execucao do contrato|prorrogac\w* contratual|prorrogac\w* do contrato|rescis|garantia contratual|pagamento antecipado|subcontrata/ },
  { tema: "Mão de obra", re: /terceiriza|dedicacao exclusiva|mao de obra|conta vinculada|planilha de custos/ },
  { tema: "Sanções", re: /inidone|impedimento de licitar|impedimento para licitar|sancao administrativa|sancoes administrativas|multa contratual/ },
  { tema: "Obras e engenharia", re: /(?<!mao de )\bobras?\b|servicos? de engenharia|obras? de engenharia|sinapi|sicro/ },
  { tema: "TI", re: /tecnologia da informacao|\bsoftware|solucao de ti|computacao em nuvem|licencas de uso/ },
];

/** Assunto do acórdão que não é de licitação e contrato, mesmo que cite um contrato ou um reajuste
 *  (de remuneração). Vale em qualquer ponto do sumário: "REVISÃO DE OFÍCIO. PENSÃO CIVIL…". */
const FORA = /^(pessoal|reforma|admissao)\b|\b(pensao (civil|militar|especial)|pensoes|aposentadoria|reforma militar|admissao de pessoal|atos? de pessoal|beneficios previdenciarios|farmacia popular|bolsa familia|seguro-defeso)\b|^tomada de contas especial\. (convenio|contrato de repasse|termo de compromisso|fundeb|fns|sus|pnae)/;

/** Liga o acórdão à Defesa ou a Manaus (destaque na tela). */
const DEFESA = /aeronautica|forca aerea|comaer|base aerea|grupamento de apoio|gap-?mn|ministerio da defesa|forcas armadas|exercito|marinha|batalhao|\bmilitar(es)?\b|manaus|amazonas/;

export function temasDe(texto: string): string[] {
  const t = normalizar(texto);
  return TEMAS.filter((x) => x.re.test(t)).map((x) => x.tema);
}

export interface Classificacao { relevante: boolean; temas: string[]; destaque: boolean }

/** Acórdão que interessa à SLIC e à SCON: o sumário fala de licitação ou contrato (não de pessoal). */
export function classificarAcordao(sumario: string | null | undefined, titulo = ""): Classificacao {
  const t = normalizar(sumario);
  const temas = temasDe(t);
  // "contrato de repasse" e "contrato de gestão" são de transferência, não de contratação
  const soRepasse = temas.length === 1 && temas[0] === "Execução do contrato" && /contrato de repasse|termo de compromisso/.test(t) && !/aditivo|reajust|repactua/.test(t);
  // tomada de contas especial só de obra (em geral de convênio) não é assunto de licitação da OM
  const tceSoObra = /^tomada de contas especial/.test(t) && temas.every((x) => x === "Obras e engenharia");
  const relevante = temas.length > 0 && !FORA.test(t) && !soRepasse && !tceSoObra;
  return { relevante, temas, destaque: DEFESA.test(t + " " + normalizar(titulo)) };
}

// ── CSV do TCU ───────────────────────────────────────────────────────────────
/** CSV dos Dados Abertos do TCU: campos entre aspas, separados por "|", aspas dobradas dentro do
 *  campo e quebras de linha dentro do texto. Devolve as linhas como objetos pelo cabeçalho. */
export function lerCsvTcu(texto: string): Record<string, string>[] {
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === "|") { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.length > 1 || linha[0] !== "") linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas;
  if (!cab) return [];
  return resto.map((l) => Object.fromEntries(cab.map((k, j) => [k.replace(/^﻿/, "").trim(), l[j] ?? ""])));
}

/** Tira as marcas do texto do TCU (<acordao_decisao_tcu …>, <p>…) e junta os espaços. */
export const semMarcas = (s: string | null | undefined) =>
  String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").replace(/ ([,.;:])/g, "$1").trim();

export interface Informativo {
  key: string; numero: number; ano: number | null; titulo: string; colegiado: string;
  acordao: string; enunciado: string; texto: string; temas: string[];
}

/** Linha do informativo-lc.csv → registro da tabela tcu_informativos. */
export function informativoDe(r: Record<string, string>): Informativo | null {
  const numero = Number(r.NUMERO);
  if (!r.KEY || !Number.isFinite(numero) || !r.ENUNCIADO) return null;
  const ano = Number(/\/(\d{4})\s*$/.exec(r.TITULO ?? "")?.[1]) || null;
  return {
    key: r.KEY, numero, ano, titulo: semMarcas(r.TITULO), colegiado: semMarcas(r.COLEGIADO),
    acordao: semMarcas(r.TEXTOACORDAO), enunciado: semMarcas(r.ENUNCIADO), texto: semMarcas(r.TEXTOINFO),
    temas: temasDe(r.ENUNCIADO),
  };
}

// ── Sanções ──────────────────────────────────────────────────────────────────
export type Lista = "INIDONEO" | "CONTAS_IRREGULARES";

/** Registro das listas do TCU (responsaveis-inidoneos / responsaveis-contas-irregulares). */
export interface RegistroTcu {
  numeroProcessoFormatado?: string; nome?: string; tipoRegistro?: string; numeroRegistro?: string;
  numeroAcordaoFormatado?: string; dataAcordao?: string; dataTransitoEmJulgado?: string; dataFinalSancao?: string;
  linkDeliberacoesProcesso?: string; linkAcompanhamentoProcesso?: string;
}

export interface Sancao {
  cnpj: string; lista: Lista; processo: string; nome: string; acordao: string | null;
  data_acordao: string | null; data_transito: string | null; data_final: string | null;
  link_deliberacao: string | null; link_processo: string | null;
}

/** Só pessoa jurídica (CNPJ) entra: a lista também tem CPF, que não é fornecedor do app e é dado pessoal. */
export function sancaoDe(r: RegistroTcu, lista: Lista): Sancao | null {
  const cnpj = soDigitos(r.numeroRegistro);
  if (cnpj.length !== 14 || (r.tipoRegistro && r.tipoRegistro !== "CNPJ")) return null;
  return {
    cnpj, lista, processo: r.numeroProcessoFormatado || "", nome: String(r.nome ?? "").replace(/^'+|'+$/g, "").trim(),
    acordao: r.numeroAcordaoFormatado || null, data_acordao: dataISO(r.dataAcordao), data_transito: dataISO(r.dataTransitoEmJulgado),
    data_final: dataISO(r.dataFinalSancao), link_deliberacao: r.linkDeliberacoesProcesso || null, link_processo: r.linkAcompanhamentoProcesso || null,
  };
}

/** Registros da lista que são fornecedores nossos (CNPJ do contrato ou da ata), sem repetir. */
export function cruzar(registros: RegistroTcu[], lista: Lista, nossos: Set<string>): Sancao[] {
  const vistos = new Set<string>();
  const out: Sancao[] = [];
  for (const r of registros) {
    const s = sancaoDe(r, lista);
    if (!s || !nossos.has(s.cnpj)) continue;
    const k = `${s.cnpj}|${s.processo}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(s);
  }
  return out;
}

/** CNPJs para o CADIRREG nesta rodada: os nunca conferidos primeiro, depois os mais antigos,
 *  só os que passaram de `dias` desde a última conferência. */
export function filaCadirreg(nossos: string[], conferidos: Map<string, string>, agora: Date, dias = 7, max = 120): string[] {
  const limite = agora.getTime() - dias * 864e5;
  return nossos
    .map((c) => ({ c, em: conferidos.has(c) ? Date.parse(conferidos.get(c)!) : -Infinity }))
    .filter((x) => x.em < limite)
    .sort((a, b) => a.em - b.em || a.c.localeCompare(b.c))
    .slice(0, max)
    .map((x) => x.c);
}

/** Texto do aviso diário no feed do app (sem nome de empresa: o feed é para todos os usuários). */
export function textoFeed(r: { acordaos_novos: number; informativos_novos: number; alertas_novos: number }): string | null {
  const partes: string[] = [];
  if (r.alertas_novos) partes.push(`${r.alertas_novos} fornecedor${r.alertas_novos > 1 ? "es" : ""} com registro novo no TCU`);
  if (r.acordaos_novos) partes.push(`${r.acordaos_novos} acórdão${r.acordaos_novos > 1 ? "s" : ""} sobre licitações e contratos`);
  if (r.informativos_novos) partes.push(`${r.informativos_novos} enunciado${r.informativos_novos > 1 ? "s" : ""} novo${r.informativos_novos > 1 ? "s" : ""} do Informativo de Licitações e Contratos`);
  return partes.length ? `TCU: ${partes.join("; ")}` : null;
}
