import http from 'node:http'
import https from 'node:https'

// Acesso à base de legislação estadual da ALERJ (Lotus Domino). A consulta full-text só é
// aceita pelo proxy www3 (o servidor alerjln1 recusa ?SearchView direto) e devolve no máximo
// 250 resultados por consulta; os documentos individuais são servidos pelo alerjln1, que
// fecha a conexão sem resposta quando a requisição não traz um User-Agent de navegador.
const SEARCH_URL = 'https://www3.alerj.rj.gov.br/lotus_notes/consultaNotes.asp'
const LEGISLACAO_VIEW = 5 // índice da visão "Legislação" no seletor de pesquisa da ALERJ
export const SEARCH_CAP = 250
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
const TIMEOUT_MS = 120_000

// node:http com agent: false (uma conexão nova por requisição): o servidor da ALERJ encerra
// conexões keep-alive reaproveitadas, e o fetch nativo do Node (undici) as reutiliza.
function get(url, encoding) {
  const client = url.startsWith('https:') ? https : http
  return new Promise((resolve, reject) => {
    const request = client.get(url, { agent: false, headers: { 'User-Agent': USER_AGENT }, timeout: TIMEOUT_MS }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`HTTP ${response.statusCode}`)); return }
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve(new TextDecoder(encoding).decode(Buffer.concat(chunks))))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('Tempo esgotado')))
    request.on('error', reject)
  })
}

function decodeEntities(value) {
  return value.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

// Uma consulta à visão "Legislação": devolve as linhas da tabela de resultados.
export async function searchLegislation(query) {
  const html = await get(`${SEARCH_URL}?txtquery=${encodeURIComponent(query)}&hdfId=${LEGISLACAO_VIEW}`, 'utf-8')
  if (/Caracteres inv[aá]lidos/i.test(html)) throw new Error(`Consulta rejeitada pela ALERJ: ${query}`)
  const rows = []
  for (const [row] of html.matchAll(/<tr><td[\s\S]*?<\/tr>/g)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1])
    const href = row.match(/href="([^"]+\?OpenDocument)/)?.[1]
    if (!href) continue
    const text = (cell) => decodeEntities(cell.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
    rows.push({ url: decodeEntities(href).replace(/^http:/, 'https:'), number: text(cells[2]), year: Number(text(cells[3])) || null, published: text(cells[4]), ementa: text(cells[5]), author: text(cells[6]) })
  }
  return rows
}

function toLines(html) {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(?:p|div|tr|td|th|h\d|li|font)>/gi, '\n').replace(/<[^>]*>/g, ' '))
    .split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

export async function fetchLawLines(url) {
  return toLines(await get(url.replace(/^https:/, 'http:'), 'windows-1252'))
}

function valueAfter(lines, label, from = 0) {
  const index = lines.findIndex((line, i) => i >= from && line === label)
  return index === -1 ? { index, value: '' } : { index, value: lines[index + 1] ?? '' }
}

// Rótulos da ficha técnica: quando um campo está vazio, a linha seguinte é o próximo rótulo,
// não um valor.
const fichaLabels = new Set(['Texto da Revogação :', 'Ação de Inconstitucionalidade', 'Tipo de Ação', 'Número da Ação', 'Liminar Deferida', 'Mensagem nº', 'Autoria', 'Data de publicação', 'Data Publ. partes vetadas', 'Assunto:', 'Sub Assunto:', 'OBS:', 'Situação', 'Redação Texto Anterior', 'Texto da Regulamentação', 'Leis relacionadas ao Assunto desta Lei'])
const field = (lines, label, from) => { const { value } = valueAfter(lines, label, from); return fichaLabels.has(value) ? '' : value }

// Estrutura da página de uma norma na base contlei.nsf: tipo, número e ano no cabeçalho;
// texto integral entre o título ("LEI Nº ...") e "Ficha Técnica"; na ficha técnica,
// a situação oficial ("Em Vigor", "Revogada"...) e, se houver, o texto da revogação.
export function parseLaw(lines) {
  const ficha = lines.indexOf('Ficha Técnica')
  const textStart = lines.findIndex((line) => /^Texto d[ao] /.test(line))
  const bodyEnd = ficha === -1 ? lines.length : ficha
  const titleIndex = lines.findIndex((line, i) => i > textStart && i < bodyEnd && /^(LEI|EMENDA|RESOLU|DECRETO)/i.test(line))
  const fichaStart = ficha === -1 ? 0 : ficha
  const adi = lines.indexOf('Ação de Inconstitucionalidade', fichaStart)
  return {
    kind: lines[0] ?? '',
    number: lines[2] ?? '',
    year: Number(lines[4]) || null,
    title: titleIndex === -1 ? '' : lines[titleIndex].replace(/\.$/, ''),
    ementa: titleIndex === -1 ? '' : lines[titleIndex + 1] ?? '',
    situation: field(lines, 'Situação', fichaStart),
    revocation: field(lines, 'Texto da Revogação :', fichaStart),
    adiSituation: adi === -1 ? '' : field(lines, 'Situação', adi),
    author: field(lines, 'Autoria', fichaStart),
    subject: field(lines, 'Assunto:', fichaStart),
    subSubject: field(lines, 'Sub Assunto:', fichaStart),
    text: lines.slice(titleIndex === -1 ? textStart + 1 : titleIndex, bodyEnd).join('\n'),
  }
}

export const lawCacheId = (url) => url.match(/\/([0-9a-f]{32})\?OpenDocument/i)?.[1]
