import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useExecucaoContratos } from "../../lib/contratos/useExecucaoContratos";
import type { ContratoScon } from "../../lib/apostilamento/cadastro";
import { CONFIG_VAZIA, type ConfigApostilamento } from "../../lib/apostilamento/tipos";
import PainelReajustes, { type Cadastro } from "./PainelReajustes";
import UnidadesApoiadas from "./UnidadesApoiadas";
import { carregarUnidades } from "../../lib/apostilamento/unidadesBanco";
import { configDaUnidade, unidadePadrao, type UnidadeApoiada } from "../../lib/apostilamento/unidades";
import ReajusteContrato from "./ReajusteContrato";
import ImportarCarga from "./ImportarCarga";
import CompletarContratosGov from "./CompletarContratosGov";

/** UG do GAP-MN no Contratos.gov.br (os contratos da SCON estão nela) */
const UG_GAPMN = "120630";

type Contrato = ContratoScon & { status: string | null; data_inicio: string | null };
type Aba = "painel" | "config";

/** Carga do SILOMS e completar todos pelo Contratos.gov.br (gravam muitos cadastros de uma vez) */
const SETORES_LOTE = ["SCON", "ADMIN", "DEV"];

/** Reajuste por apostilamento: painel de cores, cadastro do reajuste por contrato e geração dos documentos
 *  pelo motor da SCON, que roda no navegador. Todos os usuários do app usam (fiscais e gestores criam os
 *  documentos); as ferramentas em lote ficam com SCON, ADMIN e DEV e a configuração, com ADMIN e DEV.
 *  Tela do app: /app?vista=reajustes[&contrato=…][&aba=config]. */
