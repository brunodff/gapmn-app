// Painel do levantamento dos projetos e atividades do PTA (só ADMIN e DEV, aba do Painel de Execução):
// abre e encerra o formulário público (/pta-levantamento), mostra o que cada setor cadastrou, o que falta,
// a distribuição das entregas por trimestre e baixa as planilhas da APLG para montar a minuta.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  entregasPorTrimestre, moeda, nomeSetor, pendencias, SETORES, trimestreDe, type Cadastro,
} from "../lib/ptaLevantamento/cadastro.ts";
import { abasDoLevantamento, resumo } from "../lib/ptaLevantamento/exportar.ts";
import {
  abrirLevantamento, carregarPainel, fecharLevantamento, trocarLink, type LevantamentoAdmin,
} from "../lib/ptaLevantamento/api.ts";

const C = {
  bg: "#0d1117", card: "#161b27", borda: "#1e2a3a", texto: "#e2e8f0", fraco: "#7c8ba1", grade: "#1e2a3a",
  ciano: "#22d3ee", verde: "#4ade80", ambar: "#fbbf24", roxo: "#a78bfa", vermelho: "#f87171",
};
const cartao: React.CSSProperties = { background: C.card, border: `1px solid ${C.borda}`, borderRadius: 14, padding: "12px 14px" };
const botao: React.CSSProperties = { background: "#1e2a3a", border: `1px solid ${C.borda}`, borderRadius: 8, padding: "6px 12px", fontSize: 12, color: C.texto, cursor: "pointer" };
const entrada: React.CSSProperties = { background: "#0f1622", border: `1px solid ${C.borda}`, borderRadius: 8, padding: "6px 9px", fontSize: 12, color: C.texto, minWidth: 0 };
const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Manaus", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const dataBR = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

type Filtro = { setor: string; tipo: "" | "projeto" | "atividade"; busca: string; soPendentes: boolean; excluidos: boolean };

