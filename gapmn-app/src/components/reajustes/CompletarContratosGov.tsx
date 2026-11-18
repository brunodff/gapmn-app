import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { dadosIniciais, reajustesAplicados, type ContratoScon } from "../../lib/apostilamento/cadastro";
import { pendenciasCadastro, situacaoCadastro, type CargaGuardada } from "../../lib/apostilamento/carga";
import { acharContratoGov, completarCadastro, type ContratoGov } from "../../lib/apostilamento/contratosGov";
import { cadastroDoContrato, enderecoPeloCnpj, listaDaUg } from "../../lib/apostilamento/contratosGovApi";
import type { ConfigApostilamento, DadosReajuste } from "../../lib/apostilamento/tipos";

type Contrato = ContratoScon & { data_inicio?: string | null };
type Existente = { numero_contrato: string; dados: Partial<DadosReajuste> | null; versao: number; dedicacao_exclusiva: boolean; carga: CargaGuardada | null; situacao_cadastro: string | null };
type Linha = { numero_contrato: string; dados: Partial<DadosReajuste>; versao: number; reajustes_aplicados: number; situacao_cadastro: string; pendencias: string[];
  carga: Record<string, unknown>; antes: number; depois: number; preenchidos: number };
type Previa = { linhas: Linha[]; semPar: string[]; falhas: string[]; jaCompletos: number };

const LOTE = 50;
const PARALELO = 3;

type Props = { contratos: Contrato[]; config: ConfigApostilamento; nomeUsuario: string; ug: string; aoTerminar: () => void };

/** Completa de uma vez o cadastro de todos os contratos pelo Contratos.gov.br (sem robô no SILOMS):
 *  partes, itens, termos, dotação e endereço pelo CNPJ. Só preenche o que está vazio; mostra a prévia antes. */
