// src/lib/trParser.ts
// Leitura da tabela de itens do Termo de Referência a partir da POSIÇÃO de cada
// texto no PDF. O texto corrido não serve: a especificação quebra em várias
// linhas dentro da célula e o código CATMAT/CATSER vem como número solto numa
// coluna, centralizado verticalmente na linha da tabela.
//
// Estratégia:
// 1. Cabeçalho = linha que contém "CATMAT"/"CATSER" junto de "Item" ou
//    "Especificação". As palavras do cabeçalho viram colunas (agrupadas por x —
//    "Unidade / de / Medida" em três linhas é uma coluna só).
// 2. Cada número de 3–6 dígitos na coluna do código é a âncora de uma linha.
// 3. As linhas da especificação são juntadas em blocos pelo espaçamento
//    vertical: dentro da célula as linhas ficam mais próximas do que entre
//    células. Cada bloco vai para a âncora que ele contém.
// 4. Unidade, quantidade e valor são lidos na faixa vertical do bloco.

export interface Trecho { pagina: number; x: number; y: number; w: number; h: number; str: string }

export interface ItemTabela {
  numero: number;
  tipo: "material" | "servico";
  codigo: number;
  descricao: string;
  unidade: string;
  quantidade: number | null;
  valorReferencia: number | null;
}

type Papel = "item" | "descricao" | "codigo" | "unidade" | "quantidade" | "valorUnit";

interface Coluna { centro: number; ini: number; fim: number; rotulo: string; papel: Papel | null }

interface Linha { x: number; y: number; h: number; texto: string }

/** Converte os itens de texto do pdf.js (TextItem) em trechos posicionados. */
export function trechosDaPagina(
  items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }>,
  pagina: number,
): Trecho[] {
  const out: Trecho[] = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !it.str.trim() || !it.transform) continue;
    out.push({
      pagina,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width ?? 0,
      h: it.height || Math.abs(it.transform[3]) || 10,
      str: it.str,
    });
  }
  return out;
}

const RX_CAB_CODIGO = /^(c[óo]d(igo)?\.?\s*)?cat(mat|ser)\b/i;

function papelDoRotulo(r: string): Papel | null {
  if (/^item\b/i.test(r)) return "item";
  if (/especifica|descri[çc]/i.test(r)) return "descricao";
  if (/cat(mat|ser)/i.test(r)) return "codigo";
  if (/^unid/i.test(r)) return "unidade";
  if (/^(quantidade|qtd|quant\.)/i.test(r)) return "quantidade";
  if (/(valor|pre[çc]o).*unit/i.test(r)) return "valorUnit";
  return null;
}

/** Tenta montar as colunas a partir de um candidato a cabeçalho na página. */
function colunasDoCabecalho(trechos: Trecho[], ancora: Trecho): { colunas: Coluna[]; base: number } | null {
  const faixa = trechos.filter((t) => Math.abs(t.y - ancora.y) <= 20 && t.str.trim().length <= 40);
  // Agrupa por x: palavras de um mesmo cabeçalho de várias linhas ficam centralizadas.
  const grupos: { centro: number; ini: number; fim: number; itens: Trecho[] }[] = [];
  for (const t of [...faixa].sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2))) {
    const c = t.x + t.w / 2;
    const g = grupos.find((g) => Math.abs(g.centro - c) < 18 || (t.x < g.fim - 2 && t.x + t.w > g.ini + 2));
    if (g) {
      g.itens.push(t);
      g.ini = Math.min(g.ini, t.x);
      g.fim = Math.max(g.fim, t.x + t.w);
      g.centro = (g.ini + g.fim) / 2;
    } else {
      grupos.push({ centro: c, ini: t.x, fim: t.x + t.w, itens: [t] });
    }
  }
  grupos.sort((a, b) => a.centro - b.centro);
  const colunas: Coluna[] = grupos.map((g, i) => {
    const rotulo = [...g.itens].sort((a, b) => b.y - a.y || a.x - b.x).map((t) => t.str.trim()).join(" ");
    const ant = grupos[i - 1]?.centro;
    const prox = grupos[i + 1]?.centro;
    const meio = (outro: number | undefined, lado: -1 | 1) =>
      outro != null ? (g.centro + outro) / 2 : g.centro + lado * Math.max(g.fim - g.ini, 40);
    return { centro: g.centro, ini: meio(ant, -1), fim: meio(prox, 1), rotulo, papel: papelDoRotulo(rotulo) };
  });
  const papeis = new Set(colunas.map((c) => c.papel));
  if (!papeis.has("codigo") || !papeis.has("descricao")) return null;
  // Se a primeira coluna não tem papel, ela é quase sempre o "Item" com outro nome.
  const base = Math.min(...faixa.map((t) => t.y)) - 2;
  return { colunas, base };
}

