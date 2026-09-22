import { useEffect, useState } from "react";

// ─── Opções ──────────────────────────────────────────────────────────────────
const FONT_SIZES = ["7pt","8pt","9pt","10pt","11pt","12pt","14pt","16pt","18pt","20pt","24pt","28pt","32pt","36pt","48pt"];
const FONT_FAMILIES = [
  { label: "Arial",          value: "Arial, Helvetica, sans-serif" },
  { label: "Times New Roman",value: "Times New Roman, Times, serif" },
  { label: "Courier New",    value: "Courier New, monospace" },
  { label: "Georgia",        value: "Georgia, serif" },
  { label: "Calibri",        value: "Calibri, sans-serif" },
];
const PRESET_COLORS = ["#000000","#1e3a8a","#7f1d1d","#14532d","#78350f","#4c1d95","#374151","#ffffff"];

// ─── Props ───────────────────────────────────────────────────────────────────
interface DocFormatBarProps {
  docRef: React.RefObject<HTMLDivElement | null>;
  onInsertBreak: () => void;
}

// ─── Componente ──────────────────────────────────────────────────────────────
export default function DocFormatBar({ docRef, onInsertBreak }: DocFormatBarProps) {
  const [isBold,      setIsBold]      = useState(false);
  const [isItalic,    setIsItalic]    = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [fontSize,    setFontSize]    = useState("11pt");
  const [fontFamily,  setFontFamily]  = useState("Arial, Helvetica, sans-serif");
  const [brasaoSize,  setBrasaoSizeState] = useState<number>(() => {
    const img = document.querySelector("[data-brasao]") as HTMLImageElement | null;
    return img ? parseInt(img.style.width) || 110 : 110;
  });

  // Rastreia estado da seleção
  useEffect(() => {
    function onSel() {
      try {
        setIsBold(document.queryCommandState("bold"));
        setIsItalic(document.queryCommandState("italic"));
        setIsUnderline(document.queryCommandState("underline"));
      } catch {}
    }
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function exec(cmd: string, value?: string) {
    document.execCommand(cmd, false, value);
    docRef.current?.focus();
  }

  function applyFontSize(size: string) {
    setFontSize(size);
    // Workaround padrão: marca com size=7, depois substitui <font> por <span>
    document.execCommand("fontSize", false, "7");
    const el = docRef.current;
    if (!el) return;
    el.querySelectorAll('font[size="7"]').forEach(font => {
      const span = document.createElement("span");
      span.style.fontSize = size;
      while (font.firstChild) span.appendChild(font.firstChild);
      font.parentNode?.replaceChild(span, font);
    });
    el.focus();
  }

  function applyFontFamily(family: string) {
    setFontFamily(family);
    exec("fontName", family);
  }

  function applyColor(color: string) {
    exec("foreColor", color);
  }

  function applyHighlight(color: string) {
    exec("hiliteColor", color);
  }

  function setBrasaoSize(size: number) {
    setBrasaoSizeState(size);
    const el = docRef.current;
    if (!el) return;
    const img = el.querySelector("[data-brasao]") as HTMLImageElement | null;
    if (img) {
      img.style.width  = `${size}px`;
      img.style.height = `${size}px`;
    }
  }

  // ── Estilos ──────────────────────────────────────────────────────────────
  const btnBase = (active: boolean) =>
    `flex items-center justify-center w-7 h-7 rounded text-[12px] font-medium transition-colors select-none
     ${active
       ? "bg-sky-600 text-white border border-sky-500"
       : "bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600"}`;

  const Sep = () => (
    <div className="w-px self-stretch bg-slate-600 mx-1" />
  );

  const Btn = ({ title, active = false, onClick, children }: {
    title: string; active?: boolean; onClick: () => void; children: React.ReactNode;
  }) => (
    <button
      title={title}
      className={btnBase(active)}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
    >
      {children}
    </button>
  );

  return (
    <div className="print:hidden shrink-0 flex items-center flex-wrap gap-1 bg-slate-900 border-b border-slate-700 px-3 py-1.5">

      {/* Desfazer / Refazer */}
      <Btn title="Desfazer (Ctrl+Z)" onClick={() => exec("undo")}>↩</Btn>
      <Btn title="Refazer (Ctrl+Y)"  onClick={() => exec("redo")}>↪</Btn>

      <Sep />

      {/* Fonte */}
      <select
        value={fontFamily}
        onMouseDown={e => e.stopPropagation()}
        onChange={e => applyFontFamily(e.target.value)}
        className="bg-slate-700 border border-slate-600 text-slate-200 rounded text-[11px] px-1.5 py-0.5 outline-none"
        style={{ maxWidth: 130 }}
      >
        {FONT_FAMILIES.map(f => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      {/* Tamanho da fonte */}
      <select
        value={fontSize}
        onMouseDown={e => e.stopPropagation()}
        onChange={e => applyFontSize(e.target.value)}
        className="bg-slate-700 border border-slate-600 text-slate-200 rounded text-[11px] px-1.5 py-0.5 outline-none w-16"
      >
        {FONT_SIZES.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <Sep />

      {/* Negrito / Itálico / Sublinhado / Tachado */}
      <Btn title="Negrito (Ctrl+B)"   active={isBold}      onClick={() => exec("bold")}>          <strong>B</strong></Btn>
      <Btn title="Itálico (Ctrl+I)"   active={isItalic}    onClick={() => exec("italic")}>        <em>I</em></Btn>
      <Btn title="Sublinhado (Ctrl+U)"active={isUnderline} onClick={() => exec("underline")}>     <u>U</u></Btn>
      <Btn title="Tachado"                                  onClick={() => exec("strikeThrough")}> <s>S</s></Btn>

      <Sep />

      {/* Alinhamento */}
      <Btn title="Alinhar à esquerda" onClick={() => exec("justifyLeft")}>  ⬛⬜</Btn>
      <Btn title="Centralizar"        onClick={() => exec("justifyCenter")}>☰</Btn>
      <Btn title="Alinhar à direita"  onClick={() => exec("justifyRight")}> ⬜⬛</Btn>
      <Btn title="Justificar"         onClick={() => exec("justifyFull")}>  ≡</Btn>

      <Sep />

      {/* Listas */}
      <Btn title="Lista com marcadores"  onClick={() => exec("insertUnorderedList")}>•≡</Btn>
      <Btn title="Lista numerada"        onClick={() => exec("insertOrderedList")}>   1≡</Btn>

      {/* Recuo */}
      <Btn title="Aumentar recuo"  onClick={() => exec("indent")}>  →|</Btn>
      <Btn title="Diminuir recuo"  onClick={() => exec("outdent")}> |←</Btn>

      <Sep />

      {/* Cor do texto */}
      <span className="text-[10px] text-slate-400 select-none">Texto:</span>
      {PRESET_COLORS.map(c => (
        <button
          key={`t-${c}`}
          title={c}
          onMouseDown={e => { e.preventDefault(); applyColor(c); }}
          className="w-4 h-4 rounded border border-slate-500 cursor-pointer flex-shrink-0"
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        defaultValue="#000000"
        title="Cor personalizada do texto"
        onMouseDown={e => e.stopPropagation()}
        onChange={e => applyColor(e.target.value)}
        className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
      />

      <Sep />

      {/* Realce (highlight) */}
      <span className="text-[10px] text-slate-400 select-none">Realce:</span>
      {["#fef08a","#bbf7d0","#bfdbfe","#fecaca","transparent"].map(c => (
        <button
          key={`h-${c}`}
          title={c === "transparent" ? "Remover realce" : c}
          onMouseDown={e => { e.preventDefault(); applyHighlight(c); }}
          className="w-4 h-4 rounded border border-slate-500 cursor-pointer flex-shrink-0"
          style={{ background: c === "transparent" ? "#1e293b" : c }}
        >
          {c === "transparent" && <span className="text-slate-300 text-[8px] leading-none">✕</span>}
        </button>
      ))}

      <Sep />

      {/* Quebra de página */}
      <button
        title="Inserir quebra de página no cursor"
        onMouseDown={e => { e.preventDefault(); onInsertBreak(); }}
        className="flex items-center gap-1 bg-violet-700 hover:bg-violet-600 text-white rounded px-2 h-7 text-[11px] font-medium border border-violet-600"
      >
        ✂ Quebra de pág.
      </button>

      <Sep />

      {/* Brasão */}
      <span className="text-[10px] text-slate-400 select-none">Brasão:</span>
      <input
        type="range" min={50} max={200} step={5}
        value={brasaoSize}
        onMouseDown={e => e.stopPropagation()}
        onChange={e => setBrasaoSize(Number(e.target.value))}
        className="w-20 accent-sky-500"
      />
      <span className="text-[10px] text-slate-300 w-8 select-none">{brasaoSize}px</span>

    </div>
  );
}
