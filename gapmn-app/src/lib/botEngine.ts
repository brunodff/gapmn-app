/**
 * botEngine.ts — Motor de inteligência do chatbot GAP-MN
 *
 * Fluxo: detectIntent → resposta específica (consulta Supabase) → fallback kb_entries
 *
 * Tabelas consultadas:
 *   • contratos_scon         (SCON — contratos, saldos, vencimentos)
 *   • processos_licitatorios (SLIC — processos, valores, situação)
 *   • processo_controle      (status livre interno, PAG, OM)
 *   • indicadores_lotacao    (SEO — contas correntes, dotação, saldo)
 *   • empenhos_seo           (SEO — NE, valor, liquidado, saldo_emp, indicador_lotacao)
 *   • kb_entries             (base de conhecimento manual — fallback)
 */

import { supabase } from "./supabase";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s.\/\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function has(q: string, ...words: string[]): boolean {
  return words.some((w) => q.includes(norm(w)));
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "–";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "–";
  try { return new Date(d + "T12:00:00").toLocaleDateString("pt-BR"); }
  catch { return d; }
}

function daysUntil(dateStr: string | null | undefined): number {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr + "T23:59:59");
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

function isoToday(): string { return new Date().toISOString().slice(0, 10); }
function isoInDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

// ─── Tipos de intenção ────────────────────────────────────────────────────────

type Intent =
  | "SAUDACAO"
  | "AJUDA"
  | "CONTRATO_BUSCA"
  | "CONTRATO_VENCIMENTO"
  | "CONTRATO_SALDO_TOTAL"
  | "CONTRATO_VIGENTES"
  | "CONTRATO_RESUMO"
  | "CONTRATO_POR_UGE"
  | "PROCESSO_BUSCA"
  | "PROCESSO_ANDAMENTO"
  | "PROCESSO_HOMOLOGADO"
  | "PROCESSO_RESUMO"
  | "PROCESSO_VALORES"
  | "INDICADOR_RESUMO"
  | "INDICADOR_BUSCA"
  | "EMPENHO_RESUMO"
  | "EMPENHO_INDICADOR"
  | "EMPENHO_CONTRATO"
  | "GERENCIAMENTO_RESUMO"
  | "PAINEL_BI"
  | "KB_FALLBACK";

// ─── Detecção de intenção ─────────────────────────────────────────────────────

function detectIntent(q: string): { intent: Intent; extract?: string } {

  // Saudação
  if (has(q, "ola", "oi ", " oi", "bom dia", "boa tarde", "boa noite", "tudo bem", "tudo bom"))
    return { intent: "SAUDACAO" };

  // Ajuda
  if (has(q, "ajuda", "help", "o que voce faz", "o que pode", "comandos", "como usar",
    "quais perguntas", "o que posso", "o que sabe"))
    return { intent: "AJUDA" };

  // ── CONTRATOS ──

  // Número de contrato explícito (padrão: dígitos + ponto/barra + dígitos)
  const numContratoRaw = q.match(/(\d{4,}[.\-\/]\d{3,}(?:[.\-\/]\d+)?)/);
  if (numContratoRaw && !has(q, "processo"))
    return { intent: "CONTRATO_BUSCA", extract: numContratoRaw[1] };

  // "contrato <termo>" — busca pelo que vier depois
  const contratoExplicito = q.match(/contratos?\s+(n[o°]?\.?\s*)?([\w.\-\/]+)/i);
  if (contratoExplicito && !has(q, "total", "resumo", "quantos", "vencendo", "vigente", "saldo", "uge"))
    return { intent: "CONTRATO_BUSCA", extract: contratoExplicito[2] };

  // Vencimento
  if (has(q, "vencer", "vencendo", "vencimento", "expirar", "vigencia", "proximo vencer",
    "vai vencer", "vai expirar", "encerrar"))
    return { intent: "CONTRATO_VENCIMENTO" };

  // Saldo total
  if (has(q, "saldo total", "total saldo", "saldo disponivel", "total disponivel",
    "quanto disponivel", "quanto tem", "total de saldo"))
    return { intent: "CONTRATO_SALDO_TOTAL" };

  // Por UGE
  if (has(q, "por uge", "por unidade gestora", "uge", "por setor") && has(q, "contrato", "saldo"))
    return { intent: "CONTRATO_POR_UGE" };

  // Vigentes
  if ((has(q, "vigentes", "ativos", "em vigor") && has(q, "contrato")) ||
    q === "contratos vigentes" || q === "contratos ativos")
    return { intent: "CONTRATO_VIGENTES" };

  // Resumo contratos
  if (has(q, "contrato", "contratos") &&
    has(q, "resumo", "quantos", "total", "todos", "lista", "listar", "geral"))
    return { intent: "CONTRATO_RESUMO" };

  // Genérico contratos
  if (has(q, "contratos", "contrato") && !has(q, "processo"))
    return { intent: "CONTRATO_RESUMO" };

  // ── PROCESSOS ──

  // Número de processo explícito
  const numProcessoExplicito = q.match(/processo[s\s:]*(?:n[o°]?\.?\s*)?([\w.\-\/]+)/i);
  if (numProcessoExplicito && !has(q, "resumo", "quantos", "total", "andamento", "homologad"))
    return { intent: "PROCESSO_BUSCA", extract: numProcessoExplicito[1] };

  // Busca por objeto (palavras-chave de licitação)
  if (has(q, "pregao", "dispensa", "inexigibilidade", "licitacao", "licitacoes") &&
    has(q, "buscar", "encontrar", "pesquisar", "qual", "quais"))
    return { intent: "PROCESSO_BUSCA", extract: q };

  // Andamento
  if (has(q, "em andamento", "andamento", "aberto", "abertos", "em aberto"))
    return { intent: "PROCESSO_ANDAMENTO" };

  // Homologado / encerrado
  if (has(q, "homologado", "homologada", "homologados", "encerrado", "concluido", "finalizado"))
    return { intent: "PROCESSO_HOMOLOGADO" };

  // Valores
  if (has(q, "valor estimado", "valor homologado", "economia", "menor preco", "mais caro", "maior valor"))
    return { intent: "PROCESSO_VALORES" };

  // Resumo processos
  if (has(q, "processo", "processos", "licitacao", "licitacoes", "pregao", "dispensa"))
    return { intent: "PROCESSO_RESUMO" };

  // ── GERENCIAMENTO (relação contratos↔indicadores) ──

  if (
    has(q, "gerenciamento") ||
    (has(q, "relacao", "relação", "vinculo", "vinculado", "ligacao") && has(q, "contrato", "indicador", "empenho")) ||
    (has(q, "contrato") && has(q, "indicador") && has(q, "empenho"))
  )
    return { intent: "GERENCIAMENTO_RESUMO" };

  // ── INDICADORES DE LOTAÇÃO ──

  // "empenhos do indicador C26001" ou "empenhos do C26001" → EMPENHO_INDICADOR
  const ccEmpenhoMatch = q.match(/\b(c\d{4,})\b/i);
  if (ccEmpenhoMatch && has(q, "empenho", "empenhos", "ne ", "nota de empenho"))
    return { intent: "EMPENHO_INDICADOR", extract: ccEmpenhoMatch[1].toUpperCase() };

  // Busca por código conta corrente específico sem empenho (ex: "indicador C26001")
  if (ccEmpenhoMatch)
    return { intent: "INDICADOR_BUSCA", extract: ccEmpenhoMatch[1].toUpperCase() };

  // Resumo / consulta indicadores
  if (has(q, "indicador", "indicadores", "conta corrente", "lotacao", "dotacao", "nota de credito", "nota credito"))
    return { intent: "INDICADOR_RESUMO" };

  // ── EMPENHOS ──

  // "empenhos do contrato 67615.039/2024"
  const contratoEmpenhoMatch = q.match(/(\d{4,}[.\-\/]\d{3,}(?:[.\-\/]\d+)?)/);
  if (contratoEmpenhoMatch && has(q, "empenho", "empenhos", "ne "))
    return { intent: "EMPENHO_CONTRATO", extract: contratoEmpenhoMatch[1] };

  // Número NE específico
  const neMatch = q.match(/\b(\d{4}ne\d{3,})\b/i);
  if (neMatch)
    return { intent: "EMPENHO_RESUMO", extract: neMatch[1].toUpperCase() };

  // BI — termos específicos da aba Controle Empenhos (antes do check genérico de empenho)
  if (has(q, "controle empenhos") || has(q, "dias pendentes") ||
      has(q, "ug cred") || has(q, "solicitacao de empenho") || has(q, "ug credora"))
    return { intent: "PAINEL_BI", extract: "empenhos" };

  if (has(q, "empenho", "empenhos", "nota de empenho", "ne "))
    return { intent: "EMPENHO_RESUMO" };

  // ── PAINEL BI (Power BI) ──────────────────────────────────────────────────
  if (has(q, "painel bi", "powerbi", "power bi"))
    return { intent: "PAINEL_BI", extract: "geral" };

  if (has(q, "a liquidar") || has(q, "a pagar") || has(q, "credito recebido") ||
      has(q, "carrossel") || has(q, "ranking unidade") || has(q, "credito disponivel"))
    return { intent: "PAINEL_BI", extract: "controle" };

  if ((has(q, "como funciona") || has(q, "como usar") || has(q, "explicar") || has(q, "o que mostra")) && has(q, "painel"))
    return { intent: "PAINEL_BI", extract: "geral" };

  return { intent: "KB_FALLBACK" };
}

