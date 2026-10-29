// Leitura da tabela "Solicitação de Auxílio Transporte" (SIGPES, gerencia.xhtml).
// Não mexe na tela aberta: baixa uma cópia da página (estado próprio no servidor) e pede as páginas da
// tabela pela mesma requisição AJAX que o PrimeFaces usa ao paginar, com muitas linhas por vez.
// Funções puras de leitura (cabeçalho, linhas, valores) ficam separadas da rede, para teste.
(function (raiz) {
  "use strict";

  /** Colunas que interessam, pelo nome do cabeçalho (sem acento e em minúsculas). */
  const COLUNAS = {
    id: ["id"],
    solicitado: ["solicitado"],
    encaminhado: ["encaminhado"],
    situacao: ["situacao"],
    ordem: ["n ordem", "no ordem", "numero de ordem", "ordem"],
    pg: ["p/g", "pg", "posto/graduacao", "posto"],
    om: ["om"],
    nome: ["nome de guerra", "nome"],
    valor: ["valor"],
    trajetos: ["n de trajetos", "no de trajetos", "trajetos"],
    tarifas: ["tipo de tarifas", "tipo de tarifa", "tarifas"],
  };
  const OBRIGATORIAS = ["id", "situacao", "om", "nome", "valor"];
  /** Ordem dos campos no envio ao banco (at_lote). */
  const CAMPOS = ["id", "solicitado", "encaminhado", "situacao", "ordem", "pg", "om", "nome", "valor", "trajetos", "tarifas"];

  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[º°ª]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();

  /** Texto visível de uma célula, sem o rótulo que o PrimeFaces repete em tabela responsiva. */
  function textoCelula(td) {
    const c = td.cloneNode(true);
    c.querySelectorAll(".ui-column-title, script, style, input, select, textarea").forEach((e) => e.remove());
    return (c.textContent || "").replace(/\s+/g, " ").trim();
  }

  /** Cabeçalho → índice de cada coluna conhecida. Vale o nome exato; depois, o começo do nome. */
  function mapearCabecalho(ths) {
    const nomes = ths.map((th) => {
      const t = th.querySelector(".ui-column-title");
      return norm(t ? t.textContent : textoCelula(th));
    });
    const mapa = {};
    for (const [campo, candidatos] of Object.entries(COLUNAS)) {
      let i = nomes.findIndex((n) => candidatos.includes(n));
      if (i < 0) i = nomes.findIndex((n) => candidatos.some((c) => c.length > 2 && n.startsWith(c)));
      if (i >= 0) mapa[campo] = i;
    }
    return { mapa, nomes };
  }

  /** "22/02/2022" → "2022-02-22"; senão null. */
  function dataISO(t) {
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(t || "");
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  /** "R$ 1.278,20" → 1278.2; "R$ 0,00" → 0; vazio → null. */
  function dinheiro(t) {
    const s = String(t || "").replace(/R\$/i, "").replace(/[\s ]/g, "");
    if (!/\d/.test(s)) return null;
    const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function inteiro(t) {
    const m = /-?\d+/.exec(String(t || "").replace(/\./g, ""));
    return m ? Number(m[0]) : null;
  }

  /** Ícones da coluna de tarifas: título (ou classe) de cada um, com "(inativo)" quando aparece apagado. */
  function descreverTarifas(td) {
    const icones = [...td.querySelectorAll("i, img, span[class*='fa'], span[class*='icon'], a[title], span[title]")]
      .filter((e) => !e.querySelector("i, img"));
    const partes = [];
    for (const e of icones) {
      const nome = e.getAttribute("title") || e.getAttribute("alt") || e.getAttribute("aria-label")
        || ((e.getAttribute("class") || "").split(/\s+/).find((c) => /^(fa|pi|ui-icon|glyphicon|icon)-/.test(c) && !/^(fa|pi)-(fw|lg|\dx)$/.test(c)) || "");
      if (!nome) continue;
      const estilo = (e.getAttribute("style") || "") + " " + (e.getAttribute("class") || "");
      const apagado = /opacity|#(c|d|e)\w{2}\b|#(c|d|e)\w{5}\b|silver|gr[ae]y|lightgr|inativ|desativ|disabled|muted/i.test(estilo);
      partes.push(apagado ? `${nome} (inativo)` : nome);
    }
    return partes.length ? [...new Set(partes)].join("; ") : textoCelula(td) || null;
  }

  /** Uma linha da tabela → lista na ordem de CAMPOS; null quando a linha não é de solicitação. */
  function lerLinha(tr, mapa) {
    if (tr.classList.contains("ui-datatable-empty-message")) return null;
    const tds = [...tr.children].filter((e) => e.tagName === "TD");
    if (!tds.length) return null;
    const txt = (campo) => (mapa[campo] === undefined || !tds[mapa[campo]] ? null : textoCelula(tds[mapa[campo]]) || null);
    const id = inteiro(txt("id"));
    if (id === null) return null;
    return [
      id,
      dataISO(txt("solicitado")),
      dataISO(txt("encaminhado")),
      txt("situacao"),
      txt("ordem"),
      txt("pg"),
      txt("om"),
      txt("nome"),
      dinheiro(txt("valor")),
      inteiro(txt("trajetos")),
      mapa.tarifas !== undefined && tds[mapa.tarifas] ? descreverTarifas(tds[mapa.tarifas]) : null,
    ];
  }

  /** Total de registros do paginador ("1 de 1368 (13679 Registros)"). */
  function totalDoPaginador(raizEl) {
    for (const el of raizEl.querySelectorAll(".ui-paginator-current, [class*='paginator']")) {
      const m = /\(\s*([\d.]+)\s*registros?\s*\)/i.exec(el.textContent || "") || /([\d.]+)\s*registros?/i.exec(el.textContent || "");
      if (m) return Number(m[1].replace(/\./g, ""));
    }
    return null;
  }

  /** Acha a tabela de solicitações numa página (documento já carregado ou baixado). */
  function localizarTabela(doc) {
    for (const table of doc.querySelectorAll("table")) {
      const ths = [...table.querySelectorAll("thead tr:first-child th, thead th")];
      const unicos = [...new Set(ths)];
      if (unicos.length < 5) continue;
      const { mapa, nomes } = mapearCabecalho(unicos);
      if (!OBRIGATORIAS.every((c) => mapa[c] !== undefined)) continue;
      const container = table.closest(".ui-datatable") || table;
      const id = container.getAttribute("id") || table.getAttribute("id");
      const form = container.closest("form");
      return { table, container, tabelaId: id, form, mapa, nomes, total: totalDoPaginador(container) ?? totalDoPaginador(doc) };
    }
    return null;
  }

  /** Linhas de um trecho de tabela (tbody inteiro ou só os <tr> que o PrimeFaces devolve ao paginar). */
  function lerLinhasDeHtml(html, mapa) {
    const t = String(html || "").trim();
    const doc = new DOMParser().parseFromString(/^<tr[\s>]/i.test(t) ? `<table><tbody>${t}</tbody></table>` : t, "text/html");
    const corpo = doc.querySelector("tbody") || doc;
    return [...corpo.querySelectorAll("tr")].map((tr) => lerLinha(tr, mapa)).filter(Boolean);
  }

  // ── Rede ────────────────────────────────────────────────────────────────────

  /** Campos do formulário como o navegador enviaria (filtros da tela incluídos). */
  function camposDoFormulario(form) {
    const p = new URLSearchParams();
    for (const el of form.querySelectorAll("input, select, textarea")) {
      const nome = el.getAttribute("name");
      if (!nome || el.disabled) continue;
      const tipo = (el.getAttribute("type") || "").toLowerCase();
      if (["submit", "button", "image", "file", "reset"].includes(tipo)) continue;
      if ((tipo === "checkbox" || tipo === "radio") && !el.checked) continue;
      if (el.tagName === "SELECT") {
        const sel = [...el.options].filter((o) => o.selected);
        (sel.length ? sel : el.multiple ? [] : [el.options[0]].filter(Boolean)).forEach((o) => p.append(nome, o.value));
        continue;
      }
      p.append(nome, el.value ?? "");
    }
    return p;
  }

  function nomeViewState(form) {
    const el = form.querySelector("input[name$='faces.ViewState']");
    return el ? el.getAttribute("name") : "javax.faces.ViewState";
  }

  /** Corpo da requisição de paginação do PrimeFaces. */
  function corpoPaginacao(pagina, first, rows) {
    const { form, tabelaId } = pagina;
    const pref = pagina.viewStateNome.startsWith("jakarta") ? "jakarta" : "javax";
    const p = camposDoFormulario(form);
    p.set(pagina.viewStateNome, pagina.viewState);
    p.set(`${pref}.faces.partial.ajax`, "true");
    p.set(`${pref}.faces.source`, tabelaId);
    p.set(`${pref}.faces.partial.execute`, tabelaId);
    p.set(`${pref}.faces.partial.render`, tabelaId);
    p.set(tabelaId, tabelaId);
    p.set(`${tabelaId}_pagination`, "true");
    p.set(`${tabelaId}_first`, String(first));
    p.set(`${tabelaId}_rows`, String(rows));
    p.set(`${tabelaId}_skipChildren`, "true");
    p.set(`${tabelaId}_encodeFeature`, "true");
    return p;
  }

  /** Lê a resposta parcial do JSF: linhas da tabela, novo ViewState e total, quando vier. */
  function lerRespostaParcial(xml, pagina) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror")) throw new ErroLeitura("resposta_ilegivel", "O SIGPES respondeu algo que não é a tabela.");
    const redirect = doc.querySelector("redirect");
    if (redirect) throw new ErroLeitura("sessao", "A sessão do SIGPES expirou. Entre de novo no sistema.");
    const erro = doc.querySelector("error");
    if (erro) {
      const nome = erro.querySelector("error-name")?.textContent || "";
      throw new ErroLeitura(/ViewExpired/i.test(nome) ? "sessao" : "erro_servidor",
        /ViewExpired/i.test(nome) ? "A sessão do SIGPES expirou. Entre de novo no sistema." : `O SIGPES devolveu um erro (${nome || "sem nome"}).`);
    }
    let html = null, viewState = null, total = null;
    for (const u of doc.querySelectorAll("update")) {
      const id = u.getAttribute("id") || "";
      if (/ViewState/.test(id)) viewState = u.textContent;
      else if (id === pagina.tabelaId || (html === null && id.startsWith(pagina.tabelaId))) html = u.textContent;
    }
    for (const ext of doc.querySelectorAll("extension")) {
      try { const j = JSON.parse(ext.textContent || "{}"); if (Number.isFinite(j.totalRecords)) total = j.totalRecords; } catch { /* ignora */ }
    }
    if (html === null) throw new ErroLeitura("sem_tabela_na_resposta", "A resposta do SIGPES não trouxe a tabela.");
    return { linhas: lerLinhasDeHtml(html, pagina.mapa), viewState, total };
  }

  class ErroLeitura extends Error {
    constructor(codigo, mensagem) { super(mensagem); this.codigo = codigo; }
  }

  /** Baixa a página de gerência e prepara a leitura. `buscar` = fetch da página (no Firefox, content.fetch). */
  async function abrirTabela(url, buscar) {
    const r = await buscar(url, { credentials: "include", cache: "no-store" });
    if (!r.ok) throw new ErroLeitura("http", `O SIGPES respondeu ${r.status} ao abrir a gerência.`);
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const achada = localizarTabela(doc);
    if (!achada) {
      if (doc.querySelector("input[type='password']")) throw new ErroLeitura("sessao", "Entre no SIGPES para a leitura começar.");
      throw new ErroLeitura("sem_tabela", "A tabela de solicitações não apareceu na gerência (perfil sem acesso ou tela mudou).");
    }
    if (!achada.form || !achada.tabelaId) throw new ErroLeitura("sem_formulario", "A tabela não está num formulário do SIGPES.");
    const viewStateNome = nomeViewState(achada.form);
    const vsEl = achada.form.querySelector(`input[name='${CSS.escape(viewStateNome)}']`);
    if (!vsEl) throw new ErroLeitura("sem_viewstate", "A página não trouxe o ViewState do JSF.");
    const acao = new URL(achada.form.getAttribute("action") || url, url).href;
    return { ...achada, url, acao, viewStateNome, viewState: vsEl.value, primeiras: lerLinhasDeHtml(achada.table.querySelector("tbody")?.innerHTML || "", achada.mapa) };
  }

  /**
   * Lê todas as solicitações, página por página, a partir da linha 0.
   * O servidor pode devolver menos linhas que o pedido: o próximo pedido começa onde a resposta terminou.
   */
  async function lerTodas(pagina, buscar, { porPagina = 500, pausaMs = 150, aoProgredir = () => {} } = {}) {
    const porId = new Map();
    let total = pagina.total;
    let first = 0;
    let voltas = 0;
    while (total === null || first < total) {
      if (++voltas > 2000) throw new ErroLeitura("voltas", "Leitura parou: páginas demais.");
      const r = await buscar(pagina.acao, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Faces-Request": "partial/ajax",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/xml, text/xml, */*; q=0.01",
        },
        body: corpoPaginacao(pagina, first, porPagina).toString(),
      });
      if (!r.ok) throw new ErroLeitura("http", `O SIGPES respondeu ${r.status} na página que começa na linha ${first + 1}.`);
      const resp = lerRespostaParcial(await r.text(), pagina);
      if (resp.viewState) pagina.viewState = resp.viewState;
      if (resp.total !== null) total = resp.total;
      if (!resp.linhas.length) break;
      for (const l of resp.linhas) porId.set(l[0], l);
      first += resp.linhas.length;
      aoProgredir({ lidos: porId.size, total });
      if (total === null && resp.linhas.length < porPagina) break;
      if (pausaMs) await new Promise((ok) => setTimeout(ok, pausaMs));
    }
    return { linhas: [...porId.values()], total: total ?? porId.size };
  }

  /** Relatório da estrutura da página, sem dado pessoal (para ajustar o leitor se o SIGPES mudar). */
  function diagnostico(doc, extra = {}) {
    const mascarar = (s) => String(s ?? "").replace(/[A-Za-zÀ-ÿ]/g, "a").replace(/\d/g, "9");
    const achada = localizarTabela(doc);
    const tabelas = [...doc.querySelectorAll("table")].map((t) => ({
      id: t.id || null,
      container: t.closest(".ui-datatable")?.id || null,
      cabecalhos: [...t.querySelectorAll("thead th")].map((th) => norm(textoCelula(th))).slice(0, 20),
      linhas: t.querySelectorAll("tbody tr").length,
    })).slice(0, 10);
    const form = achada?.form;
    return {
      quando: new Date().toISOString(),
      endereco: location.pathname,
      tabelaEncontrada: !!achada,
      tabelaId: achada?.tabelaId ?? null,
      mapa: achada?.mapa ?? null,
      cabecalhos: achada?.nomes ?? null,
      total: achada?.total ?? null,
      formulario: form ? { id: form.id, acao: (form.getAttribute("action") || "").replace(/;jsessionid=[^?]*/i, ";jsessionid=…"),
        campos: [...new Set([...form.querySelectorAll("[name]")].map((e) => `${e.tagName.toLowerCase()}:${e.getAttribute("type") || ""}:${e.getAttribute("name")}`))].slice(0, 60) } : null,
      primeiraLinha: achada ? [...(achada.table.querySelector("tbody tr")?.children ?? [])].map((td) => mascarar(textoCelula(td)).slice(0, 30)) : null,
      paginador: [...doc.querySelectorAll(".ui-paginator-current")].map((e) => mascarar(e.textContent)).slice(0, 2),
      tabelas,
      ...extra,
    };
  }

  raiz.ExtratorAT = {
    CAMPOS, COLUNAS, norm, textoCelula, mapearCabecalho, dataISO, dinheiro, inteiro, lerLinha, totalDoPaginador,
    localizarTabela, lerLinhasDeHtml, camposDoFormulario, corpoPaginacao, lerRespostaParcial, abrirTabela, lerTodas,
    diagnostico, ErroLeitura,
  };
})(globalThis);
