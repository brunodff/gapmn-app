-- Políticas RLS para o bucket contratos-docs no Supabase Storage
-- Qualquer usuário autenticado pode fazer upload, visualizar e remover

-- Upload (INSERT)
CREATE POLICY "contratos_docs_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'contratos-docs');

-- Visualizar / baixar (SELECT)
CREATE POLICY "contratos_docs_select"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'contratos-docs');

-- Substituir arquivo (UPDATE / upsert)
CREATE POLICY "contratos_docs_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'contratos-docs');

-- Remover (DELETE)
CREATE POLICY "contratos_docs_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'contratos-docs');

-- Acesso público anônimo para leitura (necessário para links de download públicos)
CREATE POLICY "contratos_docs_public_read"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'contratos-docs');
