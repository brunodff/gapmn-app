import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { SparklesCore } from "../components/ui/sparkles";
import FeedNoticias from "../components/FeedNoticias";
import GerenciamentoProcessos from "../components/GerenciamentoProcessos";
import GerenciamentoContratos from "../components/GerenciamentoContratos";
import GerenciamentoEmpenhos from "../components/GerenciamentoEmpenhos";
import IndicadoresLotacao from "../components/IndicadoresLotacao";
import AtasRegistroPreco from "../components/AtasRegistroPreco";
import PainelSolicitacoesEmpenho from "../components/PainelSolicitacoesEmpenho";
import PaineisGerenciais from "../components/PaineisGerenciais";
import PainelRP from "../components/PainelRP";
import PainelProcessos from "../components/PainelProcessos";
import PainelExecucao from "../components/PainelExecucao";
import PainelEmpenhos from "../components/PainelEmpenhos";
import FerramentasGestao from "./FerramentasGestao";

// ── Design tokens ──────────────────────────────────────────────────────────────
const T = {
  bg:    "#060c1c",
  bg2:   "#081124",
  surf:  "rgba(255,255,255,0.035)",
  surf2: "rgba(255,255,255,0.065)",
  bdr:   "rgba(255,255,255,0.08)",
  bdr2:  "rgba(255,255,255,0.14)",
  cyan:  "#38bdf8",
  cyan2: "#0ea5e9",
  green: "#34d399",
  gold:  "#fbbf24",
  vio:   "#a78bfa",
  rose:  "#fb7185",
  txt:   "#eaf1fb",
  muted: "rgba(234,241,251,0.55)",
  font:  "'Plus Jakarta Sans', system-ui, sans-serif",
  mono:  "'JetBrains Mono', 'Fira Mono', monospace",
};
const SW  = "268px";
const SWC = "62px";

const BI_URL = "https://app.powerbi.com/view?r=eyJrIjoiYjJiZWE0NWItZTJkNS00ZjMzLThhYTQtOTNkODhhOGQ3MzM1IiwidCI6IjNhMzY0ZGI2LTg2NmEtNDRkOS1iMzY5LWM1ODk1OWQ0NDhmOCJ9";

// ── Types ──────────────────────────────────────────────────────────────────────
type View =
  | "dashboard" | "processos" | "contratos" | "empenhos" | "indicadores" | "atas" | "solicitacoes"
  | "painel-orcamento" | "painel-empenhos" | "painel-rp" | "painel-processos" | "painel-execucao"
  | "painel-contratos" | "ferramentas" | "admin";

type UserInfo = { id?: string; nome: string; avatarKey?: string | null; setor?: string | null };
type KPIs     = { empenhos: number; processos: number; contratos: number; il: number; atas: number };
type BellItem = { icon: string; text: string; time: string };

const VIEW_LABELS: Record<View, string> = {
  dashboard:          "Dashboard",
  processos:          "Processos Licitatórios",
  contratos:          "Contratos SCON",
  empenhos:           "Empenhos",
  indicadores:        "Indicadores de Lotação",
  atas:               "Atas de Registro de Preço",
  solicitacoes:       "Solicitações de Empenho",
  "painel-orcamento": "Painel Orçamentário",
  "painel-empenhos":  "Painel de Empenhos",
  "painel-rp":        "Painel de RP",
  "painel-processos": "Painel de Processos",
  "painel-execucao":  "Painel de Execução",
  "painel-contratos": "Painel de Contratos",
  ferramentas:        "Ferramentas de Gestão",
  admin:              "Administração",
};

const AVATAR_OPTIONS = [
  { key: "7_homem",    label: "Sgt Homem"  },
  { key: "7_mulher",   label: "Sgt Mulher" },
  { key: "10_homem",   label: "Of Homem"   },
  { key: "10_mulher",  label: "Of Mulher"  },
  { key: "grad_homem", label: "Grad Homem" },
  { key: "grad_mulher",label: "Grad Mulher"},
];

const NOTIF_ICONS: Record<string, string> = {
  contrato: "📋", contratos: "📋",
  processo: "⚖️", processos: "⚖️",
  empenho: "💰", empenhos: "💰",
  indicador: "📊", indicadores: "📊",
  solicitacao: "📥", geral: "📢",
};

// ── Ticker items ───────────────────────────────────────────────────────────────
const TICKER_ITEMS: { cor: string; text: string; img: string }[] = [
  { cor: "#3FA9FF", img: "/gapmn.png",   text: "Maio 2026 — Gerador de Apostilamento com cálculo IPCA via API do Banco Central" },
  { cor: "#3FA9FF", img: "/gapmn.png",   text: "Maio 2026 — Robô de ATAs: coluna de próximo reajuste e sincronização automática" },
  { cor: "#3FA9FF", img: "/gapmn.png",   text: "Maio 2026 — Robô CNET: extração completa de propostas do ComprasNet para planilha" },
  { cor: "#3FA9FF", img: "/gapmn.png",   text: "Maio 2026 — Despachante SILOMS: painel de frases favoritas para despachos rápidos" },
  { cor: "#34d399", img: "/gapmn.png",   text: "Abril 2026 — Assistente SILOMS: leitura e registro automático de andamento de empenhos" },
  { cor: "#34d399", img: "/gapmn.png",   text: "Abril 2026 — Feed de acompanhamentos com notificações push em tempo real" },
  { cor: "#a78bfa", img: "/gapmn.png",   text: "Março 2026 — Indicadores de Lotação e controle de elaboração de processos licitatórios" },
  { cor: "#fb7185", img: "/gapmn.png",   text: "Janeiro 2026 — Lançamento da plataforma GAP-MN com autenticação e perfis por setor" },
  { cor: "#fbbf24", img: "/acantus.png", text: "Acantus — Inspirado na folha de acanto — símbolo da intendência — o Acantus representa a pureza de caráter, a perfeição moral e o trabalho honesto" },
  { cor: "#38bdf8", img: "/gapmn.png",  text: "DOM — Grupamento de Apoio de Manaus - Prover apoio administrativo às organizações sediadas na Guarnição de Aeronáutica de Manaus, com vistas à preservação da capacidade de combate da Força Aérea Brasileira na Amazônia Ocidental." },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function getBrasiliaHour(): number {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })).getHours();
}

function fmtRelTime(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1)  return "agora";
  if (mins < 60) return `há ${mins} min`;
  if (hours < 24) return `há ${hours}h`;
  if (days < 2)  return "ontem";
  return `há ${days} dias`;
}

