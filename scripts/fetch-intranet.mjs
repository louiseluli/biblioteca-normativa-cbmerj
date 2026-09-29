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
// --listar mostra o que seria baixado, sem baixar.
const INTRANET = 'https://intranet.cbmerj.rj.gov.br'
const LOGIN_URL = `${INTRANET}/entrada`
const PANEL_URL = `${INTRANET}/sistemas/downloads//painel/painelSemPermissaoDeApagar`
// Pontos de entrada da área de boletins (links "BOLETIM SEDEC / CBMERJ" e "BM/1" do menu).
const BULLETIN_ROOTS = [
  ['boletim-sedec-cbmerj', `${INTRANET}/sistemas/boletim/index.php/boletim/boletimSelecionarAno/3`],
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
const OUT_DIR = 'intranet-acervo'
const DELAY_MS = 1500
const MAX_PAGES = 5000
const LOGIN_WAIT_MIN = 15
const isBulletin = (link) => /\/boletim/i.test(link.href) || /\bboletim\b/i.test(link.text)
const isLogout = (href) => /sair|logout|logoff|desconectar|encerrar/i.test(href)
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
    if (args.includes('--avisar')) execFileSync('osascript', ['-e', 'display notification "Faça o login na janela da Intranet para atualizar o acervo." with title "Biblioteca Normativa CBMERJ" sound name "Glass"'])
    console.log(`\nFaça o login na janela do Chrome que abriu. A coleta começa sozinha quando você entrar (espera até ${LOGIN_WAIT_MIN} minutos).`)
    const deadline = Date.now() + LOGIN_WAIT_MIN * 60_000
    while (loggedOut(page) || (await page.locator('input[type="password"]').count())) {
      if (Date.now() > deadline || page.isClosed()) throw new Error('O login não foi feito a tempo; nada foi coletado. A próxima execução tenta de novo.')
      await sleep(2000)
    }
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
  if (loggedOut(page) || (await page.locator('input[type="password"]').count())) {
    throw new Error('O login automático não foi concluído (senha errada, captcha, verificação em duas etapas ou tela diferente). Rode sem --keychain e faça o login manualmente.')
  }
}

async function loadManifest() {
  const manifestPath = path.join(OUT_DIR, 'manifesto.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { items: [] }
  return { manifestPath, manifest, known: new Set(manifest.items.map((item) => item.url)) }
}

// Baixa um link autenticado pelo contexto do navegador. Devolve o registro salvo, "html" quando
// a resposta é uma página (navegação, não documento) ou null quando falha.
async function download(context, link, folder, section) {
  const response = await context.request.get(link.href)
  await sleep(DELAY_MS)
  const contentType = response.headers()['content-type'] ?? ''
  if (!response.ok()) return null
  if (contentType.includes('text/html')) return 'html'
  const body = await response.body()
  const disposition = response.headers()['content-disposition'] ?? ''
  const original = decodeURIComponent(disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? new URL(link.href).pathname.split('/').pop() ?? 'arquivo')
  const extension = path.extname(original) || (contentType.includes('pdf') ? '.pdf' : '')
  const hash = createHash('sha256').update(body).digest('hex')
  const file = path.join(OUT_DIR, folder, `${slug(link.text || path.basename(original, extension)).slice(0, 80) || 'arquivo'}-${hash.slice(0, 8)}${extension}`)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  return { section, title: link.text, url: link.href, file, bytes: body.length, sha256: hash, contentType: contentType.split(';')[0], downloadedAt: new Date().toISOString() }
}

async function panelLinks(page) {
  await page.goto(PANEL_URL, { waitUntil: 'networkidle' })
  if (loggedOut(page)) throw new Error('O painel redirecionou para o login: a sessão não está ativa.')
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
  return sections.flatMap((section) => {
    if (!section.found) { console.warn(`Seção não encontrada no painel: ${section.name}`); return [] }
    const links = section.links.filter((link) => new URL(link.href).origin === INTRANET && !isBulletin(link) && !isLogout(link.href))
    console.log(`${section.name}: ${links.length} links`)
    return links.map((link) => ({ ...link, folder: slug(section.name), section: section.name }))
  })
}

// Percorre a área de boletins em largura, só dentro de /sistemas/boletim/: páginas de ano, listas
// de edições e, por fim, os arquivos. Numa página de seleção de ano, só segue os anos pedidos.
async function* bulletinLinks(page) {
  for (const [name, root] of BULLETIN_ROOTS) {
    const queue = [root]
    const seen = new Set(queue)
    let visited = 0
    while (queue.length && visited < MAX_PAGES) {
      const url = queue.shift()
      await page.goto(url, { waitUntil: 'networkidle' })
      await sleep(DELAY_MS)
      visited += 1
      if (loggedOut(page)) throw new Error('A área de boletins redirecionou para o login: a sessão expirou.')
      const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.href.split('#')[0] })))
      for (const link of links) {
        if (!link.href.startsWith(`${INTRANET}/sistemas/boletim/`) || isLogout(link.href) || seen.has(link.href)) continue
        const year = link.text.match(/^(19|20)\d{2}$/) ? Number(link.text) : null
        if (year && firstYear && (year < firstYear || year > lastYear)) continue
        seen.add(link.href)
        // Arquivo (PDF ou download) é entregue para baixar; o resto é navegação.
        if (/\.pdf(\?|$)|download|visualizar|arquivo/i.test(link.href)) yield { ...link, folder: path.join('boletins', name), section: name }
        else queue.push(link.href)
      }
    }
    if (visited >= MAX_PAGES) console.warn(`${name}: limite de ${MAX_PAGES} páginas atingido; rode de novo com --anos para continuar por partes.`)
  }
}

