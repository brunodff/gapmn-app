// src/lib/pesquisaPrecosExport.ts
// Relatório de pesquisa de preços (PDF e XLSX) no padrão IN SEGES/ME 65/2021.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import {
  CRITERIO_LABEL, fmtBRL, fmtData, fmtNum,
  type Criterio, type Estatisticas, type ItemTR, type RegistroPreco,
} from "./mcpCompras";

export interface LinhaRelatorio {
  item: ItemTR;
  estat: Estatisticas | null;
  amostraTotal: number;
  criterio: Criterio;
  valorUnitario: number | null;
  valorTotal: number | null;
  ajustado: boolean;
  justificativa: string;
  registros: RegistroPreco[];
}

export interface CabecalhoRelatorio {
  objeto: string;
  nup: string;
  numeroCompra: string;
  responsavel: string;
  periodoMeses: number;
  uf: string;
}

const METODOLOGIA = (c: CabecalhoRelatorio) =>
  `Pesquisa realizada com base no art. 5º, incisos I e II, da IN SEGES/ME nº 65/2021, ` +
  `utilizando preços praticados em contratações públicas registradas no Compras.gov.br ` +
  `(API de Dados Abertos — módulo Pesquisa de Preço), consultadas por meio do MCP Compras.gov.br, ` +
  `no período dos últimos ${c.periodoMeses} meses${c.uf ? `, restrito à UF ${c.uf}` : ", em âmbito nacional"}. ` +
  `Conforme o art. 6º da mesma IN, os valores inexequíveis, inconsistentes e excessivamente elevados foram ` +
  `desconsiderados pelo critério estatístico de Tukey (Q1 − 1,5×IQR; Q3 + 1,5×IQR), e o preço estimado de cada ` +
  `item foi obtido pelo método indicado na tabela (média, mediana ou menor valor) sobre conjunto de três ou mais preços.`;

function totalGeral(linhas: LinhaRelatorio[]) {
  return linhas.reduce((a, l) => a + (l.valorTotal ?? 0), 0);
}

