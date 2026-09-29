import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  CRITERIO_LABEL, UFS,
  calcularEstatisticas, consultarCatalogo, extrairItensIA, extrairItensRegras, extrairNup,
  extrairItensDaTabela, extrairObjeto, filtrarOutliers, fmtBRL, fmtData, fmtNum, lerPdf, mcpTool,
  normalizarItem, parseNumero, pesquisarPrecosETP, valorPorCriterio,
  type Criterio, type Estatisticas, type ItemCatalogo, type ItemTR, type RegistroPreco,
  type ResultadoETP, type TipoItem,
} from "../lib/mcpCompras";
import type { Trecho } from "../lib/trParser";
import { exportarPdf, exportarXlsx, type CabecalhoRelatorio, type LinhaRelatorio } from "../lib/pesquisaPrecosExport";

// ── Tipos de estado ──────────────────────────────────────────────────────────

type Etapa = "tr" | "itens" | "pesquisa" | "relatorio";
type Status = "pendente" | "carregando" | "ok" | "vazio" | "erro";

interface ResultadoItem {
  status: Status;
  erro?: string;
  etp?: ResultadoETP;
  catalogo?: ItemCatalogo | null;
  criterio: Criterio;
  excluidos: string[];
  unidadeFiltro: string;
  faixa: [number, number] | null;
  justificativa: string;
  aberto: boolean;
}

interface Parametros { periodoMeses: number; uf: string; maxPaginas: number }

interface TrCadastrado { numero_compra: string; pdf_url: string | null; nup: string | null }

const RASCUNHO_KEY = "gapmn:pesquisa-precos:v1";
const CONCORRENCIA = 3;

const ETAPAS: { id: Etapa; label: string; icon: string }[] = [
  { id: "tr",        label: "Termo de Referência", icon: "📄" },
  { id: "itens",     label: "Itens",               icon: "🧾" },
  { id: "pesquisa",  label: "Pesquisa",            icon: "🔎" },
  { id: "relatorio", label: "Relatório",           icon: "📊" },
];

const resultadoVazio = (): ResultadoItem => ({
  status: "pendente", criterio: "mediana", excluidos: [], unidadeFiltro: "",
  faixa: null, justificativa: "", aberto: false,
});

const chaveRegistro = (r: RegistroPreco, i: number) => r.idCompraItem ?? `${r.idCompra ?? "x"}-${i}`;

const unidadeRegistro = (r: RegistroPreco) => {
  const cap = r.capacidadeUnidadeFornecimento;
  return `${r.siglaUnidadeFornecimento ?? "?"}${cap && cap !== 1 ? ` c/ ${fmtNum(cap)}` : ""}`;
};

// ── Avaliação de um item (aplica os ajustes do analista) ─────────────────────

interface Avaliacao {
  estat: Estatisticas | null;
  ajustado: boolean;
  registrosValidos: RegistroPreco[];     // com preço, antes dos ajustes
  considerados: RegistroPreco[];         // após ajustes e descarte de outliers
  limites: [number, number] | null;      // faixa sem outliers
  valorUnitario: number | null;
  valorTotal: number | null;
}

function avaliar(item: ItemTR, res: ResultadoItem | undefined): Avaliacao {
  const vazio: Avaliacao = {
    estat: null, ajustado: false, registrosValidos: [], considerados: [],
    limites: null, valorUnitario: null, valorTotal: null,
  };
  if (!res?.etp) return vazio;

  const registrosValidos = (res.etp.registros ?? []).filter((r) => typeof r.precoUnitario === "number");
  const ajustado = res.excluidos.length > 0 || !!res.unidadeFiltro || !!res.faixa;

  let estat: Estatisticas | null;
  let base: RegistroPreco[];
  if (!ajustado && res.etp.estatisticas) {
    // Sem ajuste: vale a estatística do MCP, calculada sobre a amostra completa.
    estat = {
      ...res.etp.estatisticas,
      n: res.etp.amostra_efetiva ?? res.etp.amostra_total,
      outliers: res.etp.outliers_descartados ?? 0,
    };
    base = registrosValidos;
  } else {
    base = registrosValidos.filter((r, i) =>
      !res.excluidos.includes(chaveRegistro(r, i)) &&
      (!res.unidadeFiltro || unidadeRegistro(r) === res.unidadeFiltro) &&
      (!res.faixa || (r.precoUnitario! >= res.faixa[0] && r.precoUnitario! <= res.faixa[1])));
    estat = calcularEstatisticas(base.map((r) => r.precoUnitario!));
  }

  const { filtrados } = filtrarOutliers(base.map((r) => r.precoUnitario!));
  const limites: [number, number] | null = filtrados.length
    ? [Math.min(...filtrados), Math.max(...filtrados)] : null;
  const considerados = limites
    ? base.filter((r) => r.precoUnitario! >= limites[0] && r.precoUnitario! <= limites[1])
    : [];

  const valorUnitario = estat ? valorPorCriterio(estat, res.criterio) : null;
  const valorTotal = valorUnitario != null && item.quantidade != null ? valorUnitario * item.quantidade : null;
  return { estat, ajustado, registrosValidos, considerados, limites, valorUnitario, valorTotal };
}

// ── Componente ───────────────────────────────────────────────────────────────

