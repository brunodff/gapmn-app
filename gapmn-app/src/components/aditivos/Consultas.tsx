import { useState } from "react";
import { kitAditivo } from "../../lib/aditivos/kitAditivo";
import { bytesDeBase64, consultaAutomatica } from "../../lib/aditivos/dados";
import type { AnexosConsultas, Arquivo } from "../../lib/aditivos/anexos";
import type { EstadoAditivo, ResultadoRegularidade } from "../../lib/aditivos/tipos";

// Itens 12 (SICAF) e 13 (CEIS, CNEP, CNJ e TCU) da Lista: o SICAF exige login gov.br no perfil Governo, então o
// fiscal anexa o PDF e o kit confere; a Consulta Consolidada do TCU é tentada sozinha (servidor do site) e, se o
// firewall do TCU recusar, o fiscal baixa e anexa. Os PDFs ficam só na memória desta aba (vão juntos no .zip).

const SICAF_URL = "https://www3.comprasnet.gov.br/sicaf-web/private/geral/consultarSituacaoFornecedor.jsf";
const TCU_URL = "https://certidoes-apf.apps.tcu.gov.br/";
const fmtCnpj = (c: string) => { const d = c.replace(/\D/g, ""); return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c; };
const botao = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const baixar = (a: Arquivo) => { const u = URL.createObjectURL(new Blob([a.bytes], { type: "application/pdf" })); const l = document.createElement("a"); l.href = u; l.download = a.nome; l.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); };
async function lerArquivo(f: File): Promise<Arquivo> { return { nome: f.name, bytes: await f.arrayBuffer() }; }
async function textoDe(a: Arquivo): Promise<string> {
  const { textoDoPdf } = await import("../../lib/apostilamento/pdfTexto");
  return textoDoPdf(new Uint8Array(a.bytes));
}

