import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Status } from "../../lib/indicadores/tipos.ts";
import { VISUAL_STATUS } from "./visual";

export function StatusChip({ status, curto = false }: { status: Status; curto?: boolean }) {
  const v = VISUAL_STATUS[status];
  return (
    <span className="pg-status" style={{ color: v.texto }} title={status}>
      <v.Icone size={13} color={v.cor} aria-hidden="true" />
      {curto ? v.curto : status}
    </span>
  );
}

export function MultiSelect({ rotulo, opcoes, valores, aoMudar, rotuloOpcao, vazio = "todas" }: {
  rotulo: string;
  opcoes: string[];
  valores: string[];
  aoMudar: (v: string[]) => void;
  rotuloOpcao?: (v: string) => string;
  vazio?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", tecla); };
  }, [aberto]);

  const nome = (v: string) => (rotuloOpcao ? rotuloOpcao(v) : v);
  const resumo = valores.length === 0 ? vazio : valores.length <= 2 ? valores.map(nome).join(", ") : `${valores.length} selecionados`;

  return (
    <div className="pg-multi" ref={ref}>
      <button type="button" className="pg-campo" aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <span className="pg-multi-rotulo">{rotulo}: {resumo}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {aberto && (
        <div className="pg-menu" role="listbox" aria-label={rotulo} aria-multiselectable="true">
          {opcoes.map((o) => (
            <label key={o}>
              <input
                type="checkbox"
                checked={valores.includes(o)}
                onChange={(e) => aoMudar(e.target.checked ? [...valores, o] : valores.filter((v) => v !== o))}
              />
              {nome(o)}
            </label>
          ))}
          {valores.length > 0 && (
            <button type="button" className="pg-btn pg-btn-texto" style={{ marginTop: 4 }} onClick={() => aoMudar([])}>
              Limpar seleção
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Esqueleto com a mesma geometria do painel, para o primeiro carregamento. */
export function Esqueleto() {
  return (
    <div className="pg-tokens pg" aria-busy="true" aria-label="Carregando o Painel de Governança">
      <div className="pg-cabecalho">
        <div className="pg-esqueleto" style={{ width: 320, maxWidth: "70%", height: 24 }} />
        <div className="pg-esqueleto" style={{ width: 150, height: 32 }} />
      </div>
      <div className="pg-cards">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="pg-esqueleto" style={{ height: 96 }} />)}
      </div>
      <div className="pg-principal">
        <div className="pg-esqueleto" style={{ height: 620 }} />
        <div className="pg-coluna">
          <div className="pg-esqueleto" style={{ height: 170 }} />
          <div className="pg-esqueleto" style={{ height: 220 }} />
          <div className="pg-esqueleto" style={{ height: 260 }} />
        </div>
      </div>
    </div>
  );
}
