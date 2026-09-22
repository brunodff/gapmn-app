# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start dev server (Vite HMR)
npm run build     # tsc -b && vite build
npm run lint      # eslint
npm run preview   # preview production build
```

There are no automated tests. TypeScript compilation (`tsc -b`) is the primary correctness check and runs as part of `build`.

## Environment

Requires a `.env` file (or Netlify env) with:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Missing vars produce a white screen — the client logs a warning but does not throw.

## Architecture

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS + Supabase (client-only, RLS-enforced) + SheetJS (xlsx) + Recharts.

### Route structure (`src/App.tsx`)

| Path | Component | Guard |
|------|-----------|-------|
| `/app` | `AppChat` — home dashboard with nav cards + news feed | `RequireAuth` |
| `/setor` | `SetorInbox` — tabbed management workspace | `RequireAuth` |
| `/orcamento` | `ControleOrcamentario` — budget panels | `RequireAuth` |
| `/acompanhamentos` | `MeusAcompanhamentos` — personal watchlist | `RequireAuth` |
| `/cnet` | `CnetBot` — standalone bot page (no auth) | — |

`RequireAuth` (`src/routes/`) checks `supabase.auth.getSession()` and redirects to `/login` if no session. There is no role-gating at the route level — roles gate features within components.

### Role system

Roles live in `profiles.setor` (Supabase): `SEO | SCON | SLIC | ADMIN | DEV`.

- **ADMIN / DEV** — full access to all tabs and import operations
- **SEO** — can import `indicadores_lotacao` and `empenhos_seo`
- **SCON** — can import `contratos_scon`
- **SLIC** — can import `processos_licitatorios`

All authenticated users see all tabs in `SetorInbox`; write/import permissions are prop-drilled as `canImport*`, `canEdit`, `canSync*`.

### SetorInbox tabs (`/setor`)

- **Contratos** → `GerenciamentoContratos` — Excel import + CRUD for `contratos_scon`
- **Processos** → `GerenciamentoProcessos` — procurement lifecycle for `processos_licitatorios` + `processo_controle`
- **Indicadores de Lotação** → `IndicadoresLotacao` — SEO sub-tabs: indicadores, empenhos, gerenciamento
- **Empenhos** → `GerenciamentoEmpenhos` — NE SIAFI + SE tracking, syncs via SILOMS bot
- **Prestação de Contas** → `PainelDashboard` — visible to SCON, SLIC, ADMIN

### Excel import pattern (GerenciamentoContratos)

- `normH(s)` — strips accents + non-alphanumeric, lowercases
- `colIdx(headers, ...candidates)` — finds first header containing a candidate substring
- Header detection: scans first 8 rows, picks the row that matches the most keywords (threshold ≥3); falls back to row 1
- **Critical guard:** "TIPO OBJETO" column must not be matched as the `descricao` column — `colIdx` candidates for descricao exclude any header that contains "tipo"
- Logs detected headers as `[GAP-MN Import]` on the console — useful for debugging import mapping failures
- `fonte = 'EXCEL'` for imported rows; `fonte = 'MANUAL'` for hand-entered rows. "Limpar Importados" deletes all `fonte='EXCEL'` rows

The same general pattern (scan for header row, flexible column detection, positional fallback) is used in `src/lib/gsheets.ts` for Google Sheets CSV parsing.

### Budget panels (`/orcamento`)

`ControleOrcamentario` hosts three sub-panels:
- **Painel Orçamentário** — Power BI iframe (public embed URL)
- **Painel de Empenhos** → `PaineisGerenciais` — reads 2 CSV Google Sheets (credito1 + credito2) via `src/lib/gsheets.ts`, aggregates by OM sigla, renders with Recharts
- **Painel de RP** → `PainelRP` — reads RP CSV sheets, same pipeline

`gsheets.ts` exports typed transformers: `toCreditoLinhas`, `toControleEmpenhos`, `toEmpenhosNF`, `toLinhasRP`, `toRPNEs`. All parsers detect header rows dynamically and fall back to hardcoded column positions. ND codes starting with 31, 36, 46, 47 are filtered out (personnel / transfers). `normalizeNE()` normalizes NE numbers for cross-sheet joins by stripping leading zeros.

The `UG_MAP` in `gsheets.ts` maps UG codes (e.g., `"120630"`) and full OM names to short siglas (e.g., `"GAP-MN"`). Add new OMs here when the command structure changes.

### Chatbot (`/app` → inline, or via `AppChat`)

`src/lib/botEngine.ts` exports `getBotResponse(question, { nome })`. Flow:
1. `norm(q)` — normalize input
2. `detectIntent(q)` — keyword/regex matching → one of 20 intents
3. Intent handler queries Supabase and returns formatted string

Intent handlers are pure async functions that query Supabase directly. There is no LLM involved — all responses are deterministic. Falls back to `kb_entries` table with word-overlap scoring (threshold 0.4).

### Push notifications

`src/lib/usePush.ts` — Web Push API hook. Subscriptions stored in `push_subscriptions` table (`user_id`, `endpoint`, `subscription`). The VAPID public key is hardcoded in the file. The service worker for push must be registered at `public/` level (check `public/` for SW files).

### Supabase tables

| Table | Owner setor | Notes |
|-------|-------------|-------|
| `profiles` | all | `id`, `nome_guerra`, `setor`, `avatar_key` |
| `contratos_scon` | SCON | `fonte: 'EXCEL' \| 'MANUAL'` |
| `processos_licitatorios` | SLIC | joined to `processo_controle` |
| `processo_controle` | SLIC | `status_livre`, `pag`, `om` |
| `indicadores_lotacao` | SEO | `conta_corrente` is the key (e.g., C26001) |
| `empenhos_seo` | SEO | `indicador_lotacao` → `conta_corrente`; `contrato` → `numero_contrato` |
| `chat_messages` | all | chatbot history per user |
| `kb_entries` | ADMIN | chatbot knowledge base fallback |
| `push_subscriptions` | all | Web Push subscriptions |
| `feed_noticias` (inferred) | ADMIN+ | news/announcements for `FeedNoticias` |

All DB access is client-side via the Supabase anon key; RLS policies enforce access control.

## Key conventions

- All currency formatting uses `Intl.NumberFormat("pt-BR", { currency: "BRL" })`.
- All date formatting uses `new Date(d + "T12:00:00").toLocaleDateString("pt-BR")` — the `T12:00:00` prevents timezone off-by-one on ISO date strings.
- UI language is **pt-BR** throughout — keep all labels, messages, and errors in Portuguese.
- No test framework is configured. Verify behavior manually in the dev server.
- `mockData.ts` in `src/components/painelBI/` is used as a silent fallback when Google Sheets CSVs are unavailable.
