import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import readline from 'node:readline/promises'
import { chromium } from 'playwright-core'

// Coleta LOCAL dos documentos do painel de downloads da Intranet do CBMERJ, para curadoria.
//
// Credenciais: o script nunca pede, lê nem grava usuário ou senha. Ele abre o Chrome instalado
// numa janela visível; a pessoa faz o login ali, como faria normalmente, e confirma no terminal.
// A sessão vive só na memória desse navegador (contexto não persistente): nenhum cookie ou
// token vai para o disco, e ela termina quando a janela fecha.
//
// Escopo: só as seções listadas em SECTIONS, sem boletins; só leitura (GET), uma requisição por
// vez, com pausa. Os arquivos vão para intranet-acervo/ (fora do git). Nada daqui chega ao site
// público automaticamente: publicar um documento exige copiá-lo para public/acervo/ e cadastrá-lo
// em data/documentos-manuais.csv, depois de confirmar que ele pode ser divulgado.
//
// Uso: npm run intranet:fetch            (baixa)
//      npm run intranet:fetch -- --listar (só lista o que seria baixado)
const INTRANET = 'https://intranet.cbmerj.rj.gov.br'
const LOGIN_URL = `${INTRANET}/entrada`
const PANEL_URL = `${INTRANET}/sistemas/downloads//painel/painelSemPermissaoDeApagar`
// Nome da seção no painel e o id do bloco recolhível correspondente (o id é um palpite a partir
// dos links do painel; se mudar, a seção é achada pelo título).
const SECTIONS = [
  ['LEGISLAÇÕES', 'collapse_30'],
  ['CORREGEDORIA GERAL DA SEDEC', 'collapse_7'],
  ['CORREGEDORIA INTERNA', 'collapse_8'],
  ['CHEFIA DE GABINETE', 'collapse_5'],
  ['CHEFIA DO ESTADO-MAIOR GERAL', 'collapse_6'],
]
const isBulletin = (link) => /\/boletim/i.test(link.href) || /\bboletim\b/i.test(link.text)
const OUT_DIR = 'intranet-acervo'
const DELAY_MS = 1500
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const listOnly = process.argv.includes('--listar')
const slug = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

if (process.env.CI) {
  console.error('Este script é só para uso local, com login feito por uma pessoa; não roda em CI.')
  process.exit(1)
}

const browser = await chromium.launch({ channel: 'chrome', headless: false })
try {
  const context = await browser.newContext({ acceptDownloads: false })
  const page = await context.newPage()
  await page.goto(LOGIN_URL)
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
  await terminal.question('\nFaça o login na janela do Chrome que abriu. Quando estiver dentro da Intranet, pressione Enter aqui. ')
  terminal.close()

  await page.goto(PANEL_URL, { waitUntil: 'networkidle' })
  if (/entrada|login/i.test(new URL(page.url()).pathname)) throw new Error('O painel redirecionou para o login: a sessão não está ativa. Rode de novo e conclua o login antes de pressionar Enter.')

  // Links de cada seção: acha o bloco pelo id conhecido ou pelo título da seção e lê os <a>.
  const sections = await page.evaluate((wanted) => {
    const normalize = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()
    return wanted.map(([name, id]) => {
      let panel = document.getElementById(id)
      const toggle = [...document.querySelectorAll('a[href*="#collapse"], [data-target], [data-bs-target], h1, h2, h3, h4, h5, h6')].find((element) => normalize(element.textContent) === normalize(name))
      const target = toggle?.getAttribute('href')?.split('#')[1] ?? toggle?.dataset.target?.replace('#', '') ?? toggle?.dataset.bsTarget?.replace('#', '')
      if (target) panel = document.getElementById(target) ?? panel
      if (!panel) return { name, found: false, links: [] }
      const links = [...panel.querySelectorAll('a[href]')].map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.href })).filter((link) => !link.href.includes('#'))
      return { name, found: true, links }
    })
  }, SECTIONS)

  const manifestPath = path.join(OUT_DIR, 'manifesto.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { items: [] }
  const known = new Set(manifest.items.map((item) => item.url))
  let downloaded = 0
  const skipped = []

  for (const section of sections) {
    if (!section.found) { console.warn(`Seção não encontrada no painel: ${section.name}`); continue }
    const links = section.links.filter((link) => new URL(link.href).origin === INTRANET && !isBulletin(link))
    console.log(`\n${section.name}: ${links.length} links (${section.links.length - links.length} ignorados: boletins ou fora da Intranet)`)
    for (const link of links) {
      if (listOnly) { console.log(` - ${link.text || '(sem título)'} → ${link.href}`); continue }
      if (known.has(link.href)) continue
      const response = await context.request.get(link.href)
      await sleep(DELAY_MS)
      const contentType = response.headers()['content-type'] ?? ''
      // Uma página HTML é navegação (subpasta, listagem), não um documento: fica registrada para
      // revisão em vez de ser salva como arquivo.
      if (!response.ok() || contentType.includes('text/html')) { skipped.push(`${section.name}: ${link.text} (${response.status()} ${contentType.split(';')[0]}) ${link.href}`); continue }
      const body = await response.body()
      const disposition = response.headers()['content-disposition'] ?? ''
      const original = decodeURIComponent(disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? new URL(link.href).pathname.split('/').pop() ?? 'arquivo')
      const extension = path.extname(original) || (contentType.includes('pdf') ? '.pdf' : '')
      const file = path.join(OUT_DIR, slug(section.name), `${slug(link.text || path.basename(original, extension)).slice(0, 80) || 'arquivo'}${extension}`)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, body)
      manifest.items.push({ section: section.name, title: link.text, url: link.href, file, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), contentType: contentType.split(';')[0], downloadedAt: new Date().toISOString() })
      known.add(link.href)
      downloaded += 1
      console.log(` ✓ ${link.text}`)
    }
  }

  if (!listOnly) {
    await mkdir(OUT_DIR, { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    // Planilha para a curadoria decidir o que pode ser publicado (mesmas colunas de
    // data/documentos-manuais.csv, com o arquivo local no lugar da URL).
    const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const rows = manifest.items.map((item) => [item.section, item.title, item.file, item.downloadedAt.slice(0, 10)].map(cell).join(';'))
    await writeFile(path.join(OUT_DIR, 'indice.csv'), `secao;titulo;arquivo_local;baixado_em\n${rows.join('\n')}\n`, 'utf8')
    console.log(`\n${downloaded} arquivos novos em ${OUT_DIR}/ (${manifest.items.length} no total). Índice: ${OUT_DIR}/indice.csv`)
    if (skipped.length) console.log(`Não baixados (páginas ou erros), para revisar:\n${skipped.map((line) => ` - ${line}`).join('\n')}`)
  }
} finally {
  await browser.close()
}
