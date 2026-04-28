/**
 * SILOMS Bot — Extrai solicitações de empenho recebidas e sobe ao Supabase.
 *
 * Uso:
 *   node bot.js                        ← usa variáveis de ambiente
 *   node bot.js <CPF> <SENHA> [ANO]    ← passagem direta
 *
 * Variáveis de ambiente (alternativa):
 *   SILOMS_CPF=xxx SILOMS_SENHA=yyy SILOMS_ANO=2026 node bot.js
 */

// Bypass SSL inspection corporativa (VPN com certificado intermediário)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Node 18+ usa fetch nativo via undici — precisa desabilitar verificação TLS separadamente
try {
  const { Agent, setGlobalDispatcher } = require("undici");
  setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));
} catch (_) {}

const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const XLSX = require("xlsx");
const path = require("path");
const fs   = require("fs");

// ── Configuração ─────────────────────────────────────────────────────────────
const SILOMS_PORTAL     = "https://www.siloms.intraer/";
const SILOMS_MAC_URL    = "http://mac.siloms.intraer/siloms_mac";
const OUTPUT_DIR        = path.join(__dirname, "output");
const SUPABASE_URL      = "https://fychrtyyqbzlfbzbvzqp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw";

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) { console.log(`[${new Date().toLocaleTimeString("pt-BR")}] ${msg}`); }

