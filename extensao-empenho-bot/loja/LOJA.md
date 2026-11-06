# Robô de Empenhos na Chrome Web Store

Tudo o que a Chrome Web Store pede, na ordem das abas do painel de desenvolvedor.
Mesma conta do Painel ComprasNet (a taxa de US$ 5 já foi paga).

## Antes de enviar

1. **Página de privacidade no ar.** A loja confere o link:
   https://gapmn.app/extensoes/robo-empenhos/privacidade
   O arquivo é `gapmn-app/public/extensoes/robo-empenhos/privacidade.html` e sai no próximo deploy do app.
   Junto vão os PDFs de exemplo para o revisor:
   - `solicitacao-exemplo.pdf`
   - `sicaf-exemplo.pdf`
2. **Gerar o pacote:**
   ```
   python -X utf8 loja/empacotar_loja.py
   ```
   O comando cria `dist/robo-empenhos-<versão>-chrome.zip`. Esse pacote:
   - não leva as chaves que são só do Firefox;
   - não leva o localhost;
   - não leva testes nem documentação.
3. **Imagens:** ficam em `loja/imagens/` (ícone, 5 capturas 1280×800 e bloco 440×280). Todos os dados das capturas são fictícios.

Painel: https://chrome.google.com/webstore/devconsole → **Novo item** → envie o zip.

---

## Aba "Detalhes do item da loja"

**Nome e resumo:** vêm do pacote.
- Nome: `Robô de Empenhos`
- Resumo (129 caracteres): `Lê a solicitação de empenho em PDF, preenche a minuta no Contratos.gov.br e cria o subprocesso no SILOMS. Ferramenta não oficial.`

**Descrição** (copie o bloco inteiro):

```
Do PDF da solicitação ao empenho emitido no Contratos.gov.br.

Feito para os setores de execução orçamentária das organizações militares: você carrega as solicitações de empenho tiradas do SILOMS e o robô preenche as minutas no Contratos.gov.br, na sessão que você já abriu no navegador.

O QUE ELE FAZ
• Lê a solicitação de empenho em PDF: fornecedor, contrato ou compra, itens, valores, crédito (ND, PTRES, fonte, PI) e observação — inclusive itens escritos dentro da descrição.
• Confere antes de começar: sanções e impedimentos do fornecedor (CEIS, CNEP, cadastro do Compras.gov.br e Receita Federal), certidões do SICAF e se a soma dos itens bate com o total da solicitação.
• Preenche as etapas da minuta no Contratos.gov.br: contrato ou compra, fornecedor, itens, crédito, subelemento e quantidade — e confere o valor na tela antes de emitir.
• Trata reforço, anulação e o saldo irrisório do arredondamento.
• Depois do empenho emitido, cria o subprocesso no SILOMS com a solicitação e a declaração do SICAF anexadas.
• Relatório da fila com a nota de empenho de cada solicitação, em CSV.

AVISA, NÃO IMPEDE
Sanção, impedimento ou certidão vencida viram aviso com o motivo. Quem decide é você. Se preferir, o robô para antes de cada emissão e espera sua confirmação.

REQUISITOS
• Acesso ao Contratos.gov.br com perfil de emissão de empenho; para o subprocesso, acesso ao SILOMS (rede interna).
• Chrome ou Edge atualizados.

PRIVACIDADE
Os PDFs são lidos no seu navegador. A extensão usa a sessão que você já abriu nos sistemas e não guarda senhas. Detalhes: https://gapmn.app/extensoes/robo-empenhos/privacidade

Ferramenta não oficial, desenvolvida no GAP-MN (Grupamento de Apoio de Manaus). Sem vínculo oficial com o Ministério da Gestão, o Serpro ou o Comando da Aeronáutica.
```

**Demais campos:**
- **Categoria:** Ferramentas (a mesma do Painel ComprasNet).
- **Idioma:** Português (Brasil).

**Recursos gráficos:**

| Campo | Arquivo |
|---|---|
| Ícone da loja (128×128) | `loja/imagens/icone-128.png` |
| Capturas de tela (1280×800), nesta ordem | `captura-1-revisao.png`, `captura-2-itens.png`, `captura-3-execucao.png`, `captura-4-subprocessos.png`, `captura-5-menu.png` |
| Bloco promocional pequeno (440×280) | `promocional-440x280.png` |
| Bloco de letreiro (1400×560) | deixe em branco (opcional) |
| Vídeo promocional | deixe em branco; depois entra o link do YouTube do vídeo do robô |

**Links adicionais:**
- **Página inicial:** `https://gapmn.app`
- **URL de suporte:** em branco.
- **Site oficial:** em branco (exigiria verificar o domínio no Search Console).

**Conteúdo adulto:** Não.

---

## Aba "Práticas de privacidade"

**Descrição da finalidade única:**

```
Apoiar a emissão de empenhos: ler a solicitação de empenho em PDF e preencher a minuta de empenho no Contratos.gov.br, com a conferência do fornecedor (sanções e certidões do SICAF) e a abertura do subprocesso do empenho no SILOMS.
```

**Justificativa das permissões** (uma caixa para cada):

