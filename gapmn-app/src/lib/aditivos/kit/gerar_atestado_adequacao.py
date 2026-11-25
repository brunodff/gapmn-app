#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
ATESTADO DE ADEQUAÇÃO DO PROCESSO AO(S) PARECER(ES) REFERENCIAL(IS) (.docx) – modelo do Chefe da SCON
("ATESTADO-DE-ADEQUAÇÃO AO PARECER REFERENCIAL - CONTINUADO SEM MÃO DE OBRA EXCLUSIVA 14.133").

Uso:  python3 gerar_atestado_adequacao.py dados.json saida/

Regras (24/11/2026):
- UM único atestado por termo aditivo, citando TODOS os pareceres referenciais usados, cada um com o
  objeto (trecho do próprio parecer), a vigência e o que ele fundamenta neste aditivo.
- Só é gerado quando todas as alterações marcadas estão fundamentadas por parecer referencial vigente;
  havendo alteração sem parecer, o processo vai para a CJU e não há atestado.
- Cabeçalho: OM que assina o contrato. Assinaturas só com o cargo: Gestor do Contrato e
  Ordenador de Despesas da OM que assina o contrato.
"""
import json, os, sys
from docx import Document
from docx.shared import Pt, Cm, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import pareceres as P
from gerar_ficha_autorizacao import objeto_e_valores, brl, extenso, num

FONTE = "Arial"
TITULO_ALT = {"prorrogacao": "PRORROGAÇÃO DE VIGÊNCIA", "reajuste": "REAJUSTE",
              "acrescimo": "ACRÉSCIMO", "supressao": "SUPRESSÃO"}


def run(p, texto, size=11, bold=False):
    r = p.add_run(texto)
    r.font.name = FONTE
    r._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONTE)
    r.font.size = Pt(size)
    r.bold = bold
    return r


def par(doc, align=WD_ALIGN_PARAGRAPH.JUSTIFY, before=0, after=6, first=None, line=1.3, indent=None):
    p = doc.add_paragraph()
    p.alignment = align
    pf = p.paragraph_format
    pf.space_before, pf.space_after = Pt(before), Pt(after)
    pf.line_spacing = line
    if first is not None:
        pf.first_line_indent = first
    if indent is not None:
        pf.left_indent = indent
    return p


def objeto_aditivo(d):
    """'Prorrogação de vigência por mais 12 (doze) meses, com renovação do valor contratual; Reajuste de ...'"""
    ad = d.get("aditivo") or {}
    partes = []
    pr = ad.get("prorrogacao")
    if pr:
        m = int(pr.get("meses") or 0)
        prazo = f"{m} ({extenso(m)}) meses" if m else "__ meses"
        partes.append(f"Prorrogação de vigência por mais {prazo}, " +
                      ("em sentido estrito, sem renovação do valor contratual" if pr.get("modalidade") == "sem_valor"
                       else "com renovação do valor contratual"))
    rj = ad.get("reajuste")
    if rj:
        partes.append(f"Reajuste de {rj.get('percentual') or '__%'} referente ao índice {rj.get('indice') or '_____'}")
    for k, nome in (("acrescimo", "Acréscimo"), ("supressao", "Supressão")):
        x = ad.get(k)
        if x:
            q = []
            if x.get("valor") is not None:
                q.append(brl(num(x["valor"])))
            if x.get("percentual") is not None:
                q.append(f"{num(x['percentual']):.2f}%".replace(".", ","))
            partes.append(f"{nome} de " + " – ".join(q) if q else nome)
    return "; ".join(partes) + "." if partes else ""


def gerar(d, saida):
    erros, avisos = [], []
    om = d.get("om_signataria") or {}
    for campo, val in (("pag", d.get("pag")), ("contrato", d.get("contrato")), ("om_signataria.nome", om.get("nome")),
                       ("om_signataria.sigla", om.get("sigla"))):
        if not str(val or "").strip():
            erros.append(f"Campo obrigatório vazio: {campo}")
    an = P.analisar(d)
    if not an["pareceres"]:
        erros.append("Nenhum parecer referencial vigente: não há atestado (o aditivo vai para a CJU).")
    elif an["descobertas"]:
        erros.append("Sem parecer referencial vigente para: " + P.lista_juntada(an["descobertas"]) +
                     " → o aditivo vai para a CJU e o atestado de adequação não é gerado.")
    if erros:
        print("ERROS – Atestado de adequação NÃO gerado:")
        for e in erros:
            print("  ❌", e)
        sys.exit(1)

    e2, a2 = [], []
    _, _, valor_novo = objeto_e_valores(d, e2, a2) if d.get("valor_atual") not in (None, "") else (None, None, None)
    if valor_novo is None:
        avisos.append("Valor atual do contrato não informado: 'Valor estimado' sai em branco.")
    objeto_contrato = str(d.get("objeto_contrato") or "").strip()
    if not objeto_contrato:
        avisos.append("Objeto do contrato não informado (objeto_contrato): sai em branco para preencher.")
    orgaos = {p.get("orgao_consultivo") for p in an["pareceres"]}
    if len(orgaos) == 1 and None not in orgaos:
        orgao = orgaos.pop()
    else:
        orgao = "Consultoria Jurídica da Advocacia-Geral da União competente"
        avisos.append("Órgão consultivo dos pareceres não identificado (ou diferente entre eles): conferir o trecho "
                      "\"a cargo da …\" do atestado.")

    doc = Document()
    s = doc.sections[0]
    s.page_width, s.page_height = Cm(21.0), Cm(29.7)
    s.top_margin = s.bottom_margin = s.left_margin = s.right_margin = Cm(2.0)
    st = doc.styles["Normal"]
    st.font.name = FONTE; st.font.size = Pt(11)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONTE)

    C = WD_ALIGN_PARAGRAPH.CENTER
    p = par(doc, C, after=0, line=1.0)
    brasao = os.path.join(AQUI, "brasao.png")
    if os.path.exists(brasao):
        p.add_run().add_picture(brasao, width=Emu(807720))
    run(par(doc, C, after=0, line=1.0), "MINISTÉRIO DA DEFESA", 10, True)
    run(par(doc, C, after=0, line=1.0), "COMANDO DA AERONÁUTICA", 10, True)
    run(par(doc, C, after=16, line=1.0), om["nome"].upper(), 10, True)

    alts = [TITULO_ALT[a] for a in an["alteracoes"]]
    plural = len(an["pareceres"]) > 1
    titulo = ("ATESTADO DE ADEQUAÇÃO DO PROCESSO " + ("AOS PARECERES REFERENCIAIS" if plural else "AO PARECER REFERENCIAL") +
              " PARA " + P.lista_juntada(alts).replace(" e ", " E "))
    run(par(doc, C, after=16, line=1.15), titulo, 11, True)

    for rot, val in (("Processo NUP: ", d["pag"]),
                     ("Objeto do contrato: ", objeto_contrato or "______________________________"),
                     ("Objeto do Termo Aditivo: ", objeto_aditivo(d)),
                     ("Valor estimado (Valor de referência): ", brl(valor_novo) if valor_novo is not None else "R$ ____________")):
        p = par(doc, after=4, line=1.15)
        run(p, rot, 11, True); run(p, val)

    def descricao(pp):
        vig = f"vigente até {pp['validade']}" if pp.get("validade") else "vigência a conferir"
        return f"{P.numero_curto(pp['numero']).replace('nº ', 'nº ')}", f"({pp.get('objeto', '').rstrip('.')}; {vig})", pp["motivo_texto"]

    if not plural:
        pp = an["pareceres"][0]
        n, expl, motivo = descricao(pp)
        p = par(doc, before=10, first=Cm(1.5))
        run(p, "Atesto que o presente processo, referindo-se ao termo aditivo descrito, enquadra-se no ")
        run(p, "PARECER REFERENCIAL " + n, bold=True)
        run(p, f" {expl}, que {motivo[0].lower() + motivo[1:].rstrip('.')}, cujas recomendações restaram plenamente "
               "atendidas no caso concreto, e a instrução dos autos apresenta-se regular, de acordo com o que está "
               "consignado na Lista de Verificação juntada aos autos. ")
        run(p, f"Fica, assim, dispensada a remessa dos autos para exame individualizado a cargo da {orgao}, conforme "
               "autorizado pela Orientação Normativa AGU nº 55, de 23 de maio de 2014, e pela Portaria Normativa "
               "CGU/AGU nº 05, de 31 de março de 2022.")
    else:
        p = par(doc, before=10, first=Cm(1.5))
        run(p, "Atesto que o presente processo, referindo-se ao termo aditivo descrito, enquadra-se nos "
               "PARECERES REFERENCIAIS abaixo, cujas recomendações restaram plenamente atendidas no caso concreto, "
               "e a instrução dos autos apresenta-se regular, de acordo com o que está consignado na Lista de "
               "Verificação juntada aos autos:")
        for i, pp in enumerate(an["pareceres"]):
            n, expl, motivo = descricao(pp)
            p = par(doc, after=4, indent=Cm(1.0), line=1.3)
            run(p, f"{chr(97 + i)}) "); run(p, "PARECER REFERENCIAL " + n, bold=True)
            run(p, f" {expl}. {motivo}")
        p = par(doc, before=6, first=Cm(1.5))
        run(p, f"Fica, assim, dispensada a remessa dos autos para exame individualizado a cargo da {orgao}, conforme "
               "autorizado pela Orientação Normativa AGU nº 55, de 23 de maio de 2014, e pela Portaria Normativa "
               "CGU/AGU nº 05, de 31 de março de 2022.")

    p.paragraph_format.keep_with_next = True          # último parágrafo do texto acompanha a assinatura
    p = par(doc, WD_ALIGN_PARAGRAPH.RIGHT, before=14, after=36, line=1.0)
    run(p, "Data conforme assinatura digital.")
    p.paragraph_format.keep_with_next = True
    p = par(doc, C, after=48, line=1.0); run(p, d.get("cargo_gestor", "Gestor do Contrato"))
    p.paragraph_format.keep_with_next = True
    art = om.get("artigo", "do")
    run(par(doc, C, after=0, line=1.0), f"{d.get('cargo_ordenador', 'Ordenador de Despesas')} {art} {om['sigla']}")

    os.makedirs(saida, exist_ok=True)
    caminho = os.path.join(saida, "Atestado de Adequacao ao Parecer Referencial - CT " + d["contrato"].replace("/", "-") + ".docx")
    doc.save(caminho)
    print("RESUMO – Atestado de adequação ao(s) parecer(es) referencial(is)")
    print("  Arquivo:", caminho)
    print("  Título:", titulo)
    for pp in an["pareceres"]:
        print(f"  • {pp['numero']} (até {pp.get('validade')}) – {pp['motivo_texto']}")
    print("  Valor de referência:", brl(valor_novo) if valor_novo is not None else "—", "| a cargo da:", orgao)
    for a in avisos:
        print("  ⚠️", a)
    return caminho


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        gerar(json.load(f), sys.argv[2])
