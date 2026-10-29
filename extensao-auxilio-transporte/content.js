// Roda nas páginas do Auxílio Transporte no SIGPES. Na primeira entrada do dia, lê a tabela de
// solicitações por trás (sem mexer na tela) e envia ao banco do painel. O popup mostra o resultado.
//
// Leitura em andamento "pulsa" a cada 4 s (at_trava e at_status.andamento.vivo). Se a página muda no
// meio (a pessoa troca de tela) ou a aba fecha, o pulso para: em 15 s a trava vence, o popup mostra
// "interrompida" e a leitura recomeça sozinha. Todo pedido tem prazo, para nunca ficar parado.
//
// O que já foi lido fica guardado (at_leitura, por até 1 h): se o SIGPES parar no meio, a próxima
// tentativa continua de onde parou; se só o envio ao painel falhar, a próxima tentativa só reenvia.
(function () {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const CFG = globalThis.CONFIG_AT;
  const X = globalThis.ExtratorAT;
  // no Firefox, content.fetch faz o pedido como a própria página (mesmos cookies e origem)
  const comoPagina = typeof globalThis.content?.fetch === "function";
  const buscarSigpes = comoPagina ? globalThis.content.fetch.bind(globalThis.content) : fetch.bind(globalThis);

  const CH_STATUS = "at_status";
  const CH_TRAVA = "at_trava";
  const CH_LEITURA = "at_leitura";
  const PULSO_MS = 4000;
  const VIVO_MS = 15000;                       // sem pulso por 15 s = leitura interrompida
  const ESPERA_APOS_ERRO_MS = 30 * 60 * 1000;
  const GUARDADA_MS = 60 * 60 * 1000;          // leitura guardada vale por 1 h (depois a lista pode ter mudado)
  const PRAZO_SIGPES_MS = CFG.prazoSigpesMs ?? 90000;   // abrir a gerência
  const PRAZO_BANCO_MS = CFG.prazoBancoMs ?? 45000;
  const PRAZO_PAGINA_MS = CFG.prazoPaginaMs ?? 60000;   // cada pedido de página (estourou: pede de novo, menor)
  const RETOMAR_APOS_MS = CFG.retomarAposMs ?? 60000;   // nova tentativa automática depois de parar no meio
  const MAX_AUTOMATICAS = 3;
  const LOTE = 1000;
  const SIGPES_INSTAVEL = new Set(["sigpes_lento", "sigpes_fora", "sigpes_instavel", "resposta_ilegivel", "sem_tabela_na_resposta"]);
  const ENVIO = new Set(["sem_internet", "banco", "chave"]);

  const diaSP = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: CFG.fuso }).format(d);
  const ler = async (k) => (await api.storage.local.get(k))[k];
  const gravar = (k, v) => api.storage.local.set({ [k]: v });
  const fmtN = (n) => (n ?? 0).toLocaleString("pt-BR");

  async function atualizarStatus(p) {
    const atual = (await ler(CH_STATUS)) || {};
    await gravar(CH_STATUS, { ...atual, ...p });
  }

  /** Rejeita com `mensagem` se a promessa não terminar em `ms`. */
  function comPrazo(promessa, ms, codigo, mensagem, aoEstourar) {
    let t;
    return Promise.race([promessa, new Promise((_, rejeitar) => {
      t = setTimeout(() => { try { aoEstourar?.(); } catch { /* nada */ } rejeitar(new X.ErroLeitura(codigo, mensagem)); }, ms);
    })]).finally(() => clearTimeout(t));
  }

  /** Pedido ao SIGPES com prazo (inclui ler a resposta inteira). No Chrome o pedido vencido é cancelado. */
  function buscarSigpesComPrazo(url, opcoes, prazoMs = PRAZO_SIGPES_MS) {
    const s = Math.round(prazoMs / 1000);
    const ctl = comoPagina ? null : new AbortController();
    return comPrazo((async () => {
      let r;
      try { r = await buscarSigpes(url, ctl ? { ...opcoes, signal: ctl.signal } : opcoes); } catch {
        throw new X.ErroLeitura("sigpes_fora", "Não consegui falar com o SIGPES. Confira a conexão com a INTRAER (VPN) e tente de novo.");
      }
      let texto;
      try { texto = await r.text(); } catch {
        throw new X.ErroLeitura("sigpes_fora", "A conexão com o SIGPES caiu no meio da resposta.");
      }
      return { ok: r.ok, status: r.status, text: async () => texto };
    })(), prazoMs, "sigpes_lento", `O SIGPES não respondeu em ${s} s. Confira a conexão com a INTRAER (VPN) e tente de novo.`, () => ctl?.abort());
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
      if (/chave_invalida/.test(msg)) throw new X.ErroLeitura("chave", "Chave de envio recusada. Peça o pacote atualizado a quem mantém a extensão.");
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

  // ── leitura guardada ────────────────────────────────────────────────────────
  async function leituraGuardada() {
    let g = null;
    try { g = await ler(CH_LEITURA); } catch { return null; }
    if (!g || g.formato !== 1 || !Array.isArray(g.linhas) || !g.linhas.length) return null;
    if (Date.now() - g.atualizado > GUARDADA_MS || diaSP(new Date(g.atualizado)) !== diaSP(new Date())) return null;
    return g;
  }

  let ultimaGravacao = 0;
  async function guardarLeitura(estado, { completa = false, agora = false } = {}) {
    if (!agora && Date.now() - ultimaGravacao < 5000) return;   // no máximo a cada 5 s durante a leitura
    ultimaGravacao = Date.now();
    try { await gravar(CH_LEITURA, { formato: 1, atualizado: Date.now(), completa, total: estado.total ?? null, bloco: estado.bloco ?? null, feitos: estado.feitos || [], linhas: estado.linhas }); }
    catch { /* sem espaço: segue sem guardar */ }
  }

  // chave de envio embutida no pacote (sem configuração); marcador = pacote gerado sem as chaves
  const CHAVE = CFG.chaveEnvio && !CFG.chaveEnvio.startsWith("__") ? CFG.chaveEnvio : null;

  async function sincronizar({ forcar = false, retomar = false } = {}) {
    if (!CHAVE) return { ok: false, mensagem: "Esta cópia da extensão veio sem a chave do painel. Peça o pacote atualizado a quem mantém a extensão." };
    const st = (await ler(CH_STATUS)) || {};
    // "retomar" = continuação automática de uma tentativa que parou no meio: não espera nem pula
    if (!forcar && !retomar) {
      if (st.ultimaOk && diaSP(new Date(st.ultimaOk)) === diaSP(new Date())) return { ok: true, pulou: "ja_hoje" };
      // depois de um erro, espera 30 min, a não ser que haja leitura guardada para continuar
      if (st.ultima && !st.ultima.ok && st.ultima.contaComoTentativa && !(await leituraGuardada()) &&
        Date.now() - new Date(st.ultima.quando).getTime() < ESPERA_APOS_ERRO_MS) {
        return { ok: false, pulou: "espera_apos_erro" };
      }
    }
    const trava = await pegarTrava();
    if (!trava) return { ok: false, pulou: "em_andamento", mensagem: "Já há uma leitura em andamento em outra aba." };

    const inicio = Date.now();
    let andamento = { desde: inicio, vivo: inicio, fase: "abrindo", lidos: 0, total: null, retomados: 0 };
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
    let lidas = 0, total = null, medidas = null, reenvio = false;
    try {
      const guardada = await leituraGuardada();
      let linhas;
      if (guardada?.completa) {
        // a leitura de antes não chegou ao painel: só reenviar, sem pedir nada ao SIGPES
        ({ linhas, total } = guardada);
        reenvio = true;
      } else {
        await marcar({ fase: "abrindo" });
        const url = new URL(CFG.gerencia, location.origin).href;
        const pagina = await X.abrirTabela(url, buscarSigpesComPrazo);
        const retomada = guardada && guardada.total === pagina.total ? guardada : null;
        const ja = retomada ? new Set(retomada.linhas.map((l) => l[0])).size : 0;
        await marcar({ fase: "lendo", lidos: ja, total: pagina.total, retomados: ja, lendoDesde: Date.now() });
        const r = await X.lerTodas(pagina, buscarSigpesComPrazo, {
          abrirOutra: () => X.abrirTabela(url, buscarSigpesComPrazo),
          prazoMs: PRAZO_PAGINA_MS,
          retomada,
          aoProgredir: ({ lidos, total: t }) => marcar({ fase: "lendo", lidos, total: t }),
          aoBloco: (estado) => guardarLeitura(estado),
        });
        ({ linhas, total, medidas } = r);
        if (!linhas.length) throw new X.ErroLeitura("vazia", "A tabela veio vazia.");
        await guardarLeitura({ total, bloco: medidas.bloco, linhas }, { completa: true, agora: true });
      }
      lidas = linhas.length;

      await marcar({ fase: "enviando", lidos: 0, total: linhas.length });
      execucao = await rpc("at_iniciar", { p_chave: CHAVE, p_total: Math.max(total ?? 0, linhas.length), p_versao: CFG.versao });
      for (let i = 0; i < linhas.length; i += LOTE) {
        await rpc("at_lote", { p_chave: CHAVE, p_execucao: execucao, p_linhas: linhas.slice(i, i + LOTE) });
        await marcar({ fase: "enviando", lidos: Math.min(i + LOTE, linhas.length), total: linhas.length });
      }
      const fim = await rpc("at_concluir", { p_chave: CHAVE, p_execucao: execucao, p_erro: null });
      const ok = fim?.status === "ok";
      encerrar();
      if (ok) await api.storage.local.remove(CH_LEITURA);
      const ultima = {
        quando: new Date().toISOString(), ok, registros: linhas.length, total,
        novas: fim?.novas ?? null, alteradas: fim?.alteradas ?? null, sairam: fim?.sairam ?? null, parcial: !!fim?.parcial,
        duracaoMs: Date.now() - inicio, contaComoTentativa: true, reenvio, medidas,
        mensagem: ok ? null : "O painel não aceitou a leitura como completa.",
      };
      await atualizarStatus({ ultima, andamento: null, ...(ok ? { ultimaOk: ultima.quando } : {}) });
      return { ok, ultima };
    } catch (e) {
      encerrar();
      const sessao = e?.codigo === "sessao";
      if (execucao) {
        try { await rpc("at_concluir", { p_chave: CHAVE, p_execucao: execucao, p_erro: String(e.message || e).slice(0, 300) }); } catch { /* fica como interrompida */ }
      }
      // o que já foi lido fica guardado para a próxima tentativa continuar daí
      const guardou = !!e?.estado?.linhas?.length;
      if (guardou) await guardarLeitura(e.estado, { agora: true });
      let mensagem = String(e?.message || e);
      if (SIGPES_INSTAVEL.has(e?.codigo) && e?.linha !== undefined) {
        const tot = e.estado?.total;
        mensagem = `O SIGPES parou de responder na linha ${fmtN(e.linha + 1)}${tot ? ` de ${fmtN(tot)}` : ""}, mesmo pedindo de novo em pedaços menores. Confira a conexão com a INTRAER (VPN).`;
        if (guardou) mensagem += ` As ${fmtN(e.lidas)} já lidas ficaram guardadas: a próxima tentativa continua daí.`;
      }
      // a leitura deu certo e só o envio falhou: dizer isso, para ninguém achar que o problema é o SIGPES
      if (lidas && ENVIO.has(e?.codigo)) mensagem = `Li ${fmtN(lidas)} solicitações do SIGPES, mas não consegui enviar ao painel. ${mensagem} A leitura ficou guardada: a próxima tentativa só envia.`;
      const retomavel = (guardou && SIGPES_INSTAVEL.has(e?.codigo)) || (!!lidas && ENVIO.has(e?.codigo) && e?.codigo !== "chave");
      const ultima = {
        quando: new Date().toISOString(), ok: false, mensagem, codigo: e?.codigo || null, retomavel,
        lidas: e?.lidas ?? (lidas || null), total: e?.estado?.total ?? total, medidas: medidas ?? null,
        duracaoMs: Date.now() - inicio, contaComoTentativa: !sessao,
      };
      await atualizarStatus({ ultima, andamento: null });
      return { ok: false, ultima };
    } finally {
      encerrar();
      await soltarTrava(trava);
    }
  }

  // ── tentativas automáticas ──────────────────────────────────────────────────
  let automaticas = 0;
  /** Roda a sincronização e, se ela parou no meio com algo guardado, agenda a continuação (até 3 vezes). */
  async function executar(opcoes) {
    const r = await sincronizar(opcoes).catch((e) => ({ ok: false, mensagem: String(e) }));
    if (r && !r.ok && r.ultima?.retomavel && automaticas < MAX_AUTOMATICAS) {
      automaticas++;
      const proximaEm = Date.now() + RETOMAR_APOS_MS;
      await atualizarStatus({ ultima: { ...r.ultima, proximaEm } }).catch(() => {});
      setTimeout(() => { executar({ retomar: true }); }, RETOMAR_APOS_MS);
    }
    return r;
  }

  // ── gatilhos ────────────────────────────────────────────────────────────────
  api.runtime.onMessage.addListener((msg, _remetente, responder) => {
    if (msg?.tipo === "sincronizar") {
      executar({ forcar: !!msg.forcar }).then(responder, (e) => responder({ ok: false, mensagem: String(e) }));
      return true;
    }
    if (msg?.tipo === "diagnostico") {
      (async () => {
        let extra = {};
        try {
          const url = new URL(CFG.gerencia, location.origin).href;
          const t0 = Date.now();
          const html = await (await buscarSigpesComPrazo(url, { credentials: "include", cache: "no-store" })).text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          extra = { gerencia: { ...X.diagnostico(doc), msParaAbrir: Date.now() - t0, kb: Math.round(html.length / 1024) } };
        } catch (e) { extra = { erroGerencia: String(e?.message || e) }; }
        const st = (await ler(CH_STATUS)) || null;
        const g = await leituraGuardada();
        responder({ ok: true, diagnostico: { versao: CFG.versao, estaPagina: X.diagnostico(document), ...extra, status: st,
          guardada: g ? { completa: g.completa, linhas: g.linhas.length, total: g.total, bloco: g.bloco, trechos: g.feitos.length } : null } });
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
    const r = await executar({});
    if (r?.pulou === "em_andamento") setTimeout(() => { executar({}); }, VIVO_MS + 2000);
  }, 2500);
})();
