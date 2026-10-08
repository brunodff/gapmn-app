# SILOMS — Nome dos Documentos

Os documentos baixados do SILOMS vêm como `DOCUMENTO - 1.pdf`, `DOCUMENTO ASSINADO 3.pdf`…
Com esta extensão, o arquivo já vem com o **assunto do documento** no nome:

| Antes | Depois |
|---|---|
| `DOCUMENTO - 1.pdf` | `Solicitação de Empenho 26S1603 - HAMN.pdf` |
| `DOCUMENTO - 6.pdf` | `Despacho - Encaminhamento ao SEO.pdf` |
| `DOCUMENTO ASSINADO 3.pdf` | `Ordem Bancária - OB 2026OB010442 assinada.pdf` |

Não tem botão nem configuração: instale e baixe os documentos como sempre (ícone **Abrir** da
lista de documentos).

## Como funciona

- Ao clicar em **Abrir** numa lista do SILOMS que tem a coluna **Assunto**, a extensão guarda o
  assunto e o tipo de documento daquela linha; o arquivo que o SILOMS manda em seguida é salvo
  com esse nome. O tipo entra na frente quando o assunto não o diz (ex.: "Despacho - …").
- Sem assunto, usa o nome do documento. Caracteres que o Windows não aceita (`/ : * ? " < > |`)
  saem do nome. Dois arquivos com o mesmo assunto viram `… (1).pdf`.
- Cliques em Editar/Excluir/Assinar e downloads de outros sites não são afetados. Não envia nada
  para fora do computador: não tem servidor nem coleta de dados.

## Instalar

**Chrome / Edge**
1. Descompacte `siloms-nomes-<versão>-chrome.zip` numa pasta que não vá ser apagada.
2. Abra `chrome://extensions` (no Edge, `edge://extensions`), ligue o **Modo do desenvolvedor**
   e clique em **Carregar sem compactação** → escolha a pasta.
3. Recarregue a página do SILOMS (F5).

**Firefox**
- Sem assinatura da Mozilla, o Firefox só instala de forma temporária: `about:debugging` →
  **Este Firefox** → **Carregar extensão temporária** → escolha o `manifest.json` de dentro do
  `siloms-nomes-<versão>-firefox.zip` descompactado. Some ao fechar o Firefox — para instalar de
  vez, a versão assinada (AMO) precisa ser publicada.

## Gerar os pacotes

`python empacotar.py` → `dist/` (versão em `manifest.json` e `manifest.firefox.json`).
