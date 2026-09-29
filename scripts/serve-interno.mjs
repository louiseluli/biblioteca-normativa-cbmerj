import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Site em modo interno, só nesta máquina (127.0.0.1): o mesmo site público (dist/), com o Livro
// de Ordens completo (livro 2002–2019 + acervo + Boletins da SEDEC/CBMERJ baixados da Intranet),
// os PDFs dos boletins abertos na página certa e a busca no texto integral dos boletins.
// Nada daqui é publicado: o servidor não aceita conexões de outras máquinas.
//
// Uso: npm run interno   (gera o livro completo, compila o site e abre http://127.0.0.1:4310)
const PORT = Number(process.env.PORT) || 4310
const DIST = path.resolve('dist')
const ACERVO = path.resolve('intranet-acervo')
const db = new DatabaseSync(path.join(ACERVO, 'acervo-interno.db'), { readOnly: true })
const bulletinFile = db.prepare('SELECT arquivo FROM boletim WHERE id = ?')
// Busca no texto das páginas (FTS5, sem acentos). Cada termo vira prefixo entre aspas, para que a
// consulta nunca seja interpretada como sintaxe do FTS.
const searchPages = db.prepare(`
  SELECT pagina_fts.boletim_id AS bol, pagina_fts.pagina AS p, boletim.numero AS b, boletim.data AS bd, boletim.unidade AS unidade,
         snippet(pagina_fts, 0, '[[', ']]', ' … ', 18) AS trecho
  FROM pagina_fts JOIN boletim ON boletim.id = pagina_fts.boletim_id
  WHERE pagina_fts MATCH ? ORDER BY rank LIMIT ?`)
const countPages = db.prepare('SELECT COUNT(*) AS total FROM pagina_fts WHERE pagina_fts MATCH ?')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

function sendFile(response, file, type) {
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store' })
  createReadStream(file).pipe(response)
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`)
  if (request.method !== 'GET') { response.writeHead(405).end(); return }
  // O livro completo substitui o público.
  if (url.pathname === '/livro-de-ordens.json') return sendFile(response, path.join(ACERVO, 'livro-de-ordens-completo.json'), 'application/json')
  // PDF de um boletim, pelo id do banco (nunca por caminho vindo da URL).
  const pdf = url.pathname.match(/^\/interno\/boletim\/([0-9a-f]{16})$/)
  if (pdf) {
    const row = bulletinFile.get(pdf[1])
    if (!row || !existsSync(row.arquivo)) { response.writeHead(404).end('Boletim não encontrado'); return }
    response.setHeader('Content-Disposition', 'inline')
    return sendFile(response, row.arquivo, 'application/pdf')
  }
  if (url.pathname === '/interno/busca') {
    const terms = (url.searchParams.get('q') ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) ?? []
    const query = terms.map((term) => `"${term}"*`).join(' ')
    const limit = Math.min(Number(url.searchParams.get('limite')) || 50, 200)
    const body = query ? { total: countPages.get(query).total, resultados: searchPages.all(query, limit) } : { total: 0, resultados: [] }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(body))
    return
  }
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
  const file = path.resolve(DIST, relative)
  if (!file.startsWith(DIST + path.sep) || !existsSync(file) || statSync(file).isDirectory()) { response.writeHead(404).end('Não encontrado'); return }
  sendFile(response, file, types[path.extname(file)] ?? 'application/octet-stream')
})

server.listen(PORT, '127.0.0.1', () => console.log(`Biblioteca Normativa, modo interno: http://127.0.0.1:${PORT}/#livro (só nesta máquina; Ctrl+C para encerrar)`))