async function screenshot(page, nome) {
  try {
    const file = path.join(OUTPUT_DIR, `debug_${nome}.png`);
    await page.screenshot({ path: file, fullPage: false });
    log(`📸 Screenshot: ${file}`);
  } catch (_) {}
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function fazerLogin(page, cpf, senha) {
  // Vai direto para o módulo MAC — isso aciona o redirect SSO
  log("Acessando módulo MAC (Aquisições e Contratos)...");
  await page.goto(SILOMS_MAC_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await screenshot(page, "01_apos_goto_mac");
  log(`URL após goto MAC: ${page.url()}`);

  // Aguarda o redirect para SSO
  if (!page.url().includes("authenticationendpoint")) {
    log("Aguardando redirect para SSO...");
    await page.waitForURL("**/authenticationendpoint/**", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  await screenshot(page, "02_login_sso");
  log(`URL SSO: ${page.url()}`);

  if (!page.url().includes("authenticationendpoint")) {
    throw new Error(`SSO não foi acionado. URL atual: ${page.url()}. Veja debug_02_login_sso.png`);
  }

  // Preenche CPF e senha no formulário WSO2 Identity Server
  const cpfLimpo = cpf.replace(/\D/g, "");

  const campoUser  = await page.$("input[name='username'], input[id='username']");
  const campoSenha = await page.$("input[name='password'], input[id='password']");

  if (!campoUser)  throw new Error("Campo usuário não encontrado no SSO. Veja debug_02_login_sso.png");
  if (!campoSenha) throw new Error("Campo senha não encontrado no SSO. Veja debug_02_login_sso.png");

  await campoUser.fill(cpfLimpo);
  log(`Usuário preenchido: ${cpfLimpo}`);
  await campoSenha.fill(senha);
  log("Senha preenchida");

  await screenshot(page, "03_antes_submit");

  const btnSubmit = await page.$("button[type='submit'], input[type='submit'], button:has-text('Sign In'), button:has-text('Entrar')");
  if (btnSubmit) {
    await btnSubmit.click();
  } else {
    await page.keyboard.press("Enter");
  }

  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await screenshot(page, "04_pos_login");

  const url  = page.url();
  const body = await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");
  log(`URL pós-login: ${url}`);

  if (url.includes("authenticationendpoint") || body.toLowerCase().includes("invalid") || body.toLowerCase().includes("incorret") || body.toLowerCase().includes("inválid")) {
    throw new Error(`Login SSO falhou. Veja debug_04_pos_login.png`);
  }
  log("✅ Login SSO realizado com sucesso.");
}

// ── Navegação ─────────────────────────────────────────────────────────────────
async function navegarParaEmpenhos(page) {
  log("Clicando no menu Empenho...");
  await page.click("text=Empenho");
  await page.waitForTimeout(1200);
  await screenshot(page, "04_menu_empenho");

  log("Clicando em Solicitação de Empenho (Recebidas)...");
  await page.click("text=Solicitação de Empenho (Recebidas)");
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4000);
  // Aguarda o campo de data aparecer (em qualquer frame)
  await encontrarFrame(page, "input[name='vdt_pams_ini']", false);
  await page.waitForTimeout(1000);
  await screenshot(page, "05_pagina_empenhos");
}

// ── Step 2: Empenho > Solicitação de Anulação/Reforço (Recebidas) ─────────────
async function navegarParaAnulacaoReforco(page) {
  log("Voltando ao MAC para Anulação/Reforço...");
  await page.goto(SILOMS_MAC_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  log("Clicando no menu Empenho (Anulação/Reforço)...");
  await page.click("text=Empenho");
  await page.waitForTimeout(1200);
  await screenshot(page, "09_menu_anulacao");

  log("Clicando em Solicitação de Anulação/Reforço (Recebidas)...");
  // Tenta texto exato, depois substring
  const clicou = await page.locator("text=Solicitação de Anulação/Reforço (Recebidas)").click().then(() => true).catch(() => false);
  if (!clicou) {
    await page.locator("text=Anulação").first().click().catch(() => {});
  }
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await screenshot(page, "10_anulacao_reforco");
}

// ── Step 3: Documentos > Documentos na Unidade ────────────────────────────────
// ── Helper: preenche campo Nome no formulário Documentos na Unidade ───────────
async function preencherCampoNome(page, valor) {
  const frame = await encontrarFrame(page, "input[type='text']");
  await frame.evaluate((v) => {
    // Estratégia 1: input com name/id contendo "nome"
    for (const inp of document.querySelectorAll("input[type='text']")) {
      const n = (inp.name || inp.id || "").toLowerCase();
      if (n.includes("nome")) {
        inp.value = v;
        inp.dispatchEvent(new Event("input",  { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }
    // Estratégia 2: label "Nome"
    for (const td of document.querySelectorAll("td, label")) {
      if ((td.textContent || "").trim().toLowerCase() === "nome") {
        const next = td.nextElementSibling?.querySelector("input[type='text']")
                  || td.parentElement?.nextElementSibling?.querySelector("input[type='text']");
        if (next) {
          next.value = v;
          next.dispatchEvent(new Event("input",  { bubbles: true }));
          next.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
      }
    }
  }, valor);
  return frame;
}

// ── Helper: submete formulário de pesquisa ────────────────────────────────────
async function submeterPesquisa(frame, page) {
  await frame.evaluate(() => {
    for (const el of document.querySelectorAll("input[type='image'], img")) {
      const src = (el.src || el.getAttribute("src") || "").toLowerCase();
      if (src.includes("pesquis") || src.includes("bino") || src.includes("lupa") || src.includes("search")) { el.click(); return; }
    }
    const btn = document.querySelector("input[type='submit'], button[type='submit']");
    if (btn) { btn.click(); return; }
    document.querySelector("form")?.submit();
  });
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

// ── Helper: raspa 1ª linha da tabela de resultados ───────────────────────────
async function rasparPrimeiraLinha(page) {
  const extrator = () => {
    const RE = /26[SM]\d{4}/i;
    const tabelas = Array.from(document.querySelectorAll("table")).filter(t => t.querySelector("th") && t.querySelectorAll("th").length >= 3);
    for (const tabela of tabelas) {
      const ths     = Array.from(tabela.querySelectorAll("th")).map(th => (th.textContent || "").trim().toLowerCase());
      const iNr     = ths.findIndex(h => h.startsWith("nr") || h.includes("número") || h.includes("doc"));
      const iNome   = ths.findIndex(h => h === "nome");
      const iPerfil = ths.findIndex(h => h.includes("perfil") && (h.includes("atual") || h.includes("unidade")));
      if (iNome < 0) continue;
      const rows = Array.from(tabela.querySelectorAll("tbody tr")).filter(tr => tr.querySelectorAll("td").length > 2);
      for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll("td")).map(td => (td.textContent || "").trim());
        const nome  = cells[iNome] || "";
        const m     = nome.match(RE);
        if (!m) continue;
        return { nr_documento: cells[iNr] || "", perfil_atual: cells[iPerfil] || "", solicitacao: m[0].toUpperCase(), nome };
      }
    }
    return null;
  };

  // Estratégia 1: DOM em cada frame
  for (const frame of page.frames()) {
    try { const r = await frame.evaluate(extrator); if (r) return r; } catch (_) {}
  }

  // Estratégia 2: parseia o HTML bruto (fallback universal)
  for (const frame of page.frames()) {
    try {
      const html = await frame.content();
      const RE   = /26[SM]\d{4}/i;
      const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
          .map(c => c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()));
      const hi = rows.findIndex(r => r.some(c => c.toLowerCase() === "nome"));
      if (hi < 0) continue;
      const hdrs  = rows[hi].map(c => c.toLowerCase());
      const iNr   = hdrs.findIndex(h => h.startsWith("nr") || h.includes("doc"));
      const iNome = hdrs.findIndex(h => h === "nome");
      const iPerf = hdrs.findIndex(h => h.includes("perfil") && h.includes("atual"));
      for (const row of rows.slice(hi + 1)) {
        if (row.length < 3) continue;
        const nome = iNome >= 0 ? row[iNome] : "";
        const m    = nome.match(RE);
        if (!m) continue;
        return { nr_documento: row[iNr] || "", perfil_atual: row[iPerf] || "", solicitacao: m[0].toUpperCase(), nome };
      }
    } catch (_) {}
  }

  return null;
}

// ── Busca a última NE registrada no Supabase para o ano ──────────────────────
async function buscarUltimaNE(ano, onStatus = log) {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await sb
      .from("siloms_solicitacoes_empenho")
      .select("empenho_siafi")
      .like("empenho_siafi", `${ano}NE%`)
      .not("empenho_siafi", "is", null);
    if (!data || !data.length) { onStatus(`Nenhuma NE ${ano} no Supabase — começando do 1`); return 0; }
    let max = 0;
    for (const r of data) {
      const m = (r.empenho_siafi || "").match(/NE0*(\d+)$/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    onStatus(`Última NE registrada: ${ano}NE${String(max).padStart(6, "0")} — buscando a partir da ${max + 1}`);
    return max;
  } catch (err) {
    onStatus(`⚠️  Não foi possível consultar Supabase: ${err.message} — começando do 1`);
    return 0;
  }
}

// ── Step 3: Documentos na Unidade — busca NEs sequencialmente a partir da última ──
async function navegarParaDocumentosNaUnidade(page, onStatus = log, ultimaNeNum = 0, ano = "2026") {
  const MAX_FALHAS_CONSECUTIVAS = 5; // para quando N NEs seguidas não forem encontradas
  const fmtNE = (n) => `${ano}NE${String(n).padStart(6, "0")}`;

  onStatus(`Passo 3: buscando NEs a partir de ${fmtNE(ultimaNeNum + 1)} (para após ${MAX_FALHAS_CONSECUTIVAS} falhas consecutivas)`);

  // Navega para Documentos na Unidade e salva a URL do formulário
  onStatus("Navegando para Documentos > Documentos na Unidade...");
  await page.goto(SILOMS_MAC_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.click("text=Documentos");
  await page.waitForTimeout(1200);
  await page.locator("text=Documentos na Unidade").first().click();
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await screenshot(page, "11_docs_unidade_form");

  const formUrl = page.url();

  const results = [];
  let neNum = ultimaNeNum + 1;
  let falhasConsecutivas = 0;
  let comSubproc = 0, semSubproc = 0, total = 0;

  while (falhasConsecutivas < MAX_FALHAS_CONSECUTIVAS) {
    const ne = fmtNE(neNum);
    onStatus(`[${total + 1}] Buscando ${ne} (${falhasConsecutivas} falha(s) consec.)...`);

    let achado = null;

    for (const status of ["Ativo", "Arquivado"]) {
      await page.goto(formUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);

      const frame = await preencherCampoNome(page, ne);

      await frame.evaluate(() => {
        for (const cb of document.querySelectorAll("input[type='checkbox']")) {
          const lbl = (cb.labels?.[0]?.textContent || cb.closest("label")?.textContent || cb.nextSibling?.textContent || "").toLowerCase();
          if ((lbl.includes("meu perfil") || lbl.includes("somente")) && cb.checked) cb.click();
        }
      });

      await frame.evaluate((st) => {
        for (const sel of document.querySelectorAll("select")) {
          const opts = Array.from(sel.options);
          const opt  = opts.find(o => o.text.toLowerCase().includes(st.toLowerCase()));
          if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return; }
        }
      }, status);

      await submeterPesquisa(frame, page);
      achado = await rasparPrimeiraLinha(page);
      if (achado) break;
    }

    if (achado) {
      results.push({ nota_empenho: ne, ...achado });
      onStatus(`  ✅ ${ne} → subproc: ${achado.nr_documento} | perfil: ${achado.perfil_atual}`);
      comSubproc++;
      falhasConsecutivas = 0; // zera a contagem de falhas ao achar
    } else {
      results.push({ nota_empenho: ne, nr_documento: "s/ subprocesso", perfil_atual: "", solicitacao: "" });
      onStatus(`  ⚪ ${ne} → não encontrada (falha ${falhasConsecutivas + 1}/${MAX_FALHAS_CONSECUTIVAS})`);
      semSubproc++;
      falhasConsecutivas++;
    }

    total++;
    neNum++;

    if (total % 10 === 0)
      await screenshot(page, `14_progresso_${total}`);
  }

  onStatus(`Passo 3 concluído: ${comSubproc} encontradas · ${semSubproc} sem subprocesso · parou em ${fmtNE(neNum - 1)}`);
  return results;
}

// ── Upload subprocesso + perfil_atual para Supabase ──────────────────────────
async function uploadPerfisAtual(docs, onStatus = log) {
  if (!docs.length) { onStatus("Nenhum documento para atualizar."); return; }
  const key = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  const sb  = createClient(SUPABASE_URL, key);
  let ok = 0, err = 0;
  for (const doc of docs) {
    if (doc.nr_documento === "s/ subprocesso") {
      // Marca como sem subprocesso pela NE SIAFI
      const { error } = await sb.from("siloms_solicitacoes_empenho")
        .update({ subprocesso: "s/ subprocesso" })
        .eq("empenho_siafi", doc.nota_empenho);
      if (error) err++; else ok++;
      continue;
    }
    // Encontrado: atualiza por solicitacao (chave semântica)
    const campos = { subprocesso: doc.nr_documento };
    if (doc.perfil_atual) campos.perfil_atual = doc.perfil_atual;
    if (doc.solicitacao) {
      const { error } = await sb.from("siloms_solicitacoes_empenho")
        .update(campos).eq("solicitacao", doc.solicitacao);
      if (error) err++; else ok++;
    }
    // Também atualiza por empenho_siafi (caso a solicitação não esteja no SILOMS ainda)
    await sb.from("siloms_solicitacoes_empenho")
      .update(campos).eq("empenho_siafi", doc.nota_empenho);
  }
  onStatus(`✅ Passo 3 Supabase: ${ok} atualizados, ${err} erros`);
}

// ── Helper: acha o frame que contém o seletor ────────────────────────────────
async function encontrarFrame(page, selector, verbose = false) {
  const frames = page.frames();
  if (verbose) log(`  Frames disponíveis (${frames.length}): ${frames.map(f => f.url()).join(" | ")}`);
  for (const frame of frames) {
    const el = await frame.$(selector).catch(() => null);
    if (el) { if (verbose) log(`  Frame com "${selector}": ${frame.url()}`); return frame; }
  }
  if (verbose) log(`  "${selector}" não encontrado em nenhum frame`);
  return page;
}

// ── Helper: preenche data via JS em qualquer frame ────────────────────────────
async function preencherData(page, name, valor) {
  const frame = await encontrarFrame(page, `input[name='${name}']`);
  const ok = await frame.evaluate(({ n, v }) => {
    const el = document.querySelector(`input[name='${n}']`);
    if (!el) return false;
    el.value = v;
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur",   { bubbles: true }));
    return true;
  }, { n: name, v: valor });
  log(`  Data ${name}: ${valor} (${ok ? "✅" : "❌ não encontrado"})`);
}

// ── Filtros e pesquisa ────────────────────────────────────────────────────────
async function configurarFiltros(page, ano = "2026") {
  log(`Configurando filtros — apenas ano ${ano}...`);

  // Preenche datas: 01/01/ANO a 31/12/ANO para trazer só NEs do ano selecionado
  await preencherData(page, "vdt_pams_ini", `01/01/${ano}`);
  await preencherData(page, "vdt_pams_fim", `31/12/${ano}`);

  // Usa o frame que contém o formulário
  const frame = await encontrarFrame(page, "select", true);

  // Limpa Status (primeira opção = em branco / Todos)
  await frame.evaluate(() => {
    const s = document.querySelector("select");
    if (s) { s.value = s.options[0]?.value ?? ""; s.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  log("  Status: em branco");

  await screenshot(page, "06_filtros");

  // Pesquisa
  log("Clicando em pesquisar...");
  await frame.evaluate(() => {
    for (const el of document.querySelectorAll("input[type='image'], img")) {
      const src = (el.src || el.getAttribute("src") || "").toLowerCase();
      if (src.includes("pesquis") || src.includes("bino") || src.includes("lupa") || src.includes("search")) { el.click(); return; }
    }
    const f = document.querySelector("form"); if (f) f.submit();
  });

  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await screenshot(page, "07_resultados_iniciais");

  // Exibir 500 registros
  const frameRes = await encontrarFrame(page, "select");
  const mudouExibir = await frameRes.evaluate(() => {
    for (const s of document.querySelectorAll("select")) {
      const vals = Array.from(s.options).map(o => o.value);
      const alvo = ["500","200","100"].find(v => vals.includes(v));
      if (alvo) {
        s.value = alvo; s.dispatchEvent(new Event("change", { bubbles: true })); return alvo;
      }
    }
    return null;
  });

  if (mudouExibir) {
    log(`  Exibir ${mudouExibir} — re-pesquisando...`);
    await frameRes.evaluate(() => {
      for (const el of document.querySelectorAll("input[type='image'], img")) {
        const src = (el.src || el.getAttribute("src") || "").toLowerCase();
        if (src.includes("pesquis") || src.includes("bino") || src.includes("lupa") || src.includes("search")) { el.click(); return; }
      }
      const f = document.querySelector("form"); if (f) f.submit();
    });
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  await screenshot(page, "08_resultados_final");
  const bodyText = await page.evaluate(() => document.body.innerText);
  const m = bodyText.match(/(\d[\d.]*)\s*(registro|result|encontrad)/i);
  const total = m ? parseInt(m[1].replace(/\./g, "")) : 0;
  log(`Registros encontrados: ${total}`);
  return total;
}

// ── Extração ──────────────────────────────────────────────────────────────────
async function extrairDados(page, ano) {
  log("Procurando botão verde Excel...");

  // Descobre o src do botão Excel inspecionando a página
  const srcExcel = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img, input[type='image']"));
    for (const img of imgs) {
      const src = (img.src || img.getAttribute("src") || "").toLowerCase();
      const alt = (img.alt || img.getAttribute("alt") || "").toLowerCase();
      if (src.includes("xls") || src.includes("excel") || alt.includes("xls") || alt.includes("excel")) return src;
    }
    return null;
  });
  log(`  Botão Excel encontrado: ${srcExcel}`);

  // Usa locator do Playwright para garantir intercepção do download
  let downloadHandle = null;
  if (srcExcel) {
    try {
      [downloadHandle] = await Promise.all([
        page.waitForEvent("download", { timeout: 45000 }),
        page.locator(`img[src*='${srcExcel.split("/").pop()}'], input[src*='${srcExcel.split("/").pop()}']`).first().click(),
      ]);
    } catch (_) {}
  }

  // Fallback: tenta clicar via evaluate e interceptar
  // Tentativa 2: clica em link <a> com href .xls
  if (!downloadHandle) {
    log("  Tentativa 2: link href .xls...");
    try {
      [downloadHandle] = await Promise.all([
        page.waitForEvent("download", { timeout: 45000 }),
        page.locator("a[href*='.xls'], a[href*='excel'], a[href*='Export']").first().click(),
      ]);
    } catch (_) {}
  }

  // Tentativa 3: captura nova aba/popup com o arquivo
  if (!downloadHandle) {
    log("  Tentativa 3: aguarda popup/nova aba com Excel...");
    try {
      const [newPage] = await Promise.all([
        page.context().waitForEvent("page", { timeout: 20000 }),
        page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll("img, input[type='image']"));
          for (const img of imgs) {
            const src = (img.src || "").toLowerCase();
            if (src.includes("xls") || src.includes("excel")) { img.click(); return; }
          }
        }),
      ]);
      // Se abriu nova aba, tenta interceptar download de lá
      [downloadHandle] = await Promise.all([
        newPage.waitForEvent("download", { timeout: 30000 }),
        newPage.waitForLoadState("domcontentloaded"),
      ]).catch(() => [null]);
    } catch (_) {}
  }

  if (downloadHandle) {
    // Salva com extensão original do servidor (pode ser .xls ou .xlsx)
    const nomeOriginal  = downloadHandle.suggestedFilename() || `siloms_${ano}.xls`;
    const ext           = path.extname(nomeOriginal) || ".xls";
    const arquivoSalvo  = path.join(OUTPUT_DIR, `siloms_${ano}${ext}`);
    await downloadHandle.saveAs(arquivoSalvo);
    log(`✅ Arquivo baixado: ${arquivoSalvo} (${nomeOriginal})`);

    // Lê com SheetJS — suporta .xls, .xlsx e HTML-como-Excel
    let wb;
    try {
      wb = XLSX.readFile(arquivoSalvo);
    } catch (_) {
      // Fallback: lê como HTML (alguns sistemas Java exportam HTML com extensão .xls)
      const conteudo = fs.readFileSync(arquivoSalvo, "utf-8");
      wb = XLSX.read(conteudo, { type: "string" });
    }

    const ws   = wb.Sheets[wb.SheetNames[0]];
    // raw:false formata datas automaticamente em vez de retornar número serial
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: "dd/mm/yyyy" });

    // Detecta a linha de cabeçalho real (pode haver título nas primeiras linhas)
    const kw = ["solicit", "status", "fornecedor", "ug", "nd", "sb", "licit", "hist"];
    let headerRowIdx = 0;
    let bestScore = 0;
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const row = (rows[i] || []).map(c => String(c).toLowerCase());
      const score = kw.filter(k => row.some(c => c.includes(k))).length;
      if (score > bestScore) { bestScore = score; headerRowIdx = i; }
    }

    const headers = (rows[headerRowIdx] || []).map(String);
    const dados   = rows.slice(headerRowIdx + 1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ""; });
      return obj;
    });
    log(`  Cabeçalho na linha ${headerRowIdx}: ${headers.slice(0,8).join(" | ")}`);
    return { dados, excelFile: arquivoSalvo, headers };
  }

  // Fallback: scraping página a página
  log("Botão Excel não encontrado. Extraindo via scraping...");

  const selQtd = await page.$("select[name*='exibir'], select[name*='qtd'], select[name*='pagina']").catch(() => null);
  if (selQtd) {
    await selQtd.selectOption("100").catch(() => {});
    await page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  const todasLinhas = [];
  let headers = [];
  let pagina = 1;

  while (true) {
    log(`  Página ${pagina}...`);

    const { colunas, linhas } = await page.evaluate(() => {
      const tabela = Array.from(document.querySelectorAll("table")).find(t => t.querySelector("th"));
      if (!tabela) return { colunas: [], linhas: [] };
      const colunas = Array.from(tabela.querySelectorAll("th")).map(th => (th.textContent || "").trim());
      const linhas  = Array.from(tabela.querySelectorAll("tbody tr"))
        .filter(tr => tr.querySelectorAll("td").length > 3)
        .map(tr => Array.from(tr.querySelectorAll("td")).map(td => (td.textContent || "").trim()));
      return { colunas, linhas };
    });

    if (!headers.length && colunas.length) headers = colunas;
    todasLinhas.push(...linhas);

    const next = await page.$("a[title*='próxima'], img[alt='>'], a img[src*='prox'], img[title='Próxima']").catch(() => null);
    if (!next) break;
    await next.click();
    await page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1500);
    pagina++;
    if (pagina > 60) break;
  }

  const dados = todasLinhas.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ""; });
    return obj;
  });

  const excelFile = path.join(OUTPUT_DIR, `siloms_${ano}.xlsx`);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...todasLinhas]), "Empenhos Recebidos");
  XLSX.writeFile(wb, excelFile);
  log(`Excel gerado localmente: ${excelFile}`);

  return { dados, excelFile, headers };
}

