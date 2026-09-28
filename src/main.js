import './style.css'
import MiniSearch from 'minisearch'
import { collectedAt, documents } from './data/documents.js'
import { searchIndexOptions, searchQueryOptions } from './search-options.js'
import { initLivro } from './livro.js'

const officialSources = { cbmerj: 'https://www.cbmerj.rj.gov.br/para-o-cidadao/regularizacao/', alerj: 'https://www3.alerj.rj.gov.br/lotus_notes/default.asp?id=144' }
const documentsById = new Map(documents.map((document) => [document.id, document]))
const defaults = { query: '', type: 'Todos', year: 'Todos', theme: 'Todos', status: 'Todos', origin: 'Todos', sort: 'recent', page: 1, pageSize: 20 }
const state = { ...defaults }
const pageSizes = [10, 20, 50, 100]
const typeIcons = { 'Nota técnica': 'NT', Portaria: 'PT', Decreto: 'DEC', 'Decreto-lei': 'DL', 'Lei estadual': 'LEI', 'Lei complementar': 'LC', 'Emenda constitucional': 'EC', 'Lei federal': 'LF', Resolução: 'RES', 'Nota administrativa': 'NA', 'Instrução normativa': 'IN', 'Parecer técnico': 'PAR', 'Regulamento técnico': 'RT', 'Documento relacionado': 'DOC' }
// Situações que vêm de uma fonte oficial (ALERJ, página do CBMERJ); "Não verificada" é o
// padrão quando nenhuma fonte informa a vigência (ver statusSource em cada registro).
const statusClasses = { 'Em vigor': 'in-force', Revogada: 'revoked', Histórica: 'historical', 'Não verificada': 'unverified' }
const statusOrder = ['Em vigor', 'Revogada', 'Histórica', 'Não verificada']

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const statusClass = (status) => statusClasses[status] ?? 'revoked'
const count = (field) => documents.reduce((acc, document) => ({ ...acc, [document[field]]: (acc[document[field]] || 0) + 1 }), {})
const unique = (field) => [...new Set(documents.map((document) => document[field]))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
const years = [...new Set(documents.map((document) => document.year).filter(Boolean))].sort((a, b) => b - a).map(String)
const statuses = [...statusOrder.filter((status) => documents.some((document) => document.status === status)), ...unique('status').filter((status) => !statusOrder.includes(status))]
const yearRange = years.length ? `${years.at(-1)}—${years[0]}` : 'Ano não informado'
const verifiedCount = documents.filter((document) => document.status !== 'Não verificada').length
const options = (values, counts) => values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}${counts ? ` (${counts[value]})` : ''}</option>`).join('')

document.querySelector('#app').innerHTML = `
<a class="skip-link" href="#top">Pular para o conteúdo</a>
<header class="site-header"><div class="header-inner">
  <a class="brand" href="#top" aria-label="Biblioteca Normativa CBMERJ, início"><span class="brand-mark">CB</span><span><strong>Biblioteca Normativa</strong><small>Corpo de Bombeiros Militar do Estado do Rio de Janeiro</small></span></a>
  <nav aria-label="Navegação principal"><a href="#acervo">Acervo</a><a href="#livro">Livro de Ordens</a><a href="#situacao">Situação jurídica</a><a href="#sobre">Sobre o projeto</a><a class="header-button" href="${officialSources.cbmerj}" target="_blank" rel="noreferrer">Fontes oficiais <span aria-hidden="true">↗</span></a></nav>
