// Pareceres referenciais (Manifestações Jurídicas Referenciais, ON AGU nº 55/2014) da AGU, pelo buscador público
// da Consultoria-Geral da União (cgu.agu.gov.br/referenciais). A página traz a lista inteira num JSON dentro do
// HTML (variável arrDados, ~900 itens): órgão, número, data, assunto, ementa, link do PDF e validade. Aqui só a
// parte sem rede (ler a página, normalizar, classificar), testada em agu.test.ts.

export const FONTE_AGU = "https://cgu.agu.gov.br/referenciais/";

/** Quem emitiu: Aeronáutica (COJAER), Defesa e Forças, consultorias especializadas da CGU (e-CJU/SCGP) ou outros */
export type GrupoAgu = "aeronautica" | "defesa" | "ecju" | "outros";

export interface ReferencialAgu {
  id: number;
  orgao: string;
  grupo: GrupoAgu;
  numero: number | null;
  ano: number | null;
  parecer: string;
  nup: string | null;
  data: string | null;        // AAAA-MM-DD
  assunto: string;
  observacao: string;
  url: string | null;
  validade: string | null;    // AAAA-MM-DD; sem validade = vale enquanto estiver na lista
  licitacoes: boolean;        // trata de licitação, contratação direta, contrato ou ata
}

const DEFESA = new Set(["CONJUR-MD", "CONJUR-EB", "CONJUR-MM", "CJACM"]);

/** Licitações e contratos, pelo assunto, ementa ou tipo */
export const RX_LICITACOES = /licita|contrat|preg[ãa]o|dispensa|inexigib|registro\s+de\s+pre[çc]|\bata\b|aditiv|apostila|reajust|repactua|reequil[íi]brio|aquisi[çc]|terceiriz|credenciamento|14\.133|8\.666|ades[ãa]o|obras?\b|engenharia|loca[çc][ãa]o\s+de\s+im[óo]v|sub-?roga|prorroga[çc][ãa]o\s+d[aoe]\s+(prazo|vig)/i;

/** Convênios, doações e transferências: fora de "licitações e contratos", salvo se falam de licitação */
const RX_FORA = /conv[êe]nio|doa[çc](?:[ãa]o|[õo]es)|termos+des+(?:fomento|colabora)|transfer[êe]ncias?s+volunt|acordos+des+coopera/i;
const RX_LICITACAO_MESMO = /licita|preg[ãa]o|dispensa|inexigib|registros+des+pre[çc]/i;

const limpo = (s: unknown) => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

/** Recorta o array JSON que começa no primeiro "[" depois de `marca`, respeitando textos entre aspas */
export function recortarArray(texto: string, marca = "arrDados"): string | null {
  const m = texto.indexOf(marca);
  if (m < 0) return null;
  const ini = texto.indexOf("[", m);
  if (ini < 0) return null;
  let prof = 0, aspas = false, escape = false;
  for (let i = ini; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === "\"") aspas = false;
      continue;
    }
    if (c === "\"") aspas = true;
    else if (c === "[") prof++;
    else if (c === "]" && --prof === 0) return texto.slice(ini, i + 1);
  }
  return null;
}

/** "2026-09-24", "05/01/2023 " (dia/mês) ou "7/31/2024" (mês/dia, sem zero) → AAAA-MM-DD */
export function dataIso(s: unknown): string | null {
  const t = limpo(s);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);                 // com zeros: dd/mm/aaaa
  if (m) return valida(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);             // sem zeros: m/d/aaaa (formato americano)
  if (m) return valida(+m[3], +m[1], +m[2]) ?? valida(+m[3], +m[2], +m[1]);
  return null;
}
function valida(a: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(a, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1) return null;
  return `${a}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function grupoDe(orgao: string, abrangencia: unknown): GrupoAgu {
  const o = orgao.toUpperCase();
  if (o === "COJAER") return "aeronautica";
  if (DEFESA.has(o)) return "defesa";
  if (String(abrangencia) === "1" || String(abrangencia) === "3") return "ecju";
  return "outros";
}

const httpsAgu = (u: string) => u.replace(/^http:\/\/((?:[a-z0-9-]+\.)*agu\.gov\.br)\//i, "https://$1/");

export function normalizarReferencial(x: Record<string, unknown>): ReferencialAgu | null {
  const id = Number(x.id_referenciais);
  if (!Number.isInteger(id) || id <= 0) return null;
  const orgao = limpo(x.orgao) || "–";
  const parecer = limpo(x.parecer);
  const assunto = limpo(x.assunto).replace(/^assunto:\s*/i, "");
  const observacao = String(x.observacao ?? "").replace(/ /g, " ").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  const url = limpo(x.url);
  const num = parseInt(limpo(x.numero), 10), ano = parseInt(limpo(x.ano), 10);
  return {
    id, orgao, grupo: grupoDe(orgao, x.abrangencia),
    numero: Number.isFinite(num) ? num : null, ano: Number.isFinite(ano) ? ano : null,
    parecer, nup: limpo(x.nup) || null, data: dataIso(x.data), assunto, observacao,
    url: /^https?:\/\//i.test(url) ? httpsAgu(url) : null,
    validade: dataIso(x.validade),
    licitacoes: ehLicitacao(`${parecer} ${assunto} ${limpo(x.tipo)}`, observacao),
  };
}

/** Licitações e contratos: pelo assunto e pela ementa; convênio e doação só se o próprio assunto fala de licitação */
export function ehLicitacao(titulo: string, ementa: string): boolean {
  if (RX_FORA.test(titulo)) return RX_LICITACAO_MESMO.test(titulo);
  return RX_LICITACOES.test(`${titulo} ${ementa}`);
}

/** Todos os referenciais da página do buscador (lança se a página mudou e a lista não está mais lá) */
export function lerReferenciais(html: string): ReferencialAgu[] {
  const bruto = recortarArray(html);
  if (!bruto) throw new Error("a página da AGU mudou: a lista de referenciais não foi encontrada");
  const arr = JSON.parse(bruto) as Record<string, unknown>[];
  const vistos = new Set<number>();
  const out: ReferencialAgu[] = [];
  for (const x of arr) {
    const r = normalizarReferencial(x);
    if (r && !vistos.has(r.id)) { vistos.add(r.id); out.push(r); }
  }
  return out;
}

/** Vigente como no buscador da AGU: sem validade, ou validade de hoje em diante */
export const vigente = (r: Pick<ReferencialAgu, "validade">, hojeIso: string) => !r.validade || r.validade >= hojeIso;

/** Título do feed quando aparecem referenciais novos de licitações e contratos (null = nada a avisar) */
export function textoFeedAgu(novos: Pick<ReferencialAgu, "grupo" | "licitacoes">[]): string | null {
  const lc = novos.filter((r) => r.licitacoes);
  if (!lc.length) return null;
  const aer = lc.filter((r) => r.grupo === "aeronautica").length;
  const def = lc.filter((r) => r.grupo === "defesa").length;
  const destaque = [aer ? `${aer} da COJAER` : "", def ? `${def} da Defesa` : ""].filter(Boolean).join(", ");
  return `AGU: ${lc.length} parecer${lc.length > 1 ? "es" : ""} referencia${lc.length > 1 ? "is" : "l"} nov${lc.length > 1 ? "os" : "o"} sobre licitações e contratos${destaque ? ` (${destaque})` : ""}`;
}
