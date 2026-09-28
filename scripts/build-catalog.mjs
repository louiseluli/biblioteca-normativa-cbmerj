import { mkdir, writeFile } from 'node:fs/promises'

const sources = [
  { page: 'https://www.cbmerj.rj.gov.br/notas-tecnicas/', collection: 'Notas técnicas' },
  { page: 'https://www.cbmerj.rj.gov.br/instrucoes-normativas-do-comando-geral/', collection: 'Instruções normativas' },
]

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

function cleanText(value) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#8211;|&ndash;/gi, '-').replace(/&#8217;|&rsquo;/gi, "'").replace(/&#8220;|&ldquo;|&#8221;|&rdquo;/gi, '"').replace(/\s+/g, ' ').trim()
}

function yearFrom(value) {
  const years = value.match(/(?:19|20)\d{2}/g) || []
  return years.length ? Number(years[years.length - 1]) : null
}

function classify(url, title, collection) {
  const value = `${url} ${title}`.toLowerCase()
  if (collection === 'Instruções normativas') return 'Instrução normativa'
  if (value.includes('portaria')) return 'Portaria'
  if (value.includes('decreto') || value.includes('coscip')) return 'Decreto'
  if (value.includes('nt-') || value.includes('nt_')) return 'Nota técnica'
  return 'Documento relacionado'
}

function statusFrom(url, title, collection) {
  const value = `${url} ${title}`.toLowerCase()
  if (value.includes('revogada') || value.includes('versões anteriores')) return 'Histórica'
  return collection === 'Instruções normativas' ? 'Não verificada' : 'Não verificada'
}

function parsePage(html, source) {
  const items = []
  let group = source.collection
  const tokenPattern = /<(h[1-6]|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi
  for (const match of html.matchAll(tokenPattern)) {
    const [, tag, attributes, body] = match
    const text = cleanText(body)
    if (tag.toLowerCase().startsWith('h') && text) {
      if (/grupo|portarias|código|versões anteriores|notas técnicas/i.test(text)) group = text
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

const pages = await Promise.all(sources.map(async (source) => ({ source, html: await (await fetch(source.page)).text() })))
const records = pages.flatMap(({ source, html }) => parsePage(html, source))
  .concat(publishedIcg.map(([number, title, url]) => ({ url, title: `ICG ${number} - ${title}`, group: `Grupo ${number.split('-')[0]} - Instruções Normativas`, collection: 'Instruções normativas' })))
const unique = [...new Map(records.map((record) => [record.url, record])).values()]
  .filter((record) => !record.url.includes('Documentacao_Regularizaca'))
  .map((record, index) => {
    const type = classify(record.url, record.title, record.collection)
    const sourcePage = record.collection === 'Instruções normativas' ? sources[1].page : sources[0].page
    const year = yearFrom(`${record.url} ${record.title}`)
    return {
      id: `${type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index + 1}`,
      type,
      number: record.title.match(/(?:NT|ICG)\s*[-_]?\s*\d+[-_]\d+/i)?.[0] || '',
      title: record.title,
      year,
      theme: record.group.replace(/^NOTAS TÉCNICAS - /i, '').replace(/^Grupo \d+ - /i, ''),
      status: statusFrom(record.url, record.title, type === 'Instrução normativa' ? 'Instruções normativas' : 'Notas técnicas'),
      edition: /revogad/i.test(record.title + record.url) ? 'Versão histórica' : 'Publicação oficial',
      source: sourcePage,
      pdf: record.url,
      description: `Registro coletado da página oficial: ${record.group}. Metadados sujeitos a revisão curatorial.`,
    }
  })

await mkdir('src/data', { recursive: true })
await writeFile('src/data/documents.js', `// Gerado por scripts/build-catalog.mjs em ${new Date().toISOString().slice(0, 10)}\nexport const documents = ${JSON.stringify(unique, null, 2)}\n`, 'utf8')
console.log(`Catálogo gerado: ${unique.length} registros (${unique.filter((item) => item.type === 'Nota técnica').length} notas técnicas, ${unique.filter((item) => item.type === 'Instrução normativa').length} instruções normativas).`)
