#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Item 13 da Lista de Verificação: consulta de regularidade (CEIS, CNEP, CNJ e Licitantes
Inidôneos do TCU) do CNPJ da contratada, num ÚNICO PDF:
  1 – Consulta Consolidada de Pessoa Jurídica (TCU) + 2 – certidão de cada cadastro que
  falhou na consolidada (ex.: "Dados do sistema CNJ estão indisponíveis").

Comandos:
  analisar  consolidada.pdf                     → situação de cada cadastro (JSON)
  cnj       CNPJ saida.pdf                      → baixa a certidão do CNJ (automático)
  tcu       CNPJ saida.pdf                      → baixa a consolidada pela API do TCU (JSON + PDF)
  auto      CNPJ saida.pdf [--anexo CADASTRO=arquivo.pdf ...]
            consolidada pela API + CNJ automático se faltar + junção (botão "Consultar automaticamente")
  juntar    saida.pdf consolidada.pdf [complementos.pdf ...]
  completo  CNPJ consolidada.pdf saida.pdf [--anexo CADASTRO=arquivo.pdf ...]
            analisa a consolidada, baixa sozinho o que der (CNJ), usa os anexos do fiscal para
            o resto e junta tudo; lista o que ainda falta.

Cadastros (chaves): tcu_inidoneos, cnj_cnia, ceis, cnep.
Os comandos cnj/tcu/completo precisam de internet (servidor do site ou PC da SCON).
"""
import io, json, re, sys, urllib.parse, urllib.request
import pdfplumber
from pypdf import PdfReader, PdfWriter

UA = {"User-Agent": "Mozilla/5.0 (GAP-MN SCON - consulta de regularidade)"}

FONTES = {
    "tcu_inidoneos": {"orgao": "TCU", "cadastro": "Licitantes Inidôneos",
                      "rotulos": [r"licitantes\s+inid[oô]neos"],
                      "manual": "https://certidoes.apps.tcu.gov.br/lista-inidoneos", "automatico": False, "tipo_api": "Inidôneos"},
    "cnj_cnia": {"orgao": "CNJ", "cadastro": "CNIA – Cadastro Nacional de Condenações Cíveis por Ato de Improbidade "
                                             "Administrativa e Inelegibilidade",
                 "rotulos": [r"cnia", r"improbidade"],
                 "manual": "https://www.cnj.jus.br/improbidade_adm/consultar_requerido.php", "automatico": True, "tipo_api": "CNIA"},
    "ceis": {"orgao": "Portal da Transparência", "cadastro": "CEIS – Cadastro Nacional de Empresas Inidôneas e Suspensas",
             "rotulos": [r"\bceis\b", r"inid[oô]neas\s+e\s+suspensas"],
             "manual": "https://portaldatransparencia.gov.br/sancoes/ceis", "automatico": False, "tipo_api": "CEIS"},
    "cnep": {"orgao": "Portal da Transparência", "cadastro": "CNEP – Cadastro Nacional de Empresas Punidas",
             "rotulos": [r"\bcnep\b", r"empresas\s+punidas"],
             "manual": "https://portaldatransparencia.gov.br/sancoes/cnep", "automatico": False, "tipo_api": "CNEP"},
}
FALHA = r"indispon[ií]ve|n[aã]o\s+foi\s+poss[ií]vel|erro|falha|consultar\s+manualmente|tempo\s+esgotado|timeout"


def digitos(s):
    return re.sub(r"\D", "", s or "")


def cnpj_fmt(c):
    c = digitos(c)
    return f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}"


# ------------------------------------------------------------------ análise da consolidada
def texto_pdf(caminho):
    with pdfplumber.open(caminho) as pdf:
        return "\n".join((p.extract_text() or "") for p in pdf.pages)


def analisar(caminho):
    """Lê o PDF da Consulta Consolidada e devolve a situação de cada cadastro."""
    txt = texto_pdf(caminho)
    low = txt.lower()
    res = {"arquivo": caminho, "cnpj": None, "consulta_em": None, "cadastros": {}, "alertas": []}
    m = re.search(r"cnpj\s*:?\s*([\d./-]{14,18})", low)
    res["cnpj"] = digitos(m.group(1)) if m else None
    m = re.search(r"consulta\s+realizada\s+em\s*:?\s*(\d{2}/\d{2}/\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)", low)
    res["consulta_em"] = m.group(1) if m else None

    # blocos "Órgão Gestor: X  Cadastro: Y  Resultado da consulta: Z"
    blocos = re.split(r"(?=[oó]rg[aã]o\s+gestor\s*:)", low)
    for chave, f in FONTES.items():
        info = {"orgao": f["orgao"], "cadastro": f["cadastro"], "situacao": "nao_encontrado",
                "resultado": None, "manual": f["manual"], "automatico": f["automatico"]}
        for b in blocos:
            if any(re.search(r, b) for r in f["rotulos"]):
                m = re.search(r"resultado\s+da\s+consulta\s*:?\s*([^\n]+)", b)
                val = (m.group(1).strip() if m else b[:200]).strip()
                info["resultado"] = val
                if re.search(FALHA, val) or (not m and re.search(FALHA, b)):
                    info["situacao"] = "indisponivel"
                elif "nada consta" in val:
                    info["situacao"] = "nada_consta"
                elif re.search(r"\bconsta\b", val):
                    info["situacao"] = "consta"
                else:
                    info["situacao"] = "indefinido"
                break
        res["cadastros"][chave] = info
        if info["situacao"] == "consta":
            res["alertas"].append(f"🔴 {f['cadastro']}: CONSTA registro – verificar a sanção antes do aditivo.")
        elif info["situacao"] in ("indisponivel", "nao_encontrado", "indefinido"):
            como = "será buscada automaticamente" if f["automatico"] else "o fiscal precisa anexar"
            res["alertas"].append(f"⚠️ {f['cadastro']}: {info['situacao'].replace('_', ' ')} na consolidada – {como} "
                                  f"({f['manual']}).")
    return res


# ------------------------------------------------------------------ CNJ (automático)
def baixar(url, dados=None):
    req = urllib.request.Request(url, data=dados, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get("content-type", "")


def cnj_certidao(cnpj, saida):
    """Pesquisa o CNPJ no CNIA e baixa a certidão (Negativa se nada encontrado; Positiva se houver registro)."""
    base = "https://www.cnj.jus.br/improbidade_adm/"
    c = digitos(cnpj)
    form = urllib.parse.urlencode({"tipoPessoa": "J", "num_cpf_cnpj": cnpj_fmt(c), "nom_requerido": "",
                                   "hidNumCpfCnpj": c, "hidTipPessoa": "J", "num_registros": "0"}).encode()
    html, _ = baixar(base + "consultar_requerido.php?validar=form", form)
    html = html.decode("latin1", "ignore").lower()
    if "nenhum requerido encontrado" in html:
        tipo, consta = "N", False
    elif "btncertidaopositiva" in html or re.search(digitos(c)[:8], digitos(html)):
        tipo, consta = "P", True
    else:
        tipo, consta = "N", None   # não deu para confirmar pela pesquisa
    pdf, ct = baixar(base + f"certidao.php?tipoCertidao={tipo}&cpfCnpj={c}&tipoPessoa=J")
    if not pdf.startswith(b"%PDF"):
        raise RuntimeError("O CNJ não devolveu um PDF (consulte manualmente).")
    with open(saida, "wb") as f:
        f.write(pdf)
    return {"arquivo": saida, "tipo": "Positiva" if tipo == "P" else "Negativa", "consta": consta}


# ------------------------------------------------------------------ TCU (API conferida em 24/11/2026)
API_TCU = "https://certidoes-apf.apps.tcu.gov.br/api/rest/publico/certidoes/{cnpj}"
# A MESMA URL devolve JSON (Accept: application/json) ou o PDF da consolidada (Accept: application/pdf),
# exatamente como faz o botão "Baixar PDF" do site do TCU (nome: ConsultaConsolidada_<CNPJ>_<d-m-aaaa>.pdf).
# JSON: {cnpj, razaoSocial, nomeFantasia, uf, seCnpjEncontradoNaBaseTcu, certidaoPDF(null), certidoes:[
#   {emissor, tipo: Inidôneos|CNIA|CEIS|CNEP, descricao, situacao: NADA_CONSTA|SISTEMA_INDISPONIVEL|...,
#    observacao, linkConsultaManual, dataHoraEmissao, tempoGeracao}]}


def _tcu_get(cnpj, accept):
    req = urllib.request.Request(API_TCU.format(cnpj=digitos(cnpj)),
                                 headers={**UA, "Accept": accept + ",application/json", "X-Slow-Request": "true"})
    with urllib.request.urlopen(req, timeout=90) as r:
        corpo, ct = r.read(), r.headers.get("content-type", "")
    if b"rejeitada" in corpo[:3000].lower() or "text/html" in ct:
        raise PermissionError("Bloqueado pelo firewall do TCU ('Requisição rejeitada'): usar o fluxo manual "
                              "(abrir o site, Baixar PDF e anexar). Não repetir a chamada.")
    return corpo, ct


def situacao_api(sit):
    sit = (sit or "").upper()
    if sit == "NADA_CONSTA":
        return "nada_consta"
    if "INDISPONIVEL" in sit or "ERRO" in sit or "FALHA" in sit or not sit:
        return "indisponivel"
    if "CONSTA" in sit:
        return "consta"
    return "indefinido"


def analisar_json(j):
    res = {"cnpj": digitos(j.get("cnpj")), "razao_social": j.get("razaoSocial"), "cadastros": {}, "alertas": []}
    por_tipo = {(c.get("tipo") or "").lower(): c for c in j.get("certidoes") or []}
    for chave, f in FONTES.items():
        c = por_tipo.get(f["tipo_api"].lower())
        info = {"orgao": f["orgao"], "cadastro": f["cadastro"], "automatico": f["automatico"],
                "manual": (c or {}).get("linkConsultaManual") or f["manual"],
                "situacao": situacao_api(c.get("situacao")) if c else "nao_encontrado",
                "resultado": (c or {}).get("situacao"), "observacao": (c or {}).get("observacao"),
                "emitido_em": (c or {}).get("dataHoraEmissao")}
        res["cadastros"][chave] = info
        if info["situacao"] == "consta":
            res["alertas"].append(f"🔴 {f['cadastro']}: CONSTA registro – verificar a sanção antes do aditivo.")
        elif info["situacao"] != "nada_consta":
            como = "será buscada automaticamente" if f["automatico"] else "o fiscal precisa anexar"
            res["alertas"].append(f"⚠️ {f['cadastro']}: {info['situacao'].replace('_', ' ')} na consolidada – "
                                  f"{como} ({info['manual']}).")
    return res


def tcu_consolidada(cnpj, saida):
    """UMA chamada JSON + UMA chamada PDF. Se o firewall bloquear, levanta PermissionError (fluxo manual)."""
    corpo, _ = _tcu_get(cnpj, "application/json")
    j = json.loads(corpo)
    pdf, ct = _tcu_get(cnpj, "application/pdf")
    if not pdf.startswith(b"%PDF"):
        raise RuntimeError("O TCU não devolveu o PDF da consolidada: usar o fluxo manual.")
    with open(saida, "wb") as f:
        f.write(pdf)
    return {"arquivo": saida, "json": j, "analise": analisar_json(j)}


def automatico(cnpj, saida, anexos=None):
    """Fluxo do botão 'Consultar automaticamente': consolidada (API) + CNJ se faltar + junção."""
    base = saida[:-4] if saida.lower().endswith(".pdf") else saida
    cons = base + "_consolidada.pdf"
    r = tcu_consolidada(cnpj, cons)
    return completar(cnpj, cons, r["analise"], saida, anexos or {})


# ------------------------------------------------------------------ junção
def juntar(saida, arquivos):
    w = PdfWriter()
    for a in arquivos:
        for p in PdfReader(a).pages:
            w.add_page(p)
    with open(saida, "wb") as f:
        w.write(f)
    return saida


def completo(cnpj, consolidada, saida, anexos):
    """Fluxo manual: o fiscal anexou o PDF da consolidada (lido pelo texto)."""
    return completar(cnpj, consolidada, analisar(consolidada), saida, anexos)


def completar(cnpj, consolidada, an, saida, anexos):
    rel = {"cnpj": digitos(cnpj), "consolidada": consolidada, "complementos": [], "pendentes": [],
           "alertas": list(an["alertas"]), "cadastros": an["cadastros"]}
    if an["cnpj"] and an["cnpj"] != digitos(cnpj):
        rel["alertas"].insert(0, f"🔴 CNPJ da consolidada ({an['cnpj']}) diferente do contrato ({digitos(cnpj)}).")
    partes = [consolidada]
    for chave, info in an["cadastros"].items():
        if info["situacao"] in ("nada_consta", "consta"):
            continue
        if chave in anexos and anexos[chave]:
            partes.append(anexos[chave]); rel["complementos"].append({chave: anexos[chave], "origem": "anexo do fiscal"})
        elif FONTES[chave]["automatico"] and chave == "cnj_cnia":
            try:
                arq = saida.replace(".pdf", "") + "_cnj.pdf"
                r = cnj_certidao(cnpj, arq)
                partes.append(arq); rel["complementos"].append({chave: arq, "origem": f"CNJ automático ({r['tipo']})"})
                if r["consta"]:
                    rel["alertas"].append("🔴 CNJ/CNIA: CONSTA registro – verificar.")
            except Exception as e:
                rel["pendentes"].append({chave: FONTES[chave]["manual"], "motivo": str(e)})
        else:
            rel["pendentes"].append({chave: FONTES[chave]["manual"], "motivo": "anexar a certidão consultada manualmente"})
    juntar(saida, partes)
    rel["arquivo_final"] = saida
    return rel


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        print(__doc__); sys.exit(1)
    cmd = a[0]
    if cmd == "analisar":
        print(json.dumps(analisar(a[1]), ensure_ascii=False, indent=2))
    elif cmd == "cnj":
        print(json.dumps(cnj_certidao(a[1], a[2]), ensure_ascii=False))
    elif cmd == "tcu":
        r = tcu_consolidada(a[1], a[2]); print("PDF salvo em", r["arquivo"])
        print(json.dumps(r["analise"], ensure_ascii=False, indent=2))
    elif cmd == "auto":
        anexos = dict(x.split("=", 1) for x in a[3:] if "=" in x)
        print(json.dumps(automatico(a[1], a[2], anexos), ensure_ascii=False, indent=2))
    elif cmd == "juntar":
        print("Gerado:", juntar(a[1], a[2:]))
    elif cmd == "completo":
        anexos = {}
        for x in a[4:]:
            if x.startswith("--anexo"):
                continue
            if "=" in x:
                k, v = x.split("=", 1); anexos[k] = v
        print(json.dumps(completo(a[1], a[2], a[3], anexos), ensure_ascii=False, indent=2))
    else:
        print(__doc__); sys.exit(1)
