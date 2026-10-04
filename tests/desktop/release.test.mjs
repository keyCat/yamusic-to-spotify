import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDesktopReleaseInstallers, parseDesktopReleaseTag, stageDesktopRelease } from '../../scripts/desktop-release.mjs'
import { publishDesktopRelease } from '../../scripts/publish-desktop-release.mjs'

const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const fixtureVersion = '1.2.3'
const fixtureName = 'music'
const directories = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function createArtifactFixture({ name = fixtureName, version = fixtureVersion } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-release-'))
  directories.push(directory)
  const artifactDirectory = join(directory, 'artifacts')
  const outputDirectory = join(directory, 'publish')
  const installers = buildDesktopReleaseInstallers(name, version)
  for (const installer of installers) {
    const contents = Buffer.from(installer.name)
    const checksum = createHash('sha256').update(contents).digest('hex')
    await mkdir(join(artifactDirectory, installer.directory), { recursive: true })
    await writeFile(join(artifactDirectory, installer.directory, installer.name), contents)
    await writeFile(join(artifactDirectory, installer.directory, `${installer.name}.sha256`), `${checksum}  ${installer.name}\n`)
  }
  return { artifactDirectory, outputDirectory, installers }
}

function buildGithubFixture() {
  const release = { id: 42, draft: true, html_url: 'https://example.test/release' }
  const repos = {
    getCommit: vi.fn(async () => ({ data: { sha: 'built-commit' } })),
    getReleaseByTag: vi.fn(async () => { throw { status: 404 } }),
    generateReleaseNotes: vi.fn(async () => ({ data: { body: 'Release notes' } })),
    createRelease: vi.fn(async () => ({ data: release })),
    listReleaseAssets: vi.fn(),
    deleteReleaseAsset: vi.fn(async () => {}),
    uploadReleaseAsset: vi.fn(async () => {}),
    updateRelease: vi.fn(async () => ({ data: { ...release, draft: false } })),
  }
  return { rest: { git: { getRef: vi.fn(async () => ({})) }, repos }, paginate: vi.fn(async () => []) }
}

