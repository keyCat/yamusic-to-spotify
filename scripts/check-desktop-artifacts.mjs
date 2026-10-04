import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const artifacts = (await readdir('release')).filter(name => /\.(dmg|exe|AppImage|deb|zip|tar\.gz)$/.test(name))
if (!artifacts.length) throw new Error('No desktop distribution files found')
const sizes = []
for (const name of artifacts) {
  const filePath = join('release', name)
  const digest = createHash('sha256').update(await readFile(filePath)).digest('hex')
  await writeFile(`${filePath}.sha256`, `${digest}  ${name}\n`)
  sizes.push({ name, sizeBytes: (await stat(filePath)).size })
}
await writeFile('release/artifact-sizes.json', JSON.stringify(sizes, null, 2) + '\n')
console.log(JSON.stringify(sizes, null, 2))
