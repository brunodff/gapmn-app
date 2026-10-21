// Minuta do PTA dentro do Painel de Execução (só ADMIN e DEV): o documento Word completo (PtaWord) e o
// capítulo VII, Composição Orçamentária, gerado com os empenhos do ano no painel. O DEV edita e salva;
// ADMIN e DEV comentam artigo por artigo.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import PtaWord from "./PtaWord";
import type { NotaEmpenho } from "../lib/execucao/empenhos.ts";
import type { Vinculo } from "../lib/execucao/painel.ts";
import {
  ACAO_A_CONFIRMAR, conferirComposicao, gerarComposicao, textoCapitulo, tituloArtigo, totalArtigo, totalComposicao,
  type ArtigoPTA, type TarefaPTA,
} from "../lib/execucao/pta.ts";
import {
  apagarComentario, comentar, criarMinuta, lerComentarios, lerMinuta, marcarResolvido, salvarMinuta,
  type Comentario, type ConteudoCap7, type Minuta,
} from "../lib/execucao/ptaMinuta.ts";

const C = {
  bg: "#0d1117", card: "#161b27", borda: "#1e2a3a", texto: "#e2e8f0", fraco: "#7c8ba1", grade: "#1e2a3a",
  ciano: "#22d3ee", verde: "#4ade80", ambar: "#fbbf24", roxo: "#a78bfa", vermelho: "#f87171",
};
const SECAO = "cap7";
const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const botao: React.CSSProperties = {
  background: "#1e2a3a", border: `1px solid ${C.borda}`, borderRadius: 8, padding: "6px 12px", fontSize: 11,
  color: C.texto, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap",
};
const entrada: React.CSSProperties = {
  background: C.bg, border: `1px solid ${C.borda}`, borderRadius: 6, padding: "4px 6px", fontSize: 12, color: C.texto,
  width: "100%", boxSizing: "border-box", minWidth: 0,
};

type Props = { nes: readonly NotaEmpenho[]; vinculos: ReadonlyMap<string, Vinculo>; setor: string; ano: number };

