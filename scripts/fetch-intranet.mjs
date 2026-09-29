import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { chromium } from 'playwright-core'

// Coleta LOCAL de documentos da Intranet do CBMERJ, para curadoria. Roda só nesta máquina; os
// arquivos vão para intranet-acervo/ (fora do git) e nada chega ao site público sem cadastro
// manual depois de autorizado.
//
// Login, em um de dois modos. Em nenhum deles a senha é gravada em arquivo, log ou terminal,
// e a sessão (cookies) vive só na memória do navegador, que é fechado ao final:
// - assistido (padrão): abre o Chrome, a pessoa faz o login na tela do site e o script percebe
//   sozinho quando ela entrou (pelo endereço da página). O script nunca vê a senha. Com --avisar
//   (usado pelo agendamento), mostra antes uma notificação do macOS pedindo o login.
// - --keychain: lê usuário e senha do Chaves (Keychain) do macOS, item "cbmerj-intranet",
//   e preenche o formulário de login. Permite rodar agendado, sem ninguém presente. Cadastro:
//   security add-generic-password -s cbmerj-intranet -a SEU_USUARIO -w
//   (sem valor depois de -w, o macOS pede a senha sem mostrá-la nem gravá-la no histórico).
//
// O que coletar:
// - padrão: painel de downloads (Legislações, Corregedorias, Chefia de Gabinete, EMG), sem boletins;
// - --boletins: Boletins da SEDEC/CBMERJ, percorrendo a área de boletins (anos → edições → PDFs).
//   --anos 2020-2026 limita os anos percorridos;
// - --tudo: boletins e painel, com um único login.
//
// Sempre só leitura (GET), uma requisição por vez, com pausa; links de sair/logout são ignorados.
// --listar mostra o que seria baixado, sem baixar. --limite N baixa em lotes de N arquivos e
// --destino /caminho grava em outra pasta (ex.: disco externo).
const INTRANET = 'https://intranet.cbmerj.rj.gov.br'
const LOGIN_URL = `${INTRANET}/entrada`
const PANEL_URL = `${INTRANET}/sistemas/downloads//painel/painelSemPermissaoDeApagar`
// Pontos de entrada da área de boletins (links "BOLETIM SEDEC / CBMERJ" e "BM/1" do menu).
const BULLETIN_ROOTS = [
  ['boletim-sedec-cbmerj', `${INTRANET}/sistemas/boletim/index.php/boletim/boletimSelecionarAno/3/B%201080`],
  ['boletim-bm1', `${INTRANET}/sistemas/boletim/index.php/boletim/boletimSelecionarAno/4`],
]
const SECTIONS = [
  ['LEGISLAÇÕES', 'collapse_30'],
  ['CORREGEDORIA GERAL DA SEDEC', 'collapse_7'],
  ['CORREGEDORIA INTERNA', 'collapse_8'],
  ['CHEFIA DE GABINETE', 'collapse_5'],
  ['CHEFIA DO ESTADO-MAIOR GERAL', 'collapse_6'],
]
const KEYCHAIN_SERVICE = 'cbmerj-intranet'
// --destino grava em outra pasta (ex.: um disco externo para os anos antigos); o padrão fica
// dentro do projeto, fora do git.
const argValue = (flag) => { const index = process.argv.indexOf(flag); return index === -1 ? null : process.argv[index + 1] }
const OUT_DIR = argValue('--destino') ?? 'intranet-acervo'
// --limite N: baixa no máximo N arquivos nesta execução (lotes); a próxima continua de onde parou.
const LIMIT = Number(argValue('--limite')) || Infinity
const DELAY_MS = 1500
const MAX_PAGES = 5000
const LOGIN_WAIT_MIN = 15
const isBulletin = (link) => /\/boletim/i.test(link.href) || /\bboletim\b/i.test(link.text)
const isLogout = (href) => /sair|logout|logoff|desconectar|encerrar/i.test(href)
// Nada classificado como reservado é seguido nem baixado (boletins reservados, documentos de
// acesso restrito): só o conteúdo ostensivo.
const safeDecode = (value) => { try { return decodeURIComponent(value) } catch { return value } }
const isReserved = (link) => /reservad/i.test(`${link.text} ${safeDecode(link.href)}`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const slug = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const args = process.argv.slice(2)
const listOnly = args.includes('--listar')
const useKeychain = args.includes('--keychain')
const everything = args.includes('--tudo')
const bulletins = args.includes('--boletins') || everything
const yearRange = args[args.indexOf('--anos') + 1]?.match(/^(\d{4})(?:-(\d{4}))?$/)
const [firstYear, lastYear] = yearRange ? [Number(yearRange[1]), Number(yearRange[2] ?? yearRange[1])] : [null, null]

if (process.env.CI) {
  console.error('Este script é só para uso local; não roda em CI.')
  process.exit(1)
}
// O modo de depuração do Playwright registra os valores digitados, o que exporia a senha.
if (/pw:|\*/.test(process.env.DEBUG ?? '')) {
  console.error('Desative DEBUG antes de rodar: o log de depuração do Playwright mostraria a senha.')
  process.exit(1)
}

function keychainCredentials() {
  try {
    const attributes = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const user = attributes.match(/"acct"<blob>="([^"]*)"/)?.[1]
    const password = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\n$/, '')
    if (!user || !password) throw new Error('item incompleto')
    return { user, password }
  } catch {
    throw new Error(`Credencial "${KEYCHAIN_SERVICE}" não encontrada no Chaves do macOS. Cadastre com: security add-generic-password -s ${KEYCHAIN_SERVICE} -a SEU_USUARIO -w`)
  }
}

