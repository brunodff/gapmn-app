// Leitura dos PDFs do contrato (contrato, TR, mapa comparativo, termos) para o que o Contratos.gov.br
// não traz: índice e cláusula do reajuste, data do orçamento, representante e endereço da empresa.
// Regras calibradas no modelo da AGU (Lei 14.133/2021), que o GAP-MN segue. Tudo vira SUGESTÃO com o
// trecho de onde saiu: a SCON confere e clica em "usar" (checagem humana obrigatória da SCON).

export type TipoDoc = "CONTRATO" | "TERMO DE REFERÊNCIA" | "MAPA COMPARATIVO" | "TERMO ADITIVO" | "APOSTILAMENTO" | "OUTRO";
export interface Achado<T> { valor: T; trecho: string }
export interface AchadosPdf {
  tipo: TipoDoc;
  indice?: Achado<string>;
  clausula?: Achado<string>;
  dataBase?: Achado<string>;   // MM/AAAA
  representante?: Achado<{ nome: string; feminino: boolean }>;
  endereco?: Achado<string>;
  objeto?: Achado<string>;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const limpo = (s: string) => s.replace(/\s+/g, " ").trim();
const trecho = (t: string, i: number, n = 220) => limpo(t.slice(Math.max(0, i - 40), i + n)) + "…";

export function tipoDoDocumento(texto: string): TipoDoc {
  // primeiro o título (começo do documento); o corpo do contrato cita o TR e o TR cita o contrato
  const titulo = semAcento(texto.slice(0, 400)).toUpperCase();
  if (/APOSTILAMENTO|APOSTILA\b/.test(titulo)) return "APOSTILAMENTO";
  if (/TERMO ADITIVO/.test(titulo)) return "TERMO ADITIVO";
  if (/MAPA (COMPARATIVO|DE PRECOS|DE COTACAO)/.test(titulo)) return "MAPA COMPARATIVO";
  if (/TERMO DE CONTRATO|CONTRATO N[O°º]?\s*\d|\bCONTRATO\s+(ADMINISTRATIVO|DE PRESTACAO)/.test(titulo)) return "CONTRATO";
  if (/TERMO DE REFERENCIA|PROJETO BASICO/.test(titulo)) return "TERMO DE REFERÊNCIA";
  const t = semAcento(texto.slice(0, 2500)).toUpperCase();
  if (/APOSTILAMENTO|APOSTILA\b/.test(t)) return "APOSTILAMENTO";
  if (/TERMO ADITIVO/.test(t)) return "TERMO ADITIVO";
  if (/MAPA (COMPARATIVO|DE PRECOS|DE COTACAO)/.test(t)) return "MAPA COMPARATIVO";
  if (/TERMO DE REFERENCIA|PROJETO BASICO/.test(t)) return "TERMO DE REFERÊNCIA";
  if (/CONTRATO N|CONTRATANTE|CONTRATADA/.test(t)) return "CONTRATO";
  return "OUTRO";
}

// índice pelo nome curto ou por extenso (a ordem importa: IPCA-E antes de IPCA; INPC antes do "Consumidor" genérico)
const INDICES: [string, RegExp][] = [
  ["IPCA-E", /\bIPCA-?E\b|Pre[çc]os ao Consumidor Amplo Especial/i],
  ["IPCA", /\bIPCA\b|Pre[çc]os ao Consumidor Amplo/i],
  ["INPC", /\bINPC\b|Nacional de Pre[çc]os ao Consumidor(?! Amplo)/i],
  ["IGP-M", /\bIGP-?M\b|Geral de Pre[çc]os\s*[-–(]?\s*Mercado/i],
  ["IGP-DI", /\bIGP-?DI\b|Disponibilidade Interna/i],
  ["INCC", /\bINCC\b|Custo da Constru[çc][ãa]o/i],
  ["ICTI", /\bICTI\b|Custos de Tecnologia da Informa[çc][ãa]o/i],
  ["IST", /\bIST\b|[ÍI]ndice de Servi[çc]os de Telecomunica[çc][õo]es/i],
];

function acharIndice(t: string): Achado<string> | undefined {
  // perto das menções ao reajuste: a cláusula diz "mediante a aplicação … do índice X"
  const re = /reajust|aplica[çc][ãa]o,? pel[oa] contratante,? do [íi]ndice|[íi]ndice de reajuste/gi;
  const contagem = new Map<string, { n: number; i: number }>();
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const janela = t.slice(m.index, m.index + 450);
    for (const [nome, rx] of INDICES) {
      const k = rx.exec(janela);
      if (k) { const c = contagem.get(nome) ?? { n: 0, i: m.index + k.index }; c.n++; contagem.set(nome, c); break; }
    }
  }
  const melhor = [...contagem.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return melhor ? { valor: melhor[0], trecho: trecho(t, melhor[1].i) } : undefined;
}

function acharClausula(t: string, tipo: TipoDoc): Achado<string> | undefined {
  const cab = /CL[ÁA]USULA\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]+)?)\s*[-–—:.]?\s*(?:D[OA]S?\s+)?REAJUSTE/i.exec(t);
  if (!cab) return undefined;
  const ordinal = cab[1].toUpperCase().replace(/\s+(DO|DA|DOS|DAS)$/, "");
  // item com a regra do índice ("7.2 Após o interregno de um ano … reajustados … índice")
  const depois = t.slice(cab.index, cab.index + 3000);
  const item = /(\d{1,2}\.\d{1,2})\.?\s+[^.]{0,160}?(interregno|reajustad|[íi]ndice)/i.exec(depois)?.[1];
  const doc = tipo === "TERMO DE REFERÊNCIA" ? "do Termo de Referência" : "do Contrato";
  return { valor: `a CLÁUSULA ${ordinal}${item ? `, item ${item}` : ""}, ${doc}`, trecho: trecho(t, cab.index, 160) };
}

