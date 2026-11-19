import { useState } from "react";
import { acharContratoGov, completarCadastro, type ContratoGov } from "../../lib/apostilamento/contratosGov";
import { cadastroDoContrato, enderecoPeloCnpj, lerDocumentosOficiais, listaDaUg } from "../../lib/apostilamento/contratosGovApi";
import { aplicarAchados } from "../../lib/apostilamento/documentosGov";
import { extrairDoTexto, type AchadosPdf } from "../../lib/apostilamento/lerPdfs";
import { textoDoPdf } from "../../lib/apostilamento/pdfTexto";
import type { DadosReajuste } from "../../lib/apostilamento/tipos";

type Props = {
  numero: string; pag: string | null; inicio?: string | null;
  /** UG do contrato no Contratos.gov.br (GAP-MN = 120630) */
  ug: string;
  /** contrato já conhecido (página de outras OMs) */
  contratoGov?: ContratoGov;
  dados: DadosReajuste;
  aplicar: (novo: DadosReajuste) => void;
  /** nome da unidade de apoio da configuração (o cabeçalho do termo só muda se a OM do contrato for outra) */
  ugApoioNome?: string;
  /** sigla da unidade de apoio: a sigla sugerida só é trocada pela do contrato quando é esta */
  ugApoioSigla?: string;
};

/** Completa o cadastro sem digitar: Contratos.gov.br (partes, itens, termos, dotação), o PDF do contrato na
 *  aba "Arquivos" (índice, cláusula, data do orçamento, representante, endereço, parágrafos do contratante e da
 *  contratada, OM contratante) e o Termo de Referência da compra no PNCP. Só preenche o que está vazio e
 *  mostra de onde veio cada dado; a SCON confere antes de gerar. */
