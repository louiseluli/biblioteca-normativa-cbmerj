// Boletim de publicação citado no próprio PDF. ICGs e notas trazem no cabeçalho "Publicado no
// Boletim da SEDEC/CBMERJ nº 059, de 31 de março de 2022" ou "Boletim da SEDEC/CBMERJ nº 203,
// de 01/11/2022". Só a menção explícita de publicação, ou a primeira menção logo no início do
// texto, conta: o corpo de uma norma cita outros boletins (os das normas que ela altera).
const monthNames = { janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 }
const pad = (value) => String(value).padStart(2, '0')
const bulletin = /boletim\s+(?:ostensivo\s+)?(?:da\s+|do\s+)?(?:sedec\s*\/\s*cbmer[j3]{1,2}|subsedec\s*\/\s*cbmer[j3]{1,2}|cbmer[j3]{1,2})?\s*(?:n[º°o.]*|número:?)\s*(\d{1,3})\s*,?\s*(?:de\s+)?(\d{1,2})[º°]?\s*(?:de\s+([a-zç]+)\s+de\s+(\d{4})|\/\s*(\d{1,2})\s*\/\s*(\d{2,4}))/i

function toPublication(match) {
  const [, number, day, monthName, longYear, month, shortYear] = match
  const monthNumber = monthName ? monthNames[monthName.toLowerCase()] : Number(month)
  let year = Number(longYear ?? shortYear)
  if (year < 100) year += 2000
  if (!monthNumber || monthNumber > 12 || Number(day) > 31 || year < 1970) return null
  return { bulletin: number.padStart(3, '0'), date: `${year}-${pad(monthNumber)}-${pad(day)}` }
}

// Alguns PDFs de ICG simulam negrito imprimindo cada caractere duas vezes, e o texto extraído
// sai como "B BO OL LE ET TIIM M ... N Nºº 112 26 6,, D DE E 1111//0 07 7//2 20 02 24 4".
// Sem os espaços, é a sequência original com cada caractere repetido: basta desfazer os pares.
function undoubledHeader(text) {
  const compact = text.slice(0, 400).replace(/\s+/g, '')
  let result = ''
  for (let i = 0; i + 1 < compact.length && compact[i] === compact[i + 1]; i += 2) result += compact[i]
  return result.length >= 20 ? result : ''
}

export function publicationFromText(text) {
  const header = undoubledHeader(text).match(/BOLETIM(?:DA)?SEDEC\/CBMERJN[º°o]*(\d{1,3}),DE(\d{1,2})\/(\d{1,2})\/(\d{4})/i)
  if (header) return toPublication([header[0], header[1], header[2], undefined, undefined, header[3], header[4]])

  const explicit = text.slice(0, 4000).match(new RegExp(`publicad[oa]\\s+(?:no|em)\\s+${bulletin.source}`, 'i'))
  if (explicit) return toPublication(explicit)
  const early = text.slice(0, 600).match(bulletin)
  return early ? toPublication(early) : null
}
