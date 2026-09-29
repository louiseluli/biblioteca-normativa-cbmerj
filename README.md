# Biblioteca Normativa CBMERJ

MVP estático para pesquisa e consulta de normas do Corpo de Bombeiros Militar do Estado do Rio de Janeiro.

## Executar localmente

```bash
npm install
npm run dev
```

## Atualizar o catálogo

O catálogo público é regenerado a partir das páginas oficiais configuradas no coletor:

```bash
npm run alerj:update    # leis estaduais da ALERJ (lento: ~40 min na primeira vez, depois usa cache)
npm run data:update     # catálogo → texto dos PDFs → catálogo de novo (usa o boletim lido no PDF) → Livro de Ordens
npm run build
```

Toda segunda-feira o workflow `Update data` (`.github/workflows/update-data.yml`) roda essa sequência no GitHub Actions e abre um pull request com o que mudou; o site só é atualizado quando a curadoria faz o merge. Ele também pode ser disparado manualmente na aba Actions.

`alerj:update` consulta a base de legislação da ALERJ com termos ligados ao CBMERJ (corpo de bombeiros, bombeiro militar, incêndio e pânico, defesa civil, guarda-vidas...), mantém as leis ordinárias, complementares e emendas constitucionais cuja ementa trata do tema, lê a ficha técnica de cada uma (situação oficial, texto da revogação, autoria) e grava os metadados em `scripts/data/alerj-laws.json` (versionado). O servidor da ALERJ limita a taxa de requisições, por isso as fichas são lidas uma a uma, com pausa; o que já foi lido fica em `.cache/alerj/` e não é pedido de novo.

`catalog:update` raspa as páginas de Notas Técnicas, Instruções Normativas e Legislação/Regularização do site do CBMERJ e regera `src/data/documents.js`. `search:update` baixa o PDF de cada documento, extrai o texto (com `pdf-parse`) e gera `public/search-index.json`, o índice usado pela busca no navegador (MiniSearch). Rode `search:update` sempre que o catálogo mudar — o índice antigo continua funcionando, só fica desatualizado.

`search:update` também grava `scripts/data/pdf-metadata.json` com o boletim de publicação lido no cabeçalho do PDF ("Publicado no Boletim da SEDEC/CBMERJ nº 059, de 31 de março de 2022"); o catálogo usa esse dado para preencher o ano de atos cujo título não o traz (caso das ICGs). PDFs digitalizados, sem camada de texto, passam por OCR quando `pdftoppm` (poppler) e `tesseract` estão instalados — de preferência com o idioma `por` (`brew install tesseract-lang` no macOS).

### Curadoria: cadastro manual e correções em lote

CSV é o formato de troca e revisão em lote, não o banco operacional: ele é simples de versionar, mas não oferece histórico transacional, validação concorrente ou relações. No modo interno, as alterações do Livro de Ordens são gravadas de forma append-only em `intranet-acervo/acervo-interno.db`, na tabela `curadoria`; a extração original não é sobrescrita.

As planilhas em `data/` são a parte do banco mantida por pessoas. Podem ser editadas no Excel ou no Google Planilhas (exportando como CSV, com `;` ou `,`) e são reaplicadas a cada geração, então não se perdem numa nova coleta. Uma linha inválida interrompe a geração com a mensagem do erro, em vez de publicar dado errado.

- `data/documentos-manuais.csv` — um documento por linha, para cadastrar em lote o que não está em nenhuma página coletada. Colunas: `tipo;numero;titulo;ano;data_publicacao;boletim;situacao;fonte_situacao;tema;url_pdf;url_fonte;descricao`. Obrigatórios: `tipo`, `titulo` e `url_pdf` (ou `url_fonte`). `url_pdf` pode ser uma URL oficial ou um arquivo copiado para `public/acervo/` (ex.: `acervo/portaria-1234.pdf`). Qualquer `situacao` diferente de "Não verificada" exige `fonte_situacao`.
- `data/correcoes.csv` — corrige um campo de um registro coletado: `id;campo;valor;justificativa`. O `id` aparece em `src/data/documents.js` e é estável (derivado da URL do PDF). Campos corrigíveis: `tipo`, `numero`, `titulo`, `ano`, `tema`, `situacao`, `fonte_situacao`, `descricao`, `edicao`, `boletim`, `data_publicacao`. A justificativa é exibida como fonte da informação.
- `data/livro-de-ordens-manual.csv` — itens do Livro de Ordens: `item;assunto;ato;boletim;data_boletim;url;observacao`. Com o número de um item existente, corrige esse item; sem número, acrescenta um item novo (exige `assunto`, `boletim` e `data_boletim`). `url` torna o item clicável.

### Livro de Ordens

`livro:update` gera `public/livro-de-ordens.json`, carregado pela seção "Livro de Ordens" do site, a partir de:

