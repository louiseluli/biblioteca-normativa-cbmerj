// Livro de Ordens: índice das publicações em Boletim da SEDEC/CBMERJ (public/livro-de-ordens.json,
// gerado por scripts/build-livro.mjs a cada build). O arquivo tem ~7.600 itens e só é baixado
// quando alguém abre a aba do livro, faz uma busca ou abre um documento (ver start()). Cada item
// mostra onde o ato está: se o documento está no acervo, abre direto; se não, a localização
// (boletim, data e página do livro original) para consulta.
//
// No modo interno (npm run interno, só na máquina local) o mesmo arquivo vem com as entradas dos
// Boletins da SEDEC/CBMERJ baixados da Intranet: cada uma abre o PDF do boletim na página, e há
// busca no texto integral dos boletins (/interno/busca). No site público esses campos não existem.
const INTRANET = 'https://intranet.cbmerj.rj.gov.br/entrada'
const ALERJ_SEARCH = 'https://www3.alerj.rj.gov.br/lotus_notes/consultaNotes.asp?hdfId=5&txtquery='
const PAGE_SIZE = 25
const originLabels = { livro: 'Livro 2002–2019', acervo: 'Boletim citado no documento', manual: 'Curadoria', boletim: 'Sumário do boletim (Intranet)' }
const typeLabels = { Nota: 'Nota', 'Nota conjunta': 'Nota conjunta', Portaria: 'Portaria', Decreto: 'Decreto', Lei: 'Lei', 'Lei complementar': 'Lei complementar', Resolução: 'Resolução', 'Diário Oficial': 'Transcrição do DOERJ' }

const formatDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '')

