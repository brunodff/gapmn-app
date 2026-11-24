#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Gera a DECLARAÇÃO DE DISPONIBILIDADE ORÇAMENTÁRIA do termo aditivo (.docx).

Uso:  python3 gerar_declaracao_orcamentaria.py dados.json saida/
      (brasao.png na mesma pasta deste script)

Regras (Chefe da SCON):
- A OM que consta no documento (cabeçalho e "a cargo do ...") é a OM QUE ASSINA O CONTRATO
  (a do Ordenador de Despesas signatário), não a OM apoiada nem a UG do empenho.
- Os dados orçamentários vêm do ÚLTIMO EMPENHO do contrato no Contratos.gov.br.
- Exercício: o do último empenho, salvo se "exercicio" for informado.
- Assinatura só com o cargo: "Ordenador de Despesas".
"""
import json, os, sys
from docx import Document
from docx.shared import Pt, Cm, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTE = "Arial"


def ordinal(n):
    return f"{int(n)}º"


def run(p, texto, size=11, bold=False, underline=False):
    r = p.add_run(texto)
    r.font.name = FONTE
    r._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONTE)
    r.font.size = Pt(size)
    r.bold = bold
    r.underline = underline
    return r


def par(doc, align=WD_ALIGN_PARAGRAPH.CENTER, before=0, after=0, line=None, first=None):
    p = doc.add_paragraph()
    p.alignment = align
    pf = p.paragraph_format
    pf.space_before, pf.space_after = Pt(before), Pt(after)
    if line:
        pf.line_spacing = line
    if first is not None:
        pf.first_line_indent = first
    return p


def gerar(d, saida):
    erros, avisos = [], []
    om = d.get("om_signataria") or {}
    emp = d.get("empenho") or {}
    for campo, val in (("pag", d.get("pag")), ("contrato", d.get("contrato")),
                       ("om_signataria.nome", om.get("nome")), ("om_signataria.sigla", om.get("sigla")),
                       ("om_signataria.ug", om.get("ug")), ("numero_aditivo", d.get("numero_aditivo"))):
        if not str(val or "").strip():
            erros.append(f"Campo obrigatório vazio: {campo}")
    linhas = [("Gestão/Unidade", "gestao_unidade"), ("Fonte de Recursos", "fonte"),
              ("Programa de Trabalho", "programa_trabalho"), ("Ação", "acao"),
              ("Plano Interno", "plano_interno"), ("Natureza de Despesa", "natureza_despesa")]
    for rot, k in linhas:
        if not str(emp.get(k) or "").strip():
            if k == "acao":
                avisos.append("Ação não informada no empenho: saiu como 'não se aplica'. Confirmar.")
            else:
                erros.append(f"Dado do empenho vazio: {rot} ({k})")
    exercicio = d.get("exercicio") or emp.get("exercicio")
    if not exercicio:
        erros.append("Exercício não informado (nem em 'exercicio' nem em 'empenho.exercicio').")
    if erros:
        print("ERROS – declaração NÃO gerada:")
        for e in erros:
            print("  ❌", e)
        sys.exit(1)

    doc = Document()
    s = doc.sections[0]
    s.page_width, s.page_height = Cm(21.0), Cm(29.7)
    s.top_margin = s.bottom_margin = s.left_margin = s.right_margin = Cm(2.0)
    st = doc.styles["Normal"]
    st.font.name = FONTE
    st.font.size = Pt(11)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONTE)

    # cabeçalho
    p = par(doc)
    brasao = os.path.join(AQUI, "brasao.png")
    if os.path.exists(brasao):
        p.add_run().add_picture(brasao, width=Emu(807720))
    else:
        avisos.append("brasao.png não encontrado: declaração sem brasão.")
    run(par(doc), "MINISTÉRIO DA DEFESA", 10, True)
    run(par(doc), "COMANDO DA AERONÁUTICA", 10, True)
    run(par(doc, after=18), om["nome"].upper(), 10, True)
    run(par(doc), "DECLARAÇÃO DE DISPONIBILIDADE ORÇAMENTÁRIA", 10, True)
    run(par(doc, after=36), "PROCESSO: " + d["pag"], 10, True, True)

    # corpo
    artigo = om.get("artigo", "do")
    p = par(doc, WD_ALIGN_PARAGRAPH.JUSTIFY, line=1.5, first=Cm(1.5))
    run(p, "Declaro, para fins de comprovação, que existe previsão de dotação orçamentária visando atender às "
           "necessidades refletidas no objeto do Processo Administrativo sob o NUP/PAG ")
    run(p, d["pag"], 11, True, True)
    run(p, ", suficiente para assegurar o cumprimento das obrigações advindas do "
           f"{ordinal(d['numero_aditivo'])} Termo Aditivo, em conformidade com o art. 167, inciso II, da "
           "Constituição Federal e o art. 18 da Lei 14.133/21, e que as despesas decorrentes da contratação "
           "ocorrerão à conta dos recursos descentralizados pela Diretoria de Economia e Finanças da Aeronáutica, "
           f"para o exercício de {exercicio}, a cargo {artigo} {om['sigla']} (UG {om['ug']}), conforme listado abaixo:")

    for i, (rot, k) in enumerate(linhas):
        fim = "." if i == len(linhas) - 1 else ";"
        val = str(emp.get(k) or "").strip() or "não se aplica"
        p = par(doc, WD_ALIGN_PARAGRAPH.JUSTIFY, before=6, after=6, line=1.15)
        run(p, f"{rot}: {val}{fim}")

    run(par(doc, WD_ALIGN_PARAGRAPH.RIGHT, before=48), "DATA CONFORME ASSINATURA ELETRÔNICA")
    run(par(doc, before=60), d.get("cargo_ordenador", "Ordenador de Despesas"))

    os.makedirs(saida, exist_ok=True)
    caminho = os.path.join(saida, "Declaracao de Disponibilidade Orcamentaria - CT "
                           + d["contrato"].replace("/", "-") + ".docx")
    doc.save(caminho)
    print("RESUMO – Declaração de Disponibilidade Orçamentária")
    print("  Arquivo:", caminho)
    print(f"  OM signatária: {om['nome']} ({om['sigla']}, UG {om['ug']}) | {ordinal(d['numero_aditivo'])} Termo Aditivo"
          f" | exercício {exercicio}")
    print(f"  Empenho de referência: {emp.get('numero', '(nº não informado)')}")
    for rot, k in linhas:
        print(f"    {rot}: {emp.get(k) or 'não se aplica'}")
    for a in avisos:
        print("  ⚠️", a)
    return caminho


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        gerar(json.load(f), sys.argv[2])
