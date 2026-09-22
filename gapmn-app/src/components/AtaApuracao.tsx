import { useState, useRef, useCallback, useEffect } from "react";

// ─── Web Speech API types ────────────────────────────────────────────────────
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

// ─── Seções da ata ───────────────────────────────────────────────────────────
interface Campo {
  key: string;
  label: string;
  placeholder: string;
  rows: number;
  hint?: string;
}

const CAMPOS: Campo[] = [
  {
    key: "numero",
    label: "Número da Ata / Processo",
    placeholder: "Ex: Ata nº 001/2026 — Processo nº 67000.000001/2026-01",
    rows: 1,
    hint: "Fale o número da ata e do processo administrativo",
  },
  {
    key: "abertura",
    label: "Abertura — Data, Hora e Local",
    placeholder: "Ex: Aos vinte e cinco dias do mês de agosto de dois mil e vinte e seis, às quatorze horas, nas dependências do GAP-MN, situado em Manaus/AM...",
    rows: 3,
    hint: "Dite a data por extenso, hora e localização da reunião",
  },
  {
    key: "comissao",
    label: "Membros da Comissão",
    placeholder: "Ex: ...reuniram-se os membros da Comissão de Sindicância designada pela Portaria nº 001/GAPMN/2026, a saber: Presidente: 1º Ten João Silva; Membro: Sgt Pedro Alves; Membro: Cb Maria Santos.",
    rows: 4,
    hint: "Mencione nome, posto/graduação e função de cada membro",
  },
  {
    key: "interessado",
    label: "Interessado / Acusado",
    placeholder: "Ex: Tendo como interessado o 3º Sgt João da Silva, matrícula 12345-6, lotado na Seção de Contratos deste Grupamento.",
    rows: 2,
    hint: "Nome completo, posto/graduação, matrícula e lotação",
  },
  {
    key: "objeto",
    label: "Objeto da Apuração",
    placeholder: "Descreva os fatos que motivaram a abertura do processo disciplinar, com datas e circunstâncias...",
    rows: 5,
    hint: "Relate os fatos com clareza: o que aconteceu, quando, onde e quem estava envolvido",
  },
  {
    key: "diligencias",
    label: "Diligências Realizadas",
    placeholder: "Ex: A comissão procedeu à oitiva das seguintes pessoas: [...]. Foram juntados aos autos os seguintes documentos: [...].",
    rows: 5,
    hint: "Liste oitivas realizadas, documentos coletados, perícias e demais diligências",
  },
  {
    key: "conclusao",
    label: "Deliberação / Conclusão",
    placeholder: "Ex: Diante do exposto, a Comissão concluiu que os fatos apurados configuram [...] / não restaram configuradas irregularidades [...]. Propõe-se [...].",
    rows: 4,
    hint: "Informe a conclusão da comissão e a proposta de deliberação",
  },
  {
    key: "encerramento",
    label: "Encerramento",
    placeholder: "Ex: Nada mais havendo a tratar, foi encerrada a presente ata, que vai assinada pelos membros da comissão.",
    rows: 2,
  },
  {
    key: "assinaturas",
    label: "Assinaturas (separe por ponto e vírgula)",
    placeholder: "Ex: 1º Ten João Silva — Presidente; Sgt Pedro Alves — Membro; Cb Maria Santos — Membro",
    rows: 2,
    hint: "Nome, posto e função de cada signatário, separados por ponto e vírgula",
  },
];

type Valores = Record<string, string>;
const INITIAL: Valores = Object.fromEntries(CAMPOS.map(c => [c.key, ""]));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function montarTextoAta(valores: Valores): string {
  const v = valores;
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  const assinantes = (v.assinaturas || "")
    .split(";")
    .map(s => s.trim())
    .filter(Boolean);

  const linhaAss = assinantes.length > 0
    ? assinantes.map(a => `______________________________\n${a}`).join("\n\n")
    : "______________________________\n[Assinaturas dos membros da comissão]";

  return [
    `ATA DE APURAÇÃO${v.numero ? ` — ${v.numero}` : ""}`,
    "",
    v.abertura || "[Data, hora e local não informados]",
    "",
    "MEMBROS DA COMISSÃO:",
    v.comissao || "[Não informado]",
    "",
    "INTERESSADO:",
    v.interessado || "[Não informado]",
    "",
    "OBJETO DA APURAÇÃO:",
    v.objeto || "[Não informado]",
    "",
    "DILIGÊNCIAS REALIZADAS:",
    v.diligencias || "[Não informado]",
    "",
    "DELIBERAÇÃO:",
    v.conclusao || "[Não informado]",
    "",
    v.encerramento || "Nada mais havendo a tratar, foi encerrada a presente ata, que vai assinada pelos membros presentes.",
    "",
    "",
    linhaAss,
    "",
    `Gerado em ${hoje} via GAPMN App`,
  ].join("\n");
}

