import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Category = "licitacoes" | "gerais";

interface Tool {
  id: string;
  category: Category;
  icon: string;
  title: string;
  subtitle: string;
  tagline: string;
  description: string;
  steps: string[];
  status: "ativo" | "beta";
  bookmarklet?: string;
  requireRole?: boolean;
  bookmarkletUser?: string;
  appsScriptCode?: string;
  videos?: { titulo: string; youtubeId: string }[];
  extensaoDownload?: string; // path relativo em /public para download do zip
}

const TOOLS: Tool[] = [
  {
    id: "atas",
    category: "licitacoes",
    icon: "📋",
    title: "Robô Leitor de Atas",
    subtitle: "Sincronizador de Atas de Registro de Preço",
    tagline: "Sincroniza ATAs do Portal Gov.br — Supabase ou Google Sheets",
    description:
      "Navega automaticamente pelo Portal de Contratos Gov.br e sincroniza metadados e itens das ATAs de Registro de Preço. Ao iniciar, escolha o destino: 🗄 Supabase GAP-MN (uso interno da seção) ou 📊 Minha Planilha via Apps Script (para outras unidades — os dados vão para sua própria planilha Google Sheets).",
    steps: [
      "Copie o bookmarklet clicando em 'Instalar' abaixo e cole como URL de um favorito no navegador",
      "Acesse contratos.sistema.gov.br/arp e faça login com sua conta Gov.br",
      "Clique o favorito — o painel aparece com dois botões: [Supabase GAP-MN] ou [Minha Planilha]",
      "Para uso interno: clique Supabase GAP-MN e aguarde — dados vão para a aba Atas de RP",
      "Para uso externo (outras unidades): clique Minha Planilha → cole a URL do Web App do Apps Script → Iniciar",
      "— CRIANDO O APPS SCRIPT —",
      "Abra Google Sheets → crie uma nova planilha → Extensões → Apps Script",
      "Apague o código padrão e cole o código exibido abaixo (botão Copiar código)",
      "Salve o projeto (Ctrl+S) → clique Implantar → Nova implantação → Tipo: App da Web",
      "Configure: Executar como = Eu; Quem tem acesso = Qualquer pessoa → clique Implantar",
      "Copie a URL gerada (começa com https://script.google.com/macros/s/...) e cole no robô",
      "O robô envia os dados → a planilha cria automaticamente as abas ATAs e Itens ARP formatadas",
    ],
    status: "ativo",
    bookmarklet:
      "javascript:(function(){var s=document.createElement('script');s.src='https://gapmn.app/arp-bot.js?v='+Date.now();document.body.appendChild(s);})();",
    bookmarkletUser:
      "javascript:(function(){window.__arpBotExternalOnly=true;var s=document.createElement('script');s.src='https://gapmn.app/arp-bot.js?v='+Date.now();document.body.appendChild(s);})();",
    appsScriptCode: `// ── Robô ARP — Receptor Google Apps Script ─────────────────────────
// Cole este código no editor do Apps Script (Extensões > Apps Script)
// Depois: Implantar > Nova implantação > App da Web
// Executar como: Eu  |  Quem tem acesso: Qualquer pessoa

var ATA_HEADERS  = ['Número ATA','Situação','Tipo UASG','Vigência Inicial','Vigência Final'];
var ITEM_HEADERS = ['ATA','Nº Item','Descrição','CNPJ','Fornecedor',
                    'Qtd Registrada','Valor Unit (R$)','Valor Total (R$)',
                    'Qtd Limite Adesão','Aceita Adesão','Nº Compra'];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss   = SpreadsheetApp.getActiveSpreadsheet();
    if (data.type === 'atas') {
      writeRows(ss, 'ATAs', ATA_HEADERS, data.rows, 'numero_ata',
        ['numero_ata','situacao','tipo_uasg','vigencia_inicial','vigencia_final']);
    } else if (data.type === 'itens') {
      writeRows(ss, 'Itens ARP', ITEM_HEADERS, data.rows, null,
        ['ata_numero','numero_ata','descricao','cnpj_fornecedor','fornecedor_nome',
         'quantidade_registrada','valor_unitario','valor_total',
         'qtd_limite_adesao','aceita_adesao','numero_compra']);
    }
    return ContentService
      .createTextOutput(JSON.stringify({ok: true}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({error: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function writeRows(ss, sheetName, headers, rows, dedupeKey, fields) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    var hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setValues([headers]);
    hRange.setBackground('#1a3a5c').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setTabColor('#1a73e8');
  }
  var existing = new Set();
  if (dedupeKey) {
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var keyIdx = fields.indexOf(dedupeKey);
      if (keyIdx >= 0) {
        sheet.getRange(2, keyIdx+1, lastRow-1, 1).getValues()
          .forEach(function(r){ if (r[0]) existing.add(String(r[0])); });
      }
    }
  }
  var toAdd = rows.filter(function(r){
    return !dedupeKey || !existing.has(String(r[dedupeKey] || ''));
  });
  if (!toAdd.length) return;
  var matrix = toAdd.map(function(r){
    return fields.map(function(f){ return r[f] != null ? r[f] : ''; });
  });
  var startRow = Math.max(sheet.getLastRow(), 1) + 1;
  sheet.getRange(startRow, 1, matrix.length, headers.length).setValues(matrix);
  fields.forEach(function(f, i){
    if (f.includes('valor')) {
      sheet.getRange(startRow, i+1, matrix.length, 1)
           .setNumberFormat('R$ #,##0.00');
    }
  });
  sheet.autoResizeColumns(1, headers.length);
}`,
  },
  {
    id: "despacho",
    category: "gerais",
    icon: "✍️",
    title: "Robô Silas",
    subtitle: "Despachante SILOMS",
    tagline: "Frases de despacho salvas a um clique",
    description:
      "Abre um painel flutuante no SILOMS com suas frases de despacho favoritas. Ao clicar em uma frase, ela é preenchida automaticamente na caixa de texto ao avançar um subprocesso. As frases são salvas no navegador e podem ser personalizadas.",
    steps: [
      "Copie o bookmarklet clicando em 'Instalar' abaixo",
      "Cole o código como URL de um novo favorito no navegador",
      "Acesse o SILOMS e abra a tela de avanço de subprocesso",
      "Clique o favorito — o painel 'Silas' aparece flutuando na tela",
      "Adicione suas frases de despacho favoritas no painel",
      "Na próxima vez, basta clicar a frase desejada para preenchê-la automaticamente",
    ],
    status: "ativo",
    bookmarklet:
      "javascript:(function(){var s=document.createElement('script');s.src='https://gapmn.app/siloms-despacho.js?v='+Date.now();document.body.appendChild(s);})();",
    videos: [
      { titulo: "Tutorial: Robô Silas — Despachante SILOMS", youtubeId: "cNVttyIS8jQ" },
    ],
  },
  {
    id: "cnet-extensao",
    category: "licitacoes",
    icon: "🧩",
    title: "Extensão Painel ComprasNet",
    subtitle: "GAPMN — Painel ComprasNet (Chrome / Firefox)",
    tagline: "Sincroniza processos do ComprasNet diretamente com o App GAP-MN",
    description:
      "Extensão para Chrome e Firefox que acessa a API interna do ComprasNet usando sua sessão já autenticada. Exibe os processos da UASG 120630 com situação em tempo real, detalha os itens de cada processo, lista fornecedores participantes com proposta de preço, calcula economia e exporta planilha XLS. Os dados são enviados para o banco do App GAP-MN com um clique.",
    steps: [
      "— CHROME —",
      "Clique em 'Baixar extensão' abaixo e extraia o arquivo ZIP em qualquer pasta",
      "No Chrome, acesse chrome://extensions na barra de endereço",
      "Ative o 'Modo do desenvolvedor' (chave no canto superior direito)",
      "Clique em 'Carregar sem compactação' e selecione a pasta extraída",
      "O ícone 🧩 aparece na barra — fixe-o clicando no ícone de quebra-cabeça geral → 📌",
      "— FIREFOX —",
      "Extraia o ZIP em qualquer pasta",
      "No Firefox, acesse about:debugging na barra de endereço",
      "Clique em 'Este Firefox' → 'Carregar extensão temporária...'",
      "Selecione o arquivo manifest.json dentro da pasta extraída",
      "⚠ No Firefox a extensão é temporária — reinstale sempre que fechar o navegador",
      "— USO —",
      "Acesse o ComprasNet (cnetmobile.estaleiro.serpro.gov.br) e faça login normalmente",
      "Clique no ícone da extensão na barra do navegador → clique '↺ Sincronizar'",
      "Os processos da UASG 120630 são carregados automaticamente",
      "Clique em qualquer processo para ver itens, fornecedores e propostas de preço",
      "Clique '☁ Sincronizar com App' para enviar os dados ao Painel de Processos do GAP-MN",
      "Use '📥 Exportar XLS' no detalhe do processo para baixar a planilha de itens",
    ],
    status: "ativo",
    extensaoDownload: "/gapmn-cnet-extensao.zip",
  },
  {
    id: "ob-siloms",
    category: "gerais",
    icon: "🏦",
    title: "Robô OB",
    subtitle: "Anexador de Ordens Bancárias SILOMS",
    tagline: "Gera PDF por dia das OBs e anexa automaticamente no SILOMS",
    description:
      "Extensão do Chrome que carrega os dados de Ordens Bancárias (OBs) de uma planilha Google Sheets alimentada diariamente por e-mail, gera um PDF por dia com o layout do Tesouro Gerencial (colunas A–R) e anexa cada PDF automaticamente nos recebimentos do SILOMS, preenchendo o número da OB no campo Assunto.",
    steps: [
      "— CONFIGURAÇÃO (uma vez só) —",
      "No Google Sheets, abra Extensões → Apps Script e cole o código do Code.gs (solicite ao administrador)",
      "Execute 'atualizarOBsDiarias' manualmente para autorizar o script e importar os dados do e-mail mais recente",
      "Execute 'criarTriggerDiario' para agendar a atualização automática todo dia às 07:00",
      "Publique a aba 'OBs' como CSV: Arquivo → Publicar na web → OBs → Valores separados por vírgula → Publicar",
      "— INSTALAÇÃO DA EXTENSÃO —",
      "No Chrome, acesse chrome://extensions e ative o 'Modo do desenvolvedor'",
      "Clique em 'Carregar sem compactação' e selecione a pasta extensao-ob-siloms",
      "— USO DIÁRIO —",
      "Acesse o SILOMS: Liquidação → Gerenciamento de Recebimento → filtre por 'Emissão de OB'",
      "Clique no ícone da extensão — o painel já estará com a URL do CSV configurada",
      "Clique 'Carregar CSV' para ver o resumo de OBs por dia",
      "Clique 'Iniciar Robô' — o robô percorre cada linha: Abrir → Ordem de Pagamento → Upload → gera PDF do dia → anexa → fecha → próxima",
    ],
    status: "beta",
  },
];

