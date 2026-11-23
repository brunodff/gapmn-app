// Cliente do worker do motor de reajuste: uma instância só por aba, pedidos numerados.
import type { Pedido, Resposta } from "./motor.worker";
import type { ConfigApostilamento, DadosReajuste, MarcacaoChecklist, ResultadoChecagem, ResultadoGeracao } from "./tipos";

type Pendente = { ok: (r: { resultado: unknown; zip?: ArrayBuffer }) => void; erro: (e: Error) => void; progresso?: (etapa: string) => void };

let worker: Worker | null = null;
let seq = 0;
const pendentes = new Map<number, Pendente>();

function obterWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./motor.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<Resposta>) => {
    const r = ev.data;
    // a carga do Python é uma só: as etapas dela valem para todos os pedidos que estão esperando
    if (r.tipo === "progresso") { for (const q of pendentes.values()) q.progresso?.(r.etapa); return; }
    const p = pendentes.get(r.id);
    if (!p) return;
    pendentes.delete(r.id);
    if (r.tipo === "ok") p.ok({ resultado: r.resultado, zip: r.zip });
    else p.erro(new Error(r.erro));
  };
  worker.onerror = (ev) => {
    const e = new Error(ev.message || "o motor parou");
    for (const p of pendentes.values()) p.erro(e);
    pendentes.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

type SemId<T> = T extends { id: number } ? Omit<T, "id"> : never;
function pedir(pedido: SemId<Pedido>, progresso?: (etapa: string) => void, transferir: Transferable[] = []) {
  const id = ++seq;
  return new Promise<{ resultado: unknown; zip?: ArrayBuffer }>((ok, erro) => {
    pendentes.set(id, { ok, erro, progresso });
    obterWorker().postMessage({ ...pedido, id } as Pedido, transferir);
  });
}

/** Configuração no formato que o motor espera (sem os campos só do app). */
const paraMotor = (c: ConfigApostilamento) => ({ ordenador: c.ordenador, aci: c.aci, cidade: c.cidade, ug_apoio: c.ug_apoio, textos_fixos_om: c.textos_fixos_om });

export const motor = {
  iniciar: (progresso?: (etapa: string) => void) => pedir({ tipo: "iniciar" }, progresso).then(() => true),
  checar: async (dados: DadosReajuste, config: ConfigApostilamento, progresso?: (etapa: string) => void) =>
    (await pedir({ tipo: "checar", dados, config: paraMotor(config) }, progresso)).resultado as ResultadoChecagem,
  /** Gera sem o .zip: só os valores e os avisos (botão Conferir). */
  simular: async (dados: DadosReajuste, config: ConfigApostilamento, progresso?: (etapa: string) => void) =>
    (await pedir({ tipo: "gerar", dados, config: paraMotor(config), prints: [], zip: false }, progresso)).resultado as ResultadoGeracao,
  /** Gera o .zip; com `checklist` (as 8 marcações), ele leva também o "5 - Checklist do Fiscal". */
  gerar: async (dados: DadosReajuste, config: ConfigApostilamento, prints: File[], progresso?: (etapa: string) => void, checklist?: MarcacaoChecklist[]) => {
    const arquivos = await Promise.all(prints.map(async (f) => ({ nome: f.name, bytes: await f.arrayBuffer() })));
    const r = await pedir({ tipo: "gerar", dados, config: paraMotor(config), prints: arquivos, zip: true, checklist }, progresso, arquivos.map((a) => a.bytes));
    return { ...(r.resultado as ResultadoGeracao), zip: new Blob([r.zip!], { type: "application/zip" }) };
  },
  /** Só o checklist do fiscal (.docx). */
  checklist: async (dados: DadosReajuste, config: ConfigApostilamento, marcacoes: MarcacaoChecklist[], progresso?: (etapa: string) => void) => {
    const r = await pedir({ tipo: "checklist", dados, config: paraMotor(config), checklist: marcacoes }, progresso);
    const res = r.resultado as { avisos: string[]; arquivo: string };
    return { ...res, docx: new Blob([r.zip!], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }) };
  },
};
