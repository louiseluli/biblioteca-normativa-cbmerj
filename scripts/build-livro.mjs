import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { PDFParse } from 'pdf-parse'
import { documents } from '../src/data/documents.js'
import { parseCsv } from './lib/csv.mjs'
import { parseAct, parseLivro } from './lib/livro.mjs'

// Livro de Ordens "vivo": o índice de publicações em Boletim da SEDEC/CBMERJ montado a partir de
// três fontes, reaplicadas a cada execução:
// 1. o Livro de Ordens 2002–2019 (PDF). O PDF não é versionado (repositório público); o que
//    se versiona é a extração dele, scripts/data/livro-de-ordens-2002-2019.json, regenerada
//    quando o PDF está presente na raiz do projeto;
// 2. os documentos do acervo cujo boletim de publicação foi identificado (cabeçalho do PDF,
//    cadastro manual ou correção curatorial) — é assim que o livro continua depois de 2019;
// 3. data/livro-de-ordens-manual.csv, para a curadoria acrescentar itens novos em lote ou
//    corrigir um item do livro original (pelo número do item).
// Cada item aponta para o documento do acervo quando ele existe; quando não, informa onde o
// ato está publicado (boletim, data e página do livro original).
const LIVRO_PDF = 'LIVRO-DE-ORDENS-2002-a-2019.pdf'
const BASE_PATH = 'scripts/data/livro-de-ordens-2002-2019.json'
const LIVRO_SOURCE = 'Livro de Ordens 2002–2019 (índice do Boletim da SEDEC/CBMERJ)'

async function loadBase() {
  if (!existsSync(LIVRO_PDF)) {
    if (!existsSync(BASE_PATH)) throw new Error(`Nem ${LIVRO_PDF} nem ${BASE_PATH} existem.`)
    return JSON.parse(await readFile(BASE_PATH, 'utf8'))
  }
  const cachePath = '.cache/livro-de-ordens.txt'
  const stamp = `${statSync(LIVRO_PDF).size}-${statSync(LIVRO_PDF).mtimeMs}`
  let text = existsSync(cachePath) && existsSync(`${cachePath}.stamp`) && (await readFile(`${cachePath}.stamp`, 'utf8')) === stamp ? await readFile(cachePath, 'utf8') : null
  if (!text) {
    const parser = new PDFParse({ data: await readFile(LIVRO_PDF) })
    text = (await parser.getText()).text
    await parser.destroy()
    await mkdir('.cache', { recursive: true })
    await writeFile(cachePath, text, 'utf8')
    await writeFile(`${cachePath}.stamp`, stamp, 'utf8')
  }
  const base = { source: LIVRO_SOURCE, pages: Number(text.match(/-- \d+ of (\d+) --/)?.[1]) || null, items: parseLivro(text, { source: 'livro' }) }
  await mkdir('scripts/data', { recursive: true })
  await writeFile(BASE_PATH, `${JSON.stringify(base)}\n`, 'utf8')
  return base
}

// Chave de comparação entre um ato citado no livro e um documento do acervo. Notas são
// numeradas por órgão e ano ("NOTA DGST 137/2013"); portarias, decretos e leis têm numeração
// própria, com o ano para desempatar resoluções de órgãos diferentes com o mesmo número.
const digits = (value) => String(value ?? '').replace(/\D/g, '').replace(/^0+/, '')
const issuerRoot = (issuer) => (issuer ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[A-Z]+/)?.[0] ?? ''
function actKeys(act, year) {
  if (!act) return []
  if (act.type === 'Nota' || act.type === 'Nota conjunta') {
    const [number, noteYear] = act.number.split('/')
    return [`nota|${issuerRoot(act.issuer)}|${Number(number)}|${noteYear}`]
  }
  const family = { 'Lei complementar': 'lei-complementar', Lei: 'lei', Decreto: 'decreto', 'Decreto-lei': 'decreto-lei', Portaria: 'portaria', Resolução: 'resolucao', 'Instrução normativa': 'icg', 'Nota técnica': 'nt' }[act.type]
  if (!family) return []
  const number = family === 'icg' || family === 'nt' ? act.number : digits(act.number)
  return family === 'resolucao' ? [`${family}|${number}|${year}`] : [`${family}|${number}`, `${family}|${number}|${year}`]
}

// Atos do acervo indexados pela chave; o texto do número/título passa pelo mesmo leitor de
// atos do livro, em caixa alta, para que os dois lados produzam a mesma chave.
const typeToAct = { 'Nota administrativa': null, 'Lei estadual': 'Lei', 'Lei complementar': 'Lei complementar', Decreto: 'Decreto', 'Decreto-lei': 'Decreto-lei', Portaria: 'Portaria', Resolução: 'Resolução', 'Instrução normativa': 'Instrução normativa', 'Nota técnica': 'Nota técnica' }
const documentsByKey = new Map()
for (const document of documents) {
  const text = `${document.number} - ${document.title}`.toUpperCase()
  const act = parseAct(document.number.toUpperCase()) ?? parseAct(text)
  if (!act) continue
  if (typeToAct[document.type] && act.type !== typeToAct[document.type]) continue
  for (const key of actKeys(act, document.year)) if (!documentsByKey.has(key)) documentsByKey.set(key, document)
}
const findDocument = (act, year) => actKeys(act, year).map((key) => documentsByKey.get(key)).find(Boolean) ?? null

const base = await loadBase()
const entries = base.items.map((item) => ({ ...item, origin: 'livro' }))

