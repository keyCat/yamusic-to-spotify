import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDesktopReleaseTag, readDesktopReleaseAssets } from './desktop-release.mjs'

export async function publishDesktopRelease({ github, repository, tag, commit, artifactDirectory }) {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const { isPrerelease } = parseDesktopReleaseTag(tag, manifest.version)
  const filenames = await readDesktopReleaseAssets({ name: manifest.name, version: manifest.version, artifactDirectory })
  // Verify that the existing remote tag still points to the commit all jobs built.
  await github.rest.git.getRef({ ...repository, ref: `tags/${tag}` })
  const taggedCommit = await github.rest.repos.getCommit({ ...repository, ref: `refs/tags/${tag}` })
  if (taggedCommit.data.sha !== commit) throw new Error('The release tag moved after the builds started.')
  let release
  try {
    release = (await github.rest.repos.getReleaseByTag({ ...repository, tag })).data
  } catch (error) {
    if (error.status !== 404) throw error
    const notes = await github.rest.repos.generateReleaseNotes({ ...repository, tag_name: tag })
    release = (await github.rest.repos.createRelease({
      ...repository, tag_name: tag, target_commitish: commit, name: tag,
      body: notes.data.body, draft: true, prerelease: isPrerelease,
    })).data
  }
  if (!release.draft) throw new Error(`Release ${tag} is already published. Use a new version tag.`)
  const existingAssets = await github.paginate(github.rest.repos.listReleaseAssets, {
    ...repository, release_id: release.id, per_page: 100,
  })
  for (const name of filenames) {
    const existingAsset = existingAssets.find(asset => asset.name === name)
    if (existingAsset) await github.rest.repos.deleteReleaseAsset({ ...repository, asset_id: existingAsset.id })
    const contents = await readFile(join(artifactDirectory, name))
    await github.rest.repos.uploadReleaseAsset({
      ...repository, release_id: release.id, name,
      data: contents,
      headers: { 'content-type': 'application/octet-stream', 'content-length': contents.length },
    })
  }
  const publishedRelease = await github.rest.repos.updateRelease({
    ...repository, release_id: release.id, draft: false, prerelease: isPrerelease,
  })
  return publishedRelease.data.html_url
}