const loggedOut = (page) => /entrada|login/i.test(new URL(page.url()).pathname)

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' })
  if (!useKeychain) {
    // O script só observa o endereço da página para saber quando o login terminou; não lê o que
    // é digitado. Agendado (--avisar), mostra uma notificação do macOS pedindo o login.
    await page.bringToFront()
    execFileSync('osascript', ['-e', 'display notification "Faça o login na janela do Chrome que acabou de abrir no canto superior esquerdo." with title "Coletor da Intranet (Biblioteca Normativa)" sound name "Glass"'])
    console.log(`\nFaça o login na janela do Chrome que abriu. A coleta começa sozinha quando você entrar (espera até ${LOGIN_WAIT_MIN} minutos).`)
    const deadline = Date.now() + LOGIN_WAIT_MIN * 60_000
    // Entrou quando não há mais campo de senha visível e a página já mostra links para os
    // sistemas internos (a página inicial logada também fica em /entrada).
    // A tela de login fica em "/" com o campo de senha; depois de entrar, o painel abre em
    // /entrada sem campo de senha (os links do menu são montados por JavaScript).
    const loggedIn = async () => !(await page.locator('input[type="password"]:visible').count()) && (/^\/entrada/.test(new URL(page.url()).pathname) || (await page.locator('a[href*="sistemas"]').count()) > 0)
    let lastReport = Date.now()
    while (!(await loggedIn().catch(() => false))) {
      if (Date.now() > deadline || page.isClosed()) throw new Error('O login não foi feito a tempo; nada foi coletado. A próxima execução tenta de novo.')
      // Diagnóstico sem conteúdo: só o caminho da página e se ainda há campo de senha.
      if (Date.now() - lastReport > 30_000) {
        lastReport = Date.now()
        const passwordVisible = await page.locator('input[type="password"]:visible').count().catch(() => '?')
        const internalLinks = await page.locator('a[href*="sistemas"]').count().catch(() => '?')
        console.log(`Aguardando login… página ${new URL(page.url()).pathname}, campo de senha: ${passwordVisible}, links internos: ${internalLinks}`)
      }
      await sleep(2000)
    }
    console.log('Login detectado; começando a coleta.')
    return
  }
  let { user, password } = keychainCredentials()
  const passwordField = page.locator('input[type="password"]').first()
  const userField = page.locator('form input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="submit"])').first()
  await userField.fill(user)
  await passwordField.fill(password)
  password = null
  user = null
  await Promise.all([page.waitForLoadState('networkidle'), passwordField.press('Enter')])
  // Verificação em duas etapas, captcha ou tela nova: para aqui, sem tentar contornar.
  if ((await page.locator('input[type="password"]:visible').count()) || !(await page.locator('a[href*="/sistemas/"]').count())) {
    throw new Error('O login automático não foi concluído (senha errada, captcha, verificação em duas etapas ou tela diferente). Rode sem --keychain e faça o login manualmente.')
  }
}