// ─── Respostas ────────────────────────────────────────────────────────────────

function respondSaudacao(nome: string): string {
  return (
    `Olá, ${nome}! Sou o assistente do GAP-MN 👋\n\n` +
    `Posso responder perguntas sobre:\n` +
    `• Contratos (SCON) — saldos, vencimentos, vigências, fornecedores\n` +
    `• Processos Licitatórios (SLIC) — situação, valores, modalidades\n` +
    `• Indicadores de Lotação (SEO) — dotação, utilização, saldo por conta corrente\n` +
    `• Empenhos (SEO) — NE, valor empenhado, liquidado, saldo do empenho\n` +
    `• Gerenciamento — vínculo entre contratos, empenhos e indicadores\n` +
    `• Painel BI — explicação dos visuais do Power BI ao lado\n\n` +
    `Digite "ajuda" para ver exemplos de perguntas.`
  );
}

function respondAjuda(): string {
  return (
    `📚 Exemplos de perguntas que posso responder:\n\n` +
    `📋 CONTRATOS\n` +
    `  "Qual o saldo total disponível?"\n` +
    `  "Contratos vencendo nos próximos 30 dias"\n` +
    `  "Quais contratos estão vigentes?"\n` +
    `  "Contrato 67615.039/2024"\n` +
    `  "Resumo dos contratos"\n` +
    `  "Saldo por UGE"\n\n` +
    `📄 PROCESSOS\n` +
    `  "Processos em andamento"\n` +
    `  "Processos homologados"\n` +
    `  "Resumo dos processos licitatórios"\n` +
    `  "Maiores valores de processo"\n` +
    `  "Processo 12345/2025"\n\n` +
    `📊 INDICADORES DE LOTAÇÃO (SEO)\n` +
    `  "Resumo dos indicadores de lotação"\n` +
    `  "Indicador C26001"\n` +
    `  "Resumo dos empenhos"\n` +
    `  "Empenho 2026NE0050"\n` +
    `  "Empenhos do indicador C26001"\n` +
    `  "Empenhos do contrato 67615.039/2024"\n\n` +
    `🔗 GERENCIAMENTO\n` +
    `  "Gerenciamento dos contratos"\n` +
    `  "Relação entre contratos e indicadores"\n` +
    `  "Vínculos empenho e contrato"\n\n` +
    `📊 PAINEL BI\n` +
    `  "Como funciona o painel BI?"\n` +
    `  "O que mostra o Painel de Controle?"\n` +
    `  "O que é a aba Controle Empenhos?"\n` +
    `  "O que é o gráfico A Liquidar?"\n` +
    `  "Como usar o gráfico dias pendentes?"\n\n` +
    `Dica: se não encontrar resposta, clique em\n` +
    `"Não consegui resolver minha dúvida" para falar com o setor.`
  );
}

// ── Contratos ─────────────────────────────────────────────────────────────────

async function respondContratoBusca(extract: string): Promise<string> {
  const clean = extract.replace(/[^a-z0-9.\-\/]/gi, "").trim();
  const { data, error } = await supabase
    .from("contratos_scon")
    .select("numero_contrato, descricao, fornecedor, uge, ugr, saldo, data_inicio, data_final, vl_contratual, vl_empenhado, vl_liquidado")
    .ilike("numero_contrato", `%${clean}%`)
    .limit(6);

  if (error) return `Erro ao buscar contrato: ${error.message}`;
  if (!data || data.length === 0)
    return `Não encontrei contrato com "${extract}".\n\nTente digitar parte do número ou use "resumo dos contratos" para ver a lista.`;

  const arr = data as any[];
  if (arr.length === 1) {
    const c = arr[0];
    const dias = daysUntil(c.data_final);
    const alertaVenc =
      dias <= 0
        ? "\n🔴 ATENÇÃO: Contrato VENCIDO!"
        : dias <= 30
        ? `\n🔴 Vence em ${dias} dia${dias !== 1 ? "s" : ""}!`
        : dias <= 90
        ? `\n🟡 Vence em ${dias} dias.`
        : "";

    return (
      `📄 ${c.numero_contrato}\n` +
      `Objeto: ${c.descricao ?? "–"}\n` +
      `Fornecedor: ${c.fornecedor ?? "–"}\n` +
      `UGE: ${c.uge ?? "–"}${c.ugr ? ` / UGR: ${c.ugr}` : ""}\n` +
      `Vigência: ${fmtDate(c.data_inicio)} → ${fmtDate(c.data_final)}${alertaVenc}\n\n` +
      `💰 Valor Contratual: ${fmtMoney(c.vl_contratual)}\n` +
      `📊 Empenhado: ${fmtMoney(c.vl_empenhado)}\n` +
      `✅ Liquidado: ${fmtMoney(c.vl_liquidado)}\n` +
      `💵 Saldo Disponível: ${fmtMoney(c.saldo)}`
    );
  }

  return (
    `Encontrei ${arr.length} contratos com "${extract}":\n\n` +
    arr
      .map(
        (c: any) =>
          `• ${c.numero_contrato}\n  ${c.fornecedor ?? "–"} | Saldo: ${fmtMoney(c.saldo)} | Vence: ${fmtDate(c.data_final)}`
      )
      .join("\n\n") +
    `\n\nDigite o número completo para ver os detalhes.`
  );
}

