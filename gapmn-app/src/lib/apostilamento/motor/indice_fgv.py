# -*- coding: utf-8 -*-
"""
INCC (FGV) – consulta do acumulado em 12 meses e link para o print do parecer.

O INCC não está na Calculadora do Cidadão. A SCON/GAP-MN usa a página anual da FGV, que traz a tabela
"Qual o valor do INCC-M acumulado em 12 meses?" (colunas: Mês de referência | Evolução Mensal |
Acumulado 12 meses). Busca no Google: "índice INCC FGV <ano>". Exemplo de 2026:
    https://portal.fgv.br/noticias/incc-m-2026

Qual linha usar: a do ÚLTIMO mês do período do reajuste. Pela regra de 12 índices (mês do orçamento
até o mês anterior ao aniversário), esse "Acumulado 12 meses" cobre exatamente o período.
    ex.: orçamento 11/2025 -> período 11/2025 a 10/2026 -> linha "out/26" -> 6,75%

Qual página (ano): a do ano do último mês do período (que é o ano da data-base do reajuste, salvo
aniversário em janeiro). Se a linha não estiver lá, tenta a página do ano seguinte, que também mostra
os meses finais do ano anterior.

O percentual da FGV tem 2 casas e é usado como está (igual ao print).
"""
import re
import unicodedata
from urllib.parse import quote

MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
TITULO_TABELA = "Qual o valor do {var} acumulado em 12 meses"


def eh_fgv(nome_indice):
    """Índices que vêm da FGV (página anual), e não da Calculadora do Cidadão."""
    return str(nome_indice or "").upper().replace(" ", "").startswith("INCC")


def variante(nome_indice):
    n = str(nome_indice or "").upper().replace(" ", "")
    if n.startswith("INCC-DI"):
        return "INCC-DI"
    if n.startswith("INCC-10"):
        return "INCC-10"
    return "INCC-M"                       # "INCC" sem sufixo = INCC-M (página usada pela SCON)


def _mmaaaa(s):
    m, a = s.strip().split("/")
    return int(m), int(a)


def meses_entre(mes_ini, mes_fim):
    mi, ai = _mmaaaa(mes_ini); mf, af = _mmaaaa(mes_fim)
    return (af - ai) * 12 + (mf - mi) + 1


def rotulo(mes):
    """'10/2026' -> 'out/26' (como na tabela da FGV)."""
    m, a = _mmaaaa(mes)
    return f"{MESES[m - 1]}/{a % 100:02d}"


def url_pagina(nome_indice, ano, ancora=True):
    """Página anual da FGV. Com âncora, o navegador já abre rolado na tabela do acumulado (print)."""
    var = variante(nome_indice)
    url = f"https://portal.fgv.br/noticias/{var.lower()}-{ano}"
    if ancora:
        url += "#:~:text=" + quote(TITULO_TABELA.format(var=var))
    return url


def url_google(nome_indice, ano):
    return "https://www.google.com/search?q=" + quote(f"índice {variante(nome_indice).split('-')[0]} FGV {ano}")


def links(nome_indice, mes_ini, mes_fim):
    """Links para o site mostrar no lugar do link da Calculadora do Cidadão."""
    _, af = _mmaaaa(mes_fim)
    return {"fonte": "FGV", "indice": variante(nome_indice), "periodo": f"{mes_ini} a {mes_fim}",
            "linha_tabela": rotulo(mes_fim), "coluna": "Acumulado 12 meses",
            "url_print": url_pagina(nome_indice, af), "url_pagina_ano_seguinte": url_pagina(nome_indice, af + 1),
            "url_google": url_google(nome_indice, af)}


def _texto(html):
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    t = re.sub(r"(?i)<br\s*/?>|</(td|th|tr|p|div|li)>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = t.replace("&nbsp;", " ").replace("&#37;", "%")
    return unicodedata.normalize("NFC", t)


def ler_tabela(html):
    """{'out/26': (0.35, 6.75), ...} a partir do HTML (ou texto) da página anual da FGV."""
    t = re.sub(r"\s+", " ", _texto(html))
    out = {}
    for m in re.finditer(r"\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/(\d{2})\s+(-?\d+,\d+)\s*%\s+(-?\d+,\d+)\s*%",
                         t, re.I):
        k = f"{m.group(1).lower()}/{m.group(2)}"
        out.setdefault(k, (float(m.group(3).replace(",", ".")), float(m.group(4).replace(",", "."))))
    return out


def acumulado_12m(nome_indice, mes_ini, mes_fim, html_por_ano=None, timeout=30):
    """Percentual acumulado em 12 meses no último mês do período, como na tabela da FGV.
    html_por_ano: {ano: html} para testes ou para quando o site já baixou a página.
    Devolve (percentual, url_da_pagina_usada)."""
    if meses_entre(mes_ini, mes_fim) != 12:
        raise ValueError(f"A tabela da FGV dá o acumulado de 12 meses; o período {mes_ini} a {mes_fim} "
                         f"tem {meses_entre(mes_ini, mes_fim)} meses. Informe o percentual manualmente.")
    _, af = _mmaaaa(mes_fim)
    chave = rotulo(mes_fim)
    for ano in (af, af + 1):
        if html_por_ano is not None:
            html = html_por_ano.get(ano)
        else:
            import requests  # requer acesso à internet
            r = requests.get(url_pagina(nome_indice, ano, ancora=False), timeout=timeout,
                             headers={"User-Agent": "Mozilla/5.0"})
            html = r.text if r.ok else None
        if not html:
            continue
        tab = ler_tabela(html)
        if chave in tab:
            return tab[chave][1], url_pagina(nome_indice, ano)
    raise ValueError(f"{variante(nome_indice)} de {chave} ainda não está na tabela da FGV "
                     f"(conferir em {url_google(nome_indice, af)}).")
