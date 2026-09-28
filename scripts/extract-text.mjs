import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import MiniSearch from 'minisearch'
import { PDFParse } from 'pdf-parse'
import { documents } from '../src/data/documents.js'
import { searchIndexOptions, searchQueryOptions } from '../src/search-options.js'
import { lawCacheId } from './lib/alerj.mjs'
import { urlId } from './lib/ids.mjs'
import { publicationFromText } from './lib/publication.mjs'

const CACHE_DIR = '.cache/pdf-text'
const MAX_BYTES = 20 * 1024 * 1024 // não baixa arquivos maiores que 20MB (limite de tamanho, seção 12.1 do plano).
const FETCH_TIMEOUT_MS = 90_000
const MAX_TEXT_CHARS = 20_000 // mantém o índice pequeno o bastante para carregar rápido no navegador (meta do plano: poucos MB).
const CONCURRENCY = 5

async function fetchWithLimits(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const reader = response.body.getReader()
    const chunks = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_BYTES) { controller.abort(); throw new Error('Arquivo excede o limite de tamanho') }
      chunks.push(value)
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  } finally {
    clearTimeout(timeout)
  }
}

// Leis da ALERJ não têm PDF: o texto integral já foi lido por fetch-alerj.mjs e está no cache
// local dele (a base da ALERJ limita a taxa de requisições, então não se baixa de novo aqui).
async function alerjText(document) {
  const cachePath = path.join('.cache/alerj', `${lawCacheId(document.pdf)}.json`)
  if (!existsSync(cachePath)) return { id: document.id, pdf: document.pdf, text: '', pages: null, error: 'Texto não está no cache; rode npm run alerj:update' }
  const { text = '' } = JSON.parse(await readFile(cachePath, 'utf8'))
  return { id: document.id, pdf: document.pdf, text: text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS), pages: null, error: text ? null : 'Ficha sem texto' }
}

// PDFs digitalizados (imagem, sem camada de texto) passam por OCR quando pdftoppm (poppler) e
// tesseract estão instalados na máquina que roda a coleta; sem eles, ficam só com metadados.
const OCR_MAX_PAGES = 15
const hasCommand = (command) => { try { execFileSync('which', [command], { stdio: 'ignore' }); return true } catch { return false } }
const ocrAvailable = hasCommand('pdftoppm') && hasCommand('tesseract')
const ocrLanguage = ocrAvailable && execFileSync('tesseract', ['--list-langs'], { encoding: 'utf8' }).split('\n').includes('por') ? 'por' : 'eng'
const isTextless = (text) => text.replace(/-- \d+ of \d+ --/g, '').trim().length < 200

function ocr(buffer) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbmerj-ocr-'))
  try {
    const pdfPath = path.join(dir, 'doc.pdf')
    execFileSync('sh', ['-c', 'cat > "$1"', 'sh', pdfPath], { input: buffer })
    execFileSync('pdftoppm', ['-r', '200', '-l', String(OCR_MAX_PAGES), '-png', pdfPath, path.join(dir, 'page')])
    return readdirSync(dir).filter((file) => file.endsWith('.png')).sort()
      .map((file) => execFileSync('tesseract', [path.join(dir, file), '-', '-l', ocrLanguage], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
      .join('\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function extractOne(document) {
  if (document.format === 'html') return alerjText(document)
  const cachePath = path.join(CACHE_DIR, `${urlId(document.pdf)}.json`)
  if (existsSync(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, 'utf8'))
    // Só reaproveita sucessos do cache: falhas por timeout costumam ser transitórias
    // (servidor lento numa execução específica) e devem ser tentadas de novo na próxima corrida.
    if (cached.pdf === document.pdf && !cached.error && !(ocrAvailable && isTextless(cached.text) && !cached.ocr)) return cached
  }
  try {
    // Uma nova tentativa: o servidor do CBMERJ às vezes estoura o tempo numa requisição isolada.
    const buffer = await fetchWithLimits(document.pdf).catch(() => fetchWithLimits(document.pdf))
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    await parser.destroy()
    const ocrText = ocrAvailable && isTextless(result.text) ? ocr(buffer) : ''
    const text = (ocrText || result.text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS)
    const record = { id: document.id, pdf: document.pdf, text, pages: result.pages?.length ?? null, extractedAt: new Date().toISOString(), error: null, ...(ocrText ? { ocr: ocrLanguage } : {}) }
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(cachePath, JSON.stringify(record), 'utf8')
    return record
  } catch (error) {
    const record = { id: document.id, pdf: document.pdf, text: '', pages: null, extractedAt: new Date().toISOString(), error: String(error.message ?? error) }
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(cachePath, JSON.stringify(record), 'utf8')
    return record
  }
}

// Downloads e extração de texto são lentos e a fonte é um site de terceiros: processa em lotes
// limitados (não N downloads simultâneos descontrolados) e nunca deixa uma falha isolada
// interromper o restante da coleta (ver seção 12.2 do plano: falhas de OCR/coleta não podem
// travar a publicação dos demais documentos).
async function runPool(items, worker, concurrency) {
  const results = new Array(items.length)
  let cursor = 0
  async function next() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next))
  return results
}

let done = 0
const results = await runPool(documents, async (document) => {
  const record = await extractOne(document)
  done += 1
  if (done % 10 === 0 || done === documents.length) console.log(`Texto extraído: ${done}/${documents.length}`)
  return record
}, CONCURRENCY)

const succeeded = results.filter((record) => !record.error && record.text)
const failed = results.filter((record) => record.error)

const miniSearch = new MiniSearch({ ...searchIndexOptions, searchOptions: searchQueryOptions })
const byId = new Map(documents.map((document) => [document.id, document]))
miniSearch.addAll(documents.map((document) => {
  const extracted = results.find((record) => record.id === document.id)
  return { id: document.id, number: document.number, title: document.title, theme: document.theme, type: document.type, description: document.description, text: extracted?.text ?? '' }
}))

// Metadados extraídos do PDF que o catálogo aproveita (build-catalog.mjs lê este arquivo
// versionado): o boletim de publicação preenche o ano quando o título não o traz.
const pdfMetadata = {}
for (const record of results) {
  if (record.error || !record.text) continue
  const publication = publicationFromText(record.text)
  pdfMetadata[record.pdf] = { pages: record.pages, ...(publication ? { publication } : {}), ...(record.ocr ? { ocr: true } : {}), textless: isTextless(record.text) }
}
await mkdir('scripts/data', { recursive: true })
await writeFile('scripts/data/pdf-metadata.json', `${JSON.stringify(pdfMetadata, null, 2)}\n`, 'utf8')

await mkdir('public', { recursive: true })
await writeFile('public/search-index.json', JSON.stringify(miniSearch.toJSON()), 'utf8')

console.log(`Índice de busca gerado: ${succeeded.length} documentos com texto extraído, ${failed.length} falharam.`)
if (failed.length) {
  console.log('Falhas (mantidas pesquisáveis apenas por metadados):')
  for (const record of failed) console.log(` - ${byId.get(record.id)?.number || record.id}: ${record.error}`)
}