async function respondContratoVencimento(): Promise<string> {
  const hoje = isoToday();
  const em90 = isoInDays(90);

  const { data, error } = await supabase
    .from("contratos_scon")
    .select("numero_contrato, fornecedor, data_final, saldo, uge, descricao")
    .gte("data_final", hoje)
    .lte("data_final", em90)
    .order("data_final", { ascending: true })
    .limit(20);

  if (error) return `Erro ao consultar vencimentos: ${error.message}`;
  if (!data || data.length === 0)
    return "✅ Nenhum contrato vence nos próximos 90 dias.";

  const arr = data as any[];
  const em30 = isoInDays(30);
  const em60 = isoInDays(60);
  const crit = arr.filter((c: any) => c.data_final <= em30);
  const med  = arr.filter((c: any) => c.data_final > em30 && c.data_final <= em60);
  const ok   = arr.filter((c: any) => c.data_final > em60);

  const fmt = (c: any) => {
    const dias = daysUntil(c.data_final);
    const emoji = dias <= 30 ? "🔴" : dias <= 60 ? "🟡" : "🟢";
    return `${emoji} ${c.numero_contrato}\n   ${c.fornecedor ?? "–"} | ${fmtDate(c.data_final)} (${dias}d) | Saldo: ${fmtMoney(c.saldo)}`;
  };

  const lines: string[] = [];
  if (crit.length) lines.push(`🔴 Críticos — vence em ≤30d (${crit.length}):\n` + crit.map(fmt).join("\n"));
  if (med.length)  lines.push(`🟡 Atenção — vence em 31–60d (${med.length}):\n` + med.map(fmt).join("\n"));
  if (ok.length)   lines.push(`🟢 OK — vence em 61–90d (${ok.length}):\n` + ok.map(fmt).join("\n"));

  return `📅 Contratos vencendo nos próximos 90 dias:\n\n` + lines.join("\n\n");
}

async function respondContratoSaldoTotal(): Promise<string> {
  const { data, error } = await supabase
    .from("contratos_scon")
    .select("saldo, vl_contratual, vl_empenhado, vl_liquidado, status, uge");

  if (error) return `Erro ao calcular saldo: ${error.message}`;
  if (!data || data.length === 0) return "Nenhum contrato cadastrado ainda.";

  const arr = data as any[];
  const totalSaldo      = arr.reduce((s: number, c: any) => s + (c.saldo ?? 0), 0);
  const totalContratual = arr.reduce((s: number, c: any) => s + (c.vl_contratual ?? 0), 0);
  const totalEmpenhado  = arr.reduce((s: number, c: any) => s + (c.vl_empenhado ?? 0), 0);
  const totalLiquidado  = arr.reduce((s: number, c: any) => s + (c.vl_liquidado ?? 0), 0);

  const byUge: Record<string, number> = {};
  for (const c of arr) {
    const uge = (c.uge as string) ?? "Sem UGE";
    byUge[uge] = (byUge[uge] ?? 0) + ((c.saldo as number) ?? 0);
  }
  const ugeLines = Object.entries(byUge)
    .sort(([, a], [, b]) => b - a)
    .map(([uge, s]) => `   ${uge}: ${fmtMoney(s)}`)
    .join("\n");

  const pctExecutado = totalContratual > 0
    ? (((totalContratual - totalSaldo) / totalContratual) * 100).toFixed(1)
    : "0";

  return (
    `💰 Saldo Total Disponível: ${fmtMoney(totalSaldo)}\n\n` +
    `📊 Valor Contratual Total: ${fmtMoney(totalContratual)}\n` +
    `📌 Empenhado Total: ${fmtMoney(totalEmpenhado)}\n` +
    `✅ Liquidado Total: ${fmtMoney(totalLiquidado)}\n` +
    `📈 Execução: ${pctExecutado}%\n\n` +
    `Saldo por UGE:\n${ugeLines}`
  );
}

async function respondContratoPorUge(): Promise<string> {
  const { data, error } = await supabase
    .from("contratos_scon")
    .select("uge, saldo, vl_contratual, numero_contrato");

  if (error) return `Erro ao consultar por UGE: ${error.message}`;
  if (!data || data.length === 0) return "Nenhum contrato cadastrado.";

  const arr = data as any[];
  const byUge: Record<string, { contratos: number; saldo: number; contratual: number }> = {};
  for (const c of arr) {
    const uge = (c.uge as string) ?? "Sem UGE";
    if (!byUge[uge]) byUge[uge] = { contratos: 0, saldo: 0, contratual: 0 };
    byUge[uge].contratos++;
    byUge[uge].saldo += (c.saldo as number) ?? 0;
    byUge[uge].contratual += (c.vl_contratual as number) ?? 0;
  }

  const lines = Object.entries(byUge)
    .sort(([, a], [, b]) => b.saldo - a.saldo)
    .map(([uge, v]) => `📍 ${uge}\n   ${v.contratos} contrato${v.contratos !== 1 ? "s" : ""} | Contratual: ${fmtMoney(v.contratual)} | Saldo: ${fmtMoney(v.saldo)}`);

  return `📊 Contratos e Saldos por UGE:\n\n` + lines.join("\n\n");
}

async function respondContratoVigentes(): Promise<string> {
  const hoje = isoToday();
  const { data, error } = await supabase
    .from("contratos_scon")
    .select("numero_contrato, fornecedor, saldo, data_final, uge, descricao")
    .ilike("status", "%vigent%")
    .gte("data_final", hoje)
    .order("data_final", { ascending: true })
    .limit(25);

  if (error) return `Erro ao consultar vigentes: ${error.message}`;
  if (!data || data.length === 0)
    return "Nenhum contrato com status 'Vigente' encontrado.\n\nUse 'resumo dos contratos' para ver todos os cadastros.";

  const arr = data as any[];
  return (
    `✅ Contratos Vigentes (${arr.length}):\n\n` +
    arr
      .map((c: any) => {
        const dias = daysUntil(c.data_final);
        const emoji = dias <= 30 ? "🔴" : dias <= 90 ? "🟡" : "🟢";
        return `${emoji} ${c.numero_contrato}\n   ${c.fornecedor ?? "–"} | Saldo: ${fmtMoney(c.saldo)} | Vence: ${fmtDate(c.data_final)}`;
      })
      .join("\n\n")
  );
}