const mmaaaa = (mes: number, ano: number) => (mes >= 1 && mes <= 12 ? `${String(mes).padStart(2, "0")}/${ano < 100 ? 2000 + ano : ano}` : null);

function acharDataBase(t: string, tipo: TipoDoc): Achado<string> | undefined {
  const padroes: RegExp[] = [
    /or[çc]amento estimado,?\s*(?:em|de|realizado em)?\s*(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/i,
    /data[- ]base[^.]{0,80}?(\d{1,2})[/.](\d{4})\b/i,
    /data\s+d[oa]\s+or[çc]amento[^.]{0,60}?(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/i,
  ];
  for (const rx of padroes) {
    const m = rx.exec(t);
    if (!m) continue;
    const v = m.length === 4 ? mmaaaa(Number(m[2]), Number(m[3])) : mmaaaa(Number(m[1]), Number(m[2]));
    if (v) return { valor: v, trecho: trecho(t, m.index) };
  }
  const porExtenso = /or[çc]amento estimado,?\s*(?:em|de)?\s*(?:\d{1,2}\s+de\s+)?([a-zç]+)\s+de\s+(\d{4})/i.exec(t);
  if (porExtenso) {
    const mes = MESES.indexOf(porExtenso[1].toLowerCase()) + 1;
    const v = mmaaaa(mes, Number(porExtenso[2]));
    if (v) return { valor: v, trecho: trecho(t, porExtenso.index) };
  }
  // mapa comparativo de preços: a data em que foi assinado vale como data do orçamento (contratações antes de 2025)
  if (tipo === "MAPA COMPARATIVO") {
    const datas = [...t.matchAll(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})|(\d{2})\/(\d{2})\/(\d{4})/gi)];
    const ult = datas[datas.length - 1];
    if (ult) {
      const v = ult[2] ? mmaaaa(MESES.indexOf(ult[2].toLowerCase()) + 1, Number(ult[3])) : mmaaaa(Number(ult[5]), Number(ult[6]));
      if (v) return { valor: v, trecho: `Data do mapa comparativo: ${trecho(t, ult.index ?? 0, 80)}` };
    }
  }
  return undefined;
}