const CATEGORIES: {
  id: Category;
  label: string;
  icon: string;
  desc: string;
  gradient: string;
  accent: string;
  badge: string;
}[] = [
  {
    id: "licitacoes",
    label: "Licitações",
    icon: "📊",
    desc: "Extração e sincronização de dados de processos",
    gradient: "from-emerald-600 to-teal-700",
    accent: "border-emerald-100 bg-emerald-50/50",
    badge: "bg-emerald-100 text-emerald-700",
  },
  {
    id: "gerais",
    label: "Gerais",
    icon: "🛠️",
    desc: "Utilidades para o dia a dia do setor",
    gradient: "from-violet-600 to-purple-700",
    accent: "border-violet-100 bg-violet-50/50",
    badge: "bg-violet-100 text-violet-700",
  },
];

const TOOL_COLORS: Record<string, { card: string; icon: string; btn: string }> = {
  "cnet-extensao": {
    card: "border-indigo-100 hover:border-indigo-300",
    icon: "bg-indigo-100 text-indigo-700",
    btn: "bg-indigo-600 hover:bg-indigo-700 text-white",
  },
  atas: {
    card: "border-emerald-100 hover:border-emerald-300",
    icon: "bg-emerald-100 text-emerald-700",
    btn: "bg-emerald-500 hover:bg-emerald-600 text-white",
  },
  despacho: {
    card: "border-violet-100 hover:border-violet-300",
    icon: "bg-violet-100 text-violet-700",
    btn: "bg-violet-500 hover:bg-violet-600 text-white",
  },
  "ob-siloms": {
    card: "border-blue-100 hover:border-blue-300",
    icon: "bg-blue-100 text-blue-700",
    btn: "bg-blue-600 hover:bg-blue-700 text-white",
  },
};