describe('desktop releases', () => {
  it('accepts matching stable and prerelease tags', () => {
    expect(parseDesktopReleaseTag('v1.2.3', '1.2.3').isPrerelease).toBe(false)
    expect(parseDesktopReleaseTag('v1.2.3-rc.1', '1.2.3-rc.1').isPrerelease).toBe(true)
  })

  it('rejects branch names, malformed tags and mismatched app versions', () => {
    for (const tag of ['main', '1.2.3', 'v01.2.3', 'v1.2', 'v1.2.3\ncommit=injected', 'v1.2.3/extra']) {
      expect(() => parseDesktopReleaseTag(tag, '1.2.3')).toThrow('version tag')
    }
    expect(() => parseDesktopReleaseTag('v1.2.4', '1.2.3')).toThrow('does not match')
  })

  it('collects all seven distributions and produces individual and combined checksums', async () => {
    const fixture = await createArtifactFixture()
    const names = await stageDesktopRelease({ name: fixtureName, version: fixtureVersion, ...fixture })
    expect(names).toEqual([
      'music-1.2.3-mac-arm64.dmg', 'music-1.2.3-mac-x64.dmg', 'music-1.2.3-win-x64.exe',
      'music-1.2.3-linux-x86_64.AppImage', 'music-1.2.3-linux-amd64.deb',
      'music-1.2.3-win-x64.zip', 'music-1.2.3-linux-x64.tar.gz',
    ])
    expect(await readdir(fixture.outputDirectory)).toHaveLength(16)
    const checksumLines = (await readFile(join(fixture.outputDirectory, 'SHA256SUMS'), 'utf8')).trim().split('\n')
    expect(checksumLines).toHaveLength(7)
    for (const name of names) {
      const content = await readFile(join(fixture.outputDirectory, name))
      const checksum = `${createHash('sha256').update(content).digest('hex')}  ${name}`
      expect(checksumLines).toContain(checksum)
      expect((await readFile(join(fixture.outputDirectory, `${name}.sha256`), 'utf8')).trim()).toBe(checksum)
    }
    const sizes = JSON.parse(await readFile(join(fixture.outputDirectory, 'artifact-sizes.json'), 'utf8'))
    expect(sizes).toEqual(names.map(name => ({ name, sizeBytes: Buffer.byteLength(name) })))
  })

  it('matches the installed packager architecture names for installers and archives', () => {
    const require = createRequire(import.meta.url)
    const { Arch, getArtifactArchName } = require('builder-util')
    const { expandMacro } = require('app-builder-lib/out/util/macroExpander.js')
    const installers = buildDesktopReleaseInstallers(fixtureName, fixtureVersion)
    for (const [extension, platform] of [['AppImage', 'linux'], ['deb', 'linux'], ['tar.gz', 'linux'], ['zip', 'win']]) {
      const name = expandMacro('${name}-${version}-${os}-${arch}.${ext}', getArtifactArchName(Arch.x64, extension),
        { name: fixtureName, version: fixtureVersion }, { os: platform, ext: extension })
      expect(installers.some(installer => installer.name === name)).toBe(true)
    }
  })

  it('rejects tampered installers before staging anything', async () => {
    const fixture = await createArtifactFixture()
    const installer = fixture.installers[3]
    await writeFile(join(fixture.artifactDirectory, installer.directory, installer.name), 'tampered')
    await expect(stageDesktopRelease({ name: fixtureName, version: fixtureVersion, ...fixture })).rejects.toThrow('checksum mismatch')
    await expect(readdir(fixture.outputDirectory)).rejects.toThrow()
  })

  it.each(['.zip', '.tar.gz'])('requires the %s archive before staging a release', async (extension) => {
    const fixture = await createArtifactFixture()
    const archive = fixture.installers.find(installer => installer.name.endsWith(extension))
    await rm(join(fixture.artifactDirectory, archive.directory, archive.name))
    await expect(stageDesktopRelease({ name: fixtureName, version: fixtureVersion, ...fixture })).rejects.toThrow()
    await expect(readdir(fixture.outputDirectory)).rejects.toThrow()
  })

  it('records checksums and sizes for installers and archives without including sidecar files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'desktop-checksums-'))
    directories.push(directory)
    await mkdir(join(directory, 'release'))
    const names = buildDesktopReleaseInstallers(fixtureName, fixtureVersion).map(installer => installer.name)
    for (const name of names) await writeFile(join(directory, 'release', name), name)
    await writeFile(join(directory, 'release', 'update.yml'), 'excluded')
    execFileSync(process.execPath, [resolve('scripts/check-desktop-artifacts.mjs')], { cwd: directory })
    const sizes = JSON.parse(await readFile(join(directory, 'release/artifact-sizes.json'), 'utf8'))
    expect(sizes).toHaveLength(7)
    for (const name of names) {
      expect(sizes).toContainEqual({ name, sizeBytes: Buffer.byteLength(name) })
      expect(await readFile(join(directory, 'release', `${name}.sha256`), 'utf8'))
        .toBe(`${createHash('sha256').update(name).digest('hex')}  ${name}\n`)
    }
  })

  it('rejects a missing platform installer', async () => {
    const fixture = await createArtifactFixture()
    const installer = fixture.installers[1]
    await rm(join(fixture.artifactDirectory, installer.directory, installer.name))
    await expect(stageDesktopRelease({ name: fixtureName, version: fixtureVersion, ...fixture })).rejects.toThrow()
    await expect(readdir(fixture.outputDirectory)).rejects.toThrow()
  })
})

