-- ─── Solicitações de Empenho ───────────────────────────────────────────────
-- Importadas do Excel SILOMS; status atualizado via sync com planilha NE SIAFI.

CREATE TABLE IF NOT EXISTS solicitacoes_empenho (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                text        NOT NULL UNIQUE,         -- ex: "25S2012"
  pag                   text,                               -- processo administrativo
  responsavel           text,                               -- nome extraído de col M
  email                 text,                               -- e-mail @fab.mil.br de col M
  obs_original          text,                               -- conteúdo bruto de col M
  obs_atraso            text,                               -- nota manual ADMIN/SEO
  status                text        NOT NULL DEFAULT 'IMPORTADA',  -- IMPORTADA | EMITIDA | ASSINADA
  ne_siafi              text,                               -- ex: "2026NE000123"
  ne_siloms             text,
  notificado_emitida_em timestamptz,
  notificado_assinada_em timestamptz,
  notificacao_ativa     boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ─── Log de notificações enviadas ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notificacoes_empenho_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id  uuid        REFERENCES solicitacoes_empenho(id) ON DELETE CASCADE,
  tipo            text        NOT NULL,        -- 'EMITIDA' | 'ASSINADA'
  email_destino   text        NOT NULL,
  enviado_em      timestamptz NOT NULL DEFAULT now(),
  sucesso         boolean     NOT NULL DEFAULT true,
  erro            text
);

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE solicitacoes_empenho     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacoes_empenho_log ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário autenticado
CREATE POLICY "sol_emp_select" ON solicitacoes_empenho
  FOR SELECT TO authenticated USING (true);

-- Escrita: apenas SEO / ADMIN / DEV
CREATE POLICY "sol_emp_write" ON solicitacoes_empenho
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND setor IN ('SEO','ADMIN','DEV')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND setor IN ('SEO','ADMIN','DEV')
    )
  );

-- Log: leitura autenticada, escrita via service_role (Edge Function)
CREATE POLICY "log_emp_select" ON notificacoes_empenho_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "log_emp_insert_service" ON notificacoes_empenho_log
  FOR INSERT TO service_role WITH CHECK (true);
