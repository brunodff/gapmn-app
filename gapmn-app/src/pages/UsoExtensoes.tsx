import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";

// Contagem anônima de uso das extensões (tabela uso_extensoes, função
// resumo_uso_extensoes — só perfil DEV). Cada instalação tem um código aleatório;
// "usuário" aqui = instalação.

interface ResumoExtensao {
  extensao: string;
  hoje: number;
  semana: number;
  mes: number;
  total: number;
  aberturas_mes: number;
  versoes: Record<string, number> | null;
  uasgs: Record<string, number> | null;
  navegadores: Record<string, number> | null;
  por_dia: Record<string, number> | null;
}

const NOMES: Record<string, string> = {
  "painel-comprasnet": "Painel ComprasNet",
  "robo-empenhos": "Robô de Empenhos",
  "ob-siloms": "Extensão de OB",
};

// "1.15.0" > "1.9.2"
function compararVersoes(a: string, b: string) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function Lista({ titulo, dados, ordenar, destaque }: {
  titulo: string;
  dados: Record<string, number> | null;
  ordenar?: (a: [string, number], b: [string, number]) => number;
  destaque?: string;
}) {
  const linhas = Object.entries(dados ?? {}).sort(ordenar ?? ((a, b) => b[1] - a[1]));
  const total = linhas.reduce((s, [, n]) => s + n, 0) || 1;
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{titulo}</h3>
      {linhas.length === 0 && <p className="text-sm text-slate-400">—</p>}
      <ul className="space-y-2">
        {linhas.map(([nome, n]) => (
          <li key={nome} className="text-sm">
            <div className="flex justify-between gap-2">
              <span className={nome === destaque ? "font-semibold text-emerald-700" : "text-slate-700"}>
                {nome === "?" ? "não identificada" : nome}{nome === destaque ? " (atual)" : ""}
              </span>
              <span className="text-slate-500 tabular-nums">{n}</span>
            </div>
            <div className="h-1.5 rounded bg-slate-100 mt-1">
              <div className="h-1.5 rounded bg-blue-500" style={{ width: `${(n / total) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GraficoDias({ porDia }: { porDia: Record<string, number> | null }) {
  const hoje = new Date();
  const dias = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() - 29 + i);
    const chave = d.toLocaleDateString("sv-SE", { timeZone: "America/Manaus" });
    return { chave, n: porDia?.[chave] ?? 0 };
  });
  const max = Math.max(1, ...dias.map(d => d.n));
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Usuários por dia (30 dias)</h3>
      <div className="flex items-end gap-1 h-28">
        {dias.map(d => (
          <div key={d.chave} className="flex-1 flex flex-col justify-end h-full" title={`${d.chave.split("-").reverse().join("/")}: ${d.n}`}>
            <div className="rounded-t bg-blue-500 min-h-[2px]" style={{ height: `${(d.n / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>{dias[0].chave.split("-").reverse().slice(0, 2).join("/")}</span>
        <span>hoje</span>
      </div>
    </div>
  );
}

export default function UsoExtensoes() {
  const [dados, setDados] = useState<ResumoExtensao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.rpc("resumo_uso_extensoes");
    if (error) setErro(error.message);
    else setDados((data as ResumoExtensao[]) ?? []);
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Uso das extensões</h1>
            <p className="text-sm text-slate-500 mt-0.5">Contagem anônima: cada instalação conta como um usuário · sem nome, CPF ou e-mail</p>
          </div>
          <button
            onClick={carregar}
            disabled={carregando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw size={14} className={carregando ? "animate-spin" : ""} /> Atualizar
          </button>
        </div>

        {erro && <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">Não consegui carregar: {erro}</div>}

        {!erro && dados && dados.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white text-slate-500 text-sm p-6 text-center">
            Nenhum uso registrado ainda. A contagem começa quando as pessoas abrirem a versão 1.15.0 do Painel ComprasNet.
          </div>
        )}

        {dados?.map(e => {
          const versaoAtual = Object.keys(e.versoes ?? {}).filter(v => v !== "?").sort(compararVersoes).pop();
          return (
            <section key={e.extensao} className="space-y-3">
              <h2 className="text-lg font-semibold text-slate-800">{NOMES[e.extensao] ?? e.extensao}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([["Hoje", e.hoje], ["Últimos 7 dias", e.semana], ["Últimos 30 dias", e.mes], ["Desde o início", e.total]] as const).map(([rotulo, n]) => (
                  <div key={rotulo} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
                    <div className="text-xs text-slate-500">{rotulo}</div>
                    <div className="text-2xl font-bold text-slate-800 tabular-nums">{n}</div>
                    <div className="text-[11px] text-slate-400">usuário(s)</div>
                  </div>
                ))}
              </div>
              <GraficoDias porDia={e.por_dia} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Lista titulo="Versões em uso (30 dias)" dados={e.versoes} destaque={versaoAtual}
                  ordenar={(a, b) => compararVersoes(b[0], a[0])} />
                <Lista titulo="UASG (30 dias)" dados={e.uasgs} />
                <Lista titulo="Navegador (30 dias)" dados={e.navegadores} />
              </div>
              <p className="text-xs text-slate-400">{e.aberturas_mes} abertura(s) do painel nos últimos 30 dias.</p>
            </section>
          );
        })}
      </div>
    </div>
  );
}
