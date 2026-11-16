import { useEffect, useState, type ReactNode } from "react";

// Campos simples das telas de reajuste (texto, número no formato brasileiro, caixa de marcar, seção).

export function Secao({ titulo, children, direita }: { titulo: string; children: ReactNode; direita?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
        {direita}
      </div>
      {children}
    </section>
  );
}

export function Campo({ rotulo, valor, onChange, ro, placeholder, longo, dica }: {
  rotulo: string; valor: string; onChange: (v: string) => void; ro?: boolean; placeholder?: string; longo?: boolean; dica?: string;
}) {
  const cls = "w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-sky-300 read-only:bg-slate-50";
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-600 mb-0.5">{rotulo}</span>
      {longo
        ? <textarea className={`${cls} min-h-[70px]`} value={valor} readOnly={ro} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input className={cls} value={valor} readOnly={ro} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
      {dica && <span className="block text-[10px] text-slate-400 mt-0.5">{dica}</span>}
    </label>
  );
}

export function Caixa({ rotulo, marcado, onChange, ro }: { rotulo: string; marcado: boolean; onChange: (v: boolean) => void; ro?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-700 mt-2 cursor-pointer">
      <input type="checkbox" checked={marcado} disabled={ro} onChange={(e) => onChange(e.target.checked)} />
      {rotulo}
    </label>
  );
}

/** "1.234,56" → 1234.56; aceita também "1234.56". Vazio → null. */
export function lerNumero(s: string): number | null {
  const t = s.replace(/R\$\s*/i, "").trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}
export const fmtNumero = (v: number | null | undefined, casas = 2) =>
  v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: Math.max(casas, 6) });
export const brl = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

/** Número no formato brasileiro: guarda o texto enquanto a pessoa digita e converte ao sair do campo. */
export function CampoNumero({ valor, onChange, casas = 2, className = "", placeholder }: {
  valor: number | null | undefined; onChange: (v: number | null) => void; casas?: number; className?: string; placeholder?: string;
}) {
  const [txt, setTxt] = useState(fmtNumero(valor, casas));
  const [editando, setEditando] = useState(false);
  useEffect(() => { if (!editando) setTxt(fmtNumero(valor, casas)); }, [valor, casas, editando]);
  return (
    <input className={`rounded border border-slate-200 px-1.5 py-1 text-right text-xs ${className}`} value={txt} placeholder={placeholder}
      onFocus={() => setEditando(true)} onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { setEditando(false); onChange(lerNumero(txt)); }} />
  );
}
