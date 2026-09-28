import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { urlId } from './lib/ids.mjs'

const sources = [
  { page: 'https://www.cbmerj.rj.gov.br/notas-tecnicas/', collection: 'Notas técnicas' },
  { page: 'https://www.cbmerj.rj.gov.br/instrucoes-normativas-do-comando-geral/', collection: 'Instruções normativas' },
  { page: 'https://www.cbmerj.rj.gov.br/para-o-cidadao/regularizacao/', collection: 'Legislação e regularização' },
]

// URLs excluídas por não serem normas (cartilhas e compilações de documentação de apoio).
const excludedUrlPatterns = [/Documentacao_Regularizaca/i, /cartilha-cbmerj-licenciamento/i]
// Cartilhas e folderes são material educativo, não atos normativos; ficam fora do catálogo.
const excludedTitlePatterns = [/^cartilha\b/i, /^folder\b/i]

const publishedIcg = [
  ['1-1', 'Uniformes', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2022/04/01_ICG_1-1_Uniformes_FORMATADA_BM1_04.04.2022v_SITE.pdf'],
  ['1-2', 'Efetivo e atividades', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2022/04/02_ICG_1-2_Efetivo_e_atividades_FORMATADA_BM1_04.04.22v_SITE.pdf'],
  ['1-3', 'Seleção, ingresso e incorporação', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2022/04/03_ICG_1-3_Ingresso_FORMATADA_BM1_04.04.22v_SITE.pdf'],
  ['1-4', 'Registro geral e carteira de identidade', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2022/04/04_ICG_1-4_RG_FORMATADA_BM1_04.04.22v_SITE.pdf'],
  ['1-5', 'Capacitação', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2022/04/05_ICG_1-5_Capacitao_TEMPORRIOS_FORMATADA_BM1_04.04.22v_SITE.pdf'],
  ['1-6', 'Áreas de atuação e habilidades técnicas', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2024/04/BOL203_01Nov22_ICG1-6.pdf'],
  ['1-7', 'Normas de referenciação dos cargos militares', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2024/04/BOL203_01Nov22_ICG1-7.pdf'],
  ['1-8', 'Exclusão', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2026/08/ICG_1_8_Boletim_113__de_26.06.26.pdf'],
  ['1-9', 'Prorrogação', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2024/07/ICG-1-9.pdf'],
  ['1-10', 'Processo administrativo sumário', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2024/04/10_-ICG_1-10_Processo-Administrativo.pdf'],
  ['1-11', 'Férias, licenças, afastamentos e averbações', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2024/04/11_ICG_1-11_Frias-Licenas-Afastamentos-e-Averbaes.pdf'],
  ['2-1', 'Norma interna de armamentos', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2024/04/ICG_2_1_Norma_Interna_de_Armamentos.pdf'],
  ['3-1', 'Sistema de comando e controle operacional do CBMERJ', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2024/04/ICG_3_1_SCCO.pdf'],
  ['3-2', 'Diretrizes gerais para o emprego operacional do CBMERJ em desastres', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2024/04/ICG_3_2_GRD.pdf'],
  ['3-3', 'Vítimas de violência doméstica e familiar', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2026/06/ICG_3_3.pdf'],
  ['3-4', 'Solicitação de pagamento do RAS em operações especiais', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2025/08/ICG-3-4-Diretrizes-para-a-solicitacao-de-pagamento-do-RAS-em-Operacoes-Especiais.pdf'],
  ['3-4', 'Grupo de operações especiais (GOESP) - instruções gerais', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2026/05/ICG_3-4.pdf'],
  ['4-2', 'Normas gerais de ação do almoxarifado médico', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2025/07/ICG-4_2.pdf'],
  ['4-3', 'Almoxarifado odontológico', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2025/07/ICG-4_3.pdf'],
  ['4-4', 'Almoxarifado geral do CBMERJ', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2025/07/ICG-4_4.pdf'],
  ['5-1', 'Concessão da gratificação de raio X e outras providências', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2026/01/ICG-5-01.pdf'],
  ['6-1', 'Regimento interno do Fundo de Saúde do CBMERJ', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2026/02/ICG-6-01.pdf'],
  ['6-2', 'Regimento interno do Fundo de Saúde do CBMERJ', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2026/05/ICG_6-2.pdf'],
  ['7-1', 'Diretrizes gerais para implementação e emprego da função de subtenente adjunto ao comando', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2026/05/ICG_7-1.pdf'],
  ['1-8', 'ICG 1-08 - versão anterior', 'https://www.cbmerj.rj.gov.br/wp-content/uploads/2024/04/138064-_ICG-08-EXCLUSAO-TEMPORARIO.pdf'],
]

function slugify(value) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function cleanText(value) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#8211;|&ndash;/gi, '-').replace(/&#8217;|&rsquo;/gi, "'").replace(/&#8220;|&ldquo;|&#8221;|&rdquo;/gi, '"').replace(/\s+/g, ' ').trim()
}

// Usa apenas o título do ato (nunca a URL) para o ano: a pasta de upload reflete a data de
// coleta do arquivo, não a data do ato, e não pode alimentar o filtro de ano (ver seção 3.1
// do plano de implementação). Quando o título traz mais de um ano (ex.: "1ª edição - 2019 -
// atualizada - Portaria .../2025"), o primeiro corresponde ao ato/edição original.
function yearFromTitle(title) {
  const years = title.match(/(?:19|20)\d{2}/g)
  return years ? Number(years[0]) : null
}

// Extrai um número de identificação a partir do texto do título. NT/ICG têm prioridade porque
// aparecem mesmo em atos que também citam a portaria que os alterou (ex.: "NT 2-02 ... -
// atualizada - Portaria 1317/2025" deve ser identificado como NT 2-02, não como a portaria).
function extractNumber(title) {
  const codeMatch = title.match(/\b(?:NT|ICG)\s*[-_]?\s*\d+[-_]\d+/i)
  if (codeMatch) return codeMatch[0].toUpperCase().replace(/_/g, '-').replace(/\s+/g, ' ')
  const actMatch = title.match(/\b(decreto[\s-]*lei|decreto|lei estadual|lei|portaria(?:\s+cbmerj)?|resolu[cç][aã]o(?:\s+[a-zà-ÿ]+)?|nota\s+dgst|nota\s+chemg|aditamento administrativo(?:\s+de\s+servi[cç]os\s+t[eé]cnicos)?)\s*n?[ºo°.]*\s*(\d+(?:\.\d+)?(?:\/\d+)?)/i)
  // "Resolução Nº 094": o "N" do "Nº" não é sigla de órgão emissor.
  if (actMatch) return `${actMatch[1].replace(/\s+N$/i, '').replace(/\s+/g, ' ').trim()} ${actMatch[2]}`.replace(/\s+/g, ' ')
  const other = title.match(/\b(parecer t[eé]cnico|regulamento t[eé]cnico|nota\s+[A-Z][A-Z/.-]*(?:\s+[A-Z-]+)?)\s*n?[ºo°.]*\s*([\w/.-]*\d[\w/.-]*)/i)
  if (other) return `${other[1].replace(/\s+/g, ' ')} ${other[2]}`
  return ''
}

// Classifica pelo INÍCIO do título do ato, não por qualquer ocorrência da palavra no texto:
// uma nota administrativa que cita "Decreto Nº 42/2018" no meio da descrição, ou uma NT cujo
// título cita a portaria que a atualizou, não deve virar "Decreto" ou "Portaria" só porque essa
// palavra aparece incidentalmente no corpo do título (ver seção 3.2 do plano).
function classify(title, collection) {
  if (collection === 'Instruções normativas') return 'Instrução normativa'
  const head = title.trim()
  if (/^(?:NT)\s*[-_]?\s*\d/i.test(head)) return 'Nota técnica'
  if (/^ICG\s*[-_]?\s*\d/i.test(head)) return 'Instrução normativa'
  if (/^decreto[\s-]*lei\b/i.test(head)) return 'Decreto-lei'
  if (/^(?:decreto\b|c[oó]digo de seguran[cç]a|coscip\b)/i.test(head)) return 'Decreto'
  if (/^lei\b/i.test(head)) return isFederalLaw(head) ? 'Lei federal' : 'Lei estadual'
  if (/^resolu[cç][aã]o/i.test(head)) return 'Resolução'
  if (/^portaria/i.test(head)) return 'Portaria'
  if (/^parecer t[eé]cnico/i.test(head)) return 'Parecer técnico'
  if (/^regulamento t[eé]cnico/i.test(head)) return 'Regulamento técnico'
  if (/^(?:nota\s+[a-z]|(?:anexo|complemento) ao aditamento|aditamento administrativo)/i.test(head)) return 'Nota administrativa'
  // Títulos que começam pelo assunto e só citam o ato no fim ("Estações de recarga ... - Nota
  // CHEMG 326/2025"): uma nota numerada no próprio título identifica o documento.
  if (/\bnota\s+[A-Z][A-Z/.-]*(?:\s+[A-Z-]+)?\s+(?:n[ºo°.]*\s*)?\d+\/\d{4}/i.test(head)) return 'Nota administrativa'
  return 'Documento relacionado'
}

// A numeração das leis estaduais do RJ só passou de 9.000 em 2020; um número acima disso com
// ano anterior é de lei federal (ex.: Lei 10.519/2002, sobre rodeios, publicada na página de
// regularização junto das estaduais).
function isFederalLaw(title) {
  const number = Number(title.match(/^lei\s*n?[ºo°.]*\s*([\d.]+)/i)?.[1]?.replace(/\./g, ''))
  const year = yearFromTitle(title)
  return number > 9000 && year && year < 2020
}

const isHistorical = (record) => /revogad|vers(?:ão|ões) anterior/i.test(`${record.title} ${record.group}`)

// Situação jurídica só quando há uma fonte que a sustente. A página de Notas Técnicas separa
// as versões atuais das "versões anteriores", e a de Instruções Normativas lista as ICGs em
// vigor (marcando a versão anterior no título): para NT e ICG, estar listada como versão atual
// na página oficial do próprio órgão emissor é evidência de vigência. Leis estaduais recebem a
// situação da ALERJ mais abaixo. Os demais tipos continuam "Não verificada".
function statusFor(record, type) {
  if (isHistorical(record)) return { status: 'Histórica', statusSource: `Indicada como versão anterior/revogada na página oficial do CBMERJ (coleta de ${today})` }
  if (type === 'Nota técnica' || type === 'Instrução normativa') return { status: 'Em vigor', statusSource: `Listada como versão atual na página oficial do CBMERJ (coleta de ${today})` }
  return { status: 'Não verificada', statusSource: '' }
}

// Só a página de Notas Técnicas tem cabeçalhos de agrupamento confiáveis (GRUPO 1, Portarias,
// versões anteriores...). A página de regularização mistura um link de call-to-action ("Acessar
// Notas Técnicas") marcado como cabeçalho com a única seção real da tabela de leis ("Legislação");
// usar esses cabeçalhos lá rotularia leis e decretos com o texto do botão. Por isso o agrupamento
// por cabeçalho só é ativado para a coleção que o comporta.
function parsePage(html, source) {
  const items = []
  let group = source.collection
  const trackHeadings = source.collection === 'Notas técnicas'
  const tokenPattern = /<(h[1-6]|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi
  for (const match of html.matchAll(tokenPattern)) {
    const [, tag, attributes, body] = match
    const text = cleanText(body)
    if (tag.toLowerCase().startsWith('h') && text) {
      if (trackHeadings && /grupo|portarias|código|versões anteriores|notas técnicas/i.test(text)) group = text
      continue
    }
    if (tag.toLowerCase() !== 'a') continue
    const href = attributes.match(/href=["']([^"']+\.pdf[^"']*)["']/i)?.[1]
    if (!href) continue
    const url = new URL(href, source.page).href.replace(/^http:/, 'https:')
    const title = text || decodeURIComponent(url.split('/').pop()).replace(/\.pdf.*$/i, '').replace(/[_-]+/g, ' ')
    items.push({ url, title, group, collection: source.collection })
  }
  return items
}

const today = new Date().toISOString().slice(0, 10)
const pages = await Promise.all(sources.map(async (source) => ({ source, html: await (await fetch(source.page)).text() })))
const records = pages.flatMap(({ source, html }) => parsePage(html, source))
  .concat(publishedIcg.map(([number, title, url]) => ({ url, title: `ICG ${number} - ${title}`, group: `Grupo ${number.split('-')[0]} - Instruções Normativas`, collection: 'Instruções normativas' })))
  .filter((record) => !excludedUrlPatterns.some((pattern) => pattern.test(record.url)))
  .filter((record) => !excludedTitlePatterns.some((pattern) => pattern.test(record.title.trim())))

// Páginas como a de regularização repetem o mesmo PDF em dois links (texto + ícone de
// download); o link-ícone não tem texto e cairia no título genérico derivado do nome do
// arquivo. Mantemos, para cada URL, o registro com o título mais informativo.
const bestByUrl = new Map()
for (const record of records) {
  const current = bestByUrl.get(record.url)
  if (!current || record.title.length > current.title.length) bestByUrl.set(record.url, record)
}

const unique = [...bestByUrl.values()].map((record) => {
  const type = classify(record.title, record.collection)
  const sourcePage = sources.find((source) => source.collection === record.collection)?.page ?? sources[0].page
  return {
    id: `${slugify(type)}-${urlId(record.url)}`,
    type,
    number: extractNumber(record.title),
    title: record.title,
    year: yearFromTitle(record.title),
    theme: record.group.replace(/^NOTAS TÉCNICAS - /i, '').replace(/^Grupo \d+ - /i, ''),
    ...statusFor(record, type),
    edition: isHistorical(record) ? 'Versão histórica' : 'Publicação oficial',
    origin: 'CBMERJ',
    source: sourcePage,
    pdf: record.url,
    description: `Registro coletado da página oficial: ${record.group}. Metadados sujeitos a revisão curatorial.`,
  }
})

// Leis estaduais da ALERJ (scripts/data/alerj-laws.json, gerado por fetch-alerj.mjs). A ficha
// técnica da ALERJ informa a situação oficial de cada lei. Quando a mesma lei já veio da página
// de regularização do CBMERJ (com o PDF), o registro do CBMERJ é mantido e só recebe a situação
// e o link para o texto na ALERJ; as demais entram como registros próprios.
const alerjKinds = { 'lei ordinária': 'Lei estadual', 'lei complementar': 'Lei complementar', 'emenda constitucional': 'Emenda constitucional' }
const numberDigits = (value) => String(value ?? '').replace(/\D/g, '')
const formatLawNumber = (value) => Number(numberDigits(value)).toLocaleString('pt-BR')

function alerjStatus(law) {
  const situation = law.situation.trim()
  const adi = law.adiSituation && !/^n[aã]o consta$/i.test(law.adiSituation) ? ` Ação de inconstitucionalidade: ${law.adiSituation}.` : ''
  const statusSource = `Ficha técnica da ALERJ: “${situation || 'situação não informada'}” (coleta de ${alerjData.collectedAt}).${adi}`
  if (!situation) return { status: 'Não verificada', statusSource }
  if (/em vigor/i.test(situation)) return { status: 'Em vigor', statusSource }
  if (/revogad/i.test(situation)) return { status: 'Revogada', statusSource }
  return { status: situation.charAt(0).toUpperCase() + situation.slice(1).toLowerCase(), statusSource }
}

// As ementas da ALERJ vêm em caixa alta; converte para caixa de frase, preservando siglas e
// nomes próprios recorrentes neste acervo.
const properNouns = ['Rio de Janeiro', 'Corpo de Bombeiros Militar', 'Corpo de Bombeiros', 'Bombeiros Militares', 'Polícia Militar', 'Defesa Civil', 'Estado', 'Governo', 'Poder Executivo', 'Assembleia Legislativa', 'Constituição']
function sentenceCase(value) {
  if (value !== value.toUpperCase()) return value
  let text = value.toLowerCase().replace(/^./, (char) => char.toUpperCase())
  for (const noun of properNouns) text = text.replace(new RegExp(noun.toLowerCase(), 'g'), noun)
  return text.replace(/\b(cbmerj|sedec|pmerj|rj|ii|iii|iv|vi|vii|viii|ix|xi)\b/g, (match) => match.toUpperCase())
}

const alerjPath = 'scripts/data/alerj-laws.json'
const alerjData = existsSync(alerjPath) ? JSON.parse(await readFile(alerjPath, 'utf8')) : { collectedAt: null, laws: [] }
const alerjSource = 'https://www3.alerj.rj.gov.br/lotus_notes/default.asp?id=144'
let alerjMerged = 0
for (const law of alerjData.laws) {
  const type = alerjKinds[law.kind.toLowerCase()]
  if (!type) continue
  const digits = numberDigits(law.number)
  const existing = unique.find((doc) => doc.origin === 'CBMERJ' && doc.type === type && numberDigits(doc.number) === digits && doc.year === law.year)
  const status = alerjStatus(law)
  const extra = { ...status, alerjUrl: law.url, revocation: law.revocation || '', author: law.author || '' }
  if (existing) { Object.assign(existing, extra); alerjMerged += 1; continue }
  const label = type === 'Lei estadual' ? 'Lei' : type === 'Lei complementar' ? 'Lei Complementar' : 'Emenda Constitucional'
  unique.push({
    id: `alerj-${slugify(label)}-${digits}-${law.year}`,
    type,
    number: `${label} ${formatLawNumber(law.number)}`,
    title: sentenceCase(law.title || `${label} nº ${law.number}/${law.year}`),
    year: law.year,
    theme: 'Legislação estadual (ALERJ)',
    edition: 'Texto compilado pela ALERJ',
    origin: 'ALERJ',
    source: alerjSource,
    pdf: law.url,
    format: 'html',
    description: sentenceCase(law.ementa),
    ...extra,
  })
}

// Boletim de publicação lido no próprio PDF (scripts/data/pdf-metadata.json, gerado por
// extract-text.mjs). Uma menção a boletim anterior ao ano do ato é citação de outra norma, não
// a publicação dele; quando o título não traz ano (caso das ICGs), o boletim o fornece.
const pdfMetadataPath = 'scripts/data/pdf-metadata.json'
const pdfMetadata = existsSync(pdfMetadataPath) ? JSON.parse(await readFile(pdfMetadataPath, 'utf8')) : {}
for (const doc of unique) {
  const meta = pdfMetadata[doc.pdf]
  if (meta?.textless) doc.textless = true
  const publication = meta?.publication
  if (!publication) continue
  const publicationYear = Number(publication.date.slice(0, 4))
  if (doc.year && publicationYear < doc.year) continue
  doc.publication = { ...publication, source: 'Cabeçalho do PDF' }
  if (!doc.year) { doc.year = publicationYear; doc.yearSource = `Boletim da SEDEC/CBMERJ nº ${publication.bulletin}, de ${publication.date.split('-').reverse().join('/')}` }
}

// Relações entre atos: a página de notas técnicas guarda cada edição como um registro
// isolado, mas o usuário precisa navegar entre versões da mesma NT/ICG e entre um ato e a
// portaria/decreto que o aprovou ou alterou (ver seções 3.2 e 10 do plano — "alterada" é uma
// relação, não um campo booleano). Derivamos essas ligações só de padrões já presentes no
// próprio título coletado, nunca inventando uma relação sem evidência textual.
function baseCode(number) {
  const match = number && number.match(/^(?:NT|ICG)\s*[-_]?\s*\d+[-_]\d+/i)
  return match ? match[0].toUpperCase() : null
}
function findPortariaReference(title) {
  return title.match(/portaria(?:\s+cbmerj)?\s*n?[ºo°.]*\s*(\d+)\s*\/\s*\d{4}/i)?.[1] ?? null
}
function findDecreeReference(title) {
  return title.match(/alterado pelo decreto\s*n?[ºo°.]*\s*([\d.]+)/i)?.[1]?.replace(/\./g, '') ?? null
}
function findByNumericNumber(type, digits) {
  return unique.find((candidate) => candidate.type === type && candidate.number && candidate.number.replace(/\D/g, '') === digits)
}

const byId = new Map(unique.map((doc) => [doc.id, doc]))
const byBaseCode = new Map()
for (const doc of unique) {
  const code = baseCode(doc.number)
  if (!code) continue
  if (!byBaseCode.has(code)) byBaseCode.set(code, [])
  byBaseCode.get(code).push(doc.id)
}
for (const doc of unique) {
  const related = new Set()
  const code = baseCode(doc.number)
  if (code) for (const id of byBaseCode.get(code)) related.add(id)
  const portariaDigits = findPortariaReference(doc.title)
  const portariaTarget = portariaDigits && findByNumericNumber('Portaria', portariaDigits)
  if (portariaTarget) related.add(portariaTarget.id)
  const decreeDigits = findDecreeReference(doc.title)
  const decreeTarget = decreeDigits && findByNumericNumber('Decreto', decreeDigits)
  if (decreeTarget) related.add(decreeTarget.id)
  related.delete(doc.id)
  doc.relatedIds = [...related]
}
for (const doc of unique) {
  for (const relatedId of doc.relatedIds) {
    const target = byId.get(relatedId)
    if (target && target.id !== doc.id && !target.relatedIds.includes(doc.id)) target.relatedIds.push(doc.id)
  }
}

await mkdir('src/data', { recursive: true })
await writeFile('src/data/documents.js', `// Gerado por scripts/build-catalog.mjs em ${today}\nexport const collectedAt = ${JSON.stringify(today)}\nexport const documents = ${JSON.stringify(unique, null, 2)}\n`, 'utf8')
const counts = unique.reduce((acc, item) => ({ ...acc, [item.type]: (acc[item.type] || 0) + 1 }), {})
console.log(`Catálogo gerado: ${unique.length} registros.`)
console.log(counts)
console.log(`ALERJ: ${alerjData.laws.length} leis lidas, ${alerjMerged} mescladas a registros do CBMERJ.`)
console.log(unique.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}))
