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

## Subprocesso também para não empenhadas (versão 2.8.17)

- A tela "Subprocessos no SILOMS" lista também as solicitações **não empenhadas** (e as "conferir
  no CNET"), com o motivo. Vêm **desmarcadas**: marque as que devem ganhar subprocesso mesmo assim.
- O nome sai sem a NE ("Solicitação de Empenho 26S1630 - HAMN"); a solicitação e o SICAF são
  inseridos normalmente. Se a mesma solicitação falhou e depois foi empenhada, vale a empenhada.

## Mais rápido entre as telas (versão 2.8.16)

- Depois de cada "Próxima", o robô segue assim que a **tela nova estiver montada**, em vez de
  esperar a aba terminar de carregar tudo (imagens e scripts de fora do CNET às vezes seguravam a
  aba "carregando" por 30–50 s com a tela já pronta). Teste: de 40 s para menos de 1 s.
- "Próxima" que não leva a outra tela (campo inválido) é percebido em ~10 s (antes 25 s).
- "Ampliar a tabela" espera no máximo 1,5 s pelo seletor "N por página" (antes até 8 s por etapa,
  mesmo em telas sem o seletor).
- Depois de "Corrigir agora" (arredondamento), o robô só clica "Próxima" se ainda estiver na tela
  do aviso — com a aba demorando a carregar, antes podia clicar na tela seguinte e pular a Etapa 6.

## Item do contrato e lista de fornecedores (versão 2.8.15)

- Contrato com solicitação sem N.Item (ou com um N.Item que o contrato não tem): na Etapa 3 o robô
  escolhe o item do contrato pelo **valor unitário** e, sem ele, pela **descrição** (o log diz qual
  e por quê). Antes marcava todos e a Etapa 5 parava com "há 2 itens marcados no CNET".
- Sem como decidir com segurança, para na Etapa 3 listando os itens do contrato (nº, descrição e
  valor unitário) para você informar o N.Item na revisão.
- Solicitações carregadas antes da 2.8.15 não têm o valor unitário/descrição guardados: carregue o
  PDF de novo para o robô poder escolher sozinho.
- Etapa 2 sem nenhum fornecedor na lista: recarrega a tela uma vez; se continuar vazia, diz se o
  CNET respondeu "Nenhum registro encontrado" (sem fornecedor com saldo) ou se a tela não carregou.

## Nome do subprocesso com a NE (versão 2.8.14)

- O nome e o assunto do subprocesso levam a NE emitida no fim:
  "Solicitação de Empenho 26S1603 - HAMN - 2026NE001547". Com a NE ainda em processamento, sai
  sem ela. Nome editado à mão no painel continua como foi digitado.
- Se o campo Nome do SILOMS tiver limite de tamanho, o começo vira "Sol. Empenho" para a NE não
  ser cortada.

## CNET lento (versão 2.8.13)

- Com o CNET sobrecarregado, o robô **não desiste em 20 s**: espera a próxima tela e as tabelas
  (fornecedores, itens, crédito, subelementos) **até 5 min**, avisando no log a cada 20 s
  ("⏳ O CNET está lento — esperando os itens (40 s)…").
- Se a tela ainda está carregando, ele espera em vez de clicar "Próxima" de novo.
- Se uma tabela não vier em 2 min (a busca pode ter se perdido), ele recarrega a tela uma vez.
- Só desiste depois de 5 min; três solicitações seguidas assim pausam a fila (CNET fora do ar).

## Unidade da compra e listas longas (versão 2.8.12)

- Etapa 1: com o CNET lento, a busca da unidade (120630) mostrava "Pesquisando…" e o robô clicava
  nisso — ficava "Unidade da compra 120630 não selecionada". Agora espera a unidade aparecer na
  lista (até 15 s), tenta até 3 vezes e, se já estiver selecionada, não mexe.
- Etapas 2 a 5: além de escolher o maior "N por página", o robô põe **todas as linhas** numa
  página só e limpa uma pesquisa que tenha ficado guardada. Antes, numa compra com mais itens que
  a maior opção (ex.: 50), os itens da página 2 davam "Item … não está na lista desta compra".

## Crédito atualizado na Etapa 4 (versão 2.8.11)

- Antes de marcar a linha de crédito, o robô clica o botão de atualizar (⟳, coluna Ações) **da
  linha da solicitação** e espera o CNET terminar — o "Valor" guardado pode estar velho, para mais
  ou para menos, e barrar um empenho que cabe no crédito real.
- O log mostra o crédito antes → depois ("Crédito da linha atualizado: R$ 500,00 → R$ 2.750,40") e
  avisa se, mesmo atualizado, o crédito for menor que a solicitação.
- Se o CNET der erro na atualização (SIAFI fora do ar) ou não responder, o robô avisa no log e segue
  com o valor da tela. Avisos de confirmação/sucesso do CNET são confirmados sozinhos.

## Documentos no subprocesso (versão 2.8.10)

- Na janela "Inclusão de Documento em Subprocesso" o robô preenche **Nome do Documento**
  ("Solicitação de Empenho 26S1593" / "Declaração SICAF - <empresa>"), **Data de Elaboração**
  (hoje), **Tipo de Documento** (a opção que combinar), o Assunto e o arquivo; Sigilo e Tipo de
  Conferência ficam no padrão (OSTENSIVO / ORIGINAL).
- Se o SILOMS recusar (ex.: "campo obrigatório"), o aviso aparece no log e no resultado, com os
  campos da janela — o robô não fica parado no alerta.

## Credenciamento (versão 2.8.7)

- O PDF traz o contrato cortado ("CREDENCIAMENTO 004/2"). O robô reconhece o credenciamento e
  guarda o número (004, com o ano se aparecer no PDF). No CNET o credenciamento tem **2 na frente**
  e 4 dígitos: na Etapa 1 ele pesquisa **20004/2023** (ou **20004/2** sem o ano) — aparecem os
  credenciamentos desse número, um por credenciado — e escolhe o do **CNPJ do fornecedor**.
- Na revisão, a caixa "Credenciamento" (abaixo do Contrato) vem marcada; dá para desmarcar ou
  marcar à mão. Se o fornecedor tiver mais de um credenciamento com esse número, informe o ano.

## Reforço, anulação e irrisório (versão 2.8)

- Solicitação com "Anulação Ident/OC …" ou "Reforço …" é reconhecida no PDF. Na revisão,
  informe a **NE a alterar** (não vem no PDF; aceita "552", "NE552" ou "2026NE000552").
  Com mais de um item na NE, informe o N.Item.
- No CNET o robô pesquisa a NE em Minutas de Empenho (remove os filtros se ela não aparecer),
  abre **Alterar Empenho › Adicionar Alteração do empenho**, escolhe o Tipo Operação, digita
  o valor, passa pelo Passivo Anterior e emite — conferindo o número da NE na Mensagem SIAFI.
- Aviso "Diferença de arredondamento identificada" (2.8.6): o robô escolhe a opção de menor
  valor e clica **"Corrigir agora"** (o valor do item passa a ser o calculado); se a tela não
  avançar sozinha, clica "Próxima Etapa" de novo. "Avançar e ajustar depois" seguia com o valor
  digitado e o SIAFI recusava (ER0462).
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
