// Unidades apoiadas e as regras de sigla copiadas do modelo do Power BI (Oficial.pbip).
// A sigla sai do nome da UG: a primeira regra cujo trecho aparece no nome vence,
// por isso a ORDEM importa (é a mesma das colunas Sigla_OM do BI).

export type Apoiada = { sigla: string; logo: string | null };

/** Tabela "Apoiadas" do BI, na ordem dela. Logos em public/om (cópias reduzidas das do BI). */
export const APOIADAS: Apoiada[] = [
  { sigla: "GAP-MN", logo: "/om/gap-mn.png" },
  { sigla: "COMAR VII", logo: "/om/comar-vii.png" },
  { sigla: "DACTA IV", logo: "/om/dacta-iv.png" },
  { sigla: "COMARA", logo: "/om/comara.png" },
  { sigla: "BAMN", logo: "/om/bamn.png" },
  { sigla: "SERINFRA-MN", logo: "/om/serinfra-mn.png" },
  { sigla: "SEREP-MN", logo: "/om/serep-mn.png" },
  { sigla: "HAMN", logo: "/om/hamn.png" },
  { sigla: "PAMN", logo: "/om/pamn.png" },
  { sigla: "SERIPA-MN", logo: "/om/seripa-mn.png" },
  { sigla: "DIRAP", logo: null },
  { sigla: "DECEA", logo: null },
  { sigla: "GDAAe", logo: null },
];

const LOGOS = new Map(APOIADAS.map((a) => [a.sigla, a.logo]));
export const logoDa = (sigla: string | null): string | null => (sigla ? LOGOS.get(sigla) ?? null : null);

export type Regra = readonly [trecho: string, sigla: string];

/** Crédito recebido e empenhos (coluna Sigla_OM de "Dados (2)" e de "Dados"). */
export const REGRAS_RECEBIDO: readonly Regra[] = [
  ["SERV DE REC", "SEREP-MN"],
  ["GRUPAMENTO DE APOIO", "GAP-MN"],
  ["HOSPITAL", "HAMN"],
  ["PREFEITURA", "PAMN"],
  ["CENTRO", "DACTA IV"],
  // No BI esta regra gera "SERINFRA", que não casa com a apoiada "SERINFRA-MN".
  ["INFRA", "SERINFRA-MN"],
  ["COMANDO", "COMAR VII"],
  ["COMISSAO", "COMARA"],
  ["ACID", "SERIPA-MN"],
  ["BASE", "BAMN"],
  ["NAVAL", "HAMN"],
  ["DEPARTAMENTO", "DECEA"],
  ["PESSOAL", "DIRAP"],
];

/** Crédito disponível (coluna Sigla_OM de "Crédito Disponível"). */
export const REGRAS_DISPONIVEL: readonly Regra[] = [
  ["SERV DE REC", "SEREP-MN"],
  ["GRUPAMENTO DE APOIO", "GAP-MN"],
  ["HOSPITAL", "HAMN"],
  ["PREFEITURA", "PAMN"],
  ["CENTRO", "DACTA IV"],
  ["INFRA", "SERINFRA-MN"],
  ["COMANDO", "COMAR VII"],
  ["COMISSAO", "COMARA"],
  ["ACID", "SERIPA-MN"],
  ["BASE", "BAMN"],
  ["POLICLINICA", "HAMN"],
  ["DEPARTAMENTO", "DECEA"],
  ["ESCOLA", "SEREP-MN"],
  ["DIRETORIA", "GAP-MN"],
  ["DEFESA ANTIAEREA", "GDAAe"],
];

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

export function siglaDe(nomeUG: string | null | undefined, regras: readonly Regra[]): string | null {
  const nome = semAcento(String(nomeUG ?? "")).toUpperCase().trim();
  if (!nome) return null;
  for (const [trecho, sigla] of regras) if (nome.includes(trecho)) return sigla;
  return null;
}
