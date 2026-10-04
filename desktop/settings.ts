import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesktopSettingsDto } from '../shared/desktop-api'

export type DesktopSettingsRecord = DesktopSettingsDto & { version: 1 }
export type KeyProtectionOptions = {
  isAvailable: () => boolean
  encrypt: (value: string) => Buffer
  decrypt: (value: Buffer) => string
  confirmFileStorage: () => Promise<boolean>
}

export function parseDesktopSettings(value: unknown): DesktopSettingsRecord {
  if (!value || typeof value !== 'object') throw new Error('Настройки повреждены: ожидается объект.')
  const record = value as Record<string, unknown>
  if (record.version !== 1 || typeof record.spotifyClientId !== 'string'
    || (record.spotifyClientId !== '' && !/^[a-fA-F0-9]{32}$/.test(record.spotifyClientId))) {
    throw new Error('Настройки повреждены или имеют неподдерживаемую версию.')
  }
  return { version: 1, spotifyClientId: record.spotifyClientId }
}

export async function updatePrivateFile(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporaryPath, filePath)
  } finally {
    await unlink(temporaryPath).catch(() => {})
  }
}

export async function readDesktopSettings(profilePath: string): Promise<DesktopSettingsRecord> {
  await mkdir(profilePath, { recursive: true, mode: 0o700 })
  try {
    return parseDesktopSettings(JSON.parse(await readFile(join(profilePath, 'settings.json'), 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('Не удалось прочитать settings.json. Проверьте доступ к профилю и восстановите настройки из резервной копии.')
    }
    return { version: 1, spotifyClientId: '' }
  }
}

export async function ensureEncryptionKey(profilePath: string, protection: KeyProtectionOptions) {
  const keyPath = join(profilePath, 'encryption-key.json')
  let keyRecord: { version: number, protection: string, value: string }
  try {
    keyRecord = JSON.parse(await readFile(keyPath, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Файл ключа поврежден. Восстановите профиль из резервной копии.')
    const hasDatabase = await stat(join(profilePath, 'data', 'application.sqlite')).then(() => true, error => {
      if (error.code !== 'ENOENT') throw error
      return false
    })
    if (hasDatabase) throw new Error('Ключ шифрования отсутствует. Восстановите encryption-key.json из резервной копии; существующая база сохранена.')
    const encryptionKey = randomBytes(32).toString('base64')
    if (protection.isAvailable()) {
      keyRecord = { version: 1, protection: 'safeStorage', value: protection.encrypt(encryptionKey).toString('base64') }
    } else {
      if (!await protection.confirmFileStorage()) throw new Error('Настройте системное хранилище ключей и запустите приложение снова.')
      keyRecord = { version: 1, protection: 'private-file', value: encryptionKey }
    }
    await updatePrivateFile(keyPath, keyRecord)
  }
  if (!keyRecord || keyRecord.version !== 1 || typeof keyRecord.value !== 'string') throw new Error('Файл ключа имеет неподдерживаемый формат.')
  let encryptionKey: string
  if (keyRecord.protection === 'safeStorage') {
    if (!protection.isAvailable()) throw new Error('Системное хранилище ключей недоступно. Разблокируйте его и запустите приложение снова.')
    try {
      encryptionKey = protection.decrypt(Buffer.from(keyRecord.value, 'base64'))
    } catch {
      throw new Error('Не удалось расшифровать ключ. Разблокируйте системную связку ключей или восстановите профиль для этой учетной записи ОС.')
    }
  } else if (keyRecord.protection === 'private-file') {
    encryptionKey = keyRecord.value
  } else {
    throw new Error('Неизвестный способ защиты ключа.')
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey) || Buffer.from(encryptionKey, 'base64').length !== 32) {
    throw new Error('Ключ шифрования поврежден. Восстановите профиль из резервной копии.')
  }
  return encryptionKey
}
