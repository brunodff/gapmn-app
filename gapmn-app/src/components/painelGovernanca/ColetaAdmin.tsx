// Coleta mensal dos indicadores — tela de quem administra (ADMIN e DEV), dentro do Painel de Governança.
// Abre e encerra a competência, entrega o link para o grupo, acompanha o preenchimento por divisão
// (com justificativas, comprovantes e histórico de alterações) e baixa a planilha consolidada.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, ExternalLink, Lock, RefreshCw, Unlock } from "lucide-react";
import { fmtValor } from "../../lib/indicadores/formato.ts";
import { DIVISOES, competenciaExtenso, competenciaPadrao, nomeSecao } from "../../lib/governanca/cadastros.ts";
import {
  abrirColeta, fecharColeta, lerDadosColeta, linkDoFormulario, trocarLink, urlDoAnexo, type DadosColeta,
} from "../../lib/governanca/coleta.ts";
import { baixarPlanilha, classificar } from "../../lib/governanca/exportar.ts";
import { cobradoEm, type CompetenciaAdmin, type HistoricoGov, type IndicadorGov, type LancamentoAdmin } from "../../lib/governanca/tipos.ts";

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const rotuloDe = (codigo: string) => `${MESES[Number(codigo.slice(5, 7)) - 1]}/${codigo.slice(2, 4)}`;
const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Manaus", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const dataBR = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

const COR_STATUS: Record<string, string> = { "Adequado": "var(--ok)", "Atenção": "var(--atencao)", "Crítico": "var(--critico)" };