export default function Reajustes() {
  const [params, setParams] = useSearchParams();
  const aberto = params.get("contrato");
  const aba: Aba = params.get("aba") === "config" ? "config" : "painel";
  const novaUnidade = params.get("nova");
  // "Fazer o reajuste no módulo Reajustes" do termo aditivo: abre com Instrumento = Termo Aditivo e o nº do TA
  const taPedido = params.get("instrumento") === "aditivo" ? Number(params.get("ta")) || null : null;

  const [logado, setLogado] = useState(false);
  const [setor, setSetor] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [perfilOk, setPerfilOk] = useState(false);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [cadastros, setCadastros] = useState<Map<string, Cadastro>>(new Map());
  const [config, setConfig] = useState<ConfigApostilamento>(CONFIG_VAZIA);
  const [unidades, setUnidades] = useState<UnidadeApoiada[]>([]);
  const [tabelaUnidades, setTabelaUnidades] = useState(true);
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
        setLogado(true);
        setSetor(p?.setor?.toUpperCase() ?? null);
        setNome(p?.nome_guerra ?? s.session?.user.email ?? "");
      }
      setPerfilOk(true);
    })();
  }, []);

  const pode = logado;
  const lote = !!setor && SETORES_LOTE.includes(setor);

  useEffect(() => {
    if (!pode) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const [c, a, u] = await Promise.all([
        supabase.from("contratos_scon")
          .select("id, numero_contrato, pag_nup, fornecedor, cnpj, descricao, data_orcamento, data_inicio, data_final, vl_contratual, status")
          .order("numero_contrato"),
        supabase.from("contratos_apostilamento")
          .select("numero_contrato, data_base:dados->>data_base, reajustes_aplicados, dedicacao_exclusiva, atualizado_em, situacao_cadastro, pendencias, carga_em, fora:carga->fora_da_carga, nao_aplicavel:carga->siloms->>reajuste_nao_aplicavel, vig_siloms:carga->siloms->>vigencia_fim"),
        carregarUnidades(),
      ]);
      if (!vivo) return;
      const falhas = [c.error && `contratos: ${c.error.message}`, a.error && `cadastros: ${a.error.message}`].filter(Boolean);
      if (a.error?.code === "42P01" || /does not exist|schema cache/i.test(`${a.error?.message}`))
        setErro("O banco ainda não tem as tabelas ou colunas do reajuste (migração pendente: 20261116_reajuste_apostilamento ou 20261117b_reajuste_carga_siloms).");
      else setErro(falhas.length ? `Não carregou ${falhas.join("; ")}` : null);
      setContratos((c.data ?? []) as Contrato[]);
      setCadastros(new Map(((a.data ?? []) as unknown as Cadastro[]).map((x) => [x.numero_contrato, x])));
      // configuração base = a da unidade padrão (GAP-MN); cada contrato usa a da OM que assina (ReajusteContrato)
      setUnidades(u.unidades); setTabelaUnidades(u.tabela);
      const padrao = unidadePadrao(u.unidades);
      if (padrao) setConfig(configDaUnidade(padrao, padrao.sigla));
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [pode, recarga]);

  const contrato = useMemo(() => contratos.find((c) => c.numero_contrato === aberto) ?? null, [contratos, aberto]);
  // depois de salvar uma unidade: relê só as unidades (a tela de Configurações continua aberta, com a mensagem)
  const recarregarUnidades = async () => {
    const u = await carregarUnidades();
    setUnidades(u.unidades); setTabelaUnidades(u.tabela);
    const padrao = unidadePadrao(u.unidades);
    if (padrao) setConfig(configDaUnidade(padrao, padrao.sigla));
  };
  const ir = (p: { contrato?: string; aba?: Aba; nova?: string }) => {
    // mantém o resto do endereço (vista=reajustes)
    const q = new URLSearchParams(params);
    q.delete("contrato"); q.delete("aba"); q.delete("nova"); q.delete("instrumento"); q.delete("ta");
    if (p.contrato) q.set("contrato", p.contrato);
    if (p.aba === "config") q.set("aba", "config");
    if (p.nova) q.set("nova", p.nova);
    setParams(q);
  };

  if (!perfilOk) return <div className="p-6 text-sm text-slate-500">Carregando…</div>;
  if (!pode) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Entre no gapmn.app para usar o reajuste dos contratos.</div>;

  const configIncompleta = !config.ordenador.nome || !config.aci.nome;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Reajuste por apostilamento</h1>
          <p className="text-xs text-slate-500">Memória de cálculo, Declaração de Disponibilidade Orçamentária, Parecer Técnico, Termo de Apostilamento e Checklist do Fiscal — regras da SCON.</p>
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
          Faltam os dados do Ordenador de Despesas ou do Agente de Controle Interno da unidade padrão em Configurações: sem eles o termo e o parecer saem com o campo em branco.
        </div>
      )}

      {carregando ? <div className="p-6 text-sm text-slate-500">Carregando os contratos…</div>
        : aberto ? (contrato
          ? <DetalheComNE contratos={contratos} contrato={contrato} config={config} nomeUsuario={nome} ugGov={UG_GAPMN}
              unidades={unidades} aoCadastrarUnidade={(sigla) => ir({ aba: "config", nova: sigla })} taPedido={taPedido}
              aoVoltar={() => ir({})}
              aoSalvar={(r) => setCadastros((m) => new Map(m).set(r.numero_contrato, r))} />
          : <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Contrato {aberto} não encontrado. <button className="text-sky-700 hover:underline" onClick={() => ir({})}>Voltar ao painel</button></div>)
        : aba === "config"
          ? <UnidadesApoiadas unidades={unidades} tabela={tabelaUnidades} nomeUsuario={nome} aoMudar={() => void recarregarUnidades()}
              novaSigla={novaUnidade} aoUsarNovaSigla={() => { const q = new URLSearchParams(params); q.delete("nova"); setParams(q, { replace: true }); }} />
          : <div className="space-y-3">
              {lote && <CompletarContratosGov contratos={contratos} config={config} nomeUsuario={nome} ug={UG_GAPMN} aoTerminar={() => setRecarga((n) => n + 1)} />}
              {lote && <ImportarCarga contratos={contratos} config={config} nomeUsuario={nome} aoTerminar={() => setRecarga((n) => n + 1)} />}
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
