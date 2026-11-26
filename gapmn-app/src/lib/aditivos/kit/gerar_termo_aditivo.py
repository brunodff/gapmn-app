#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Gera o TERMO ADITIVO (.docx) – documento da SEÇÃO DE CONTRATOS (não entra na Lista de Verificação).

Uso:  python3 gerar_termo_aditivo.py dados.json saida/

Regras do Chefe da SCON (modelo "MINUTA 2º TA do CT 043/BAMN/2021" + áudios de 25/11/2026):
- No site só usuários SCON geram o termo, em botão próprio, a partir do que o fiscal SALVOU.
- Cabeçalho de todas as páginas: "1/3" no canto SUPERIOR ESQUERDO e, do lado oposto, "Xº Termo Aditivo ao Contrato de
  Despesa nº ...". Sem o rodapé da Câmara Nacional de Modelos da AGU.
- Brasão · MINISTÉRIO DA DEFESA · COMANDO DA AERONÁUTICA · OM que assina o contrato · "MINUTA" (em vermelho) SÓ quando o
  aditivo vai para a CJU (sem parecer referencial; prorrogação excepcional sempre vai) · "TERMO ADITIVO nº <nº>".
- Ementa: "<ORDINAL> TERMO ADITIVO AO CONTRATO DE DESPESA Nº ..., QUE FAZEM ENTRE SI O/A <OM> E A EMPRESA <EMPRESA>."
- Preâmbulo: contratante e Ordenador vêm do cadastro da unidade (Reajustes → Configurações, inclusive unidades apoiadas);
  contratada e representante do cadastro do contrato; Processo (PAG), Lei do contrato e a licitação de origem.
- Cláusula 1 OBJETO: uma alínea por alteração (1.1, 1.2…): PRORROGAR [de forma EXCEPCIONAL] / REAJUSTAR / ACRESCER /
  SUPRIMIR, com os mesmos dados e artigos do Parecer Técnico (Lei 8.666 ou 14.133).
