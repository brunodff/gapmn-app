#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Gera a DECLARAÇÃO DE VANTAJOSIDADE ECONÔMICA do termo aditivo (.docx).

Uso:  python3 gerar_declaracao_vantajosidade.py dados.json saida/
      (brasao.png na mesma pasta deste script)

Regras (Chefe da SCON, 24/11/2026):
- Só existe quando a PRORROGAÇÃO DE VIGÊNCIA está marcada (com ou sem renovação de valor).
- Modelo = só a 1ª página do modelo enviado (a página "Controle de assinaturas eletrônicas" é gerada pelo SILOMS).
- Cabeçalho: brasão, MINISTÉRIO DA DEFESA, COMANDO DA AERONÁUTICA e o nome da OM QUE ASSINA O CONTRATO
  (puxado automático de om_signataria.nome; o usuário pode trocar no site → vantajosidade.om_cabecalho).
- Título fixo, para todos os casos: DECLARAÇÃO DE VANTAJOSIDADE ECONÔMICA.
- 1º parágrafo: "Considerando a prorrogação de vigência do Contrato nº <nº>, cujo objeto é <objeto do contrato>,
  declaro que é vantajosa economicamente a prorrogação do contrato em questão, pois:"
- Em seguida, os INCISOS (I –, II –, III – …) com os motivos que o fiscal escreve no site
  (campo "Motivos da vantajosidade", quantos forem necessários) → vantajosidade.motivos.
- "Data conforme assinatura eletrônica."
- Assinaturas só com o cargo: "Gestor do Contrato" e "Ordenador de Despesas" (sem nome e sem posto).

Bloco no dados.json:
  "vantajosidade": {
      "motivos": ["Os preços praticados no mercado ...", "..."],   # obrigatório (1 ou mais)
      "om_cabecalho": "GRUPAMENTO DE APOIO DE MANAUS",              # opcional (padrão: om_signataria.nome)
      "objeto": "a prestação de serviço móvel pessoal – SMP"        # opcional (padrão: objeto_contrato com artigo)
  }
