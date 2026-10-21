// Documento Word (.docx) da minuta do PTA, dentro da aba "Minuta do PTA" (só ADMIN e DEV).
// Quem quer editar baixa a versão mais recente, edita no Word (comentários e controle de alterações
// funcionam) e envia de volta: cada envio vira uma versão nova, nada é sobrescrito. O cap. VII vem da
// minuta do painel: o DEV leva a minuta para o Word com "Atualizar o cap. VII no Word".
import { useCallback, useEffect, useRef, useState } from "react";
import { atualizarDocx, ehDocx } from "../lib/execucao/ptaWord.ts";
import {
  baixarArquivo, enviarArquivo, listarArquivos, salvarMinuta,
  type ArquivoPTA, type Minuta,
} from "../lib/execucao/ptaMinuta.ts";

const C = {
  bg: "#0d1117", card: "#161b27", borda: "#1e2a3a", texto: "#e2e8f0", fraco: "#7c8ba1",
  ciano: "#22d3ee", verde: "#4ade80", ambar: "#fbbf24", roxo: "#a78bfa", vermelho: "#f87171", azul: "#60a5fa",
};
const botao: React.CSSProperties = {
  background: "#1e2a3a", border: `1px solid ${C.borda}`, borderRadius: 8, padding: "6px 12px", fontSize: 11,
  color: C.texto, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap",
};
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const ORIGEM: Record<ArquivoPTA["origem"], string> = {
  modelo: "gerada do PTA anterior",
  enviado: "editada no Word",
  cap7: "cap. VII atualizado pela minuta",
};
const MAX_BYTES = 20 * 1024 * 1024;

type Props = {
  ano: number;
  setor: string;
  minuta: { atual: Minuta | null; sujo: boolean };
  onMinuta: (m: Minuta) => void;
};

