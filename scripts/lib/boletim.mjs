// Leitura dos Boletins da SEDEC/CBMERJ baixados da Intranet (scripts/fetch-intranet.mjs).
//
// Estrutura de uma edição: capa com "N° 234, DE 23/12/2025"; sumário nas primeiras páginas,
// em que cada linha termina com traços e o número da página ("... - NOTA CHEMG 1230/2025 ____ 8"),
// organizado em partes ("3ª PARTE - ASSUNTOS GERAIS E ADMINISTRATIVOS"), seções ("II - ASSUNTOS
// ADMINISTRATIVOS"), itens numerados ("1. OPERAÇÃO DE PREVENÇÃO ...") e anexos ("ANEXO I -
// REFERENTE À NOTA ..."). Cada item do sumário é um item do Livro de Ordens, com a página.
import { parseAct } from './livro.mjs'

const months = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 }
const pad = (value) => String(value).padStart(2, '0')
const fullYear = (value) => { const year = Number(value); return year < 100 ? year + (year > 50 ? 1900 : 2000) : year }

// Nome da edição na listagem da Intranet: "BOL234 23Dez25", "BOLALUSIVO 002 02Dez25",
// "BOL126 ANEXO", "BOL048 14mar88".
export function parseEditionName(name) {
  const match = name.match(/^BOL\s*(ALUSIVO|ESPECIAL|EXTRA(?:ORDIN[AÁ]RIO)?)?\s*(\d{1,4})\s*(ANEXO\w*)?\s*(?:(\d{1,2})\s*([a-zç]{3})[a-zç]*\.?\s*(\d{2,4}))?/i)
  if (!match) return { number: null, date: null, kind: 'Outro' }
  const [, special, number, annex, day, month, year] = match
  const monthNumber = month ? months[month.toLowerCase().replace('ç', 'c')] : null
  return {
    number: Number(number),
    date: monthNumber && year ? `${fullYear(year)}-${pad(monthNumber)}-${pad(day)}` : null,
    kind: annex ? 'Anexo' : special ? special.charAt(0).toUpperCase() + special.slice(1).toLowerCase() : 'Ordinário',
  }
}

// Número e data na capa, quando o nome da listagem não traz a data. A capa pode citar outros
// boletins; vale a menção cujo número é o da edição, ou a última.
export function parseCover(text, expectedNumber = null) {
  const matches = [...text.matchAll(/N[º°o]\s*(\d{1,4})\s*,?\s*DE\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/gi)]
    .map((match) => ({ number: Number(match[1]), date: `${match[4]}-${pad(match[3])}-${pad(match[2])}` }))
  return matches.find((match) => match.number === expectedNumber) ?? matches.at(-1) ?? null
}

// O PDF quebra palavras em maiúsculas com espaços ("INSTR UÇÃO", "ADM INISTRATIVO", "FE IRA").
// Duas partes são unidas quando a junção é uma palavra que aparece no próprio boletim e pelo
// menos uma das partes não aparece sozinha nele.
const wordsOf = (text) => text.toUpperCase().match(/[A-ZÀ-Ú]+/g) ?? []
export const vocabulary = (text) => new Set(wordsOf(text))
function joinBrokenWords(text, vocab) {
  if (!vocab) return text
  const tokens = text.split(' ')
  const out = []
  for (let index = 0; index < tokens.length; index++) {
    const current = tokens[index]
    const next = tokens[index + 1]
    if (next && /^[A-ZÀ-Ú]+$/.test(current) && /^[A-ZÀ-Ú]+[,.;:)]?$/.test(next)) {
      const bare = next.replace(/[,.;:)]$/, '')
      const joined = current + bare
      if (vocab.has(joined) && (!vocab.has(current) || !vocab.has(bare) || current.length < 3 || bare.length < 3)) { out.push(joined + next.slice(bare.length)); index += 1; continue }
    }
    out.push(current)
  }
  return out.join(' ')
}

const clean = (value, vocab) => joinBrokenWords(value.replace(/\s+/g, ' ').replace(/[\s_.]+$/, '').trim(), vocab)

