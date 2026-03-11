import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

// Chave pública VAPID gerada para este projeto
const VAPID_PUBLIC_KEY =
  "BCvuRXyksc1BHTLw-T76nDzBi5cjjA0iHH7RLU5qU3W6vYyJGuHoMKgef8tUaunut8rVxrPcyIgzwfvvJ9tW0mE";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buf = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return buf;
}

export type PushState = "unsupported" | "denied" | "subscribed" | "unsubscribed" | "loading";

export function usePush(userId: string | null) {
  const [state, setState] = useState<PushState>("loading");

  // Verifica estado inicial
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "subscribed" : "unsubscribed");
    });
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    setState("loading");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const { error } = await supabase.from("push_subscriptions").upsert(
        { user_id: userId, endpoint: sub.endpoint, subscription: sub.toJSON() },
        { onConflict: "endpoint" }
      );
      if (error) throw error;

      setState("subscribed");
      return true;
    } catch (err) {
      console.error("[Push] subscribe error:", err);
      setState(Notification.permission === "denied" ? "denied" : "unsubscribed");
      return false;
    }
  }, [userId]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    setState("loading");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      }
      setState("unsubscribed");
    } catch (err) {
      console.error("[Push] unsubscribe error:", err);
      setState("unsubscribed");
    }
  }, []);

  return { state, subscribe, unsubscribe };
}
