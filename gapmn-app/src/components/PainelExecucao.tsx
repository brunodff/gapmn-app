// Painel de Execução: empenhos de 2026 por item, com categoria do objeto, contrato do PAG,
// liquidação e pagamento. Os dados vêm de lib/execucao (leitura, classificação e agrupamentos).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
} from "recharts";
import MultiSelectPI from "./MultiSelectPI";
import { CATEGORIAS, categoria as catDe, type CategoriaId } from "../lib/execucao/categorias.ts";
import { fmtCNPJ, type ItemEmpenho, type NotaEmpenho } from "../lib/execucao/empenhos.ts";
import { buscarExecucao, type DadosExecucao } from "../lib/execucao/fonte.ts";
import {
  FILTROS_VAZIOS, filtrar, financeiroDo, omDe, porCategoria, porContrato, porFornecedor, porMes, porOM,
  porObjeto, resumir, vincular, type Filtros, type Financeiro, type Recorte, type Vinculo,
} from "../lib/execucao/painel.ts";

// ─── Aparência (mesmos tons dos outros painéis escuros) ──────────────────────

const DK = {
  bg: "#0d1117", card: "#161b27", cardBorder: "#1e2a3a", text: "#e2e8f0", muted: "#7c8ba1", dim: "#334155",
  grid: "#1e2a3a", cyan: "#22d3ee", teal: "#2dd4bf", green: "#4ade80", amber: "#fbbf24", red: "#f87171", purple: "#a78bfa",
};

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtMoeda = (v: number) => moeda.format(v);
function fmtCurto(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return fmtMoeda(v);
}
const fmtData = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fmtMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1] ?? ym}/${ym.slice(2, 4)}`;
const pct = (v: number, total: number) => (total > 0 ? `${((v / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
const semPrefixo = (d: string) => d.replace(/^\s*item\s*compra\s*:\s*\d+\s*-\s*/i, "");

// ─── Peças de interface ──────────────────────────────────────────────────────

function Kpi({ rotulo, valor, sub, cor }: { rotulo: string; valor: string; sub?: string; cor: string }) {
  return (
    <div style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 14, padding: "14px 16px", position: "relative", overflow: "hidden", minWidth: 0 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${cor}00, ${cor}, ${cor}00)` }} />
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: DK.muted }}>{rotulo}</div>
      <div style={{ marginTop: 8, fontSize: 22, fontWeight: 800, color: cor, lineHeight: 1.1, overflowWrap: "anywhere" }}>{valor}</div>
      {sub && <div style={{ marginTop: 4, fontSize: 11, color: DK.muted }}>{sub}</div>}
    </div>
  );
}

function Cartao({ titulo, dica, children, extra }: { titulo: string; dica?: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 14, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: DK.text, margin: 0 }}>{titulo}</h3>
        {extra}
      </div>
      {dica && <p style={{ fontSize: 11, color: DK.muted, margin: "-4px 0 10px" }}>{dica}</p>}
      {children}
    </section>
  );
}

type LinhaBarra = { chave: string; nome: string; valor: number; sub?: string; cor?: string };

/** Lista de barras horizontais clicáveis (o clique filtra o painel). */
function ListaBarras({ linhas, ativo, onEscolher, limite = 10, corPadrao = DK.cyan }: {
  linhas: LinhaBarra[]; ativo?: string; onEscolher?: (chave: string) => void; limite?: number; corPadrao?: string;
}) {
  const [todas, setTodas] = useState(false);
  const max = Math.max(...linhas.map((l) => l.valor), 1);
  const visiveis = todas ? linhas : linhas.slice(0, limite);
  if (!linhas.length) return <p style={{ fontSize: 12, color: DK.muted }}>Nada para os filtros escolhidos.</p>;
  return (
    <div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>
        {visiveis.map((l) => {
          const cor = l.cor ?? corPadrao;
          const sel = ativo === l.chave;
          return (
            <li key={l.chave} style={{ minWidth: 0 }}>
              <button
                type="button"
                onClick={() => onEscolher?.(l.chave)}
                title={onEscolher ? (sel ? "Tirar o filtro" : "Filtrar o painel por este item") : undefined}
                style={{
                  width: "100%", textAlign: "left", background: sel ? `${cor}1f` : "transparent", border: `1px solid ${sel ? cor : "transparent"}`,
                  borderRadius: 8, padding: "5px 8px", cursor: onEscolher ? "pointer" : "default", color: DK.text,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.nome}>{l.nome}</span>
                  <span style={{ fontFamily: "monospace", whiteSpace: "nowrap", color: DK.text }}>{fmtCurto(l.valor)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 4, background: DK.grid, overflow: "hidden" }}>
                    <div style={{ width: `${(l.valor / max) * 100}%`, height: "100%", background: cor, borderRadius: 4 }} />
                  </div>
                  {l.sub && <span style={{ fontSize: 10, color: DK.muted, whiteSpace: "nowrap" }}>{l.sub}</span>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {linhas.length > limite && (
        <button type="button" onClick={() => setTodas((v) => !v)}
          style={{ marginTop: 8, fontSize: 11, color: DK.cyan, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          {todas ? "Mostrar menos" : `Mostrar todos (${linhas.length})`}
        </button>
      )}
    </div>
  );
}

function Chip({ texto, onTirar, cor = DK.cyan }: { texto: string; onTirar: () => void; cor?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: cor, border: `1px solid ${cor}55`, background: `${cor}14`, borderRadius: 999, padding: "3px 6px 3px 10px", maxWidth: "100%" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{texto}</span>
      <button type="button" onClick={onTirar} aria-label={`Tirar filtro ${texto}`}
        style={{ background: "none", border: "none", color: cor, cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "0 2px" }}>✕</button>
    </span>
  );
}

function CategoriaTag({ id }: { id: CategoriaId }) {
  const c = catDe(id);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: DK.text, border: `1px solid ${c.cor}55`, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: c.cor }} />{c.nome}
    </span>
  );
}

const estiloSelect: React.CSSProperties = {
  background: DK.bg, border: `1px solid ${DK.cardBorder}`, borderRadius: 8, padding: "6px 10px", fontSize: 12, color: DK.text,
  outline: "none", cursor: "pointer", maxWidth: "100%", minWidth: 0,
};
const estiloBotao: React.CSSProperties = {
  background: "#1e2a3a", border: `1px solid ${DK.cardBorder}`, borderRadius: 8, padding: "6px 12px", fontSize: 11, color: DK.text,
  cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap",
};

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: DK.muted }}>{rotulo}</div>
      <div style={{ fontSize: 12, color: DK.text, marginTop: 2, overflowWrap: "anywhere" }}>{children}</div>
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

type Ordem = "valor" | "emissao" | "ne";

export default function PainelExecucao() {
  const [dados, setDados] = useState<DadosExecucao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [f, setF] = useState<Filtros>(FILTROS_VAZIOS);
  const [ordem, setOrdem] = useState<Ordem>("valor");
  const [limite, setLimite] = useState(30);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [telaCheia, setTelaCheia] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await buscarExecucao());
    } catch (e) {
      setErro((e as Error)?.message ?? "Erro ao ler as planilhas.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    const iv = setInterval(() => void carregar(), 3_600_000); // a planilha muda uma vez por dia, às 8h
    return () => clearInterval(iv);
  }, [carregar]);

  useEffect(() => {
    const h = () => setTelaCheia(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const alternarTelaCheia = () => {
    if (!document.fullscreenElement) caixa.current?.requestFullscreen().catch(() => setTelaCheia((v) => !v));
    else document.exitFullscreen().catch(() => setTelaCheia(false));
  };

  const vinculos = useMemo(() => (dados ? vincular(dados.nes, dados.contratos, dados.processos) : new Map<string, Vinculo>()), [dados]);
  const recortes = useMemo(() => (dados ? filtrar(dados.nes, f, vinculos) : []), [dados, f, vinculos]);
  const fin = useMemo(() => dados?.financeiro ?? new Map<string, Financeiro>(), [dados]);
  const resumo = useMemo(() => resumir(recortes, fin, vinculos), [recortes, fin, vinculos]);
  const categorias = useMemo(() => porCategoria(recortes), [recortes]);
  const meses = useMemo(() => porMes(recortes), [recortes]);
  const objetos = useMemo(() => porObjeto(recortes), [recortes]);
  const contratos = useMemo(() => porContrato(recortes, vinculos, fin), [recortes, vinculos, fin]);
  const oms = useMemo(() => porOM(recortes), [recortes]);
  const fornecedores = useMemo(() => porFornecedor(recortes), [recortes]);

  // Opções dos filtros (do conjunto inteiro, para não sumirem ao filtrar)
  const opcoes = useMemo(() => {
    const nes = dados?.nes ?? [];
    const om = [...new Set(nes.map(omDe))].sort();
    const nd = new Map<string, string>();
    const pis = new Map<string, string>();
    const ms = new Set<string>();
    for (const n of nes) {
      nd.set(n.natureza, n.naturezaNome);
      if (n.pi) pis.set(n.pi, n.piNome);
      ms.add(n.emissao.slice(0, 7));
    }
    return {
      om,
      nd: [...nd].sort(([a], [b]) => a.localeCompare(b)),
      pis: [...pis].map(([codigo, desc]) => ({ codigo, desc })).sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })),
      meses: [...ms].sort(),
    };
  }, [dados]);

  const ordenados = useMemo(() => {
    const a = [...recortes];
    if (ordem === "valor") a.sort((x, y) => y.valor - x.valor);
    else if (ordem === "emissao") a.sort((x, y) => y.nota.emissao.localeCompare(x.nota.emissao) || y.valor - x.valor);
    else a.sort((x, y) => x.nota.ne.localeCompare(y.nota.ne));
    return a;
  }, [recortes, ordem]);

  useEffect(() => setLimite(30), [f, ordem]);

  const mudar = (p: Partial<Filtros>) => setF((atual) => ({ ...atual, ...p }));
  const alternar = <K extends keyof Filtros>(k: K, v: Filtros[K]) => setF((atual) => ({ ...atual, [k]: atual[k] === v ? FILTROS_VAZIOS[k] : v }));
  const temFiltro = JSON.stringify({ ...f, pis: [...f.pis] }) !== JSON.stringify({ ...FILTROS_VAZIOS, pis: [] });

  const contratoAtivo = f.contrato ? dados?.contratos.find((c) => c.id === f.contrato) : null;
  const fornecedorAtivo = f.fornecedor ? fornecedores.find((x) => x.cnpj === f.fornecedor)?.nome ?? fmtCNPJ(f.fornecedor) : null;

  async function exportar() {
    const XLSX = await import("xlsx");
    const linhas = ordenados.flatMap((r) => r.itens.map((i) => {
      const n = r.nota;
      const v = vinculos.get(n.ne);
      return {
        NE: n.ne, Emissão: fmtData(n.emissao), Unidade: omDe(n), Natureza: `${n.natureza} - ${n.naturezaNome}`, PI: n.pi,
        PAG: n.pag, Contrato: v?.contrato?.numero ?? "", "Processo licitatório": v?.processo ? `${v.processo.modalidade} ${v.processo.numero}` : "",
        Fornecedor: n.favorecido.nome, CNPJ: n.favorecido.tipo === "empresa" && n.favorecido.documento ? fmtCNPJ(n.favorecido.documento) : "",
        "Item da compra": i.itemCompra ?? "", Item: semPrefixo(i.descricao), Categoria: catDe(i.categoria).nome, "Valor do item": Number(i.valor.toFixed(2)),
        Solicitação: n.solicitacao ?? "",
      };
    }));
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Empenhos 2026");
    XLSX.writeFile(wb, `empenhos-2026-por-item.xlsx`);
  }

  // ── Estados de carga ───────────────────────────────────────────────────────

  if (carregando && !dados) {
    return <div style={{ background: DK.bg, borderRadius: 20, padding: 40, textAlign: "center", color: DK.muted, fontSize: 13 }}>Carregando os empenhos de 2026…</div>;
  }
  if (erro && !dados) {
    return (
      <div style={{ background: DK.bg, borderRadius: 20, padding: 32 }}>
        <div style={{ color: DK.red, fontSize: 13, fontWeight: 700 }}>{erro}</div>
        <button type="button" onClick={() => void carregar()} style={{ ...estiloBotao, marginTop: 12 }}>Tentar de novo</button>
      </div>
    );
  }
  if (!dados) return null;

  const totalCategorias = categorias.reduce((s, c) => s + c.valor, 0);

  return (
    <div ref={caixa} className="space-y-3"
      style={{ background: DK.bg, borderRadius: 20, padding: 14, color: DK.text, minWidth: 0, maxWidth: "100%", ...(telaCheia ? { overflowY: "auto", height: "100vh", boxSizing: "border-box" as const } : {}) }}>

      {/* ── Cabeçalho ── */}
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Execução dos empenhos — 2026</h2>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: DK.muted }}>
            Notas de empenho por item (Tesouro Gerencial) · liquidação e pagamento da planilha de situação · lido às{" "}
            {new Date(dados.lidoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void exportar()} style={estiloBotao} title="Baixa os itens filtrados em Excel">⬇ Exportar itens</button>
          <button type="button" onClick={() => void carregar()} style={estiloBotao} disabled={carregando}>{carregando ? "Atualizando…" : "↻ Atualizar"}</button>
          <button type="button" onClick={alternarTelaCheia} style={estiloBotao}>{telaCheia ? "Sair da tela cheia" : "⛶ Tela cheia"}</button>
        </div>
      </header>

      {dados.avisos.map((a) => (
        <div key={a} role="status" style={{ fontSize: 11, color: DK.amber, border: `1px solid ${DK.amber}44`, background: `${DK.amber}10`, borderRadius: 10, padding: "6px 10px" }}>{a}</div>
      ))}

      {/* ── Filtros ── */}
      <div style={{ background: DK.card, border: `1px solid ${DK.cardBorder}`, borderRadius: 14, padding: "10px 12px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
        <input
          type="search"
          value={f.busca}
          onChange={(e) => mudar({ busca: e.target.value })}
          placeholder="Buscar objeto, NE, PAG, fornecedor, contrato ou solicitação…"
          aria-label="Buscar"
          style={{ ...estiloSelect, cursor: "text", width: "100%", boxSizing: "border-box", padding: "8px 12px", fontSize: 13 }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select value={f.om} onChange={(e) => mudar({ om: e.target.value })} style={estiloSelect} aria-label="Unidade">
            <option value="">Todas as unidades</option>
            {opcoes.om.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={f.categoria} onChange={(e) => mudar({ categoria: e.target.value as CategoriaId | "" })} style={estiloSelect} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {CATEGORIAS.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <select value={f.natureza} onChange={(e) => mudar({ natureza: e.target.value })} style={estiloSelect} aria-label="Natureza de despesa">
            <option value="">Todas as naturezas</option>
            {opcoes.nd.map(([cod, nome]) => <option key={cod} value={cod}>{cod} · {nome.slice(0, 40)}</option>)}
          </select>
          <select value={f.mes} onChange={(e) => mudar({ mes: e.target.value })} style={estiloSelect} aria-label="Mês de emissão">
            <option value="">Todos os meses</option>
            {opcoes.meses.map((m) => <option key={m} value={m}>{fmtMes(m)}</option>)}
          </select>
          <MultiSelectPI opcoes={opcoes.pis} selecionados={f.pis as Set<string>} onChange={(s) => mudar({ pis: s })} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: DK.text, cursor: "pointer" }}>
            <input type="checkbox" checked={f.soComContrato} onChange={(e) => mudar({ soComContrato: e.target.checked })} />
            Só com contrato
          </label>
          {temFiltro && (
            <button type="button" onClick={() => setF(FILTROS_VAZIOS)}
              style={{ ...estiloBotao, color: DK.red, borderColor: `${DK.red}55`, background: "transparent" }}>✕ Limpar filtros</button>
          )}
        </div>
        {(contratoAtivo || fornecedorAtivo) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {contratoAtivo && <Chip texto={`Contrato ${contratoAtivo.numero}`} onTirar={() => mudar({ contrato: "" })} />}
            {fornecedorAtivo && <Chip texto={`Fornecedor ${fornecedorAtivo}`} onTirar={() => mudar({ fornecedor: "" })} cor={DK.purple} />}
          </div>
        )}
      </div>

      {/* ── Números ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi rotulo="Empenhado em 2026" valor={fmtCurto(resumo.valor)} sub={`${resumo.nes.toLocaleString("pt-BR")} NEs · ${resumo.itens.toLocaleString("pt-BR")} itens`} cor={DK.cyan} />
        <Kpi rotulo="A liquidar" valor={fmtCurto(resumo.aLiquidar)} sub={pct(resumo.aLiquidar, resumo.valor) + " do empenhado"} cor={DK.amber} />
        <Kpi rotulo="Liquidado a pagar" valor={fmtCurto(resumo.liquidadoPagar)} sub={pct(resumo.liquidadoPagar, resumo.valor) + " do empenhado"} cor={DK.teal} />
        <Kpi rotulo="Pago" valor={fmtCurto(resumo.pago)} sub={pct(resumo.pago, resumo.valor) + " do empenhado"} cor={DK.green} />
        <Kpi rotulo="Com contrato" valor={pct(resumo.valorComContrato, resumo.valor)} sub={`${fmtCurto(resumo.valorComContrato)} em ${resumo.contratos} contratos`} cor={DK.purple} />
      </div>
      {(resumo.parcial || resumo.semSituacao > 0) && (
        <p style={{ fontSize: 11, color: DK.muted, margin: 0 }}>
          {resumo.parcial && "Liquidação e pagamento proporcionais ao valor dos itens filtrados. "}
          {resumo.semSituacao > 0 && `${resumo.semSituacao} NE${resumo.semSituacao > 1 ? "s" : ""} ainda sem linha na planilha de situação.`}
        </p>
      )}

      {/* ── Categoria e mês ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <Cartao titulo="Empenhado por categoria do objeto" dica="Clique numa categoria para filtrar. A categoria vem da natureza de despesa e do nome do item.">
          <ListaBarras
            limite={8}
            ativo={f.categoria}
            onEscolher={(k) => alternar("categoria", k as CategoriaId)}
            linhas={categorias.map((c) => ({ chave: c.chave, nome: c.nome, valor: c.valor, cor: c.cor, sub: `${pct(c.valor, totalCategorias)} · ${c.itens} itens` }))}
          />
        </Cartao>
        <Cartao titulo="Empenhado por mês de emissão" dica="Valor atual das NEs, no mês em que foram emitidas. Clique numa barra para filtrar.">
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={meses.map((m) => ({ ...m, rotulo: fmtMes(m.chave) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={DK.grid} vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: DK.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: DK.muted }} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => fmtCurto(v).replace("R$ ", "")} />
                <ChartTooltip
                  cursor={{ fill: "#ffffff0a" }}
                  contentStyle={{ background: "#1e2a3a", border: "1px solid #2d3f52", borderRadius: 10, fontSize: 11, color: DK.text }}
                  formatter={(v, _n, item: any) => [`${fmtMoeda(Number(v ?? 0))} · ${item?.payload?.nes ?? 0} NEs`, "Empenhado"]}
                />
                <Bar dataKey="valor" radius={[6, 6, 0, 0]} cursor="pointer" isAnimationActive={false}
                  onClick={(d: any) => { const k = d?.chave ?? d?.payload?.chave; if (k) alternar("mes", k); }}>
                  {meses.map((m) => <Cell key={m.chave} fill={!f.mes || f.mes === m.chave ? DK.cyan : `${DK.cyan}40`} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Cartao>
      </div>

      {/* ── Objetos e contratos ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <Cartao titulo="Objetos mais empenhados" dica="Itens agrupados pelo nome do catálogo. Clique para buscar o objeto.">
          <ListaBarras
            limite={12}
            ativo={objetos.find((o) => o.nome === f.busca)?.chave}
            onEscolher={(k) => {
              const o = objetos.find((x) => x.chave === k);
              if (o) mudar({ busca: f.busca === o.nome ? "" : o.nome });
            }}
            linhas={objetos.map((o) => ({ chave: o.chave, nome: o.nome, valor: o.valor, cor: catDe(o.categoria).cor, sub: `${o.nes} NE${o.nes > 1 ? "s" : ""} · ${catDe(o.categoria).nome}` }))}
          />
        </Cartao>
        <Cartao titulo="Contratos mais empenhados em 2026" dica="Contrato encontrado pelo PAG da NE. Clique para ver só as NEs do contrato.">
          {contratos.length === 0 ? (
            <p style={{ fontSize: 12, color: DK.muted }}>Nenhuma NE dos filtros está ligada a contrato.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>
              {contratos.slice(0, 10).map((c) => {
                const sel = f.contrato === c.contrato.id;
                return (
                  <li key={c.contrato.id} style={{ minWidth: 0 }}>
                    <button type="button" onClick={() => alternar("contrato", c.contrato.id)}
                      style={{ width: "100%", textAlign: "left", background: sel ? `${DK.purple}1f` : "transparent", border: `1px solid ${sel ? DK.purple : DK.cardBorder}`, borderRadius: 10, padding: "8px 10px", cursor: "pointer", color: DK.text }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                        <strong style={{ fontSize: 12, overflowWrap: "anywhere" }}>{c.contrato.numero}</strong>
                        <span style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{fmtCurto(c.valor)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: DK.muted, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {c.contrato.objeto || "Objeto não informado"}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 10, color: DK.muted, marginTop: 4, flexWrap: "wrap" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{c.contrato.fornecedor}</span>
                        <span>{c.nes} NE{c.nes > 1 ? "s" : ""} · pago {pct(c.pago, c.valor)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Cartao>
      </div>

      {/* ── Unidades e fornecedores ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <Cartao titulo="Por unidade">
          <ListaBarras limite={10} ativo={f.om} onEscolher={(k) => alternar("om", k)} corPadrao={DK.teal}
            linhas={oms.map((o) => ({ chave: o.chave, nome: o.nome, valor: o.valor, sub: `${o.nes} NEs` }))} />
        </Cartao>
        <Cartao titulo="Fornecedores" dica="Só empresas; órgãos e pessoas físicas ficam de fora.">
          <ListaBarras limite={10} ativo={f.fornecedor} onEscolher={(k) => alternar("fornecedor", k)} corPadrao={DK.purple}
            linhas={fornecedores.map((x) => ({ chave: x.cnpj, nome: x.nome, valor: x.valor, sub: `${x.nes} NEs` }))} />
        </Cartao>
      </div>

      {/* ── Tabela de NEs ── */}
      <Cartao
        titulo={`Notas de empenho (${recortes.length.toLocaleString("pt-BR")})`}
        dica="Clique numa NE para ver os itens, o contrato, a licitação e os lançamentos."
        extra={
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} style={estiloSelect} aria-label="Ordenar">
            <option value="valor">Maior valor</option>
            <option value="emissao">Mais recentes</option>
            <option value="ne">Número da NE</option>
          </select>
        }
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${DK.dim}`, color: DK.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>NE</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Objeto</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Unidade</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Fornecedor</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Contrato / PAG</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>Empenhado</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>Pago</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.slice(0, limite).map((r) => {
                const n = r.nota;
                const v = vinculos.get(n.ne);
                const aberta = abertas.has(n.ne);
                const fr = financeiroDo(r, fin);
                const principal = r.itens.reduce((m, i) => (i.valor > m.valor ? i : m), r.itens[0]);
                return (
                  <Fragment key={n.ne}>
                    <tr
                      onClick={() => setAbertas((s) => { const x = new Set(s); x.has(n.ne) ? x.delete(n.ne) : x.add(n.ne); return x; })}
                      style={{ borderBottom: aberta ? "none" : `1px solid ${DK.grid}`, cursor: "pointer", background: aberta ? `${DK.cyan}0d` : "transparent" }}
                    >
                      <td style={{ padding: "8px", whiteSpace: "nowrap", verticalAlign: "top" }}>
                        <div style={{ fontFamily: "monospace", fontWeight: 700 }}>{aberta ? "▾" : "▸"} {n.ne}</div>
                        <div style={{ fontSize: 10, color: DK.muted }}>{fmtData(n.emissao)}{n.lancamentos.length > 1 ? ` · ${n.lancamentos.length} lanç.` : ""}</div>
                      </td>
                      <td style={{ padding: "8px", verticalAlign: "top", maxWidth: 320 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={principal.nome}>{principal.nome}</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                          <CategoriaTag id={principal.categoria} />
                          {r.itens.length > 1 && <span style={{ fontSize: 10, color: DK.muted }}>+{r.itens.length - 1} {r.itens.length > 2 ? "itens" : "item"}</span>}
                          {r.parcial && <span style={{ fontSize: 10, color: DK.amber }}>{r.itens.length} de {n.itens.length} itens</span>}
                        </div>
                      </td>
                      <td style={{ padding: "8px", verticalAlign: "top", whiteSpace: "nowrap" }}>{omDe(n)}</td>
                      <td style={{ padding: "8px", verticalAlign: "top", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={n.favorecido.nome}>
                        {n.favorecido.nome}
                      </td>
                      <td style={{ padding: "8px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                        {v?.contrato
                          ? <span style={{ color: DK.purple, fontWeight: 600 }}>{v.contrato.numero}</span>
                          : <span style={{ color: DK.muted, fontFamily: "monospace", fontSize: 11 }}>{n.pag || "—"}</span>}
                      </td>
                      <td style={{ padding: "8px", verticalAlign: "top", textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap" }}>{fmtMoeda(r.valor)}</td>
                      <td style={{ padding: "8px", verticalAlign: "top", textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap", color: DK.green }}>
                        {fin.has(n.ne) ? fmtMoeda(fr.pago) : "—"}
                      </td>
                    </tr>
                    {aberta && (
                      <tr style={{ borderBottom: `1px solid ${DK.grid}`, background: `${DK.cyan}08` }}>
                        <td colSpan={7} style={{ padding: "4px 12px 14px" }}>
                          <DetalheNE nota={n} itens={n.itens} recorte={r} vinculo={v} financeiro={fin.get(n.ne) ?? null} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {ordenados.length > limite && (
          <button type="button" onClick={() => setLimite((l) => l + 50)} style={{ ...estiloBotao, marginTop: 10 }}>
            Mostrar mais ({(ordenados.length - limite).toLocaleString("pt-BR")} restantes)
          </button>
        )}
      </Cartao>
    </div>
  );
}

// ─── Detalhe de uma NE ───────────────────────────────────────────────────────

function DetalheNE({ nota: n, itens, recorte, vinculo, financeiro }: {
  nota: NotaEmpenho; itens: ItemEmpenho[]; recorte: Recorte; vinculo: Vinculo | undefined; financeiro: Financeiro | null;
}) {
  const noRecorte = new Set(recorte.itens.map((i) => i.seq));
  const c = vinculo?.contrato;
  const p = vinculo?.processo;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: DK.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <th style={{ textAlign: "left", padding: "4px 6px", width: 60 }}>Item</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>Descrição</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>Categoria</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.seq} style={{ borderTop: `1px solid ${DK.grid}`, opacity: noRecorte.has(i.seq) ? 1 : 0.45 }}>
              <td style={{ padding: "5px 6px", fontFamily: "monospace", verticalAlign: "top" }}>{i.itemCompra ?? i.seq}</td>
              <td style={{ padding: "5px 6px", verticalAlign: "top" }}>{semPrefixo(i.descricao)}</td>
              <td style={{ padding: "5px 6px", verticalAlign: "top" }}><CategoriaTag id={i.categoria} /></td>
              <td style={{ padding: "5px 6px", textAlign: "right", fontFamily: "monospace", verticalAlign: "top", whiteSpace: "nowrap" }}>{fmtMoeda(i.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "10px 18px" }}>
        <Campo rotulo="Unidade">{omDe(n)} · {n.ugNome}</Campo>
        <Campo rotulo="Natureza de despesa">{n.natureza} · {n.naturezaNome}</Campo>
        <Campo rotulo="PI">{n.pi} · {n.piNome}</Campo>
        <Campo rotulo="PAG">{n.pag || "—"}</Campo>
        <Campo rotulo="Fornecedor">
          {n.favorecido.nome}
          {n.favorecido.tipo === "empresa" && n.favorecido.documento ? ` · ${fmtCNPJ(n.favorecido.documento)}` : ""}
        </Campo>
        <Campo rotulo="Solicitação de empenho">{n.solicitacao ?? "—"}</Campo>
        <Campo rotulo="Assinatura">{n.assinada ? "Assinada" : "Pendente"}</Campo>
        <Campo rotulo="Lançamentos">{n.lancamentos.map(fmtData).join(" · ")}</Campo>
        <Campo rotulo="Liquidação e pagamento">
          {financeiro
            ? `A liquidar ${fmtMoeda(financeiro.aLiquidar)} · liquidado a pagar ${fmtMoeda(financeiro.liquidadoPagar)} · pago ${fmtMoeda(financeiro.pago)}`
            : "Sem linha na planilha de situação"}
        </Campo>
      </div>

      {(c || p) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {c && (
            <div style={{ border: `1px solid ${DK.purple}55`, borderRadius: 10, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: DK.purple, textTransform: "uppercase", letterSpacing: "0.06em" }}>Contrato do PAG</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{c.numero}{c.status ? <span style={{ fontWeight: 400, color: DK.muted }}> · {c.status}</span> : null}</div>
              <div style={{ fontSize: 11, color: DK.text, marginTop: 2 }}>{c.objeto || "Objeto não informado"}</div>
              <div style={{ fontSize: 11, color: DK.muted, marginTop: 4 }}>
                {c.fornecedor}{c.valor != null ? ` · ${fmtMoeda(c.valor)}` : ""} · vigência {fmtData(c.inicio)} a {fmtData(c.fim)}
              </div>
            </div>
          )}
          {p && (
            <div style={{ border: `1px solid ${DK.teal}55`, borderRadius: 10, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: DK.teal, textTransform: "uppercase", letterSpacing: "0.06em" }}>Licitação do PAG</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{p.modalidade} {p.numero}{p.situacao ? <span style={{ fontWeight: 400, color: DK.muted }}> · {p.situacao}</span> : null}</div>
              <div style={{ fontSize: 11, color: DK.text, marginTop: 2 }}>{p.objeto}</div>
            </div>
          )}
        </div>
      )}

      {n.observacao && <Campo rotulo="Observação da NE">{n.observacao}</Campo>}
    </div>
  );
}