export default function PtaMinuta({ nes, vinculos, setor, ano }: Props) {
  const podeEditar = setor === "DEV";
  const [minuta, setMinuta] = useState<Minuta | null>(null);
  const [rascunho, setRascunho] = useState<ConteudoCap7 | null>(null);
  const [coments, setComents] = useState<Comentario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [meuId, setMeuId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setMeuId(data.session?.user.id ?? null)).catch(() => {}); }, []);

  const proposta = useMemo<ConteudoCap7>(() => ({ ...gerarComposicao(nes, vinculos, { ano }), primeiroArtigo: 38 }), [nes, vinculos, ano]);
  const doc: ConteudoCap7 = rascunho ?? minuta?.conteudo ?? proposta;
  const previa = !minuta;
  const sujo = !!rascunho;

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [m, c] = await Promise.all([lerMinuta(ano, SECAO), lerComentarios(ano, SECAO)]);
      setMinuta(m);
      setComents(c);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [ano]);

  useEffect(() => { void carregar(); }, [carregar]);

  // comentários novos chegam sozinhos (a cada minuto e quando a aba volta ao foco)
  useEffect(() => {
    const atualizar = () => { lerComentarios(ano, SECAO).then(setComents).catch(() => {}); };
    const iv = setInterval(atualizar, 60_000);
    window.addEventListener("focus", atualizar);
    return () => { clearInterval(iv); window.removeEventListener("focus", atualizar); };
  }, [ano]);

  const avisar = (t: string) => { setAviso(t); setTimeout(() => setAviso((a) => (a === t ? null : a)), 4000); };

  async function acao(fn: () => Promise<void>) {
    setOcupado(true);
    setErro(null);
    try { await fn(); } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }

  // ── edição (só DEV) ─────────────────────────────────────────────────────────
  const editar = (fn: (d: ConteudoCap7) => void) => {
    const d = copia(doc);
    fn(d);
    setRascunho(d);
  };
  const mudarTarefa = (artId: string, tarId: string, campo: keyof TarefaPTA, valor: string) => editar((d) => {
    const t = d.artigos.find((a) => a.id === artId)?.tarefas.find((x) => x.id === tarId);
    if (!t) return;
    if (campo === "valor") t.valor = Number(valor.replace(/\./g, "").replace(",", ".")) || 0;
    else (t as Record<string, unknown>)[campo] = valor;
  });
  const novaTarefa = (artId: string) => editar((d) => {
    d.artigos.find((a) => a.id === artId)?.tarefas.push({
      id: `${artId}:manual:${Date.now()}`, codigo: "", periodo: "", descricao: "", valor: 0, base: 0, nes: 0,
      contrato: null, observacao: "incluída na minuta",
    });
  });
  const removerTarefa = (artId: string, tarId: string) => editar((d) => {
    const a = d.artigos.find((x) => x.id === artId);
    if (a) a.tarefas = a.tarefas.filter((t) => t.id !== tarId);
  });

  const salvar = () => acao(async () => {
    if (!minuta) {
      const m = await criarMinuta(ano, SECAO, doc);
      setMinuta(m);
      setRascunho(null);
      avisar("Minuta criada. ADMIN e DEV já podem comentar.");
      return;
    }
    const m = await salvarMinuta(ano, SECAO, doc, minuta.versao);
    setMinuta(m);
    setRascunho(null);
    avisar(`Versão ${m.versao} salva.`);
  });

  const regerar = () => {
    if (!window.confirm("Trocar o conteúdo da minuta pela proposta gerada agora com os dados do painel? As edições não salvas e os valores ajustados à mão serão substituídos. Os comentários ficam.")) return;
    setRascunho({ ...copia(proposta), primeiroArtigo: doc.primeiroArtigo });
  };

  async function copiarTexto() {
    try {
      await navigator.clipboard.writeText(textoCapitulo(doc, doc.primeiroArtigo));
      avisar("Texto do capítulo copiado. Cole no Word.");
    } catch {
      avisar("O navegador não deixou copiar.");
    }
  }

  // ── comentários ─────────────────────────────────────────────────────────────
  const porAlvo = useMemo(() => {
    const m = new Map<string, Comentario[]>();
    for (const c of coments) { const k = c.alvo ?? "secao"; m.set(k, [...(m.get(k) ?? []), c]); }
    return m;
  }, [coments]);
  const pendentes = (alvo: string) => (porAlvo.get(alvo) ?? []).filter((c) => !c.resolvido && c.tipo === "comentario").length;
  const total = (alvo: string) => (porAlvo.get(alvo) ?? []).length;

  const enviar = (alvo: string | null, rotulo: string | null, tipo: "comentario" | "de_acordo", texto: string) => acao(async () => {
    const c = await comentar({ ano, secao: SECAO, alvo, alvo_rotulo: rotulo, tipo, texto });
    setComents((l) => [...l, c]);
  });
  const resolver = (c: Comentario) => acao(async () => {
    await marcarResolvido(c.id, !c.resolvido);
    setComents((l) => l.map((x) => (x.id === c.id ? { ...x, resolvido: !c.resolvido } : x)));
  });
  const apagar = (c: Comentario) => acao(async () => {
    await apagarComentario(c.id);
    setComents((l) => l.filter((x) => x.id !== c.id));
  });

  const avisosConferencia = useMemo(() => conferirComposicao(doc), [doc]);

  if (carregando) return <div style={{ padding: 30, textAlign: "center", color: C.fraco, fontSize: 13 }}>Carregando a minuta…</div>;

  const botaoComentar = (alvo: string) => {
    const n = total(alvo);
    const p = pendentes(alvo);
    return (
      <button type="button" onClick={() => setAberto((a) => (a === alvo ? null : alvo))} title="Comentários"
        style={{ ...botao, padding: "3px 8px", background: aberto === alvo ? `${C.ciano}22` : "transparent", borderColor: p ? C.ambar : C.borda, color: p ? C.ambar : C.fraco }}>
        💬 {n || ""}
      </button>
    );
  };

  const fio = (alvo: string, rotulo: string) => (
    <FioComentarios
      key={alvo}
      meuId={meuId}
      lista={porAlvo.get(alvo) ?? []}
      rotulo={rotulo}
      podeResolverTudo={podeEditar}
      ocupado={ocupado || previa}
      bloqueio={previa ? "Os comentários abrem depois que o DEV cria a minuta." : null}
      onEnviar={(tipo, texto) => enviar(alvo === "secao" ? null : alvo, rotulo, tipo, texto)}
      onResolver={resolver}
      onApagar={apagar}
    />
  );

  return (
    <div style={{ display: "grid", gap: 12, color: C.texto }}>
      <PtaWord ano={ano} setor={setor} minuta={{ atual: minuta, sujo }} onMinuta={(m) => { setMinuta(m); setRascunho(null); }} />

      {/* cabeçalho */}
      <section style={{ background: C.card, border: `1px solid ${C.borda}`, borderRadius: 14, padding: "14px 16px", display: "grid", gap: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Minuta do PTA {ano} — Capítulo VII · Composição Orçamentária</h3>
            <p style={{ margin: "3px 0 0", fontSize: 11, color: C.fraco }}>
              {previa
                ? "Prévia gerada agora com os dados do painel. Ainda não foi salva como minuta."
                : `Versão ${minuta!.versao} · atualizada por ${minuta!.atualizado_nome || "—"} em ${dataHora(minuta!.atualizado_em)}`}
              {sujo && <span style={{ color: C.ambar }}> · alterações não salvas</span>}
              {" · "}<span style={{ color: C.roxo }}>visível só para ADMIN e DEV</span>
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {podeEditar && (previa || sujo) && (
              <button type="button" onClick={() => void salvar()} disabled={ocupado} style={{ ...botao, background: C.ciano, color: "#04121a", borderColor: C.ciano }}>
                {previa ? "Criar minuta" : "Salvar"}
              </button>
            )}
            {podeEditar && sujo && <button type="button" onClick={() => setRascunho(null)} disabled={ocupado} style={botao}>Descartar alterações</button>}
            {podeEditar && !previa && <button type="button" onClick={regerar} disabled={ocupado} style={botao}>Regerar com o painel</button>}
            <button type="button" onClick={() => void copiarTexto()} style={botao}>Copiar texto</button>
            <button type="button" onClick={() => void carregar()} style={botao}>↻</button>
            {botaoComentar("secao")}
          </div>
        </div>
        {aviso && <div role="status" style={{ fontSize: 12, color: C.verde }}>{aviso}</div>}
        {erro && <div role="alert" style={{ fontSize: 12, color: C.vermelho }}>{erro}</div>}
        {aberto === "secao" && fio("secao", "Capítulo VII (geral)")}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12 }}>
          <span>Total proposto: <strong style={{ color: C.ciano }}>{moeda(totalComposicao(doc))}</strong></span>
          <span style={{ color: C.fraco }}>{doc.artigos.length} artigos · {doc.artigos.reduce((s, a) => s + a.tarefas.length, 0)} tarefas</span>
          {podeEditar ? (
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", color: C.fraco }}>
              Primeiro artigo
              <input type="number" min={1} value={doc.primeiroArtigo} onChange={(e) => editar((d) => { d.primeiroArtigo = Math.max(1, Number(e.target.value) || 1); })}
                style={{ ...entrada, width: 64 }} aria-label="Número do primeiro artigo" />
            </label>
          ) : <span style={{ color: C.fraco }}>Artigos a partir do {doc.primeiroArtigo}</span>}
        </div>
        <details>
          <summary style={{ cursor: "pointer", fontSize: 12, color: C.fraco }}>Pontos a conferir ({doc.pontos.length + avisosConferencia.length})</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: C.texto, display: "grid", gap: 4 }}>
            {doc.pontos.map((p) => <li key={p}>{p}</li>)}
            {avisosConferencia.map((p) => <li key={p} style={{ color: C.ambar }}>{p}</li>)}
          </ul>
        </details>
      </section>

      {/* artigos */}
      {doc.artigos.map((a, i) => (
        <ArtigoCartao key={a.id} artigo={a} numero={doc.primeiroArtigo + i} ano={ano} podeEditar={podeEditar}
          onAcao={(v) => editar((d) => { const x = d.artigos.find((y) => y.id === a.id); if (x) x.acao = v; })}
          onTarefa={(tid, campo, v) => mudarTarefa(a.id, tid, campo, v)}
          onNova={() => novaTarefa(a.id)} onRemover={(tid) => removerTarefa(a.id, tid)}
          botaoComentar={botaoComentar} aberto={aberto} fio={fio}
        />
      ))}
    </div>
  );
}