async function loadManifest() {
  const manifestPath = path.join(OUT_DIR, 'manifesto.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { items: [] }
  return { manifestPath, manifest, known: new Set(manifest.items.map((item) => item.url)) }
}

class SessionExpired extends Error {
  constructor() { super('A sessão da Intranet expirou. Rode o mesmo comando de novo e faça o login: a coleta continua de onde parou.'); this.name = 'SessionExpired' }
}

// Busca um documento pela sessão do navegador. Quando a resposta é uma página que exibe o arquivo
// embutido (visualizador de boletim), segue uma vez o endereço do <iframe>/<embed>/<object> ou o
// primeiro link para PDF. Devolve { body, contentType, url } ou { html: true } / null.
async function resolveDocument(context, href, depth = 0) {
  const response = await context.request.get(href, { timeout: 120_000 })
  await sleep(DELAY_MS)
  if (!response.ok()) return null
  const contentType = (response.headers()['content-type'] ?? '').split(';')[0]
  if (!contentType.includes('text/html')) return { body: await response.body(), contentType, url: href, headers: response.headers() }
  if (depth > 0) return { html: true }
  const html = await response.text()
  if (/<input[^>]+type=["']?password/i.test(html)) throw new SessionExpired()
  const embedded = html.match(/<(?:iframe|embed|object)\b[^>]*\b(?:src|data)=["']([^"']+)["']/i)?.[1] ?? html.match(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/i)?.[1]
  if (!embedded) return { html: true }
  return resolveDocument(context, new URL(embedded.replace(/&amp;/g, '&'), href).href, depth + 1)
}

// Registro técnico de como um documento é entregue (sem conteúdo): usado na listagem para
// ajustar o coletor sem expor o texto dos boletins.
async function probe(context, href) {
  const mask = (value) => value.replace(/\d+/g, 'N')
  try {
    const result = await resolveDocument(context, href)
    if (!result) return { pagina: mask(new URL(href).pathname), resultado: 'erro HTTP' }
    if (result.html) return { pagina: mask(new URL(href).pathname), resultado: 'página HTML sem arquivo embutido' }
    return { pagina: mask(new URL(href).pathname), arquivo: mask(new URL(result.url).pathname), tipo: result.contentType, bytes: result.body.length }
  } catch (error) {
    return { pagina: mask(new URL(href).pathname), resultado: `falha: ${error.name}` }
  }
}

// Baixa um documento e grava no acervo local. Devolve o registro, "html" quando não há arquivo
// ou null quando falha.
async function download(context, link, folder, section) {
  const result = await resolveDocument(context, link.href).catch((error) => { if (error instanceof SessionExpired) throw error; return null })
  if (!result) return null
  if (result.html) return 'html'
  const { body, contentType, headers } = result
  const disposition = headers['content-disposition'] ?? ''
  const original = safeDecode(disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? new URL(result.url).pathname.split('/').pop() ?? 'arquivo')
  const extension = path.extname(original) || (contentType.includes('pdf') ? '.pdf' : '')
  const hash = createHash('sha256').update(body).digest('hex')
  const file = path.join(OUT_DIR, folder, `${slug(link.text || path.basename(original, extension)).slice(0, 80) || 'arquivo'}-${hash.slice(0, 8)}${extension}`)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  return { section, title: link.text, url: link.href, fileUrl: result.url, file, bytes: body.length, sha256: hash, contentType, downloadedAt: new Date().toISOString() }
}

async function panelLinks(page) {
  // O sistema de downloads só aceita quem chega pelo menu da Intranet: aberto direto pelo
  // endereço, volta para a tela inicial. Por isso parte da página inicial logada.
  await page.goto(`${INTRANET}/entrada`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await sleep(DELAY_MS)
  const menuLink = await page.evaluate(() => [...document.querySelectorAll('a[href*="downloads"]')].map((a) => a.href)[0] ?? null)
  await page.goto(menuLink ?? PANEL_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await sleep(DELAY_MS)
  if (!/downloads/.test(page.url()) && menuLink !== PANEL_URL) await page.goto(PANEL_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
  await sleep(DELAY_MS)
  if (loggedOut(page) || new URL(page.url()).pathname === '/') console.warn('O painel de downloads não abriu (voltou para a tela inicial); ele será ajustado numa próxima rodada.')
  const sections = await page.evaluate((wanted) => {
    const normalize = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()
    return wanted.map(([name, id]) => {
      let panel = document.getElementById(id)
      const toggle = [...document.querySelectorAll('a[href*="#collapse"], [data-target], [data-bs-target], h1, h2, h3, h4, h5, h6')].find((element) => normalize(element.textContent) === normalize(name))
      const target = toggle?.getAttribute('href')?.split('#')[1] ?? toggle?.dataset.target?.replace('#', '') ?? toggle?.dataset.bsTarget?.replace('#', '')
      if (target) panel = document.getElementById(target) ?? panel
      if (!panel) return { name, found: false, links: [] }
      return { name, found: true, links: [...panel.querySelectorAll('a[href]')].map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.href })).filter((link) => !link.href.includes('#')) }
    })
  }, SECTIONS)
  if (sections.some((section) => !section.found)) {
    // Estrutura do painel (títulos, ids de blocos recolhíveis, quantidade de links), sem os documentos.
    structure.push({ url: PANEL_URL.replace(INTRANET, ''), painel: await page.evaluate(() => ({
      headings: [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, .panel-title, .card-header, [data-toggle], [data-bs-toggle]')].slice(0, 80).map((element) => ({ tag: element.tagName, text: element.textContent.replace(/\s+/g, ' ').trim().slice(0, 80), href: element.getAttribute('href'), target: element.dataset.target ?? element.dataset.bsTarget ?? null })),
      collapses: [...document.querySelectorAll('[id^="collapse"]')].map((element) => ({ id: element.id, links: element.querySelectorAll('a[href]').length })),
      totalLinks: document.querySelectorAll('a[href]').length,
      path: location.pathname,
    })) })
  }
  return sections.flatMap((section) => {
    if (!section.found) { console.warn(`Seção não encontrada no painel: ${section.name}`); return [] }
    const links = section.links.filter((link) => new URL(link.href).origin === INTRANET && !isBulletin(link) && !isLogout(link.href) && !isReserved(link))
    console.log(`${section.name}: ${links.length} links`)
    return links.map((link) => ({ ...link, folder: slug(section.name), section: section.name }))
  })
}

// Percorre a área de boletins em profundidade, só dentro de /sistemas/boletim/. A navegação do
// sistema guarda o ano escolhido na sessão: boletimSelecionarMes/<ano> define o ano, e as
// listagens mensais (boletimListagem/1..12) mostram as edições desse ano. Por isso a ordem
// importa (ano → seus 12 meses → próximo ano) e as listagens são revisitadas a cada ano.
// As edições (exibirBoletim/<id>) são os documentos.
const visitedPages = []
const listing = []
const structure = []
const isDocument = (href) => /exibirBoletim|\.pdf(\?|$)|download|visualizar|arquivo/i.test(href)
const isYearSelection = (href) => /boletimSelecionarMes\//i.test(href)
const isPerYear = (href) => /boletimListagem\//i.test(href)
// O boletim ativo também fica na sessão (boletimSelecionarAno/<id>): as edições são etiquetadas
// pelo último escolhido, não pela página de onde a navegação começou.
const bulletinUnits = { 3: 'boletim-sedec-cbmerj', 4: 'boletim-bm1' }
let currentUnit = null

// Estrutura de uma página de navegação, sem conteúdo de documentos: formulários, listas de
// seleção (anos, unidades) e botões. Serve para ajustar o coletor quando a navegação não é por links.
async function recordStructure(page, url) {
  const info = await page.evaluate(() => ({
    forms: [...document.forms].map((form) => ({ action: form.getAttribute('action'), method: form.method, selects: [...form.querySelectorAll('select')].map((select) => ({ name: select.name, options: [...select.options].slice(0, 80).map((option) => `${option.value}=${option.text.trim()}`) })), buttons: [...form.querySelectorAll('button, input[type=submit]')].map((button) => button.textContent.trim() || button.value) })),
    selectsOutsideForms: [...document.querySelectorAll('select')].filter((select) => !select.form).map((select) => ({ name: select.name, id: select.id, options: [...select.options].slice(0, 80).map((option) => `${option.value}=${option.text.trim()}`) })),
    onclickCount: document.querySelectorAll('[onclick]').length,
  }))
  structure.push({ url: url.replace(INTRANET, ''), ...info })
}

async function* bulletinLinks(page) {
  const seenDocuments = new Set()
  for (const [name, root] of BULLETIN_ROOTS) {
    const seenPages = new Set()
    let seenThisYear = new Set()
    let visited = 0
    async function* visit(url) {
      if (visited >= MAX_PAGES) return
      visited += 1
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (error) {
        visitedPages.push({ url, erro: error.name })
        return
      }
      await sleep(DELAY_MS)
      if (loggedOut(page)) throw new Error('A área de boletins redirecionou para o login: a sessão expirou.')
      const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.href.split('#')[0] })))
      visitedPages.push({ url, links: links.length })
      const unit = url.match(/boletimSelecionarAno\/(\d+)/)?.[1]
      if (unit) currentUnit = bulletinUnits[unit] ?? `boletim-${unit}`
      if (links.filter((link) => link.href.includes('/sistemas/boletim/')).length < 4) await recordStructure(page, url)
      const children = []
      for (const link of links) {
        if (!link.href.startsWith(`${INTRANET}/sistemas/boletim/`) || isLogout(link.href) || isReserved(link)) continue
        const year = link.text.match(/^(19|20)\d{2}$/) ? Number(link.text) : null
        if (year && firstYear && (year < firstYear || year > lastYear)) continue
        if (isDocument(link.href)) {
          if (seenDocuments.has(link.href)) continue
          seenDocuments.add(link.href)
          const label = currentUnit ?? name
          yield { ...link, folder: path.join('boletins', label), section: label }
        } else children.push(link.href)
      }
      for (const child of children) {
        if (isPerYear(child) ? seenThisYear.has(child) : seenPages.has(child)) continue
        if (isPerYear(child)) seenThisYear.add(child)
        else seenPages.add(child)
        // Ao escolher um novo ano, as listagens mensais passam a mostrar esse ano.
        if (isYearSelection(child)) seenThisYear = new Set()
        yield* visit(child)
        // Depois de percorrer um ano, volta à página atual para seguir com os demais links dela.
        if (isYearSelection(child)) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
      }
    }
    seenPages.add(root)
    yield* visit(root)
    if (visited >= MAX_PAGES) console.warn(`${name}: limite de ${MAX_PAGES} páginas atingido; rode de novo com --anos para continuar por partes.`)
  }
}

