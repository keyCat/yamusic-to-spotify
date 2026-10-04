import { describe, expect, it } from 'vitest'
import { hasDesktopCredential } from '../../server/security/desktop'
import { isAllowedExternalUrl, isReportUrl, isTrustedRendererUrl } from '../../desktop/security'
import { DesktopAuthorization } from '../../server/security/desktop-authorization'

describe('desktop authority boundaries', () => {
  it('rejects unknown, empty and length-mismatched credentials', () => {
    expect(hasDesktopCredential(undefined, 'secret')).toBe(false)
    expect(hasDesktopCredential('', '')).toBe(false)
    expect(hasDesktopCredential('secrets', 'secret')).toBe(false)
    expect(hasDesktopCredential('Secret', 'secret')).toBe(false)
    expect(hasDesktopCredential('secret', 'secret')).toBe(true)
  })

  it('allows exact provider HTTPS hosts and rejects executable or misleading URLs', () => {
    expect(isAllowedExternalUrl('https://accounts.spotify.com/authorize?client_id=fixture')).toBe(true)
    expect(isAllowedExternalUrl('https://oauth.yandex.ru/device')).toBe(true)
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://open.spotify.com/',
      'https://open.spotify.com.evil.test/', 'https://evil.test@open.spotify.com/',
      'https://accounts.spotify.com:8443/', 'https://127.0.0.1/']) expect(isAllowedExternalUrl(url)).toBe(false)
  })

  it('limits trusted IPC documents and downloads to the active application', () => {
    const origin = 'http://127.0.0.1:54321'
    expect(isTrustedRendererUrl(origin + '/?authError=x', origin)).toBe(true)
    expect(isTrustedRendererUrl(origin + '/api/status', origin)).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:54322/', origin)).toBe(false)
    expect(isReportUrl(origin + '/api/jobs/00000000-0000-4000-8000-000000000000/report?format=csv', origin)).toBe(true)
    expect(isReportUrl(origin + '/api/jobs/../../etc/report', origin)).toBe(false)
    expect(isReportUrl('https://evil.test/api/jobs/00000000-0000-4000-8000-000000000000/report', origin)).toBe(false)
  })
})

describe('desktop OAuth one-use handoff', () => {
  it('binds callback to state and claim to the private attempt ID', () => {
    const authorization = new DesktopAuthorization()
    const id = authorization.createAttempt('state', 'verifier', 1000)
    expect(authorization.consumeCallback('wrong', 1100)).toBeUndefined()
    expect(authorization.claimSession('wrong', 1100).status).toBe('failed')
    expect(authorization.claimSession(id, 1100).status).toBe('pending')
    const request = authorization.consumeCallback('state', 1100)!
    expect(request.verifier).toBe('verifier')
    expect(authorization.consumeCallback('state', 1100)).toBeUndefined()
    expect(authorization.claimSession(id, 1100).status).toBe('pending')
    authorization.completeAttempt(request, 'private-session', 1100)
    expect(authorization.claimSession(id, 1100)).toEqual({ status: 'complete', session: 'private-session' })
    expect(authorization.claimSession(id, 1100).status).toBe('failed')
  })

  it('invalidates expired, replaced and restarted attempts', () => {
    const authorization = new DesktopAuthorization()
    const oldId = authorization.createAttempt('old-state', 'verifier', 0)
    const request = authorization.consumeCallback('old-state', 1)!
    const newId = authorization.createAttempt('new-state', 'verifier', 2)
    expect(authorization.completeAttempt(request, 'session')).toBe(false)
    expect(authorization.claimSession(oldId, 3).status).toBe('failed')
    expect(authorization.consumeCallback('new-state', 600_002)).toBeUndefined()
    expect(authorization.claimSession(newId, 600_002).status).toBe('failed')
    expect(new DesktopAuthorization().claimSession(newId, 3).status).toBe('failed')
  })

  it('reports cancellation without handing off a session', () => {
    const authorization = new DesktopAuthorization()
    const id = authorization.createAttempt('state', 'verifier')
    authorization.failAttempt(authorization.consumeCallback('state')!)
    expect(authorization.claimSession(id)).toEqual({ status: 'failed' })
  })
})
