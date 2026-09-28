import { createHash } from 'node:crypto'

// Identificador estável derivado da URL do documento. Correções curatoriais, o cache de texto
// e o Livro de Ordens referenciam registros pelo id, que precisa sobreviver a uma nova coleta
// (a posição do link na página oficial muda sempre que o CBMERJ publica algo novo).
export const urlId = (url) => createHash('sha1').update(url).digest('hex').slice(0, 10)