async function respondContratoResumo(): Promise<string> {
  const { data, error } = await supabase
    .from("contratos_scon")
    .select("status, saldo, vl_contratual, data_final, uge");

  if (error) return `Erro ao carregar contratos: ${error.message}`;
  if (!data || data.length === 0)
    return "Nenhum contrato cadastrado. Importe uma planilha Excel na aba de Contratos (acesse via Gerenciamento).";

  const arr    = data as any[];
  const hoje   = isoToday();
  const em30   = isoInDays(30);
  const em90   = isoInDays(90);

  const vigentes  = arr.filter((c: any) => (c.status ?? "").toLowerCase().includes("vigent")).length;
  const venc30    = arr.filter((c: any) => c.data_final && c.data_final >= hoje && c.data_final <= em30).length;
  const venc90    = arr.filter((c: any) => c.data_final && c.data_final >= hoje && c.data_final <= em90).length;
  const vencidos  = arr.filter((c: any) => c.data_final && c.data_final < hoje).length;
  const semData   = arr.filter((c: any) => !c.data_final).length;

  const totalSaldo      = arr.reduce((s: number, c: any) => s + ((c.saldo as number) ?? 0), 0);
  const totalContratual = arr.reduce((s: number, c: any) => s + ((c.vl_contratual as number) ?? 0), 0);
  const uges = [...new Set(arr.map((c: any) => c.uge).filter(Boolean))];

  return (
    `📋 Resumo Geral de Contratos — SCON\n\n` +
    `Total cadastrado: ${arr.length}\n` +
    `Vigentes: ${vigentes}\n` +
    `Vencendo em ≤30d: ${venc30} ${venc30 > 0 ? "🔴" : "✅"}\n` +
    `Vencendo em ≤90d: ${venc90} ${venc90 > 0 ? "🟡" : "✅"}\n` +
    `Vencidos: ${vencidos} ${vencidos > 0 ? "🔴" : "✅"}\n` +
    (semData > 0 ? `Sem data final: ${semData}\n` : "") +
    `\n💰 Valor Contratual Total: ${fmtMoney(totalContratual)}\n` +
    `💵 Saldo Disponível Total: ${fmtMoney(totalSaldo)}\n` +
    `\nUGEs: ${uges.length > 0 ? uges.join(", ") : "–"}\n` +
    `\nDigite "contratos vencendo" para ver os que expiram em breve.`
  );
}

// ── Processos ─────────────────────────────────────────────────────────────────

async function respondProcessoBusca(extract: string): Promise<string> {
  const clean = extract.trim();
  const { data, error } = await supabase
    .from("processos_licitatorios")
    .select("numero_processo, objeto, modalidade, ano, situacao_api, valor_estimado, valor_homologado, data_publicacao, abertura_proposta, encerramento_proposta, link_sistema, chave, processo_controle(status_livre, pag, om)")
    .or(`numero_processo.ilike.%${clean}%,objeto.ilike.%${clean}%`)
    .limit(5);

  if (error) return `Erro ao buscar processo: ${error.message}`;
  if (!data || data.length === 0)
    return `Não encontrei processo com "${extract}".\n\nTente buscar por parte do número ou palavras-chave do objeto.`;

  const arr = data as any[];
  if (arr.length === 1) {
    const p = arr[0];
    const ctrl = (p.processo_controle as any[])?.[0];
    const sit = p.valor_homologado != null
      ? "✅ Homologada"
      : (p.situacao_api ?? "").toLowerCase().includes("revogad")
      ? `🟣 ${p.situacao_api}`
      : (p.situacao_api ?? "").toLowerCase().includes("suspens")
      ? `🟡 ${p.situacao_api}`
      : "🔵 Em Andamento";

    return (
      `📄 ${p.numero_processo ?? p.chave} — ${p.ano}\n` +
      `Modalidade: ${p.modalidade ?? "–"}\n` +
      `Situação: ${sit}\n` +
      (ctrl?.status_livre ? `Status Interno: ${ctrl.status_livre}\n` : "") +
      (ctrl?.pag ? `PAG: ${ctrl.pag}\n` : "") +
      (ctrl?.om ? `OM: ${ctrl.om}\n` : "") +
      `\nPublicação: ${fmtDate(p.data_publicacao)}\n` +
      `Abertura: ${fmtDate(p.abertura_proposta)}\n` +
      `Encerramento: ${fmtDate(p.encerramento_proposta)}\n` +
      `\n💰 Valor Estimado: ${fmtMoney(p.valor_estimado)}\n` +
      (p.valor_homologado != null
        ? `✅ Valor Homologado: ${fmtMoney(p.valor_homologado)}\n`
        : "") +
      `\nObjeto: ${p.objeto ?? "–"}`
    );
  }

  return (
    `Encontrei ${arr.length} processos com "${extract}":\n\n` +
    arr
      .map((p: any) => {
        const sit = p.valor_homologado != null ? "✅ Homologado" : "🔵 Em andamento";
        return `• ${p.numero_processo ?? "–"} (${p.ano}) — ${sit}\n  ${(p.objeto ?? "").slice(0, 80)}`;
      })
      .join("\n\n") +
    `\n\nDigite o número completo para ver detalhes.`
  );
}

async function respondProcessoAndamento(): Promise<string> {
  const { data, error } = await supabase
    .from("processos_licitatorios")
    .select("numero_processo, objeto, ano, valor_estimado, data_publicacao, abertura_proposta, situacao_api, processo_controle(status_livre)")
    .is("valor_homologado", null)
    .order("data_publicacao", { ascending: false })
    .limit(20);

  if (error) return `Erro ao consultar processos: ${error.message}`;
  if (!data || data.length === 0) return "Nenhum processo em andamento encontrado.";

  const arr = (data as any[]).filter(
    (p: any) =>
      !((p.situacao_api ?? "").toLowerCase().match(/revogad|suspens|encerrad/))
  );

  if (arr.length === 0) return "Nenhum processo ativamente em andamento (todos encerrados, revogados ou suspensos).";

  return (
    `🔵 Processos em Andamento (${arr.length}):\n\n` +
    arr
      .map((p: any) => {
        const sl = (p.processo_controle as any[])?.[0]?.status_livre;
        return (
          `• ${p.numero_processo ?? "–"} (${p.ano})\n` +
          `  ${(p.objeto ?? "").slice(0, 70)}\n` +
          `  Est: ${fmtMoney(p.valor_estimado)} | Publ: ${fmtDate(p.data_publicacao)}` +
          (sl ? ` | Status: ${sl}` : "")
        );
      })
      .join("\n\n")
  );
}

async function respondProcessoHomologado(): Promise<string> {
  const { data, error } = await supabase
    .from("processos_licitatorios")
    .select("numero_processo, objeto, ano, valor_estimado, valor_homologado, data_publicacao, modalidade")
    .not("valor_homologado", "is", null)
    .order("data_publicacao", { ascending: false })
    .limit(15);

  if (error) return `Erro ao consultar processos: ${error.message}`;
  if (!data || data.length === 0) return "Nenhum processo homologado encontrado.";

  const arr = data as any[];
  const totalEst = arr.reduce((s: number, p: any) => s + ((p.valor_estimado as number) ?? 0), 0);
  const totalHom = arr.reduce((s: number, p: any) => s + ((p.valor_homologado as number) ?? 0), 0);
  const economia = totalEst > 0 ? (((totalEst - totalHom) / totalEst) * 100).toFixed(1) : "0";

  return (
    `✅ Processos Homologados (${arr.length}):\n\n` +
    arr
      .map((p: any) => {
        const eco =
          p.valor_estimado && p.valor_homologado
            ? ` (−${((((p.valor_estimado as number) - (p.valor_homologado as number)) / (p.valor_estimado as number)) * 100).toFixed(1)}%)`
            : "";
        return (
          `• ${p.numero_processo ?? "–"} (${p.ano})\n` +
          `  ${(p.objeto ?? "").slice(0, 70)}\n` +
          `  Est: ${fmtMoney(p.valor_estimado)} → Hom: ${fmtMoney(p.valor_homologado)}${eco}`
        );
      })
      .join("\n\n") +
    (parseFloat(economia) > 0
      ? `\n\n📉 Economia média geral: ${economia}%\n` +
        `   Valor Estimado Total: ${fmtMoney(totalEst)}\n` +
        `   Valor Homologado Total: ${fmtMoney(totalHom)}`
      : "")
  );
}