function colunaDe(colunas: Coluna[], t: Trecho): Coluna | null {
  const c = t.x + t.w / 2;
  const col = colunas.find((k) => c >= k.ini && c < k.fim);
  if (!col) return null;
  // Texto mais largo que a coluna atravessa várias colunas → parágrafo, não célula.
  if (t.w > (col.fim - col.ini) * 1.6) return null;
  return col;
}

/** Junta trechos da mesma altura (mesma linha visual) em uma linha de texto. */
function emLinhas(trechos: Trecho[]): Linha[] {
  const ord = [...trechos].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas: { y: number; h: number; partes: Trecho[] }[] = [];
  for (const t of ord) {
    const l = linhas.find((l) => Math.abs(l.y - t.y) < Math.max(2, t.h * 0.3));
    if (l) { l.partes.push(t); l.h = Math.max(l.h, t.h); } else linhas.push({ y: t.y, h: t.h, partes: [t] });
  }
  return linhas.map((l) => ({
    x: Math.min(...l.partes.map((p) => p.x)), y: l.y, h: l.h,
    texto: l.partes.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ").replace(/\s+/g, " ").trim(),
  })).sort((a, b) => b.y - a.y);
}

/** Separa as linhas de uma coluna em blocos (células) pelo espaçamento vertical. */
function emBlocos(linhas: Linha[]): Linha[][] {
  if (!linhas.length) return [];
  const gaps = linhas.slice(1).map((l, i) => linhas[i].y - l.y).filter((g) => g > linhas[0].h * 0.3);
  const menor = gaps.length ? Math.min(...gaps) : 0;
  const blocos: Linha[][] = [[linhas[0]]];
  for (let i = 1; i < linhas.length; i++) {
    const gap = linhas[i - 1].y - linhas[i].y;
    if (menor && gap > menor * 1.3) blocos.push([linhas[i]]);
    else blocos[blocos.length - 1].push(linhas[i]);
  }
  return blocos;
}

const RX_RODAPE = /p[áa]gina\s*\d|^\d+\s*(de|\/)\s*\d+$|^sei\b|documento assinado|c[óo]digo verificador/i;