if (useKeychain) {
  try { execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], { stdio: 'ignore' }) } catch {
    console.error(`Credencial "${KEYCHAIN_SERVICE}" não encontrada no Chaves do macOS. Cadastre com: security add-generic-password -s ${KEYCHAIN_SERVICE} -a SEU_USUARIO -w`)
    process.exit(1)
  }
}

// Janela própria, em posição fixa e trazida para a frente, para não ser confundida com o Chrome
// de uso diário (que não é usado nem lido pelo script).
const browser = await chromium.launch({ channel: 'chrome', headless: useKeychain, args: ['--window-position=40,40', '--window-size=1200,900'] })
try {
  const context = await browser.newContext({ acceptDownloads: false })
  const page = await context.newPage()
  await login(page)
  const { manifestPath, manifest, known } = await loadManifest()
  const skipped = []
  const probes = []
  let downloaded = 0
  // --tudo: boletins e painel com o mesmo login.
  async function* selectedLinks() {
    if (bulletins) yield* bulletinLinks(page)
    if (!bulletins || everything) yield* await panelLinks(page)
  }
  const links = selectedLinks()
  for await (const link of links) {
    // A listagem vai para um arquivo local, não para o terminal: os títulos não aparecem em
    // telas, gravações ou ferramentas que leiam a saída do comando.
    if (listOnly) {
      listing.push({ section: link.section, text: link.text, href: link.href })
      if (probes.filter((entry) => entry.secao === link.section).length < 3) probes.push({ secao: link.section, ...await probe(context, link.href) })
      continue
    }
    if (known.has(link.href)) continue
    const record = await download(context, link, link.folder, link.section)
    if (!record || record === 'html') { skipped.push(`${link.section}: ${link.text} ${link.href}`); continue }
    manifest.items.push(record)
    known.add(link.href)
    downloaded += 1
    if (downloaded % 10 === 0) console.log(`${downloaded} arquivos baixados…`)
    if (downloaded >= LIMIT) { console.log(`Limite de ${LIMIT} arquivos atingido; rode de novo para o próximo lote.`); break }
    // Grava o manifesto a cada arquivo: uma coleta longa interrompida continua de onde parou.
    await mkdir(OUT_DIR, { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
  if (listOnly) {
    await mkdir(OUT_DIR, { recursive: true })
    await writeFile(path.join(OUT_DIR, 'diagnostico.json'), `${JSON.stringify(probes, null, 2)}\n`, 'utf8')
    const bySection = listing.reduce((acc, link) => ({ ...acc, [link.section]: (acc[link.section] || 0) + 1 }), {})
    console.log(`Listagem: ${listing.length} arquivos encontrados`, bySection, `→ ${OUT_DIR}/listagem.json`)
  } else {
    const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const rows = manifest.items.map((item) => [item.section, item.title, item.file, item.downloadedAt.slice(0, 10)].map(cell).join(';'))
    await mkdir(OUT_DIR, { recursive: true })
    await writeFile(path.join(OUT_DIR, 'indice.csv'), `secao;titulo;arquivo_local;baixado_em\n${rows.join('\n')}\n`, 'utf8')
    console.log(`\n${downloaded} arquivos novos em ${OUT_DIR}/ (${manifest.items.length} no total). Índice: ${OUT_DIR}/indice.csv`)
    if (skipped.length) {
      await writeFile(path.join(OUT_DIR, 'nao-baixados.txt'), `${skipped.join('\n')}\n`, 'utf8')
      console.log(`${skipped.length} links não baixados (páginas ou erros), listados em ${OUT_DIR}/nao-baixados.txt`)
    }
  }
} finally {
  // Mesmo se algo falhar no meio, o que já foi listado fica salvo para análise.
  if (listOnly) {
    await mkdir(OUT_DIR, { recursive: true })
    await writeFile(path.join(OUT_DIR, 'paginas-visitadas.json'), `${JSON.stringify(visitedPages, null, 2)}\n`, 'utf8')
    await writeFile(path.join(OUT_DIR, 'listagem.json'), `${JSON.stringify(listing, null, 2)}\n`, 'utf8')
    await writeFile(path.join(OUT_DIR, 'estrutura.json'), `${JSON.stringify(structure, null, 2)}\n`, 'utf8')
  }
  await browser.close()
}