| Permissão | Justificativa |
|---|---|
| `storage` | Guardar no navegador o código anônimo da instalação, o perfil do usuário (posto, nome e OM), as solicitações carregadas, os PDFs que serão anexados ao subprocesso, o relatório dos empenhos gerados e a configuração da unidade no SILOMS. |
| `sidePanel` | A extensão funciona num painel lateral, aberto pelo ícone, ao lado das abas do Contratos.gov.br e do SILOMS. |
| `scripting` | Preencher as telas da minuta de empenho no Contratos.gov.br, conferir as certidões no SICAF e criar o subprocesso no SILOMS, nas abas que o próprio usuário abriu com o seu login. |
| `tabs` | Localizar as abas abertas do Contratos.gov.br, do SICAF e do SILOMS e acompanhar a troca de tela entre as etapas da minuta. |
| `webNavigation` | Encontrar o quadro (frame) certo das janelas do SILOMS onde o subprocesso é preenchido (webNavigation.getAllFrames). |

**Justificativa da permissão de host:**

```
contratos.comprasnet.gov.br: preencher a minuta de empenho na sessão do usuário.
www3.comprasnet.gov.br: ler a declaração do SICAF (situação do fornecedor e certidões) na sessão do usuário.
*.siloms.intraer, *.intraer e *.fab.mil.br: SILOMS, sistema interno do Comando da Aeronáutica, onde o robô cria o subprocesso do empenho (só existe na rede interna).
mcp-compras.up.railway.app: servidor de consultas do GAP-MN App, que verifica sanções do fornecedor em bases públicas; recebe apenas o CNPJ.
fychrtyyqbzlfbzbvzqp.supabase.co: banco do GAP-MN App, que recebe as sugestões enviadas pelo botão de sugestões e a contagem anônima de uso.
```

**Código remoto:** marque **Não, não estou usando código remoto.**

**Uso de dados**, marque:
- ☑ **Informações de identificação pessoal.** O nome do responsável vai para a planilha da própria unidade, se ela for configurada.
- ☑ **Conteúdo do site.** A extensão lê as telas do Contratos.gov.br, do SICAF e do SILOMS.
- Deixe os demais tipos desmarcados.
- Marque as três declarações:
  - não vende dados;
  - não usa os dados para fins alheios à finalidade única;
  - não usa os dados para crédito.

**Política de privacidade:** `https://gapmn.app/extensoes/robo-empenhos/privacidade`

---

## Aba "Distribuição"

- **Pagamento:** gratuito.
- **Visibilidade:** **Público**. É o recomendado: outras unidades acham o robô na busca, como o Painel ComprasNet. Use **Não listado** se preferir só quem tem o link.
- **Regiões:** Brasil.

---

## Aba "Instruções de teste" (para o revisor)

```
O Robô de Empenhos automatiza sistemas do governo federal brasileiro que exigem login institucional: Contratos.gov.br (perfil de órgão público), SICAF e SILOMS (rede interna do Comando da Aeronáutica). Não é possível fornecer credenciais de teste.

Para ver a leitura e a revisão sem esses sistemas:
1. Instale e clique no ícone da extensão: o painel lateral abre.
2. Preencha o perfil (posto 2T, nome TESTE, OM GAP-MN) e salve.
3. Clique em "Empenhar no Contratosgov" e carregue os dois PDFs de exemplo (dados fictícios):
   https://gapmn.app/extensoes/robo-empenhos/solicitacao-exemplo.pdf
   https://gapmn.app/extensoes/robo-empenhos/sicaf-exemplo.pdf
4. Clique em "Ver revisão": o cartão mostra fornecedor, contrato e crédito; em "Ver / editar campos" aparecem os 6 itens lidos do PDF, com a soma conferida com o total.
O botão de iniciar só preenche a minuta com uma aba do Contratos.gov.br logada.

Sobre "new Function" em runner/subprocessoBg.js e siloms/subprocesso.js: é usado só nas páginas do SILOMS, no mundo da própria página, para disparar o código de clique (atributos onclick/href) dos botões do SILOMS, que é feito em GeneXus e não aceita cliques sintéticos. Nenhum código é baixado da internet e não há eval no contexto da extensão. A biblioteca lib/pdf.min.mjs é o PDF.js da Mozilla, sem alterações.
```

---

## Depois da aprovação

1. **Link:** o item ganha um ID e um link próprios. Anote os dois aqui e no cofre.
2. **Central de Ferramentas:** trocar o download do zip pelo link da loja no card `robo-empenhos` (`gapmn-app/src/lib/ferramentasCatalogo.ts`).
3. **Quem usa o zip ("sem compactação"):**
   - remover a extensão antiga antes de instalar pela loja, senão ficam duas;
   - no gapmn.app (Empenho Automático → **Extensão**), colar o **ID novo** e clicar em **Testar**.
4. **Firefox:** continua pelo zip temporário até enviar ao addons.mozilla.org.

## Cada versão nova

1. Suba a `version` no `manifest.json`.
2. `python -X utf8 loja/empacotar_loja.py`
3. No painel do item: **Pacote › Enviar novo pacote** com o zip → revisão (a versão anterior segue no ar até aprovar).

## Se a loja recusar

- **"Código remoto" (Blue Argon):** o motivo provável é o `new Function` do módulo do SILOMS. A correção é disparar os cliques pelo manipulador já compilado da página, em vez de compilar o texto do atributo; precisa ser testada no SILOMS real.
- **Permissões amplas:** se pedirem para reduzir `*.intraer` ou `*.fab.mil.br`, deixe só `*.siloms.intraer` (confirmar antes o endereço do SILOMS das outras unidades).
