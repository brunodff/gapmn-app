import { useState } from "react";
import biblioteca from "../../lib/aditivos/kit/biblioteca_riscos.json";
import type { EstadoAditivo, Risco } from "../../lib/aditivos/tipos";

// Mapa de Riscos (seção 3A): o fiscal preenche cada risco; "Usar sugestão" traz um risco da biblioteca da SCON
// (biblioteca_riscos.json, filtrada pelo tipo de objeto) e o fiscal edita o que quiser.
type Sugestao = Risco & { id: string; aplica_a: string };
const B = biblioteca as unknown as { ajuda_fiscal: { titulo: string; texto: string[] }; riscos: Sugestao[] };
const PROB = ["Baixa", "Média", "Alta"];
const IMP = ["Baixo", "Médio", "Alto"];
const vazio = (): Risco => ({ nome: "", probabilidade: "", impacto: "", dano: "", acao_preventiva: "", acao_contingencia: "", responsavel_preventiva: "FISCAL", responsavel_contingencia: "FISCAL" });
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cls = "w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-300";

function Escala({ rotulo, opcoes, valor, onChange }: { rotulo: string; opcoes: string[]; valor: string; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="block text-[11px] font-medium text-slate-600 mb-0.5">{rotulo}</span>
      <div className="flex gap-1">
        {opcoes.map((o) => (
          <button key={o} type="button" onClick={() => onChange(o)}
            className={`rounded-md border px-2 py-1 text-xs ${sem(valor) === sem(o) ? "border-sky-500 bg-sky-100 font-semibold text-sky-700" : "border-slate-200 text-slate-600"}`}>{o}</button>
        ))}
      </div>
    </div>
  );
}

export default function MapaRiscos({ riscos, tipo, onChange, onTipo, ro }: {
  riscos: Risco[]; tipo: EstadoAditivo["tipo_risco"]; onChange: (r: Risco[]) => void; onTipo: (t: EstadoAditivo["tipo_risco"]) => void; ro?: boolean;
}) {
  const [ajuda, setAjuda] = useState(false);
  const [sugerir, setSugerir] = useState<number | null>(null);
  const sugestoes = B.riscos.filter((s) => s.aplica_a === "todos" || s.aplica_a === tipo || (tipo === "demo" && s.aplica_a === "servicos"));
  const set = (i: number, campo: keyof Risco, v: string) => onChange(riscos.map((r, j) => (j === i ? { ...r, [campo]: v } : r)));
  const usar = (i: number, s: Sugestao) => {
    onChange(riscos.map((r, j) => (j === i ? { nome: s.nome, probabilidade: s.probabilidade, impacto: s.impacto, dano: s.dano, acao_preventiva: s.acao_preventiva, acao_contingencia: s.acao_contingencia, responsavel_preventiva: r.responsavel_preventiva || "FISCAL", responsavel_contingencia: r.responsavel_contingencia || "FISCAL" } : r)));
    setSugerir(null);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-600">Sugestões para:</span>
        <select className="min-w-0 max-w-full rounded-md border border-slate-200 px-2 py-1" value={tipo} disabled={ro} onChange={(e) => onTipo(e.target.value as EstadoAditivo["tipo_risco"])}>
          <option value="servicos">Serviços</option><option value="demo">Serviços com dedicação exclusiva de mão de obra</option>
          <option value="fornecimento">Fornecimento</option><option value="todos">Só os gerais</option>
        </select>
        <button type="button" onClick={() => setAjuda(!ajuda)} className="ml-auto rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50">❓ Como funciona?</button>
      </div>
      {ajuda && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-slate-700 space-y-1.5">
          <b>{B.ajuda_fiscal.titulo}</b>
          {B.ajuda_fiscal.texto.map((t, i) => <p key={i}>{t}</p>)}
          <p className="text-slate-500">Este texto não vai para o documento.</p>
        </div>
      )}
      {riscos.map((r, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-[#8EAADB] px-2 py-0.5 text-[11px] font-bold text-slate-900">RISCO {String(i + 1).padStart(2, "0")}</span>
            <input className={`${cls} min-w-0 flex-[1_1_12rem]`} placeholder="Nome do risco" value={r.nome} readOnly={ro} onChange={(e) => set(i, "nome", e.target.value)} />
            {!ro && <button type="button" className="text-[11px] text-sky-700 underline" onClick={() => setSugerir(sugerir === i ? null : i)}>Usar sugestão</button>}
            {!ro && <button type="button" className="text-[11px] text-red-600 underline" onClick={() => onChange(riscos.filter((_, j) => j !== i))}>Remover</button>}
          </div>
          {sugerir === i && (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
              {sugestoes.map((s) => (
                <button key={s.id} type="button" onClick={() => usar(i, s)} className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-white">
                  <b>{s.nome}</b> <span className="text-slate-500">({s.probabilidade} / {s.impacto})</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-4">
            <Escala rotulo="Probabilidade" opcoes={PROB} valor={r.probabilidade} onChange={(v) => !ro && set(i, "probabilidade", v)} />
            <Escala rotulo="Impacto" opcoes={IMP} valor={r.impacto} onChange={(v) => !ro && set(i, "impacto", v)} />
          </div>
          <label className="block"><span className="text-[11px] font-medium text-slate-600">Dano</span>
            <textarea className={`${cls} min-h-[48px]`} value={r.dano} readOnly={ro} onChange={(e) => set(i, "dano", e.target.value)} /></label>
          <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
            <label className="block"><span className="text-[11px] font-medium text-slate-600">Ação preventiva</span>
              <textarea className={`${cls} min-h-[48px]`} value={r.acao_preventiva} readOnly={ro} onChange={(e) => set(i, "acao_preventiva", e.target.value)} /></label>
            <label className="block"><span className="text-[11px] font-medium text-slate-600">Responsável</span>
              <input className={cls} value={r.responsavel_preventiva ?? "FISCAL"} readOnly={ro} onChange={(e) => set(i, "responsavel_preventiva", e.target.value)} /></label>
            <label className="block"><span className="text-[11px] font-medium text-slate-600">Ação de contingência</span>
              <textarea className={`${cls} min-h-[48px]`} value={r.acao_contingencia} readOnly={ro} onChange={(e) => set(i, "acao_contingencia", e.target.value)} /></label>
            <label className="block"><span className="text-[11px] font-medium text-slate-600">Responsável</span>
              <input className={cls} value={r.responsavel_contingencia ?? "FISCAL"} readOnly={ro} onChange={(e) => set(i, "responsavel_contingencia", e.target.value)} /></label>
          </div>
        </div>
      ))}
      {!ro && <button type="button" onClick={() => onChange([...riscos, vazio()])} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700">+ Adicionar risco</button>}
      {riscos.length < 2 && <p className="text-[11px] text-amber-700">O modelo prevê pelo menos 2 riscos.</p>}
    </div>
  );
}