/** Últimos 14 meses (do mais novo ao mais antigo), para escolher a competência a abrir. */
function opcoesDeMes(hoje = new Date()): string[] {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + 1 - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

export default function ColetaAdmin() {
  const [dados, setDados] = useState<DadosColeta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mesNovo, setMesNovo] = useState(competenciaPadrao());
  const [prazo, setPrazo] = useState("");
  const [vendo, setVendo] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const d = await lerDadosColeta();
      setDados(d);
      setErro(null);
      const aberta = d.competencias.find((c) => c.aberta);
      setVendo((v) => v ?? aberta?.codigo ?? d.competencias[0]?.codigo ?? null);
      // com uma coleta aberta, o campo de mês começa nela (o botão vira "Atualizar prazo")
      setMesNovo((m) => (aberta && m === competenciaPadrao() ? aberta.codigo : m));
      setPrazo((p) => (aberta && !p ? aberta.prazo ?? "" : p));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function acao(nome: string, fn: () => Promise<void>) {
    setOcupado(nome);
    setErro(null);
    setAviso(null);
    try { await fn(); await carregar(); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); } finally { setOcupado(null); }
  }

  const atual = dados?.competencias.find((c) => c.aberta) ?? null;
  const link = atual?.token ? linkDoFormulario(atual.token) : null;
  const mensagemGrupo = atual && link
    ? `Senhores gestores, está aberto o preenchimento dos Indicadores de Desempenho referentes a ${competenciaExtenso(atual.codigo, atual.rotulo).toUpperCase()}`
      + `${atual.prazo ? `, até ${dataBR(atual.prazo)}` : ""}. Cada divisão informa os seus pelo link: ${link}`
    : "";

  async function copiar(texto: string, ok: string) {
    try { await navigator.clipboard.writeText(texto); setAviso(ok); } catch { setAviso("O navegador não deixou copiar. Selecione o texto e copie."); }
  }

  const abrir = () => {
    const ja = dados?.competencias.find((c) => c.codigo === mesNovo);
    if (atual && atual.codigo !== mesNovo && !window.confirm(`Abrir ${rotuloDe(mesNovo)} encerra a coleta de ${atual.rotulo}. Continuar?`)) return;
    if (ja?.origem === "planilha" && !window.confirm(`${ja.rotulo} já tem dados importados da planilha. Abrir a coleta deixa as divisões completarem ou corrigirem esses dados. Continuar?`)) return;
    void acao("abrir", async () => { await abrirColeta(mesNovo, prazo || null); setVendo(mesNovo); setAviso(`Coleta de ${rotuloDe(mesNovo)} aberta. Copie o link e mande no grupo.`); });
  };

  if (erro && !dados) return <div className="pg-card" role="alert">{erro}</div>;
  if (!dados) return <div className="pg-card pg-sub">Carregando a coleta…</div>;

  return (
    <div className="pg-coleta">
      <section className="pg-card" aria-label="Coleta aberta">
        <div className="pg-secao-topo">
          <span className="pg-rotulo">Coleta mensal dos indicadores</span>
          <button type="button" className="pg-btn" onClick={() => void carregar()} disabled={!!ocupado}><RefreshCw size={13} aria-hidden="true" /> Atualizar</button>
        </div>
        {atual ? (
          <div className="pg-coleta-aberta">
            <div>
              <Unlock size={15} color="var(--ok)" aria-hidden="true" /> <b>{atual.rotulo}</b> aberta
              <span className="pg-sub"> · dados de {competenciaExtenso(atual.codigo, atual.rotulo)}{atual.prazo ? ` · prazo ${dataBR(atual.prazo)}` : ""} · aberta em {dataHora(atual.aberta_em)}</span>
            </div>
            {link && <code className="pg-coleta-link">{link}</code>}
            <div className="pg-coleta-botoes">
              <button type="button" className="pg-btn" onClick={() => link && void copiar(link, "Link copiado.")}><Copy size={13} aria-hidden="true" /> Copiar link</button>
              <button type="button" className="pg-btn" onClick={() => void copiar(mensagemGrupo, "Mensagem para o grupo copiada.")}><Copy size={13} aria-hidden="true" /> Copiar mensagem para o grupo</button>
              {link && <a className="pg-btn" href={link} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden="true" /> Abrir o formulário</a>}
              <button type="button" className="pg-btn" disabled={!!ocupado}
                onClick={() => window.confirm("Trocar o link? O link atual para de funcionar e é preciso mandar o novo no grupo.") && void acao("link", async () => { await trocarLink(atual.codigo); setAviso("Link trocado. Mande o novo no grupo."); })}>
                Trocar link
              </button>
              <button type="button" className="pg-btn pg-btn-perigo" disabled={!!ocupado}
                onClick={() => window.confirm(`Encerrar a coleta de ${atual.rotulo}? O formulário passa a abrir só para consulta.`) && void acao("fechar", async () => { await fecharColeta(atual.codigo); setAviso(`Coleta de ${atual.rotulo} encerrada.`); })}>
                <Lock size={13} aria-hidden="true" /> Encerrar coleta
              </button>
            </div>
          </div>
        ) : (
          <p className="pg-sub" style={{ margin: "4px 0 0" }}>Nenhuma coleta aberta.</p>
        )}

        <div className="pg-coleta-abrir">
          <label className="pg-coleta-campo">
            <span className="pg-rotulo">Competência (mês dos dados)</span>
            <select className="pg-campo" value={mesNovo} onChange={(e) => setMesNovo(e.target.value)}>
              {opcoesDeMes().map((m) => <option key={m} value={m}>{rotuloDe(m)} — {competenciaExtenso(m)}</option>)}
            </select>
          </label>
          <label className="pg-coleta-campo">
            <span className="pg-rotulo">Prazo (opcional)</span>
            <input className="pg-campo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </label>
          <button type="button" className="pg-btn pg-btn-forte" onClick={abrir} disabled={!!ocupado || (atual?.codigo === mesNovo && (prazo || null) === atual.prazo)}>
            <Unlock size={13} aria-hidden="true" /> {atual?.codigo === mesNovo ? "Atualizar prazo" : "Abrir coleta"}
          </button>
          <button type="button" className="pg-btn" disabled={!!ocupado}
            onClick={() => void acao("xlsx", async () => { await baixarPlanilha(dados, `indicadores-gapmn-${new Date().toISOString().slice(0, 10)}.xlsx`); })}>
            <Download size={13} aria-hidden="true" /> Baixar planilha consolidada
          </button>
        </div>
        {aviso && <div className="pg-coleta-aviso" role="status">{aviso}</div>}
        {erro && <div className="pg-coleta-aviso pg-coleta-erro" role="alert">{erro}</div>}
      </section>

      <Acompanhamento dados={dados} vendo={vendo} setVendo={setVendo} aberta={aberta} setAberta={setAberta} />
    </div>
  );
}

