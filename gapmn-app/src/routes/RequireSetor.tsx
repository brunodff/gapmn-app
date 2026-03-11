import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function RequireSetor({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) {
        if (mounted) {
          setAllowed(false);
          setLoading(false);
        }
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("setor")
        .eq("id", uid)
        .maybeSingle();

      if (mounted) {
        setAllowed(!!profile?.setor);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <div style={{ padding: 24 }}>Carregando...</div>;
  if (!allowed) return <Navigate to="/app" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}
