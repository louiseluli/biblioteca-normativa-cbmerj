// Leitura do "Livro de Ordens" (índice das publicações em Boletim da SEDEC/CBMERJ). Cada item
// do PDF tem três colunas — ITEM, ASSUNTO e BOLETIM / DATA —, mas o texto extraído vem em
// linhas corridas: o número do item abre o registro ("4729."), o assunto pode quebrar em
// várias linhas e o boletim/data fecha o registro ("117, DE 28 JUN 2013" ou "234, de 16/12/2019").
const months = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 }
const monthNames = { janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 }
const pad = (value) => String(value).padStart(2, '0')
const isoDate = (year, month, day) => (year && month && day ? `${year}-${pad(month)}-${pad(day)}` : null)
const fullYear = (value) => { const year = Number(value); return year < 100 ? year + (year > 50 ? 1900 : 2000) : year }

// Boletim e data no fim do item. Aceita "039, DE 01 MAR 2002", "234, de 16/12/2019",
// "69, DE 15 ABR 2004", "BOL 117, DE 28 JUN 2013" e variações sem vírgula.
const bulletinPattern = /(?:\bBOL(?:ETIM)?\.?\s*(?:N[º°o.]*\s*)?)?(\d{1,3}(?:\s*-\s*[A-Z])?)\s*,?\s*(?:DE|de|E)\s*(\d{1,2})[º°]?\s*(?:\/\s*(\d{1,2})\s*\/\s*(\d{2,4})|([A-Za-zÇç]{3})[A-Za-zÇç.]*\s*(?:DE\s+)?(\d{4}))\s*\.?\s*$/

export function parseBulletin(text) {
  const match = text.match(bulletinPattern)
  if (!match) return null
  const [, number, day, slashMonth, slashYear, monthName, monthYear] = match
  const month = slashMonth ? Number(slashMonth) : months[monthName.toUpperCase().replace('Ç', 'C')]
  const year = fullYear(slashYear ?? monthYear)
  if (!month || month > 12) return null
  return { index: match.index, number: number.replace(/\s+/g, ''), date: isoDate(year, month, Number(day)), year }
}

// Ato citado no assunto. A ordem importa: o livro descreve o assunto e termina com o ato que o
// publicou ("... - NOTA DGST 137/2013", "... - PORTARIA CBMERJ Nº 1086 DE 04 DE DEZEMBRO DE 2019"),
// então procuramos a ÚLTIMA referência a ato no texto, que é a do próprio item.
const actPatterns = [
  ['Decreto-lei', /DECRETO[\s-]*LEI\s*(?:ESTADUAL\s*)?N?[º°o.]*\s*([\d.]+)/gi],
  ['Lei complementar', /LEI\s+COMPLEMENTAR\s*(?:ESTADUAL\s*|FEDERAL\s*)?N?[º°o.]*\s*([\d.]+)/gi],
  ['Lei', /\bLEI\s*(?:ESTADUAL\s*|FEDERAL\s*)?(?:N[º°o.]*\s*)?(\d[\d.]*)/gi],
  ['Decreto', /\bDECRETO\s*(?:ESTADUAL\s*|FEDERAL\s*|RIO\s*)?(?:N[º°o.]*\s*)?(\d[\d.]*)/gi],
  ['Resolução', /\bRESOLU[CÇ][AÃ]O\s+(?:CONJUNTA\s+)?([A-Z][A-Z/\s-]{1,30}?)?\s*(?:N[º°o.]*\s*)?(\d[\d.]*)/gi],
  ['Portaria', /\bPORTARIA\s+(?:CONJUNTA\s+)?([A-Z][A-Z/\s-]{1,40}?)?\s*(?:N[º°o.]*\s*)?(\d[\d.]*)/gi],
  ['Instrução normativa', /\bICG\s*[-_]?\s*(\d+\s*[-_]\s*\d+)/gi],
  ['Nota técnica', /\bNT\s*[-_]?\s*(\d+\s*[-_]\s*\d+)/gi],
  ['Aditamento', /\bADITAMENTO\s+ADMINISTRATIVO(?:\s+DE\s+[A-ZÇÃÉÍÓÚ\s]+?)?\s*N?[º°o.]*\s*(\d+\s*\/\s*\d{2,4})/gi],
  ['Ordem de serviço', /\bORDEM\s+DE\s+SERVI[CÇ]O\s+([A-Z][A-Z/\s-]{1,30}?)?\s*(?:N[º°o.]*\s*)?(\d[\d.]*)/gi],
  ['Deliberação', /\bDELIBERA[CÇ][AÃ]O\s+([A-Z][A-Z/\s-]{1,30}?)?\s*(?:N[º°o.]*\s*)?(\d[\d.]*)/gi],
  ['Instrução normativa externa', /\bINSTRU[CÇ][AÃ]O\s+NORMATIVA\s+([A-Z][A-Za-z/\s-]{1,30}?)?\s*(?:N[º°o.]*\s*)?(\d[\d.]*)/gi],
  ['Diário Oficial', /\bDOERJ\b[^,]*?N[º°o.]*\s*(\d+)/gi],
  ['Nota', /\bNOTAS?\s*(CONJUNTA\s+)?(?:N[º°o.]*\s*)?([A-Z0-9][A-Za-zÀ-ÿ0-9º°ª/.\s-]*?)?\s*[-\s]?\s*(?:N[º°o.]*\s*)?(\d{1,4})-?\s*\/\s*(\d{2,4})/gi],
]

