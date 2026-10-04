import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const argumentsList = process.argv.slice(2)
let binaryPath = require('electron')

async function runDesktopProcess(executablePath, argumentsList, environment = process.env) {
  const child = spawn(executablePath, argumentsList, { stdio: 'inherit', env: environment })
  const onInterrupt = () => child.kill('SIGINT')
  const onTerminate = () => child.kill('SIGTERM')
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onTerminate)
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (exitCode, signal) => resolve(exitCode ?? (signal === 'SIGINT' ? 130 : 1)))
    })
  } finally {
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onTerminate)
  }
}

if (process.platform === 'darwin') {
  // macOS uses bundle metadata for the Dock and menu-bar name.
  const exitCode = await runDesktopProcess(process.execPath, [
    require.resolve('electron-builder/cli.js'), '--config', 'electron-builder.yml',
    '--dir', '--publish', 'never', `--${process.arch}`,
    '--config.directories.output=.desktop/dev', '--config.mac.identity=null',
    '--config.mac.notarize=false',
  ], { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
  if (exitCode !== 0) process.exit(exitCode)
  const directory = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
  binaryPath = resolve('.desktop/dev', directory, 'YMusicToSpotify.app', 'Contents', 'MacOS', 'YMusicToSpotify')
} else {
  argumentsList.unshift(resolve('.desktop/app'))
}

process.exitCode = await runDesktopProcess(binaryPath, argumentsList)
