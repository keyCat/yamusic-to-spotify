import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildBackendEnvironment } from '../../desktop/environment'

describe('desktop runtime configuration', () => {
  it('replaces inherited application settings and removes runtime injection variables', () => {
    const environment = buildBackendEnvironment({
      PATH: '/test/bin', NUXT_DATA_DIR: '/wrong', NUXT_ENCRYPTION_KEY: 'wrong',
      NUXT_SPOTIFY_CLIENT_ID: 'wrong', NUXT_SPOTIFY_MARKET: 'US', NUXT_ALLOWED_SPOTIFY_USERS: 'wrong',
      NITRO_HOST: '0.0.0.0', NITRO_ENV_PREFIX: 'EVIL_', NODE_OPTIONS: '--import evil',
      ELECTRON_RUN_AS_NODE: '1', RUNTIME_CONFIG: 'wrong', HOST: '0.0.0.0', PORT: '3000',
    }, '/profile', { spotifyClientId: '' }, 'stable-key', 54321, 'launch-secret', 'window-secret')
    expect(environment.NUXT_DATA_DIR).toBe(join('/profile', 'data'))
    expect(environment.NUXT_ENCRYPTION_KEY).toBe('stable-key')
    expect(environment.NUXT_SPOTIFY_CLIENT_ID).toBe('')
    expect(environment.NUXT_SPOTIFY_MARKET).toBe('SG')
    expect(environment.NUXT_ALLOWED_SPOTIFY_USERS).toBe('')
    expect(environment.HOST).toBe('127.0.0.1')
    expect(environment.NUXT_SPOTIFY_REDIRECT_URI).toBe('http://127.0.0.1:54321/api/auth/spotify/callback')
    for (const name of ['NITRO_HOST', 'NITRO_ENV_PREFIX', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'RUNTIME_CONFIG']) expect(environment).not.toHaveProperty(name)
    expect(environment.PATH).toBe('/test/bin')
  })
})
