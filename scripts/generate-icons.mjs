import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sourcePath = 'build/icon-gradient.png'
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'music-icons-'))
const iconsetDirectory = join(temporaryDirectory, 'icon.iconset')

function convertIcon(argumentsList) {
  execFileSync('magick', [sourcePath, ...argumentsList], { stdio: 'inherit' })
}

try {
  await mkdir('public', { recursive: true })
  await mkdir(iconsetDirectory)
  convertIcon(['-resize', '1024x1024', 'build/icon.png'])
  convertIcon(['-define', 'icon:auto-resize=256,128,64,48,32,16', 'build/icon.ico'])
  convertIcon(['-resize', '512x512', 'public/icon.png'])
  convertIcon(['-resize', '32x32', 'public/favicon.png'])
  convertIcon(['-define', 'icon:auto-resize=48,32,16', 'public/favicon.ico'])
  convertIcon(['-resize', '180x180', 'public/apple-touch-icon.png'])
  for (const sizePixels of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const suffix = scale === 2 ? '@2x' : ''
      const filename = `icon_${sizePixels}x${sizePixels}${suffix}.png`
      convertIcon(['-resize', `${sizePixels * scale}x${sizePixels * scale}`, join(iconsetDirectory, filename)])
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconsetDirectory, '-o', 'build/icon.icns'], { stdio: 'inherit' })
  console.log('Desktop icons and web favicons generated from ' + sourcePath)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
