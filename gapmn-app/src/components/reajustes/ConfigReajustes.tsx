import { useState } from "react";
import { supabase } from "../../lib/supabase";
import type { ConfigApostilamento } from "../../lib/apostilamento/tipos";
import { Campo, Caixa, Secao } from "./campos";

type Props = { config: ConfigApostilamento; podeEditar: boolean; nomeUsuario: string; aoSalvar: (c: ConfigApostilamento) => void;
  /** guarda em outro lugar (outras OMs: no navegador); devolve o erro ou null */
  guardar?: (c: ConfigApostilamento) => Promise<string | null> };

/** Dados que o motor usa e não ficam no código: Ordenador de Despesas, ACI e textos fixos do "I – CONTRATANTE". */
export default function ConfigReajustes({ config, podeEditar, nomeUsuario, aoSalvar, guardar }: Props) {
  const [c, setC] = useState<ConfigApostilamento>(config);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [novaOm, setNovaOm] = useState("");
  const set = <K extends keyof ConfigApostilamento>(k: K, v: ConfigApostilamento[K]) => setC((x) => ({ ...x, [k]: v }));

  async function salvar() {
    setSalvando(true); setMsg(null);
    if (guardar) {
      const e = await guardar(c);
      setSalvando(false);
      if (e) { setMsg({ ok: false, txt: `Não salvou: ${e}` }); return; }
      setMsg({ ok: true, txt: "Configuração salva neste navegador." });
      aoSalvar(c);
      return;
    }
    const { data: s } = await supabase.auth.getSession();
    const { error } = await supabase.from("apostilamento_config").upsert({
      id: "padrao", ordenador: c.ordenador, aci: c.aci, cidade: c.cidade, ug_apoio: c.ug_apoio,
      textos_fixos_om: c.textos_fixos_om, dias_alerta: c.dias_alerta,
      atualizado_por: s.session?.user.id ?? null, atualizado_nome: nomeUsuario, atualizado_em: new Date().toISOString(),
    });
    setSalvando(false);
    if (error) { setMsg({ ok: false, txt: `Não salvou: ${error.message}` }); return; }
    setMsg({ ok: true, txt: "Configuração salva." });
    aoSalvar(c);
  }

  const ro = !podeEditar;
  return (
    <div className="max-w-4xl space-y-4">
      {ro && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Só ADMIN e DEV alteram a configuração. Os demais usuários veem os dados usados nos documentos.</p>}
      <Secao titulo="Ordenador de Despesas (qualificação no termo e assinatura)">
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Nome" valor={c.ordenador.nome} ro={ro} onChange={(v) => set("ordenador", { ...c.ordenador, nome: v })} />
          <Campo rotulo="Posto/quadro (ex.: Cel Int)" valor={c.ordenador.posto} ro={ro} onChange={(v) => set("ordenador", { ...c.ordenador, posto: v })} />
          <Campo rotulo="Portaria de nomeação" valor={c.ordenador.portaria} ro={ro} onChange={(v) => set("ordenador", { ...c.ordenador, portaria: v })} />
          <Campo rotulo="Publicação (BCA)" valor={c.ordenador.publicacao} ro={ro} onChange={(v) => set("ordenador", { ...c.ordenador, publicacao: v })} />
          <Campo rotulo="Matrícula funcional" valor={c.ordenador.matricula} ro={ro} onChange={(v) => set("ordenador", { ...c.ordenador, matricula: v })} />
          <Campo rotulo="OM do Ordenador (sigla)" valor={c.ordenador.om_sigla} ro={ro} onChange={(v) => set("ordenador", { ...c.ordenador, om_sigla: v })} />
        </div>
        <Caixa rotulo="Ordenadora (cargo no feminino nos documentos)" marcado={c.ordenador.feminino} ro={ro} onChange={(v) => set("ordenador", { ...c.ordenador, feminino: v })} />
      </Secao>
      <Secao titulo="Agente de Controle Interno">
        <div className="grid sm:grid-cols-3 gap-3">
          <Campo rotulo="Nome" valor={c.aci.nome} ro={ro} onChange={(v) => set("aci", { ...c.aci, nome: v })} />
          <Campo rotulo="Posto/quadro" valor={c.aci.posto} ro={ro} onChange={(v) => set("aci", { ...c.aci, posto: v })} />
          <Campo rotulo="Função (vai na assinatura)" valor={c.aci.funcao} ro={ro} onChange={(v) => set("aci", { ...c.aci, funcao: v })} />
        </div>
      </Secao>
      <Secao titulo="Unidade de apoio">
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Nome" valor={c.ug_apoio.nome} ro={ro} onChange={(v) => set("ug_apoio", { ...c.ug_apoio, nome: v })} />
          <Campo rotulo="Sigla" valor={c.ug_apoio.sigla} ro={ro} onChange={(v) => set("ug_apoio", { ...c.ug_apoio, sigla: v })} />
          <Campo rotulo="Endereço" valor={c.ug_apoio.endereco} ro={ro} onChange={(v) => set("ug_apoio", { ...c.ug_apoio, endereco: v })} />
          <Campo rotulo="CNPJ" valor={c.ug_apoio.cnpj} ro={ro} onChange={(v) => set("ug_apoio", { ...c.ug_apoio, cnpj: v })} />
          <Campo rotulo="Cidade (data dos documentos)" valor={c.cidade} ro={ro} onChange={(v) => set("cidade", v)} />
          <Campo rotulo="Dias de alerta antes do aniversário (painel amarelo)" valor={String(c.dias_alerta)} ro={ro}
            onChange={(v) => set("dias_alerta", Math.max(1, Math.min(365, Number(v.replace(/\D/g, "")) || 60)))} />
        </div>
      </Secao>
      <Secao titulo='Texto fixo do "I – CONTRATANTE" por OM do Ordenador'>
        <p className="text-xs text-slate-500 mb-2">
          Regra da SCON: quando a OM do Ordenador que assina tem texto fixo, ele vai sempre no termo, mesmo que o contrato inicial
          traga outro Ordenador. Sem texto fixo, vai o parágrafo da 1ª página do contrato. Use <code>**negrito**</code>.
        </p>
        {Object.entries(c.textos_fixos_om).map(([om, txt]) => (
          <div key={om} className="mb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">{om}</span>
              {!ro && <button className="text-xs text-red-500 hover:text-red-700" onClick={() => { const t = { ...c.textos_fixos_om }; delete t[om]; set("textos_fixos_om", t); }}>Remover</button>}
            </div>
            <textarea className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-mono min-h-[90px]" value={txt} readOnly={ro}
              onChange={(e) => set("textos_fixos_om", { ...c.textos_fixos_om, [om]: e.target.value })} />
          </div>
        ))}
        {!ro && (
          <div className="flex gap-2">
            <input className="rounded-lg border border-slate-200 px-2 py-1 text-xs" placeholder="Sigla da OM (ex.: GAP-MN)" value={novaOm} onChange={(e) => setNovaOm(e.target.value.toUpperCase())} />
            <button className="rounded-lg border border-sky-200 text-sky-700 px-2 py-1 text-xs disabled:opacity-40" disabled={!novaOm.trim() || novaOm in c.textos_fixos_om}
              onClick={() => { set("textos_fixos_om", { ...c.textos_fixos_om, [novaOm.trim()]: "**I – CONTRATANTE:** " }); setNovaOm(""); }}>+ Texto fixo</button>
          </div>
        )}
      </Secao>
      {!ro && (
        <div className="flex items-center gap-3">
          <button onClick={salvar} disabled={salvando} className="rounded-lg bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
            {salvando ? "Salvando…" : "Salvar configuração"}
          </button>
          {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.txt}</span>}
        </div>
      )}
    </div>
  );
}
