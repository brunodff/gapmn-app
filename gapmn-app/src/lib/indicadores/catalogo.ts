// Catálogo de Indicadores de Desempenho — Grupamentos de Apoio (GAPs), versão de 24 JUL 26.
// Ficha técnica de cada indicador (objetivo, origem dos dados, periodicidade, unidade e meta),
// transcrita do PDF do catálogo. Só informativa: não entra em nenhuma conta do painel.
// Se a planilha tiver a aba CATALOGO, ela tem prioridade (permite revisar sem publicar o app).

import type { FichaCatalogo } from "./tipos.ts";

export const VERSAO_CATALOGO = "v24JUL26";

export const CATALOGO_PADRAO: Record<string, FichaCatalogo> = {
  "1": {
    objetivo: "Acompanhar a celeridade da análise do direito a sua publicação em boletim interno.",
    origem: "Portal do Militar (Aplicação FEP) / Sistema de Boletim",
    periodicidade: "Mensal",
    unidade: "Dias úteis",
    meta: "10 dias úteis",
  },
  "2": {
    objetivo: "Determinar a eficiência operacional na análise, conferência e concessão de direitos financeiros ao pessoal militar.",
    origem: "SIGPES (Nº militares do efetivo do GAP e Apoiadas)",
    periodicidade: "Mensal",
    unidade: "Militares / Auxiliar",
    meta: "500 militares atendidos / auxiliar",
  },
  "3": {
    objetivo: "Assegurar a atualização técnica e profissional do efetivo.",
    origem: "Controle próprio do setor de capacitação ou pessoal",
    periodicidade: "Mensal",
    unidade: "Percentual (%)",
    meta: "100%",
  },
  "4": {
    objetivo: "Medir a agilidade no processamento de direitos financeiros já reconhecidos ao beneficiário.",
    origem: "Sistema de Boletim / SIGPP",
    periodicidade: "Mensal",
    unidade: "Dias úteis",
    meta: "2 dias úteis",
  },
  "5": {
    objetivo: "Mensurar a eficiência operacional no lançamento manual dos itens financeiros publicados em boletim.",
    origem: "SIGPES (Nº militares do efetivo do GAP e Apoiadas)",
    periodicidade: "Mensal",
    unidade: "Militares / Auxiliar",
    meta: "400 militares atendidos / auxiliar sacador",
  },
  "6": {
    objetivo: "Assegurar suporte financeiro rápido aos militares e seus dependentes em momento de óbito. A mensuração engloba tanto o pagamento do auxílio quanto o ressarcimento das despesas a partir da apresentação dos documentos comprobatórios.",
    origem: "SIGADAER / SIAFI",
    periodicidade: "Mensal",
    unidade: "Minutos / Horas",
    meta: "≤ 48 horas",
  },
  "7": {
    objetivo: "Acelerar o processamento do direito legal pelas pensionistas, medindo o tempo entre o requerimento e o envio do processo à SDVP/DIRAP.",
    origem: "SIGADAER / SIGPP",
    periodicidade: "Mensal",
    unidade: "Dias úteis",
    meta: "5 dias úteis",
  },
  "8": {
    objetivo: "Evitar demora na autorização para avaliação médica.",
    origem: "Protocolo / Sistema de Boletim",
    periodicidade: "Mensal",
    unidade: "Dias úteis",
    meta: "5 dias úteis",
  },
  "9": {
    objetivo: "Acelerar a publicação do resultado médico para implantação da isenção.",
    origem: "Protocolo da OM de vínculo / Sis. Boletim",
    periodicidade: "Mensal",
    unidade: "Dias úteis",
    meta: "5 dias úteis",
  },
  "10": {
    objetivo: "Acelerar a análise e processamento de requerimentos de revisão de reforma ou auxílio.",
    origem: "Protocolo OM / Sis. Boletim / SIGPP",
    periodicidade: "Mensal",
    unidade: "Dias úteis",
    meta: "5 dias úteis",
  },
  "11": {
    objetivo: "Medir o tempo médio exigido da área técnica para resolução de chamados do Nível 1.",
    origem: "SAU",
    periodicidade: "Mensal",
    unidade: "Horas",
    meta: "≤ 24 horas",
  },
  "12": {
    objetivo: "Dimensionar o esforço (HH) exigido da área técnica para resolução de chamados do Nível 1.",
    origem: "SAU / SIGPES",
    periodicidade: "Mensal",
    unidade: "Homem-Hora / Chamado",
    meta: "Teto de esforço unitário histórico",
  },
  "13": {
    objetivo: "Garantir a infraestrutura de rede para a continuidade das atividades administrativas.",
    origem: "Notificações de Indisponibilidade no SAU / Relatório de Fiscalização",
    periodicidade: "Mensal",
    unidade: "Percentual (%)",
    meta: "99%",
  },
  "14": {
    objetivo: "Mensurar a porcentagem de tempo em que os sistemas corporativos (SIGADAER, SILOMS e SIGPES) permanecem ativos e acessíveis para a continuidade das atividades administrativas.",
    origem: "Notificações de Indisponibilidade no SAU / Relatório de Fiscalização",
    periodicidade: "Mensal",
    unidade: "Percentual (%)",
    meta: "99%",
  },
  "15": {
    objetivo: "Medir a idade média dos ativos de TI para diagnosticar a necessidade de novas aquisições para substituição.",
    origem: "Inventário de TI / SILOMS",
    periodicidade: "Mensal",
    unidade: "Anos",
    meta: "≤ 5 anos (Tempo de depreciação)",
  },
  "16": {
    objetivo: "Monitorar a evolução de documentos pendentes de registro de ciência/análise/providências em comparação ao período anterior, almejando-se a redução contínua das pendências da OM.",
    origem: "SIGADAER",
    periodicidade: "Mensal",
    unidade: "Percentual (%)",
    meta: "Tendência decrescente (Valor negativo)",
  },
  "17.1": {
    objetivo: "Prevenir o descumprimento de prazos legais.",
    origem: "SIGADAER / SIJ",
    periodicidade: "Mensal",
    unidade: "Dias",
    meta: "30 dias corridos (PATD)",
  },
  "17.2": {
    objetivo: "Prevenir o descumprimento de prazos legais.",
    origem: "SIGADAER / SIJ",
    periodicidade: "Mensal",
    unidade: "Dias",
    meta: "20 dias úteis (Sindicância)",
  },
  "17.3": {
    objetivo: "Prevenir o descumprimento de prazos legais.",
    origem: "SIGADAER / SIJ",
    periodicidade: "Mensal",
    unidade: "Dias",
    meta: "40 dias corridos (IPM)",
  },
  "18": {
    objetivo: "Avaliar a eficácia na resolução de procedimentos disciplinares, evitando a prescrição punitiva por excesso de prazo.",
    origem: "Controle próprio da SIJ",
    periodicidade: "Mensal",
    unidade: "Percentual (%)",
    meta: "80%",
  },
  "19": {
    objetivo: "Garantir suporte tempestivo aos militares, medindo o tempo entre a recepção do requerimento e a emissão do parecer de deferimento.",
    origem: "Sistema do Serviço Social",
    periodicidade: "Mensal",
    unidade: "Dias úteis",
    meta: "15 dias corridos",
  },
  "20": {
    objetivo: "Mensurar o ritmo de transição do modelo tradicional de suprimentos para o modelo virtual, avaliando a eficácia da política de migração dos gastos com material de expediente.",
    origem: "SILOMS / Plataforma AVN",
    periodicidade: "Mensal",
    unidade: "Percentual (%)",
    meta: "Atingir ≥ 80% de substituição do gasto total",
  },
  "21": {
    objetivo: "Monitorar o comportamento dos Grupamentos de Apoio quanto à mudança de cultura logística e identificar o nível de preferência operacional.",
    origem: "SILOMS / Plataforma AVN",
    periodicidade: "Mensal",
    unidade: "Percentual (%)",
    meta: "> 75% via AVN",
  },
  "22": {
    objetivo: "Avaliar o ritmo de esvaziamento do estoque físico de material de expediente, medindo se o consumo mensal está superando a entrada.",
    origem: "SIAFI / SILOMS",
    periodicidade: "Mensal",
    unidade: "Percentual (%)",
    meta: "Redução linear de 5% ao mês",
  },
  "23": {
    objetivo: "Estimar o tempo restante para o consumo definitivo do estoque físico remanescente de material de expediente, visando a aquisição Just In Time.",
    origem: "SIAFI / SILOMS",
    periodicidade: "Mensal",
    unidade: "Meses",
    meta: "Redução contínua até 0 (Zero)",
  },
  "24.1": {
    objetivo: "Monitorar a velocidade da instrução processual da fase de planejamento das contratações até a publicação do edital.",
    origem: "SILOMS / PNCP",
    periodicidade: "Mensal",
    unidade: "Dias",
    meta: "70 dias (Baixa complexidade)",
  },
  "24.2": {
    objetivo: "Monitorar a velocidade da instrução processual da fase de planejamento das contratações até a publicação do edital.",
    origem: "SILOMS / PNCP",
    periodicidade: "Mensal",
    unidade: "Dias",
    meta: "97 dias (Média complexidade)",
  },
  "24.3": {
    objetivo: "Monitorar a velocidade da instrução processual da fase de planejamento das contratações até a publicação do edital.",
    origem: "SILOMS / PNCP",
    periodicidade: "Mensal",
    unidade: "Dias",
    meta: "130 dias (Alta complexidade)",
  },
  "25": {
    objetivo: "Mensurar as licitações efetivamente concluídas até o período comparativamente com as licitações previstas no plano para o mesmo período.",
    origem: "PNCP / Controle Interno",
    periodicidade: "Mensal",
    unidade: "Percentual (%)",
    meta: "100%",
  },
  "26": {
    objetivo: "Medir a celeridade do recebimento definitivo a partir da data de apresentação da Nota Fiscal ou Fatura.",
    origem: "SILOMS / SIAFI",
    periodicidade: "Mensal",
    unidade: "Dias úteis",
    meta: "Até 5 dias úteis",
  },
  "27": {
    objetivo: "Monitorar a celeridade na liquidação das despesas para se evitar a incidência de encargos de mora com credores.",
    origem: "SIAFI / SILOMS",
    periodicidade: "Mensal",
    unidade: "Dias úteis",
    meta: "72 horas",
  },
  "28": {
    objetivo: "Medir a celeridade da solicitação de empenho até a sua efetiva emissão.",
    origem: "SIAFI",
    periodicidade: "Mensal",
    unidade: "Horas",
    meta: "72 horas",
  },
  "29": {
    objetivo: "Avaliar a agilidade da emissão do empenho até a assinatura do contrato.",
    origem: "PNCP / MAC-SILOMS",
    periodicidade: "Mensal",
    unidade: "Dias corridos",
    meta: "15 dias corridos",
  },
  "30": {
    objetivo: "Assegurar o cumprimento do prazo legal da assinatura do contrato até a sua publicação.",
    origem: "PNCP / Imprensa Nacional (DOU)",
    periodicidade: "Mensal",
    unidade: "Dias úteis",
    meta: "Até 10 dias úteis",
  },
  "31": {
    objetivo: "Reduzir o tempo de resolução de problemas de manutenção predial e medir a capacidade de atendimento das demandas do período.",
    origem: "Controle próprio da Seção de Infraestrutura e de Serviços Gerais",
    periodicidade: "Mensal",
    unidade: "Percentual (%)",
    meta: "> 70%",
  },
  "32": {
    objetivo: "Aferir o esforço de homem-hora empreendido para a execução direta de manutenção e reparo.",
    origem: "Controle próprio da Seção de Infraestrutura e de Serviços Gerais",
    periodicidade: "Mensal",
    unidade: "Homem-Hora / OS",
    meta: "Teto histórico pré-definido",
  },
  "33": {
    objetivo: "Medir redução das terceirizações priorizando execução direta.",
    origem: "Controle próprio da Seção de Infraestrutura e de Serviços Gerais",
    periodicidade: "Mensal",
    unidade: "Percentual (%)",
    meta: "> 60% internalização",
  },
  "34": {
    objetivo: "Acompanhar a variação do giro logístico de materiais de infraestrutura em contraposição à taxa de internalização de serviços.",
    origem: "SILOMS / Almoxarifado",
    periodicidade: "Mensal",
    unidade: "Razão (Vezes)",
    meta: "Tendência de crescimento",
  },
  "35": {
    objetivo: "Mensurar o engajamento na promoção de atividades que melhorem a qualidade de vida, integração e motivação do efetivo.",
    origem: "Controle próprio do setor de Comunicação Social",
    periodicidade: "Mensal",
    unidade: "Unidade (Número Absoluto)",
    meta: "Mín. 1 evento por mês",
  },
};

/** Catálogo em uso: o do código, sobreposto pelo da planilha (aba CATALOGO) quando houver. */
export function catalogoEfetivo(daPlanilha: Record<string, FichaCatalogo> | undefined): Record<string, FichaCatalogo> {
  const out: Record<string, FichaCatalogo> = { ...CATALOGO_PADRAO };
  for (const [id, ficha] of Object.entries(daPlanilha ?? {})) {
    const base = out[id];
    out[id] = {
      objetivo: ficha.objetivo ?? base?.objetivo ?? null,
      origem: ficha.origem ?? base?.origem ?? null,
      periodicidade: ficha.periodicidade ?? base?.periodicidade ?? null,
      unidade: ficha.unidade ?? base?.unidade ?? null,
      meta: ficha.meta ?? base?.meta ?? null,
    };
  }
  return out;
}
