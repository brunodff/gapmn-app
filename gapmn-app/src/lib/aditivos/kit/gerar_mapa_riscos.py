#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Gera o MAPA DE RISCOS REFERENTE À PRORROGAÇÃO CONTRATUAL (.docx).

Uso:  python3 gerar_mapa_riscos.py dados.json saida/
      (brasao.png na mesma pasta deste script)

Regras (Chefe da SCON):
- Cabeçalho: OM QUE ASSINOU O CONTRATO (om_signataria.nome).
- "Contrato de Despesa nº <contrato>".
- As Notas Explicativas da IN SEGES/MP nº 05/2017 NÃO entram no documento (ficam só como ajuda ao fiscal).
- Fase de Análise: "Gestão de Contrato – <N>º Termo Aditivo a ser firmado".
- Cada risco: nome, probabilidade (Baixa/Média/Alta), impacto (Baixo/Médio/Alto), dano,
  ação preventiva e ação de contingência (responsável padrão: FISCAL). O X sai na opção escolhida.
- Fechamento: "Data conforme assinatura digital." e só o cargo "Gestor do Contrato".

dados.json → chave "riscos": lista de
  {"nome": "...", "probabilidade": "Baixa|Média|Alta", "impacto": "Baixo|Médio|Alto",
   "dano": "...", "acao_preventiva": "...", "acao_contingencia": "...",
   "responsavel_preventiva": "FISCAL", "responsavel_contingencia": "FISCAL"}