export default function PtaLevantamento({ ano }: { ano: number }) {
  const [lev, setLev] = useState<LevantamentoAdmin | null>(null);
  const [itens, setItens] = useState<Cadastro[]>([]);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [prazo, setPrazo] = useState(`${ano - 1}-11-06`);
  const [f, setF] = useState<Filtro>({ setor: "", tipo: "", busca: "", soPendentes: false, excluidos: false });
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [confirmaTroca, setConfirmaTroca] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await carregarPainel(ano);
      setLev(r.levantamento);
      setItens(r.itens);
      setGeradoEm(r.geradoEm);
      if (r.levantamento?.prazo) setPrazo(r.levantamento.prazo);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [ano]);
  useEffect(() => { void carregar(); }, [carregar]);
  // relê ao voltar para a aba do navegador
  useEffect(() => {
    const ao = () => { if (document.visibilityState === "visible") void carregar(); };
    document.addEventListener("visibilitychange", ao);
    return () => document.removeEventListener("visibilitychange", ao);
  }, [carregar]);

  const acao = async (fn: () => Promise<LevantamentoAdmin>, ok: string) => {
    setOcupado(true);
    setAviso(null);
    try { setLev(await fn()); setAviso(ok); } catch (e) { setAviso(e instanceof Error ? e.message : String(e)); } finally { setOcupado(false); setConfirmaTroca(false); }
  };

  const link = lev?.token ? `${window.location.origin}/pta-levantamento?c=${encodeURIComponent(lev.token)}` : "";
  const r = useMemo(() => resumo(itens), [itens]);
  const setoresComEnvio = SETORES.filter((s) => r.porSetor.has(s.sigla)).length;

  const visiveis = useMemo(() => {
    const q = f.busca.trim().toLowerCase();
    return itens.filter((c) => (f.excluidos ? true : !c.excluidoEm)
      && (!f.setor || c.setor === f.setor) && (!f.tipo || c.tipo === f.tipo)
      && (!f.soPendentes || pendencias(c).length > 0)
      && (!q || `${c.nome} ${c.nomeGuerra} ${c.secao} ${JSON.stringify(c.dados)} ${JSON.stringify(c.etapas)}`.toLowerCase().includes(q)));
  }, [itens, f]);

  const baixarExcel = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    for (const [nome, linhas] of Object.entries(abasDoLevantamento(itens))) {
      const ws = XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ "(vazio)": "" }]);
      XLSX.utils.book_append_sheet(wb, ws, nome.slice(0, 31));
    }
    XLSX.writeFile(wb, `PTA ${ano} - levantamento dos setores ${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const baixarJson = () => {
    const blob = new Blob([JSON.stringify({ ano, gerado_em: geradoEm, itens: itens.filter((c) => !c.excluidoEm) }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pta-${ano}-levantamento.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  if (carregando) return <div style={{ ...cartao, color: C.fraco, fontSize: 13 }}>Carregando o levantamento…</div>;
  if (erro) return (
    <div style={{ ...cartao, color: C.vermelho, fontSize: 13 }} role="alert">
      {erro} <button type="button" style={{ ...botao, marginLeft: 8 }} onClick={() => { setCarregando(true); void carregar(); }}>Tentar de novo</button>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 12, color: C.texto }}>
      {/* ── formulário: abrir, encerrar, link ── */}
      <div style={{ ...cartao, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Levantamento dos setores — PTA {ano}</div>
            <div style={{ fontSize: 12, color: C.fraco, marginTop: 2 }}>
              Formulário aberto por link, sem login. Cada pessoa cadastra os seus projetos e atividades e pode editar ou excluir o que cadastrou.
            </div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 10px", color: lev?.aberta ? C.verde : C.ambar, border: `1px solid ${lev?.aberta ? C.verde : C.ambar}55` }}>
            {!lev ? "Ainda não aberto" : lev.aberta ? `Aberto · prazo ${dataBR(lev.prazo)}` : `Encerrado em ${dataHora(lev.fechada_em)}`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 12, color: C.fraco, display: "flex", gap: 6, alignItems: "center" }}>Prazo
            <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} style={entrada} />
          </label>
          <button type="button" disabled={ocupado} style={{ ...botao, borderColor: C.ciano, color: C.ciano }}
            onClick={() => acao(() => abrirLevantamento(ano, prazo), lev?.aberta ? "Prazo atualizado." : "Levantamento aberto. Copie o link e envie aos chefes.")}>
            {lev?.aberta ? "Atualizar prazo" : lev ? "Reabrir" : "Abrir levantamento"}
          </button>
          {lev?.aberta && <button type="button" disabled={ocupado} style={{ ...botao, color: C.ambar }} onClick={() => acao(() => fecharLevantamento(ano), "Levantamento encerrado: o formulário só mostra o que cada um enviou.")}>Encerrar</button>}
          {lev && (confirmaTroca ? (
            <span style={{ fontSize: 12, color: C.ambar, display: "inline-flex", gap: 6, alignItems: "center" }}>
              O link atual para de funcionar (os cadastros continuam).
              <button type="button" disabled={ocupado} style={{ ...botao, color: C.vermelho }} onClick={() => acao(() => trocarLink(ano), "Link trocado. Envie o novo aos chefes.")}>Trocar</button>
              <button type="button" style={botao} onClick={() => setConfirmaTroca(false)}>Cancelar</button>
            </span>
          ) : <button type="button" style={botao} onClick={() => setConfirmaTroca(true)}>Trocar link</button>)}
          <button type="button" style={botao} onClick={() => { void carregar(); }}>Atualizar</button>
        </div>
        {link && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input readOnly value={link} aria-label="Link do formulário" onFocus={(e) => e.currentTarget.select()} style={{ ...entrada, flex: "1 1 320px" }} />
            <button type="button" style={botao} onClick={() => { void navigator.clipboard?.writeText(link).then(() => setAviso("Link copiado.")); }}>Copiar link</button>
            <a href={link} target="_blank" rel="noreferrer" style={{ ...botao, textDecoration: "none" }}>Abrir formulário</a>
          </div>
        )}
        {aviso && <div role="status" style={{ fontSize: 12, color: C.ciano }}>{aviso}</div>}
      </div>

      {/* ── números ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {([
          ["Projetos", r.projetos, C.ciano], ["Atividades", r.atividades, C.verde],
          ["Setores com envio", `${setoresComEnvio} de ${SETORES.length}`, C.roxo],
          ["Com pendência", r.pendentes, r.pendentes ? C.ambar : C.verde], ["Valor estimado", moeda(r.valor), C.texto],
        ] as const).map(([rot, v, cor]) => (
          <div key={rot} style={cartao}>
            <div style={{ fontSize: 11, color: C.fraco, textTransform: "uppercase", letterSpacing: "0.04em" }}>{rot}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: cor, marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
        <div style={cartao}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Por divisão ou assessoria</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ color: C.fraco, textAlign: "left" }}><th style={{ padding: "4px 6px" }}>Setor</th><th>Proj.</th><th>Ativ.</th><th>Pend.</th><th style={{ textAlign: "right" }}>Valor</th></tr></thead>
            <tbody>
              {SETORES.map((s) => {
                const x = r.porSetor.get(s.sigla);
                return (
                  <tr key={s.sigla} style={{ borderTop: `1px solid ${C.grade}`, color: x ? C.texto : C.fraco, cursor: "pointer" }} onClick={() => setF((v) => ({ ...v, setor: v.setor === s.sigla ? "" : s.sigla }))}
                    title="Clique para filtrar a lista">
                    <td style={{ padding: "4px 6px", fontWeight: f.setor === s.sigla ? 700 : 400 }}>{s.sigla}{!x && <span style={{ color: C.ambar }}> · sem envio</span>}</td>
                    <td>{x?.projetos ?? 0}</td><td>{x?.atividades ?? 0}</td>
                    <td style={{ color: x?.pendentes ? C.ambar : undefined }}>{x?.pendentes ?? 0}</td>
                    <td style={{ textAlign: "right" }}>{x?.valor ? moeda(x.valor) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={cartao}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Entregas dos projetos por trimestre</div>
          <div style={{ fontSize: 11, color: C.fraco, marginBottom: 10 }}>Tarefas e marcos que terminam em cada trimestre. A DIRAD pede entregas nos quatro (Of nº 37/CGOV/17513, item 3).</div>
          {r.trimestres.map((n, i) => {
            const max = Math.max(1, ...r.trimestres);
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 1fr 34px", gap: 8, alignItems: "center", fontSize: 12, marginTop: 6 }}>
                <span style={{ color: C.fraco }}>{i + 1}º trim.</span>
                <div style={{ background: C.grade, borderRadius: 4, height: 12 }}><div style={{ width: `${(n / max) * 100}%`, height: "100%", borderRadius: 4, background: n ? C.ciano : "transparent" }} /></div>
                <span style={{ textAlign: "right", color: n ? C.texto : C.ambar, fontWeight: 700 }}>{n}</span>
              </div>
            );
          })}
          {r.excluidos > 0 && <div style={{ fontSize: 11, color: C.fraco, marginTop: 10 }}>{r.excluidos} cadastro(s) excluído(s) pelos próprios autores (ficam no histórico).</div>}
        </div>
      </div>

      {/* ── lista ── */}
      <div style={{ ...cartao, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="search" placeholder="Buscar nome, responsável, etapa…" value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })} style={{ ...entrada, flex: "1 1 220px" }} />
          <select value={f.setor} onChange={(e) => setF({ ...f, setor: e.target.value })} style={entrada} aria-label="Setor">
            <option value="">Todos os setores</option>
            {SETORES.map((s) => <option key={s.sigla} value={s.sigla}>{s.sigla}</option>)}
          </select>
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as Filtro["tipo"] })} style={entrada} aria-label="Tipo">
            <option value="">Projetos e atividades</option><option value="projeto">Só projetos</option><option value="atividade">Só atividades</option>
          </select>
          <label style={{ fontSize: 12, color: C.fraco, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={f.soPendentes} onChange={(e) => setF({ ...f, soPendentes: e.target.checked })} /> só com pendência</label>
          <label style={{ fontSize: 12, color: C.fraco, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={f.excluidos} onChange={(e) => setF({ ...f, excluidos: e.target.checked })} /> mostrar excluídos</label>
          <span style={{ flex: 1 }} />
          <button type="button" style={botao} onClick={() => { void baixarExcel(); }} disabled={!itens.length}>Baixar Excel</button>
          <button type="button" style={botao} onClick={baixarJson} disabled={!itens.length}>Baixar JSON</button>
        </div>
        <div style={{ fontSize: 11, color: C.fraco }}>{visiveis.length} de {itens.filter((c) => !c.excluidoEm).length} cadastro(s) · lido em {dataHora(geradoEm)}</div>

        {!visiveis.length && <div style={{ fontSize: 13, color: C.fraco, padding: 12, textAlign: "center" }}>{itens.length ? "Nada com esses filtros." : "Nenhum cadastro ainda."}</div>}
        {visiveis.map((c) => {
          const p = pendencias(c);
          const aberto = abertos.has(c.id ?? "");
          const valor = c.dados.precisaDinheiro === "Sim" && c.dados.valor ? moeda(c.dados.valor) : null;
          return (
            <div key={c.id} style={{ border: `1px solid ${C.borda}`, borderRadius: 10, opacity: c.excluidoEm ? 0.55 : 1 }}>
              <button type="button" aria-expanded={aberto}
                onClick={() => setAbertos((s) => { const n = new Set(s); if (n.has(c.id ?? "")) n.delete(c.id ?? ""); else n.add(c.id ?? ""); return n; })}
                style={{ all: "unset", cursor: "pointer", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, padding: "9px 12px", width: "100%", boxSizing: "border-box" }}>
                <span>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", borderRadius: 5, padding: "1px 6px", marginRight: 6, color: c.tipo === "projeto" ? C.ciano : C.verde, border: `1px solid ${c.tipo === "projeto" ? C.ciano : C.verde}55` }}>{c.tipo}</span>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{c.nome}</span>
                  {c.excluidoEm && <span style={{ color: C.vermelho, fontSize: 11 }}> · excluído em {dataHora(c.excluidoEm)}</span>}
                  <span style={{ display: "block", fontSize: 11.5, color: C.fraco, marginTop: 2 }}>
                    {c.setor}{c.secao ? ` · ${c.secao}` : ""} · resp. {c.dados.responsavel || "—"}
                    {c.tipo === "projeto" ? ` · ${c.dados.inicio || "?"} a ${c.dados.termino || "?"}` : c.dados.medicao ? ` · ${c.dados.medicao}` : ""}
                    {valor ? ` · ${valor}` : ""} · {c.tipo === "projeto" ? `${c.etapas.length} etapa(s)` : `${c.etapas.length} tarefa(s)`}
                  </span>
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: p.length ? C.ambar : C.verde, whiteSpace: "nowrap" }}>{p.length ? `${p.length} pendência(s)` : "completo"} {aberto ? "▴" : "▾"}</span>
              </button>
              {aberto && <Detalhe c={c} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Detalhe({ c }: { c: Cadastro }) {
  const p = pendencias(c);
  const pares: [string, string][] = c.tipo === "projeto"
    ? [["Divisão", nomeSetor(c.setor)], ["O que vai ficar pronto", c.dados.entrega], ["Por que é necessário", c.dados.porque], ["Se não for feito", c.dados.seNaoFizer],
      ["Período", `${c.dados.inicio || "?"} a ${c.dados.termino || "?"}`], ["Responsável", `${c.dados.responsavel}${c.dados.ramal ? ` · ramal ${c.dados.ramal}` : ""}`],
      ["Precisa de dinheiro?", c.dados.precisaDinheiro], ["Valor estimado", c.dados.valor !== null ? moeda(c.dados.valor) : ""], ["O que será comprado", c.dados.compra],
      ["Situação da contratação", c.dados.contratacao], ["Prioridade", c.dados.prioridade], ["Observações", c.dados.observacoes],
      ["Entregas por trimestre", entregasPorTrimestre(c.etapas).map((n, i) => `${i + 1}º: ${n}`).join(" · ")]]
    : [["Divisão", nomeSetor(c.setor)], ["O que é feito", c.dados.oQueE], ["Já existe na Matriz?", `${c.dados.matriz}${c.dados.matrizAtividade ? ` — ${c.dados.matrizAtividade}` : ""}`],
      ["Item de controle", c.dados.itemControle], ["Indicador", c.dados.indicador], ["Como calcular", c.dados.calculo],
      ["Unidade e meta", [c.dados.unidade, c.dados.meta && `meta ${c.dados.meta}`].filter(Boolean).join(" · ")], ["Medição", c.dados.medicao],
      ["De onde vêm os dados", c.dados.fonteDados], ["Responsável", `${c.dados.responsavel}${c.dados.ramal ? ` · ramal ${c.dados.ramal}` : ""}`],
      ["Precisa de dinheiro?", c.dados.precisaDinheiro], ["Valor estimado no ano", c.dados.valor !== null ? moeda(c.dados.valor) : ""], ["O que será comprado", c.dados.compra],
      ["Observações", c.dados.observacoes]];
  const td: React.CSSProperties = { padding: "4px 6px", borderTop: `1px solid ${C.grade}`, verticalAlign: "top" };
  return (
    <div style={{ padding: "0 12px 12px", display: "grid", gap: 10, fontSize: 12 }}>
      {p.length > 0 && <div style={{ color: C.ambar }}>Pendências: {p.join("; ")}</div>}
      <dl style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) minmax(0, 1fr)", gap: "3px 12px", margin: 0 }}>
        {pares.map(([r, v]) => <Fragment key={r}><dt style={{ color: C.fraco }}>{r}</dt><dd style={{ margin: 0, color: v ? C.texto : C.fraco }}>{v || "—"}</dd></Fragment>)}
      </dl>
      <div style={{ overflowX: "auto" }}>
        {c.tipo === "projeto" ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ color: C.fraco, textAlign: "left" }}><th style={td}>#</th><th style={td}>Tipo</th><th style={td}>Descrição</th><th style={td}>Quando</th><th style={td}>Trim.</th><th style={td}>Responsável</th><th style={td}>Como comprovar</th></tr></thead>
            <tbody>{c.etapas.map((e, i) => (
              <tr key={i} style={{ color: e.tipo === "Marco" ? C.ambar : C.texto }}>
                <td style={td}>{i + 1}</td><td style={td}>{e.tipo}</td><td style={td}>{e.descricao}</td>
                <td style={td}>{e.tipo === "Marco" ? e.fim : `${e.inicio} a ${e.fim}`}</td><td style={td}>{trimestreDe(e.fim) || "—"}</td>
                <td style={td}>{e.responsavel}</td><td style={td}>{e.comprova}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ color: C.fraco, textAlign: "left" }}><th style={td}>#</th><th style={td}>Tarefa</th><th style={td}>Frequência</th><th style={td}>Quando</th><th style={td}>Responsável</th><th style={td}>Como comprovar</th></tr></thead>
            <tbody>{c.etapas.map((t, i) => (
              <tr key={i}><td style={td}>{i + 1}</td><td style={td}>{t.tarefa}</td><td style={td}>{t.frequencia}</td><td style={td}>{t.quando}</td><td style={td}>{t.responsavel}</td><td style={td}>{t.comprova}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div style={{ color: C.fraco, fontSize: 11 }}>
        Preenchido por {c.posto} {c.nomeGuerra} · criado em {dataHora(c.criadoEm)} · última alteração {dataHora(c.atualizadoEm)} · versão {c.versao ?? 1}
      </div>
    </div>
  );
}
