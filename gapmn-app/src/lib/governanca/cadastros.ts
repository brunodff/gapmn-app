// Listas fixas do formulário de coleta: postos e graduações e as divisões/assessorias que respondem.

export const POSTOS = [
  "Cel", "Ten Cel", "Maj", "Cap", "1º Ten", "2º Ten", "Asp",
  "SO", "1S", "2S", "3S", "Cb", "S1", "S2", "Servidor civil",
] as const;

/** Siglas como estão no catálogo de indicadores (ordem do Painel de Governança). */
export const DIVISOES: { sigla: string; nome: string }[] = [
  { sigla: "DRH", nome: "Divisão de Recursos Humanos" },
  { sigla: "DIE", nome: "Divisão de Infraestrutura" },
  { sigla: "DA", nome: "Divisão de Administração" },
  { sigla: "AJUR", nome: "Assessoria Jurídica e de Investigação e Justiça" },
  { sigla: "ASESO", nome: "Assessoria de Serviço Social (inclui Comunicação Social)" },
  { sigla: "DOC", nome: "Divisão de Obtenções e Contratos" },
  { sigla: "ACI", nome: "Assessoria de Controle Interno" },
  // Fala.BR (Ouvidoria e LAI): Matriz de Atividades e Tarefas Mínimas da DIRAD, macroprocesso ACS
  { sigla: "SEC", nome: "Secretaria da Chefia (Ouvidoria e SIC)" },
];

export const nomeDivisao = (sigla: string) => DIVISOES.find((d) => d.sigla === sigla)?.nome ?? sigla;

/** "9. LICITAÇÕES E CONTRATOS" → "Licitações e Contratos"; grupos extras ficam como estão. */
export function nomeSecao(categoria: string): string {
  const sem = categoria.replace(/^\d+\.\s*/, "").trim();
  if (sem !== sem.toUpperCase()) return sem;
  const minusculas = new Set(["de", "da", "do", "das", "dos", "e", "a", "o"]);
  return sem.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ").replace(/\bTi\b/, "TI");
}

/** "2026-09" → "setembro de 2026" (e "2026-06" semestral → "1º semestre de 2026"). */
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function competenciaExtenso(codigo: string, rotulo?: string): string {
  if (rotulo && rotulo.startsWith("JAN-JUN")) return `1º semestre de ${codigo.slice(0, 4)}`;
  const [a, m] = codigo.split("-").map(Number);
  return `${MESES[m - 1] ?? m} de ${a}`;
}

/** Competência padrão para abrir: o mês anterior ao de hoje (na apresentação de outubro, dados de setembro). */
export function competenciaPadrao(hoje = new Date()): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
