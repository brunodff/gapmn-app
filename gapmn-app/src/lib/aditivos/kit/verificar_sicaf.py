#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Confere o PDF da consulta "Situação do Fornecedor" do SICAF anexado pelo fiscal.

Uso:  python3 verificar_sicaf.py sicaf.pdf [CNPJ_do_contrato] [dd/mm/aaaa_referencia]
      Sem data de referência, usa a data de emissão do próprio relatório (ou hoje).

O SICAF exige login gov.br (perfil Governo) e captcha nas consultas públicas,
então o PDF é sempre obtido pelo fiscal e anexado. Este script só LÊ o PDF e alerta:
  - CNPJ do relatório diferente do CNPJ do contrato;
  - impedimento de licitar / ocorrências que não sejam "Nada Consta";
  - níveis I e II não cadastrados;
  - certidões do nível III (Receita Federal e PGFN = União, FGTS, Trabalhista) e
    do nível IV (Municipal; Estadual quando houver) vencidas, ausentes ou marcadas com "*".
Critério do item 12 da Lista de Verificação: não impedida; níveis I e II; nível III com
Receita Federal/PGFN, FGTS e Trabalhista válidas; nível IV ao menos com a municipal válida.

Saída: resumo legível + JSON (--json) para o site.
ATENÇÃO: os rótulos foram escritos a partir do leiaute conhecido do relatório do SICAF;
calibrar com um PDF real (ver CALIBRAR abaixo).
"""
import json, re, sys, datetime
import pdfplumber

# CALIBRAR: rótulos como aparecem no relatório (sem acento/maiúsculas, comparação tolerante)
CERTIDOES = [
    # chave, rótulo (regex), nível, obrigatória, é da União?
    # Rótulos conferidos nas telas reais do SICAF em 24/11/2026 ("Comprovante de Regularidade da Receita
    # Federal e PGFN / do FGTS / do TST / Estadual/Distrital / Municipal" + "Data de Validade dd/mm/aaaa")
    # e mantidos os do relatório "Situação do Fornecedor" ("Receita Federal e PGFN Validade: ...").
    ("receita_federal_pgfn", r"receita\s+federal\s+e\s+pgfn", "III", True, True),
    ("fgts", r"\bfgts\b", "III", True, False),
    ("trabalhista", r"trabalhista(?!\s+federal)|\btst\b", "III", True, False),
    ("receita_estadual", r"(?:receita|regularidade)\s+estadual(?:/distrital)?", "IV", False, False),
    ("receita_municipal", r"(?:receita|regularidade)\s+municipal", "IV", True, False),
    ("qualif_economica", r"qualifica[cç][aã]o\s+econ[oô]mico[- ]financeira\s*(?:validade|\n)", "VI", False, False),
]
AVISO_DIAS = 15   # certidão que vence em até 15 dias → aviso amarelo
OCORRENCIAS = [
    ("ocorrencia", r"ocorr[eê]ncia\s*:"),
    ("impedimento_licitar", r"impedimento\s+de\s+licitar\s*:"),
    ("ocorrencias_indiretas", r"ocorr[eê]ncias\s+impeditivas\s+indiretas\s*:"),
]
NIVEIS = [("I", r"\bi\s*[-–]\s*credenciamento"), ("II", r"\bii\s*[-–]\s*habilita[cç][aã]o\s+jur[ií]dica")]
DATA = r"(\d{2}/\d{2}/\d{4})"


def so_digitos(s):
    return re.sub(r"\D", "", s or "")


def ler_texto(caminho):
    if caminho.lower().endswith(".txt"):
        return open(caminho, encoding="utf-8").read()
    with pdfplumber.open(caminho) as pdf:
        return "\n".join((p.extract_text() or "") for p in pdf.pages)


def data(s):
    return datetime.datetime.strptime(s, "%d/%m/%Y").date()


def verificar(caminho, cnpj_contrato=None, ref=None):
    texto = ler_texto(caminho)
    plano = re.sub(r"[ \t]+", " ", texto)
    low = plano.lower()
    res = {"arquivo": caminho, "alertas": [], "certidoes": {}, "ocorrencias": {}, "niveis": {}, "ok": True}

    if len(low.strip()) < 50:
        res["alertas"].append("PDF sem texto legível (imagem/digitalizado): conferir manualmente.")
        res["ok"] = False
        return res
    if "sicaf" not in low:
        res["alertas"].append("O arquivo não parece ser um relatório do SICAF.")
        res["ok"] = False

    # CNPJ
    m = re.search(r"cnpj\s*:?\s*\n?\s*([\d./-]{14,18})", low)
    res["cnpj"] = so_digitos(m.group(1)) if m else None
    if cnpj_contrato:
        if not res["cnpj"]:
            res["alertas"].append("CNPJ não encontrado no relatório.")
        elif res["cnpj"] != so_digitos(cnpj_contrato):
            res["alertas"].append(f"CNPJ do relatório ({res['cnpj']}) diferente do contrato ({so_digitos(cnpj_contrato)}).")
            res["ok"] = False

    # data de referência: informada > emissão do relatório > hoje
    m = re.search(r"emitid[oa]\s+em\s*:?\s*" + DATA, low)
    res["emitido_em"] = m.group(1) if m else None
    if ref:
        dref = data(ref)
    elif res["emitido_em"]:
        dref = data(res["emitido_em"])
    else:
        dref = datetime.date.today()
    res["data_referencia"] = dref.strftime("%d/%m/%Y")
    hoje = datetime.date.today()
    if res["emitido_em"] and (hoje - data(res["emitido_em"])).days > 30:
        res["alertas"].append(f"Relatório emitido em {res['emitido_em']} (mais de 30 dias): emitir um novo.")

    # ocorrências / impedimentos
    for chave, rot in OCORRENCIAS:
        m = re.search(rot + r"\s*([^\n]+)", low)
        val = m.group(1).strip() if m else None
        res["ocorrencias"][chave] = val
        if val is not None and "nada consta" not in val:
            res["alertas"].append(f"{chave.replace('_', ' ').capitalize()}: \"{val}\" – verificar (não é 'Nada Consta').")
            res["ok"] = False
    if res["ocorrencias"].get("impedimento_licitar") is None:
        res["alertas"].append("Linha 'Impedimento de Licitar' não encontrada: conferir manualmente.")

    # níveis I e II
    for nv, rot in NIVEIS:
        res["niveis"][nv] = bool(re.search(rot, low))
        if not res["niveis"][nv]:
            res["alertas"].append(f"Nível {nv} não encontrado no relatório.")
            res["ok"] = False

    # certidões e validades
    todos_rotulos = "|".join("(?:" + c[1] + ")" for c in CERTIDOES)
    for chave, rot, nivel, obrig, uniao in CERTIDOES:
        info = {"nivel": nivel, "obrigatoria": obrig, "validade": None, "situacao": "ausente"}
        for mr in re.finditer(r"(\*?)\s*(?:" + rot + ")", low):
            ini = mr.end()
            prox = re.search(todos_rotulos, low[ini:ini + 400])
            trecho = low[ini: ini + (prox.start() if prox else 400)]
            m = re.search(r"validade\s*:?\s*(\*?)\s*" + DATA + r"\s*(\*?)", trecho)
            if m:
                info["validade"] = m.group(2)
                vencida = data(m.group(2)) < dref or "*" in (mr.group(1) + m.group(1) + m.group(3))
                info["situacao"] = "vencida" if vencida else "valida"
                if not vencida:
                    info["dias_para_vencer"] = (data(m.group(2)) - dref).days
                break
        res["certidoes"][chave] = info
        nome = {"receita_federal_pgfn": "Receita Federal e PGFN (União)", "fgts": "FGTS", "trabalhista": "Trabalhista",
                "receita_estadual": "Receita Estadual/Distrital", "receita_municipal": "Receita Municipal",
                "qualif_economica": "Qualificação Econômico-Financeira"}[chave]
        if info["situacao"] == "vencida" and (obrig or chave == "receita_estadual"):
            destaque = "🔴 UNIÃO – " if uniao else ""
            res["alertas"].append(f"{destaque}{nome} VENCIDA (validade {info['validade']}).")
            res["ok"] = False
        elif info["situacao"] == "valida" and info.get("dias_para_vencer", 999) <= AVISO_DIAS and (obrig or chave == "receita_estadual"):
            res["alertas"].append(f"🟡 {nome} vence em {info['dias_para_vencer']} dia(s) ({info['validade']}): "
                                  "conferir de novo antes da assinatura do termo aditivo.")
        elif info["situacao"] == "ausente" and obrig:
            destaque = "🔴 UNIÃO – " if uniao else ""
            res["alertas"].append(f"{destaque}{nome} não encontrada no relatório.")
            res["ok"] = False

    for m in re.finditer(r"situa[cç][aã]o\s+do\s+n[ií]vel\s+(iii|iv|vi|ii|v|i)\b\s*\n?\s*([^\n]+)", low):
        if "pend" in m.group(2):
            res["alertas"].append(f"Nível {m.group(1).upper()}: \"{m.group(2).strip()}\" no SICAF – conferir.")
            res["ok"] = False
    if re.search(r"assinalad[oa]s?\s+com\s+\"?\*\"?", low) and not any(
            c["situacao"] == "vencida" for c in res["certidoes"].values()):
        res["alertas"].append("O relatório indica documento assinalado com '*' (vencido): conferir.")
        res["ok"] = False
    return res


def imprimir(res):
    print("RESUMO – SICAF (Situação do Fornecedor)")
    print("  Arquivo:", res["arquivo"])
    print("  CNPJ:", res.get("cnpj"), "| emitido em:", res.get("emitido_em"), "| referência:", res.get("data_referencia"))
    for k, c in res["certidoes"].items():
        print(f"    {k:<22} nível {c['nivel']:<3} {c['situacao']:<8} {c['validade'] or ''}")
    if res["alertas"]:
        for a in res["alertas"]:
            print("  ⚠️", a)
    print("  RESULTADO:", "OK – atende ao item 12" if res["ok"] else "PENDÊNCIAS – ver alertas")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--json"]
    if not args:
        print(__doc__); sys.exit(1)
    r = verificar(args[0], args[1] if len(args) > 1 else None, args[2] if len(args) > 2 else None)
    if "--json" in sys.argv:
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        imprimir(r)
