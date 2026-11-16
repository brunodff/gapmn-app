import { useMemo, useState } from "react";
import { painel, dataBaseDe, ROTULOS, CORES, type StatusReajuste } from "../../lib/apostilamento/painel";
import type { ContratoScon } from "../../lib/apostilamento/cadastro";

export type Cadastro = { numero_contrato: string; data_base: string | null; reajustes_aplicados: number; dedicacao_exclusiva: boolean; atualizado_em: string | null };

type Props = {
  contratos: (ContratoScon & { status: string | null })[];
  cadastros: Map<string, Cadastro>;
  diasAlerta: number;
  aoAbrir: (numero: string) => void;
};

const ORDEM_FILTRO: StatusReajuste[] = ["VERMELHO", "AGUARDANDO_INDICE", "AMARELO", "VERDE", "SEM_DATA_BASE", "VIGENCIA_ENCERRADA", "NAO_SE_APLICA"];
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Painel da SCON: cada contrato com a cor do reajuste (regra do painel_reajustes.py da SCON). */
export default function PainelReajustes({ contratos, cadastros, diasAlerta, aoAbrir }: Props) {
  const [filtro, setFiltro] = useState<StatusReajuste | "TODOS">("TODOS");
  const [busca, setBusca] = useState("");

  const linhas = useMemo(() => {
    const porNumero = new Map(contratos.map((c) => [c.numero_contrato, c]));
    const entrada = contratos.map((c) => {
      const cad = cadastros.get(c.numero_contrato);
      return {
        contrato: c.numero_contrato,
        data_base: cad?.data_base || dataBaseDe(c.data_orcamento),
        reajustes_aplicados: cad?.reajustes_aplicados ?? 0,
        dedicacao_exclusiva: cad?.dedicacao_exclusiva ?? false,
        vigencia_fim: c.data_final,
      };
    });
    return painel(entrada, undefined, diasAlerta).map((l) => ({ ...l, c: porNumero.get(l.contrato)!, cad: cadastros.get(l.contrato), data_base: entrada.find((e) => e.contrato === l.contrato)?.data_base ?? null }));
  }, [contratos, cadastros, diasAlerta]);

  const contagem = useMemo(() => {
    const m = new Map<StatusReajuste, number>();
    for (const l of linhas) m.set(l.status, (m.get(l.status) ?? 0) + 1);
    return m;
  }, [linhas]);

  const visiveis = linhas.filter((l) => (filtro === "TODOS" || l.status === filtro)
    && (!busca.trim() || norm(`${l.contrato} ${l.c.fornecedor ?? ""} ${l.c.descricao ?? ""}`).includes(norm(busca))));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFiltro("TODOS")} className={`rounded-full border px-3 py-1 text-xs ${filtro === "TODOS" ? "bg-slate-800 text-white border-slate-800" : "bg-white border-slate-200 text-slate-600"}`}>
          Todos ({linhas.length})
        </button>
        {ORDEM_FILTRO.filter((s) => contagem.get(s)).map((s) => (
          <button key={s} onClick={() => setFiltro(s)} style={{ background: filtro === s ? undefined : CORES[s] }}
            className={`rounded-full border px-3 py-1 text-xs ${filtro === s ? "bg-slate-800 text-white border-slate-800" : "border-slate-200 text-slate-700"}`}>
            {ROTULOS[s]} ({contagem.get(s)})
          </button>
        ))}
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar contrato, empresa ou objeto…"
          className="ml-auto w-72 rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-300" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Situação</th>
              <th className="px-3 py-2 text-left">Contrato</th>
              <th className="px-3 py-2 text-left">Empresa</th>
              <th className="px-3 py-2 text-left">Data do orçamento</th>
              <th className="px-3 py-2 text-left">Reajustes devidos</th>
              <th className="px-3 py-2 text-left">Próximo aniversário</th>
              <th className="px-3 py-2 text-left">Cadastro</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={l.contrato} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2"><span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-800" style={{ background: l.cor }}>{ROTULOS[l.status]}</span></td>
                <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{l.contrato}</td>
                <td className="px-3 py-2 text-slate-600 max-w-[260px] truncate" title={l.c.fornecedor ?? ""}>{l.c.fornecedor ?? "–"}</td>
                <td className="px-3 py-2 text-slate-600">{l.data_base ?? "–"}</td>
                <td className="px-3 py-2 text-slate-600">
                  {l.reajustes_devidos.length
                    ? l.reajustes_devidos.map((d) => `${d.n}º (${d.periodo}${d.indice_divulgado ? "" : " — índice não saiu"})`).join("; ")
                    : l.motivo ?? "–"}
                </td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{l.proximo_aniversario ? `${l.proximo_aniversario} (${l.dias_para_proximo} d)` : "–"}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{l.cad?.atualizado_em ? new Date(l.cad.atualizado_em).toLocaleDateString("pt-BR") : "não iniciado"}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => aoAbrir(l.contrato)} className="rounded-lg border border-sky-200 text-sky-700 hover:bg-sky-50 px-2 py-1">Abrir</button>
                </td>
              </tr>
            ))}
            {!visiveis.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Nenhum contrato neste filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">
        Reajuste a cada 12 meses da data do orçamento; efeitos no 1º dia do mês de aniversário; o índice do mês final sai até o dia 12 do mês seguinte.
        Contratos com dedicação exclusiva de mão de obra são repactuação (fora desta automação).
      </p>
    </div>
  );
}