function gerarHTML(valores: Valores): string {
  const v = valores;
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  const assinantes = (v.assinaturas || "")
    .split(";")
    .map(s => s.trim())
    .filter(Boolean);

  const blocoAssinatura = assinantes.length > 0
    ? assinantes.map(a => `<div class="assinante"><div class="linha-ass">${a}</div></div>`).join("")
    : `<div class="assinante"><div class="linha-ass">[Presidente]</div></div>
       <div class="assinante"><div class="linha-ass">[Membro]</div></div>`;

  const secao = (label: string, texto: string) =>
    texto ? `<div class="secao"><div class="secao-label">${label}</div><div class="secao-texto">${texto.replace(/\n/g, "<br>")}</div></div>` : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Ata de Apuração${v.numero ? " — " + v.numero : ""}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000; padding: 40px 55px; }
  h1 { text-align: center; font-size: 15pt; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 6px; font-weight: bold; }
  .numero { text-align: center; font-size: 11pt; margin-bottom: 28px; color: #333; }
  .abertura { text-align: justify; line-height: 1.7; margin-bottom: 20px; }
  .secao { margin-bottom: 20px; }
  .secao-label { font-weight: bold; text-transform: uppercase; font-size: 11pt; margin-bottom: 5px; border-bottom: 1px solid #aaa; padding-bottom: 3px; }
  .secao-texto { text-align: justify; line-height: 1.7; padding-top: 4px; }
  .encerramento { margin-top: 16px; text-align: justify; line-height: 1.7; }
  .assinaturas { margin-top: 48px; display: flex; gap: 40px; flex-wrap: wrap; justify-content: center; }
  .assinante { text-align: center; min-width: 200px; }
  .linha-ass { border-top: 1px solid #000; padding-top: 6px; margin-top: 52px; font-size: 10pt; line-height: 1.4; }
  .rodape { margin-top: 32px; font-size: 8pt; color: #999; text-align: right; border-top: 1px solid #eee; padding-top: 6px; }
  @media print {
    body { padding: 20px 30px; }
    @page { margin: 18mm; size: A4; }
  }
</style>
</head>
<body>
  <h1>Ata de Apuração</h1>
  ${v.numero ? `<div class="numero">${v.numero}</div>` : ""}

  ${v.abertura ? `<div class="abertura">${v.abertura.replace(/\n/g, "<br>")}</div>` : ""}

  ${secao("Membros da Comissão", v.comissao)}
  ${secao("Interessado", v.interessado)}
  ${secao("Objeto da Apuração", v.objeto)}
  ${secao("Diligências Realizadas", v.diligencias)}
  ${secao("Deliberação", v.conclusao)}

  <div class="encerramento">${(v.encerramento || "Nada mais havendo a tratar, foi encerrada a presente ata, que vai assinada pelos membros presentes.").replace(/\n/g, "<br>")}</div>

  <div class="assinaturas">${blocoAssinatura}</div>

  <div class="rodape">Gerado em ${hoje} via GAPMN App — Sistema de Gestão GAP-MN</div>
</body>
</html>`;
}

// ─── Componente principal ────────────────────────────────────────────────────
export default function AtaApuracao() {
  const [valores, setValores] = useState<Valores>(INITIAL);
  const [escutando, setEscutando] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [aba, setAba] = useState<"formulario" | "preview">("formulario");
  const [campoAtivo, setCampoAtivo] = useState(0);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);

  const suportaVoz = !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );

  // Limpa reconhecimento ao desmontar
  useEffect(() => () => { recRef.current?.stop(); }, []);

  const pararVoz = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setEscutando(null);
    setInterim("");
  }, []);

  const iniciarVoz = useCallback((key: string) => {
    if (!suportaVoz) {
      alert("Reconhecimento de voz não disponível.\nUse Google Chrome ou Microsoft Edge.");
      return;
    }
    if (escutando) pararVoz();

    const SR: new () => SpeechRecognitionInstance =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalChunk += transcript;
        else interimChunk += transcript;
      }
      if (finalChunk) {
        setValores(prev => ({
          ...prev,
          [key]: (prev[key] ? prev[key] + " " : "") + finalChunk.trim(),
        }));
      }
      setInterim(interimChunk);
    };

    rec.onerror = () => pararVoz();
    rec.onend = () => { setEscutando(null); setInterim(""); };

    rec.start();
    recRef.current = rec;
    setEscutando(key);
    setInterim("");
  }, [escutando, pararVoz, suportaVoz]);

  function handleDownloadPDF() {
    const win = window.open("", "_blank");
    if (!win) { alert("Permita pop-ups para gerar o PDF."); return; }
    win.document.write(gerarHTML(valores));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }

  function handleLimpar() {
    if (Object.values(valores).some(v => v.trim())) {
      if (!confirm("Limpar todos os campos e começar uma nova ata?")) return;
    }
    pararVoz();
    setValores(INITIAL);
    setCampoAtivo(0);
    setAba("formulario");
  }

  const preenchidos = CAMPOS.filter(c => valores[c.key].trim()).length;
  const progresso = Math.round((preenchidos / CAMPOS.length) * 100);

  return (
    <div className="space-y-4">

      {/* ── Cabeçalho ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-slate-800">
              🎙️ Ata de Apuração — Digitação por Voz
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {suportaVoz
                ? "Clique em Ditar ao lado de cada campo e fale — a transcrição é automática"
                : "⚠️ Reconhecimento de voz indisponível — use Google Chrome ou Edge"}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Abas */}
            <div className="flex rounded-xl border border-slate-200 overflow-hidden text-xs font-medium">
              <button
                onClick={() => setAba("formulario")}
                className={`px-3 py-1.5 transition-colors ${aba === "formulario" ? "bg-sky-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                ✏️ Formulário
              </button>
              <button
                onClick={() => setAba("preview")}
                className={`px-3 py-1.5 border-l border-slate-200 transition-colors ${aba === "preview" ? "bg-sky-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                👁️ Pré-visualizar
              </button>
            </div>

            <button
              onClick={handleDownloadPDF}
              className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition-colors"
            >
              ⬇ PDF
            </button>

            <button
              onClick={handleLimpar}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 transition-colors"
            >
              ↺ Nova ata
            </button>
          </div>
        </div>

        {/* Barra de progresso */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 overflow-hidden rounded-full bg-slate-100 h-1.5">
            <div
              className="h-full rounded-full bg-sky-500 transition-all duration-500"
              style={{ width: `${progresso}%` }}
            />
          </div>
          <span className="text-xs text-slate-400 shrink-0">
            {preenchidos}/{CAMPOS.length} campos preenchidos
          </span>
        </div>
      </div>

      {/* ── Aviso navegador ── */}
      {!suportaVoz && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <strong>Reconhecimento de voz não disponível.</strong> Este recurso funciona apenas no Google Chrome e Microsoft Edge.
          Você ainda pode digitar o texto diretamente nos campos abaixo.
        </div>
      )}

      {/* ── Formulário ── */}
      {aba === "formulario" && (
        <div className="space-y-3">
          {CAMPOS.map((campo, idx) => {
            const isListening = escutando === campo.key;
            const temConteudo = !!valores[campo.key].trim();
            const isAtivo = campoAtivo === idx;

            return (
              <div
                key={campo.key}
                className={`rounded-xl border bg-white transition-shadow ${
                  isListening
                    ? "border-sky-400 shadow-md shadow-sky-100"
                    : isAtivo
                      ? "border-slate-300 shadow-sm"
                      : "border-slate-200"
                }`}
              >
                {/* Header do campo */}
                <div
                  className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 cursor-pointer"
                  onClick={() => setCampoAtivo(idx)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Indicador */}
                    <div className={`shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      temConteudo ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-400"
                    }`}>
                      {temConteudo ? "✓" : idx + 1}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-700">{campo.label}</div>
                      {campo.hint && (
                        <div className="text-[10px] text-slate-400 leading-tight">{campo.hint}</div>
                      )}
                    </div>
                  </div>

                  {/* Botão microfone */}
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setCampoAtivo(idx);
                      isListening ? pararVoz() : iniciarVoz(campo.key);
                    }}
                    disabled={!suportaVoz}
                    title={isListening ? "Parar gravação" : "Iniciar ditado"}
                    className={`shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                      isListening
                        ? "bg-red-500 text-white shadow-sm animate-pulse"
                        : suportaVoz
                          ? "bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-100"
                          : "bg-slate-100 text-slate-300 cursor-not-allowed"
                    }`}
                  >
                    <span className="text-sm">{isListening ? "⏹" : "🎙️"}</span>
                    <span>{isListening ? "Parar" : "Ditar"}</span>
                  </button>
                </div>

                {/* Prévia da transcrição em tempo real */}
                {isListening && (interim || true) && (
                  <div className="mx-4 mb-2 flex items-start gap-2">
                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-xs text-sky-700 italic">
                      {interim || "Ouvindo… fale agora"}
                    </span>
                  </div>
                )}

                {/* Textarea */}
                <div className="px-4 pb-4">
                  <textarea
                    rows={campo.rows}
                    value={valores[campo.key]}
                    onChange={e => setValores(prev => ({ ...prev, [campo.key]: e.target.value }))}
                    onFocus={() => setCampoAtivo(idx)}
                    placeholder={campo.placeholder}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-y leading-relaxed"
                  />
                </div>
              </div>
            );
          })}

          {/* Botão avançar para preview */}
          {preenchidos >= 3 && (
            <button
              onClick={() => setAba("preview")}
              className="w-full rounded-xl border border-sky-200 bg-sky-50 py-2.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
            >
              👁️ Ver pré-visualização da ata →
            </button>
          )}
        </div>
      )}

      {/* ── Pré-visualização ── */}
      {aba === "preview" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* Barra de ação */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <span className="text-xs font-semibold text-slate-600">Pré-visualização da Ata</span>
            <div className="flex gap-2">
              <button
                onClick={() => setAba("formulario")}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                ← Editar
              </button>
              <button
                onClick={handleDownloadPDF}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
              >
                ⬇ Baixar PDF
              </button>
            </div>
          </div>

          {/* Texto da ata */}
          <div className="p-6 sm:p-8">
            <pre className="whitespace-pre-wrap font-serif text-sm text-slate-800 leading-[1.8]">
              {montarTextoAta(valores)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
