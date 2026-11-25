-- Prints da consulta do índice (Calculadora do Cidadão / tabela da FGV) guardados por contrato e por reajuste
-- (revisão 5.1 da SCON, seção 3.4): o Parecer Técnico do termo aditivo usa o print feito no módulo Reajustes, em
-- qualquer sessão. Depósito privado; como os Reajustes, qualquer usuário logado lê, envia e troca.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reajustes-prints', 'reajustes-prints', false, 10485760, array['image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- caminho: <nº do contrato sem símbolos>/<nº do reajuste>/<nome>
drop policy if exists reajustes_prints_ler on storage.objects;
drop policy if exists reajustes_prints_enviar on storage.objects;
drop policy if exists reajustes_prints_apagar on storage.objects;
create policy reajustes_prints_ler on storage.objects for select to authenticated using (bucket_id = 'reajustes-prints');
create policy reajustes_prints_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'reajustes-prints' and name ~ '^[0-9A-Za-z_-]{1,80}/[0-9]{1,2}/[0-9A-Za-z_. ()-]{1,160}$');
create policy reajustes_prints_apagar on storage.objects for delete to authenticated using (bucket_id = 'reajustes-prints');

select (select count(*) from storage.buckets where id = 'reajustes-prints') as bucket,
       (select count(*) from pg_policies where tablename = 'objects' and policyname like 'reajustes_prints%') as politicas;
