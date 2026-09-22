import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  ApostilamentoModal,
  IpcaResult,
  CompraTR,
  proxReajusteDate,
  fetchIpcaRange,
} from "../components/AtasRegistroPreco";
import TermoApostilamentoContrato, { ContratoRef } from "../components/TermoApostilamentoContrato";
import TermoAditivoContrato from "../components/TermoAditivoContrato";

// ── Tipos locais ─────────────────────────────────────────────────────────────
type ItemAta = {
  id: number;
  ata_numero: string;
  numero_ata: string | null;
  descricao: string | null;
  cnpj_fornecedor: string | null;
  fornecedor_nome: string | null;
  quantidade_registrada: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
  qtd_limite_adesao: number | null;
  aceita_adesao: string | null;
  numero_compra: string | null;
};

type ContratoRow = {
  id: string;
  numero_contrato: string;
  descricao: string | null;
  fornecedor: string | null;
  cnpj: string | null;
  fiscal: string | null;
  vl_contratual: number | null;
  vl_a_empenhar: number | null;
  vl_atual: number | null;
  pag_nup: string | null;
  data_orcamento: string | null;
};

// ── Página de Apostilamento (nova aba) ───────────────────────────────────────
export default function AptPage() {
  const params = new URLSearchParams(window.location.search);
  const tipo   = params.get("tipo") ?? "ata"; // "ata" | "contrato" | "aditivo"
  const ataNum = params.get("ata") ?? "";
  const ctrId  = params.get("id") ?? "";

  if (tipo === "contrato") return <AptContrato id={ctrId} />;
  if (tipo === "aditivo")  return <AptAditivo  id={ctrId} />;
  return <AptAta numeroAta={ataNum} />;
}

// ── Apostilamento de ATA ─────────────────────────────────────────────────────
function AptAta({ numeroAta }: { numeroAta: string }) {
  const [itens,       setItens]       = useState<ItemAta[]>([]);
  const [tr,          setTr]          = useState<CompraTR | null>(null);
  const [compra,      setCompra]      = useState<string | null>(null);
  const [ipcaResult,  setIpcaResult]  = useState<IpcaResult | null | undefined>(undefined);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    if (!numeroAta) return;

    async function load() {
      // 1. Busca itens da ATA
      const { data: itensData } = await supabase
        .from("itens_ata_gap_mn")
        .select("*")
        .eq("ata_numero", numeroAta);
      const loadedItens: ItemAta[] = (itensData as ItemAta[]) ?? [];
      setItens(loadedItens);

      // 2. Número da compra (pregão) — primeiro item com numero_compra
      const numCompra = loadedItens.find(i => i.numero_compra)?.numero_compra ?? null;
      setCompra(numCompra);
      setLoading(false);

      if (!numCompra) return;

      // 3. TR da compra
      const { data: trData } = await supabase
        .from("compras_tr_gap_mn")
        .select("*")
        .eq("numero_compra", numCompra)
        .maybeSingle();
      const loadedTR = (trData as CompraTR | null) ?? null;
      setTr(loadedTR);

      // 4. Calcular IPCA
      if (!loadedTR?.data_orcamento) { setIpcaResult(null); return; }
      const dtReaj = proxReajusteDate(loadedTR.data_orcamento);
      const hoje   = new Date();
      const fmtMY  = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
      const inicio = fmtMY(new Date(loadedTR.data_orcamento + "T12:00:00"));
      const fimDate = dtReaj < hoje ? new Date(dtReaj) : new Date(hoje);
      fimDate.setMonth(fimDate.getMonth() - 1);
      const fim = fmtMY(fimDate);
      const result = await fetchIpcaRange(inicio, fim);
      setIpcaResult(result);
    }

    load();
  }, [numeroAta]);

  if (!numeroAta) {
    return <div style={errStyle}>Parâmetro ?ata= não informado.</div>;
  }

  return (
    <ApostilamentoModal
      numeroAta={numeroAta}
      compra={compra}
      tr={tr}
      itens={itens}
      loadingItens={loading}
      ipcaResult={ipcaResult}
      onClose={() => window.close()}
    />
  );
}

// ── Apostilamento de CONTRATO ────────────────────────────────────────────────
function AptContrato({ id }: { id: string }) {
  const [contrato, setContrato] = useState<ContratoRef | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!id) return;
    supabase
      .from("contratos_scon")
      .select("id,numero_contrato,descricao,fornecedor,cnpj,fiscal,vl_contratual,vl_a_empenhar,vl_atual,pag_nup,data_orcamento")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setContrato(data as ContratoRef);
        setLoading(false);
      });
  }, [id]);

  if (!id) {
    return <div style={errStyle}>Parâmetro ?id= não informado.</div>;
  }
  if (loading) {
    return <div style={errStyle}>Carregando contrato…</div>;
  }
  if (!contrato) {
    return <div style={errStyle}>Contrato não encontrado (id={id}).</div>;
  }

  return (
    <TermoApostilamentoContrato
      contrato={contrato}
      onClose={() => window.close()}
    />
  );
}

// ── Termo Aditivo de CONTRATO ────────────────────────────────────────────────
function AptAditivo({ id }: { id: string }) {
  const [contrato, setContrato] = useState<ContratoRef | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!id) return;
    supabase
      .from("contratos_scon")
      .select("id,numero_contrato,descricao,fornecedor,cnpj,fiscal,vl_contratual,vl_a_empenhar,vl_atual,pag_nup,data_orcamento")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setContrato(data as ContratoRef);
        setLoading(false);
      });
  }, [id]);

  if (!id)      return <div style={errStyle}>Parâmetro ?id= não informado.</div>;
  if (loading)  return <div style={errStyle}>Carregando contrato…</div>;
  if (!contrato) return <div style={errStyle}>Contrato não encontrado (id={id}).</div>;

  return <TermoAditivoContrato contrato={contrato} onClose={() => window.close()} />;
}

const errStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  height: "100vh", fontFamily: "Arial", fontSize: 14, color: "#64748b",
};
