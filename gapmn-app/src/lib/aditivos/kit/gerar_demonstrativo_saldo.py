#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Gera o DEMONSTRATIVO DE EXECUÇÃO E SALDO DO PERÍODO DE VIGÊNCIA (.docx) – documento novo, sem modelo anterior.

Uso:  python3 gerar_demonstrativo_saldo.py dados.json saida/

Para que serve (Chefe da SCON, 25/11/2026):
  Na prorrogação, o fiscal mostra à Seção de Contratos quanto sobrou do valor do contrato no período de vigência que
  está acabando, quanto desse saldo ainda vai pagar serviço executado no período (serviço começado na vigência é
  concluído e pago mesmo depois do fim dela) e quanto a SCON deve RETIRAR DO SILOMS e ANULAR NO SIAFI. Assim o novo
  período entra só com o valor do termo aditivo, e não com o valor novo + a sobra do período anterior.
  Ex.: período de R$ 1.200.000,00; R$ 1.000.000,00 executados e liquidados; sobra R$ 200.000,00; R$ 50.000,00 de
  serviço executado ainda a pagar → retirar R$ 150.000,00. Na prorrogação com valor o novo período entra com
  R$ 1.200.000,00 (e não R$ 1.400.000,00).

Quando entra: em toda PRORROGAÇÃO DE VIGÊNCIA (item da Lista logo após a Declaração de Vantajosidade).
  Com valor → saldo sem uso é retirado/anulado e o novo período entra só com o valor do aditivo.
  Sem valor (sentido estrito) → o saldo NÃO é retirado: continua para o período prorrogado (o documento registra quanto).

Quadro (A a F):
  A  Valor do contrato para o período de vigência que termina
  B  Executado e já liquidado (atestado) no período
  C  Executado no período e ainda não pago (informado pelo fiscal)
  D  = A − B − C  Saldo sem utilização → retirar do SILOMS
  E  Saldo a liquidar das notas de empenho do período
  F  = E − C  Valor a anular nas notas de empenho no SIAFI (por NE)

Bloco no dados.json:
  "saldo_periodo": {
    "inicio": "29/10/2026", "fim": "28/10/2027",        # padrão: fim = véspera do novo período; início = fim − meses
    "documento_periodo": "4º Termo Aditivo",            # o que fixou o valor do período (opcional)
    "valor_periodo": 85856.03,                          # padrão: valor_atual
    "empenhos": [{"numero": "2026NE000123", "data": "05/01/2026", "empenhado": 60000, "liquidado": 50000,
                  "pago": 45000, "a_liquidar": null}],  # a_liquidar padrão = empenhado − liquidado
    "liquidado": null,                                  # padrão: soma do liquidado das NEs
    "pendentes": [{"descricao": "Serviços de outubro/2027", "periodo": "01/10/2027 a 28/10/2027",
                   "nf": "", "valor": 7000, "empenho": "2026NE000123"}],
    "observacoes": "texto livre do fiscal"
  }
