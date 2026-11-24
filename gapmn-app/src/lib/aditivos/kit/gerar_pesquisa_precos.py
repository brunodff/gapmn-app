#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
PESQUISA DE PREÇOS PARA A PRORROGAÇÃO CONTRATUAL (.docx + .pdf) – item OBRIGATÓRIO em todo aditivo.

Uso:  python3 gerar_pesquisa_precos.py dados.json saida/

No site, a pesquisa é feita na aba Licitações > Pesquisa de Preços do gapmn.app (Compras.gov.br – Dados
Abertos, preços atualizados pelo IPCA, IN SEGES/ME nº 65/2021), partindo do TERMO DE REFERÊNCIA do contrato
(anexado em Contratos SCON > Documentos > Termo de Referência, lido do PNCP ou enviado pelo fiscal).
Este script é a referência do documento final: compara o preço que o contrato terá no novo período com os
preços de mercado e conclui sobre a vantajosidade da prorrogação.

dados.json → chave "pesquisa_precos":
  {"fonte_tr": "Termo de Referência do Pregão 90043/2025 (PNCP)",
   "data_pesquisa": "24/11/2026", "atualizacao": "IPCA até 10/2026",
   "criterio": "mediana",                      # mediana (padrão) | media | menor
   "itens": [
     {"item": 1, "descricao": "...", "codigo": "CATSER 12345", "unidade": "mês", "quantidade": 12,
      "preco_contratado": 1394.17,             # unitário que o contrato terá no novo período
      "precos": [{"fonte": "Compras.gov.br – UASG 160001 – Pregão 90012/2026", "data": "12/05/2026",
                  "valor": 1350.00, "valor_atualizado": 1371.20, "excluido": false, "motivo_exclusao": ""}]}]}
