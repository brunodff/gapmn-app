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
