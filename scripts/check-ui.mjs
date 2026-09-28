import { chromium } from 'playwright-core'

// Verificação rápida do site no Chrome instalado na máquina (playwright-core não baixa navegador):
// rode `npm run build && npm run preview` e, em outro terminal, `npm run check:ui`. Confere, no
// desktop e numa tela de celular, que a página não transborda na horizontal, que a busca do topo
// também consulta o Livro de Ordens, que a aba do livro abre e que não há erros de JavaScript.
const BASE = process.env.SITE_URL ?? 'http://localhost:4173/'
const viewports = { desktop: { viewport: { width: 1300, height: 900 } }, celular: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
const problems = []
const browser = await chromium.launch({ channel: 'chrome' })
for (const [name, options] of Object.entries(viewports)) {
  const page = await browser.newPage(options)
  page.on('pageerror', (error) => problems.push(`${name}: erro de JavaScript: ${error.message}`))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#search-input', 'segurança contra incêndio')
  await page.press('#search-input', 'Enter')
  await page.waitForFunction(() => document.querySelector('#livro-tab-count').textContent, null, { timeout: 15000 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 0) problems.push(`${name}: a página transborda ${overflow}px na horizontal`)
  if (await page.locator('#cross-hint').isHidden()) problems.push(`${name}: a busca não mostrou resultados do Livro de Ordens`)
  await page.click('#tab-livro')
  if (!(await page.locator('.livro-item').count())) problems.push(`${name}: a aba do Livro de Ordens abriu vazia`)
  console.log(`${name}: ok`)
  await page.close()
}
await browser.close()
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
