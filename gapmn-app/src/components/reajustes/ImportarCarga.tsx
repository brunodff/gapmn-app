import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { casarContratos, cargaGuardada, cargaMaisNova, lerCarga, mesclarDados, motivoForaDaAutomacao, pendenciasCadastro, situacaoCadastro,
  type Carga, type CargaGuardada, type Par, type RegistroCarga } from "../../lib/apostilamento/carga";
import type { ConfigApostilamento, DadosReajuste } from "../../lib/apostilamento/tipos";

type Existente = { numero_contrato: string; dados: Partial<DadosReajuste> | null; versao: number; dedicacao_exclusiva: boolean;
  editado_no_app_em: string | null; carga: CargaGuardada | null };
type Linha = Record<string, unknown> & { numero_contrato: string; situacao_cadastro: string };
type Previa = { carga: Carga; pares: Par[]; semPar: RegistroCarga[]; linhas: Linha[]; novos: number; fora: string[]; arquivo: string };

type Props = {
  contratos: { numero_contrato: string; pag_nup: string | null }[];
  config: ConfigApostilamento;
  nomeUsuario: string;
  aoTerminar: () => void;
};

const LOTE = 50;

/** Importa o arquivo carga_contratos_AAAA-MM-DD.json que a SCON gera do SILOMS: junta cada contrato ao
 *  cadastro do reajuste (sem apagar o que foi digitado no app), guarda documentos e último empenho e
 *  recalcula as pendências. Mostra a prévia antes de gravar. */
