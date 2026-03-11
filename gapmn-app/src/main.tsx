import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Registra o Service Worker para PWA e push notifications
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("[SW] Registrado:", reg.scope))
      .catch((err) => console.warn("[SW] Falha no registro:", err));
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
