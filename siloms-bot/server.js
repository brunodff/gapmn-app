/**
 * SILOMS Local Server — Fase única (split-tunnel VPN, Linux)
 * Porta 3333 — mantém abertura para o app web se comunicar.
 * Iniciar: node server.js
 */

const http   = require("http");
const fs     = require("fs");
const path   = require("path");
const { executarBot } = require("./bot");

const PORT       = 3333;
const OUTPUT_DIR = path.join(__dirname, "output");

// ── Estado global ─────────────────────────────────────────────────────────
let botRunning = false;
let botLog     = [];
let botResult  = null;   // { jsonFile, excelFile, registros }
let botError   = null;

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

function log(msg) {
  console.log("[BOT]", msg);
  botLog.push({ ts: new Date().toISOString(), msg });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── GET /status ───────────────────────────────────────────────────────────
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

  // ── GET /download ─────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/download") {
    const arquivo = botResult?.excelFile
      ?? (fs.existsSync(OUTPUT_DIR) ? fs.readdirSync(OUTPUT_DIR).map(f => path.join(OUTPUT_DIR, f)).find(f => f.endsWith(".xlsx")) : null);
    if (!arquivo || !fs.existsSync(arquivo)) return json(res, { error: "Arquivo não encontrado" }, 404);
    cors(res);
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${path.basename(arquivo)}"`,
    });
    fs.createReadStream(arquivo).pipe(res);
    return;
  }

  // ── GET /dados — retorna registros + docs do JSON salvo (browser faz upload ao Supabase) ──
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

  // ── POST /rodar — extrai do SILOMS e envia ao Supabase (fase única) ───────
  if (req.method === "POST" && url.pathname === "/rodar") {
    if (botRunning) return json(res, { error: "Robô já está em execução." }, 409);

    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      let params;
      try { params = JSON.parse(body); } catch { return json(res, { error: "JSON inválido" }, 400); }

      const { cpf, senha, ano = "2026", nesFeitas = [] } = params;
      if (!cpf || !senha) return json(res, { error: "CPF e senha são obrigatórios." }, 400);

      botRunning = true;
      botLog     = [];
      botResult  = null;
      botError   = null;
      json(res, { ok: true, message: "Robô iniciado." });

      try {
        botResult = await executarBot({ cpf, senha, ano, nesFeitas, onStatus: log });
        log(`✅ Concluído! ${botResult.registros} registros prontos — o site fará o upload ao Supabase.`);
      } catch (err) {
        botError = err.message;
        log(`❌ Erro: ${err.message}`);
      } finally {
        botRunning = false;
      }
    });
    return;
  }

  json(res, { error: "Rota não encontrada" }, 404);
});

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n🤖 SILOMS Bot Server · http://localhost:${PORT}`);
  console.log("   Mantenha este terminal aberto enquanto usa o app.\n");
});