function getCeliaResponse(text: string, kpis: KPIs): string {
  const q = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // ── Saudações ──────────────────────────────────────────────────────────────
  if (/^(ola|oi|bom dia|boa tarde|boa noite|bem.?vindo|opa|eai|hey|tudo bem|tudo)/.test(q))
    return "Olá! Sou a Cel. Susan Kelly, assistente virtual do GAP-MN. Posso ajudar com empenhos, processos, contratos, ATAs, indicadores, painéis gerenciais e ferramentas. O que deseja saber?";

  // ── Identidade / sistema ───────────────────────────────────────────────────
  if (/quem (e|eh|es) voce|seu nome|como (se chama|voce se)|apresenta/.test(q))
    return "Sou a Cel Int Susan Kelly, assistente virtual do GAP-MN. Fui desenvolvida para ajudar os agentes a navegar pelo sistema, consultar dados e entender as funcionalidades disponíveis no Grupamento de Apoio de Manaus.";

  if (/o que (e|eh|faz|pode|tem)|para que serve|missao.*sistema|o que.*sistema|sistema.*faz|app.*faz|plataforma|gapmn|gap.mn/.test(q))
    return "O GAP-MN centraliza a gestão administrativa do Grupamento de Apoio de Manaus:\n• Processos licitatórios (SLIC)\n• Contratos SCON com geradores de Termo Aditivo e Apostilamento\n• ATAs de Registro de Preço com alertas de reajuste\n• Empenhos SEO com rastreamento SILOMS\n• Indicadores de Lotação\n• Painéis analíticos: Orçamentário, Empenhos, RP, Processos e Execução\n• Ferramentas: Robô CNET, SILOMS Leitor e Despachante";

  // ── Painéis — visão geral ──────────────────────────────────────────────────
  if (/quais painel|todos.*painel|painel.*disponiv|lista.*painel|menu.*painel/.test(q))
    return "Há 5 painéis em Painéis Gerenciais:\n• 💰 Painel Orçamentário — Power BI com execução total da OM\n• 📊 Painel de Empenhos — NEs por OM, gap de SEs sem NE e taxa de atendimento\n• 📋 Painel de RP — Restos a Pagar por UGR com vínculo a contratos\n• 🤖 Painel de Processos — propostas CNET com economia calculada\n• 📈 Painel de Execução — SIAFI: a liquidar, liquidado e pago por unidade";

  // ── Painel Orçamentário (Power BI) ────────────────────────────────────────
  if (/painel.*orcament|orcament.*painel|power.?bi|bi.*embed/.test(q))
    return "O Painel Orçamentário é um embed do Power BI com visão completa da execução orçamentária: dotações, créditos, empenhos e saldo por ND/ação/PI. Acesse: Painéis Gerenciais → Painel Orçamentário.";

  // ── Painel de Empenhos (PaineisGerenciais) ────────────────────────────────
  if (/painel.*empenh|empenh.*painel|gap.*analise|taxa.*atend|ne.*emitida|siloms.*painel/.test(q))
    return "O Painel de Empenhos cruza SILOMS + planilha SEO por OM:\n• NEs emitidas no exercício, valor empenhado e taxa de atendimento\n• Gap: SEs aguardando NE há mais de 7 dias (com campo de justificativa editável)\n• Gráfico mensal de quantidade e valor empenhado\n• Filtro por OM (GAP-MN, DACTA IV, BAMN, CINDACTA IV...)\nFonte: Google Sheets + Supabase (SILOMS).";

  // ── Painel de RP ──────────────────────────────────────────────────────────
  if (/painel.*\brp\b|rp.*painel|restos.*pagar|resto.*pagar/.test(q))
    return "O Painel de Restos a Pagar mostra:\n• RP não processado (empenhado, não liquidado) e RP processado\n• Breakdown por UGR em gráfico de barras empilhado\n• Tabela de NEs com fornecedor, processo, descrição e contrato SCON vinculado\n• Filtro por UGR e busca por NE\nFonte: Google Sheets (rpNE CSV).";

  // ── Painel de Processos ───────────────────────────────────────────────────
  if (/painel.*processo|processo.*painel|cnet.*painel|painel.*licitac|economia.*painel/.test(q))
    return "O Painel de Processos usa dados do Robô CNET para mostrar:\n• Total de processos, itens, fornecedores, valor adjudicado e % de economia\n• Situação dos itens: Homologado, Fracassado, Aguardando Julgamento\n• Tabela hierárquica processo → item → propostas com CNPJ, valores e status coloridos\n• Economia real = valor estimado dos itens julgados − valor negociado\nFonte: tabela cnet_propostas_gapmn (Supabase).";

  // ── Painel de Execução ────────────────────────────────────────────────────
  if (/painel.*execuc|execuc.*painel|siafi.*painel|a.?liquidar|liquidado.*pagar|pago.*siafi/.test(q))
    return "O Painel de Execução lê a planilha SIAFI (Google Sheets) e exibe por OM:\n• NEs a liquidar, liquidado/a pagar e pago (em R$)\n• Top empresas favorecidas (alternável entre gráfico e tabela)\n• Detalhamento de NEs por unidade com cabeçalhos customizados\n• Atualização automática de hora em hora entre 8h e 18h\nAcesse: Painéis Gerenciais → Painel de Execução.";

  // ── Empenhos ──────────────────────────────────────────────────────────────
  if (/quantos empenh|total.*empenh|empenh.*total|numero.*empenh/.test(q))
    return `Há ${kpis.empenhos} empenhos no exercício 2026. Acesse Exec. Orçamentária → Empenhos para ver cada NE SIAFI, perfil SILOMS e situação.`;

  if (/solicitac.*empenh|se.*pendente|pendente.*se\b|26S\d|empenh.*aguard/.test(q))
    return "Solicitações de Empenho (SE) pendentes são aquelas sem NE emitida na planilha SEO. Uma SE sai da lista quando a NE aparece na planilha ou é vinculada pelo Robô SILOMS Leitor Subprocesso. O painel de SEs pendentes mostra o responsável, número SILOMS e subprocesso.";

  if (/empenh|ne.?siafi|nota.*empenh|2026ne|siafi/.test(q))
    return "Em Exec. Orçamentária → Empenhos você acompanha:\n• NE SIAFI vinculada a cada SE do SILOMS\n• Perfil atual no SILOMS (DA | EMPENHOS, AEL, ASSESSORIA...)\n• Solicitações pendentes (SEs sem NE emitida)\n• Upload da planilha SEO para atualizar os dados\n• Feed em tempo real com mudanças registradas pelo Robô SILOMS";

  // ── SILOMS ────────────────────────────────────────────────────────────────
  if (/silom/.test(q))
    return "O SILOMS é acessado via bookmarklets instalados em Ferramentas:\n• Leitor SE — lê situação das SEs e registra no banco\n• Leitor Subprocesso — vincula NE SIAFI ao subprocesso\n• Despachante — painel de frases favoritas para despachos rápidos\nInstale o bookmarklet, acesse o SILOMS no navegador e clique no favorito para ativar o robô.";

  // ── CNET / Robô CNET ──────────────────────────────────────────────────────
  if (/cnet|comprasnet|robo.*cnet|cnet.*robo|extracao.*proposta|proposta.*cnet/.test(q))
    return "O Robô CNET extrai propostas do ComprasNet automaticamente:\n1. Instale o bookmarklet em Ferramentas → Robô CNET\n2. Acesse ComprasNet e abra o processo\n3. Ative o robô — ele navega por cada item coletando CNPJ, valores e status\n4. Os dados vão para a planilha Google Sheets e alimentam o Painel de Processos\nPara ~500 itens, o robô leva cerca de 20 minutos.";

  // ── Processos Licitatórios ────────────────────────────────────────────────
  if (/quantos process|total.*process|process.*total/.test(q))
    return `Existem ${kpis.processos} processos licitatórios cadastrados. Acesse Licitações → Processos.`;

  if (/criterio.*julgamento|menor.*preco|maior.*desconto|tipo.*licitac/.test(q))
    return "O critério de julgamento (Menor Preço, Maior Desconto, Maior Lance) é extraído pelo Robô CNET e aparece na planilha de propostas. Em Licitações → Processos ele está visível no detalhe de cada processo junto com a situação e o pregoeiro responsável.";

  if (/homolog|fracass|deserto|aguard.*julgamento|situac.*process/.test(q))
    return "Situações dos processos no sistema:\n• Aguardando Julgamento / Habilitação\n• Julgado e Habilitado\n• Homologado — com opção de marcar manualmente\n• Fracassado / Deserto\n• Revogado / Anulado\nA situação vem da planilha SLIC ou da homologação manual. O dashboard KPI agrupa por situação.";

  if (/process|licitac|pregao|dispensa|inexigib|edital|pag\b/.test(q))
    return "Em Licitações → Processos você acompanha:\n• Situação, critério e valores (estimado e homologado)\n• Fase externa: pregoeiro, apoiada, data abertura, dias em andamento\n• PAG (Processo Administrativo de Gestão)\n• Sincronização com planilha SLIC\n• Homologação manual para registrar resultado diretamente\nAcesse: Licitações → Processos.";

  // ── Contratos ────────────────────────────────────────────────────────────
  if (/quantos contrato|total.*contrato|contrato.*total/.test(q))
    return `Há ${kpis.contratos} contratos cadastrados. Acesse Contratos para gerenciar.`;

  if (/vencimento|vencido|encerramento|prazo.*contrato|contrato.*prazo/.test(q))
    return "Contratos vencidos aparecem com faixa 'VENCIDO' e alerta de encerramento pendente. O card mostra a data do próximo reajuste colorida: 🔴 atrasado, 🟠 ≤30 dias, 🟡 ≤90 dias, 🟢 ok. Filtre por 'Vencidos' no seletor de status para encontrá-los rapidamente.";

  if (/fiscal.*contrato|contrato.*fiscal|gestor.*contrato/.test(q))
    return "O fiscal do contrato é editável diretamente no painel de detalhes (clique no ícone de edição ao lado do nome). O sistema registra o nome de guerra do fiscal responsável em cada contrato.";

  if (/valor.*atual.*contrato|contrato.*valor.*atual|base.*reajuste/.test(q))
    return "O 'Valor Atual do Contrato' é um campo manual em Contratos → seção Valores Financeiros. Ele serve de base para cálculo dos índices aplicados nos Termos Aditivos e de Apostilamento. Preencha com o valor vigente após cada reajuste.";

  if (/contrato|scon|vigencia|fornecedor|importar.*contrato|planilha.*scon/.test(q))
    return "Em Contratos (SCON) você gerencia:\n• Importação via planilha Excel SCON\n• Dados: vigência, fiscal, UGE/UGR, ação orçamentária, CNPJ, valor\n• Valor atual (base para reajuste em Aditivos/Apostilamentos)\n• Geradores de Termo Aditivo e Apostilamento integrados\n• Data-base do orçamento com cálculo automático do próximo reajuste\nAcesse: menu Contratos.";

  // ── Apostilamento ─────────────────────────────────────────────────────────
  if (/apostilament/.test(q))
    return "O Apostilamento reajusta unilateralmente o contrato (art. 136 Lei 14.133/2021):\n1. Em Contratos, aba Apostilamento: informe a data-base (MM/AAAA)\n2. Clique em '🔖 Gerar Termo de Apostilamento'\n3. O IPCA acumulado é calculado automaticamente via API do Banco Central\n4. O documento é editável: '📝 Editar texto' para personalizar\n5. Salve com Ctrl+S e imprima com Ctrl+P\nOs termos das ATAs de RP ficam em Licitações → Atas de RP.";

  if (/ipca|indice.*reajuste|reajuste.*ipca|banco.*central|inflac/.test(q))
    return "O IPCA é buscado automaticamente via API pública do Banco Central (SIDRA/IBGE). O sistema calcula o índice acumulado desde a data-base do orçamento até o mês atual. O resultado aparece no Gerador de Apostilamento com memória de cálculo detalhada.";

  // ── Termo Aditivo ─────────────────────────────────────────────────────────
  if (/termo.*aditiv|aditiv/.test(q))
    return "O Termo Aditivo modifica cláusulas do contrato original. Em Contratos, aba Aditivo:\n• Clique em '📝 Gerar Termo Aditivo'\n• O documento é editável via '📝 Editar texto'\n• Edições são salvas por contrato no navegador (localStorage)\n• Ctrl+S para salvar rapidamente\n• '🔄 Original' restaura o texto padrão";

  // ── ATAs de Registro de Preço ─────────────────────────────────────────────
  if (/quantas? ata|total.*ata|ata.*total/.test(q))
    return `${kpis.atas} ATAs de Registro de Preços cadastradas. Acesse Licitações → Atas de RP.`;

  if (/reajuste.*ata|ata.*reajuste|vigencia.*ata/.test(q))
    return "ATAs usam ciclo de 11 meses para cálculo de reajuste (contratos: 12 meses). O card mostra a data estimada colorida: 🔴 ≤60 dias, 🟡 ≤120 dias. O Gerador de Apostilamento para ATAs também calcula o IPCA acumulado automaticamente.";

  if (/ata|registro.*prec|prec.*registr/.test(q))
    return "Em Licitações → Atas de RP você gerencia:\n• ATA, UASG, fornecedor, vigência e situação\n• Itens: código, descrição, unidade, quantidade e valor unitário\n• Alertas de reajuste próximo (por cor no card)\n• Sincronização com planilha ComprasNet\n• Gerador de Apostilamento de ATA";

  // ── Indicadores de Lotação ────────────────────────────────────────────────
  if (/quantos indicador|total.*indicador/.test(q))
    return `Há ${kpis.il} indicadores de lotação. Acesse Exec. Orçamentária → Indicadores.`;

  if (/indicador.*lotac|lotac|conta.?corrente|seo|dotacao|utilizac|saldo.*indicador/.test(q))
    return "Em Exec. Orçamentária → Indicadores (SEO):\n• Conta corrente (C26001...), dotação, utilização e saldo\n• Natureza de despesa, ação orçamentária, UG credora\n• Empenhos vinculados ao indicador (NE SIAFI + contrato)\n• Importação via planilha Excel SEO";

  // ── Ferramentas ───────────────────────────────────────────────────────────
  if (/como.*instalar|instalar.*bookmarklet|adicionar.*barra|favorito.*barra/.test(q))
    return "Para instalar um bookmarklet:\n1. Acesse Ferramentas no menu lateral\n2. Escolha o robô e clique em 'Ver instruções'\n3. Clique em '📋 Copiar código'\n4. Crie um favorito no navegador e cole o código no campo URL\n5. Acesse o sistema externo (SILOMS/ComprasNet) e clique no favorito para ativar";

  if (/ferramenta|bookmarklet|robo\b|bot\b|instalar/.test(q))
    return "Ferramentas disponíveis (menu Ferramentas):\n\n💰 Exec. Orçamentária:\n• Leitor SILOMS SE — lê situação das SEs e registra no banco\n• Leitor SILOMS Subprocesso — vincula NE a subprocesso\n• Despachante SILOMS — frases favoritas para despachos rápidos\n\n⚖️ Licitações:\n• Robô CNET — extrai propostas do ComprasNet (~20 min/500 itens)\n• Robô ATAs — sincroniza ATAs de RP";

  // ── Navegação e permissões ────────────────────────────────────────────────
  if (/setor|permissao|acesso|quem pode|slic|scon.*setor|admin/.test(q))
    return "Permissões por setor:\n• SLIC — importa processos licitatórios e planilha fase externa\n• SCON — importa e edita contratos\n• SEO — importa indicadores e empenhos\n• ADMIN / DEV — acesso total\nTodos os setores visualizam todas as abas — a restrição é só em importar/editar.";

  if (/perfil|avatar|nome.*guerra|senha|alterar.*perfil|editar.*perfil/.test(q))
    return "Para editar seu perfil: clique no avatar no canto inferior esquerdo. Você pode alterar avatar (6 opções), nome de guerra e senha de acesso.";

  if (/feed|noticia|novidade|notificac|push/.test(q))
    return "O Feed de Notícias (tela inicial) mostra em tempo real: novas SEs registradas, mudanças de perfil SILOMS, OCs geradas e avisos gerais. Notificações push podem ser ativadas para alertas mesmo fora do app.";

  if (/o\.?m\.|unidade.*gestora|\bug\b|\bugr\b|uasg|gap.mn.*om|dacta|bamn|cindacta|pama|binfae/.test(q))
    return "OMs da Guarnição de Manaus no sistema: GAP-MN, DACTA IV, BAMN, CINDACTA IV, PAMA-MN, BINFAE e outras. Cada OM tem código UGR e aparece nos painéis de Execução e Empenhos com filtro individual.";

  if (/ajuda|como.*usar|como.*funciona|help|tutorial|o que.*posso|menu|navegar/.test(q))
    return "Menu lateral:\n• 🏠 Início — KPIs + feed de notícias\n• ⚖️ Licitações — Processos e ATAs de RP\n• 📑 Contratos — SCON com geradores de documentos\n• 💰 Exec. Orçamentária — Empenhos e Indicadores\n• 📈 Painéis Gerenciais — 5 painéis analíticos\n• 🔧 Ferramentas — robôs e bookmarklets\n\nPergunte sobre qualquer seção para mais detalhes!";

  // ── Fallback ───────────────────────────────────────────────────────────────
  return "Não reconheci sua consulta. Posso ajudar com:\n• Empenhos, NE SIAFI e SILOMS\n• Processos licitatórios e Robô CNET\n• Contratos, apostilamento e termo aditivo\n• ATAs de Registro de Preço\n• Indicadores de Lotação\n• Painéis: Orçamentário, Empenhos, RP, Processos, Execução\n• Ferramentas e bookmarklets\n\nTente reformular sua pergunta!";
}