function Acompanhamento({ dados, vendo, setVendo, aberta, setAberta }: {
  dados: DadosColeta; vendo: string | null; setVendo: (c: string) => void; aberta: string | null; setAberta: (d: string | null) => void;
}) {
  const comp: CompetenciaAdmin | undefined = dados.competencias.find((c) => c.codigo === vendo);
  const linhas = useMemo(() => {
    if (!comp) return [];
    return DIVISOES.map((div) => {
      const inds = dados.indicadores.filter((i) => i.divisao === div.sigla && cobradoEm(i, comp.codigo));
      const esperadas = inds.flatMap((i) => (i.planejado ? ["Planejado", "Realizado"] : ["Realizado"]).map((t) => ({ ind: i, tipo: t })));
      const lancs = dados.lancamentos.filter((l) => l.competencia === comp.codigo && inds.some((i) => i.id === l.indicador_id));
      const preenchidas = lancs.filter((l) => l.valor !== null || l.v1 !== null || l.v2 !== null).length;
      const classificados = lancs.map((l) => ({ l, ind: inds.find((i) => i.id === l.indicador_id)!, ...classificar(inds.find((i) => i.id === l.indicador_id)!, l) }));
      const ruins = classificados.filter((c) => c.ind.direcao !== "Monitoramento" && (c.status === "Atenção" || c.status === "Crítico"));
      const ultima = lancs.filter((l) => l.posto || l.nome_guerra).sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em))[0] ?? null;
      return {
        div, inds, esperadas: esperadas.length, preenchidas, ruins: ruins.length, semJustificativa: ruins.filter((c) => !c.l.comentario).length,
        anexos: lancs.filter((l) => l.anexo).length, ultima, classificados,
      };
    }).filter((x) => x.esperadas > 0); // divisão sem indicador cobrado no mês (a SEC antes de OUT/26) não aparece
  }, [dados, comp]);
  if (!comp) return null;
  const contratos = dados.contratos.filter((c) => c.competencia === comp.codigo);
  return (
    <section className="pg-card" aria-label="Acompanhamento do preenchimento">
      <div className="pg-secao-topo">
        <span className="pg-rotulo">Acompanhamento do preenchimento</span>
        <select className="pg-campo" value={comp.codigo} onChange={(e) => setVendo(e.target.value)} aria-label="Competência">
          {dados.competencias.map((c) => <option key={c.codigo} value={c.codigo}>{c.rotulo}{c.aberta ? " (aberta)" : c.origem === "planilha" ? " (planilha)" : ""}</option>)}
        </select>
      </div>
      <div className="pg-ctr-rolagem">
        <table className="pg-ctr-tabela pg-coleta-tabela">
          <thead>
            <tr><th>Divisão</th><th>Preenchidos</th><th>Atenção / Crítico</th><th>Sem justificativa</th><th>Comprovantes</th><th>Última atualização</th></tr>
          </thead>
          <tbody>
            {linhas.map((x) => (
              <Fragment key={x.div.sigla}>
                <tr className="pg-coleta-div" onClick={() => setAberta(aberta === x.div.sigla ? null : x.div.sigla)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") setAberta(aberta === x.div.sigla ? null : x.div.sigla); }} aria-expanded={aberta === x.div.sigla}>
                  <td className="pg-ctr-servico">{aberta === x.div.sigla ? "▾" : "▸"} {x.div.sigla}</td>
                  <td style={{ color: x.preenchidas === x.esperadas ? "var(--ok)" : x.preenchidas === 0 ? "var(--critico)" : "var(--atencao)" }}>{x.preenchidas} de {x.esperadas}</td>
                  <td>{x.ruins}</td>
                  <td style={{ color: x.semJustificativa ? "var(--atencao)" : undefined }}>{x.semJustificativa}</td>
                  <td>{x.anexos}</td>
                  <td className="pg-sub">{x.ultima ? `${x.ultima.posto ?? ""} ${x.ultima.nome_guerra ?? ""} · ${dataHora(x.ultima.atualizado_em)}` : x.preenchidas > 0 ? "importado da planilha" : "—"}</td>
                </tr>
                {aberta === x.div.sigla && (
                  <tr><td colSpan={6} className="pg-coleta-detalhe">
                    <DetalheDivisao inds={x.inds} lancs={x.classificados} historico={dados.historico.filter((h) => h.competencia === comp.codigo)} />
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {contratos.length > 0 && <p className="pg-sub" style={{ marginBottom: 0 }}>DOC informou {contratos.length} contratos e atas essenciais em {comp.rotulo} (aparecem no painel).</p>}
    </section>
  );
}

function DetalheDivisao({ inds, lancs, historico }: {
  inds: IndicadorGov[];
  lancs: { l: LancamentoAdmin; ind: IndicadorGov; status: string }[];
  historico: HistoricoGov[];
}) {
  const [hist, setHist] = useState<string | null>(null);
  const [erroAnexo, setErroAnexo] = useState<string | null>(null);
  const abrirAnexo = async (caminho: string) => {
    setErroAnexo(null);
    try { window.open(await urlDoAnexo(caminho), "_blank", "noopener"); } catch (e) { setErroAnexo(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="pg-coleta-lista">
      {erroAnexo && <div className="pg-coleta-erro">{erroAnexo}</div>}
      {inds.map((ind) => {
        const doInd = lancs.filter((x) => x.ind.id === ind.id);
        const h = historico.filter((x) => x.indicador_id === ind.id);
        return (
          <div key={ind.id} className="pg-coleta-item">
            <div className="pg-coleta-item-cab">
              <span><b>Nº {ind.id}</b> {ind.indicador} <span className="pg-sub">· {nomeSecao(ind.categoria)}</span></span>
              {h.length > 0 && <button type="button" className="pg-btn-texto pg-btn" onClick={() => setHist(hist === ind.id ? null : ind.id)}>{h.length} alteraç{h.length > 1 ? "ões" : "ão"}</button>}
            </div>
            {doInd.length === 0 ? <div className="pg-sub">não informado</div> : doInd.map(({ l, status }) => (
              <div key={l.tipo} className="pg-coleta-valor">
                {ind.planejado && <span className="pg-sub">{l.tipo}: </span>}
                <b>{l.valor === null ? "—" : fmtValor(l.valor, ind.unidade)}</b>
                {ind.direcao !== "Monitoramento" && COR_STATUS[status] && <span className="pg-ctr-chip" style={{ color: COR_STATUS[status], borderColor: COR_STATUS[status], marginLeft: 8 }}>{status}</span>}
                {l.anexo && <button type="button" className="pg-btn pg-btn-texto" onClick={() => void abrirAnexo(l.anexo!)}>📎 {l.anexo_nome ?? "comprovante"}</button>}
                {(l.posto || l.nome_guerra) && <span className="pg-sub"> · {l.posto} {l.nome_guerra}, {dataHora(l.atualizado_em)}</span>}
                {l.comentario && <div className="pg-justificativa">“{l.comentario}”</div>}
              </div>
            ))}
            {hist === ind.id && (
              <ul className="pg-coleta-hist">
                {h.map((x) => (
                  <li key={x.id}>
                    {dataHora(x.quando)} · {x.posto} {x.nome_guerra}: {x.antes ? `${fmtH(x.antes)} → ` : ""}{fmtH(x.depois)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function fmtH(o: HistoricoGov["antes"]): string {
  if (!o) return "—";
  const partes: string[] = [];
  if (o.valor !== null && o.valor !== undefined) partes.push(`resultado ${Math.round(Number(o.valor) * 100) / 100}`);
  else if (o.v1 !== null && o.v1 !== undefined) partes.push(`valores ${[o.v1, o.v2, o.v3].filter((v) => v !== null && v !== undefined).join(" / ")}`);
  else partes.push("vazio");
  if (o.comentario) partes.push("com justificativa");
  if (o.anexo_nome) partes.push("com comprovante");
  return partes.join(", ");
}