// Itens da curadoria: com "item" de um item existente, substituem os campos informados; sem
// "item" (ou com um número novo), entram como itens novos.
const errors = []
const manualPath = 'data/livro-de-ordens-manual.csv'
const manualRows = existsSync(manualPath) ? parseCsv(await readFile(manualPath, 'utf8')) : []
for (const row of manualRows) {
  const where = `${manualPath}, linha ${row.line}`
  if (row.data_boletim && !/^\d{4}-\d{2}-\d{2}$/.test(row.data_boletim)) { errors.push(`${where}: data_boletim deve estar no formato AAAA-MM-DD`); continue }
  const existing = row.item && entries.find((entry) => entry.item === Number(row.item))
  if (!existing && (!row.assunto || !row.boletim || !row.data_boletim)) { errors.push(`${where}: item novo exige assunto, boletim e data_boletim`); continue }
  const target = existing ?? { id: `lo-manual-${row.line}`, item: Number(row.item) || null, page: null, flags: [], origin: 'manual' }
  if (row.assunto) { target.subject = row.assunto; target.act = parseAct(row.ato || row.assunto) }
  if (row.ato) target.act = parseAct(row.ato.toUpperCase()) ?? { type: 'Outro', issuer: '', number: '', label: row.ato }
  if (row.boletim || row.data_boletim) target.bulletin = { number: row.boletim || target.bulletin?.number, date: row.data_boletim || target.bulletin?.date }
  if (target.bulletin?.date) target.year = Number(target.bulletin.date.slice(0, 4))
  if (row.url) target.url = row.url
  if (row.observacao) target.note = row.observacao
  target.curated = true
  if (!existing) entries.push(target)
}
if (errors.length) {
  console.error(`Livro de Ordens: ${errors.length} erro(s) na curadoria; nada foi gravado:\n${errors.map((error) => ` - ${error}`).join('\n')}`)
  process.exit(1)
}

// Liga cada item ao documento do acervo e registra quais documentos já estão no livro.
const linked = new Set()
for (const entry of entries) {
  const year = entry.actDate ? Number(entry.actDate.slice(0, 4)) : entry.year
  const document = findDocument(entry.act, year)
  if (document) { entry.documentId = document.id; linked.add(document.id) }
}

// Continuação do livro: documentos do acervo com boletim de publicação identificado que ainda
// não aparecem em nenhum item.
for (const document of documents) {
  if (linked.has(document.id) || !document.publication?.bulletin || !document.publication?.date) continue
  entries.push({
    id: `lo-acervo-${document.id}`,
    item: null,
    page: null,
    subject: document.title,
    act: parseAct(document.number.toUpperCase()) ?? { type: document.type, issuer: '', number: document.number, label: document.number || document.type },
    actDate: null,
    bulletin: { number: document.publication.bulletin, date: document.publication.date },
    year: Number(document.publication.date.slice(0, 4)),
    flags: [],
    origin: 'acervo',
    documentId: document.id,
  })
}

entries.sort((a, b) => (a.bulletin?.date ?? `${a.year ?? 0}`).localeCompare(b.bulletin?.date ?? `${b.year ?? 0}`) || (a.item ?? Infinity) - (b.item ?? Infinity))

// Pendências para a curadoria: o que o livro original deixou incompleto e atos publicados mais
// de uma vez (republicações e transcrições aparecem como itens próprios).
const issues = []
for (const entry of entries.filter((candidate) => candidate.origin === 'livro' && !candidate.curated)) {
  if (!entry.subject) issues.push([entry.item, entry.page, 'Item sem assunto no livro original', ''])
  else if (!entry.bulletin) issues.push([entry.item, entry.page, 'Boletim/data não identificados', entry.subject])
  else if (!entry.act) issues.push([entry.item, entry.page, 'Ato não identificado no assunto', entry.subject])
}
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
await writeFile('data/livro-de-ordens-pendencias.csv', `item;pagina;problema;assunto\n${issues.map((issue) => issue.map(csvCell).join(';')).join('\n')}\n`, 'utf8')

// Formato compacto para o navegador (o arquivo é carregado só quando o livro é aberto).
const output = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: base.source,
  pages: base.pages,
  items: entries.map((entry) => ({
    id: entry.id,
    n: entry.item,
    p: entry.page,
    s: entry.subject,
    t: entry.act?.type ?? null,
    a: entry.act?.label ?? null,
    o: entry.act?.issuer ? issuerRoot(entry.act.issuer) : null,
    d: entry.actDate,
    b: entry.bulletin?.number ?? null,
    bd: entry.bulletin?.date ?? null,
    y: entry.year,
    f: entry.flags?.length ? entry.flags : undefined,
    doc: entry.documentId,
    url: entry.url,
    src: entry.origin,
    note: entry.note,
  })),
}
await mkdir('public', { recursive: true })
await writeFile('public/livro-de-ordens.json', JSON.stringify(output), 'utf8')

const byOrigin = entries.reduce((acc, entry) => ({ ...acc, [entry.origin]: (acc[entry.origin] || 0) + 1 }), {})
console.log(`Livro de Ordens: ${entries.length} itens`, byOrigin)
console.log(`Ligados a documentos do acervo: ${entries.filter((entry) => entry.documentId).length} itens (${linked.size} documentos distintos).`)
console.log(`Pendências de curadoria: ${issues.length} (data/livro-de-ordens-pendencias.csv).`)
