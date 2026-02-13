import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { LogOut, MessageCircle, LayoutDashboard, Shield } from "lucide-react";

export default function AppShell({
  children,
  showChief,
}: {
  children: React.ReactNode;
  showChief: boolean;
}) {
  const nav = useNavigate();
  const loc = useLocation();

  async function handleLogout() {
    await supabase.auth.signOut();
    nav("/login");
  }

  const isActive = (path: string) =>
    loc.pathname === path ? "text-sky-700" : "text-slate-600";

  return (
    <div className="min-h-dvh bg-gradient-to-b from-white to-slate-50">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-sky-100" />
            <div className="leading-tight">
              <div className="text-sm font-semibold">gapmn.app</div>
              <div className="text-xs text-slate-500">GAP-MN • ChatBI</div>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            <Link className={`flex items-center gap-1 text-sm ${isActive("/app")}`} to="/app">
              <MessageCircle size={16} /> Chat
            </Link>

            <Link
              className={`flex items-center gap-1 text-sm ${isActive("/bi")}`}
              to="/bi"
              title="Abrir painéis de BI"
            >
              <LayoutDashboard size={16} /> BI
            </Link>

            {showChief && (
              <Link
                className={`flex items-center gap-1 text-sm ${isActive("/chief")}`}
                to="/chief"
                title="Painel do Chefe do Grupamento"
              >
                <Shield size={16} /> Chefe
              </Link>
            )}

            <button
              onClick={handleLogout}
              className="ml-2 inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <LogOut size={16} />
              Sair
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