async function respondProcessoValores(): Promise<string> {
  const { data, error } = await supabase
    .from("processos_licitatorios")
    .select("numero_processo, objeto, ano, valor_estimado, valor_homologado, modalidade")
    .not("valor_estimado", "is", null)
    .order("valor_estimado", { ascending: false })
    .limit(10);

  if (error) return `Erro ao consultar valores: ${error.message}`;
  if (!data || data.length === 0) return "Nenhum processo com valores cadastrados.";

  return (
    `💰 Top 10 por Valor Estimado:\n\n` +
    (data as any[])
      .map((p: any, i: number) => {
        const eco =
          p.valor_homologado != null && p.valor_estimado
            ? ` → Hom: ${fmtMoney(p.valor_homologado)} (−${((((p.valor_estimado as number) - (p.valor_homologado as number)) / (p.valor_estimado as number)) * 100).toFixed(1)}%)`
            : "";
        return (
          `${i + 1}. ${p.numero_processo ?? "–"} (${p.ano})\n` +
          `   Est: ${fmtMoney(p.valor_estimado)}${eco}\n` +
          `   ${(p.objeto ?? "").slice(0, 60)}`
        );
      })
      .join("\n\n")
  );
}

async function respondProcessoResumo(): Promise<string> {
  const { data, error } = await supabase
    .from("processos_licitatorios")
    .select("ano, modalidade, valor_estimado, valor_homologado, situacao_api");

  if (error) return `Erro ao carregar processos: ${error.message}`;
  if (!data || data.length === 0)
    return "Nenhum processo licitatório cadastrado. Acesse Gerenciamento → Sincronizar para importar dados.";

  const arr   = data as any[];
  const anos  = [...new Set(arr.map((p: any) => p.ano as number))].sort((a, b) => b - a);

  const homologados = arr.filter((p: any) => p.valor_homologado != null).length;
  const revogados   = arr.filter((p: any) => (p.situacao_api ?? "").toLowerCase().includes("revogad")).length;
  const suspensos   = arr.filter((p: any) => (p.situacao_api ?? "").toLowerCase().includes("suspens")).length;
  const andamento   = arr.length - homologados - revogados - suspensos;

  const totalEst = arr.reduce((s: number, p: any) => s + ((p.valor_estimado as number) ?? 0), 0);
  const totalHom = arr.reduce((s: number, p: any) => s + ((p.valor_homologado as number) ?? 0), 0);
  const economia = totalEst > 0 ? (((totalEst - totalHom) / totalEst) * 100).toFixed(1) : null;

  const byModal: Record<string, number> = {};
  for (const p of arr) {
    const m = (p.modalidade as string) ?? "Sem modalidade";
    byModal[m] = (byModal[m] ?? 0) + 1;
  }
  const modalLines = Object.entries(byModal)
    .sort(([, a], [, b]) => b - a)
    .map(([m, n]) => `   ${m}: ${n}`)
    .join("\n");

  return (
    `📊 Resumo Geral de Processos Licitatórios\n\n` +
    `Total: ${arr.length} | Anos: ${anos.slice(0, 4).join(", ")}\n\n` +
    `🔵 Em Andamento: ${andamento}\n` +
    `✅ Homologados: ${homologados}\n` +
    `🟣 Revogados: ${revogados}\n` +
    `🟡 Suspensos: ${suspensos}\n\n` +
    `💰 Valor Estimado Total: ${fmtMoney(totalEst)}\n` +
    `✅ Valor Homologado Total: ${fmtMoney(totalHom)}\n` +
    (economia ? `📉 Economia Média: ${economia}%\n\n` : "\n") +
    `Por Modalidade:\n${modalLines}`
  );
}

// ── Indicadores de Lotação ────────────────────────────────────────────────────

async function respondIndicadorResumo(): Promise<string> {
  const { data, error } = await supabase
    .from("indicadores_lotacao")
    .select("conta_corrente, dotacao, utilizacao, saldo, natureza, plano_interno, ug_cred");

  if (error) return `Erro ao consultar indicadores: ${error.message}`;
  if (!data || data.length === 0)
    return (
      "Nenhum indicador de lotação importado ainda.\n\n" +
      "O setor SEO é responsável pela importação diária da planilha de Consulta de Conta Corrente.\n" +
      "Acesse: Gerenciamento → aba 'Indicadores de Lotação'."
    );

  const arr = data as any[];
  const totalDotacao   = arr.reduce((s: number, r: any) => s + (r.dotacao    ?? 0), 0);
  const totalUtilizado = arr.reduce((s: number, r: any) => s + (r.utilizacao ?? 0), 0);
  const totalSaldo     = arr.reduce((s: number, r: any) => s + (r.saldo      ?? 0), 0);
  const codigosUnicos  = new Set(arr.map((r: any) => r.conta_corrente as string));
  const comSaldo       = [...codigosUnicos].filter((cc) =>
    arr.filter((r: any) => r.conta_corrente === cc).reduce((s: number, r: any) => s + (r.saldo ?? 0), 0) > 0
  ).length;
  const pctExec = totalDotacao > 0 ? ((totalUtilizado / totalDotacao) * 100).toFixed(1) : "0";

  // Top naturezas por saldo
  const byNatureza: Record<string, { dotacao: number; saldo: number }> = {};
  for (const r of arr) {
    const n = (r.natureza as string) ?? "Sem natureza";
    if (!byNatureza[n]) byNatureza[n] = { dotacao: 0, saldo: 0 };
    byNatureza[n].dotacao += (r.dotacao as number) ?? 0;
    byNatureza[n].saldo   += (r.saldo   as number) ?? 0;
  }
  const natLines = Object.entries(byNatureza)
    .sort(([, a], [, b]) => b.saldo - a.saldo)
    .slice(0, 5)
    .map(([n, v]) => `   ${n}: Dotação ${fmtMoney(v.dotacao)} | Saldo ${fmtMoney(v.saldo)}`)
    .join("\n");

  return (
    `📊 Indicadores de Lotação — Resumo SEO\n\n` +
    `Códigos distintos: ${codigosUnicos.size} (${comSaldo} com saldo disponível)\n` +
    `Total de registros (notas de crédito): ${arr.length}\n\n` +
    `💰 Dotação Total: ${fmtMoney(totalDotacao)}\n` +
    `📊 Utilizado: ${fmtMoney(totalUtilizado)} (${pctExec}%)\n` +
    `💵 Saldo Disponível: ${fmtMoney(totalSaldo)}\n\n` +
    `Por Natureza de Despesa:\n${natLines}\n\n` +
    `Acesse a aba "Indicadores de Lotação" para filtros detalhados.`
  );
}

