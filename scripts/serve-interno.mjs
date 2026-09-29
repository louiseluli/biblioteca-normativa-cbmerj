import http from 'node:http'
import { createReadStream, existsSync, readFile, readFileSync, statSync } from 'node:fs'
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
const db = new DatabaseSync(path.join(ACERVO, 'acervo-interno.db'))
db.exec(`CREATE TABLE IF NOT EXISTS curadoria (id TEXT PRIMARY KEY, target_id TEXT, fields TEXT NOT NULL, justification TEXT NOT NULL, created_at TEXT NOT NULL)`)
const bulletinFile = db.prepare('SELECT arquivo FROM boletim WHERE id = ?')
const listCuration = db.prepare('SELECT id, target_id, fields, justification, created_at FROM curadoria ORDER BY created_at DESC LIMIT ?')
const insertCuration = db.prepare('INSERT INTO curadoria (id, target_id, fields, justification, created_at) VALUES (?, ?, ?, ?, ?)')
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

async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 100_000) throw new Error('Payload muito grande')
  }
  return JSON.parse(body)
}

function curationEntries() {
  return listCuration.all(1000).map((entry) => ({ ...entry, fields: JSON.parse(entry.fields) }))
}

function applyCuration(data) {
  const items = data.items.map((item) => ({ ...item }))
  const byId = new Map(items.map((item) => [item.id, item]))
  for (const entry of curationEntries().reverse()) {
    const fields = entry.fields
    const target = entry.target_id && byId.get(entry.target_id)
    if (target) {
      Object.assign(target, { ...(fields.subject ? { s: fields.subject } : {}), ...(fields.act ? { a: fields.act } : {}), ...(fields.bulletin ? { b: fields.bulletin } : {}), ...(fields.bulletinDate ? { bd: fields.bulletinDate, y: Number(fields.bulletinDate.slice(0, 4)) } : {}), ...(fields.page ? { p: Number(fields.page) } : {}), ...(fields.note ? { note: fields.note } : {}) })
    } else if (!entry.target_id) {
      items.push({ id: entry.id, n: null, p: fields.page ? Number(fields.page) : null, s: fields.subject, t: null, a: fields.act || null, o: null, d: null, b: fields.bulletin || null, bd: fields.bulletinDate || null, y: fields.bulletinDate ? Number(fields.bulletinDate.slice(0, 4)) : null, src: 'curadoria', note: fields.note || null })
    }
  }
  return { ...data, items }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`)
  if (request.method !== 'GET' && !(request.method === 'POST' && url.pathname === '/interno/api/curadoria')) { response.writeHead(405).end(); return }
  // O livro completo substitui o público.
  if (url.pathname === '/livro-de-ordens.json') {
    const data = JSON.parse(readFileSync(path.join(ACERVO, 'livro-de-ordens-completo.json'), 'utf8'))
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(applyCuration(data)))
    return
  }
  if (url.pathname === '/interno/api/curadoria' && request.method === 'GET') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(curationEntries()))
    return
  }
  if (url.pathname === '/interno/api/curadoria' && request.method === 'POST') {
    try {
      const body = await readJson(request)
      const fields = body.fields && typeof body.fields === 'object' ? body.fields : {}
      if (!String(fields.subject ?? '').trim() || !String(body.justification ?? '').trim()) throw new Error('Assunto e justificativa são obrigatórios')
      if (fields.bulletinDate && !/^\d{4}-\d{2}-\d{2}$/.test(fields.bulletinDate)) throw new Error('Data deve estar no formato AAAA-MM-DD')
      const id = `curadoria-${Date.now().toString(36)}`
      insertCuration.run(id, String(body.targetId ?? '').trim() || null, JSON.stringify(fields), String(body.justification).trim(), new Date().toISOString())
      response.writeHead(201, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify({ id }))
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: error.message }))
    }
    return
  }
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
