-- RESET COMPLETO de itens_ata_gap_mn
-- O bug de race condition afetou todos os itens processados sequencialmente:
-- cada ATA tinha os itens da ATA anterior salva com seu ata_numero.
-- Com o bot corrigido (verificação de ID exato da URL), a re-leitura será correta.

-- 1. Apaga todos os itens
TRUNCATE TABLE itens_ata_gap_mn;

-- 2. Confirma
SELECT count(*) AS total_itens FROM itens_ata_gap_mn;
-- deve retornar 0

-- Após executar:
-- Rode o Robô ARP novamente — ele detecta todas as ATAs como "sem itens"
-- e as reprocessa na ordem correta com o bug de race condition corrigido.