function injectFonts() {
  if (document.getElementById("gf-dash")) return;
  const l = document.createElement("link");
  l.id = "gf-dash"; l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap";
  document.head.appendChild(l);
}

function useCountUp(target: number, ms = 1100): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!target) { setV(0); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(target); return; }
    const s = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - s) / ms, 1);
      setV(Math.round((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 72, H = 28;
  if (data.length < 2) return <svg width={W} height={H} />;
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const xs = data.map((_, i) => (i / (data.length - 1)) * W);
  const ys = data.map(v => H - 3 - ((v - min) / rng) * (H - 7));
  const pts = data.map((_, i) => `${xs[i]},${ys[i]}`).join(" ");
  return (
    <svg width={W} height={H} style={{ overflow: "visible", flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.72" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="2.5" fill={color} />
    </svg>
  );
}

function fmtSetor(s?: string | null) {
  switch ((s ?? "").toUpperCase()) {
    case "SLIC":  return "Seção de Licitações";
    case "SEO":   return "Exec. Orçamentária";
    case "SCON":  return "Seção de Contratos";
    case "ADMIN": return "Administração";
    case "DEV":   return "Desenvolvimento";
    default: return s ?? "";
  }
}

// ── Nav tree ──────────────────────────────────────────────────────────────────
type NavChild = { label: string; path: string; icon: string; wip?: boolean };
type NavNode  = { id: string; label: string; icon: string; path?: string; children?: NavChild[] };

const NAV: NavNode[] = [
  { id: "home",    label: "Início",              icon: "🏠" },
  { id: "lic",     label: "Licitações",           icon: "⚖️", children: [
    { label: "Processos",  path: "view:processos", icon: "📋" },
    { label: "Atas de RP", path: "view:atas",      icon: "📄" },
  ]},
  { id: "ctr",     label: "Contratos",            icon: "📑", path: "view:contratos" },
  { id: "eo",      label: "Exec. Orçamentária",   icon: "💰", children: [
    { label: "Empenhos",               path: "view:empenhos",       icon: "💵" },
    { label: "Indicadores de Lotação", path: "view:indicadores",    icon: "📊" },
    { label: "Solicitações",           path: "view:solicitacoes",   icon: "📬" },
  ]},
  { id: "paineis", label: "Painéis Gerenciais",   icon: "📈", children: [
    { label: "Painel Orçamentário",  path: "view:painel-orcamento",  icon: "💰" },
    { label: "Painel de Empenhos",   path: "view:painel-empenhos",   icon: "📊" },
    { label: "Painel de RP",         path: "view:painel-rp",         icon: "📋" },
    { label: "Painel de Processos",  path: "view:painel-processos",  icon: "🤖", wip: true },
    { label: "Painel de Execução",   path: "view:painel-execucao",   icon: "📈" },
    { label: "Painel de Contratos",  path: "view:painel-contratos",  icon: "📑", wip: true },
  ]},
  { id: "tools",   label: "Ferramentas",           icon: "🔧", path: "view:ferramentas" },
  { id: "admin",   label: "Administração",          icon: "🛡️", path: "view:admin" },
];

// ── ProfileModal ──────────────────────────────────────────────────────────────
function ProfileModal({ user, onSave, onClose }: {
  user: UserInfo;
  onSave: (updates: { avatarKey?: string; nome?: string; senha?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [sel,     setSel]     = useState(user.avatarKey ?? "grad_homem");
  const [nomeVal, setNomeVal] = useState(user.nome);
  const [senha,   setSenha]   = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState("");

  async function save() {
    if (senha && senha !== confirm) { setErr("Senhas não conferem."); return; }
    if (senha && senha.length < 6)  { setErr("Senha deve ter ao menos 6 caracteres."); return; }
    setErr("");
    setBusy(true);
    await onSave({
      avatarKey: sel,
      nome: nomeVal.trim() !== user.nome ? nomeVal.trim() : undefined,
      senha: senha || undefined,
    });
    setBusy(false);
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(4,8,20,0.75)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{
        background: "rgba(6,12,28,0.98)", backdropFilter: "blur(24px)",
        border: `1px solid ${T.bdr2}`, borderRadius: 18,
        padding: "28px 28px", width: 380,
        boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
        animation: "dashFadeIn 0.22s ease-out",
        maxHeight: "90vh", overflowY: "auto",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.txt, fontFamily: T.font, marginBottom: 18 }}>Editar Perfil</div>

        {/* Avatar preview */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <img src={`/${sel}.png`} alt="avatar"
            style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover",
              border: `2.5px solid ${T.cyan}`, boxShadow: `0 0 18px ${T.cyan}44` }}
            onError={e => { (e.currentTarget as HTMLImageElement).src = "/grad_homem.png"; }}
          />
        </div>

        {/* Avatar grid 3×2 — sem labels */}
        <div style={{ marginBottom: 6, fontSize: 11, color: T.muted, fontFamily: T.font }}>Avatar</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 18 }}>
          {AVATAR_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => setSel(opt.key)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: sel === opt.key ? "rgba(56,189,248,0.12)" : T.surf,
                border: `1.5px solid ${sel === opt.key ? T.cyan : T.bdr}`,
                borderRadius: 10, padding: "8px 6px", cursor: "pointer", transition: "all 0.14s",
              }}>
              <img src={`/${opt.key}.png`} alt={opt.label}
                style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }}
                onError={e => { (e.currentTarget as HTMLImageElement).src = "/grad_homem.png"; }}
              />
            </button>
          ))}
        </div>

        {/* Nome */}
        <div style={{ marginBottom: 6, fontSize: 11, color: T.muted, fontFamily: T.font }}>Nome de Guerra</div>
        <input value={nomeVal} onChange={e => setNomeVal(e.target.value)}
          style={{ width: "100%", background: T.surf, border: `1px solid ${T.bdr}`, borderRadius: 8,
            padding: "8px 12px", marginBottom: 20, color: T.txt, fontSize: 12, fontFamily: T.font,
            outline: "none", boxSizing: "border-box", display: "block" }} />

        {/* Senha */}
        <div style={{ marginBottom: 6, fontSize: 11, color: T.muted, fontFamily: T.font }}>Nova Senha <span style={{ color: T.muted, fontWeight: 400 }}>(opcional)</span></div>
        <input type="password" value={senha} onChange={e => setSenha(e.target.value)}
          placeholder="Deixe em branco para manter"
          style={{ width: "100%", background: T.surf, border: `1px solid ${T.bdr}`, borderRadius: 8,
            padding: "8px 12px", marginBottom: 8, color: T.txt, fontSize: 12, fontFamily: T.font,
            outline: "none", boxSizing: "border-box", display: "block" }} />
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
          placeholder="Confirmar nova senha"
          style={{ width: "100%", background: T.surf, border: `1px solid ${T.bdr}`, borderRadius: 8,
            padding: "8px 12px", marginBottom: err ? 8 : 20, color: T.txt, fontSize: 12, fontFamily: T.font,
            outline: "none", boxSizing: "border-box", display: "block" }} />
        {err && <div style={{ color: T.rose, fontSize: 11, marginBottom: 14, fontFamily: T.font }}>{err}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose}
            style={{ flex: 1, background: T.surf, border: `1px solid ${T.bdr}`,
              borderRadius: 9, padding: "9px 0", color: T.muted, fontSize: 12,
              cursor: "pointer", fontFamily: T.font, transition: "all 0.14s" }}>Cancelar</button>
          <button onClick={save} disabled={busy}
            style={{ flex: 1, background: T.cyan2, border: "none", borderRadius: 9,
              padding: "9px 0", color: "#fff", fontSize: 12, fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer", fontFamily: T.font,
              opacity: busy ? 0.7 : 1, transition: "all 0.14s" }}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

