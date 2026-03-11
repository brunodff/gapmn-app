// GAP-MN Service Worker — Push Notifications
const CACHE_NAME = "gapmn-v1";

// Instala e ativa o SW imediatamente
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Recebe push do servidor e exibe notificação
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: "GAP-MN", body: event.data?.text() ?? "" };
  }

  const title = data.title || "GAP-MN";
  const options = {
    body: data.body || "",
    icon: "/gapmn.png",
    badge: "/gapmn.png",
    tag: data.tag || "gapmn-notif",
    renotify: true,
    data: { url: data.url || "/app" },
    vibrate: [200, 100, 200],
    actions: [
      { action: "open", title: "Abrir sistema" },
      { action: "dismiss", title: "Fechar" },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clique na notificação — abre o sistema
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "/app";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Se já tem janela aberta, foca nela
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Senão abre nova aba
        return self.clients.openWindow(targetUrl);
      })
  );
});
