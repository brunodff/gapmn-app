import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useExecucaoContratos } from "../../lib/contratos/useExecucaoContratos";
import type { ContratoScon } from "../../lib/apostilamento/cadastro";
import { CONFIG_VAZIA, type ConfigApostilamento } from "../../lib/apostilamento/tipos";
import PainelReajustes, { type Cadastro } from "./PainelReajustes";
import ConfigReajustes from "./ConfigReajustes";
import ReajusteContrato from "./ReajusteContrato";
import ImportarCarga from "./ImportarCarga";

type Contrato = ContratoScon & { status: string | null; data_inicio: string | null };
type Aba = "painel" | "config";

const SETORES = ["SCON", "ADMIN", "DEV"];

/** Reajuste por apostilamento (SCON): painel de cores, cadastro do reajuste por contrato e geração dos
 *  4 documentos pelo motor da SCON, que roda no navegador. Tela do app: /app?vista=reajustes[&contrato=…][&aba=config]. */
export default function Reajustes() {
  const [params, setParams] = useSearchParams();
  const aberto = params.get("contrato");
  const aba: Aba = params.get("aba") === "config" ? "config" : "painel";

  const [setor, setSetor] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [perfilOk, setPerfilOk] = useState(false);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [cadastros, setCadastros] = useState<Map<string, Cadastro>>(new Map());
  const [config, setConfig] = useState<ConfigApostilamento>(CONFIG_VAZIA);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user.id;
      if (uid) {
        const { data } = await supabase.from("profiles").select("setor, nome_guerra").eq("id", uid).maybeSingle();
        const p = data as { setor?: string | null; nome_guerra?: string | null } | null;
        setSetor(p?.setor?.toUpperCase() ?? null);
        setNome(p?.nome_guerra ?? s.session?.user.email ?? "");
      }
      setPerfilOk(true);
    })();
  }, []);

  const pode = !!setor && SETORES.includes(setor);
  const admin = setor === "ADMIN" || setor === "DEV";

  useEffect(() => {
    if (!pode) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const [c, a, g] = await Promise.all([
        supabase.from("contratos_scon")
          .select("id, numero_contrato, pag_nup, fornecedor, cnpj, descricao, data_orcamento, data_inicio, data_final, vl_contratual, status")
          .order("numero_contrato"),
        supabase.from("contratos_apostilamento")
          .select("numero_contrato, data_base:dados->>data_base, reajustes_aplicados, dedicacao_exclusiva, atualizado_em, situacao_cadastro, pendencias, carga_em, fora:carga->fora_da_carga"),
        supabase.from("apostilamento_config").select("ordenador, aci, cidade, ug_apoio, textos_fixos_om, dias_alerta").eq("id", "padrao").maybeSingle(),
      ]);
      if (!vivo) return;
      const falhas = [c.error && `contratos: ${c.error.message}`, a.error && `cadastros: ${a.error.message}`, g.error && `configuração: ${g.error.message}`].filter(Boolean);
      if (a.error?.code === "42P01" || g.error?.code === "42P01" || /does not exist|schema cache/i.test(`${a.error?.message} ${g.error?.message}`))
        setErro("O banco ainda não tem as tabelas ou colunas do reajuste (migração pendente: 20261116_reajuste_apostilamento ou 20261117b_reajuste_carga_siloms).");
      else setErro(falhas.length ? `Não carregou ${falhas.join("; ")}` : null);
      setContratos((c.data ?? []) as Contrato[]);
      setCadastros(new Map(((a.data ?? []) as unknown as Cadastro[]).map((x) => [x.numero_contrato, x])));
      if (g.data) setConfig({ ...CONFIG_VAZIA, ...(g.data as Partial<ConfigApostilamento>),
        ordenador: { ...CONFIG_VAZIA.ordenador, ...((g.data as Partial<ConfigApostilamento>).ordenador ?? {}) },
        aci: { ...CONFIG_VAZIA.aci, ...((g.data as Partial<ConfigApostilamento>).aci ?? {}) },
        ug_apoio: { ...CONFIG_VAZIA.ug_apoio, ...((g.data as Partial<ConfigApostilamento>).ug_apoio ?? {}) },
        textos_fixos_om: (g.data as Partial<ConfigApostilamento>).textos_fixos_om ?? {} });
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [pode, recarga]);

  const contrato = useMemo(() => contratos.find((c) => c.numero_contrato === aberto) ?? null, [contratos, aberto]);
  const ir = (p: { contrato?: string; aba?: Aba }) => {
    // mantém o resto do endereço (vista=reajustes)
    const q = new URLSearchParams(params);
    q.delete("contrato"); q.delete("aba");
    if (p.contrato) q.set("contrato", p.contrato);
    if (p.aba === "config") q.set("aba", "config");
    setParams(q);
  };

  if (!perfilOk) return <div className="p-6 text-sm text-slate-500">Carregando…</div>;
  if (!pode) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Esta tela é da Seção de Contratos (SCON), ADMIN e DEV.</div>;

  const configIncompleta = !config.ordenador.nome || !config.aci.nome;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Reajuste por apostilamento</h1>
          <p className="text-xs text-slate-500">Memória de cálculo, Declaração de Disponibilidade Orçamentária, Parecer Técnico e Termo de Apostilamento — regras da SCON.</p>
        </div>
        {!contrato && (
          <div className="ml-auto flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {(["painel", "config"] as Aba[]).map((x) => (
              <button key={x} onClick={() => ir({ aba: x })}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${aba === x ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {x === "painel" ? "Painel" : "Configurações"}
              </button>
            ))}
          </div>
        )}
      </div>

      {erro && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</div>}
      {configIncompleta && !carregando && !erro && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Faltam os dados do Ordenador de Despesas ou do Agente de Controle Interno em Configurações{admin ? "" : " (só ADMIN e DEV preenchem)"}: sem eles o termo e o parecer saem com o campo em branco.
        </div>
      )}

      {carregando ? <div className="p-6 text-sm text-slate-500">Carregando os contratos…</div>
        : aberto ? (contrato
          ? <DetalheComNE contratos={contratos} contrato={contrato} config={config} nomeUsuario={nome}
              aoVoltar={() => ir({})}
              aoSalvar={(r) => setCadastros((m) => new Map(m).set(r.numero_contrato, r))} />
          : <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Contrato {aberto} não encontrado. <button className="text-sky-700 hover:underline" onClick={() => ir({})}>Voltar ao painel</button></div>)
        : aba === "config"
          ? <ConfigReajustes config={config} podeEditar={admin} nomeUsuario={nome} aoSalvar={setConfig} />
          : <div className="space-y-3">
              <ImportarCarga contratos={contratos} config={config} nomeUsuario={nome} aoTerminar={() => setRecarga((n) => n + 1)} />
              <PainelReajustes contratos={contratos} cadastros={cadastros} diasAlerta={config.dias_alerta} aoAbrir={(n) => ir({ contrato: n })} />
            </div>}
    </div>
  );
}

/** A tela do contrato com a última NE dele (das planilhas de empenho) como sugestão do orçamento. */
function DetalheComNE({ contratos, contrato, ...resto }: { contratos: Contrato[]; contrato: Contrato } & Omit<Parameters<typeof ReajusteContrato>[0], "contrato" | "ultimaNE">) {
  const exec = useExecucaoContratos(contratos);
  const ne = exec.porContrato.get(contrato.id)?.nes[0];
  return <ReajusteContrato contrato={contrato} ultimaNE={ne ? { ne: ne.ne, pi: ne.pi, unidade: ne.unidade } : null} {...resto} />;
}
