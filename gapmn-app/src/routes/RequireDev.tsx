import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function RequireDev({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      if (!data.session) { setLoading(false); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("setor")
        .eq("id", data.session.user.id)
        .single();

      if (mounted) {
        setAllowed(profile?.setor === "DEV");
        setLoading(false);
      }
    });

    return () => { mounted = false; };
  }, []);

  if (loading) return <div style={{ padding: 24 }}>Carregando...</div>;

  if (!allowed) return <Navigate to="/app" replace state={{ from: loc.pathname }} />;

  return <>{children}</>;
}