"""
import json, os, sys, datetime
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from gerar_ficha_autorizacao import objeto_e_valores, brl, num, data, somar_meses
from gerar_lista_verificacao import tem_prorrogacao
from gerar_parecer_tecnico import (run, par, escrever, falta, celula, larguras, sombrear, manter_linhas, brl_ext,
                                   ordinal, texto_objeto, FONTE)

R, C, L = WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT


def v(x):
    return round(num(x), 2) if x not in (None, "") else None


def sem_rs(x):
    return brl(x)[3:] if x is not None else "–"


def periodo_analisado(d, avisos):
    sp = d.get("saldo_periodo") or {}
    pr = (d.get("aditivo") or {}).get("prorrogacao") or {}
    fim, ini = sp.get("fim"), sp.get("inicio")
    if not fim and pr.get("inicio"):
        fim = (data(pr["inicio"]) - datetime.timedelta(days=1)).strftime("%d/%m/%Y")
    if not ini and fim:
        meses = int(sp.get("meses") or pr.get("meses") or 12)
        ini = somar_meses(data(fim) + datetime.timedelta(days=1), -meses).strftime("%d/%m/%Y")
        avisos.append(f"Início do período analisado calculado ({ini}) – conferir com o termo que fixou o período.")
    if not fim:
        avisos.append("Período analisado sem fim (saldo_periodo.fim ou aditivo.prorrogacao.inicio).")
    return ini, fim


def calcular(d, atual, avisos):
    sp = d.get("saldo_periodo") or {}
    A = v(sp.get("valor_periodo")) if sp.get("valor_periodo") not in (None, "") else atual
    nes = []
    for e in sp.get("empenhos") or []:
        emp, liq = v(e.get("empenhado")), v(e.get("liquidado"))
        al = v(e.get("a_liquidar"))
        if al is None and emp is not None:
            al = round(emp - (liq or 0), 2)
        nes.append({"numero": str(e.get("numero") or "").strip(), "data": e.get("data") or "", "empenhado": emp,
                    "liquidado": liq, "pago": v(e.get("pago")), "a_liquidar": al, "reservado": 0.0})
    if not nes:
        avisos.append("Nenhuma nota de empenho do período informada (buscar no Contratos.gov.br e conferir).")
    B = v(sp.get("liquidado"))
    if B is None:
        B = round(sum(e["liquidado"] or 0 for e in nes), 2)
    pend = []
    for p in sp.get("pendentes") or []:
        if p.get("valor") in (None, ""):
            continue
        pend.append({"descricao": p.get("descricao") or "", "periodo": p.get("periodo") or "", "nf": p.get("nf") or "",
                     "valor": v(p["valor"]), "empenho": str(p.get("empenho") or "").strip()})
    Cp = round(sum(p["valor"] for p in pend), 2)
    # reserva das pendências nas NEs (a indicada pelo fiscal; sem indicação → NE mais recente com saldo)
    por_num = {e["numero"]: e for e in nes}
    for p in pend:
        resto = p["valor"]
        if p["empenho"] in por_num:
            e = por_num[p["empenho"]]
            e["reservado"] = round(e["reservado"] + resto, 2)
            continue
        if p["empenho"]:
            avisos.append(f"Pendência '{p['descricao']}' aponta a NE {p['empenho']}, que não está na lista de empenhos.")
        for e in sorted(nes, key=lambda x: x["data"][-4:] + x["data"][3:5] + x["data"][:2], reverse=True):
            livre = (e["a_liquidar"] or 0) - e["reservado"]
            if livre <= 0:
                continue
            uso = min(livre, resto)
            e["reservado"] = round(e["reservado"] + uso, 2)
            resto = round(resto - uso, 2)
            if not p["empenho"]:
                p["empenho"] = e["numero"]
            if resto <= 0:
                break
        if resto > 0:
            avisos.append(f"🔴 Faltam {brl(resto)} de empenho para pagar '{p['descricao']}' – pedir reforço de empenho.")
    D = round(A - B - Cp, 2) if A is not None else None
    E = round(sum(e["a_liquidar"] or 0 for e in nes), 2)
    for e in nes:
        e["anular"] = round(max((e["a_liquidar"] or 0) - e["reservado"], 0), 2)
        if (e["a_liquidar"] or 0) - e["reservado"] < -0.009:
            avisos.append(f"🔴 A NE {e['numero']} não tem saldo para o que foi reservado nela – conferir.")
    F = round(sum(e["anular"] for e in nes), 2)
    if D is not None and D < -0.009:
        avisos.append(f"🔴 Executado + a pagar ({brl(B + Cp)}) passa do valor do período ({brl(A)}) – conferir.")
    if A is None:
        avisos.append("Valor do contrato para o período não informado (saldo_periodo.valor_periodo ou valor_atual).")
    return {"A": A, "B": B, "C": Cp, "D": D, "E": E, "F": F, "nes": nes, "pend": pend}


def tabela(doc, cab, linhas, cms, total=None, size=8):
    t = doc.add_table(rows=1, cols=len(cab))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for c, txt in zip(t.rows[0].cells, cab):
        celula(c, txt, True, C, size), sombrear(c)
    for ln in linhas:
        r = t.add_row().cells
        for c, (txt, al) in zip(r, ln):
            celula(c, txt, align=al, size=size)
    if total:
        r = t.add_row().cells
        n = len(cab) - len(total)
        if n > 1:
            r[0].merge(r[n - 1])
        celula(r[0], "TOTAL", True, R, size)
        for c, txt in zip(r[n:], total):
            celula(c, txt, True, R, size)
        for c in r:
            sombrear(c, "F2F2F2")
    larguras(t, cms)
    manter_linhas(t)                          # tabela não se parte, mas não puxa o que vem depois
    for c in t.rows[-1].cells:
        for p_ in c.paragraphs:
            p_.paragraph_format.keep_with_next = False
    return t


def gerar(d, saida):
    erros, avisos = [], []
    if not tem_prorrogacao(d):
        print("Demonstrativo de Saldo NÃO se aplica: o aditivo não tem prorrogação de vigência.")
        sys.exit(2)
    om = d.get("om_signataria") or {}
    sp = d.get("saldo_periodo") or {}
    pr = (d.get("aditivo") or {}).get("prorrogacao") or {}
    sem_valor = pr.get("modalidade") == "sem_valor"
    for campo in ("contrato", "numero_aditivo"):
        if not str(d.get(campo) or "").strip():
            erros.append(f"Campo obrigatório vazio: {campo}")
    _, atual, novo = objeto_e_valores(d, erros, avisos)
    if erros:
        print("ERROS – Demonstrativo NÃO gerado:")
        for e in erros:
            print("  ❌", e)
        sys.exit(1)
    ini, fim = periodo_analisado(d, avisos)
    q = calcular(d, atual, avisos)
    n_ta = ordinal(d["numero_aditivo"])
    novo_ini = pr.get("inicio")
    novo_fim = pr.get("fim") or (
        (somar_meses(data(novo_ini), int(pr.get("meses") or 12)) - datetime.timedelta(days=1)).strftime("%d/%m/%Y")
        if novo_ini else None)

    doc = Document()
    s = doc.sections[0]
    s.page_width, s.page_height = Cm(21.0), Cm(29.7)
    s.top_margin, s.bottom_margin = Cm(1.5), Cm(1.5)
    s.left_margin, s.right_margin = Cm(2.0), Cm(2.0)
    st = doc.styles["Normal"]
    st.font.name, st.font.size = FONTE, Pt(11)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONTE)

    p = par(doc, C, after=0)
    brasao = os.path.join(AQUI, "brasao.png")
    if os.path.exists(brasao):
        p.add_run().add_picture(brasao, height=Cm(2.0))
    run(par(doc, C, after=0), "MINISTÉRIO DA DEFESA", bold=True)
    run(par(doc, C, after=0), "COMANDO DA AERONÁUTICA")
    run(par(doc, C, after=12), (sp.get("om_cabecalho") or om.get("nome") or om.get("sigla") or "").upper(),
        underline=True)
    run(par(doc, C, after=14), "DEMONSTRATIVO DE EXECUÇÃO E SALDO DO PERÍODO DE VIGÊNCIA", bold=True, underline=True)
    doc.paragraphs[-1].paragraph_format.space_after = Pt(10)

    obj = texto_objeto(d)
    escrever(par(doc, after=0), [f"Contrato nº {d['contrato']}"])
    if d.get("pag"):
        escrever(par(doc, after=0), [f"Processo nº {d['pag']}"])
    emp = (d.get("contratada") or {}).get("nome") if isinstance(d.get("contratada"), dict) else d.get("contratada")
    if emp:
        escrever(par(doc, after=0), [f"Contratada: {emp}"])
    escrever(par(doc, after=0), ["Objeto: ", obj or falta("___")])
    doc_per = sp.get("documento_periodo")
    escrever(par(doc, after=12), ["Período de vigência analisado: ", ini or falta("__/__/____"), " a ",
                                  fim or falta("__/__/____"), f" ({doc_per})" if doc_per else ""])
    doc.paragraphs[-1].paragraph_format.space_after = Pt(8)

    # texto de abertura
    p = par(doc, after=4, recuo=Cm(1.25))
    alvo = (f"para que o novo período ({novo_ini} a {novo_fim}) seja registrado somente com o valor do {n_ta} Termo "
            "Aditivo, sem somar o saldo do período encerrado") if not sem_valor else \
           ("para registro do saldo que continua disponível no período prorrogado, uma vez que a prorrogação é sem "
            "renovação do valor contratual")
    escrever(p, ["Em razão da prorrogação de vigência do contrato, esta fiscalização demonstra a execução financeira do "
                 "período de vigência que se encerra, os serviços executados nesse período ainda pendentes de pagamento "
                 f"e o saldo a ser tratado pela Seção de Contratos no SILOMS e no SIAFI, {alvo}."])

    # 1 – notas de empenho
    escrever(par(doc, after=4, junto=True), [("1. NOTAS DE EMPENHO DO PERÍODO", {"bold": True})])
    linhas = [[(e["numero"] or "___", C), (e["data"], C), (sem_rs(e["empenhado"]), R), (sem_rs(e["liquidado"]), R),
               (sem_rs(e["pago"]), R), (sem_rs(e["a_liquidar"]), R)] for e in q["nes"]]
    if not linhas:
        linhas = [[("___", C), ("", C), ("", R), ("", R), ("", R), ("", R)]]
    tot = [sem_rs(sum(e["empenhado"] or 0 for e in q["nes"])), sem_rs(sum(e["liquidado"] or 0 for e in q["nes"])),
           sem_rs(sum(e["pago"] or 0 for e in q["nes"])), sem_rs(q["E"])]
    tabela(doc, ["NOTA DE EMPENHO", "EMISSÃO", "EMPENHADO (R$)", "LIQUIDADO (R$)", "PAGO (R$)", "SALDO A LIQUIDAR (R$)"],
           linhas, [3.4, 2.2, 2.9, 2.9, 2.7, 2.9], total=tot)

    # 2 – executado e não pago
    escrever(par(doc, before=10, after=4, junto=True),
             [("2. SERVIÇOS EXECUTADOS NO PERÍODO E AINDA NÃO PAGOS", {"bold": True})])
    if q["pend"]:
        linhas = [[(p["descricao"], L), (p["periodo"], C), (p["nf"] or "–", C), (p["empenho"] or "–", C),
                   (sem_rs(p["valor"]), R)] for p in q["pend"]]
        tabela(doc, ["SERVIÇO / COMPETÊNCIA", "PERÍODO DE EXECUÇÃO", "NOTA FISCAL", "NE QUE VAI PAGAR", "VALOR (R$)"],
               linhas, [5.0, 3.4, 2.4, 3.2, 3.0], total=[sem_rs(q["C"])])
    else:
        escrever(par(doc, after=0), ["Não há serviços executados no período pendentes de pagamento."])

    # 3 – quadro
    escrever(par(doc, before=10, after=4, junto=True), [("3. DEMONSTRATIVO DO SALDO", {"bold": True})])
    linhas = [
        [("A", C), ("Valor do contrato para o período de vigência analisado", L), (sem_rs(q["A"]), R)],
        [("B", C), ("Executado e já liquidado (atestado) no período", L), (sem_rs(q["B"]), R)],
        [("C", C), ("Executado no período e ainda não pago (item 2)", L), (sem_rs(q["C"]), R)],
        [("D", C), ("Saldo do período sem utilização (A − B − C)", L), (sem_rs(q["D"]), R)],
        [("E", C), ("Saldo a liquidar das notas de empenho do período (item 1)", L), (sem_rs(q["E"]), R)],
        [("F", C), ("Saldo das notas de empenho sem uso (E − C)", L), (sem_rs(q["F"]), R)],
    ]
    t = tabela(doc, ["", "DESCRIÇÃO", "VALOR (R$)"], linhas, [1.0, 12.5, 3.5])
    for i in (4, 6):                          # D e F em destaque
        for c in t.rows[i].cells:
            sombrear(c, "FFF2CC")
            for r_ in c.paragraphs[0].runs:
                r_.bold = True

    # 4 – providências
    escrever(par(doc, before=10, after=4, junto=True), [("4. PROVIDÊNCIAS PARA A SEÇÃO DE CONTRATOS", {"bold": True})])
    prov = []
    if sem_valor:
        prov.append(["Prorrogação sem renovação do valor contratual: o saldo de ", brl_ext(q["D"]) if q["D"] is not None
                     else falta("R$ ___"), " permanece no contrato para o período prorrogado (", novo_ini or "", " a ",
                     novo_fim or "", "). Não retirar do SILOMS nem anular empenho por causa desta prorrogação"])
    else:
        prov.append(["Retirar do SILOMS o saldo de ", brl_ext(q["D"]) if q["D"] is not None else falta("R$ ___"),
                     f", referente ao período de {ini or '___'} a {fim or '___'}"])
        anul = [e for e in q["nes"] if e["anular"] > 0]
        if anul:
            prov.append(["Anular no SIAFI o saldo sem uso das notas de empenho, no total de ", brl_ext(q["F"]), ": "
                         + "; ".join(f"{e['numero']} – {brl(e['anular'])}" for e in anul)])
        else:
            prov.append(["Não há saldo de nota de empenho a anular no SIAFI"])
        if q["pend"]:
            res = [e for e in q["nes"] if e["reservado"] > 0]
            prov.append(["Manter ", brl_ext(q["C"]), " nas notas de empenho para pagar os serviços do item 2 ("
                         + "; ".join(f"{e['numero']} – {brl(e['reservado'])}" for e in res) + ")"])
        prov.append(["Registrar o novo período (", novo_ini or falta("__/__/____"), " a ", novo_fim or falta("__/__/____"),
                     ") somente com o valor do ", f"{n_ta} Termo Aditivo, ", brl_ext(novo),
                     ", sem somar o saldo do período anterior"])
    letras = "abcdefg"
    for i, pv in enumerate(prov):
        ult = i == len(prov) - 1
        p = par(doc, after=6 if ult else 1, junto=ult)    # última providência presa às observações e à assinatura
        p.paragraph_format.left_indent = Cm(1.0)
        p.paragraph_format.first_line_indent = Cm(-0.6)
        escrever(p, [f"{letras[i]}) "] + pv + ["." if ult else ";"])

    obs = str(sp.get("observacoes") or "").strip()
    escrever(par(doc, after=0, junto=True), [("5. OBSERVAÇÕES DA FISCALIZAÇÃO: ", {"bold": True}),
                                             obs if obs else "não há."])

    run(par(doc, R, before=12, after=0, junto=True), "Data conforme assinatura eletrônica.")
    run(par(doc, C, before=24, after=0), d.get("cargo_gestor", "Gestor do Contrato"))

    os.makedirs(saida, exist_ok=True)
    caminho = os.path.join(saida, "Demonstrativo de Execucao e Saldo - CT " + d["contrato"].replace("/", "-") + ".docx")
    doc.save(caminho)
    print("RESUMO – Demonstrativo de Execução e Saldo do Período de Vigência")
    print("  Arquivo:", caminho)
    print(f"  Período {ini} a {fim} | A {brl(q['A']) if q['A'] is not None else '?'} | B {brl(q['B'])} | "
          f"C {brl(q['C'])} | D {brl(q['D']) if q['D'] is not None else '?'} | E {brl(q['E'])} | F {brl(q['F'])}")
    print("  Prorrogação", "SEM valor (saldo continua)" if sem_valor else f"COM valor (novo período: {brl(novo)})")
    for a in avisos:
        print("  ⚠️", a)
    return caminho


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        gerar(json.load(f), sys.argv[2])
