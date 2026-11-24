"""
Ponte entre o gapmn.app e o kit de Termos Aditivos da SCON (src/lib/aditivos/kit, importado sem mudanças por
scripts/aditivos/importar_kit.mjs). Roda no navegador (Pyodide) e também no CPython, para os testes.

Faz o papel do gerar_aditivo.py do kit (que chama os outros scripts por subprocesso, o que o navegador não tem):
roda cada gerador que se aplica ao caso, guarda o que cada um escreveu (RESUMO, erros, avisos) e junta tudo num .zip.
O SICAF e a Consulta Consolidada chegam como TEXTO (o app lê o PDF com o pdf.js): o kit lê .txt sem o pdfplumber.
"""
import contextlib, copy, importlib, io, json, os, shutil, sys, tempfile, types, zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.join(AQUI, "kit")
if KIT not in sys.path:
    sys.path.insert(0, KIT)

# o pdfplumber não roda no Pyodide; o kit só o usa para ler PDF, e aqui ele recebe texto
try:
    import pdfplumber  # noqa: F401
except ImportError:
    sys.modules["pdfplumber"] = types.ModuleType("pdfplumber")

DOCUMENTOS = [
    ("lista", "Lista de Verificação", "gerar_lista_verificacao"),
    ("declaracao", "Declaração de Disponibilidade Orçamentária", "gerar_declaracao_orcamentaria"),
    ("mapa", "Mapa de Riscos", "gerar_mapa_riscos"),
    ("pesquisa", "Pesquisa de Preços", "gerar_pesquisa_precos"),
    ("ficha", "Ficha para Autorização da Prorrogação", "gerar_ficha_autorizacao"),
]


def _linhas(texto, marca):
    return [l.strip()[len(marca):].strip() for l in texto.splitlines() if l.strip().startswith(marca)]


def _rodar(modulo, d, saida):
    """Roda o gerar() de um script do kit; erro de validação do kit = SystemExit(1) com a lista de ERROS."""
    out = io.StringIO()
    antes = set(os.listdir(saida))
    ok = True
    with contextlib.redirect_stdout(out):
        try:
            importlib.import_module(modulo).gerar(copy.deepcopy(d), saida)
        except SystemExit as e:
            ok = e.code in (0, None)
        except Exception as e:  # erro inesperado do script: vira mensagem, não derruba os outros documentos
            ok = False
            print("❌ " + type(e).__name__ + ": " + str(e))
    texto = out.getvalue()
    novos = sorted(set(os.listdir(saida)) - antes)
    return {"ok": ok and bool(novos), "arquivos": novos, "saida": texto,
            "erros": _linhas(texto, "❌"), "avisos": _linhas(texto, "⚠️")}


def aplicaveis(d):
    """Os documentos que se aplicam ao caso (a mesma regra do gerar_aditivo.py do kit)."""
    from gerar_lista_verificacao import passa_1_milhao
    chaves = ["lista", "declaracao"]
    if d.get("riscos"):
        chaves.append("mapa")
    if d.get("pesquisa_precos"):
        chaves.append("pesquisa")
    if passa_1_milhao(d):
        chaves.append("ficha")
    return chaves


def conferir(dados_json):
    """Sem gerar: pareceres, itens da Lista, objeto e valores da Ficha e os documentos que se aplicam."""
    d = json.loads(dados_json)
    import pareceres
    from gerar_lista_verificacao import itens_da_lista, passa_1_milhao, tem_reajuste
    from gerar_ficha_autorizacao import objeto_e_valores
    an = pareceres.analisar(d)
    erros, avisos = [], []
    objeto, atual, novo = objeto_e_valores(copy.deepcopy(d), erros, avisos)
    itens = [{"chave": c, "texto": "".join(t for t, _, _ in trechos)} for c, trechos in itens_da_lista(copy.deepcopy(d))]
    return json.dumps({
        "pareceres": an, "observacao_parecer": pareceres.frase_observacao(an), "itens": itens,
        "objeto": objeto, "valor_atual": atual, "valor_novo": novo, "erros_ficha": erros, "avisos_ficha": avisos,
        "passa_1_milhao": passa_1_milhao(d), "tem_reajuste": tem_reajuste(d), "documentos": aplicaveis(d),
    }, ensure_ascii=False, default=str)


def gerar(dados_json, destino_zip, extras_json="[]"):
    """Gera os documentos que se aplicam e junta no .zip os extras (item 13, SICAF, memória de cálculo…).
    extras: [{"caminho": "/tmp/x.pdf", "nome": "nome no zip"}]. Devolve o resultado de cada documento."""
    d = json.loads(dados_json)
    extras = json.loads(extras_json or "[]")
    saida = tempfile.mkdtemp(prefix="aditivo_")
    try:
        resultados = {}
        for chave, nome, modulo in DOCUMENTOS:
            if chave in aplicaveis(d):
                r = _rodar(modulo, d, saida)
                r["nome"] = nome
                resultados[chave] = r
        arquivos = []
        if destino_zip:
            with zipfile.ZipFile(destino_zip, "w", zipfile.ZIP_DEFLATED) as z:
                for nome in sorted(os.listdir(saida)):
                    z.write(os.path.join(saida, nome), nome)
                    arquivos.append(nome)
                for x in extras:
                    if os.path.exists(x["caminho"]):
                        z.write(x["caminho"], x["nome"])
                        arquivos.append(x["nome"])
        return json.dumps({"documentos": resultados, "arquivos": arquivos}, ensure_ascii=False, default=str)
    finally:
        shutil.rmtree(saida, ignore_errors=True)


def sicaf(texto, cnpj, referencia=""):
    """Confere o SICAF (verificar_sicaf.py do kit) a partir do texto do PDF."""
    import verificar_sicaf
    caminho = os.path.join(tempfile.gettempdir(), "sicaf.txt")
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(texto)
    r = verificar_sicaf.verificar(caminho, cnpj or None, referencia or None)
    r["arquivo"] = "SICAF (PDF anexado)"
    return json.dumps(r, ensure_ascii=False, default=str)


def consolidada_texto(texto):
    """Situação de cada cadastro (TCU, CNJ, CEIS, CNEP) pelo texto do PDF da Consulta Consolidada."""
    import consultar_regularidade as cr
    caminho = os.path.join(tempfile.gettempdir(), "consolidada.txt")
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(texto)
    original = cr.texto_pdf
    cr.texto_pdf = lambda c: open(c, encoding="utf-8").read()
    try:
        r = cr.analisar(caminho)
    finally:
        cr.texto_pdf = original
    r["arquivo"] = "Consulta Consolidada (PDF anexado)"
    return json.dumps(r, ensure_ascii=False, default=str)


def consolidada_json(json_str):
    """Situação de cada cadastro pelo JSON da API do TCU."""
    import consultar_regularidade as cr
    return json.dumps(cr.analisar_json(json.loads(json_str)), ensure_ascii=False, default=str)


def juntar(caminhos_json, destino):
    """Item 13: um PDF só (consolidada + certidões que faltaram), na ordem recebida."""
    import consultar_regularidade as cr
    cr.juntar(destino, json.loads(caminhos_json))
    return destino
