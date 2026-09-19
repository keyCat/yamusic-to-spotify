import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const algorithm = 'aes-256-gcm'

function readKey(encodedKey: string) {
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) throw new Error('INVALID_ENCRYPTION_KEY')
  return key
}

export function encryptSecret(value: unknown, encodedKey: string) {
  const key = readKey(encodedKey)
  const iv = randomBytes(12)
  const cipher = createCipheriv(algorithm, key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

export function decryptSecret<T>(value: string, encodedKey: string): T {
  const key = readKey(encodedKey)
  const payload = Buffer.from(value, 'base64url')
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const encrypted = payload.subarray(28)
  const decipher = createDecipheriv(algorithm, key, iv)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')) as T
}

export function hashSecret(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

export function createSecret(byteLength = 32) {
  return randomBytes(byteLength).toString('base64url')
}