export function exportarPdf(cab: CabecalhoRelatorio, linhas: LinhaRelatorio[]) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const hoje = new Date().toLocaleDateString("pt-BR");

  doc.setFont("helvetica", "bold").setFontSize(10);
  doc.text("COMANDO DA AERONÁUTICA", W / 2, 12, { align: "center" });
  doc.text("GRUPAMENTO DE APOIO DE MANAUS — UASG 120630", W / 2, 17, { align: "center" });
  doc.setFontSize(13).text("RELATÓRIO DE PESQUISA DE PREÇOS", W / 2, 26, { align: "center" });

  doc.setFont("helvetica", "normal").setFontSize(9);
  let y = 34;
  const campo = (rotulo: string, valor: string) => {
    if (!valor) return;
    doc.setFont("helvetica", "bold").text(`${rotulo}:`, 14, y);
    doc.setFont("helvetica", "normal");
    const linhasTxt = doc.splitTextToSize(valor, W - 60);
    doc.text(linhasTxt, 48, y);
    y += 4.5 * linhasTxt.length;
  };
  campo("Objeto", cab.objeto);
  campo("Processo (NUP)", cab.nup);
  campo("Nº da compra", cab.numeroCompra);
  campo("Data", hoje);

  y += 2;
  doc.setFont("helvetica", "bold").text("Metodologia", 14, y);
  y += 4.5;
  doc.setFont("helvetica", "normal");
  const met = doc.splitTextToSize(METODOLOGIA(cab), W - 28);
  doc.text(met, 14, y);
  y += 4 * met.length + 2;

  autoTable(doc, {
    startY: y,
    head: [["Item", "Tipo/Código", "Descrição", "Unid.", "Qtd.", "Amostra", "Mínimo", "Mediana", "Média", "Máximo", "CV", "Critério", "Vlr. unit. estimado", "Vlr. total estimado"]],
    body: linhas.map((l) => [
      l.item.numero,
      `${l.item.tipo === "material" ? "CATMAT" : "CATSER"} ${l.item.codigo ?? "–"}`,
      l.item.descricao.slice(0, 160),
      l.item.unidade || "–",
      fmtNum(l.item.quantidade),
      l.estat ? `${l.estat.n}/${l.amostraTotal}${l.ajustado ? "*" : ""}` : "0",
      fmtBRL(l.estat?.minimo),
      fmtBRL(l.estat?.mediana),
      fmtBRL(l.estat?.media),
      fmtBRL(l.estat?.maximo),
      l.estat ? `${fmtNum(l.estat.coeficiente_variacao * 100, 1)}%` : "–",
      CRITERIO_LABEL[l.criterio],
      fmtBRL(l.valorUnitario),
      fmtBRL(l.valorTotal),
    ]),
    foot: [["", "", "VALOR TOTAL ESTIMADO", "", "", "", "", "", "", "", "", "", "", fmtBRL(totalGeral(linhas))]],
    styles: { fontSize: 7, cellPadding: 1.4, valign: "middle" },
    headStyles: { fillColor: [26, 58, 92], fontSize: 7 },
    footStyles: { fillColor: [226, 232, 240], textColor: 20, fontStyle: "bold" },
    columnStyles: { 2: { cellWidth: 62 }, 12: { halign: "right" }, 13: { halign: "right" } },
    margin: { left: 14, right: 14 },
  });

  const nota = linhas.some((l) => l.ajustado)
    ? "* Amostra ajustada pelo analista (exclusão motivada de registros, filtro de unidade ou recorte de faixa) — ver justificativas abaixo."
    : "";
  let yy = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  doc.setFontSize(7.5).setFont("helvetica", "italic");
  doc.text("Amostra = preços considerados / preços encontrados no período. CV = coeficiente de variação.", 14, yy);
  if (nota) { yy += 4; doc.text(nota, 14, yy); }

  const justificadas = linhas.filter((l) => l.justificativa.trim());
  if (justificadas.length) {
    autoTable(doc, {
      startY: yy + 5,
      head: [["Item", "Justificativa / observação do analista"]],
      body: justificadas.map((l) => [l.item.numero, l.justificativa.trim()]),
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [71, 85, 105] },
      columnStyles: { 0: { cellWidth: 14 } },
      margin: { left: 14, right: 14 },
    });
  }

  // Anexo: fontes consultadas por item
  doc.addPage();
  doc.setFont("helvetica", "bold").setFontSize(11);
  doc.text("ANEXO — Preços considerados por item (fonte: Compras.gov.br)", 14, 14);
  let yAnexo = 18;
  for (const l of linhas) {
    if (!l.registros.length) continue;
    autoTable(doc, {
      startY: yAnexo,
      head: [[{ content: `Item ${l.item.numero} — ${l.item.descricao.slice(0, 120)}`, colSpan: 8 }],
        ["Data", "UASG / Órgão", "UF", "Fornecedor", "Marca", "Unid. forn.", "Qtd.", "Preço unit."]],
      body: l.registros.map((r) => [
        fmtData(r.dataResultado ?? r.dataCompra),
        `${r.codigoUasg ?? ""} — ${r.nomeUasg ?? r.nomeOrgao ?? ""}`.slice(0, 70),
        r.estado ?? "",
        (r.nomeFornecedor ?? "").slice(0, 45),
        (r.marca ?? "").slice(0, 20),
        [r.siglaUnidadeFornecimento, r.capacidadeUnidadeFornecimento && r.capacidadeUnidadeFornecimento !== 1 ? `c/ ${fmtNum(r.capacidadeUnidadeFornecimento)}` : ""].filter(Boolean).join(" "),
        fmtNum(r.quantidade),
        fmtBRL(r.precoUnitario),
      ]),
      styles: { fontSize: 6.8, cellPadding: 1 },
      headStyles: { fillColor: [26, 58, 92], fontSize: 7 },
      columnStyles: { 7: { halign: "right" } },
      margin: { left: 14, right: 14 },
    });
    yAnexo = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  // Assinatura
  const H = doc.internal.pageSize.getHeight();
  if (yAnexo > H - 30) { doc.addPage(); yAnexo = 30; }
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.line(W / 2 - 50, yAnexo + 14, W / 2 + 50, yAnexo + 14);
  doc.text(cab.responsavel || "Responsável pela pesquisa de preços", W / 2, yAnexo + 19, { align: "center" });

  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setFontSize(7).setTextColor(120);
    doc.text(`Gerado pelo Aplicativo do GAP-MN em ${hoje} — página ${p}/${paginas}`, W / 2, H - 6, { align: "center" });
    doc.setTextColor(0);
  }

  doc.save(`pesquisa-precos${cab.numeroCompra ? "-" + cab.numeroCompra.replace(/\W+/g, "") : ""}.pdf`);
}

