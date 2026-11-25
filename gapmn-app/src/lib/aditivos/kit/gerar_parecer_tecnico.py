#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Gera o PARECER TÉCNICO DE ALTERAÇÃO CONTRATUAL do termo aditivo (.docx) – item 5 da Lista.

Uso:  python3 gerar_parecer_tecnico.py dados.json saida/
      (brasao.png na mesma pasta deste script)

Regras do Chefe da SCON (áudios de 25/11/2026), sobre o modelo "PARECER TÉCNICO DE ALTERAÇÃO CONTRATUAL":
- Cabeçalho: brasão, MINISTÉRIO DA DEFESA, COMANDO DA AERONÁUTICA e a OM QUE ASSINA O CONTRATO.
- Parecer nº (controle da OM/fiscal) · Processo nº = PAG · Assunto fixo · Referência: Contrato nº.
- Anexos: SÓ quando há reajuste – "Anexos: Consulta índice IPCA." (o índice do contrato). Sem reajuste, a linha não sai.
  Pareceres referenciais não entram (são tratados no Atestado de adequação).
- 1 a 4: contrato, OM contratante, empresa contratada, objeto resumido (do cadastro).
- 5 VALORES TOTAIS DO CONTRATO: contrato inicial e depois cada documento NA ORDEM DE ASSINATURA, com o VALOR QUE O
  CONTRATO PASSOU A TER depois dele (valor anterior + o que o documento acrescentou). Prorrogação que só renova o
  limite repete o valor; reajuste/acréscimo somam; supressão subtrai. Só o valor, sem descrever o documento.
- 6 VALOR DO Xº TERMO ADITIVO A SER FIRMADO = valor que o contrato passará a ter (o mesmo da Ficha e do Atestado), com extenso.
- 7 ENQUADRAMENTO LEGAL e 8 TIPO(S) DE ALTERAÇÃO: das opções marcadas no início do aditivo; Lei 14.133 ou 8.666.
  Prorrogação: nº de meses + início e fim + com valor / sem valor (sentido estrito).
  Reajuste: "Reajuste de X,XXXXXX% (todas as casas da Calculadora do Cidadão), conforme índice ..., sobre o valor anual do contrato".
- 9 MOTIVO(S): textos-padrão por alteração (sugestões amarradas a cláusula, período e artigo), que o fiscal pode
  editar, apagar ou completar com novos parágrafos ("+ Adicionar motivo"). Com reajuste, entram logo abaixo os PRINTS
  da Calculadora do Cidadão feitos no módulo Reajustes (anexos.calculadora_prints).
- 10 CRONOGRAMA FÍSICO-FINANCEIRO: tabela dos itens do contrato (nº e descrição do contrato), valor atual e valor
  após o termo aditivo (o fiscal pode corrigir os dois); contínuo → com o valor mensal; escopo → prazos de entrega,
  recebimento e pagamento.
- 11 PARECER DO FISCAL: texto fixo + "manifesta-se favoravelmente" a cada alteração marcada, juntas num só parágrafo.
- "Data conforme assinatura eletrônica." · Gestor do Contrato · linha · declaração do Ordenador · data ·
  "Ordenador de Despesas do/da <sigla da OM que assina o contrato>" (só cargos, sem nomes).