export default function ImportarCarga({ contratos, config, nomeUsuario, aoTerminar }: Props) {
  const [aberto, setAberto] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function lerArquivo(f: File) {
    setPrevia(null); setMsg(null); setOcupado("Lendo a carga…");
    try {
      const carga = lerCarga(JSON.parse(await f.text()));
      const { data, error } = await supabase.from("contratos_apostilamento")
        .select("numero_contrato, dados, versao, dedicacao_exclusiva, editado_no_app_em, carga");
      if (error) throw new Error(error.message);
      const existentes = new Map(((data ?? []) as Existente[]).map((e) => [e.numero_contrato, e]));
      const { pares, semPar } = casarContratos(carga.contratos, contratos);
      const agora = new Date().toISOString();
      const opPend = { textosFixos: config.textos_fixos_om, omPadrao: config.ordenador.om_sigla || "GAP-MN" };
      let novos = 0;
      const linhas: Linha[] = pares.map(({ reg, numero_contrato }) => {
        const ex = existentes.get(numero_contrato);
        if (!ex) novos++;
        const manda = cargaMaisNova(reg.atualizado_em ?? carga.gerado_em, ex?.editado_no_app_em);
        const dados = mesclarDados(ex?.dados, reg.dados, manda);
        if (!dados.contrato) dados.contrato = numero_contrato;
        if (!dados.nup && reg.siloms?.pag) dados.nup = reg.siloms.pag;
        const dedicacao = reg.siloms?.dedicacao_exclusiva ?? ex?.dedicacao_exclusiva ?? false;
        // fora da automação: dedicação exclusiva (repactuação) ou sem reajuste por índice (adesão, credenciamento)
        const fora = !!motivoForaDaAutomacao(reg.siloms, dedicacao);
        const pend = pendenciasCadastro(dados, { ...opPend, dedicacao: fora });
        return {
          numero_contrato, dados, dedicacao_exclusiva: dedicacao,
          reajustes_aplicados: (dados.reajustes ?? []).filter((r) => !r.novo).length,
          carga: cargaGuardada(reg, carga), carga_em: agora,
          situacao_cadastro: situacaoCadastro(pend, fora), pendencias: pend,
          versao: (ex?.versao ?? 0) + 1,
          atualizado_nome: `carga do SILOMS (${nomeUsuario})`, atualizado_em: agora,
        };
      });
      // Coleta de todos os contratos ativos: quem estava numa carga anterior e não veio fica marcado
      const casados = new Set(pares.map((p) => p.numero_contrato));
      const fora = carga.lista_completa
        ? [...existentes.values()].filter((e) => e.carga && !e.carga.fora_da_carga && !casados.has(e.numero_contrato)).map((e) => e.numero_contrato)
        : [];
      setPrevia({ carga, pares, semPar, linhas, novos, fora, arquivo: f.name });
    } catch (e) {
      setMsg({ ok: false, txt: `Não li a carga: ${e instanceof Error ? e.message : String(e)}` });
    } finally { setOcupado(null); }
  }

  async function importar() {
    if (!previa) return;
    setMsg(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user.id ?? null;
      for (let i = 0; i < previa.linhas.length; i += LOTE) {
        setOcupado(`Gravando ${Math.min(i + LOTE, previa.linhas.length)} de ${previa.linhas.length}…`);
        const lote = previa.linhas.slice(i, i + LOTE).map((l) => ({ ...l, atualizado_por: uid }));
        const { error } = await supabase.from("contratos_apostilamento").upsert(lote, { onConflict: "numero_contrato" });
        if (error) throw new Error(error.message);
      }
      for (const n of previa.fora) {
        const { data } = await supabase.from("contratos_apostilamento").select("carga").eq("numero_contrato", n).maybeSingle();
        const c = (data?.carga ?? {}) as CargaGuardada;
        await supabase.from("contratos_apostilamento").update({ carga: { ...c, fora_da_carga: true } }).eq("numero_contrato", n);
      }
      const comp = previa.linhas.filter((l) => l.situacao_cadastro === "COMPLETO").length;
      setMsg({ ok: true, txt: `Carga de ${previa.carga.gerado_em ?? "?"} importada: ${previa.linhas.length} contratos (${previa.novos} novos no cadastro), ` +
        `${comp} completos para gerar${previa.fora.length ? `, ${previa.fora.length} marcados como fora da carga` : ""}.` });
      setPrevia(null);
      aoTerminar();
    } catch (e) {
      setMsg({ ok: false, txt: `A importação parou: ${e instanceof Error ? e.message : String(e)}. O que já foi gravado fica; importe de novo para completar.` });
    } finally { setOcupado(null); }
  }

  const conta = (s: string) => previa?.linhas.filter((l) => l.situacao_cadastro === s).length ?? 0;
  const porComo = (c: Par["como"]) => previa?.pares.filter((p) => p.como === c).length ?? 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setAberto((v) => !v)} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100">
          📥 Importar carga do SILOMS
        </button>
        <span className="text-[11px] text-slate-500">Arquivo carga_contratos_AAAA-MM-DD.json gerado pela SCON: completa o cadastro dos contratos para gerar os documentos.</span>
      </div>
      {aberto && (
        <div className="mt-3 space-y-2">
          <input type="file" accept=".json,application/json" className="text-xs" disabled={!!ocupado}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) lerArquivo(f); e.target.value = ""; }} />
          {previa && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
              <div><b>{previa.arquivo}</b> · gerada em {previa.carga.gerado_em ?? "?"} · {previa.carga.contratos.length} contratos
                {previa.carga.lista_completa ? " (todos os ativos)" : " (coleta parcial)"}</div>
              <div>Achados no app: <b>{previa.pares.length}</b> ({porComo("exato")} pelo nº, {porComo("numero")} pelo nº sem o prefixo, {porComo("pag")} pelo PAG) · {previa.novos} ainda sem cadastro de reajuste</div>
              <div>Depois da importação: <b className="text-emerald-700">{conta("COMPLETO")} completos</b> · <b className="text-amber-700">{conta("PENDENTE")} com pendências</b> · {conta("NAO_SE_APLICA")} fora da automação (repactuação, tarifa regulada ou tabela de credenciamento)</div>
              {!!previa.fora.length && <div>{previa.fora.length} contrato(s) de cargas anteriores não vieram nesta e ficam marcados como fora da carga.</div>}
              {!!previa.semPar.length && (
                <div className="text-amber-700">Não achei no app ({previa.semPar.length}): {previa.semPar.map((r) => r.chave).join(", ")} — cadastre o contrato em Contratos e importe de novo.</div>
              )}
              <div className="text-[11px] text-slate-500">O que foi digitado no app depois da data da coleta não é substituído: a carga só preenche o que estiver vazio.</div>
              <div className="flex gap-2 pt-1">
                <button onClick={importar} disabled={!!ocupado || !previa.linhas.length} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                  Importar {previa.linhas.length} contratos
                </button>
                <button onClick={() => setPrevia(null)} disabled={!!ocupado} className="text-xs text-slate-500">Cancelar</button>
              </div>
            </div>
          )}
          {ocupado && <div className="text-xs text-slate-500 animate-pulse">{ocupado}</div>}
        </div>
      )}
      {msg && <div className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.txt}</div>}
    </div>
  );
}