// ── Normalização ──────────────────────────────────────────────────────────────
function normalizar(dados, ano) {
  return dados.map(r => {
    const get = (...keys) => {
      for (const k of keys) {
        const kl = k.toLowerCase().trim();
        const rkeys = Object.keys(r);
        // Prioridade: match exato antes de substring (evita "COD FORNECEDOR" vencer "FORNECEDOR")
        const exact = rkeys.find(rk => rk.toLowerCase().trim() === kl);
        if (exact && r[exact] !== "" && r[exact] !== undefined) return String(r[exact]).trim();
        const found = rkeys.find(rk => rk.toLowerCase().includes(kl));
        if (found && r[found] !== "" && r[found] !== undefined) return String(r[found]).trim();
      }
      return "";
    };
    const valorStr = get("Valor", "valor");
    const valor    = valorStr ? parseFloat(valorStr.replace(/\./g, "").replace(",", ".")) || null : null;
    return {
      solicitacao:       get("SOLICITAÇÃO", "Solicitação", "Solicitacao", "solicit"),
      ug_exec:           get("UGExec", "UG Exec", "ug exec", "ugexec", "ug_exec"),
      ug_cred:           get("UGCred", "UG Cred", "ug cred", "ugcred", "ug_cred"),
      ug_local:          get("UG Local", "ug_local"),
      indicador_lotacao: get("I/Lotação", "I/Lotacao", "I/Lot", "Lotação", "lotacao", "Indicador"),
      nd:                get("ND", "N.D.", "N.D", "Natureza Despesa", "Natureza"),
      sb:                get("SB", "S.B.", "Sb", "Subelem"),
      status:            get("STATUS", "Status", "status"),
      codemp:            get("COD FORNECEDOR", "CODEMP", "Cod Forn", "codemp"),
      fornecedor:        get("FORNECEDOR", "Fornecedor", "fornecedor"),
      pag:               get("PAG", "Proc Aquis", "pag"),
      pregao:            get("PREGAO", "Pregão", "PREGÃO", "pregao"),
      licit_siasg:       get("LICITAÇÃO", "Licitação", "Licit", "SIASG", "Nr SIASG", "licit"),
      usuario:           get("USUARIO", "Usuário", "USUÁRIO", "usuario"),
      oc_gerada:         get("OC GERADA", "OC Gerada", "oc gerada", "oc_gerada"),
      validade_rp:       get("Validade", "validade"),
      dt_solicitacao:    get("DT SOLICITAÇÃO", "DT SOLICITACAO", "Dt Solicit", "DATA", "Data", "dt_solic"),
      valor,
      historico:         get("OBS", "HISTÓRICO", "Histórico", "Historico", "historico"),
      ano,
    };
  }).filter(r => {
    if (!r.solicitacao) return false;
    // Garante apenas solicitações do ano selecionado (ex.: 2026 → começa com "26")
    const prefixo = String(ano).slice(-2);
    return r.solicitacao.toUpperCase().startsWith(prefixo);
  });
}

