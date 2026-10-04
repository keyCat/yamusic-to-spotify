import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

await mkdir('.desktop', { recursive: true })
const dotenvPath = resolve('.desktop/build.env')
await writeFile(dotenvPath, '')
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(NUXT_|NITRO_|RUNTIME_CONFIG$)/i.test(name)))
const child = spawn(process.execPath, ['node_modules/nuxt/bin/nuxt.mjs', 'build', '--dotenv', dotenvPath], {
  stdio: 'inherit', env: environment,
})
child.once('error', error => { console.error(error.message); process.exitCode = 1 })
child.once('exit', code => { process.exitCode = code ?? 1 })
