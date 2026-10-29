// Popup: mostra a última sincronização (e o andamento, se houver) e abre o painel. Não há o que configurar:
// a chave de envio e o código do painel vêm no pacote.
(function () {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const CFG = globalThis.CONFIG_AT;
  const SIGPES = ["*://sigpes.servicos.ccarj.intraer/*"];
  const $ = (id) => document.getElementById(id);
  const fmtN = (n) => (n ?? 0).toLocaleString("pt-BR");
  const embutido = (v) => !!v && !v.startsWith("__");

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

  async function temPermissao() {
    try { return await api.permissions.contains({ origins: SIGPES }); } catch { return true; }
  }

  async function render() {
    const { at_status: st = {} } = await api.storage.local.get("at_status");
    const ponto = $("ponto"), texto = $("estado-texto"), detalhe = $("detalhe"), barra = $("barra");
    // andamento só vale enquanto a leitura "pulsa" (a cada 4 s) e se não houver resultado mais novo que ele
    const resto = st.andamento && !(st.ultima && new Date(st.ultima.quando).getTime() >= st.andamento.desde) ? st.andamento : null;
    const andamento = resto && Date.now() - (resto.vivo ?? resto.desde) < 15000 ? resto : null;
    const interrompida = resto && !andamento;
    barra.hidden = !andamento;
    $("sincronizar").disabled = !!andamento || !embutido(CFG.chaveEnvio);
    detalhe.innerHTML = "";

    if (!embutido(CFG.chaveEnvio)) {
      ponto.dataset.estado = "erro";
      texto.textContent = "Pacote sem a chave do painel";
      detalhe.textContent = "Esta cópia da extensão foi gerada sem as chaves. Peça o pacote atualizado a quem mantém a extensão.";
    } else if (interrompida) {
      ponto.dataset.estado = "erro";
      texto.textContent = "A leitura foi interrompida";
      detalhe.textContent = "A página do SIGPES mudou ou foi fechada durante a leitura, ou a conexão caiu. Ela recomeça sozinha em instantes com o SIGPES aberto; ou clique em “Sincronizar agora”.";
      if (st.ultimaOk) detalhe.append(document.createElement("br"), `Último sucesso: ${quando(st.ultimaOk)}.`);
    } else if (andamento) {
      ponto.dataset.estado = "andamento";
      const fase = { abrindo: "Abrindo a gerência no SIGPES…", lendo: "Lendo as solicitações…", enviando: "Enviando ao painel…" }[andamento.fase] || "Sincronizando…";
      texto.textContent = fase;
      const total = andamento.total || 0;
      $("barra-cheia").style.width = total ? `${Math.min(100, (andamento.lidos / total) * 100).toFixed(1)}%` : "8%";
      const seg = Math.max(0, Math.round((Date.now() - andamento.desde) / 1000));
      detalhe.textContent = `${total ? `${fmtN(andamento.lidos)} de ${fmtN(total)} · ` : ""}há ${seg} s`;
    } else if (st.ultima?.ok) {
      ponto.dataset.estado = "ok";
      texto.textContent = `Sincronizado ${quando(st.ultima.quando)}`;
      const partes = [`<b>${fmtN(st.ultima.registros)}</b> solicitações`];
      if (st.ultima.novas) partes.push(`${fmtN(st.ultima.novas)} novas`);
      if (st.ultima.alteradas) partes.push(`${fmtN(st.ultima.alteradas)} alteradas`);
      if (st.ultima.sairam) partes.push(`${fmtN(st.ultima.sairam)} saíram da lista`);
      detalhe.innerHTML = partes.join(" · ");
      if (st.ultima.parcial) detalhe.append(document.createElement("br"), "Seu perfil vê só parte da lista: o painel atualizou essas e manteve as demais.");
    } else if (st.ultima) {
      ponto.dataset.estado = "erro";
      texto.textContent = `A sincronização ${quando(st.ultima.quando)} falhou`;
      detalhe.textContent = st.ultima.mensagem || "Erro sem descrição.";
      if (st.ultimaOk) detalhe.append(document.createElement("br"), `Último sucesso: ${quando(st.ultimaOk)}.`);
    } else {
      ponto.dataset.estado = "";
      texto.textContent = "Ainda não sincronizado";
      detalhe.textContent = "A leitura acontece sozinha quando você entra no Auxílio Transporte do SIGPES (uma vez por dia).";
    }

    const painel = $("abrir-painel");
    if (embutido(CFG.codigoPainel)) {
      painel.href = `${CFG.painelUrl}#k=${encodeURIComponent(CFG.codigoPainel)}`;
      painel.removeAttribute("aria-disabled");
    } else {
      painel.href = "#";
      painel.setAttribute("aria-disabled", "true");
    }
    $("permitir").hidden = await temPermissao();
  }

  async function abaDoSigpes() {
    const abas = await api.tabs.query({ url: "*://sigpes.servicos.ccarj.intraer/auxilio-transporte/*" });
    return abas[0] || null;
  }

  async function pedirPermissao() {
    return api.permissions.request({ origins: [...SIGPES, `${CFG.supabaseUrl}/*`] }).catch(() => false);
  }

  $("permitir").addEventListener("click", async () => {
    if (!(await pedirPermissao())) aviso("Sem essa permissão a extensão não consegue ler o SIGPES.");
    render();
  });

  $("sincronizar").addEventListener("click", async () => {
    aviso("");
    if (!(await temPermissao()) && !(await pedirPermissao())) { aviso("Sem permissão para ler o SIGPES. Autorize a extensão e tente de novo."); return; }
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

  $("diagnostico").addEventListener("click", async () => {
    const aba = await abaDoSigpes();
    if (!aba) { aviso("Abra o Auxílio Transporte do SIGPES numa aba para gerar o diagnóstico."); return; }
    try {
      const r = await api.tabs.sendMessage(aba.id, { tipo: "diagnostico" });
      await navigator.clipboard.writeText(JSON.stringify(r?.diagnostico ?? r, null, 2));
      aviso("");
      $("nota").textContent = "Diagnóstico copiado. Cole numa mensagem para quem mantém a extensão.";
    } catch (e) {
      aviso(`Não consegui gerar o diagnóstico: ${e?.message || e}`);
    }
  });

  api.storage.onChanged.addListener((mudou, area) => { if (area === "local" && mudou.at_status) render(); });
  // redesenha a cada 2 s: atualiza o tempo e percebe uma leitura que parou de pulsar
  setInterval(render, 2000);
  render();
})();
