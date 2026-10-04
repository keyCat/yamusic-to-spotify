const { readFile, stat } = require('node:fs/promises')
const { join } = require('node:path')

module.exports = async function assertDesktopTarget(context) {
  const platform = context.electronPlatformName
  const architecture = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][context.arch]
  const target = JSON.parse(await readFile(join(context.packager.projectDir, '.desktop', 'target.json'), 'utf8'))
  if (target.platform !== platform || target.architecture !== architecture) {
    throw new Error(`Staged resources target ${target.platform}-${target.architecture}; rebuild with DESKTOP_TARGET_PLATFORM=${platform} DESKTOP_TARGET_ARCH=${architecture} npm run desktop:build before packaging.`)
  }
  await stat(join(context.packager.projectDir, '.desktop', 'server', 'server', 'node_modules', 'better-sqlite3', 'prebuilds', `${platform}-${architecture}.node`))
}