async function respondIndicadorBusca(extract: string): Promise<string> {
  const { data, error } = await supabase
    .from("indicadores_lotacao")
    .select("conta_corrente, descricao, ug_cred, natureza, ptres, plano_interno, acao, dotacao, utilizacao, saldo, nota_credito")
    .ilike("conta_corrente", `%${extract}%`)
    .limit(20);

  if (error) return `Erro ao buscar indicador: ${error.message}`;
  if (!data || data.length === 0)
    return `Não encontrei o indicador "${extract}".\n\nVerifique o código (ex: C26001) ou use "resumo dos indicadores" para ver todos.`;

  const arr = data as any[];
  const totalDotacao   = arr.reduce((s: number, r: any) => s + (r.dotacao    ?? 0), 0);
  const totalUtilizado = arr.reduce((s: number, r: any) => s + (r.utilizacao ?? 0), 0);
  const totalSaldo     = arr.reduce((s: number, r: any) => s + (r.saldo      ?? 0), 0);
  const r0 = arr[0];

  return (
    `📋 Indicador ${r0.conta_corrente}\n` +
    `Descrição: ${r0.descricao ?? "–"}\n` +
    `UG CRED: ${r0.ug_cred ?? "–"} | Natureza: ${r0.natureza ?? "–"}\n` +
    `PTRES: ${r0.ptres ?? "–"} | PI: ${r0.plano_interno ?? "–"} | Ação: ${r0.acao ?? "–"}\n\n` +
    `Notas de Crédito (${arr.length}):\n` +
    arr.map((r: any) =>
      `   • ${r.nota_credito ?? "–"} → Dotação: ${fmtMoney(r.dotacao)} | Saldo: ${fmtMoney(r.saldo)}`
    ).join("\n") +
    `\n\n💰 Totais:\n` +
    `   Dotação: ${fmtMoney(totalDotacao)}\n` +
    `   Utilizado: ${fmtMoney(totalUtilizado)}\n` +
    `   Saldo Disponível: ${fmtMoney(totalSaldo)}`
  );
}

async function respondEmpenhoResumo(extract?: string): Promise<string> {
  // If a specific empenho number was extracted, search for it
  if (extract && extract.toUpperCase().includes("NE")) {
    const { data, error } = await supabase
      .from("empenhos_seo")
      .select("empenho, empresa, valor, liquidado, saldo_emp, contrato, indicador_lotacao, licitacao_siasg")
      .ilike("empenho", `%${extract}%`)
      .limit(10);

    if (error) return `Erro ao buscar empenho: ${error.message}`;
    if (!data || data.length === 0)
      return `Não encontrei o empenho "${extract}".\n\nVerifique o número (ex: 2026NE0050) ou use "resumo dos empenhos" para ver todos.`;

    const arr = data as any[];
    return (
      `📋 Empenho${arr.length > 1 ? "s" : ""} encontrado${arr.length > 1 ? "s" : ""}:\n\n` +
      arr.map((e: any) => {
        const ref = e.contrato ?? e.licitacao_siasg ?? "–";
        return (
          `• ${e.empenho}\n` +
          `  Empresa: ${e.empresa ?? "–"}\n` +
          `  Indicador de Lotação: ${e.indicador_lotacao ?? "–"}\n` +
          `  💰 Valor: ${fmtMoney(e.valor)}\n` +
          `  ✅ Liquidado: ${fmtMoney(e.liquidado)}\n` +
          `  💵 Saldo do Empenho: ${fmtMoney(e.saldo_emp)}\n` +
          `  Contrato/SIASG: ${ref}`
        );
      }).join("\n\n")
    );
  }

  // General summary
  const { data, error } = await supabase
    .from("empenhos_seo")
    .select("empenho, empresa, valor, liquidado, saldo_emp, contrato, indicador_lotacao");

  if (error) return `Erro ao consultar empenhos: ${error.message}`;
  if (!data || data.length === 0)
    return (
      "Nenhum empenho importado ainda.\n\n" +
      "O setor SEO importa a planilha de empenhos na aba 'Indicadores de Lotação' → sub-aba 'Empenhos'."
    );

  const arr = data as any[];
  const totalValor     = arr.reduce((s: number, e: any) => s + ((e.valor      as number) ?? 0), 0);
  const totalLiquidado = arr.reduce((s: number, e: any) => s + ((e.liquidado  as number) ?? 0), 0);
  const totalSaldo     = arr.reduce((s: number, e: any) => s + ((e.saldo_emp  as number) ?? 0), 0);
  const comIndicador   = arr.filter((e: any) => e.indicador_lotacao).length;

  const byContrato: Record<string, number> = {};
  for (const e of arr) {
    const c = (e.contrato as string) ?? "Sem contrato";
    byContrato[c] = (byContrato[c] ?? 0) + ((e.valor as number) ?? 0);
  }
  const topContratos = Object.entries(byContrato)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([c, v]) => `   ${c}: ${fmtMoney(v)}`)
    .join("\n");

  const pctExec = totalValor > 0 ? ((totalLiquidado / totalValor) * 100).toFixed(1) : "0";

  return (
    `📋 Empenhos SEO — Resumo\n\n` +
    `Total de empenhos: ${arr.length}\n` +
    `Com indicador de lotação: ${comIndicador} de ${arr.length}\n` +
    `Contratos referenciados: ${Object.keys(byContrato).filter(k => k !== "Sem contrato").length}\n\n` +
    `💰 Valor Total Empenhado: ${fmtMoney(totalValor)}\n` +
    `✅ Total Liquidado: ${fmtMoney(totalLiquidado)} (${pctExec}%)\n` +
    `💵 Saldo Total dos Empenhos: ${fmtMoney(totalSaldo)}\n\n` +
    `Top contratos por valor empenhado:\n${topContratos}\n\n` +
    `Dica: pergunte "empenhos do indicador C26001" ou "empenhos do contrato X" para filtrar.`
  );
}

async function respondEmpenhoIndicador(cc: string): Promise<string> {
  const { data, error } = await supabase
    .from("empenhos_seo")
    .select("empenho, empresa, valor, liquidado, saldo_emp, contrato, licitacao_siasg")
    .ilike("indicador_lotacao", `%${cc}%`)
    .order("empenho", { ascending: false })
    .limit(20);

  if (error) return `Erro ao buscar empenhos do indicador: ${error.message}`;
  if (!data || data.length === 0)
    return (
      `Não encontrei empenhos vinculados ao indicador "${cc}".\n\n` +
      `Verifique se o código está correto (ex: C26001) e se os empenhos já foram importados na aba "Empenhos".`
    );

  const arr = data as any[];
  const totalValor     = arr.reduce((s: number, e: any) => s + ((e.valor     as number) ?? 0), 0);
  const totalLiquidado = arr.reduce((s: number, e: any) => s + ((e.liquidado as number) ?? 0), 0);
  const totalSaldo     = arr.reduce((s: number, e: any) => s + ((e.saldo_emp as number) ?? 0), 0);

  return (
    `📋 Empenhos do Indicador ${cc} (${arr.length} NE):\n\n` +
    arr.map((e: any) => {
      const ref = e.contrato ?? e.licitacao_siasg ?? "–";
      return (
        `• ${e.empenho}  |  ${fmtMoney(e.valor)}\n` +
        `  Liq: ${fmtMoney(e.liquidado)}  Saldo: ${fmtMoney(e.saldo_emp)}  Ref: ${ref}`
      );
    }).join("\n\n") +
    `\n\n💰 Totais:\n` +
    `   Empenhado: ${fmtMoney(totalValor)}\n` +
    `   Liquidado: ${fmtMoney(totalLiquidado)}\n` +
    `   Saldo dos Empenhos: ${fmtMoney(totalSaldo)}`
  );
}

