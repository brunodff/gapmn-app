// src/lib/pesquisaPrecosExport.ts
// Relatório de pesquisa de preços (PDF e XLSX) no padrão IN SEGES/ME 65/2021.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import {
  API_DADOS_ABERTOS, CRITERIO_LABEL, fmtBRL, fmtData, fmtNum,
  type Criterio, type Estatisticas, type FonteConsulta, type ItemTR, type RegistroPreco,
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
  consultas: FonteConsulta[];   // consultas feitas à API para este item (uma por UF)
  catalogoUrl: string;          // consulta do item no catálogo CATMAT/CATSER
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
  `no período dos últimos ${c.periodoMeses} meses${c.uf ? `, restrito ${c.uf.includes(",") ? "às UFs" : "à UF"} ${c.uf}` : ", em âmbito nacional"}. ` +
  `Conforme o art. 6º da mesma IN, os valores inexequíveis, inconsistentes e excessivamente elevados foram ` +
  `desconsiderados pelo critério estatístico de Tukey (Q1 - 1,5 x IQR; Q3 + 1,5 x IQR), e o preço estimado de cada ` +
  `item foi obtido pelo método indicado na tabela (média, mediana ou menor valor) sobre conjunto de três ou mais preços.`;

// ── Fontes ───────────────────────────────────────────────────────────────────

interface FonteApi { nome: string; uso: string; endereco: string; documentacao: string }

/** APIs efetivamente usadas neste relatório (só lista serviço/material se houver item do tipo). */
function apisUsadas(linhas: LinhaRelatorio[]): FonteApi[] {
  const material = linhas.some((l) => l.item.tipo === "material");
  const servico = linhas.some((l) => l.item.tipo === "servico");
  const swagger = `${API_DADOS_ABERTOS}/swagger-ui/index.html`;
  const apis: FonteApi[] = [];
  if (material) apis.push({
    nome: "Compras.gov.br — Dados Abertos: Pesquisa de Preço (material)",
    uso: "Preços unitários homologados em compras públicas, por item CATMAT (rota 1_consultarMaterial).",
    endereco: `${API_DADOS_ABERTOS}/modulo-pesquisa-preco/1_consultarMaterial`,
    documentacao: swagger,
  });
  if (servico) apis.push({
    nome: "Compras.gov.br — Dados Abertos: Pesquisa de Preço (serviço)",
    uso: "Preços unitários homologados em compras públicas, por item CATSER (rota 3_consultarServico).",
    endereco: `${API_DADOS_ABERTOS}/modulo-pesquisa-preco/3_consultarServico`,
    documentacao: swagger,
  });
  if (material) apis.push({
    nome: "Compras.gov.br — Dados Abertos: Catálogo de Materiais (CATMAT)",
    uso: "Confirmação da descrição oficial e do PDM de cada item (rota 4_consultarItemMaterial).",
    endereco: `${API_DADOS_ABERTOS}/modulo-material/4_consultarItemMaterial`,
    documentacao: swagger,
  });
  if (servico) apis.push({
    nome: "Compras.gov.br — Dados Abertos: Catálogo de Serviços (CATSER)",
    uso: "Confirmação da descrição oficial de cada serviço (rota 6_consultarItemServico).",
    endereco: `${API_DADOS_ABERTOS}/modulo-servico/6_consultarItemServico`,
    documentacao: swagger,
  });
  apis.push({
    nome: "MCP Compras.gov.br (servidor MCP)",
    uso: "Camada que consulta as APIs acima, percorre as páginas de resultado e calcula as estatísticas (média, mediana, quartis e descarte de outliers).",
    endereco: "https://mcp-compras.up.railway.app/mcp",
    documentacao: "https://github.com/opedrosoares/MCP_Compras",
  });
  return apis;
}

interface LinhaConsulta { item: number; codigo: string; abrangencia: string; encontrados: string; quando: string; url: string }

/** Uma linha por consulta feita (item × UF), mais a consulta de catálogo de cada item. */
function consultasPorItem(linhas: LinhaRelatorio[]): LinhaConsulta[] {
  const dt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const out: LinhaConsulta[] = [];
  for (const l of linhas) {
    const codigo = `${l.item.tipo === "material" ? "CATMAT" : "CATSER"} ${l.item.codigo ?? "–"}`;
    for (const c of l.consultas) {
      out.push({
        item: l.item.numero, codigo, abrangencia: c.uf ?? "Nacional",
        encontrados: fmtNum(c.encontrados, 0), quando: dt(c.consultadoEm), url: c.url,
      });
    }
    if (l.item.codigo) {
      out.push({ item: l.item.numero, codigo, abrangencia: "Catálogo", encontrados: "–", quando: "", url: l.catalogoUrl });
    }
  }
  return out;
}

type CelulaAutoTable = { section: string; column: { index: number }; row: { index: number }; cell: { x: number; y: number; width: number; height: number; styles: { textColor: unknown } } };