1. o Livro de Ordens 2002–2019 (PDF de 570 páginas, 7.576 itens). O PDF fica fora do repositório (que é público): coloque `LIVRO-DE-ORDENS-2002-a-2019.pdf` na raiz para regenerar a extração, versionada em `scripts/data/livro-de-ordens-2002-2019.json`;
2. os documentos do acervo com boletim de publicação identificado — a continuação do livro depois de 2019;
3. `data/livro-de-ordens-manual.csv`.

Cada item é ligado ao documento do acervo quando o ato citado (nota por órgão/número/ano, portaria, decreto, lei, resolução, ICG, NT) está no catálogo: aí o item abre o documento. Quando não está, o site mostra onde consultá-lo — boletim, data, página do livro original, e o acesso à Intranet do CBMERJ (restrito) ou a busca na ALERJ, para leis. Itens que o livro original deixou incompletos (sem assunto, sem boletim ou sem ato identificável) vão para `data/livro-de-ordens-pendencias.csv`.

A base atual inclui notas técnicas, instruções normativas, leis estaduais, decretos, resoluções e notas administrativas publicadas pelo CBMERJ. Os metadados de situação jurídica são provisórios e não constituem declaração de vigência.

### Limitações conhecidas do acervo coletado

- **Cobertura de texto**: a extração baixa cada PDF da fonte oficial; downloads que expiram por timeout ou retornam 404 ficam sem texto indexado (permanecem pesquisáveis por título/número/tema). Rodar `npm run search:update` novamente tenta de novo apenas os que falharam — sucessos ficam em cache local (`.cache/`, não versionado).
- **Duplicatas entre páginas**: o mesmo ato pode estar publicado em mais de uma página oficial com nomes de arquivo diferentes (ex.: o Decreto-Lei 247/1975 aparece tanto em Notas Técnicas quanto em Legislação/Regularização). A deduplicação atual é por URL exata; não há comparação de conteúdo entre URLs distintas.
- **Ligação livro ↔ acervo é por número do ato**: um item que cita um ato só de passagem (ex.: "altera o Decreto 897") é ligado a esse ato; a ligação indica o ato citado, não necessariamente o documento publicado naquele boletim.
- **Tema é a página de origem, não uma taxonomia curada**: os únicos valores hoje são "Notas Técnicas", "Instruções Normativas" e "Legislação e regularização". Uma classificação temática mais fina (Regularização, extintores, eventos etc., como descrito no plano de implementação) exige curadoria manual.
- **Situação jurídica**: só é preenchida quando uma fonte oficial a informa, e cada registro guarda essa fonte em `statusSource`:
  - Leis estaduais: situação da ficha técnica da ALERJ ("Em Vigor", "Revogada"...). Leis que também estão na página do CBMERJ recebem essa situação e o link para o texto na ALERJ.
  - Notas técnicas e ICGs: "Em vigor" quando listadas como versão atual na página oficial do CBMERJ; "Histórica" quando a página as marca como versão anterior ou revogada.
  - Decretos, resoluções, portarias e notas administrativas continuam "Não verificada": nenhuma fonte consultada informa sua vigência.
- **Leis ALERJ relevantes só pela ficha**: a seleção usa a ementa (que vem na lista de resultados); uma lei cuja relação com o CBMERJ apareça só no campo "Assunto" da ficha não entra.
- **PDFs não são preservados localmente**: o catálogo aponta direto para as URLs do CBMERJ. Se um arquivo for movido, renomeado ou tirado do ar na fonte, o link quebra sem aviso no acervo.

### Acervo interno dos boletins (só na máquina local)

Os boletins baixados da Intranet viram um banco local e uma versão interna do site, sem nada ir para o site público:

```bash
npm run boletins:processar   # organiza os PDFs e atualiza o banco (incremental: só o que é novo)
npm run interno              # processa, junta ao Livro de Ordens e abre http://127.0.0.1:4310/#livro
```

- **Arquivos:** `intranet-acervo/organizado/<boletim>/<ano>/<AAAA-MM-DD>-BOL<nº>.pdf` (links físicos para os PDFs baixados, sem ocupar espaço extra). `-- --acervo /Volumes/DISCO/intranet-acervo` inclui uma pasta de outro disco.
- **Banco:** `intranet-acervo/acervo-interno.db` (SQLite embutido no Node, sem instalação), com três tabelas: `boletim` (unidade, número, tipo, data, páginas, arquivo, SHA-256), `item` (cada entrada do sumário: parte, seção, assunto, página, ato, nota que o publicou e **categoria**) e `pagina` (texto de cada página, com busca de texto integral sem acentos em `pagina_fts`).
- **Nenhuma entrada do sumário é descartada:** cada uma recebe uma categoria (Item, Anexo, Serviços diários, Abertura, Sem alteração, Título de parte/seção/subseção), filtrável na interface.
- **Livro de Ordens interno:** `build-livro.mjs --interno` junta as entradas dos boletins ao livro 2002–2019 e ao acervo, liga cada uma ao documento do acervo pelo ato e, quando um item do livro original é o mesmo de uma entrada de boletim, liga o item ao PDF em vez de duplicar. O resultado fica em `intranet-acervo/livro-de-ordens-completo.json`.
- **Site interno** (`scripts/serve-interno.mjs`): o site normal, com o livro completo, filtros por fonte, categoria e parte do boletim, links que abrem o PDF do boletim na página do item, e busca no texto integral dos boletins. Escuta só em `127.0.0.1`: outras máquinas não conseguem acessar.
- **Painel de curadoria**: em `http://127.0.0.1:4310/curadoria.html`, permite adicionar item ou corrigir assunto, ato, boletim, data, página e observação. Toda gravação exige justificativa e fica registrada com data; o painel não está disponível no GitHub Pages.

