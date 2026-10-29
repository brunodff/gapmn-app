// Popup: mostra a última sincronização (e o andamento, se houver), abre o painel e guarda a configuração.
(function () {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const CFG = globalThis.CONFIG_AT;
  const SIGPES = ["*://sigpes.servicos.ccarj.intraer/*"];
  const $ = (id) => document.getElementById(id);
  const fmtN = (n) => (n ?? 0).toLocaleString("pt-BR");

  function quando(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const dia = (x) => new Intl.DateTimeFormat("en-CA", { timeZone: CFG.fuso }).format(x);
    const hora = d.toLocaleTimeString("pt-BR", { timeZone: CFG.fuso, hour: "2-digit", minute: "2-digit" });
    if (dia(d) === dia(new Date())) return `hoje às ${hora}`;
    return `${d.toLocaleDateString("pt-BR", { timeZone: CFG.fuso })} às ${hora}`;
  }

  function aviso(texto) {
    $("aviso").hidden = !texto;
    $("aviso").textContent = texto || "";
  }

  async function render() {
    const { at_status: st = {}, at_config: cfg = {} } = await api.storage.local.get(["at_status", "at_config"]);
    const ponto = $("ponto"), texto = $("estado-texto"), detalhe = $("detalhe"), barra = $("barra");
    const andamento = st.andamento && Date.now() - st.andamento.desde < 20 * 60 * 1000 ? st.andamento : null;
    barra.hidden = !andamento;
    $("sincronizar").disabled = !!andamento || !cfg.chave;
    detalhe.innerHTML = "";

    if (!cfg.chave) {
      ponto.dataset.estado = "";
      texto.textContent = "Falta configurar";
      detalhe.textContent = "Cole o código de configuração recebido em “Configuração”, abaixo.";
      $("config").open = true;
    } else if (andamento) {
      ponto.dataset.estado = "andamento";
      const fase = { abrindo: "Abrindo a gerência no SIGPES…", lendo: "Lendo as solicitações…", enviando: "Enviando ao painel…" }[andamento.fase] || "Sincronizando…";
      texto.textContent = fase;
      const total = andamento.total || 0;
      $("barra-cheia").style.width = total ? `${Math.min(100, (andamento.lidos / total) * 100).toFixed(1)}%` : "8%";
      detalhe.textContent = total ? `${fmtN(andamento.lidos)} de ${fmtN(total)}` : "";
    } else if (st.ultima?.ok) {
      ponto.dataset.estado = "ok";
      texto.textContent = `Sincronizado ${quando(st.ultima.quando)}`;
      const partes = [`<b>${fmtN(st.ultima.registros)}</b> solicitações`];
      if (st.ultima.novas) partes.push(`${fmtN(st.ultima.novas)} novas`);
      if (st.ultima.alteradas) partes.push(`${fmtN(st.ultima.alteradas)} alteradas`);
      if (st.ultima.sairam) partes.push(`${fmtN(st.ultima.sairam)} saíram da lista`);
      detalhe.innerHTML = partes.join(" · ");
    } else if (st.ultima) {
      ponto.dataset.estado = "erro";
      texto.textContent = `A sincronização ${quando(st.ultima.quando)} falhou`;
      detalhe.textContent = st.ultima.mensagem || "Erro sem descrição.";
      if (st.ultimaOk) detalhe.append(document.createElement("br"), `Último sucesso: ${quando(st.ultimaOk)}.`);
    } else {
      ponto.dataset.estado = "";
      texto.textContent = "Ainda não sincronizado";
      detalhe.textContent = "A primeira leitura acontece quando você entrar no Auxílio Transporte do SIGPES.";
    }

    const painel = $("abrir-painel");
    if (cfg.painel) {
      painel.href = `${CFG.painelUrl}#k=${encodeURIComponent(cfg.painel)}`;
      painel.removeAttribute("aria-disabled");
    } else {
      painel.href = "#";
      painel.setAttribute("aria-disabled", "true");
    }
    $("config-estado").textContent = cfg.chave ? "Configurado. Para trocar, cole um código novo." : "";
  }

  async function abaDoSigpes() {
    const abas = await api.tabs.query({ url: "*://sigpes.servicos.ccarj.intraer/auxilio-transporte/*" });
    return abas[0] || null;
  }

  async function temPermissao() {
    try { return await api.permissions.contains({ origins: SIGPES }); } catch { return true; }
  }

  $("sincronizar").addEventListener("click", async () => {
    aviso("");
    if (!(await temPermissao())) {
      const ok = await api.permissions.request({ origins: [...SIGPES, `${CFG.supabaseUrl}/*`] }).catch(() => false);
      if (!ok) { aviso("Sem permissão para ler o SIGPES. Autorize a extensão e tente de novo."); return; }
    }
    const aba = await abaDoSigpes();
    if (!aba) { aviso("Abra o Auxílio Transporte do SIGPES numa aba e tente de novo."); return; }
    $("sincronizar").disabled = true;
    try {
      const r = await api.tabs.sendMessage(aba.id, { tipo: "sincronizar", forcar: true });
      if (r?.pulou === "em_andamento") aviso(r.mensagem);
      else if (r && !r.ok && r.mensagem && !r.ultima) aviso(r.mensagem);
    } catch {
      aviso("A aba do SIGPES ainda não está pronta. Recarregue a página dele e tente de novo.");
    } finally {
      render();
    }
  });

  $("salvar").addEventListener("click", async () => {
    const bruto = $("codigo").value.trim();
    const m = /^AT1\.([A-Za-z0-9_-]{20,})\.([A-Za-z0-9_-]{20,})$/.exec(bruto);
    if (!m) { $("config-estado").textContent = "Código inválido. Ele começa com AT1. e tem duas partes separadas por ponto."; return; }
    await api.storage.local.set({ at_config: { chave: m[1], painel: m[2] } });
    $("codigo").value = "";
    if (!(await temPermissao())) await api.permissions.request({ origins: [...SIGPES, `${CFG.supabaseUrl}/*`] }).catch(() => false);
    render();
  });

  $("diagnostico").addEventListener("click", async () => {
    const aba = await abaDoSigpes();
    if (!aba) { aviso("Abra o Auxílio Transporte do SIGPES numa aba para gerar o diagnóstico."); return; }
    try {
      const r = await api.tabs.sendMessage(aba.id, { tipo: "diagnostico" });
      await navigator.clipboard.writeText(JSON.stringify(r?.diagnostico ?? r, null, 2));
      aviso("");
      $("config-estado").textContent = "Diagnóstico copiado. Cole numa mensagem para quem mantém a extensão.";
    } catch (e) {
      aviso(`Não consegui gerar o diagnóstico: ${e?.message || e}`);
    }
  });

  api.storage.onChanged.addListener((mudou, area) => { if (area === "local" && (mudou.at_status || mudou.at_config)) render(); });
  render();
})();