export function exportarXlsx(cab: CabecalhoRelatorio, linhas: LinhaRelatorio[]) {
  const resumo = linhas.map((l) => ({
    "Item": l.item.numero,
    "Tipo": l.item.tipo === "material" ? "CATMAT" : "CATSER",
    "Código": l.item.codigo,
    "Descrição": l.item.descricao,
    "Unidade": l.item.unidade,
    "Quantidade": l.item.quantidade,
    "Preços considerados": l.estat?.n ?? 0,
    "Preços encontrados": l.amostraTotal,
    "Outliers descartados": l.estat?.outliers ?? 0,
    "Mínimo": l.estat?.minimo,
    "Mediana": l.estat?.mediana,
    "Média": l.estat?.media,
    "Máximo": l.estat?.maximo,
    "CV (%)": l.estat ? +(l.estat.coeficiente_variacao * 100).toFixed(1) : null,
    "Critério": CRITERIO_LABEL[l.criterio],
    "Valor unitário estimado": l.valorUnitario,
    "Valor unitário no TR": l.item.valorReferencia ?? null,
    "Diferença vs TR (%)": l.item.valorReferencia && l.valorUnitario != null
      ? +((l.valorUnitario / l.item.valorReferencia - 1) * 100).toFixed(1) : null,
    "Valor total estimado": l.valorTotal,
    "Amostra ajustada": l.ajustado ? "Sim" : "Não",
    "Justificativa": l.justificativa,
  }));
  resumo.push({ "Descrição": "VALOR TOTAL ESTIMADO", "Valor total estimado": totalGeral(linhas) } as never);

  const amostras = linhas.flatMap((l) => l.registros.map((r) => ({
    "Item": l.item.numero,
    "Código": l.item.codigo,
    "Data resultado": fmtData(r.dataResultado ?? r.dataCompra),
    "UASG": r.codigoUasg,
    "Unidade compradora": r.nomeUasg,
    "Órgão": r.nomeOrgao,
    "UF": r.estado,
    "Município": r.municipio,
    "CNPJ fornecedor": r.niFornecedor,
    "Fornecedor": r.nomeFornecedor,
    "Marca": r.marca,
    "Unid. fornecimento": r.siglaUnidadeFornecimento,
    "Capacidade": r.capacidadeUnidadeFornecimento,
    "Quantidade": r.quantidade,
    "Preço unitário": r.precoUnitario,
    "Id compra/item": r.idCompraItem,
    "Descrição detalhada": r.descricaoDetalhadaItem,
  })));

  const info = [
    { Campo: "Objeto", Valor: cab.objeto },
    { Campo: "Processo (NUP)", Valor: cab.nup },
    { Campo: "Nº da compra", Valor: cab.numeroCompra },
    { Campo: "Responsável", Valor: cab.responsavel },
    { Campo: "Data", Valor: new Date().toLocaleDateString("pt-BR") },
    { Campo: "Metodologia", Valor: METODOLOGIA(cab) },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Resumo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(amostras), "Amostras");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(info), "Informações");
  XLSX.writeFile(wb, `pesquisa-precos${cab.numeroCompra ? "-" + cab.numeroCompra.replace(/\W+/g, "") : ""}.xlsx`);
}
