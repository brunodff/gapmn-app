import { useState } from "react";
import { Caixa, Campo, CampoNumero, brl } from "../reajustes/campos";
import { contratadaDoCadastro, exercicioDotacao, minutaDoTermo, omParaTermo, pendenciasTermo, valorGarantia } from "../../lib/aditivos/termo";
import type { DadosReajuste } from "../../lib/apostilamento/tipos";
import type { AnalisePareceres } from "../../lib/aditivos/regras";
import type { DadosAditivo, TermoAditivoScon } from "../../lib/aditivos/tipos";
import type { UnidadeApoiada } from "../../lib/apostilamento/unidades";
import type { TermoGerado } from "../../lib/aditivos/kitAditivo";

const botao = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const sel = "w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none disabled:bg-slate-50";
export const SO_SCON = "Somente a Seção de Contratos gera o termo";

// Termo Aditivo (seção 3L da SCON, revisão 7): documento da Seção de Contratos, fora da Lista e do .zip do fiscal.
// Visível a todos; editável e gerável só por SCON (o banco confere o perfil). Sai do aditivo SALVO.
export default function TermoScon({ d, an, unidade, cadastro, podeScon, sujo, ocupado, gerado, previa, onChange, onTrazerContratada, onBuscarLicitacao, onLerGarantia, onPrevia, onGerar }: {
  d: DadosAditivo; an: AnalisePareceres; unidade: UnidadeApoiada | null; podeScon: boolean; sujo: boolean; ocupado: boolean;
  /** cadastro do contrato nos Reajustes: o que o aditivo não tiver da contratada vem daqui (como no termo gerado) */
  cadastro: Partial<DadosReajuste> | null;
  gerado: { em: string; por: string | null; versao: number; arquivo: string } | null | undefined;
  previa: TermoGerado | null;
  onChange: (f: (x: DadosAditivo) => DadosAditivo) => void;
  onTrazerContratada: () => void;
  onBuscarLicitacao: () => Promise<void>;
  onLerGarantia: () => Promise<void>;
  onPrevia: () => void;
  onGerar: () => void;
}) {
  const [lendo, setLendo] = useState<string | null>(null);
  const ta: TermoAditivoScon = d.termo_aditivo ?? {};
  const g = ta.garantia ?? { exige: null };
  const setTa = (p: Partial<TermoAditivoScon>) => onChange((x) => ({ ...x, termo_aditivo: { ...(x.termo_aditivo ?? {}), ...p } }));
  const setG = (p: Partial<NonNullable<TermoAditivoScon["garantia"]>>) => setTa({ garantia: { exige: null, ...(ta.garantia ?? {}), ...p } });
  const ro = !podeScon;
  const minuta = minutaDoTermo(d, an);
  const exercicio = exercicioDotacao({ ...d, termo_aditivo: { ...ta, exercicio: null } });
  const valorG = valorGarantia(d);
  const om = omParaTermo(d.om_signataria, unidade);
  const ct = d.contratada;
  // o termo completa a contratada com o cadastro do contrato: a tela mostra o que vai sair (placeholder) e avisa só do que falta
  const ctEf = contratadaDoCadastro(d, cadastro);
  const pend = pendenciasTermo({ ...d, contratada: ctEf }, unidade);
  const rodar = async (rotulo: string, f: () => Promise<void>) => { setLendo(rotulo); try { await f(); } finally { setLendo(null); } };

  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-600">Documento da Seção de Contratos: não entra na Lista nem no .zip do fiscal. {ro ? <b className="text-amber-700">Você vê os dados; só a SCON edita e gera.</b> : "Sai exatamente com o que está salvo no aditivo."}</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Nº do Termo Aditivo (controle da SCON)</span>
          <input className={sel} disabled={ro} value={ta.numero ?? ""} placeholder="001/2026" onChange={(e) => setTa({ numero: e.target.value || null })} /></label>
        <label className="block sm:col-span-2"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Licitação de origem</span>
          <div className="flex gap-1">
            <input className={sel} disabled={ro} value={d.licitacao ?? ""} placeholder="Pregão nº 07/2020" onChange={(e) => onChange((x) => ({ ...x, licitacao: e.target.value || null }))} />
            {!ro && <button className={botao} disabled={!!lendo} title="modalidade e número da compra no Contratos.gov.br (cerca de 40 s na 1ª vez)" onClick={() => void rodar("licitacao", onBuscarLicitacao)}>{lendo === "licitacao" ? "…" : "🔎"}</button>}
          </div></label>
        <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Exercício da dotação</span>
          <input className={sel} disabled={ro} value={ta.exercicio ?? ""} placeholder={exercicio ?? "____"} onChange={(e) => setTa({ exercicio: e.target.value || null })} />
          <span className="block text-[10px] text-slate-400 mt-0.5">vazio = {exercicio ?? "o do empenho"} (automático)</span></label>
        <div className="sm:col-span-4"><Campo rotulo='Complemento do preço (opcional; ex.: "valor referente a 6 meses de vigência do contrato")' valor={ta.preco_complemento ?? ""}
          ro={ro} onChange={(v) => setTa({ preco_complemento: v || null })} /></div>
      </div>

      <div className="rounded-lg border border-slate-200 p-2">
        <div className="mb-1 flex flex-wrap items-center gap-2"><b className="text-slate-700">Garantia de execução</b>
          {!ro && <button className={botao} disabled={!!lendo} onClick={() => void rodar("garantia", onLerGarantia)}>{lendo === "garantia" ? "Lendo o contrato e o TR…" : "📄 Ler no contrato/TR"}</button>}
          {g.fonte && <span className="text-slate-500">lido em: {g.fonte}</span>}</div>
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">O contrato/TR exige garantia?</span>
            <select className={sel} disabled={ro} value={g.exige == null ? "" : g.exige ? "sim" : "nao"} onChange={(e) => setG({ exige: e.target.value === "" ? null : e.target.value === "sim" })}>
              <option value="">não informado</option><option value="sim">sim</option><option value="nao">não (a cláusula sai)</option></select></label>
          {g.exige !== false && <>
            <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Percentual (%)</span>
              {ro ? <input className={sel} disabled value={g.percentual?.toLocaleString("pt-BR") ?? ""} /> : <CampoNumero valor={g.percentual ?? null} onChange={(v) => setG({ percentual: v })} className="w-full py-1.5" />}</label>
            <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Sobre</span>
              <select className={sel} disabled={ro} value={g.base ?? "termo"} onChange={(e) => setG({ base: e.target.value as "termo" | "contrato" })}>
                <option value="termo">o valor do Termo Aditivo</option><option value="contrato">o valor total do contrato</option></select></label>
            {g.base === "contrato" && <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">Valor total do contrato</span>
              {ro ? <input className={sel} disabled value={g.valor_base != null ? brl(g.valor_base) : ""} /> : <CampoNumero valor={g.valor_base ?? null} onChange={(v) => setG({ valor_base: v })} className="w-full py-1.5" />}</label>}
          </>}
        </div>
        <p className="mt-1 text-slate-500">{g.exige === false ? "Sem garantia: a cláusula sai e as seguintes são renumeradas."
          : `Garantia: ${valorG != null ? brl(valorG) : "—"} · 10 dias úteis após a assinatura · validade de 90 dias após a vigência (IN SEGES/MPDG nº 5/2017, Anexo VII-F).`}</p>
        {g.trecho && <p className="mt-1 text-[10.5px] italic text-slate-400">"{g.trecho}"</p>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block"><span className="block text-[11px] font-medium text-slate-600 mb-0.5">MINUTA (em vermelho)</span>
          <select className={sel} disabled={ro} value={ta.minuta == null ? "" : ta.minuta ? "sim" : "nao"} onChange={(e) => setTa({ minuta: e.target.value === "" ? null : e.target.value === "sim" })}>
            <option value="">automático: {an.vai_para_cju ? "sai (vai para a CJU)" : "não sai (parecer referencial)"}</option>
            <option value="sim">forçar: sai com MINUTA</option><option value="nao">forçar: sem MINUTA</option></select></label>
        <div className="rounded-md bg-slate-50 p-2 text-slate-600">
          <div><b>Contratante:</b> {om.nome || "—"} · {om.endereco || <span className="text-amber-700">sem endereço</span>} · CNPJ {om.cnpj || <span className="text-amber-700">—</span>} · {om.cidade || "—"}</div>
          <div><b>Ordenador:</b> {om.ordenador?.nome ? `${om.ordenador.posto} ${om.ordenador.nome}` : <span className="text-amber-700">não cadastrado (Reajustes › Configurações)</span>}</div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 p-2">
        <div className="mb-1 flex flex-wrap items-center gap-2"><b className="text-slate-700">Contratada</b>
          <button className={botao} onClick={onTrazerContratada}>↻ Trazer do cadastro do contrato</button></div>
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="sm:col-span-2"><Campo rotulo="Razão social" valor={ct?.nome ?? ""} placeholder={ctEf?.nome} onChange={(v) => onChange((x) => ({ ...x, contratada: { ...(x.contratada ?? { nome: "" }), nome: v } }))} /></div>
          <Campo rotulo="CNPJ" valor={ct?.cnpj ?? ""} placeholder={ctEf?.cnpj} onChange={(v) => onChange((x) => ({ ...x, contratada: { ...(x.contratada ?? { nome: "" }), cnpj: v } }))} />
          <div>
            <Campo rotulo="Representante" valor={ct?.representante ?? ""} placeholder={ctEf?.representante} onChange={(v) => onChange((x) => ({ ...x, contratada: { ...(x.contratada ?? { nome: "" }), representante: v } }))} />
            <Caixa rotulo="feminino (a Sra.)" marcado={!!(ct?.representante_feminino ?? ctEf?.representante_feminino)} onChange={(v) => onChange((x) => ({ ...x, contratada: { ...(x.contratada ?? { nome: "" }), representante_feminino: v } }))} />
          </div>
          <div className="sm:col-span-4"><Campo rotulo='Endereço (como no contrato: "na Rua…, em Cidade/UF, CEP…")' valor={ct?.endereco ?? ""} placeholder={ctEf?.endereco} onChange={(v) => onChange((x) => ({ ...x, contratada: { ...(x.contratada ?? { nome: "" }), endereco: v } }))} /></div>
          {cadastro?.empresa?.nome && <p className="sm:col-span-4 text-[10.5px] text-slate-400">Em branco = o do cadastro do contrato (Reajustes), que aparece em cinza.</p>}
        </div>
      </div>

      {pend.length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800">O termo sai com estes campos em amarelo: {pend.join("; ")}.</div>}
      {gerado && <p className="text-emerald-700">📜 Gerado por {gerado.por ?? "—"} em {new Date(gerado.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} (salvamento nº {gerado.versao}): {gerado.arquivo}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button className={botao} disabled={ocupado || sujo} onClick={onPrevia}>👁 Prévia do termo</button>
        <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50" disabled={ocupado || sujo || !podeScon}
          title={!podeScon ? SO_SCON : sujo ? "Salve antes de baixar" : undefined} onClick={onGerar}>📜 Gerar Termo Aditivo (SCON)</button>
        {!podeScon && <span className="text-slate-500">{SO_SCON}.</span>}
        {sujo && <span className="text-amber-700">Salve antes de baixar – os documentos saem exatamente com o que está salvo.</span>}
        <span className="text-slate-500">{minuta ? "Sai com MINUTA (vai para a CJU)." : "Sem MINUTA (parecer referencial)."}</span>
      </div>
      {previa && (
        <div className="rounded-md border border-slate-200 bg-white p-2">
          <div className="mb-1 flex flex-wrap items-center gap-2"><b className="text-slate-700">Prévia (texto do documento que o kit gera)</b>
            {previa.avisos.length > 0 && <span className="text-amber-700">{previa.avisos.length} aviso(s)</span>}</div>
          {previa.erros.length > 0 && <p className="text-red-700">{previa.erros.join("; ")}</p>}
          {previa.avisos.length > 0 && <ul className="mb-1 list-disc pl-5 text-amber-700">{previa.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
          <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-serif text-[12px] leading-snug text-slate-800">
            {previa.texto.map((t, i) => <p key={i} className={/^(MINUTA)$/.test(t) ? "text-center font-bold text-red-600" : /^\d+\. CLÁUSULA/.test(t) ? "mt-2 font-bold" : "mb-1"}>{t}</p>)}
          </div>
        </div>
      )}
    </div>
  );
}