export default function FerramentasGestao() {
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [userSetor, setUserSetor] = useState<string | null | undefined>(undefined);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setUserSetor(null); return; }
      supabase
        .from("profiles")
        .select("setor")
        .eq("id", user.id)
        .maybeSingle()
        .then(({ data }) => setUserSetor((data as { setor: string } | null)?.setor ?? null));
    });
  }, []);

  const ROLE_SETORES = new Set(["SLIC", "SEO", "SCON", "ADMIN", "DEV"]);
  // hasRole = false → usuário comum (USER) → pode ver mas não pode usar
  const hasRole = userSetor != null && ROLE_SETORES.has(userSetor.toUpperCase());

  // Todos veem todas as ferramentas; requireRole não filtra mais visibilidade
  const visibleTools = (cat: Category) => TOOLS.filter(t => t.category === cat);

  function getBookmarklet(tool: Tool): string | undefined {
    if (!hasRole && tool.bookmarkletUser) return tool.bookmarkletUser;
    return tool.bookmarklet;
  }

  function handleCopy(tool: Tool) {
    const bm = getBookmarklet(tool);
    if (!bm) return;
    navigator.clipboard.writeText(bm).then(() => {
      setCopiedId(tool.id);
      setTimeout(() => setCopiedId(null), 2500);
    });
  }

  const toolsByCategory = (cat: Category) => visibleTools(cat);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Hero ── */}
      <div className="bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 text-white">
        <div className="max-w-5xl mx-auto px-4 py-8 flex items-center justify-between">
          <button
            onClick={() => navigate("/app")}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors"
          >
            <span>←</span> Início
          </button>
          <div className="text-center">
            <div className="text-3xl mb-1">🏪</div>
            <h1 className="text-2xl font-bold tracking-tight">Central de Ferramentas</h1>
            <p className="text-slate-400 text-sm mt-0.5">Robôs e automações do GAP-MN</p>
          </div>
          <div className="w-16" />
        </div>

        <div className="max-w-5xl mx-auto px-4 pb-6 flex gap-3 flex-wrap justify-center">
          {CATEGORIES.map((cat) => (
            <a
              key={cat.id}
              href={`#cat-${cat.id}`}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors text-white/80 hover:text-white"
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
            </a>
          ))}
        </div>
      </div>

      {/* ── Seções ── */}
      <main className="max-w-5xl mx-auto px-4 py-10 space-y-14">
        {CATEGORIES.map((cat) => (
          <section key={cat.id} id={`cat-${cat.id}`}>
            <div
              className={`flex items-center gap-4 rounded-2xl bg-gradient-to-r ${cat.gradient} text-white px-6 py-4 mb-6 shadow-md`}
            >
              <span className="text-3xl">{cat.icon}</span>
              <div>
                <h2 className="text-lg font-bold leading-tight">{cat.label}</h2>
                <p className="text-white/70 text-sm">{cat.desc}</p>
              </div>
              <span className="ml-auto text-4xl font-black text-white/10 select-none">
                {toolsByCategory(cat.id).length}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {toolsByCategory(cat.id).map((tool) => {
                const colors = TOOL_COLORS[tool.id];
                return (
                  <div
                    key={tool.id}
                    className={`group relative rounded-2xl border-2 bg-white shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer ${colors.card}`}
                    onClick={() => setSelectedTool(tool)}
                  >
                    <div className="p-5">
                      <div className="absolute top-4 right-4">
                        {tool.status === "ativo" ? (
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
                            ativo
                          </span>
                        ) : (
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                            beta
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mb-3 pr-14">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0 ${colors.icon}`}>
                          {tool.icon}
                        </div>
                        <div>
                          <h3 className="font-bold text-gray-800 text-base leading-snug">{tool.title}</h3>
                          <p className="text-xs text-gray-500 mt-0.5">{tool.subtitle}</p>
                        </div>
                      </div>

                      <p className="text-sm text-gray-500 leading-relaxed mb-4">{tool.tagline}</p>

                      <div className="flex items-center gap-2 mt-auto">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedTool(tool); }}
                          className="flex-1 py-2 rounded-xl border-2 border-gray-200 hover:border-gray-300 text-sm font-medium text-gray-600 hover:text-gray-800 transition-all bg-gray-50 hover:bg-white"
                        >
                          Como usar →
                        </button>
                        {hasRole && getBookmarklet(tool) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCopy(tool); }}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${colors.btn}`}
                          >
                            {copiedId === tool.id ? <>✓ Copiado!</> : <>⬇ Instalar</>}
                          </button>
                        )}
                        {hasRole && tool.extensaoDownload && (
                          <a
                            href={tool.extensaoDownload}
                            download
                            onClick={(e) => e.stopPropagation()}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all no-underline ${colors.btn}`}
                          >
                            ⬇ Baixar
                          </a>
                        )}
                        {!hasRole && (
                          <span className="text-xs text-slate-400 border border-slate-200 rounded-xl px-3 py-2">
                            🔒 Restrito
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <div className="flex justify-center pt-2 pb-8">
          <button
            onClick={() => navigate("/app")}
            className="flex items-center gap-2 px-6 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-600 shadow-sm transition-all"
          >
            ← Voltar ao início
          </button>
        </div>
      </main>

      {/* ── Modal ── */}
      {selectedTool && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(15,23,42,0.65)" }}
          onClick={() => setSelectedTool(null)}
        >
          <div
            className="relative w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
            style={{ background: "#fff", color: "#0f172a" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`sticky top-0 z-10 rounded-t-3xl sm:rounded-t-3xl px-6 py-5 bg-gradient-to-r ${
                CATEGORIES.find((c) => c.id === selectedTool.category)?.gradient ?? "from-slate-700 to-slate-800"
              } text-white`}
            >
              <button
                onClick={() => setSelectedTool(null)}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors"
              >
                ×
              </button>
              <div className="flex items-center gap-4 pr-10">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-4xl shrink-0 ${TOOL_COLORS[selectedTool.id].icon} bg-white/90`}>
                  {selectedTool.icon}
                </div>
                <div>
                  <h2 className="text-xl font-bold leading-tight">{selectedTool.title}</h2>
                  <p className="text-white/70 text-sm mt-0.5">{selectedTool.subtitle}</p>
                  <div className="mt-1.5">
                    {selectedTool.status === "ativo" ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-400/30 text-green-100 border border-green-300/40">ativo</span>
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-400/30 text-amber-100 border border-amber-300/40">beta</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-6 space-y-6 force-light">
              <p className="text-sm leading-relaxed" style={{ color: "#475569" }}>
                {selectedTool.description}
              </p>

              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Passo a Passo</h3>
                <ol className="space-y-2 rounded-xl border border-gray-100 bg-gray-50 p-4">
                  {selectedTool.steps.map((step, i) => (
                    <li key={i} className="flex gap-3 items-start">
                      <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5 ${TOOL_COLORS[selectedTool.id].btn.split(" ")[0]}`}>
                        {i + 1}
                      </span>
                      <p className="text-sm leading-relaxed pt-0 text-gray-700">{step}</p>
                    </li>
                  ))}
                </ol>
              </div>

              {selectedTool.videos && selectedTool.videos.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <span>🎬</span> Videoaulas
                  </h3>
                  {selectedTool.videos.map((v) => (
                    <div key={v.youtubeId} className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                      <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
                        <iframe
                          src={`https://www.youtube.com/embed/${v.youtubeId}`}
                          title={v.titulo}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          className="absolute inset-0 w-full h-full"
                          style={{ border: 0 }}
                        />
                      </div>
                      <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
                        <p className="text-xs font-medium text-gray-600">{v.titulo}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center space-y-2">
                  <div className="text-2xl">🎬</div>
                  <div className="text-sm font-semibold text-gray-700">Videoaulas</div>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Tutoriais em vídeo serão disponibilizados em breve.
                  </p>
                </div>
              )}

              {selectedTool.appsScriptCode && (
                <div>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <span>📋</span> Código do Apps Script
                  </h3>
                  <div className="relative rounded-xl overflow-hidden border border-gray-200">
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
                      <span className="text-xs text-gray-400 font-mono">Apps Script — cole no editor</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedTool.appsScriptCode!).then(() => {
                            setCopiedCode(true);
                            setTimeout(() => setCopiedCode(false), 2500);
                          });
                        }}
                        className="text-xs px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium transition-all"
                      >
                        {copiedCode ? "✓ Copiado!" : "Copiar código"}
                      </button>
                    </div>
                    <pre className="text-xs bg-gray-950 text-green-400 p-4 overflow-x-auto leading-relaxed max-h-64">
                      {selectedTool.appsScriptCode}
                    </pre>
                  </div>
                </div>
              )}

              {(getBookmarklet(selectedTool) || selectedTool.extensaoDownload) && (
                hasRole ? (
                  <div className="space-y-3">
                    {getBookmarklet(selectedTool) && (
                      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
                        <p className="text-xs text-gray-500 mb-3">
                          Copie o código abaixo e cole como URL de um favorito no navegador (
                          <span className="font-semibold">Ctrl+D → editar → colar na URL</span>):
                        </p>
                        <div className="bg-white border border-gray-200 rounded-lg p-2.5 mb-3 overflow-x-auto">
                          <code className="text-xs text-gray-500 break-all font-mono">
                            {getBookmarklet(selectedTool)}
                          </code>
                        </div>
                        <button
                          onClick={() => handleCopy(selectedTool)}
                          className={`w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${TOOL_COLORS[selectedTool.id].btn}`}
                        >
                          {copiedId === selectedTool.id ? <>✓ Copiado com sucesso!</> : <>⬇ Instalar Bookmarklet</>}
                        </button>
                      </div>
                    )}
                    {selectedTool.extensaoDownload && (
                      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center">
                        <p className="text-xs text-gray-500 mb-3">
                          Baixe o arquivo da extensão e siga o passo a passo acima para instalar.
                        </p>
                        <a
                          href={selectedTool.extensaoDownload}
                          download
                          className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all no-underline ${TOOL_COLORS[selectedTool.id].btn}`}
                        >
                          ⬇ Baixar Extensão (.zip)
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                    <div className="text-2xl mb-2">🔒</div>
                    <p className="text-sm font-semibold text-slate-600">Acesso Restrito</p>
                    <p className="text-xs text-slate-400 mt-1">Apenas usuários com perfil de setor podem instalar ou baixar esta ferramenta.</p>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