function paginaFontes(doc: jsPDF, linhas: LinhaRelatorio[]) {
  const W = doc.internal.pageSize.getWidth();
  doc.addPage();
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(0);
  doc.text("FONTES", W / 2, 16, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(8);
  doc.text("APIs e bases de dados utilizadas e endereços das consultas realizadas (clique no endereço para abrir).", W / 2, 21, { align: "center" });

  const AZUL: [number, number, number] = [3, 105, 161];
  // Colunas de endereço ficam azuis e a célula inteira vira link clicável.
  const links = (colunas: number[], urlDe: (linha: number, coluna: number) => string) => ({
    didParseCell: (d: CelulaAutoTable) => {
      if (d.section === "body" && colunas.includes(d.column.index)) d.cell.styles.textColor = AZUL;
    },
    didDrawCell: (d: CelulaAutoTable) => {
      if (d.section !== "body" || !colunas.includes(d.column.index)) return;
      const url = urlDe(d.row.index, d.column.index);
      if (url) doc.link(d.cell.x, d.cell.y, d.cell.width, d.cell.height, { url });
    },
  });

  const apis = apisUsadas(linhas);
  autoTable(doc, {
    startY: 26,
    head: [["1. APIs e bases consultadas", "Uso neste relatório", "Endereço", "Documentação"]],
    body: apis.map((a) => [a.nome, a.uso, a.endereco, a.documentacao]),
    styles: { fontSize: 7, cellPadding: 1.6, valign: "top", overflow: "linebreak" },
    headStyles: { fillColor: [26, 58, 92] },
    columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 70 }, 2: { cellWidth: 68 }, 3: { cellWidth: 68 } },
    margin: { left: 14, right: 14 },
    ...links([2, 3], (i, c) => (c === 2 ? apis[i]?.endereco : apis[i]?.documentacao) ?? ""),
  });

  const consultas = consultasPorItem(linhas);
  const yIni = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: yIni,
    head: [["Item", "Código", "Abrangência", "Encontrados", "Consultado em", "2. Endereço da consulta (API Dados Abertos)"]],
    body: consultas.map((c) => [c.item, c.codigo, c.abrangencia, c.encontrados, c.quando, c.url]),
    styles: { fontSize: 6.5, cellPadding: 1.3, valign: "top", overflow: "linebreak" },
    headStyles: { fillColor: [26, 58, 92], fontSize: 7 },
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 26 }, 2: { cellWidth: 22 }, 3: { cellWidth: 20 }, 4: { cellWidth: 27 }, 5: { cellWidth: 153 } },
    margin: { left: 14, right: 14 },
    ...links([5], (i) => consultas[i]?.url ?? ""),
  });

  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  doc.setFont("helvetica", "italic").setFontSize(7.5).setTextColor(60);
  doc.text(doc.splitTextToSize(
    "Os endereços reproduzem a consulta feita à API pública de Dados Abertos (primeira página, até 500 registros; o MCP percorre as demais páginas). " +
    "Os dados são atualizados continuamente pelo órgão gestor, de modo que a mesma consulta pode retornar resultados adicionais em datas posteriores. " +
    "Cada preço considerado, com UASG, fornecedor, marca e data, consta no Anexo deste relatório.",
    W - 28), 14, y);
  doc.setTextColor(0);
}

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
    // Larguras fixas somando 267 mm (folha A4 paisagem com margens de 14 mm = 269 mm).
    columnStyles: {
      0: { cellWidth: 9 }, 1: { cellWidth: 22 }, 2: { cellWidth: 40, halign: "left" }, 3: { cellWidth: 11 },
      4: { cellWidth: 14 }, 5: { cellWidth: 14 }, 6: { cellWidth: 22 }, 7: { cellWidth: 22 }, 8: { cellWidth: 22 },
      9: { cellWidth: 22 }, 10: { cellWidth: 11 }, 11: { cellWidth: 13 },
      12: { cellWidth: 22, halign: "right" }, 13: { cellWidth: 23, halign: "right" },
    },
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
      columnStyles: {
        0: { cellWidth: 18 }, 1: { cellWidth: 72 }, 2: { cellWidth: 9 }, 3: { cellWidth: 55 },
        4: { cellWidth: 28 }, 5: { cellWidth: 26 }, 6: { cellWidth: 16 }, 7: { cellWidth: 28, halign: "right" },
      },
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

  paginaFontes(doc, linhas);

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

  // Aba Fontes: APIs usadas + endereço de cada consulta (com hiperlink clicável)
  const apis = apisUsadas(linhas);
  const consultas = consultasPorItem(linhas);
  const aoa: (string | number)[][] = [
    ["APIs e bases consultadas", "Uso neste relatório", "Endereço", "Documentação"],
    ...apis.map((a) => [a.nome, a.uso, a.endereco, a.documentacao]),
    [],
    ["Item", "Código", "Abrangência", "Registros encontrados", "Consultado em", "Endereço da consulta"],
    ...consultas.map((c) => [c.item, c.codigo, c.abrangencia, c.encontrados, c.quando, c.url]),
  ];
  const wsFontes = XLSX.utils.aoa_to_sheet(aoa);
  const link = (r: number, c: number, url: string) => {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (wsFontes[ref]) wsFontes[ref].l = { Target: url, Tooltip: url };
  };
  apis.forEach((a, i) => { link(i + 1, 2, a.endereco); link(i + 1, 3, a.documentacao); });
  const inicioConsultas = apis.length + 3;
  consultas.forEach((c, i) => link(inicioConsultas + i, 5, c.url));
  wsFontes["!cols"] = [{ wch: 44 }, { wch: 40 }, { wch: 60 }, { wch: 46 }, { wch: 16 }, { wch: 120 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Resumo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(amostras), "Amostras");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(info), "Informações");
  XLSX.utils.book_append_sheet(wb, wsFontes, "Fontes");
  XLSX.writeFile(wb, `pesquisa-precos${cab.numeroCompra ? "-" + cab.numeroCompra.replace(/\W+/g, "") : ""}.xlsx`);
}
