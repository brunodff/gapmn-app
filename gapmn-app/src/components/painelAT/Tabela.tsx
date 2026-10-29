// Tabela das solicitações filtradas: ordena pelo cabeçalho, pagina de 25 em 25 e exporta para Excel.
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { dataBR, encerrada, fmtMoeda, fmtNumero, ordenar, type CampoOrdem, type Solicitacao } from "../../lib/auxilioTransporte/dados.ts";

const POR_PAGINA = 25;

const COLUNAS: { campo: CampoOrdem; rotulo: string; num?: boolean }[] = [
  { campo: "solicitado", rotulo: "Solicitado" },
  { campo: "id", rotulo: "id", num: true },
  { campo: "nome", rotulo: "Nome de guerra" },
  { campo: "pg", rotulo: "P/G" },
  { campo: "om", rotulo: "OM" },
  { campo: "situacao", rotulo: "Situação" },
  { campo: "ordem", rotulo: "Nº de ordem" },
  { campo: "valor", rotulo: "Valor", num: true },
  { campo: "trajetos", rotulo: "Trajetos", num: true },
  { campo: "encaminhado", rotulo: "Encaminhado" },
];

function Situacao({ s }: { s: Solicitacao }) {
  const tipo = s.situacao.startsWith("FINALIZ") ? "ok" : s.situacao.startsWith("CANCEL") || encerrada(s.situacao) ? "neutro" : "andamento";
  return (
    <span className="at-chip" data-tipo={tipo} title={s.situacaoAnterior ? `Antes: ${s.situacaoAnterior}` : undefined}>
      {s.situacao}
    </span>
  );
}

async function exportar(lista: Solicitacao[]) {
  const XLSX = await import("xlsx");
  const linhas = lista.map((s) => ({
    "id": s.id, "Solicitado": dataBR(s.solicitado), "Encaminhado": dataBR(s.encaminhado), "Situação": s.situacao,
    "Nº de ordem": s.ordem, "P/G": s.pg, "OM": s.om, "Nome de guerra": s.nome, "Valor (R$)": s.valor, "Nº de trajetos": s.trajetos,
    "Tarifas": s.tarifas ?? "", "Saiu da lista": s.foraDaLista ? "sim" : "", "Situação anterior": s.situacaoAnterior ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(linhas);
  ws["!cols"] = [8, 11, 11, 16, 12, 6, 14, 22, 12, 8, 24, 8, 16].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Solicitações");
  const hoje = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `auxilio-transporte-${hoje}.xlsx`);
}

export default function Tabela({ lista }: { lista: Solicitacao[] }) {
  const [ordem, setOrdem] = useState<{ campo: CampoOrdem; crescente: boolean }>({ campo: "solicitado", crescente: false });
  const [pagina, setPagina] = useState(0);
  const [exportando, setExportando] = useState(false);
  // filtro novo volta para a primeira página
  const [listaAnterior, setListaAnterior] = useState(lista);
  if (lista !== listaAnterior) { setListaAnterior(lista); setPagina(0); }

  const ordenada = useMemo(() => ordenar(lista, ordem.campo, ordem.crescente), [lista, ordem]);
  const paginas = Math.max(1, Math.ceil(ordenada.length / POR_PAGINA));
  const atual = Math.min(pagina, paginas - 1);
  const visiveis = ordenada.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA);

  const clicar = (campo: CampoOrdem) =>
    setOrdem((o) => (o.campo === campo ? { campo, crescente: !o.crescente } : { campo, crescente: campo === "nome" || campo === "om" || campo === "pg" }));

  return (
    <section className="at-cartao at-tabela-cartao" aria-label="Solicitações">
      <div className="at-cartao-topo">
        <div>
          <h2 className="at-cartao-tit">Solicitações</h2>
          <p className="at-cartao-sub">{fmtNumero(lista.length)} com os filtros atuais</p>
        </div>
        <button type="button" className="at-botao" disabled={!lista.length || exportando}
          onClick={async () => { setExportando(true); try { await exportar(ordenada); } finally { setExportando(false); } }}>
          <Download size={15} aria-hidden="true" /> {exportando ? "Gerando…" : "Exportar Excel"}
        </button>
      </div>
      <div className="at-tabela-rolagem">
        <table className="at-tabela">
          <thead>
            <tr>
              {COLUNAS.map((c) => (
                <th key={c.campo} scope="col" data-num={c.num ? "1" : undefined}
                  aria-sort={ordem.campo === c.campo ? (ordem.crescente ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => clicar(c.campo)}>
                    {c.rotulo}
                    {ordem.campo === c.campo && (ordem.crescente ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((s) => (
              <tr key={s.id} data-fora={s.foraDaLista ? "1" : undefined}>
                <td>{dataBR(s.solicitado) || "—"}</td>
                <td data-num="1">{s.id}</td>
                <td className="at-forte">{s.nome || "—"}{s.foraDaLista && <span className="at-fora" title="Não veio na última leitura do SIGPES"> · saiu da lista</span>}</td>
                <td>{s.pg || "—"}</td>
                <td>{s.om}</td>
                <td><Situacao s={s} /></td>
                <td>{s.ordem || "—"}</td>
                <td data-num="1">{fmtMoeda(s.valor)}</td>
                <td data-num="1">{s.trajetos ?? "—"}</td>
                <td>{dataBR(s.encaminhado) || "—"}</td>
              </tr>
            ))}
            {!visiveis.length && (
              <tr><td colSpan={COLUNAS.length} className="at-vazio">Nenhuma solicitação com esses filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {paginas > 1 && (
        <nav className="at-paginas" aria-label="Páginas da tabela">
          <button type="button" className="at-botao-icone" disabled={atual === 0} onClick={() => setPagina(atual - 1)} aria-label="Página anterior">
            <ChevronLeft size={16} />
          </button>
          <span>Página {atual + 1} de {fmtNumero(paginas)}</span>
          <button type="button" className="at-botao-icone" disabled={atual >= paginas - 1} onClick={() => setPagina(atual + 1)} aria-label="Próxima página">
            <ChevronRight size={16} />
          </button>
        </nav>
      )}
    </section>
  );
}
