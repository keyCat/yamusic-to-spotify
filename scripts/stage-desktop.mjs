import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const platform = process.env.DESKTOP_TARGET_PLATFORM || process.platform
const architecture = process.env.DESKTOP_TARGET_ARCH || process.arch
if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(architecture)) {
  throw new Error('Unsupported desktop target')
}
await rm('.desktop/app', { recursive: true, force: true })
await mkdir('.desktop/app', { recursive: true })
await cp('.desktop/host/desktop', '.desktop/app/desktop', { recursive: true })
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
await writeFile('.desktop/app/package.json', JSON.stringify({
  name: manifest.name, productName: manifest.productName, version: manifest.version, description: manifest.description,
  author: { name: 'keyCat' }, license: manifest.license, main: 'desktop/main.js', type: 'commonjs',
}, null, 2))
await rm('.desktop/server', { recursive: true, force: true })
await cp('.output', '.desktop/server', { recursive: true, dereference: true })

async function pruneResources(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name)
    if ((directory.endsWith('prebuilds') && entry.name !== `${platform}-${architecture}.node` && entry.name !== `${platform}-${architecture}`)
      || /^\.env/.test(entry.name) || /\.(map|sqlite|sqlite-wal|sqlite-shm|log)$/.test(entry.name)) {
      await rm(filePath, { recursive: true, force: true })
    } else if (entry.isDirectory()) {
      if (directory.endsWith('prebuilds') && entry.name !== `${platform}-${architecture}`) {
        await rm(filePath, { recursive: true, force: true })
      } else await pruneResources(filePath)
    }
  }
}
await pruneResources('.desktop/server')
await writeFile('.desktop/target.json', JSON.stringify({ platform, architecture }))
console.log(`Desktop resources staged for ${platform}-${architecture}`)
