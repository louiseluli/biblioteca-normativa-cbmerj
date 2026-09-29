import http from 'node:http'
import https from 'node:https'

// Acesso à base de legislação estadual da ALERJ (Lotus Domino). A consulta full-text só é
// aceita pelo proxy www3 (o servidor alerjln1 recusa ?SearchView direto) e devolve no máximo
// 250 resultados por consulta; os documentos individuais são servidos pelo alerjln1, que
// fecha a conexão sem resposta quando a requisição não traz um User-Agent de navegador.
const SEARCH_URL = 'https://www3.alerj.rj.gov.br/lotus_notes/consultaNotes.asp'
// Índices das visões no seletor de pesquisa da ALERJ: 5 = "Legislação" (leis, emendas,
// resoluções), 0 = "Atos do Executivo" (decretos estaduais). As demais visões são processo
// legislativo, discursos e constituições, não normas em vigor.
export const VIEWS = { legislacao: 5, executivo: 0 }
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

// Uma consulta a uma visão da base: devolve as linhas da tabela de resultados.
export async function searchLegislation(query, view = VIEWS.legislacao) {
  const html = await get(`${SEARCH_URL}?txtquery=${encodeURIComponent(query)}&hdfId=${view}`, 'utf-8')
  if (/Caracteres inv[aá]lidos/i.test(html)) throw new Error(`Consulta rejeitada pela ALERJ: ${query}`)
  const rows = []
  for (const [row] of html.matchAll(/<tr><td[\s\S]*?<\/tr>/g)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1])
    const href = row.match(/href="([^"]+\?OpenDocument)/)?.[1]
    if (!href) continue
    const text = (cell) => decodeEntities(cell.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
    rows.push({ url: decodeEntities(href).replace(/&Highlight=.*$/, '').replace(/^http:/, 'https:'), number: text(cells[2]), year: Number(text(cells[3])) || null, published: text(cells[4]), ementa: text(cells[5]), author: text(cells[6]) })
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

// Página de um decreto na base decest.nsf: "Decreto nº: | 32129 | / | 2002" no cabeçalho, a
// situação entre colchetes em "Texto do Decreto Estadual [ Em Vigor ]" e, no rodapé, "Tipo de
// Revogação:" seguido da situação e "Texto da Revogação :" seguido do texto, quando houver.
export function parseDecree(lines) {
  const numberIndex = lines.indexOf('Decreto nº:')
  const header = lines.findIndex((line) => /^Texto do Decreto/i.test(line))
  const titleIndex = lines.findIndex((line, i) => i > header && /^DECRETO/i.test(line))
  const end = lines.findIndex((line) => /^Data da Publica[cç][aã]o:/i.test(line))
  const revocationType = lines.indexOf('Tipo de Revogação:')
  const bracket = header === -1 ? '' : lines[header].match(/\[\s*([^\]]+?)\s*\]/)?.[1] ?? ''
  const afterType = revocationType === -1 ? '' : lines[revocationType + 1] ?? ''
  const revocationLabel = lines.indexOf('Texto da Revogação :')
  const revocation = revocationLabel === -1 ? '' : lines[revocationLabel + 1] ?? ''
  return {
    kind: 'Decreto',
    number: numberIndex === -1 ? '' : lines[numberIndex + 1] ?? '',
    year: numberIndex === -1 ? null : Number(lines[numberIndex + 3]) || null,
    title: titleIndex === -1 ? '' : lines[titleIndex].replace(/\.$/, ''),
    ementa: titleIndex === -1 ? '' : lines[titleIndex + 1] ?? '',
    situation: bracket || (/^(Redação|Texto da|Atalho)/.test(afterType) ? '' : afterType),
    revocation: /^(Tipo de Revoga|Redação Texto|Texto da Regulamenta|Atalho)/.test(revocation) ? '' : revocation,
    adiSituation: '',
    author: '',
    subject: '',
    subSubject: '',
    text: lines.slice(titleIndex === -1 ? header + 1 : titleIndex, end === -1 ? lines.length : end).join('\n'),
  }
}

