// Painel Orçamentário aberto, sem login, para a página do GAP-MN na INTRAER (por link ou dentro de um iframe).
// Só lê as planilhas de crédito, empenho e saldo, que já são publicadas por link; nada vem do banco do app.
// Dentro de um iframe (ou com ?embutido na URL) o cabeçalho sai, porque a página da INTRAER já tem o dela.
import { useEffect } from "react";
import PainelOrcamentario from "../components/painelOrcamentario";

/** Está dentro de um iframe? (comparar as janelas é permitido mesmo entre domínios diferentes) */
function emIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export default function PainelOrcamentarioPublico() {
  const embutido = new URLSearchParams(window.location.search).has("embutido") || emIframe();

  // fora dos buscadores: a página é para quem recebe o link
  useEffect(() => {
    const tituloAntes = document.title;
    document.title = "Painel Orçamentário · GAP-MN";
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.appendChild(robots);
    return () => {
      document.title = tituloAntes;
      robots.remove();
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F4F7FB" }}>
      {!embutido && (
        <header className="bg-white" style={{ borderBottom: "1px solid #E2E8F0", boxShadow: "0 1px 8px rgba(15,23,42,0.06)" }}>
          <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 md:px-8">
            <img src="/om/gapmn-brasao.png" alt="GAP-MN" className="h-10 w-10 object-contain" />
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight" style={{ color: "#0F172A" }}>Painel Orçamentário · GAP-MN</h1>
              <p className="text-xs" style={{ color: "#64748B" }}>
                Crédito recebido, empenhado e disponível do Grupamento de Apoio de Manaus e das unidades apoiadas
              </p>
            </div>
          </div>
        </header>
      )}
      <main className={embutido ? "flex-1" : "flex-1 px-2 pt-4 pb-6 md:px-6"}>
        <div className="mx-auto w-full max-w-[1600px]">
          <PainelOrcamentario publico />
        </div>
      </main>
      {!embutido && (
        <footer className="pb-4 text-center text-[11px]" style={{ color: "#94A3B8" }}>
          Dados do SIAFI (Tesouro Gerencial), lidos das planilhas do GAP-MN · gapmn.app
        </footer>
      )}
    </div>
  );
}
