import { useState, useEffect, useRef } from "react";

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface LogEntry { ts: string; msg: string; }

interface SicafResult {
  pdfFile: string;
  cnpj:    string;
}

// ─── Formata CNPJ ─────────────────────────────────────────────────────────────
function fmtCnpj(raw: string) {
  const c = raw.replace(/\D/g, "");
  if (c.length !== 14) return raw;
  return `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,8)}/${c.slice(8,12)}-${c.slice(12)}`;
}

// ─── Componente ──────────────────────────────────────────────────────────────
export default function SicafBot() {
  const [disponivel, setDisponivel]  = useState(false);
  const [running,    setRunning]     = useState(false);
  const [log,        setLog]         = useState<string[]>([]);
  const [result,     setResult]      = useState<SicafResult | null>(null);
  const [error,      setError]       = useState<string | null>(null);

  const [cpf,   setCpf]   = useState(() => localStorage.getItem("sicaf_cpf")   || "");
  const [senha, setSenha] = useState(() => localStorage.getItem("sicaf_senha") || "");
  const [cnpj,  setCnpj]  = useState("");

  const logRef     = useRef<HTMLDivElement>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling disponibilidade do servidor ───────────────────────────────────
  useEffect(() => {
    const check = () => {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      fetch("http://localhost:3333/status-sicaf", { signal: ctrl.signal })
        .then(r => { clearTimeout(timer); setDisponivel(r.ok); })
        .catch(() => { clearTimeout(timer); setDisponivel(false); });
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (cpf)   localStorage.setItem("sicaf_cpf",   cpf);   }, [cpf]);
  useEffect(() => { if (senha) localStorage.setItem("sicaf_senha", senha); }, [senha]);

  // ── Executa bot ───────────────────────────────────────────────────────────
  async function rodar() {
    if (!cpf || !senha || !cnpj) return;

    // Verifica servidor
    const ok = await fetch("http://localhost:3333/status-sicaf")
      .then(r => r.ok).catch(() => false);
    if (!ok) {
      setError("Servidor não encontrado. Execute: node server.js");
      return;
    }

    setRunning(true);
    setLog(["⏳ Iniciando..."]);
    setResult(null);
    setError(null);

    try {
      await fetch("http://localhost:3333/rodar-sicaf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf: cpf.replace(/\D/g, ""), senha, cnpj }),
      });

      // Polling de status
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const res  = await fetch("http://localhost:3333/status-sicaf").catch(() => null);
        if (!res) return;
        const data = await res.json();
        const msgs = (data.log ?? []).map((l: LogEntry) => l.msg);
        setLog(msgs.length ? msgs : ["⏳ Aguardando..."]);
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
        if (!data.running) {
          clearInterval(pollRef.current!);
          setRunning(false);
          if (data.result) setResult(data.result);
          if (data.error)  setError(data.error);
        }
      }, 1500);
    } catch {
      setError("Erro ao iniciar o bot. Verifique: node server.js");
      setRunning(false);
    }
  }

  // ── Download PDF ──────────────────────────────────────────────────────────
  function baixarPdf() {
    const link = document.createElement("a");
    link.href = "http://localhost:3333/download-sicaf";
    link.download = `SICAF_${cnpj.replace(/\D/g, "")}.pdf`;
    link.click();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 max-w-xl">

      {/* Cabeçalho */}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-slate-900">🏢 SICAF — Situação do Fornecedor</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${disponivel ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
            {disponivel ? "● servidor online" : "● servidor offline"}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          Baixa o documento <em>Situação do Fornecedor</em> do comprasnet.gov.br via login gov.br.
          Não requer VPN — qualquer máquina com internet pode executar.
        </p>
      </div>

      {!disponivel && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          <strong>Servidor offline.</strong> Abra um terminal na pasta <code className="bg-amber-100 px-1 rounded">siloms-bot</code> e execute:
          <code className="block mt-1 bg-amber-100 px-2 py-1 rounded font-mono">node server.js</code>
        </div>
      )}

      {/* Formulário */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="text-slate-500 font-semibold uppercase text-[10px] block mb-1">CPF (só números)</label>
            <input
              value={cpf}
              onChange={e => setCpf(e.target.value.replace(/\D/g, ""))}
              placeholder="00000000000"
              maxLength={11}
              disabled={running}
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="text-slate-500 font-semibold uppercase text-[10px] block mb-1">Senha gov.br</label>
            <input
              type="password"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              placeholder="••••••••"
              disabled={running}
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-50"
            />
          </div>
          <div className="col-span-2">
            <label className="text-slate-500 font-semibold uppercase text-[10px] block mb-1">CNPJ da empresa</label>
            <input
              value={cnpj}
              onChange={e => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
              disabled={running}
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200 font-mono disabled:bg-slate-50"
            />
          </div>
        </div>

        <button
          onClick={rodar}
          disabled={running || !disponivel || !cpf || !senha || !cnpj}
          className="w-full rounded-xl bg-sky-600 text-white py-2.5 text-sm font-medium hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? "🔄 Executando — aguarde..." : "🔍 Buscar SICAF"}
        </button>
      </div>

      {/* Log de execução */}
      {log.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Log de execução</span>
            {running && <span className="text-[10px] text-emerald-400 animate-pulse">● rodando</span>}
          </div>
          <div ref={logRef}
            className="text-green-400 font-mono text-[10px] p-3 h-44 overflow-y-auto space-y-0.5">
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {/* Sucesso + download */}
      {result && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-emerald-800">✅ SICAF gerado com sucesso!</p>
            <p className="text-xs text-emerald-600 mt-0.5">
              CNPJ: <span className="font-mono font-semibold">{result.cnpj || fmtCnpj(cnpj)}</span>
            </p>
          </div>
          <button
            onClick={baixarPdf}
            className="w-full rounded-xl border-2 border-emerald-400 bg-emerald-600 text-white py-2.5 text-sm font-semibold hover:bg-emerald-700"
          >
            ⬇ Baixar PDF — Situação do Fornecedor
          </button>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <strong>Erro:</strong> {error}
        </div>
      )}
    </div>
  );
}
