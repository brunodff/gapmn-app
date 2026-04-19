import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function RequireAgent({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) {
        if (mounted) {
          setOk(false);
          setLoading(false);
        }
        return;
      }

      const { data: p } = await supabase
        .from("profiles")
        .select("setor")
        .eq("id", uid)
        .maybeSingle();

      const setor = ((p as any)?.setor as string | undefined)?.toUpperCase();
      const allowed =
        setor === "ADMIN" || setor === "DEV" ||
        setor === "SEO" || setor === "SCON" || setor === "SLIC";

      if (mounted) {
        setOk(allowed);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <div style={{ padding: 24 }}>Carregando...</div>;
  if (!ok) return <Navigate to="/app" replace />;

  return <>{children}</>;
}
