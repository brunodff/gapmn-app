import { useState } from "react";

// ─── Bookmarklet source ───────────────────────────────────────────────────────
// Loader: always fetches latest cnet-bot.js from the server (cache-busted)
const BOT_SRC = `(function(){
var s=document.createElement('script');
s.src='https://gapmn.app/cnet-bot.js?v='+Date.now();
s.onerror=function(){alert('Erro ao carregar CNET Bot.\\nVerifique sua conexão e tente novamente.');};
document.head.appendChild(s);
})()`;

// ─── Etapas de instalação ─────────────────────────────────────────────────────
const STEPS = [
  {
    n: 1,
    title: "Copie o código",
    desc: 'Clique em "Copiar Bookmarklet" abaixo. Se você já tem o bookmarklet instalado, apague-o e reinstale com este novo código.',
  },
  {
    n: 2,
    title: "Abra o Gerenciador de Favoritos",
    desc: "Pressione Ctrl + Shift + O no Chrome (ou Edge).",
  },
  {
    n: 3,
    title: "Crie um novo favorito",
    desc: 'Clique em "⋮" → "Adicionar novo favorito". Dê o nome "CNET Bot".',
  },
  {
    n: 4,
    title: "Cole no campo URL",
    desc: 'Apague o conteúdo do campo URL e cole o código copiado (Ctrl + V). Salve.',
  },
  {
    n: 5,
    title: "Use o robô",
    desc: (
      <>
        Acesse{" "}
        <a
          href="https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 underline"
        >
          ComprasNet
        </a>{" "}
        e clique no favorito "CNET Bot". Digite os processos no formato{" "}
        <code className="bg-slate-700 px-1 rounded text-amber-300">900XX202X</code>.
      </>
    ),
  },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function CnetBot() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText("javascript:" + BOT_SRC);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // fallback: textarea + execCommand
      const ta = document.createElement("textarea");
      ta.value = "javascript:" + BOT_SRC;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center py-10 px-4">
      {/* Cabeçalho */}
      <div className="mb-8 text-center">
        <div className="text-4xl mb-2">🤖</div>
        <h1 className="text-2xl font-bold text-white">CNET Bot</h1>
        <p className="text-slate-400 text-sm mt-1">
          Robô para captura de dados do ComprasNet — grupos, itens e propostas de fornecedores
        </p>
      </div>

      {/* Botão copiar */}
      <button
        onClick={handleCopy}
        className={`
          flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-base shadow-lg transition-all
          ${copied
            ? "bg-green-600 text-white scale-95"
            : "bg-sky-600 hover:bg-sky-500 text-white"
          }
        `}
      >
        {copied ? "✅ Copiado!" : "📋 Copiar Bookmarklet"}
      </button>

      <p className="text-slate-500 text-xs mt-2 mb-8">
        O código copiado começa com <code className="text-slate-300">javascript:</code>
      </p>

      {/* Passos */}
      <div className="w-full max-w-lg space-y-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">
          Como instalar
        </h2>
        {STEPS.map((s) => (
          <div key={s.n} className="flex gap-4 bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex-shrink-0 h-7 w-7 rounded-full bg-sky-700 text-white text-sm font-bold flex items-center justify-center">
              {s.n}
            </div>
            <div>
              <div className="font-medium text-slate-100">{s.title}</div>
              <div className="text-slate-400 text-sm mt-0.5">{s.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* O que o robô captura */}
      <div className="mt-10 w-full max-w-lg bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
          O que o robô captura
        </h2>
        <ul className="space-y-1 text-sm text-slate-300">
          <li>📦 Grupos/lotes e itens avulsos do processo</li>
          <li>🏢 Propostas de fornecedores (CNPJ, razão social, status, valor)</li>
          <li>📝 Nome do item, situação, quantidade solicitada e descrição detalhada</li>
          <li>✅ Atualiza <code className="text-amber-300 bg-slate-700 px-1 rounded">situacao_cnet</code> no banco de processos</li>
          <li>🔁 Processa múltiplos processos e centenas de páginas em sequência</li>
        </ul>
        <p className="text-slate-500 text-xs mt-3">
          UASG fixa: 120630 · Formato: <code className="text-amber-300">900XX202X</code> (ex: 900602025)
        </p>
      </div>

      {/* Aviso */}
      <div className="mt-6 w-full max-w-lg bg-amber-900/30 border border-amber-700/40 rounded-xl p-4">
        <p className="text-amber-300 text-sm">
          <strong>⚠️ Atenção:</strong> Execute o robô com o ComprasNet já aberto na aba correta (
          <em>comprasnet-web/public/compras</em>). O robô preenche os filtros automaticamente — não
          mexa na tela enquanto estiver rodando.
        </p>
      </div>
    </div>
  );
}
