// Compartilhado entre scripts/extract-text.mjs (gera o índice) e src/main.js (carrega e
// consulta o índice no navegador). As duas pontas precisam usar exatamente as mesmas opções
// de campos/tokenização, senão MiniSearch.loadJSON não consegue reconstruir o índice.
const stripAccents = (term) => term.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const searchIndexOptions = {
  idField: 'id',
  fields: ['number', 'title', 'theme', 'type', 'description', 'text'],
  storeFields: [],
  processTerm: stripAccents,
}

// combineWith 'AND': por padrão a busca exige todos os termos, não qualquer um deles
// (ver seção 8.1 do plano — "qualquer termo" fica reservado para uma busca avançada futura).
export const searchQueryOptions = { prefix: true, fuzzy: 0.2, boost: { number: 4, title: 2 }, combineWith: 'AND' }
