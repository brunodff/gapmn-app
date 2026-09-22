import { supabase } from "./supabase";

let _uid:   string | null = null;
let _setor: string | null = null;
let _nome:  string | null = null;

export function initAnalytics(uid: string, setor: string | null, nome: string | null) {
  _uid   = uid;
  _setor = setor;
  _nome  = nome;
}

export function logActivity(action: string, entity?: string, value?: string) {
  if (!_uid) return;
  supabase.from("activity_log").insert({
    user_id:     _uid,
    setor:       _setor,
    nome_guerra: _nome,
    action,
    entity:      entity ?? null,
    value:       value  ?? null,
  }).then(() => {});
}

export function startHeartbeat(): () => void {
  const id = window.setInterval(() => logActivity("heartbeat"), 2 * 60 * 1000);
  return () => window.clearInterval(id);
}