export function parseAct(text) {
  let best = null
  for (const [type, pattern] of actPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (best && match.index < best.index) continue
      // Decreto-lei também casa "LEI Nº" e "Lei complementar" casa "LEI"; em empate de posição
      // (ou sobreposição), vence o padrão mais específico, listado antes.
      if (best && match.index <= best.index + best.length && best.index <= match.index && type !== best.type && match.index + match[0].length <= best.index + best.length) continue
      best = { type, index: match.index, length: match[0].length, match }
    }
  }
  if (!best) return null
  const { type, match } = best
  const clean = (value) => (value ?? '').replace(/\s+/g, ' ').replace(/[\s-]+$/, '').trim()
  if (type === 'Nota') {
    const issuer = clean(match[2]).replace(/^-+|\s*-\s*$/g, '')
    return { type: match[1] ? 'Nota conjunta' : 'Nota', issuer, number: `${Number(match[3])}/${fullYear(match[4])}`, label: `Nota ${issuer ? `${issuer} ` : ''}${match[3]}/${fullYear(match[4])}` }
  }
  if (['Resolução', 'Portaria', 'Ordem de serviço', 'Deliberação', 'Instrução normativa externa'].includes(type)) {
    const labelType = type === 'Instrução normativa externa' ? 'Instrução normativa' : type
    const issuer = clean(match[1])
    const number = match[2].replace(/\./g, '')
    return { type, issuer, number, label: `${labelType}${issuer ? ` ${issuer}` : ''} nº ${number}` }
  }
  const number = clean(match[1]).replace(/\s*[-_]\s*/g, '-')
  const label = { 'Instrução normativa': `ICG ${number}`, 'Nota técnica': `NT ${number}`, Aditamento: `Aditamento Administrativo ${number.replace(/\s/g, '')}`, 'Diário Oficial': `DOERJ nº ${number}` }[type] ?? `${type} nº ${number}`
  return { type, issuer: '', number: type === 'Aditamento' ? number.replace(/\s/g, '') : number, label }
}

// Data do próprio ato quando o assunto a traz ("... Nº 1086 DE 04 DE DEZEMBRO DE 2019",
// "... DE 08 MAR 2002"); senão fica só o ano do número ("NOTA DGST 137/2013").
function actDate(text) {
  const long = [...text.matchAll(/\bDE\s+(\d{1,2})[º°]?\s+DE\s+([A-ZÇ]+)\s+DE\s+(\d{4})/gi)].at(-1)
  if (long && monthNames[long[2].toLowerCase()]) return isoDate(Number(long[3]), monthNames[long[2].toLowerCase()], Number(long[1]))
  const short = [...text.matchAll(/\bDE\s+(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})/gi)].at(-1)
  if (short) return isoDate(Number(short[3]), months[short[2].toUpperCase()], Number(short[1]))
  return null
}

const flags = [['republicacao', /REPUBLICA[CÇ][AÃ]O/i], ['retificacao', /RETIFICA[CÇ][AÃ]O/i], ['transcricao', /TRANSCRI[CÇ][AÃ]O/i], ['revogacao', /\bREVOGA/i], ['alteracao', /\bALTERA/i]]

// Converte o texto extraído (com os marcadores "-- N of M --" que o pdf-parse insere ao fim de
// cada página) em itens. O número do item é sequencial: só uma linha "N." com N = anterior + 1
// (ou um pequeno salto, para tolerar itens ausentes) abre um novo item — assim uma linha de
// assunto que comece com número ("2002. ...") não é confundida com um item.
export function parseLivro(text, { source }) {
  const items = []
  let page = 1
  let current = null
  const close = () => { if (current) items.push(current); current = null }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const pageMarker = line.match(/^-- (\d+) of \d+ --$/)
    if (pageMarker) { page = Number(pageMarker[1]) + 1; continue }
    if (/^LIVRO DE ORDENS\b.*\bp\.\s*\d+ de \d+\.?$/i.test(line) || /^ITEM ASSUNTO BOLETIM/i.test(line)) continue
    const opener = line.match(/^(\d{1,5})\.\s*(.*)$/)
    const expected = current ? current.item + 1 : (items.at(-1)?.item ?? 0) + 1
    if (opener && Number(opener[1]) >= expected && Number(opener[1]) <= expected + 3) {
      close()
      current = { item: Number(opener[1]), page, lines: [opener[2]] }
      continue
    }
    if (current) current.lines.push(line)
  }
  close()

  return items.map(({ item, page, lines }) => {
    const raw = lines.join(' ').replace(/\s+/g, ' ').replace(/(\w)- (\w)/g, '$1-$2').trim()
    const bulletin = parseBulletin(raw)
    const subject = (bulletin ? raw.slice(0, bulletin.index) : raw).replace(/[\s-]+$/, '').trim()
    const act = parseAct(subject)
    const date = actDate(subject)
    return {
      id: `lo-${item}`,
      item,
      page,
      subject,
      act,
      actDate: date,
      bulletin: bulletin ? { number: bulletin.number, date: bulletin.date } : null,
      year: bulletin?.year ?? (date ? Number(date.slice(0, 4)) : null),
      flags: flags.filter(([, pattern]) => pattern.test(subject)).map(([name]) => name),
      source,
    }
  })
}
