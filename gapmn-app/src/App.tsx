import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import AuthConfirm from "./pages/AuthConfirm";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AppChat from "./pages/AppChat";
import SetorInbox from "./pages/SetorInbox";
import ControleOrcamentario from "./pages/ControleOrcamentario";
import FerramentasGestao from "./pages/FerramentasGestao";
import CnetBot from "./pages/CnetBot";
import LandingPage from "./pages/LandingPage";
import RequireAuth from "./routes/RequireAuth";
import RequireAgent from "./routes/RequireAgent";
import ManualSite from "./components/ManualSite";

const AppTitle = () => (
  <div className="flex items-center justify-center gap-3">
    <img src="/gapmn.png" alt="GAP-MN"
      className="h-10 w-10 rounded-xl object-contain shadow-sm border border-slate-200 bg-white" />
    <img src="/acantus.png" alt="Acantus"
      className="h-10 w-10 rounded-xl object-contain shadow-sm border border-slate-200 bg-white" />
    <h1 className="text-lg sm:text-xl font-semibold text-slate-900">
      Aplicativo do GAP-MN
    </h1>
    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600 select-none">
      versão de teste
    </span>
  </div>
);

function Shell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const isApp = loc.pathname.startsWith("/app") || loc.pathname.startsWith("/setor") || loc.pathname.startsWith("/orcamento") || loc.pathname.startsWith("/ferramentas");
  if (loc.pathname.startsWith("/cnet")) return <>{children}</>;
  const [showManual, setShowManual] = useState(false);

  // Login/signup: componente controla o próprio layout
  if (loc.pathname === "/" || loc.pathname === "/login" || loc.pathname === "/signup") {
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

  // Páginas de app: header fixo no topo
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 overflow-hidden">
      {showManual && <ManualSite onClose={() => setShowManual(false)} />}
      <header className="pt-6 pb-4">
        <AppTitle />
      </header>
      <main className="flex-1 px-4 pb-10">
        <div className="mx-auto w-full max-w-[1600px]">{children}</div>
      </main>
      <footer className="py-4">
        <div className="text-center text-xs text-slate-500">
          Desenvolvido por 2T Bruno | GAP-MN
        </div>
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

          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />

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

          <Route
            path="/setor"
            element={
              <RequireAuth>
                <SetorInbox />
              </RequireAuth>
            }
          />

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


          <Route path="/cnet" element={<CnetBot />} />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
