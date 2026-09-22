/**
 * Apps Script — Backup Supabase → Google Sheets
 * Cole este código em: Extensions > Apps Script na sua planilha de controle
 * Depois vá em "Triggers" e configure para rodar diariamente.
 */

const SUPABASE_URL  = "https://fychrtyyqbzlfbzbvzqp.supabase.co";
const SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw";

function backupSolicitacoes() {
  const dados = fetchTabela("siloms_solicitacoes_empenho",
    "solicitacao,status,oc_gerada,responsavel,subprocesso,empenho_siafi,fornecedor,valor,dt_solicitacao,ug_cred,nd,pag,historico,importado_em"
  );
  if (!dados) return;
  escreverAba("Solicitacoes", dados);
  Logger.log("✅ Backup Solicitações: " + dados.length + " registros");
}

function backupCompleto() {
  backupSolicitacoes();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fetchTabela(tabela, colunas) {
  let todos = [];
  let offset = 0;
  const LIMIT = 1000;

  while (true) {
    const url = SUPABASE_URL + "/rest/v1/" + tabela
      + "?select=" + colunas
      + "&order=solicitacao.asc"
      + "&limit=" + LIMIT
      + "&offset=" + offset;

    const resp = UrlFetchApp.fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("Erro " + resp.getResponseCode() + ": " + resp.getContentText());
      return null;
    }

    const lote = JSON.parse(resp.getContentText());
    todos = todos.concat(lote);
    if (lote.length < LIMIT) break;
    offset += LIMIT;
  }

  return todos;
}

function escreverAba(nomeAba, dados) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet   = ss.getSheetByName(nomeAba);
  if (!sheet) sheet = ss.insertSheet(nomeAba);
  sheet.clearContents();

  if (!dados || dados.length === 0) {
    sheet.getRange(1, 1).setValue("Sem dados");
    return;
  }

  const headers = Object.keys(dados[0]);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);

  const linhas = dados.map(r => headers.map(h => {
    const v = r[h];
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  }));

  sheet.getRange(2, 1, linhas.length, headers.length).setValues(linhas);

  // Ajusta largura das colunas
  sheet.autoResizeColumns(1, headers.length);

  // Timestamp do backup
  const ts = new Date().toLocaleString("pt-BR", { timeZone: "America/Manaus" });
  sheet.getRange(1, headers.length + 2).setValue("Atualizado: " + ts);
}
