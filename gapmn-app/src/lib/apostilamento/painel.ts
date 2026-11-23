// Painel de reajustes: para cada contrato, quando o próximo reajuste fica devido e a cor do painel.
// Porte direto do painel_reajustes.py do pacote da SCON (mesmas regras e cores), em TypeScript para o
// painel abrir sem carregar o Python:
// - o reajuste fica devido a cada 12 meses da data do orçamento (data-base);
// - os efeitos começam no 1º dia do mês de aniversário;
// - com dedicação exclusiva de mão de obra não entra (é repactuação), nem o contrato que a carga do SILOMS
//   marca sem reajuste por índice (adesão com tarifa regulada, credenciamento com tabela);
// - com reajustes já aplicados, o próximo é o de número (aplicados + 1);
// - o índice do mês final sai até o dia 12 do mês seguinte.
// O app acrescenta SEM_DATA_BASE para contrato sem a data do orçamento cadastrada.

export type StatusReajuste =
  | "VERMELHO" | "AGUARDANDO_INDICE" | "AMARELO" | "VERDE"
  | "VIGENCIA_ENCERRADA" | "NAO_SE_APLICA" | "SEM_DATA_BASE";

export const DIAS_ALERTA = 60;
export const DIA_DIVULGACAO_INDICE = 12;

export interface ContratoPainel {
  contrato: string;
  data_base: string | null;        // MM/AAAA
  reajustes_aplicados?: number;
  dedicacao_exclusiva?: boolean;
  nao_aplicavel?: string | null;   // motivo da carga do SILOMS (siloms.reajuste_nao_aplicavel)
  vigencia_fim?: string | null;    // AAAA-MM-DD
}

export interface ReajusteDevido { n: number; periodo: string; efeitos: string; indice_divulgado: boolean }

export interface LinhaPainel {
  contrato: string;
  status: StatusReajuste;
  motivo?: string;
  reajustes_devidos: ReajusteDevido[];
  qtd_devidos: number;
  proximo_aniversario: string | null; // DD/MM/AAAA
  dias_para_proximo: number | null;
  cor: string;
}

export const CORES: Record<StatusReajuste, string> = {
  VERDE: "#D9EAD3", AMARELO: "#FFF2CC", VERMELHO: "#F4CCCC", AGUARDANDO_INDICE: "#FCE4D6",
  VIGENCIA_ENCERRADA: "#D9D9D9", NAO_SE_APLICA: "#EFEFEF", SEM_DATA_BASE: "#EFEFEF",
};

export const ROTULOS: Record<StatusReajuste, string> = {
  VERMELHO: "Reajuste devido", AGUARDANDO_INDICE: "Aguardando índice", AMARELO: "Próximo",
  VERDE: "Distante", VIGENCIA_ENCERRADA: "Vigência encerrada", NAO_SE_APLICA: "Fora da automação",
  SEM_DATA_BASE: "Sem data do orçamento",
};

const ORDEM: Record<StatusReajuste, number> = {
  VERMELHO: 0, AGUARDANDO_INDICE: 1, AMARELO: 2, VERDE: 3, SEM_DATA_BASE: 4, VIGENCIA_ENCERRADA: 5, NAO_SE_APLICA: 6,
};

type Data = { a: number; m: number; d: number };
const somaMeses = (m: number, a: number, k: number): [number, number] => {
  const t = a * 12 + (m - 1) + k;
  return [(t % 12 + 12) % 12 + 1, Math.floor(t / 12)];
};
const diaDe = (x: Data) => Date.UTC(x.a, x.m - 1, x.d) / 86400000;
const cmp = (x: Data, y: Data) => diaDe(x) - diaDe(y);
const fmt = (x: Data) => `${String(x.d).padStart(2, "0")}/${String(x.m).padStart(2, "0")}/${x.a}`;
const mmAaaa = (m: number, a: number) => `${String(m).padStart(2, "0")}/${a}`;

