import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { CATEGORIAS, MODALIDADES, type ConfigPca, type Elo, type MembroEquipe, type RegraMjr } from "../../lib/pca/tipos";
import { pareceresAgu, type AguRef, type DadosPca } from "../../lib/pca/cliente";
import { Campo, botao, botaoPrimario, entrada } from "./ui";
import { dataBR } from "./formato";

const FUNCOES = ["AUX SLIC", "AUX SLIC (Atas)", "Pregoeiro", "Agente de Contratação", "Chefe da SLIC"];
const lista = (s: string) => s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
type Msg = { ok: boolean; txt: string } | null;

function useSalvar(onMudou: () => void) {
  const [msg, setMsg] = useState<Msg>(null);
  const [ocupado, setOcupado] = useState(false);
  async function salvar(f: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setOcupado(true); setMsg(null);
    const { error } = await f();
    setOcupado(false);
    if (error) setMsg({ ok: false, txt: /row-level security|permission/i.test(error.message) ? "Só a SLIC, ADMIN e DEV alteram os cadastros." : error.message });
    else { setMsg({ ok: true, txt: ok }); onMudou(); }
  }
  return { msg, ocupado, salvar };
}
const Aviso = ({ msg }: { msg: Msg }) => (msg ? <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.txt}</div> : null);