Campos (dados.json): contrato, pag, numero_aditivo, om_signataria, contratada{nome,cnpj}, objeto_resumido|objeto_contrato,
valor_atual, valor_novo (opcional), lei ("14133"|"8666"), aditivo{...}, pareceres_referenciais, historico[...],
itens[...], anexos{calculadora_prints:[...]}, parecer_tecnico{numero, anexos, motivos, motivos_adicionais,
clausula_vigencia, clausula_reajuste, natureza ("continuado"|"escopo"), cronograma_escopo, base ("anual"|"mensal"|"total")}.
Dado que falta → o texto sai marcado em AMARELO no documento e entra nos avisos (o site deve pedir o dado).
"""
import json, os, re, sys, datetime
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX, WD_TAB_ALIGNMENT
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from gerar_ficha_autorizacao import objeto_e_valores, brl, num, data, somar_meses
from gerar_lista_verificacao import LIMITE_ANUENCIA
import pareceres as P

FONTE = "Arial"
ROMANOS_ORD = {1: "1º", 2: "2º"}


# ================================================================ números por extenso (R$)
_U = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze",
      "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
_D = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
_C = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos",
      "novecentos"]


def _ate_999(n):
    if n == 0:
        return ""
    if n == 100:
        return "cem"
    c, r = divmod(n, 100)
    partes = [_C[c]] if c else []
    if r:
        if r < 20:
            partes.append(_U[r])
        else:
            d, u = divmod(r, 10)
            partes.append(_D[d] + (" e " + _U[u] if u else ""))
    return " e ".join(partes)


def inteiro_extenso(n):
    if n == 0:
        return "zero"
    grupos = []
    while n:
        n, g = divmod(n, 1000)
        grupos.append(g)
    nomes = [("", ""), ("mil", "mil"), ("milhão", "milhões"), ("bilhão", "bilhões")]
    partes = []
    for i in range(len(grupos) - 1, -1, -1):
        g = grupos[i]
        if not g:
            continue
        if i == 1 and g == 1:
            txt = "mil"
        else:
            txt = _ate_999(g)
            if i:
                txt += " " + (nomes[i][0] if g == 1 else nomes[i][1])
        partes.append((i, g, txt))
    out = ""
    for k, (i, g, txt) in enumerate(partes):
        if k == 0:
            out = txt
        else:
            ult = k == len(partes) - 1
            usa_e = ult and (g < 100 or g % 100 == 0)
            out += (" e " if usa_e else ", ") + txt
    return out


def reais_extenso(v):
    v = round(float(v) + 1e-9, 2)
    r = int(v)
    c = int(round((v - r) * 100))
    partes = []
    if r:
        txt = inteiro_extenso(r)
        de = " de" if (r >= 1_000_000 and r % 1_000_000 == 0) else ""
        partes.append(txt + de + (" real" if r == 1 else " reais"))
    if c:
        partes.append(inteiro_extenso(c) + (" centavo" if c == 1 else " centavos"))
    return " e ".join(partes) if partes else "zero real"


def brl_ext(v):
    return f"{brl(v)} ({reais_extenso(v)})"


def meses_ext(m):
    return f"{m} ({inteiro_extenso(m)}) {'mês' if m == 1 else 'meses'}"


def pct_txt(p, casas=2):
    """'4,724910%' (texto do site) fica como está; número vira texto com as casas pedidas."""
    if p is None:
        return None
    if isinstance(p, str) and p.strip():
        s = p.strip()
        return s if s.endswith("%") else s + "%"
    return f"{float(p):.{casas}f}".replace(".", ",") + "%"


def ordinal(n):
    return f"{int(n)}º"


# ================================================================ leis e artigos
LEIS = {"14133": "da Lei nº 14.133/2021", "8666": "da Lei nº 8.666/1993"}
ART = {
    "14133": {
        "prorrogacao": "art. 107", "prorrogacao_escopo": "art. 111", "prorrogacao_com_alteracao": "art. 106, art. 107",
        "reajuste": "art. 92, § 4º", "acrescimo": "art. 124, inciso I, alínea \"b\", e art. 125",
        "supressao": "art. 124, inciso I, alínea \"b\", e art. 125",
        "supressao_acordo": "art. 124, inciso II, alínea \"a\" (acordo entre as partes)",
        "limite": "art. 125",
    },
    "8666": {
        "prorrogacao": "art. 57, inciso II", "prorrogacao_escopo": "art. 57, § 1º", "prorrogacao_com_alteracao": "art. 57, inciso II",
        "reajuste": "art. 40, inciso XI, e art. 55, inciso III",
        "acrescimo": "art. 65, inciso I, alínea \"b\", e § 1º", "supressao": "art. 65, inciso I, alínea \"b\", e § 1º",
        "supressao_acordo": "art. 65, § 2º, inciso II (acordo entre as partes)",
        "limite": "art. 65, § 1º",
    },
}


def lei_do(d, avisos):
    l = re.sub(r"\D", "", str(d.get("lei") or ""))
    if l.startswith("14133") or l == "14133":
        return "14133"
    if l.startswith("8666"):
        return "8666"
    # deduz pela lei dos pareceres usados
    for p in d.get("pareceres_referenciais") or []:
        lp = re.sub(r"\D", "", str(p.get("lei") or ""))
        if lp in ("14133", "8666"):
            return lp
    avisos.append("Lei do contrato não informada (lei = 14133 ou 8666): usei a Lei 14.133/2021 – conferir.")
    return "14133"


# ================================================================ docx helpers
def run(p, texto, size=11, bold=False, italic=False, underline=False, marca=False):
    r = p.add_run(texto)
    r.font.name = FONTE
    r._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONTE)
    r.font.size = Pt(size)
    r.bold, r.italic, r.underline = bold, italic, underline
    if marca:
        r.font.highlight_color = WD_COLOR_INDEX.YELLOW
    return r


def par(doc, align=WD_ALIGN_PARAGRAPH.JUSTIFY, before=0, after=8, junto=False, recuo=None, line=1.0):
    p = doc.add_paragraph()
    p.alignment = align
    pf = p.paragraph_format
    pf.space_before, pf.space_after = Pt(before), Pt(after)
    pf.line_spacing = line
    pf.keep_with_next = junto
    if recuo is not None:
        pf.first_line_indent = recuo
    return p


def escrever(p, partes, size=11):
    """partes: lista de (texto, {bold, marca, italic}) ou str."""
    for x in partes:
        if isinstance(x, str):
            run(p, x, size)
        else:
            t, f = x
            run(p, t, size, bold=f.get("bold", False), italic=f.get("italic", False), marca=f.get("marca", False))


def falta(txt):
    return (txt, {"marca": True})


def sombrear(cell, cor="D9D9D9"):
    tcPr = cell._element.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear"), shd.set(qn("w:color"), "auto"), shd.set(qn("w:fill"), cor)
    tcPr.append(shd)


def celula(cell, texto, bold=False, align=WD_ALIGN_PARAGRAPH.LEFT, size=9, marca=False):
    cell.text = ""
    p = cell.paragraphs[0]
    p.alignment = align
    p.paragraph_format.space_after = Pt(0)
    run(p, texto, size, bold=bold, marca=marca)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def larguras(t, cms):
    t.autofit = False
    grid = t._tbl.tblGrid
    for i, gc in enumerate(grid.findall(qn("w:gridCol"))):
        gc.set(qn("w:w"), str(int(cms[i] * 567)))
    for row in t.rows:
        for i, c in enumerate(row.cells):
            c.width = Cm(cms[i])


def manter_linhas(t):
    for row in t.rows:
        trPr = row._tr.get_or_add_trPr()
        cs = OxmlElement("w:cantSplit")
        trPr.append(cs)
        for c in row.cells:
            for p in c.paragraphs:
                p.paragraph_format.keep_with_next = True


# ================================================================ conteúdo
def texto_objeto(d):
    obj = str(d.get("objeto_resumido") or d.get("objeto_contrato") or "").strip().rstrip(".")
    if obj.isupper():
        pal = obj.split()
        comuns = {"DE", "DA", "DO", "DAS", "DOS", "E", "PARA", "COM", "EM", "NO", "NA", "A", "O", "AS", "OS", "POR"}
        out = []
        for i, w in enumerate(pal):
            limpo = re.sub(r"\W", "", w)
            if 2 <= len(limpo) <= 5 and limpo not in comuns and not re.search(r"[ÁÉÍÓÚÂÊÔÃÕÇ]", limpo) \
                    and i == len(pal) - 1:
                out.append(w)              # sigla no fim (ex.: SMP)
            else:
                out.append(w.lower())
        obj = " ".join(out)
        obj = obj[:1].upper() + obj[1:]
    return obj


def contratada(d):
    c = d.get("contratada") or {}
    if isinstance(c, str):
        return c
    return c.get("nome") or d.get("empresa") or ""


def historico_linhas(d, avisos):
    """[(rótulo, valor|None)] – valor que o contrato passou a ter depois de cada documento."""
    hist = d.get("historico") or []
    linhas, anterior = [], None
    for h in hist:
        rot = str(h.get("documento") or "").strip().upper()
        v = h.get("valor")
        if v in (None, "") and h.get("variacao") not in (None, "") and anterior is not None:
            v = anterior + num(h["variacao"])
        if v in (None, ""):
            doc_ = str(h.get('documento') or '')
            avisos.append("Item 5: falta o valor do " + ("contrato inicial" if doc_.lower().startswith("contrato")
                          else f"contrato depois do {doc_}") + " – preencher.")
            linhas.append((rot, None))
            anterior = None
        else:
            v = round(num(v), 2)
            linhas.append((rot, v))
            anterior = v
    if not hist:
        avisos.append("Item 5: histórico de valores não informado (historico) – usar o do cadastro do contrato.")
    return linhas


def artigos_enquadramento(d, lei, avisos):
    ad = d.get("aditivo") or {}
    A = ART[lei]
    pt = d.get("parecer_tecnico") or {}
    escopo = pt.get("natureza") == "escopo"
    frags = []
    alt_valor = any(ad.get(k) for k in ("acrescimo", "supressao"))
    if ad.get("prorrogacao"):
        frags.append(A["prorrogacao_escopo"] if escopo else
                     (A["prorrogacao_com_alteracao"] if alt_valor else A["prorrogacao"]))
    if ad.get("reajuste"):
        frags.append(A["reajuste"])
    for k in ("acrescimo", "supressao"):
        x = ad.get(k)
        if not x:
            continue
        pct = num(x["percentual"]) if x.get("percentual") not in (None, "") else None
        if k == "supressao" and pct is not None and pct > LIMITE_ANUENCIA:
            frags.append(A["supressao_acordo"])
        else:
            frags.append(A[k])
        if k == "acrescimo" and pct is not None and pct > LIMITE_ANUENCIA:
            avisos.append(f"Acréscimo de {pct:.2f}% passa do limite de 25% ({A['limite']} {LEIS[lei]}) – só reforma "
                          "permite 50% (Lei 14.133) – conferir; o aditivo vai para a CJU.")
    vistos, unicos = set(), []
    for f in frags:
        if f not in vistos:
            vistos.add(f), unicos.append(f)
    if not unicos:
        return ""
    if len(unicos) == 1:
        return f"{unicos[0]}, {LEIS[lei]}"
    return "; ".join(unicos[:-1]) + "; e " + unicos[-1] + f", todos {LEIS[lei]}"


def art_de(chave, d, lei):
    """Artigo de uma alteração isolada, para os textos dos itens 9 e 11."""
    A = ART[lei]
    pt = d.get("parecer_tecnico") or {}
    if chave == "prorrogacao":
        f = A["prorrogacao_escopo"] if pt.get("natureza") == "escopo" else A["prorrogacao"]
    elif chave == "supressao":
        x = (d.get("aditivo") or {}).get("supressao") or {}
        pct = num(x["percentual"]) if x.get("percentual") not in (None, "") else 0
        f = A["supressao_acordo"] if pct > LIMITE_ANUENCIA else A["supressao"]
    else:
        f = A[chave]
    return f"{f}, {LEIS[lei]}"


def periodo(d, avisos):
    pr = (d.get("aditivo") or {}).get("prorrogacao") or {}
    ini, fim = pr.get("inicio"), pr.get("fim")
    if ini and not fim and pr.get("meses"):
        fim = (somar_meses(data(ini), int(pr["meses"])) - datetime.timedelta(days=1)).strftime("%d/%m/%Y")
    if pr and (not ini or not fim):
        avisos.append("Prorrogação sem início/fim do novo período (aditivo.prorrogacao.inicio/fim ou meses).")
    return ini, fim


def tipos_alteracao(d, lei, ini, fim, atual, avisos):
    """Item 8 – uma linha por alteração marcada (com partes marcadas em amarelo quando falta dado)."""
    ad = d.get("aditivo") or {}
    pt = d.get("parecer_tecnico") or {}
    base = {"anual": "anual", "mensal": "mensal", "total": "total"}.get(pt.get("base", "anual"), "anual")
    linhas = []
    pr = ad.get("prorrogacao")
    if pr:
        m = int(pr.get("meses") or 0)
        prazo = meses_ext(m) if m else None
        l = ["Prorrogação contratual por mais ", prazo or falta("__ meses"), ", de ", ini or falta("__/__/____"),
             " a ", fim or falta("__/__/____"), ", "]
        l.append("sem renovação do valor contratual (prorrogação em sentido estrito, apenas da vigência)"
                 if pr.get("modalidade") == "sem_valor" else "com renovação do valor contratual")
        linhas.append(l)
    rj = ad.get("reajuste")
    if rj:
        p = pct_txt(rj.get("percentual"), 6)
        if not p:
            avisos.append("Reajuste sem percentual (todas as casas decimais da Calculadora do Cidadão).")
        linhas.append(["Reajuste de ", p or falta("XX,XXXXXX%"), ", conforme índice ",
                       rj.get("indice") or falta("XXXX"), f", sobre o valor {base} do contrato"])
    for k, nome in (("acrescimo", "Acréscimo"), ("supressao", "Supressão")):
        x = ad.get(k)
        if not x:
            continue
        p = pct_txt(num(x["percentual"]) if x.get("percentual") not in (None, "") else None)
        l = [f"{nome} de ", p or falta("XX,XX%"), " sobre o valor inicial atualizado do contrato, no valor de ",
             brl_ext(num(x["valor"])) if x.get("valor") not in (None, "") else falta("R$ ___")]
        if x.get("descricao"):
            l.append(f", referente a {x['descricao'].strip().rstrip('.')}")
        linhas.append(l)
    return linhas


def motivos_sugeridos(d, lei, ini, fim, atual, novo, avisos):
    """Item 9 – um parágrafo por alteração (o site mostra estes textos já preenchidos e o fiscal edita)."""
    ad = d.get("aditivo") or {}
    pt = d.get("parecer_tecnico") or {}
    escopo = pt.get("natureza") == "escopo"
    cv = pt.get("clausula_vigencia")
    cr = pt.get("clausula_reajuste")
    out = []
    pr = ad.get("prorrogacao")
    if pr:
        m = int(pr.get("meses") or 0)
        if escopo:
            abre = ("A celebração do presente Termo Aditivo justifica-se pela necessidade de conclusão do objeto "
                    "contratado, cuja execução ainda não foi finalizada, não sendo conveniente a sua interrupção. ")
        else:
            abre = ("A celebração do presente Termo Aditivo justifica-se pela necessidade de continuidade dos serviços "
                    "contratados, os quais se mostram essenciais ao atendimento das demandas da Contratante, não sendo "
                    "conveniente a interrupção de sua execução. ")
        p = [abre, "O referido Termo Aditivo decorre da prorrogação do prazo de vigência da contratação por mais ",
             meses_ext(m) if m else falta("__ meses"), ", contemplando-se, nesta ocasião, o período de ",
             ini or falta("__/__/____"), " a ", fim or falta("__/__/____"), ", na forma do ",
             art_de("prorrogacao", d, lei), ", conforme previsto na "]
        if cv:
            p.append(cv)
        else:
            p.append(falta("CLÁUSULA ___, item ___ (cláusula de vigência)"))
            avisos.append("Item 9: cláusula de vigência do contrato não informada (parecer_tecnico.clausula_vigencia) – "
                          "ler no PDF do contrato.")
        p.append(" do contrato")
        p.append(", sem renovação do valor contratual." if pr.get("modalidade") == "sem_valor"
                 else ", com renovação do valor contratual.")
        out.append(p)
    rj = ad.get("reajuste")
    if rj:
        pct = pct_txt(rj.get("percentual"), 6)
        valor_rj = num(rj["valor"]) if rj.get("valor") not in (None, "") else None
        nominal = atual
        corrigido = round(nominal + valor_rj, 2) if (nominal is not None and valor_rj is not None) else None
        abre = ("O presente Termo Aditivo contempla, ainda, a necessidade de reajuste pelo índice " if pr else
                "A celebração do presente Termo Aditivo decorre da necessidade de reajuste pelo índice ")
        p = [abre, rj.get("indice") or falta("XXXX"), ", conforme estabelece a "]
        if cr:
            p.append(cr)
        else:
            p.append(falta("CLÁUSULA ___, item ___ (cláusula de reajuste)"))
            avisos.append("Item 9: cláusula de reajuste não informada (parecer_tecnico.clausula_reajuste).")
        p += [" do ajuste contratual. O reajuste corresponde ao percentual de ", pct or falta("XX,XXXXXX%"),
              " sobre o valor nominal de ", brl_ext(nominal) if nominal is not None else falta("R$ ___"),
              ", resultando no valor corrigido de ", brl_ext(corrigido) if corrigido is not None else falta("R$ ___"),
              ", fonte de pesquisa: Calculadora do Cidadão (Banco Central do Brasil)."]
        out.append(p)
    for k, nome, verbo in (("acrescimo", "O acréscimo", "justifica-se pela necessidade de"),
                           ("supressao", "A supressão", "decorre de")):
        x = ad.get(k)
        if not x:
            continue
        pctn = num(x["percentual"]) if x.get("percentual") not in (None, "") else None
        p = [f"{nome} de ", pct_txt(pctn) if pctn is not None else falta("XX,XX%"),
             " sobre o valor inicial atualizado do contrato, no montante de ",
             brl_ext(num(x["valor"])) if x.get("valor") not in (None, "") else falta("R$ ___"), f", {verbo} "]
        if x.get("descricao"):
            p.append(x["descricao"].strip().rstrip("."))
        else:
            p.append(falta("[descrever a necessidade]"))
            avisos.append(f"Item 9: descreva a necessidade do(a) {nome.split()[1]} (aditivo.{k}.descricao).")
        if k == "supressao" and pctn is not None and pctn > LIMITE_ANUENCIA:
            p.append(", mediante acordo entre as partes, nos termos do " + art_de("supressao", d, lei) + ".")
        else:
            p.append(", observado o limite de 25% (vinte e cinco por cento) previsto no "
                     f"{ART[lei]['limite']}, {LEIS[lei]}.")
        out.append(p)
    if out and atual is not None and novo is not None and round(novo - atual, 2) != 0:
        out[-1].append(f" Com as alterações deste Termo Aditivo, o valor do contrato passa de {brl_ext(atual)} "
                       f"para {brl_ext(novo)}.")
    return out


def parecer_fiscal(d, lei, ini, fim, atual, novo):
    ad = d.get("aditivo") or {}
    partes = []
    pr = ad.get("prorrogacao")
    if pr:
        p = ["à prorrogação da vigência do contrato, cuja nova vigência passará a ser do dia ",
             ini or falta("__/__/____"), " até o dia ", fim or falta("__/__/____")]
        p.append(", em sentido estrito, sem renovação do valor contratual" if pr.get("modalidade") == "sem_valor"
                 else ", com renovação do valor contratual")
        p.append(f", nos termos do {art_de('prorrogacao', d, lei)}")
        partes.append(p)
    rj = ad.get("reajuste")
    if rj:
        p = ["ao reajuste de ", pct_txt(rj.get("percentual"), 6) or falta("XX,XXXXXX%"), ", conforme índice ",
             rj.get("indice") or falta("XXXX")]
        if rj.get("valor") not in (None, ""):
            p.append(f", no valor de {brl_ext(num(rj['valor']))}")
        p.append(f", nos termos do {art_de('reajuste', d, lei)}")
        partes.append(p)
    for k, art_txt in (("acrescimo", "ao acréscimo"), ("supressao", "à supressão")):
        x = ad.get(k)
        if not x:
            continue
        pctn = num(x["percentual"]) if x.get("percentual") not in (None, "") else None
        p = [f"{art_txt} de ", pct_txt(pctn) if pctn is not None else falta("XX,XX%"),
             " sobre o valor inicial atualizado do contrato, no valor de ",
             brl_ext(num(x["valor"])) if x.get("valor") not in (None, "") else falta("R$ ___"),
             f", nos termos do {art_de(k, d, lei)}"]
        partes.append(p)
    frase = ["A fiscalização do contrato atesta que a contratada vem cumprindo regularmente suas obrigações contratuais, "
             "exercendo suas atividades de forma satisfatória e prestando os serviços a contento da Administração. "
             "Diante disso, considerando o interesse da Administração na continuidade da prestação dos serviços, bem como "
             "a vantajosidade da manutenção da contratação, esta Fiscalização manifesta-se favoravelmente "]
    for i, p in enumerate(partes):
        if i:
            frase.append("; e " if i == len(partes) - 1 else "; ")
        frase += p
    if atual is not None and novo is not None and round(novo - atual, 2) != 0:
        frase.append(f", resultando no valor total do contrato de {brl_ext(novo)}")
    frase.append(".")
    return frase


def itens_tabela(d, atual, novo, avisos):
    itens = [dict(i) for i in (d.get("itens") or [])]
    if not itens:
        avisos.append("Item 10: itens do contrato não informados (itens) – puxar do cadastro (nº e descrição do contrato).")
        return []
    for i in itens:
        i["valor_atual"] = round(num(i["valor_atual"]), 2) if i.get("valor_atual") not in (None, "") else None
        i["valor_apos"] = round(num(i["valor_apos"]), 2) if i.get("valor_apos") not in (None, "") else None
    soma_atual = round(sum(i["valor_atual"] or 0 for i in itens), 2)
    if atual is not None and abs(soma_atual - atual) > 0.009:
        avisos.append(f"Item 10: a soma dos valores atuais dos itens ({brl(soma_atual)}) difere do valor atual do "
                      f"contrato ({brl(atual)}) – conferir.")
    faltam = [i for i in itens if i["valor_apos"] is None]
    if faltam and novo is not None and soma_atual:
        fator = novo / soma_atual
        for i in faltam:
            i["valor_apos"] = round((i["valor_atual"] or 0) * fator, 2)
        dif = round(novo - sum(i["valor_apos"] for i in itens), 2)
        if dif:
            maior = max(faltam, key=lambda i: i["valor_apos"])
            maior["valor_apos"] = round(maior["valor_apos"] + dif, 2)
    soma_apos = round(sum(i["valor_apos"] or 0 for i in itens), 2)
    if novo is not None and abs(soma_apos - novo) > 0.009:
        avisos.append(f"Item 10: a soma dos itens após o aditivo ({brl(soma_apos)}) difere do valor do termo "
                      f"({brl(novo)}) – conferir.")
    return itens


# ================================================================ geração
def gerar(d, saida):
    erros, avisos = [], []
    om = d.get("om_signataria") or {}
    pt = d.get("parecer_tecnico") or {}
    for campo in ("contrato", "numero_aditivo"):
        if not str(d.get(campo) or "").strip():
            erros.append(f"Campo obrigatório vazio: {campo}")
    if not om.get("sigla") and not om.get("nome"):
        erros.append("OM que assina o contrato não informada (om_signataria).")
    _, atual, novo = objeto_e_valores(d, erros, avisos)
    if erros:
        print("ERROS – Parecer Técnico NÃO gerado:")
        for e in erros:
            print("  ❌", e)
        sys.exit(1)
    lei = lei_do(d, avisos)
    ini, fim = periodo(d, avisos)
    n_ta = ordinal(d["numero_aditivo"])
    sigla = om.get("sigla") or ""
    artigo = om.get("artigo") or "do"

    doc = Document()
    s = doc.sections[0]
    s.page_width, s.page_height = Cm(21.0), Cm(29.7)
    s.top_margin, s.bottom_margin = Cm(2.0), Cm(2.0)
    s.left_margin, s.right_margin = Cm(2.0), Cm(2.0)
    st = doc.styles["Normal"]
    st.font.name, st.font.size = FONTE, Pt(11)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONTE)

    # ---- cabeçalho
    p = par(doc, WD_ALIGN_PARAGRAPH.CENTER, after=0)
    brasao = os.path.join(AQUI, "brasao.png")
    if os.path.exists(brasao):
        p.add_run().add_picture(brasao, height=Cm(2.25))
    run(par(doc, WD_ALIGN_PARAGRAPH.CENTER, after=0), "MINISTÉRIO DA DEFESA", bold=True)
    run(par(doc, WD_ALIGN_PARAGRAPH.CENTER, after=0), "COMANDO DA AERONÁUTICA")
    run(par(doc, WD_ALIGN_PARAGRAPH.CENTER, after=22), (pt.get("om_cabecalho") or om.get("nome") or sigla).upper(),
        underline=True)

    numero = str(pt.get("numero") or "").strip()
    if not numero:
        avisos.append("Nº do Parecer Técnico não informado (parecer_tecnico.numero – controle da OM ou do fiscal).")
    escrever(par(doc, after=0), ["Parecer nº ", numero or falta("___/____/____")])
    escrever(par(doc, after=12), ["Processo nº ", d.get("pag") or falta("00000.000000/0000-00")])
    escrever(par(doc, after=12), ["Assunto: Parecer Técnico de Alteração Contratual."])
    escrever(par(doc, after=12), [f"Referência: Contrato nº {d['contrato']}."])

    # Anexos: SÓ com reajuste – "Consulta índice <nome do índice>" (regra do Chefe da SCON, 25/11/2026).
    # Os pareceres referenciais NÃO entram aqui (vão no Atestado de adequação). Sem reajuste, a linha "Anexos" não sai.
    anexos = pt.get("anexos")
    if anexos is None:
        rj = (d.get("aditivo") or {}).get("reajuste")
        anexos = [f"Consulta índice {rj.get('indice') or '____'}"] if rj else []
    if isinstance(anexos, str):
        anexos = [anexos]
    anexos = [a.strip().rstrip(".;") for a in anexos if str(a or "").strip()]
    if anexos:
        escrever(par(doc, after=14), ["Anexos: " + "; ".join(anexos) + "."])
    else:
        doc.paragraphs[-1].paragraph_format.space_after = Pt(14)

    def item(nro, rotulo, valor_partes, after=12, junto=False):
        p = par(doc, after=after, junto=junto)
        p.paragraph_format.tab_stops.add_tab_stop(Cm(1.0))
        escrever(p, [f"{nro}.\t{rotulo}"] + (valor_partes or []))
        return p

    item(1, "CONTRATO Nº: ", [d["contrato"]])
    om_txt = (om.get("nome") or "") + (f" ({sigla})" if sigla and om.get("nome") else sigla if not om.get("nome") else "")
    item(2, "OM CONTRATANTE: ", [om_txt])
    emp = contratada(d)
    if not emp:
        avisos.append("Empresa contratada não informada (contratada.nome).")
    item(3, "EMPRESA CONTRATADA: ", [emp or falta("XXXXXXX")])
    obj = texto_objeto(d)
    item(4, "OBJETO RESUMIDO: ", [obj or falta("Contratação de XXXXXXX")])

    # 5 – histórico
    item(5, "VALORES TOTAIS DO CONTRATO:", [], after=0, junto=True)
    hist = historico_linhas(d, avisos)
    for i, (rot, v) in enumerate(hist):
        escrever(par(doc, after=0 if i < len(hist) - 1 else 12, junto=i < len(hist) - 1),
                 [f"{rot}: ", brl(v) if v is not None else falta("R$ ___ (preencher)")])
    if not hist:
        escrever(par(doc, after=12), [falta("CONTRATO INICIAL: R$ ___ (preencher o histórico)")])

    # 6
    item(6, f"VALOR DO {n_ta} TERMO ADITIVO A SER FIRMADO: ", [brl_ext(novo) + "."])

    # 7
    enq = artigos_enquadramento(d, lei, avisos)
    item(7, "ENQUADRAMENTO LEGAL: ", [enq + "." if enq else falta("___")])

    # 8
    tipos = tipos_alteracao(d, lei, ini, fim, atual, avisos)
    item(8, "TIPO(S) DE ALTERAÇÃO:", [] if len(tipos) > 1 else [" "] + tipos[0] + ["."] if tipos else [],
         after=0 if len(tipos) > 1 else 12, junto=len(tipos) > 1)
    if len(tipos) > 1:
        letras = "abcdefg"
        for i, t in enumerate(tipos):
            ult = i == len(tipos) - 1
            p = par(doc, after=12 if ult else 2, junto=not ult)
            p.paragraph_format.left_indent = Cm(1.0)
            p.paragraph_format.first_line_indent = Cm(-0.6)
            escrever(p, [f"{letras[i]}) "] + t + ["." if ult else ";"])

    # 9 – motivos (os do fiscal, se houver; senão as sugestões) + prints
    if pt.get("motivos"):
        motivos = [[str(m).strip()] for m in pt["motivos"] if str(m or "").strip()]
    else:
        motivos = motivos_sugeridos(d, lei, ini, fim, atual, novo, avisos)
    for m in pt.get("motivos_adicionais") or []:
        if str(m or "").strip():
            motivos.append([str(m).strip()])
    p = par(doc, after=6)
    p.paragraph_format.tab_stops.add_tab_stop(Cm(1.0))
    escrever(p, ["9.\tMOTIVO(S): "] + (motivos[0] if motivos else [falta("[motivo]")]))
    for m in motivos[1:]:
        escrever(par(doc, after=6, recuo=Cm(1.0)), m)
    rj = (d.get("aditivo") or {}).get("reajuste")
    if rj:
        prints = [x for x in ((d.get("anexos") or {}).get("calculadora_prints") or []) if x]
        if not prints:
            avisos.append("Item 9: faltam os prints da Calculadora do Cidadão (fazer no módulo Reajustes, instrumento "
                          "'Termo Aditivo').")
            escrever(par(doc, WD_ALIGN_PARAGRAPH.CENTER, after=6),
                     [falta("[PRINT DO RESULTADO DA CALCULADORA DO CIDADÃO – gerar no módulo Reajustes]")])
        for img in prints:
            if os.path.exists(img):
                pi = par(doc, WD_ALIGN_PARAGRAPH.CENTER, after=6)
                pi.add_run().add_picture(img, width=Cm(14.0))
            else:
                avisos.append(f"Print não encontrado: {img}")
    doc.paragraphs[-1].paragraph_format.space_after = Pt(12)

    # 10 – cronograma físico-financeiro
    pr = (d.get("aditivo") or {}).get("prorrogacao") or {}
    meses = int(pr.get("meses") or 12)
    escopo = pt.get("natureza") == "escopo"
    item(10, "ATUALIZAÇÃO DO CRONOGRAMA FÍSICO-FINANCEIRO:", [], after=4, junto=True)
    if escopo:
        etapas = pt.get("cronograma_escopo") or []
        escrever(par(doc, after=4, junto=True),
                 ["Cronograma com os prazos de entrega, recebimento e pagamento atualizados:"])
        t = doc.add_table(rows=1, cols=5)
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for c, txt in zip(t.rows[0].cells, ("ETAPA", "ENTREGA", "RECEBIMENTO", "PAGAMENTO", "VALOR (R$)")):
            celula(c, txt, True, WD_ALIGN_PARAGRAPH.CENTER), sombrear(c)
        if not etapas:
            avisos.append("Item 10 (escopo): cronograma de entregas não informado (parecer_tecnico.cronograma_escopo).")
            etapas = [{"etapa": "___", "entrega": "___", "recebimento": "___", "pagamento": "___", "valor": None}]
        for e in etapas:
            r = t.add_row().cells
            vals = (e.get("etapa"), e.get("entrega"), e.get("recebimento"), e.get("pagamento"),
                    brl(num(e["valor"]))[3:] if e.get("valor") not in (None, "") else "___")
            for c, v in zip(r, vals):
                celula(c, str(v or "___"), align=WD_ALIGN_PARAGRAPH.CENTER)
        larguras(t, [5.0, 3.0, 3.0, 3.0, 3.0])
    else:
        itens = itens_tabela(d, atual, novo, avisos)
        base = pt.get("base", "anual")
        mostra_mensal = base == "anual" and not (pr and pr.get("modalidade") == "sem_valor")
        intro = "Cronograma físico-financeiro atualizado dos itens do contrato"
        if ini and fim:
            intro += f", para o período de {ini} a {fim}"
        escrever(par(doc, after=4, junto=True), [intro + ":"])
        cab = ["ITEM", "DESCRIÇÃO", "VALOR ATUAL (R$)", f"VALOR APÓS O {n_ta} TERMO ADITIVO (R$)"]
        if mostra_mensal:
            cab.append(f"VALOR MENSAL APÓS O {n_ta} TERMO ADITIVO (R$)")
        t = doc.add_table(rows=1, cols=len(cab))
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for c, txt in zip(t.rows[0].cells, cab):
            celula(c, txt, True, WD_ALIGN_PARAGRAPH.CENTER, 8), sombrear(c)
        R = WD_ALIGN_PARAGRAPH.RIGHT
        tot_m = 0.0
        for i in itens or [{"item": "___", "descricao": "___", "valor_atual": None, "valor_apos": None}]:
            r = t.add_row().cells
            celula(r[0], str(i.get("item") or ""), align=WD_ALIGN_PARAGRAPH.CENTER)
            celula(r[1], str(i.get("descricao") or ""))
            celula(r[2], brl(i["valor_atual"])[3:] if i.get("valor_atual") is not None else "___", align=R,
                   marca=i.get("valor_atual") is None)
            celula(r[3], brl(i["valor_apos"])[3:] if i.get("valor_apos") is not None else "___", align=R,
                   marca=i.get("valor_apos") is None)
            if mostra_mensal:
                vm = round((i.get("valor_apos") or 0) / meses, 2) if i.get("valor_apos") is not None else None
                tot_m += vm or 0
                celula(r[4], brl(vm)[3:] if vm is not None else "___", align=R)
        r = t.add_row().cells
        r[0].merge(r[1])
        celula(r[0], "TOTAL", True, R)
        celula(r[2], brl(sum(i["valor_atual"] or 0 for i in itens))[3:] if itens else "___", True, R)
        celula(r[3], brl(sum(i["valor_apos"] or 0 for i in itens))[3:] if itens else "___", True, R)
        if mostra_mensal:
            celula(r[4], brl(tot_m)[3:], True, R)
        for c in r:
            sombrear(c, "F2F2F2")
        larguras(t, [1.3, 6.6, 3.0, 3.1, 3.0] if mostra_mensal else [1.3, 9.6, 3.1, 3.0])
        manter_linhas(t)
        if mostra_mensal:
            p = par(doc, before=4, after=0)
            escrever(p, [(f"Valor mensal = valor após o termo aditivo ÷ {meses} meses do novo período "
                          "(execução mensal estimada).", {"italic": True})], size=9)
    doc.paragraphs[-1].paragraph_format.space_after = Pt(12)

    # 11 – parecer do fiscal + assinaturas (juntos)
    p = par(doc, before=12, after=0, junto=True)
    p.paragraph_format.tab_stops.add_tab_stop(Cm(1.0))
    escrever(p, ["11.\tPARECER DO FISCAL: "] + parecer_fiscal(d, lei, ini, fim, atual, novo))
    run(par(doc, WD_ALIGN_PARAGRAPH.RIGHT, before=22, after=0, junto=True), "Data conforme assinatura eletrônica.")
    run(par(doc, WD_ALIGN_PARAGRAPH.CENTER, before=30, after=0, junto=True), d.get("cargo_gestor", "Gestor do Contrato"))
    run(par(doc, WD_ALIGN_PARAGRAPH.CENTER, before=8, after=0, junto=True), "_" * 78)
    p = par(doc, before=12, after=0, junto=True, recuo=Cm(1.0))
    run(p, "Declaro haver disponibilidade orçamentária para as alterações contratuais pretendidas e aprovo estas "
           "conforme justificativas apresentadas.")
    run(par(doc, WD_ALIGN_PARAGRAPH.RIGHT, before=22, after=0, junto=True), "Data conforme assinatura eletrônica.")
    run(par(doc, WD_ALIGN_PARAGRAPH.CENTER, before=30, after=0),
        d.get("cargo_ordenador") or f"Ordenador de Despesas {artigo} {sigla}".strip())

    os.makedirs(saida, exist_ok=True)
    caminho = os.path.join(saida, "Parecer Tecnico de Alteracao Contratual - CT "
                           + d["contrato"].replace("/", "-") + ".docx")
    doc.save(caminho)
    print("RESUMO – Parecer Técnico de Alteração Contratual")
    print("  Arquivo:", caminho)
    print(f"  {n_ta} TA | Lei {'14.133/2021' if lei == '14133' else '8.666/1993'} | valor atual {brl(atual)} → {brl(novo)}")
    print("  Enquadramento:", enq)
    for a in avisos:
        print("  ⚠️", a)
    return caminho


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        gerar(json.load(f), sys.argv[2])
