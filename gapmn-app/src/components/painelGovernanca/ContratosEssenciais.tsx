// Contratos e atas essenciais (checklist que a DOC informa na coleta mensal).
// Mostra a situação da competência exibida (ou a última informada antes dela), do mais crítico ao mais seguro.

import type { Competencia, ContratoPainel } from "../../lib/indicadores/tipos.ts";

const ORDEM_RISCO: Record<string, number> = { "Crítico": 0, "Atenção": 1, "Seguro": 2 };
const COR: Record<string, string> = { "Crítico": "var(--critico)", "Atenção": "var(--atencao)", "Seguro": "var(--ok)" };

const dataBR = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const rotuloDe = (codigo: string) => {
  const m = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"][Number(codigo.slice(5, 7)) - 1];
  return `${m}/${codigo.slice(2, 4)}`;
};

function prazo(termino: string | null, hoje: Date): { texto: string; cor: string } | null {
  if (!termino) return null;
  const dias = Math.round((new Date(`${termino}T00:00:00`).getTime() - hoje.getTime()) / 864e5);
  if (dias < 0) return { texto: `venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, cor: "var(--critico)" };
  if (dias === 0) return { texto: "vence hoje", cor: "var(--critico)" };
  return { texto: `vence em ${dias} dia${dias === 1 ? "" : "s"}`, cor: dias <= 90 ? "var(--atencao)" : "var(--txt-2)" };
}

/** Contratos da competência exibida ou, se ela não tiver, da última anterior que tiver. */
function contratosDaReferencia(todos: ContratoPainel[], referencia: Competencia | null): { competencia: string; itens: ContratoPainel[] } | null {
  if (!referencia || !todos.length) return null;
  const limite = referencia.data.slice(0, 7);
  const comps = [...new Set(todos.map((c) => c.competencia))].filter((c) => c <= limite).sort();
  const escolhida = comps.pop();
  if (!escolhida) return null;
  const itens = todos.filter((c) => c.competencia === escolhida)
    .sort((a, b) => (ORDEM_RISCO[a.status ?? ""] ?? 3) - (ORDEM_RISCO[b.status ?? ""] ?? 3) || a.ordem - b.ordem);
  return { competencia: escolhida, itens };
}

export default function ContratosEssenciais({ contratos, referencia, hoje = new Date() }: {
  contratos: ContratoPainel[]; referencia: Competencia | null; hoje?: Date;
}) {
  const r = contratosDaReferencia(contratos, referencia);
  if (!r) return null;
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const conta = (s: string) => r.itens.filter((c) => c.status === s).length;
  return (
    <section className="pg-card" aria-label="Contratos e atas essenciais">
      <div className="pg-secao-topo">
        <span className="pg-rotulo">Contratos e atas essenciais · DOC</span>
        <span className="pg-ctr-contagem">
          {(["Crítico", "Atenção", "Seguro"] as const).map((s) => (
            <span key={s} className="pg-ctr-chip" style={{ color: COR[s], borderColor: COR[s] }}>{s}: {conta(s)}</span>
          ))}
        </span>
      </div>
      <div className="pg-sub" style={{ marginTop: -4, marginBottom: 8 }}>
        situação informada em {rotuloDe(r.competencia)}{referencia && rotuloDe(r.competencia) !== referencia.label ? ` (a mais recente até ${referencia.label})` : ""}
      </div>
      <div className="pg-ctr-rolagem">
        <table className="pg-ctr-tabela">
          <thead>
            <tr><th>Serviço essencial</th><th>NUP</th><th>Término da vigência</th><th>Situação</th><th>Providências da Administração</th></tr>
          </thead>
          <tbody>
            {r.itens.map((c) => {
              const p = prazo(c.termino, base);
              return (
                <tr key={`${c.competencia}-${c.ordem}`}>
                  <td className="pg-ctr-servico">{c.servico}</td>
                  <td className="pg-ctr-nup">{c.nup ?? "—"}</td>
                  <td>
                    {dataBR(c.termino)}
                    {p && <div style={{ color: p.cor, fontSize: 11 }}>{p.texto}</div>}
                  </td>
                  <td>{c.status ? <span className="pg-ctr-chip" style={{ color: COR[c.status], borderColor: COR[c.status] }}>{c.status}</span> : "—"}</td>
                  <td className="pg-ctr-prov">{c.providencias ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
