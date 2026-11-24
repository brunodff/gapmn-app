#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Gera a FICHA PARA A AUTORIZAÇÃO DA PRORROGAÇÃO CONTRATUAL (.docx) – item da Lista de
Verificação que só entra quando o aditivo passa de R$ 1.000.000,00.

Uso:  python3 gerar_ficha_autorizacao.py dados.json saida/

Regras (Chefe da SCON, 24/11/2026) – campos da versão corrigida do modelo:
  Cabeçalho  OM que ASSINA o contrato (nome por extenso).
  1/2        UG signatária: só a SIGLA da OM que assina o contrato / código da UG dela
             (GAP-MN = 120630; das outras OMs o código é informado por quem gera, se não houver no cadastro).
  3/4        UG executora: SEMPRE "GRUPAMENTO DE APOIO DE MANAUS" / 120630.
  5/6/7      nº do contrato / nº do termo aditivo / nº do PAG.
  8          Objeto e finalidade: uma linha (I, II, III...) para cada opção marcada no aditivo
             (prorrogação com ou sem valor, reajuste, acréscimo, supressão).
  9          Mérito administrativo: texto escrito pelo fiscal.
  10         Vigência do termo aditivo (de ... A ...).
  11         Valor atual do contrato = valor vigente NESTE período (inicial + acréscimos + reajustes − supressões),
             NÃO a soma de todas as prorrogações.
  12         Valor do termo aditivo = quanto o contrato passará a valer.
  13         TODOS os pareceres referenciais vigentes necessários para fundamentar cada alteração do aditivo
             (nº, ementa, vigência e motivo); alteração sem parecer referencial → aviso + parecer jurídico (CJU).
  14         Nº e data de aprovação do parecer jurídico (em branco se não houver).
  15/16      Ratificação / aprovação pela autoridade superior – opcionais.
  17/18      Ordenador de Despesas / Agente de Controle Interno DA OM QUE ASSINA o contrato.
  19         "Diretor de Administração da Aeronáutica" se a OM for do CEFA (GAP-MN ou Prefeitura);
             nas demais, o cargo é informado por quem gera ("autoridade_superior").
