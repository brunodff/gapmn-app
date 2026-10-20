import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import PainelRP from "../components/PainelRP";
import CnetRoboGapmn from "../components/CnetRoboGapmn";
import PainelProcessos from "../components/PainelProcessos";
import PainelExecucao from "../components/PainelExecucao";
import PainelGovernanca from "../components/painelGovernanca";
import PainelOrcamentario from "../components/painelOrcamentario";

const GOV_URL =
  "https://app.powerbi.com/view?r=eyJrIjoiMGI0ZDUxZDAtOTQzOC00YmNiLTk1OTctYzA1NDk5MjkxMDNjIiwidCI6IjNhMzY0ZGI2LTg2NmEtNDRkOS1iMzY5LWM1ODk1OWQ0NDhmOCJ9";

type Painel = "orcamentario" | "rp" | "processos" | "execucao" | "governanca";
const PAINEIS: Painel[] = ["orcamentario", "rp", "processos", "execucao", "governanca"];

export default function PaineisGerenciaisPage() {
  const nav = useNavigate();
  // A aba fica na URL (?painel=governanca), para o painel poder ser compartilhado por link já filtrado.
  const [params, setParams] = useSearchParams();
  const painelUrl = params.get("painel") as Painel | null;
  const painel: Painel = painelUrl && PAINEIS.includes(painelUrl) ? painelUrl : "orcamentario";
  const setPainel = (p: Painel) => setParams(p === "orcamentario" ? {} : { painel: p });
  const [userSetor, setUserSetor] = useState<string | null>(null);
  const [perfilCarregado, setPerfilCarregado] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (uid) {
        const { data } = await supabase
          .from("profiles").select("setor").eq("id", uid).maybeSingle();
        setUserSetor((data as any)?.setor?.toUpperCase() ?? null);
      }
      setPerfilCarregado(true);
    })();
  }, []);

  const isAdmin = userSetor === "ADMIN" || userSetor === "DEV";

  return (
    <>
      <div className="flex flex-col gap-3">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Painéis Gerenciais</h2>
            <p className="text-xs text-slate-500">GAP-MN e subordinadas</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => nav("/app")}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              ← Voltar
            </button>
          </div>
        </div>

        {/* ── Seletor de painel ── */}
        <div className="flex gap-2 border-b border-slate-200 pb-0 overflow-x-auto">
          {([
            ["orcamentario", "💰 Painel Orçamentário"],
            ["rp",           "📋 Painel de RP"],
            ["processos",    "🤖 Painel de Processos"],
            ["execucao",     "📈 Painel de Execução"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPainel(key)}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
                painel === key
                  ? "border-sky-600 text-sky-700"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
          {isAdmin && (
            <button
              onClick={() => setPainel("governanca")}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
                painel === "governanca"
                  ? "border-purple-600 text-purple-700"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              🏛️ Painel de Governança
            </button>
          )}
        </div>

        {/* ── Conteúdo ── */}
        {painel === "orcamentario" && (
          <PainelOrcamentario />
        )}

        {painel === "rp" && (
          <PainelRP />
        )}

        {painel === "processos" && (
          <PainelProcessos />
        )}

        {painel === "execucao" && (
          <PainelExecucao />
        )}

        {painel === "governanca" && (
          !perfilCarregado ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Carregando…
            </div>
          ) : isAdmin ? (
            <PainelGovernanca urlPowerBI={GOV_URL} />
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
              🔒 Acesso restrito a administradores do sistema.
            </div>
          )
        )}
      </div>
    </>
  );
}
