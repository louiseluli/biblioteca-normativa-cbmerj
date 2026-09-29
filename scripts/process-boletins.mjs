import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, linkSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PDFParse } from 'pdf-parse'
import { parseCover, parseEditionName, parseSummary, summaryItems } from './lib/boletim.mjs'

// Organiza os boletins baixados da Intranet e monta o banco interno. Tudo fica na pasta do
// acervo interno (fora do git); nada daqui vai para o site público.
//
// Para cada edição ainda não processada (pelo SHA-256 do arquivo):
// 1. lê número e data (nome da listagem ou capa) e cria um atalho organizado
//    organizado/<boletim>/<ano>/<AAAA-MM-DD>-BOL<nº>.pdf (link físico: não ocupa espaço extra);
// 2. extrai o texto de cada página e o sumário (itens com parte, seção, ato e página);
// 3. grava no SQLite acervo-interno.db: boletim, item e pagina, com busca de texto integral
//    (FTS5, sem acentos) sobre as páginas.
// Ao final exporta livro-interno.json, os itens no formato do Livro de Ordens, que
// build-livro.mjs --interno junta ao livro e serve-interno.mjs mostra no site local.
//
// Uso: npm run boletins:processar [-- --acervo /Volumes/DISCO/intranet-acervo ...]
// (--acervo pode ser repetido quando os anos antigos estão em outro disco; o banco fica na
// pasta padrão, intranet-acervo/).
const MAIN_DIR = 'intranet-acervo'
const args = process.argv.slice(2)
const collections = [MAIN_DIR, ...args.flatMap((arg, index) => (arg === '--acervo' ? [args[index + 1]] : []))]
const dbPath = path.join(MAIN_DIR, 'acervo-interno.db')

await mkdir(MAIN_DIR, { recursive: true })
const db = new DatabaseSync(dbPath)
db.exec(`
  CREATE TABLE IF NOT EXISTS boletim (
    id TEXT PRIMARY KEY, unidade TEXT, numero INTEGER, tipo TEXT, data TEXT, ano INTEGER, titulo TEXT,
    paginas INTEGER, sem_texto INTEGER, arquivo TEXT, organizado TEXT, url TEXT, sha256 TEXT, bytes INTEGER, processado_em TEXT
  );
  CREATE TABLE IF NOT EXISTS item (
    id TEXT PRIMARY KEY, boletim_id TEXT REFERENCES boletim(id), ordem INTEGER, numero_item INTEGER,
    parte TEXT, secao TEXT, assunto TEXT, anexo INTEGER, pagina INTEGER, ato_tipo TEXT, ato TEXT, orgao TEXT
  );
  CREATE TABLE IF NOT EXISTS pagina (boletim_id TEXT REFERENCES boletim(id), pagina INTEGER, texto TEXT, PRIMARY KEY (boletim_id, pagina));
  CREATE VIRTUAL TABLE IF NOT EXISTS pagina_fts USING fts5(texto, boletim_id UNINDEXED, pagina UNINDEXED, tokenize='unicode61 remove_diacritics 2');
  CREATE INDEX IF NOT EXISTS item_boletim ON item(boletim_id);
  CREATE INDEX IF NOT EXISTS item_ato ON item(ato);
  CREATE INDEX IF NOT EXISTS boletim_data ON boletim(data);
`)

// O manifesto é regravado pelo coletor a cada arquivo; uma leitura no meio da gravação é repetida.
async function readManifest(dir) {
  const file = path.join(dir, 'manifesto.json')
  if (!existsSync(file)) return []
  for (let attempt = 0; attempt < 3; attempt++) {
    // O coletor grava os caminhos relativos à pasta do projeto (ou absolutos, com --destino).
    try { return JSON.parse(await readFile(file, 'utf8')).items.map((item) => ({ ...item, file: path.resolve(item.file) })) } catch { await new Promise((resolve) => setTimeout(resolve, 500)) }
  }
  throw new Error(`Não foi possível ler ${file}`)
}

// Colunas acrescentadas depois da primeira versão do banco.
const itemColumns = db.prepare('PRAGMA table_info(item)').all().map((column) => column.name)
if (!itemColumns.includes('nota')) db.exec('ALTER TABLE item ADD COLUMN nota TEXT')
if (!itemColumns.includes('categoria')) db.exec('ALTER TABLE item ADD COLUMN categoria TEXT')

