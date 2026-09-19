import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const launcher = resolve('scripts/start.mjs')
const fixtures = []

function createFixture(existingEnv) {
  const directory = mkdtempSync(resolve(tmpdir(), 'playlist-start-'))
  fixtures.push(directory)
  writeFileSync(resolve(directory, '.env.example'), [
    'NUXT_ENCRYPTION_KEY=',
    'NUXT_SPOTIFY_CLIENT_ID=',
    'NUXT_SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback',
    'NUXT_DATA_DIR=./data',
    '',
  ].join('\n'))
  if (existingEnv !== undefined) writeFileSync(resolve(directory, '.env'), existingEnv)
  return directory
}

function runSetup(directory, input = '') {
  return spawnSync(process.execPath, [launcher, '--setup-only'], {
    cwd: directory,
    input,
    encoding: 'utf8',
    timeout: 5_000,
    env: { ...process.env, NUXT_SPOTIFY_CLIENT_ID: '' },
  })
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('local startup', () => {
  it('creates a private configuration with a unique key and the localhost callback', () => {
    const directory = createFixture()
    const result = runSetup(directory, 'spotifyclientid12345678901234567890\n')

    expect(result.status).toBe(0)
    const content = readFileSync(resolve(directory, '.env'), 'utf8')
    const key = content.match(/^NUXT_ENCRYPTION_KEY=(.+)$/m)?.[1]
    expect(Buffer.from(key, 'base64')).toHaveLength(32)
    expect(content).toContain('NUXT_SPOTIFY_CLIENT_ID=spotifyclientid12345678901234567890')
    expect(content).toContain('NUXT_SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback')
    expect(content).toContain('NUXT_DATA_DIR=./data')
  })

  it('keeps the existing key and client ID on later runs', () => {
    const directory = createFixture([
      `NUXT_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
      'NUXT_SPOTIFY_CLIENT_ID=existingclientid',
      'NUXT_SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback',
      '',
    ].join('\n'))
    const before = readFileSync(resolve(directory, '.env'), 'utf8')

    const result = runSetup(directory)

    expect(result.status).toBe(0)
    expect(readFileSync(resolve(directory, '.env'), 'utf8')).toBe(before)
  })

  it('fills a missing key without replacing other settings', () => {
    const directory = createFixture([
      'NUXT_ENCRYPTION_KEY=',
      'NUXT_SPOTIFY_CLIENT_ID=existingclientid',
      'NUXT_SPOTIFY_REDIRECT_URI=https://example.com/api/auth/spotify/callback',
      '',
    ].join('\n'))

    const result = runSetup(directory)

    expect(result.status).toBe(0)
    const content = readFileSync(resolve(directory, '.env'), 'utf8')
    const key = content.match(/^NUXT_ENCRYPTION_KEY=(.+)$/m)?.[1]
    expect(Buffer.from(key, 'base64')).toHaveLength(32)
    expect(content).toContain('NUXT_SPOTIFY_CLIENT_ID=existingclientid')
    expect(content).toContain('NUXT_SPOTIFY_REDIRECT_URI=https://example.com/api/auth/spotify/callback')
  })

  it('does not create configuration when the client ID is missing', () => {
    const directory = createFixture()

    const result = runSetup(directory)

    expect(result.status).toBe(1)
    expect(existsSync(resolve(directory, '.env'))).toBe(false)
    expect(result.stderr).toContain('Client ID')
  })
})