export default function CompletarContratosGov({ contratos, config, nomeUsuario, ug, aoTerminar }: Props) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const opPend = { textosFixos: config.textos_fixos_om, omPadrao: config.ordenador.om_sigla || "GAP-MN" };

  async function buscar() {
    setMsg(null); setPrevia(null);
    try {
      setOcupado("Buscando os contratos ativos da UG no Contratos.gov.br (cerca de 40 s)…");
      const lista = await listaDaUg(ug);
      const { data, error } = await supabase.from("contratos_apostilamento").select("numero_contrato, dados, versao, dedicacao_exclusiva, carga, situacao_cadastro");
      if (error) throw new Error(error.message);
      const existentes = new Map(((data ?? []) as Existente[]).map((e) => [e.numero_contrato, e]));
      // nome por extenso da OM contratante: o da unidade de apoio ou o que a SCON já digitou para a mesma sigla
      const chaveOm = (s: unknown) => String(s ?? "").trim().toUpperCase();
      const nomesOm = new Map<string, string>();
      if (config.ug_apoio.sigla && config.ug_apoio.nome) nomesOm.set(chaveOm(config.ug_apoio.sigla), config.ug_apoio.nome);
      for (const e of existentes.values()) {
        const sigla = chaveOm(e.dados?.om_contratante_sigla), nome = e.dados?.om_contratante_nome;
        if (sigla && nome && !nomesOm.has(sigla)) nomesOm.set(sigla, nome);
      }
      const fila: { c: Contrato; gov: ContratoGov }[] = [];
      const semPar: string[] = [];
      let jaCompletos = 0;
      for (const c of contratos) {
        const ex = existentes.get(c.numero_contrato);
        if (ex?.situacao_cadastro === "COMPLETO" || ex?.dedicacao_exclusiva) { jaCompletos++; continue; }
        const gov = acharContratoGov(c.numero_contrato, c.pag_nup, c.data_inicio, lista);
        if (gov) fila.push({ c, gov }); else if (ex || (c.data_final ?? "") >= new Date().toISOString().slice(0, 10)) semPar.push(c.numero_contrato);
      }
      const linhas: Linha[] = [], falhas: string[] = [];
      let feitos = 0;
      const trabalhar = async () => {
        for (let item = fila.shift(); item; item = fila.shift()) {
          const { c, gov } = item;
          try {
            const ex = existentes.get(c.numero_contrato);
            const base = { ...dadosIniciais(c), ...((ex?.dados ?? {}) as DadosReajuste) };
            const antes = pendenciasCadastro(base, { ...opPend, dedicacao: false }).length;
            const r = await cadastroDoContrato(gov);
            const { dados, preenchidos } = completarCadastro(base, r.dados);
            if (!dados.empresa?.endereco && dados.empresa?.cnpj) {
              const end = await enderecoPeloCnpj(dados.empresa.cnpj);
              if (end) { dados.empresa = { ...dados.empresa, endereco: end }; preenchidos.push("empresa.endereco"); }
            }
            const nomeOm = nomesOm.get(chaveOm(dados.om_contratante_sigla));
            if (!dados.om_contratante_nome && nomeOm) { dados.om_contratante_nome = nomeOm; preenchidos.push("om_contratante_nome"); }
            const pend = pendenciasCadastro(dados, { ...opPend, dedicacao: false });
            linhas.push({
              numero_contrato: c.numero_contrato, dados, versao: (ex?.versao ?? 0) + 1, reajustes_aplicados: reajustesAplicados(dados as DadosReajuste),
              situacao_cadastro: situacaoCadastro(pend, false), pendencias: pend, antes, depois: pend.length, preenchidos: preenchidos.length,
              carga: { ...((ex?.carga ?? {}) as Record<string, unknown>), contratos_gov: { id: gov.id, numero: gov.numero, atualizado_em: new Date().toISOString().slice(0, 10),
                documentos: r.documentos, ultimo_empenho: r.ultimo_empenho, avisos: r.avisos } },
            });
          } catch (e) {
            falhas.push(`${c.numero_contrato} (${e instanceof Error ? e.message : String(e)})`);
          }
          feitos++;
          setOcupado(`Lendo contratos no Contratos.gov.br: ${feitos} de ${feitos + fila.length}…`);
        }
      };
      await Promise.all(Array.from({ length: PARALELO }, trabalhar));
      setPrevia({ linhas: linhas.sort((a, b) => a.numero_contrato.localeCompare(b.numero_contrato)), semPar, falhas, jaCompletos });
    } catch (e) {
      setMsg({ ok: false, txt: `Não consegui buscar no Contratos.gov.br: ${e instanceof Error ? e.message : String(e)}` });
    } finally { setOcupado(null); }
  }

  async function gravar() {
    if (!previa) return;
    try {
      const agora = new Date().toISOString();
      const uteis = previa.linhas.filter((l) => l.preenchidos > 0);
      for (let i = 0; i < uteis.length; i += LOTE) {
        setOcupado(`Gravando ${Math.min(i + LOTE, uteis.length)} de ${uteis.length}…`);
        const lote = uteis.slice(i, i + LOTE).map(({ numero_contrato, dados, versao, reajustes_aplicados, situacao_cadastro, pendencias, carga }) => ({
          numero_contrato, dados, versao, reajustes_aplicados, situacao_cadastro, pendencias, carga,
          atualizado_nome: `Contratos.gov.br (${nomeUsuario})`, atualizado_em: agora,
        }));
        const { error } = await supabase.from("contratos_apostilamento").upsert(lote, { onConflict: "numero_contrato" });
        if (error) throw new Error(error.message);
      }
      const comp = uteis.filter((l) => l.situacao_cadastro === "COMPLETO").length;
      setMsg({ ok: true, txt: `${uteis.length} cadastros completados pelo Contratos.gov.br (${comp} já prontos para gerar). O que falta (índice, cláusula, data do orçamento, representante) sai dos PDFs, em cada contrato.` });
      setPrevia(null);
      aoTerminar();
    } catch (e) {
      setMsg({ ok: false, txt: `A gravação parou: ${e instanceof Error ? e.message : String(e)}. O que já foi gravado fica.` });
    } finally { setOcupado(null); }
  }

  const contagem = (lista: string[][]) => {
    const m = new Map<string, number>();
    for (const ps of lista) for (const p of ps) { const k = p.replace(/^Item \d+:/, "Item:"); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={buscar} disabled={!!ocupado} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
          🔎 Completar todos pelo Contratos.gov.br
        </button>
        <span className="text-[11px] text-slate-500">Partes, itens, termos, dotação do último empenho e endereço pelo CNPJ, direto da API pública — sem robô no SILOMS. Só preenche o que está vazio.</span>
      </div>
      {ocupado && <div className="mt-2 text-xs text-sky-700">⏳ {ocupado}</div>}
      {msg && <div className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.txt}</div>}
      {previa && (
        <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
          <div>Achados no Contratos.gov.br: <b>{previa.linhas.length}</b> · já completos ou com dedicação exclusiva (não mexi): {previa.jaCompletos} · sem par: {previa.semPar.length}{previa.falhas.length ? ` · falharam: ${previa.falhas.length}` : ""}</div>
          <div>Pendências: <b>{previa.linhas.reduce((s, l) => s + l.antes, 0)}</b> antes → <b className="text-emerald-700">{previa.linhas.reduce((s, l) => s + l.depois, 0)}</b> depois ·
            <b className="text-emerald-700"> {previa.linhas.filter((l) => l.situacao_cadastro === "COMPLETO").length} ficam completos</b></div>
          <div className="text-slate-600">O que mais falta depois (vem dos PDFs, em cada contrato): {contagem(previa.linhas.map((l) => l.pendencias)).map(([p, n]) => `${p} (${n})`).join(" · ")}</div>
          {!!previa.semPar.length && <div className="text-amber-700">Sem par no Contratos.gov.br ({previa.semPar.length}): {previa.semPar.slice(0, 15).join(", ")}{previa.semPar.length > 15 ? "…" : ""} — adesões antigas e contratos fora do sistema; complete pela carga do SILOMS ou à mão.</div>}
          {!!previa.falhas.length && <div className="text-red-700">Falharam (tente de novo depois): {previa.falhas.slice(0, 5).join("; ")}</div>}
          <div className="flex gap-2 pt-1">
            <button onClick={gravar} disabled={!!ocupado || !previa.linhas.some((l) => l.preenchidos)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              Gravar {previa.linhas.filter((l) => l.preenchidos).length} cadastros
            </button>
            <button onClick={() => setPrevia(null)} disabled={!!ocupado} className="text-xs text-slate-500">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
