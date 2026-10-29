// Página aberta do Painel do Auxílio Transporte (/painel-at#k=<código>). Sem login e sem nada do
// gapmn.app na tela: o acesso é pelo código do link, conferido no banco (at_painel). Fora dos buscadores.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { lerPayload, type DadosAT } from "../lib/auxilioTransporte/dados.ts";
import PainelAT from "../components/painelAT/PainelAT";
import "../components/painelAT/painelAT.css";

const CHAVE_CODIGO = "painel_at_codigo";
const ICONE = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#16834f"/>' +
  '<rect x="7" y="6" width="18" height="17" rx="3" fill="#fff"/><rect x="9" y="8.5" width="14" height="6.5" rx="1.5" fill="#16834f"/>' +
  '<rect x="8.5" y="23" width="4" height="3.5" rx="1" fill="#fff"/><rect x="19.5" y="23" width="4" height="3.5" rx="1" fill="#fff"/></svg>');

/** Código do link (#k=…); guardado neste navegador para o endereço sem código continuar abrindo. */
function codigoDoLink(): string | null {
  const m = /(?:^|[#&])k=([^&]+)/.exec(window.location.hash);
  if (m) {
    const c = decodeURIComponent(m[1]);
    try { localStorage.setItem(CHAVE_CODIGO, c); } catch { /* navegação privada */ }
    return c;
  }
  try { return localStorage.getItem(CHAVE_CODIGO); } catch { return null; }
}

function mensagemDeErro(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? "";
  if (/link_invalido/.test(m)) return "Este link não é válido ou foi desativado. Peça o link atualizado.";
  if (/Failed to fetch|NetworkError|fetch/i.test(m)) return "Sem conexão. Confira a internet e tente de novo.";
  return m || "Não foi possível carregar o painel.";
}

export default function PainelAuxilioTransporte() {
  const [codigo] = useState(codigoDoLink);
  const [dados, setDados] = useState<DadosAT | null>(null);
  const [erro, setErro] = useState<string | null>(codigo ? null : "Abra o painel pelo link completo que você recebeu.");
  const [lendo, setLendo] = useState(!!codigo);

  // identidade própria: título, ícone, fonte e fora dos buscadores
  useEffect(() => {
    const antes = document.title;
    document.title = "Auxílio Transporte · Painel";
    const icones = [...document.querySelectorAll<HTMLLinkElement>("link[rel~='icon'], link[rel='apple-touch-icon']")];
    const hrefs = icones.map((l) => l.href);
    icones.forEach((l) => { l.href = ICONE; });
    const robots = Object.assign(document.createElement("meta"), { name: "robots", content: "noindex, nofollow" });
    const fonte = Object.assign(document.createElement("link"), {
      rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
    });
    document.head.append(robots, fonte);
    return () => {
      document.title = antes;
      icones.forEach((l, i) => { l.href = hrefs[i]; });
      robots.remove();
      fonte.remove();
    };
  }, []);

  // cada clique em "Recarregar" soma 1 e o efeito busca de novo; os estados só mudam na resposta do banco
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    if (!codigo) return;
    let vivo = true;
    supabase.rpc("at_painel", { p_codigo: codigo }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) {
        setErro(mensagemDeErro(error));
        if (/link_invalido/.test(error.message ?? "")) { try { localStorage.removeItem(CHAVE_CODIGO); } catch { /* sem armazenamento */ } }
      } else {
        try { setDados(lerPayload(data)); setErro(null); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
      }
      setLendo(false);
    });
    return () => { vivo = false; };
  }, [codigo, recarga]);

  const carregar = () => { setLendo(true); setRecarga((n) => n + 1); };

  return (
    <div className="at-pagina">
      {dados ? (
        <>
          {erro && <div className="at-faixa-erro" role="alert">{erro}</div>}
          <PainelAT dados={dados} lendo={lendo} aoRecarregar={carregar} />
        </>
      ) : (
        <div className="at-estado">
          <div className="at-estado-cartao">
            <span className="at-marca-icone" aria-hidden="true"><img src={ICONE} alt="" width={28} height={28} /></span>
            <h1 className="at-titulo">Auxílio Transporte</h1>
            {erro ? (
              <>
                <p role="alert">{erro}</p>
                {codigo && <button type="button" className="at-botao" onClick={carregar}>Tentar de novo</button>}
              </>
            ) : <p>Carregando as solicitações…</p>}
          </div>
        </div>
      )}
    </div>
  );
}