// Linhas do sumário: das primeiras páginas, as que terminam em "____ <página>". Uma entrada
// pode quebrar em várias linhas; ela termina na linha que traz o número da página.
export function parseSummary(pages) {
  const vocab = vocabulary(pages.join('\n'))
  const entries = []
  let started = false
  let buffer = []
  for (let index = 0; index < Math.min(pages.length, 12); index++) {
    const lines = pages[index].split('\n').map((line) => line.trim()).filter(Boolean)
    const isSummaryPage = lines.filter((line) => /_{4,}\s*\d+\s*$/.test(line)).length >= 3
    if (!isSummaryPage) { if (started) break; continue }
    started = true
    for (const line of lines) {
      const end = line.match(/^(.*?)\s*_{3,}\s*(\d+)\s*$/)
      if (!end) { buffer.push(line); continue }
      buffer.push(end[1])
      entries.push({ text: clean(buffer.join(' '), vocab), page: Number(end[2]) })
      buffer = []
    }
  }
  return entries
}

// O título termina com a nota que publicou o item ("PORTARIA CBMERJ Nº 1317 ... - NOTA CHEMG
// 123/2025"). O ato principal é o normativo citado antes da nota, quando existe; a nota fica
// registrada como "publicado por".
export function itemActs(subject) {
  const upper = subject.toUpperCase()
  const note = parseAct(upper)
  const beforeNote = upper.replace(/\s*[-–]\s*NOTAS?\b(?!.*\bNOTAS?\b).*$/, '')
  const normative = beforeNote !== upper ? parseAct(beforeNote) : null
  if (normative && !/^Nota/.test(normative.type)) return { act: normative, note: /^Nota/.test(note?.type ?? '') ? note : null }
  return { act: note, note: null }
}

// Categoria de cada entrada do sumário. Nenhuma entrada é descartada: títulos de parte e seção
// também são guardados (e dão contexto aos itens abaixo deles).
export const CATEGORIES = {
  abertura: 'Abertura',
  parte: 'Título de parte',
  secao: 'Título de seção',
  subsecao: 'Título de subseção',
  servico: 'Serviços diários',
  semAlteracao: 'Sem alteração',
  item: 'Item',
  anexo: 'Anexo',
}

export function summaryItems(entries) {
  const items = []
  let part = null
  let section = null
  let subsection = null
  let order = 0
  const push = (category, text, page, extra = {}) => {
    order += 1
    const numbered = text.match(/^(\d{1,3})\s*\.\s*(.+)$/)
    const subject = numbered ? numbered[2] : text
    const withActs = category === CATEGORIES.item || category === CATEGORIES.anexo || category === CATEGORIES.servico
    items.push({ order, itemNumber: numbered ? Number(numbered[1]) : null, category, part, section: [section, subsection].filter(Boolean).join(' · ') || null, subject, annex: category === CATEGORIES.anexo, page, ...(withActs ? itemActs(subject) : { act: null, note: null }), ...extra })
  }
  for (const { text, page } of entries) {
    const partMatch = text.match(/^(\d)ª\s*PARTE\s*-\s*(.+)$/i)
    if (partMatch) { part = `${partMatch[1]}ª Parte - ${partMatch[2]}`; section = null; subsection = null; push(CATEGORIES.parte, text, page); continue }
    const sectionMatch = text.match(/^([IVX]{1,4})\s*-\s*(.+)$/)
    if (sectionMatch && text.length < 90 && !parseAct(text.toUpperCase())) { section = `${sectionMatch[1]} - ${sectionMatch[2]}`; subsection = null; push(CATEGORIES.secao, text, page); continue }
    const subsectionMatch = text.match(/^([A-Z])\s*-\s*(.+)$/)
    if (subsectionMatch && text.length < 90 && !parseAct(text.toUpperCase())) { subsection = `${subsectionMatch[1]} - ${subsectionMatch[2]}`; push(CATEGORIES.subsecao, text, page); continue }
    if (!part && /^(FATOS HIST[OÓ]RICOS|ESTAT[IÍ]STICA|PREVIS[AÃ]O DO TEMPO|TEND[EÊ]NCIAS? METEOROL)/i.test(text)) { push(CATEGORIES.abertura, text, page); continue }
    if (/^SEM ALTERA[CÇ][AÃ]O$/i.test(text)) { push(CATEGORIES.semAlteracao, text, page); continue }
    if (/^ANEXO\b/i.test(text)) { const previous = part; part = 'Anexos'; push(CATEGORIES.anexo, text, page); part = previous; continue }
    push(/^1ª/.test(part ?? '') ? CATEGORIES.servico : part ? CATEGORIES.item : CATEGORIES.abertura, text, page)
  }
  return items
}
