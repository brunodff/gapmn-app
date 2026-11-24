#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Gera a LISTA DE VERIFICAÇÃO DE DOCUMENTOS do termo aditivo (.docx).

Uso:  python3 gerar_lista_verificacao.py dados.json saida/
      (brasao.png precisa estar na mesma pasta deste script)

Itens fixos: 1-7, 9-13. Itens condicionais (só entram quando se aplicam):
  8  Calculadora do Cidadão ........ reajuste = true
  14 Consulta CPF do sócio ......... consulta_socio = true
  15 Procuração ................... representante_mudou = true
  16 Atestado de exclusividade .... inexigibilidade = true
  17 Ficha de autorização ......... acima_1_milhao = true
  18 Parecer(es) referencial(is) + atestado(s)  um par para cada parecer que fundamenta alguma alteração (pareceres.py)
  19 Memória de cálculo ........... reajuste = true
A numeração é refeita na ordem acima, sem buracos.
"""
import json, os, sys, datetime
from docx import Document
from docx.shared import Pt, Inches, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTE = "Arial"

# ---------------------------------------------------------------- itens
# chave, texto (lista de trechos: (texto, negrito, italico)), condição
def tem_reajuste(d):
    """Reajuste marcado na aba do aditivo (bloco 'aditivo') ou no campo antigo 'reajuste'."""
    ad = d.get("aditivo")
    if ad is not None:
        return bool(ad.get("reajuste"))
    return bool(d.get("reajuste"))


def passa_1_milhao(d):
    """Ficha de autorização: informada ('acima_1_milhao') ou calculada pelo valor que o contrato passará a ter."""
    if d.get("acima_1_milhao") is not None:
        return bool(d["acima_1_milhao"])
    try:
        sys.path.insert(0, AQUI)
        from gerar_ficha_autorizacao import objeto_e_valores
        _, _, novo = objeto_e_valores(d, [], [])
        return novo is not None and novo > 1_000_000
    except Exception:
        return False


def analise_pareceres(d):
    sys.path.insert(0, AQUI)
    import pareceres
    return pareceres.analisar(d)


def itens_da_lista(d):
    L = []
    def add(chave, trechos, cond=True):
        if cond:
            L.append((chave, trechos))
    add("anuencia_consulta", [("Consulta formal à contratada quanto à anuência para a prorrogação contratual.", False, False)])
    add("anuencia_resposta", [("Resposta da contratada contendo a anuência para a prorrogação contratual.", False, False)])
    add("disp_orcamentaria", [("Declaração de Disponibilidade Orçamentária.", False, False)])
    add("vantajosidade", [("Declaração quanto à vantajosidade da prorrogação contratual.", False, False)])
    add("parecer_tecnico", [("Parecer Técnico sobre Alteração de Contrato aprovado pelo Ordenador de Despesas da UG Signatária.", False, False)])
    add("mapa_riscos", [("Mapa de Riscos para Termo Aditivo ", False, False),
                        ("(Gerenciamento de Riscos da fase de Gestão do Contrato, conforme arts. 20 e 26 da IN nº 05/2017 SEGES/MP).", False, True)])
    add("pesquisa_precos", [("Pesquisa de Preços – ", False, False),
                            ("pesquisa de preços praticados pelo mercado do ramo do objeto, baseada em critérios aceitáveis, "
                             "observando-se a " + d.get("norma_pesquisa_precos", "IN SEGES/ME nº 65/2021") + ", contendo os documentos "
                             "comprobatórios para calcular o custo global, com a verificação da congruência entre os preços das "
                             "propostas, de forma a evitar valores desarrazoados ou evidentemente inexequíveis.", False, True)])
    add("calculadora", [("Calculadora do Cidadão ", False, False),
                        ("(consulta anexada ao Parecer Técnico).", False, True)], tem_reajuste(d))
    add("bol_aci", [("Boletim de Designação do Agente de Controle Interno.", False, False)])
    add("bol_od", [("Boletim de Designação do Ordenador de Despesas.", False, False)])
    add("bol_fiscalizacao", [("Boletim de Designação da Fiscalização atualizado.", False, False)])
    add("sicaf", [("Comprovante de consulta à situação da contratada junto ao SICAF ", False, False),
                  ("(a contratada deverá, ao menos, não estar impedida de licitar; possuir os níveis cadastrados I e II; "
                   "nível III com certidões da Receita Federal, FGTS e Trabalhista válidas; e nível IV ao menos com certidão "
                   "municipal válida).", False, True)])
    add("consulta_cnpj", [("Comprovante de consulta de regularidade junto ao CEIS, CNJ e Lista de Licitantes Inidôneos (TCU) "
                           "para o CNPJ da contratada.", False, False)])
    add("consulta_cpf_socio", [("Comprovante de consulta de regularidade junto ao CEIS, CNJ e Lista de Licitantes Inidôneos (TCU) "
                                "para o CPF do sócio majoritário.", False, False)], d.get("consulta_socio"))
    add("procuracao", [("Procuração do representante competente para assinatura do Termo Aditivo.", False, False)],
        d.get("representante_mudou"))
    add("exclusividade", [("Atestado de Exclusividade válido.", False, False)], d.get("inexigibilidade"))
    add("ficha_autorizacao", [("Ficha para a Autorização da Prorrogação Contratual ", False, False),
                              ("(atividade de custeio acima de R$ 1.000.000,00).", False, True)], passa_1_milhao(d))
    # pareceres referenciais: um bloco (parecer + atestado) para CADA parecer que fundamenta alguma alteração
    for i, p in enumerate(analise_pareceres(d)["pareceres"]):
        num = p["numero"].strip()
        tre = [(num, True, False)]
        if p.get("objeto"):
            tre += [("\nObjeto: ", True, False), (p["objeto"].strip(), False, False)]
        vig = []
        if p.get("data"):
            vig.append("de " + p["data"])
        if p.get("validade"):
            vig.append("válido até " + p["validade"])
        if vig:
            tre += [("\nVigência: ", True, False), (", ".join(vig) + ".", False, False)]
        tre += [("\nMotivo: ", True, False), (p["motivo_texto"], False, False)]
        suf = "" if i == 0 else f"_{i + 1}"
        add("parecer_referencial" + suf, tre)
        add("atestado_adequacao" + suf, [("Atestado de adequação ao " + num + ".", False, False)])
    add("memoria_calculo", [("Memória de Cálculo – Reajuste.", False, False)], tem_reajuste(d))
    return L

def parecer_vencido(pr):
    try:
        dv = datetime.datetime.strptime(pr.get("validade", ""), "%d/%m/%Y").date()
    except ValueError:
        return False
    return dv < datetime.date.today()

# ---------------------------------------------------------------- helpers
def fmt_run(r, size=10, bold=False, italic=False, color=None):
    r.font.name = FONTE
    r._element.rPr.rFonts.set(qn("w:eastAsia"), FONTE)
    r.font.size = Pt(size)
    r.bold = bold
    r.italic = italic
    if color:
        r.font.color.rgb = RGBColor.from_string(color)

def par(doc_or_cell, texto="", size=10, bold=False, align=None, before=0, after=0, italic=False, indent_first=None, color=None):
    p = doc_or_cell.add_paragraph()
    if texto:
        fmt_run(p.add_run(texto), size, bold, italic, color)
    pf = p.paragraph_format
    pf.space_before = Pt(before); pf.space_after = Pt(after)
    if align is not None:
        p.alignment = align
    if indent_first is not None:
        pf.first_line_indent = indent_first
    return p

def set_cell_margins(table, top=40, bottom=40, left=70, right=70):
    tblPr = table._tbl.tblPr
    m = OxmlElement("w:tblCellMar")
    for k, v in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        e = OxmlElement("w:" + k); e.set(qn("w:w"), str(v)); e.set(qn("w:type"), "dxa"); m.append(e)
    tblPr.append(m)

def repeat_header(row):
    trPr = row._tr.get_or_add_trPr()
    e = OxmlElement("w:tblHeader"); e.set(qn("w:val"), "true"); trPr.append(e)

def cant_split(row):
    trPr = row._tr.get_or_add_trPr()
    e = OxmlElement("w:cantSplit"); e.set(qn("w:val"), "true"); trPr.append(e)

def cell_text(cell, trechos, align=WD_ALIGN_PARAGRAPH.LEFT, size=10):
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    p = cell.paragraphs[0]
    p.alignment = align
    p.paragraph_format.space_after = Pt(0)
    for texto, b, i in trechos:
        partes = texto.split("\n")
        for k, parte in enumerate(partes):
            if k > 0:
                p = cell.add_paragraph(); p.alignment = align
                p.paragraph_format.space_after = Pt(0)
            if parte:
                fmt_run(p.add_run(parte), size, b, i)

# ---------------------------------------------------------------- geração
def gerar(d, saida):
    erros, avisos = [], []
    # Agente de Controle Interno: sempre da OM que assinou o contrato
    om_sig = d.get("om_signataria") or {}
    if not d.get("om_aci") and om_sig.get("sigla"):
        d["om_aci"] = om_sig["sigla"]
        d.setdefault("artigo_aci", om_sig.get("artigo", "do"))
    for campo in ("om_nome", "pag", "contrato", "om_aci"):
        if not str(d.get(campo, "")).strip():
            erros.append(f"Campo obrigatório vazio: {campo}")

    itens = itens_da_lista(d)
    chaves = [c for c, _ in itens]
    nao = d.get("nao_anexados") or {}           # {chave: justificativa}
    for k in nao:
        if k not in chaves:
            avisos.append(f"'nao_anexados' cita '{k}', que não está na lista deste aditivo (ignorado).")
    for k, j in nao.items():
        if k in chaves and not str(j).strip():
            erros.append(f"Item '{k}' marcado como NÃO anexado sem justificativa.")

    import pareceres
    an = analise_pareceres(d)
    obs_parecer = None
    if not pareceres.pareceres(d):
        avisos.append("Nenhum parecer referencial aplicável: o aditivo PRECISA de análise jurídica da CJU.")
    else:
        obs_parecer = pareceres.frase_observacao(an)
        for p in an["vencidos"]:
            avisos.append(f"Parecer {p['numero']} vencido em {p.get('validade')}: não entra na lista.")
        if an["descobertas"]:
            avisos.append("🔴 Sem parecer referencial vigente para: " + pareceres.lista_juntada(an["descobertas"]) +
                          " → o termo aditivo PRECISA de análise jurídica da CJU (registrado na Observação).")
        for p in an["pareceres"]:
            if not p.get("validade"):
                avisos.append(f"Validade do {p['numero']} não informada.")
    if erros:
        print("ERROS – documento NÃO gerado:")
        for e in erros: print("  ❌", e)
        sys.exit(1)

    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Inches(8.5), Inches(11)
    sec.top_margin = sec.bottom_margin = Inches(0.5)
    sec.left_margin = sec.right_margin = Inches(0.5)
    st = doc.styles["Normal"]
    st.font.name = FONTE; st.font.size = Pt(10)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONTE)

    # cabeçalho
    p = par(doc, align=WD_ALIGN_PARAGRAPH.CENTER)
    brasao = os.path.join(AQUI, "brasao.png")
    if os.path.exists(brasao):
        p.add_run().add_picture(brasao, width=Inches(0.78))
    else:
        avisos.append("brasao.png não encontrado ao lado do script: documento sem brasão.")
    par(doc, "MINISTÉRIO DA DEFESA", 10, True, WD_ALIGN_PARAGRAPH.CENTER)
    par(doc, "COMANDO DA AERONÁUTICA", 10, False, WD_ALIGN_PARAGRAPH.CENTER)
    par(doc, d["om_nome"].upper(), 10, False, WD_ALIGN_PARAGRAPH.CENTER, after=14)

    titulo = d.get("titulo", "LISTA DE VERIFICAÇÃO DE DOCUMENTOS PARA PRORROGAÇÃO")
    p = par(doc, titulo, 11, True, WD_ALIGN_PARAGRAPH.CENTER)
    par(doc, after=6)

    p = par(doc, "Processo nº: ", 10, False); fmt_run(p.add_run(d["pag"]), 10, True)
    p = par(doc, "Contrato de Despesa nº: ", 10, False, after=8); fmt_run(p.add_run(d["contrato"]), 10, True)

    # tabela
    t = doc.add_table(rows=1, cols=4)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_cell_margins(t)
    larg = [Cm(1.0), Cm(15.6), Cm(1.2), Cm(1.2)]
    hdr = t.rows[0]
    for c, txt in zip(hdr.cells, ("Nº", "DOCUMENTAÇÃO INSERIDA PELO FISCAL", "SIM", "NÃO")):
        cell_text(c, [(txt, True, False)], WD_ALIGN_PARAGRAPH.CENTER)
        shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:fill"), "D9D9D9")
        c._tc.get_or_add_tcPr().append(shd)
    repeat_header(hdr)

    obs_itens = []
    for n, (chave, trechos) in enumerate(itens, 1):
        r = t.add_row(); cant_split(r)
        cell_text(r.cells[0], [(str(n), False, False)], WD_ALIGN_PARAGRAPH.CENTER)
        cell_text(r.cells[1], trechos)
        anexado = chave not in nao
        cell_text(r.cells[2], [("X" if anexado else "", False, False)], WD_ALIGN_PARAGRAPH.CENTER)
        cell_text(r.cells[3], [("" if anexado else "X", False, False)], WD_ALIGN_PARAGRAPH.CENTER)
        if not anexado:
            nome = "".join(tx for tx, _, _ in trechos).split("\n")[0].split(" (")[0].split(" – ")[0].rstrip(". ")
            obs_itens.append(f"item {n} ({nome}): {nao[chave].strip()}")
    t.autofit = False
    grid = t._tbl.tblGrid
    for gc, w in zip(grid.findall(qn("w:gridCol")), larg):
        gc.set(qn("w:w"), str(int(w.twips)))
    for row in t.rows:
        for c, w in zip(row.cells, larg):
            c.width = w

    # declaração e observação
    fechamento = [par(doc, after=4)]
    fechamento.append(par(doc, "Declaro, para os devidos fins legais, que o(s) agente(s) que atestou(aram) os documentos em anexo "
             "está(ão) apto(s) para esse fim.", 10, align=WD_ALIGN_PARAGRAPH.JUSTIFY, indent_first=Cm(1.25), after=6))
    obs = list(obs_itens)
    if obs_parecer:
        obs.append(obs_parecer)
    if str(d.get("observacao", "")).strip():
        obs.append(d["observacao"].strip())
    p = par(doc, align=WD_ALIGN_PARAGRAPH.JUSTIFY, indent_first=Cm(1.25))
    fechamento.append(p)
    fmt_run(p.add_run("Observação: "), 10, True)
    if obs:
        fmt_run(p.add_run("; ".join(obs).rstrip(".") + "."), 10)
    else:
        fmt_run(p.add_run(d.get("observacao_vazia", "não há.")), 10)

    fechamento.append(par(doc, before=18))
    # data + assinaturas ficam sempre juntas na mesma página
    bloco = [par(doc, "Data conforme assinatura eletrônica.", 10, align=WD_ALIGN_PARAGRAPH.RIGHT, after=40)]

    def assinatura(cargo):
        bloco.append(par(doc, "___________________________________________", 10, align=WD_ALIGN_PARAGRAPH.CENTER))
        bloco.append(par(doc, cargo, 10, align=WD_ALIGN_PARAGRAPH.CENTER, after=48))
    assinatura(d.get("cargo_gestor", "Gestor do Contrato"))
    assinatura("Agente de Controle Interno " + d.get("artigo_aci", "do") + " " + d["om_aci"])
    for p in bloco[:-1]:
        p.paragraph_format.keep_with_next = True
    # declaração, observação e a última linha da tabela ficam presas ao bloco de assinaturas
    for p in fechamento:
        p.paragraph_format.keep_with_next = True
    for c in t.rows[-1].cells:
        for p in c.paragraphs:
            p.paragraph_format.keep_with_next = True

    os.makedirs(saida, exist_ok=True)
    nome_arq = "Lista de Verificacao - CT " + d["contrato"].replace("/", "-") + ".docx"
    caminho = os.path.join(saida, nome_arq)
    doc.save(caminho)

    print("RESUMO – Lista de Verificação")
    print("  Arquivo:", caminho)
    print("  Contrato:", d["contrato"], "| PAG:", d["pag"], "| OM:", d["om_nome"])
    for n, (chave, trechos) in enumerate(itens, 1):
        marca = "SIM" if chave not in nao else "NÃO"
        print(f"  {n:>2}. [{marca}] {trechos[0][0].strip()[:80]}")
    for a in avisos:
        print("  ⚠️", a)
    return caminho

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        dados = json.load(f)
    gerar(dados, sys.argv[2])
