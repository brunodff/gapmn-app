import { useEffect, useState } from "react";
import { Caixa, Campo, Secao } from "./campos";
import { pendenciasUnidade, siglaLimpa, unidadeVazia, type UnidadeApoiada } from "../../lib/apostilamento/unidades";
import { removerUnidade, salvarUnidade } from "../../lib/apostilamento/unidadesBanco";

// Reajustes › Configurações (revisão 4 da SCON, seção 6.2): um cadastro por unidade que o GAP-MN apoia, com os mesmos
// blocos de antes (Ordenador, ACI, unidade de apoio, texto fixo do "I – CONTRATANTE") e o que os aditivos usam (sigla e
// outras grafias, nome por extenso, UG, artigo, CEFA). Qualquer usuário edita; cada cadastro mostra quem mexeu por último.
// Substituição temporária (férias): basta editar e salvar; os documentos já gerados não mudam.

type Props = {
  unidades: UnidadeApoiada[]; tabela: boolean; nomeUsuario: string; aoMudar: () => void;
  /** sigla vinda de "Cadastrar esta unidade" (contrato ou aditivo de OM sem cadastro) */
  novaSigla?: string | null; aoUsarNovaSigla?: () => void;
};
const botao = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

export default function UnidadesApoiadas({ unidades, tabela, nomeUsuario, aoMudar, novaSigla, aoUsarNovaSigla }: Props) {
  const [edicao, setEdicao] = useState<{ u: UnidadeApoiada; siglaAntes: string | null } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<string | null>(null);

  useEffect(() => {
    if (!novaSigla) return;
    const ja = unidades.find((x) => siglaLimpa(x.sigla) === siglaLimpa(novaSigla));
    setEdicao(ja ? { u: ja, siglaAntes: ja.sigla } : { u: unidadeVazia(novaSigla), siglaAntes: null });
    aoUsarNovaSigla?.();
  }, [novaSigla, unidades, aoUsarNovaSigla]);

  async function salvar() {
    if (!edicao) return;
    const sigla = siglaLimpa(edicao.u.sigla);
    if (!sigla) { setMsg({ ok: false, txt: "Informe a sigla da unidade." }); return; }
    if (edicao.siglaAntes !== sigla && unidades.some((x) => siglaLimpa(x.sigla) === sigla && x.sigla !== edicao.siglaAntes)) { setMsg({ ok: false, txt: `Já existe o cadastro ${sigla}: edite-o.` }); return; }
    setOcupado(true); setMsg(null);
    try {
      await salvarUnidade(edicao.u, nomeUsuario, edicao.siglaAntes);
      setMsg({ ok: true, txt: `Unidade ${sigla} salva. Os próximos documentos dos contratos dela saem com estes dados.` });
      setEdicao(null);
      aoMudar();
    } catch (e) { setMsg({ ok: false, txt: e instanceof Error ? e.message : String(e) }); } finally { setOcupado(false); }
  }
  async function remover(u: UnidadeApoiada) {
    setOcupado(true); setMsg(null);
    try { await removerUnidade(u.sigla); setMsg({ ok: true, txt: `Cadastro ${u.sigla} removido.` }); aoMudar(); }
    catch (e) { setMsg({ ok: false, txt: e instanceof Error ? e.message : String(e) }); } finally { setOcupado(false); setConfirmar(null); }
  }

  return (
    <div className="max-w-4xl space-y-4">
      {!tabela && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">O banco ainda não tem a tabela das unidades apoiadas (migração 20261125c_aditivos_rev4): vale a configuração única antiga, só para leitura.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">Unidade:
          <select className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={edicao?.siglaAntes ?? ""} disabled={!tabela}
            onChange={(e) => { const u = unidades.find((x) => x.sigla === e.target.value); setEdicao(u ? { u, siglaAntes: u.sigla } : null); setMsg(null); }}>
            <option value="">— escolha para editar —</option>
            {unidades.map((u) => <option key={u.sigla} value={u.sigla}>{u.sigla}{u.padrao ? " (padrão)" : ""}{u.rascunho ? " (rascunho)" : ""}</option>)}
          </select>
        </label>
        <button className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50" disabled={!tabela || ocupado}
          onClick={() => { setEdicao({ u: unidadeVazia(""), siglaAntes: null }); setMsg(null); }}>+ Adicionar unidade apoiada</button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.txt}</span>}
      </div>

      {edicao
        ? <Formulario edicao={edicao} unidades={unidades} ocupado={ocupado} onChange={(u) => setEdicao((x) => (x ? { ...x, u } : x))} onSalvar={() => void salvar()} onCancelar={() => setEdicao(null)} />
        : (
          <Secao titulo="Unidades cadastradas">
            <p className="mb-2 text-[11px] text-slate-500">Ao abrir um contrato (Reajustes ou Termos Aditivos) o site lê a OM que assina — a "OM do Ordenador" — e usa o cadastro da unidade de mesma sigla ou de uma das outras grafias. OM sem cadastro gera alerta e os campos saem em branco, para nenhum documento sair com o Ordenador de outra unidade.</p>
            <ul className="divide-y divide-slate-100 text-xs">
              {unidades.map((u) => {
                const pend = pendenciasUnidade(u);
                return (
                  <li key={u.sigla} className="flex flex-wrap items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <b className="text-slate-800">{u.sigla}</b>{u.grafias.length ? <span className="text-slate-500"> ({u.grafias.join(", ")})</span> : null} <span className="text-slate-600">— {u.nome || "sem nome por extenso"}{u.ug ? ` · UG ${u.ug}` : ""}{u.cefa ? " · CEFA" : ""}</span>
                      {u.padrao && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-600">padrão</span>}
                      {u.rascunho && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">rascunho</span>}
                      <div className="text-slate-500">Ordenador: {u.ordenador.nome ? [u.ordenador.posto, u.ordenador.nome].filter(Boolean).join(" ") : "—"} · ACI: {u.aci.nome ? [u.aci.posto, u.aci.nome].filter(Boolean).join(" ") : "—"}{u.atualizado_em ? ` · atualizado em ${new Date(u.atualizado_em).toLocaleDateString("pt-BR")}${u.atualizado_nome ? ` por ${u.atualizado_nome}` : ""}` : ""}</div>
                      {pend.length > 0 && <div className="text-amber-700">Falta: {pend.join(", ")}.</div>}
                    </div>
                    <button className={botao} disabled={!tabela} onClick={() => setEdicao({ u, siglaAntes: u.sigla })}>Editar</button>
                    {!u.padrao && tabela && <button className="text-[11px] text-red-600 underline disabled:opacity-50" disabled={ocupado} onBlur={() => setConfirmar(null)}
                      onClick={() => (confirmar === u.sigla ? void remover(u) : setConfirmar(u.sigla))}>{confirmar === u.sigla ? "clique de novo para remover" : "Remover"}</button>}
                  </li>
                );
              })}
            </ul>
          </Secao>
        )}
    </div>
  );
}

function Formulario({ edicao, unidades, ocupado, onChange, onSalvar, onCancelar }: {
  edicao: { u: UnidadeApoiada; siglaAntes: string | null }; unidades: UnidadeApoiada[]; ocupado: boolean;
  onChange: (u: UnidadeApoiada) => void; onSalvar: () => void; onCancelar: () => void;
}) {
  const { u, siglaAntes } = edicao;
  const set = <K extends keyof UnidadeApoiada>(k: K, v: UnidadeApoiada[K]) => onChange({ ...u, [k]: v });
  const nova = siglaAntes == null;
  return (
    <div className="space-y-4">
      <Secao titulo={nova ? "Nova unidade apoiada" : `Unidade ${siglaAntes}${u.padrao ? " (padrão)" : ""}`}
        direita={nova && unidades.length > 0 ? (
          <select className="rounded-lg border border-slate-200 px-2 py-1 text-xs" value="" onChange={(e) => { const de = unidades.find((x) => x.sigla === e.target.value); if (de) onChange({ ...unidadeVazia(u.sigla, de), sigla: u.sigla, nome: u.nome, ug: u.ug, grafias: u.grafias }); }}>
            <option value="">Copiar dados de outra unidade…</option>
            {unidades.map((x) => <option key={x.sigla} value={x.sigla}>{x.sigla}</option>)}
          </select>
        ) : undefined}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="Sigla" valor={u.sigla} ro={u.padrao} onChange={(v) => set("sigla", v.toUpperCase())} dica={u.padrao ? "a sigla da unidade padrão não muda" : "como aparece no campo OM do Ordenador (ex.: CINDACTA IV)"} />
          <div className="sm:col-span-2"><Campo rotulo="Outras siglas/grafias (separe por vírgula)" valor={u.grafias.join(", ")} onChange={(v) => set("grafias", v.split(",").map((x) => x.trim().toUpperCase()).filter((x, i, l) => x || i === l.length - 1))} placeholder="DACTA IV, CINDACTAIV" /></div>
          <div className="sm:col-span-2"><Campo rotulo="Nome por extenso (cabeçalho dos documentos)" valor={u.nome ?? ""} onChange={(v) => set("nome", v)} placeholder="Quarto Centro Integrado de Defesa Aérea e Controle de Tráfego Aéreo" /></div>
          <Campo rotulo="Código da UG" valor={u.ug ?? ""} onChange={(v) => set("ug", v.replace(/\D/g, ""))} dica="Declaração orçamentária e item 2 da Ficha" />
          <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-slate-600">Artigo</span>
            <select className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={u.artigo} onChange={(e) => set("artigo", e.target.value as "do" | "da")}><option value="do">do ({`do ${u.sigla || "GAP-MN"}`})</option><option value="da">da ({`da ${u.sigla || "BAMN"}`})</option></select></label>
          <div className="sm:col-span-2">
            <Caixa rotulo="Pertence ao CEFA (autoridade do campo 19 da Ficha = Diretor de Administração da Aeronáutica)" marcado={u.cefa} onChange={(v) => set("cefa", v)} />
            {!u.cefa && <Campo rotulo="Autoridade superior (campo 19 da Ficha, OM fora do CEFA)" valor={u.autoridade_superior ?? ""} onChange={(v) => set("autoridade_superior", v)} placeholder="Comandante do …" />}
          </div>
        </div>
      </Secao>
      <Secao titulo="Ordenador de Despesas (qualificação no termo e assinatura)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome" valor={u.ordenador.nome} onChange={(v) => set("ordenador", { ...u.ordenador, nome: v })} />
          <Campo rotulo="Posto/quadro (ex.: Cel Int)" valor={u.ordenador.posto} onChange={(v) => set("ordenador", { ...u.ordenador, posto: v })} />
          <Campo rotulo="Portaria de nomeação" valor={u.ordenador.portaria} onChange={(v) => set("ordenador", { ...u.ordenador, portaria: v })} />
          <Campo rotulo="Publicação (BCA)" valor={u.ordenador.publicacao} onChange={(v) => set("ordenador", { ...u.ordenador, publicacao: v })} />
          <Campo rotulo="Matrícula funcional" valor={u.ordenador.matricula} onChange={(v) => set("ordenador", { ...u.ordenador, matricula: v })} />
        </div>
        <Caixa rotulo="Ordenadora (cargo no feminino nos documentos)" marcado={u.ordenador.feminino} onChange={(v) => set("ordenador", { ...u.ordenador, feminino: v })} />
      </Secao>
      <Secao titulo="Agente de Controle Interno">
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="Nome" valor={u.aci.nome} onChange={(v) => set("aci", { ...u.aci, nome: v })} />
          <Campo rotulo="Posto/quadro" valor={u.aci.posto} onChange={(v) => set("aci", { ...u.aci, posto: v })} />
          <Campo rotulo="Função (vai na assinatura)" valor={u.aci.funcao} onChange={(v) => set("aci", { ...u.aci, funcao: v })} placeholder={`Agente de Controle Interno ${u.artigo} ${u.sigla}`} />
        </div>
      </Secao>
      <Secao titulo="Unidade de apoio (I – CONTRATANTE e cabeçalho do termo)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome" valor={u.ug_apoio.nome} onChange={(v) => set("ug_apoio", { ...u.ug_apoio, nome: v })} placeholder={(u.nome ?? "").toUpperCase()} />
          <Campo rotulo="Sigla" valor={u.ug_apoio.sigla} onChange={(v) => set("ug_apoio", { ...u.ug_apoio, sigla: v })} placeholder={u.sigla} />
          <Campo rotulo="Endereço" valor={u.ug_apoio.endereco} onChange={(v) => set("ug_apoio", { ...u.ug_apoio, endereco: v })} />
          <Campo rotulo="CNPJ" valor={u.ug_apoio.cnpj} onChange={(v) => set("ug_apoio", { ...u.ug_apoio, cnpj: v })} />
          <Campo rotulo="Cidade (data dos documentos)" valor={u.cidade} onChange={(v) => set("cidade", v)} />
          {u.padrao && <Campo rotulo="Dias de alerta antes do aniversário (painel amarelo)" valor={String(u.dias_alerta ?? 60)}
            onChange={(v) => set("dias_alerta", Math.max(1, Math.min(365, Number(v.replace(/\D/g, "")) || 60)))} />}
        </div>
      </Secao>
      <Secao titulo='Texto fixo do "I – CONTRATANTE"'>
        <p className="mb-2 text-xs text-slate-500">Regra da SCON: com texto fixo, ele vai sempre no termo, mesmo que o contrato inicial traga outro Ordenador. Sem texto fixo, vai o parágrafo da 1ª página do contrato. Use <code>**negrito**</code>.</p>
        <textarea className="min-h-[90px] w-full rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-xs" value={u.texto_fixo ?? ""} placeholder="**I – CONTRATANTE:** …" onChange={(e) => set("texto_fixo", e.target.value)} />
      </Secao>
      <div className="flex items-center gap-3">
        <button onClick={onSalvar} disabled={ocupado} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">{ocupado ? "Salvando…" : "Salvar unidade apoiada"}</button>
        <button onClick={onCancelar} disabled={ocupado} className="text-xs text-slate-500">Cancelar</button>
      </div>
    </div>
  );
}