export default function PtaWord({ ano, setor, minuta, onMinuta }: Props) {
  const ehDev = setor === "DEV";
  const [lista, setLista] = useState<ArquivoPTA[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<{ mudancas: string[]; avisos: string[] } | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [obs, setObs] = useState("");
  const entrada = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try {
      setLista(await listarArquivos(ano));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [ano]);
  useEffect(() => { void carregar(); }, [carregar]);

  const atual = lista[0] ?? null;
  const versao = (a: ArquivoPTA) => lista.length - lista.indexOf(a);
  const nomeBaixado = (a: ArquivoPTA) => `PTA GAP-MN ${ano} - minuta v${versao(a)}.docx`;

  async function tarefa(nome: string, fn: () => Promise<void>) {
    setOcupado(nome);
    setErro(null);
    setAviso(null);
    try { await fn(); } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  }

  const baixar = (a: ArquivoPTA) => tarefa("baixar", async () => {
    const bytes = await baixarArquivo(a.caminho);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeBaixado(a);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });

  const escolher = (f: File | null) => {
    setErro(null);
    if (!f) return;
    if (!/\.docx$/i.test(f.name)) { setErro("Escolha um arquivo .docx (Word). Se estiver em .doc, salve como .docx no Word antes."); return; }
    if (f.size > MAX_BYTES) { setErro("O arquivo passa de 20 MB."); return; }
    setArquivo(f);
  };

  const enviar = () => tarefa("enviar", async () => {
    if (!arquivo) return;
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    if (!ehDocx(bytes)) throw new Error("Esse arquivo não abre como documento do Word (.docx).");
    await enviarArquivo(ano, bytes, arquivo.name, "enviado", obs);
    setArquivo(null);
    setObs("");
    if (entrada.current) entrada.current.value = "";
    setRelatorio(null);
    await carregar();
    setAviso("Versão enviada. Ela é a mais recente agora.");
  });

  const atualizarCap7 = () => tarefa("cap7", async () => {
    const m = minuta.atual;
    if (!m || !atual) return;
    if (!window.confirm(`Gerar uma versão nova do Word com o cap. VII da minuta (versão ${m.versao})?\n\nO cap. VII da versão mais recente do Word é substituído; o resto do documento fica como está. Artigos, sumário e códigos de tarefa são renumerados.`)) return;
    const r = atualizarDocx(await baixarArquivo(atual.caminho), m.conteudo);
    let versaoMinuta = m.versao;
    if (JSON.stringify(r.conteudo) !== JSON.stringify(m.conteudo)) {
      const salva = await salvarMinuta(m.ano, m.secao, r.conteudo, m.versao);
      versaoMinuta = salva.versao;
      onMinuta(salva);
    }
    await enviarArquivo(ano, r.bytes, `PTA GAP-MN ${ano} - minuta.docx`, "cap7", `Cap. VII da minuta (versão ${versaoMinuta}).`);
    await carregar();
    setRelatorio({ mudancas: r.mudancas, avisos: r.avisos });
    setAviso("Versão nova do Word gerada com o cap. VII da minuta.");
  });

  const podeCap7 = ehDev && !!atual && !!minuta.atual && !minuta.sujo;
  const motivoCap7 = !atual ? "Ainda não há versão do Word." : !minuta.atual ? "Crie a minuta primeiro." : minuta.sujo ? "Salve as alterações da minuta antes." : "";

  return (
    <section style={{ background: C.card, border: `1px solid ${C.azul}55`, borderRadius: 14, padding: "14px 16px", display: "grid", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>📄 Documento Word — PTA GAP-MN {ano} (minuta completa)</h3>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: C.fraco }}>
            {carregando ? "Carregando…" : atual
              ? <>Versão {versao(atual)} · {ORIGEM[atual.origem]} · {atual.enviado_nome || "—"} em {dataHora(atual.enviado_em)}{atual.observacao ? <> · “{atual.observacao}”</> : null}</>
              : "Nenhuma versão do Word ainda."}
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {atual && (
            <button type="button" onClick={() => void baixar(atual)} disabled={!!ocupado}
              style={{ ...botao, background: C.azul, color: "#04121a", borderColor: C.azul }}>
              {ocupado === "baixar" ? "Baixando…" : "Baixar .docx"}
            </button>
          )}
          <button type="button" onClick={() => entrada.current?.click()} disabled={!!ocupado} style={botao}>Enviar versão editada…</button>
          {ehDev && (
            <button type="button" onClick={() => void atualizarCap7()} disabled={!podeCap7 || !!ocupado} title={motivoCap7 || "Leva o cap. VII da minuta abaixo para uma versão nova do Word"} style={botao}>
              {ocupado === "cap7" ? "Gerando…" : "Atualizar o cap. VII no Word"}
            </button>
          )}
          <input ref={entrada} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden
            onChange={(e) => escolher(e.target.files?.[0] ?? null)} aria-label="Arquivo .docx" />
        </div>
      </div>

      {arquivo && (
        <div style={{ display: "grid", gap: 6, border: `1px solid ${C.borda}`, borderRadius: 10, padding: "8px 10px", minWidth: 0 }}>
          <div style={{ fontSize: 12, overflowWrap: "anywhere" }}>Enviar <strong>{arquivo.name}</strong> ({(arquivo.size / 1024).toFixed(0)} KB) como versão nova</div>
          <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={1000} placeholder="O que mudou (opcional)" aria-label="O que mudou"
            style={{ background: C.bg, border: `1px solid ${C.borda}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, color: C.texto, minWidth: 0 }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void enviar()} disabled={!!ocupado} style={{ ...botao, background: C.ciano, color: "#04121a", borderColor: C.ciano }}>
              {ocupado === "enviar" ? "Enviando…" : "Enviar"}
            </button>
            <button type="button" onClick={() => { setArquivo(null); if (entrada.current) entrada.current.value = ""; }} disabled={!!ocupado} style={botao}>Cancelar</button>
          </div>
        </div>
      )}

      {aviso && <div role="status" style={{ fontSize: 12, color: C.verde }}>{aviso}</div>}
      {erro && <div role="alert" style={{ fontSize: 12, color: C.vermelho }}>{erro}</div>}
      {relatorio && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, display: "grid", gap: 3 }}>
          {relatorio.mudancas.map((m) => <li key={m}>{m}</li>)}
          {relatorio.avisos.map((m) => <li key={m} style={{ color: C.ambar }}>{m}</li>)}
        </ul>
      )}

      <p style={{ margin: 0, fontSize: 11, color: C.fraco, lineHeight: 1.5 }}>
        Baixe, edite no Word (comentários e controle de alterações funcionam) e envie de volta: cada envio vira uma versão nova e a mais recente é a que vale.
        O realce amarelo e os comentários marcam o que falta decidir. O cap. VII vem da minuta abaixo: para mudá-lo, edite aqui no app
        {ehDev ? " e use “Atualizar o cap. VII no Word”" : " (o DEV leva a minuta para o Word)"}; edição feita direto no cap. VII do Word é substituída.
      </p>

      {lista.length > 1 && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 12, color: C.fraco }}>Histórico ({lista.length} versões)</summary>
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 4 }}>
            {lista.map((a) => (
              <li key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, minWidth: 0 }}>
                <span style={{ fontWeight: 700, minWidth: 28 }}>v{versao(a)}</span>
                <span style={{ color: C.fraco }}>{dataHora(a.enviado_em)}</span>
                <span>{a.enviado_nome || "—"}</span>
                <span style={{ color: a.origem === "enviado" ? C.ciano : C.roxo }}>{ORIGEM[a.origem]}</span>
                {a.observacao && <span style={{ color: C.fraco, overflowWrap: "anywhere", minWidth: 0 }}>“{a.observacao}”</span>}
                <button type="button" onClick={() => void baixar(a)} disabled={!!ocupado} style={{ ...botao, padding: "2px 8px", fontSize: 10 }}>Baixar</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
