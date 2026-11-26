// Termo Aditivo (documento da SCON, revisão 7, seção 3L; kit/gerar_termo_aditivo.py): o que a tela mostra antes de
// gerar (MINUTA, exercício da dotação, valor da garantia) e os dados que o termo usa do cadastro da unidade e do
// contrato. O documento em si sai do kit, no navegador, a partir do aditivo SALVO.
import type { DadosReajuste } from "../apostilamento/tipos.ts";
import type { UnidadeApoiada } from "../apostilamento/unidades.ts";
import type { AnalisePareceres } from "./regras.ts";
import { fimPrevisto, numero, valorNovo } from "./regras.ts";
import type { DadosAditivo, OmSignataria } from "./tipos.ts";

/** "MINUTA" em vermelho só quando o aditivo vai para a CJU (ou quando a SCON força) */
export const minutaDoTermo = (d: Pick<DadosAditivo, "termo_aditivo">, an: Pick<AnalisePareceres, "vai_para_cju">) =>
  d.termo_aditivo?.minuta != null ? !!d.termo_aditivo.minuta : an.vai_para_cju;

/** Exercício da dotação: "2026/2027" quando o novo período atravessa o ano (editável) */
export function exercicioDotacao(d: Pick<DadosAditivo, "termo_aditivo" | "aditivo" | "empenho">): string | null {
  const ta = d.termo_aditivo;
  if (String(ta?.exercicio ?? "").trim()) return String(ta!.exercicio).trim();
  const pr = d.aditivo?.prorrogacao;
  const ini = pr?.inicio || null;
  const fim = pr?.fim || (ini && pr?.meses ? fimPrevisto(ini, Number(pr.meses)) : null);
  const ano = (s: string | null) => (s && /^\d{2}\/\d{2}\/\d{4}$/.test(s) ? s.slice(6) : null);
  if (ano(ini) && ano(fim) && ano(ini) !== ano(fim)) return `${ano(ini)}/${ano(fim)}`;
  const e = d.empenho?.exercicio ?? (d as { exercicio?: string | number }).exercicio ?? ano(ini);
  return e != null && e !== "" ? String(e) : null;
}

/** Garantia de execução: P% × valor do termo (ou do contrato); null enquanto o percentual não for informado */
export function valorGarantia(d: Pick<DadosAditivo, "termo_aditivo" | "aditivo" | "valor_atual" | "valor_novo">): number | null {
  const g = d.termo_aditivo?.garantia;
  const p = numero(g?.percentual);
  const novo = valorNovo(d);
  if (p == null || novo == null) return null;
  const base = (g?.base ?? "termo") === "termo" ? novo : numero(g?.valor_base) ?? novo;
  return Math.round(base * p) / 100;
}

/** OM signatária completa para o termo: endereço, CNPJ, cidade e Ordenador SEMPRE do cadastro da unidade */
export function omParaTermo(om: OmSignataria, u: UnidadeApoiada | null): OmSignataria {
  if (!u) return om;
  const o = u.ordenador;
  return {
    ...om, nome: om.nome || u.nome || om.sigla, endereco: u.ug_apoio?.endereco || om.endereco || "", cnpj: u.ug_apoio?.cnpj || om.cnpj || "",
    cidade: u.cidade || om.cidade || "",
    ordenador: { nome: o.nome ?? "", posto: o.posto ?? "", feminino: !!o.feminino, portaria: o.portaria ?? "", publicacao: o.publicacao ?? "", matricula: o.matricula ?? "" },
  };
}

/** Contratada e licitação de origem pelo cadastro do contrato nos Reajustes (o que o aditivo já tiver fica) */
export function contratadaDoCadastro(d: Pick<DadosAditivo, "contratada">, cad: Partial<DadosReajuste> | null): DadosAditivo["contratada"] {
  const e = cad?.empresa;
  const atual = d.contratada ?? null;
  if (!e?.nome && !atual) return null;
  return {
    nome: atual?.nome || e?.nome || "", cnpj: atual?.cnpj || e?.cnpj || "", endereco: atual?.endereco || e?.endereco || "",
    representante: atual?.representante || e?.representante || "", representante_feminino: atual?.representante_feminino ?? e?.representante_feminino ?? false,
  };
}

/** Pendências que fazem o termo sair com campo em amarelo (a tela avisa; o termo sai assim mesmo) */
export function pendenciasTermo(d: DadosAditivo, u: UnidadeApoiada | null): string[] {
  const p: string[] = [];
  const om = omParaTermo(d.om_signataria, u);
  if (!u) p.push(`a OM signatária ${d.om_signataria.sigla || "?"} não está cadastrada em Reajustes › Configurações (endereço, CNPJ e Ordenador)`);
  else {
    if (!om.endereco || !om.cnpj) p.push("endereço/CNPJ da unidade (Reajustes › Configurações)");
    if (!om.ordenador?.nome) p.push("dados do Ordenador da unidade (Reajustes › Configurações)");
  }
  if (!String(d.termo_aditivo?.numero ?? "").trim()) p.push("nº do Termo Aditivo (controle da SCON)");
  if (!String(d.licitacao ?? "").trim()) p.push("licitação de origem");
  if (!d.contratada?.representante) p.push("representante da empresa (cadastro do contrato)");
  if (!d.contratada?.endereco) p.push("endereço da contratada (cadastro do contrato)");
  const g = d.termo_aditivo?.garantia;
  if (g?.exige == null) p.push("se o contrato/TR exige garantia");
  else if (g.exige && numero(g.percentual) == null) p.push("percentual da garantia");
  return p;
}

export { licitacaoDoGov } from "../apostilamento/contratosGov.ts";
