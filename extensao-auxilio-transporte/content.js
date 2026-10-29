// Roda nas páginas do Auxílio Transporte no SIGPES. Na primeira entrada do dia, lê a tabela de
// solicitações por trás (sem mexer na tela) e envia ao banco do painel. O popup mostra o resultado.
//
// Leitura em andamento "pulsa" a cada 4 s (at_trava e at_status.andamento.vivo). Se a página muda no
// meio (a pessoa troca de tela) ou a aba fecha, o pulso para: em 15 s a trava vence, o popup mostra
// "interrompida" e a leitura recomeça sozinha. Todo pedido tem prazo, para nunca ficar parado.
//
// O que já foi lido fica guardado (envio.js): se o SIGPES parar no meio, a próxima tentativa continua
// de onde parou; se só o envio ao painel falhar, a próxima tentativa (aqui ou no popup) só reenvia.
(function () {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const CFG = globalThis.CONFIG_AT;
  const X = globalThis.ExtratorAT;
  const E = globalThis.EnvioAT;
  // no Firefox, content.fetch faz o pedido como a própria página (mesmos cookies e origem)
  const comoPagina = typeof globalThis.content?.fetch === "function";
  const buscarSigpes = comoPagina ? globalThis.content.fetch.bind(globalThis.content) : fetch.bind(globalThis);

  const ESPERA_APOS_ERRO_MS = 30 * 60 * 1000;
  const PRAZO_SIGPES_MS = CFG.prazoSigpesMs ?? 90000;   // abrir a gerência
  const PRAZO_PAGINA_MS = CFG.prazoPaginaMs ?? 60000;   // cada pedido de página (estourou: pede de novo, menor)
  const RETOMAR_APOS_MS = CFG.retomarAposMs ?? 60000;   // nova tentativa automática depois de parar no meio
  const MAX_AUTOMATICAS = 3;
  const SIGPES_INSTAVEL = new Set(["sigpes_lento", "sigpes_fora", "sigpes_instavel", "resposta_ilegivel", "sem_tabela_na_resposta"]);
  const fmtN = E.fmtN;

  /** Pedido ao SIGPES com prazo (inclui ler a resposta inteira). No Chrome o pedido vencido é cancelado. */
  function buscarSigpesComPrazo(url, opcoes, prazoMs = PRAZO_SIGPES_MS) {
    const s = Math.round(prazoMs / 1000);
    const ctl = comoPagina ? null : new AbortController();
    return E.comPrazo((async () => {
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

  async function sincronizar({ forcar = false, retomar = false } = {}) {
    if (!E.CHAVE) return { ok: false, mensagem: "Esta cópia da extensão veio sem a chave do painel. Peça o pacote atualizado a quem mantém a extensão." };
    const st = (await E.ler(E.CH_STATUS)) || {};
    // "retomar" = continuação automática de uma tentativa que parou no meio: não espera nem pula
    if (!forcar && !retomar) {
      if (st.ultimaOk && E.diaSP(new Date(st.ultimaOk)) === E.diaSP(new Date())) return { ok: true, pulou: "ja_hoje" };
      // depois de um erro, espera 30 min, a não ser que haja leitura guardada para continuar ou enviar
      if (st.ultima && !st.ultima.ok && st.ultima.contaComoTentativa && !(await E.leituraGuardada()) &&
        Date.now() - new Date(st.ultima.quando).getTime() < ESPERA_APOS_ERRO_MS) {
        return { ok: false, pulou: "espera_apos_erro" };
      }
    }
    const trava = await E.pegarTrava();
    if (!trava) return { ok: false, pulou: "em_andamento", mensagem: "Já há uma leitura em andamento em outra aba." };

    const inicio = Date.now();
    const ac = E.acompanhar(trava, { fase: "abrindo" });
    try {
      const guardada = await E.leituraGuardada();
      if (guardada?.completa) {
        // a leitura de antes não chegou ao painel: só reenviar, sem pedir nada ao SIGPES
        return await E.enviar({ linhas: guardada.linhas, total: guardada.total, medidas: guardada.medidas, reenvio: true, inicio, acompanhamento: ac });
      }
      await ac.marcar({ fase: "abrindo" });
      const url = new URL(CFG.gerencia, location.origin).href;
      const pagina = await X.abrirTabela(url, buscarSigpesComPrazo);
      const retomada = guardada && guardada.total === pagina.total ? guardada : null;
      const ja = retomada ? new Set(retomada.linhas.map((l) => l[0])).size : 0;
      await ac.marcar({ fase: "lendo", lidos: ja, total: pagina.total, retomados: ja, lendoDesde: Date.now() });
      const { linhas, total, medidas } = await X.lerTodas(pagina, buscarSigpesComPrazo, {
        abrirOutra: () => X.abrirTabela(url, buscarSigpesComPrazo),
        prazoMs: PRAZO_PAGINA_MS,
        retomada,
        aoProgredir: ({ lidos, total: t }) => ac.marcar({ fase: "lendo", lidos, total: t }),
        aoBloco: (estado) => E.guardarLeitura(estado),
      });
      if (!linhas.length) throw new X.ErroLeitura("vazia", "A tabela veio vazia.");
      medidas.duracaoLeituraMs = Date.now() - inicio;
      await E.guardarLeitura({ total, bloco: medidas.bloco, linhas }, { completa: true, agora: true, medidas });
      // as medidas da última leitura ficam no status mesmo que o envio falhe (para o diagnóstico)
      await E.atualizarStatus({ ultimaLeitura: { quando: new Date().toISOString(), linhas: linhas.length, total, medidas } });
      return await E.enviar({ linhas, total, medidas, inicio, acompanhamento: ac });
    } catch (e) {
      // aqui só chegam erros da leitura do SIGPES (o envio registra o próprio resultado)
      ac.encerrar();
      const guardou = !!e?.estado?.linhas?.length;
      if (guardou) await E.guardarLeitura(e.estado, { agora: true });
      let mensagem = String(e?.message || e);
      if (SIGPES_INSTAVEL.has(e?.codigo) && e?.linha !== undefined) {
        const tot = e.estado?.total;
        mensagem = `O SIGPES parou de responder na linha ${fmtN(e.linha + 1)}${tot ? ` de ${fmtN(tot)}` : ""}, mesmo pedindo de novo em pedaços menores. Confira a conexão com a INTRAER (VPN).`;
        if (guardou) mensagem += ` As ${fmtN(e.lidas)} já lidas ficaram guardadas: a próxima tentativa continua daí.`;
      }
      const ultima = {
        quando: new Date().toISOString(), ok: false, mensagem, codigo: e?.codigo || null,
        retomavel: guardou && SIGPES_INSTAVEL.has(e?.codigo),
        lidas: e?.lidas ?? null, total: e?.estado?.total ?? null,
        duracaoMs: Date.now() - inicio, contaComoTentativa: e?.codigo !== "sessao",
      };
      await E.atualizarStatus({ ultima, andamento: null });
      return { ok: false, ultima };
    } finally {
      ac.encerrar();
      await E.soltarTrava(trava);
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
      await E.atualizarStatus({ ultima: { ...r.ultima, proximaEm } }).catch(() => {});
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
        const st = (await E.ler(E.CH_STATUS)) || null;
        const g = await E.leituraGuardada();
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
    if (r?.pulou === "em_andamento") setTimeout(() => { executar({}); }, E.VIVO_MS + 2000);
  }, 2500);
})();
