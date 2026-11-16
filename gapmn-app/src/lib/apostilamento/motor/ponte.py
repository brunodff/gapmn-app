# -*- coding: utf-8 -*-
"""
Ponte entre o gapmn.app e o motor de reajuste da SCON (gerar_apostilamento.py), rodando no navegador
(Pyodide). O motor fica igual ao da SCON; aqui só entram os dados da configuração do app (Ordenador de
Despesas, Agente de Controle Interno, textos fixos do "I – CONTRATANTE"), os prints da Calculadora e o zip.
"""
import copy
import io
import json
import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gerar_apostilamento as ga  # noqa: E402

_PADRAO = copy.deepcopy(ga.DEFAULTS)


def _aplicar_config(cfg):
    d = copy.deepcopy(_PADRAO)
    cfg = cfg or {}
    for chave in ("ordenador", "aci", "ug_apoio"):
        valores = {k: v for k, v in (cfg.get(chave) or {}).items() if v not in (None, "")}
        d[chave].update(valores)
    if cfg.get("cidade"):
        d["cidade"] = cfg["cidade"]
    ga.DEFAULTS = d
    ga.TEXTOS_FIXOS_OM = {k: v for k, v in (cfg.get("textos_fixos_om") or {}).items() if v}


def _json(x):
    return json.dumps(x, ensure_ascii=False, default=str)


def checar(dados_json, cfg_json):
    _aplicar_config(json.loads(cfg_json))
    q = ga.checar(json.loads(dados_json))
    return _json({"pode_gerar": not any(x["status"] == "FALTA" for x in q), "itens": q})


def gerar(dados_json, cfg_json, prints_json, saida_zip=""):
    """Gera os documentos. Com `saida_zip`, grava o .zip nesse caminho; sem ele, só devolve o resumo."""
    _aplicar_config(json.loads(cfg_json))
    dados = json.loads(dados_json)
    prints = json.loads(prints_json or "[]")
    if prints:
        dados["prints_indice"] = prints
    pasta = tempfile.mkdtemp()
    try:
        r = ga.gerar(dados, pasta, verificar_pdf=False)
    except SystemExit as e:  # o motor usa SystemExit para dado inválido
        raise ValueError(str(e))
    avisos = list(r["avisos"])
    avisos.append("Conferir no Word se a última página do termo não ficou só com as assinaturas "
                  "(no navegador o motor não consegue conferir sozinho).")
    if saida_zip:
        with zipfile.ZipFile(saida_zip, "w", zipfile.ZIP_DEFLATED) as z:
            for caminho in r["arquivos"].values():
                z.write(caminho, os.path.basename(caminho))
            z.writestr("RESUMO.txt", "\n".join([f"{k}: {v}" for k, v in r["resumo"].items()] + ["", "AVISOS:"] + avisos))
    return _json({"resumo": r["resumo"], "avisos": avisos, "arquivos": [os.path.basename(c) for c in r["arquivos"].values()]})