export function initLivro({ root, documentsById, showDocument, escapeHtml, normalize, pageNumbers }) {
  const state = { query: '', year: 'Todos', type: 'Todos', issuer: 'Todos', availability: 'Todos', category: 'Todos', part: 'Todos', origin: 'Todos', page: 1 }
  let items = null
  let meta = null

  root.innerHTML = '<p class="livro-loading">Carregando o Livro de Ordens…</p>'

  let ready = null
  function start() {
    ready ??= fetch('./livro-de-ordens.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data) => {
        meta = data
        items = data.items.map((item, index) => ({ ...item, index, haystack: normalize(`${item.n ?? ''} ${item.s} ${item.a ?? ''} ${item.pn ?? ''} ${item.b ?? ''} ${formatDate(item.bd)} ${item.secao ?? ''}`) }))
        renderShell()
        renderList()
        return items
      })
      .catch((error) => { root.innerHTML = '<p class="livro-loading">Não foi possível carregar o Livro de Ordens.</p>'; throw error })
    return ready
  }

  function countBy(key) {
    return items.reduce((acc, item) => { const value = item[key]; if (value) acc[value] = (acc[value] || 0) + 1; return acc }, {})
  }

  function renderShell() {
    const years = [...new Set(items.map((item) => item.y).filter(Boolean))].sort((a, b) => b - a)
    const types = Object.entries(countBy('t')).sort((a, b) => b[1] - a[1])
    // Só os órgãos emissores com volume relevante; os demais continuam encontráveis pela busca.
    const issuers = Object.entries(countBy('o')).filter(([, total]) => total >= 15).sort((a, b) => a[0].localeCompare(b[0]))
    const inCollection = items.filter(hasDocument).length
    const option = ([value, total]) => `<option value="${escapeHtml(value)}">${escapeHtml(typeLabels[value] ?? value)} (${total.toLocaleString('pt-BR')})</option>`
    const select = (id, label, entries) => (entries.length > 1 ? `<div class="filter-field"><label for="${id}">${label}</label><select id="${id}"><option value="Todos">Todos</option>${entries.map(option).join('')}</select></div>` : '')
    const categories = Object.entries(countBy('cat')).sort((a, b) => b[1] - a[1])
    const parts = Object.entries(countBy('parte')).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
    const origins = Object.entries(countBy('src')).map(([value, total]) => [value, total])
    root.innerHTML = `
      <div class="livro-summary">
        <div><strong>${items.length.toLocaleString('pt-BR')}</strong><span>itens publicados<br>em boletim</span></div>
        <div><strong>${years.at(-1)}—${years[0]}</strong><span>período<br>coberto</span></div>
        <div><strong>${inCollection.toLocaleString('pt-BR')}</strong><span>com documento<br>${meta.interno ? 'ou página do boletim' : 'no acervo'}</span></div>
        <p>Base: ${escapeHtml(meta.source)}${meta.interno ? '' : ', com a continuação a partir dos boletins citados nos documentos do acervo'}. Atualizado em ${formatDate(meta.generatedAt)}.</p>
      </div>
      <div class="filter-panel livro-filters">
        <div class="filter-field search-filter"><label for="livro-search">Buscar no livro</label><input id="livro-search" type="search" placeholder="Assunto, ato, nº do boletim ou item"></div>
        <div class="filter-field"><label for="livro-year">Ano</label><select id="livro-year"><option value="Todos">Todos</option>${years.map((year) => `<option>${year}</option>`).join('')}</select></div>
        <div class="filter-field"><label for="livro-type">Tipo de ato</label><select id="livro-type"><option value="Todos">Todos</option>${types.map(option).join('')}</select></div>
        <div class="filter-field"><label for="livro-issuer">Órgão emissor</label><select id="livro-issuer"><option value="Todos">Todos</option>${issuers.map(option).join('')}</select></div>
        <div class="filter-field"><label for="livro-availability">Documento</label><select id="livro-availability"><option value="Todos">Todos</option><option value="acervo">Disponível</option><option value="referencia">Só a localização</option></select></div>
        ${select('livro-origin', 'Fonte', origins.map(([value, total]) => [value, total]))}
        ${select('livro-category', 'Categoria', categories)}
        ${select('livro-part', 'Parte do boletim', parts)}
      </div>
      <p id="livro-count" class="livro-count" aria-live="polite"></p>
      ${meta.interno ? '<section id="livro-fulltext" class="livro-fulltext" aria-live="polite" hidden></section>' : ''}
      <div id="livro-list" class="results-list"></div>
      <nav id="livro-pagination" class="pagination" aria-label="Paginação do Livro de Ordens"></nav>`
    // O rótulo de origem aparece por extenso nas opções.
    for (const optionElement of root.querySelectorAll('#livro-origin option')) if (originLabels[optionElement.value]) optionElement.textContent = optionElement.textContent.replace(optionElement.value, originLabels[optionElement.value])
    root.querySelector('#livro-search').value = state.query
    const bind = (id, field) => root.querySelector(id).addEventListener(field === 'query' ? 'input' : 'change', (event) => { state[field] = event.target.value; state.page = 1; renderList() })
    bind('#livro-search', 'query')
    bind('#livro-year', 'year')
    bind('#livro-type', 'type')
    bind('#livro-issuer', 'issuer')
    bind('#livro-availability', 'availability')
    for (const [id, field] of [['#livro-origin', 'origin'], ['#livro-category', 'category'], ['#livro-part', 'part']]) if (root.querySelector(id)) bind(id, field)
    root.querySelector('#livro-pagination').addEventListener('click', (event) => {
      const button = event.target.closest('[data-page]')
      if (!button || button.disabled) return
      state.page = Number(button.dataset.page)
      renderList()
      root.querySelector('.livro-filters').scrollIntoView({ behavior: 'smooth' })
    })
    root.querySelector('#livro-list').addEventListener('click', (event) => {
      const open = event.target.closest('[data-livro-open]')
      if (open) showDocument(open.dataset.livroOpen)
    })
  }

  const hasDocument = (item) => Boolean(item.doc || item.url || item.bol)
  const matchesQuery = (item, terms) => !terms.length || terms.every((term) => item.haystack.includes(term))
  // Plural e singular casam entre si ("extintores" encontra "EXTINTOR"): o livro usa os dois.
  const termsOf = (query) => normalize(query).split(/\s+/).filter(Boolean).map((term) => (term.length > 5 ? term.replace(/(?:es|s)$/, '') : term))

  function filtered() {
    const terms = termsOf(state.query)
    return items.filter((item) => matchesQuery(item, terms)
      && (state.year === 'Todos' || String(item.y) === state.year)
      && (state.type === 'Todos' || item.t === state.type)
      && (state.issuer === 'Todos' || item.o === state.issuer)
      && (state.availability === 'Todos' || (state.availability === 'acervo' ? hasDocument(item) : !hasDocument(item)))
      && (state.origin === 'Todos' || item.src === state.origin)
      && (state.category === 'Todos' || item.cat === state.category)
      && (state.part === 'Todos' || item.parte === state.part))
  }

  const bulletinText = (item) => (item.b ? `Boletim da SEDEC/CBMERJ nº ${escapeHtml(item.b)}${item.bd ? `, de ${formatDate(item.bd)}` : ''}` : 'Boletim não identificado no livro original')

  // Onde o ato está: documento do acervo (clicável), link informado pela curadoria, ou a
  // localização no boletim — que está na Intranet do CBMERJ, de acesso restrito.
  // Link para o PDF do boletim guardado localmente, aberto na página do item (modo interno).
  const bulletinLink = (item) => (item.bol ? `<a href="./interno/boletim/${escapeHtml(item.bol)}${item.bp ? `#page=${item.bp}` : ''}" target="_blank" rel="noreferrer">Abrir boletim${item.bp ? `, p. ${item.bp}` : ''} ↗</a>` : '')

  function locationMarkup(item) {
    const document = item.doc && documentsById.get(item.doc)
    if (item.bol && !document) {
      return `<div class="livro-location available"><span class="tag in-force">Boletim no acervo interno</span>${bulletinLink(item)}<span>${bulletinText(item)}${item.pn ? ` · publicado pela ${escapeHtml(item.pn)}` : ''}</span></div>`
    }
    if (document) {
      return `<div class="livro-location available"><span class="tag in-force">No acervo</span>
        <button type="button" class="read-button" data-livro-open="${escapeHtml(document.id)}">Ver documento <span aria-hidden="true">→</span></button>
        <a href="${escapeHtml(document.pdf)}" target="_blank" rel="noreferrer">${document.format === 'html' ? 'Texto na ALERJ ↗' : 'Abrir PDF ↗'}</a>
        ${bulletinLink(item)}
        <span>Publicado no ${bulletinText(item)}</span></div>`
    }
    if (item.url) return `<div class="livro-location available"><span class="tag in-force">Link da curadoria</span><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Abrir documento ↗</a><span>Publicado no ${bulletinText(item)}</span></div>`
    const where = item.p ? ` · Livro de Ordens 2002–2019, p. ${item.p}` : ''
    const alerj = item.t === 'Lei' || item.t === 'Lei complementar' ? ` · <a href="${ALERJ_SEARCH}${encodeURIComponent((item.a ?? '').replace(/\D/g, ''))}" target="_blank" rel="noreferrer">Buscar na ALERJ ↗</a>` : ''
    return `<div class="livro-location"><span class="tag unverified">Não digitalizado no acervo</span>
      <span>Consulte o <strong>${bulletinText(item)}</strong>${where} · <a href="${INTRANET}" target="_blank" rel="noreferrer" title="Acesso restrito a usuários da Intranet">Intranet do CBMERJ ↗</a>${alerj}</span></div>`
  }

  function itemMarkup(item) {
    const flags = (item.f ?? []).map((flag) => `<span>${escapeHtml({ republicacao: 'Republicação', retificacao: 'Retificação', transcricao: 'Transcrição', revogacao: 'Revogação', alteracao: 'Alteração' }[flag] ?? flag)}</span>`).join('')
    const meta = [item.n && `Item ${item.n}`, escapeHtml(item.a ?? 'Ato não identificado'), item.d && `de ${formatDate(item.d)}`].filter(Boolean)
    return `<article class="result-item livro-item">
      <div class="result-icon livro-number" aria-hidden="true">${item.b ? `<small>BOL</small>${escapeHtml(item.b)}<small>${item.bd ? item.bd.slice(0, 4) : ''}</small>` : '—'}</div>
      <div class="result-main">
        <div class="result-meta">${meta.map((part) => `<span>${part}</span>`).join('<span>·</span>')}</div>
        ${item.parte || item.secao ? `<p class="livro-section-path">${escapeHtml([item.parte, item.secao].filter(Boolean).join(' › '))}</p>` : ''}
        <h3 class="livro-subject">${escapeHtml(item.s || '(item sem assunto no livro original)')}</h3>
        ${locationMarkup(item)}
        <div class="result-tags"><span>${escapeHtml(originLabels[item.src] ?? item.src)}</span>${item.cat ? `<span>${escapeHtml(item.cat)}</span>` : ''}${item.t ? `<span>${escapeHtml(typeLabels[item.t] ?? item.t)}</span>` : ''}${flags}${item.note ? `<span>${escapeHtml(item.note)}</span>` : ''}</div>
      </div>
    </article>`
  }

  // Busca no texto integral das páginas dos boletins (modo interno), com o trecho encontrado.
  let fullTextTimer = null
  let fullTextQuery = ''
  function searchFullText() {
    const panel = root.querySelector('#livro-fulltext')
    const query = state.query.trim()
    if (!panel) return
    if (query.length < 3) { panel.hidden = true; fullTextQuery = ''; return }
    if (query === fullTextQuery) return
    fullTextQuery = query
    clearTimeout(fullTextTimer)
    fullTextTimer = setTimeout(async () => {
      const response = await fetch(`./interno/busca?q=${encodeURIComponent(query)}&limite=20`).catch(() => null)
      if (!response?.ok || fullTextQuery !== query) return
      const { total, resultados } = await response.json()
      const mark = (text) => escapeHtml(text).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>')
      panel.hidden = false
      panel.innerHTML = `<h3>No texto dos boletins: ${total.toLocaleString('pt-BR')} ${total === 1 ? 'página' : 'páginas'} com “${escapeHtml(query)}”${total > resultados.length ? ` (mostrando as ${resultados.length} mais relevantes)` : ''}</h3>
        ${resultados.length ? `<ol>${resultados.map((hit) => `<li><a href="./interno/boletim/${escapeHtml(hit.bol)}#page=${hit.p}" target="_blank" rel="noreferrer">Boletim nº ${escapeHtml(String(hit.b ?? '?').padStart(3, '0'))}${hit.bd ? `, de ${formatDate(hit.bd)}` : ''}, p. ${hit.p} ↗</a><p>${mark(hit.trecho)}</p></li>`).join('')}</ol>` : '<p>Nenhuma página encontrada.</p>'}`
    }, 350)
  }

  function renderList() {
    const result = filtered()
    const totalPages = Math.max(1, Math.ceil(result.length / PAGE_SIZE))
    state.page = Math.min(Math.max(1, state.page), totalPages)
    // Mais recentes primeiro, como se consulta um livro de ordens; dentro de um mesmo boletim,
    // na ordem do sumário.
    const ordered = result.slice().sort((a, b) => (b.bd ?? `${b.y ?? ''}`).localeCompare(a.bd ?? `${a.y ?? ''}`) || (a.bol === b.bol ? a.index - b.index : b.index - a.index))
    const first = (state.page - 1) * PAGE_SIZE
    const pageItems = ordered.slice(first, first + PAGE_SIZE)
    root.querySelector('#livro-count').textContent = `${result.length.toLocaleString('pt-BR')} ${result.length === 1 ? 'item' : 'itens'} · ${result.filter(hasDocument).length.toLocaleString('pt-BR')} com documento${meta.interno ? ' ou página do boletim' : ' no acervo'}`
    if (meta.interno) searchFullText()
    root.querySelector('#livro-list').innerHTML = pageItems.length ? pageItems.map(itemMarkup).join('') : '<div class="empty-state"><span>⌕</span><h3>Nenhum item encontrado</h3><p>Tente outra palavra ou remova algum filtro.</p></div>'
    const pagination = root.querySelector('#livro-pagination')
    if (totalPages <= 1) { pagination.innerHTML = ''; return }
    const step = (page, label, disabled) => `<button type="button" class="page-button page-step" data-page="${page}" ${disabled ? 'disabled' : ''}>${label}</button>`
    pagination.innerHTML = `<p class="page-summary">Mostrando ${first + 1}–${Math.min(first + PAGE_SIZE, result.length)} de ${result.length.toLocaleString('pt-BR')}</p>
      <div class="page-buttons">${step(state.page - 1, '← Anterior', state.page === 1)}
        ${pageNumbers(state.page, totalPages).map((page) => (page === '…' ? '<span class="page-gap" aria-hidden="true">…</span>' : `<button type="button" class="page-button ${page === state.page ? 'current' : ''}" data-page="${page}" ${page === state.page ? 'aria-current="page"' : ''} aria-label="Página ${page}">${page}</button>`)).join('')}
        ${step(state.page + 1, 'Próxima →', state.page === totalPages)}</div>`
  }

  return {
    start,
    // Busca vinda do topo da página: aplica a mesma consulta no livro.
    setQuery(query) {
      state.query = query
      state.page = 1
      if (!items) return
      root.querySelector('#livro-search').value = query
      renderList()
    },
    countMatches: (query) => (items ? items.filter((item) => matchesQuery(item, termsOf(query))).length : null),
    // Publicações de um documento do acervo segundo o livro (republicações incluídas).
    itemsForDocument: (id) => (items ?? []).filter((item) => item.doc === id),
    formatDate,
  }
}