function numeroBR(s: string): number | null {
  const limpo = s.replace(/R\$\s*/gi, "").replace(/\s+/g, "").trim();
  if (!limpo || !/\d/.test(limpo)) return null;
  const n = /,\d+$/.test(limpo)
    ? Number(limpo.replace(/\./g, "").replace(",", "."))
    : Number(limpo.replace(/\.(?=\d{3}\b)/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Extrai os itens da(s) tabela(s) do TR. Devolve [] quando não reconhece uma
 * tabela com coluna CATMAT/CATSER — o chamador então tenta a IA ou as regras.
 */
export function extrairItensTabela(trechos: Trecho[]): ItemTabela[] {
  const paginas = [...new Set(trechos.map((t) => t.pagina))].sort((a, b) => a - b);
  const itens: (ItemTabela & { _pendente?: boolean })[] = [];
  let colunas: Coluna[] | null = null;
  let margemDesc: number | null = null;
  let tipo: "material" | "servico" = "material";
  let prefixoProximo = "";

  for (const p of paginas) {
    const daPagina = trechos.filter((t) => t.pagina === p);

    // Cabeçalho nesta página? (a tabela pode repetir o cabeçalho a cada página)
    let base = Infinity;
    for (const cand of daPagina.filter((t) => RX_CAB_CODIGO.test(t.str.trim()))) {
      const r = colunasDoCabecalho(daPagina, cand);
      if (r) {
        colunas = r.colunas;
        base = r.base;
        // A especificação é alinhada à esquerda: a divisa com a coluna anterior
        // é a margem real do texto, não o meio entre os títulos do cabeçalho
        // (senão uma última linha curta, tipo "ML", cai na coluna "Item").
        const desc = colunas.find((c) => c.papel === "descricao")!;
        // Usa a margem MAIS FREQUENTE (todas as linhas da célula começam nela);
        // o mínimo seria puxado por parágrafos fora da tabela.
        const freq = new Map<number, number>();
        for (const t of daPagina) {
          if (t.y >= base || colunaDe(r.colunas, t) !== desc) continue;
          const x = Math.round(t.x);
          freq.set(x, (freq.get(x) ?? 0) + 1);
        }
        const moda = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
        if (moda && moda[1] >= 2) {
          const margem = moda[0] - 3;
          margemDesc = moda[0];
          const i = colunas.indexOf(desc);
          desc.ini = margem;
          if (i > 0) colunas[i - 1].fim = margem;
        }
        tipo = /catser/i.test(r.colunas.find((c) => c.papel === "codigo")?.rotulo ?? "") ? "servico" : "material";
        break;
      }
    }
    if (!colunas) continue;
    const cols = colunas;

    const corpo = daPagina.filter((t) => t.y < base && !RX_RODAPE.test(t.str.trim()));
    const porPapel = (papel: Papel) => {
      const col = cols.find((c) => c.papel === papel);
      return col ? corpo.filter((t) => colunaDe(cols, t) === col) : [];
    };

    const ancoras = emLinhas(porPapel("codigo")).filter((l) => /^\d{3,6}$/.test(l.texto));
    const blocos = emBlocos(emLinhas(porPapel("descricao")));
    const faixaDe = (b: Linha[]) => ({ topo: b[0].y + b[0].h, fundo: b[b.length - 1].y });

    // Liga cada âncora ao bloco de especificação que a contém.
    const linhasDaPagina: { ancora: Linha; desc: Linha[] }[] = ancoras.map((a) => ({ ancora: a, desc: [] }));
    if (!ancoras.length) {
      // Página sem nenhum código: ou a tabela acabou, ou uma célula muito longa
      // ocupa a página inteira. Só é continuação se as linhas começam
      // exatamente na margem da coluna de especificação.
      const ultimo = itens[itens.length - 1];
      const cont = margemDesc == null ? [] : emLinhas(porPapel("descricao")).filter((l) => Math.abs(l.x - margemDesc!) <= 2);
      if (ultimo && cont.length) {
        const texto = cont.map((l) => l.texto).join(" ");
        if (prefixoProximo) prefixoProximo = `${prefixoProximo} ${texto}`;
        else ultimo.descricao = `${ultimo.descricao} ${texto}`.trim();
      } else prefixoProximo = "";
      continue;
    }
    let fundoUltimaLinha = Infinity;
    for (const b of blocos) {
      const { topo, fundo } = faixaDe(b);
      const texto = b.map((l) => l.texto).join(" ");
      const dentro = linhasDaPagina.filter((r) => r.ancora.y <= topo + 6 && r.ancora.y >= fundo - 6);
      if (dentro.length === 1) {
        dentro[0].desc.push(...b);
        fundoUltimaLinha = fundo;
      } else if (dentro.length > 1) {
        // Bloco único com várias âncoras (linhas de altura igual): vai por proximidade.
        for (const l of b) {
          const alvo = dentro.reduce((m, r) => (Math.abs(r.ancora.y - l.y) < Math.abs(m.ancora.y - l.y) ? r : m));
          alvo.desc.push(l);
        }
        fundoUltimaLinha = fundo;
      } else if (topo > ancoras[0].y) {
        // Sem âncora, acima da primeira linha: continuação de célula da página anterior.
        const ultimo = itens[itens.length - 1];
        if (ultimo) ultimo.descricao = `${ultimo.descricao} ${texto}`.trim();
      } else if (fundoUltimaLinha - topo < b[0].h * 2.5 && !prefixoProximo) {
        // Sem âncora, colado logo abaixo da última linha: célula que continua na próxima página.
        prefixoProximo = texto;
      }
    }

    for (const r of linhasDaPagina) {
      const topo = r.desc.length ? r.desc[0].y + r.desc[0].h + 6 : r.ancora.y + 15;
      const fundo = r.desc.length ? r.desc[r.desc.length - 1].y - 6 : r.ancora.y - 15;
      const celula = (papel: Papel) => emLinhas(porPapel(papel).filter((t) => t.y <= topo && t.y >= fundo))
        .map((l) => l.texto).join(" ").trim();

      const numero = Number(celula("item").match(/^\d{1,4}/)?.[0]) || itens.length + 1;
      let descricao = r.desc.map((l) => l.texto).join(" ").replace(/\s+/g, " ").trim();
      if (prefixoProximo && r === linhasDaPagina[0]) { descricao = `${prefixoProximo} ${descricao}`.trim(); prefixoProximo = ""; }
      itens.push({
        numero,
        tipo,
        codigo: Number(r.ancora.texto),
        descricao,
        unidade: celula("unidade").toUpperCase(),
        quantidade: numeroBR(celula("quantidade")),
        valorReferencia: numeroBR(celula("valorUnit")),
      });
    }
  }
  return itens;
}
