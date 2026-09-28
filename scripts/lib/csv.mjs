// CSV mínimo (RFC 4180: aspas, aspas duplicadas, quebras de linha dentro de aspas) para as
// planilhas de curadoria em data/. Aceita vírgula ou ponto e vírgula como separador — o Excel
// em português exporta com ";" — e ignora o BOM que ele coloca no início do arquivo.
export function parseCsv(text) {
  const source = text.replace(/^﻿/, '')
  const firstLine = source.split(/\r?\n/, 1)[0]
  const separator = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++ } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === separator) { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += char
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header = [], ...body] = rows.filter((cells) => cells.some((cell) => cell.trim()))
  const keys = header.map((key) => key.trim())
  return body.map((cells, index) => ({ line: index + 2, ...Object.fromEntries(keys.map((key, column) => [key, (cells[column] ?? '').trim()])) }))
}
