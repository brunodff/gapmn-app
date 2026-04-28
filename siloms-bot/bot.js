/**
 * SILOMS Bot — Busca Nr. Documento (subprocesso) para cada NE SIAFI
 *
 * Fluxo:
 *   1. Login SSO no SILOMS
 *   2. Lê Supabase: quais NEs de siloms_ne_identificadores têm subprocesso = NULL
 *   3. Para cada NE: pesquisa em Documentos na Unidade (Ativo → Arquivado)
 *   4. Salva JSON local → frontend faz upload ao Supabase
 *
 * Uso: node bot.js <CPF> <SENHA> [ANO]
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
try {
  const { Agent, setGlobalDispatcher } = require("undici");
  setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));
} catch (_) {}

const { chromium }    = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs   = require("fs");

const SILOMS_MAC_URL    = "http://mac.siloms.intraer/siloms_mac";
const OUTPUT_DIR        = path.join(__dirname, "output");
const SUPABASE_URL      = "https://fychrtyyqbzlfbzbvzqp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw";

function log(msg) { console.log(`[${new Date().toLocaleTimeString("pt-BR")}] ${msg}`); }

async function screenshot(page, nome) {
  try {
    await page.screenshot({ path: path.join(OUTPUT_DIR, `debug_${nome}.png`), fullPage: false });
  } catch (_) {}
}

// ── Login SSO ─────────────────────────────────────────────────────────────────
async function fazerLogin(page, cpf, senha) {
  log("Acessando módulo MAC...");
  await page.goto(SILOMS_MAC_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  if (!page.url().includes("authenticationendpoint")) {
    log("Aguardando redirect para SSO...");
    await page.waitForURL("**/authenticationendpoint/**", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  await screenshot(page, "01_sso");

  if (!page.url().includes("authenticationendpoint"))
    throw new Error(`SSO não foi acionado. URL atual: ${page.url()}`);

  const cpfLimpo   = cpf.replace(/\D/g, "");
  const campoUser  = await page.$("input[name='username'], input[id='username']");
  const campoSenha = await page.$("input[name='password'], input[id='password']");
  if (!campoUser)  throw new Error("Campo usuário não encontrado no SSO");
  if (!campoSenha) throw new Error("Campo senha não encontrado no SSO");

  await campoUser.fill(cpfLimpo);
  await campoSenha.fill(senha);
  await screenshot(page, "02_preenchido");

  const btn = await page.$("button[type='submit'], input[type='submit']");
  if (btn) await btn.click(); else await page.keyboard.press("Enter");

  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await screenshot(page, "03_pos_login");

  const url  = page.url();
  const body = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
  if (url.includes("authenticationendpoint") || body.toLowerCase().includes("inválid"))
    throw new Error("Login SSO falhou. Credenciais incorretas?");

  log("✅ Login realizado com sucesso.");
}

// ── Helper: encontra frame com o seletor ─────────────────────────────────────
async function encontrarFrame(page, selector) {
  for (const frame of page.frames()) {
    const el = await frame.$(selector).catch(() => null);
    if (el) return frame;
  }
  return page;
}

// ── Helper: preenche campo "Nome" no formulário ───────────────────────────────
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
      if (src.includes("pesquis") || src.includes("bino") || src.includes("lupa") || src.includes("search")) {
        el.click(); return;
      }
    }
    const btn = document.querySelector("input[type='submit'], button[type='submit']");
    if (btn) { btn.click(); return; }
    document.querySelector("form")?.submit();
  });
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

// ── Extrai Nr. Documento da primeira linha de resultado ───────────────────────
async function rasparNrDocumento(page) {
  const extrator = () => {
    const tabelas = Array.from(document.querySelectorAll("table"))
      .filter(t => t.querySelector("th") && t.querySelectorAll("th").length >= 2);
    for (const tabela of tabelas) {
      const ths = Array.from(tabela.querySelectorAll("th"))
        .map(th => (th.textContent || "").trim().toLowerCase());
      const iNr = ths.findIndex(h =>
        h.startsWith("nr") || h.includes("número") || h.includes("nº") || h.includes("doc")
      );
      if (iNr < 0) continue;
      const dataRows = Array.from(tabela.querySelectorAll("tbody tr"))
        .filter(tr => tr.querySelectorAll("td").length > 1);
      if (!dataRows.length) continue;
      const cells = Array.from(dataRows[0].querySelectorAll("td"))
        .map(td => (td.textContent || "").trim());
      const nr = cells[iNr];
      if (nr && /\d/.test(nr)) return nr;
    }
    return null;
  };

  // DOM em cada frame
  for (const frame of page.frames()) {
    try { const r = await frame.evaluate(extrator); if (r) return r; } catch (_) {}
  }

  // Fallback: parse HTML bruto
  for (const frame of page.frames()) {
    try {
      const html = await frame.content();
      const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
          .map(c => c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()));
      const hi = rows.findIndex(r => r.some(c =>
        c.toLowerCase().startsWith("nr") || c.toLowerCase().includes("doc")
      ));
      if (hi < 0) continue;
      const hdrs = rows[hi].map(c => c.toLowerCase());
      const iNr  = hdrs.findIndex(h => h.startsWith("nr") || h.includes("doc"));
      if (iNr < 0) continue;
      for (const row of rows.slice(hi + 1)) {
        if (row.length <= iNr) continue;
        const nr = row[iNr];
        if (nr && /\d/.test(nr)) return nr;
      }
    } catch (_) {}
  }

  return null;
}

// ── Busca NEs que ainda não têm subprocesso no Supabase ──────────────────────
async function buscarNEsSemSubprocesso(ano, onStatus = log) {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await sb
      .from("siloms_ne_identificadores")
      .select("ne_siafi")
      .is("subprocesso", null)
      .like("ne_siafi", `${ano}NE%`);
    if (error) throw new Error(error.message);
    if (!data || !data.length) {
      onStatus("✅ Todas as NEs já têm subprocesso registrado. Nada a fazer.");
      return [];
    }
    const list = data.map(r => r.ne_siafi).sort();
    onStatus(`📋 ${list.length} NEs sem subprocesso para pesquisar`);
    return list;
  } catch (err) {
    onStatus(`⚠️ Erro ao buscar NEs no Supabase: ${err.message}`);
    return [];
  }
}

// ── Passo principal: pesquisa Nr. Documento para cada NE ─────────────────────
async function buscarSubprocessoPorNEList(page, neList, onStatus = log) {
  if (!neList.length) return [];

  onStatus("Navegando para Documentos > Documentos na Unidade...");
  await page.goto(SILOMS_MAC_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.click("text=Documentos");
  await page.waitForTimeout(1200);
  await page.locator("text=Documentos na Unidade").first().click();
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await screenshot(page, "04_docs_unidade");

  const formUrl = page.url();
  const results = [];
  let encontrados = 0;

  for (let i = 0; i < neList.length; i++) {
    const ne = neList[i];
    onStatus(`[${i + 1}/${neList.length}] Buscando ${ne}...`);

    let subprocesso = null;

    for (const status of ["Ativo", "Arquivado"]) {
      await page.goto(formUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);

      const frame = await preencherCampoNome(page, ne);

      // Desmarca "somente meu perfil" se houver
      await frame.evaluate(() => {
        for (const cb of document.querySelectorAll("input[type='checkbox']")) {
          const lbl = (cb.labels?.[0]?.textContent || cb.closest("label")?.textContent || "").toLowerCase();
          if ((lbl.includes("meu perfil") || lbl.includes("somente")) && cb.checked) cb.click();
        }
      });

      // Seleciona status (Ativo / Arquivado)
      await frame.evaluate((st) => {
        for (const sel of document.querySelectorAll("select")) {
          const opts = Array.from(sel.options);
          const opt  = opts.find(o => o.text.toLowerCase().includes(st.toLowerCase()));
          if (opt) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return;
          }
        }
      }, status);

      await submeterPesquisa(frame, page);
      const nr = await rasparNrDocumento(page);
      if (nr) { subprocesso = nr; break; }
    }

    if (subprocesso) {
      results.push({ ne_siafi: ne, subprocesso });
      onStatus(`  ✅ ${ne} → ${subprocesso}`);
      encontrados++;
    } else {
      // "" = pesquisado mas não encontrado (não tenta novamente na próxima execução)
      results.push({ ne_siafi: ne, subprocesso: "" });
      onStatus(`  ⚪ ${ne} → não encontrado`);
    }

    if ((i + 1) % 10 === 0) await screenshot(page, `progresso_${i + 1}`);
  }

  onStatus(`✅ Concluído: ${encontrados}/${neList.length} subprocessos encontrados`);
  return results;
}

// ── executarBot (exportado para server.js) ───────────────────────────────────
async function executarBot({ cpf, senha, ano = "2026", onStatus = log }) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ["--ignore-certificate-errors", "--disable-web-security", "--no-sandbox"],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page    = await context.newPage();
  page.setDefaultTimeout(60000);

  try {
    onStatus("━━ PASSO 1: Login SILOMS ━━");
    await fazerLogin(page, cpf, senha);

    onStatus("━━ PASSO 2: Verificando NEs sem subprocesso ━━");
    const neList = await buscarNEsSemSubprocesso(ano, onStatus);

    if (!neList.length) {
      const jsonFile = path.join(OUTPUT_DIR, `siloms_${ano}.json`);
      fs.writeFileSync(jsonFile, JSON.stringify({ ano, exportadoEm: new Date().toISOString(), registros: [], docs: [] }, null, 2));
      return { jsonFile, registros: 0, docs: 0 };
    }

    onStatus("━━ PASSO 3: Documentos na Unidade ━━");
    const docs = await buscarSubprocessoPorNEList(page, neList, onStatus);

    const jsonFile = path.join(OUTPUT_DIR, `siloms_${ano}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify({
      ano,
      exportadoEm: new Date().toISOString(),
      registros: [],
      docs,
    }, null, 2));
    onStatus(`JSON salvo: ${jsonFile}`);

    return { jsonFile, registros: docs.length, docs: docs.length };
  } finally {
    await browser.close();
  }
}

module.exports = { executarBot };

// ── Execução direta ───────────────────────────────────────────────────────────
if (require.main === module) {
  const cpf   = process.env.SILOMS_CPF   || process.argv[2] || "";
  const senha = process.env.SILOMS_SENHA || process.argv[3] || "";
  const ano   = process.env.SILOMS_ANO   || process.argv[4] || "2026";
  if (!cpf || !senha) {
    console.error("\nUso: node bot.js <CPF> <SENHA> [ANO]");
    process.exit(1);
  }
  executarBot({ cpf, senha, ano }).then(r => {
    console.log(`\n✅ Concluído! ${r.docs} subprocessos buscados.`);
  }).catch(err => {
    console.error(`\n❌ Erro: ${err.message}`);
    process.exit(1);
  });
}