// O cabeçalho de uma norma às vezes vem quebrado em várias linhas ("LEI Nº" / "2566, DE 05 DE
// JUNHO DE 1996."; "RESOLUÇÃO N.º 1389," / "DE 2026"; "LEI Nº 26" / "62, DE ...") e a ementa pode
// vir depois de linhas de ruído (".", "*", "(Redação atual)", observações de consolidação) ou
// continuar na linha seguinte. Junta o cabeçalho até o ano e a ementa até o preâmbulo.
const headerStart = /^(LEI|EMENDA|RESOLU|DECRETO)/i
const headerEnd = /\bDE\s+\d{3,4}\.?$|\b(1[89]|20)\d{2}\.?$/i
const ementaNoise = /^([.*"',;–-]+|\(Reda[çc][ãa]o atual\)|\(Revogad.*|\* ?LEI EM PROCESSO.*|obs\.?:.*|"?Art\. ?\d.*|ANO D[OE] .*|Norma submetida a a[çc][ãa]o direta.*)$/i
const preamble = /^(,|[*"“]|(O|A) (GOVERN|ASSEMBL|PRESIDENTE|MESA|VICE)|Art\.?\s*\d|D ?E ?C ?R ?E ?T ?A|CONSIDERANDO|Fa[çc]o saber|CAP[ÍI]TULO|T[ÍI]TULO|no uso d)/i

export function headerAndEmenta(text) {
  const lines = String(text ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
  if (!headerStart.test(lines[0] ?? '')) return null
  let title = lines[0]
  let index = 1
  while (!headerEnd.test(title) && index < Math.min(lines.length, 6)) {
    const next = lines[index++]
    title = /\d$/.test(title) && /^\d/.test(next) ? title + next : `${title} ${next}`
  }
  if (!headerEnd.test(title)) return null
  while (index < lines.length && ementaNoise.test(lines[index])) index++
  const ementa = []
  while (index < lines.length && ementa.length < 5 && !preamble.test(lines[index])) ementa.push(lines[index++])
  // Continuação que começa com vírgula (", DE 26/11/79, E DÁ OUTRAS PROVIDÊNCIAS.") pertence à ementa.
  while (index < lines.length && /^,\s*\S/.test(lines[index]) && !/^,\s*(no uso|nos termos)/i.test(lines[index])) ementa.push(lines[index++])
  const clean = (value) => value.replace(/\s+([,.])/g, '$1').replace(/\s+/g, ' ').trim()
  return { title: clean(title).replace(/[.,]$/, ''), ementa: clean(ementa.join(' ').replace(/\s+,/g, ',')) }
}

// Sem "Ficha Técnica" (caso das resoluções), a situação vem depois de "Tipo de Revogação:".
export function situationFromText(text) {
  const lines = String(text ?? '').split('\n').map((line) => line.trim())
  const index = lines.indexOf('Tipo de Revogação:')
  const value = index === -1 ? '' : lines[index + 1] ?? ''
  return /^(Em Vigor|Revogad[ao]|Suspens[ao]|Inconstitucional|Parcialmente|Declarad|Vetad|Sem efeito|Tornad|Anulad|Exaurid)/i.test(value) ? value : ''
}

// Aplica as duas correções acima a um registro (recém-lido ou vindo do cache). Só troca a
// ementa lida pelo parser original quando ela está quebrada ("DE 2026", ".", "*") ou quando a
// nova é a continuação dela; uma ementa que já estava certa não muda.
const brokenEmenta = (ementa) => ementa.length < 40 || /^(DE\s|N[º°.]|[.*"'])/i.test(ementa)
export function refineLaw(law) {
  const parsed = headerAndEmenta(law.text)
  const better = parsed && parsed.ementa.length >= 8 && (brokenEmenta(law.ementa) || !headerEnd.test(law.title) || (parsed.ementa.startsWith(law.ementa) && parsed.ementa.length > law.ementa.length))
  return { ...law, ...(better ? parsed : {}), situation: law.situation || situationFromText(law.text) }
}

export const lawCacheId =(url) => url.match(/\/([0-9a-f]{32})\?OpenDocument/i)?.[1]
