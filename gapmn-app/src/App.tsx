import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import AuthConfirm from "./pages/AuthConfirm";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AppChat from "./pages/AppChat";
import ControleOrcamentario from "./pages/ControleOrcamentario";
import FerramentasGestao from "./pages/FerramentasGestao";
import EmpenhoAutomatico from "./pages/EmpenhoAutomatico";
import OrdensBancarias from "./pages/OrdensBancarias";
import CnetBot from "./pages/CnetBot";
import AptPage from "./pages/AptPage";
import PaineisExternos from "./pages/PaineisExternos";
import LandingPage from "./pages/LandingPage";
import RequireAuth from "./routes/RequireAuth";
import RequireDev from "./routes/RequireDev";
import ManualSite from "./components/ManualSite";

const AppTitle = () => (
  <div className="flex items-center gap-3">
    <img src="/gapmn.png" alt="GAP-MN"
      className="h-9 w-9 rounded-xl object-contain border border-slate-100 bg-white shadow-sm" />
    <img src="/acantus.png" alt="Acantus"
      className="h-9 w-9 rounded-xl object-contain border border-slate-100 bg-white shadow-sm" />
    <div className="flex items-center gap-2">
      <h1 className="text-base font-bold tracking-tight" style={{ color: "#0F172A" }}>
        Aplicativo do GAP-MN
      </h1>
    </div>
  </div>
);

function Shell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const [showManual, setShowManual] = useState(false);
  const isApp = loc.pathname.startsWith("/app") || loc.pathname.startsWith("/setor") || loc.pathname.startsWith("/orcamento") || loc.pathname.startsWith("/ferramentas") || loc.pathname.startsWith("/ordens-bancarias");
  if (loc.pathname.startsWith("/cnet") || loc.pathname.startsWith("/app") || loc.pathname.startsWith("/paineis-externos") || loc.pathname.startsWith("/empenho-automatico")) return <>{children}</>;

  // Login/signup: componente controla o próprio layout
  if (loc.pathname === "/" || loc.pathname === "/login") {
    return <>{children}</>;
  }

  // Outras páginas de auth: título + card centralizados
  if (!isApp) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        {showManual && <ManualSite onClose={() => setShowManual(false)} />}
        <main className="flex-1 flex flex-col items-center justify-center px-4 gap-6">
          <AppTitle />
          <div className="w-full max-w-3xl">{children}</div>
        </main>
        <footer className="py-4 text-center text-xs text-slate-400">
          Desenvolvido por 2T Bruno | GAP-MN
        </footer>
      </div>
    );
  }

  // Páginas de app: topbar fixa + conteúdo
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F4F7FB" }}>
      {showManual && <ManualSite onClose={() => setShowManual(false)} />}
      <header className="sticky top-0 z-40 bg-white"
        style={{ borderBottom: "1px solid #E2E8F0", boxShadow: "0 1px 8px rgba(15,23,42,0.06)" }}>
        <div className="mx-auto flex h-16 max-w-[1600px] items-center px-6 md:px-10">
          <AppTitle />
        </div>
      </header>
      <main className="flex-1 px-4 md:px-8 pb-12 pt-6">
        <div className="mx-auto w-full max-w-[1600px]">{children}</div>
      </main>
      <footer className="py-4 text-center text-[11px]" style={{ color: "#94A3B8" }}>
        Desenvolvido por 2T Bruno · GAP-MN
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<LandingPage />} />

          <Route path="/signup" element={<Navigate to="/" replace />} />
          <Route path="/login" element={<Navigate to="/" replace />} />

          <Route path="/auth/confirm" element={<AuthConfirm />} />
          <Route path="/auth/reset-password" element={<ResetPassword />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          <Route
            path="/app"
            element={
              <RequireAuth>
                <AppChat />
              </RequireAuth>
            }
          />

          <Route path="/setor" element={<Navigate to="/app" replace />} />

          <Route
            path="/orcamento"
            element={
              <RequireAuth>
                <ControleOrcamentario />
              </RequireAuth>
            }
          />

          <Route
            path="/ferramentas"
            element={
              <RequireAuth>
                <FerramentasGestao />
              </RequireAuth>
            }
          />


          <Route
            path="/empenho-automatico"
            element={
              <RequireAuth>
                <EmpenhoAutomatico />
              </RequireAuth>
            }
          />

          <Route
            path="/ordens-bancarias"
            element={
              <RequireDev>
                <OrdensBancarias />
              </RequireDev>
            }
          />

          <Route path="/cnet" element={<CnetBot />} />
          <Route path="/apt"  element={<AptPage />} />
          <Route path="/paineis-externos" element={<PaineisExternos />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