"""
import json, os, sys, shutil, subprocess, statistics, datetime
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTE = "Arial"
MIN_PRECOS = 3


def brl(v, simbolo=True):
    s = f"{float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("R$ " + s) if simbolo else s


def pct(v):
    return f"{v:+.2f}%".replace(".", ",")


def fmt(r, size=9, bold=False, italic=False):
    r.font.name = FONTE
    r._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONTE)
    r.font.size = Pt(size)
    r.bold, r.italic = bold, italic


def par(doc, texto="", size=10, bold=False, align=WD_ALIGN_PARAGRAPH.JUSTIFY, before=0, after=4, first=None):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before, p.paragraph_format.space_after = Pt(before), Pt(after)
    if first is not None:
        p.paragraph_format.first_line_indent = first
    if texto:
        fmt(p.add_run(texto), size, bold)
    return p


def titulo(doc, texto, before=0):
    p = par(doc, texto, 10, True, before=before, after=2)
    p.paragraph_format.keep_with_next = True
    return p


def cel(c, texto, bold=False, align=WD_ALIGN_PARAGRAPH.CENTER, size=8, fundo=None):
    c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    p = c.paragraphs[0]
    p.alignment = align
    p.paragraph_format.space_before = p.paragraph_format.space_after = Pt(1)
    fmt(p.add_run(str(texto)), size, bold)
    if fundo:
        shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:fill"), fundo)
        c._tc.get_or_add_tcPr().append(shd)


def estatistica(item, criterio):
    validos = [float(p.get("valor_atualizado") or p["valor"]) for p in item.get("precos", []) if not p.get("excluido")]
    if not validos:
        return None
    est = {"n": len(validos), "media": round(statistics.mean(validos), 2),
           "mediana": round(statistics.median(validos), 2), "menor": round(min(validos), 2)}
    est["referencia"] = est[{"media": "media", "menor": "menor"}.get(criterio, "mediana")]
    return est


def gerar(d, saida):
    pp = d.get("pesquisa_precos") or {}
    om = d.get("om_signataria") or {}
    erros, avisos = [], []
    for campo, val in (("contrato", d.get("contrato")), ("pag", d.get("pag")), ("om_signataria.nome", om.get("nome"))):
        if not str(val or "").strip():
            erros.append(f"Campo obrigatório vazio: {campo}")
    itens = pp.get("itens") or []
    if not itens:
        erros.append("Pesquisa sem itens: carregar o Termo de Referência do contrato na aba Pesquisa de Preços.")
    if not str(pp.get("fonte_tr") or "").strip():
        avisos.append("Origem do Termo de Referência não informada (fonte_tr).")
    criterio = (pp.get("criterio") or "mediana").lower()
    linhas, tot_ct, tot_ref = [], 0.0, 0.0
    for it in itens:
        est = estatistica(it, criterio)
        if "preco_contratado" not in it:
            erros.append(f"Item {it.get('item')}: falta o preço contratado (unitário do novo período).")
            continue
        if not est:
            erros.append(f"Item {it.get('item')}: nenhum preço válido coletado.")
            continue
        if est["n"] < MIN_PRECOS:
            avisos.append(f"Item {it.get('item')}: só {est['n']} preço(s) válido(s) – justificar na pesquisa "
                          "(IN SEGES/ME nº 65/2021).")
        qtd = float(it.get("quantidade") or 1)
        ct = float(it["preco_contratado"])
        dif = (ct - est["referencia"]) / est["referencia"] * 100 if est["referencia"] else 0.0
        tot_ct += ct * qtd
        tot_ref += est["referencia"] * qtd
        linhas.append((it, est, ct, qtd, dif))
    if erros:
        print("ERROS – Pesquisa de Preços NÃO gerada:")
        for e in erros:
            print("  ❌", e)
        sys.exit(1)
    dif_total = (tot_ct - tot_ref) / tot_ref * 100 if tot_ref else 0.0
    vantajosa = tot_ct <= tot_ref
    if not vantajosa:
        avisos.append(f"🔴 Valor contratado {pct(dif_total)} ACIMA do mercado: negociar redução com a contratada "
                      "ou justificar a vantajosidade antes da prorrogação.")
    for it, est, ct, qtd, dif in linhas:
        if dif > 0:
            avisos.append(f"Item {it.get('item')}: preço contratado {pct(dif)} acima da referência.")

    doc = Document()
    s = doc.sections[0]
    s.orientation = WD_ORIENT.LANDSCAPE
    s.page_width, s.page_height = Cm(29.7), Cm(21.0)
    s.top_margin = s.bottom_margin = Cm(1.5)
    s.left_margin = s.right_margin = Cm(1.8)
    st = doc.styles["Normal"]
    st.font.name = FONTE; st.font.size = Pt(10)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONTE)

    p = par(doc, align=WD_ALIGN_PARAGRAPH.CENTER, after=0)
    brasao = os.path.join(AQUI, "brasao.png")
    if os.path.exists(brasao):
        p.add_run().add_picture(brasao, width=Cm(1.7))
    par(doc, "MINISTÉRIO DA DEFESA", 10, True, WD_ALIGN_PARAGRAPH.CENTER, after=0)
    par(doc, "COMANDO DA AERONÁUTICA", 10, False, WD_ALIGN_PARAGRAPH.CENTER, after=0)
    par(doc, om["nome"].upper(), 10, False, WD_ALIGN_PARAGRAPH.CENTER, after=8)
    par(doc, "PESQUISA DE PREÇOS PARA A PRORROGAÇÃO CONTRATUAL", 11, True, WD_ALIGN_PARAGRAPH.CENTER, after=6)
    p = par(doc, align=WD_ALIGN_PARAGRAPH.CENTER, after=8)
    fmt(p.add_run(f"Contrato de Despesa nº {d['contrato']}   •   Processo (PAG): {d['pag']}"), 10)
    if d.get("numero_aditivo"):
        fmt(p.add_run(f"   •   {int(d['numero_aditivo'])}º Termo Aditivo"), 10)

    crit_txt = {"media": "média", "menor": "menor preço"}.get(criterio, "mediana")
    titulo(doc, "1. OBJETIVO")
    par(doc, "Verificar se os preços do contrato para o novo período de vigência continuam compatíveis com os "
             "praticados no mercado, demonstrando a vantajosidade da prorrogação.", 10, first=Cm(1.0))
    titulo(doc, "2. ITENS PESQUISADOS")
    par(doc, "Itens, códigos, unidades e quantidades extraídos do " + (pp.get("fonte_tr") or "Termo de Referência do contrato") + ".",
        10, first=Cm(1.0))
    titulo(doc, "3. METODOLOGIA")
    par(doc, "Pesquisa realizada no gapmn.app (Licitações > Pesquisa de Preços) com preços praticados em contratações "
             "públicas registradas no Compras.gov.br (API de Dados Abertos), conforme a Instrução Normativa SEGES/ME "
             f"nº 65/2021, com valores atualizados pelo IPCA ({pp.get('atualizacao') or 'até o mês da pesquisa'}). "
             f"Preço de referência de cada item: {crit_txt} dos preços válidos. Data da pesquisa: "
             f"{pp.get('data_pesquisa') or datetime.date.today().strftime('%d/%m/%Y')}.", 10, first=Cm(1.0))
    titulo(doc, "4. QUADRO COMPARATIVO")

    cab = ["Item", "Descrição", "Código", "Unid.", "Qtd", "Preço contratado (novo período)", "Nº de preços",
           "Média", "Mediana", "Menor", "Referência", "Diferença"]
    larg = [1.0, 6.8, 2.0, 1.4, 1.2, 2.4, 1.4, 2.0, 2.0, 2.0, 2.2, 1.7]
    t = doc.add_table(rows=1, cols=len(cab))
    t.style = "Table Grid"; t.alignment = WD_TABLE_ALIGNMENT.CENTER; t.autofit = False
    for gc, w in zip(t._tbl.tblGrid.findall(qn("w:gridCol")), larg):
        gc.set(qn("w:w"), str(int(Cm(w).twips)))
    for c, txt in zip(t.rows[0].cells, cab):
        cel(c, txt, True, fundo="D9D9D9")
    trPr = t.rows[0]._tr.get_or_add_trPr(); e = OxmlElement("w:tblHeader"); e.set(qn("w:val"), "true"); trPr.append(e)
    for it, est, ct, qtd, dif in linhas:
        r = t.add_row().cells
        vals = [it.get("item", ""), it.get("descricao", ""), it.get("codigo", ""), it.get("unidade", ""),
                f"{qtd:g}".replace(".", ","), brl(ct), est["n"], brl(est["media"]), brl(est["mediana"]),
                brl(est["menor"]), brl(est["referencia"]), pct(dif)]
        for i, (c, v) in enumerate(zip(r, vals)):
            cel(c, v, align=WD_ALIGN_PARAGRAPH.LEFT if i == 1 else WD_ALIGN_PARAGRAPH.CENTER,
                fundo=("FDE9E7" if (i == 11 and dif > 0) else None))
    r = t.add_row().cells
    m = r[0].merge(r[4]); cel(m, "TOTAL (preço × quantidade)", True)
    cel(r[5], brl(tot_ct), True)
    m2 = r[6].merge(r[9]); cel(m2, "")
    cel(r[10], brl(tot_ref), True)
    cel(r[11], pct(dif_total), True, fundo=("FDE9E7" if not vantajosa else "E2EFDA"))
    for row in t.rows:
        idx = 0
        for tc in row._tr.findall(qn("w:tc")):
            span = tc.tcPr.find(qn("w:gridSpan")) if tc.tcPr is not None else None
            n = int(span.get(qn("w:val"))) if span is not None else 1
            w = tc.get_or_add_tcPr().get_or_add_tcW(); w.set(qn("w:w"), str(int(sum(Cm(x).twips for x in larg[idx:idx + n])))); w.set(qn("w:type"), "dxa")
            idx += n

    par(doc, "", after=2)
    titulo(doc, "5. PREÇOS CONSULTADOS", before=6)
    for it in itens:
        p = par(doc, after=1)
        fmt(p.add_run(f"Item {it.get('item')}: "), 9, True)
        partes = []
        for pr in it.get("precos", []):
            v = float(pr.get("valor_atualizado") or pr["valor"])
            txt = f"{pr.get('fonte', 'fonte não informada')} ({pr.get('data', '')}) – {brl(v)}"
            if pr.get("excluido"):
                txt += f" [desconsiderado{': ' + pr['motivo_exclusao'] if pr.get('motivo_exclusao') else ''}]"
            partes.append(txt)
        fmt(p.add_run("; ".join(partes) + "."), 9)

    titulo(doc, "6. CONCLUSÃO", before=6)
    if vantajosa:
        concl = (f"O valor total do contrato para o novo período ({brl(tot_ct)}) está {pct(dif_total).lstrip('+-')} "
                 f"{'abaixo' if dif_total < 0 else 'igual ao'} do valor de referência de mercado ({brl(tot_ref)}), "
                 "o que demonstra a vantajosidade da prorrogação contratual.")
        concl = concl.replace("0,00% igual ao do", "igual ao")
    else:
        concl = (f"O valor total do contrato para o novo período ({brl(tot_ct)}) está {pct(dif_total).lstrip('+')} acima "
                 f"do valor de referência de mercado ({brl(tot_ref)}). Antes da prorrogação, a Administração deve "
                 "negociar a redução dos preços com a contratada ou justificar a vantajosidade.")
    pc = par(doc, concl, 10, first=Cm(1.0))
    pc.paragraph_format.keep_with_next = True

    p = par(doc, "Data conforme assinatura eletrônica.", 10, align=WD_ALIGN_PARAGRAPH.RIGHT, before=10, after=30)
    p.paragraph_format.keep_with_next = True
    par(doc, d.get("cargo_responsavel_pesquisa", "Gestor do Contrato"), 10, align=WD_ALIGN_PARAGRAPH.CENTER)

    os.makedirs(saida, exist_ok=True)
    base = os.path.join(saida, "Pesquisa de Precos - CT " + d["contrato"].replace("/", "-"))
    doc.save(base + ".docx")
    pdf = None
    if shutil.which("soffice"):
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", saida, base + ".docx"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pdf = base + ".pdf" if os.path.exists(base + ".pdf") else None
    print("RESUMO – Pesquisa de Preços para a Prorrogação")
    print("  Arquivos:", base + ".docx", "|", pdf or "(PDF: converter no site/LibreOffice)")
    for it, est, ct, qtd, dif in linhas:
        print(f"  Item {it.get('item')}: contratado {brl(ct)} × referência {brl(est['referencia'])} "
              f"({est['n']} preços) → {pct(dif)}")
    print(f"  TOTAL: {brl(tot_ct)} × {brl(tot_ref)} → {pct(dif_total)} | "
          f"{'VANTAJOSA' if vantajosa else 'ACIMA DO MERCADO'}")
    for a in avisos:
        print("  ⚠️", a)
    return base


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        gerar(json.load(f), sys.argv[2])