// ── Upload Supabase — deduplicação inteligente ────────────────────────────────
async function uploadSupabase(registros, onStatus = log) {
  const key = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  const sb  = createClient(SUPABASE_URL, key);

  // Busca solicitações já existentes para comparar status
  const { data: existentes, error: errBusca } = await sb
    .from("siloms_solicitacoes_empenho")
    .select("solicitacao, status");

  if (errBusca) {
    onStatus(`⚠️  Não foi possível buscar existentes: ${errBusca.message}. Fazendo upsert completo...`);
    const { error } = await sb.from("siloms_solicitacoes_empenho").upsert(registros, { onConflict: "solicitacao" });
    if (error) onStatus(`❌ Upsert falhou: ${error.message}`);
    else onStatus(`✅ ${registros.length} registros enviados`);
    return;
  }

  const mapaExistente = new Map((existentes || []).map(r => [r.solicitacao, r.status]));

  const novos       = registros.filter(r => !mapaExistente.has(r.solicitacao));
  const atualizados = registros.filter(r =>
    mapaExistente.has(r.solicitacao) &&
    (mapaExistente.get(r.solicitacao) || "").toLowerCase() !== (r.status || "").toLowerCase()
  );

  onStatus(`Classificados: ${novos.length} novos | ${atualizados.length} com status alterado | ${registros.length - novos.length - atualizados.length} sem mudança`);

  // Insere novos em lotes
  const BATCH = 100;
  let okIns = 0;
  for (let i = 0; i < novos.length; i += BATCH) {
    const lote = novos.slice(i, i + BATCH);
    const { error } = await sb.from("siloms_solicitacoes_empenho").insert(lote);
    if (error) onStatus(`❌ Insert lote ${Math.floor(i/BATCH)+1}: ${error.message}`);
    else okIns += lote.length;
  }

  // Atualiza apenas o status quando mudou
  let okUpd = 0;
  for (const r of atualizados) {
    const { error } = await sb.from("siloms_solicitacoes_empenho")
      .update({ status: r.status, updated_at: new Date().toISOString() })
      .eq("solicitacao", r.solicitacao);
    if (error) onStatus(`❌ Update ${r.solicitacao}: ${error.message}`);
    else okUpd++;
  }

  onStatus(`✅ Supabase: ${okIns} inseridos, ${okUpd} status atualizados`);
}