// --reprocessar relê todas as edições (depois de uma melhoria no leitor do sumário).
const processed = new Set(args.includes('--reprocessar') ? [] : db.prepare('SELECT sha256 FROM boletim').all().map((row) => row.sha256))
const insertBulletin = db.prepare('INSERT OR REPLACE INTO boletim VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
const insertItem = db.prepare('INSERT OR REPLACE INTO item (id, boletim_id, ordem, numero_item, parte, secao, assunto, anexo, pagina, ato_tipo, ato, orgao, nota, categoria) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
const insertPage = db.prepare('INSERT OR REPLACE INTO pagina VALUES (?, ?, ?)')
const insertFts = db.prepare('INSERT INTO pagina_fts (texto, boletim_id, pagina) VALUES (?, ?, ?)')
const deleteFts = db.prepare('DELETE FROM pagina_fts WHERE boletim_id = ?')

let done = 0
let failed = 0
for (const dir of collections) {
  const bulletins = (await readManifest(dir)).filter((item) => item.section?.startsWith('boletim-') && /pdf/.test(item.contentType ?? ''))
  for (const record of bulletins) {
    if (processed.has(record.sha256) || !existsSync(record.file)) continue
    try {
      const parser = new PDFParse({ data: await readFile(record.file) })
      const result = await parser.getText()
      await parser.destroy()
      const pages = result.pages.map((page) => page.text)
      const fromName = parseEditionName(record.title ?? '')
      const cover = parseCover(pages[0] ?? '', fromName.number)
      const number = fromName.number ?? cover?.number ?? null
      const date = fromName.date ?? cover?.date ?? null
      const year = date ? Number(date.slice(0, 4)) : null
      const id = record.sha256.slice(0, 16)
      const textless = pages.join('').replace(/\s+/g, '').length < 200 * Math.max(1, pages.length / 10)

      // Atalho organizado por ano e data, no mesmo disco do arquivo (link físico).
      const suffix = fromName.kind === 'Ordinário' ? '' : `-${fromName.kind.toLowerCase()}`
      const organized = path.join(dir, 'organizado', record.section, String(year ?? 'sem-data'), `${date ?? 'sem-data'}-BOL${String(number ?? 0).padStart(3, '0')}${suffix}-${id.slice(0, 6)}.pdf`)
      if (!existsSync(organized)) {
        await mkdir(path.dirname(organized), { recursive: true })
        try { linkSync(record.file, organized) } catch { copyFileSync(record.file, organized) }
      }

      const items = summaryItems(parseSummary(pages))
      db.exec('BEGIN')
      insertBulletin.run(id, record.section, number, fromName.kind, date, year, record.title ?? '', pages.length, textless ? 1 : 0, path.resolve(record.file), path.resolve(organized), record.url, record.sha256, record.bytes, new Date().toISOString())
      db.prepare('DELETE FROM item WHERE boletim_id = ?').run(id)
      for (const item of items) insertItem.run(`${id}-${item.order}`, id, item.order, item.itemNumber, item.part, item.section, item.subject, item.annex ? 1 : 0, item.page, item.act?.type ?? null, item.act?.label ?? null, item.act?.issuer ?? null, item.note?.label ?? null, item.category)
      deleteFts.run(id)
      pages.forEach((text, index) => { insertPage.run(id, index + 1, text); insertFts.run(text, id, index + 1) })
      db.exec('COMMIT')
      processed.add(record.sha256)
      done += 1
      if (done % 25 === 0) console.log(`${done} boletins processados…`)
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      failed += 1
      console.warn(`Falha ao processar ${path.basename(record.file)}: ${error.message}`)
    }
  }
}

// Todas as entradas no formato do Livro de Ordens (mesmas chaves compactas de
// public/livro-de-ordens.json), cada uma com sua categoria para o filtro da interface.
const rows = db.prepare(`
  SELECT item.*, boletim.numero, boletim.data, boletim.ano, boletim.unidade, boletim.tipo
  FROM item JOIN boletim ON boletim.id = item.boletim_id
  ORDER BY boletim.data, item.ordem`).all()
const issuerRoot = (issuer) => (issuer ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[A-Z]+/)?.[0] ?? null
const exported = rows.map((row) => ({
  id: `bol-${row.id}`,
  bol: row.boletim_id,
  p: row.pagina,
  s: row.assunto,
  t: row.ato_tipo,
  a: row.ato,
  o: issuerRoot(row.orgao),
  b: row.numero ? String(row.numero).padStart(3, '0') : null,
  bd: row.data,
  y: row.ano,
  src: 'boletim',
  parte: row.parte,
  secao: row.secao,
  unidade: row.unidade,
  cat: row.categoria,
  nota: row.nota ?? undefined,
}))
await writeFile(path.join(MAIN_DIR, 'livro-interno.json'), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), items: exported }), 'utf8')

const totals = db.prepare('SELECT unidade, COUNT(*) boletins, MIN(data) desde, MAX(data) ate, SUM(sem_texto) sem_texto FROM boletim GROUP BY unidade').all()
console.log(`Processados agora: ${done} (${failed} falhas). Banco: ${dbPath}`)
console.table(totals)
console.log(`Itens exportados para o Livro de Ordens interno: ${exported.length}`)
