import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { SEARCH_CAP, fetchLawLines, lawCacheId, parseLaw, searchLegislation } from './lib/alerj.mjs'

// Coleta leis estaduais relacionadas ao CBMERJ na base de legislação da ALERJ e grava os
// metadados (incluindo a situação oficial informada pela ALERJ) em scripts/data/alerj-laws.json,
// consumido por build-catalog.mjs. O texto integral fica só no cache local (.cache/alerj),
// de onde extract-text.mjs o lê para o índice de busca.
const queries = ['corpo de bombeiros', 'bombeiro militar', 'bombeiros militares', 'CBMERJ', 'incendio e panico', 'prevencao contra incendio', 'combate a incendio', 'guarda-vidas', 'salva-vidas', 'defesa civil', 'brigada de incendio', 'brigadista']
// Termos usados para particionar uma consulta que bateu no teto de 250 resultados:
// "q AND termo" + "q AND NOT termo" cobrem o mesmo conjunto que "q".
const splitTerms = ['militar', 'estadual', 'servidor', 'municipio', 'pensao', 'saude', 'educacao']
// Só entram leis cuja ementa ou assunto indexado trata do tema; a busca full-text também
// casa leis que citam o Corpo de Bombeiros só de passagem (orçamento, listas de órgãos...).
const relevant = /bombeir|cbmerj|inc[eê]ndio|p[aâ]nico|defesa civil|guarda-?vidas|salva-?vidas|brigad/i
const notNormative = /declara de utilidade p[uú]blica/i
const keptKinds = /^(Lei Ordinária|Lei Complementar|Emenda Constitucional)$/i
const CACHE_DIR = '.cache/alerj'
// O servidor da ALERJ limita a taxa (cerca de 2 requisições a cada poucos segundos; acima
// disso derruba a conexão): lê uma ficha por vez, com pausa entre elas e novas tentativas com
// espera crescente. Fichas já lidas ficam em cache e não são pedidas de novo.
const DELAY_MS = 2500
const RETRIES = 4
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function searchAll(query, depth = 0) {
  const rows = await searchLegislation(query)
  if (rows.length < SEARCH_CAP) return rows
  const term = splitTerms[depth]
  if (!term) { console.warn(`Aviso: "${query}" ainda bate no teto de ${SEARCH_CAP} resultados; alguns podem faltar.`); return rows }
  return [...await searchAll(`${query} AND ${term}`, depth + 1), ...await searchAll(`${query} AND NOT ${term}`, depth + 1)]
}

const found = new Map()
for (const query of queries) {
  const rows = await searchAll(query)
  for (const row of rows) found.set(row.url, row)
  console.log(`ALERJ "${query}": ${rows.length} resultados (${found.size} únicos até agora)`)
}

async function loadLaw(url) {
  const id = lawCacheId(url)
  const cachePath = path.join(CACHE_DIR, `${id}.json`)
  if (existsSync(cachePath)) return JSON.parse(await readFile(cachePath, 'utf8'))
  let lines
  for (let attempt = 0; ; attempt++) {
    try { lines = await fetchLawLines(url); break } catch (error) { if (attempt >= RETRIES) throw error; await sleep(DELAY_MS * 4 * (attempt + 1)) }
  }
  await sleep(DELAY_MS)
  const record = { ...parseLaw(lines), url, fetchedAt: new Date().toISOString() }
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(cachePath, JSON.stringify(record), 'utf8')
  return record
}

// A ementa já vem na lista de resultados: só baixa a ficha (lenta, por causa do limite de
// taxa) das normas cuja ementa indica relação com o tema. Perde-se apenas o que é relevante
// só pelo campo "Assunto" da ficha, sem nenhuma menção na ementa.
const urls = [...found.values()].filter((row) => relevant.test(row.ementa) && !notNormative.test(row.ementa)).map((row) => row.url)
console.log(`${urls.length} de ${found.size} resultados têm ementa relacionada; lendo as fichas...`)
const laws = []
const failures = []
for (const url of urls) {
  try { laws.push(await loadLaw(url)) } catch (error) { failures.push(`${url}: ${error.message}`) }
  if ((laws.length + failures.length) % 50 === 0) console.log(`Fichas lidas: ${laws.length + failures.length}/${urls.length}`)
}

const selected = laws.map(({ text, ...law }) => law)
  .filter((law) => keptKinds.test(law.kind))
  .filter((law) => relevant.test(`${law.ementa} ${law.subject} ${law.subSubject}`) && !notNormative.test(law.ementa))
  .sort((a, b) => (a.year - b.year) || (Number(a.number.replace(/\D/g, '')) - Number(b.number.replace(/\D/g, ''))))

await mkdir('scripts/data', { recursive: true })
await writeFile('scripts/data/alerj-laws.json', `${JSON.stringify({ collectedAt: new Date().toISOString().slice(0, 10), laws: selected }, null, 2)}\n`, 'utf8')
const bySituation = selected.reduce((acc, law) => ({ ...acc, [law.situation || '(vazio)']: (acc[law.situation || '(vazio)'] || 0) + 1 }), {})
console.log(`Leis ALERJ: ${laws.length} fichas lidas, ${selected.length} relevantes gravadas em scripts/data/alerj-laws.json.`)
console.log(bySituation)
if (failures.length) console.log(`Falhas (${failures.length}):\n${failures.join('\n')}`)