## Publicação

O projeto foi preparado para hospedagem estática. O build de produção é gerado em `dist/` e não deve ser versionado.

O MVP versiona um pacote pequeno de PDFs públicos oficiais em `public/acervo/`, para que a demonstração continue funcionando mesmo sem acesso externo. A lista está em `scripts/data/mvp-files.json`; para baixar ou conferir o pacote, rode `npm run mvp:pdfs`. PDFs da Intranet e boletins internos continuam fora do GitHub.

## Segurança

- Nunca coloque usuário, senha, token, cookie de sessão ou arquivo `.env` no repositório.
- O frontend público deve consumir somente documentos e metadados autorizados para divulgação.
- A intranet do CBMERJ não deve ser automatizada pelo navegador público.
- **Coleta local da Intranet** (`npm run intranet:fetch`): roda só na sua máquina e grava em `intranet-acervo/`, que não é versionado, com `manifesto.json` (origem, data, SHA-256) e `indice.csv` para a curadoria. Só leitura, uma requisição por vez; links de sair/logout são ignorados. Opções:
  - sem opções: painel de downloads (Legislações, Corregedorias, Chefia de Gabinete, Chefia do Estado-Maior Geral), sem boletins;
  - `-- --boletins [--anos 2020-2026]`: Boletins da SEDEC/CBMERJ e do BM/1, percorrendo anos → edições → PDFs;
  - `-- --tudo`: boletins e painel com um único login;
  - `-- --limite 200`: baixa em lotes (no máximo 200 arquivos por execução; a próxima continua de onde parou);
  - `-- --destino /Volumes/DISCO/intranet-acervo`: grava em outra pasta, por exemplo um disco externo (os boletins de 1982 a 2026 somam cerca de 47 GB);
  - `-- --listar`: mostra o que seria baixado, sem baixar.

  **Login, sem vazar credenciais:** por padrão o Chrome abre e você faz o login na própria tela do site. O script nunca lê o que é digitado; ele só observa o endereço da página para perceber que você entrou, e então começa a coleta. O Chrome aberto pelo script usa um perfil temporário, apagado ao fechar, então nem uma senha salva pelo navegador sobrevive. A Intranet usa reCAPTCHA no login, que o script não tenta resolver: na prática, o login é sempre feito por você. Com `-- --keychain`, usuário e senha vêm do Chaves (Keychain) do macOS, criptografado e protegido pela sua senha do Mac, e o script preenche o formulário sozinho. Cadastre uma vez com `security add-generic-password -s cbmerj-intranet -a SEU_USUARIO -w` (o macOS pede a senha sem mostrá-la nem gravá-la no histórico). Em nenhum modo a senha ou a sessão vai para arquivo, log, repositório ou GitHub: os cookies vivem só na memória do navegador. Se o login automático encontrar captcha, verificação em duas etapas ou uma tela diferente, ele para e pede o modo manual. O script se recusa a rodar com `DEBUG` do Playwright ligado, porque esse log mostraria o que foi digitado. Os documentos baixados ficam no disco: mantenha o FileVault ligado e a pasta do projeto fora do iCloud Drive.

  **Atualização automática:**
  - `npm run intranet:agendar -- --assistido`: todo dia às 07:00, abre a janela da Intranet e mostra uma notificação; você faz o login e a coleta incremental (boletins do ano corrente e do anterior, e o painel) segue sozinha. Nenhuma senha é guardada. Sem login em 15 minutos, não coleta nada e tenta de novo no dia seguinte.
  - `npm run intranet:agendar`: igual, mas com o login pelo Chaves do macOS, sem ninguém presente.
  - `npm run intranet:agendar -- --remover` desfaz. O log fica em `intranet-acervo/coleta.log`. A coleta roda enquanto sua sessão do Mac estiver aberta e o Mac tiver acesso à Intranet.

  Para publicar um documento da Intranet, confirme que ele pode ser divulgado, copie o arquivo para `public/acervo/` e cadastre-o em `data/documentos-manuais.csv`; links da Intranet nas planilhas são recusados pelo build.
- Qualquer ingestão autenticada deve rodar em processo separado, em infraestrutura institucional, com segredo armazenado no gerenciador de segredos e revisão de autorização.
- Os documentos públicos atuais apontam para as URLs oficiais e não armazenam credenciais.