</div></header>
<main id="top" tabindex="-1">
  <section class="hero" aria-labelledby="hero-title"><div class="hero-inner">
    <div class="eyebrow"><span class="signal-dot"></span> ACERVO PILOTO · CBMERJ + ALERJ</div>
    <h1 id="hero-title">A norma certa,<br><em>na hora certa.</em></h1>
    <p class="hero-copy">Um lugar para encontrar, conferir e consultar as normas que orientam o trabalho do CBMERJ.</p>
    <form id="search-form" class="searchbar"><label class="sr-only" for="search-input">Buscar por palavra, assunto ou número</label><span class="search-icon" aria-hidden="true">⌕</span><input id="search-input" type="search" placeholder="Busque por assunto, número ou expressão..." autocomplete="off"><button type="submit">Buscar <span aria-hidden="true">↵</span></button></form>
    <p class="search-hint">Experimente <button class="text-button" data-query="extintores">“extintores”</button>, <button class="text-button" data-query="1120/2020">“1120/2020”</button>, <button class="text-button" data-query="guarda-vidas">“guarda-vidas”</button> ou <button class="text-button" data-query="regularização">“regularização”</button></p>
  </div><div class="hero-stamp" aria-hidden="true"><span>190</span><small>anos de<br>serviço</small></div></section>
  <section class="stats-strip" aria-label="Resumo do acervo">
    <div><strong>${documents.length}</strong><span>documentos<br>no acervo</span></div>
    <div><strong>${unique('type').length}</strong><span>tipos<br>documentais</span></div>
    <div><strong>${yearRange}</strong><span>período<br>representado</span></div>
    <div class="stats-note"><strong>${verifiedCount}</strong><span>com situação<br>informada por fonte oficial</span></div>
  </section>
  <section id="acervo" class="collection-section">
    <div class="section-heading"><div><p class="eyebrow">NAVEGUE PELO ACERVO</p><h2>O que você procura?</h2></div><p class="section-intro">Comece por um tipo de documento<br>ou refine sua busca com filtros.</p></div>
    <div class="type-grid" id="type-grid"></div>
  </section>
  <section class="results-section" aria-labelledby="results-title">
    <div class="results-toolbar">
      <div><p class="eyebrow">RESULTADOS DA BUSCA</p><h2 id="results-title">Acervo completo <span id="result-count"></span></h2></div>
      <div class="toolbar-controls">
        <label class="sort-control">Ordenar por <select id="sort-select"><option value="relevance">Relevância</option><option value="recent">Mais recentes</option><option value="oldest">Mais antigos</option><option value="az">Título (A–Z)</option></select></label>
        <label class="sort-control">Por página <select id="page-size">${pageSizes.map((size) => `<option value="${size}">${size}</option>`).join('')}</select></label>
      </div>
    </div>
    <div class="filter-panel">
      <div class="filter-field search-filter"><label for="inline-search">Busca atual</label><input id="inline-search" type="search" placeholder="Palavra ou número"></div>
      <div class="filter-field"><label for="type-filter">Tipo</label><select id="type-filter"><option value="Todos">Todos</option>${options(unique('type'), count('type'))}</select></div>
      <div class="filter-field"><label for="origin-filter">Fonte</label><select id="origin-filter"><option value="Todos">Todas</option>${options(unique('origin'), count('origin'))}</select></div>
      <div class="filter-field"><label for="theme-filter">Página de origem</label><select id="theme-filter"><option value="Todos">Todas</option>${options(unique('theme'), count('theme'))}</select></div>
      <div class="filter-field"><label for="year-filter">Ano</label><select id="year-filter"><option value="Todos">Todos</option>${options([...years, 'Sem ano'])}</select></div>
      <div class="filter-field"><label for="status-filter">Situação</label><select id="status-filter"><option value="Todos">Todas</option>${options(statuses, count('status'))}</select></div>
      <button id="clear-filters" class="clear-button" type="button">Limpar filtros</button>
    </div>
    <div id="active-filters" class="active-filters" aria-live="polite"></div>
    <div id="results-list" class="results-list"></div>
    <nav id="pagination" class="pagination" aria-label="Paginação dos resultados"></nav>
  </section>
  <section id="livro" class="results-section livro-section" aria-labelledby="livro-title">
    <div class="results-toolbar"><div><p class="eyebrow">LIVRO DE ORDENS</p><h2 id="livro-title">O que foi publicado em boletim</h2></div><p class="section-intro">Cada item indica onde o ato está:<br>no acervo, ou em qual boletim consultar.</p></div>
    <div id="livro-root"></div>
  </section>
  <section id="situacao" class="status-section" aria-labelledby="status-title">
    <div><p class="eyebrow">SITUAÇÃO JURÍDICA</p><h2 id="status-title">De onde vem cada situação</h2></div>
    <dl class="status-legend">
      <div><dt><span class="tag in-force">Em vigor</span></dt><dd>Leis: a ficha técnica da ALERJ informa “Em Vigor”. Notas técnicas e ICGs: listadas como versão atual na página oficial do CBMERJ.</dd></div>
      <div><dt><span class="tag revoked">Revogada</span></dt><dd>A ALERJ informa revogação (ou outra situação, como inconstitucionalidade), com o texto da revogação quando disponível.</dd></div>
      <div><dt><span class="tag historical">Histórica</span></dt><dd>Versão anterior ou revogada, conforme indicado na própria página oficial do CBMERJ.</dd></div>
      <div><dt><span class="tag unverified">Não verificada</span></dt><dd>Nenhuma fonte oficial consultada informa a vigência: decretos, resoluções, portarias e notas administrativas. Exige revisão documental.</dd></div>
    </dl>
  </section>
  <section id="sobre" class="about-section">
    <div class="about-marker">01<br><span>/</span></div>
    <div><p class="eyebrow">SOBRE ESTE MVP</p><h2>Um acervo organizado<br>para servir melhor.</h2></div>
    <div class="about-copy"><p>Este é um primeiro recorte da Biblioteca Normativa CBMERJ. Os documentos apontam para fontes oficiais — o site do CBMERJ e a base de legislação da ALERJ — e cada registro informa sua natureza, edição e procedência.</p><p class="muted">A situação exibida reproduz o que a fonte oficial informa na data da coleta; não substitui a consulta ao Diário Oficial.</p><a class="arrow-link" href="${officialSources.alerj}" target="_blank" rel="noreferrer">Base de legislação da ALERJ <span aria-hidden="true">→</span></a></div>
  </section>