if (useKeychain) {
  try { execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], { stdio: 'ignore' }) } catch {
    console.error(`Credencial "${KEYCHAIN_SERVICE}" não encontrada no Chaves do macOS. Cadastre com: security add-generic-password -s ${KEYCHAIN_SERVICE} -a SEU_USUARIO -w`)
    process.exit(1)
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: useKeychain })
try {
  const context = await browser.newContext({ acceptDownloads: false })
  const page = await context.newPage()
  await login(page)
  const { manifestPath, manifest, known } = await loadManifest()
  const skipped = []
  let downloaded = 0
  // --tudo: boletins e painel com o mesmo login.
  async function* selectedLinks() {
    if (bulletins) yield* bulletinLinks(page)
    if (!bulletins || everything) yield* await panelLinks(page)
  }
  const links = selectedLinks()
  for await (const link of links) {
    if (listOnly) { console.log(` - [${link.section}] ${link.text || '(sem título)'} → ${link.href}`); continue }
    if (known.has(link.href)) continue
    const record = await download(context, link, link.folder, link.section)
    if (!record || record === 'html') { skipped.push(`${link.section}: ${link.text} ${link.href}`); continue }
    manifest.items.push(record)
    known.add(link.href)
    downloaded += 1
    console.log(` ✓ ${link.text || record.file}`)
    // Grava o manifesto a cada arquivo: uma coleta longa interrompida continua de onde parou.
    await mkdir(OUT_DIR, { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
  if (!listOnly) {
    const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const rows = manifest.items.map((item) => [item.section, item.title, item.file, item.downloadedAt.slice(0, 10)].map(cell).join(';'))
    await mkdir(OUT_DIR, { recursive: true })
    await writeFile(path.join(OUT_DIR, 'indice.csv'), `secao;titulo;arquivo_local;baixado_em\n${rows.join('\n')}\n`, 'utf8')
    console.log(`\n${downloaded} arquivos novos em ${OUT_DIR}/ (${manifest.items.length} no total). Índice: ${OUT_DIR}/indice.csv`)
    if (skipped.length) console.log(`Não baixados (páginas ou erros), para revisar:\n${skipped.map((line) => ` - ${line}`).join('\n')}`)
  }
} finally {
  await browser.close()
}
