import { useState } from "react";
import { acharContratoGov, completarCadastro, type ContratoGov } from "../../lib/apostilamento/contratosGov";
import { cadastroDoContrato, enderecoPeloCnpj, listaDaUg } from "../../lib/apostilamento/contratosGovApi";
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
};

/** Completa o cadastro sem digitar: Contratos.gov.br (partes, itens, termos, dotação, endereço pelo CNPJ)
 *  e leitura dos PDFs do contrato (índice, cláusula, data do orçamento, representante). Só sugere o que
 *  está vazio; a SCON confere antes de gerar. */
export default function CompletarAutomatico({ numero, pag, inicio, ug, contratoGov, dados, aplicar }: Props) {
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
      const final = novo as DadosReajuste;
      if (!final.empresa?.endereco && final.empresa?.cnpj) {
        setOcupado("Buscando o endereço da empresa pelo CNPJ…");
        const end = await enderecoPeloCnpj(final.empresa.cnpj);
        if (end) { final.empresa = { ...final.empresa, endereco: end }; preenchidos.push("empresa.endereco (cadastro do CNPJ)"); }
      }
      aplicar(final);
      setMsg({ ok: true, txt: (preenchidos.length ? `Preenchido pelo Contratos.gov.br: ${preenchidos.join(", ")}.` : "Nada vazio a preencher: o cadastro já tinha esses dados.")
        + (r.avisos.length ? ` Atenção: ${r.avisos.join("; ")}.` : "") + " Confira e salve." });
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
        <span className="text-[11px] text-slate-500">Itens, termos, dotação e endereço vêm do Contratos.gov.br; índice, cláusula, data do orçamento e representante, dos PDFs (contrato, TR, mapa comparativo). Os PDFs são lidos aqui no computador.</span>
      </div>
      {ocupado && <div className="mt-2 text-xs text-sky-700">⏳ {ocupado}</div>}
      {msg && <div className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.txt}</div>}
      {pdfs.map(({ nome, achados: a }, i) => (
        <div key={`${nome}-${i}`} className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-[11px] text-slate-500"><b className="text-slate-700">{nome}</b> · {a.tipo === "OUTRO" ? "não reconheci o documento" : a.tipo.toLowerCase()}</div>
          {!a.indice && !a.clausula && !a.dataBase && !a.representante && !a.endereco && <div className="py-1 text-xs text-slate-500">Nada útil encontrado neste PDF (pode ser imagem escaneada, sem texto).</div>}
          <div className="divide-y divide-slate-100">
            {a.indice && <Linha rotulo="Índice" valor={a.indice.valor} trecho={a.indice.trecho} atual={dados.indice?.nome ?? ""} onUsar={() => usar((x) => ({ ...x, indice: { ...x.indice, nome: a.indice!.valor } }))} />}
            {a.clausula && <Linha rotulo="Cláusula do reajuste" valor={a.clausula.valor} trecho={a.clausula.trecho} atual={dados.indice?.clausula ?? ""} onUsar={() => usar((x) => ({ ...x, indice: { ...x.indice, clausula: a.clausula!.valor } }))} />}
            {a.dataBase && <Linha rotulo="Data do orçamento" valor={a.dataBase.valor} trecho={a.dataBase.trecho} atual={dados.data_base ?? ""} onUsar={() => usar((x) => ({ ...x, data_base: a.dataBase!.valor }))} />}
            {a.representante && <Linha rotulo="Representante da empresa" valor={a.representante.valor.nome} trecho={a.representante.trecho} atual={dados.empresa?.representante ?? ""}
              onUsar={() => usar((x) => ({ ...x, empresa: { ...x.empresa, representante: a.representante!.valor.nome, representante_feminino: a.representante!.valor.feminino } }))} />}
            {a.endereco && <Linha rotulo="Endereço da empresa" valor={a.endereco.valor} trecho={a.endereco.trecho} atual={dados.empresa?.endereco ?? ""} onUsar={() => usar((x) => ({ ...x, empresa: { ...x.empresa, endereco: a.endereco!.valor } }))} />}
            {a.objeto && !dados.objeto_completo && <Linha rotulo="Objeto" valor={a.objeto.valor} trecho={a.objeto.trecho} atual="" onUsar={() => usar((x) => ({ ...x, objeto_completo: a.objeto!.valor }))} />}
          </div>
        </div>
      ))}
    </div>
  );
}