export function hojeLocal(d = new Date()): Data {
  return { a: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

/** Fim da vigência do SILOMS (carga, dd/mm/aaaa) → AAAA-MM-DD; aceita AAAA-MM-DD. */
export function isoDaVigencia(s: string | null | undefined): string | null {
  const t = String(s ?? "").trim();
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

/** Data do orçamento AAAA-MM-DD (contratos_scon.data_orcamento) → MM/AAAA. */
export function dataBaseDe(dataOrcamento: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(dataOrcamento ?? "");
  return m ? `${m[2]}/${m[1]}` : null;
}

export function statusContrato(c: ContratoPainel, hoje: Data = hojeLocal(), diasAlerta = DIAS_ALERTA): LinhaPainel {
  const base = { contrato: c.contrato, reajustes_devidos: [] as ReajusteDevido[], qtd_devidos: 0, proximo_aniversario: null, dias_para_proximo: null };
  if (c.dedicacao_exclusiva) {
    return { ...base, status: "NAO_SE_APLICA", motivo: "Dedicação exclusiva de mão de obra (repactuação)", cor: CORES.NAO_SE_APLICA };
  }
  if (c.nao_aplicavel) {
    return { ...base, status: "NAO_SE_APLICA", motivo: `Sem reajuste por índice: ${c.nao_aplicavel}`, cor: CORES.NAO_SE_APLICA };
  }
  const vig = /^(\d{4})-(\d{2})-(\d{2})/.exec(c.vigencia_fim ?? "");
  const encerrado = !!vig && cmp({ a: +vig[1], m: +vig[2], d: +vig[3] }, hoje) < 0;
  const mb = /^(\d{2})\/(\d{4})$/.exec(c.data_base ?? "");
  // vigência antes da data do orçamento (carga de 23/11 da SCON): contrato encerrado sem data-base não fica em "Sem data"
  if (!mb && encerrado) return { ...base, status: "VIGENCIA_ENCERRADA", motivo: "Vigência encerrada", cor: CORES.VIGENCIA_ENCERRADA };
  if (!mb) return { ...base, status: "SEM_DATA_BASE", motivo: "Cadastrar a data do orçamento", cor: CORES.SEM_DATA_BASE };
  const dbm = Number(mb[1]), dba = Number(mb[2]);
  const aplicados = Math.max(0, Math.trunc(Number(c.reajustes_aplicados ?? 0)));

  const devidos: ReajusteDevido[] = [];
  let n = aplicados + 1;
  for (;;) {
    const [am, aa] = somaMeses(dbm, dba, 12 * n);
    const aniv = { a: aa, m: am, d: 1 };
    if (cmp(aniv, hoje) > 0) break;
    const ini = somaMeses(dbm, dba, 12 * (n - 1));
    const fim = somaMeses(am, aa, -1); // 12 índices: até o mês anterior ao aniversário
    const [dm, da] = somaMeses(fim[0], fim[1], 1);
    devidos.push({
      n, periodo: `${mmAaaa(...ini)} a ${mmAaaa(...fim)}`, efeitos: fmt(aniv),
      indice_divulgado: cmp(hoje, { a: da, m: dm, d: DIA_DIVULGACAO_INDICE }) >= 0,
    });
    n++;
  }
  const [pm, pa] = somaMeses(dbm, dba, 12 * n);
  const proximo = { a: pa, m: pm, d: 1 };
  const dias = cmp(proximo, hoje);

  let status: StatusReajuste;
  if (devidos.length) {
    status = devidos.every((d) => d.indice_divulgado) ? "VERMELHO" : "AGUARDANDO_INDICE";
    if (!devidos[devidos.length - 1].indice_divulgado && devidos.length > 1) status = "VERMELHO";
  } else status = dias <= diasAlerta ? "AMARELO" : "VERDE";

  if (encerrado) status = "VIGENCIA_ENCERRADA";

  return { contrato: c.contrato, status, reajustes_devidos: devidos, qtd_devidos: devidos.length,
    proximo_aniversario: fmt(proximo), dias_para_proximo: dias, cor: CORES[status] };
}

/** Primeiro os devidos, depois aguardando índice, próximos e distantes (e, entre iguais, o mais perto). */
export function painel(contratos: ContratoPainel[], hoje: Data = hojeLocal(), diasAlerta = DIAS_ALERTA): LinhaPainel[] {
  return contratos.map((c) => statusContrato(c, hoje, diasAlerta))
    .sort((x, y) => ORDEM[x.status] - ORDEM[y.status] || (x.dias_para_proximo ?? 99999) - (y.dias_para_proximo ?? 99999));
}
