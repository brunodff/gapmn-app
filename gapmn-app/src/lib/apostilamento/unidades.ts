// Unidades apoiadas (Reajustes › Configurações; pedido da SCON, revisão 4, seção 6.2): cada OM que o GAP-MN apoia
// tem o seu Ordenador, ACI, unidade de apoio e texto fixo do "I – CONTRATANTE". Ao abrir um contrato (Reajustes ou
// Termos Aditivos) o site acha a unidade da OM que assina o contrato pela sigla ou pelas outras grafias e usa os dados
// dela em todos os documentos. OM sem cadastro: alerta, e o motor recebe campos em branco ("«…»"), nunca os do GAP-MN.
import { CONFIG_VAZIA, type ConfigApostilamento } from "./tipos.ts";

export interface UnidadeApoiada {
  sigla: string;
  grafias: string[];
  nome: string | null;
  ug: string | null;
  artigo: "do" | "da";
  cefa: boolean;
  autoridade_superior: string | null;
  padrao: boolean;
  rascunho: boolean;
  ordenador: ConfigApostilamento["ordenador"];
  aci: ConfigApostilamento["aci"];
  ug_apoio: ConfigApostilamento["ug_apoio"];
  cidade: string;
  texto_fixo: string | null;
  dias_alerta: number | null;
  atualizado_em?: string;
  atualizado_nome?: string | null;
}

/** "CINDACTA IV", "cindacta-iv" e "CINDACTAIV" são a mesma OM; acento e espaço não contam */
export const siglaChave = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const siglaLimpa = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

/** A unidade cadastrada da OM (pela sigla ou por uma das outras grafias) */
export function acharUnidade(unidades: UnidadeApoiada[], sigla: string | null | undefined): UnidadeApoiada | null {
  const k = siglaChave(sigla);
  if (!k) return null;
  return unidades.find((u) => siglaChave(u.sigla) === k) ?? unidades.find((u) => u.grafias.some((g) => siglaChave(g) === k)) ?? null;
}
export const unidadePadrao = (unidades: UnidadeApoiada[]) => unidades.find((u) => u.padrao) ?? null;

const cargoOrdenador = (u: Pick<UnidadeApoiada, "artigo" | "sigla">, feminino: boolean) => `${feminino ? "Ordenadora" : "Ordenador"} de Despesas ${u.artigo} ${u.sigla}`;

/** Configuração que o motor recebe para um contrato da unidade `u` (a OM que assina é `omAssina`, como no cadastro) */
export function configDaUnidade(u: UnidadeApoiada, omAssina: string, diasAlerta?: number | null): ConfigApostilamento {
  const ordenador = { ...CONFIG_VAZIA.ordenador, ...u.ordenador, om_sigla: u.sigla };
  // o motor escreve "Ordenador de Despesas do <sigla>": com "da" (BAMN, Prefeitura) a assinatura vai pronta
  const extra = u.artigo === "da" ? { funcao_assinatura: cargoOrdenador(u, !!ordenador.feminino) } : {};
  const texto = (u.texto_fixo ?? "").trim();
  const textos: Record<string, string> = {};
  if (texto) for (const k of [u.sigla, omAssina, ...u.grafias]) if (k?.trim()) textos[k.trim()] = texto;
  return {
    ordenador: { ...ordenador, ...extra } as ConfigApostilamento["ordenador"],
    aci: { ...CONFIG_VAZIA.aci, ...u.aci, funcao: u.aci?.funcao || `Agente de Controle Interno ${u.artigo} ${u.sigla}` },
    cidade: u.cidade || CONFIG_VAZIA.cidade,
    ug_apoio: { ...CONFIG_VAZIA.ug_apoio, ...u.ug_apoio, nome: u.ug_apoio?.nome || (u.nome ?? "").toUpperCase() || CONFIG_VAZIA.ug_apoio.nome, sigla: u.ug_apoio?.sigla || u.sigla },
    textos_fixos_om: textos,
    dias_alerta: diasAlerta ?? u.dias_alerta ?? CONFIG_VAZIA.dias_alerta,
  };
}

