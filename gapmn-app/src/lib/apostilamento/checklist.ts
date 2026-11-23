// Checklist do fiscal: LISTA DE VERIFICAÇÃO DE DOCUMENTOS PARA REAJUSTE CONTRATUAL, como o checklist.py do
// pacote da SCON (versão 3.3), no mesmo padrão do robô offline antigo: 8 itens fixos, SIM ou NÃO (um exclui
// o outro), justificativa só no NÃO. Os avisos não impedem gerar (o robô antigo também não impedia).
import type { MarcacaoChecklist } from "./tipos.ts";

export const ITENS_CHECKLIST = [
  "Memória de Cálculo para o Reajuste",
  "Comprovante do cálculo da Calculadora do Cidadão (Banco Central) ou fonte equivalente (ex.: FGV, para o INCC)",
  "Parecer Técnico de Reajustamento",
  "Declaração de Disponibilidade Orçamentária",
  "Procuração do representante competente para assinatura do Termo de Apostilamento (se diferente de quem assinou o contrato)",
  "Cópia de designação do Ordenador de Despesas",
  "Cópia de designação do Agente de Controle Interno",
  "Cópia de designação da Fiscalização",
];

export const checklistVazio = (): MarcacaoChecklist[] => ITENS_CHECKLIST.map(() => ({ sim: false, nao: false, obs: "" }));

/** Sempre os 8 itens; SIM e NÃO juntos vale o NÃO; justificativa de item SIM é descartada */
export function normalizarChecklist(marcacoes: Partial<MarcacaoChecklist>[] | null | undefined): MarcacaoChecklist[] {
  return checklistVazio().map((_, i) => {
    const m = marcacoes?.[i] ?? {};
    const nao = !!m.nao;
    return { sim: !!m.sim && !nao, nao, obs: nao ? String(m.obs ?? "") : "" };
  });
}

/** Marca SIM ou NÃO num item: marcar um desmarca o outro; sair do NÃO apaga a justificativa */
export function marcar(lista: MarcacaoChecklist[], i: number, campo: "sim" | "nao", valor: boolean): MarcacaoChecklist[] {
  return lista.map((m, j) => {
    if (j !== i) return m;
    const x = { ...m, [campo]: valor };
    if (campo === "sim" && valor) x.nao = false;
    if (campo === "nao" && valor) x.sim = false;
    if (!x.nao) x.obs = "";
    return x;
  });
}

/** Itens sem marcação e NÃO sem justificativa (mesmas mensagens do conferir() do motor) */
export function avisosChecklist(marcacoes: MarcacaoChecklist[] | null | undefined): string[] {
  return normalizarChecklist(marcacoes).flatMap((m, i) =>
    !m.sim && !m.nao ? [`Item ${i + 1} sem marcação (SIM ou NÃO).`]
      : m.nao && !m.obs.trim() ? [`Item ${i + 1} marcado NÃO sem justificativa.`] : []);
}

/** O fiscal começou o checklist? (sem nenhuma marcação, ele não vai no .zip) */
export const checklistIniciado = (marcacoes: MarcacaoChecklist[] | null | undefined) => !!marcacoes?.some((m) => m.sim || m.nao);