export default function CompletarAutomatico({ numero, pag, inicio, ug, contratoGov, dados, aplicar, ugApoioNome, ugApoioSigla }: Props) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [pdfs, setPdfs] = useState<{ nome: string; achados: AchadosPdf }[]>([]);

  async function pelaApi() {
    setMsg(null);
    try {
      let c = contratoGov ?? null;
      if (!c) {
        setOcupado("Buscando os contratos da UG no Contratos.gov.br (a primeira vez leva cerca de 40 s)…");
        c = acharContratoGov(numero, pag, inicio, await listaDaUg(ug));
        if (!c) { setMsg({ ok: false, txt: `Não achei o contrato ${numero} entre os contratos ativos da UG ${ug} no Contratos.gov.br (adesões antigas e contratos fora do sistema não aparecem).` }); return; }
      }
      setOcupado(`Lendo itens, termos e empenhos do contrato ${c.numero} no Contratos.gov.br…`);
      const r = await cadastroDoContrato(c);
      const { dados: novo, preenchidos } = completarCadastro(dados, r.dados);
      let final = novo as DadosReajuste;
      setOcupado("Lendo o PDF do contrato (Contratos.gov.br) e o Termo de Referência da compra (PNCP)…");
      const docs = await lerDocumentosOficiais(c, final.empresa?.cnpj);
      const doPdf = aplicarAchados(final, docs.contrato, docs.tr, { ugApoioNome, siglasPadrao: [ugApoioSigla, c.contratante?.orgao?.unidade_gestora?.nome_resumido], origemContrato: docs.origemContrato, origemTr: docs.origemTr });
      final = doPdf.dados;
      // sem o nome da OM no PDF, vale a unidade contratante do Contratos.gov.br
      const ugGov = c.contratante?.orgao?.unidade_gestora;
      if (!final.om_contratante_nome && ugGov?.nome) { final = { ...final, om_contratante_nome: ugGov.nome }; preenchidos.push("om_contratante_nome"); }
      if (!final.om_contratante_sigla && ugGov?.nome_resumido) { final = { ...final, om_contratante_sigla: ugGov.nome_resumido }; preenchidos.push("om_contratante_sigla"); }
      setPdfs((x) => [
        ...(docs.contrato ? [{ nome: docs.origemContrato, achados: docs.contrato }] : []),
        ...(docs.tr ? [{ nome: docs.origemTr, achados: docs.tr }] : []), ...x]);
      if (!final.empresa?.endereco && final.empresa?.cnpj) {
        setOcupado("Buscando o endereço da empresa pelo CNPJ…");
        const end = await enderecoPeloCnpj(final.empresa.cnpj);
        if (end) { final.empresa = { ...final.empresa, endereco: end }; preenchidos.push("empresa.endereco (cadastro do CNPJ)"); }
      }
      aplicar(final);
      const dosPdfs = doPdf.preenchidos.map((p) => `${p.rotulo} (${/TR/.test(p.origem) ? "TR" : "contrato"})`);
      setMsg({ ok: true, txt: (preenchidos.length || dosPdfs.length
        ? `Preenchido: ${[...preenchidos.map((p) => `${p} (Contratos.gov.br)`), ...dosPdfs].join(", ")}.` : "Nada vazio a preencher: o cadastro já tinha esses dados.")
        + ([...r.avisos, ...docs.avisos].length ? ` Atenção: ${[...r.avisos, ...docs.avisos].join("; ")}.` : "") + " Confira e salve." });
    } catch (e) {
      setMsg({ ok: false, txt: `Não consegui buscar no Contratos.gov.br: ${e instanceof Error ? e.message : String(e)}` });
    } finally { setOcupado(null); }
  }

  async function lerPdfs(arquivos: FileList | File[]) {
    setMsg(null);
    const lidos: { nome: string; achados: AchadosPdf }[] = [];
    for (const f of Array.from(arquivos).filter((x) => /\.pdf$/i.test(x.name) || x.type === "application/pdf")) {
      setOcupado(`Lendo ${f.name}…`);
      try { lidos.push({ nome: f.name, achados: extrairDoTexto(await textoDoPdf(f), { cnpjEmpresa: dados.empresa?.cnpj }) }); }
      catch { lidos.push({ nome: f.name, achados: { tipo: "OUTRO" } }); }
    }
    setOcupado(null);
    setPdfs((x) => [...lidos, ...x]);
    if (!lidos.length) setMsg({ ok: false, txt: "Escolha arquivos PDF (contrato, termo de referência, mapa comparativo, termos)." });
  }

  const usar = (f: (x: DadosReajuste) => DadosReajuste) => aplicar(f(structuredClone(dados)));
  const Botao = ({ onClick, children }: { onClick: () => void; children: string }) => (
    <button onClick={onClick} className="shrink-0 rounded border border-sky-300 bg-white px-2 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-50">{children}</button>
  );
  const Linha = ({ rotulo, valor, trecho, atual, onUsar }: { rotulo: string; valor: string; trecho: string; atual: string; onUsar: () => void }) => (
    <div className="flex items-start gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-xs"><b>{rotulo}:</b> {valor}{atual && atual !== valor && <span className="text-slate-500"> (hoje: {atual})</span>}</div>
        <div className="truncate text-[11px] text-slate-400" title={trecho}>“{trecho}”</div>
      </div>
      {atual === valor ? <span className="text-[11px] text-emerald-600">✓ igual</span> : <Botao onClick={onUsar}>Usar</Botao>}
    </div>
  );

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-sky-800">Completar sem digitar:</span>
        <button onClick={pelaApi} disabled={!!ocupado} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">🔎 Buscar no Contratos.gov.br</button>
        <label className={`cursor-pointer rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 ${ocupado ? "pointer-events-none opacity-50" : ""}`}>
          📄 Ler PDFs do contrato
          <input type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => { if (e.target.files) void lerPdfs(e.target.files); e.target.value = ""; }} />
        </label>
        <span className="text-[11px] text-slate-500">Busca os dados do contrato e lê sozinho o PDF do contrato (aba Arquivos do Contratos.gov.br) e o Termo de Referência da compra no PNCP: índice, cláusula, data do orçamento, representante, contratante e contratada. Para outro PDF (mapa comparativo, termos), use "Ler PDFs".</span>
      </div>
      {ocupado && <div className="mt-2 text-xs text-sky-700">⏳ {ocupado}</div>}
      {msg && <div className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.txt}</div>}
      {pdfs.map(({ nome, achados: a }, i) => (
        <div key={`${nome}-${i}`} className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-[11px] text-slate-500"><b className="text-slate-700">{nome}</b> · {a.tipo === "OUTRO" ? "não reconheci o documento" : a.tipo.toLowerCase()}</div>
          {!a.indice && !a.clausula && !a.dataBase && !a.representante && !a.endereco && !a.contratante && <div className="py-1 text-xs text-slate-500">{a.semTexto
            ? "PDF sem texto (imagem escaneada): não dá para ler sozinho."
            : "Não traz índice, cláusula, data do orçamento nem as partes do contrato."}</div>}
          <div className="divide-y divide-slate-100">
            {a.indice && <Linha rotulo="Índice" valor={a.indice.valor} trecho={a.indice.trecho} atual={dados.indice?.nome ?? ""} onUsar={() => usar((x) => ({ ...x, indice: { ...x.indice, nome: a.indice!.valor } }))} />}
            {a.clausula && <Linha rotulo="Cláusula do reajuste" valor={a.clausula.valor} trecho={a.clausula.trecho} atual={dados.indice?.clausula ?? ""} onUsar={() => usar((x) => ({ ...x, indice: { ...x.indice, clausula: a.clausula!.valor } }))} />}
            {a.dataBase && <Linha rotulo="Data do orçamento" valor={a.dataBase.valor} trecho={a.dataBase.trecho} atual={dados.data_base ?? ""} onUsar={() => usar((x) => ({ ...x, data_base: a.dataBase!.valor }))} />}
            {a.representante && <Linha rotulo="Representante da empresa" valor={a.representante.valor.nome} trecho={a.representante.trecho} atual={dados.empresa?.representante ?? ""}
              onUsar={() => usar((x) => ({ ...x, empresa: { ...x.empresa, representante: a.representante!.valor.nome, representante_feminino: a.representante!.valor.feminino } }))} />}
            {a.endereco && <Linha rotulo="Endereço da empresa" valor={a.endereco.valor} trecho={a.endereco.trecho} atual={dados.empresa?.endereco ?? ""} onUsar={() => usar((x) => ({ ...x, empresa: { ...x.empresa, endereco: a.endereco!.valor } }))} />}
            {a.omContratante && <Linha rotulo="OM contratante" valor={a.omContratante.valor} trecho={a.omContratante.trecho} atual={dados.om_contratante_nome ?? ""}
              onUsar={() => usar((x) => ({ ...x, om_contratante_nome: a.omContratante!.valor }))} />}
            {a.omSigla && <Linha rotulo="Sigla da OM" valor={a.omSigla.valor} trecho={a.omSigla.trecho} atual={dados.om_contratante_sigla ?? ""}
              onUsar={() => usar((x) => ({ ...x, om_contratante_sigla: a.omSigla!.valor }))} />}
            {a.contratante && <Linha rotulo="I – CONTRATANTE" valor={a.contratante.valor.replace(/\*\*/g, "")} trecho={a.contratante.trecho} atual={(dados.contratante_paragrafo ?? "").replace(/\*\*/g, "")}
              onUsar={() => usar((x) => ({ ...x, contratante_paragrafo: a.contratante!.valor }))} />}
            {a.contratada && <Linha rotulo="II – CONTRATADA" valor={a.contratada.valor.replace(/\*\*/g, "")} trecho={a.contratada.trecho} atual={(dados.contratada_paragrafo ?? "").replace(/\*\*/g, "")}
              onUsar={() => usar((x) => ({ ...x, contratada_paragrafo: a.contratada!.valor }))} />}
            {a.objeto && !dados.objeto_completo && <Linha rotulo="Objeto" valor={a.objeto.valor} trecho={a.objeto.trecho} atual="" onUsar={() => usar((x) => ({ ...x, objeto_completo: a.objeto!.valor }))} />}
          </div>
        </div>
      ))}
    </div>
  );
}
