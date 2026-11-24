#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gerador dos 4 documentos de REAJUSTE (SCON/GAP-MN):
  1) Memória de Cálculo (.xlsx)
  2) Declaração de Disponibilidade Orçamentária (.docx)
  3) Parecer Técnico de Reajustamento (.docx)
  4) Termo de Apostilamento (.docx)

Uso:  python3 gerar_apostilamento.py dados.json PASTA_SAIDA
"""
import sys, json, io, os, re
from decimal import Decimal, ROUND_HALF_UP
from datetime import date

# ---------------------------------------------------------------------------
# CONFIGURAÇÃO GERAL (alterar aqui quando a regra mudar)
# ---------------------------------------------------------------------------
# Regra do período lançado na Calculadora do Cidadão / FGV (12 índices mensais, confirmado pela SCON em 16/11/2026):
#   "DOZE_INDICES" -> 07/2024 a 06/2025 (do mês do orçamento até o mês anterior ao aniversário)
#   "MESMO_MES"    -> 07/2024 a 07/2025 (NÃO usar: conta 13 índices; mantido só para referência histórica)
REGRA_PERIODO = "DOZE_INDICES"

DEFAULTS = {
    "cidade": "Manaus",
    "ug_apoio": {
        "nome": "GRUPAMENTO DE APOIO DE MANAUS",
        "sigla": "GAP-MN",
        "endereco": "Avenida Rodrigo Otávio, 780, Bairro Crespo, CEP 69073-177",
        "cnpj": "00.394.429/0188-24",
    },
    "ordenador": {   # dados reais: tabela apostilamento_config do gapmn.app
        "nome": "«nome do Ordenador de Despesas»", "posto": "«posto»", "feminino": False,
        "portaria": "«portaria de nomeação»", "publicacao": "«publicação»", "matricula": "«matrícula»",
        "om_sigla": "GAP-MN",
    },
    "aci": {"nome": "«nome do ACI»", "posto": "«posto»", "funcao": "Agente de Controle Interno"},
    "enquadramento_legal": "Art. 92, Inciso V da Lei 14.133/2021.",
}

# Textos fixos do "I – CONTRATANTE" (termo de apostilamento), por OM do Ordenador de Despesas que assina.
# Regra SCON: OM cadastrada aqui -> usar SEMPRE este texto (mesmo que o contrato inicial traga outro
# Ordenador/publicação). OM não cadastrada -> usar o texto da 1ª página do contrato inicial
# (dados["contratante_paragrafo"]) e cadastrar aqui quando a SCON aprovar. **...** = negrito.
TEXTOS_FIXOS_OM = {}  # textos fixos por OM: tabela apostilamento_config do gapmn.app

# Brasão: arquivo "brasao.png" ou "brasao.jpg" ao lado deste script, ou caminho em dados["brasao"].
BRASAO_PATH = None

# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
D = Decimal
def r2(x):
    return D(x).quantize(D("0.01"), rounding=ROUND_HALF_UP)

def brl(x, prefixo=True):
    v = r2(x)
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("R$ " + s) if prefixo else s

def _modulo(nome):
    """Importa um módulo irmão tanto no pacote (site) quanto com o script solto no kit da skill."""
    import importlib
    try:
        return importlib.import_module(f".{nome}", __package__) if __package__ else importlib.import_module(nome)
    except ImportError:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        return importlib.import_module(nome)


CASAS_PCT = 6          # Calculadora do Cidadão: 6 casas; FGV (INCC): 2 casas, como na tabela da FGV

def pct(p):
    return f"{D(str(p)):.{CASAS_PCT}f}".replace(".", ",") + "%"

UN = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
      "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
DZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
CT = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos",
      "setecentos", "oitocentos", "novecentos"]

def _ate999(n):
    if n == 0: return ""
    if n == 100: return "cem"
    c, r = divmod(n, 100); partes = []
    if c: partes.append(CT[c])
    if r:
        if r < 20: partes.append(UN[r])
        else:
            d, u = divmod(r, 10)
            partes.append(DZ[d] + (" e " + UN[u] if u else ""))
    return " e ".join(partes)

def _inteiro(n):
    if n == 0: return "zero"
    grupos = []
    while n: n, g = divmod(n, 1000); grupos.append(g)
    nomes = [("", ""), ("mil", "mil"), ("milhão", "milhões"), ("bilhão", "bilhões")]
    partes = []
    for i in range(len(grupos) - 1, -1, -1):
        g = grupos[i]
        if not g: continue
        if i == 1 and g == 1: txt = "mil"
        elif i == 0: txt = _ate999(g)
        else: txt = _ate999(g) + " " + (nomes[i][0] if g == 1 else nomes[i][1])
        partes.append((txt, g, i))
    out = ""
    for k, (txt, g, i) in enumerate(partes):
        if k == 0: out = txt
        else:
            # "e" antes do último grupo quando < 100 ou centena redonda
            out += (" e " if (g < 100 or g % 100 == 0) else ", ") + txt
    return out

def extenso_reais(valor):
    v = r2(valor); inteiro = int(v); cent = int((v - inteiro) * 100)
    partes = []
    if inteiro:
        s = _inteiro(inteiro)
        sufixo = "real" if inteiro == 1 else "reais"
        if inteiro % 1000000 == 0: sufixo = "de reais"
        partes.append(f"{s} {sufixo}")
    if cent:
        partes.append(f"{_inteiro(cent)} {'centavo' if cent == 1 else 'centavos'}")
    return " e ".join(partes) if partes else "zero reais"

ORD_M = ["", "PRIMEIRO", "SEGUNDO", "TERCEIRO", "QUARTO", "QUINTO", "SEXTO", "SÉTIMO", "OITAVO",
         "NONO", "DÉCIMO", "DÉCIMO PRIMEIRO", "DÉCIMO SEGUNDO", "DÉCIMO TERCEIRO", "DÉCIMO QUARTO",
         "DÉCIMO QUINTO"]
MESES = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
         "setembro", "outubro", "novembro", "dezembro"]
NUM_EXT = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez"]

def mm_aaaa(s):
    m, a = s.split("/"); return int(m), int(a)

def add_meses(m, a, k):
    t = a * 12 + (m - 1) + k
    return t % 12 + 1, t // 12

def fmt_ma(m, a): return f"{m:02d}/{a}"

def fmt_qtd(q):
    """Quantidade com separador de milhar brasileiro (734856 -> 734.856; 180.986 -> 180,986)."""
    d = D(str(q))
    if d == d.to_integral():
        return f"{int(d):,}".replace(",", ".")
    return f"{d:,}".replace(",", "X").replace(".", ",").replace("X", ".")

def lista_pt(itens):
    itens = list(itens)
    if len(itens) <= 1: return "".join(itens)
    return ", ".join(itens[:-1]) + " e " + itens[-1]

# ---------------------------------------------------------------------------
# Cálculo
# ---------------------------------------------------------------------------
def calcular(dados):
    db_m, db_a = mm_aaaa(dados["data_base"])
    reaj = sorted(dados["reajustes"], key=lambda r: r["n"])
    for r in reaj:
        n = r["n"]
        ini = add_meses(db_m, db_a, 12 * (n - 1))
        aniv = add_meses(db_m, db_a, 12 * n)
        fim = aniv if REGRA_PERIODO == "MESMO_MES" else add_meses(*aniv, -1)
        r.setdefault("inicio", fmt_ma(*ini))
        r.setdefault("fim", fmt_ma(*fim))
        r["aniversario"] = fmt_ma(*aniv)
        r["efeitos"] = f"01/{aniv[0]:02d}/{aniv[1]}"
        r["fator"] = D(1) + D(str(r["indice_pct"])) / D(100)
    novos = [r for r in reaj if r.get("novo", True)]
    antigos = [r for r in reaj if not r.get("novo", True)]
    if not novos:
        raise SystemExit("Nenhum reajuste marcado como novo.")
    if antigos and max(r["n"] for r in antigos) > min(r["n"] for r in novos):
        raise SystemExit("Reajustes já aplicados devem vir antes dos novos.")

    itens = dados["itens"]
    # Séries com 2 casas decimais a cada reajuste (como a Calculadora do Cidadão, que encadeia o valor exibido).
    for it in itens:
        vb = r2(D(str(it["valor_base"]))); vu = r2(D(str(it.get("valor_unit", it["valor_base"]))))
        it["serie_base"] = [vb]; it["serie_unit"] = [vu]; it["ajustes"] = {}
    totais = [sum(it["serie_base"][0] for it in itens)]
    ajustes = []
    for k, r in enumerate(reaj, start=1):
        for it in itens:
            it["serie_base"].append(r2(it["serie_base"][-1] * r["fator"]))
            it["serie_unit"].append(r2(it["serie_unit"][-1] * r["fator"]))
        soma = sum(it["serie_base"][k] for it in itens)
        if r.get("novo", True):
            alvo = r2(totais[k - 1] * r["fator"])      # valor que a Calculadora mostra
            r["valor_calculadora"] = alvo
            dif = alvo - soma
            if dif != 0:
                # diferença de arredondamento lançada no item de maior valor, para o total bater com a Calculadora
                it_aj = max(itens, key=lambda x: x["serie_base"][k])
                it_aj["serie_base"][k] += dif
                it_aj["ajustes"][k] = dif
                ajustes.append({"reajuste": r["n"], "item": it_aj["item"], "valor": dif})
            totais.append(alvo)
        else:
            totais.append(soma)
    idx_atual = len(antigos)
    for it in itens:
        it["atual"] = it["serie_base"][idx_atual]
        it["novo_valor"] = it["serie_base"][-1]
    total_atual = totais[idx_atual]
    total_novo = totais[-1]
    calc = {
        "reajustes": reaj, "novos": novos, "antigos": antigos, "totais": totais,
        "total_atual": total_atual, "total_novo": total_novo,
        "valor_termo": total_novo - total_atual,
        "efeitos": novos[0]["efeitos"], "ajustes_arredondamento": ajustes,
    }
    # Conferências
    avisos = []
    tot_calc = D(str(dados["itens_total_inicial"])) if dados.get("itens_total_inicial") else None
    if tot_calc is not None and r2(tot_calc) != totais[0]:
        avisos.append(f"Soma dos itens iniciais ({brl(totais[0])}) difere do valor informado ({brl(tot_calc)}).")
    for a in ajustes:
        avisos.append(f"INFO: {a['reajuste']}º reajuste – ajuste de arredondamento de {brl(a['valor'])} no item "
                      f"{a['item']} para o total coincidir com a Calculadora do Cidadão.")
    calc["difs_calculadora"] = []
    for it in itens:
        if it.get("valor_atual_documentado") is not None:
            doc = r2(D(str(it["valor_atual_documentado"])))
            if doc != it["atual"]:
                avisos.append(f"Item {it['item']}: valor atual calculado {brl(it['atual'])} ≠ documentado {brl(doc)}.")
    calc["avisos"] = avisos
    calc["valor_dif_anual"] = calc["valor_termo"]
    calc["complemento"] = None
    alts = dados.get("alteracoes_quantitativas", [])
    if dados.get("complemento_supressao", True) and alts:   # regra SCON: sempre incluir
        comp = calcular_complemento(dados, calc, alts[-1])
        if comp["linhas"] and comp["total"] > 0:
            calc["complemento"] = comp
            calc["valor_termo"] = calc["valor_dif_anual"] + comp["total"]
    return calc

def calcular_complemento(dados, calc, alt):
    """Reajuste devido sobre as unidades suprimidas entre o início dos efeitos financeiros e a assinatura do TA."""
    import calendar
    from datetime import timedelta
    if not re.fullmatch(r"\d{2}/\d{2}/\d{4}", str(alt.get("data_assinatura") or "")):
        return {"linhas": [], "total": D(0), "doc": alt.get("documento", ""), "periodo": "", "meses_total": D(0)}
    d, m, a = map(int, alt["data_assinatura"].split("/"))
    fim_excl = date(a, m, d)                         # TA produz efeitos na assinatura
    reaj = calc["reajustes"]; novos = calc["novos"]; k_atual = len(calc["antigos"])
    def dt(s): dd, mm, aa = map(int, s.split("/")); return date(aa, mm, dd)
    def meses(ini, fim):                            # [ini, fim) em meses fracionários por mês civil
        tot = D(0); cur = ini
        while cur < fim:
            dim = calendar.monthrange(cur.year, cur.month)[1]
            prox = date(cur.year + (cur.month == 12), cur.month % 12 + 1, 1)
            ate = min(prox, fim)
            tot += D((ate - cur).days) / D(dim); cur = ate
        return tot
    linhas = []; total = D(0); faixas = []
    for i, r in enumerate(novos):
        ini = dt(r["efeitos"])
        prox = dt(novos[i + 1]["efeitos"]) if i + 1 < len(novos) else date(9999, 1, 1)
        a_ini, a_fim = ini, min(prox, fim_excl)
        if a_ini >= a_fim: continue
        mf = meses(a_ini, a_fim)
        k = reaj.index(r) + 1
        faixas.append((r, a_ini, a_fim - timedelta(days=1), mf))
        for it in dados["itens"]:
            qi = it.get("qtd_inicial"); q = it.get("qtd")
            if qi is None or q is None or qi <= q: continue
            delta = qi - q
            u_atual = r2(it["serie_unit"][k_atual]); u_novo = r2(it["serie_unit"][k])
            dif = u_novo - u_atual
            val = r2(D(delta) * dif * mf)
            linhas.append({"item": it["item"], "descricao": it["descricao"], "delta": delta, "u_atual": u_atual,
                           "u_novo": u_novo, "dif": dif, "meses": mf, "valor": val, "reajuste": r["n"],
                           "ini": a_ini, "fim": a_fim - timedelta(days=1)})
            total += val
    f0 = faixas[0][1] if faixas else None; f1 = faixas[-1][2] if faixas else None
    return {"linhas": linhas, "total": total, "doc": alt["documento"],
            "periodo": f"{f0:%d/%m/%Y} a {f1:%d/%m/%Y}" if faixas else "",
            "meses_total": sum(f[3] for f in faixas) if faixas else D(0)}

# ---------------------------------------------------------------------------
# Textos comuns
# ---------------------------------------------------------------------------
def textos(dados, calc):
    n_inst = dados["numero_instrumento"]
    inst = dados.get("instrumento", "Termo de Apostilamento")
    novos = calc["novos"]
    base = dados.get("base", "ANUAL").lower()
    t = {}
    t["inst_curto"] = f"{n_inst}° {inst}"
    t["reaj_ord"] = lista_pt([f"{r['n']}°" for r in novos])
    t["reaj_label"] = (f"{t['reaj_ord']} Reajuste" + ("s" if len(novos) > 1 else ""))
    per = []
    for i, r in enumerate(novos):
        ini = r["inicio"] + (" (data do orçamento)" if r["n"] == 1 else "")
        per.append(f"{ini} a {r['fim']}")
    t["periodos"] = lista_pt(per)
    t["base_txt"] = base  # anual / mensal / total
    return t

# ---------------------------------------------------------------------------
# DOCX helpers
# ---------------------------------------------------------------------------
from docx import Document
from docx.shared import Pt, Cm, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_TAB_ALIGNMENT
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

def novo_doc(fonte, tam, margens):
    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = fonte; st.font.size = Pt(tam)
    rpr = st.element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None: rf = OxmlElement("w:rFonts"); rpr.append(rf)
    for k in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"): rf.set(qn(k), fonte)
    st.paragraph_format.space_before = Pt(0); st.paragraph_format.space_after = Pt(0)
    s = doc.sections[0]
    s.page_width = Emu(7560310); s.page_height = Emu(10692130)
    s.left_margin, s.right_margin, s.top_margin, s.bottom_margin = [Cm(x) for x in margens]
    return doc

def par(doc_or_cell, texto="", bold=False, italic=False, align=None, size=None, after=0,
        before=0, indent_first=None, underline=False, line=None, keep=False):
    p = doc_or_cell.add_paragraph()
    if texto: run(p, texto, bold, italic, size, underline)
    if align: p.alignment = align
    pf = p.paragraph_format
    pf.space_after = Pt(after); pf.space_before = Pt(before)
    if indent_first is not None: pf.first_line_indent = Cm(indent_first)
    if line: pf.line_spacing = line
    if keep: pf.keep_with_next = True
    return p

def run(p, texto, bold=False, italic=False, size=None, underline=False):
    r = p.add_run(texto); r.bold = bold; r.italic = italic; r.underline = underline
    if size: r.font.size = Pt(size)
    return r

def achar_brasao(dados):
    cands = [dados.get("brasao")] + [os.path.join(os.path.dirname(os.path.abspath(__file__)), n)
                                     for n in ("brasao.png", "brasao.jpg")]
    for c in cands:
        if c and os.path.exists(c): return c
    return None

def run_md(p, texto):
    """Escreve texto com trechos **em negrito**."""
    partes = texto.split("**")
    for i, t_ in enumerate(partes):
        if t_: run(p, t_, bold=(i % 2 == 1))

def brasao(doc, largura_cm=1.9):
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if BRASAO_PATH: p.add_run().add_picture(BRASAO_PATH, width=Cm(largura_cm))
    else: run(p, "[BRASÃO]", bold=True)
    return p

def borda_inferior(p):
    pPr = p._p.get_or_add_pPr(); b = OxmlElement("w:pBdr"); bt = OxmlElement("w:bottom")
    for k, v in (("w:val", "single"), ("w:sz", "6"), ("w:space", "1"), ("w:color", "000000")):
        bt.set(qn(k), v)
    b.append(bt); pPr.append(b)

def campo(p, instr, size=None, italic=False):
    for tipo, txt in (("begin", None), (None, instr), ("separate", None), (None, "1"), ("end", None)):
        r = p.add_run(); r.italic = italic
        if size: r.font.size = Pt(size)
        if tipo:
            fc = OxmlElement("w:fldChar"); fc.set(qn("w:fldCharType"), tipo); r._r.append(fc)
        elif txt == instr:
            it = OxmlElement("w:instrText"); it.set(qn("xml:space"), "preserve"); it.text = f" {instr} "
            r._r.append(it)
        else:
            r.text = txt

def tabela_bordas(t):
    tbl = t._tbl; tblPr = tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for lado in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{lado}")
        for k, v in (("w:val", "single"), ("w:sz", "4"), ("w:space", "0"), ("w:color", "000000")):
            e.set(qn(k), v)
        b.append(e)
    tblPr.append(b)

def sem_bordas(t):
    tblPr = t._tbl.tblPr; b = OxmlElement("w:tblBorders")
    for lado in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{lado}"); e.set(qn("w:val"), "nil"); b.append(e)
    tblPr.append(b)

def cel(c, texto, bold=False, align=WD_ALIGN_PARAGRAPH.CENTER, size=None):
    c.text = ""; p = c.paragraphs[0]; p.alignment = align
    run(p, texto, bold, size=size); c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

def larguras(t, cms):
    t.autofit = False
    grid = t._tbl.tblGrid
    for i, gc in enumerate(grid.findall(qn("w:gridCol"))):
        if i < len(cms): gc.set(qn("w:w"), str(int(cms[i] * 567)))
    for row in t.rows:
        trPr = row._tr.get_or_add_trPr(); cs = OxmlElement("w:cantSplit"); trPr.append(cs)
        for i, w in enumerate(cms): row.cells[i].width = Cm(w)

def cabecalho_om(doc, om_nome, estilo_om="italico_sublinhado", tam=None, bold_md=True):
    brasao(doc)
    par(doc, "MINISTÉRIO DA DEFESA", bold=bold_md, align=WD_ALIGN_PARAGRAPH.CENTER, size=tam)
    par(doc, "COMANDO DA AERONÁUTICA", bold=(estilo_om == "negrito"), align=WD_ALIGN_PARAGRAPH.CENTER, size=tam)
    if estilo_om == "negrito":
        p = par(doc, om_nome, bold=True, italic=True, align=WD_ALIGN_PARAGRAPH.CENTER, size=tam)
        borda_inferior(p)
    else:
        par(doc, om_nome, italic=True, underline=True, align=WD_ALIGN_PARAGRAPH.CENTER, size=tam)

def assinatura(doc, funcao, before=36):
    """Padrão do termo: só linha e cargo, sem nome de pessoa (evita erro quando o titular muda)."""
    par(doc, "_______________________________________", align=WD_ALIGN_PARAGRAPH.CENTER, before=before, keep=True)
    par(doc, funcao, align=WD_ALIGN_PARAGRAPH.CENTER)

def quadro_complemento(ws, comp, calc, r0, ultima, borda, F, cen, MOEDA, Font, Alignment, L):
    """Quadro curto: reajuste sobre as unidades suprimidas no período anterior ao TA. Retorna a última linha usada."""
    LAR = "FCE4D6"
    ws.merge_cells(start_row=r0, start_column=1, end_row=r0, end_column=ultima)
    c = ws.cell(r0, 1, f"COMPLEMENTO – REAJUSTE SOBRE AS UNIDADES SUPRIMIDAS PELO {comp['doc'].upper()} "
                       f"NO PERÍODO DE {comp['periodo']} (ANTES DA SUPRESSÃO)")
    c.font = Font(name="Arial", size=12, bold=True); c.fill = F(LAR); c.alignment = cen
    for cc in range(1, ultima + 1): ws.cell(r0, cc).border = borda
    ws.row_dimensions[r0].height = 30
    hdr = ["ITEM", "DESCRIÇÃO/ ESPECIFICAÇÃO", "QTD SUPRIMIDA", "REAJUSTE", "VALOR UNIT MENSAL ANTES DO REAJUSTE",
           "VALOR UNIT MENSAL REAJUSTADO", "DIFERENÇA UNIT MENSAL", "MESES NO PERÍODO", "VALOR DEVIDO"]
    rh = r0 + 1
    for i, h in enumerate(hdr):
        c = ws.cell(rh, i + 1, h); c.font = Font(name="Arial", size=10, bold=True); c.fill = F("D9D9D9")
        c.alignment = cen; c.border = borda
    ws.row_dimensions[rh].height = 45
    r = rh
    for ln in comp["linhas"]:
        r += 1
        vals = [ln["item"], ln["descricao"], ln["delta"], f"{ln['reajuste']}° ({ln['ini']:%d/%m/%Y} a {ln['fim']:%d/%m/%Y})",
                float(ln["u_atual"]), float(ln["u_novo"]), f"=F{r}-E{r}", float(round(ln["meses"], 4)),
                f"=ROUND(C{r}*G{r}*H{r},2)"]
        for i, v in enumerate(vals):
            c = ws.cell(r, i + 1, v); c.font = Font(name="Arial", size=10); c.alignment = cen; c.border = borda
            if i in (4, 5, 6, 8): c.number_format = MOEDA
            if i == 7: c.number_format = "0.0000"
        ws.row_dimensions[r].height = 52
    r += 1
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
    c = ws.cell(r, 1, "TOTAL DO COMPLEMENTO"); c.font = Font(name="Arial", size=11, bold=True); c.alignment = cen
    c = ws.cell(r, 9, f"=SUM(I{rh+1}:I{r-1})"); c.number_format = MOEDA; c.font = Font(name="Arial", size=11, bold=True)
    c.alignment = cen
    for cc in range(1, 10): ws.cell(r, cc).border = borda; ws.cell(r, cc).fill = F(LAR)
    r += 1
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
    c = ws.cell(r, 1, f"VALOR DO TERMO = DIFERENÇA DO VALOR ANUAL ({brl(calc['valor_dif_anual'])}) + COMPLEMENTO "
                      f"({brl(comp['total'])})")
    c.font = Font(name="Arial", size=11, bold=True); c.alignment = cen
    c = ws.cell(r, 9, float(calc["valor_termo"])); c.number_format = MOEDA
    c.font = Font(name="Arial", size=11, bold=True); c.alignment = cen
    for cc in range(1, 10): ws.cell(r, cc).border = borda; ws.cell(r, cc).fill = F("D9EAD3")
    ws.row_dimensions[r].height = 28
    return r

# ---------------------------------------------------------------------------
# 1) MEMÓRIA DE CÁLCULO (xlsx)
# ---------------------------------------------------------------------------
def gerar_memoria(dados, calc, t, caminho):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter as L
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "MEMÓRIA DE CÁLCULO"
    reaj = calc["reajustes"]; itens = dados["itens"]
    base = dados.get("base", "ANUAL").upper()
    mostrar_unit = dados.get("mostrar_unitario", True)
    fin = Side(style="thin", color="000000"); borda = Border(left=fin, right=fin, top=fin, bottom=fin)
    F = lambda c: PatternFill("solid", fgColor=c)
    CINZA, AZUL, VERDE, AMAR, ROSA1, ROSA2 = "D9D9D9", "9FC5E8", "D9EAD3", "FFF2CC", "E6B8AF", "F4CCCC"
    cen = Alignment(horizontal="center", vertical="center", wrap_text=True)
    MOEDA = '[$R$-416] #,##0.00'

    def rot(r, prefixo=""):
        a = r["inicio"][:3] + r["inicio"][-2:]; b = r["fim"][:3] + r["fim"][-2:]
        doc = f" - {r['documento']}" if (not r.get("novo", True) and r.get("documento")) else ""
        return f"{prefixo}{r['n']}° REAJUSTE\n(DATA-BASE - {a} a {b}{doc})\níndice abaixo:"

    alts = dados.get("alteracoes_quantitativas", [])
    tem_qi = bool(alts) and any(it.get("qtd_inicial") is not None for it in itens)
    fixos = [("item", 9), ("desc", 30), ("cat", 13)] + ([("qi", 15)] if tem_qi else []) + [("qtd", 16)]
    col = 1; cols = {}
    for k, w in fixos:
        cols[k] = col; ws.column_dimensions[L(col)].width = w; col += 1
    if mostrar_unit:
        cols["u0"] = col; ws.column_dimensions[L(col)].width = 16; col += 1
        for i, r in enumerate(reaj):
            cols[f"u{i+1}"] = col; ws.column_dimensions[L(col)].width = 17; col += 1
    cols["b0"] = col; ws.column_dimensions[L(col)].width = 17; col += 1
    for i, r in enumerate(reaj):
        cols[f"b{i+1}"] = col; ws.column_dimensions[L(col)].width = 19; col += 1
    ultima = col - 1
    col_db = ultima + 1; ws.column_dimensions[L(col_db)].width = 14

    # Título
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ultima)
    c = ws.cell(1, 1, f"MEMÓRIA DE CÁLCULO PARA REAJUSTE DO CONTRATO {dados['contrato']}")
    c.font = Font(name="Arial", size=15); c.fill = F(AZUL); c.alignment = cen
    ws.row_dimensions[1].height = 27
    c = ws.cell(1, col_db, "DATA BASE\nDO REAJUSTE"); c.font = Font(name="Arial", size=10)
    c.fill = F(ROSA1); c.alignment = cen; c.border = borda
    m, a = mm_aaaa(dados["data_base"])
    c = ws.cell(2, col_db, date(a, m, 1)); c.number_format = "mm/yyyy"; c.fill = F(ROSA2)
    c.alignment = cen; c.font = Font(name="Arial", size=11); c.border = borda

    # Cabeçalhos (linhas 2 e 3)
    for k, _ in fixos:
        ws.merge_cells(start_row=2, start_column=cols[k], end_row=3, end_column=cols[k])
    nomes_fixos = {"item": "ITEM", "desc": "DESCRIÇÃO/ ESPECIFICAÇÃO", "cat": "CATSER OU CATMAT",
                   "qtd": "QUANTIDADE"}
    if tem_qi:
        ult = alts[-1]
        nomes_fixos["qi"] = "QUANTIDADE INICIAL"
        nomes_fixos["qtd"] = f"QUANTIDADE ATUAL\n(após {ult['documento']} – {ult['data_assinatura']})"
    for k, v in nomes_fixos.items():
        ws.cell(2, cols[k], v)
    blocos = []
    if mostrar_unit: blocos.append(("u", "VALOR UNIT INICIAL", ""))
    blocos.append(("b", f"VALOR {base} {'ATUAL (QTD ATUAL)' if alts else 'INICIAL'}", f"VALOR {base}\n"))
    for pref, nome0, prefr in blocos:
        ws.merge_cells(start_row=2, start_column=cols[f"{pref}0"], end_row=3, end_column=cols[f"{pref}0"])
        ws.cell(2, cols[f"{pref}0"], nome0)
        for i, r in enumerate(reaj):
            cc = cols[f"{pref}{i+1}"]
            ws.cell(2, cc, rot(r, prefr))
            ci = ws.cell(3, cc, float(r["indice_pct"])); ci.number_format = "0.000000"
    for rr in (2, 3):
        for cc in range(1, ultima + 1):
            c = ws.cell(rr, cc); c.border = borda; c.alignment = cen
            is_reaj = any(cc == cols.get(f"{p}{i+1}") for p in ("u", "b") for i in range(len(reaj)))
            if is_reaj:
                i = next(i for i in range(len(reaj)) for p in ("u", "b") if cols.get(f"{p}{i+1}") == cc)
                c.fill = F(VERDE if reaj[i].get("novo", True) else AMAR)
                c.font = Font(name="Arial", size=10 if rr == 2 else 11, bold=True)
            else:
                c.fill = F(CINZA); c.font = Font(name="Arial", size=11, bold=True)
    ws.row_dimensions[2].height = 70; ws.row_dimensions[3].height = 22

    # Itens
    lin0 = 4
    for j, it in enumerate(itens):
        rr = lin0 + j
        ws.cell(rr, cols["item"], it["item"]); ws.cell(rr, cols["desc"], it["descricao"])
        ws.cell(rr, cols["cat"], it.get("catser", "")); ws.cell(rr, cols["qtd"], it.get("qtd", 1)).number_format = '#,##0.###' 
        if tem_qi: ws.cell(rr, cols["qi"], it.get("qtd_inicial", it.get("qtd", 1))).number_format = '#,##0.###' 
        pares = []
        if mostrar_unit: pares.append(("u", float(D(str(it.get("valor_unit", it["valor_base"]))))))
        pares.append(("b", float(D(str(it["valor_base"])))))
        for p, v0 in pares:
            ws.cell(rr, cols[f"{p}0"], v0).number_format = MOEDA
            for i in range(len(reaj)):
                ant = L(cols[f"{p}{i}"]); idx = L(cols[f"{p}{i+1}"])
                aj = it["ajustes"].get(i + 1) if p == "b" else None
                extra = (f"{'+' if aj > 0 else '-'}{abs(float(aj)):.2f}") if aj else ""
                c = ws.cell(rr, cols[f"{p}{i+1}"], f"=ROUND({ant}{rr}*(1+{idx}$3/100),2){extra}")
                c.number_format = MOEDA
        for cc in range(1, ultima + 1):
            c = ws.cell(rr, cc); c.border = borda; c.alignment = cen
            c.font = Font(name="Arial", size=10 if cc == cols["desc"] else 11)
        ws.row_dimensions[rr].height = max(45, 15 * (len(it["descricao"]) // 28 + 1))
    lin_tot = lin0 + len(itens)

    # Total (soma dos valores arredondados, conforme orientação da planilha-modelo)
    ws.merge_cells(start_row=lin_tot, start_column=1, end_row=lin_tot, end_column=cols["b0"] - 1)
    c = ws.cell(lin_tot, 1, f"VALOR {base} DO CONTRATO"); c.font = Font(name="Arial", size=14, bold=True)
    c.fill = F(VERDE); c.alignment = cen
    for i in range(len(reaj) + 1):
        cc = cols[f"b{i}"]; colL = L(cc)
        formula = f"=SUM({colL}{lin0}:{colL}{lin0+len(itens)-1})"
        c = ws.cell(lin_tot, cc, formula); c.number_format = MOEDA
        c.font = Font(name="Arial", size=11, bold=True); c.alignment = cen
        if i == len(reaj): c.fill = F(VERDE)
    for cc in range(1, ultima + 1): ws.cell(lin_tot, cc).border = borda
    ws.row_dimensions[lin_tot].height = 40

    # Observações
    novos, antigos = calc["novos"], calc["antigos"]
    n = len(novos)
    obs = []
    if n > 1:
        partes = [f"o {r['n']}° Reajuste referente ao período de {r['inicio']}"
                  f"{' (data do orçamento)' if r['n']==1 else ''} a {r['fim']}" for r in novos]
        obs.append(f"O presente {t['inst_curto'].split(' ',1)[1].lower()} contém {n} ({NUM_EXT[n]}) reajustes: "
                   + lista_pt(partes) + ".")
    else:
        r = novos[0]
        obs.append(f"O presente {t['inst_curto'].split(' ',1)[1].lower()} refere-se ao {r['n']}° Reajuste, "
                   f"período de {r['inicio']}{' (data do orçamento)' if r['n']==1 else ''} a {r['fim']}.")
    if antigos:
        obs.append("As colunas em amarelo indicam reajustes já aplicados (" +
                   lista_pt([f"{r['n']}° Reajuste – {r.get('documento','documento anterior')}" for r in antigos])
                   + "); as colunas em verde indicam o(s) reajuste(s) objeto do presente instrumento.")
    for a in alts:
        obs.append(f"O {a['documento']}, assinado em {a['data_assinatura']}, promoveu {a['descricao']}. "
                   f"Os valores { {'anual':'anuais','mensal':'mensais','total':'totais'}.get(base.lower(), base.lower())} atual e reajustado foram calculados sobre a quantidade vigente após "
                   f"essa alteração (coluna QUANTIDADE ATUAL); os valores unitários seguem reajustados desde a "
                   f"data-base, pois a supressão/acréscimo altera quantidades e não preços.")
    comp = calc.get("complemento")
    if alts and comp:
        obs.append(f"Entre o início dos efeitos financeiros e a assinatura do {comp['doc']} ({comp['periodo']}), "
                   "o contrato ainda tinha as quantidades iniciais. O reajuste devido sobre as unidades depois "
                   f"suprimidas nesse período foi calculado no quadro COMPLEMENTO ({brl(comp['total'])}) e somado "
                   "ao valor do termo.")
    elif alts:
        aniv = calc["novos"][0]["efeitos"]
        obs.append(f"Para os meses entre o início dos efeitos financeiros ({aniv}) e a data de assinatura do "
                   f"{alts[-1]['documento']} ({alts[-1]['data_assinatura']}), o reajuste incide sobre as quantidades "
                   "então vigentes (QUANTIDADE INICIAL), cabendo à fiscalização apurar a diferença nas faturas "
                   "desse período com os valores unitários reajustados acima.")
    if comp:
        obs.append(f"O valor utilizado para o cálculo foi o valor {base.lower()} do contrato. Dessa forma, o valor do "
                   f"{t['inst_curto']} é de {brl(calc['valor_termo'])}, composto pela diferença entre o valor "
                   f"{base.lower()} reajustado ({brl(calc['total_novo'])}) e o valor {base.lower()} atual "
                   f"({brl(calc['total_atual'])}), de {brl(calc['valor_dif_anual'])}, acrescida do complemento de "
                   f"{brl(comp['total'])}.")
    else:
        obs.append(f"O valor utilizado para o cálculo foi o valor {base.lower()} do contrato. Dessa forma, o valor do "
               f"{t['inst_curto']} é de {brl(calc['valor_termo'])}, resultado da diferença entre o valor "
               f"{base.lower()} reajustado ({brl(calc['total_novo'])}) e o valor {base.lower()} "
               f"{'atual' if (antigos or alts) else 'inicial'} ({brl(calc['total_atual'])}).")
    if calc["ajustes_arredondamento"]:
        det = lista_pt([f"{brl(a['valor'])} no item {a['item']}, no {a['reajuste']}° reajuste"
                        for a in calc["ajustes_arredondamento"]])
        obs.append("Os valores foram arredondados em 2 (duas) casas decimais a cada reajuste. Para que os totais "
                   f"coincidam exatamente com a Calculadora do Cidadão, foi lançado o ajuste de arredondamento de "
                   f"{det} (item de maior valor), conforme fórmula da respectiva célula.")
    else:
        obs.append("Os valores foram arredondados em 2 (duas) casas decimais a cada reajuste e os totais coincidem "
                   "com a Calculadora do Cidadão.")
    for o in dados.get("observacoes_extras", []): obs.append(o)
    texto = "Obs: " + "\n\n".join(f"{i+1} - {o}" for i, o in enumerate(obs))
    lo = lin_tot + 1
    if comp:
        lo = quadro_complemento(ws, comp, calc, lin_tot + 2, ultima, borda, F, cen, MOEDA, Font, Alignment, L) + 1
    ws.merge_cells(start_row=lo, start_column=1, end_row=lo, end_column=ultima)
    c = ws.cell(lo, 1, texto); c.font = Font(name="Arial", size=11)
    c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
    ws.row_dimensions[lo].height = 30 + 30 * len(obs)
    for cc in range(1, ultima + 1): ws.cell(lo, cc).border = borda

    ws.page_setup.orientation = "landscape"; ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1; ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_area = f"A1:{L(col_db)}{lo}"
    ws.page_margins.left = ws.page_margins.right = 0.4
    wb.save(caminho)

# ---------------------------------------------------------------------------
# 2) DECLARAÇÃO DE DISPONIBILIDADE ORÇAMENTÁRIA
# ---------------------------------------------------------------------------
def gerar_declaracao(dados, calc, t, caminho):
    o = dados["orcamento"]; ordn = {**DEFAULTS["ordenador"], **dados.get("ordenador", {})}
    doc = novo_doc("Arial", 11, (2.5, 1.8, 1.87, 1.4))
    brasao(doc)
    par(doc, "MINISTÉRIO DA DEFESA", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    par(doc, "COMANDO DA AERONÁUTICA", align=WD_ALIGN_PARAGRAPH.CENTER)
    par(doc, dados["om_contratante_nome"], align=WD_ALIGN_PARAGRAPH.CENTER)
    par(doc); par(doc)
    par(doc, "DECLARAÇÃO DE DISPONIBILIDADE ORÇAMENTÁRIA", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    par(doc, f"PROCESSO: {dados['nup']}", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    par(doc); par(doc)
    p = par(doc, align=WD_ALIGN_PARAGRAPH.JUSTIFY, indent_first=1.5, line=1.5, after=6)
    run(p, "Declaro, para fins de comprovação, que existe previsão de dotação orçamentária visando atender "
           "às necessidades refletidas no objeto do Processo Administrativo sob o NUP/PAG ")
    run(p, dados["nup"], bold=True)
    run(p, f", suficiente para assegurar o cumprimento das obrigações advindas do {t['inst_curto']}, em "
           "conformidade com o art. 167, inciso II, da Constituição Federal e o art. 18 da Lei 14.133/21, e que "
           "as despesas decorrentes da contratação ocorrerão à conta dos recursos descentralizados pela Diretoria "
           f"de Economia e Finanças da Aeronáutica, para o exercício de {o['exercicio']}, a cargo do "
           f"{o.get('ug_texto') or ordn['om_sigla']}, conforme listado abaixo:")
    linhas = [("Gestão/Unidade", o.get("gestao_unidade")), ("Fonte de Recursos", o.get("fonte")),
              ("Programa de Trabalho", o.get("programa_trabalho")), ("Ação", o.get("acao")),
              ("Plano Interno", o.get("plano_interno")), ("Natureza de Despesa", o.get("natureza_despesa"))]
    linhas = [l for l in linhas if l[1]]
    for i, (k, v) in enumerate(linhas):
        par(doc, f"{k}: {v}{'.' if i == len(linhas)-1 else ';'}", align=WD_ALIGN_PARAGRAPH.JUSTIFY, line=1.5)
    par(doc)
    dt = dados.get("data_declaracao")
    if dt:
        a, m, d = map(int, dt.split("-"))
        dtxt = f"{dados.get('cidade', DEFAULTS['cidade'])}, {d} de {MESES[m]} de {a}."
    else:
        dtxt = f"{dados.get('cidade', DEFAULTS['cidade'])}, data conforme assinatura eletrônica."
    par(doc, dtxt, align=WD_ALIGN_PARAGRAPH.RIGHT, before=12)
    funcao = ordn.get("funcao_assinatura") or (("Ordenadora" if ordn["feminino"] else "Ordenador") + " de Despesas do " + ordn.get("om_sigla", DEFAULTS["ug_apoio"]["sigla"]))
    assinatura(doc, funcao, before=60)
    doc.save(caminho)

# ---------------------------------------------------------------------------
# 3) PARECER TÉCNICO DE REAJUSTAMENTO
# ---------------------------------------------------------------------------
def gerar_parecer(dados, calc, t, caminho):
    doc = novo_doc("Arial", 11, (2.0, 2.0, 2.05, 1.5))
    ordn = {**DEFAULTS["ordenador"], **dados.get("ordenador", {})}
    aci = {**DEFAULTS["aci"], **dados.get("aci", {})}
    fis = dados.get("fiscal", {}); idx = dados["indice"]; base = dados.get("base", "ANUAL").lower()
    novos = calc["novos"]
    cabecalho_om(doc, dados["om_contratante_nome"])
    par(doc); par(doc)
    p = par(doc); run(p, "Parecer n° ", bold=True); run(p, dados["parecer_numero"])
    p = par(doc); run(p, "Processo nº ", bold=True); run(p, dados["nup"])
    par(doc)
    par(doc, "Assunto: Parecer Técnico de Reajustamento de Contrato.", after=8)
    par(doc, f"Referência: Contrato nº {dados['contrato']}", after=8)
    par(doc, f"Anexos: CONSULTA {idx['nome']}", after=10)

    def item(n, texto=None, partes=None, after=8, just=False):
        p = doc.add_paragraph()
        pf = p.paragraph_format; pf.left_indent = Cm(0); pf.space_after = Pt(after)
        pf.tab_stops.add_tab_stop(Cm(1.25))
        if just: p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        run(p, f"{n}.\t")
        for txt, b in (partes or [(texto, False)]): run(p, txt, bold=b)
        return p

    item(1, f"CONTRATO Nº: {dados['contrato']}")
    item(2, f"OM CONTRATANTE: {dados['om_contratante_sigla']}")
    p = item(3, partes=[("EMPRESA CONTRATADA: ", False)]); run(p, dados["empresa"]["nome"], italic=True)
    p = item(4, partes=[("OBJETO RESUMIDO: ", False)]); run(p, dados["objeto_resumido"], italic=True)
    item(5, "VALORES TOTAIS DO CONTRATO:", after=4)
    for h in dados["historico_valores"]:
        v = h.get("valor")
        par(doc, f"{h['documento'].upper()}: {brl(v) if v not in (None, '') else 'R$ (VALOR A PREENCHER)'}", after=2)
    par(doc, after=6)
    vt = calc["valor_termo"]
    ref = (f"referente ao {t['reaj_ord']} reajuste{'s' if len(novos)>1 else ''} do valor {base} do contrato.")
    comp = calc.get("complemento")
    if comp:
        ref = (f"referente ao {t['reaj_ord']} reajuste{'s' if len(novos)>1 else ''} do valor {base} do contrato "
               f"({brl(calc['valor_dif_anual'])}) e ao reajuste incidente sobre as unidades suprimidas pelo "
               f"{comp['doc']} no período de {comp['periodo']} ({brl(comp['total'])}), conforme memória de cálculo.")
    item(6, partes=[(f"VALOR DO {t['inst_curto'].upper()} A SER FIRMADO: ", False),
                    (f"{brl(vt)} ({extenso_reais(vt)})", True), (", " + ref, False)], just=True)
    item(7, f"ENQUADRAMENTO LEGAL: {dados.get('enquadramento_legal', DEFAULTS['enquadramento_legal'])}")
    # Motivo
    per = lista_pt([f"ao {r['n']}º Reajuste, calculado através do período de {r['inicio']} a {r['fim']}"
                    for r in novos])
    pcts = lista_pt([f"{pct(r['indice_pct'])} no {r['n']}º reajuste" for r in novos])
    k0 = len(calc["antigos"])
    res = lista_pt([f"{brl(calc['totais'][k0 + i + 1])} no {r['n']}º reajuste" for i, r in enumerate(novos)])
    fonte = idx.get("fonte_curta", "pesquisa abaixo")
    item(8, partes=[("MOTIVO: Necessidade de reajuste pelo ", False), ("índice ", True),
                    (f"{idx['nome']}, conforme estabelece {idx['clausula']}, referente {per}. "
                     f"O reajuste corresponde ao percentual de {pcts} sobre o valor {base} do contrato de "
                     f"{brl(calc['total_atual'])}"
                     + (f", vigente após a alteração quantitativa promovida pelo "
                        f"{dados['alteracoes_quantitativas'][-1]['documento']}, assinado em "
                        f"{dados['alteracoes_quantitativas'][-1]['data_assinatura']}"
                        if dados.get('alteracoes_quantitativas') else "")
                     + f", resultando no valor corrigido {base} de {res}, conforme {fonte}:", False)], just=True)
    for img in dados.get("prints_indice", []):
        if os.path.exists(img):
            p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.add_run().add_picture(img, width=Cm(11)); p.paragraph_format.space_after = Pt(10)
        else:
            par(doc, f"[INSERIR PRINT DA CONSULTA: {img}]", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, after=10)
    item(9, "TABELA DE ITENS:")
    tb = doc.add_table(rows=1 + len(dados["itens"]), cols=5); tabela_bordas(tb)
    tb.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = ["Item", "Descrição / Especificação", "QTD", f"Valor {base} atual", f"Valor {base} após o Reajuste"]
    for i, h in enumerate(hdr): cel(tb.rows[0].cells[i], h, size=10)
    for j, it in enumerate(dados["itens"]):
        cs = tb.rows[j + 1].cells
        cel(cs[0], str(it["item"]), size=10); cel(cs[1], it["descricao"], align=WD_ALIGN_PARAGRAPH.LEFT, size=10)
        cel(cs[2], fmt_qtd(it.get("qtd", 1)), size=10); cel(cs[3], brl(it["atual"]), size=10)
        cel(cs[4], brl(it["novo_valor"]), bold=True, size=10)
    larguras(tb, [1.2, 6.5, 1.8, 3.3, 3.6])
    par(doc, after=10)
    dbm, dba = mm_aaaa(dados["data_base"])
    par(doc, f"Isto posto, em face da análise efetuada da data do orçamento ({MESES[dbm].capitalize()}/{dba}), "
             "constante do Processo Administrativo de Gestão supracitado e no índice de reajuste oficial previsto "
             f"para o presente contrato, o {idx['nome']}, observado o interregno legal de doze meses da data do "
             f"orçamento, esta Fiscalização solicita o reajustamento do valor {base} do contrato de "
             f"{brl(calc['total_atual'])} para {brl(calc['total_novo'])}, conforme memória de cálculo em anexo, "
             f"com efeitos financeiros a contar de {calc['efeitos']}, por meio do {t['inst_curto']}, "
             "submetendo-o à consideração do(a) senhor(a) para fins de deferimento e adoção das medidas "
             "posteriores pertinentes.", align=WD_ALIGN_PARAGRAPH.JUSTIFY, indent_first=0.75, line=1.15)
    par(doc, "Data conforme assinatura eletrônica.", align=WD_ALIGN_PARAGRAPH.RIGHT, before=18)
    assinatura(doc, fis.get("funcao", "Gestor do Contrato"), before=48)
    par(doc, "Conferido por:", before=30)
    assinatura(doc, aci["funcao"], before=36)
    par(doc, "Aprovado por:", before=30)
    funcao = ordn.get("funcao_assinatura") or (("Ordenadora" if ordn["feminino"] else "Ordenador") + " de Despesas do " + ordn.get("om_sigla", DEFAULTS["ug_apoio"]["sigla"]))
    assinatura(doc, funcao, before=36)
    doc.save(caminho)

# ---------------------------------------------------------------------------
# 4) TERMO DE APOSTILAMENTO
# ---------------------------------------------------------------------------
def gerar_termo(dados, calc, t, caminho):
    doc = novo_doc("Calibri", 11, (3.0, 2.0, 2.5, 2.0))
    ug = DEFAULTS["ug_apoio"]; ordn = {**DEFAULTS["ordenador"], **dados.get("ordenador", {})}
    emp = dados["empresa"]; base = dados.get("base", "ANUAL")
    n = dados["numero_instrumento"]; ct = dados["contrato"]
    J = WD_ALIGN_PARAGRAPH.JUSTIFY; C = WD_ALIGN_PARAGRAPH.CENTER
    # Cabeçalho de página
    sec = doc.sections[0]; hp = sec.header.paragraphs[0]
    hp.paragraph_format.tab_stops.add_tab_stop(Cm(16.0), WD_TAB_ALIGNMENT.RIGHT)
    campo(hp, "PAGE", 9, True); run(hp, "/", italic=True, size=9); campo(hp, "NUMPAGES", 9, True)
    run(hp, f"\t{n}° Termo de Apostilamento ao Contrato de Despesa nº {ct}", italic=True, size=9)

    brasao(doc, 1.7)
    par(doc, "MINISTÉRIO DA DEFESA", bold=True, align=C, size=12)
    par(doc, "COMANDO DA AERONÁUTICA", bold=True, align=C, size=12)
    p = par(doc, dados.get("termo_om_nome", ug["nome"]), bold=True, italic=True, align=C, size=12); borda_inferior(p)
    par(doc)
    par(doc, f"{ORD_M[n]} TERMO DE APOSTILAMENTO", bold=True, align=C, size=12)
    par(doc, f"CONTRATO DE DESPESA N° {ct}", bold=True, align=C, size=12)
    par(doc)
    par(doc, f"Espécie: {n}° Termo de Apostilamento", after=6)
    par(doc, f"NUP: {dados['nup']}", bold=True)
    par(doc)
    tit = "Ordenadora" if ordn["feminino"] else "Ordenador"
    p = par(doc, align=J, after=6)
    om_od = dados.get("om_ordenador", ordn.get("om_sigla", "GAP-MN"))
    if om_od in TEXTOS_FIXOS_OM:                       # texto fixo da OM tem prioridade
        run_md(p, TEXTOS_FIXOS_OM[om_od])
    elif dados.get("contratante_paragrafo"):           # OM sem texto fixo: texto do contrato inicial
        run_md(p, dados["contratante_paragrafo"])
    else:
        run(p, "I – CONTRATANTE: ", bold=True)
        run(p, "A União, Ministério da Defesa, por intermédio do Comando da Aeronáutica, representada pelo ")
        run(p, ug["nome"], bold=True)
        run(p, f", com sede na {ug['endereco']}, inscrito no CNPJ sob o n° {ug['cnpj']}, neste ato representada "
               f"pel{'a sua' if ordn['feminino'] else 'o seu'} {tit} de Despesas, ")
        run(p, f"{ordn['nome']} {ordn['posto']}", bold=True)
        run(p, f", nomead{'a' if ordn['feminino'] else 'o'} pela {ordn['portaria']}, publicada no {ordn['publicacao']}, "
               f"portador(a) da Matrícula Funcional n° {ordn['matricula']}.")
    p = par(doc, align=J, after=6)
    if dados.get("contratada_paragrafo"):
        run_md(p, dados["contratada_paragrafo"])
    else:
        run(p, f"II – CONTRATADA: {emp['nome']}", bold=True)
        run(p, f", inscrita no CNPJ/MF sob o n° {emp['cnpj']}, com sede {emp['endereco']}, doravante denominado ")
        run(p, "CONTRATADO", bold=True)
        reps = emp.get("representantes") or [{"nome": emp["representante"],
                                              "feminino": emp.get("representante_feminino", False)}]
        for k, r in enumerate(reps):
            run(p, (", neste ato representado " if k == 0 else " e ") +
                f"pel{'a Sra.' if r.get('feminino') else 'o Sr.'} ")
            run(p, r["nome"], bold=True)
        run(p, ".")

    par(doc).add_run().add_break(WD_BREAK.PAGE)

    clausulas = ["OBJETO", "FINALIDADE E FUNDAMENTO LEGAL", "JUSTIFICATIVA DO APOSTILAMENTO", "VIGÊNCIA",
                 "DISPOSIÇÕES FINAIS"]
    par(doc, "CONTEÚDO", bold=True, align=C, after=12)
    for i, c in enumerate(clausulas): par(doc, f"CLÁUSULA {i+1}ª – {c}", after=6)
    par(doc).add_run().add_break(WD_BREAK.PAGE)

    def tit_cl(i): par(doc, f"CLÁUSULA {i}ª – {clausulas[i-1]}", bold=True, after=6, before=6, keep=True)
    tit_cl(1)
    par(doc, f"1.1 O objeto do Contrato de Despesa {ct} é {dados['objeto_completo']}", align=J, after=6)
    tit_cl(2)
    par(doc, f"2.1 – O presente Termo de Apostilamento tem por finalidade realizar o {t['reaj_label']}, "
             f"referente{'s' if len(calc['novos'])>1 else ''} ao{'s' if len(calc['novos'])>1 else ''} "
             f"período{'s' if len(calc['novos'])>1 else ''} de {t['periodos']}, sobre o valor {base.lower()} "
             f"do contrato, conforme índice {dados['indice']['nome']}, "
             + (f"com percentual de {pct(calc['novos'][0]['indice_pct'])}." if len(calc['novos']) == 1 else
                "com percentuais de " + lista_pt([f"{pct(r['indice_pct'])} no {r['n']}° reajuste"
                                                  for r in calc['novos']]) + "."), align=J, after=6)
    par(doc, "2.2. – Dessa maneira, o valor dos itens do contrato segue a tabela abaixo:", align=J, after=6)
    itens = dados["itens"]
    tb = doc.add_table(rows=len(itens) + 2, cols=3); tabela_bordas(tb); tb.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(["ITEM", f"VALOR {base} ANTES DO REAJUSTE", f"VALOR {base} APÓS O REAJUSTE"]):
        cel(tb.rows[0].cells[i], h, bold=True, size=10)
    for j, it in enumerate(itens):
        cs = tb.rows[j + 1].cells
        cel(cs[0], f"{it['item']} — {it['descricao']}", align=WD_ALIGN_PARAGRAPH.LEFT, size=10)
        cel(cs[1], brl(it["atual"]), size=10); cel(cs[2], brl(it["novo_valor"]), size=10)
    cs = tb.rows[-1].cells
    cel(cs[0], f"VALOR {base} DO CONTRATO", bold=True, size=10)
    cel(cs[1], brl(calc["total_atual"]), bold=True, size=10); cel(cs[2], brl(calc["total_novo"]), bold=True, size=10)
    larguras(tb, [8.0, 4.0, 4.0])
    par(doc, after=6)
    vt = calc["valor_termo"]
    p = par(doc, align=J, after=6)
    run(p, "2.3. - O valor do presente Termo de Apostilamento perfaz o valor de ")
    run(p, f"{brl(vt)} ({extenso_reais(vt)})", bold=True)
    comp = calc.get("complemento")
    if comp:
        run(p, f", sendo {brl(calc['valor_dif_anual'])} referente à diferença do valor {base.lower()} do contrato e "
               f"{brl(comp['total'])} referente ao reajuste incidente sobre as unidades suprimidas pelo {comp['doc']} "
               f"no período de {comp['periodo']}, destinado à atualização do valor e do saldo contratual.")
    else:
        run(p, ", destinado à atualização do valor e do saldo contratual.")
    tit_cl(3)
    par(doc, "3.1 – Considerando o interesse da Administração e o parecer favorável do fiscal do Contrato de "
             f"Despesa n° {ct} e d{'a' if ordn['feminino'] else 'o'} {tit} de Despesas, pelo reajuste do valor "
             f"contratual, conforme o Parecer Técnico de Reajustamento nº {dados['parecer_numero']}.",
        align=J, after=6)
    tit_cl(4)
    par(doc, "4.1 – O presente Termo de Apostilamento entrará em vigor na data de sua assinatura, com efeitos "
             f"financeiros a contar de {calc['efeitos']}, em decorrência da aplicação do reajuste contratual.",
        align=J, after=6)
    tit_cl(5)
    par(doc, "5.1 – Este Termo de Apostilamento está estabelecido em 02 (duas) vias de igual teor, sendo uma para "
             "a CONTRATANTE e outra para a CONTRATADA, dele sendo extraídas tantas cópias quantas forem necessárias "
             "à sua execução.", align=J, after=6)
    par(doc, "5.2 - E, por assim estarem acordadas, declaram as partes aceitar todas as condições estabelecidas nas "
             "cláusulas do presente TERMO DE APOSTILAMENTO, que, após lido e achado conforme, vai devidamente "
             "assinado pelos representantes e testemunhas abaixo:", align=J, after=6, keep=True)
    par(doc, keep=True)
    par(doc, f"{dados.get('cidade', DEFAULTS['cidade'])}, data conforme assinatura digital.",
        align=WD_ALIGN_PARAGRAPH.RIGHT, after=12, keep=True)
    linha = "_______________________________________"
    # Lado da CONTRATADA: um bloco por representante (contrato pode ter mais de um), depois as 2 testemunhas
    nomes_rep = [r["nome"] for r in emp.get("representantes", [])] or [emp["representante"]]
    dir_col = [("Pela CONTRATADA", "", "", linha, nomes_rep[0], "Representante da Empresa")]
    dir_col += [("", "", linha, n, "Representante da Empresa") for n in nomes_rep[1:]]
    dir_col += [("", "", linha, "Testemunha de Assinatura")] * 2
    esq_col = [("Pela CONTRATANTE", "", "", linha, "Gestor do Contrato"),
               ("", "", linha, dados.get("aci", {}).get("funcao", "Agente de Controle Interno")),
               ("", "", linha, ordn.get("funcao_assinatura") or f"{tit} de Despesas")]
    esq_col += [("",)] * (len(dir_col) - len(esq_col))
    blocos = list(zip(esq_col, dir_col))
    for ib, (esq, dir_) in enumerate(blocos):
        tb = doc.add_table(rows=1, cols=2); sem_bordas(tb)
        trPr = tb.rows[0]._tr.get_or_add_trPr(); trPr.append(OxmlElement("w:cantSplit"))
        ultimo = ib == len(blocos) - 1
        for c, linhas in zip(tb.rows[0].cells, (esq, dir_)):
            c.text = ""
            for k, l in enumerate(linhas):
                pp = c.paragraphs[0] if k == 0 else c.add_paragraph()
                pp.alignment = C; run(pp, l)
                pp.paragraph_format.keep_with_next = not ultimo
        if not ultimo: par(doc, keep=True)
    doc.save(caminho)

def verificar_ultima_pagina(docx_path):
    """Regra: a última página do termo deve ter ao menos um item (5.2) antes das assinaturas."""
    import subprocess, tempfile, shutil
    if not shutil.which("soffice") or not shutil.which("pdftotext"):
        print("AVISO: não foi possível verificar a última página do termo (sem soffice/pdftotext)."); return
    tmp = tempfile.mkdtemp()
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmp, docx_path],
                   capture_output=True, timeout=120)
    pdf = os.path.join(tmp, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")
    if not os.path.exists(pdf): print("AVISO: falha ao converter o termo para PDF."); return
    txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    ultima = txt.split("\f")[-2] if txt.endswith("\f") else txt.split("\f")[-1]
    if "5.2" in ultima or "5.1" in ultima:
        print("OK: última página do termo contém item de texto antes das assinaturas.")
    else:
        print("AVISO: última página do termo ficou só com assinaturas - ajustar quebra de página.")

# ---------------------------------------------------------------------------
def checar(dados, hoje=None):
    """Quadro de checagem (obrigatório antes de gerar). Devolve lista de
    {"campo", "status": "OK"|"ATENCAO"|"FALTA", "valor", "mensagem"}. Não gerar se houver "FALTA"."""
    hoje = hoje or date.today()
    q = []
    def add(campo, status, valor="", msg=""): q.append({"campo": campo, "status": status, "valor": valor, "mensagem": msg})
    obrig = [("contrato", "Nº do contrato"), ("nup", "NUP/PAG"), ("om_contratante_nome", "OM contratante"),
             ("objeto_completo", "Objeto completo"), ("objeto_resumido", "Objeto resumido"),
             ("data_base", "Data do orçamento (data-base)"), ("parecer_numero", "Nº do Parecer Técnico"),
             ("numero_instrumento", "Nº do apostilamento")]
    for k, nome in obrig:
        v = dados.get(k)
        add(nome, "OK" if v not in (None, "") else "FALTA", v if v is not None else "",
            "" if v not in (None, "") else "Informar manualmente")
    emp = dados.get("empresa") or {}
    falt = [k for k in ("nome", "cnpj", "endereco", "representante") if not emp.get(k)
            and not (k == "representante" and emp.get("representantes"))]
    add("Empresa (II – CONTRATADA)", "FALTA" if falt else "OK", emp.get("nome", ""),
        ("Faltam: " + ", ".join(falt)) if falt else "")
    idx = dados.get("indice") or {}
    add("Índice e cláusula", "OK" if idx.get("nome") and idx.get("clausula") else "FALTA",
        f"{idx.get('nome','')} – {idx.get('clausula','')}")
    # OM do Ordenador / texto fixo
    ordn = {**DEFAULTS["ordenador"], **dados.get("ordenador", {})}
    om_od = dados.get("om_ordenador", ordn.get("om_sigla", "GAP-MN"))
    if om_od in TEXTOS_FIXOS_OM:
        add("I – CONTRATANTE", "OK", f"Texto fixo {om_od}")
    elif dados.get("contratante_paragrafo"):
        add("I – CONTRATANTE", "ATENCAO", om_od, "Texto do contrato inicial (OM sem texto fixo) – conferir e, se aprovado, cadastrar como fixo")
    else:
        add("I – CONTRATANTE", "FALTA", om_od, "OM sem texto fixo: copiar o parágrafo da 1ª página do contrato inicial")
    # Itens
    itens = dados.get("itens") or []
    if not itens:
        add("Itens", "FALTA", "", "Sem itens")
    else:
        nums = [it.get("item") for it in itens]
        add("Numeração dos itens", "OK" if len(set(nums)) == len(nums) else "ATENCAO", ", ".join(map(str, nums)),
            "" if len(set(nums)) == len(nums) else "Numeração repetida – deve ser igual à do contrato")
        soma = sum(r2(D(str(it.get("valor_base", 0)))) for it in itens)
        tot = dados.get("itens_total_inicial")
        if tot is not None:
            ok = r2(D(str(tot))) == soma
            add("Soma dos itens = valor do contrato", "OK" if ok else "ATENCAO", f"{brl(soma)} × {brl(tot)}",
                "" if ok else "Soma dos itens difere do valor informado")
        fator = dados.get("fator_anual") or {"ANUAL": 12, "MENSAL": 1}.get(dados.get("base", "ANUAL").upper())
        for it in itens:
            if fator and it.get("valor_unit") is not None and it.get("qtd") is not None:
                calc_ = r2(D(str(it["valor_unit"])) * D(str(it["qtd"])) * fator)
                if calc_ != r2(D(str(it["valor_base"]))):
                    add(f"Item {it['item']} – unitário × qtd", "ATENCAO",
                        f"{brl(it['valor_unit'])} × {it['qtd']} × {fator} = {brl(calc_)} ≠ {brl(it['valor_base'])}",
                        "Unitário não bate com o valor do item – confirmar qual vale (usar observacoes_extras)")
    # Alterações / supressão
    alts = dados.get("alteracoes_quantitativas") or []
    datas = []
    for a in alts:
        try:
            d_, m_, a_ = map(int, a["data_assinatura"].split("/")); datas.append(date(a_, m_, d_))
        except Exception:
            add(f"{a.get('documento','TA')} – data", "FALTA", a.get("data_assinatura", ""), "Data dd/mm/aaaa (última assinatura)")
    if datas and datas != sorted(datas):
        add("Ordem dos TAs", "ATENCAO", "", "Datas fora de ordem cronológica")
    if alts and not any(it.get("qtd_inicial") is not None for it in itens):
        add("Quantidades da supressão", "FALTA", "", "Informar qtd_inicial dos itens alterados")
    # Histórico
    add("Histórico de valores (item 5 do parecer)", "OK" if dados.get("historico_valores") else "FALTA",
        len(dados.get("historico_valores") or []))
    # Reajustes / índice divulgado / prints
    reaj = dados.get("reajustes") or []
    novos = [r for r in reaj if r.get("novo", True)]
    add("Reajustes novos", "OK" if novos else "FALTA", len(novos))
    for r in novos:
        if r.get("indice_pct") in (None, ""):
            add(f"{r.get('n')}º reajuste – índice", "FALTA", "", "Consultar a Calculadora do Cidadão / FGV")
    if dados.get("data_base") and novos:
        dbm, dba = mm_aaaa(dados["data_base"])
        ult = max(r["n"] for r in novos)
        am, aa = add_meses(dbm, dba, 12 * ult)
        fm, fa = (am, aa) if REGRA_PERIODO == "MESMO_MES" else add_meses(am, aa, -1)
        pm, pa = add_meses(fm, fa, 1)
        if hoje < date(pa, pm, 12):
            add("Índice do mês final divulgado?", "ATENCAO", f"{fm:02d}/{fa}", "Índice provavelmente ainda não divulgado")
        if hoje < date(aa, am, 1):
            add("Aniversário do último reajuste", "FALTA", f"{am:02d}/{aa}", "Reajuste ainda não devido")
    prints = dados.get("prints_indice") or []
    add("Prints da consulta do índice", "OK" if len(prints) >= len(novos) else "ATENCAO", len(prints),
        "" if len(prints) >= len(novos) else "Um print por reajuste novo (anexo do parecer)")
    # Empenho
    o = dados.get("orcamento") or {}
    falt = [k for k in ("gestao_unidade", "fonte", "programa_trabalho", "plano_interno", "natureza_despesa", "exercicio")
            if not o.get(k)]
    add("Dados do empenho", "FALTA" if falt else "OK", "", ("Faltam: " + ", ".join(falt)) if falt else "")
    return q


def links_indice(dados, calc):
    """Um link por reajuste novo, para abrir direto a consulta que vai como print no parecer:
    Calculadora do Cidadão (já preenchida) ou a tabela anual da FGV (INCC)."""
    fgv, ib = _modulo("indice_fgv"), _modulo("indice_bcb")
    nome = (dados.get("indice") or {}).get("nome", "")
    k0 = len(calc["antigos"]); out = []
    for i, r in enumerate(calc["novos"]):
        if fgv.eh_fgv(nome):
            l = fgv.links(nome, r["inicio"], r["fim"])
        else:
            cod = nome.upper().replace(" ", "")
            valor = float(calc["totais"][k0 + i])
            l = {"fonte": "Calculadora do Cidadão", "indice": cod, "periodo": f"{r['inicio']} a {r['fim']}",
                 "valor_correcao": valor,
                 "url_print": ib.url_calculadora(cod, r["inicio"], r["fim"], valor) if cod in ib.CALCULADORA else None}
        out.append({"n": r["n"], **l})
    return out


def gerar(dados, saida, verificar_pdf=True):
    """API para uso em sistemas (site): recebe o dict de dados, gera os arquivos em `saida`
    e devolve {"arquivos": {...}, "resumo": {...}, "avisos": [...]}. Não imprime nada."""
    os.makedirs(saida, exist_ok=True)
    global BRASAO_PATH, CASAS_PCT
    BRASAO_PATH = achar_brasao(dados)
    fgv = _modulo("indice_fgv")
    eh_fgv = fgv.eh_fgv((dados.get("indice") or {}).get("nome"))
    CASAS_PCT = 2 if eh_fgv else 6
    if eh_fgv:
        dados.setdefault("indice", {}).setdefault("fonte_curta", "consulta abaixo")
    calc = calcular(dados); t = textos(dados, calc)
    nome = dados["contrato"].replace("/", "-")
    aditivo = dados.get("instrumento", "").lower().startswith("termo aditivo")
    inst = f"{dados['numero_instrumento']}TA" if aditivo else f"{dados['numero_instrumento']}Apost"
    arqs = {
        "memoria": os.path.join(saida, f"1 - Memoria de Calculo - CT {nome} - {inst}.xlsx"),
        "declaracao": os.path.join(saida, f"2 - Declaracao de Disponibilidade Orcamentaria - CT {nome} - {inst}.docx"),
        "parecer": os.path.join(saida, f"3 - Parecer Tecnico de Reajustamento - CT {nome} - {inst}.docx"),
        "termo": os.path.join(saida, f"4 - Termo de Apostilamento - CT {nome} - {inst}.docx"),
    }
    gerar_memoria(dados, calc, t, arqs["memoria"])
    gerar_declaracao(dados, calc, t, arqs["declaracao"])
    gerar_parecer(dados, calc, t, arqs["parecer"])
    if aditivo: arqs.pop("termo")
    else: gerar_termo(dados, calc, t, arqs["termo"])
    avisos = list(calc["avisos"])
    if dados.get("checklist"):      # checklist do fiscal (SIM/NÃO), mesmo padrão do robô offline
        gerar_checklist = _modulo("checklist").gerar_checklist
        arqs["checklist"] = os.path.join(saida, f"5 - Checklist do Fiscal - CT {nome} - {inst}.docx")
        avisos += ["Checklist: " + a for a in gerar_checklist(dados, dados["checklist"], arqs["checklist"])]
    if not BRASAO_PATH: avisos.append("Brasão não encontrado - documentos saíram com [BRASÃO] no lugar.")
    if verificar_pdf and "termo" in arqs:
        import contextlib, io as _io
        buf = _io.StringIO()
        with contextlib.redirect_stdout(buf): verificar_ultima_pagina(arqs["termo"])
        msg = buf.getvalue().strip()
        if msg.startswith("AVISO"): avisos.append(msg.replace("AVISO: ", ""))
    comp = calc.get("complemento")
    resumo = {
        "regra_periodo": REGRA_PERIODO,
        "reajustes": [{"n": r["n"], "novo": r.get("novo", True), "inicio": r["inicio"], "fim": r["fim"],
                       "indice_pct": float(r["indice_pct"]), "efeitos": r["efeitos"]} for r in calc["reajustes"]],
        "valor_atual": float(calc["total_atual"]), "valor_reajustado": float(calc["total_novo"]),
        "diferenca_anual": float(calc["valor_dif_anual"]),
        "complemento_supressao": float(comp["total"]) if comp else 0.0,
        "valor_termo": float(calc["valor_termo"]), "valor_termo_extenso": extenso_reais(calc["valor_termo"]),
        "efeitos_financeiros": calc["efeitos"],
        "links_indice": links_indice(dados, calc),
    }
    return {"arquivos": arqs, "resumo": resumo, "avisos": avisos}


def main():
    dados = json.load(open(sys.argv[1], encoding="utf-8"))
    saida = sys.argv[2] if len(sys.argv) > 2 else "."
    r = gerar(dados, saida)
    res = r["resumo"]
    print("=== RESUMO ===")
    print("Regra do período:", res["regra_periodo"])
    for x in res["reajustes"]:
        print(f"{x['n']}º reajuste {'(NOVO)' if x['novo'] else '(já aplicado)'}: {x['inicio']} a {x['fim']} | "
              f"índice {pct(x['indice_pct'])} | efeitos {x['efeitos']}")
    print("Valor atual:", brl(res["valor_atual"]), "| Valor reajustado:", brl(res["valor_reajustado"]))
    if res["complemento_supressao"]:
        print("Complemento supressão:", brl(res["complemento_supressao"]))
    print("Valor do instrumento:", brl(res["valor_termo"]), "-", res["valor_termo_extenso"])
    print("Efeitos financeiros a contar de:", res["efeitos_financeiros"])
    for l in res.get("links_indice", []):
        print(f"CONSULTA {l['n']}º reajuste ({l['fonte']}): {l.get('url_print')}"
              + (f"  -> linha {l['linha_tabela']}, Acumulado 12 meses" if l.get("linha_tabela") else ""))
    for a in r["avisos"]: print(a if a.startswith("INFO") else "AVISO: " + a)
    for k, v in r["arquivos"].items(): print("ARQUIVO:", v)


if __name__ == "__main__":
    main()
