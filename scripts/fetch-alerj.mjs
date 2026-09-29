import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { SEARCH_CAP, VIEWS, fetchLawLines, lawCacheId, parseDecree, parseLaw, refineLaw, searchLegislation } from './lib/alerj.mjs'

// Coleta, na base da ALERJ, as normas estaduais que citam o CBMERJ — leis, emendas e resoluções
// (visão "Legislação") e decretos (visão "Atos do Executivo") — e grava os metadados, com a
// situação oficial informada pela ALERJ, em scripts/data/alerj-laws.json, consumido por
// build-catalog.mjs. Todo resultado das consultas entra no acervo; "relevance" separa as normas
// cuja ementa trata do tema das que só o citam no texto (orçamento, estrutura do Executivo...).
// O texto integral fica só no cache local (.cache/alerj), de onde extract-text.mjs o lê.
const queries = ['CBMERJ', 'corpo de bombeiros', 'bombeiro militar', 'bombeiros militares', 'bombeiro-militar', 'incendio e panico', 'prevencao contra incendio', 'combate a incendio', 'guarda-vidas', 'salva-vidas', 'defesa civil', 'brigada de incendio', 'brigadista', 'FUNESBOM']
// Termos usados para particionar uma consulta que bateu no teto de 250 resultados:
// "q AND termo" + "q AND NOT termo" cobrem o mesmo conjunto que "q".
const splitTerms = ['militar', 'estadual', 'servidor', 'municipio', 'pensao', 'saude', 'educacao', 'orcamento', 'credito', 'policia', 'lei', 'decreto']
const relevant = /bombeir|cbmerj|inc[eê]ndio|p[aâ]nico|defesa civil|guarda-?vidas|salva-?vidas|brigad|funesbom|sedec/i
const CACHE_DIR = '.cache/alerj'
// O servidor da ALERJ limita a taxa (cerca de 2 requisições a cada poucos segundos; acima
// disso derruba a conexão): lê uma ficha por vez, com pausa entre elas e novas tentativas com
// espera crescente. Fichas já lidas ficam em cache e não são pedidas de novo.
const DELAY_MS = 2500
const RETRIES = 4
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const warnings = []

async function searchAll(query, view, depth = 0) {
  const rows = await searchLegislation(query, view)
  await sleep(DELAY_MS)
  if (rows.length < SEARCH_CAP) return rows
  const term = splitTerms[depth]
  if (!term) { warnings.push(`"${query}" ainda bate no teto de ${SEARCH_CAP} resultados; alguns podem faltar.`); return rows }
  return [...await searchAll(`${query} AND ${term}`, view, depth + 1), ...await searchAll(`${query} AND NOT ${term}`, view, depth + 1)]
}

// --offline: não consulta a ALERJ; relê do cache as normas já gravadas em alerj-laws.json.
// Serve para reaplicar uma correção do parser sem refazer os ~40 minutos de coleta.
const OFFLINE = process.argv.includes('--offline')
const found = new Map()
if (OFFLINE) for (const law of JSON.parse(await readFile('scripts/data/alerj-laws.json', 'utf8')).laws) found.set(law.url, law)
else for (const [viewName, view] of Object.entries(VIEWS)) {
  for (const query of queries) {
    const rows = await searchAll(query, view)
    for (const row of rows) found.set(row.url, { ...row, view: viewName })
    console.log(`ALERJ [${viewName}] "${query}": ${rows.length} resultados (${found.size} únicos até agora)`)
  }
}

const isDecree = (url) => /\/decest\.nsf\//i.test(url)

async function loadLaw(url) {
  const id = lawCacheId(url)
  const cachePath = path.join(CACHE_DIR, `${id}.json`)
  if (existsSync(cachePath)) return refineLaw(JSON.parse(await readFile(cachePath, 'utf8')))
  if (OFFLINE) throw new Error('fora do cache (rode sem --offline)')
  let lines
  for (let attempt = 0; ; attempt++) {
    try { lines = await fetchLawLines(url); break } catch (error) { if (attempt >= RETRIES) throw error; await sleep(DELAY_MS * 4 * (attempt + 1)) }
  }
  await sleep(DELAY_MS)
  const record = { ...(isDecree(url) ? parseDecree(lines) : parseLaw(lines)), url, fetchedAt: new Date().toISOString() }
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(cachePath, JSON.stringify(record), 'utf8')
  return refineLaw(record)
}

const rows = [...found.values()]
console.log(`${rows.length} normas únicas; lendo as fichas (as já lidas vêm do cache)...`)
const laws = []
const failures = []
for (const row of rows) {
  try {
    const law = await loadLaw(row.url)
    // A lista de resultados traz número, ano e ementa mesmo quando a ficha vem incompleta.
    laws.push({ ...law, number: law.number || row.number, year: law.year || row.year, ementa: law.ementa || row.ementa, author: law.author || row.author, published: row.published, view: row.view })
  } catch (error) { failures.push(`${row.url}: ${error.message}`) }
  if ((laws.length + failures.length) % 50 === 0) console.log(`Fichas lidas: ${laws.length + failures.length}/${rows.length}`)
}

const selected = laws.map(({ text, ...law }) => ({ ...law, relevance: relevant.test(`${law.ementa} ${law.subject} ${law.subSubject}`) ? 'tema' : 'mencao' }))
  .sort((a, b) => (a.year - b.year) || (Number(String(a.number).replace(/\D/g, '')) - Number(String(b.number).replace(/\D/g, ''))))

// Uma coleta que falhou em muitas fichas não substitui a anterior: melhor dados de uma semana
// atrás do que um acervo que perdeu metade das leis por instabilidade do servidor.
const previous = existsSync('scripts/data/alerj-laws.json') ? JSON.parse(await readFile('scripts/data/alerj-laws.json', 'utf8')).laws.length : 0
if (failures.length > rows.length * 0.2 && selected.length < previous) {
  console.error(`Falhas demais (${failures.length} de ${rows.length}); scripts/data/alerj-laws.json não foi alterado. Rode de novo: o que já foi lido está em cache.`)
  process.exit(1)
}

await mkdir('scripts/data', { recursive: true })
// Offline não é uma coleta nova: mantém a data da última consulta à ALERJ.
const collectedAt = OFFLINE ? JSON.parse(await readFile('scripts/data/alerj-laws.json', 'utf8')).collectedAt : new Date().toISOString().slice(0, 10)
await writeFile('scripts/data/alerj-laws.json', `${JSON.stringify({ collectedAt, laws: selected }, null, 2)}\n`, 'utf8')
const tally = (key) => selected.reduce((acc, law) => ({ ...acc, [law[key] || '(vazio)']: (acc[law[key] || '(vazio)'] || 0) + 1 }), {})
console.log(`ALERJ: ${selected.length} normas gravadas em scripts/data/alerj-laws.json.`)
console.log(tally('kind'), tally('relevance'), tally('situation'))
for (const warning of warnings) console.warn(`Aviso: ${warning}`)
if (failures.length) console.log(`Falhas (${failures.length}):\n${failures.join('\n')}`)
