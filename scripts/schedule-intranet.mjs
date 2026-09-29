import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

// Agenda a coleta da Intranet no próprio Mac (launchd), todo dia às 07:00, em um de dois modos:
// - --assistido: abre a janela da Intranet e avisa com uma notificação; a pessoa faz o login e a
//   coleta segue sozinha. Nenhuma senha é guardada; sem login em 15 minutos, não coleta nada.
// - padrão (--keychain): a senha fica no Chaves do macOS e é lida só na hora do login. Roda enquanto a sessão do
// usuário estiver aberta e o Mac estiver na rede (ou VPN) que acessa a Intranet. O log vai para
// intranet-acervo/coleta.log, que não é versionado e não contém dados de login.
//
// Uso: npm run intranet:agendar -- --assistido (instala, com login feito por você)
//      npm run intranet:agendar             (instala, com login pelo Chaves do macOS)
//      npm run intranet:agendar -- --remover (desinstala)
const LABEL = 'br.gov.rj.cbmerj.biblioteca.intranet'
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const project = process.cwd()
const node = process.execPath
const uid = String(process.getuid())

if (process.platform !== 'darwin') {
  console.error('O agendamento usa o launchd do macOS. Em outro sistema, agende "node scripts/fetch-intranet.mjs --keychain ..." no agendador local.')
  process.exit(1)
}

const bootout = () => { try { execFileSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' }) } catch { /* não estava carregado */ } }

if (process.argv.includes('--remover')) {
  bootout()
  if (existsSync(plistPath)) await rm(plistPath)
  console.log('Coleta agendada removida.')
  process.exit(0)
}

const assisted = process.argv.includes('--assistido')
if (!assisted) {
  try {
    execFileSync('security', ['find-generic-password', '-s', 'cbmerj-intranet'], { stdio: 'ignore' })
  } catch {
    console.error('Cadastre antes a credencial no Chaves do macOS:\n  security add-generic-password -s cbmerj-intranet -a SEU_USUARIO -w\nou agende com login feito por você: npm run intranet:agendar -- --assistido')
    process.exit(1)
  }
}

// Boletins do ano corrente e do anterior (para pegar publicações atrasadas) e o painel de
// downloads, com um único login.
const year = new Date().getFullYear()
const mode = assisted ? '--avisar' : '--keychain'
const command = `cd "${project}" && "${node}" scripts/fetch-intranet.mjs ${mode} --tudo --anos ${year - 1}-${year}`
const escape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const log = path.join(project, 'intranet-acervo', 'coleta.log')
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>${escape(command)}</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>${escape(log)}</string>
  <key>StandardErrorPath</key><string>${escape(log)}</string>
</dict>
</plist>
`
await mkdir(path.dirname(plistPath), { recursive: true })
await mkdir(path.dirname(log), { recursive: true })
await writeFile(plistPath, plist, { encoding: 'utf8', mode: 0o600 })
bootout()
execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath])
console.log(`Coleta agendada para todo dia às 07:00, ${assisted ? 'com login feito por você' : 'com login pelo Chaves do macOS'} (${plistPath}).\nLog: ${log}\nPara rodar agora: launchctl kickstart gui/${uid}/${LABEL}`)
