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

interface Equipe { id: string; nome: string; uasgs: string[]; anotacoes: number; criado_em: string }

// Equipes do Painel ComprasNet: cada uma tem um código que dá acesso às anotações
// das suas UASGs. O código só existe na criação; aqui o DEV gera outro se perderem.
function EquipesPainel() {
  const [equipes, setEquipes] = useState<Equipe[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState<{ id: string; codigo: string } | null>(null);

  async function carregar() {
    const { data, error } = await supabase.rpc("painel_equipes_resumo");
    if (error) setErro(error.message); else setEquipes((data as Equipe[]) ?? []);
  }
  useEffect(() => { carregar(); }, []);

  async function gerarCodigo(e: Equipe) {
    if (!confirm(`Gerar um código novo para ${e.nome}? O código atual deixa de valer e a equipe precisa informar o novo.`)) return;
    const { data, error } = await supabase.rpc("painel_novo_codigo", { p_equipe: e.id });
    if (error) { alert("Não consegui gerar: " + error.message); return; }
    setNovo({ id: e.id, codigo: data as string });
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-800">Equipes do Painel ComprasNet</h2>
      <p className="text-sm text-slate-500">Cada equipe vê só as anotações das suas UASGs, com o código que recebeu. O código não fica guardado aqui: se uma equipe perder o dela, gere outro.</p>
      {erro && <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">Não consegui carregar as equipes: {erro}</div>}
      {equipes && equipes.length === 0 && <p className="text-sm text-slate-400">Nenhuma equipe ainda.</p>}
      {equipes && equipes.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-4 py-2 font-semibold">Equipe</th>
                <th className="px-4 py-2 font-semibold">UASG</th>
                <th className="px-4 py-2 font-semibold text-right">Anotações</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {equipes.map(e => (
                <tr key={e.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2 font-medium text-slate-800">{e.nome}</td>
                  <td className="px-4 py-2 text-slate-600">{e.uasgs.join(", ") || "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{e.anotacoes}</td>
                  <td className="px-4 py-2 text-right">
                    {novo?.id === e.id ? (
                      <span className="inline-flex items-center gap-2">
                        <code className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 font-mono tracking-wider">{novo.codigo}</code>
                        <button onClick={() => navigator.clipboard.writeText(novo.codigo)} className="text-xs text-blue-600 hover:underline">Copiar</button>
                      </span>
                    ) : (
                      <button onClick={() => gerarCodigo(e)} className="text-xs text-blue-600 hover:underline">Gerar novo código</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface Sugestao { id: string; mensagem: string; tipo: string | null; versao_extensao: string | null; created_at: string }

// "OB-SILOMS 2.5" → extensão de OB; 2.x → robô de empenhos; 1.x → Painel ComprasNet
function extensaoDaVersao(v: string | null) {
  const s = (v ?? "").trim();
  if (/^OB-SILOMS/i.test(s)) return { nome: "Extensão de OB", versao: s.replace(/^OB-SILOMS\s*/i, "") };
  if (/^2\./.test(s)) return { nome: "Robô de Empenhos", versao: s };
  if (/^1\./.test(s)) return { nome: "Painel ComprasNet", versao: s };
  return { nome: "Extensão", versao: s || "?" };
}

const COR_TIPO: Record<string, string> = {
  bug: "bg-red-50 text-red-700 border-red-200",
  "sugestão": "bg-indigo-50 text-indigo-700 border-indigo-200",
  elogio: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

// Sugestões enviadas pelo botão 💬 das extensões. Só o perfil DEV lê (policy
// "dev le pelo app"); antes elas eram lidas na própria extensão com a chave pública.
function SugestoesExtensoes() {
  const [itens, setItens] = useState<Sugestao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("feedback_extensao").select("id, mensagem, tipo, versao_extensao, created_at")
      .order("created_at", { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) setErro(error.message); else setItens((data as Sugestao[]) ?? []); });
  }, []);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-800">Sugestões das extensões</h2>
      {erro && <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">Não consegui carregar as sugestões: {erro}</div>}
      {itens && itens.length === 0 && <p className="text-sm text-slate-400">Nenhuma sugestão ainda.</p>}
      {itens && itens.length > 0 && (
        <ul className="space-y-2">
          {itens.map(s => {
            const ext = extensaoDaVersao(s.versao_extensao);
            const tipo = s.tipo ?? "outro";
            return (
              <li key={s.id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
                <div className="flex flex-wrap items-center gap-2 mb-1.5 text-xs">
                  <span className={`px-2 py-0.5 rounded-full border font-semibold ${COR_TIPO[tipo] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>{tipo}</span>
                  <span className="font-medium text-slate-700">{ext.nome}</span>
                  <span className="text-slate-400">v{ext.versao} · {new Date(s.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                </div>
                <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{s.mensagem}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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

        <EquipesPainel />

        <SugestoesExtensoes />

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