/** Parágrafo da contratada: começa no CNPJ dela (que já se sabe pelo Contratos.gov.br) ou em "CONTRATADA" */
function paragrafoContratada(t: string, cnpj?: string): { texto: string; inicio: number } | null {
  const d = (cnpj ?? "").replace(/\D/g, "");
  if (d.length === 14) {
    const fmt = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    const i = t.indexOf(fmt) >= 0 ? t.indexOf(fmt) : t.indexOf(d);
    // a partir do CNPJ: o que vem antes é o contratante ("representada pelo GRUPAMENTO…")
    if (i >= 0) return { texto: t.slice(i, i + 900), inicio: i };
  }
  const m = /\bCONTRATADA\b/.exec(t);
  return m ? { texto: t.slice(m.index, m.index + 1300), inicio: m.index } : null;
}

const CARGO = String.raw`(?:(?:seu|sua)\s+)?(?:s[óo]ci[oa](?:[-\s](?:administrador[a]?|gerente|propriet[áa]ri[oa]|diretor[a]?))?|diretor[a]?(?:[-\s][a-zç]+)?|administrador[a]?|procurador[a]?|representante legal|titular|empres[áa]ri[oa])?\s*,?\s*`;
const NOME = String.raw`([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç'.]+(?:\s+(?:d[aeo]s?|e|[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç'.]+)){1,7})`;

function acharRepresentante(t: string, cnpj?: string): Achado<{ nome: string; feminino: boolean }> | undefined {
  const p = paragrafoContratada(t, cnpj);
  if (!p) return undefined;
  const rx = new RegExp(String.raw`representad[ao]\s+(?:neste ato\s+)?(?:por|pel[oa])\s+` + CARGO + String.raw`(?:(?:o|a)\s+)?(?:Sr\.?|Sra\.?|Senhor[a]?)?\s*` + NOME, "u");
  const m = rx.exec(p.texto);
  if (!m) return undefined;
  const nome = limpo(m[1]).replace(/\s+(conforme|portador[a]?|inscrit[oa]|brasileir[oa]|CPF).*$/i, "");
  if (/^(conforme|seu|sua|o|a)$/i.test(nome) || nome.split(" ").length < 2) return undefined;
  const depois = p.texto.slice(m.index, m.index + 260);
  const feminino = /\bSra\b|Senhora|pela\s+(?:s[óo]cia|diretora|administradora|procuradora|representante)|brasileira|portadora|inscrita no CPF/i.test(depois);
  return { valor: { nome, feminino }, trecho: trecho(t, p.inicio + m.index) };
}

function acharEndereco(t: string, cnpj?: string): Achado<string> | undefined {
  const p = paragrafoContratada(t, cnpj);
  if (!p) return undefined;
  const m = /(?:sediad[ao]|com sede|estabelecid[ao])\s+(n[ao]|em|à)\s+(.{10,220}?)(?=,?\s*(?:DDD|telefone|fone|e-?mail|neste ato|doravante|inscrit|representad)|;)/i.exec(p.texto);
  if (!m) return undefined;
  return { valor: `${m[1].toLowerCase()} ${limpo(m[2]).replace(/,$/, "")}`, trecho: trecho(t, p.inicio + m.index) };
}

function acharObjeto(t: string): Achado<string> | undefined {
  const m = /(?:O\s+)?objeto\s+d[oe]\s+presente\s+(?:instrumento|contrato|termo)\s+[ée]\s+(?:a|o)?\s*(.{20,600}?)(?:,\s*(?:conforme|nas condi)|\.\s)/i.exec(t);
  return m ? { valor: limpo(m[1]), trecho: trecho(t, m.index) } : undefined;
}

/** Tudo o que dá para tirar do texto de um PDF do contrato */
export function extrairDoTexto(textoBruto: string, op: { cnpjEmpresa?: string } = {}): AchadosPdf {
  const t = textoBruto.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const tipo = tipoDoDocumento(t);
  const r: AchadosPdf = { tipo };
  if (tipo !== "OUTRO") {
    r.indice = acharIndice(t);
    r.clausula = acharClausula(t, tipo);
    r.dataBase = acharDataBase(t, tipo);
  }
  if (tipo === "CONTRATO" || tipo === "TERMO ADITIVO" || tipo === "APOSTILAMENTO") {
    r.representante = acharRepresentante(t, op.cnpjEmpresa);
    r.endereco = acharEndereco(t, op.cnpjEmpresa);
    r.objeto = acharObjeto(t);
  }
  return r;
}
