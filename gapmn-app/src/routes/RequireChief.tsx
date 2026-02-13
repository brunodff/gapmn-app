import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function RequireChief({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [isChief, setIsChief] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) {
        if (mounted) setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .maybeSingle();

      if (mounted) {
        setIsChief(profile?.role === "chief");
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <div className="text-slate-500">Carregando...</div>;
  if (!isChief) return <Navigate to="/app" replace />;

  return <>{children}</>;
}
