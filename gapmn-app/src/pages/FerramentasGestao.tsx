import { useState } from "react";
import { useNavigate } from "react-router-dom";

interface Tool {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  description: string;
  status: "ativo" | "beta";
  bookmarklet?: string;
  bookmarkletLabel?: string;
  navTarget?: string;
  navLabel?: string;
  instruction?: string;
}

interface GuideItem {
  icon: string;
  title: string;
  description: string;
}

const TOOLS: Tool[] = [
  {
    id: "cnet",
    icon: "🤖",
    title: "Robô CNET",
    subtitle: "Leitor de Processos Licitatórios",
    description:
      "Extrai automaticamente as propostas de todos os itens de um pregão eletrônico diretamente do ComprasNet, exportando os dados para uma planilha Google Sheets. Ideal para análise de fornecedores e valores ofertados.",
    status: "ativo",
    bookmarklet:
      "javascript:(function(){var s=document.createElement('script');s.src='https://processoscae.vercel.app/cnet-bot.js?v='+Date.now();document.body.appendChild(s);})();",
    bookmarkletLabel: "📋 Copiar Bookmarklet",
    instruction:
      "1. Cole essa URL em um favorito do navegador. 2. Abra o ComprasNet com o pregão. 3. Clique o favorito.",
  },
  {
    id: "atas",
    icon: "📋",
    title: "Robô de ATAs",
    subtitle: "Sincronizador de Atas de Registro de Preço",
    description:
      "Navega automaticamente pelo Portal de Contratos Gov.br e sincroniza os metadados e itens das Atas de Registro de Preço do GAP-MN. Mantém os dados sempre atualizados na aba 'Atas de RP'.",
    status: "ativo",
    bookmarklet:
      "javascript:(function(){var s=document.createElement('script');s.src='https://processoscae.vercel.app/arp-bot.js?v='+Date.now();document.body.appendChild(s);})();",
    bookmarkletLabel: "📋 Copiar Bookmarklet",
    instruction:
      "1. Cole essa URL em um favorito do navegador. 2. Abra contratos.sistema.gov.br/arp. 3. Clique o favorito.",
  },
  {
    id: "apostilamento",
    icon: "📄",
    title: "Gerador de Termo de Apostilamento",
    subtitle: "Reajuste contratual automático",
    description:
      "Insira o Termo de Referência de uma ATA (PDF) na aba 'Atas de RP'. O sistema extrai automaticamente a data do orçamento estimado e o índice de reajuste (IPCA, IGP-M etc.), calcula o percentual acumulado via API do Banco Central e gera os valores reajustados.",
    status: "ativo",
    navTarget: "/setor?tab=atas",
    navLabel: "→ Ir para ATAs de RP",
  },
  {
    id: "siloms",
    icon: "🔧",
    title: "Assistente SILOMS",
    subtitle: "Auxiliar de despacho de empenhos",
    description:
      "Consulta automaticamente o status de Notas de Empenho no SILOMS e registra o perfil de tramitação, número de documento e dados do responsável diretamente no sistema, agilizando o controle de empenhos pela SEO.",
    status: "beta",
    bookmarklet:
      "javascript:(function(){var s=document.createElement('script');s.src='https://processoscae.vercel.app/siloms-bot.js?v='+Date.now();document.body.appendChild(s);})();",
    bookmarkletLabel: "📋 Copiar Bookmarklet",
    instruction:
      "1. Cole essa URL em um favorito do navegador. 2. Acesse o SILOMS. 3. Clique o favorito para iniciar a leitura em lote.",
  },
];

const GUIDE_ITEMS: GuideItem[] = [
  {
    icon: "📋",
    title: "Contratos",
    description:
      "Gerenciamento dos contratos da SCON. Permite importar planilha Excel, visualizar vigências, valores e modalidades.",
  },
  {
    icon: "📊",
    title: "Processos",
    description:
      "Acompanhamento dos processos licitatórios da SLIC. Registra status, modalidade, número UASG e estimativas de valor.",
  },
  {
    icon: "📈",
    title: "Indicadores de Lotação",
    description:
      "Painel da SEO com indicadores orçamentários por conta-corrente. Importa dados de planilha.",
  },
  {
    icon: "💰",
    title: "Empenhos",
    description:
      "Rastreamento de Notas de Empenho SIAFI. Integrado ao Robô SILOMS para atualização automática.",
  },
  {
    icon: "📑",
    title: "Atas de RP",
    description:
      "Controle das Atas de Registro de Preço vigentes. Robô ARP sincroniza automaticamente. Suporta Termos de Apostilamento.",
  },
  {
    icon: "📊",
    title: "Painéis Gerenciais",
    description:
      "Painéis de execução orçamentária e Restos a Pagar integrados ao SIAFI via Google Sheets.",
  },
];

