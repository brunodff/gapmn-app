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
      // Nome da OM no cabeçalho (antes da tabela de itens). No layout de julho a
      // linha depois de "SOLICITAÇÃO DE EMPENHO" é "COMPRADORA DATA NÚMERO".
      const cabecalho = t.split(/ITEM\s+REQUISI/)[0].split('\n').map(l => l.trim()).filter(Boolean);
      const om = cabecalho.find(l => !l.includes(':') &&
        /\b(BASE A[ÉE]REA|HOSPITAL|GRUPAMENTO|COMANDO|CENTRO|ESQUADR[ÃA]O|DESTACAMENTO|PREFEITURA|SERVI[ÇC]O REGIONAL|PARQUE|BATALH[ÃA]O|ESCOLA|INSTITUTO|ACADEMIA|CINDACTA|DEP[ÓO]SITO|DIRETORIA|GABINETE|ALA \d)/i.test(l) &&
        !/\b(LTDA|EIRELI|S\/A|EPP|COM[ÉE]RCIO|IMPORTA|ENGENHARIA)\b/i.test(l));
      if (om) return om;
      const m = /SOLICITAÇÃO\s+DE\s+EMPENHO\s*\n([^\n]+)/.exec(t);
      if (m) return m[1].trim();
      // fallback: segunda linha não-vazia
      const lines = t.split('\n').filter(l => l.trim());
      return lines[1]?.trim() ?? '';
    })();

    // ── Fornecedor ──────────────────────────────────────────────────────────────
    // Primeira linha com nome depois de "FORNECEDOR" — no layout de julho a linha
    // logo abaixo é "CNPJ: 505…" e o nome vem depois
    const fornecedorNome = (() => {
      const m = /FORNECEDOR\s*\n((?:[^\n]*\n?){0,4})/.exec(t);
      const linhas = (m?.[1] ?? '').split('\n').map(l => l.trim()).filter(Boolean);
      // Nome de MEI começa com a raiz do CNPJ ("25.283.883 ERICA…"): dígito no início vale
      return linhas.find(l => !/^(CNPJ|CPF|SOLICITA|COMPRADORA|TELEFONE|ITEM)\b/i.test(l) &&
        !/^\d{2}\/\d{2}\/\d{4}/.test(l) && !/\b\d{2}[A-Z]\d{4}\b/.test(l) && /[A-Za-zÀ-ú]{3}/.test(l)) ?? '';
    })();

    const fornecedorCnpj = (() => {
      // O cabeçalho pode trazer o CNPJ da OM compradora (Comando da Aeronáutica,
      // raiz 00.394.429) antes do fornecedor: o primeiro "CNPJ:" do texto não serve.
      const RAIZ_COMAER = '00394429';
      const valido = c => {
        if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
        const dv = n => {
          let s = 0, p = n - 7;
          for (let i = 0; i < n; i++) { s += +c[i] * p--; if (p < 2) p = 9; }
          return s % 11 < 2 ? 0 : 11 - (s % 11);
        };
        return dv(12) === +c[12] && dv(13) === +c[13];
      };
      const doFornecedor = c => c.length === 14 && !c.startsWith(RAIZ_COMAER);
      // 1) Logo depois de um rótulo "CNPJ:" (formatado ou só dígitos)
      const rotulados = [];
      const re = /CNPJ:\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/g;
      for (let m; (m = re.exec(t)) !== null;) rotulados.push({ c: m[1].replace(/\D/g, ''), pos: m.index });
      let lista = rotulados.filter(a => doFornecedor(a.c));
      // 2) Rótulo e número separados pela extração do PDF: qualquer CNPJ válido do texto
      if (!lista.length) {
        const solto = /(?<![\d.\/])(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})(?![\d.\/-])/g;
        for (let m; (m = solto.exec(t)) !== null;) {
          const c = m[1].replace(/\D/g, '');
          if (doFornecedor(c) && valido(c)) lista.push({ c, pos: m.index });
        }
      }
      if (lista.length <= 1) return lista[0]?.c ?? '';
      // Vários: o primeiro depois do rótulo FORNECEDOR
      const forn = t.search(/FORNECEDOR/);
      return (lista.find(a => a.pos > forn) ?? lista[0]).c;
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

    // Ano do contrato. O campo "Contrato:" costuma vir cortado ("028/GAPMN-BA");
    // o número completo aparece na descrição ou na OBS, às vezes quebrado em duas
    // linhas pelo PDF ("…028/GAPMN-BA" + "MN/2024."), com os valores do item no meio.
    let contratoSemAno = false;
    const contrato = (() => {
      // Remove prefixo "DESPESA " que o SILOMS adiciona
      let raw = contratoRaw.replace(/^DESPESA\s+/i, '').trim();
      // Formata como NNN/ANO para o CONTRATOSGOV (ex: "065/2024")
      const numMatch = /^(\d+)\//.exec(raw);
      if (!numMatch) return raw;
      const numero = numMatch[1];
      const anoMax = new Date().getFullYear() + 1;
      const plausivel = a => +a >= 2000 && +a <= anoMax;
      // 1) Ano no próprio campo (ex: "065/GAPMN-DACTAIV/2024")
      const noCampo = /\/(\d{4})(?:[-\s]|$)/.exec(raw);
      if (noCampo && plausivel(noCampo[1])) return `${numero}/${noCampo[1]}`;
      // 2) Outras menções do número no texto (linhas emendadas). Depois de "NNN/",
      //    o ano é o primeiro "/AAAA" logo após letras (fim da sigla: "MN/2024") ou
      //    colado ao número ("028/2024"). Datas e PAG têm dígitos antes da barra e
      //    o PAG ainda tem "-19" depois — não casam.
      const emendado = t.replace(/\s*\n\s*/g, ' ');
      const n = String(parseInt(numero, 10));
      const mencao = new RegExp(String.raw`(?<![\d./])0*${n}\/`, 'g');
      const posCampo = emendado.search(/Contrato:/);   // rótulo do campo (case-sensitive)
      const anos = [];
      for (let m; (m = mencao.exec(emendado)) !== null;) {
        const depois = emendado.slice(m.index + m[0].length, m.index + m[0].length + 160);
        const a = /^((?:19|20)\d{2})(?![\d-])/.exec(depois) ?? /[A-Za-z]\/((?:19|20)\d{2})(?![\d-])/.exec(depois);
        const doCampo = posCampo >= 0 && m.index > posCampo && m.index - posCampo < 30;
        if (a && plausivel(a[1])) anos.push({ ano: a[1], doCampo });
      }
      // Descrição/OBS antes do campo "Contrato:" (que é o cortado)
      const achado = anos.find(x => !x.doCampo) ?? anos[0];
      if (achado) return `${numero}/${achado.ano}`;
      // 3) Sem o ano no PDF: só o número — o robô escolhe o contrato pelo CNPJ do
      //    fornecedor (nunca o ano da data da solicitação, que errava o contrato)
      contratoSemAno = true;
      return numero;
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

    // ── Crédito ─────────────────────────────────────────────────────────────────
    // Campos preenchidos por dedução (não lidos direto do rótulo) — a revisão
    // marca esses com ⚠ para o usuário conferir.
    const deduzidos = {};
    if (contratoSemAno) deduzidos.contrato = true;   // ano não achado: revisão marca ⚠

    // Formato de cada campo. O valor vem logo depois do rótulo, NA MESMA LINHA:
    // atravessar a quebra (\s*) pegava o que vinha embaixo — no layout de julho,
    // PI "J367$" (era o CODEMP) e CODEMP "FONTE:".
    const FORMATO = {
      ND:     String.raw`[34]\d{5}`,
      PTRES:  String.raw`\d{6}`,
      FONTE:  String.raw`\d{10}`,
      PI:     String.raw`(?=[A-Z0-9]*[A-Z])[A-Z0-9]{4,11}`,
      CODEMP: String.raw`[A-Z0-9]{2,8}\$`,
      'I/L':  String.raw`[A-Z]\d{4,6}`,
    };
    // Na mesma linha do rótulo vale qualquer valor do tipo (como antes); os
    // formatos estritos acima só servem para casar valores soltos
    const NA_LINHA = { ND: String.raw`\d+`, PTRES: String.raw`\d+`, FONTE: String.raw`\d+`, PI: String.raw`[A-Z0-9][\w-]*`, CODEMP: String.raw`[^\s:]+`, 'I/L': String.raw`[^\s:]+` };
    const naLinha = rotulo => {
      const m = new RegExp(String.raw`${rotulo.replace('/', '\\/')}:[ \t]*(${NA_LINHA[rotulo]})(?![\w$:])`).exec(t);
      return m?.[1] ?? '';
    };
    // Layout com os rótulos sozinhos numa linha ("ND: PTRES: PI:") e os valores
    // numa linha próxima, na mesma ordem ("339030 214537 CG190904100")
    const soltos = (() => {
      const r = {};
      const linhas = t.split('\n').map(l => l.trim());
      const RX_ROT = /(ND|PTRES|PI|FONTE|CODEMP|I\/L):/g;
      linhas.forEach((l, i) => {
        const rotulos = [...l.matchAll(RX_ROT)].map(m => m[1]);
        if (!rotulos.length) return;
        // só rótulos (sem valores) nesta linha
        if (l.replace(/(ND|PTRES|PI|FONTE|CODEMP|I\/L|UG\s*Cred|Licit|Contrato|PAG|TOTAL):?/g, '').trim()) return;
        for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
          const toks = linhas[j].split(/\s+/).filter(Boolean);
          if (toks.length !== rotulos.length) continue;
          if (rotulos.every((rot, k) => new RegExp(`^(?:${FORMATO[rot]})$`).test(toks[k]))) {
            rotulos.forEach((rot, k) => { if (!r[rot]) r[rot] = toks[k]; });
            break;
          }
        }
      });
      return r;
    })();
    const campo = rotulo => {
      const v = naLinha(rotulo);
      if (v) return v;
      if (soltos[rotulo] && ['ND', 'PTRES', 'FONTE', 'PI'].includes(rotulo)) deduzidos.credito = true;
      return soltos[rotulo] ?? '';
    };

    // I/L: no rótulo; senão o código "C26006" solto no texto
    const il = campo('I/L') || (/(?<![\w\/])([A-Z]\d{5})(?![\w\/])/.exec(t)?.[1] ?? '');

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

    const codemp = campo('CODEMP');

    // Subelemento: número de 2-3 dígitos que segue o código de requisição (ex: SNT177001AU 91)
    const subelemento = (() => {
      const m = /\b[A-Z]{2,}\d+[A-Z0-9]*\s+(\d{2,3})\b/.exec(t);
      return m?.[1] ?? '';
    })();

    const ptres = campo('PTRES');
    const fonte = campo('FONTE');
    const pi    = campo('PI');
    const nd    = campo('ND');

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
    // A linha de item começa com a coluna ITEM (nº do item na compra/contrato,
    // ex: 21) seguida da requisição. Ancorar no início da linha evita tomar por
    // requisição o código REF que fecha a linha de continuação da descrição.
    // A descrição pode vir vazia na linha (contrato: "BMT274013AU 16 1,00 UN 12030,50
    // 12.030,5000", com a descrição na linha de cima).
    const UNIDADES = String.raw`UN|UN\.|M|M2|M3|KG|L|CX|PC|SV|SC|JG|PT|FD|GL|MO|HR|DI|SE|ME|AN`;
    const CAUDA = String.raw`\s+(\d+)\s+(?:(.+?)\s+)?([\d,]+)\s+(` + UNIDADES + String.raw`)\s+([\d.,]+)\s+([\d.,]+)`;
    const itemAncorado = new RegExp(String.raw`^[ \t]*(\d{1,5})[ \t]+([A-Z]{2,}\d+[A-Z]*)` + CAUDA, 'gim');
    const itemLivre    = new RegExp(String.raw`()\b([A-Z]{2,}\d+[A-Z]*)` + CAUDA, 'gi');
    // Formato mais livre, só quando os de cima não acham nada: unidade qualquer
    // (MES, MÊS, UNID, SERV…), quantidade com milhar e totais com centavos.
    const UNID_LIVRE = String.raw`[A-ZÀ-Ú][A-ZÀ-Ú0-9²³]{0,5}\.?`;
    const CAUDA_LIVRE = String.raw`\s+(\d+)\s+(?:(.+?)\s+)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,5})?)\s+(` + UNID_LIVRE +
      String.raw`)\s+(\d[\d.]*,\d{2,5}|\d+)\s+(\d{1,3}(?:\.\d{3})*,\d{2,4})(?![\d,])`;
    const itemAncoradoAmplo = new RegExp(String.raw`^[ \t]*(\d{1,5})[ \t]+([A-Z]{2,}\d+[A-Z]*)` + CAUDA_LIVRE, 'gm');
    const itemLivreAmplo    = new RegExp(String.raw`()\b([A-Z]{2,}\d+[A-Z]*)` + CAUDA_LIVRE, 'g');

    // Sem descrição na linha do item, usa a linha de cima (se não for o cabeçalho
    // da tabela nem outra linha de item)
    const linhaAcima = pos => {
      const antes = t.slice(0, pos).replace(/\n[^\n]*$/, '');
      const linha = (/[^\n]*$/.exec(antes)?.[0] ?? '').trim();
      return /REQUISI|PRC\s+UNIT|Ref\.?\s+a\s+REQ|,\d{4}\s*$/i.test(linha) ? '' : linha;
    };
    const coletar = re => {
      const lista = [];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t)) !== null) {
        lista.push({
          item:         m[1] || '',
          requisicao:   m[2],
          subelemento:  m[3],
          descricao:    (m[4] ?? '').trim() || linhaAcima(m.index + m[0].search(/\S/)),
          quant:        m[5],
          unid:         m[6],
          valorUnit:    m[7],
          valorTotal:   m[8],
        });
      }
      return lista;
    };
    // Layout com a descrição antes do nº do item e o subelemento colado à requisição:
    // "LUVA … CAIXA 164 OLT198002SA10 OLR333164SA 50,00 CX 23,38 1.169,0000"
    const itemInvertido = new RegExp(String.raw`^(.*?)\s(\d{1,5})\s+([A-Z]{2,}\d+[A-Z]+)(\d{2,3})\s+(\S+)\s+(\d{1,3}(?:\.\d{3})*(?:,\d{1,5})?)\s+(` +
      UNID_LIVRE + String.raw`)\s+(\d[\d.]*,\d{2,5}|\d+)\s+(\d{1,3}(?:\.\d{3})*,\d{2,4})(?![\d,])`, 'gm');
    const coletarInvertido = () => {
      const lista = [];
      itemInvertido.lastIndex = 0;
      let m;
      while ((m = itemInvertido.exec(t)) !== null) {
        lista.push({
          item: m[2], requisicao: m[3], subelemento: m[4], descricao: m[1].trim(),
          quant: m[6], unid: m[7], valorUnit: m[8], valorTotal: m[9],
        });
      }
      return lista;
    };

    let itens = coletar(itemAncorado.test(t) ? itemAncorado : itemLivre);
    if (!itens.length) itens = coletar(itemAncoradoAmplo);
    if (!itens.length) itens = coletar(itemLivreAmplo);
    if (!itens.length) itens = coletarInvertido();

    // "ITEM 14 - 12.030,50 - Ref a REQ:BMT274013AU": nº do item no contrato numa
    // linha à parte, com a coluna ITEM da tabela vazia. Liga pela requisição (e
    // pelo valor, se a mesma requisição tiver mais de um item).
    const refs = [];
    const reRef = /\bITEM\s+(\d{1,5})\s*[-–:]\s*(\d[\d.]*,\d{2,4})\s*[-–]\s*Ref\.?\s+a\s+REQ\.?\s*:?\s*([A-Z]{2,}\d+[A-Z0-9]*)/gi;
    for (let m; (m = reRef.exec(t)) !== null;) refs.push({ item: m[1], valor: m[2], req: m[3].toUpperCase(), usado: false });
    const centavos = v => Math.round((parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0) * 100);
    for (const it of itens) {
      if (it.item) continue;
      const req = String(it.requisicao ?? '').toUpperCase();
      const livres = refs.filter(r => !r.usado && (r.req === req || req.startsWith(r.req) || r.req.startsWith(req)));
      const ref = livres.find(r => centavos(r.valor) === centavos(it.valorTotal)) ?? livres[0];
      if (ref) { it.item = ref.item; ref.usado = true; }
    }
    // Nenhuma linha de item legível, mas há essas referências: monta os itens por elas
    if (!itens.length) {
      itens = refs.map(r => ({
        item: r.item, requisicao: r.req, subelemento: '', descricao: '',
        quant: '', unid: '', valorUnit: '', valorTotal: r.valor,
      }));
    }
    // Itens descritos DENTRO da descrição de uma linha da tabela (às vezes em várias
    // páginas): "CONTRATO 045/GAP-MN/2025 ITEM 42: FRUTA…; VALOR UNITÁRIO: R$ 10,70;
    // QUANTIDADE: 500KG; VALOR TOTAL: R$ 5.350,00.ITEM 46: …". Cada "ITEM n:" abre
    // um trecho até o próximo; a soma dos itens tem de dar o TOTAL (a revisão confere).
    let itensDaDescricao = false;
    const naDescricao = (() => {
      const corrido = t.replace(/\s*\n\s*/g, ' ');
      // "ITEM" pode vir colado ao ano do contrato ("045/GAP-MN/2025ITEM 07:"): vale
      // qualquer coisa antes, menos letra (SUBITEM)
      const marcas = [...corrido.matchAll(/(?<![A-Za-zÀ-ú])I\s?TEM\s+(\d{1,5})\s*:/gi)];
      const valorBR = s => parseFloat(String(s ?? '').replace(/\./g, '').replace(',', '.'));
      // Linha da tabela a que o item pertence: a última requisição antes dele no texto
      const linhasTabela = itens.map(it => ({ it, pos: corrido.indexOf(it.requisicao) })).filter(x => x.pos >= 0);
      const lista = [];
      marcas.forEach((m, i) => {
        const trecho = corrido.slice(m.index + m[0].length, i + 1 < marcas.length ? marcas[i + 1].index : corrido.length);
        // "R$ 5.350,00" ou sem centavos com milhar ("R$ 7.900.ITEM 19"); "R$ 4.6"
        // (cortado) não vale — aí sai de unitário × quantidade
        let total = /VALOR\s+TOTAL\s*:?\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d{1,3}(?:\.\d{3})+)(?![\d,])/i.exec(trecho)?.[1] ?? '';
        const unit = /VALOR\s+UNIT[ÁA]RIO\s*:?\s*R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,4})?)/i.exec(trecho)?.[1] ?? '';
        const q = /QUANTIDADE\s*:?\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\s*([A-ZÀ-Ú]{1,8})?/i.exec(trecho);
        // "1.000KG" → "1000" (ponto de milhar sem decimais; o robô leria 1,000)
        const quant = (q?.[1] ?? '').replace(/^(\d{1,3}(?:\.\d{3})+)$/, s => s.replace(/\./g, ''));
        // VALOR TOTAL cortado no PDF: unitário × quantidade (a soma x TOTAL confere)
        if (!total && unit && quant) {
          const calc = valorBR(unit) * valorBR(quant.includes(',') ? quant : quant.replace(/\./g, ''));
          if (calc > 0) { total = calc.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); deduzidos.itensCalculados = true; }
        }
        if (!total) return;   // "ITEM 1: 4891,66" da OBS e afins não são esta forma
        // Total ≠ unitário × quantidade: um dos dois foi mal lido — a revisão aponta
        const calcConf = unit && quant ? valorBR(unit) * valorBR(quant.includes(',') ? quant : quant.replace(/\./g, '')) : NaN;
        const confere = !(calcConf > 0) || Math.abs(calcConf - valorBR(total)) <= Math.max(0.05, valorBR(total) * 0.005);
        const dono = [...linhasTabela].reverse().find(x => x.pos < m.index)?.it ?? itens[0];
        lista.push({
          confere,
          item: m[1], requisicao: dono?.requisicao ?? '', subelemento: dono?.subelemento ?? '',
          // sem as colunas da linha da tabela que caem no meio ("1,00 UN 92.980,00 92.980,0000")
          descricao: trecho.replace(/\s*;?\s*VALOR\s+UNIT[ÁA]RIO[\s\S]*$/i, '')
            .replace(/\s\d{1,3}(?:\.\d{3})*,\d{2,4}\s+[A-Z]{1,4}\.?\s+[\d.,]+\s+[\d.,]+(?=\s|$)/g, '').trim().slice(0, 120),
          quant, unid: q?.[2] ?? '', valorUnit: unit, valorTotal: total,
        });
      });
      return lista;
    })();
    // Coluna PRC TOTAL das linhas da tabela: com os itens na descrição, é o valor
    // oficial da solicitação (e a referência para conferir a soma deles)
    const somaTabela = itens.reduce((s, it) => s + (parseFloat(String(it.valorTotal ?? '').replace(/\./g, '').replace(',', '.')) || 0), 0);
    // A linha da tabela que embrulha esses itens não tem nº de item próprio
    if (naDescricao.length && (naDescricao.length > 1 || !itens.length || itens.every(it => !it.item))) {
      itens = naDescricao;
      itensDaDescricao = true;
      if (naDescricao.some(it => !it.confere)) deduzidos.itensDivergentes = naDescricao.filter(it => !it.confere).map(it => it.item);
    }

    // Sem itens, a revisão avisa; num contrato de item único o robô usa o TOTAL

    // Sem TOTAL legível, soma os itens da tabela
    const total = (() => {
      if (totalLido) return totalLido;
      const fmt4 = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
      // Itens na descrição: o valor da linha da tabela (PRC TOTAL), não a soma deles —
      // senão a conferência compararia a soma com ela mesma
      if (itensDaDescricao && somaTabela > 0) return fmt4(somaTabela);
      // O SILOMS escreve PRC TOTAL e TOTAL com 4 casas ("90.250,0000"): o maior é o TOTAL
      const quatroCasas = [...t.matchAll(/(?<![\d.,])(\d{1,3}(?:\.\d{3})*,\d{4})(?![\d,])/g)]
        .map(m => m[1]).sort((a, b) => parseFloat(b.replace(/\./g, '').replace(',', '.')) - parseFloat(a.replace(/\./g, '').replace(',', '.')));
      if (quatroCasas.length && itensDaDescricao) return quatroCasas[0];
      const soma = itens.reduce((acc, it) =>
        acc + (parseFloat(String(it.valorTotal ?? '').replace(/\./g, '').replace(',', '.')) || 0), 0);
      if (!soma) return '';
      deduzidos.total = true;
      return soma.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    })();

    // ── Reforço / anulação de um empenho já emitido ─────────────────────────────
    // "Anulação Ident/OC 26E0454 V. 3" (ou "Reforço …"). A NE a alterar NÃO vem no
    // PDF: o usuário informa na revisão. O valor também aparece na OBS
    // ("ANULAÇÃO DO VALOR DE R$ 9.998,73").
    const operacao = (() => {
      const m = /(?:^|\s)(Anula[çc][ãa]o|Refor[çc]o)\s+(?:Ident\b|de\s+Empenho\b|da\s+OC\b|OC\b)/im.exec(t) ??
        /SOLICITA[ÇC][ÃA]O\s+DE\s+(ANULA[ÇC][ÃA]O|REFOR[ÇC]O)\b/i.exec(t);
      if (m) return /^anula/i.test(m[1]) ? 'anulacao' : 'reforco';
      const o = /OBS:\s*(ANULA[ÇC][ÃA]O|REFOR[ÇC]O)\b/i.exec(t);
      if (o) { deduzidos.operacao = true; return /^anula/i.test(o[1]) ? 'anulacao' : 'reforco'; }
      return '';
    })();
    const identOperacao = operacao
      ? (/(?:Anula[çc][ãa]o|Refor[çc]o)\s+Ident\/?\s*OC\s+(\w+(?:\s+V\.\s*\d+)?)/i.exec(t)?.[1] ?? '').trim()
      : '';
    const valorOperacao = operacao
      ? (/(?:ANULA[ÇC][ÃA]O|REFOR[ÇC]O)\s+(?:DO\s+|DE\s+)?VALOR\s+(?:DE\s+)?R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i.exec(t)?.[1] ?? '')
      : '';

    return {
      ok: true,
      _deduzidos: deduzidos,
      operacao,          // '' | 'anulacao' | 'reforco'
      identOperacao,     // "26E0454 V. 3"
      valorOperacao,     // "9.998,73" (da OBS)
      itensDaDescricao,
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
