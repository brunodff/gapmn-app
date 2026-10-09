# GAP-MN — Processos ao Vivo

Extensão para o pessoal da **SLIC**. Completa a tela **Processos** do app do GAP-MN com o que
só existe com login no ComprasNet:

- fase de cada processo e de cada item (aguardando julgamento, habilitação, recurso, adjudicação…);
- ação pendente na Área de Trabalho e pendências;
- participantes (com ME/EPP) e quem está em primeiro em cada item antes da homologação.

O resto — **todos** os processos da UASG 120630 (2019 em diante), objeto, NUP, valores, itens e
vencedores publicados — o app busca sozinho no PNCP e nos Dados Abertos do Compras.gov.br,
às 07:00 e 13:00 (função `sync-processos`). A extensão não é necessária para isso.

## Instalar (Chrome ou Edge)

1. Baixe `processos-ao-vivo-<versão>.zip` (tela Processos do app → link da extensão) e descompacte
   numa pasta que não vá ser apagada (ex.: `Documentos\processos-ao-vivo`).
2. Abra `chrome://extensions` (no Edge: `edge://extensions`), ligue **Modo do desenvolvedor**.
3. **Carregar sem compactação** → escolha a pasta descompactada.
4. Clique no ícone da extensão e entre com o **login do app GAP-MN** (perfis SLIC, ADMIN ou DEV).

## Uso

Nada a fazer no dia a dia: ao abrir a **Área de Trabalho** do ComprasNet (com login), a extensão
envia sozinha — e de novo a cada 3 horas enquanto ela estiver aberta (dá para mudar na janelinha).
O botão **Enviar agora** força um envio. Cada envio fica registrado em `processos_sync_log`
(fonte `cnet`).

Só processos da UASG 120630. O envio usa o login da pessoa no app; o banco só aceita gravação
nas tabelas `cnet_*` de SLIC, ADMIN e DEV.

## Atualizar

Edite os arquivos, aumente `version` no `manifest.json` e rode `python empacotar.py`
(gera `dist/`, copia para a Área de Trabalho e para `gapmn-app/public/gapmn-processos-ao-vivo.zip`).
Quem já instalou: substitui os arquivos da pasta e clica em ⟳ em `chrome://extensions`.
