/**
 * pdfParser.js — Parser de Solicitação de Empenho (formato SILOMS)
 *
 * Campos extraídos:
 *   localEntrega   — OM no cabeçalho (ex: QUARTO CENTRO INTEGRADO DE DEFESA...)
 *   solicitacao    — Número da solicitação (ex: 26S0885)
 *   data           — Data (ex: 26/06/2026)
 *   compradora     — OM compradora (ex: GAP-MN)
 *   fornecedorNome — Razão social do fornecedor
 *   fornecedorCnpj — CNPJ do fornecedor
 *   itens[]        — Array de itens (item, requisicao, subelemento, descricao, quant, unid, valorUnit, valorTotal)
 *   pag            — Processo administrativo/licitação (ex: 67615.021461/2025-25)
 *   contrato       — Contrato de referência (ex: DESPESA 010/GAPMN-DA)
 *   licit          — Número da compra quando não há contrato (ex: 90063/2025)
 *   il             — I/L (ex: C26071)
 *   ugCred         — UG Credora (ex: 120094)
 *   codemp         — CODEMP (ex: E974$)
 *   ptres          — PTRES (ex: 229166)
 *   fonte          — Fonte (ex: 1052000140)
 *   pi             — PI (ex: DC060402100)
 *   nd             — ND / Natureza de Despesa (ex: 449051)
 *   total          — Total geral (ex: 200.000,0000)
 *   obs            — Observações
 */

/**
 * Extrai texto de um ArrayBuffer PDF usando PDF.js (ES module).
 * Retorna array de strings, uma por página.
 */
export async function extractPdfText(arrayBuffer) {
  const pdfjsLib = await import(chrome.runtime.getURL('lib/pdf.min.mjs'));
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Agrupa items por linha (coordenada Y arredondada)
    const byLine = {};
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!byLine[y]) byLine[y] = [];
      byLine[y].push({ x: item.transform[4], str: item.str });
    }
    // Ordena linhas de cima para baixo (Y decrescente em PDF)
    const lines = Object.entries(byLine)
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([, items]) =>
        items.sort((a, b) => a.x - b.x).map(i => i.str).join(' ')
      );
    pages.push(lines.join('\n'));
  }

  return pages.join('\n');
}

/**
 * Parseia o texto extraído de uma Solicitação de Empenho do SILOMS.
 * Retorna objeto com todos os campos ou { ok: false, error } se falhar.
 */
