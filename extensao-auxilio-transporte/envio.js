// Envio ao painel, leitura guardada e trava entre abas. Usado pela página do SIGPES (content.js) e pelo
// popup, que envia uma leitura guardada sem precisar do SIGPES (por exemplo, depois de desligar a VPN).
(function (raiz) {
  "use strict";
  const api = raiz.browser ?? raiz.chrome;
  const CFG = raiz.CONFIG_AT;

  const CH_STATUS = "at_status";
  const CH_TRAVA = "at_trava";
  const CH_LEITURA = "at_leitura";
  const PULSO_MS = 4000;
  const VIVO_MS = 15000;                              // sem pulso por 15 s = tarefa interrompida
  const PARCIAL_VALE_MS = 60 * 60 * 1000;             // leitura pela metade: 1 h (depois a lista muda de posição)
  const COMPLETA_VALE_MS = 8 * 60 * 60 * 1000;        // leitura inteira ainda não enviada: 8 h, no mesmo dia
  const PRAZO_BANCO_MS = CFG.prazoBancoMs ?? 45000;
  const LOTE = 1000;
  const ERROS_DE_ENVIO = new Set(["sem_internet", "banco", "chave"]);

  class ErroEnvio extends Error {
    constructor(codigo, mensagem) { super(mensagem); this.codigo = codigo; }
  }

  const diaSP = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: CFG.fuso }).format(d);
  const ler = async (k) => (await api.storage.local.get(k))[k];
  const gravar = (k, v) => api.storage.local.set({ [k]: v });
  const fmtN = (n) => (n ?? 0).toLocaleString("pt-BR");
  // chave de envio embutida no pacote (sem configuração); marcador = pacote gerado sem as chaves
  const CHAVE = CFG.chaveEnvio && !CFG.chaveEnvio.startsWith("__") ? CFG.chaveEnvio : null;

  async function atualizarStatus(p) {
    const atual = (await ler(CH_STATUS)) || {};
    await gravar(CH_STATUS, { ...atual, ...p });
  }

  /** Rejeita com `mensagem` se a promessa não terminar em `ms`. */
  function comPrazo(promessa, ms, codigo, mensagem, aoEstourar) {
    let t;
    return Promise.race([promessa, new Promise((_, rejeitar) => {
      t = setTimeout(() => { try { aoEstourar?.(); } catch { /* nada */ } rejeitar(new ErroEnvio(codigo, mensagem)); }, ms);
    })]).finally(() => clearTimeout(t));
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
      if (e?.codigo === "banco_lento") throw new ErroEnvio("sem_internet", "Sem conexão com o painel (a internet está bloqueada ou lenta, por exemplo pela VPN).");
      throw new ErroEnvio("sem_internet", "Sem conexão com o painel (a internet está bloqueada, por exemplo pela VPN).");
    }
    if (!r.ok) {
      let msg = texto;
      try { msg = JSON.parse(texto).message || texto; } catch { /* texto puro */ }
      if (/chave_invalida/.test(msg)) throw new ErroEnvio("chave", "Chave de envio recusada. Peça o pacote atualizado a quem mantém a extensão.");
      throw new ErroEnvio("banco", `O painel recusou o envio (${r.status}): ${String(msg).slice(0, 160)}`);
    }
    return texto ? JSON.parse(texto) : null;
  }

  // ── trava entre abas (e o popup), com pulso ─────────────────────────────────
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

  /** Grava o andamento e mantém a trava viva a cada 4 s, até `encerrar()`. */
  function acompanhar(trava, inicial = {}) {
    let andamento = { desde: Date.now(), vivo: Date.now(), lidos: 0, total: null, retomados: 0, ...inicial };
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
    return { marcar, encerrar: () => { encerrada = true; clearInterval(pulso); }, desde: andamento.desde };
  }

  // ── leitura guardada ────────────────────────────────────────────────────────
  // As linhas ficam em at_leitura; um resumo pequeno fica em at_status.guardada, para o popup não ler tudo.
  function vale(meta) {
    if (!meta || !meta.atualizado || !meta.linhas) return false;
    if (diaSP(new Date(meta.atualizado)) !== diaSP(new Date())) return false;
    return Date.now() - meta.atualizado < (meta.completa ? COMPLETA_VALE_MS : PARCIAL_VALE_MS);
  }

  async function leituraGuardada() {
    let g = null;
    try { g = await ler(CH_LEITURA); } catch { return null; }
    if (!g || g.formato !== 1 || !Array.isArray(g.linhas) || !g.linhas.length) return null;
    return vale({ ...g, linhas: g.linhas.length }) ? g : null;
  }

  let ultimaGravacao = 0;
  async function guardarLeitura(estado, { completa = false, agora = false, medidas = null } = {}) {
    if (!agora && Date.now() - ultimaGravacao < 5000) return;   // no máximo a cada 5 s durante a leitura
    ultimaGravacao = Date.now();
    const atualizado = Date.now();
    try {
      await gravar(CH_LEITURA, { formato: 1, atualizado, completa, total: estado.total ?? null, bloco: estado.bloco ?? null,
        feitos: estado.feitos || [], linhas: estado.linhas, medidas });
      await atualizarStatus({ guardada: { completa, linhas: estado.linhas.length, total: estado.total ?? null, atualizado } });
    } catch { /* sem espaço: segue sem guardar */ }
  }

  async function apagarLeitura() {
    await api.storage.local.remove(CH_LEITURA);
    await atualizarStatus({ guardada: null });
  }

  /**
   * Envia as linhas ao painel e registra o resultado em at_status.ultima. Não lança: devolve { ok, ultima }.
   * `acompanhamento` = retorno de acompanhar() (marca o andamento e é encerrado antes do resultado final).
   */
  async function enviar({ linhas, total, medidas = null, reenvio = false, inicio = Date.now(), acompanhamento = null }) {
    const marcar = acompanhamento?.marcar ?? (async () => {});
    let execucao = null;
    try {
      await marcar({ fase: "enviando", lidos: 0, total: linhas.length });
      execucao = await rpc("at_iniciar", { p_chave: CHAVE, p_total: Math.max(total ?? 0, linhas.length), p_versao: CFG.versao });
      for (let i = 0; i < linhas.length; i += LOTE) {
        await rpc("at_lote", { p_chave: CHAVE, p_execucao: execucao, p_linhas: linhas.slice(i, i + LOTE) });
        await marcar({ fase: "enviando", lidos: Math.min(i + LOTE, linhas.length), total: linhas.length });
      }
      const fim = await rpc("at_concluir", { p_chave: CHAVE, p_execucao: execucao, p_erro: null });
      const ok = fim?.status === "ok";
      acompanhamento?.encerrar();
      // aceita ou recusada pelo painel, mandar de novo os mesmos dados não muda nada: a guardada sai
      await apagarLeitura();
      const ultima = {
        quando: new Date().toISOString(), ok, registros: linhas.length, total,
        novas: fim?.novas ?? null, alteradas: fim?.alteradas ?? null, sairam: fim?.sairam ?? null,
        parcial: !!fim?.parcial, faltaram: fim?.faltaram ?? null,
        duracaoMs: Date.now() - inicio, contaComoTentativa: true, reenvio, medidas,
        mensagem: ok ? null : `O painel recusou a leitura: vieram ${fmtN(linhas.length)} de ${fmtN(total)} solicitações do SIGPES.`,
      };
      await atualizarStatus({ ultima, andamento: null, ...(ok ? { ultimaOk: ultima.quando } : {}) });
      return { ok, ultima };
    } catch (e) {
      acompanhamento?.encerrar();
      if (execucao) {
        try { await rpc("at_concluir", { p_chave: CHAVE, p_execucao: execucao, p_erro: String(e?.message || e).slice(0, 300) }); } catch { /* fica como interrompida */ }
      }
      const inicioMsg = reenvio
        ? `Não consegui enviar ao painel a leitura guardada (${fmtN(linhas.length)} solicitações).`
        : `Li ${fmtN(linhas.length)} solicitações do SIGPES, mas não consegui enviar ao painel.`;
      const depois = e?.codigo === "chave" ? "" :
        " A leitura ficou guardada: com internet, clique em “Enviar leitura guardada” (não precisa do SIGPES aberto).";
      const ultima = {
        quando: new Date().toISOString(), ok: false, codigo: e?.codigo || null, retomavel: e?.codigo !== "chave",
        mensagem: `${inicioMsg} ${String(e?.message || e)}${depois}`,
        lidas: linhas.length, total, medidas, reenvio, duracaoMs: Date.now() - inicio, contaComoTentativa: true,
      };
      await atualizarStatus({ ultima, andamento: null });
      return { ok: false, ultima };
    }
  }

  raiz.EnvioAT = {
    CHAVE, CH_STATUS, CH_TRAVA, CH_LEITURA, VIVO_MS, ERROS_DE_ENVIO, ErroEnvio,
    diaSP, ler, gravar, fmtN, atualizarStatus, comPrazo, rpc, viva, pegarTrava, soltarTrava, acompanhar,
    vale, leituraGuardada, guardarLeitura, apagarLeitura, enviar,
  };
})(globalThis);
