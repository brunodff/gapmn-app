-- ============================================================
--  GERENCIAMENTO DE PROCESSOS LICITATÓRIOS - UASG 120630
--  Execute no SQL Editor do Supabase Dashboard
-- ============================================================

-- 1. Dados da API (sincronizados pelo Edge Function)
CREATE TABLE IF NOT EXISTS processos_licitatorios (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave                 text UNIQUE NOT NULL,        -- ex: "PNCP:123", "PREGAO:456"
  fonte                 text NOT NULL,               -- LEGADO_LICITACAO | LEGADO_PREGAO | PNCP_14133
  ano                   integer NOT NULL,
  modalidade            text,
  numero_processo       text,
  objeto                text,
  data_publicacao       date,
  abertura_proposta     date,
  encerramento_proposta date,
  valor_estimado        numeric(15,2),
  valor_homologado      numeric(15,2),
  situacao_api          text,
  link_sistema          text,
  ultima_sync           timestamptz DEFAULT now(),
  created_at            timestamptz DEFAULT now()
);

-- 2. Controle manual por processo (status livre, um por processo)
CREATE TABLE IF NOT EXISTS processo_controle (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave        text UNIQUE NOT NULL REFERENCES processos_licitatorios(chave) ON DELETE CASCADE,
  status_livre text,
  updated_at   timestamptz DEFAULT now(),
  updated_by   uuid REFERENCES auth.users(id)
);

-- 3. Observações manuais (várias por processo)
CREATE TABLE IF NOT EXISTS processo_observacoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave           text NOT NULL REFERENCES processos_licitatorios(chave) ON DELETE CASCADE,
  observacao      text NOT NULL,
  data_observacao date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_processos_ano      ON processos_licitatorios(ano);
CREATE INDEX IF NOT EXISTS idx_processos_chave    ON processos_licitatorios(chave);
CREATE INDEX IF NOT EXISTS idx_observacoes_chave  ON processo_observacoes(chave);
CREATE INDEX IF NOT EXISTS idx_controle_chave     ON processo_controle(chave);


-- ============================================================
--  VIEW PARA POWERBI (Security Definer = bypassa RLS)
-- ============================================================
CREATE OR REPLACE VIEW v_processos_powerbi
WITH (security_invoker = false) AS
SELECT
  p.chave,
  p.fonte,
  p.ano,
  p.modalidade,
  p.numero_processo,
  p.objeto,
  p.data_publicacao,
  p.abertura_proposta,
  p.encerramento_proposta,
  p.valor_estimado,
  p.valor_homologado,
  p.situacao_api,
  p.link_sistema,
  p.ultima_sync,

  -- Status calculado (automático, baseado nos dados da API)
  CASE
    WHEN lower(p.situacao_api) LIKE '%revogad%' THEN p.situacao_api
    WHEN lower(p.situacao_api) LIKE '%suspens%' THEN p.situacao_api
    WHEN p.valor_homologado IS NOT NULL           THEN 'Homologada'
    ELSE 'Em Andamento'
  END AS status_calculado,

  -- Status livre (preenchido manualmente pelo SLIC)
  pc.status_livre,

  -- Total de observações deste processo
  (SELECT count(*) FROM processo_observacoes po
   WHERE po.chave = p.chave)::int AS total_observacoes,

  -- Texto da observação mais recente
  (SELECT po.observacao FROM processo_observacoes po
   WHERE po.chave = p.chave
   ORDER BY po.data_observacao DESC, po.created_at DESC
   LIMIT 1) AS ultima_observacao,

  -- Data da observação mais recente
  (SELECT po.data_observacao FROM processo_observacoes po
   WHERE po.chave = p.chave
   ORDER BY po.data_observacao DESC, po.created_at DESC
   LIMIT 1) AS data_ultima_observacao

FROM processos_licitatorios p
LEFT JOIN processo_controle pc ON pc.chave = p.chave;

-- Permitir leitura da view pelo anon (para PowerBI com anon key)
GRANT SELECT ON v_processos_powerbi TO anon, authenticated;


-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE processos_licitatorios ENABLE ROW LEVEL SECURITY;
ALTER TABLE processo_controle      ENABLE ROW LEVEL SECURITY;
ALTER TABLE processo_observacoes   ENABLE ROW LEVEL SECURITY;

-- Helper: retorna a role do usuário logado
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- processos_licitatorios:
--   leitura → qualquer autenticado
--   escrita → somente service_role (Edge Function)
CREATE POLICY "pl_read"   ON processos_licitatorios FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_insert" ON processos_licitatorios FOR INSERT TO service_role  WITH CHECK (true);
CREATE POLICY "pl_update" ON processos_licitatorios FOR UPDATE TO service_role  USING (true);

-- processo_controle: leitura/escrita para slic e admin
CREATE POLICY "pc_read"  ON processo_controle FOR SELECT TO authenticated
  USING (get_my_role() IN ('slic', 'admin'));
CREATE POLICY "pc_write" ON processo_controle FOR ALL    TO authenticated
  USING  (get_my_role() IN ('slic', 'admin'))
  WITH CHECK (get_my_role() IN ('slic', 'admin'));

-- processo_observacoes: leitura/escrita para slic e admin
CREATE POLICY "po_read"  ON processo_observacoes FOR SELECT TO authenticated
  USING (get_my_role() IN ('slic', 'admin'));
CREATE POLICY "po_write" ON processo_observacoes FOR ALL    TO authenticated
  USING  (get_my_role() IN ('slic', 'admin'))
  WITH CHECK (get_my_role() IN ('slic', 'admin'));


-- ============================================================
--  POWERBI - COMO CONECTAR
-- ============================================================
-- No PowerBI Desktop:
--   1. Obter Dados → Web
--   2. URL: https://<SEU_PROJECT_REF>.supabase.co/rest/v1/v_processos_powerbi
--   3. Em "Avançado" adicione os cabeçalhos HTTP:
--        apikey        →  <SUA_ANON_KEY>
--        Authorization →  Bearer <SUA_ANON_KEY>
--   4. Para exportar todas as linhas acrescente na URL: ?select=*&limit=10000
--
-- Para puxar observações detalhadas (uma linha por observação), use:
--   https://<PROJECT>.supabase.co/rest/v1/processo_observacoes?select=*
--   (com os mesmos cabeçalhos - requer autenticação com service_role key neste caso)


-- ============================================================
--  SYNC DIÁRIO AUTOMÁTICO (pg_cron)
--  Habilite a extensão pg_cron no Dashboard → Extensions
--  Substitua SEU_PROJECT_REF e SUA_SERVICE_ROLE_KEY antes de executar
-- ============================================================
-- SELECT cron.schedule(
--   'sync-processos-daily',
--   '0 6 * * *',           -- todo dia às 06:00 UTC (03:00 Manaus)
--   $$
--   SELECT net.http_post(
--     url     := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/sync-processos',
--     headers := '{"Authorization": "Bearer SUA_SERVICE_ROLE_KEY", "Content-Type": "application/json"}',
--     body    := '{}'
--   );
--   $$
-- );