"""
import json, os, sys, unicodedata
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTE = "Arial"
AZUL = "8EAADB"      # faixa de "FASE DE ANÁLISE" e do nome do risco (cor do modelo)
AZUL_CLARO = "B4C6E7"  # subtítulos (Dano, Ação Preventiva, Responsável...)
PROB = ["Baixa", "Média", "Alta"]
IMP = ["Baixo", "Médio", "Alto"]
GRID = [Inches(1.45), Inches(1.55), Inches(1.55), Inches(2.0)]


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower().strip()


def normaliza(valor, opcoes):
    for o in opcoes:
        if sem_acento(valor) == sem_acento(o):
            return o
    return None


def ordinal(n):
    return f"{int(n)}º"


def fmt(r, size=10, bold=False, italic=False, underline=False):
    r.font.name = FONTE
    r._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONTE)
    r.font.size = Pt(size)
    r.bold, r.italic, r.underline = bold, italic, underline
    return r


def par(doc, texto="", size=10, bold=False, align=WD_ALIGN_PARAGRAPH.CENTER, before=0, after=0, underline=False):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before, p.paragraph_format.space_after = Pt(before), Pt(after)
    if texto:
        fmt(p.add_run(texto), size, bold, underline=underline)
    return p


def sombrear(cell, cor):
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), cor)
    cell._tc.get_or_add_tcPr().append(shd)


def escrever(cell, texto, align=WD_ALIGN_PARAGRAPH.LEFT, bold=False, size=10, cor=None, altura_min=None):
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    linhas = str(texto).split("\n")
    p = cell.paragraphs[0]
    for i, linha in enumerate(linhas):
        if i:
            p = cell.add_paragraph()
        p.alignment = align
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(1)
        if linha:
            fmt(p.add_run(linha), size, bold)
    if cor:
        sombrear(cell, cor)


def nao_quebrar(row):
    trPr = row._tr.get_or_add_trPr()
    e = OxmlElement("w:cantSplit"); e.set(qn("w:val"), "true"); trPr.append(e)


def manter_com_proxima(row):
    for c in row.cells:
        for p in c.paragraphs:
            p.paragraph_format.keep_with_next = True


def linha_cheia(t, texto, cor=None, bold=False, align=WD_ALIGN_PARAGRAPH.CENTER, manter=True):
    r = t.add_row(); nao_quebrar(r)
    c = r.cells[0].merge(r.cells[3])
    escrever(c, texto, align, bold, cor=cor)
    if manter:
        manter_com_proxima(r)
    return r


def linha_escala(t, rotulo, opcoes, escolhida):
    r = t.add_row(); nao_quebrar(r); manter_com_proxima(r)
    escrever(r.cells[0], rotulo + ":", WD_ALIGN_PARAGRAPH.CENTER)
    for c, o in zip(r.cells[1:], opcoes):
        escrever(c, f"( {'X' if o == escolhida else '  '} ) {o}", WD_ALIGN_PARAGRAPH.CENTER)


def linha_acao(t, titulo, texto, responsavel, ultima=False):
    # ultima=True quebra a corrente de keep_with_next entre um risco e o seguinte
    # (cada bloco de risco fica inteiro numa página, mas a tabela pode quebrar entre riscos)
    r = t.add_row(); nao_quebrar(r); manter_com_proxima(r)
    c = r.cells[0].merge(r.cells[2])
    escrever(c, titulo, WD_ALIGN_PARAGRAPH.CENTER, cor=AZUL_CLARO)
    escrever(r.cells[3], "Responsável", WD_ALIGN_PARAGRAPH.CENTER, cor=AZUL_CLARO)
    r = t.add_row(); nao_quebrar(r)
    if not ultima:
        manter_com_proxima(r)
    c = r.cells[0].merge(r.cells[2])
    escrever(c, texto, WD_ALIGN_PARAGRAPH.JUSTIFY)
    escrever(r.cells[3], responsavel.upper(), WD_ALIGN_PARAGRAPH.CENTER)


def gerar(d, saida):
    erros, avisos = [], []
    om = d.get("om_signataria") or {}
    for campo, val in (("contrato", d.get("contrato")), ("om_signataria.nome", om.get("nome")),
                       ("numero_aditivo", d.get("numero_aditivo"))):
        if not str(val or "").strip():
            erros.append(f"Campo obrigatório vazio: {campo}")
    riscos = d.get("riscos") or []
    if not riscos:
        erros.append("Nenhum risco informado (chave 'riscos').")
    for i, rk in enumerate(riscos, 1):
        for k in ("nome", "dano", "acao_preventiva", "acao_contingencia"):
            if not str(rk.get(k) or "").strip():
                erros.append(f"Risco {i:02d}: campo '{k}' vazio.")
        if not normaliza(rk.get("probabilidade"), PROB):
            erros.append(f"Risco {i:02d}: probabilidade deve ser Baixa, Média ou Alta.")
        if not normaliza(rk.get("impacto"), IMP):
            erros.append(f"Risco {i:02d}: impacto deve ser Baixo, Médio ou Alto.")
    if len(riscos) == 1:
        avisos.append("Só 1 risco informado; o modelo prevê pelo menos 2. Conferir com o fiscal.")
    if erros:
        print("ERROS – Mapa de Riscos NÃO gerado:")
        for e in erros:
            print("  ❌", e)
        sys.exit(1)

    doc = Document()
    s = doc.sections[0]
    s.page_width, s.page_height = Inches(8.2681), Inches(11.6929)
    s.top_margin, s.bottom_margin = Inches(0.7362), Inches(0.5516)
    s.left_margin, s.right_margin = Inches(0.9846), Inches(0.7091)
    st = doc.styles["Normal"]
    st.font.name = FONTE; st.font.size = Pt(10)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONTE)

    p = par(doc)
    brasao = os.path.join(AQUI, "brasao.png")
    if os.path.exists(brasao):
        p.add_run().add_picture(brasao, width=Inches(0.83))
    else:
        avisos.append("brasao.png não encontrado: mapa sem brasão.")
    par(doc, "MINISTÉRIO DA DEFESA", 10, True)
    par(doc, "COMANDO DA AERONÁUTICA", 10)
    par(doc, om["nome"].upper(), 10, after=12)
    par(doc, "MAPA DE RISCOS REFERENTE À PRORROGAÇÃO CONTRATUAL", 12, True, underline=True, after=8)
    par(doc, f"Contrato de Despesa nº {d['contrato']}", 12, after=8)

    t = doc.add_table(rows=0, cols=4)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    for gc, w in zip(t._tbl.tblGrid.findall(qn("w:gridCol")), GRID):
        gc.set(qn("w:w"), str(int(w.twips)))

    linha_cheia(t, "FASE DE ANÁLISE", AZUL)
    linha_cheia(t, f"Gestão de Contrato – {ordinal(d['numero_aditivo'])} Termo Aditivo a ser firmado",
                align=WD_ALIGN_PARAGRAPH.LEFT)
    for i, rk in enumerate(riscos, 1):
        ultimo = i == len(riscos)
        linha_cheia(t, f"RISCO {i:02d} – {rk['nome'].strip()}", AZUL)
        linha_escala(t, "Probabilidade", PROB, normaliza(rk["probabilidade"], PROB))
        linha_escala(t, "Impacto", IMP, normaliza(rk["impacto"], IMP))
        linha_cheia(t, "Dano", AZUL_CLARO, bold=True)
        linha_cheia(t, rk["dano"].strip(), align=WD_ALIGN_PARAGRAPH.JUSTIFY)
        linha_acao(t, "Ação Preventiva", rk["acao_preventiva"].strip(), rk.get("responsavel_preventiva") or "FISCAL")
        linha_acao(t, "Ação de Contingência", rk["acao_contingencia"].strip(),
                   rk.get("responsavel_contingencia") or "FISCAL", ultima=not ultimo)
    # larguras das células conforme o gridSpan de cada uma
    for row in t.rows:
        tcs = row._tr.findall(qn("w:tc"))
        idx = 0
        for tc in tcs:
            span = tc.tcPr.find(qn("w:gridSpan")) if tc.tcPr is not None else None
            n = int(span.get(qn("w:val"))) if span is not None else 1
            w = sum(int(g.twips) for g in GRID[idx:idx + n])
            tcW = tc.get_or_add_tcPr().get_or_add_tcW()
            tcW.set(qn("w:w"), str(w)); tcW.set(qn("w:type"), "dxa")
            idx += n

    # o último bloco de risco (encadeado com keep_with_next) acompanha a data e a assinatura:
    # se não couber tudo, o bloco inteiro desce junto e a assinatura nunca fica sozinha.
    p = par(doc, "Data conforme assinatura digital.", 10, align=WD_ALIGN_PARAGRAPH.RIGHT, before=12, after=36)
    p.paragraph_format.keep_with_next = True
    par(doc, d.get("cargo_gestor", "Gestor do Contrato"), 10)

    os.makedirs(saida, exist_ok=True)
    caminho = os.path.join(saida, "Mapa de Riscos - CT " + d["contrato"].replace("/", "-") + ".docx")
    doc.save(caminho)
    print("RESUMO – Mapa de Riscos")
    print("  Arquivo:", caminho)
    print(f"  OM signatária: {om['nome']} | Contrato {d['contrato']} | {ordinal(d['numero_aditivo'])} Termo Aditivo")
    for i, rk in enumerate(riscos, 1):
        print(f"  RISCO {i:02d} – {rk['nome'][:70]} | P: {normaliza(rk['probabilidade'], PROB)} | "
              f"I: {normaliza(rk['impacto'], IMP)}")
    for a in avisos:
        print("  ⚠️", a)
    return caminho


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        gerar(json.load(f), sys.argv[2])