function Elos({ dados, onMudou, pode }: { dados: DadosPca; onMudou: () => void; pode: boolean }) {
  const [linhas, setLinhas] = useState<Elo[]>(dados.elos);
  const { msg, ocupado, salvar } = useSalvar(onMudou);
  // códigos de área dos DFD no PGC e quantas contratações cada um tem (para ligar cada área a um Elo)
  const areas = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of dados.lista) if (c.area_pgc) m.set(c.area_pgc, (m.get(c.area_pgc) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [dados.lista]);
  const semElo = useMemo(() => [...new Set(dados.lista.map((c) => c.om_apoiada).filter((o): o is string => !!o && !dados.elos.some((e) => e.om === o)))], [dados.lista, dados.elos]);
  const set = (i: number, k: keyof Elo, v: unknown) => setLinhas((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Cada OM apoiada ou setor do GAP-MN com o e-mail do Elo: recebe o aviso D-30 e as mudanças de status. As <b>áreas do PGC</b> ligam o DFD ao Elo sozinhas (contratação nova já nasce com a OM).</p>
      <p className="text-[11px] text-slate-500">Áreas no PCA: {areas.map(([a, n]) => <span key={a} className={`mr-2 ${dados.elos.some((e) => e.areas_pgc.includes(a)) ? "" : "font-bold text-amber-700"}`}>{a} ({n})</span>)}{semElo.length > 0 && <> · OMs sem Elo: <b className="text-amber-700">{semElo.join(", ")}</b></>}</p>
      <Aviso msg={msg} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="text-slate-500"><tr><th className="p-1">OM/setor</th><th className="p-1">Nome</th><th className="p-1">Elo</th><th className="p-1">E-mail do Elo</th><th className="p-1">Áreas do PGC</th><th className="p-1">Interno</th><th className="p-1">Ativo</th><th /></tr></thead>
          <tbody>
            {linhas.map((e, i) => (
              <tr key={e.id ?? `n${i}`} className="border-t border-slate-100">
                <td className="p-1"><input className={`${entrada} w-20`} disabled={!pode} value={e.om} onChange={(x) => set(i, "om", x.target.value)} /></td>
                <td className="p-1"><input className={entrada} disabled={!pode} value={e.nome_om ?? ""} onChange={(x) => set(i, "nome_om", x.target.value)} /></td>
                <td className="p-1"><input className={entrada} disabled={!pode} value={e.elo_nome ?? ""} onChange={(x) => set(i, "elo_nome", x.target.value)} /></td>
                <td className="p-1"><input className={entrada} disabled={!pode} type="email" value={e.elo_email ?? ""} onChange={(x) => set(i, "elo_email", x.target.value)} /></td>
                <td className="p-1"><input className={`${entrada} w-28`} disabled={!pode} value={e.areas_pgc.join(", ")} onChange={(x) => set(i, "areas_pgc", lista(x.target.value))} /></td>
                <td className="p-1 text-center"><input type="checkbox" disabled={!pode} checked={e.interno} onChange={(x) => set(i, "interno", x.target.checked)} /></td>
                <td className="p-1 text-center"><input type="checkbox" disabled={!pode} checked={e.ativo} onChange={(x) => set(i, "ativo", x.target.checked)} /></td>
                <td className="p-1">{pode && <button className={botao} disabled={ocupado || !e.om.trim()} onClick={() => void salvar(() => {
                  const { id, ...resto } = e;
                  return id ? supabase.from("pca_elos").update(resto).eq("id", id) : supabase.from("pca_elos").insert(resto);
                }, `Elo ${e.om} salvo.`)}>Salvar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pode && <button className={botao} onClick={() => setLinhas((l) => [...l, { id: 0, om: "", nome_om: null, elo_nome: null, elo_email: null, areas_pgc: [], interno: false, ativo: true }])}>+ Elo</button>}
    </div>
  );
}

function Equipe({ dados, onMudou, pode }: { dados: DadosPca; onMudou: () => void; pode: boolean }) {
  const [linhas, setLinhas] = useState<MembroEquipe[]>(dados.equipe);
  const { msg, ocupado, salvar } = useSalvar(onMudou);
  const set = (i: number, k: keyof MembroEquipe, v: unknown) => setLinhas((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">AUX SLIC (minutas), pregoeiros e agentes de contratação: aparecem nas listas de designação; o pregoeiro recebe o aviso de impugnação e esclarecimento no e-mail daqui.</p>
      <Aviso msg={msg} />
      <table className="w-full text-left text-[11px]">
        <thead className="text-slate-500"><tr><th className="p-1">Nome (posto e nome de guerra)</th><th className="p-1">E-mail</th><th className="p-1">Função</th><th className="p-1">Ativo</th><th /></tr></thead>
        <tbody>
          {linhas.map((p, i) => (
            <tr key={p.id ?? `n${i}`} className="border-t border-slate-100">
              <td className="p-1"><input className={entrada} disabled={!pode} value={p.nome} onChange={(x) => set(i, "nome", x.target.value)} /></td>
              <td className="p-1"><input className={entrada} disabled={!pode} type="email" value={p.email ?? ""} onChange={(x) => set(i, "email", x.target.value)} /></td>
              <td className="p-1"><select className={entrada} disabled={!pode} value={p.funcao} onChange={(x) => set(i, "funcao", x.target.value)}>{FUNCOES.map((f) => <option key={f}>{f}</option>)}</select></td>
              <td className="p-1 text-center"><input type="checkbox" disabled={!pode} checked={p.ativo} onChange={(x) => set(i, "ativo", x.target.checked)} /></td>
              <td className="p-1">{pode && <button className={botao} disabled={ocupado || !p.nome.trim()} onClick={() => void salvar(() => {
                const { id, ...resto } = p;
                return id ? supabase.from("pca_equipe").update(resto).eq("id", id) : supabase.from("pca_equipe").insert(resto);
              }, `${p.nome} salvo.`)}>Salvar</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pode && <button className={botao} onClick={() => setLinhas((l) => [...l, { id: 0, nome: "", email: null, funcao: "AUX SLIC", ativo: true }])}>+ Integrante</button>}
    </div>
  );
}

function Mjr({ dados, onMudou, pode }: { dados: DadosPca; onMudou: () => void; pode: boolean }) {
  const [linhas, setLinhas] = useState<RegraMjr[]>(dados.regras);
  const [agu, setAgu] = useState<AguRef[]>([]);
  useEffect(() => { void pareceresAgu().then(setAgu); }, []);
  const { msg, ocupado, salvar } = useSalvar(onMudou);
  const set = (i: number, k: keyof RegraMjr, v: unknown) => setLinhas((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const alterna = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const nomeAgu = (a: AguRef) => `${a.grupo ?? ""} ${a.numero ? `nº ${a.numero}/` : ""}${a.ano ?? ""} — ${(a.assunto ?? "").slice(0, 90)}`;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Regras de enquadramento em <b>Manifestação Jurídica Referencial</b>: cada uma ligada a um parecer referencial vigente da AGU (lista da tela AGU, atualizada todo dia). A triagem usa a primeira regra que atender à categoria, à modalidade, ao valor, ao SRP e às palavras do objeto; sem regra, o processo vai à CJU (art. 53 da Lei nº 14.133/2021).</p>
      <Aviso msg={msg} />
      {linhas.map((r, i) => {
        const a = agu.find((x) => x.id === r.agu_id);
        return (
          <div key={r.id ?? `n${i}`} className="space-y-2 rounded-lg border border-slate-200 p-2">
            <div className="grid gap-2 sm:grid-cols-4">
              <Campo rotulo="Título da regra" largo><input className={entrada} disabled={!pode} value={r.titulo} onChange={(x) => set(i, "titulo", x.target.value)} /></Campo>
              <Campo rotulo="Parecer referencial da AGU" largo>
                <select className={entrada} disabled={!pode} value={r.agu_id ?? ""} onChange={(x) => { const id = x.target.value ? Number(x.target.value) : null; const p = agu.find((y) => y.id === id); set(i, "agu_id", id); if (p?.validade) set(i, "vigencia_fim", p.validade); }}>
                  <option value="">—</option>{agu.map((p) => <option key={p.id} value={p.id}>{nomeAgu(p)}</option>)}
                </select>
                {a?.url && <a href={a.url} target="_blank" rel="noreferrer" className="text-[10.5px] text-sky-700 underline">abrir o parecer ↗</a>}
              </Campo>
              <Campo rotulo="Valor máximo (R$, vazio = sem limite)"><input type="number" className={entrada} disabled={!pode} value={r.valor_maximo ?? ""} onChange={(x) => set(i, "valor_maximo", x.target.value === "" ? null : Number(x.target.value))} /></Campo>
              <Campo rotulo="SRP"><select className={entrada} disabled={!pode} value={r.srp == null ? "" : r.srp ? "s" : "n"} onChange={(x) => set(i, "srp", x.target.value === "" ? null : x.target.value === "s")}><option value="">tanto faz</option><option value="s">só com SRP</option><option value="n">só sem SRP</option></select></Campo>
              <Campo rotulo="Vigência até"><input type="date" className={entrada} disabled={!pode} value={r.vigencia_fim ?? ""} onChange={(x) => set(i, "vigencia_fim", x.target.value || null)} /></Campo>
              <Campo rotulo="Palavras do objeto (vírgula; vazio = qualquer)"><input className={entrada} disabled={!pode} value={r.palavras.join(", ")} onChange={(x) => set(i, "palavras", lista(x.target.value))} /></Campo>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-600">
              <span className="font-semibold">Categorias:</span>{CATEGORIAS.map((c) => <label key={c} className="flex items-center gap-1"><input type="checkbox" disabled={!pode} checked={r.categorias.includes(c)} onChange={() => set(i, "categorias", alterna(r.categorias, c))} />{c}</label>)}
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-600">
              <span className="font-semibold">Modalidades:</span>{MODALIDADES.map((m) => <label key={m} className="flex items-center gap-1"><input type="checkbox" disabled={!pode} checked={r.modalidades.includes(m)} onChange={() => set(i, "modalidades", alterna(r.modalidades, m))} />{m}</label>)}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" disabled={!pode} checked={r.ativo} onChange={(x) => set(i, "ativo", x.target.checked)} /> ativa</label>
              {r.vigencia_fim && <span className={`text-[10.5px] ${r.vigencia_fim < new Date().toISOString().slice(0, 10) ? "font-bold text-red-600" : "text-slate-400"}`}>vigência até {dataBR(r.vigencia_fim)}</span>}
              {pode && <button className={`${botao} ml-auto`} disabled={ocupado || !r.titulo.trim()} onClick={() => void salvar(() => {
                const { id, ...resto } = r;
                return id ? supabase.from("pca_mjr").update(resto).eq("id", id) : supabase.from("pca_mjr").insert(resto);
              }, "Regra salva.")}>Salvar regra</button>}
            </div>
          </div>
        );
      })}
      {pode && <button className={botao} onClick={() => setLinhas((l) => [...l, { id: 0, titulo: "", agu_id: null, categorias: [], modalidades: [], valor_maximo: null, palavras: [], srp: null, vigencia_fim: null, ativo: true }])}>+ Regra de MJR</button>}
    </div>
  );
}

function Configuracao({ dados, onMudou, pode }: { dados: DadosPca; onMudou: () => void; pode: boolean }) {
  const [cfg, setCfg] = useState<ConfigPca>(dados.cfg);
  const { msg, ocupado, salvar } = useSalvar(onMudou);
  const set = <K extends keyof ConfigPca>(k: K, v: ConfigPca[K]) => setCfg((c) => ({ ...c, [k]: v }));
  return (
    <div className="space-y-3">
      <Aviso msg={msg} />
      <label className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${cfg.envio_automatico ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <input type="checkbox" disabled={!pode} checked={cfg.envio_automatico} onChange={(e) => set("envio_automatico", e.target.checked)} />
        <span><b>Envio automático de e-mails</b> (D-30, mudanças de status ao Elo, homologação à Atas/SCON, prazo da CJU, impugnação). Desligado, os e-mails ficam na aba E-mails até alguém enviar. Ao ligar, só saem os criados nos últimos 3 dias.</span>
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        <Campo rotulo="Ano do PCA acompanhado"><input type="number" className={entrada} disabled={!pode} value={cfg.ano} onChange={(e) => set("ano", Number(e.target.value))} /></Campo>
        <Campo rotulo="E-mail da SLIC (prazo da CJU, impugnações, respostas)"><input className={entrada} disabled={!pode} value={cfg.email_slic ?? ""} onChange={(e) => set("email_slic", e.target.value || null)} /></Campo>
        <Campo rotulo="E-mail do AUX SLIC de Atas (homologado com SRP)"><input className={entrada} disabled={!pode} value={cfg.email_atas} onChange={(e) => set("email_atas", e.target.value)} /></Campo>
        <Campo rotulo="E-mail da SCON (homologado sem SRP)"><input className={entrada} disabled={!pode} value={cfg.email_scon} onChange={(e) => set("email_scon", e.target.value)} /></Campo>
        <Campo rotulo="Prazo de referência da CJU (dias corridos)"><input type="number" className={entrada} disabled={!pode} value={cfg.sla_cju_dias} onChange={(e) => set("sla_cju_dias", Number(e.target.value))} /></Campo>
        <Campo rotulo="Aviso antes da chegada (dias)"><input type="number" className={entrada} disabled={!pode} value={cfg.dias_alerta_chegada} onChange={(e) => set("dias_alerta_chegada", Number(e.target.value))} /></Campo>
        <Campo rotulo="Limite de dispensa — art. 75, I (engenharia)"><input type="number" step="0.01" className={entrada} disabled={!pode} value={cfg.limite_dispensa_engenharia} onChange={(e) => set("limite_dispensa_engenharia", Number(e.target.value))} /></Campo>
        <Campo rotulo="Limite de dispensa — art. 75, II (demais)"><input type="number" step="0.01" className={entrada} disabled={!pode} value={cfg.limite_dispensa_demais} onChange={(e) => set("limite_dispensa_demais", Number(e.target.value))} /></Campo>
        <Campo rotulo="Link das listas de verificação (e-mail D-30)"><input className={entrada} disabled={!pode} value={cfg.link_listas} onChange={(e) => set("link_listas", e.target.value)} /></Campo>
      </div>
      <p className="text-[11px] text-slate-500">Limites do art. 75 de 2026 (Decreto nº 12.807/2025). Atualizar quando sair o decreto com os valores de {cfg.ano}.</p>
      {pode && <button className={botaoPrimario} disabled={ocupado} onClick={() => void salvar(() => supabase.from("pca_config").update({ ...cfg, atualizado_em: new Date().toISOString() }).eq("id", 1), "Configuração salva.")}>Salvar configuração</button>}
    </div>
  );
}

function Integracoes() {
  const [eventos, setEventos] = useState<{ recebido_em: string; origem: string; tipo: string; assunto: string | null; pag: string | null; contratacao_id: string | null }[] | null>(null);
  useEffect(() => { void supabase.from("pca_eventos").select("recebido_em, origem, tipo, assunto, pag, contratacao_id").order("recebido_em", { ascending: false }).limit(20).then(({ data }) => setEventos(data ?? [])); }, []);
  return (
    <div className="space-y-3 text-xs text-slate-600">
      <div className="space-y-1 rounded-lg border border-slate-200 p-3">
        <b className="text-slate-800">Caixa licita.guarnaemn@gmail.com (CJU, impugnações e esclarecimentos)</b>
        <p>Um Apps Script na própria conta confere a caixa a cada 10 minutos e avisa o app: "SOLICITAÇÃO DE ANÁLISE JURÍDICA - PAG:…" em Enviados (vai para a CJU e começa a contar os 15 dias), "DEVOLUÇÃO DA ANÁLISE DO PROCESSO Nº …" na Entrada (retorno da CJU) e IMPUGNAÇÃO/ESCLARECIMENTO no assunto (alerta ao pregoeiro e à SLIC). Não guarda a senha da conta.</p>
        <p>Instalação: abrir <a className="text-sky-700 underline" href="https://script.google.com" target="_blank" rel="noreferrer">script.google.com</a> logado na conta da SLIC, colar o <a className="text-sky-700 underline" href="/pca/monitor-gmail.gs" target="_blank" rel="noreferrer">script do monitor</a>, criar a propriedade PCA_CHAVE (valor com o DEV) e executar "instalar".</p>
      </div>
      <div className="space-y-1 rounded-lg border border-slate-200 p-3">
        <b className="text-slate-800">SILOMS</b>
        <p>Sem API pública: a DNR entra pelos PDFs (TR + Ofício de Abertura), pela planilha exportada ou pelo robô interno, que manda para a mesma função os marcos dos subprocessos (5 fluxos), a fase externa e a homologação. O formato está no LEIA-ME do repositório (docs/pca).</p>
      </div>
      <div>
        <b className="text-slate-800">Últimos avisos recebidos</b>
        {!eventos ? <p>Carregando…</p> : !eventos.length ? <p>Nenhum ainda.</p> : (
          <ul className="mt-1 space-y-0.5 text-[11px]">{eventos.map((e, i) => <li key={i}>{new Date(e.recebido_em).toLocaleString("pt-BR")} · {e.origem} · {e.tipo} · {e.assunto ?? e.pag ?? ""} {e.contratacao_id ? "✔" : "(sem processo)"}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

export default function AdminPca({ dados, onMudou, pode }: { dados: DadosPca; onMudou: () => void; pode: boolean }) {
  const [aba, setAba] = useState<"elos" | "equipe" | "mjr" | "config" | "integracoes">("elos");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 text-xs">
        {([["elos", "Elos das OMs"], ["equipe", "Equipe SLIC e pregoeiros"], ["mjr", "Pareceres referenciais (MJR)"], ["config", "Configuração"], ["integracoes", "Integrações"]] as const).map(([k, n]) => (
          <button key={k} onClick={() => setAba(k)} className={`-mb-px border-b-2 px-3 py-1.5 font-semibold ${aba === k ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500"}`}>{n}</button>
        ))}
      </div>
      {!pode && <p className="text-[11px] text-slate-500">Somente leitura: a SLIC, ADMIN e DEV alteram os cadastros.</p>}
      {aba === "elos" && <Elos key={JSON.stringify(dados.elos)} dados={dados} onMudou={onMudou} pode={pode} />}
      {aba === "equipe" && <Equipe key={JSON.stringify(dados.equipe)} dados={dados} onMudou={onMudou} pode={pode} />}
      {aba === "mjr" && <Mjr key={JSON.stringify(dados.regras)} dados={dados} onMudou={onMudou} pode={pode} />}
      {aba === "config" && <Configuracao key={JSON.stringify(dados.cfg)} dados={dados} onMudou={onMudou} pode={pode} />}
      {aba === "integracoes" && <Integracoes />}
    </div>
  );
}
