import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'

const projectDir = process.cwd()
const envPath = resolve(projectDir, '.env')
const examplePath = resolve(projectDir, '.env.example')
const defaultCallback = 'http://127.0.0.1:3000/api/auth/spotify/callback'

function readSetting(content, name) {
  const line = content.split(/\r?\n/).find(line => line.startsWith(`${name}=`))
  return line?.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2') || ''
}

function writeSetting(content, name, value) {
  const line = `${name}=${value}`
  const pattern = new RegExp(`^${name}=[^\\r\\n]*`, 'm')
  if (pattern.test(content)) return content.replace(pattern, line)
  return `${content.replace(/\s*$/, '')}\n${line}\n`
}

async function readExistingEnv() {
  try {
    return { content: await readFile(envPath, 'utf8'), exists: true }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return { content: await readFile(examplePath, 'utf8'), exists: false }
  }
}

async function askClientId() {
  if (process.env.NUXT_SPOTIFY_CLIENT_ID?.trim()) return process.env.NUXT_SPOTIFY_CLIENT_ID.trim()
  return new Promise((resolve, reject) => {
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    let answered = false
    prompt.once('close', () => {
      if (!answered) reject(new Error('Укажите Client ID приложения Spotify.'))
    })
    prompt.question('Введите Client ID приложения Spotify: ', (answer) => {
      answered = true
      prompt.close()
      resolve(answer.trim())
    })
  })
}

async function prepareEnvironment() {
  const { content: original, exists } = await readExistingEnv()
  let content = original
  const savedKey = readSetting(content, 'NUXT_ENCRYPTION_KEY')
  if (savedKey) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(savedKey) || Buffer.from(savedKey, 'base64').length !== 32) {
      throw new Error('NUXT_ENCRYPTION_KEY должен содержать 32 байта в формате Base64.')
    }
  } else {
    content = writeSetting(content, 'NUXT_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
  }

  if (!readSetting(content, 'NUXT_SPOTIFY_CLIENT_ID')) {
    const clientId = await askClientId()
    if (!/^[A-Za-z0-9]+$/.test(clientId)) {
      throw new Error('Укажите действительный Client ID приложения Spotify.')
    }
    content = writeSetting(content, 'NUXT_SPOTIFY_CLIENT_ID', clientId)
  }

  if (!readSetting(content, 'NUXT_SPOTIFY_REDIRECT_URI')) {
    content = writeSetting(content, 'NUXT_SPOTIFY_REDIRECT_URI', defaultCallback)
  }

  if (content !== original || !exists) {
    await writeFile(envPath, content, { encoding: 'utf8', flag: exists ? 'w' : 'wx', mode: 0o600 })
    console.log('Настройки сохранены в .env.')
  }
}

function runNpm(args) {
  const npmCli = process.env.npm_execpath
  if (!npmCli) throw new Error('Запустите проект командой npm start.')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], { cwd: projectDir, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

async function installDependencies() {
  const lockfile = await readFile(resolve(projectDir, 'package-lock.json'))
  const lockHash = createHash('sha256').update(lockfile).digest('hex')
  const stampPath = resolve(projectDir, 'node_modules', '.startup-lock-hash')
  let installedHash = ''
  try {
    installedHash = (await readFile(stampPath, 'utf8')).trim()
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (installedHash === lockHash) return 0

  const result = await runNpm(['ci', '--no-audit', '--no-fund'])
  if (result === 0) await writeFile(stampPath, `${lockHash}\n`, { mode: 0o600 })
  return result
}

function checkLocalPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error('Порт 3000 занят. Остановите другой сервер и повторите npm start.'))
      } else {
        reject(error)
      }
    })
    server.listen(3000, '127.0.0.1', () => server.close(resolve))
  })
}

try {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    throw new Error('Установите Node.js версии 22 или новее.')
  }
  await prepareEnvironment()
  if (!process.argv.includes('--setup-only')) {
    await checkLocalPort()
    const installed = await installDependencies()
    if (installed !== 0) process.exitCode = installed
    else process.exitCode = await runNpm(['run', 'dev'])
  }
} catch (error) {
  console.error(`Не удалось запустить проект: ${error.message}`)
  process.exitCode = 1
}
