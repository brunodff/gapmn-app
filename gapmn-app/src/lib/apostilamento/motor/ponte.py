# -*- coding: utf-8 -*-
"""
Ponte entre o gapmn.app e o motor de reajuste da SCON (gerar_apostilamento.py), rodando no navegador
(Pyodide). O motor fica igual ao da SCON; aqui só entram os dados da configuração do app (Ordenador de
Despesas, Agente de Controle Interno, textos fixos do "I – CONTRATANTE"), os prints da consulta do índice,
o checklist do fiscal e o zip.
"""
import copy
import io
import json
import os
import re
import shutil
import sys
import tempfile
import types
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# indice_bcb.py importa o requests, que não existe no navegador. O motor só usa dele o link da Calculadora:
# quem busca o índice (Banco Central e FGV) é o app, em TypeScript.
try:
    import requests  # noqa: F401
except ImportError:
    def _sem_rede(*_a, **_k):
        raise RuntimeError("o motor não acessa a internet no navegador: o app busca o índice")
    _req = types.ModuleType("requests")
    _req.get = _sem_rede
    sys.modules["requests"] = _req

import gerar_apostilamento as ga  # noqa: E402
import checklist as ck  # noqa: E402

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


def _dados_checklist(dados):
    """O checklist é assinado pelo mesmo Agente de Controle Interno do parecer (o do contrato ou o da
    configuração) e diz se o contrato é de despesa ou de receita."""
    d = dict(dados)
    d["aci"] = {**ga.DEFAULTS["aci"], **(dados.get("aci") or {})}
    if not d.get("tipo_contrato"):
        d["tipo_contrato"] = "Receita" if str(dados.get("contrato", "")).upper().startswith("RECEITA") else "Despesa"
    return d


def _nome_checklist(dados):
    """Mesmo nome que o motor dá: "5 - Checklist do Fiscal - CT 001-GAPMN-2024 - 2Apost.docx"."""
    nome = str(dados.get("contrato") or "SEM-NUMERO").replace("/", "-")
    aditivo = str(dados.get("instrumento", "")).lower().startswith("termo aditivo")
    n = dados.get("numero_instrumento")
    inst = (f"{n}TA" if aditivo else f"{n}Apost") if n not in (None, "") else ""
    return f"5 - Checklist do Fiscal - CT {nome}" + (f" - {inst}" if inst else "") + ".docx"


def _quebra_antes(caminho, achar):
    """Põe o parágrafo escolhido no começo de uma página nova: ele e as assinaturas que vêm depois ficam
    juntos na última página. `achar` recebe os textos dos parágrafos e devolve o índice (ou None)."""
    from docx import Document
    doc = Document(caminho)
    i = achar([p.text.strip() for p in doc.paragraphs])
    if i is None:
        return False
    doc.paragraphs[i].paragraph_format.page_break_before = True
    doc.save(caminho)
    return True


def _ultimo_item_clausula_5(textos):
    itens = [i for i, t in enumerate(textos) if re.match(r"5\.\d+\s*[–-]", t)]
    return itens[-1] if itens else None


def _isto_posto(textos):
    return next((i for i, t in enumerate(textos) if t.startswith("Isto posto")), None)


def _paginas_finais(arquivos):
    """Regra do GAP-MN: no Termo, o último item da cláusula 5 abre a última página, junto com as assinaturas;
    no Parecer, o parágrafo "Isto posto" abre a última página, junto com as assinaturas."""
    avisos = []
    if "termo" in arquivos and not _quebra_antes(arquivos["termo"], _ultimo_item_clausula_5):
        avisos.append("Não achei o último item da cláusula 5 no termo: confira a última página no Word.")
    if "parecer" in arquivos and not _quebra_antes(arquivos["parecer"], _isto_posto):
        avisos.append('Não achei o parágrafo "Isto posto" no parecer: confira a última página no Word.')
    return avisos


