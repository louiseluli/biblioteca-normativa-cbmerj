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

## Publicação

O projeto foi preparado para hospedagem estática. O build de produção é gerado em `dist/` e não deve ser versionado.

## Segurança

- Nunca coloque usuário, senha, token, cookie de sessão ou arquivo `.env` no repositório.
- O frontend público deve consumir somente documentos e metadados autorizados para divulgação.
- A intranet do CBMERJ não deve ser automatizada pelo navegador público.
- **Coleta local da Intranet** (`npm run intranet:fetch`): roda só na sua máquina e grava em `intranet-acervo/`, que não é versionado, com `manifesto.json` (origem, data, SHA-256) e `indice.csv` para a curadoria. Só leitura, uma requisição por vez; links de sair/logout são ignorados. Opções:
  - sem opções: painel de downloads (Legislações, Corregedorias, Chefia de Gabinete, Chefia do Estado-Maior Geral), sem boletins;
  - `-- --boletins [--anos 2020-2026]`: Boletins da SEDEC/CBMERJ e do BM/1, percorrendo anos → edições → PDFs;
  - `-- --listar`: mostra o que seria baixado, sem baixar.

  **Login, sem vazar credenciais:** por padrão o Chrome abre e você faz o login na própria tela do site; o script nunca vê a senha. Com `-- --keychain`, usuário e senha vêm do Chaves (Keychain) do macOS, criptografado e protegido pela sua senha do Mac, e o script preenche o formulário sozinho. Cadastre uma vez com `security add-generic-password -s cbmerj-intranet -a SEU_USUARIO -w` (o macOS pede a senha sem mostrá-la nem gravá-la no histórico). Em nenhum modo a senha ou a sessão vai para arquivo, log, repositório ou GitHub: os cookies vivem só na memória do navegador, que fecha ao final. Se o login automático encontrar captcha, verificação em duas etapas ou uma tela diferente, ele para e pede o modo manual. O script se recusa a rodar com `DEBUG` do Playwright ligado, porque esse log mostraria o que foi digitado.

  **Coleta diária automática:** `npm run intranet:agendar` registra no `launchd` do macOS uma coleta todo dia às 07:00, no modo `--keychain` (boletins do ano corrente e do anterior e o painel), com log em `intranet-acervo/coleta.log`. Ela roda enquanto sua sessão do Mac estiver aberta e o Mac tiver acesso à Intranet. `npm run intranet:agendar -- --remover` desfaz.

  Para publicar um documento da Intranet, confirme que ele pode ser divulgado, copie o arquivo para `public/acervo/` e cadastre-o em `data/documentos-manuais.csv`; links da Intranet nas planilhas são recusados pelo build.
- Qualquer ingestão autenticada deve rodar em processo separado, em infraestrutura institucional, com segredo armazenado no gerenciador de segredos e revisão de autorização.
- Os documentos públicos atuais apontam para as URLs oficiais e não armazenam credenciais.