"""
import json, os, re, sys, datetime, calendar
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTE = "Arial"
UG_EXECUTORA = ("GRUPAMENTO DE APOIO DE MANAUS", "120630")
UGS_CONHECIDAS = {"GAP-MN": "120630"}          # cadastro: ir completando conforme as OMs forem informadas
OMS_CEFA = ("GAP-MN", "PAMN", "PREFEITURA")      # OMs cujo nível superior é a DIRAD
LIMITE_ALTERACAO = 25.0                          # art. 125 da Lei 14.133/2021 (50% em reforma)
GRID = [Cm(3.0)] * 6

UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
            "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta"]


def extenso(n):
    n = int(n)
    if n < 20:
        return UNIDADES[n]
    d, u = divmod(n, 10)
    return DEZENAS[d] + (" e " + UNIDADES[u] if u else "")


def brl(v):
    s = f"{float(v):,.2f}"
    return "R$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


def num(v):
    if isinstance(v, (int, float)):
        return float(v)
    return float(str(v).replace("R$", "").replace(".", "").replace(",", ".").strip())


def data(s):
    return datetime.datetime.strptime(s, "%d/%m/%Y").date()


def somar_meses(d, meses):
    m = d.month - 1 + meses
    a, m = d.year + m // 12, m % 12 + 1
    return datetime.date(a, m, min(d.day, calendar.monthrange(a, m)[1]))


def eh_cefa(om):
    alvo = (om.get("sigla", "") + " " + om.get("nome", "")).upper()
    return any(x in alvo for x in OMS_CEFA) or "GRUPAMENTO DE APOIO DE MANAUS" in alvo


# ------------------------------------------------------------------ formatação
def fmt(r, size=9, bold=False, italic=False):
    r.font.name = FONTE
    r._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONTE)
    r.font.size = Pt(size)
    r.bold, r.italic = bold, italic
    return r


def par(doc, texto="", size=10, bold=False, align=WD_ALIGN_PARAGRAPH.CENTER, after=0):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.space_before = Pt(0)
    if texto:
        fmt(p.add_run(texto), size, bold)
    return p


def escrever(cell, texto, align=WD_ALIGN_PARAGRAPH.LEFT, bold=False, size=9, centro_v=True):
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER if centro_v else WD_CELL_VERTICAL_ALIGNMENT.TOP
    for i, linha in enumerate(str(texto).split("\n")):
        p = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        p.alignment = align
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(1)
        if linha:
            fmt(p.add_run(linha), size, bold)


def linha(t, partes):
    """partes: lista de (span, texto, align, bold)"""
    r = t.add_row()
    trPr = r._tr.get_or_add_trPr()
    e = OxmlElement("w:cantSplit"); e.set(qn("w:val"), "true"); trPr.append(e)
    col = 0
    for span, texto, align, bold in partes:
        c = r.cells[col]
        if span > 1:
            c = c.merge(r.cells[col + span - 1])
        escrever(c, texto, align, bold)
        col += span
    return r


def campo_aprovacao(info):
    if info and str(info.get("numero", "")).strip():
        return f"Nº {info['numero']},\nDE {info.get('data') or '____/_______/____'}."
    return "Nº _________,\nDE____/_______/____."


# ------------------------------------------------------------------ objeto e valores
def objeto_e_valores(d, erros, avisos):
    ad = d.get("aditivo") or {}
    ct = d["contrato"]
    linhas = []
    pr = ad.get("prorrogacao")
    if pr:
        meses = int(pr.get("meses") or 0)
        if not meses:
            erros.append("Prorrogação sem o número de meses (aditivo.prorrogacao.meses).")
        prazo = f"{meses} ({extenso(meses)}) meses" if meses else "__ meses"
        if pr.get("modalidade") == "sem_valor":
            linhas.append(f"Prorrogar a vigência do Contrato nº {ct} por mais {prazo}, em sentido estrito, "
                          "sem renovação do valor contratual")
        else:
            linhas.append(f"Prorrogar o Contrato nº {ct} por mais {prazo}, com renovação do valor contratual")
    rj = ad.get("reajuste")
    if rj:
        idx = rj.get("indice") or "_____"
        pct = f" ({rj['percentual']})" if rj.get("percentual") else ""
        linhas.append(f"Reajustar o Contrato nº {ct}, conforme índice {idx}{pct}")
    for chave, verbo, nome in (("acrescimo", "Acrescer", "Acréscimo"), ("supressao", "Suprimir", "Supressão")):
        x = ad.get(chave)
        if x:
            partes = []
            if x.get("valor") is not None:
                partes.append(brl(num(x["valor"])))
            if x.get("percentual") is not None:
                partes.append(f"{num(x['percentual']):.2f}%".replace(".", ","))
            quanto = " em " + " – ".join(partes) if partes else ""
            desc = f", referente a {x['descricao']}" if x.get("descricao") else ""
            linhas.append(f"{verbo} o valor do Contrato nº {ct}{quanto}{desc}")
            if x.get("percentual") is not None and num(x["percentual"]) > LIMITE_ALTERACAO:
                avisos.append(f"{nome} de {num(x['percentual']):.2f}%".replace(".", ",") + f" passa de {LIMITE_ALTERACAO:.0f}% "
                              "(art. 125 da Lei 14.133/2021; 50% só para reforma) – conferir.")
    if not linhas:
        erros.append("Nenhuma opção marcada no aditivo (prorrogação, reajuste, acréscimo ou supressão).")
    romanos = ["I", "II", "III", "IV", "V", "VI"]
    objeto = "\n".join(f"{romanos[i]} - {t};" if i < len(linhas) - 1 else f"{romanos[i]} - {t}."
                       for i, t in enumerate(linhas))

    # valores
    if d.get("valor_atual") in (None, ""):
        erros.append("Valor atual do contrato não informado (valor_atual).")
        return objeto, None, None
    atual = num(d["valor_atual"])
    if d.get("valor_novo") not in (None, ""):
        novo = num(d["valor_novo"])
    else:
        novo = atual
        if rj and rj.get("valor") is not None:
            novo += num(rj["valor"])
        if ad.get("acrescimo") and ad["acrescimo"].get("valor") is not None:
            novo += num(ad["acrescimo"]["valor"])
        if ad.get("supressao") and ad["supressao"].get("valor") is not None:
            novo -= num(ad["supressao"]["valor"])
        if rj and rj.get("valor") is None:
            avisos.append("Reajuste sem valor em R$ (aditivo.reajuste.valor): o valor do item 12 não o inclui – "
                          "usar o total da memória de cálculo do reajuste.")
    return objeto, round(atual, 2), round(novo, 2)


def vigencia(d, erros):
    pr = (d.get("aditivo") or {}).get("prorrogacao") or {}
    ini, fim = pr.get("inicio"), pr.get("fim")
    if ini and not fim and pr.get("meses"):
        fim = (somar_meses(data(ini), int(pr["meses"])) - datetime.timedelta(days=1)).strftime("%d/%m/%Y")
    if not ini or not fim:
        if pr:
            erros.append("Vigência da prorrogação não informada (aditivo.prorrogacao.inicio e .fim ou .meses).")
        return "____/____/______ A ____/____/______"
    return f"{ini} A {fim}"


def parecer_blocos(d, avisos):
    """Campo 13: um bloco por parecer referencial que fundamenta alguma alteração (nº, ementa, vigência, motivo);
    alterações sem parecer → linha de aviso + parecer jurídico informado pelo fiscal (CJU)."""
    sys.path.insert(0, AQUI)
    import pareceres
    an = pareceres.analisar(d)
    blocos = []   # lista de parágrafos; cada parágrafo = lista de (texto, negrito)
    for p in an["pareceres"]:
        vig = "vigência até " + p["validade"] if p.get("validade") else "vigência não informada"
        blocos.append([(p["numero"].strip(), True), (f" ({vig})", False)])
        if p.get("objeto"):
            blocos.append([("Ementa: ", True), (p["objeto"].strip(), False)])
        blocos.append([("Motivo: ", True), (p["motivo_texto"], False)])
    if an["descobertas"]:
        txt = "Sem parecer referencial vigente para: " + pareceres.lista_juntada(an["descobertas"]) + \
              " – alteração submetida à análise jurídica (CJU)."
        blocos.append([(txt, True)])
        avisos.append("🔴 " + txt)
        pj = d.get("parecer_juridico")
        if pj and str(pj.get("numero", "")).strip():
            blocos.append([("Parecer jurídico: ", True),
                           (f"nº {pj['numero']}" + (f", de {pj['data']}" if pj.get("data") else ""), False)])
        else:
            blocos.append([("Parecer jurídico: nº ______________, de ____/____/______", False)])
            avisos.append("Parecer jurídico da CJU ainda não informado (campo 13/14 com espaço para preencher).")
    return blocos


def escrever_blocos(cell, blocos, size=9):
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    for i, partes in enumerate(blocos):
        p = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(1)
        for texto, negrito in partes:
            fmt(p.add_run(texto), size, negrito)


# ------------------------------------------------------------------ geração
def gerar(d, saida):
    erros, avisos = [], []
    om = d.get("om_signataria") or {}
    for campo, val in (("contrato", d.get("contrato")), ("pag", d.get("pag")),
                       ("numero_aditivo", d.get("numero_aditivo")),
                       ("om_signataria.nome", om.get("nome")), ("om_signataria.sigla", om.get("sigla"))):
        if not str(val or "").strip():
            erros.append(f"Campo obrigatório vazio: {campo}")
    ug = str(om.get("ug") or UGS_CONHECIDAS.get(om.get("sigla", "").upper(), "")).strip()
    if not ug:
        erros.append(f"Código da UG signatária ({om.get('sigla')}) não informado: quem gera a ficha deve "
                     "preencher om_signataria.ug.")
    merito = str(d.get("merito_administrativo") or "").strip()
    if not merito:
        erros.append("Mérito administrativo (campo 9) vazio: o fiscal precisa escrever a justificativa.")
    if eh_cefa(om):
        autoridade = "Diretor de Administração da Aeronáutica"
    else:
        autoridade = str(d.get("autoridade_superior") or "").strip()
        if not autoridade:
            erros.append(f"{om.get('sigla')} não é do CEFA: informar o cargo da autoridade que autoriza "
                         "(campo 19 → 'autoridade_superior').")
    objeto, atual, novo = objeto_e_valores(d, erros, avisos) if d.get("contrato") else ("", None, None)
    vig = vigencia(d, erros)
    if erros:
        print("ERROS – Ficha NÃO gerada:")
        for e in erros:
            print("  ❌", e)
        sys.exit(1)
    if novo is not None and novo <= 1_000_000:
        avisos.append(f"Valor do aditivo {brl(novo)} não passa de R$ 1.000.000,00: a Ficha não é exigida na lista.")
    parecer = parecer_blocos(d, avisos)

    doc = Document()
    s = doc.sections[0]
    s.page_width, s.page_height = Cm(21.0), Cm(29.7)
    s.top_margin, s.bottom_margin = Cm(1.5), Cm(1.5)
    s.left_margin = s.right_margin = Cm(1.5)
    st = doc.styles["Normal"]
    st.font.name = FONTE; st.font.size = Pt(9)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONTE)

    p = par(doc)
    brasao = os.path.join(AQUI, "brasao.png")
    if os.path.exists(brasao):
        p.add_run().add_picture(brasao, width=Cm(1.9))
    par(doc, "MINISTÉRIO DA DEFESA", 10, True)
    par(doc, "COMANDO DA AERONÁUTICA", 10)
    par(doc, om["nome"].upper(), 10, after=8)

    t = doc.add_table(rows=0, cols=6)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    for gc, w in zip(t._tbl.tblGrid.findall(qn("w:gridCol")), GRID):
        gc.set(qn("w:w"), str(int(w.twips)))
    L, C, J = WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.JUSTIFY

    linha(t, [(4, "1   UNIDADE GESTORA SIGNATÁRIA", L, False), (2, "2   CÓDIGO UG SIGNATÁRIA", L, False)])
    linha(t, [(4, om["sigla"].upper(), L, False), (2, ug, L, False)])
    linha(t, [(4, "3   UNIDADE GESTORA EXECUTORA", L, False), (2, "4   CÓDIGO UGEXEC", L, False)])
    linha(t, [(4, UG_EXECUTORA[0], L, False), (2, UG_EXECUTORA[1], L, False)])
    linha(t, [(2, "5   Nº DO CONTRATO", L, False), (2, "6   Nº DO TERMO ADITIVO", L, False),
              (2, "7   Nº DO PAG (NUP)", L, False)])
    linha(t, [(2, d["contrato"], L, False), (2, f"{int(d['numero_aditivo'])}º TERMO ADITIVO", L, False),
              (2, d["pag"], L, False)])
    linha(t, [(6, "8 OBJETO E FINALIDADE", L, False)])
    linha(t, [(6, objeto, L, False)])
    linha(t, [(6, "9 MÉRITO ADMINISTRATIVO (JUSTIFICATIVA)", L, False)])
    linha(t, [(6, merito, J, False)])
    linha(t, [(6, "10 VIGÊNCIA DO CONTRATO/ TERMO ADITIVO", L, False)])
    linha(t, [(6, vig, C, False)])
    linha(t, [(3, "11   VALOR ATUAL DO CONTRATO", L, False),
              (3, "12   VALOR DO TERMO ADITIVO (Valor que passará a ser)", L, False)])
    linha(t, [(3, brl(atual), L, False), (3, brl(novo), L, False)])
    linha(t, [(6, "13   Nº E DATA DE APROVAÇÃO DO PARECER JURÍDICO", L, False)])
    r13 = linha(t, [(6, "", L, False)])
    c13 = r13.cells[0]
    c13.paragraphs[0].text = ""
    escrever_blocos(c13, parecer)
    linha(t, [(2, "14   Nº E DATA DE APROVAÇÃO DO PARECER JURÍDICO", C, False),
              (2, "15   Nº E DATA DA RATIFICAÇÃO PELA AUTORIDADE SUPERIOR (SE FOR O CASO).", C, False),
              (2, "16   Nº E DATA DA APROVAÇÃO DA AUTORIDADE SUPERIOR (SE FOR O CASO).", C, False)])
    linha(t, [(2, campo_aprovacao(d.get("parecer_juridico")), C, False),
              (2, campo_aprovacao(d.get("ratificacao")), C, False),
              (2, campo_aprovacao(d.get("aprovacao_superior")), C, False)])
    linha(t, [(2, "17 DECLARO que foram satisfeitas todas as exigências legais necessárias para a regularidade do "
                  "presente processo, e que esse foi conduzido de acordo com a legislação pertinente.", J, False),
              (2, "18 DECLARO que o presente processo foi verificado e considerado em conformidade com a "
                  "legislação pertinente.", J, False),
              (2, "19 AUTORIZO a celebração/ prorrogação do contrato, de acordo com as informações apresentadas "
                  "na presente Ficha, conforme o disposto na Portaria nº 524/GC4/2023.", J, False)])
    art = om.get("artigo", "do")
    local = "\nLocal, _________\nData ____/_______/____.\n\n"
    linha(t, [(2, local + f"Ordenador de Despesas {art} {om['sigla']}", C, False),
              (2, local + f"Agente de Controle Interno {art} {om['sigla']}", C, False),
              (2, local + autoridade, C, False)])

    # larguras por gridSpan
    for row in t.rows:
        idx = 0
        for tc in row._tr.findall(qn("w:tc")):
            span = tc.tcPr.find(qn("w:gridSpan")) if tc.tcPr is not None else None
            n = int(span.get(qn("w:val"))) if span is not None else 1
            tcW = tc.get_or_add_tcPr().get_or_add_tcW()
            tcW.set(qn("w:w"), str(sum(int(g.twips) for g in GRID[idx:idx + n]))); tcW.set(qn("w:type"), "dxa")
            idx += n

    os.makedirs(saida, exist_ok=True)
    caminho = os.path.join(saida, "Ficha de Autorizacao da Prorrogacao - CT " + d["contrato"].replace("/", "-") + ".docx")
    doc.save(caminho)
    print("RESUMO – Ficha para a Autorização da Prorrogação Contratual")
    print("  Arquivo:", caminho)
    print(f"  UG signatária: {om['sigla']} ({ug}) | executora: {UG_EXECUTORA[0]} ({UG_EXECUTORA[1]})")
    print(f"  Contrato {d['contrato']} | {int(d['numero_aditivo'])}º TA | PAG {d['pag']}")
    print("  Objeto:"); [print("    " + l) for l in objeto.split("\n")]
    print(f"  Vigência: {vig} | valor atual {brl(atual)} → passa a {brl(novo)}")
    print("  Campo 13:")
    for b in parecer:
        print("    " + "".join(t for t, _ in b))
    print(f"  Assinaturas: OD {art} {om['sigla']} | ACI {art} {om['sigla']} | {autoridade}")
    for a in avisos:
        print("  ⚠️", a)
    return caminho


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        gerar(json.load(f), sys.argv[2])
