#!/usr/bin/env python3
"""
Automação-Aditivos – SCON/GAP-MN
Monta o .zip FINAL do termo aditivo: todos os documentos gerados + os PDFs anexados pelo fiscal
(SICAF, Consulta de regularidade CEIS/CNEP/CNJ/TCU, Pesquisa de Preços, Memória de Cálculo, etc.),
numerados na MESMA ordem da Lista de Verificação.

Uso:  python3 montar_zip.py dados.json pasta_dos_gerados/ saida.zip

dados.json → "anexos": {"sicaf": ["sicaf.pdf"] ou "sicaf.pdf", "consulta_cnpj": "item13.pdf", ...}
  (chaves iguais às da Lista: sicaf, consulta_cnpj, consulta_cpf_socio, pesquisa_precos, memoria_calculo,
   procuracao, exclusividade, vantajosidade, parecer_tecnico, anuencia_consulta, anuencia_resposta, ...)
Vários PDFs na mesma chave são juntados num só (ex.: SICAF nível III + nível IV).

Regra (24/11/2026): o zip leva TUDO o que existir – inclusive o PDF do item 12 (SICAF) e do item 13
(regularidade), que no site também podem ser conferidos no próprio item. O que for obrigatório e não
estiver no zip (nem marcado como NÃO anexado) é listado no fim.
"""
import glob, json, os, re, sys, zipfile, tempfile
from pypdf import PdfReader, PdfWriter

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from gerar_lista_verificacao import itens_da_lista

GERADOS = {   # chave da Lista → início do nome do arquivo gerado pelos scripts
    "disp_orcamentaria": "Declaracao de Disponibilidade Orcamentaria",
    "vantajosidade": "Declaracao de Vantajosidade Economica",
    "mapa_riscos": "Mapa de Riscos",
    "pesquisa_precos": "Pesquisa de Precos",
    "ficha_autorizacao": "Ficha de Autorizacao da Prorrogacao",
    "atestado_adequacao": "Atestado de Adequacao ao Parecer Referencial",
}
NOMES = {
    "anuencia_consulta": "Consulta de anuencia a contratada", "anuencia_resposta": "Resposta de anuencia da contratada",
    "disp_orcamentaria": "Declaracao de Disponibilidade Orcamentaria", "vantajosidade": "Declaracao de Vantajosidade Economica",
    "parecer_tecnico": "Parecer Tecnico", "mapa_riscos": "Mapa de Riscos", "pesquisa_precos": "Pesquisa de Precos",
    "calculadora": "Calculadora do Cidadao", "sicaf": "SICAF", "consulta_cnpj": "Regularidade CEIS-CNEP-CNJ-TCU - CNPJ",
    "consulta_cpf_socio": "Regularidade - CPF do socio", "procuracao": "Procuracao",
    "exclusividade": "Atestado de Exclusividade", "ficha_autorizacao": "Ficha de Autorizacao da Prorrogacao",
    "atestado_adequacao": "Atestado de Adequacao ao Parecer Referencial", "memoria_calculo": "Memoria de Calculo - Reajuste",
}
SEM_ARQUIVO = ("bol_aci", "bol_od", "bol_fiscalizacao")   # lançados no SILOMS
DENTRO_DE_OUTRO = {"calculadora": "parecer_tecnico"}       # print da Calculadora vai dentro do Parecer Técnico


def juntar_pdfs(caminhos, destino):
    w = PdfWriter()
    for c in caminhos:
        for pg in PdfReader(c).pages:
            w.add_page(pg)
    with open(destino, "wb") as f:
        w.write(f)
    return destino


def montar(d, pasta, saida_zip):
    itens = itens_da_lista(d)
    nao = d.get("nao_anexados") or {}
    anexos = d.get("anexos") or {}
    contrato = d.get("contrato", "").replace("/", "-")
    tmp = tempfile.mkdtemp()
    entradas, faltando = [], []

    lista = glob.glob(os.path.join(pasta, "Lista de Verificacao*.docx"))
    if lista:
        entradas.append((lista[0], f"00 - Lista de Verificacao - CT {contrato}.docx"))
    else:
        faltando.append("Lista de Verificação (gerar antes de montar o zip)")

    for n, (chave, trechos) in enumerate(itens, 1):
        base = chave.split("_")[0] if re.match(r"(parecer_referencial|atestado_adequacao)_\d+$", chave) else chave
        nome = NOMES.get(base, base)
        arquivo = None
        if base in GERADOS:
            achados = sorted(glob.glob(os.path.join(pasta, GERADOS[base] + "*")))
            pdfs = [a for a in achados if a.lower().endswith(".pdf")]
            docs = [a for a in achados if a.lower().endswith(".docx")]
            arquivo = (pdfs or docs or [None])[0] if base == "pesquisa_precos" else (docs or pdfs or [None])[0]
        if base in anexos and anexos[base]:
            lst = anexos[base] if isinstance(anexos[base], list) else [anexos[base]]
            lst = [a for a in lst if os.path.exists(a)]
            if lst:
                arquivo = lst[0] if len(lst) == 1 else juntar_pdfs(lst, os.path.join(tmp, f"{base}.pdf"))
        if arquivo:
            ext = os.path.splitext(arquivo)[1]
            entradas.append((arquivo, f"{n:02d} - {nome}{ext}"))
        elif chave.startswith("parecer_referencial"):
            continue                      # o parecer em si não vai no zip (consta na Lista e no atestado)
        elif base in SEM_ARQUIVO or base in DENTRO_DE_OUTRO or chave in nao:
            continue
        else:
            faltando.append(f"item {n} – {nome}")

    os.makedirs(os.path.dirname(os.path.abspath(saida_zip)), exist_ok=True)
    with zipfile.ZipFile(saida_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for origem, nome in entradas:
            z.write(origem, nome)
    print("RESUMO – .zip do termo aditivo")
    print("  Arquivo:", saida_zip)
    for _, nome in entradas:
        print("   ✔", nome)
    for f in faltando:
        print("   ✖ faltando no zip:", f)
    return saida_zip, faltando


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(__doc__); sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        montar(json.load(f), sys.argv[2], sys.argv[3])