// ── Executar Bot (exportado para server.js) ───────────────────────────────────
// ── Pré-passo: baixa lista de NEs antes de entrar no SILOMS ──────────────────
async function baixarListaNEs(page, onStatus = log) {
  const SHEET_CSV  = "https://docs.google.com/spreadsheets/d/1XQ5CGcB0dTVADeEGfKjtXRhqtHxsNf1J1H_9VKjBklM/export?format=csv&gid=1297815245";
  const CACHE_FILE = path.join(OUTPUT_DIR, "ne_cache.json");
  const RE_NE      = /2026NE\d{6}/i;

  // Tenta baixar via browser (ainda sem estar na intranet SILOMS)
  try {
    onStatus("Pré-passo: baixando lista de NEs do Tesouro Gerencial...");
    await page.goto(SHEET_CSV, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1000);
    const csvText = await page.evaluate(() => document.body?.innerText || document.body?.textContent || "");
    const neList = [...new Set(
      csvText.split("\n").slice(1).map(linha => {
        const col = linha.split(",")[0].replace(/"/g, "").trim();
        const m   = col.match(RE_NE);
        return m ? m[0].toUpperCase() : null;
      }).filter(Boolean)
    )];
    if (neList.length) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(neList));
      onStatus(`✅ ${neList.length} NEs baixadas e cacheadas em ne_cache.json`);
      return neList;
    }
  } catch (err) {
    onStatus(`⚠️  Google Sheets inacessível: ${err.message.split("\n")[0]}`);
  }

  // Lê do cache local (criado em execução anterior sem VPN)
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      onStatus(`📦 Cache local: ${cached.length} NEs (execute sem VPN para atualizar)`);
      return cached;
    } catch (_) {}
  }

  onStatus("⚠️  Sem cache de NEs. Passo 3 será ignorado. Execute o bot SEM VPN uma vez para criar o cache.");
  return [];
}