</main>
<footer><div class="footer-brand"><span class="brand-mark">CB</span><span><strong>Biblioteca Normativa</strong><small>Um projeto de organização e acesso</small></span></div><p>Acervo piloto · Última coleta: ${escapeHtml(collectedAt)}</p></footer>
<dialog id="document-dialog" aria-labelledby="dialog-title"><button class="dialog-close" id="dialog-close" aria-label="Fechar detalhes">×</button><div id="dialog-content"></div></dialog>`

const $ = (selector) => document.querySelector(selector)
const elements = { typeGrid: $('#type-grid'), results: $('#results-list'), pagination: $('#pagination'), count: $('#result-count'), inlineSearch: $('#inline-search'), searchInput: $('#search-input'), type: $('#type-filter'), origin: $('#origin-filter'), year: $('#year-filter'), theme: $('#theme-filter'), status: $('#status-filter'), sort: $('#sort-select'), pageSize: $('#page-size'), active: $('#active-filters'), dialog: $('#document-dialog'), dialogContent: $('#dialog-content') }
const filterFields = ['type', 'origin', 'theme', 'year', 'status']
const filterLabels = { type: 'Tipo', origin: 'Fonte', theme: 'Página', year: 'Ano', status: 'Situação' }

let searchIndex = null
fetch('./search-index.json')
  .then((response) => response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`)))
  .then((json) => { searchIndex = MiniSearch.loadJSON(json, searchIndexOptions); if (state.query) renderResults() })
  .catch(() => { searchIndex = null })

function sortYear(document, direction) { return document.year ?? (direction === 'oldest' ? Infinity : -Infinity) }

function filteredDocuments() {
  const query = normalize(state.query)
  const searchResults = state.query && searchIndex ? searchIndex.search(state.query, searchQueryOptions) : []
  const relevance = new Map(searchResults.map((result) => [result.id, result.score]))
  const result = documents.filter((document) => {
    const haystack = normalize(`${document.number} ${document.title} ${document.theme} ${document.type} ${document.description}`)
    const textMatch = !query || haystack.includes(query) || relevance.has(document.id)
    const yearMatch = state.year === 'Todos' || (state.year === 'Sem ano' ? !document.year : String(document.year) === state.year)
    return textMatch && yearMatch && ['type', 'origin', 'theme', 'status'].every((field) => state[field] === 'Todos' || document[field] === state[field])
  })
  const compare = {
    az: (a, b) => a.title.localeCompare(b.title, 'pt-BR'),
    oldest: (a, b) => sortYear(a, 'oldest') - sortYear(b, 'oldest'),
    relevance: (a, b) => (relevance.get(b.id) ?? 0) - (relevance.get(a.id) ?? 0),
    recent: (a, b) => sortYear(b, 'recent') - sortYear(a, 'recent'),
  }
  return result.sort(compare[state.sort] ?? compare.recent)
}