describe('GitHub release publication', () => {
  async function loadPublishFixture() {
    const fixture = await createArtifactFixture({ name: manifest.name, version: manifest.version })
    await stageDesktopRelease({ name: manifest.name, version: manifest.version, ...fixture })
    const github = buildGithubFixture()
    return { github, options: {
      github, repository: { owner: 'owner', repo: 'repo' }, tag: `v${manifest.version}`,
      commit: 'built-commit', artifactDirectory: fixture.outputDirectory,
    } }
  }

  it('keeps the release in draft until every installer and checksum is uploaded', async () => {
    const { github, options } = await loadPublishFixture()
    expect(await publishDesktopRelease(options)).toBe('https://example.test/release')
    expect(github.rest.repos.createRelease).toHaveBeenCalledWith(expect.objectContaining({ draft: true, tag_name: options.tag }))
    expect(github.rest.repos.uploadReleaseAsset).toHaveBeenCalledTimes(16)
    for (const extension of ['.zip', '.tar.gz']) {
      expect(github.rest.repos.uploadReleaseAsset).toHaveBeenCalledWith(expect.objectContaining({
        name: expect.stringContaining(extension),
      }))
    }
    const uploadOrder = github.rest.repos.uploadReleaseAsset.mock.invocationCallOrder
    expect(github.rest.repos.updateRelease.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...uploadOrder))
    expect(github.rest.repos.updateRelease).toHaveBeenCalledWith(expect.objectContaining({ draft: false }))
  })

  it('does not publish when an asset upload fails', async () => {
    const { github, options } = await loadPublishFixture()
    github.rest.repos.uploadReleaseAsset.mockRejectedValueOnce(new Error('Upload failed'))
    await expect(publishDesktopRelease(options)).rejects.toThrow('Upload failed')
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled()
  })

  it('rejects incomplete or corrupted assets before making GitHub requests', async () => {
    const { github, options } = await loadPublishFixture()
    await writeFile(join(options.artifactDirectory, 'SHA256SUMS'), 'corrupted')
    await expect(publishDesktopRelease(options)).rejects.toThrow('Combined installer checksums')
    expect(github.rest.git.getRef).not.toHaveBeenCalled()
    await rm(join(options.artifactDirectory, 'SHA256SUMS'))
    await expect(publishDesktopRelease(options)).rejects.toThrow('all seven versioned distribution files')
    expect(github.rest.repos.createRelease).not.toHaveBeenCalled()
  })

  it('resumes a draft and replaces its incomplete matching assets', async () => {
    const { github, options } = await loadPublishFixture()
    github.rest.repos.getReleaseByTag.mockResolvedValue({ data: { id: 42, draft: true } })
    github.paginate.mockResolvedValue([{ id: 7, name: 'SHA256SUMS' }])
    await publishDesktopRelease(options)
    expect(github.rest.repos.createRelease).not.toHaveBeenCalled()
    expect(github.rest.repos.deleteReleaseAsset).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 7 }))
    expect(github.rest.repos.updateRelease).toHaveBeenCalledOnce()
  })

  it('preserves an already published release', async () => {
    const { github, options } = await loadPublishFixture()
    github.rest.repos.getReleaseByTag.mockResolvedValue({ data: { id: 42, draft: false } })
    await expect(publishDesktopRelease(options)).rejects.toThrow('already published')
    expect(github.rest.repos.uploadReleaseAsset).not.toHaveBeenCalled()
    expect(github.rest.repos.deleteReleaseAsset).not.toHaveBeenCalled()
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled()
  })

  it('refuses a missing or moved tag', async () => {
    const { github, options } = await loadPublishFixture()
    github.rest.git.getRef.mockRejectedValueOnce({ status: 404 })
    await expect(publishDesktopRelease(options)).rejects.toEqual({ status: 404 })
    github.rest.repos.getCommit.mockResolvedValue({ data: { sha: 'different-commit' } })
    await expect(publishDesktopRelease(options)).rejects.toThrow('tag moved')
    expect(github.rest.repos.createRelease).not.toHaveBeenCalled()
  })

  it('does not treat authentication or network errors as a missing release', async () => {
    const { github, options } = await loadPublishFixture()
    github.rest.repos.getReleaseByTag.mockRejectedValue({ status: 403 })
    await expect(publishDesktopRelease(options)).rejects.toEqual({ status: 403 })
    expect(github.rest.repos.createRelease).not.toHaveBeenCalled()
  })
})
