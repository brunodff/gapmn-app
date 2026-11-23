# -*- coding: utf-8 -*-
"""
Consulta automática de índices de reajuste no Banco Central (SGS - Sistema Gerenciador de Séries Temporais).

Substitui a digitação manual na Calculadora do Cidadão: busca as variações mensais do índice e
acumula do mês inicial ao mês final (inclusive), que é o mesmo método da Calculadora.

ATENÇÃO
- Validar antes de usar em produção: comparar com a Calculadora do Cidadão.
  Valores de referência já conferidos na Calculadora:
    IPCA 07/2024 a 06/2025 = 5,351170 %
    IPCA 07/2025 a 06/2026 = 4,641330 %
- O parecer técnico exige o PRINT da consulta como anexo. Para isso use `url_calculadora()` e gere
  uma captura da página (ex.: Playwright headless) ou peça ao usuário para anexar o print.
- Índices da FGV que não estão na Calculadora (ex.: INCC) precisam de outra fonte (portal FGV/IBRE).
"""
import requests
from decimal import Decimal, ROUND_HALF_UP

# Códigos SGS das séries mensais (variação % ao mês). Conferir no portal do BCB antes de ampliar a lista.
SERIES_SGS = {
    "IPCA": 433,
    "INPC": 188,
    "IGP-M": 189,
    "IGP-DI": 190,
}

# Códigos usados pela Calculadora do Cidadão (parâmetro selIndice)
CALCULADORA = {
    "IPCA": "00433IPCA", "INPC": "00188INPC", "IGP-M": "28655IGP-M", "IGP-DI": "00190IGP-DI",
    "IPCA-E": "10764IPC-E", "IPC-BRASIL": "00191IPC-BRASIL", "IPC-SP": "00193IPC-SP",
}


def variacoes_mensais(indice, mes_ini, mes_fim):
    """mes_ini / mes_fim no formato 'MM/AAAA'. Retorna lista de (data, variação %)."""
    serie = SERIES_SGS[indice]
    mi, ai = map(int, mes_ini.split("/"))
    mf, af = map(int, mes_fim.split("/"))
    url = (f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{serie}/dados"
           f"?formato=json&dataInicial=01/{mi:02d}/{ai}&dataFinal=28/{mf:02d}/{af}")
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    dados = r.json()
    return [(d["data"], Decimal(d["valor"])) for d in dados]


def acumulado(indice, mes_ini, mes_fim):
    """Percentual acumulado (6 casas), como na Calculadora do Cidadão."""
    vars_ = variacoes_mensais(indice, mes_ini, mes_fim)
    if not vars_:
        raise ValueError("Índice ainda não divulgado para o período.")
    fator = Decimal(1)
    for _, v in vars_:
        fator *= (Decimal(1) + v / Decimal(100))
    pct = (fator - 1) * 100
    return float(pct.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)), len(vars_)


def url_calculadora(indice, mes_ini, mes_fim, valor):
    """Link direto para a Calculadora do Cidadão já preenchida (para print/anexo do parecer)."""
    v = f"{valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("https://www3.bcb.gov.br/CALCIDADAO/publico/corrigirPorIndice.do?method=corrigirPorIndice"
            f"&aba=1&selIndice={CALCULADORA[indice]}&dataInicial={mes_ini}&dataFinal={mes_fim}&valorCorrecao={v}")


if __name__ == "__main__":
    print(url_calculadora("IPCA", "07/2024", "06/2025", 16730.00))
    try:
        print(acumulado("IPCA", "07/2024", "06/2025"), "(esperado 5.35117)")
    except Exception as e:
        print("Sem acesso à API do BCB neste ambiente:", e)
