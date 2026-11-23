# -*- coding: utf-8 -*-
"""
Checklist do fiscal – LISTA DE VERIFICAÇÃO DE DOCUMENTOS PARA REAJUSTE CONTRATUAL.

Mesmo padrão do checklist do robô offline da SCON/GAP-MN (robo_fiscal.html / robo_scon.html):
- 8 itens fixos, na mesma ordem e com o mesmo texto;
- o fiscal marca SIM ou NÃO em cada item (um exclui o outro);
- só quando marca NÃO ele escreve a justificativa;
- no documento: tabela Nº | ITENS | SIM | NÃO, com "X" na coluna marcada; a seguir a declaração,
  a "Observação:" (justificativas dos itens NÃO, no formato "Item N: texto", separadas por " | ";
  sem nenhuma, o texto padrão), "Data conforme assinatura eletrônica." e a assinatura do
  Agente de Controle Interno (só linha e cargo, sem nome).

Uso no código:
    from apostilamento.checklist import CHECKLIST_ITENS, checklist_vazio, gerar_checklist
    marcacoes = checklist_vazio()            # [{"texto":..., "sim":False, "nao":False, "obs":""}, ...]
    marcacoes[0]["sim"] = True ...
    avisos = gerar_checklist(dados, marcacoes, "5 - Checklist.docx")
"""
from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

try:
    from . import gerar_apostilamento as ga
except ImportError:                      # script solto no kit da skill
    import gerar_apostilamento as ga

CHECKLIST_ITENS = [
    "Memória de Cálculo para o Reajuste",
    "Comprovante do cálculo da Calculadora do Cidadão (Banco Central) ou fonte equivalente (ex.: FGV, para o INCC)",
    "Parecer Técnico de Reajustamento",
    "Declaração de Disponibilidade Orçamentária",
    "Procuração do representante competente para assinatura do Termo de Apostilamento (se diferente de quem assinou o contrato)",
    "Cópia de designação do Ordenador de Despesas",
    "Cópia de designação do Agente de Controle Interno",
    "Cópia de designação da Fiscalização",
]
TITULO = "LISTA DE VERIFICAÇÃO DE DOCUMENTOS PARA REAJUSTE CONTRATUAL"
DECLARACAO = ("Declaro, para os devidos fins legais, que o(s) agente(s) que atestou(aram) os documentos em anexo "
              "está(ão) apto(s) para esse fim.")
OBS_PADRAO = "Utilizar/justificar caso algum dos documentos não seja remetido."
AZUL = "1F3864"
LINHA_ASSINATURA = "_______________________________________"


def checklist_vazio():
    return [{"texto": t, "sim": False, "nao": False, "obs": ""} for t in CHECKLIST_ITENS]


def normalizar(marcacoes):
    """Aceita a lista completa (com "texto") ou só as marcações na ordem dos itens.
    Garante SIM/NÃO exclusivos (se vierem os dois, vale o NÃO) e descarta justificativa de item SIM."""
    base = checklist_vazio()
    for i, m in enumerate(marcacoes or []):
        if i >= len(base):
            break
        if isinstance(m, str):
            m = {"sim": m.upper() == "SIM", "nao": m.upper() in ("NAO", "NÃO")}
        nao = bool(m.get("nao"))
        sim = bool(m.get("sim")) and not nao
        base[i].update(sim=sim, nao=nao, obs=(str(m.get("obs") or "").strip() if nao else ""))
    return base


def conferir(marcacoes):
    """Avisos para a tela do site (não impedem a geração – o robô antigo também não impedia)."""
    av = []
    for i, it in enumerate(normalizar(marcacoes), 1):
        if not it["sim"] and not it["nao"]:
            av.append(f"Item {i} sem marcação (SIM ou NÃO).")
        elif it["nao"] and not it["obs"]:
            av.append(f"Item {i} marcado NÃO sem justificativa.")
    return av


def _par(doc, texto="", bold=False, centro=False, justificado=False, size=11, after=6, before=0, underline=False):
    p = doc.add_paragraph()
    if texto:
        r = p.add_run(texto); r.bold = bold; r.underline = underline; r.font.size = Pt(size)
    if centro:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    elif justificado:
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.space_after = Pt(after); p.paragraph_format.space_before = Pt(before)
    return p


def _borda_azul(p):
    pPr = p._p.get_or_add_pPr(); b = OxmlElement("w:pBdr"); bt = OxmlElement("w:bottom")
    for k, v in (("w:val", "single"), ("w:sz", "8"), ("w:space", "4"), ("w:color", AZUL)):
        bt.set(qn(k), v)
    b.append(bt); pPr.append(b)


def _cel(c, texto, bold=False, centro=False, largura=None):
    c.text = ""
    p = c.paragraphs[0]
    if centro:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(str(texto)); r.bold = bold; r.font.size = Pt(10)
    c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    tcPr = c._tc.get_or_add_tcPr(); mar = OxmlElement("w:tcMar")
    for lado, v in (("top", 60), ("bottom", 60), ("left", 100), ("right", 100)):
        e = OxmlElement(f"w:{lado}"); e.set(qn("w:w"), str(v)); e.set(qn("w:type"), "dxa"); mar.append(e)
    tcPr.append(mar)
    if largura:
        c.width = Cm(largura)


