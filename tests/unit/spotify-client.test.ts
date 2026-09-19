import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSpotifySearchQuery,
  searchSpotifyTracks,
  searchSpotifyTracksByQuery,
  SpotifyProviderError,
  withSpotifyAccessToken,
} from '../../server/providers/spotify/client'
import { decryptSecret, encryptSecret } from '../../server/security/secrets'
import { initialMigration } from '../../server/storage/migrations/001_initial'

afterEach(() => vi.unstubAllGlobals())

describe('Spotify client', () => {
  it('creates a search query from the title and the first artist', () => {
    expect(createSpotifySearchQuery({ title: 'Песня', artists: ['Автор', 'Гость'] }))
      .toBe('track:Песня artist:Автор')
  })

  it('maps search results to match candidates', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      tracks: {
        items: [{
          uri: 'spotify:track:1',
          name: 'Песня',
          duration_ms: 123_000,
          is_playable: true,
          artists: [{ name: 'Автор' }],
          album: {
            name: 'Альбом',
            images: [{ url: 'https://i.scdn.co/image/cover', width: 640, height: 640 }],
          },
          external_ids: { isrc: 'TEST123' },
        }],
      },
    }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    const result = await searchSpotifyTracks('access-token', {
      uri: 'yandex:track:1',
      title: 'Песня',
      artists: ['Автор'],
      album: 'Альбом',
      coverUrl: null,
      durationMs: 123_000,
      available: true,
    }, 'SG')
    expect(result).toEqual([{
      uri: 'spotify:track:1',
      title: 'Песня',
      artists: ['Автор'],
      album: 'Альбом',
      coverUrl: 'https://i.scdn.co/image/cover',
      durationMs: 123_000,
      available: true,
      isrc: 'TEST123',
    }])

    await searchSpotifyTracksByQuery('access-token', 'Песня Автор')
    const automaticUrl = new URL(String(fetchMock.mock.calls[0]![0]))
    const manualUrl = new URL(String(fetchMock.mock.calls[1]![0]))
    expect(automaticUrl.searchParams.get('market')).toBe('SG')
    expect(manualUrl.searchParams.get('q')).toBe('Песня Автор')
  })

  it('keeps the Spotify retry delay', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', {
      status: 429,
      headers: { 'Retry-After': '7' },
    })))

    await expect(searchSpotifyTracksByQuery('access-token', 'Песня', 'SG')).rejects.toMatchObject({
      message: 'SPOTIFY_RATE_LIMIT',
      retryAfterMs: 8_000,
    })
  })

  it.each([403, 429])('reports Spotify quota exhaustion from status %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { reason: 'quota_exceeded' },
    }), { status, headers: { 'Retry-After': '81928' } })))

    await expect(searchSpotifyTracksByQuery('access-token', 'Песня', 'SG')).rejects.toMatchObject({
      message: 'SPOTIFY_QUOTA_EXCEEDED',
      retryAfterMs: 81_929_000,
    })
  })

  it('uses a one-day delay when Spotify omits the quota reset time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { reason: 'QUOTA_EXCEEDED' },
    }), { status: 429 })))

    await expect(searchSpotifyTracksByQuery('access-token', 'Песня', 'SG')).rejects.toMatchObject({
      message: 'SPOTIFY_QUOTA_EXCEEDED',
      retryAfterMs: 86_400_000,
    })
  })

  it('refreshes after Spotify rejects the access token', async () => {
    const database = new Database(':memory:')
    const encryptionKey = Buffer.alloc(32, 7).toString('base64')
    try {
      database.exec(initialMigration)
      const now = new Date().toISOString()
      database.prepare(`
        INSERT INTO users (id, spotify_id, access_status, created_at, updated_at)
        VALUES ('owner', 'spotify-user', 'active', ?, ?)
      `).run(now, now)
      const encryptedTokens = encryptSecret({
        access_token: 'expired-access',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }, encryptionKey)
      database.prepare(`
        INSERT INTO account_connections
          (id, owner_id, provider, provider_identity, encrypted_tokens, token_expires_at, status, created_at, updated_at)
        VALUES ('connection', 'owner', 'spotify', 'spotify-user', ?, ?, 'active', ?, ?)
      `).run(encryptedTokens, new Date(Date.now() + 3_600_000).toISOString(), now, now)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        access_token: 'refreshed-access',
        token_type: 'Bearer',
        expires_in: 3600,
      }), { status: 200 })))

      const connection = {
        id: 'connection',
        encryptedTokens,
        tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }
      const receivedTokens: string[] = []
      const result = await withSpotifyAccessToken(database, connection, 'client-id', encryptionKey, async (accessToken) => {
        receivedTokens.push(accessToken)
        if (receivedTokens.length === 1) throw new SpotifyProviderError('SPOTIFY_RECONNECT_REQUIRED')
        return 'success'
      })
      const nextAccessToken = await withSpotifyAccessToken(
        database,
        connection,
        'client-id',
        encryptionKey,
        async accessToken => accessToken,
      )

      expect(result).toBe('success')
      expect(receivedTokens).toEqual(['expired-access', 'refreshed-access'])
      expect(nextAccessToken).toBe('refreshed-access')
      const row = database.prepare(`
        SELECT encrypted_tokens AS encryptedTokens FROM account_connections WHERE id = 'connection'
      `).get() as { encryptedTokens: string }
      expect(decryptSecret<{ access_token: string }>(row.encryptedTokens, encryptionKey).access_token)
        .toBe('refreshed-access')
    } finally {
      database.close()
    }
  })

  it('retries only once after Spotify rejects the access token', async () => {
    const database = new Database(':memory:')
    const encryptionKey = Buffer.alloc(32, 8).toString('base64')
    try {
      database.exec(initialMigration)
      const now = new Date().toISOString()
      database.prepare(`
        INSERT INTO users (id, spotify_id, access_status, created_at, updated_at)
        VALUES ('owner', 'spotify-user', 'active', ?, ?)
      `).run(now, now)
      const encryptedTokens = encryptSecret({
        access_token: 'expired-access',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }, encryptionKey)
      database.prepare(`
        INSERT INTO account_connections
          (id, owner_id, provider, provider_identity, encrypted_tokens, token_expires_at, status, created_at, updated_at)
        VALUES ('connection', 'owner', 'spotify', 'spotify-user', ?, ?, 'active', ?, ?)
      `).run(encryptedTokens, new Date(Date.now() + 3_600_000).toISOString(), now, now)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        access_token: 'refreshed-access',
        token_type: 'Bearer',
        expires_in: 3600,
      }), { status: 200 })))

      const receivedTokens: string[] = []
      await expect(withSpotifyAccessToken(database, {
        id: 'connection',
        encryptedTokens,
        tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }, 'client-id', encryptionKey, async (accessToken) => {
        receivedTokens.push(accessToken)
        throw new SpotifyProviderError('SPOTIFY_RECONNECT_REQUIRED')
      })).rejects.toMatchObject({ message: 'SPOTIFY_RECONNECT_REQUIRED' })

      expect(receivedTokens).toEqual(['expired-access', 'refreshed-access'])
    } finally {
      database.close()
    }
  })
})
