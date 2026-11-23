-- Reajuste por apostilamento aberto a todos os usuários do gapmn.app (23/11/2026): quem cria os documentos do
-- reajuste são os fiscais e gestores dos contratos, não só a SCON.
--   • contratos_apostilamento: qualquer usuário logado lê, cria e altera o cadastro do reajuste (o app grava
--     com controle de versão, então ninguém apaga sem querer o que outra pessoa salvou). Apagar continua só
--     ADMIN e DEV.
--   • apostilamento_config: qualquer usuário logado lê (Ordenador, ACI e textos fixos vão nos documentos);
--     alterar continua só ADMIN e DEV.
-- Mesmo padrão do contratos_scon (20260502_contratos_rls_todos_veem).

drop policy if exists apost_ler on public.contratos_apostilamento;
drop policy if exists apost_incluir on public.contratos_apostilamento;
drop policy if exists apost_alterar on public.contratos_apostilamento;
create policy apost_ler on public.contratos_apostilamento for select to authenticated using (true);
create policy apost_incluir on public.contratos_apostilamento for insert to authenticated with check (true);
create policy apost_alterar on public.contratos_apostilamento for update to authenticated using (true) with check (true);

drop policy if exists apost_cfg_ler on public.apostilamento_config;
create policy apost_cfg_ler on public.apostilamento_config for select to authenticated using (true);