// ─── Artigo ───────────────────────────────────────────────────────────────────

function ArtigoCartao({ artigo: a, numero, ano, podeEditar, onAcao, onTarefa, onNova, onRemover, botaoComentar, aberto, fio }: {
  artigo: ArtigoPTA; numero: number; ano: number; podeEditar: boolean;
  onAcao: (v: string) => void; onTarefa: (tid: string, campo: keyof TarefaPTA, v: string) => void;
  onNova: () => void; onRemover: (tid: string) => void;
  botaoComentar: (alvo: string) => React.ReactNode; aberto: string | null;
  fio: (alvo: string, rotulo: string) => React.ReactNode;
}) {
  const totalBase = a.tarefas.reduce((s, t) => s + (Number(t.base) || 0), 0);
  const fioAberto = aberto === a.id ? { alvo: a.id, rotulo: tituloArtigo(a, numero) } : (() => {
    const t = a.tarefas.find((x) => x.id === aberto);
    return t ? { alvo: t.id, rotulo: `${t.codigo || "sem código"} – ${t.descricao || "tarefa sem descrição"}` } : null;
  })();
  return (
    <section style={{ background: C.card, border: `1px solid ${C.borda}`, borderRadius: 14, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>
            Art. {numero} {a.titulo} – ND {a.nd} – Ação:{" "}
            {podeEditar
              ? <input value={a.acao === ACAO_A_CONFIRMAR ? "" : a.acao} placeholder="a confirmar" onChange={(e) => onAcao(e.target.value || ACAO_A_CONFIRMAR)}
                  style={{ ...entrada, width: 90, display: "inline-block" }} aria-label={`Ação do artigo ${numero}`} />
              : <span style={{ color: a.acao === ACAO_A_CONFIRMAR ? C.ambar : C.texto }}>{a.acao === ACAO_A_CONFIRMAR ? "«a confirmar»" : a.acao}</span>}
            {" – "}<span style={{ color: C.ciano }}>{moeda(totalArtigo(a))}</span>
          </div>
          <div style={{ fontSize: 11, color: C.fraco, marginTop: 2 }}>PI {a.pi} · {a.piNome} · base {ano - 1}: {moeda(totalBase)}</div>
        </div>
        {botaoComentar(a.id)}
      </div>
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: C.fraco, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${C.grade}` }}>
              <th style={{ textAlign: "left", padding: "5px 6px", width: 92 }}>Código</th>
              <th style={{ textAlign: "left", padding: "5px 6px", width: 110 }}>Período</th>
              <th style={{ textAlign: "left", padding: "5px 6px" }}>Tarefa</th>
              <th style={{ textAlign: "right", padding: "5px 6px", width: 120 }}>Base {ano - 1}</th>
              <th style={{ textAlign: "right", padding: "5px 6px", width: 130 }}>Proposta {ano}</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {a.tarefas.map((t) => (
              <tr key={t.id} style={{ borderBottom: `1px solid ${C.grade}`, verticalAlign: "top" }}>
                <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>
                  {podeEditar ? <input value={t.codigo} onChange={(e) => onTarefa(t.id, "codigo", e.target.value.toUpperCase())} style={entrada} aria-label="Código" /> : t.codigo}
                </td>
                <td style={{ padding: "5px 6px" }}>
                  {podeEditar ? <input value={t.periodo} onChange={(e) => onTarefa(t.id, "periodo", e.target.value)} style={entrada} aria-label="Período" /> : t.periodo}
                </td>
                <td style={{ padding: "5px 6px" }}>
                  {podeEditar
                    ? <textarea value={t.descricao} onChange={(e) => onTarefa(t.id, "descricao", e.target.value)} rows={2} style={{ ...entrada, resize: "vertical" }} aria-label="Tarefa" />
                    : t.descricao}
                  {(t.observacao || t.nes > 0) && (
                    <div style={{ fontSize: 10, color: /vence/.test(t.observacao) ? C.ambar : C.fraco, marginTop: 2 }}>
                      {[t.nes ? `${t.nes} NE${t.nes > 1 ? "s" : ""} em ${ano - 1}` : "", t.observacao].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </td>
                <td style={{ padding: "5px 6px", textAlign: "right", fontFamily: "monospace", color: C.fraco, whiteSpace: "nowrap" }}>{moeda(t.base)}</td>
                <td style={{ padding: "5px 6px", textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                  {podeEditar
                    ? <InputValor valor={t.valor} onMudar={(v) => onTarefa(t.id, "valor", v)} />
                    : <span style={{ color: t.valor !== t.base ? C.ambar : C.texto }}>{moeda(Number(t.valor) || 0)}</span>}
                </td>
                <td style={{ padding: "5px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {botaoComentar(t.id)}
                  {podeEditar && (
                    <button type="button" onClick={() => onRemover(t.id)} title="Tirar a tarefa da minuta"
                      style={{ ...botao, padding: "3px 7px", marginLeft: 4, color: C.vermelho, background: "transparent" }}>✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {podeEditar && <button type="button" onClick={onNova} style={{ ...botao, marginTop: 8 }}>+ Tarefa</button>}
      {fioAberto && <div style={{ marginTop: 10 }}>{fio(fioAberto.alvo, fioAberto.rotulo)}</div>}
    </section>
  );
}

/** Valor em reais editável: mostra formatado e aceita "1.234,56". */
function InputValor({ valor, onMudar }: { valor: number; onMudar: (v: string) => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const mostrado = texto ?? (Number(valor) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <input value={mostrado} inputMode="decimal" aria-label="Valor proposto"
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => { if (texto !== null) { onMudar(texto); setTexto(null); } }}
      style={{ ...entrada, textAlign: "right", fontFamily: "monospace" }} />
  );
}

// ─── Comentários ──────────────────────────────────────────────────────────────

function FioComentarios({ meuId, lista, rotulo, podeResolverTudo, ocupado, bloqueio, onEnviar, onResolver, onApagar }: {
  meuId: string | null; lista: Comentario[]; rotulo: string; podeResolverTudo: boolean; ocupado: boolean; bloqueio: string | null;
  onEnviar: (tipo: "comentario" | "de_acordo", texto: string) => void;
  onResolver: (c: Comentario) => void; onApagar: (c: Comentario) => void;
}) {
  const [texto, setTexto] = useState("");
  return (
    <div style={{ border: `1px solid ${C.ciano}44`, background: `${C.ciano}08`, borderRadius: 10, padding: "10px 12px", display: "grid", gap: 8 }}>
      <div style={{ fontSize: 11, color: C.fraco }}>Comentários sobre: <strong style={{ color: C.texto }}>{rotulo}</strong></div>
      {lista.length === 0 && <div style={{ fontSize: 12, color: C.fraco }}>Nenhum comentário ainda.</div>}
      {lista.map((c) => {
        const meu = meuId === c.autor_id;
        return (
          <Fragment key={c.id}>
            <div style={{ display: "grid", gap: 2, opacity: c.resolvido ? 0.55 : 1 }}>
              <div style={{ fontSize: 11, color: C.fraco }}>
                <strong style={{ color: C.texto }}>{c.autor_nome || "—"}</strong> · {dataHora(c.criado_em)}
                {c.tipo === "de_acordo" && <span style={{ color: C.verde }}> · ✓ de acordo</span>}
                {c.resolvido && <span> · resolvido</span>}
              </div>
              <div style={{ fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.texto}</div>
              <div style={{ display: "flex", gap: 6 }}>
                {c.tipo === "comentario" && (podeResolverTudo || meu) && (
                  <button type="button" disabled={ocupado} onClick={() => onResolver(c)} style={{ ...botao, padding: "2px 8px", fontSize: 10 }}>
                    {c.resolvido ? "Reabrir" : "Marcar como resolvido"}
                  </button>
                )}
                {meu && (
                  <button type="button" disabled={ocupado} onClick={() => onApagar(c)} style={{ ...botao, padding: "2px 8px", fontSize: 10, color: C.vermelho }}>Apagar</button>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
      {bloqueio ? (
        <div style={{ fontSize: 11, color: C.ambar }}>{bloqueio}</div>
      ) : (
        <>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={4000} placeholder="Escreva um comentário…"
            aria-label="Novo comentário" style={{ ...entrada, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" disabled={ocupado || !texto.trim()} onClick={() => { onEnviar("comentario", texto.trim()); setTexto(""); }}
              style={{ ...botao, background: C.ciano, color: "#04121a", borderColor: C.ciano }}>Comentar</button>
            <button type="button" disabled={ocupado} onClick={() => onEnviar("de_acordo", texto.trim() || "De acordo.")}
              style={{ ...botao, color: C.verde }}>✓ De acordo</button>
          </div>
        </>
      )}
    </div>
  );
}
