import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encryptSecret } from '../../server/security/secrets'
import { closeDatabase, getDatabase } from '../../server/storage/database'
import { createMatchingJob, readJob } from '../../server/storage/jobs'
import { runMatchingStep } from '../../server/transfers/matching-worker'

const dataDirs: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  closeDatabase()
  for (const dataDir of dataDirs.splice(0)) rmSync(dataDir, { recursive: true, force: true })
})

describe('matching worker', () => {
  it('schedules a quota retry instead of pausing the job', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'yamusic-quota-'))
    dataDirs.push(dataDir)
    const database = getDatabase(dataDir)
    const now = new Date().toISOString()
    const encryptionKey = Buffer.alloc(32, 9).toString('base64')
    database.prepare(`
      INSERT INTO users (id, spotify_id, access_status, created_at, updated_at)
      VALUES ('owner', 'spotify-user', 'active', ?, ?)
    `).run(now, now)
    database.prepare(`
      INSERT INTO account_connections
        (id, owner_id, provider, provider_identity, encrypted_tokens, token_expires_at, status, created_at, updated_at)
      VALUES ('destination', 'owner', 'spotify', 'spotify-user', ?, ?, 'active', ?, ?)
    `).run(encryptSecret({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      expires_in: 3600,
    }, encryptionKey), new Date(Date.now() + 3_600_000).toISOString(), now, now)
    const jobId = createMatchingJob(database, {
      ownerId: 'owner',
      sourceConnectionId: null,
      destinationConnectionId: 'destination',
      idempotencyKey: 'quota-retry',
      snapshot: {
        id: 'source',
        owner: 'public-owner',
        revision: null,
        name: 'Плейлист',
        description: '',
        declaredTrackCount: 1,
        coverUrl: null,
        tracks: [{
          id: 'track',
          title: 'Песня',
          artists: ['Автор'],
          album: 'Альбом',
          coverUrl: null,
          durationMs: 120_000,
          available: true,
          position: 0,
        }],
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { reason: 'QUOTA_EXCEEDED' },
    }), { status: 429, headers: { 'Retry-After': '86400' } })))

    await runMatchingStep({
      dataDir,
      encryptionKey,
      spotifyClientId: 'client-id',
      spotifyRedirectUri: 'http://127.0.0.1:3000/api/auth/spotify/callback',
      spotifyMarket: 'SG',
      allowedSpotifyUsers: 'spotify-user',
    })

    const job = readJob(database, 'owner', jobId)
    expect(job).toMatchObject({
      state: 'matching',
      pauseReason: 'SPOTIFY_QUOTA_EXCEEDED',
    })
    expect(new Date(job!.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now() + 86_399_000)
  })
})
