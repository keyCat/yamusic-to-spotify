import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureEncryptionKey, parseDesktopSettings, readDesktopSettings, updatePrivateFile, type KeyProtectionOptions } from '../../desktop/settings'
import { encryptSecret, decryptSecret } from '../../server/security/secrets'

const profiles: string[] = []
async function createProfile() {
  const path = await mkdtemp(join(tmpdir(), 'desktop-settings-'))
  profiles.push(path)
  return path
}
const protection: KeyProtectionOptions = {
  isAvailable: () => true,
  encrypt: value => Buffer.from(`protected:${value}`),
  decrypt: value => value.toString().replace(/^protected:/, ''),
  confirmFileStorage: async () => false,
}
afterEach(async () => { await Promise.all(profiles.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('desktop settings and encryption key persistence', () => {
  it('starts without a client ID and persists only validated ordinary settings', async () => {
    const profile = await createProfile()
    const settings = await readDesktopSettings(profile)
    expect(settings).toEqual({ version: 1, spotifyClientId: '' })
    // Older profiles may contain a market; loading and saving must discard it.
    const legacySettings = { ...settings, spotifyClientId: 'a'.repeat(32), spotifyMarket: 'US' }
    await updatePrivateFile(join(profile, 'settings.json'), legacySettings)
    expect(await readDesktopSettings(profile)).toEqual({ version: 1, spotifyClientId: 'a'.repeat(32) })
    const next = parseDesktopSettings({ ...legacySettings, ignoredSecret: 'secret' })
    await updatePrivateFile(join(profile, 'settings.json'), next)
    expect(await readDesktopSettings(profile)).toEqual(next)
    expect(await readFile(join(profile, 'settings.json'), 'utf8')).not.toContain('secret')
    expect(await readFile(join(profile, 'settings.json'), 'utf8')).not.toContain('spotifyMarket')
    if (process.platform !== 'win32') expect((await stat(join(profile, 'settings.json'))).mode & 0o777).toBe(0o600)
  })

  it('rejects malformed settings without overwriting them', async () => {
    const profile = await createProfile()
    await writeFile(join(profile, 'settings.json'), 'corrupt')
    await expect(readDesktopSettings(profile)).rejects.toThrow()
    expect(await readFile(join(profile, 'settings.json'), 'utf8')).toBe('corrupt')
    expect(() => parseDesktopSettings({ version: 2, spotifyClientId: '' })).toThrow()
    expect(() => parseDesktopSettings({ version: 1, spotifyClientId: 'wrong' })).toThrow()
  })

  it('uses the same protected key after restart to read existing account tokens', async () => {
    const profile = await createProfile()
    const firstKey = await ensureEncryptionKey(profile, protection)
    const tokens = encryptSecret({ refresh_token: 'fixture-refresh-token' }, firstKey)
    const storedKey = await readFile(join(profile, 'encryption-key.json'), 'utf8')
    const secondKey = await ensureEncryptionKey(profile, protection)
    expect(decryptSecret(tokens, secondKey)).toEqual({ refresh_token: 'fixture-refresh-token' })
    expect(await readFile(join(profile, 'encryption-key.json'), 'utf8')).toBe(storedKey)
    await expect(ensureEncryptionKey(profile, { ...protection, isAvailable: () => false })).rejects.toThrow('хранилище')
    expect(await readFile(join(profile, 'encryption-key.json'), 'utf8')).toBe(storedKey)
  })

  it('refuses to generate a replacement key for an existing database', async () => {
    const profile = await createProfile()
    await mkdir(join(profile, 'data'))
    await writeFile(join(profile, 'data', 'application.sqlite'), 'existing database')
    await expect(ensureEncryptionKey(profile, protection)).rejects.toThrow('Ключ шифрования отсутствует')
    await expect(stat(join(profile, 'encryption-key.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('requires explicit acceptance before storing a private file without OS protection', async () => {
    const profile = await createProfile()
    const confirm = vi.fn(async () => false)
    await expect(ensureEncryptionKey(profile, { ...protection, isAvailable: () => false, confirmFileStorage: confirm })).rejects.toThrow()
    expect(confirm).toHaveBeenCalledOnce()
    const key = await ensureEncryptionKey(profile, { ...protection, isAvailable: () => false, confirmFileStorage: async () => true })
    expect(key).toHaveLength(44)
    expect(JSON.parse(await readFile(join(profile, 'encryption-key.json'), 'utf8')).protection).toBe('private-file')
    expect(await ensureEncryptionKey(profile, protection)).toBe(key)
  })

  it('preserves corrupt and unknown key formats', async () => {
    const profile = await createProfile()
    for (const value of ['corrupt', 'null', JSON.stringify({ version: 1, protection: 'unknown', value: randomBytes(32).toString('base64') })]) {
      await writeFile(join(profile, 'encryption-key.json'), value)
      await expect(ensureEncryptionKey(profile, protection)).rejects.toThrow()
      expect(await readFile(join(profile, 'encryption-key.json'), 'utf8')).toBe(value)
    }
  })
})