async function respondEmpenhoContrato(contratoNum: string): Promise<string> {
  const clean = contratoNum.replace(/[^a-z0-9.\-\/]/gi, "").trim();
  const { data, error } = await supabase
    .from("empenhos_seo")
    .select("empenho, empresa, valor, liquidado, saldo_emp, indicador_lotacao, licitacao_siasg")
    .ilike("contrato", `%${clean}%`)
    .order("empenho", { ascending: false })
    .limit(20);

  if (error) return `Erro ao buscar empenhos: ${error.message}`;
  if (!data || data.length === 0)
    return (
      `Não encontrei empenhos para o contrato "${contratoNum}".\n\n` +
      `Verifique o número do contrato ou use "resumo dos empenhos" para ver todos.`
    );

  const arr = data as any[];
  const totalValor     = arr.reduce((s: number, e: any) => s + ((e.valor     as number) ?? 0), 0);
  const totalLiquidado = arr.reduce((s: number, e: any) => s + ((e.liquidado as number) ?? 0), 0);
  const totalSaldo     = arr.reduce((s: number, e: any) => s + ((e.saldo_emp as number) ?? 0), 0);
  const indicadores    = [...new Set(arr.map((e: any) => e.indicador_lotacao as string).filter(Boolean))];

  return (
    `📋 Empenhos do Contrato ${contratoNum} (${arr.length} NE):\n\n` +
    arr.map((e: any) =>
      `• ${e.empenho}  |  ${fmtMoney(e.valor)}\n` +
      `  Indicador: ${e.indicador_lotacao ?? "–"}  Liq: ${fmtMoney(e.liquidado)}  Saldo: ${fmtMoney(e.saldo_emp)}`
    ).join("\n\n") +
    (indicadores.length > 0
      ? `\n\n🔗 Indicadores vinculados: ${indicadores.join(", ")}`
      : "") +
    `\n\n💰 Totais:\n` +
    `   Empenhado: ${fmtMoney(totalValor)}\n` +
    `   Liquidado: ${fmtMoney(totalLiquidado)}\n` +
    `   Saldo dos Empenhos: ${fmtMoney(totalSaldo)}`
  );
}

async function respondGerenciamentoResumo(): Promise<string> {
  const [{ data: contratos, error: erC }, { data: empenhos, error: erE }] = await Promise.all([
    supabase.from("contratos_scon").select("numero_contrato, saldo, uge, acao"),
    supabase.from("empenhos_seo").select("contrato, indicador_lotacao"),
  ]);

  if (erC) return `Erro ao consultar contratos: ${erC.message}`;
  if (erE) return `Erro ao consultar empenhos: ${erE.message}`;
  if (!contratos || contratos.length === 0)
    return "Nenhum contrato cadastrado. Importe uma planilha Excel na aba 'Contratos'.";

  const arrC = contratos as any[];
  const arrE = (empenhos ?? []) as any[];

  // Build map: contrato → set of indicadores diretos
  const empByContrato: Record<string, Set<string>> = {};
  for (const e of arrE) {
    if (!e.contrato) continue;
    if (!empByContrato[e.contrato]) empByContrato[e.contrato] = new Set();
    if (e.indicador_lotacao) empByContrato[e.contrato].add(e.indicador_lotacao as string);
  }

  let comDireto = 0, semEmpenho = 0, comEmpenhoSemIndicador = 0;
  const totalValor = arrC.reduce((s: number, c: any) => s + ((c.saldo as number) ?? 0), 0);

  for (const c of arrC) {
    const num = c.numero_contrato as string;
    const emps = empByContrato[num];
    if (!emps) {
      semEmpenho++;
    } else if (emps.size > 0) {
      comDireto++;
    } else {
      comEmpenhoSemIndicador++;
    }
  }

  const semEmpenhoExemplos = arrC
    .filter((c: any) => !empByContrato[c.numero_contrato])
    .slice(0, 3)
    .map((c: any) => `   • ${c.numero_contrato} (Saldo: ${fmtMoney(c.saldo)})`)
    .join("\n");

  return (
    `🔗 Gerenciamento dos Contratos — Resumo\n\n` +
    `Total de contratos: ${arrC.length}\n` +
    `Total de empenhos (NE): ${arrE.length}\n\n` +
    `✅ Com indicador de lotação direto: ${comDireto}\n` +
    `   (empenho vinculado tem campo "indicador_lotacao" preenchido)\n\n` +
    `⚠️  Com empenho mas sem indicador: ${comEmpenhoSemIndicador}\n` +
    `   (NE importada sem o campo indicador_lotacao)\n\n` +
    `🔍 Sem empenhos cadastrados: ${semEmpenho}\n` +
    `   (indicadores podem ser sugeridos por ação/UGE)\n` +
    (semEmpenhoExemplos ? `   Exemplos:\n${semEmpenhoExemplos}\n` : "") +
    `\n💵 Saldo Total dos Contratos: ${fmtMoney(totalValor)}\n\n` +
    `Acesse "Gerenciamento dos Contratos" para ver o detalhamento por contrato.`
  );
}

// ── Painel BI (Power BI) ──────────────────────────────────────────────────────

