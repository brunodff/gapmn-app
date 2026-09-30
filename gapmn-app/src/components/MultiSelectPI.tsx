import { useState, useEffect, useMemo, useRef } from "react";

// Paleta compartilhada com PainelExecucao / PainelRP
const DK = {
  card:      "#161b27",
  cardBorder:"#1e2a3a",
  text:      "#e2e8f0",
  muted:     "#64748b",
  purple:    "#a78bfa",
};

export type OpcaoPi = { codigo: string; desc: string };

export default function MultiSelectPI({
  opcoes, selecionados, onChange, rotuloVazio,
}: {
  opcoes: OpcaoPi[];
  selecionados: Set<string>;
  onChange: (s: Set<string>) => void;
  /** Texto exibido sem seleção. Padrão: "Todos (N)". */
  rotuloVazio?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca,  setBusca]  = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [aberto]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return opcoes;
    return opcoes.filter(o =>
      o.codigo.toLowerCase().includes(q) || o.desc.toLowerCase().includes(q));
  }, [opcoes, busca]);

  const n = selecionados.size;
  const ativo = n > 0;
  const rotulo =
    n === 0 ? (rotuloVazio ?? `Todos (${opcoes.length})`) :
    n === 1 ? Array.from(selecionados)[0] :
    `${n} PI selecionados`;

  function toggle(cod: string) {
    const next = new Set(selecionados);
    if (next.has(cod)) next.delete(cod); else next.add(cod);
    onChange(next);
  }

  const btnMini = {
    fontSize: 10, background: "none", border: `1px solid ${DK.cardBorder}`,
    borderRadius: 5, padding: "2px 8px", cursor: "pointer", color: DK.muted, fontWeight: 600,
  } as const;

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        onClick={() => setAberto(a => !a)}
        style={{
          background: "#0d1117", border: `1px solid ${ativo ? DK.purple : DK.cardBorder}`,
          borderRadius: 8, padding: "5px 10px", fontSize: 12,
          color: ativo ? DK.purple : DK.text, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6, minWidth: 150, maxWidth: 260,
          fontWeight: ativo ? 700 : 400,
        }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rotulo}</span>
        <span style={{ marginLeft: "auto", fontSize: 9, opacity: 0.7 }}>▼</span>
      </button>

      {aberto && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50,
          width: 420, maxWidth: "min(420px, 90vw)",
          background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,.6)", overflow: "hidden",
        }}>
          <input
            autoFocus
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por código ou descrição…"
            style={{
              width: "100%", boxSizing: "border-box", background: "#0d1117",
              border: "none", borderBottom: `1px solid ${DK.cardBorder}`,
              padding: "8px 10px", fontSize: 12, color: DK.text, outline: "none",
            }} />

          <div style={{
            display: "flex", gap: 6, padding: "6px 10px",
            borderBottom: `1px solid ${DK.cardBorder}`, alignItems: "center",
          }}>
            <button onClick={() => onChange(new Set(visiveis.map(o => o.codigo)))} style={btnMini}>
              Selecionar {busca ? "filtrados" : "todos"}
            </button>
            <button onClick={() => onChange(new Set())} style={btnMini}>Limpar</button>
            <span style={{ marginLeft: "auto", fontSize: 10, color: DK.muted }}>
              {n > 0 ? `${n} de ${opcoes.length}` : `${opcoes.length} disponíveis`}
            </span>
          </div>

          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {visiveis.map(o => {
              const on = selecionados.has(o.codigo);
              return (
                <label key={o.codigo} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                  cursor: "pointer", background: on ? "#1e2a3a55" : "transparent",
                  borderBottom: `1px solid ${DK.cardBorder}44`,
                }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(o.codigo)}
                    style={{ accentColor: DK.purple, cursor: "pointer", flexShrink: 0 }} />
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: DK.purple,
                    fontFamily: "monospace", flexShrink: 0,
                  }}>{o.codigo}</span>
                  <span style={{
                    fontSize: 11, color: DK.muted, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{o.desc}</span>
                </label>
              );
            })}
            {!visiveis.length && (
              <div style={{ padding: "14px 10px", fontSize: 11, color: DK.muted, textAlign: "center" }}>
                Nenhum PI encontrado
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
