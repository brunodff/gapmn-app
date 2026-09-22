/**
 * Exporta a tabela siloms_solicitacoes_empenho do Supabase GAP-MN para Google Sheets.
 *
 * COMO USAR:
 *   1. Abra a planilha destino → Extensions > Apps Script
 *   2. Cole este código → Salvar
 *   3. Ajuste SPREADSHEET_ID e SHEET_NAME se necessário
 *   4. Execute "criarGatilhosDiarios()" uma vez para agendar execução automática
 *   5. Autorize as permissões quando solicitado
 *
 * ATENÇÃO: use a SERVICE ROLE KEY do Supabase (não a anon key) para bypassar RLS.
 * Acesse: Supabase → Project Settings → API → service_role (secret)
 */

// ══════════════════════════════════════════════════
//  CONFIGURAÇÃO
// ══════════════════════════════════════════════════
const CFG = {
  SUPABASE_URL:      "https://fychrtyyqbzlfbzbvzqp.supabase.co",
  SERVICE_ROLE_KEY:  "COLE_AQUI_SUA_SERVICE_ROLE_KEY",   // ← altere!
  SPREADSHEET_ID:    "COLE_AQUI_O_ID_DA_PLANILHA",       // ← altere!
  SHEET_NAME:        "Solicitacoes",
  TABLE:             "siloms_solicitacoes_empenho",
  // Colunas desejadas (use * para todas)
  SELECT:            "solicitacao,empenho_siafi,subprocesso,status,oc_gerada,perfil_atual,responsavel,fornecedor,valor,dt_solicitacao,ug_cred,nd,pag,historico,ano,importado_em",
  ORDER:             "solicitacao.asc",
  PAGE_SIZE:         1000,
};
// ══════════════════════════════════════════════════

function exportarSolicitacoes() {
  const url    = CFG.SUPABASE_URL.replace(/\/+$/, "");
  const ss     = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const sheet  = ss.getSheetByName(CFG.SHEET_NAME) || ss.insertSheet(CFG.SHEET_NAME);

  let offset = 0;
  let allRows = [];
  let cols    = null;

  // Paginação — busca até esgotar os registros
  while (true) {
    const endpoint =
      `${url}/rest/v1/${CFG.TABLE}` +
      `?select=${encodeURIComponent(CFG.SELECT)}` +
      `&order=${encodeURIComponent(CFG.ORDER)}` +
      `&limit=${CFG.PAGE_SIZE}` +
      `&offset=${offset}`;

    const resp = UrlFetchApp.fetch(endpoint, {
      method: "get",
      headers: {
        apikey:        CFG.SERVICE_ROLE_KEY,
        Authorization: `Bearer ${CFG.SERVICE_ROLE_KEY}`,
        Accept:        "application/json",
      },
      muteHttpExceptions: true,
    });

    const code = resp.getResponseCode();
    const body = resp.getContentText();

    if (code < 200 || code >= 300)
      throw new Error(`Erro Supabase (${code}): ${body}`);

    const page = JSON.parse(body);
    if (!Array.isArray(page) || page.length === 0) break;

    if (!cols) cols = Object.keys(page[0]);
    allRows = allRows.concat(page);
    if (page.length < CFG.PAGE_SIZE) break;
    offset += CFG.PAGE_SIZE;
  }

  if (!cols) cols = [];

  // Monta cabeçalho legível em pt-BR
  const LABELS = {
    solicitacao:    "Solicitação",
    empenho_siafi:  "NE SIAFI",
    subprocesso:    "Subprocesso",
    status:         "Status",
    oc_gerada:      "OC Gerada",
    perfil_atual:   "Perfil Atual",
    responsavel:    "Responsável",
    fornecedor:     "Fornecedor",
    valor:          "Valor (R$)",
    dt_solicitacao: "Dt. Solicitação",
    ug_cred:        "UGCred",
    nd:             "ND",
    pag:            "PAG",
    historico:      "Histórico",
    ano:            "Ano",
    importado_em:   "Importado Em",
  };

  const header = cols.map(c => LABELS[c] || c);

  const data = [header];
  for (const r of allRows) {
    data.push(cols.map(c => {
      const v = r[c];
      if (v === null || v === undefined) return "";
      if (typeof v === "object") return JSON.stringify(v);
      // Formata valor monetário
      if (c === "valor" && typeof v === "number")
        return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return String(v);
    }));
  }

  // Escreve na planilha
  sheet.clearContents();
  if (data.length > 0 && data[0].length > 0) {
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  }

  // Formatação básica
  if (cols.length) {
    const headerRange = sheet.getRange(1, 1, 1, cols.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#1e3a5f");
    headerRange.setFontColor("#ffffff");
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, cols.length);
  }

  // Timestamp no canto
  sheet.getRange(1, cols.length + 2).setValue(`Atualizado: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Manaus" })}`);

  SpreadsheetApp.flush();
  Logger.log(`✅ ${allRows.length} registros exportados para "${CFG.SHEET_NAME}".`);
}

/**
 * Cria gatilhos automáticos diários.
 * Execute UMA VEZ manualmente após configurar o script.
 */
function criarGatilhosDiarios() {
  // Remove gatilhos antigos dessa função
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "exportarSolicitacoes") ScriptApp.deleteTrigger(t);
  });

  // Executa todos os dias às 7h, 12h e 18h (horário Manaus = UTC-4)
  [7, 12, 18].forEach(h => {
    ScriptApp.newTrigger("exportarSolicitacoes")
      .timeBased()
      .everyDays(1)
      .atHour(h)
      .create();
  });

  Logger.log("✅ Gatilhos criados: 7h, 12h e 18h (horário local do servidor Apps Script).");
}