export function Sicaf({ estado, anexos, onEstado, onAnexos, ro }: {
  estado: EstadoAditivo; anexos: AnexosConsultas; onEstado: (e: Partial<EstadoAditivo>) => void; onAnexos: (a: Partial<AnexosConsultas>) => void; ro?: boolean;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function anexar(files: FileList | null) {
    if (!files?.length) return;
    setOcupado(true); setMsg("Lendo o PDF e conferindo pelas regras da SCON (verificar_sicaf.py)…");
    try {
      const arqs = await Promise.all(Array.from(files).map(lerArquivo));
      const texto = (await Promise.all(arqs.map(textoDe))).join("\n");
      const r = await kitAditivo.sicaf(texto, estado.cnpj, setMsg);
      onAnexos({ sicaf: arqs });
      onEstado({ sicaf: { ...r, arquivo: arqs.map((a) => a.nome).join(", "), em: new Date().toISOString() } });
      setMsg(null);
    } catch (e) { setMsg(`Não consegui conferir: ${e instanceof Error ? e.message : String(e)}`); } finally { setOcupado(false); }
  }
  const s = estado.sicaf;
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span>CNPJ da contratada: <b>{fmtCnpj(estado.cnpj) || "—"}</b></span>
        <button type="button" className={botao} onClick={() => void navigator.clipboard.writeText(estado.cnpj.replace(/\D/g, ""))}>Copiar CNPJ</button>
        <a className={botao} href={SICAF_URL} target="_blank" rel="noreferrer">Abrir SICAF ↗</a>
      </div>
      <p className="text-slate-600">Na tela de entrada do SICAF escolha o perfil <b>Governo</b> → Entrar com gov.br → informe o CNPJ → gere o relatório de <b>Situação do Fornecedor</b> → salve em PDF → anexe aqui. Se o relatório não sair (ex.: "Falha de comunicação com SIAPE"), gere o RELATÓRIO das telas Nível III e Nível IV e anexe os dois PDFs.</p>
      {!ro && <label className={`${botao} inline-block cursor-pointer`}>📎 Anexar PDF do SICAF<input type="file" accept="application/pdf" multiple className="hidden" disabled={ocupado} onChange={(e) => void anexar(e.target.files)} /></label>}
      {msg && <p className="text-slate-500">{msg}</p>}
      {s && (
        <div className={`rounded-lg border p-2 ${s.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
          <div className="font-semibold">{s.ok ? "✅ SICAF OK – atende ao item 12" : "⛔ SICAF com pendências"} <span className="font-normal text-slate-500">({s.arquivo}; emitido em {s.emitido_em ?? "?"})</span></div>
          {!anexos.sicaf.length && <div className="text-amber-700">Anexe o PDF de novo para ele ir junto no .zip (os arquivos não ficam guardados no site).</div>}
          <ul className="mt-1 list-disc pl-5">{s.alertas.map((a, i) => <li key={i} className={/^🟡/.test(a) ? "text-amber-700" : "text-red-700"}>{a}</li>)}</ul>
          <div className="mt-1 text-slate-600">{Object.entries(s.certidoes).map(([k, c]) => `${k.replace(/_/g, " ")}: ${c.situacao}${c.validade ? ` (${c.validade})` : ""}`).join(" · ")}</div>
        </div>
      )}
    </div>
  );
}

const FONTES_LINK: Record<string, string> = {
  tcu_inidoneos: "https://certidoes.apps.tcu.gov.br/lista-inidoneos", cnj_cnia: "https://www.cnj.jus.br/improbidade_adm/consultar_requerido.php",
  ceis: "https://portaldatransparencia.gov.br/sancoes/ceis", cnep: "https://portaldatransparencia.gov.br/sancoes/cnep",
};

export function Regularidade({ estado, anexos, contrato, consultaSocio, onEstado, onAnexos, ro }: {
  estado: EstadoAditivo; anexos: AnexosConsultas; contrato: string; consultaSocio: boolean;
  onEstado: (e: Partial<EstadoAditivo>) => void; onAnexos: (a: Partial<AnexosConsultas>) => void; ro?: boolean;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const r = estado.regularidade;
  const cnpj = estado.cnpj.replace(/\D/g, "");
  const guardar = (an: ResultadoRegularidade, fonte: "api" | "pdf", complementos: Record<string, string> = {}) =>
    onEstado({ regularidade: { ...an, fonte, em: new Date().toISOString(), complementos } });

  async function automatico() {
    setOcupado(true); setMsg({ ok: true, txt: "Consultando a Consulta Consolidada do TCU (uma chamada; pode levar até 1 minuto)…" });
    try {
      const x = await consultaAutomatica<{ ok: boolean; bloqueado?: boolean; error?: string; json?: unknown; pdf_base64?: string | null; pdf_erro?: string | null; nome_pdf?: string }>({ acao: "tcu", cnpj });
      if (!x.ok) { setMsg({ ok: false, txt: x.error ?? "O TCU não respondeu: use o caminho manual abaixo." }); return; }
      const an = await kitAditivo.consolidadaJson(x.json);
      guardar(an, "api");
      if (x.pdf_base64) onAnexos({ consolidada: { nome: x.nome_pdf ?? `ConsultaConsolidada_${cnpj}.pdf`, bytes: bytesDeBase64(x.pdf_base64) }, item13: null, complementos: {} });
      setMsg({ ok: !!x.pdf_base64, txt: x.pdf_base64 ? "Consulta Consolidada recebida (JSON e PDF)." : `Situação recebida, mas sem o PDF: ${x.pdf_erro ?? ""} Baixe o PDF pelo site do TCU e anexe abaixo.` });
    } catch (e) { setMsg({ ok: false, txt: `${e instanceof Error ? e.message : String(e)} Use o caminho manual abaixo.` }); } finally { setOcupado(false); }
  }
  async function anexarConsolidada(f: File | undefined) {
    if (!f) return;
    setOcupado(true); setMsg({ ok: true, txt: "Lendo a Consulta Consolidada…" });
    try {
      const a = await lerArquivo(f);
      const an = await kitAditivo.consolidadaTexto(await textoDe(a));
      if (an.cnpj && cnpj && an.cnpj !== cnpj) an.alertas.unshift(`🔴 CNPJ da consolidada (${an.cnpj}) diferente do contrato (${cnpj}).`);
      guardar(an, "pdf");
      onAnexos({ consolidada: a, item13: null, complementos: {} });
      setMsg(null);
    } catch (e) { setMsg({ ok: false, txt: `Não consegui ler: ${e instanceof Error ? e.message : String(e)}` }); } finally { setOcupado(false); }
  }
  async function cnjAutomatico() {
    setOcupado(true); setMsg({ ok: true, txt: "Buscando a certidão no CNJ…" });
    try {
      const x = await consultaAutomatica<{ ok: boolean; error?: string; tipo?: string; consta?: boolean | null; pdf_base64?: string; nome_pdf?: string }>({ acao: "cnj", documento: cnpj, tipoPessoa: "J" });
      if (!x.ok || !x.pdf_base64) { setMsg({ ok: false, txt: x.error ?? "O CNJ não respondeu: abra o site e anexe a certidão." }); return; }
      onAnexos({ complementos: { ...anexos.complementos, cnj_cnia: { nome: x.nome_pdf ?? "Certidao_CNJ.pdf", bytes: bytesDeBase64(x.pdf_base64) } }, item13: null });
      if (r) guardar(r, r.fonte, { ...r.complementos, cnj_cnia: `CNJ automático (${x.tipo})` });
      setMsg({ ok: x.consta === false, txt: x.consta ? "🔴 CNJ/CNIA: CONSTA registro – verificar antes do aditivo." : x.consta === null ? `⚠️ A pesquisa do CNJ não confirmou se há registro: a certidão ${x.tipo} foi anexada, confira o PDF.` : `Certidão ${x.tipo} do CNJ anexada.` });
    } catch (e) { setMsg({ ok: false, txt: e instanceof Error ? e.message : String(e) }); } finally { setOcupado(false); }
  }
  async function anexarComplemento(chave: string, f: File | undefined) {
    if (!f || !r) return;
    const a = await lerArquivo(f);
    onAnexos({ complementos: { ...anexos.complementos, [chave]: a }, item13: null });
    guardar(r, r.fonte, { ...r.complementos, [chave]: `anexo do fiscal (${a.nome})` });
  }
  async function montar() {
    if (!anexos.consolidada) { setMsg({ ok: false, txt: "Falta o PDF da Consulta Consolidada." }); return; }
    setOcupado(true);
    try {
      const ordem = ["tcu_inidoneos", "cnj_cnia", "ceis", "cnep"].filter((k) => anexos.complementos[k]).map((k) => anexos.complementos[k].bytes);
      const pdf = await kitAditivo.juntar([anexos.consolidada.bytes, ...ordem], (t) => setMsg({ ok: true, txt: t }));
      const item13 = { nome: `13 - Consulta de regularidade CEIS CNEP CNJ TCU - CT ${contrato.replace(/\//g, "-")}.pdf`, bytes: await pdf.arrayBuffer() };
      onAnexos({ item13 });
      setMsg({ ok: true, txt: `PDF do item 13 montado (consolidada + ${ordem.length} certidão(ões)).` });
    } catch (e) { setMsg({ ok: false, txt: e instanceof Error ? e.message : String(e) }); } finally { setOcupado(false); }
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {!ro && <button type="button" className={botao} disabled={ocupado || cnpj.length !== 14} onClick={() => void automatico()}>🔎 Consultar automaticamente (TCU)</button>}
        <a className={botao} href={TCU_URL} target="_blank" rel="noreferrer">Abrir Consulta Consolidada ↗</a>
        <button type="button" className={botao} onClick={() => void navigator.clipboard.writeText(cnpj)}>Copiar CNPJ</button>
        {!ro && <label className={`${botao} cursor-pointer`}>📎 Anexar PDF da Consulta Consolidada<input type="file" accept="application/pdf" className="hidden" disabled={ocupado} onChange={(e) => void anexarConsolidada(e.target.files?.[0])} /></label>}
      </div>
      {msg && <p className={msg.ok ? "text-slate-600" : "text-red-700"}>{msg.txt}</p>}
      {r && (
        <div className="space-y-1">
          <p className="text-slate-500">Consulta de {new Date(r.em).toLocaleString("pt-BR")} ({r.fonte === "api" ? "automática" : "PDF anexado"}).</p>
          {Object.entries(r.cadastros).map(([k, c]) => {
            const falhou = c.situacao !== "nada_consta" && c.situacao !== "consta";
            return (
              <div key={k} className={`rounded-md border px-2 py-1 ${c.situacao === "nada_consta" ? "border-emerald-200 bg-emerald-50" : c.situacao === "consta" ? "border-red-200 bg-red-50" : r.complementos?.[k] ? "border-sky-200 bg-sky-50" : "border-amber-200 bg-amber-50"}`}>
                <b>{c.cadastro}</b>: {c.situacao === "nada_consta" ? "nada consta" : c.situacao === "consta" ? "🔴 CONSTA registro – verificar a sanção" : r.complementos?.[k] ? `complemento: ${r.complementos[k]}` : `⚠️ ${c.situacao.replace(/_/g, " ")} na consolidada – é preciso anexar a certidão desse cadastro`}
                {falhou && !ro && (
                  <span className="ml-2 inline-flex flex-wrap gap-1">
                    {k === "cnj_cnia" && <button type="button" className={botao} disabled={ocupado} onClick={() => void cnjAutomatico()}>Buscar automaticamente</button>}
                    <a className={botao} href={FONTES_LINK[k] ?? c.manual} target="_blank" rel="noreferrer">Abrir site do cadastro ↗</a>
                    <label className={`${botao} cursor-pointer`}>Anexar certidão<input type="file" accept="application/pdf" className="hidden" onChange={(e) => void anexarComplemento(k, e.target.files?.[0])} /></label>
                  </span>
                )}
              </div>
            );
          })}
          {!anexos.consolidada && <p className="text-amber-700">O PDF da consolidada não está anexado nesta sessão: anexe (ou consulte de novo) para montar o item 13.</p>}
          {!ro && <button type="button" className={botao} disabled={ocupado || !anexos.consolidada} onClick={() => void montar()}>📄 Montar o PDF do item 13</button>}
          {anexos.item13 && <button type="button" className={`${botao} ml-2`} onClick={() => baixar(anexos.item13!)}>⬇ {anexos.item13.nome}</button>}
        </div>
      )}
      {consultaSocio && (
        <div className="rounded-lg border border-slate-200 p-2">
          <b>Item 14 – CPF do sócio majoritário</b>: a consolidada do TCU é só para CNPJ. Consulte CNJ, CEIS/CNEP e TCU pelo CPF e anexe os PDFs (vão juntos no .zip; o CPF não fica guardado no site).
          {!ro && <label className={`${botao} ml-2 cursor-pointer`}>📎 Anexar PDFs do item 14<input type="file" accept="application/pdf" multiple className="hidden" onChange={async (e) => onAnexos({ socio: await Promise.all(Array.from(e.target.files ?? []).map(lerArquivo)) })} /></label>}
          {anexos.socio.length > 0 && <span className="ml-2 text-slate-600">{anexos.socio.length} arquivo(s)</span>}
        </div>
      )}
    </div>
  );
}
