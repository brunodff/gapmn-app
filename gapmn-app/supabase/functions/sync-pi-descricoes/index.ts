// @ts-nocheck
/**
 * Edge Function: sync-pi-descricoes
 *
 * Busca a planilha pública de créditos recebidos, extrai todos os pares
 * PI código → nome e salva/atualiza na tabela `pi_descricoes` do Supabase.
 *
 * Fonte: https://docs.google.com/spreadsheets/d/1ZA22vgi7L511h6BX8ngfOknNceDPy5xmZszgvcxC1jA
 *        aba gid=263182411 ("Crédito Recebido")
 *
 * Deploy:
 *   supabase functions deploy sync-pi-descricoes --no-verify-jwt
 *
 * Agendamento (Supabase → Cron Jobs):
 *   - Expressão cron: 0 6 * * 1-5   (todo dia útil às 6h)
 *   - Método: POST para https://<project>.supabase.co/functions/v1/sync-pi-descricoes
 *
 * Também pode ser chamado manualmente via POST sem body para forçar sincronização.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1ZA22vgi7L511h6BX8ngfOknNceDPy5xmZszgvcxC1jA/export?format=csv&gid=263182411";

// ── CSV parser simples ──────────────────────────────────────────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let inQuote = false;
    let cur = "";
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        row.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    row.push(cur.trim());
    rows.push(row);
  }
  return rows;
}

// ── Localiza índice de coluna por substring no header ──────────────────────
function findCol(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const up = c.toUpperCase();
    const i = headers.findIndex((h) => h.toUpperCase().trim() === up);
    if (i >= 0) return i;
  }
  // Busca por inclusão
  for (const c of candidates) {
    const up = c.toUpperCase();
    const i = headers.findIndex((h) => h.toUpperCase().includes(up));
    if (i >= 0) return i;
  }
  return -1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── Busca o CSV ──────────────────────────────────────────────────────────
    const res = await fetch(SHEET_URL, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`Planilha retornou HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);

    if (rows.length < 4) throw new Error("Planilha vazia ou formato inesperado");

    // ── Localiza a linha de cabeçalho ────────────────────────────────────────
    // A planilha tem: linha 1 = título, linha 2 = vazia, linha 3 = headers
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      const joined = rows[i].join("|").toUpperCase();
      // Cabeçalho deve conter "PI" e "PTRES" ou "NATUREZA"
      if (joined.includes("PTRES") && joined.includes("NATUREZA")) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) {
      // Fallback: assume linha 2 (índice 2) como header
      headerIdx = 2;
    }

    const headers = rows[headerIdx];
    console.log(`[sync-pi] Header encontrado na linha ${headerIdx}:`, headers.join(" | "));

    // ── Localiza colunas PI e nome PI ────────────────────────────────────────
    let iPi = findCol(headers, "PI", "PLANO INTERNO");
    // Nome do PI está na coluna SEGUINTE ao código PI (padrão da planilha SIAFI)
    // mas verificamos também por nome explícito
    let iPiNome = findCol(headers, "NOME PI", "(NOME PI)", "DESCRICAO PI");
    if (iPiNome < 0 && iPi >= 0) {
      // Fallback: coluna imediatamente após o código PI
      iPiNome = iPi + 1;
    }

    if (iPi < 0) throw new Error("Coluna PI não encontrada no cabeçalho");

    console.log(`[sync-pi] Colunas: PI=${iPi}, nomePI=${iPiNome}`);

    // ── Extrai pares únicos código → descrição ───────────────────────────────
    const piMap = new Map<string, string>();

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const codigo = (row[iPi] ?? "").trim();
      const descricao = iPiNome >= 0 ? (row[iPiNome] ?? "").trim() : "";

      if (codigo && descricao && codigo !== "PI") {
        // Limpa eventuais marcas de formatação
        const codLimpo = codigo.replace(/^["']|["']$/g, "");
        const descLimpa = descricao.replace(/^["']|["']$/g, "");
        if (codLimpo) {
          piMap.set(codLimpo, descLimpa || piMap.get(codLimpo) || "");
        }
      }
    }

    if (piMap.size === 0) {
      throw new Error(`Nenhum PI extraído. Verifique as colunas: iPi=${iPi}, iPiNome=${iPiNome}`);
    }

    console.log(`[sync-pi] ${piMap.size} PIs únicos extraídos`);

    // ── Upsert no Supabase ───────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const records = [...piMap.entries()]
      .filter(([, desc]) => desc) // apenas PI com descrição
      .map(([codigo, descricao]) => ({
        codigo,
        descricao,
        updated_at: new Date().toISOString(),
      }));

    const { error } = await supabase
      .from("pi_descricoes")
      .upsert(records, { onConflict: "codigo" });

    if (error) throw error;

    console.log(`[sync-pi] Upsert OK: ${records.length} registros`);

    return json({ ok: true, count: records.length, pis: [...piMap.keys()].slice(0, 10) });
  } catch (err: any) {
    console.error("[sync-pi] Erro:", err.message);
    return json({ ok: false, error: err.message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
