# GAPMN Empenho Bot — Instalação e Checklist

## 1. Instalar a extensão Chrome

1. Abra `chrome://extensions`
2. Ative **Modo do desenvolvedor** (toggle no canto superior direito)
3. Clique em **Carregar sem compactação** (Load unpacked)
4. Selecione a pasta `extensao-empenho-bot/`
5. Copie o **ID da extensão** exibido na extensão instalada (formato: `abcdefghijklmnopqrstuvwxyzabcdef`)

## 2. Configurar ID no gapmn.app

1. Acesse gapmn.app → Ferramentas → **Empenho Automático**
2. Clique em **Extensão** (canto superior direito)
3. Cole o ID copiado no campo
4. Clique **Testar** — deve aparecer "✓ Extensão respondendo"

## 3. Pré-requisitos para uso

- Estar logado no Contratos.gov.br (`contratos.comprasnet.gov.br`) com sua conta gov.br
- O site deve estar aberto em uma aba do Chrome
- Extensão instalada e lado panel visível

## Checklist — Teste dry-run com 26S1030

- [ ] Upload do PDF 26S1030 na tela de conferência
- [ ] Parser extrai: numero=26S1030, CNPJ=50522607000100, nd=339030, ptres=214537, pi=CG190904100, ugr=120154, compra=90007/2025
- [ ] Campos em amarelo: subelemento dos 2 itens (164 e 165) — preencher manualmente com valor do PDF original
- [ ] Extensão conectada (badge verde)
- [ ] Contratos.gov.br aberto e logado
- [ ] Clicar "Executar no Comprasnet" → side panel abre
- [ ] Robô executa Etapa 1: seleciona Compra, Pregão, preenche 90007/2025, seleciona GAP-MN
- [ ] Robô PAUSA na Etapa 2 (seletores pendentes de HTML real)
- [ ] Verificar log no side panel para diagnóstico

## Etapas com seletores ainda pendentes (aguardando HTML)

| Etapa | Status | Ação necessária |
|-------|--------|-----------------|
| 1 — Contrato/Compra | ✅ Implementada | — |
| 2 — Fornecedor | ⏳ Pendente | Cole o HTML desta página no chat |
| 3 — Itens | ⏳ Pendente | Cole o HTML desta página no chat |
| 4 — Crédito disponível | ⏳ Pendente | Cole o HTML desta página no chat |
| 5 — Subelemento | ⏳ Pendente | Cole o HTML desta página no chat |
| 6 — Dados Empenho | ⏳ Pendente | Cole o HTML desta página no chat |
| 7 — Passivo Anterior | ⏳ Pendente | Cole o HTML desta página no chat |
| 8 — Finalizar | ⏳ Pendente | Cole o HTML desta página no chat |

Para cada etapa: navegue até ela no Comprasnet, F12 → Elements → encontre `<div class="content-wrapper">` → botão direito → **Copy → Copy outerHTML** → cole no chat.

## Firefox (128 ou superior)

1. Abra `about:debugging#/runtime/this-firefox`
2. Clique em **Carregar extensão temporária…** e escolha o arquivo `manifest.json` desta pasta
3. Abra a barra lateral em **Exibir → Barra lateral → GAPMN Empenho Bot** (ou clique no ícone da extensão)

Observações:
- No Firefox a extensão é temporária: precisa ser recarregada a cada vez que o navegador é reiniciado.
- O botão "enviar do gapmn.app" (mensagem direta da página para a extensão) só funciona no Chrome; no Firefox use o painel lateral.
- Avisos do Firefox sobre `sidePanel` e `service_worker` são esperados e inofensivos.

## Subprocessos no SILOMS (versão 2.7)

Depois da fila de empenhos, o robô cria um subprocesso por solicitação empenhada e anexa
a ele o PDF da solicitação e o da declaração do SICAF (substitui a extensão
"Criador de Subprocessos SILOMS", que pode ser desativada).

1. Abra o SILOMS e entre em **Documentos na Unidade** (a lista com o botão Novo Subprocesso).
2. No painel: **Criar subprocessos no SILOMS** (menu, relatório da fila ou "Empenhos gerados").
3. Confira o PAG e o nome de cada um, marque os que quer criar e clique em **Criar subprocessos**.

- Os PDFs ficam guardados quando você arrasta a solicitação e quando o SICAF é conferido
  (ou quando arrasta a declaração do SICAF). Faltando a declaração, o botão
  "Baixar do SICAF as declarações que faltam" usa a aba do SICAF logada.
- Em **Configuração**: unidade do ePAG, fluxo, responsáveis (sorteio por peso) e o endereço
  da planilha de controle (Apps Script) — o mesmo do robô antigo.
- **Firefox:** em `about:addons` › GAPMN Empenho Bot › Permissões, deixe ligados os sites
  do SILOMS (`*.siloms.intraer`); sem isso o robô não entra na aba do SILOMS.
- Se o botão de inserir documento não for achado, o log lista os botões da tela —
  mande o print para ajustar.

## Reforço, anulação e irrisório (versão 2.8)

- Solicitação com "Anulação Ident/OC …" ou "Reforço …" é reconhecida no PDF. Na revisão,
  informe a **NE a alterar** (não vem no PDF; aceita "552", "NE552" ou "2026NE000552").
  Com mais de um item na NE, informe o N.Item.
- No CNET o robô pesquisa a NE em Minutas de Empenho (remove os filtros se ela não aparecer),
  abre **Alterar Empenho › Adicionar Alteração do empenho**, escolhe o Tipo Operação, digita
  o valor, passa pelo Passivo Anterior e emite — conferindo o número da NE na Mensagem SIAFI.
- Arredondamento: sempre "para menos". O que faltar vira, na mesma NE:
  REFORÇO IRRISÓRIO (empenho novo e reforço) ou ANULAÇÃO SALDO IRRISÓRIO (anulação).
  O robô só faz sozinho quando houve arredondamento e a diferença cabe nele; senão avisa
  no relatório ("Irrisório a fazer").
- Na anulação/reforço (2.8.2) o próprio robô calcula o "para menos" antes de digitar: o SIAFI
  só aceita valor = quantidade (até 5 casas) × valor unitário (senão recusa com ER0462). Ele
  digita o valor que fecha, emite e logo em seguida faz o irrisório da diferença na mesma NE.
  Se o CNET ainda abrir o aviso de arredondamento, escolhe "para menos" e, antes de emitir,
  confere que o valor mudou (se não mudou, não emite).
- NE de ano anterior (restos a pagar): a revisão avisa. Se o CNET não oferecer o
  "Tipo Operação", o robô para e explica — alteração de RP costuma ser feita no SIAFI Web.
- Anulação não confere o fornecedor; reforço confere (SICAF) como o empenho novo.
