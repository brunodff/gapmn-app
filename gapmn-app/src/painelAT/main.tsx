// Entrada do Painel do Auxílio Transporte como site à parte (build: npm run build:painel-at).
// Só o painel: sem roteador, sem login e sem nada do resto do app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PainelAuxilioTransporte from "../pages/PainelAuxilioTransporte";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PainelAuxilioTransporte />
  </StrictMode>,
);
