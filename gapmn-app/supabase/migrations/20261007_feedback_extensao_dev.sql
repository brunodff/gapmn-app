-- Sugestões das extensões (botão 💬 do Painel ComprasNet, do robô de empenhos e da
-- extensão de OB). A policy "dev select" deixava qualquer um com a chave pública
-- (que está no código das extensões) ler todas as mensagens. Agora as extensões só
-- gravam; a leitura é no App (página /uso-extensoes), para o perfil DEV.

alter table public.feedback_extensao enable row level security;

drop policy if exists "dev select" on public.feedback_extensao;
drop policy if exists "dev le pelo app" on public.feedback_extensao;
create policy "dev le pelo app" on public.feedback_extensao
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and setor = 'DEV'));
