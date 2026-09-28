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
npm run catalog:update
npm run search:update
npm run build
```

`alerj:update` consulta a base de legislação da ALERJ com termos ligados ao CBMERJ (corpo de bombeiros, bombeiro militar, incêndio e pânico, defesa civil, guarda-vidas...), mantém as leis ordinárias, complementares e emendas constitucionais cuja ementa trata do tema, lê a ficha técnica de cada uma (situação oficial, texto da revogação, autoria) e grava os metadados em `scripts/data/alerj-laws.json` (versionado). O servidor da ALERJ limita a taxa de requisições, por isso as fichas são lidas uma a uma, com pausa; o que já foi lido fica em `.cache/alerj/` e não é pedido de novo.

`catalog:update` raspa as páginas de Notas Técnicas, Instruções Normativas e Legislação/Regularização do site do CBMERJ e regera `src/data/documents.js`. `search:update` baixa o PDF de cada documento, extrai o texto (com `pdf-parse`) e gera `public/search-index.json`, o índice usado pela busca no navegador (MiniSearch). Rode `search:update` sempre que o catálogo mudar — o índice antigo continua funcionando, só fica desatualizado.

A base atual inclui notas técnicas, instruções normativas, leis estaduais, decretos, resoluções e notas administrativas publicadas pelo CBMERJ. Os metadados de situação jurídica são provisórios e não constituem declaração de vigência.

### Limitações conhecidas do acervo coletado

- **Cobertura de texto**: a extração baixa cada PDF da fonte oficial; downloads que expiram por timeout ou retornam 404 ficam sem texto indexado (permanecem pesquisáveis por título/número/tema). Rodar `npm run search:update` novamente tenta de novo apenas os que falharam — sucessos ficam em cache local (`.cache/`, não versionado).
- **Duplicatas entre páginas**: o mesmo ato pode estar publicado em mais de uma página oficial com nomes de arquivo diferentes (ex.: o Decreto-Lei 247/1975 aparece tanto em Notas Técnicas quanto em Legislação/Regularização). A deduplicação atual é por URL exata; não há comparação de conteúdo entre URLs distintas.
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
- Qualquer ingestão autenticada deve rodar em processo separado, em infraestrutura institucional, com segredo armazenado no gerenciador de segredos e revisão de autorização.
- Os documentos públicos atuais apontam para as URLs oficiais e não armazenam credenciais.