async function executarBot({ cpf, senha, ano = "2026", nesFeitas = [], onStatus = log }) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ["--ignore-certificate-errors", "--disable-web-security", "--no-sandbox"],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page    = await context.newPage();
  page.setDefaultTimeout(60000);

  let excelFile1, excelFile2, allRegistros = [], docs = [];

  try {
    // ── Passo 1: Login + Solicitações de Empenho (Recebidas) ─────────────────
    onStatus("━━ PASSO 1: Solicitações de Empenho (Recebidas) ━━");
    await fazerLogin(page, cpf, senha);
    await navegarParaEmpenhos(page);
    await configurarFiltros(page, ano);
    const { dados: dados1, excelFile: ef1 } = await extrairDados(page, ano);
    excelFile1 = ef1;
    onStatus(`Normalizando ${dados1.length} registros (Passo 1)...`);
    const reg1 = normalizar(dados1, parseInt(ano));
    onStatus(`Passo 1: ${reg1.length} registros normalizados`);
    allRegistros = reg1;

    // ── Passo 2: Solicitações de Anulação/Reforço (Recebidas) ────────────────
    onStatus("━━ PASSO 2: Solicitações de Anulação/Reforço (Recebidas) ━━");
    try {
      await navegarParaAnulacaoReforco(page);
      await configurarFiltros(page, ano);
      const { dados: dados2, excelFile: ef2 } = await extrairDados(page, `${ano}_anulacao`);
      excelFile2 = ef2;
      onStatus(`Normalizando ${dados2.length} registros (Passo 2)...`);
      const reg2 = normalizar(dados2, parseInt(ano));
      onStatus(`Passo 2: ${reg2.length} registros normalizados`);
      // Mescla: passo 2 não duplica passo 1 (chave = solicitacao)
      const keys1 = new Set(reg1.map(r => r.solicitacao));
      const novos2 = reg2.filter(r => !keys1.has(r.solicitacao));
      allRegistros = [...reg1, ...novos2];
      onStatus(`Total combinado: ${allRegistros.length} registros únicos`);
    } catch (err2) {
      onStatus(`⚠️  Passo 2 falhou: ${err2.message} — continuando com Passo 3`);
    }

    // ── Passo 3: Documentos na Unidade — busca sequencial a partir da última NE ─
    onStatus("━━ PASSO 3: Documentos na Unidade (Perfil Atual) ━━");
    try {
      const ultimaNeNum = await buscarUltimaNE(ano, onStatus);
      docs = await navegarParaDocumentosNaUnidade(page, onStatus, ultimaNeNum, ano);
    } catch (err3) {
      onStatus(`⚠️  Passo 3 falhou: ${err3.message}`);
      docs = [];
    }

    // ── Salva JSON com todos os registros ────────────────────────────────────
    const jsonFile = path.join(OUTPUT_DIR, `siloms_${ano}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify({
      ano,
      total: allRegistros.length,
      totalDocs: docs.length,
      exportadoEm: new Date().toISOString(),
      registros: allRegistros,
      docs,
    }, null, 2));
    onStatus(`JSON salvo: ${jsonFile}`);

    // ── Upload ao Supabase ────────────────────────────────────────────────────
    onStatus("Enviando solicitações ao Supabase...");
    await uploadSupabase(allRegistros, onStatus);

    if (docs.length > 0) {
      onStatus("Atualizando Perfil Atual no Supabase...");
      await uploadPerfisAtual(docs, onStatus);
    }

    return { jsonFile, excelFile: excelFile1, registros: allRegistros.length, docs: docs.length };
  } finally {
    await browser.close();
  }
}

module.exports = { executarBot };

// ── Execução direta (node bot.js CPF SENHA ANO) ───────────────────────────────
if (require.main === module) {
  const cpf   = process.env.SILOMS_CPF   || process.argv[2] || "";
  const senha = process.env.SILOMS_SENHA  || process.argv[3] || "";
  const ano   = process.env.SILOMS_ANO   || process.argv[4] || "2026";

  if (!cpf || !senha) {
    console.error("\nUso: node bot.js <CPF> <SENHA> [ANO]");
    console.error("  ex: node bot.js 50216055857 minhasenha 2026\n");
    process.exit(1);
  }

  executarBot({ cpf, senha, ano }).then(r => {
    console.log(`\n✅ Concluído! ${r.registros} registros enviados.`);
    console.log(`   Excel: ${r.excelFile}`);
  }).catch(err => {
    console.error(`\n❌ Erro: ${err.message}`);
    process.exit(1);
  });
}
