import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { buildDesktopPackageEnvironment } from './desktop-package-environment.mjs'

const require = createRequire(import.meta.url)
const child = spawn(process.execPath, [
  require.resolve('electron-builder/cli.js'), '--config', 'electron-builder.yml',
  '--publish', 'never', ...process.argv.slice(2),
], { stdio: 'inherit', env: buildDesktopPackageEnvironment(process.env) })

process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
child.once('error', error => { console.error(error.message); process.exitCode = 1 })
child.once('exit', (exitCode, signal) => { process.exitCode = exitCode ?? (signal === 'SIGINT' ? 130 : 1) })
