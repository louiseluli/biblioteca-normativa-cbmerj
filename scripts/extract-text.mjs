import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import MiniSearch from 'minisearch'
import { PDFParse } from 'pdf-parse'
import { documents } from '../src/data/documents.js'
import { searchIndexOptions, searchQueryOptions } from '../src/search-options.js'
import { lawCacheId } from './lib/alerj.mjs'

const CACHE_DIR = '.cache/pdf-text'
const MAX_BYTES = 20 * 1024 * 1024 // não baixa arquivos maiores que 20MB (limite de tamanho, seção 12.1 do plano).
const FETCH_TIMEOUT_MS = 40_000
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

async function extractOne(document) {
  if (document.format === 'html') return alerjText(document)
  const cachePath = path.join(CACHE_DIR, `${document.id}.json`)
  if (existsSync(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, 'utf8'))
    // Só reaproveita sucessos do cache: falhas por timeout costumam ser transitórias
    // (servidor lento numa execução específica) e devem ser tentadas de novo na próxima corrida.
    if (cached.pdf === document.pdf && !cached.error) return cached
  }
  try {
    const buffer = await fetchWithLimits(document.pdf)
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    await parser.destroy()
    const text = result.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS)
    const record = { id: document.id, pdf: document.pdf, text, pages: result.pages?.length ?? null, extractedAt: new Date().toISOString(), error: null }
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

await mkdir('public', { recursive: true })
await writeFile('public/search-index.json', JSON.stringify(miniSearch.toJSON()), 'utf8')

console.log(`Índice de busca gerado: ${succeeded.length} documentos com texto extraído, ${failed.length} falharam.`)
if (failed.length) {
  console.log('Falhas (mantidas pesquisáveis apenas por metadados):')
  for (const record of failed) console.log(` - ${byId.get(record.id)?.number || record.id}: ${record.error}`)
}
