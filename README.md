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
npm run catalog:update
npm run build
```

A base atual inclui notas técnicas, instruções normativas e documentos relacionados publicados pelo CBMERJ. Os metadados de situação jurídica são provisórios e não constituem declaração de vigência.

## Publicação

O projeto foi preparado para hospedagem estática. O build de produção é gerado em `dist/` e não deve ser versionado.

## Segurança

- Nunca coloque usuário, senha, token, cookie de sessão ou arquivo `.env` no repositório.
- O frontend público deve consumir somente documentos e metadados autorizados para divulgação.
- A intranet do CBMERJ não deve ser automatizada pelo navegador público.
- Qualquer ingestão autenticada deve rodar em processo separado, em infraestrutura institucional, com segredo armazenado no gerenciador de segredos e revisão de autorização.
- Os documentos públicos atuais apontam para as URLs oficiais e não armazenam credenciais.
