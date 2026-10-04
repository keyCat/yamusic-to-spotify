import { createServer, request as requestHttp, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as h3 from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'
import { closeDatabase, getDatabase } from '../../server/storage/database'
import { readSessionUser, saveAuthorizationRequest } from '../../server/storage/accounts'
import { encryptSecret, hashSecret } from '../../server/security/secrets'
import { desktopAuthorization } from '../../server/security/desktop-authorization'
import type { getServerConfig } from '../../server/config'

vi.mock('../../server/providers/spotify/oauth', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/providers/spotify/oauth')>()
  return {
    ...original,
    exchangeSpotifyCode: vi.fn(async () => ({ access_token: 'private-access', refresh_token: 'private-refresh', token_type: 'Bearer', expires_in: 3600 })),
    readSpotifyProfile: vi.fn(async () => ({ id: 'fixture-user', display_name: 'Fixture' })),
  }
})

let server: Server
let origin: string
let dataDir: string
let config: ReturnType<typeof getServerConfig> & { desktopLaunchSecret: string, desktopWindowSecret: string }

beforeEach(async () => {
  for (const name of ['defineEventHandler', 'getQuery', 'getCookie', 'setCookie', 'deleteCookie', 'setHeader', 'sendRedirect', 'createError', 'readBody', 'getHeader', 'getRequestURL'] as const) {
    vi.stubGlobal(name, h3[name])
  }
  dataDir = mkdtempSync(join(tmpdir(), 'desktop-oauth-'))
  config = {
    dataDir, encryptionKey: randomBytes(32).toString('base64'), spotifyClientId: 'a'.repeat(32),
    spotifyMarket: 'SG', spotifyRedirectUri: '', allowedSpotifyUsers: '',
    desktopLaunchSecret: 'launch-secret', desktopWindowSecret: 'window-secret',
  }
  vi.stubGlobal('useRuntimeConfig', () => config)
  const application = h3.createApp({ debug: false })
  application.use((await import('../../server/middleware/desktop')).default)
  application.use('/api/desktop/ready', (await import('../../server/api/desktop/ready.get')).default)
  application.use('/api/desktop/spotify/start', (await import('../../server/api/desktop/spotify/start.post')).default)
  application.use('/api/desktop/spotify/claim', (await import('../../server/api/desktop/spotify/claim.post')).default)
  application.use('/api/auth/spotify/callback', (await import('../../server/api/auth/spotify/callback.get')).default)
  server = createServer(h3.toNodeListener(application))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  config.spotifyRedirectUri = origin + '/api/auth/spotify/callback'
})

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  closeDatabase()
  rmSync(dataDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('Spotify callback and private desktop handoff', () => {
  it('authenticates server readiness with a challenge without requiring or returning the launch credential', async () => {
    const challenge = randomBytes(32).toString('hex')
    const response = await fetch(`${origin}/api/desktop/ready?challenge=${challenge}`)
    expect(response.status).toBe(200)
    const result = await response.json() as { proof: string }
    expect(result.proof).toBe(createHmac('sha256', config.desktopLaunchSecret).update(`desktop-ready:${challenge}`).digest('hex'))
    expect(result.proof).not.toContain(config.desktopLaunchSecret)
    config.desktopLaunchSecret = ''
    expect((await fetch(`${origin}/api/desktop/ready?challenge=${challenge}`)).status).toBe(403)
  })

  it('completes a simulated provider exchange without a browser cookie and claims the session only once', async () => {
    const started = await fetch(origin + '/api/desktop/spotify/start', { method: 'POST', headers: { 'x-desktop-secret': 'launch-secret' } })
    expect(started.status).toBe(200)
    const attempt = await started.json() as { id: string, url: string }
    const authorizationUrl = new URL(attempt.url)
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(config.spotifyRedirectUri)
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    const state = authorizationUrl.searchParams.get('state')!
    const callback = await fetch(`${origin}/api/auth/spotify/callback?state=${state}&code=fixture-code`)
    const html = await callback.text()
    expect(html).toContain('Spotify подключен')
    expect(html).not.toContain('private-access')
    expect(html).not.toContain('private-refresh')
    expect(callback.headers.has('set-cookie')).toBe(false)
    const claim = () => fetch(origin + '/api/desktop/spotify/claim', {
      method: 'POST', headers: { 'x-desktop-secret': 'launch-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ id: attempt.id }),
    })
    const result = await (await claim()).json() as { status: string, session: string }
    expect(result.status).toBe('complete')
    expect(readSessionUser(getDatabase(dataDir), hashSecret(result.session))?.spotifyId).toBe('fixture-user')
    expect((await (await claim()).json()).status).toBe('failed')
    expect(await (await fetch(`${origin}/api/auth/spotify/callback?state=${state}&code=replay`)).text()).toContain('Авторизация не завершена')
  })

  it('rejects local browsers, renderer credentials, foreign origins and invalid Host headers from private endpoints', async () => {
    const rejectedHeaders: Record<string, string>[] = [{}, { 'x-desktop-window': 'window-secret' }, { 'x-desktop-secret': 'wrong' },
      { 'x-desktop-secret': 'launch-secret', origin: 'https://evil.test' }]
    for (const headers of rejectedHeaders) {
      const response = await fetch(origin + '/api/desktop/spotify/start', { method: 'POST', headers })
      expect(response.status, JSON.stringify(headers)).toBe(403)
    }
    // Node fetch normalizes Host; use a raw HTTP request to test DNS rebinding protection.
    const statusCode = await new Promise<number | undefined>((resolve, reject) => {
      const request = requestHttp(origin + '/api/desktop/spotify/start', {
        method: 'POST', headers: { 'x-desktop-secret': 'launch-secret', host: 'evil.test' },
      }, response => { response.resume(); resolve(response.statusCode) })
      request.once('error', reject)
      request.end()
    })
    expect(statusCode).toBe(403)
  })

  it('handles provider cancellation and invalid state without saving account credentials', async () => {
    const id = desktopAuthorization.createAttempt('cancel-state', 'verifier')
    expect(await (await fetch(origin + '/api/auth/spotify/callback?state=unknown&code=code')).text()).toContain('Авторизация не завершена')
    expect(await (await fetch(origin + '/api/auth/spotify/callback?state=cancel-state&error=access_denied')).text()).toContain('Авторизация не завершена')
    expect(desktopAuthorization.claimSession(id).status).toBe('failed')
    expect(getDatabase(dataDir).prepare('SELECT COUNT(*) AS count FROM account_connections').get()).toEqual({ count: 0 })
  })

  it('preserves the local and Docker browser flow with an HttpOnly session cookie', async () => {
    config.desktopLaunchSecret = ''
    config.desktopWindowSecret = ''
    saveAuthorizationRequest(getDatabase(dataDir), {
      provider: 'spotify', sessionKeyHash: hashSecret('browser-key'), stateHash: hashSecret('browser-state'),
      encryptedVerifier: encryptSecret('verifier', config.encryptionKey),
    })
    const response = await fetch(origin + '/api/auth/spotify/callback?state=browser-state&code=fixture-code', {
      headers: { cookie: 'yamusic_preauth=browser-key' }, redirect: 'manual',
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/')
    expect(response.headers.get('set-cookie')).toContain('yamusic_session=')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  })
})
