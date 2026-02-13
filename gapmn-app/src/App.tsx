import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import RequireAuth from "./routes/RequireAuth";

// ⬇️ TROQUE aqui se o seu chat tiver outro nome/caminho
import AppChat from "./pages/AppChat";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-slate-50">
        {/* Cabeçalho com título + logos (fora do card) */}
        <header className="pt-10 pb-4">
          <div className="mx-auto w-full max-w-xl px-4">
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-3">
                <img
                  src="/gapmn.png"
                  alt="GAP-MN"
                  className="h-12 w-12 rounded-xl object-contain shadow-sm border border-slate-200 bg-white"
                />
                <img
                  src="/acantus.png"
                  alt="Acantus"
                  className="h-12 w-12 rounded-xl object-contain shadow-sm border border-slate-200 bg-white"
                />
              </div>

              <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">
                Aplicativo do GAP-MN
              </h1>
            </div>
          </div>
        </header>

        {/* Área central */}
        <main className="flex-1 flex items-center justify-center px-4 pb-10">
          <div className="w-full max-w-xl">
            <Routes>
              {/* Default do app: área logada */}
              <Route path="/" element={<Navigate to="/app" replace />} />

              {/* Auth */}
              <Route path="/signup" element={<Signup />} />
              <Route path="/login" element={<Login />} />

              {/* Chat (protegido) */}
              <Route
                path="/app"
                element={
                  <RequireAuth>
                    <AppChat />
                  </RequireAuth>
                }
              />

              {/* Qualquer rota desconhecida manda pra /app */}
              <Route path="*" element={<Navigate to="/app" replace />} />
            </Routes>
          </div>
        </main>

        {/* Rodapé discreto */}
        <footer className="py-4">
          <div className="mx-auto w-full max-w-xl px-4 text-center text-xs text-slate-500">
            Desenvolvido por 2T Bruno | GAP-MN
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