export function parseSolicitacaoEmpenho(text) {
  try {
    const t = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');

    // ── Local de Entrega (OM no cabeçalho, linha após "SOLICITAÇÃO DE EMPENHO") ──
    const localEntrega = (() => {
      const m = /SOLICITAÇÃO\s+DE\s+EMPENHO\s*\n([^\n]+)/.exec(t);
      if (m) return m[1].trim();
      // fallback: segunda linha não-vazia
      const lines = t.split('\n').filter(l => l.trim());
      return lines[1]?.trim() ?? '';
    })();

    // ── Fornecedor ──────────────────────────────────────────────────────────────
    const fornecedorNome = (() => {
      const m = /FORNECEDOR\s*\n([^\n]+)/.exec(t);
      return m?.[1]?.trim() ?? '';
    })();

    const fornecedorCnpj = (() => {
      // CNPJ formatado (xx.xxx.xxx/xxxx-xx) ou somente dígitos (14)
      const m = /CNPJ:\s*([\d.\/\-]{14,18}|\d{14})/.exec(t);
      return m?.[1]?.replace(/\D/g, '') ?? '';
    })();

    // ── Compradora / Solicitação / Data ─────────────────────────────────────────
    const compradora = (() => {
      const m = /COMPRADORA\s*\n?([A-Z]{2,}-[A-Z]{2,4})\b/.exec(t)
        ?? /\b(GAP-[A-Z]+|[A-Z]{2,}-[A-Z]{2,4})\s+\d{2}[A-Z]\d{4}/.exec(t);
      return m?.[1]?.trim() ?? '';
    })();

    const solicitacao = (() => {
      // Padrão: dois dígitos + letra + quatro dígitos (ex: 26S0885)
      const m = /\b(\d{2}[A-Z]\d{4})\b/.exec(t);
      return m?.[1] ?? '';
    })();

    const data = (() => {
      const m = /\b(\d{2}\/\d{2}\/\d{4})\b/.exec(t);
      return m?.[1] ?? '';
    })();

    // ── PAG / Contrato / I/L ────────────────────────────────────────────────────
    const pag = (() => {
      const m = /PAG:\s*([\d.\/\-]+)/.exec(t);
      return m?.[1]?.trim() ?? '';
    })();

    // Extrai o texto do campo "Contrato:" da seção financeira
    // IMPORTANTE: usa case-SENSITIVE para evitar pegar "CONTRATO:" dentro da descrição do item
    const _contratoMatch = (() => {
      // Estratégia 1: procura "Contrato:" na mesma linha que "PAG:" (seção financeira)
      const pagLine = /^[^\n]*PAG:[^\n]*/m.exec(t)?.[0] ?? '';
      const m1 = /Contrato:\s*(.+?)(?:\s{2,}|\s+I\/L:|$)/.exec(pagLine);
      if (m1) return m1[1].trim();
      // Estratégia 2: case-SENSITIVE (evita "CONTRATO:" maiúsculo da descrição de item)
      const m2 = /Contrato:\s*(.+?)(?:\s{2,}|\s+I\/L:|[\n])/.exec(t);
      if (m2) return m2[1].trim();
      return '';
    })();

    // Texto do campo Contrato. Com "Contrato:" vazio (solicitação de compra) o
    // regex encosta no rótulo seguinte e captura "I/L: C26009 ..." ou "PAG: ...".
    // Contrato de verdade sempre tem número seguido de barra (ex: 009/GAPMN/2026).
    const contratoRaw = /^[A-Za-zÀ-ú\/ ]{1,12}:/.test(_contratoMatch) || !/\d+\s*\//.test(_contratoMatch)
      ? ''
      : _contratoMatch;

    const contrato = (() => {
      // Remove prefixo "DESPESA " que o SILOMS adiciona
      let raw = contratoRaw.replace(/^DESPESA\s+/i, '').trim();
      // Formata como NNN/ANO para o CONTRATOSGOV (ex: "065/2024")
      const numMatch = /^(\d+)\//.exec(raw);
      if (!numMatch) return raw;
      const numero = numMatch[1];
      // 1) Ano já presente no texto do campo (ex: "065/GAPMN-DACTAIV/2024")
      const yearInRaw = /\/(\d{4})(?:[-\s]|$)/.exec(raw);
      if (yearInRaw) return `${numero}/${yearInRaw[1]}`;
      // 2) Busca no texto completo do PDF: "NNN/SIGLA/AAAA"
      //    (frequentemente em OBS ou na descrição do item)
      const yearAnywhere = new RegExp(`\\b${numero}\\/[A-Z][A-Z0-9\\-]*\\/(\\d{4})\\b`).exec(t);
      if (yearAnywhere) return `${numero}/${yearAnywhere[1]}`;
      // 3) Fallback: ano da data da solicitação (dd/mm/yyyy) — último recurso
      const dataYear = /\/(\d{4})$/.exec(data ?? '');
      if (dataYear) return `${numero}/${dataYear[1]}`;
      return raw;
    })();

    // ── Compra (Licit) ──────────────────────────────────────────────────────────
    // Solicitações de compra trazem "Licit: 90063/2025" em vez de contrato.
    // O rótulo e o número podem cair em linhas diferentes na extração do PDF.
    const licit = (() => {
      const m = /Licit:\s*(\d{4,6}\s*\/\s*\d{4})\b/i.exec(t);
      if (m) return m[1].replace(/\s+/g, '');
      if (!/Licit:/i.test(t)) return '';
      // Número de compra do SIASG: 5 dígitos/ano. Não colide com PAG
      // (67298.002407/2025-11), contrato (009/2026) nem datas (dd/mm/aaaa).
      const f = /(?<![\d.\/])(\d{5}\/\d{4})(?![\d\/-])/.exec(t);
      return f?.[1] ?? '';
    })();

    // Sugestão de modalidade (código do Contratos.gov.br); o usuário confirma na revisão.
    // Compras do SIASG com número iniciado em 90 são pregões.
    const modalidadeSugerida = /^90/.test(licit) ? '05 - Pregão' : '';

    const il = (() => {
      const m = /I\/L:\s*(\S+)/.exec(t);
      return m?.[1]?.trim() ?? '';
    })();

    // ── Crédito ─────────────────────────────────────────────────────────────────
    // Campos preenchidos por dedução (não lidos direto do rótulo) — a revisão
    // marca esses com ⚠ para o usuário conferir.
    const deduzidos = {};

    const ugCred = (() => {
      const m = /UG\s*Cred\.?\s*:?\s*(\d{6})\b/i.exec(t);
      if (m) return m[1];
      const rotulo = /UG\s*Cred/i.exec(t);
      if (!rotulo) return '';
      // A extração do PDF pode separar rótulo e número em linhas distintas (e em
      // qualquer ordem). UGs do Comando da Aeronáutica são 12xxxx: pega a isolada
      // mais próxima do rótulo, ignorando pedaços de CNPJ, PAG, códigos e valores.
      const re = /(?<![\w.\/])(12\d{4})(?![\w\/.,-])/g;
      let melhor = '', dist = Infinity, c;
      while ((c = re.exec(t))) {
        const d = Math.abs(c.index - rotulo.index);
        if (d < dist) { dist = d; melhor = c[1]; }
      }
      if (melhor) deduzidos.ugCred = true;
      return melhor;
    })();

    const codemp = (() => {
      const m = /CODEMP:\s*(\S+)/.exec(t);
      return m?.[1]?.trim() ?? '';
    })();

    // Subelemento: número de 2-3 dígitos que segue o código de requisição (ex: SNT177001AU 91)
    const subelemento = (() => {
      const m = /\b[A-Z]{2,}\d+[A-Z0-9]*\s+(\d{2,3})\b/.exec(t);
      return m?.[1] ?? '';
    })();

    const ptres = (() => {
      const m = /PTRES:\s*(\d+)/.exec(t);
      return m?.[1] ?? '';
    })();

    const fonte = (() => {
      const m = /FONTE:\s*(\d+)/.exec(t);
      return m?.[1] ?? '';
    })();

    const pi = (() => {
      const m = /PI:\s*(\S+)/.exec(t);
      return m?.[1]?.trim() ?? '';
    })();

    const nd = (() => {
      const m = /ND:\s*(\d+)/.exec(t);
      return m?.[1] ?? '';
    })();

    // ── Total ───────────────────────────────────────────────────────────────────
    // Exige formato monetário (11.020,0000): se o valor cair em outra linha, o
    // rótulo sozinho pegaria o primeiro número da linha seguinte (ex: a UG).
    const totalLido = (() => {
      const m = /TOTAL:\s*(\d{1,3}(?:\.\d{3})*,\d{2,4})\b/.exec(t);
      return m?.[1] ?? '';
    })();

    // ── OBS ─────────────────────────────────────────────────────────────────────
    const obs = (() => {
      // Para ao encontrar a página de assinatura digital do SILOMS ("Documento: NÚMERO")
      // ou um rótulo de campo em maiúsculas seguido de dois pontos
      // Não para em palavras em maiúsculas que fazem parte do texto (ex: "CINDACTA IV")
      const m = /OBS:\s*(.+?)(?=\nDocumento:\s*\d|\n[A-Z]{3,}[A-Z\s]*:|$)/s.exec(t);
      return m?.[1]?.trim().replace(/\n+/g, ' ') ?? '';
    })();

    // ── Itens da tabela ─────────────────────────────────────────────────────────
    // Estrutura: REQUISIÇÃO  SUB  DESCRIÇÃO  REF  QUANT  UNID  PRC UNITARIO  PRC TOTAL
    // Linha de item começa com código alfanumérico tipo "SNT177001AU"
    const itens = [];
    // A linha de item começa com a coluna ITEM (nº do item na compra/contrato,
    // ex: 21) seguida da requisição. Ancorar no início da linha evita tomar por
    // requisição o código REF que fecha a linha de continuação da descrição.
    const UNIDADES = String.raw`UN|UN\.|M|M2|M3|KG|L|CX|PC|SV|SC|JG|PT|FD|GL|MO|HR|DI|SE|ME|AN`;
    const CAUDA = String.raw`\s+(\d+)\s+(.+?)\s+([\d,]+)\s+(` + UNIDADES + String.raw`)\s+([\d.,]+)\s+([\d.,]+)`;
    const itemAncorado = new RegExp(String.raw`^[ \t]*(\d{1,5})[ \t]+([A-Z]{2,}\d+[A-Z]*)` + CAUDA, 'gim');
    const itemLivre    = new RegExp(String.raw`()\b([A-Z]{2,}\d+[A-Z]*)` + CAUDA, 'gi');
    const itemRe = itemAncorado.test(t) ? itemAncorado : itemLivre;
    itemRe.lastIndex = 0;
    let m;
    while ((m = itemRe.exec(t)) !== null) {
      itens.push({
        item:         m[1] || '',
        requisicao:   m[2],
        subelemento:  m[3],
        descricao:    m[4].trim(),
        quant:        m[5],
        unid:         m[6],
        valorUnit:    m[7],
        valorTotal:   m[8],
      });
    }

    // Se regex de item não pegou nada, tenta extrair descrição de forma mais genérica
    if (!itens.length) {
      const descM = /(?:DESCRIÇÃO|DESCRICAO)\s*\n(.+?)(?=\nPAG:|\nREF\s|\nQUANT)/si.exec(t);
      if (descM) {
        itens.push({
          requisicao: '', subelemento: '', descricao: descM[1].trim(),
          quant: '', unid: '', valorUnit: '', valorTotal: total,
        });
      }
    }

    // Sem TOTAL legível, soma os itens da tabela
    const total = (() => {
      if (totalLido) return totalLido;
      const soma = itens.reduce((acc, it) =>
        acc + (parseFloat(String(it.valorTotal ?? '').replace(/\./g, '').replace(',', '.')) || 0), 0);
      if (!soma) return '';
      deduzidos.total = true;
      return soma.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    })();

    return {
      ok: true,
      _deduzidos: deduzidos,
      localEntrega,
      solicitacao,
      data,
      compradora,
      fornecedorNome,
      fornecedorCnpj,
      subelemento,
      itens,
      pag,
      contrato,
      contratoRaw,
      licit,
      modalidadeSugerida,
      il,
      ugCred,
      codemp,
      ptres,
      fonte,
      pi,
      nd,
      total,
      obs,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
