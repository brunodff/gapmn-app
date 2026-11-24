# Acompanhamento do PCA (SLIC)

Tela `/app?vista=pca` (menu Licitações › Acompanhamento do PCA). Pedido da SLIC (Ten Gabriela), nov/2026.

## Como funciona

| Módulo | O que o sistema faz | De onde vem |
|---|---|---|
| A. PGC e modalidade | Cria e atualiza uma linha por contratação do PCA (nº 120630-NNN/AAAA, DFD, objeto, chegada e conclusão previstas, valor) e sugere a modalidade (Lei nº 14.133/2021, limites do art. 75 configuráveis) | Dados Abertos do Compras.gov.br (módulo PGC) + PCA no PNCP, 07:50 e 13:50 |
| B. D-30 | E-mail ao Elo 30 dias antes da chegada prevista sem DNR: datas, link das listas de verificação e aviso do expediente formal | rotina diária |
| C. DNR | Lê o TR e o Ofício de Abertura (PDF, no navegador), a planilha exportada do SILOMS ou o robô; o PAG do Ofício prevalece; contratação ausente, fora do PCA ou com objeto diferente vai para a fila de decisão | tela "Registrar DNR" ou robô |
| D. Fase interna | Subprocesso do SILOMS com os 5 fluxos oficiais e os marcos (minutas, IRP, ACI, OD) | tela ou robô |
| E. Jurídico | Triagem MJR × CJU pelas regras cadastradas (ligadas aos pareceres referenciais vigentes da AGU); CJU pelos e-mails da SLIC, com o prazo de 15 dias | caixa licita.guarnaemn@gmail.com (Apps Script) |
| F. Publicação | Acha o certame publicado pelo PAG (ou pelo nº do certame = nº da contratação) e confirma modalidade, valor e SRP; DOU pelo alerta do DOU; DOU e EBC piscam até serem registrados | processos_licitatorios (sync-processos) e dou_publicacoes (sync-dou) |
| G. Fase externa | Pregoeiro, impugnação e esclarecimento (alerta ao pregoeiro e à SLIC), status manual só com justificativa | tela e caixa de e-mail |
| H. Homologação | Homologado → e-mail à Atas (SRP) ou à SCON (contrato) → "Encaminhado" | PNCP e robô do SILOMS |
| I. Elos | E-mail ao Elo a cada macroalteração de status | automático |

Toda alteração passa pela função `pca-automacao` e fica no histórico imutável (`pca_historico`: nem a chave de serviço altera ou apaga).
E-mail só sai sozinho com o envio automático ligado (Administração › Configuração); desligado, fica na aba E-mails.

## Implantação

1. **Banco:** rodar `supabase/migrations/20261125_pca_acompanhamento.sql` no SQL Editor (cria as tabelas, as permissões e a rotina das 07:50/13:50).
2. **Secret da integração:** `npx supabase secrets set PCA_WEBHOOK_KEY=<32+ caracteres aleatórios> --project-ref fychrtyyqbzlfbzbvzqp`.
   `RESEND_API_KEY`, `RESEND_FROM` e `SYNC_PROCESSOS_KEY` já existem (são os do e-mail ao fiscal e da sync-processos).
3. **Função:** `npx supabase functions deploy pca-automacao --no-verify-jwt --use-api --project-ref fychrtyyqbzlfbzbvzqp`.
4. **App:** push no main (Cloudflare Pages). Não há variável nova no `.env` do app (usa `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`).
5. **Primeira carga:** na tela, "↻ Atualizar agora" (SLIC, ADMIN ou DEV).
6. **Cadastros (Administração):** Elos (com os códigos de área do PGC), equipe da SLIC e pregoeiros, regras de MJR, e-mail da SLIC; depois ligar o envio automático.
7. **Caixa da SLIC:** na conta licita.guarnaemn@gmail.com, script.google.com → colar `public/pca/monitor-gmail.gs` (também em gapmn.app/pca/monitor-gmail.gs) → propriedade do script `PCA_CHAVE` = o valor do `PCA_WEBHOOK_KEY` → executar `instalar`.

## Integração com o SILOMS (robô interno)

`POST https://fychrtyyqbzlfbzbvzqp.supabase.co/functions/v1/pca-automacao`, cabeçalho `x-pca-key: <PCA_WEBHOOK_KEY>`.

DNR:
```json
{ "acao": "dnr", "registros": [{ "numero_dnr": "345/2027", "data_chegada": "2027-02-09", "pag_oficio": "67000.000999/2027-22",
  "pag_tr": "67000.000999/2027-22", "numero_contratacao": "120630-110/2027", "itens_pca": [40, 41], "objeto": "…",
  "assinante_tr": "…", "om_apoiada": "HAMN", "fonte": "siloms" }] }
```

Marcos (subprocesso, fase externa, homologação, liberação para publicação):
```json
{ "acao": "evento", "origem": "siloms", "eventos": [
  { "origem": "siloms", "tipo": "subprocesso", "chave": "id-único-do-robô", "pag": "67000.000999/2027-22", "data": "2027-02-15",
    "dados": { "nome": "DNR 345 - LIMPEZA", "fluxo": "FASE INTERNA DA LICITAÇÃO GAP-MN - PÓS PARECER ACI", "etapa": "ACI", "marco": "aci" } },
  { "origem": "siloms", "tipo": "fase_externa", "chave": "…", "pag": "…", "data": "…", "dados": { "nome": "FASE EXTERNA - PREGÃO 90110" } },
  { "origem": "siloms", "tipo": "homologacao", "chave": "…", "pag": "…", "data": "2027-04-01" },
  { "origem": "siloms", "tipo": "liberacao", "chave": "…", "pag": "…", "data": "2027-03-01" } ] }
```
`marco`: `minutas`, `irp`, `aci` ou `od`. `fluxo`: nome do fluxo ou número de 1 a 5. A `chave` evita processar o mesmo aviso duas vezes.

## Regras e testes

Regras em `src/lib/pca/` (as mesmas na tela e na função): `regras.ts` (modalidade, triagem, prazos, alertas), `pgc.ts`, `documentos.ts` (TR, Ofício, planilha, e-mails), `motor.ts` (status e histórico), `emails.ts`. Testes: `node --test src/lib/pca/pca.test.ts` (também no `npm test`).
