/**
 * Local Server — porta 3333
 * Bots disponíveis:
 *   SILOMS  — busca subprocesso de NEs (requer VPN)
 *   SICAF   — baixa Situação do Fornecedor (internet pública)
 *
 * Iniciar: node server.js
 */

const http   = require("http");
const fs     = require("fs");
const path   = require("path");
const { executarBot }      = require("./bot");
const { executarBotSicaf } = require("./sicaf-bot");

const PORT       = 3333;
const OUTPUT_DIR = path.join(__dirname, "output");

// ── Estado SILOMS ─────────────────────────────────────────────────────────────
let botRunning = false;
let botLog     = [];
let botResult  = null;
let botError   = null;

// ── Estado SICAF ──────────────────────────────────────────────────────────────
let sicafRunning = false;
let sicafLog     = [];
let sicafResult  = null;
let sicafError   = null;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Access-Control-Request-Private-Network");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function logSiloms(msg) {
  console.log("[SILOMS]", msg);
  botLog.push({ ts: new Date().toISOString(), msg });
}

function logSicaf(msg) {
  console.log("[SICAF]", msg);
  sicafLog.push({ ts: new Date().toISOString(), msg });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ════════════════════════════════════════════════════════════════════════════
  //  SILOMS
  // ════════════════════════════════════════════════════════════════════════════

  // GET /status
  if (req.method === "GET" && url.pathname === "/status") {
    const jsonAnterior = fs.existsSync(OUTPUT_DIR)
      ? (fs.readdirSync(OUTPUT_DIR).find(f => f.startsWith("siloms_") && f.endsWith(".json")) ?? null)
      : null;
    return json(res, {
      running: botRunning,
      log: botLog,
      result: botResult,
      error: botError,
      jsonAnterior: jsonAnterior ? path.join(OUTPUT_DIR, jsonAnterior) : null,
    });
  }

  // GET /dados
  if (req.method === "GET" && url.pathname === "/dados") {
    const jsonFile = fs.existsSync(OUTPUT_DIR)
      ? fs.readdirSync(OUTPUT_DIR).map(f => path.join(OUTPUT_DIR, f)).find(f => /siloms_.*\.json$/.test(path.basename(f)))
      : null;
    if (!jsonFile || !fs.existsSync(jsonFile)) return json(res, { registros: [], docs: [] });
    try {
      const conteudo = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
      return json(res, { registros: conteudo.registros || [], docs: conteudo.docs || [] });
    } catch { return json(res, { registros: [], docs: [] }); }
  }

  // POST /rodar
  if (req.method === "POST" && url.pathname === "/rodar") {
    if (botRunning) return json(res, { error: "Robô SILOMS já está em execução." }, 409);

    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      let params;
      try { params = JSON.parse(body); } catch { return json(res, { error: "JSON inválido" }, 400); }

      const { cpf, senha, ano = "2026" } = params;
      if (!cpf || !senha) return json(res, { error: "CPF e senha são obrigatórios." }, 400);

      botRunning = true; botLog = []; botResult = null; botError = null;
      json(res, { ok: true, message: "Robô SILOMS iniciado." });

      try {
        botResult = await executarBot({ cpf, senha, ano, onStatus: logSiloms });
        logSiloms(`✅ Concluído! ${botResult.registros} NEs processadas.`);
      } catch (err) {
        botError = err.message;
        logSiloms(`❌ Erro: ${err.message}`);
      } finally {
        botRunning = false;
      }
    });
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  SICAF
  // ════════════════════════════════════════════════════════════════════════════

  // GET /status-sicaf
  if (req.method === "GET" && url.pathname === "/status-sicaf") {
    return json(res, {
      running: sicafRunning,
      log: sicafLog,
      result: sicafResult,
      error: sicafError,
    });
  }

  // GET /download-sicaf — serve o PDF gerado
  if (req.method === "GET" && url.pathname === "/download-sicaf") {
    const arquivo = sicafResult?.pdfFile;
    if (!arquivo || !fs.existsSync(arquivo))
      return json(res, { error: "PDF não encontrado. Execute o bot primeiro." }, 404);
    cors(res);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${path.basename(arquivo)}"`,
    });
    fs.createReadStream(arquivo).pipe(res);
    return;
  }

  // POST /rodar-sicaf
  if (req.method === "POST" && url.pathname === "/rodar-sicaf") {
    if (sicafRunning) return json(res, { error: "Bot SICAF já está em execução." }, 409);

    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      let params;
      try { params = JSON.parse(body); } catch { return json(res, { error: "JSON inválido" }, 400); }

      const { cpf, senha, cnpj } = params;
      if (!cpf || !senha || !cnpj) return json(res, { error: "CPF, senha e CNPJ são obrigatórios." }, 400);

      sicafRunning = true; sicafLog = []; sicafResult = null; sicafError = null;
      json(res, { ok: true, message: "Bot SICAF iniciado." });

      try {
        sicafResult = await executarBotSicaf({ cpf, senha, cnpj, onStatus: logSicaf });
        logSicaf(`✅ PDF gerado: ${path.basename(sicafResult.pdfFile)}`);
      } catch (err) {
        sicafError = err.message;
        logSicaf(`❌ Erro: ${err.message}`);
      } finally {
        sicafRunning = false;
      }
    });
    return;
  }

  json(res, { error: "Rota não encontrada" }, 404);
});

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n🤖 Bot Server · http://localhost:${PORT}`);
  console.log("   SILOMS: /rodar  /status  /dados");
  console.log("   SICAF:  /rodar-sicaf  /status-sicaf  /download-sicaf\n");
});