def _om(dados):
    return (dados.get("om_nome") or dados.get("om_contratante_nome") or dados.get("termo_om_nome")
            or dados.get("om_contratante") or "[OM SIGNATÁRIA]")


def _tipo(dados):
    t = dados.get("tipo_contrato") or dados.get("natureza_contrato") or "Despesa"
    return {"RECEITA": "Receita", "DESPESA": "Despesa"}.get(str(t).upper(), str(t))


def dados_de_registro(reg):
    """Dados do checklist a partir de um registro da carga do SILOMS."""
    d = dict(reg.get("dados") or {})
    sil = reg.get("siloms") or {}
    chave = reg.get("chave", "")
    prefixo = chave.split(" ")[0]
    d.setdefault("contrato", chave.split(" ", 1)[-1] if prefixo in ("RECEITA", "ADESÃO", "CREDENCIAMENTO") else chave)
    d.setdefault("tipo_contrato", "Receita" if (prefixo == "RECEITA" or str(sil.get("natureza", "")).upper().startswith("REC"))
                 else "Despesa")
    d.setdefault("om_contratante_nome", d.get("termo_om_nome") or ga.DEFAULTS["ug_apoio"]["nome"])
    return d


def gerar_checklist(dados, marcacoes, caminho):
    """Gera o .docx do checklist. dados: JSON do contrato (motor) ou registro da carga ("dados").
    Devolve a lista de avisos de conferir()."""
    itens = normalizar(marcacoes)
    doc = Document()
    st = doc.styles["Normal"]; st.font.name = "Calibri"; st.font.size = Pt(11)
    rpr = st.element.get_or_add_rPr(); rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts"); rpr.append(rf)
    for k in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rf.set(qn(k), "Calibri")
    s = doc.sections[0]
    s.page_width, s.page_height = Cm(21.0), Cm(29.7)
    s.top_margin, s.right_margin, s.bottom_margin, s.left_margin = Cm(2.5), Cm(2.0), Cm(2.0), Cm(3.0)

    # cabeçalho com timbre (OM sublinhada e filete azul, como no robô)
    br = ga.BRASAO_PATH or ga.achar_brasao(dados)
    if br:
        p = _par(doc, centro=True, after=2); p.add_run().add_picture(br, width=Cm(1.64))
    _par(doc, "MINISTÉRIO DA DEFESA", bold=True, centro=True, size=12, after=0)
    _par(doc, "COMANDO DA AERONÁUTICA", bold=True, centro=True, size=12, after=0)
    p = _par(doc, _om(dados).upper(), centro=True, size=12, after=2, underline=True)
    _borda_azul(p)
    _par(doc)
    _par(doc, TITULO, bold=True, centro=True, size=12, after=2)
    _par(doc, f"CONTRATO DE {_tipo(dados).upper()} Nº: {dados.get('contrato') or 'XXX/GAPMN-XXXX/XXXX'}",
         bold=True, centro=True, size=12, after=2)
    _par(doc)

    larg = [1.2, 11.5, 1.5, 1.5]
    t = doc.add_table(rows=1, cols=4)
    tblPr = t._tbl.tblPr; b = OxmlElement("w:tblBorders")
    for lado in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{lado}")
        for k, v in (("w:val", "single"), ("w:sz", "4"), ("w:space", "0"), ("w:color", "000000")):
            e.set(qn(k), v)
        b.append(e)
    tblPr.append(b)
    for i, h in enumerate(["Nº", "ITENS", "SIM", "NÃO"]):
        _cel(t.rows[0].cells[i], h, bold=True, centro=True, largura=larg[i])
    for n, it in enumerate(itens, 1):
        c = t.add_row().cells
        _cel(c[0], n, centro=True, largura=larg[0])
        _cel(c[1], it["texto"], largura=larg[1])
        _cel(c[2], "X" if it["sim"] else "", centro=True, largura=larg[2])
        _cel(c[3], "X" if it["nao"] else "", centro=True, largura=larg[3])
    t.autofit = False
    for i, gc in enumerate(t._tbl.tblGrid.findall(qn("w:gridCol"))):
        gc.set(qn("w:w"), str(int(larg[i] * 567)))

    _par(doc)
    _par(doc, DECLARACAO, justificado=True)
    obs = [f"Item {i}: {it['obs']}" for i, it in enumerate(itens, 1) if it["nao"] and it["obs"]]
    _par(doc, "Observação: " + (" | ".join(obs) if obs else OBS_PADRAO))
    _par(doc)
    _par(doc, "Data conforme assinatura eletrônica.", centro=True)
    aci = (dados.get("aci") or {}).get("funcao") or f"Agente de Controle Interno do(a) {_om(dados)}"
    _par(doc); _par(doc)
    _par(doc, LINHA_ASSINATURA, centro=True, after=0)
    _par(doc, aci, centro=True, after=0)
    doc.save(caminho)
    return conferir(itens)