def _linhas_links(links):
    return [f"{l['n']}º reajuste ({l.get('periodo', '')}) – {l.get('fonte', '')}: {l.get('url_print') or '(sem link)'}"
            + (f"  [linha {l['linha_tabela']}, coluna Acumulado 12 meses]" if l.get("linha_tabela") else "")
            for l in links]


def checar(dados_json, cfg_json):
    _aplicar_config(json.loads(cfg_json))
    q = ga.checar(json.loads(dados_json))
    return _json({"pode_gerar": not any(x["status"] == "FALTA" for x in q), "itens": q})


def gerar(dados_json, cfg_json, prints_json, saida_zip="", checklist_json="", so=""):
    """Gera os documentos. Com `saida_zip`, grava o .zip nesse caminho; sem ele, só devolve o resumo.
    Com `checklist_json` (as 8 marcações SIM/NÃO), o .zip leva também o "5 - Checklist do Fiscal".
    so="fiscal": o .zip sem o Termo de Apostilamento (documento da SCON, revisão 7 de 25/11/2026);
    so="termo": só o Termo de Apostilamento, gravado como .docx em `saida_zip`."""
    _aplicar_config(json.loads(cfg_json))
    dados = json.loads(dados_json)
    dados.pop("checklist", None)  # o checklist sai abaixo, com o ACI do parecer
    marcacoes = json.loads(checklist_json or "null")
    prints = json.loads(prints_json or "[]")
    if prints:
        dados["prints_indice"] = prints
    pasta = tempfile.mkdtemp()
    try:
        r = ga.gerar(dados, pasta, verificar_pdf=False)
    except SystemExit as e:  # o motor usa SystemExit para dado inválido
        raise ValueError(str(e))
    avisos = list(r["avisos"])
    arquivos = dict(r["arquivos"])
    if so == "fiscal":
        arquivos.pop("termo", None)
    if so == "termo":
        if "termo" not in arquivos:
            raise ValueError("Com o instrumento Termo Aditivo, o termo sai na aba Termos Aditivos.")
        arquivos = {"termo": arquivos["termo"]}
        avisos += _paginas_finais(arquivos)
        if saida_zip:
            shutil.copy(arquivos["termo"], saida_zip)
        return _json({"resumo": r["resumo"], "avisos": avisos, "arquivos": [os.path.basename(arquivos["termo"])]})
    if saida_zip:
        avisos += _paginas_finais(arquivos)
    if saida_zip and marcacoes:
        caminho = os.path.join(pasta, _nome_checklist(dados))
        avisos += ["Checklist: " + a for a in ck.gerar_checklist(_dados_checklist(dados), marcacoes, caminho)]
        arquivos["checklist"] = caminho
    if saida_zip:
        links = r["resumo"].get("links_indice") or []
        with zipfile.ZipFile(saida_zip, "w", zipfile.ZIP_DEFLATED) as z:
            for caminho in arquivos.values():
                z.write(caminho, os.path.basename(caminho))
            z.writestr("RESUMO.txt", "\n".join(
                [f"{k}: {v}" for k, v in r["resumo"].items() if k != "links_indice"]
                + ["", "CONSULTA DO ÍNDICE (abrir e tirar o print do parecer):"] + _linhas_links(links)
                + ["", "AVISOS:"] + avisos))
    return _json({"resumo": r["resumo"], "avisos": avisos, "arquivos": [os.path.basename(c) for c in arquivos.values()]})


def checklist(dados_json, cfg_json, marcacoes_json, saida_docx):
    """Só o checklist do fiscal (.docx), para quando os outros documentos já foram gerados."""
    _aplicar_config(json.loads(cfg_json))
    dados = json.loads(dados_json)
    avisos = ck.gerar_checklist(_dados_checklist(dados), json.loads(marcacoes_json or "[]"), saida_docx)
    return _json({"avisos": avisos, "arquivo": _nome_checklist(dados)})
