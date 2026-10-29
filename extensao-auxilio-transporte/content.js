// Roda nas páginas do Auxílio Transporte no SIGPES. Na primeira entrada do dia, lê a tabela de
// solicitações por trás (sem mexer na tela) e envia ao banco do painel. O popup mostra o resultado.
//
// Leitura em andamento "pulsa" a cada 4 s (at_trava e at_status.andamento.vivo). Se a página muda no
// meio (a pessoa troca de tela) ou a aba fecha, o pulso para: em 15 s a trava vence, o popup mostra
// "interrompida" e a leitura recomeça sozinha. Todo pedido tem prazo, para nunca ficar parado.
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
  const PULSO_MS = 4000;
  const VIVO_MS = 15000;                       // sem pulso por 15 s = leitura interrompida
  const ESPERA_APOS_ERRO_MS = 30 * 60 * 1000;
  const PRAZO_SIGPES_MS = CFG.prazoSigpesMs ?? 90000;
  const PRAZO_BANCO_MS = CFG.prazoBancoMs ?? 45000;
  const LOTE = 1000;

  const diaSP = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: CFG.fuso }).format(d);
  const ler = async (k) => (await api.storage.local.get(k))[k];
  const gravar = (k, v) => api.storage.local.set({ [k]: v });
  const fmtN = (n) => (n ?? 0).toLocaleString("pt-BR");

  async function atualizarStatus(p) {
    const atual = (await ler(CH_STATUS)) || {};
    await gravar(CH_STATUS, { ...atual, ...p });
  }

  /** Rejeita com `mensagem` se a promessa não terminar em `ms` (o pedido segue, mas a leitura não espera mais). */
  function comPrazo(promessa, ms, codigo, mensagem) {
    let t;
    return Promise.race([promessa, new Promise((_, rejeitar) => { t = setTimeout(() => rejeitar(new X.ErroLeitura(codigo, mensagem)), ms); })])
      .finally(() => clearTimeout(t));
  }

  /** Pedido ao SIGPES com prazo (inclui ler a resposta inteira). */
  function buscarSigpesComPrazo(url, opcoes) {
    const s = Math.round(PRAZO_SIGPES_MS / 1000);
    return comPrazo((async () => {
      let r;
      try { r = await buscarSigpes(url, opcoes); } catch {
        throw new X.ErroLeitura("sigpes_fora", "Não consegui falar com o SIGPES. Confira a conexão com a INTRAER (VPN) e tente de novo.");
      }
      const texto = await r.text();
      return { ok: r.ok, status: r.status, text: async () => texto };
    })(), PRAZO_SIGPES_MS, "sigpes_lento", `O SIGPES não respondeu em ${s} s. Confira a conexão com a INTRAER (VPN) e tente de novo.`);
  }

  // ── banco do painel ─────────────────────────────────────────────────────────
  async function rpc(nome, corpo) {
    let r, texto;
    try {
      [r, texto] = await comPrazo((async () => {
        const resp = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${nome}`, {
          method: "POST",
          headers: { apikey: CFG.supabaseAnon, Authorization: `Bearer ${CFG.supabaseAnon}`, "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        return [resp, await resp.text()];
      })(), PRAZO_BANCO_MS, "banco_lento", "O painel não respondeu a tempo.");
    } catch (e) {
      if (e?.codigo === "banco_lento") throw new X.ErroLeitura("sem_internet", "Sem conexão com o painel (a internet está bloqueada ou lenta, por exemplo pela VPN).");
      throw new X.ErroLeitura("sem_internet", "Sem conexão com o painel (a internet está bloqueada, por exemplo pela VPN).");
    }
    if (!r.ok) {
      let msg = texto;
      try { msg = JSON.parse(texto).message || texto; } catch { /* texto puro */ }
      if (/chave_invalida/.test(msg)) throw new X.ErroLeitura("chave", "Chave de envio recusada. Confira o código de configuração da extensão.");
      throw new X.ErroLeitura("banco", `O painel recusou o envio (${r.status}): ${String(msg).slice(0, 160)}`);
    }
    return texto ? JSON.parse(texto) : null;
  }

  // ── trava entre abas, com pulso ─────────────────────────────────────────────
  const viva = (x) => !!x && Date.now() - (x.vivo ?? x.desde) < VIVO_MS;

  async function pegarTrava() {
    if (viva(await ler(CH_TRAVA))) return null;
    const minha = { desde: Date.now(), vivo: Date.now(), id: Math.random().toString(36).slice(2) };
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
    let andamento = { desde: inicio, vivo: inicio, fase: "abrindo", lidos: 0, total: null };
    let encerrada = false;
    const marcar = async (p) => {
      if (encerrada) return;
      andamento = { ...andamento, ...p, vivo: Date.now() };
      await atualizarStatus({ andamento });
    };
    const pulso = setInterval(async () => {
      try {
        await marcar({});
        const t = await ler(CH_TRAVA);
        if (!encerrada && t?.id === trava.id) await gravar(CH_TRAVA, { ...t, vivo: Date.now() });
      } catch { /* a página está saindo */ }
    }, PULSO_MS);
    const encerrar = () => { encerrada = true; clearInterval(pulso); };

    let execucao = null;
    let lidas = 0;
    try {
      await marcar({ fase: "abrindo" });
      const url = new URL(CFG.gerencia, location.origin).href;
      const pagina = await X.abrirTabela(url, buscarSigpesComPrazo);
      await marcar({ fase: "lendo", lidos: 0, total: pagina.total });
      const { linhas, total } = await X.lerTodas(pagina, buscarSigpesComPrazo, {
        aoProgredir: ({ lidos, total: t }) => marcar({ fase: "lendo", lidos, total: t }),
      });
      if (!linhas.length) throw new X.ErroLeitura("vazia", "A tabela veio vazia.");
      lidas = linhas.length;

      await marcar({ fase: "enviando", lidos: 0, total: linhas.length });
      execucao = await rpc("at_iniciar", { p_chave: cfg.chave, p_total: Math.max(total, linhas.length), p_versao: CFG.versao });
      for (let i = 0; i < linhas.length; i += LOTE) {
        await rpc("at_lote", { p_chave: cfg.chave, p_execucao: execucao, p_linhas: linhas.slice(i, i + LOTE) });
        await marcar({ fase: "enviando", lidos: Math.min(i + LOTE, linhas.length), total: linhas.length });
      }
      const fim = await rpc("at_concluir", { p_chave: cfg.chave, p_execucao: execucao, p_erro: null });
      const ok = fim?.status === "ok";
      encerrar();
      const ultima = {
        quando: new Date().toISOString(), ok, registros: linhas.length, total,
        novas: fim?.novas ?? null, alteradas: fim?.alteradas ?? null, sairam: fim?.sairam ?? null,
        duracaoMs: Date.now() - inicio, contaComoTentativa: true,
        mensagem: ok ? null : "O painel não aceitou a leitura como completa.",
      };
      await atualizarStatus({ ultima, andamento: null, ...(ok ? { ultimaOk: ultima.quando } : {}) });
      return { ok, ultima };
    } catch (e) {
      encerrar();
      const sessao = e?.codigo === "sessao";
      if (execucao) {
        try { await rpc("at_concluir", { p_chave: cfg.chave, p_execucao: execucao, p_erro: String(e.message || e).slice(0, 300) }); } catch { /* fica como interrompida */ }
      }
      let mensagem = String(e?.message || e);
      // a leitura deu certo e só o envio falhou: dizer isso, para ninguém achar que o problema é o SIGPES
      if (lidas && ["sem_internet", "banco", "chave"].includes(e?.codigo)) mensagem = `Li ${fmtN(lidas)} solicitações do SIGPES, mas não consegui enviar ao painel. ${mensagem}`;
      const ultima = {
        quando: new Date().toISOString(), ok: false, mensagem, codigo: e?.codigo || null,
        duracaoMs: Date.now() - inicio, contaComoTentativa: !sessao,
      };
      await atualizarStatus({ ultima, andamento: null });
      return { ok: false, ultima };
    } finally {
      encerrar();
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
          const html = await (await buscarSigpesComPrazo(url, { credentials: "include", cache: "no-store" })).text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          extra = { gerencia: X.diagnostico(doc) };
        } catch (e) { extra = { erroGerencia: String(e?.message || e) }; }
        responder({ ok: true, diagnostico: { versao: CFG.versao, estaPagina: X.diagnostico(document), ...extra, status: (await ler(CH_STATUS)) || null } });
      })();
      return true;
    }
    return false;
  });

  // tela de login: nada a fazer até a pessoa entrar
  if (document.querySelector("input[type='password']")) return;
  // dá tempo da página terminar de carregar antes de pedir a gerência ao servidor; se outra leitura
  // estiver em andamento, confere de novo depois que o pulso dela venceria (ela pode ter sido interrompida)
  setTimeout(async () => {
    const r = await sincronizar().catch(() => null);
    if (r?.pulou === "em_andamento") setTimeout(() => { sincronizar().catch(() => {}); }, VIVO_MS + 2000);
  }, 2500);
})();
