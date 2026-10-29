// Roda nas páginas do Auxílio Transporte no SIGPES. Na primeira entrada do dia, lê a tabela de
// solicitações por trás (sem mexer na tela) e envia ao banco do painel. O popup mostra o resultado.
(function () {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const CFG = globalThis.CONFIG_AT;
  const X = globalThis.ExtratorAT;
  // no Firefox, content.fetch faz o pedido como a própria página (mesmos cookies e origem)
  const buscarSigpes = typeof globalThis.content?.fetch === "function" ? globalThis.content.fetch.bind(globalThis.content) : fetch.bind(globalThis);

  const CH_STATUS = "at_status";
  const CH_CONFIG = "at_config";
  const CH_TRAVA = "at_trava";
  const TRAVA_VALE_MS = 20 * 60 * 1000;
  const ESPERA_APOS_ERRO_MS = 30 * 60 * 1000;
  const LOTE = 1000;

  const diaSP = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: CFG.fuso }).format(d);
  const ler = async (k) => (await api.storage.local.get(k))[k];
  const gravar = (k, v) => api.storage.local.set({ [k]: v });

  async function atualizarStatus(p) {
    const atual = (await ler(CH_STATUS)) || {};
    await gravar(CH_STATUS, { ...atual, ...p });
  }

  // ── banco do painel ─────────────────────────────────────────────────────────
  async function rpc(nome, corpo) {
    const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: CFG.supabaseAnon, Authorization: `Bearer ${CFG.supabaseAnon}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const texto = await r.text();
    if (!r.ok) {
      let msg = texto;
      try { msg = JSON.parse(texto).message || texto; } catch { /* texto puro */ }
      if (/chave_invalida/.test(msg)) throw new Error("Chave de envio recusada. Confira a configuração da extensão.");
      throw new Error(`O painel recusou o envio (${r.status}): ${String(msg).slice(0, 160)}`);
    }
    return texto ? JSON.parse(texto) : null;
  }

  // ── leitura ─────────────────────────────────────────────────────────────────
  async function pegarTrava() {
    const t = await ler(CH_TRAVA);
    if (t && Date.now() - t.desde < TRAVA_VALE_MS) return null;
    const minha = { desde: Date.now(), id: Math.random().toString(36).slice(2) };
    await gravar(CH_TRAVA, minha);
    await new Promise((ok) => setTimeout(ok, 300));
    const confere = await ler(CH_TRAVA);
    return confere?.id === minha.id ? minha : null;
  }

  async function soltarTrava(trava) {
    const t = await ler(CH_TRAVA);
    if (t?.id === trava.id) await api.storage.local.remove(CH_TRAVA);
  }

  async function sincronizar({ forcar = false } = {}) {
    const cfg = (await ler(CH_CONFIG)) || {};
    if (!cfg.chave) return { ok: false, mensagem: "Configure a extensão (código de configuração) antes de sincronizar." };
    const st = (await ler(CH_STATUS)) || {};
    if (!forcar) {
      if (st.ultimaOk && diaSP(new Date(st.ultimaOk)) === diaSP(new Date())) return { ok: true, pulou: "ja_hoje" };
      if (st.ultima && !st.ultima.ok && st.ultima.contaComoTentativa && Date.now() - new Date(st.ultima.quando).getTime() < ESPERA_APOS_ERRO_MS) {
        return { ok: false, pulou: "espera_apos_erro" };
      }
    }
    const trava = await pegarTrava();
    if (!trava) return { ok: false, pulou: "em_andamento", mensagem: "Já há uma leitura em andamento em outra aba." };

    const inicio = Date.now();
    let execucao = null;
    try {
      await atualizarStatus({ andamento: { desde: inicio, fase: "abrindo", lidos: 0, total: null } });
      const url = new URL(CFG.gerencia, location.origin).href;
      const pagina = await X.abrirTabela(url, buscarSigpes);
      await atualizarStatus({ andamento: { desde: inicio, fase: "lendo", lidos: 0, total: pagina.total } });
      const { linhas, total } = await X.lerTodas(pagina, buscarSigpes, {
        aoProgredir: ({ lidos, total: t }) => atualizarStatus({ andamento: { desde: inicio, fase: "lendo", lidos, total: t } }),
      });
      if (!linhas.length) throw new X.ErroLeitura("vazia", "A tabela veio vazia.");

      await atualizarStatus({ andamento: { desde: inicio, fase: "enviando", lidos: linhas.length, total } });
      execucao = await rpc("at_iniciar", { p_chave: cfg.chave, p_total: Math.max(total, linhas.length), p_versao: CFG.versao });
      for (let i = 0; i < linhas.length; i += LOTE) {
        await rpc("at_lote", { p_chave: cfg.chave, p_execucao: execucao, p_linhas: linhas.slice(i, i + LOTE) });
        await atualizarStatus({ andamento: { desde: inicio, fase: "enviando", lidos: Math.min(i + LOTE, linhas.length), total: linhas.length } });
      }
      const fim = await rpc("at_concluir", { p_chave: cfg.chave, p_execucao: execucao, p_erro: null });
      const ok = fim?.status === "ok";
      const ultima = {
        quando: new Date().toISOString(), ok, registros: linhas.length, total,
        novas: fim?.novas ?? null, alteradas: fim?.alteradas ?? null, sairam: fim?.sairam ?? null,
        duracaoMs: Date.now() - inicio, contaComoTentativa: true,
        mensagem: ok ? null : "O painel não aceitou a leitura como completa.",
      };
      await atualizarStatus({ ultima, andamento: null, ...(ok ? { ultimaOk: ultima.quando } : {}) });
      return { ok, ultima };
    } catch (e) {
      const sessao = e?.codigo === "sessao";
      if (execucao) {
        try { await rpc("at_concluir", { p_chave: cfg.chave, p_execucao: execucao, p_erro: String(e.message || e).slice(0, 300) }); } catch { /* fica como interrompida */ }
      }
      const ultima = {
        quando: new Date().toISOString(), ok: false, mensagem: String(e?.message || e), codigo: e?.codigo || null,
        duracaoMs: Date.now() - inicio, contaComoTentativa: !sessao,
      };
      await atualizarStatus({ ultima, andamento: null });
      return { ok: false, ultima };
    } finally {
      await soltarTrava(trava);
    }
  }

  // ── gatilhos ────────────────────────────────────────────────────────────────
  api.runtime.onMessage.addListener((msg, _remetente, responder) => {
    if (msg?.tipo === "sincronizar") {
      sincronizar({ forcar: !!msg.forcar }).then(responder, (e) => responder({ ok: false, mensagem: String(e) }));
      return true;
    }
    if (msg?.tipo === "diagnostico") {
      (async () => {
        let extra = {};
        try {
          const url = new URL(CFG.gerencia, location.origin).href;
          const html = await (await buscarSigpes(url, { credentials: "include", cache: "no-store" })).text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          extra = { gerencia: X.diagnostico(doc) };
        } catch (e) { extra = { erroGerencia: String(e) }; }
        responder({ ok: true, diagnostico: { versao: CFG.versao, estaPagina: X.diagnostico(document), ...extra, status: (await ler(CH_STATUS)) || null } });
      })();
      return true;
    }
    return false;
  });

  // tela de login: nada a fazer até a pessoa entrar
  if (document.querySelector("input[type='password']")) return;
  // dá tempo da página terminar de carregar antes de pedir a gerência ao servidor
  setTimeout(() => { sincronizar().catch(() => {}); }, 2500);
})();