// ── SidebarTicker ─────────────────────────────────────────────────────────────
function SidebarTicker() {
  const [idx,     setIdx]     = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setIdx(i => (i + 1) % TICKER_ITEMS.length); setVisible(true); }, 380);
    }, 10000);
    return () => clearInterval(t);
  }, []);

  const item = TICKER_ITEMS[idx];

  return (
    <div style={{ padding: "8px 12px 6px", flexShrink: 0 }}>
      <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, fontFamily: T.font }}>
        Novidades
      </div>
      <div style={{
        background: T.surf, border: `1px solid ${T.bdr}`, borderRadius: 10,
        overflow: "hidden", opacity: visible ? 1 : 0, transition: "opacity 0.35s ease",
      }}>
        {/* Image strip */}
        <div style={{
          height: 58, background: "rgba(0,0,0,0.35)",
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative", overflow: "hidden",
        }}>
          <img src={item.img} alt=""
            style={{ maxHeight: 42, maxWidth: "80%", objectFit: "contain",
              filter: "brightness(0.9) saturate(1.1)", display: "block" }}
            onError={e => { (e.currentTarget as HTMLImageElement).src = "/gapmn.png"; }}
          />
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background: `linear-gradient(to bottom, transparent 40%, rgba(4,8,20,0.55))`,
          }} />
          <div style={{ position: "absolute", bottom: 5, left: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%",
              background: item.cor, boxShadow: `0 0 6px ${item.cor}99` }} />
          </div>
        </div>
        {/* Text */}
        <div style={{ padding: "8px 10px 10px" }}>
          <span style={{ color: T.txt, fontSize: 10.5, lineHeight: 1.55, fontFamily: T.font }}>{item.text}</span>
        </div>
      </div>
      {/* Dots */}
      <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 6 }}>
        {TICKER_ITEMS.map((_, i) => (
          <div key={i} onClick={() => { setIdx(i); setVisible(true); }}
            style={{
              width: i === idx ? 12 : 4, height: 4, borderRadius: 2,
              cursor: "pointer", transition: "all 0.25s",
              background: i === idx ? T.cyan : T.bdr2,
            }} />
        ))}
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ user, navTo, onView, collapsed, onLogout, onEdit }: {
  user: UserInfo; navTo: (p: string) => void; onView: (v: View) => void;
  collapsed: boolean; onLogout: () => void; onEdit: () => void;
}) {
  const [open,   setOpen]   = useState<Record<string, boolean>>({});
  const [active, setActive] = useState("home");
  const av = user.avatarKey ? `/${user.avatarKey}.png` : "/grad_homem.png";

  const go = (path: string, id: string) => {
    setActive(id);
    if (!path || path === "home") { onView("dashboard"); return; }
    if (path.startsWith("view:")) { onView(path.slice(5) as View); return; }
    if (path.startsWith("nav:"))  { navTo(path.slice(4)); return; }
    navTo(path);
  };

  return (
    <nav style={{
      position: "fixed", left: 0, top: 0, bottom: 0,
      width: collapsed ? SWC : SW, zIndex: 40,
      background: "rgba(4,8,20,0.95)", backdropFilter: "blur(24px) saturate(1.4)",
      borderRight: `1px solid ${T.bdr}`,
      display: "flex", flexDirection: "column",
      transition: "width 0.22s cubic-bezier(.4,0,.2,1)", overflow: "hidden",
    }}>
      {/* Logo */}
      <div style={{
        display: "flex", alignItems: "center", gap: 11,
        padding: collapsed ? "18px 14px" : "18px 18px",
        borderBottom: `1px solid ${T.bdr}`, flexShrink: 0,
        justifyContent: collapsed ? "center" : "flex-start",
      }}>
        <img src="/gapmn.png" alt="GAP-MN"
          style={{ width: 32, height: 32, objectFit: "contain", flexShrink: 0,
            filter: "drop-shadow(0 0 7px rgba(56,189,248,0.4))" }} />
        {!collapsed && (
          <div>
            <div style={{ color: T.txt, fontWeight: 800, fontSize: 13, fontFamily: T.font, lineHeight: 1.25 }}>GAP-MN</div>
            <div style={{ color: T.muted, fontSize: 10, fontFamily: T.font }}>Gestão Orçamentária</div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px", scrollbarWidth: "none" }}>
        {NAV.filter(n => n.id !== "admin" || user.setor === "ADMIN" || user.setor === "DEV").map(n => (
          <div key={n.id}>
            <button
              onClick={() => n.path ? go(n.path, n.id) : n.id === "home" ? go("home", n.id) : setOpen(p => ({ ...p, [n.id]: !p[n.id] }))}
              title={collapsed ? n.label : undefined}
              style={{
                width: "100%", display: "flex", alignItems: "center",
                gap: 9, padding: collapsed ? "10px 0" : "9px 12px",
                justifyContent: collapsed ? "center" : "flex-start",
                borderRadius: 10, border: "none", cursor: "pointer",
                background: active === n.id ? "rgba(56,189,248,0.13)" : "transparent",
                color: active === n.id ? T.cyan : T.txt,
                fontSize: 13, fontWeight: 500, fontFamily: T.font,
                transition: "background 0.14s, color 0.14s", marginBottom: 2,
              }}
              onMouseEnter={e => { if (active !== n.id) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={e => { if (active !== n.id) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <span style={{ fontSize: 15, flexShrink: 0, lineHeight: 1 }}>{n.icon}</span>
              {!collapsed && (
                <>
                  <span style={{ flex: 1, textAlign: "left" }}>{n.label}</span>
                  {n.children && (
                    <span style={{ fontSize: 9, opacity: 0.4, display: "inline-block",
                      transform: open[n.id] ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
                  )}
                </>
              )}
            </button>

            {!collapsed && n.children && open[n.id] && (
              <div style={{ paddingLeft: 12, paddingBottom: 4 }}>
                {n.children.map(c => {
                  const cid = `${n.id}:${c.label}`;
                  return (
                    <button key={c.label}
                      onClick={() => { if (!c.wip) go(c.path, cid); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center",
                        gap: 8, padding: "7px 10px", borderRadius: 8,
                        border: "none", cursor: c.wip ? "not-allowed" : "pointer", textAlign: "left",
                        background: active === cid ? "rgba(56,189,248,0.09)" : "transparent",
                        color: c.wip ? "rgba(148,163,184,0.45)" : active === cid ? T.cyan : T.muted,
                        fontSize: 12, fontFamily: T.font, transition: "color 0.12s, background 0.12s",
                        opacity: c.wip ? 0.75 : 1,
                      }}
                      onMouseEnter={e => { if (!c.wip) (e.currentTarget as HTMLButtonElement).style.color = T.txt; }}
                      onMouseLeave={e => { if (!c.wip) (e.currentTarget as HTMLButtonElement).style.color = active === cid ? T.cyan : T.muted; }}
                    >
                      <span style={{ fontSize: 12 }}>{c.icon}</span>
                      <span style={{ flex: 1 }}>{c.label}</span>
                      {c.wip && (
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 4,
                          background: "rgba(251,146,60,0.18)", color: "#fb923c",
                          border: "1px solid rgba(251,146,60,0.3)", whiteSpace: "nowrap", letterSpacing: "0.02em",
                        }}>em elaboração</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {!collapsed && <SidebarTicker />}

      {/* User chip */}
      <div style={{
        padding: collapsed ? "12px 0" : "11px 14px",
        borderTop: `1px solid ${T.bdr}`,
        display: "flex", alignItems: "center", gap: 9,
        justifyContent: collapsed ? "center" : "flex-start", flexShrink: 0,
      }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <img src={av} alt="avatar"
            style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", border: `2px solid ${T.bdr2}` }}
            onError={e => { (e.currentTarget as HTMLImageElement).src = "/grad_homem.png"; }}
          />
          <span style={{ position: "absolute", bottom: 0, right: 0,
            width: 10, height: 10, borderRadius: "50%",
            background: T.green, border: "2px solid #060c1c" }} />
        </div>
        {!collapsed && (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: T.txt, fontSize: 12, fontWeight: 600, fontFamily: T.font,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.nome}</div>
              <div style={{ color: T.muted, fontSize: 10 }}>{fmtSetor(user.setor)}</div>
            </div>
            <button onClick={onEdit} title="Editar perfil"
              style={{ background: "transparent", border: "none", cursor: "pointer",
                color: T.muted, padding: "3px 5px", lineHeight: 1, borderRadius: 6,
                transition: "color 0.14s", flexShrink: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = T.cyan; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = T.muted; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button onClick={onLogout} title="Sair"
              style={{ background: "transparent", border: "none", cursor: "pointer",
                color: T.muted, padding: "3px 5px", lineHeight: 1, borderRadius: 6,
                transition: "color 0.14s", flexShrink: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = T.rose; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = T.muted; }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </>
        )}
      </div>
    </nav>
  );
}

// ── Topbar ────────────────────────────────────────────────────────────────────
function Topbar({ user, bellCount, bellOpen, bellItems, onBell, onToggle }: {
  user: UserInfo; bellCount: number; bellOpen: boolean;
  bellItems: BellItem[]; onBell: () => void; onToggle: () => void;
}) {
  const h = getBrasiliaHour();
  const greet = h >= 6 && h < 13 ? "Bom dia" : h >= 13 && h < 19 ? "Boa tarde" : "Boa noite";

  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 30,
      height: 58, display: "flex", alignItems: "center",
      padding: "0 24px 0 18px", gap: 14,
      background: "rgba(4,9,22,0.9)", backdropFilter: "blur(18px) saturate(1.3)",
      borderBottom: `1px solid ${T.bdr}`,
    }}>
      <button onClick={onToggle}
        style={{ background: "transparent", border: "none", cursor: "pointer",
          color: T.muted, fontSize: 20, lineHeight: 1, padding: "4px 6px",
          borderRadius: 8, flexShrink: 0, transition: "color 0.14s" }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = T.txt; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = T.muted; }}
      >☰</button>

      <div style={{ flex: 1, color: T.txt, fontSize: 14, fontWeight: 600, fontFamily: T.font }}>
        {greet}, <span style={{ color: T.cyan }}>{user.nome.split(" ")[0]}</span>!
      </div>

      {/* Bell */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button onClick={onBell}
          style={{
            background: bellOpen ? "rgba(56,189,248,0.1)" : T.surf,
            border: `1px solid ${bellOpen ? T.cyan + "70" : T.bdr}`,
            borderRadius: 10, width: 36, height: 36, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: T.txt, fontSize: 16, position: "relative", transition: "all 0.14s",
          }}
        >
          🔔
          {bellCount > 0 && (
            <span style={{
              position: "absolute", top: -4, right: -4,
              background: T.rose, color: "#fff", fontSize: 8, fontWeight: 800,
              width: 16, height: 16, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "2px solid #060c1c",
            }}>{bellCount > 9 ? "9+" : bellCount}</span>
          )}
        </button>

        {bellOpen && (
          <div style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0,
            width: 310, background: "rgba(6,12,28,0.98)",
            backdropFilter: "blur(24px)",
            border: `1px solid ${T.bdr2}`, borderRadius: 14,
            boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
            overflow: "hidden", zIndex: 50,
            animation: "dashFadeIn 0.18s ease-out",
          }}>
            <div style={{ padding: "12px 16px 8px", borderBottom: `1px solid ${T.bdr}`,
              fontSize: 12, fontWeight: 700, color: T.txt, fontFamily: T.font }}>
              Notificações
            </div>
            {bellItems.length === 0 ? (
              <div style={{ padding: "16px", color: T.muted, fontSize: 12, fontFamily: T.font, textAlign: "center" }}>
                Nenhuma notificação pendente
              </div>
            ) : bellItems.map((item, i) => (
              <div key={i} style={{
                padding: "10px 16px", display: "flex", gap: 10, alignItems: "flex-start",
                borderBottom: i < bellItems.length - 1 ? `1px solid ${T.bdr}` : "none",
                cursor: "pointer", transition: "background 0.12s",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = T.surf2; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
                <div>
                  <div style={{ color: T.txt, fontSize: 12, fontFamily: T.font, lineHeight: 1.4 }}>{item.text}</div>
                  <div style={{ color: T.muted, fontSize: 10, marginTop: 2 }}>{item.time}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
type StatProps = { icon: string; label: string; value: number; accent: string; trend: "up" | "dn" | "eq"; pct: number; spark: number[] };

function StatCard({ icon, label, value, accent, trend, pct, spark }: StatProps) {
  const count = useCountUp(value);
  const [hov, setHov] = useState(false);
  const tColor = trend === "up" ? T.green : trend === "dn" ? T.rose : T.muted;
  const tArrow = trend === "up" ? "↑" : trend === "dn" ? "↓" : "→";

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? T.surf2 : T.surf, border: `1px solid ${hov ? T.bdr2 : T.bdr}`,
        borderRadius: 16, padding: "18px 20px 14px", backdropFilter: "blur(14px)",
        transform: hov ? "translateY(-3px)" : "none",
        boxShadow: hov ? `0 10px 36px ${accent}22, 0 2px 12px rgba(0,0,0,0.25)` : "0 1px 8px rgba(0,0,0,0.18)",
        transition: "all 0.18s ease", position: "relative", overflow: "hidden", cursor: "default",
      }}>
      <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80,
        borderRadius: "50%", background: `${accent}16`, filter: "blur(22px)",
        opacity: hov ? 1 : 0.35, transition: "opacity 0.3s", pointerEvents: "none" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, fontSize: 16, background: `${accent}18`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
            <span style={{ color: T.muted, fontSize: 11, fontFamily: T.font }}>{label}</span>
          </div>
          <div style={{ color: T.txt, fontSize: 26, fontWeight: 700, lineHeight: 1, fontFamily: T.mono }}>
            {count.toLocaleString("pt-BR")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 7 }}>
            <span style={{ color: tColor, fontSize: 11, fontWeight: 700 }}>{tArrow} {pct > 0 ? `+${pct}%` : `${pct}%`}</span>
            <span style={{ color: T.muted, fontSize: 10 }}>vs. mês ant.</span>
          </div>
        </div>
        <Sparkline data={spark} color={accent} />
      </div>
    </div>
  );
}

// ── Celia chat ────────────────────────────────────────────────────────────────
function CeliaWidget({ kpis }: { kpis: KPIs }) {
  const [phase, setPhase] = useState<"balloon" | "chat" | "idle">("balloon");
  const [msgs,  setMsgs]  = useState([{ from: "bot", text: "👋 Bem-vindo ao GAP-MN! Como posso ajudar?" }]);
  const [inp,   setInp]   = useState("");
  const [busy,  setBusy]  = useState(false);
  const endRef    = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setPhase(p => p === "balloon" ? "idle" : p), 6500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(override?: string) {
    const t = (override ?? inp).trim();
    if (!t || busy) return;
    setInp("");
    setMsgs(p => [...p, { from: "user", text: t }]);
    setBusy(true);
    await new Promise(r => setTimeout(r, 750));
    setBusy(false);
    setMsgs(p => [...p, { from: "bot", text: getCeliaResponse(t, kpis) }]);
  }

  return (
    <>
    {phase === "chat" && (
      <div onClick={() => setPhase("idle")}
        style={{ position: "fixed", inset: 0, zIndex: 99 }} />
    )}
    <div ref={widgetRef} style={{ position: "fixed", bottom: 22, right: 22, zIndex: 100, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
      {phase === "balloon" && (
        <div style={{
          background: "rgba(6,12,28,0.96)", backdropFilter: "blur(18px)",
          border: `1px solid ${T.cyan}55`, borderRadius: "14px 14px 4px 14px",
          padding: "10px 14px", color: T.txt, fontSize: 13,
          whiteSpace: "nowrap", fontFamily: T.font,
          boxShadow: "0 8px 32px rgba(0,0,0,0.45)", animation: "dashFadeIn 0.3s ease-out",
        }}>👋 Bem-vindo ao GAP-MN!</div>
      )}

      {phase === "chat" && (
        <div style={{
          width: 310, background: "rgba(4,9,22,0.97)", backdropFilter: "blur(24px)",
          border: `1px solid ${T.bdr2}`, borderRadius: 16, overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.65)", animation: "dashFadeIn 0.22s ease-out",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10,
            background: `linear-gradient(135deg, ${T.bg2}, rgba(56,189,248,0.08))`,
            borderBottom: `1px solid ${T.bdr}` }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
              <img src="/CELIA.png" alt="Cel Susan Kelly"
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 8%" }}
                onError={e => { (e.currentTarget as HTMLImageElement).src = "/CELIA.jpg"; }} />
            </div>
            <div>
              <div style={{ color: T.txt, fontSize: 12, fontWeight: 700, fontFamily: T.font }}>Cel Int Susan Kelly</div>
              <div style={{ color: T.green, fontSize: 10, fontFamily: T.font }}>● online</div>
            </div>
            <button onClick={() => setPhase("idle")}
              style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", color: T.muted, fontSize: 16 }}>✕</button>
          </div>

          <div style={{ height: 210, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.from === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "88%", padding: "8px 12px", fontSize: 12, lineHeight: 1.5,
                  borderRadius: m.from === "user" ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                  background: m.from === "user" ? T.cyan2 : T.surf2,
                  color: T.txt, fontFamily: T.font,
                }}>{m.text}</div>
              </div>
            ))}
            {busy && (
              <div style={{ display: "flex" }}>
                <div style={{ padding: "8px 14px", borderRadius: "12px 12px 12px 3px",
                  background: T.surf2, color: T.muted, fontSize: 13, letterSpacing: 3 }}>• • •</div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div style={{ padding: "4px 12px 6px", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Empenhos", "Processos", "ATAs", "Ferramentas"].map(q => (
              <button key={q} onClick={() => send(q)}
                style={{ background: T.surf, border: `1px solid ${T.bdr}`, borderRadius: 6,
                  padding: "3px 9px", fontSize: 10, color: T.muted, cursor: "pointer",
                  fontFamily: T.font, transition: "all 0.12s" }}
                onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = T.cyan; b.style.borderColor = T.cyan + "70"; }}
                onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = T.muted; b.style.borderColor = T.bdr; }}
              >{q}</button>
            ))}
          </div>

          <div style={{ padding: "6px 12px 12px", display: "flex", gap: 8, alignItems: "center" }}>
            <input value={inp} onChange={e => setInp(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") send(); }}
              placeholder="Mensagem…"
              style={{ flex: 1, background: T.surf, border: `1px solid ${T.bdr}`,
                borderRadius: 8, padding: "7px 10px", fontSize: 12,
                color: T.txt, outline: "none", fontFamily: T.font }} />
            <button onClick={() => send()} disabled={busy}
              style={{ background: T.cyan2, border: "none", borderRadius: 8,
                width: 30, height: 30, cursor: "pointer", color: "#fff", fontSize: 14,
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.14s", opacity: busy ? 0.5 : 1 }}
              onMouseEnter={e => { if (!busy) (e.currentTarget as HTMLButtonElement).style.background = T.cyan; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = T.cyan2; }}
            >↑</button>
          </div>
        </div>
      )}

      <button onClick={() => setPhase(p => p === "chat" ? "idle" : "chat")}
        style={{
          width: 60, height: 60, borderRadius: "50%",
          border: `2.5px solid ${T.cyan}`, overflow: "hidden",
          cursor: "pointer", background: "transparent", flexShrink: 0,
          boxShadow: `0 0 22px ${T.cyan}45, 0 4px 18px rgba(0,0,0,0.45)`,
          transition: "transform 0.18s, box-shadow 0.18s",
          animation: "celiaFloat 4.5s ease-in-out infinite",
        }}
        onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.transform = "scale(1.08)"; }}
        onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.transform = "scale(1)"; }}
      >
        <img src="/CELIA.png" alt="Cel. Susan Kelly"
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 8%" }}
          onError={e => { (e.currentTarget as HTMLImageElement).src = "/CELIA.jpg"; }} />
      </button>
    </div>
    </>
  );
}

// ── AdminUsersPanel ───────────────────────────────────────────────────────────
type AdminProfile = { id: string; nome_guerra: string; setor: string | null; email?: string };
const SETORES = ["SEO", "SCON", "SLIC", "ADMIN", "DEV"];

function AdminUsersPanel() {
  const [users,   setUsers]   = useState<AdminProfile[]>([]);
  const [edits,   setEdits]   = useState<Record<string, string>>({});
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [saved,   setSaved]   = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles")
        .select("id, nome_guerra, email, setor")
        .order("nome_guerra");
      setUsers((data ?? []) as AdminProfile[]);
      setLoading(false);
    })();
  }, []);

  async function saveSetor(uid: string) {
    const novoSetor = edits[uid] ?? "";
    setSaving(p => ({ ...p, [uid]: true }));
    await supabase.from("profiles")
      .update({ setor: novoSetor || null })
      .eq("id", uid);
    setUsers(prev => prev.map(u => u.id === uid ? { ...u, setor: novoSetor || null } : u));
    setSaving(p => ({ ...p, [uid]: false }));
    setSaved(p => ({ ...p, [uid]: true }));
    setTimeout(() => setSaved(p => ({ ...p, [uid]: false })), 1800);
  }

  return (
    <div style={{ background: "#0d1117", borderRadius: 16, padding: "24px 28px" }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Gerenciamento de Usuários</div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 20 }}>
        Edite o setor/função de cada usuário. A permissão de importação e edição é determinada pelo setor.
      </div>

      {loading && <div style={{ color: "#64748b", fontSize: 13 }}>Carregando usuários…</div>}

      {!loading && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1e2a3a" }}>
                {["Usuário", "Setor / Função", "Ação"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left",
                    color: "#64748b", fontWeight: 600, fontSize: 10,
                    textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const cur   = edits[u.id] ?? (u.setor ?? "");
                const dirty = cur !== (u.setor ?? "");
                return (
                  <tr key={u.id} style={{ borderBottom: "1px solid #1e2a3a" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>
                        {u.email ?? u.nome_guerra}
                      </div>
                      {u.email && (
                        <div style={{ color: "#64748b", fontSize: 10, marginTop: 1 }}>
                          {u.nome_guerra}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <select
                        value={cur}
                        onChange={e => setEdits(p => ({ ...p, [u.id]: e.target.value }))}
                        style={{ background: "#161b27", border: "1px solid #1e2a3a",
                          borderRadius: 7, padding: "5px 10px", color: "#e2e8f0",
                          fontSize: 12, cursor: "pointer", outline: "none", fontFamily: "inherit" }}>
                        <option value="">— Sem setor —</option>
                        {SETORES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <button
                        onClick={() => saveSetor(u.id)}
                        disabled={!dirty || saving[u.id]}
                        style={{
                          background: saved[u.id] ? "rgba(74,222,128,0.15)" : dirty ? "rgba(34,211,238,0.12)" : "transparent",
                          border: `1px solid ${saved[u.id] ? "#4ade80" : dirty ? "#22d3ee55" : "#1e2a3a"}`,
                          borderRadius: 7, padding: "5px 14px", fontSize: 11, fontWeight: 600,
                          color: saved[u.id] ? "#4ade80" : dirty ? "#22d3ee" : "#334155",
                          cursor: dirty && !saving[u.id] ? "pointer" : "default",
                          transition: "all 0.15s",
                        }}>
                        {saving[u.id] ? "…" : saved[u.id] ? "✓ Salvo" : "Salvar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── BI Painel wrapper ─────────────────────────────────────────────────────────
function PainelOrcamentario() {
  const [key, setKey] = useState(0);
  const [max, setMax] = useState(false);
  const src = `${BI_URL}&_k=${key}`;
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, justifyContent: "flex-end" }}>
        <button onClick={() => setKey(k => k + 1)}
          style={{ background: T.surf, border: `1px solid ${T.bdr}`, borderRadius: 8,
            padding: "6px 14px", color: T.txt, fontSize: 12, cursor: "pointer", fontFamily: T.font }}>
          ↺ Recarregar
        </button>
        <button onClick={() => setMax(true)}
          style={{ background: T.surf, border: `1px solid ${T.bdr}`, borderRadius: 8,
            padding: "6px 14px", color: T.txt, fontSize: 12, cursor: "pointer", fontFamily: T.font }}>
          ⛶ Maximizar
        </button>
      </div>
      <div style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${T.bdr}` }}>
        <iframe key={key} src={src} title="Painel Orçamentário GAP-MN"
          style={{ width: "100%", height: "calc(100dvh - 14rem)", display: "block" }}
          allowFullScreen />
      </div>
      {max && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 16px", borderBottom: "1px solid #e2e8f0", background: "#fff" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Painel Orçamentário — GAP-MN</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setKey(k => k + 1)}
                style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8,
                  padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>↺ Recarregar</button>
              <button onClick={() => setMax(false)}
                style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8,
                  padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>✕ Restaurar</button>
            </div>
          </div>
          <iframe src={`${BI_URL}&_k=${key}-max`} title="Painel Orçamentário Maximizado"
            style={{ flex: 1, width: "100%", display: "block" }} allowFullScreen />
        </div>
      )}
    </>
  );
}


// ── Main dashboard ────────────────────────────────────────────────────────────
export default function AppChat() {
  const navigate   = useNavigate();
  const [user,           setUser]       = useState<UserInfo>({ nome: "…" });
  const [kpis,           setKpis]       = useState<KPIs>({ empenhos: 0, processos: 0, contratos: 0, il: 0, atas: 0 });
  const [collapsed,      setCollapsed]  = useState(false);
  const [bellOpen,       setBellOpen]   = useState(false);
  const [view,           setView]       = useState<View>("dashboard");
  const [filterTipo,     setFilterTipo] = useState("todos");
  const [showProf,       setShowProf]   = useState(false);
  const [userNotifs,     setUserNotifs] = useState<BellItem[]>([]);
  const [userNotifCount, setNotifCount] = useState(0);

  const sw = collapsed ? SWC : SW;

  const isDev        = user.setor === "DEV";
  const canEdit      = isDev || ["ADMIN","SLIC","SCON","SEO"].includes(user.setor ?? "");
  const canImportPrc = isDev || user.setor === "SLIC"  || user.setor === "ADMIN";
  const canImportCtr = isDev || user.setor === "SCON"  || user.setor === "ADMIN";
  const canImportInd = isDev || user.setor === "SEO"   || user.setor === "ADMIN";
  const canSyncEmp         = isDev || user.setor === "SEO"   || user.setor === "ADMIN";
  const canManageSolicit   = isDev || user.setor === "SEO"   || user.setor === "ADMIN";
  const canCreate          = isDev || ["ADMIN","SCON","SLIC","SEO"].includes(user.setor ?? "");

  useEffect(() => {
    injectFonts();
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = ""; };
  }, []);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const u = sess.session?.user;
      if (!u) { navigate("/", { replace: true }); return; }

      const { data: prof } = await supabase
        .from("profiles").select("nome_guerra, avatar_key, setor")
        .eq("id", u.id).maybeSingle();

      setUser({
        id:        u.id,
        nome:      (prof as any)?.nome_guerra || (u.user_metadata as any)?.nome_guerra || u.email?.split("@")[0] || "Usuário",
        avatarKey: (prof as any)?.avatar_key ?? null,
        setor:     (prof as any)?.setor ?? null,
      });

      // Load real notifications
      const { data: notifData } = await supabase
        .from("user_notifications")
        .select("tipo, ref_label, mensagem, created_at, lida")
        .eq("user_id", u.id)
        .order("created_at", { ascending: false })
        .limit(5);

      const notifItems: BellItem[] = (notifData ?? []).map((n: any) => ({
        icon: NOTIF_ICONS[n.tipo] ?? "📢",
        text: ((n.mensagem ?? n.ref_label ?? "Notificação") as string).split("\n")[0].slice(0, 80),
        time: fmtRelTime(n.created_at),
      }));
      setUserNotifs(notifItems);
      setNotifCount((notifData ?? []).filter((n: any) => !n.lida).length);

      const today = new Date().toISOString().split("T")[0];
      const [r1, r2, r3, r4, r5] = await Promise.all([
        supabase.from("siloms_ne_identificadores").select("ne_siafi")
          .ilike("ne_siafi", "2026NE0_____").order("ne_siafi", { ascending: false }).limit(1),
        // "Em Andamento" = not homologado, not revogado/anulado, not suspenso (mirrors calcStatus())
        supabase.from("processos_licitatorios").select("*", { count: "exact", head: true })
          .is("valor_homologado", null)
          .or("homologado_manual.is.null,homologado_manual.eq.false")
          .not("situacao_api", "ilike", "%homolog%")
          .not("situacao_api", "ilike", "%adjudic%")
          .not("situacao_api", "ilike", "%revogad%")
          .not("situacao_api", "ilike", "%anulad%")
          .not("situacao_api", "ilike", "%suspens%"),
        supabase.from("contratos_scon").select("*", { count: "exact", head: true }),
        supabase.from("indicadores_lotacao").select("*", { count: "exact", head: true }),
        supabase.from("atas_gap_mn").select("*", { count: "exact", head: true })
          .gte("vigencia_final", today).not("situacao", "ilike", "%cancelad%"),
      ]);

      const lastNE = (r1.data?.[0] as any)?.ne_siafi ?? "";
      setKpis({
        empenhos:  parseInt(lastNE.slice(-5) || "0", 10),
        processos: r2.count ?? 0,
        contratos: r3.count ?? 0,
        il:        r4.count ?? 0,
        atas:      r5.count ?? 0,
      });
    })();
  }, [navigate]);

  async function saveProfile(updates: { avatarKey?: string; nome?: string; senha?: string }) {
    if (!user.id) return;
    const dbFields: Record<string, string> = {};
    if (updates.avatarKey !== undefined) dbFields.avatar_key = updates.avatarKey;
    if (updates.nome?.trim())            dbFields.nome_guerra = updates.nome.trim();
    if (Object.keys(dbFields).length)
      await supabase.from("profiles").update(dbFields).eq("id", user.id);
    if (updates.senha)
      await supabase.auth.updateUser({ password: updates.senha });
    setUser(prev => ({
      ...prev,
      ...(updates.avatarKey !== undefined ? { avatarKey: updates.avatarKey } : {}),
      ...(updates.nome?.trim() ? { nome: updates.nome.trim() } : {}),
    }));
  }

  const stats: StatProps[] = useMemo(() => {
    const curves: Record<string, number[]> = {
      empenhos:  [0.67,0.72,0.77,0.82,0.87,0.91,0.96],
      processos: [0.80,0.84,0.87,0.91,0.89,0.93,0.97],
      contratos: [0.96,0.98,1.01,0.99,1.02,0.99,1.01],
      il:        [1.08,1.05,1.03,1.02,1.02,1.01,1.00],
      atas:      [0.68,0.74,0.80,0.85,0.89,0.94,0.97],
    };
    function sp(key: keyof typeof curves, base: number): number[] {
      return [...curves[key].map(m => Math.max(1, Math.round(base * m))), base];
    }
    return [
      { icon: "💵", label: "Empenhos 2026",       value: kpis.empenhos,  accent: T.cyan,  trend: "up", pct: 12, spark: sp("empenhos",  kpis.empenhos)  },
      { icon: "⚖️", label: "Processos Ativos",    value: kpis.processos, accent: T.vio,   trend: "up", pct:  5, spark: sp("processos", kpis.processos) },
      { icon: "📑", label: "Contratos",            value: kpis.contratos, accent: T.green, trend: "eq", pct:  0, spark: sp("contratos", kpis.contratos) },
      { icon: "📊", label: "Indicadores de Lot.",  value: kpis.il,        accent: T.gold,  trend: "dn", pct: -3, spark: sp("il",        kpis.il)        },
      { icon: "📄", label: "ATAs Ativas",           value: kpis.atas,     accent: T.rose,  trend: "up", pct:  8, spark: sp("atas",      kpis.atas)      },
    ];
  }, [kpis]);

  const FILTER_OPTS = ["Todos", "Contratos", "Processos", "Empenhos"];

  return (
    <>
      <style>{`
        @keyframes dashFadeIn {
          from { opacity:0; transform:translateY(8px) scale(.97); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        @keyframes celiaFloat {
          0%,100% { transform:translateY(0); }
          50%     { transform:translateY(-6px); }
        }
        .dc { animation: dashFadeIn 0.38s ease-out both; }
        @media (prefers-reduced-motion:reduce) { .dc { animation:none !important; } }
        *,:before,:after { box-sizing:border-box; }
        ::-webkit-scrollbar { width:4px; height:4px; background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.09); border-radius:2px; }
        input::placeholder { color:rgba(234,241,251,0.28) !important; }

        /* ── FeedNoticias dark overrides ───────────────────────────────────── */
        .fdark .bg-white        { background: rgba(255,255,255,0.04) !important; }
        .fdark .border-slate-100 { border-color: rgba(255,255,255,0.07) !important; }
        .fdark .border-slate-200 { border-color: rgba(255,255,255,0.10) !important; }
        .fdark .hover\\:border-slate-200:hover { border-color: rgba(255,255,255,0.14) !important; }
        .fdark .text-slate-800  { color: #eaf1fb !important; }
        .fdark .text-slate-700  { color: rgba(234,241,251,0.85) !important; }
        .fdark .text-slate-600  { color: rgba(234,241,251,0.65) !important; }
        .fdark .text-slate-500  { color: rgba(234,241,251,0.50) !important; }
        .fdark .text-slate-400  { color: rgba(234,241,251,0.38) !important; }
        .fdark .shadow-sm       { box-shadow: 0 1px 6px rgba(0,0,0,0.4) !important; }
        .fdark .bg-sky-100      { background: rgba(56,189,248,0.14) !important; }
        .fdark .bg-violet-100   { background: rgba(167,139,250,0.14) !important; }
        .fdark .bg-emerald-100  { background: rgba(52,211,153,0.14) !important; }
        .fdark .bg-amber-100    { background: rgba(251,191,36,0.14) !important; }
        .fdark .bg-slate-100    { background: rgba(255,255,255,0.07) !important; }
        .fdark .text-sky-600    { color: #38bdf8 !important; }
        .fdark .hover\\:text-sky-800:hover { color: #7dd3fc !important; }
        .fdark .border-sky-200  { border-color: rgba(56,189,248,0.3) !important; }
        .fdark input, .fdark select {
          background: rgba(255,255,255,0.06) !important;
          border-color: rgba(255,255,255,0.12) !important;
          color: #eaf1fb !important;
        }
        .fdark .bg-sky-600      { background: #0ea5e9 !important; }
        .fdark .text-red-300    { color: rgba(251,113,133,0.55) !important; }
        .fdark .hover\\:text-red-500:hover { color: #fb7185 !important; }
        .fdark .animate-pulse   { color: rgba(234,241,251,0.35) !important; }
        .fdark .text-sm.font-semibold { color: rgba(234,241,251,0.85) !important; }

        /* ── Sub-view dark overrides ──────────────────────────────────────── */
        .svdark { background: #060e1f; border-radius: 14px; overflow: hidden; }
        .svdark .bg-white         { background: rgba(255,255,255,0.04) !important; }
        .svdark .bg-slate-50      { background: rgba(255,255,255,0.025) !important; }
        .svdark .bg-slate-100     { background: rgba(255,255,255,0.06) !important; }
        .svdark .bg-slate-200     { background: rgba(255,255,255,0.09) !important; }
        .svdark .bg-gray-50       { background: rgba(255,255,255,0.025) !important; }
        .svdark .bg-gray-100      { background: rgba(255,255,255,0.06) !important; }
        .svdark .bg-gray-200      { background: rgba(255,255,255,0.09) !important; }
        .svdark .text-gray-900, .svdark .text-gray-800 { color: #eaf1fb !important; }
        .svdark .text-gray-700    { color: rgba(234,241,251,0.82) !important; }
        .svdark .text-gray-600    { color: rgba(234,241,251,0.65) !important; }
        .svdark .text-gray-500    { color: rgba(234,241,251,0.50) !important; }
        .svdark .text-gray-400    { color: rgba(234,241,251,0.38) !important; }
        .svdark .border-gray-100  { border-color: rgba(255,255,255,0.07) !important; }
        .svdark .border-gray-200  { border-color: rgba(255,255,255,0.11) !important; }
        .svdark .border-gray-300  { border-color: rgba(255,255,255,0.17) !important; }
        .svdark .hover\\:bg-gray-50:hover  { background: rgba(255,255,255,0.04) !important; }
        .svdark .hover\\:bg-gray-100:hover { background: rgba(255,255,255,0.07) !important; }
        .svdark .min-h-screen     { min-height: unset !important; }
        .svdark .text-slate-900, .svdark .text-slate-800 { color: #eaf1fb !important; }
        .svdark .text-slate-700   { color: rgba(234,241,251,0.82) !important; }
        .svdark .text-slate-600   { color: rgba(234,241,251,0.82) !important; }
        .svdark .text-slate-500   { color: rgba(234,241,251,0.55) !important; }
        .svdark .text-slate-400   { color: rgba(234,241,251,0.45) !important; }
        .svdark .text-slate-300   { color: rgba(234,241,251,0.30) !important; }
        .svdark .border-slate-50, .svdark .border-slate-100 { border-color: rgba(255,255,255,0.07) !important; }
        .svdark .border-slate-200 { border-color: rgba(255,255,255,0.11) !important; }
        .svdark .border-slate-300 { border-color: rgba(255,255,255,0.17) !important; }
        .svdark .divide-slate-100 > * + * { border-color: rgba(255,255,255,0.07) !important; }
        .svdark .divide-slate-200 > * + * { border-color: rgba(255,255,255,0.11) !important; }
        .svdark .shadow-sm        { box-shadow: 0 1px 6px rgba(0,0,0,0.5) !important; }
        .svdark .shadow-md        { box-shadow: 0 4px 18px rgba(0,0,0,0.6) !important; }
        .svdark .shadow-lg        { box-shadow: 0 8px 32px rgba(0,0,0,0.7) !important; }
        .svdark input, .svdark select, .svdark textarea {
          background: rgba(255,255,255,0.07) !important;
          border-color: rgba(255,255,255,0.14) !important;
          color: #eaf1fb !important;
        }
        .svdark select option { background: #1e293b !important; color: #eaf1fb !important; }
        .svdark input::placeholder, .svdark textarea::placeholder { color: rgba(234,241,251,0.28) !important; }
        .svdark .bg-sky-100       { background: rgba(56,189,248,0.14) !important; }
        .svdark .bg-sky-50        { background: rgba(56,189,248,0.08) !important; }
        .svdark .bg-green-100, .svdark .bg-emerald-100 { background: rgba(52,211,153,0.14) !important; }
        .svdark .bg-green-50,  .svdark .bg-emerald-50  { background: rgba(52,211,153,0.08) !important; }
        .svdark .bg-red-100       { background: rgba(251,113,133,0.14) !important; }
        .svdark .bg-red-50        { background: rgba(251,113,133,0.08) !important; }
        .svdark .bg-amber-100, .svdark .bg-yellow-100  { background: rgba(251,191,36,0.18) !important; }
        .svdark .bg-amber-50   { background: rgba(251,191,36,0.15) !important; }
        .svdark .bg-yellow-50  { background: rgba(251,191,36,0.08) !important; }
        .svdark .bg-violet-100, .svdark .bg-purple-100 { background: rgba(167,139,250,0.14) !important; }
        .svdark .bg-orange-100    { background: rgba(251,146,60,0.14) !important; }
        .svdark .bg-indigo-100    { background: rgba(99,102,241,0.14) !important; }
        .svdark .text-sky-700, .svdark .text-sky-600   { color: #38bdf8 !important; }
        .svdark .text-sky-500     { color: #7dd3fc !important; }
        .svdark .text-green-800, .svdark .text-green-700, .svdark .text-green-600, .svdark .text-emerald-700, .svdark .text-emerald-600 { color: #34d399 !important; }
        .svdark .text-red-700, .svdark .text-red-600   { color: #fb7185 !important; }
        .svdark .text-amber-800, .svdark .text-amber-700, .svdark .text-amber-600, .svdark .text-yellow-700, .svdark .text-yellow-600 { color: #fbbf24 !important; }
        .svdark .text-violet-700, .svdark .text-violet-600, .svdark .text-purple-700, .svdark .text-purple-600 { color: #a78bfa !important; }
        .svdark .text-orange-700, .svdark .text-orange-600 { color: #fb923c !important; }
        .svdark .text-indigo-700, .svdark .text-indigo-600 { color: #818cf8 !important; }
        .svdark table             { border-color: rgba(255,255,255,0.10) !important; }
        .svdark thead, .svdark th {
          background: rgba(255,255,255,0.07) !important;
          color: rgba(234,241,251,0.75) !important;
          border-color: rgba(255,255,255,0.10) !important;
        }
        .svdark td                { border-color: rgba(255,255,255,0.07) !important; color: #eaf1fb !important; }
        .svdark .bg-slate-50\/40   { background: rgba(255,255,255,0.07) !important; }
        .svdark .bg-slate-50\/70   { background: rgba(255,255,255,0.04) !important; }
        .svdark .bg-amber-50\/60   { background: rgba(251,191,36,0.12) !important; }
        .svdark .bg-sky-50\/60     { background: rgba(56,189,248,0.10) !important; }
        .svdark .bg-green-50\/60, .svdark .bg-emerald-50\/60 { background: rgba(52,211,153,0.10) !important; }
        .svdark .bg-indigo-50      { background: rgba(99,102,241,0.10) !important; }
        .svdark .border-amber-300  { border-color: rgba(251,191,36,0.45) !important; }
        .svdark .border-amber-200  { border-color: rgba(251,191,36,0.30) !important; }
        .svdark .border-yellow-200 { border-color: rgba(254,240,138,0.25) !important; }
        .svdark .border-sky-100    { border-color: rgba(56,189,248,0.15) !important; }
        .svdark .border-sky-200    { border-color: rgba(56,189,248,0.25) !important; }
        .svdark .border-red-200    { border-color: rgba(251,113,133,0.30) !important; }
        .svdark .border-green-200, .svdark .border-emerald-200 { border-color: rgba(52,211,153,0.30) !important; }
        .svdark .bg-gray-50\/50    { background: rgba(255,255,255,0.03) !important; }
        .svdark .bg-gray-50\/40    { background: rgba(255,255,255,0.025) !important; }
        .svdark .bg-sky-50\/40     { background: rgba(56,189,248,0.06) !important; }
        .svdark .bg-sky-50\/50     { background: rgba(56,189,248,0.08) !important; }
        .svdark .hover\\:bg-white:hover { background: rgba(255,255,255,0.05) !important; }
        .svdark tr:hover td, .svdark tbody tr:hover { background: rgba(56,189,248,0.08) !important; }
        .svdark .bg-sky-600       { background: #0ea5e9 !important; }
        .svdark .bg-sky-700       { background: #0284c7 !important; }
        .svdark .hover\\:bg-sky-700:hover { background: #0284c7 !important; }
        .svdark .bg-indigo-600    { background: #4f46e5 !important; }
        .svdark .bg-red-600       { background: #dc2626 !important; }
        .svdark .text-white       { color: #fff !important; }
        .svdark .hover\\:bg-slate-100:hover { background: rgba(255,255,255,0.07) !important; }
        .svdark .hover\\:bg-slate-50:hover  { background: rgba(255,255,255,0.04) !important; }
        .svdark .hover\\:bg-sky-50:hover    { background: rgba(56,189,248,0.08) !important; }
        .svdark .hover\\:bg-sky-100:hover   { background: rgba(56,189,248,0.13) !important; }
        .svdark .hover\\:bg-emerald-100:hover { background: rgba(52,211,153,0.13) !important; }
        .svdark .hover\\:bg-amber-100:hover { background: rgba(251,191,36,0.13) !important; }
        .svdark .hover\\:bg-red-50:hover    { background: rgba(251,113,133,0.08) !important; }
        .svdark .hover\\:shadow-sm:hover    { box-shadow: 0 1px 6px rgba(0,0,0,0.5) !important; }
        .svdark .recharts-wrapper, .svdark .recharts-surface { background: transparent !important; }
        .svdark .recharts-cartesian-axis-tick-value { fill: rgba(234,241,251,0.55) !important; }
        .svdark .recharts-legend-item-text { color: rgba(234,241,251,0.65) !important; }
        .svdark .recharts-tooltip-wrapper .recharts-default-tooltip {
          background: rgba(6,12,28,0.95) !important;
          border-color: rgba(255,255,255,0.15) !important;
          color: #eaf1fb !important;
        }
        /* ── Dark modal card ── */
        .modal-card { background: #0f1929 !important; color: #eaf1fb !important; }
        .modal-card .bg-white          { background: rgba(255,255,255,0.06) !important; }
        .modal-card .bg-slate-50       { background: #1c2b3a !important; }
        .modal-card .bg-slate-100      { background: #243040 !important; }
        .modal-card .text-slate-900, .modal-card .text-slate-800 { color: #eaf1fb !important; }
        .modal-card .text-slate-700    { color: rgba(234,241,251,0.85) !important; }
        .modal-card .text-slate-600    { color: rgba(234,241,251,0.70) !important; }
        .modal-card .text-slate-500    { color: rgba(234,241,251,0.55) !important; }
        .modal-card .text-slate-400    { color: #94a3b8 !important; }
        .modal-card .border-slate-100  { border-color: rgba(255,255,255,0.10) !important; }
        .modal-card .border-slate-200  { border-color: #334155 !important; }
        .modal-card .border-slate-300  { border-color: rgba(255,255,255,0.18) !important; }
        .modal-card .border-b, .modal-card .border-t, .modal-card .border-r { border-color: rgba(255,255,255,0.10) !important; }
        .modal-card input, .modal-card select, .modal-card textarea {
          background: #1a2b3e !important;
          border-color: rgba(255,255,255,0.15) !important;
          color: #eaf1fb !important;
        }
        .modal-card input::placeholder, .modal-card textarea::placeholder { color: rgba(148,163,184,0.7) !important; }
        .modal-card strong, .modal-card b { color: rgba(234,241,251,0.92) !important; }
        .modal-card .text-sky-700      { color: #38bdf8 !important; }
        .modal-card .text-sky-800      { color: #7dd3fc !important; }
        .modal-card .text-sky-500      { color: #38bdf8 !important; }
        .modal-card .border-sky-600    { border-color: #0ea5e9 !important; }
        .modal-card .text-teal-700     { color: #2dd4bf !important; }
        .modal-card .text-amber-500    { color: #fbbf24 !important; }
        .modal-card .text-amber-800    { color: #fcd34d !important; }
        .modal-card .text-amber-900    { color: #fde68a !important; }
        .modal-card .text-emerald-800  { color: #6ee7b7 !important; }
        /* Caixas coloridas — sólidas, não transparentes */
        .modal-card .bg-amber-50       { background: #2d1b00 !important; }
        .modal-card .bg-amber-100      { background: #3d2400 !important; }
        .modal-card .border-amber-200  { border-color: #92400e !important; }
        .modal-card .bg-sky-50         { background: #0c1f2e !important; }
        .modal-card .border-sky-200    { border-color: #0369a1 !important; }
        .modal-card .bg-emerald-50     { background: #0a1f17 !important; }
        .modal-card .border-emerald-200{ border-color: #065f46 !important; }
        .modal-card .bg-yellow-50      { background: #2d2200 !important; }
        .modal-card .border-yellow-200 { border-color: #854d0e !important; }
        .modal-card .text-yellow-800   { color: #fde68a !important; }
        .modal-card .bg-red-50         { background: #2d0a0a !important; }
        .modal-card .border-red-200    { border-color: #991b1b !important; }
        .modal-card .text-red-700      { color: #fb7185 !important; }
        .modal-card .hover\\:bg-slate-50:hover  { background: rgba(255,255,255,0.05) !important; }
        .modal-card .hover\\:text-slate-700:hover { color: #eaf1fb !important; }
        /* ApostilamentoModal */
        .apt-modal-bg  { background: #080f1c !important; }
        .apt-cfg-panel { background: #0d1726 !important; border-color: rgba(255,255,255,0.08) !important; }
        /* ── force-light: reverte cores para branco dentro de svdark (modal FerramentasGestao) ── */
        .svdark .force-light { color: #0f172a !important; }
        .svdark .force-light .text-gray-900,.svdark .force-light .text-gray-800 { color: #111827 !important; }
        .svdark .force-light .text-gray-700 { color: #374151 !important; }
        .svdark .force-light .text-gray-600 { color: #4b5563 !important; }
        .svdark .force-light .text-gray-500 { color: #6b7280 !important; }
        .svdark .force-light .text-gray-400 { color: #9ca3af !important; }
        .svdark .force-light .text-gray-300 { color: #d1d5db !important; }
        .svdark .force-light .text-slate-700 { color: #334155 !important; }
        .svdark .force-light .text-slate-600 { color: #475569 !important; }
        .svdark .force-light .text-slate-500 { color: #64748b !important; }
        .svdark .force-light .bg-white  { background: #ffffff !important; }
        .svdark .force-light .bg-gray-50  { background: #f9fafb !important; }
        .svdark .force-light .bg-gray-100 { background: #f3f4f6 !important; }
        .svdark .force-light .bg-gray-900 { background: #111827 !important; }
        .svdark .force-light .bg-gray-950 { background: #030712 !important; }
        .svdark .force-light .border-gray-100 { border-color: #f3f4f6 !important; }
        .svdark .force-light .border-gray-200 { border-color: #e5e7eb !important; }
        .svdark .force-light .text-amber-700  { color: #b45309 !important; }
        .svdark .force-light .bg-amber-50     { background: #fffbeb !important; }
        .svdark .force-light .border-amber-200 { border-color: #fde68a !important; }
        .svdark .force-light .text-green-400  { color: #4ade80 !important; }
      `}</style>

      <div style={{
        position: "fixed", inset: 0, overflow: "hidden",
        background: `linear-gradient(155deg, ${T.bg} 0%, ${T.bg2} 55%, #0a1628 100%)`,
        fontFamily: T.font, color: T.txt,
      }}>
        {/* Particles */}
        <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", opacity: 0.28 }}>
          <SparklesCore background="transparent" minSize={0.3} maxSize={1.1}
            particleDensity={40} particleColor="#38bdf8" speed={0.65} className="w-full h-full" />
        </div>

        {/* Sidebar */}
        <Sidebar
          user={user} navTo={navigate} onView={v => { setView(v); setFilterTipo("todos"); }}
          collapsed={collapsed} onEdit={() => setShowProf(true)}
          onLogout={async () => { await supabase.auth.signOut(); navigate("/", { replace: true }); }}
        />

        {/* Right panel */}
        <div style={{
          position: "absolute", top: 0, bottom: 0, right: 0,
          left: sw, overflowY: "auto", overflowX: "hidden",
          zIndex: 10, transition: "left 0.22s cubic-bezier(.4,0,.2,1)",
        }}>
          <Topbar
            user={user} bellCount={userNotifCount}
            bellOpen={bellOpen} bellItems={userNotifs}
            onBell={() => setBellOpen(b => !b)}
            onToggle={() => setCollapsed(c => !c)}
          />

          <div
            style={{ padding: "28px 28px 64px", minHeight: "calc(100vh - 58px)" }}
            onClick={() => bellOpen && setBellOpen(false)}
          >
            {/* Breadcrumb */}
            {view !== "dashboard" && (
              <div className="dc" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, animationDelay: "0s" }}>
                <button onClick={() => setView("dashboard")}
                  style={{ background: T.surf, border: `1px solid ${T.bdr}`,
                    borderRadius: 8, padding: "5px 12px", fontSize: 12,
                    color: T.muted, cursor: "pointer", fontFamily: T.font, transition: "all 0.14s" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = T.txt; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = T.muted; }}
                >← Início</button>
                <span style={{ color: T.bdr2, fontSize: 13 }}>/</span>
                <span style={{ color: T.txt, fontSize: 13, fontWeight: 600 }}>{VIEW_LABELS[view]}</span>
              </div>
            )}

            {/* ── Dashboard view ── */}
            {view === "dashboard" && (
              <>
                <div className="dc" style={{ marginBottom: 26, animationDelay: "0.04s" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: T.txt, marginBottom: 4 }}>Dashboard GAP-MN</div>
                  <div style={{ fontSize: 13, color: T.muted }}>Seção de Execução Orçamentária — exercício 2026</div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14, marginBottom: 28 }}>
                  {stats.map((s, i) => (
                    <div key={s.label} className="dc" style={{ animationDelay: `${0.1 + i * 0.07}s` }}>
                      <StatCard {...s} />
                    </div>
                  ))}
                </div>

                <div className="dc" style={{
                  background: T.surf, backdropFilter: "blur(16px)",
                  border: `1px solid ${T.bdr}`, borderRadius: 20,
                  overflow: "hidden", animationDelay: "0.5s",
                }}>
                  <div style={{ padding: "16px 24px 12px", borderBottom: `1px solid ${T.bdr}`,
                    display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.txt }}>Atualizações</div>
                      <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Atividades recentes do sistema</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {FILTER_OPTS.map(f => {
                        const key = f.toLowerCase();
                        const active = filterTipo === key;
                        return (
                          <button key={f} onClick={() => setFilterTipo(key)}
                            style={{
                              background: active ? "rgba(56,189,248,0.12)" : T.surf,
                              border: `1px solid ${active ? T.cyan + "60" : T.bdr}`,
                              color: active ? T.cyan : "rgba(234,241,251,0.72)",
                              borderRadius: 8, padding: "4px 10px", fontSize: 11,
                              cursor: "pointer", fontFamily: T.font, transition: "all 0.12s",
                            }}
                            onMouseEnter={e => { if (!active) { const b = e.currentTarget as HTMLButtonElement; b.style.color = T.txt; b.style.borderColor = T.bdr2; } }}
                            onMouseLeave={e => { if (!active) { const b = e.currentTarget as HTMLButtonElement; b.style.color = "rgba(234,241,251,0.72)"; b.style.borderColor = T.bdr; } }}
                          >{f}</button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="fdark" style={{ padding: "16px 24px" }}>
                    <FeedNoticias isLoggedIn canCreate={canCreate}
                      filterTipo={filterTipo} onNavigate={tab => setView(tab as View)} />
                  </div>
                </div>
              </>
            )}

            {/* ── Setor views ── */}
            {view === "processos"     && <div className="svdark"><GerenciamentoProcessos canImport={canImportPrc} canEdit={canEdit} canEditElaboracao={canImportPrc} /></div>}
            {view === "contratos"     && <div className="svdark"><GerenciamentoContratos canImport={canImportCtr} canEdit={canEdit} canEditBudget={canImportCtr} /></div>}
            {view === "empenhos"      && <div className="svdark"><GerenciamentoEmpenhos  canSync={canSyncEmp} userRole={user.setor ?? undefined} /></div>}
            {view === "indicadores"   && <div className="svdark"><IndicadoresLotacao canImport={canImportInd} /></div>}
            {view === "atas"          && <div className="svdark"><AtasRegistroPreco canSync={canImportPrc} /></div>}
            {view === "solicitacoes"  && <div className="svdark"><PainelSolicitacoesEmpenho canManage={canManageSolicit} /></div>}

            {/* ── Panel views ── */}
            {view === "painel-orcamento"  && <PainelOrcamentario />}
            {view === "painel-empenhos"   && (
              <PainelEmpenhos onNavigateToEmpenhos={() => setView("empenhos")} />
            )}
            {view === "painel-rp"         && <div className="svdark"><PainelRP /></div>}
            {view === "painel-processos"  && (
              <div className="svdark" style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:320 }}>
                <div style={{ textAlign:"center", color:"rgba(234,241,251,0.45)" }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🚧</div>
                  <div style={{ fontSize:15, fontWeight:700, color:"#fb923c", marginBottom:6 }}>Em elaboração</div>
                  <div style={{ fontSize:12 }}>Painel de Processos em desenvolvimento.</div>
                </div>
              </div>
            )}
            {view === "painel-execucao"  && <PainelExecucao />}
            {view === "painel-contratos" && (
              <div className="svdark" style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:320 }}>
                <div style={{ textAlign:"center", color:"rgba(234,241,251,0.45)" }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🚧</div>
                  <div style={{ fontSize:15, fontWeight:700, color:"#fb923c", marginBottom:6 }}>Em elaboração</div>
                  <div style={{ fontSize:12 }}>Painel de Contratos em desenvolvimento.</div>
                </div>
              </div>
            )}

            {/* ── Ferramentas ── */}
            {view === "ferramentas" && <div className="svdark"><FerramentasGestao /></div>}

            {/* ── Administração (ADMIN/DEV only) ── */}
            {view === "admin" && (isDev || user.setor === "ADMIN"
              ? <AdminUsersPanel />
              : <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(234,241,251,0.4)" }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>🔒</div>
                  <div style={{ fontSize: 14 }}>Acesso restrito a administradores.</div>
                </div>
            )}
          </div>
        </div>

        <CeliaWidget kpis={kpis} />

        {showProf && (
          <ProfileModal user={user} onSave={saveProfile} onClose={() => setShowProf(false)} />
        )}
      </div>

    </>
  );
}
