import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const isArchive = process.argv.includes('--archive')
const isPackaged = isArchive || process.argv.includes('--packaged')
if (isArchive && !['win32', 'linux'].includes(process.platform)) throw new Error('Archive smoke checks require Windows or Linux')
const profilePath = await mkdtemp(join(tmpdir(), 'music desktop smoke-музыка-'))
let hasPassed = false
let child
try {
  // Explicit smoke fixture: no provider credentials and no OS keychain changes.
  await writeFile(join(profilePath, 'encryption-key.json'), JSON.stringify({
    version: 1, protection: 'private-file', value: randomBytes(32).toString('base64'),
  }), { mode: 0o600 })
  let binaryPath = createRequire(import.meta.url)('electron')
  const argumentsList = isPackaged ? [] : [resolve('.desktop/app')]
  if (isArchive) {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'))
    const extractionPath = join(profilePath, 'extracted')
    await mkdir(extractionPath)
    if (process.platform === 'win32') {
      const archivePath = resolve('release', `${manifest.name}-${manifest.version}-win-${process.arch}.zip`)
      const archiveLiteral = archivePath.replaceAll("'", "''")
      const extractionLiteral = extractionPath.replaceAll("'", "''")
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath '${archiveLiteral}' -DestinationPath '${extractionLiteral}'`], { stdio: 'inherit' })
      binaryPath = join(extractionPath, `${manifest.productName}.exe`)
    } else {
      const archiveName = `${manifest.name}-${manifest.version}-linux-${process.arch}`
      execFileSync('tar', ['-xzf', resolve('release', `${archiveName}.tar.gz`), '-C', extractionPath], { stdio: 'inherit' })
      binaryPath = join(extractionPath, archiveName, 'music-without-borders')
    }
  } else if (isPackaged) {
    if (process.platform === 'darwin') {
      const directories = await readdir('release')
      const directory = directories.find(name => name === (process.arch === 'arm64' ? 'mac-arm64' : 'mac'))
      if (!directory) throw new Error('Packaged macOS application not found')
      binaryPath = resolve('release', directory, 'YMusicToSpotify.app', 'Contents', 'MacOS', 'YMusicToSpotify')
    } else if (process.platform === 'win32') binaryPath = resolve('release/win-unpacked/YMusicToSpotify.exe')
    else binaryPath = resolve('release/linux-unpacked/music-without-borders')
  }
  argumentsList.push(`--desktop-profile=${profilePath}`, '--desktop-smoke-test')
  child = spawn(binaryPath, argumentsList, { stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, NUXT_SPOTIFY_CLIENT_ID: 'ambient-must-be-ignored', NUXT_DATA_DIR: join(profilePath, 'wrong-data'),
  } })
  child.stdout.on('data', chunk => {
    const output = chunk.toString()
    if (output.includes('DESKTOP_SMOKE_OK')) hasPassed = true
    process.stdout.write(output)
  })
  child.stderr.on('data', chunk => process.stderr.write(chunk))
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  }).finally(() => clearTimeout(timer))
  if (exitCode !== 0 || !hasPassed) throw new Error(`Desktop smoke check failed (${exitCode})`)
  // Repeat with the same profile to check migrations, stable key and database reopen.
  const secondChild = spawn(binaryPath, argumentsList, { stdio: 'inherit' })
  const secondTimer = setTimeout(() => secondChild.kill('SIGKILL'), 60_000)
  const secondExitCode = await new Promise((resolve, reject) => {
    secondChild.once('error', reject)
    secondChild.once('exit', resolve)
  }).finally(() => clearTimeout(secondTimer))
  if (secondExitCode !== 0) throw new Error('Desktop profile reopen check failed')
} finally {
  if (child && child.exitCode === null) child.kill('SIGKILL')
  await rm(profilePath, { recursive: true, force: true })
}