- PREÇO: "O valor do presente Termo Aditivo perfaz o total de R$ ... (extenso)." (complemento opcional, ex.: "valor
  referente a 6 meses de vigência do contrato" quando o período foge do habitual).
- Com REAJUSTE: cláusula com a tabela dos itens (a mesma do item 10 do Parecer Técnico).
- DOTAÇÃO ORÇAMENTÁRIA: os mesmos dados da Declaração de Disponibilidade Orçamentária (último empenho).
- GARANTIA (se o contrato/TR exigir): 10 dias úteis (IN SEGES/MP 5/2017, Anexo VII-F, item 3.1, "a"), valor = percentual do contrato/TR × valor do termo; art. 56 da 8.666
  ou arts. 96 a 100 da 14.133; validade de 90 dias após a vigência (item 3.1 do Anexo VII-F da IN SEGES/MPDG nº 5/2017).
- RATIFICAÇÃO (fixa) · PUBLICAÇÃO (8.666: art. 61, parágrafo único, DOU; 14.133: PNCP, art. 94, e sítio oficial, art. 91).
- "<Cidade>, data conforme assinatura digital." e assinaturas NUNCA sozinhas: ficam presas ao último subitem da última
  cláusula. Contratante: Gestor do Contrato; Agente de Controle Interno do/da <sigla>; Ordenador de Despesas do/da
  <sigla> (sem nomes). Contratada: nome do representante + "Representante da Empresa"; 2 testemunhas.

Bloco no dados.json (além dos já usados pelos outros documentos):
  "om_signataria": {..., "endereco", "cnpj", "cidade", "ordenador": {"nome", "posto", "portaria", "publicacao",
                    "matricula", "feminino"}},
  "contratada": {"nome", "cnpj", "endereco", "representante", "representante_feminino"},
  "tipo_contrato": "Despesa", "licitacao": "Pregão nº 07/2020",
  "termo_aditivo": {"numero": "001/2026", "minuta": null, "preco_complemento": "", "exercicio": null,
                    "garantia": {"exige": true, "percentual": 0.75, "base": "termo"}}
"""
import json, os, re, sys, datetime
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from gerar_ficha_autorizacao import objeto_e_valores, brl, num, data, somar_meses
from gerar_parecer_tecnico import (run, par, escrever, falta, brl_ext, meses_ext, pct_txt, ordinal, lei_do, ART,
                                   LIMITE_ANUENCIA, tabela_itens, inteiro_extenso, FONTE)
import pareceres as P

LEI_LONGA = {"8666": "da Lei nº 8.666, de 21 de junho de 1993", "14133": "da Lei nº 14.133, de 1º de abril de 2021"}
LEI_CURTA = {"8666": "da Lei nº 8.666, de 1993", "14133": "da Lei nº 14.133, de 2021"}
ORD_M = ["", "PRIMEIRO", "SEGUNDO", "TERCEIRO", "QUARTO", "QUINTO", "SEXTO", "SÉTIMO", "OITAVO", "NONO", "DÉCIMO"]
ORD_F = ["", "PRIMEIRA", "SEGUNDA", "TERCEIRA", "QUARTA", "QUINTA", "SEXTA", "SÉTIMA", "OITAVA", "NONA", "DÉCIMA"]
J, C, R, L = (WD_ALIGN_PARAGRAPH.JUSTIFY, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.LEFT)


def ordinal_extenso(n, fem=False):
    tab = ORD_F if fem else ORD_M
    n = int(n)
    if n <= 10:
        return tab[n]
    if n < 20:
        return ("DÉCIMA " if fem else "DÉCIMO ") + tab[n - 10]
    return f"{n}ª" if fem else f"{n}º"


def campo(p, instr):
    """Campo do Word (PAGE / NUMPAGES)."""
    r = p.add_run()
    for tipo, txt in (("begin", None), (None, instr), ("separate", None), (None, "1"), ("end", None)):
        if tipo:
            fc = OxmlElement("w:fldChar")
            fc.set(qn("w:fldCharType"), tipo)
            r._r.append(fc)
        elif txt == instr:
            it = OxmlElement("w:instrText")
            it.set(qn("xml:space"), "preserve")
            it.text = f" {instr} "
            r._r.append(it)
        else:
            t = OxmlElement("w:t")
            t.text = txt
            r._r.append(t)
    r.font.name, r.font.size = FONTE, Pt(8)
    return r


def cabecalho_pagina(sec, titulo):
    hp = sec.header.paragraphs[0]
    hp.text = ""
    largura = sec.page_width - sec.left_margin - sec.right_margin
    hp.paragraph_format.tab_stops.add_tab_stop(largura, WD_TAB_ALIGNMENT.RIGHT)
    campo(hp, "PAGE")
    r = hp.add_run("/")
    r.font.name, r.font.size = FONTE, Pt(8)
    campo(hp, "NUMPAGES")
    r = hp.add_run("\t" + titulo)
    r.font.name, r.font.size, r.italic = FONTE, Pt(8), True


def g(fem, m, f):
    return f if fem else m


def art_ta(chave, d, lei):
    """Artigo da alteração, com a lei por extenso (padrão do termo)."""
    A = ART[lei]
    ad = d.get("aditivo") or {}
    pt = d.get("parecer_tecnico") or {}
    if chave == "prorrogacao":
        pr = ad.get("prorrogacao") or {}
        f = A["prorrogacao_excepcional"] if pr.get("excepcional") else \
            (A["prorrogacao_escopo"] if pt.get("natureza") == "escopo" else A["prorrogacao"])
    elif chave == "supressao":
        x = ad.get("supressao") or {}
        pct = num(x["percentual"]) if x.get("percentual") not in (None, "") else 0
        f = A["supressao_acordo"].split(" (")[0] if pct > LIMITE_ANUENCIA else A["supressao"]
    else:
        f = A[chave]
    return f"{f}, {LEI_LONGA[lei]}"


def nome_tipo(ad):
    partes = []
    pr = ad.get("prorrogacao")
    if pr:
        partes.append("prorrogação excepcional" if pr.get("excepcional") else "prorrogação")
    for k, n in (("reajuste", "reajuste"), ("acrescimo", "acréscimo"), ("supressao", "supressão")):
        if ad.get(k):
            partes.append(n)
    if not partes:
        return ""
    return "de " + (partes[0] if len(partes) == 1 else ", ".join(partes[:-1]) + " e " + partes[-1])


def subitem(doc, num_txt, partes, junto=False, after=6):
    p = par(doc, J, after=after, junto=junto)
    p.paragraph_format.left_indent = Cm(0.75)
    escrever(p, [f"{num_txt}. "] + partes)
    return p


def titulo_clausula(doc, n, nome):
    p = par(doc, L, before=10, after=6, junto=True)
    escrever(p, [(f"{n}. CLÁUSULA {ordinal_extenso(n, True)} – {nome}", {"bold": True})])


def gerar(d, saida):
    erros, avisos = [], []
    om = d.get("om_signataria") or {}
    od = om.get("ordenador") or {}
    ct = d.get("contratada") or {}
    if isinstance(ct, str):
        ct = {"nome": ct}
    ta = d.get("termo_aditivo") or {}
    ad = d.get("aditivo") or {}
    for campo_ in ("contrato", "numero_aditivo"):
        if not str(d.get(campo_) or "").strip():
            erros.append(f"Campo obrigatório vazio: {campo_}")
    _, atual, novo = objeto_e_valores(d, erros, avisos)
    if erros:
        print("ERROS – Termo Aditivo NÃO gerado:")
        for e in erros:
            print("  ❌", e)
        sys.exit(1)
    lei = lei_do(d, avisos)
    n = int(d["numero_aditivo"])
    sigla = om.get("sigla") or ""
    fem_om = (om.get("artigo") or "do") == "da"
    tipo_ct = d.get("tipo_contrato") or "Despesa"
    contrato = d["contrato"]
    an = P.analisar(d)
    minuta = ta.get("minuta") if ta.get("minuta") is not None else an["vai_para_cju"]
    pr = ad.get("prorrogacao") or {}
    ini, fim = pr.get("inicio"), pr.get("fim")
    if ini and not fim and pr.get("meses"):
        fim = (somar_meses(data(ini), int(pr["meses"])) - datetime.timedelta(days=1)).strftime("%d/%m/%Y")

    doc = Document()
    s = doc.sections[0]
    s.page_width, s.page_height = Cm(21.0), Cm(29.7)
    s.top_margin, s.bottom_margin = Cm(2.0), Cm(2.0)
    s.left_margin, s.right_margin = Cm(2.5), Cm(2.0)
    s.header_distance = Cm(0.8)
    st = doc.styles["Normal"]
    st.font.name, st.font.size = FONTE, Pt(11)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONTE)
    cabecalho_pagina(s, f"{ordinal(n)} Termo Aditivo ao Contrato de {tipo_ct} nº {contrato}")

    # ---- abertura
    p = par(doc, C, after=0)
    brasao = os.path.join(AQUI, "brasao.png")
    if os.path.exists(brasao):
        p.add_run().add_picture(brasao, height=Cm(2.25))
    run(par(doc, C, after=0), "MINISTÉRIO DA DEFESA", bold=True)
    run(par(doc, C, after=0), "COMANDO DA AERONÁUTICA")
    run(par(doc, C, after=14), (om.get("nome") or sigla).upper(), underline=True)
    if minuta:
        r = run(par(doc, C, after=10), "MINUTA", bold=True, underline=True)
        r.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)
    numero = str(ta.get("numero") or "").strip()
    if not numero:
        avisos.append("Número do termo aditivo não informado (termo_aditivo.numero – controle da SCON).")
    escrever(par(doc, C, after=18), [("TERMO ADITIVO nº ", {"bold": True}),
                                     (numero, {"bold": True}) if numero else falta("___/____")])
    emp = (ct.get("nome") or "").strip()
    ementa = (f"{ordinal_extenso(n)} TERMO ADITIVO AO CONTRATO DE {tipo_ct.upper()} Nº {contrato}, QUE FAZEM ENTRE SI "
              f"{'A' if fem_om else 'O'} {(om.get('nome') or sigla).upper()} E A EMPRESA {emp.upper() or '___'}.")
    p = par(doc, J, after=18, line=1.5)
    p.paragraph_format.left_indent = Cm(6.0)
    run(p, ementa, bold=True)

    # ---- preâmbulo
    fem_od = bool(od.get("feminino"))
    partes = ["A União, Ministério da Defesa, por intermédio do Comando da Aeronáutica, representada ",
              g(fem_om, "pelo ", "pela "), ((om.get("nome") or sigla).upper(), {"bold": True}), ", com sede na ",
              om.get("endereco") or falta("[endereço da unidade]"), f", {g(fem_om, 'inscrito', 'inscrita')} no CNPJ sob o nº ",
              om.get("cnpj") or falta("[CNPJ]"), f", neste ato {g(fem_om, 'representado', 'representada')} pelo seu "
              f"Ordenador de Despesas, {g(fem_od, 'o Sr.', 'a Sra.')} ",
              (f"{(od.get('nome') or '').upper()} {(od.get('posto') or '').upper()}".strip(), {"bold": True})
              if od.get("nome") else falta("[NOME E POSTO DO ORDENADOR]"),
              f", {g(fem_od, 'nomeado', 'nomeada')} pela ", od.get("portaria") or falta("[portaria de nomeação]"),
              ", publicada no ", od.get("publicacao") or falta("[BCA]"),
              f", {g(fem_od, 'portador', 'portadora')} da Matrícula Funcional nº ", od.get("matricula") or falta("[matrícula]"),
              f", doravante {g(fem_om, 'denominado', 'denominada')} CONTRATANTE, e a ", (emp.upper() or "___", {"bold": True}),
              ", inscrita no CNPJ/MF sob o nº ", ct.get("cnpj") or falta("[CNPJ]"), ", sediada ",
              (ct["endereco"].strip() if re.match(r"(?i)^(na|no|em)\s", ct["endereco"].strip())
               else "na " + ct["endereco"].strip()) if ct.get("endereco") else falta("[endereço da contratada]"),
              ", doravante designada CONTRATADA, neste ato representada ",
              g(ct.get("representante_feminino"), "pelo Sr. ", "pela Sra. "),
              ((ct.get("representante") or "").upper(), {"bold": True}) if ct.get("representante")
              else falta("[REPRESENTANTE DA EMPRESA]"),
              ", tendo em vista o que consta no Processo nº ", (d.get("pag") or "___", {"bold": True}),
              " e em observância às disposições "]
    for faltou, msg in ((not om.get("endereco") or not om.get("cnpj"), "Endereço/CNPJ da unidade não cadastrados (Configurações)."),
                        (not od.get("nome"), "Dados do Ordenador não cadastrados (Configurações da unidade)."),
                        (not ct.get("representante"), "Representante da empresa não informado (cadastro do contrato)."),
                        (not ct.get("endereco"), "Endereço da contratada não informado (cadastro do contrato).")):
        if faltou:
            avisos.append(msg)
    if lei == "8666":
        partes.append("da Lei nº 8.666, de 21 de junho de 1993, da Lei de Diretrizes Orçamentárias vigente e do Decreto "
                      "nº 7.983, de 8 de abril de 2013")
    else:
        partes.append("da Lei nº 14.133, de 1º de abril de 2021, da Lei de Diretrizes Orçamentárias vigente e demais "
                      "legislação aplicável")
    partes += [", resolvem celebrar o presente Termo Aditivo ", nome_tipo(ad)]
    lic = str(d.get("licitacao") or "").strip()
    if lic:
        partes.append(f", decorrente do {lic}")
    else:
        partes += [", decorrente do ", falta("[Pregão nº __/____]")]
        avisos.append("Licitação de origem não informada (licitacao, ex.: 'Pregão nº 07/2020').")
    partes.append(", mediante as cláusulas e condições a seguir enunciadas:")
    escrever(par(doc, J, after=12, line=1.15), partes)

    # ---- cláusulas
    cl = 0

    def nova(nome):
        nonlocal cl
        cl += 1
        titulo_clausula(doc, cl, nome)
        return cl

    k = nova("OBJETO")
    sub = 0
    if ad.get("prorrogacao"):
        sub += 1
        m = int(pr.get("meses") or 0)
        verbo = [("PRORROGAR de forma EXCEPCIONAL", {"bold": True})] if pr.get("excepcional") else [("PRORROGAR", {"bold": True})]
        subitem(doc, f"{k}.{sub}", verbo + [f" o prazo de vigência do Contrato nº {contrato} por mais ",
                                            meses_ext(m) if m else falta("__ meses"), ", passando de ",
                                            ini or falta("__/__/____"), " até o dia ", fim or falta("__/__/____"),
                                            ", sem renovação do valor contratual (apenas da vigência)" if pr.get("modalidade") == "sem_valor"
                                            else ", com renovação do valor contratual",
                                            f", com fundamento no {art_ta('prorrogacao', d, lei)}."])
    rj = ad.get("reajuste")
    if rj:
        sub += 1
        base = (d.get("parecer_tecnico") or {}).get("base", "anual")
        vrj = num(rj["valor"]) if rj.get("valor") not in (None, "") else None
        corr = round(atual + vrj, 2) if (atual is not None and vrj is not None) else None
        subitem(doc, f"{k}.{sub}", [("REAJUSTAR", {"bold": True}), " os preços do contrato em ",
                                    pct_txt(rj.get("percentual"), 6) or falta("XX,XXXXXX%"), ", conforme índice ",
                                    rj.get("indice") or falta("XXXX"), f", sobre o valor {base} do contrato, passando de ",
                                    brl_ext(atual), " para ", brl_ext(corr) if corr is not None else falta("R$ ___"),
                                    f", com fundamento no {art_ta('reajuste', d, lei)}."])
    for chave, verbo in (("acrescimo", "ACRESCER"), ("supressao", "SUPRIMIR")):
        x = ad.get(chave)
        if not x:
            continue
        sub += 1
        pctn = num(x["percentual"]) if x.get("percentual") not in (None, "") else None
        l = [(verbo, {"bold": True}), " ", pct_txt(pctn) if pctn is not None else falta("XX,XX%"),
             " do valor inicial atualizado do contrato, no valor de ",
             brl_ext(num(x["valor"])) if x.get("valor") not in (None, "") else falta("R$ ___")]
        if x.get("descricao"):
            l.append(f", referente a {x['descricao'].strip().rstrip('.')}")
        if chave == "supressao" and pctn is not None and pctn > LIMITE_ANUENCIA:
            l.append(", mediante acordo entre as partes")
        l.append(f", com fundamento no {art_ta(chave, d, lei)}.")
        subitem(doc, f"{k}.{sub}", l)

    k = nova("PREÇO")
    sem_valor_puro = pr.get("modalidade") == "sem_valor" and not any(ad.get(x) for x in ("reajuste", "acrescimo", "supressao"))
    if sem_valor_puro:
        subitem(doc, f"{k}.1", ["O presente Termo Aditivo não altera o valor do contrato, cuja vigência é prorrogada "
                                "sem renovação do valor contratual."])
    else:
        comp = str(ta.get("preco_complemento") or "").strip().rstrip(".")
        subitem(doc, f"{k}.1", ["O valor do presente Termo Aditivo perfaz o total de ", (brl_ext(novo), {"bold": True}),
                                (", " + comp.lstrip(", ")) if comp else "", "."])

    if rj:
        k = nova("VALORES DOS ITENS (CRONOGRAMA FÍSICO-FINANCEIRO)")
        subitem(doc, f"{k}.1", ["Em decorrência do reajuste, os valores dos itens do contrato passam a ser os seguintes:"],
                junto=True, after=4)
        tabela_itens(doc, d, atual, novo, ordinal(n), ini, fim, int(pr.get("meses") or 12), avisos, intro="")

    # dotação = Declaração de Disponibilidade Orçamentária
    k = nova("DOTAÇÃO ORÇAMENTÁRIA")
    emp_ = d.get("empenho") or {}
    exerc = ta.get("exercicio")
    if not exerc:
        if ini and fim and data(ini).year != data(fim).year:
            exerc = f"{data(ini).year}/{data(fim).year}"
        else:
            exerc = emp_.get("exercicio") or d.get("exercicio") or (data(ini).year if ini else None)
    subitem(doc, f"{k}.1", ["As despesas decorrentes desta contratação estão programadas em dotação orçamentária própria, "
                            "prevista no orçamento da União, para o exercício de ", str(exerc) if exerc else falta("____"),
                            ", na classificação abaixo:"], junto=True)
    linhas = [("Gestão/Unidade", "gestao_unidade"), ("Fonte de Recursos", "fonte"), ("Programa de Trabalho", "programa_trabalho"),
              ("Ação", "acao"), ("Plano Interno", "plano_interno"), ("Natureza de Despesa", "natureza_despesa")]
    for rot, ch in linhas:
        v = emp_.get(ch)
        if ch == "acao" and not v:
            continue
        p = par(doc, L, after=0, junto=True)
        p.paragraph_format.left_indent = Cm(2.0)
        escrever(p, [f"{rot}: ", str(v) if v else falta("___")])
        if not v:
            avisos.append(f"Dotação: '{rot}' vazio (mesmo dado da Declaração de Disponibilidade Orçamentária).")
    p = par(doc, L, after=6)
    p.paragraph_format.left_indent = Cm(2.0)
    escrever(p, [("Nota de Empenho: ", {"bold": True}),
                 (emp_.get("numero"), {"bold": True}) if emp_.get("numero") else falta("____NE______")])

    # garantia (só se o contrato/TR exigir)
    gar = ta.get("garantia") or {}
    exige = gar.get("exige")
    if exige is None:
        avisos.append("Garantia: informe se o contrato/TR exige (termo_aditivo.garantia.exige) e o percentual – "
                      "a cláusula saiu com o percentual em branco.")
    if exige is not False:
        k = nova("GARANTIA DE EXECUÇÃO")
        pg = gar.get("percentual")
        pgn = num(pg) if pg not in (None, "") else None
        base_v = novo if gar.get("base", "termo") == "termo" else num(gar.get("valor_base") or novo)
        valor_g = round(base_v * pgn / 100, 2) if pgn is not None else None
        art_g = "conforme disposto no art. 56 da Lei nº 8.666, de 1993" if lei == "8666" else \
                "conforme disposto nos arts. 96 a 100 da Lei nº 14.133, de 2021"
        base_txt = "do valor do Termo Aditivo" if gar.get("base", "termo") == "termo" else "do valor total do contrato"
        subitem(doc, f"{k}.1", ["No prazo de 10 (dez) dias úteis após a assinatura do Termo Aditivo, prestará garantia no valor de ",
                                brl_ext(valor_g) if valor_g is not None else falta("R$ ___"), ", correspondente a ",
                                pct_txt(pgn) if pgn is not None else falta("__%"), f" {base_txt}, que será liberada de "
                                "acordo com as condições previstas no Termo de Referência, ", art_g,
                                ", desde que cumpridas as obrigações contratuais."])
        subitem(doc, f"{k}.2", ["A validade da garantia, qualquer que seja a modalidade escolhida, deverá abranger um "
                                "período de 90 dias após o término da vigência contratual, conforme item 3.1 do Anexo "
                                "VII-F da IN SEGES/MPDG nº 5/2017."])

    k = nova("RATIFICAÇÃO")
    subitem(doc, f"{k}.1", ["Ficam mantidas as demais cláusulas e condições do contrato originário, naquilo que não "
                            "contrariem o presente Termo Aditivo."])

    k = nova("PUBLICAÇÃO")
    if lei == "8666":
        subitem(doc, f"{k}.1", ["Incumbirá à CONTRATANTE providenciar a publicação deste instrumento, por extrato, no "
                                "Diário Oficial da União, de acordo com o prescrito no artigo 61, parágrafo único, da "
                                "Lei nº 8.666, de 1993."])
    else:
        subitem(doc, f"{k}.1", ["Incumbirá à CONTRATANTE divulgar o presente instrumento no Portal Nacional de "
                                "Contratações Públicas (PNCP), na forma prevista no art. 94 da Lei nº 14.133, de 2021, "
                                "bem como no respectivo sítio oficial na Internet, em atenção ao art. 91, caput, da Lei "
                                "nº 14.133, de 2021, e ao art. 8º, § 2º, da Lei nº 12.527, de 2011, c/c art. 7º, § 3º, "
                                "inciso V, do Decreto nº 7.724, de 2012."])
    # último subitem preso à data e às assinaturas
    subitem(doc, f"{k}.2", ["Para firmeza e validade do pactuado, o presente Termo Aditivo foi lavrado em 2 (duas) vias "
                            "de igual teor, que, depois de lido e achado em ordem, vai assinado pelos contraentes."],
            junto=True, after=10)
    cidade = om.get("cidade") or "Manaus"
    run(par(doc, R, before=6, after=14, junto=True), f"{cidade}, data conforme assinatura digital.")
    run(par(doc, L, after=4, junto=True), "Assinaturas", size=9)

    t = doc.add_table(rows=4, cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    largura = [8.0, 8.0]
    t.autofit = False
    for row in t.rows:
        trPr = row._tr.get_or_add_trPr()
        trPr.append(OxmlElement("w:cantSplit"))
        for i, c in enumerate(row.cells):
            c.width = Cm(largura[i])
    for c, txt in zip(t.rows[0].cells, ("Pela CONTRATANTE", "Pela CONTRATADA")):
        pp = c.paragraphs[0]
        pp.alignment = C
        pp.paragraph_format.keep_with_next = True
        run(pp, txt, size=10)
    rep = (ct.get("representante") or "").upper()
    blocos = [(["Gestor do Contrato"], [rep or "___", "Representante da Empresa"]),
              ([f"Agente de Controle Interno {om.get('artigo') or 'do'} {sigla}"], ["Testemunha de Assinatura"]),
              ([f"Ordenador de Despesas {om.get('artigo') or 'do'} {sigla}"], ["Testemunha de Assinatura"])]
    for i, (esq, dir_) in enumerate(blocos, start=1):
        for col, (c, linhas_) in enumerate(zip(t.rows[i].cells, (esq, dir_))):
            pp = c.paragraphs[0]
            pp.alignment = C
            pp.paragraph_format.space_before = Pt(26)
            pp.paragraph_format.keep_with_next = i < 3
            run(pp, "_" * 34, size=10)
            for j, txt in enumerate(linhas_):
                q = c.add_paragraph()
                q.alignment = C
                q.paragraph_format.space_after = Pt(0)
                q.paragraph_format.keep_with_next = i < 3
                run(q, txt, size=10, bold=(i == 1 and col == 1 and j == 0 and bool(rep)))

    os.makedirs(saida, exist_ok=True)
    caminho = os.path.join(saida, f"Termo Aditivo {n} - CT " + contrato.replace("/", "-") + ".docx")
    doc.save(caminho)
    print("RESUMO – Termo Aditivo (Seção de Contratos)")
    print("  Arquivo:", caminho)
    print(f"  {ordinal(n)} TA nº {numero or '___'} | Lei {'8.666/1993' if lei == '8666' else '14.133/2021'} | "
          f"{'MINUTA (vai para a CJU)' if minuta else 'sem MINUTA (parecer referencial)'} | {cl} cláusulas | valor {brl(novo)}")
    for a in avisos:
        print("  ⚠️", a)
    return caminho


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        gerar(json.load(f), sys.argv[2])