function renderTypes() {
  const counts = count('type')
  const items = [{ name: 'Todos', icon: '✦', label: 'Acervo completo', total: documents.length }, ...unique('type').map((name) => ({ name, icon: typeIcons[name] ?? 'DOC', label: name, total: counts[name] }))]
  elements.typeGrid.innerHTML = items.map((item) => `<button type="button" class="type-card ${state.type === item.name ? 'selected' : ''}" data-type="${escapeHtml(item.name)}" aria-pressed="${state.type === item.name}"><span class="type-icon">${item.icon}</span><span class="type-name">${escapeHtml(item.label)}</span><strong>${item.total}</strong><small>registros</small></button>`).join('')
}

function statusTag(document) {
  const title = document.statusSource ? ` title="${escapeHtml(document.statusSource)}"` : ''
  return `<span class="tag ${statusClass(document.status)}"${title}>${escapeHtml(document.status)}</span>`
}

// Muitos títulos já começam pelo próprio número ("NT 2-16 - ...", "Portaria CBMERJ Nº 1102, ...");
// nesses casos o número não é repetido antes do título.
const compact = (value) => normalize(value).replace(/\bn\s*[ºo°]\.?\s*/g, '').replace(/[^a-z0-9]/g, '')
const titleRepeatsNumber = (document) => document.number && compact(document.title).startsWith(compact(document.number))

function resultMarkup(document) {
  return `<article class="result-item">
    <div class="result-icon">${typeIcons[document.type] ?? 'DOC'}</div>
    <div class="result-main">
      <div class="result-meta"><span>${escapeHtml(document.type)}</span><span>·</span><span>${document.year ?? 'Ano não informado'}</span>${statusTag(document)}</div>
      <h3>${document.number && !titleRepeatsNumber(document) ? `${escapeHtml(document.number)} <span>—</span> ` : ''}${escapeHtml(document.title)}</h3>
      <p>${escapeHtml(document.description)}</p>
      <div class="result-tags"><span>${escapeHtml(document.origin)}</span><span>${escapeHtml(document.theme)}</span></div>
    </div>
    <div class="result-actions"><button class="read-button" data-open="${document.id}">Ver detalhes <span aria-hidden="true">→</span></button><a href="${escapeHtml(document.pdf)}" target="_blank" rel="noreferrer">${document.format === 'html' ? 'Texto na ALERJ ↗' : 'Abrir PDF ↗'}</a></div>
  </article>`
}

// Números de página com reticências: sempre a primeira, a última e duas vizinhas da atual.
function pageNumbers(current, total) {
  const pages = [...new Set([1, total, current - 2, current - 1, current, current + 1, current + 2])].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b)
  return pages.flatMap((page, index) => index && page - pages[index - 1] > 1 ? ['…', page] : [page])
}

function renderPagination(total, totalPages) {
  if (totalPages <= 1) { elements.pagination.innerHTML = ''; return }
  const button = (page, label, disabled, extra = '') => `<button type="button" class="page-button ${extra}" data-page="${page}" ${disabled ? 'disabled' : ''}>${label}</button>`
  const first = (state.page - 1) * state.pageSize + 1
  elements.pagination.innerHTML = `<p class="page-summary">Mostrando ${first}–${Math.min(first + state.pageSize - 1, total)} de ${total}</p>
    <div class="page-buttons">
      ${button(state.page - 1, '← Anterior', state.page === 1, 'page-step')}
      ${pageNumbers(state.page, totalPages).map((page) => page === '…' ? '<span class="page-gap" aria-hidden="true">…</span>' : `<button type="button" class="page-button ${page === state.page ? 'current' : ''}" data-page="${page}" ${page === state.page ? 'aria-current="page"' : ''} aria-label="Página ${page}">${page}</button>`).join('')}
      ${button(state.page + 1, 'Próxima →', state.page === totalPages, 'page-step')}
    </div>`
}