"""
import json, os, re, sys
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from gerar_lista_verificacao import tem_prorrogacao

FONTE = "Arial"
ROMANOS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"]
MASC_EM_A = {"sistema", "programa", "problema", "tema", "mapa", "dia", "clima", "esquema", "projeto"}


# ---------------------------------------------------------------- texto
def artigo_para(palavra):
    """Artigo definido pelo 1º substantivo do objeto ('Serviço' → o, 'Contratação' → a, 'Serviços' → os)."""
    w = palavra.lower().strip(" ,.;:–-")
    plural = w.endswith("s") and len(w) > 3
    base = w
    if plural:
        base = re.sub(r"ções$", "ção", base)
        base = re.sub(r"ões$", "ão", base)
        base = re.sub(r"s$", "", base)
    fem = (base not in MASC_EM_A) and bool(re.search(r"(ção|são|dade|gem|ura|eza|ça|a)$", base))
    art = "a" if fem else "o"
    return art + ("s" if plural else "")


def frase_objeto(d):
    """Objeto do contrato como entra na frase 'cujo objeto é ...'."""
    v = d.get("vantajosidade") or {}
    if str(v.get("objeto") or "").strip():
        return v["objeto"].strip().rstrip(".")
    obj = str(d.get("objeto_contrato") or "").strip().rstrip(".")
    if not obj:
        return ""
    if obj.isupper():                       # objeto em caixa alta (SILOMS) → caixa normal
        obj = obj.lower()
    primeira = obj.split()[0]
    if primeira.lower() in ("o", "a", "os", "as"):
        return obj[:1].lower() + obj[1:]
    if not primeira.isupper():              # não mexe em sigla no início (ex.: "SMP ...")
        obj = obj[:1].lower() + obj[1:]
    return artigo_para(primeira) + " " + obj


def incisos(motivos):
    """Numeração I –, II – …; pontuação final padronizada (';' nos intermediários e '.' no último)."""
    limpos = [re.sub(r"\s+", " ", str(m)).strip() for m in motivos if str(m or "").strip()]
    limpos = [re.sub(r"^(?:[IVX]+|\d+|[a-z])\s*[–\-).]\s*", "", m) for m in limpos]   # tira numeração digitada
    saida = []
    for i, m in enumerate(limpos):
        m = m.rstrip(" ;.")
        saida.append((ROMANOS[i] if i < len(ROMANOS) else str(i + 1), m + ("." if i == len(limpos) - 1 else ";")))
    return saida


# ---------------------------------------------------------------- docx
def run(p, texto, size=11, bold=False, underline=False):
    r = p.add_run(texto)
    r.font.name = FONTE
    r._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONTE)
    r.font.size = Pt(size)
    r.bold = bold
    r.underline = underline
    return r


def par(doc, align=WD_ALIGN_PARAGRAPH.CENTER, before=0, after=0, line=None, first=None, junto=False):
    p = doc.add_paragraph()
    p.alignment = align
    pf = p.paragraph_format
    pf.space_before, pf.space_after = Pt(before), Pt(after)
    if line:
        pf.line_spacing = line
    if first is not None:
        pf.first_line_indent = first
    pf.keep_with_next = junto
    return p


def gerar(d, saida):
    erros, avisos = [], []
    if not tem_prorrogacao(d):
        print("Declaração de Vantajosidade NÃO se aplica: o aditivo não tem prorrogação de vigência.")
        sys.exit(2)
    om = d.get("om_signataria") or {}
    v = d.get("vantajosidade") or {}
    cab = str(v.get("om_cabecalho") or om.get("nome") or "").strip()
    if not str(d.get("contrato") or "").strip():
        erros.append("Campo obrigatório vazio: contrato")
    if not cab:
        erros.append("OM do cabeçalho vazia (om_signataria.nome ou vantajosidade.om_cabecalho)")
    objeto = frase_objeto(d)
    if not objeto:
        erros.append("Objeto do contrato vazio (objeto_contrato ou vantajosidade.objeto)")
    inc = incisos(v.get("motivos") or [])
    if not inc:
        erros.append("O fiscal não escreveu nenhum motivo da vantajosidade (vantajosidade.motivos)")
    if erros:
        print("ERROS – declaração de vantajosidade NÃO gerada:")
        for e in erros:
            print("  ❌", e)
        sys.exit(1)
    if v.get("om_cabecalho") and om.get("nome") and v["om_cabecalho"].strip().upper() != om["nome"].strip().upper():
        avisos.append(f"Cabeçalho ajustado manualmente: '{v['om_cabecalho']}' (OM signatária: {om['nome']}).")

    doc = Document()
    s = doc.sections[0]
    s.page_width, s.page_height = Cm(21.0), Cm(29.7)
    s.top_margin, s.bottom_margin = Cm(1.3), Cm(1.5)
    s.left_margin, s.right_margin = Cm(1.4), Cm(1.6)
    st = doc.styles["Normal"]
    st.font.name = FONTE
    st.font.size = Pt(11)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONTE)

    # cabeçalho
    p = par(doc)
    brasao = os.path.join(AQUI, "brasao.png")
    if os.path.exists(brasao):
        p.add_run().add_picture(brasao, height=Cm(2.25))
    else:
        avisos.append("brasao.png não encontrado: declaração sem brasão.")
    run(par(doc), "MINISTÉRIO DA DEFESA", bold=True)
    run(par(doc), "COMANDO DA AERONÁUTICA")
    run(par(doc, after=30), cab.upper(), underline=True)
    run(par(doc, after=22), "DECLARAÇÃO DE VANTAJOSIDADE ECONÔMICA", bold=True, underline=True)

    # corpo
    J, ESP, REC = WD_ALIGN_PARAGRAPH.JUSTIFY, 1.5, Cm(1.45)
    p = par(doc, J, line=ESP, first=REC)
    run(p, f"Considerando a prorrogação de vigência do Contrato nº {d['contrato'].strip()}, cujo objeto é {objeto}, "
           "declaro que é vantajosa economicamente a prorrogação do contrato em questão, pois:")
    for i, (num, texto) in enumerate(inc):
        p = par(doc, J, line=ESP, first=REC, junto=(i == len(inc) - 1))   # último inciso preso à data/assinaturas
        run(p, f"{num} – {texto}")

    run(par(doc, WD_ALIGN_PARAGRAPH.RIGHT, before=36, junto=True), "Data conforme assinatura eletrônica.", 12)
    run(par(doc, before=54, junto=True), d.get("cargo_gestor", "Gestor do Contrato"))
    run(par(doc, before=72), d.get("cargo_ordenador", "Ordenador de Despesas"))

    os.makedirs(saida, exist_ok=True)
    caminho = os.path.join(saida, "Declaracao de Vantajosidade Economica - CT "
                           + d["contrato"].replace("/", "-") + ".docx")
    doc.save(caminho)
    print("RESUMO – Declaração de Vantajosidade Econômica")
    print("  Arquivo:", caminho)
    print("  Cabeçalho:", cab.upper())
    print("  Objeto na frase: cujo objeto é", objeto)
    for num, texto in inc:
        print(f"    {num} – {texto}")
    for a in avisos:
        print("  ⚠️", a)
    return caminho


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        gerar(json.load(f), sys.argv[2])