const CARD_ACCENT: Record<string, string> = {
  cnet: "from-sky-50 to-blue-50 border-sky-200",
  atas: "from-emerald-50 to-green-50 border-emerald-200",
  apostilamento: "from-violet-50 to-purple-50 border-violet-200",
  siloms: "from-amber-50 to-yellow-50 border-amber-200",
};

const ICON_BG: Record<string, string> = {
  cnet: "bg-sky-100 text-sky-700",
  atas: "bg-emerald-100 text-emerald-700",
  apostilamento: "bg-violet-100 text-violet-700",
  siloms: "bg-amber-100 text-amber-700",
};

export default function FerramentasGestao() {
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function handleCopy(toolId: string, bookmarklet: string) {
    navigator.clipboard.writeText(bookmarklet).then(() => {
      setCopiedId(toolId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Cabeçalho */}
      <header className="bg-gradient-to-r from-sky-50 via-white to-sky-50 border-b border-sky-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <button
            onClick={() => navigate("/app")}
            className="flex items-center gap-2 text-sky-700 hover:text-sky-900 font-medium text-sm transition-colors w-fit"
          >
            <span className="text-base">←</span>
            <span>Início</span>
          </button>
          <div className="flex-1 text-center">
            <h1 className="text-2xl font-bold text-gray-800 tracking-tight">
              Ferramentas &amp; Catálogo
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Robôs, automações e guia de uso do sistema
            </p>
          </div>
          {/* Espaço espelho para alinhar o título ao centro */}
          <div className="hidden sm:block w-20" />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10 space-y-14">
        {/* Seção 1 — Automações e Robôs */}
        <section>
          <div className="mb-6">
            <h2 className="text-lg font-bold text-gray-700 uppercase tracking-wider">
              Automações e Robôs
            </h2>
            <p className="text-sm text-gray-400 mt-0.5">
              Bookmarklets e integrações para agilizar o trabalho diário
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {TOOLS.map((tool) => (
              <div
                key={tool.id}
                className={`rounded-2xl border bg-gradient-to-br ${CARD_ACCENT[tool.id]} shadow-sm hover:shadow-md transition-shadow p-6 flex flex-col gap-4`}
              >
                {/* Topo do card */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 ${ICON_BG[tool.id]}`}
                    >
                      {tool.icon}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-800 text-base leading-tight">
                        {tool.title}
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {tool.subtitle}
                      </p>
                    </div>
                  </div>
                  {/* Badge de status */}
                  {tool.status === "ativo" ? (
                    <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
                      ativo
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                      beta
                    </span>
                  )}
                </div>

                {/* Descrição */}
                <p className="text-sm text-gray-600 leading-relaxed">
                  {tool.description}
                </p>

                {/* Instrução */}
                {tool.instruction && (
                  <p className="text-xs text-gray-500 bg-white/60 rounded-lg px-3 py-2 border border-white/80">
                    {tool.instruction}
                  </p>
                )}

                {/* Ações */}
                <div className="mt-auto flex flex-col gap-2">
                  {tool.bookmarklet && tool.bookmarkletLabel && (
                    <button
                      onClick={() => handleCopy(tool.id, tool.bookmarklet!)}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-sm font-medium text-gray-700 shadow-sm transition-all"
                    >
                      {copiedId === tool.id ? (
                        <>
                          <span className="text-green-600">✓</span>
                          <span className="text-green-600">Copiado!</span>
                        </>
                      ) : (
                        <>
                          <span>{tool.bookmarkletLabel}</span>
                        </>
                      )}
                    </button>
                  )}
                  {tool.navTarget && tool.navLabel && (
                    <button
                      onClick={() => navigate(tool.navTarget!)}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium shadow-sm transition-colors"
                    >
                      {tool.navLabel}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Separador */}
        <div className="border-t border-gray-100" />

        {/* Seção 2 — Guia das Abas */}
        <section>
          <div className="mb-6">
            <h2 className="text-lg font-bold text-gray-700 uppercase tracking-wider">
              Guia das Abas
            </h2>
            <p className="text-sm text-gray-400 mt-0.5">
              Entenda o que cada seção do sistema oferece
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {GUIDE_ITEMS.map((item) => (
              <div
                key={item.title}
                className="flex items-start gap-4 rounded-xl border border-gray-100 bg-gray-50 hover:bg-white hover:border-gray-200 transition-all shadow-sm px-5 py-4"
              >
                <div className="text-2xl shrink-0 mt-0.5">{item.icon}</div>
                <div>
                  <h3 className="font-semibold text-gray-700 text-sm">
                    {item.title}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Rodapé */}
        <div className="flex justify-center pt-4 pb-8">
          <button
            onClick={() => navigate("/app")}
            className="flex items-center gap-2 px-6 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-600 shadow-sm transition-all"
          >
            <span>←</span>
            <span>Voltar ao início</span>
          </button>
        </div>
      </main>
    </div>
  );
}