function respondPainelBI(extract?: string): string {
  const sub = (extract ?? "geral").toLowerCase();

  if (sub === "controle") {
    return (
      `📊 Aba "Painel de Controle" — Power BI GAP-MN\n\n` +
      `Acompanha o orçamento das OMs com os seguintes visuais:\n\n` +
      `🃏 KPIs no topo:\n` +
      `   • Crédito Recebido — total de crédito recebido no período\n` +
      `   • Empenhado — total já empenhado\n` +
      `   • %_Empenhado — percentual do crédito já executado\n\n` +
      `📱 Carrossel — "Crédito Recebido por Unidade (2026)":\n` +
      `   Cartões clicáveis por OM. Ao clicar em uma unidade,\n` +
      `   todos os visuais são filtrados e abre drill-through:\n` +
      `   OM | Ação | PI | ND | Disp (saldo disponível)\n\n` +
      `📈 Gráfico de barras — "Crédito por Meses (2026)":\n` +
      `   Evolução mensal do crédito. Clique num mês para filtrar.\n` +
      `   Drill-through: Data | Fonte | PI | PTRES | ND | Ação | Crédito\n\n` +
      `📊 Barras horizontais — "A Liquidar":\n` +
      `   Valor empenhado ainda não liquidado, por unidade.\n\n` +
      `📊 Barras horizontais — "A Pagar":\n` +
      `   Valor liquidado ainda não pago, por unidade.\n` +
      `   Drill-through: Data | Fonte | PI | PTRES | ND | Ação | valor\n\n` +
      `🏆 Tabela de ranking (lado direito, fundo escuro):\n` +
      `   Unidades em ordem decrescente de crédito disponível.\n\n` +
      `⚙️ Filtros laterais: Selecione a OM | ND | Ação\n` +
      `   São globais e afetam todos os visuais simultaneamente.\n` +
      `   A data de atualização aparece no rodapé do menu lateral.`
    );
  }

  if (sub === "empenhos") {
    return (
      `📋 Aba "Controle Empenhos" — Power BI GAP-MN\n\n` +
      `Acompanha operacionalmente as solicitações de empenho.\n\n` +
      `🔢 KPI central — "Solicitações Recebidas - 2026":\n` +
      `   Total de solicitações do ano, com dois indicadores:\n` +
      `   • Verde (%) → Resolvidas\n` +
      `   • Amarelo (%) → Pendentes (backlog)\n\n` +
      `📋 Tabela principal de empenhos:\n` +
      `   Colunas: Data | UGCred | Solicitação | SP | Siafi\n` +
      `   Ao clicar em uma linha, aparece tooltip com resumo completo:\n` +
      `   "A Solicitação Nº XXXX enviada em DD/MM por [OM]\n` +
      `    encontra-se como pendente.\n` +
      `    Subprocesso: XXX | Empenho SILOMS: XXX\n` +
      `    Empenho SIAFI: 2026NEXXX | Status: [descrição]"\n\n` +
      `📊 Gráfico "Dias pendentes por solicitação" (lado direito):\n` +
      `   Barras horizontais com cores por criticidade:\n` +
      `   🔴 Vinho — prazo crítico (muitos dias em aberto)\n` +
      `   🔴 Vermelho — prazo em alerta\n` +
      `   🟡 Amarelo — prazo aceitável\n` +
      `   Permite identificar solicitações prioritárias rapidamente.\n\n` +
      `⚙️ Filtros laterais:\n` +
      `   • Selecione a OM — filtra por unidade\n` +
      `   • Pesquise por Solicitação — localiza pelo número (ex: 26M0001)\n\n` +
      `Obs: os filtros desta aba são independentes dos filtros\n` +
      `da aba "Painel de Controle".`
    );
  }

  // Geral
  return (
    `📊 Painel BI — GAP-MN (Power BI)\n\n` +
    `O painel lateral possui duas abas principais:\n\n` +
    `1️⃣ Painel de Controle (Crédito)\n` +
    `   Acompanha o orçamento: crédito recebido por OM, valor\n` +
    `   empenhado, % executado, A Liquidar, A Pagar e ranking\n` +
    `   de crédito disponível por unidade.\n\n` +
    `2️⃣ Controle Empenhos\n` +
    `   Monitora solicitações de empenho: total recebidas, %\n` +
    `   resolvidas/pendentes, tabela com tooltip detalhado e\n` +
    `   gráfico de "dias pendentes" por solicitação.\n\n` +
    `⚙️ Todos os visuais são interativos — clicar em barras ou\n` +
    `   cartões filtra a página e abre drill-through detalhado.\n\n` +
    `Navegação lateral (menu esquerdo do Power BI):\n` +
    `   • Página Inicial\n` +
    `   • Painel de Controle  ← aba principal\n` +
    `   • Controle Empenhos\n\n` +
    `Pergunte sobre uma aba específica:\n` +
    `  "O que mostra o Painel de Controle?"\n` +
    `  "Como funciona a aba Controle Empenhos?"\n` +
    `  "O que é o gráfico A Liquidar?"`
  );
}

// ── Fallback: base de conhecimento manual ─────────────────────────────────────

async function respondKbFallback(question: string): Promise<string> {
  const q = norm(question);
  const { data } = await supabase
    .from("kb_entries")
    .select("answer, question, intent")
    .limit(200);

  const entries = (data ?? []) as any[];
  const qWords  = q.split(/\s+/).filter((w) => w.length > 3);

  let bestAnswer = "";
  let bestScore  = 0;

  for (const e of entries) {
    const eq = norm(e.question ?? "");
    const ei = norm(e.intent ?? "");

    if (eq === q) return e.answer as string; // exact
    if (ei && q.includes(ei)) return e.answer as string; // intent exact

    const eWords = eq.split(/\s+/).filter((w) => w.length > 3);
    const overlap = qWords.filter((w) => eWords.includes(w)).length;
    const score   = eWords.length > 0 ? overlap / eWords.length : 0;

    if (score > 0.4 && score > bestScore) {
      bestScore  = score;
      bestAnswer = e.answer as string;
    }
  }

  if (bestAnswer) return bestAnswer;

  return (
    "Não encontrei uma resposta para essa pergunta.\n\n" +
    "Tente perguntar sobre:\n" +
    "• Contratos: 'saldo total', 'contratos vencendo', 'contratos vigentes'\n" +
    "• Processos: 'processos em andamento', 'processos homologados'\n" +
    "• Indicadores: 'resumo dos indicadores', 'indicador C26001'\n" +
    "• Painel BI: 'como funciona o painel', 'aba controle empenhos'\n\n" +
    "Ou clique em 'Não consegui resolver minha dúvida' para falar com o setor."
  );
}

// ─── Exportação principal ─────────────────────────────────────────────────────

export async function getBotResponse(
  question: string,
  context: { nome?: string } = {}
): Promise<string> {
  const q = norm(question);
  const { intent, extract } = detectIntent(q);

  switch (intent) {
    case "SAUDACAO":            return respondSaudacao(context.nome ?? "usuário");
    case "AJUDA":               return respondAjuda();
    case "CONTRATO_BUSCA":      return respondContratoBusca(extract ?? question.trim());
    case "CONTRATO_VENCIMENTO": return respondContratoVencimento();
    case "CONTRATO_SALDO_TOTAL":return respondContratoSaldoTotal();
    case "CONTRATO_POR_UGE":    return respondContratoPorUge();
    case "CONTRATO_VIGENTES":   return respondContratoVigentes();
    case "CONTRATO_RESUMO":     return respondContratoResumo();
    case "PROCESSO_BUSCA":      return respondProcessoBusca(extract ?? question.trim());
    case "PROCESSO_ANDAMENTO":  return respondProcessoAndamento();
    case "PROCESSO_HOMOLOGADO": return respondProcessoHomologado();
    case "PROCESSO_VALORES":    return respondProcessoValores();
    case "PROCESSO_RESUMO":     return respondProcessoResumo();
    case "INDICADOR_RESUMO":     return respondIndicadorResumo();
    case "INDICADOR_BUSCA":      return respondIndicadorBusca(extract ?? question.trim());
    case "EMPENHO_RESUMO":       return respondEmpenhoResumo(extract);
    case "EMPENHO_INDICADOR":    return respondEmpenhoIndicador(extract ?? question.trim());
    case "EMPENHO_CONTRATO":     return respondEmpenhoContrato(extract ?? question.trim());
    case "GERENCIAMENTO_RESUMO": return respondGerenciamentoResumo();
    case "PAINEL_BI":            return respondPainelBI(extract);
    default:                     return respondKbFallback(question);
  }
}
