import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, hashSecret } from '../../server/security/secrets'

describe('secret protection', () => {
  const key = randomBytes(32).toString('base64')

  it('encrypts and decrypts a value', () => {
    const encrypted = encryptSecret({ accessToken: 'private' }, key)
    expect(encrypted).not.toContain('private')
    expect(decryptSecret(encrypted, key)).toEqual({ accessToken: 'private' })
  })

  it('creates stable hashes', () => {
    expect(hashSecret('session')).toBe(hashSecret('session'))
    expect(hashSecret('session')).not.toBe(hashSecret('another session'))
  })
})