export default function PesquisaPrecos() {
  const [etapa, setEtapa] = useState<Etapa>("tr");

  // Cabeçalho / TR
  const [cab, setCab] = useState<CabecalhoRelatorio>({
    objeto: "", nup: "", numeroCompra: "", responsavel: "", periodoMeses: 12, uf: "",
  });
  const [textoTR, setTextoTR] = useState("");
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [lendo, setLendo] = useState<string | null>(null);
  const [erroTR, setErroTR] = useState<string | null>(null);
  const [trsCadastrados, setTrsCadastrados] = useState<TrCadastrado[]>([]);
  const [mostrarTexto, setMostrarTexto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const trechosRef = useRef<Trecho[]>([]);
  const [origemItens, setOrigemItens] = useState("");

  // Itens e pesquisa
  const [itens, setItens] = useState<ItemTR[]>([]);
  const [params, setParams] = useState<Parametros>({ periodoMeses: 12, uf: "", maxPaginas: 5 });
  const [resultados, setResultados] = useState<Record<string, ResultadoItem>>({});
  const [executando, setExecutando] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<"verificando" | "online" | "offline">("verificando");
  const [rascunhoRestaurado, setRascunhoRestaurado] = useState(false);

  // ── Inicialização: rascunho, TRs cadastrados, status do MCP, responsável ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RASCUNHO_KEY);
      if (raw) {
        const r = JSON.parse(raw);
        if (r.itens?.length) {
          setCab(r.cab); setItens(r.itens); setParams(r.params);
          const res: Record<string, ResultadoItem> = r.resultados ?? {};
          for (const k of Object.keys(res)) if (res[k].status === "carregando") res[k].status = "pendente";
          setResultados(res);
          setEtapa(r.etapa === "tr" ? "itens" : r.etapa);
          setRascunhoRestaurado(true);
        }
      }
    } catch { /* rascunho corrompido — ignora */ }

    supabase.from("compras_tr_gap_mn").select("numero_compra, pdf_url, nup")
      .not("pdf_url", "is", null).order("registrado_em", { ascending: false }).limit(200)
      .then(({ data }) => setTrsCadastrados((data as TrCadastrado[]) ?? []));

    mcpTool("compras_versao", {}).then(() => setMcpStatus("online")).catch(() => setMcpStatus("offline"));

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("profiles").select("nome_guerra").eq("id", user.id).maybeSingle()
        .then(({ data }) => {
          const nome = (data as { nome_guerra?: string } | null)?.nome_guerra;
          if (nome) setCab((c) => (c.responsavel ? c : { ...c, responsavel: nome }));
        });
    });
  }, []);

  // Salva rascunho (com fallback sem amostras se estourar a cota do localStorage)
  useEffect(() => {
    if (!itens.length) return;
    const t = setTimeout(() => {
      const snap = { cab, itens, params, resultados, etapa };
      try { localStorage.setItem(RASCUNHO_KEY, JSON.stringify(snap)); }
      catch {
        try { localStorage.setItem(RASCUNHO_KEY, JSON.stringify({ ...snap, resultados: {} })); } catch { /* sem espaço */ }
      }
    }, 600);
    return () => clearTimeout(t);
  }, [cab, itens, params, resultados, etapa]);

  function novaPesquisa() {
    try { localStorage.removeItem(RASCUNHO_KEY); } catch { /* ok */ }
    setCab((c) => ({ objeto: "", nup: "", numeroCompra: "", responsavel: c.responsavel, periodoMeses: 12, uf: "" }));
    setTextoTR(""); setNomeArquivo(""); setItens([]); setResultados({});
    setRascunhoRestaurado(false); setEtapa("tr");
  }

  // ── Etapa 1: leitura do TR ──
  async function carregarTexto(texto: string, origem: string) {
    setTextoTR(texto);
    setNomeArquivo(origem);
    setCab((c) => ({
      ...c,
      objeto: c.objeto || extrairObjeto(texto),
      nup: c.nup || extrairNup(texto),
    }));
  }

  async function lerArquivo(file: File) {
    setErroTR(null);
    setLendo("Lendo arquivo…");
    try {
      const { texto, trechos } = file.name.toLowerCase().endsWith(".pdf")
        ? await lerPdf(await file.arrayBuffer())
        : { texto: await file.text(), trechos: [] as Trecho[] };
      if (texto.trim().length < 50) throw new Error("Não foi possível ler texto do arquivo (PDF digitalizado sem OCR?). Cole o texto manualmente.");
      trechosRef.current = trechos;
      await carregarTexto(texto, file.name);
    } catch (e) {
      setErroTR((e as Error).message);
    } finally { setLendo(null); }
  }

  async function lerTrCadastrado(numeroCompra: string) {
    const tr = trsCadastrados.find((t) => t.numero_compra === numeroCompra);
    if (!tr?.pdf_url) return;
    setErroTR(null);
    setLendo(`Baixando TR da compra ${numeroCompra}…`);
    try {
      const res = await fetch(tr.pdf_url);
      if (!res.ok) throw new Error(`Falha ao baixar o PDF (HTTP ${res.status})`);
      const { texto, trechos } = await lerPdf(await res.arrayBuffer());
      trechosRef.current = trechos;
      setCab((c) => ({ ...c, numeroCompra, nup: c.nup || tr.nup || "" }));
      await carregarTexto(texto, `TR da compra ${numeroCompra}`);
    } catch (e) {
      setErroTR((e as Error).message);
    } finally { setLendo(null); }
  }

  /**
   * "auto": 1º a tabela do PDF (lida pela posição do texto — exata para o modelo
   * de TR com colunas Item/Especificação/CATMAT/Unidade/Quantidade), depois IA,
   * por fim as regras por código.
   */
  async function extrair(modo: "auto" | "ia" | "regras") {
    setErroTR(null);
    if (modo === "auto") {
      const daTabela = extrairItensDaTabela(trechosRef.current);
      if (daTabela.length) {
        definirItens(daTabela, `${daTabela.length} itens lidos da tabela do TR (colunas Item, Especificação, código, Unidade, Quantidade e Valor Unitário).`);
        return;
      }
    }
    if (modo === "regras") {
      const achados = extrairItensRegras(textoTR);
      if (!achados.length) { setErroTR("Nenhum código CATMAT/CATSER encontrado no texto. Tente a extração com IA ou cadastre os itens manualmente."); return; }
      definirItens(achados, `${achados.length} itens encontrados pelos códigos CATMAT/CATSER no texto — revise descrições e quantidades.`);
      return;
    }
    setLendo(modo === "auto" ? "Tabela de itens não reconhecida — extraindo com IA…" : "Extraindo itens com IA…");
    try {
      const { objeto, itens: achados } = await extrairItensIA(textoTR);
      if (objeto && !cab.objeto) setCab((c) => ({ ...c, objeto }));
      if (!achados.length) throw new Error("A IA não encontrou itens no texto.");
      definirItens(achados, `${achados.length} itens extraídos com IA — confira código, unidade e quantidade de cada um.`);
    } catch (e) {
      const porRegras = extrairItensRegras(textoTR);
      if (porRegras.length) {
        definirItens(porRegras, `IA indisponível (${(e as Error).message}). ${porRegras.length} itens extraídos pelos códigos no texto — revise com atenção.`);
      } else {
        setErroTR((e as Error).message);
      }
    } finally { setLendo(null); }
  }

  function definirItens(novos: ItemTR[], origem: string) {
    setOrigemItens(origem);
    setItens(novos);
    setResultados({});
    setEtapa("itens");
  }

  // ── Etapa 2: edição de itens ──
  function atualizarItem(id: string, patch: Partial<ItemTR>) {
    setItens((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if ("codigo" in patch || "tipo" in patch) {
      setResultados((r) => { const n = { ...r }; delete n[id]; return n; });
    }
  }
  function adicionarItem() {
    setItens((xs) => [...xs, normalizarItem({
      numero: (xs[xs.length - 1]?.numero ?? 0) + 1, tipo: "material", codigo: null, descricao: "", unidade: "", quantidade: null, valorReferencia: null,
    })]);
  }
  function removerItem(id: string) {
    setItens((xs) => xs.filter((x) => x.id !== id));
    setResultados((r) => { const n = { ...r }; delete n[id]; return n; });
  }

  // ── Etapa 3: pesquisa ──
  function patchResultado(id: string, patch: Partial<ResultadoItem>) {
    setResultados((r) => ({ ...r, [id]: { ...(r[id] ?? resultadoVazio()), ...patch } }));
  }

  async function pesquisarItem(item: ItemTR, override?: Partial<Parametros>) {
    const p = { ...params, ...override };
    if (!item.codigo) {
      patchResultado(item.id, { status: "erro", erro: "Informe o código CATMAT/CATSER do item." });
      return;
    }
    patchResultado(item.id, { status: "carregando", erro: undefined });
    const [precos, catalogo] = await Promise.allSettled([
      pesquisarPrecosETP({ tipo: item.tipo, codigo: item.codigo, periodoMeses: p.periodoMeses, uf: p.uf || undefined, maxPaginas: p.maxPaginas }),
      consultarCatalogo(item.tipo, item.codigo),
    ]);
    const cat = catalogo.status === "fulfilled" ? catalogo.value : undefined;
    if (precos.status === "rejected") {
      patchResultado(item.id, { status: "erro", erro: (precos.reason as Error).message, catalogo: cat });
      return;
    }
    const etp = precos.value;
    const status: Status = etp._erro_upstream ? "erro" : etp.amostra_total > 0 ? "ok" : "vazio";
    patchResultado(item.id, {
      status, etp, catalogo: cat,
      erro: etp._erro_upstream?.diagnostico,
      excluidos: [], unidadeFiltro: "", faixa: null,
    });
  }

  async function pesquisarTodos(somentePendentes = false) {
    const fila = itens.filter((it) => !somentePendentes || !["ok", "vazio"].includes(resultados[it.id]?.status ?? ""));
    if (!fila.length) return;
    setCab((c) => ({ ...c, periodoMeses: params.periodoMeses, uf: params.uf }));
    setEtapa("pesquisa");
    setExecutando(true);
    let idx = 0;
    const worker = async () => { while (idx < fila.length) await pesquisarItem(fila[idx++]); };
    await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, fila.length) }, worker));
    setExecutando(false);
  }

  // ── Derivados ──
  const avaliacoes = useMemo(() => {
    const m: Record<string, Avaliacao> = {};
    for (const it of itens) m[it.id] = avaliar(it, resultados[it.id]);
    return m;
  }, [itens, resultados]);

  const linhasRelatorio: LinhaRelatorio[] = itens.map((it) => {
    const a = avaliacoes[it.id];
    const r = resultados[it.id] ?? resultadoVazio();
    return {
      item: it, estat: a.estat, amostraTotal: r.etp?.amostra_total ?? 0, criterio: r.criterio,
      valorUnitario: a.valorUnitario, valorTotal: a.valorTotal, ajustado: a.ajustado,
      justificativa: r.justificativa, registros: [...a.considerados].sort((x, y) => x.precoUnitario! - y.precoUnitario!),
    };
  });
  const totalEstimado = linhasRelatorio.reduce((s, l) => s + (l.valorTotal ?? 0), 0);
  const concluidos = itens.filter((it) => ["ok", "vazio", "erro"].includes(resultados[it.id]?.status ?? "")).length;
  const pendencias = linhasRelatorio.filter((l) => !l.estat || l.estat.n < 3 || l.item.quantidade == null);

  // ── Render ──
  return (
    <div className="p-5 md:p-6 space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Pesquisa de Preços a partir do TR</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Preços praticados no Compras.gov.br via MCP Compras — metodologia IN SEGES/ME nº 65/2021
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
            mcpStatus === "online" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : mcpStatus === "offline" ? "bg-red-50 text-red-700 border-red-200"
            : "bg-slate-100 text-slate-500 border-slate-200"}`}>
            {mcpStatus === "online" ? "● MCP online" : mcpStatus === "offline" ? "● MCP indisponível" : "○ verificando MCP…"}
          </span>
          {itens.length > 0 && (
            <button onClick={novaPesquisa}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
              Nova pesquisa
            </button>
          )}
        </div>
      </div>

      {rascunhoRestaurado && (
        <div className="text-xs rounded-lg border border-sky-200 bg-sky-50 text-sky-700 px-3 py-2">
          Rascunho anterior restaurado neste navegador. Use "Nova pesquisa" para começar do zero.
        </div>
      )}

      {/* Stepper */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {ETAPAS.map((e, i) => {
          const ativo = etapa === e.id;
          const liberado = e.id === "tr" || itens.length > 0;
          return (
            <button key={e.id} disabled={!liberado} onClick={() => setEtapa(e.id)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-all ${
                ativo ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"
              } ${liberado ? "" : "opacity-40 cursor-not-allowed"}`}>
              <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                ativo ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-500"}`}>{i + 1}</span>
              <span className={`text-sm font-semibold ${ativo ? "text-sky-700" : "text-slate-600"}`}>
                {e.icon} {e.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ═════════ Etapa 1 — TR ═════════ */}
      {etapa === "tr" && (
        <div className="grid lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3 space-y-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) lerArquivo(f); }}
              onClick={() => fileRef.current?.click()}
              className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-sky-50 p-8 text-center transition-all">
              <div className="text-4xl mb-2">📄</div>
              <div className="text-sm font-semibold text-slate-700">Arraste o PDF do Termo de Referência ou clique para selecionar</div>
              <div className="text-xs text-slate-500 mt-1">PDF com texto (não digitalizado) ou .txt</div>
              <input ref={fileRef} type="file" accept=".pdf,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) lerArquivo(f); e.target.value = ""; }} />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <label className="text-xs font-semibold text-slate-500">Ou use um TR já cadastrado (Atas de RP)</label>
                <select className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  value="" onChange={(e) => e.target.value && lerTrCadastrado(e.target.value)}>
                  <option value="">{trsCadastrados.length ? "Selecione a compra…" : "Nenhum TR cadastrado"}</option>
                  {trsCadastrados.map((t) => (
                    <option key={t.numero_compra} value={t.numero_compra}>
                      Compra {t.numero_compra}{t.nup ? ` — NUP ${t.nup}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <label className="text-xs font-semibold text-slate-500">Ou cole o texto do TR</label>
                <button onClick={() => setMostrarTexto((v) => !v)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                  {mostrarTexto ? "Ocultar editor de texto" : "Abrir editor de texto"}
                </button>
              </div>
            </div>

            {mostrarTexto && (
              <textarea value={textoTR} onChange={(e) => { setTextoTR(e.target.value); setNomeArquivo("texto colado"); trechosRef.current = []; }}
                rows={10} placeholder="Cole aqui o texto do TR (ao menos a tabela de itens com os códigos CATMAT/CATSER)…"
                className="w-full rounded-xl border border-slate-200 p-3 text-xs font-mono" />
            )}

            {lendo && <div className="text-sm text-sky-700 animate-pulse">⏳ {lendo}</div>}
            {erroTR && <div className="text-sm rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2">{erroTR}</div>}

            {textoTR && !lendo && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                <div className="text-sm text-emerald-700 font-semibold">
                  ✓ {nomeArquivo} — {fmtNum(textoTR.length, 0)} caracteres lidos
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => extrair("auto")}
                    className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold">
                    📋 Extrair itens do TR
                  </button>
                  <button onClick={() => extrair("ia")}
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700">
                    ✨ Usar IA
                  </button>
                  <button onClick={() => extrair("regras")}
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700">
                    Só pelos códigos
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  Lê a tabela de itens do TR (Item, Especificação, CATMAT/CATSER, Unidade, Quantidade e Valor Unitário).
                  Se o PDF não tiver essa tabela, usa IA automaticamente. Em qualquer caso você revisa tudo na próxima etapa.
                </p>
              </div>
            )}

            <button onClick={() => { if (!itens.length) adicionarItem(); setEtapa("itens"); }}
              className="text-xs text-slate-500 underline hover:text-slate-700">
              Não tenho o TR em arquivo — cadastrar os itens manualmente
            </button>
          </div>

          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 space-y-3 h-fit">
            <div className="text-sm font-bold text-slate-700">Dados da contratação</div>
            <Campo label="Objeto">
              <textarea rows={3} value={cab.objeto} onChange={(e) => setCab({ ...cab, objeto: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Processo (NUP)">
                <input value={cab.nup} onChange={(e) => setCab({ ...cab, nup: e.target.value })}
                  placeholder="00000.000000/2026-00" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
              </Campo>
              <Campo label="Nº da compra">
                <input value={cab.numeroCompra} onChange={(e) => setCab({ ...cab, numeroCompra: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
              </Campo>
            </div>
            <Campo label="Responsável pela pesquisa">
              <input value={cab.responsavel} onChange={(e) => setCab({ ...cab, responsavel: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </Campo>
          </div>
        </div>
      )}

      {/* ═════════ Etapa 2 — Itens ═════════ */}
      {etapa === "itens" && (
        <div className="space-y-4">
          {origemItens && (
            <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 flex items-start gap-2">
              <span className="flex-1">✓ {origemItens}</span>
              <button onClick={() => setOrigemItens("")} className="font-bold">×</button>
            </div>
          )}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="px-3 py-2 w-14">Item</th>
                  <th className="px-3 py-2 w-32">Tipo</th>
                  <th className="px-3 py-2 w-32">Código</th>
                  <th className="px-3 py-2">Descrição (TR)</th>
                  <th className="px-3 py-2 w-24">Unidade</th>
                  <th className="px-3 py-2 w-28">Quantidade</th>
                  <th className="px-3 py-2 w-28" title="Valor unitário estimado que consta no TR — usado só para comparação">Vlr. unit. TR</th>
                  <th className="px-3 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {itens.map((it) => (
                  <tr key={it.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <input type="number" value={it.numero} onChange={(e) => atualizarItem(it.id, { numero: Number(e.target.value) || 0 })}
                        className="w-12 rounded border border-slate-200 px-1.5 py-1 text-sm" />
                    </td>
                    <td className="px-3 py-2">
                      <select value={it.tipo} onChange={(e) => atualizarItem(it.id, { tipo: e.target.value as TipoItem })}
                        className="w-full rounded border border-slate-200 px-1.5 py-1 text-sm">
                        <option value="material">Material (CATMAT)</option>
                        <option value="servico">Serviço (CATSER)</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input value={it.codigo ?? ""} placeholder="ex.: 461864"
                        onChange={(e) => atualizarItem(it.id, { codigo: Number(e.target.value.replace(/\D/g, "")) || null })}
                        className={`w-full rounded border px-1.5 py-1 text-sm ${it.codigo ? "border-slate-200" : "border-amber-300"}`} />
                    </td>
                    <td className="px-3 py-2">
                      <textarea rows={2} value={it.descricao} onChange={(e) => atualizarItem(it.id, { descricao: e.target.value })}
                        className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={it.unidade} onChange={(e) => atualizarItem(it.id, { unidade: e.target.value })}
                        className="w-full rounded border border-slate-200 px-1.5 py-1 text-sm" />
                    </td>
                    <td className="px-3 py-2">
                      <CampoNumero valor={it.quantidade} onChange={(v) => atualizarItem(it.id, { quantidade: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <CampoNumero valor={it.valorReferencia ?? null} moeda
                        onChange={(v) => atualizarItem(it.id, { valorReferencia: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => removerItem(it.id)} title="Remover item"
                        className="w-7 h-7 rounded-lg text-red-600 hover:bg-red-50">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2">
              <button onClick={adicionarItem} className="text-sm text-sky-700 hover:underline">+ Adicionar item</button>
            </div>
          </div>

          {itens.some((i) => !i.codigo) && (
            <div className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-700 px-3 py-2">
              Itens sem código CATMAT/CATSER não podem ser pesquisados. Consulte o código no catálogo do Compras.gov.br
              (catalogo.compras.gov.br) e informe-o na tabela.
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-end gap-4">
            <Campo label="Período da pesquisa">
              <select value={params.periodoMeses} onChange={(e) => setParams({ ...params, periodoMeses: Number(e.target.value) })}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                {[6, 12, 18, 24].map((m) => <option key={m} value={m}>Últimos {m} meses{m === 12 ? " (recomendado)" : ""}</option>)}
              </select>
            </Campo>
            <Campo label="Abrangência">
              <select value={params.uf} onChange={(e) => setParams({ ...params, uf: e.target.value })}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                <option value="">Nacional</option>
                {UFS.map((u) => <option key={u} value={u}>Somente {u}</option>)}
              </select>
            </Campo>
            <Campo label="Profundidade">
              <select value={params.maxPaginas} onChange={(e) => setParams({ ...params, maxPaginas: Number(e.target.value) })}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                <option value={1}>Rápida (até 500 compras)</option>
                <option value={5}>Padrão (até 2.500)</option>
                <option value={10}>Ampla (até 5.000)</option>
              </select>
            </Campo>
            <div className="flex-1" />
            <button disabled={!itens.some((i) => i.codigo) || executando} onClick={() => pesquisarTodos()}
              className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold disabled:opacity-40">
              🔎 Pesquisar preços ({itens.filter((i) => i.codigo).length} {itens.filter((i) => i.codigo).length === 1 ? "item" : "itens"})
            </button>
          </div>
        </div>
      )}

      {/* ═════════ Etapa 3 — Pesquisa ═════════ */}
      {etapa === "pesquisa" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-slate-600">
              {executando ? "⏳ Pesquisando…" : "Pesquisa concluída"} — {concluidos}/{itens.length} itens
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden min-w-[120px]">
              <div className="h-full bg-sky-600 transition-all" style={{ width: `${itens.length ? (concluidos / itens.length) * 100 : 0}%` }} />
            </div>
            {!executando && (
              <>
                <button onClick={() => pesquisarTodos(true)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
                  Pesquisar pendentes
                </button>
                <button onClick={() => setEtapa("relatorio")} className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold">
                  Ver relatório →
                </button>
              </>
            )}
          </div>

          {itens.map((it) => (
            <CartaoItem key={it.id} item={it} res={resultados[it.id] ?? resultadoVazio()} av={avaliacoes[it.id]}
              uf={params.uf} periodo={params.periodoMeses}
              onPatch={(p) => patchResultado(it.id, p)}
              onRefazer={(o) => pesquisarItem(it, o)} />
          ))}
        </div>
      )}

      {/* ═════════ Etapa 4 — Relatório ═════════ */}
      {etapa === "relatorio" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Itens" valor={String(itens.length)} />
            <Kpi label="Com preço estimado" valor={`${linhasRelatorio.filter((l) => l.valorUnitario != null).length}/${itens.length}`} />
            <Kpi label="Preços considerados" valor={fmtNum(linhasRelatorio.reduce((s, l) => s + (l.estat?.n ?? 0), 0), 0)} />
            <Kpi label="Valor total estimado" valor={fmtBRL(totalEstimado)} destaque />
          </div>

          {pendencias.length > 0 && (
            <div className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-700 px-3 py-2 space-y-0.5">
              <div className="font-semibold">Pontos de atenção antes de juntar ao processo:</div>
              {pendencias.map((l) => (
                <div key={l.item.id}>
                  • Item {l.item.numero}: {!l.estat ? "sem preço estimado"
                    : l.estat.n < 3 ? `apenas ${l.estat.n} preço(s) — abaixo do mínimo de 3 (art. 6º); complemente com outras fontes`
                    : "quantidade não informada"}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2 text-right">Qtd.</th>
                  <th className="px-3 py-2 text-right">Amostra</th>
                  <th className="px-3 py-2">Critério</th>
                  <th className="px-3 py-2 text-right">Vlr. unit. TR</th>
                  <th className="px-3 py-2 text-right">Vlr. unitário</th>
                  <th className="px-3 py-2 text-right">Vlr. total</th>
                </tr>
              </thead>
              <tbody>
                {linhasRelatorio.map((l) => (
                  <tr key={l.item.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">{l.item.numero}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{l.item.tipo === "material" ? "CATMAT" : "CATSER"} {l.item.codigo ?? "–"}</td>
                    <td className="px-3 py-2 text-xs max-w-md">{l.item.descricao}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{fmtNum(l.item.quantidade)} {l.item.unidade}</td>
                    <td className="px-3 py-2 text-right">{l.estat ? `${l.estat.n}/${l.amostraTotal}${l.ajustado ? "*" : ""}` : "–"}</td>
                    <td className="px-3 py-2 text-xs">{CRITERIO_LABEL[l.criterio]}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-xs text-slate-500">
                      {fmtBRL(l.item.valorReferencia)}
                      {l.item.valorReferencia != null && l.valorUnitario != null && <div>{variacao(l.valorUnitario, l.item.valorReferencia)}</div>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{fmtBRL(l.valorUnitario)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">{fmtBRL(l.valorTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} className="px-3 py-3 text-right font-bold text-slate-700">VALOR TOTAL ESTIMADO</td>
                  <td className="px-3 py-3 text-right font-bold text-emerald-700 whitespace-nowrap">{fmtBRL(totalEstimado)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={() => exportarPdf(cab, linhasRelatorio)}
              className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold">
              ⬇ Relatório em PDF
            </button>
            <button onClick={() => exportarXlsx(cab, linhasRelatorio)}
              className="px-5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-bold text-slate-700">
              ⬇ Planilha XLSX (resumo + amostras)
            </button>
          </div>
          <p className="text-xs text-slate-500">
            O relatório traz metodologia (arts. 5º e 6º da IN SEGES/ME 65/2021), resumo estatístico por item, justificativas
            de ajustes e o anexo com cada preço considerado (UASG, fornecedor, marca, data). Confira os dados do cabeçalho na etapa 1.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Cartão de resultado por item ─────────────────────────────────────────────

function CartaoItem({ item, res, av, uf, periodo, onPatch, onRefazer }: {
  item: ItemTR;
  res: ResultadoItem;
  av: Avaliacao;
  uf: string;
  periodo: number;
  onPatch: (p: Partial<ResultadoItem>) => void;
  onRefazer: (o?: Partial<Parametros>) => void;
}) {
  const { estat, ajustado, registrosValidos, limites } = av;
  const unidades = useMemo(() => {
    const cont = new Map<string, number>();
    for (const r of registrosValidos) cont.set(unidadeRegistro(r), (cont.get(unidadeRegistro(r)) ?? 0) + 1);
    return [...cont.entries()].sort((a, b) => b[1] - a[1]);
  }, [registrosValidos]);

  const chip = {
    pendente:   ["bg-slate-100 text-slate-500", "aguardando"],
    carregando: ["bg-sky-100 text-sky-700 animate-pulse", "pesquisando…"],
    ok:         ["bg-emerald-100 text-emerald-700", "ok"],
    vazio:      ["bg-amber-100 text-amber-700", "sem preços"],
    erro:       ["bg-red-100 text-red-700", "erro"],
  }[res.status];

  const catalogoDesc = res.catalogo?.descricaoItem ?? res.catalogo?.descricaoServico ?? res.catalogo?.nomeServico;
  const truncado = (res.etp?.amostra_total ?? 0) > registrosValidos.length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-700">
            {item.numero}
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="text-sm font-semibold text-slate-800">{item.descricao || "(sem descrição)"}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {item.tipo === "material" ? "CATMAT" : "CATSER"} {item.codigo ?? "–"} · {fmtNum(item.quantidade)} {item.unidade}
              {res.catalogo?.nomePdm && <> · PDM {res.catalogo.nomePdm}</>}
            </div>
            {catalogoDesc && (
              <div className="text-xs text-slate-400 mt-1">Catálogo: {catalogoDesc}</div>
            )}
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${chip[0]}`}>{chip[1]}</span>
        </div>

        {res.status === "erro" && (
          <div className="text-xs rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2">
            {res.erro}
            {res.etp?._erro_upstream?.alternativas && (
              <ul className="mt-1 list-disc pl-4">{res.etp._erro_upstream.alternativas.map((a) => <li key={a}>{a}</li>)}</ul>
            )}
          </div>
        )}

        {res.status === "vazio" && (
          <div className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-700 px-3 py-2 flex flex-wrap items-center gap-2">
            <span>Nenhum preço para este código no período{uf ? ` em ${uf}` : ""}.</span>
            {uf && <button onClick={() => onRefazer({ uf: "" })} className="underline font-semibold">Pesquisar em âmbito nacional</button>}
            {periodo < 24 && <button onClick={() => onRefazer({ periodoMeses: 24 })} className="underline font-semibold">Ampliar para 24 meses</button>}
            <span>Confira também se o código está correto.</span>
          </div>
        )}

        {estat && (
          <>
            <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
              <Mini label="Amostra" valor={`${estat.n}/${res.etp?.amostra_total ?? 0}`} alerta={estat.n < 3} />
              <Mini label="Outliers" valor={String(estat.outliers)} />
              <Mini label="Mínimo" valor={fmtBRL(estat.minimo)} />
              <Mini label="Mediana" valor={fmtBRL(estat.mediana)} ativo={res.criterio === "mediana"} />
              <Mini label="Média" valor={fmtBRL(estat.media)} ativo={res.criterio === "media"} />
              <Mini label="Máximo" valor={fmtBRL(estat.maximo)} />
              <Mini label="CV" valor={`${fmtNum(estat.coeficiente_variacao * 100, 1)}%`} alerta={estat.coeficiente_variacao > 0.5} />
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <Campo label="Critério (art. 6º)">
                <select value={res.criterio} onChange={(e) => onPatch({ criterio: e.target.value as Criterio })}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                  {(Object.keys(CRITERIO_LABEL) as Criterio[]).map((c) => <option key={c} value={c}>{CRITERIO_LABEL[c]}</option>)}
                </select>
              </Campo>
              {unidades.length > 1 && (
                <Campo label="Unidade de fornecimento">
                  <select value={res.unidadeFiltro} onChange={(e) => onPatch({ unidadeFiltro: e.target.value })}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                    <option value="">Todas ({registrosValidos.length})</option>
                    {unidades.map(([u, n]) => <option key={u} value={u}>{u} ({n})</option>)}
                  </select>
                </Campo>
              )}
              <div className="flex-1" />
              <div className="text-right">
                <div className="text-xs text-slate-500">Valor unitário estimado</div>
                <div className="text-lg font-bold text-emerald-700">{fmtBRL(av.valorUnitario)}</div>
                {av.valorTotal != null && <div className="text-xs text-slate-500">Total: {fmtBRL(av.valorTotal)}</div>}
                {item.valorReferencia != null && av.valorUnitario != null && (
                  <div className={`text-xs ${Math.abs(av.valorUnitario / item.valorReferencia - 1) > 0.25 ? "text-amber-700" : "text-slate-500"}`}>
                    TR: {fmtBRL(item.valorReferencia)} ({variacao(av.valorUnitario, item.valorReferencia)})
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {res.etp?.aviso_heterogeneidade && res.etp.clusters && (
          <div className="text-xs rounded-lg border border-violet-200 bg-violet-50 text-violet-700 px-3 py-2 space-y-2">
            <div>
              <b>Amostra heterogênea:</b> o mesmo código reúne produtos com faixas de preço bem diferentes. Compare a
              descrição do catálogo com a especificação do TR e, se for o caso, restrinja à faixa compatível (ajuste motivado).
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => onPatch({ faixa: null })}
                className={`px-2.5 py-1 rounded-lg border ${!res.faixa ? "border-violet-300 bg-violet-100 font-semibold" : "border-violet-200"}`}>
                Todas as faixas
              </button>
              {res.etp.clusters.map((c, i) => {
                const sel = res.faixa?.[0] === c.minimo && res.faixa?.[1] === c.maximo;
                return (
                  <button key={i} onClick={() => onPatch({ faixa: [c.minimo, c.maximo] })}
                    className={`px-2.5 py-1 rounded-lg border ${sel ? "border-violet-300 bg-violet-100 font-semibold" : "border-violet-200"}`}>
                    {fmtBRL(c.minimo)} – {fmtBRL(c.maximo)} (n={c.n})
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {ajustado && (
          <div className="text-xs rounded-lg border border-sky-200 bg-sky-50 text-sky-700 px-3 py-2 space-y-2">
            <div>
              Amostra ajustada manualmente — estatística recalculada sobre {registrosValidos.length} registros retornados
              {truncado ? ` (de ${res.etp?.amostra_total} encontrados)` : ""}. Justifique o ajuste para o relatório.
              <button onClick={() => onPatch({ excluidos: [], unidadeFiltro: "", faixa: null })} className="ml-2 underline font-semibold">
                Desfazer ajustes
              </button>
            </div>
            <textarea rows={2} value={res.justificativa} onChange={(e) => onPatch({ justificativa: e.target.value })}
              placeholder="Ex.: excluídos preços em embalagem com 100 unidades, incompatíveis com a unidade do TR."
              className="w-full rounded-lg border border-sky-200 px-2 py-1.5 text-xs" />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {registrosValidos.length > 0 && (
            <button onClick={() => onPatch({ aberto: !res.aberto })}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
              {res.aberto ? "Ocultar preços" : `Ver ${registrosValidos.length} preços encontrados`}
            </button>
          )}
          {res.status !== "carregando" && (
            <button onClick={() => onRefazer()} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
              ↻ Refazer pesquisa
            </button>
          )}
          {!ajustado && res.status === "ok" && (
            <button onClick={() => onPatch({ aberto: true })}
              className="text-xs text-slate-400 hover:text-slate-600">
              Para excluir preços inconsistentes, desmarque-os na lista
            </button>
          )}
        </div>
      </div>

      {res.aberto && registrosValidos.length > 0 && (
        <div className="border-t border-slate-200 overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-slate-500">
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">UASG / Órgão</th>
                <th className="px-3 py-2">UF</th>
                <th className="px-3 py-2">Fornecedor</th>
                <th className="px-3 py-2">Marca</th>
                <th className="px-3 py-2">Unid. forn.</th>
                <th className="px-3 py-2 text-right">Qtd.</th>
                <th className="px-3 py-2 text-right">Preço unit.</th>
              </tr>
            </thead>
            <tbody>
              {registrosValidos
                .map((r, i) => ({ r, k: chaveRegistro(r, i) }))
                .sort((a, b) => a.r.precoUnitario! - b.r.precoUnitario!)
                .map(({ r, k }) => {
                  const excluido = res.excluidos.includes(k);
                  const foraFiltro = (!!res.unidadeFiltro && unidadeRegistro(r) !== res.unidadeFiltro) ||
                    (!!res.faixa && (r.precoUnitario! < res.faixa[0] || r.precoUnitario! > res.faixa[1]));
                  const outlier = !excluido && !foraFiltro && limites != null &&
                    (r.precoUnitario! < limites[0] || r.precoUnitario! > limites[1]);
                  return (
                    <tr key={k} className={`border-t border-slate-100 ${excluido || foraFiltro ? "opacity-40" : ""}`}
                      title={r.descricaoDetalhadaItem ?? r.descricaoItem}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={!excluido} disabled={foraFiltro}
                          onChange={() => onPatch({
                            excluidos: excluido ? res.excluidos.filter((x) => x !== k) : [...res.excluidos, k],
                          })} />
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{fmtData(r.dataResultado ?? r.dataCompra)}</td>
                      <td className="px-3 py-1.5">{r.codigoUasg} — {r.nomeUasg ?? r.nomeOrgao}</td>
                      <td className="px-3 py-1.5">{r.estado}</td>
                      <td className="px-3 py-1.5">{r.nomeFornecedor}</td>
                      <td className="px-3 py-1.5">{r.marca}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{unidadeRegistro(r)}</td>
                      <td className="px-3 py-1.5 text-right">{fmtNum(r.quantidade)}</td>
                      <td className={`px-3 py-1.5 text-right whitespace-nowrap font-semibold ${outlier ? "text-amber-700" : ""}`}>
                        {fmtBRL(r.precoUnitario)}{outlier && <span className="ml-1 font-normal">(outlier)</span>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Pequenos componentes de UI ───────────────────────────────────────────────

/** Diferença do preço pesquisado em relação ao valor do TR, ex.: "+12,4% vs TR". */
function variacao(pesquisado: number, tr: number) {
  const p = (pesquisado / tr - 1) * 100;
  return `${p >= 0 ? "+" : ""}${fmtNum(p, 1)}% vs TR`;
}

/** Número no formato brasileiro: guarda o texto enquanto digita, converte ao sair do campo. */
function CampoNumero({ valor, onChange, moeda }: { valor: number | null; onChange: (v: number | null) => void; moeda?: boolean }) {
  const formatar = (v: number | null) =>
    v == null ? "" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: moeda ? 4 : 3, minimumFractionDigits: moeda ? 2 : 0 }).format(v);
  const [texto, setTexto] = useState(formatar(valor));
  const [editando, setEditando] = useState(false);
  return (
    <input value={editando ? texto : formatar(valor)} inputMode="decimal" placeholder={moeda ? "R$" : ""}
      onFocus={() => { setTexto(formatar(valor)); setEditando(true); }}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => { setEditando(false); onChange(parseNumero(texto.replace(/R\$\s*/i, ""))); }}
      className="w-full rounded border border-slate-200 px-1.5 py-1 text-sm" />
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Mini({ label, valor, ativo, alerta }: { label: string; valor: string; ativo?: boolean; alerta?: boolean }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${ativo ? "border-emerald-200 bg-emerald-50" : alerta ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-sm font-semibold ${ativo ? "text-emerald-700" : alerta ? "text-amber-700" : "text-slate-800"}`}>{valor}</div>
    </div>
  );
}

function Kpi({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${destaque ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-bold mt-1 ${destaque ? "text-emerald-700" : "text-slate-800"}`}>{valor}</div>
    </div>
  );
}
