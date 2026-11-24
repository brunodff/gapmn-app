// Pesquisa de Preços (Licitações › Pesquisa de Preços) → "pesquisa_precos" do kit da SCON (gerar_pesquisa_precos.py).
// Entram os preços considerados na estatística da tela; os desconsiderados vão marcados com o motivo, até um limite,
// para o documento não virar uma lista de centenas de compras.
import type { Criterio, ItemTR, RegistroPreco } from "../mcpCompras";
import type { ItemPesquisa, PesquisaPrecosAditivo, PrecoPesquisa } from "./tipos.ts";

const MODALIDADE: Record<string, string> = { "05": "Pregão", "06": "Dispensa", "07": "Inexigibilidade", "03": "Concorrência", "04": "Concorrência", "02": "Tomada de Preços", "01": "Convite" };
const MAX_DESCONSIDERADOS = 30;

/** "Compras.gov.br – UASG 160001 – Pregão 90012/2026" (idCompra = UASG 6 + modalidade 2 + número 5 + ano 4) */
export function fonteDoRegistro(r: RegistroPreco): string {
  const partes = ["Compras.gov.br"];
  const id = String(r.idCompra ?? "");
  const m = /^(\d{6})(\d{2})(\d{5})(\d{4})$/.exec(id);
  const uasg = r.codigoUasg || m?.[1];
  if (uasg) partes.push(`UASG ${uasg}`);
  if (r.origem === "ata") partes.push(`Ata de RP ${r.numeroAta ?? ""}`.trim());
  else if (m) partes.push(`${MODALIDADE[m[2]] ?? "Compra"} ${m[3]}/${m[4]}`);
  return partes.join(" – ");
}
const dataBr = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split("-").reverse().join("/") : s ?? "");

export interface LinhaParaAditivo {
  item: ItemTR;
  validos: RegistroPreco[];
  considerados: RegistroPreco[];
  criterio: Criterio;
}

export function pesquisaParaAditivo(linhas: LinhaParaAditivo[], meta: { fonteTr: string; atualizacao: string; hoje: string },
  anterior: PesquisaPrecosAditivo | null): PesquisaPrecosAditivo {
  const contagem = new Map<Criterio, number>();
  for (const l of linhas) contagem.set(l.criterio, (contagem.get(l.criterio) ?? 0) + 1);
  const criterio = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "mediana";
  const itens: ItemPesquisa[] = linhas.map((l) => {
    const ok = new Set(l.considerados);
    const preco = (r: RegistroPreco, excluido: boolean): PrecoPesquisa => ({
      fonte: fonteDoRegistro(r), data: dataBr(r.dataResultado ?? r.dataCompra),
      valor: Math.round((r.precoOriginal ?? r.precoUnitario ?? 0) * 100) / 100,
      valor_atualizado: Math.round((r.precoUnitario ?? 0) * 100) / 100,
      ...(excluido ? { excluido: true, motivo_exclusao: "valor discrepante, unidade diferente ou retirado na análise" } : {}),
    });
    const fora = l.validos.filter((r) => !ok.has(r));
    return {
      item: l.item.numero, descricao: l.item.descricao,
      codigo: l.item.codigo ? `${l.item.tipo === "material" ? "CATMAT" : "CATSER"} ${l.item.codigo}` : "",
      unidade: l.item.unidade, quantidade: l.item.quantidade ?? 1,
      preco_contratado: anterior?.itens.find((x) => x.item === l.item.numero)?.preco_contratado ?? null,
      precos: [...l.considerados.map((r) => preco(r, false)), ...(fora.length <= MAX_DESCONSIDERADOS ? fora.map((r) => preco(r, true)) : [])],
    };
  });
  return { fonte_tr: meta.fonteTr, data_pesquisa: meta.hoje, atualizacao: meta.atualizacao, criterio, itens };
}