/** OM sem cadastro: campos em branco no documento (o motor põe «…»), para não sair com o Ordenador de outra unidade */
export function configSemCadastro(sigla: string, diasAlerta?: number | null): ConfigApostilamento {
  const s = siglaLimpa(sigla || "?");
  return {
    ordenador: { nome: "", posto: "", feminino: false, portaria: "", publicacao: "", matricula: "", om_sigla: s },
    aci: { nome: "", posto: "", funcao: `Agente de Controle Interno do ${s}` },
    cidade: CONFIG_VAZIA.cidade,
    ug_apoio: { nome: `«${s} – cadastrar em Reajustes › Configurações»`, sigla: s, endereco: "«endereço da OM»", cnpj: "«CNPJ da OM»" },
    textos_fixos_om: {},
    dias_alerta: diasAlerta ?? CONFIG_VAZIA.dias_alerta,
  };
}

/** A configuração única antiga (apostilamento_config) como unidade padrão, para quem ainda não tem a tabela nova */
export function unidadeDaConfig(c: ConfigApostilamento): UnidadeApoiada {
  const sigla = siglaLimpa(c.ordenador.om_sigla || c.ug_apoio.sigla || "GAP-MN");
  return {
    sigla, grafias: [], nome: "Grupamento de Apoio de Manaus", ug: "120630", artigo: "do", cefa: true, autoridade_superior: null,
    padrao: true, rascunho: false, ordenador: c.ordenador, aci: c.aci, ug_apoio: c.ug_apoio, cidade: c.cidade,
    texto_fixo: c.textos_fixos_om[sigla] ?? null, dias_alerta: c.dias_alerta,
  };
}

export function unidadeVazia(sigla = "", copiarDe?: UnidadeApoiada | null): UnidadeApoiada {
  const s = siglaLimpa(sigla);
  const base: UnidadeApoiada = {
    sigla: s, grafias: [], nome: null, ug: null, artigo: "do", cefa: false, autoridade_superior: null, padrao: false, rascunho: false,
    ordenador: { ...CONFIG_VAZIA.ordenador, om_sigla: s }, aci: { nome: "", posto: "", funcao: s ? `Agente de Controle Interno do ${s}` : "" },
    ug_apoio: { nome: "", sigla: s, endereco: "", cnpj: "" }, cidade: CONFIG_VAZIA.cidade, texto_fixo: null, dias_alerta: null,
  };
  if (!copiarDe) return base;
  // copia as pessoas e a cidade; o que identifica a outra unidade (função do ACI "do GAP-MN", unidade de apoio com
  // nome, endereço e CNPJ, texto fixo do I – CONTRATANTE) começa vazio, para não sair documento com dado de outra OM
  return {
    ...base, artigo: copiarDe.artigo, cefa: copiarDe.cefa, autoridade_superior: copiarDe.autoridade_superior,
    ordenador: { ...copiarDe.ordenador, om_sigla: s }, aci: { ...copiarDe.aci, funcao: "" }, cidade: copiarDe.cidade,
  };
}

/** Linha do banco → unidade (com os padrões no que faltar) */
export function normalizarUnidade(r: Partial<UnidadeApoiada> & { sigla: string }): UnidadeApoiada {
  const v = unidadeVazia(r.sigla);
  return {
    ...v, ...r,
    grafias: r.grafias ?? [], artigo: r.artigo === "da" ? "da" : "do", cefa: !!r.cefa, padrao: !!r.padrao, rascunho: !!r.rascunho,
    ordenador: { ...v.ordenador, ...(r.ordenador ?? {}) }, aci: { ...v.aci, ...(r.aci ?? {}) }, ug_apoio: { ...v.ug_apoio, ...(r.ug_apoio ?? {}) },
    cidade: r.cidade || v.cidade,
  };
}

/** Pendências do cadastro da unidade para os documentos saírem completos */
export function pendenciasUnidade(u: UnidadeApoiada): string[] {
  const p: string[] = [];
  if (!u.ordenador.nome?.trim()) p.push("nome do Ordenador de Despesas");
  if (!u.aci.nome?.trim()) p.push("nome do Agente de Controle Interno");
  if (!(u.nome ?? "").trim()) p.push("nome por extenso");
  if (!(u.ug ?? "").trim()) p.push("código da UG");
  if (!u.cefa && !(u.autoridade_superior ?? "").trim()) p.push("autoridade do campo 19 da Ficha (OM fora do CEFA)");
  return p;
}
