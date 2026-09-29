const form = document.querySelector('#curation-form')
const message = document.querySelector('#message')
const entries = document.querySelector('#entries')
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

async function loadEntries() {
  const response = await fetch('/interno/api/curadoria?limite=50')
  if (!response.ok) throw new Error('Não foi possível carregar a curadoria.')
  const data = await response.json()
  entries.innerHTML = data.length ? data.map((entry) => `<article class="entry"><strong>${escapeHtml(entry.target_id || 'novo item')}</strong><code>${escapeHtml(entry.created_at)}</code><span>${escapeHtml(entry.justification)}</span><small>${escapeHtml(JSON.stringify(entry.fields))}</small></article>`).join('') : '<p class="muted">Nenhuma alteração registrada.</p>'
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  message.textContent = 'Salvando…'
  const values = Object.fromEntries(new FormData(form))
  const fields = Object.fromEntries(Object.entries(values).filter(([key, value]) => !['itemId', 'justification'].includes(key) && value !== ''))
  try {
    const response = await fetch('/interno/api/curadoria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId: values.itemId, fields, justification: values.justification }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.')
    form.reset(); message.textContent = `Salvo: ${result.id}`; await loadEntries()
  } catch (error) { message.textContent = error.message }
})

loadEntries().catch((error) => { entries.textContent = error.message })
