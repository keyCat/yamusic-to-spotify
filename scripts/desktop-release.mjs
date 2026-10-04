import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function parseDesktopReleaseTag(tag, version) {
  if (typeof tag !== 'string' || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(tag)) {
    throw new Error('Use a version tag such as v1.0.0 or v1.0.0-rc.1.')
  }
  if (tag.slice(1) !== version) throw new Error(`Tag ${tag} does not match package.json version ${version}.`)
  return { tag, version, isPrerelease: version.includes('-') }
}

export function buildDesktopReleaseInstallers(name, version) {
  return [
    { directory: 'desktop-darwin-arm64', name: `${name}-${version}-mac-arm64.dmg` },
    { directory: 'desktop-darwin-x64', name: `${name}-${version}-mac-x64.dmg` },
    { directory: 'desktop-win32-x64', name: `${name}-${version}-win-x64.exe` },
    { directory: 'desktop-linux-x64', name: `${name}-${version}-linux-x86_64.AppImage` },
    { directory: 'desktop-linux-x64', name: `${name}-${version}-linux-amd64.deb` },
    { directory: 'desktop-win32-x64', name: `${name}-${version}-win-x64.zip` },
    { directory: 'desktop-linux-x64', name: `${name}-${version}-linux-x64.tar.gz` },
  ]
}

async function readDesktopInstaller(filePath, name) {
  const contents = await readFile(filePath)
  const digest = createHash('sha256').update(contents).digest('hex')
  const checksum = `${digest}  ${name}\n`
  if (await readFile(`${filePath}.sha256`, 'utf8') !== checksum) {
    throw new Error(`Installer checksum mismatch: ${name}`)
  }
  return { name, filePath, checksum, sizeBytes: contents.length }
}

export async function stageDesktopRelease({ name, version, artifactDirectory, outputDirectory }) {
  const installers = []
  for (const installer of buildDesktopReleaseInstallers(name, version)) {
    const filePath = join(artifactDirectory, installer.directory, installer.name)
    installers.push(await readDesktopInstaller(filePath, installer.name))
  }
  await mkdir(outputDirectory, { recursive: true })
  for (const installer of installers) {
    await cp(installer.filePath, join(outputDirectory, installer.name))
    await writeFile(join(outputDirectory, `${installer.name}.sha256`), installer.checksum)
  }
  await writeFile(join(outputDirectory, 'SHA256SUMS'), installers.map(installer => installer.checksum).join(''))
  await writeFile(join(outputDirectory, 'artifact-sizes.json'), JSON.stringify(
    installers.map(({ name, sizeBytes }) => ({ name, sizeBytes })), null, 2,
  ) + '\n')
  return installers.map(installer => installer.name)
}

export async function readDesktopReleaseAssets({ name, version, artifactDirectory }) {
  const installers = buildDesktopReleaseInstallers(name, version)
  const filenames = [
    ...installers.flatMap(installer => [installer.name, `${installer.name}.sha256`]),
    'SHA256SUMS', 'artifact-sizes.json',
  ].sort()
  if (JSON.stringify((await readdir(artifactDirectory)).sort()) !== JSON.stringify(filenames)) {
    throw new Error('Release assets must contain all seven versioned distribution files, checksums and size metadata.')
  }
  const verifiedInstallers = []
  for (const installer of installers) {
    verifiedInstallers.push(await readDesktopInstaller(join(artifactDirectory, installer.name), installer.name))
  }
  if (await readFile(join(artifactDirectory, 'SHA256SUMS'), 'utf8') !== verifiedInstallers.map(installer => installer.checksum).join('')) {
    throw new Error('Combined installer checksums do not match.')
  }
  return filenames
}

async function runDesktopReleaseCommand() {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const release = parseDesktopReleaseTag(process.env.RELEASE_TAG, manifest.version)
  if (process.argv[2] === 'validate') {
    const lockfile = JSON.parse(await readFile('package-lock.json', 'utf8'))
    if (lockfile.version !== manifest.version || lockfile.packages[''].version !== manifest.version) {
      throw new Error('package-lock.json version must match package.json. Update the version with npm version.')
    }
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `tag=${release.tag}\ncommit=${commit}\n`)
    console.log(`Release ${release.tag} will build commit ${commit}.`)
  } else if (process.argv[2] === 'collect') {
    const installers = await stageDesktopRelease({
      name: manifest.name, version: manifest.version,
      artifactDirectory: 'release-artifacts', outputDirectory: 'release-publish',
    })
    console.log(`Verified ${installers.length} distribution files and their checksums for ${release.tag}.`)
  } else throw new Error('Use validate or collect.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runDesktopReleaseCommand()
}
