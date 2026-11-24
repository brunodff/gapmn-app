#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Cobertura do termo aditivo por PARECERES REFERENCIAIS (usado pela Lista e pela Ficha).

Regra do Chefe da SCON (24/11/2026):
- Cada alteração marcada no aditivo (prorrogação, reajuste, acréscimo, supressão) precisa estar
  fundamentada por um parecer referencial VIGENTE. Aparecem tantos pareceres quantos forem necessários,
  cada um com breve explicação (ementa), vigência e o motivo de estar ali (o que ele fundamenta).
- Alteração sem parecer referencial vigente (ex.: acréscimo acima de 25%) → AVISO: o termo aditivo
  vai para análise jurídica (CJU).

dados.json:
  "pareceres_referenciais": [
    {"numero": "PARECER REFERENCIAL n. 00004/2024/CGSEM/SCGP/CGU/AGU",
     "objeto": "Prorrogação do prazo de vigência de contratos de serviços continuados sem DEMO, com ou sem reajuste...",
     "data": "01/11/2024", "validade": "01/11/2028",
     "cobre": ["prorrogacao", "reajuste"],
     "limite_percentual": null},
    {"numero": "PARECER REFERENCIAL Nº. 00006/2025/CONSER/SCGP/CGU/AGU",
     "objeto": "Alteração unilateral quantitativa – acréscimo ou supressão – art. 124, I, b ...",
     "validade": "03/09/2027", "cobre": ["acrescimo", "supressao"], "limite_percentual": 25}
  ]
  (o campo antigo "parecer_referencial" – um só – continua aceito e vale para prorrogação e reajuste)
"""
import datetime

NOMES = {"prorrogacao": "prorrogação de vigência", "reajuste": "reajuste",
         "acrescimo": "acréscimo", "supressao": "supressão"}
COM_ARTIGO = {"prorrogacao": "a prorrogação de vigência", "reajuste": "o reajuste",
              "acrescimo": "o acréscimo", "supressao": "a supressão"}
ORDEM = ["prorrogacao", "reajuste", "acrescimo", "supressao"]
LIMITE_LEI = 25.0   # art. 125 da Lei 14.133/2021 (50% só para reforma de edifício/equipamento)


def _num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return float(str(v).replace("%", "").replace("R$", "").replace(".", "").replace(",", ".").strip())


def _data(s):
    try:
        return datetime.datetime.strptime(s, "%d/%m/%Y").date()
    except (TypeError, ValueError):
        return None


def lista_juntada(itens):
    itens = list(itens)
    if len(itens) <= 1:
        return "".join(itens)
    return ", ".join(itens[:-1]) + " e " + itens[-1]


def alteracoes(d):
    """Alterações marcadas no aditivo, na ordem padrão."""
    ad = d.get("aditivo")
    if ad is None:                      # formato antigo: prorrogação (+ reajuste se marcado)
        alts = ["prorrogacao"] + (["reajuste"] if d.get("reajuste") else [])
        return alts
    return [k for k in ORDEM if ad.get(k)]


def pareceres(d):
    ps = d.get("pareceres_referenciais")
    if ps is None and d.get("parecer_referencial"):
        p = dict(d["parecer_referencial"])
        p.setdefault("cobre", ["prorrogacao", "reajuste"])
        ps = [p]
    return [dict(p) for p in (ps or []) if p and str(p.get("numero", "")).strip()]


def analisar(d, hoje=None):
    hoje = hoje or datetime.date.today()
    alts = alteracoes(d)
    ad = d.get("aditivo") or {}
    vigentes, vencidos = [], []
    for p in pareceres(d):
        dv = _data(p.get("validade"))
        (vencidos if (dv and dv < hoje) else vigentes).append(p)

    cobertura, descobertas = {}, []
    for alt in alts:
        pct = _num((ad.get(alt) or {}).get("percentual")) if alt in ("acrescimo", "supressao") else None
        candidatos = [p for p in vigentes if alt in (p.get("cobre") or [])]
        ok = None
        for p in candidatos:
            lim = _num(p.get("limite_percentual"))
            if lim is None and alt in ("acrescimo", "supressao"):
                lim = LIMITE_LEI
            if pct is not None and lim is not None and pct > lim:
                continue
            ok = p
            break
        if ok:
            cobertura[alt] = ok["numero"]
        else:
            motivo = NOMES[alt]
            if pct is not None and pct > LIMITE_LEI:
                motivo += f" ({pct:.2f}%".replace(".", ",") + f", acima do limite de {LIMITE_LEI:.0f}%)"
            elif any(alt in (p.get("cobre") or []) for p in vencidos):
                venc = [p for p in vencidos if alt in (p.get("cobre") or [])][0]
                motivo += f" (o {venc['numero'].strip()} teve validade até {venc.get('validade')})"
            descobertas.append(motivo)

    usados = []
    for p in vigentes:
        cobre = [a for a in alts if cobertura.get(a) == p["numero"]]
        if not cobre:
            continue
        p["fundamenta"] = cobre
        p["motivo_texto"] = p.get("motivo") or ("Fundamenta " + lista_juntada(COM_ARTIGO[a] for a in cobre) +
                                                " deste termo aditivo.")
        usados.append(p)
    return {"alteracoes": alts, "pareceres": usados, "vencidos": vencidos,
            "descobertas": descobertas, "vai_para_cju": bool(descobertas) or not alts}


def frase_observacao(an):
    """Frase para a Observação da Lista quando alguma alteração não está fundamentada por parecer referencial."""
    if not an["descobertas"]:
        return None
    if not an["pareceres"]:
        base = "não há parecer referencial vigente para este aditivo"
        venc = [p for p in an["vencidos"]]
        if venc and len(an["descobertas"]) == len(an["alteracoes"]) and all("validade até" in x for x in an["descobertas"]):
            p = venc[0]
            return f"{base} (o {p['numero'].strip()} teve validade até {p.get('validade')})"
        return f"{base} ({lista_juntada(an['descobertas'])}); o termo aditivo deve ser submetido à análise jurídica"
    return ("não há parecer referencial vigente que fundamente: " + lista_juntada(an["descobertas"]) +
            "; o termo aditivo deve ser submetido à análise jurídica")


if __name__ == "__main__":
    import json, sys
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    an = analisar(d)
    print(json.dumps({k: v for k, v in an.items()}, ensure_ascii=False, indent=2, default=str))