function renderResults() {
  const result = filteredDocuments()
  const totalPages = Math.max(1, Math.ceil(result.length / state.pageSize))
  state.page = Math.min(Math.max(1, state.page), totalPages)
  const pageItems = result.slice((state.page - 1) * state.pageSize, state.page * state.pageSize)
  elements.count.textContent = `· ${result.length} ${result.length === 1 ? 'registro' : 'registros'}`
  elements.results.innerHTML = pageItems.length ? pageItems.map(resultMarkup).join('') : `<div class="empty-state"><span>⌕</span><h3>Nenhum registro encontrado</h3><p>Tente outra palavra ou remova algum filtro.</p><button class="clear-button" id="empty-clear">Limpar busca</button></div>`
  renderPagination(result.length, totalPages)
  const chips = filterFields.filter((field) => state[field] !== 'Todos').map((field) => `<button type="button" class="chip" data-remove="${field}" aria-label="Remover filtro ${filterLabels[field]}: ${escapeHtml(state[field])}">${filterLabels[field]}: ${escapeHtml(state[field])} <span aria-hidden="true">×</span></button>`)
  if (state.query) chips.push(`<button type="button" class="chip" data-remove="query" aria-label="Remover busca">“${escapeHtml(state.query)}” <span aria-hidden="true">×</span></button>`)
  elements.active.innerHTML = chips.join('')
  writeHash()
}

function syncControls() {
  elements.inlineSearch.value = state.query
  elements.searchInput.value = state.query
  for (const field of [...filterFields, 'sort']) elements[field].value = state[field]
  elements.pageSize.value = String(state.pageSize)
}

function render() { renderTypes(); renderResults(); syncControls() }

// Filtros e página ficam na URL (#q=...&tipo=...&p=2) para que uma busca possa ser
// compartilhada ou recarregada sem perder o contexto.
const hashKeys = { query: 'q', type: 'tipo', origin: 'fonte', theme: 'pagina', year: 'ano', status: 'situacao', sort: 'ordem', page: 'p', pageSize: 'por' }
function writeHash() {
  const params = new URLSearchParams()
  for (const [field, key] of Object.entries(hashKeys)) if (state[field] !== defaults[field]) params.set(key, state[field])
  const hash = params.toString()
  // Âncoras de seção (#livro, #sobre...) não são estado de filtro e não devem ser apagadas.
  if (!hash && !isFilterHash()) return
  if (hash !== location.hash.slice(1)) history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search)
}
const isFilterHash = () => [...new URLSearchParams(location.hash.slice(1)).keys()].some((key) => Object.values(hashKeys).includes(key))
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1))
  if (!isFilterHash()) return
  for (const [field, key] of Object.entries(hashKeys)) {
    const value = params.get(key)
    if (value === null) continue
    state[field] = typeof defaults[field] === 'number' ? Number(value) || defaults[field] : value
  }
  if (!pageSizes.includes(state.pageSize)) state.pageSize = defaults.pageSize
}

function relatedMarkup(document) {
  const related = (document.relatedIds ?? []).map((id) => documentsById.get(id)).filter(Boolean)
  if (!related.length) return ''
  return `<div class="dialog-related"><h4>Documentos relacionados</h4><ul>${related.map((item) => `<li><button type="button" class="related-link" data-open="${item.id}">${escapeHtml(item.number || item.type)} — ${escapeHtml(item.title)}</button>${statusTag(item)}</li>`).join('')}</ul></div>`
}

