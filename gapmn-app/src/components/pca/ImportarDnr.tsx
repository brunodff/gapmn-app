import { useMemo, useState } from "react";
import { cruzarDnr, juntarLeituras, lerDocumento, lerPlanilhaSiloms, type DadosDnr, type LeituraDocumento } from "../../lib/pca/documentos";
import { acaoPca, type DadosPca } from "../../lib/pca/cliente";
import { Campo, botao, botaoPrimario, entrada } from "./ui";

const hoje = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const vazio = (): DadosDnr => ({ numero_dnr: null, data_chegada: hoje(), pag_oficio: null, pag_tr: null, numero_contratacao: null, itens_pca: [], objeto: null, assinante_tr: null, om_apoiada: null, fonte: "manual" });
type Retorno = { registros: { situacao: string; contratacao: { id_contratacao_pgc: string | null; objeto: string | null; status: string } | null; irregularidades: { tipo: string; descricao: string }[]; motivo?: string }[] };

/** Prévia do cruzamento com o PCA, antes de gravar */
function Previa({ d, dados }: { d: DadosDnr; dados: DadosPca }) {
  const r = cruzarDnr(d, dados.lista);
  return (
    <div className={`rounded-md border px-2 py-1 text-[11px] ${r.contratacao ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      {r.contratacao ? <>✔ Vincula à contratação <b>{r.contratacao.id_contratacao_pgc ?? r.contratacao.objeto_resumido}</b> ({r.contratacao.objeto_resumido}).</> : <>⚠ Vai para a fila de decisão da SLIC{r.candidata ? <> (provável: <b>{r.candidata.id_contratacao_pgc ?? r.candidata.objeto_resumido}</b>)</> : null}.</>}
      {r.irregularidades.map((i, k) => <div key={k}>• {i.descricao}</div>)}
    </div>
  );
}

function FormDnr({ d, onChange }: { d: DadosDnr; onChange: (d: DadosDnr) => void }) {
  const s = <K extends keyof DadosDnr>(k: K, v: DadosDnr[K]) => onChange({ ...d, [k]: v });
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      <Campo rotulo="Nº da DNR"><input className={entrada} value={d.numero_dnr ?? ""} onChange={(e) => s("numero_dnr", e.target.value || null)} /></Campo>
      <Campo rotulo="Chegada na SLIC"><input type="date" className={entrada} value={d.data_chegada ?? ""} onChange={(e) => s("data_chegada", e.target.value || null)} /></Campo>
      <Campo rotulo="PAG do Ofício de Abertura (prevalece)"><input className={entrada} value={d.pag_oficio ?? ""} onChange={(e) => s("pag_oficio", e.target.value || null)} /></Campo>
      <Campo rotulo="PAG no TR"><input className={entrada} value={d.pag_tr ?? ""} onChange={(e) => s("pag_tr", e.target.value || null)} /></Campo>
      <Campo rotulo="Contratação do PCA no TR (item 2.2)"><input className={entrada} placeholder="120630-110/2027" value={d.numero_contratacao ?? ""} onChange={(e) => s("numero_contratacao", e.target.value || null)} /></Campo>
      <Campo rotulo="Itens do PCA (TR)"><input className={entrada} value={d.itens_pca.join(", ")} onChange={(e) => s("itens_pca", (e.target.value.match(/\d+/g) ?? []).map(Number))} /></Campo>
      <Campo rotulo="Assinante do TR (responsável na apoiada)" largo><input className={entrada} value={d.assinante_tr ?? ""} onChange={(e) => s("assinante_tr", e.target.value || null)} /></Campo>
      <Campo rotulo="Objeto (TR, item 1.1)" largo><textarea className={`${entrada} min-h-[48px]`} value={d.objeto ?? ""} onChange={(e) => s("objeto", e.target.value || null)} /></Campo>
      <Campo rotulo="OM apoiada / setor"><input className={entrada} value={d.om_apoiada ?? ""} onChange={(e) => s("om_apoiada", e.target.value || null)} /></Campo>
    </div>
  );
}

export default function ImportarDnr({ dados, onFechar, onMudou }: { dados: DadosPca; onFechar: () => void; onMudou: () => void }) {
  const [aba, setAba] = useState<"pdf" | "planilha" | "manual">("pdf");
  const [leituras, setLeituras] = useState<(LeituraDocumento & { arquivo: string })[]>([]);
  const [dnr, setDnr] = useState<DadosDnr>(vazio());
  const [linhas, setLinhas] = useState<DadosDnr[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<Retorno | null>(null);

  async function lerPdfs(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setOcupado(true); setMsg({ ok: true, txt: "Lendo os PDFs no seu computador (nada sai daqui)…" });
    try {
      const { textoDoPdf } = await import("../../lib/apostilamento/pdfTexto");
      const novas: (LeituraDocumento & { arquivo: string })[] = [];
      for (const f of Array.from(arquivos)) novas.push({ ...lerDocumento(await textoDoPdf(f)), arquivo: f.name });
      const todas = [...leituras, ...novas];
      setLeituras(todas);
      const j = juntarLeituras(todas);
      const oficio = todas.find((l) => l.tipo === "OFICIO");
      setDnr({ ...vazio(), ...j, data_chegada: oficio?.data ?? hoje(), fonte: "upload" });
      const semTexto = novas.filter((l) => !l.pag && !l.numero_contratacao && !l.objeto);
      setMsg({ ok: !semTexto.length, txt: semTexto.length ? `Não achei texto em: ${semTexto.map((l) => l.arquivo).join(", ")} (PDF escaneado?). Preencha à mão.` : "Confira os campos e o cruzamento com o PCA antes de registrar." });
    } catch (e) { setMsg({ ok: false, txt: `Não consegui ler: ${e instanceof Error ? e.message : String(e)}` }); } finally { setOcupado(false); }
  }

  async function lerPlanilha(arquivo: File | undefined) {
    if (!arquivo) return;
    setOcupado(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await arquivo.arrayBuffer(), { type: "array" });
      const aba0 = wb.Sheets[wb.SheetNames[0]];
      const r = lerPlanilhaSiloms(XLSX.utils.sheet_to_json<unknown[]>(aba0, { header: 1, raw: true, defval: "" }));
      setLinhas(r);
      setMsg(r.length ? { ok: true, txt: `${r.length} DNR(s) na planilha. Confira o cruzamento de cada uma.` } : { ok: false, txt: "Não achei as colunas (DNR, data de chegada, PAG/NUP, objeto) nas 15 primeiras linhas." });
    } catch (e) { setMsg({ ok: false, txt: `Não consegui ler a planilha: ${e instanceof Error ? e.message : String(e)}` }); } finally { setOcupado(false); }
  }

  async function registrar(registros: DadosDnr[]) {
    setOcupado(true); setMsg(null);
    try {
      const r = await acaoPca<Retorno>("dnr", { registros: registros.map((x) => ({ ...x, arquivos: leituras.map((l) => l.arquivo) })) });
      setResultado(r);
      const vinc = r.registros.filter((x) => x.situacao === "vinculada").length;
      setMsg({ ok: true, txt: `${vinc} DNR(s) vinculada(s); ${r.registros.length - vinc} na fila de decisão da SLIC.` });
      onMudou();
    } catch (e) { setMsg({ ok: false, txt: e instanceof Error ? e.message : String(e) }); } finally { setOcupado(false); }
  }

  const prontaManual = useMemo(() => !!(dnr.pag_oficio || dnr.pag_tr || dnr.numero_dnr), [dnr]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
      <div className="max-h-[92vh] w-full max-w-3xl space-y-3 overflow-y-auto rounded-xl p-4 shadow-xl" style={{ background: "var(--gm-pop, #fff)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800">Registrar DNR (chegada do processo na SLIC)</h3>
          <button onClick={onFechar} className="ml-auto text-lg text-slate-400 hover:text-slate-700" aria-label="Fechar">✕</button>
        </div>
        <div className="flex gap-1 border-b border-slate-200 text-xs">
          {([["pdf", "PDFs do SILOMS (TR + Ofício)"], ["planilha", "Planilha exportada do SILOMS"], ["manual", "Digitar"]] as const).map(([k, n]) => (
            <button key={k} onClick={() => { setAba(k); setResultado(null); setMsg(null); if (k === "manual") setDnr(vazio()); }}
              className={`-mb-px border-b-2 px-3 py-1.5 font-semibold ${aba === k ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500"}`}>{n}</button>
          ))}
        </div>
        {msg && <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-sky-200 bg-sky-50 text-sky-700" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.txt}</div>}

        {aba === "pdf" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Selecione o <b>Termo de Referência</b> e o <b>Ofício/Documento de Abertura do PAG</b>. O PAG do Ofício prevalece; se o TR tiver outro, vira alerta de divergência para conferência.</p>
            <input type="file" accept="application/pdf" multiple disabled={ocupado} onChange={(e) => void lerPdfs(e.target.files)} className="text-xs" />
            {leituras.length > 0 && (
              <ul className="text-[11px] text-slate-600">
                {leituras.map((l, i) => <li key={i}>📄 {l.arquivo}: <b>{l.tipo === "TR" ? "Termo de Referência" : l.tipo === "OFICIO" ? "Ofício de abertura" : "outro documento"}</b>{l.pag ? ` · PAG ${l.pag}` : ""}{l.pags.length > 1 ? ` (outros PAG no texto: ${l.pags.filter((p) => p !== l.pag).join(", ")})` : ""}{l.numero_contratacao ? ` · contratação ${l.numero_contratacao}` : ""}{l.numero_dnr ? ` · DNR ${l.numero_dnr}` : ""}</li>)}
              </ul>
            )}
            {leituras.length > 0 && <><FormDnr d={dnr} onChange={setDnr} /><Previa d={dnr} dados={dados} />
              <div className="flex justify-end gap-2"><button className={botao} onClick={() => { setLeituras([]); setDnr(vazio()); setMsg(null); }}>Limpar</button>
                <button className={botaoPrimario} disabled={ocupado || !prontaManual} onClick={() => void registrar([{ ...dnr, fonte: "upload" }])}>Registrar DNR</button></div></>}
          </div>
        )}

        {aba === "planilha" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Relatório exportado do SILOMS em Excel ou CSV, com colunas como Nº DNR, Data de chegada, PAG/NUP, Objeto e OM. A leitura é feita no seu computador.</p>
            <input type="file" accept=".xlsx,.xls,.csv" disabled={ocupado} onChange={(e) => void lerPlanilha(e.target.files?.[0])} className="text-xs" />
            {linhas.length > 0 && (
              <>
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {linhas.map((l, i) => (
                    <div key={i} className="rounded-md border border-slate-200 p-2 text-[11px]">
                      <div className="font-semibold text-slate-700">DNR {l.numero_dnr ?? "s/nº"} · {l.pag_oficio ?? "sem PAG"} · {l.data_chegada ?? "sem data"} · {l.om_apoiada ?? ""}</div>
                      <div className="text-slate-500">{l.objeto}</div>
                      <Previa d={l} dados={dados} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end"><button className={botaoPrimario} disabled={ocupado} onClick={() => void registrar(linhas)}>Registrar {linhas.length} DNR(s)</button></div>
              </>
            )}
          </div>
        )}

        {aba === "manual" && (
          <div className="space-y-3">
            <FormDnr d={dnr} onChange={setDnr} />
            <Previa d={dnr} dados={dados} />
            <div className="flex justify-end"><button className={botaoPrimario} disabled={ocupado || !prontaManual} onClick={() => void registrar([{ ...dnr, fonte: "manual" }])}>Registrar DNR</button></div>
          </div>
        )}

        {resultado && (
          <ul className="space-y-1 text-[11px]">
            {resultado.registros.map((r, i) => (
              <li key={i} className={r.situacao === "vinculada" ? "text-emerald-700" : "text-amber-700"}>
                {r.situacao === "vinculada" ? `✔ Vinculada: ${r.contratacao?.id_contratacao_pgc ?? ""} ${r.contratacao?.objeto ?? ""} → ${r.contratacao?.status}` : r.situacao === "ignorada" ? `— Ignorada: ${r.motivo}` : "⚠ Na fila de irregularidades"}
                {r.irregularidades.map((x, k) => <div key={k} className="pl-3">• {x.descricao}</div>)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