function showDocument(id) {
  const document = documentsById.get(id)
  const extra = [
    document.publication?.bulletin && ['Publicação', `Boletim da SEDEC/CBMERJ nº ${document.publication.bulletin}${document.publication.date ? `, de ${document.publication.date.split('-').reverse().join('/')}` : ''} (${document.publication.source})`],
    document.yearSource && ['Origem do ano', document.yearSource],
    document.statusSource && ['Fonte da situação', document.statusSource],
    document.revocation && ['Texto da revogação', document.revocation],
    document.author && ['Autoria', document.author],
  ].filter(Boolean)
  elements.dialogContent.innerHTML = `<p class="eyebrow">${escapeHtml(document.type)} · ${escapeHtml(document.origin)}</p>
    <h2 id="dialog-title" tabindex="-1">${escapeHtml(document.number || document.type)}</h2>
    <h3>${escapeHtml(document.title)}</h3>
    <dl>
      <div><dt>Situação</dt><dd>${statusTag(document)}</dd></div>
      <div><dt>Ano do ato/edição</dt><dd>${document.year ?? 'Não informado'}</dd></div>
      <div><dt>Edição</dt><dd>${escapeHtml(document.edition)}</dd></div>
      <div><dt>Página de origem</dt><dd>${escapeHtml(document.theme)}</dd></div>
      ${extra.map(([label, value]) => `<div class="wide"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
    </dl>
    <p class="dialog-note">${escapeHtml(document.description)}</p>
    ${relatedMarkup(document)}
    <div class="dialog-actions">
      <a class="primary-button" href="${escapeHtml(document.pdf)}" target="_blank" rel="noreferrer">${document.format === 'html' ? 'Ler texto integral' : 'Abrir PDF'} <span aria-hidden="true">↗</span></a>
      ${document.format === 'html' ? '' : `<a class="secondary-button" href="${escapeHtml(document.pdf)}" download>Baixar documento</a>`}
      ${document.alerjUrl && document.format !== 'html' ? `<a class="secondary-button" href="${escapeHtml(document.alerjUrl)}" target="_blank" rel="noreferrer">Texto na ALERJ ↗</a>` : ''}
      <a class="source-link" href="${escapeHtml(document.source)}" target="_blank" rel="noreferrer">Ver fonte oficial →</a>
    </div>`
  if (elements.dialog.open) elements.dialogContent.querySelector('#dialog-title').focus()
  else elements.dialog.showModal()
}

function setQuery(value) {
  const hadQuery = Boolean(state.query)
  state.query = value
  state.page = 1
  if (value && !hadQuery) state.sort = 'relevance'
  if (!value && hadQuery) state.sort = 'recent'
}
function setFilter(field, value) { state[field] = value; state.page = 1; render() }
const scrollToResults = () => $('.results-section').scrollIntoView({ behavior: 'smooth' })

$('#search-form').addEventListener('submit', (event) => { event.preventDefault(); setQuery(elements.searchInput.value.trim()); render(); scrollToResults() })
elements.inlineSearch.addEventListener('input', (event) => { setQuery(event.target.value); renderResults(); syncControls() })
for (const field of filterFields) elements[field].addEventListener('change', (event) => setFilter(field, event.target.value))
elements.sort.addEventListener('change', (event) => { state.sort = event.target.value; state.page = 1; renderResults() })
elements.pageSize.addEventListener('change', (event) => { state.pageSize = Number(event.target.value); state.page = 1; renderResults() })
elements.pagination.addEventListener('click', (event) => {
  const button = event.target.closest('[data-page]')
  if (!button || button.disabled) return
  state.page = Number(button.dataset.page)
  renderResults()
  $('.results-toolbar').scrollIntoView({ behavior: 'smooth' })
})
document.addEventListener('click', (event) => {
  const type = event.target.closest('[data-type]')
  const query = event.target.closest('[data-query]')
  const open = event.target.closest('[data-open]')
  const remove = event.target.closest('[data-remove]')
  if (type) { setFilter('type', type.dataset.type); scrollToResults() }
  if (query) { setQuery(query.dataset.query); render(); scrollToResults() }
  if (open) showDocument(open.dataset.open)
  if (remove) { if (remove.dataset.remove === 'query') { setQuery(''); render() } else setFilter(remove.dataset.remove, 'Todos') }
  if (event.target.closest('#empty-clear, #clear-filters')) { Object.assign(state, defaults, { pageSize: state.pageSize }); render() }
})
$('#dialog-close').addEventListener('click', () => elements.dialog.close())
elements.dialog.addEventListener('click', (event) => { if (event.target === elements.dialog) elements.dialog.close() })
window.addEventListener('hashchange', () => { readHash(); render() })

readHash()
render()
initLivro({ root: $('#livro-root'), documentsById, showDocument, escapeHtml, normalize, pageNumbers })
