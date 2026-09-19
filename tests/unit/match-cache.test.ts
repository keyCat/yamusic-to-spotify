import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMatchIdentity } from '../../server/matching/normalize'
import { readCachedSpotifyCandidates, saveCachedSpotifyCandidates } from '../../server/storage/match-cache'
import { initialMigration } from '../../server/storage/migrations/001_initial'
import { spotifyMatchCacheMigration } from '../../server/storage/migrations/002_spotify_match_cache'

let database: Database.Database

beforeEach(() => {
  database = new Database(':memory:')
  database.exec(initialMigration)
  database.exec(spotifyMatchCacheMigration)
  const now = new Date().toISOString()
  database.prepare(`
    INSERT INTO users (id, spotify_id, access_status, created_at, updated_at)
    VALUES ('owner', 'spotify-user', 'active', ?, ?)
  `).run(now, now)
  database.prepare(`
    INSERT INTO account_connections
      (id, owner_id, provider, provider_identity, encrypted_tokens, status, created_at, updated_at)
    VALUES ('destination', 'owner', 'spotify', 'spotify-user', 'secret', 'active', ?, ?)
  `).run(now, now)
})

afterEach(() => database.close())

describe('Spotify match cache', () => {
  it('uses a normalized identity and keeps the market context', () => {
    const trackIdentity = createMatchIdentity({
      title: 'Группа крови',
      artists: ['Кино'],
      album: 'Группа крови',
      durationMs: 285_400,
    })
    const key = {
      ownerId: 'owner',
      destinationConnectionId: 'destination',
      market: 'SG',
      trackIdentity,
    }
    const candidates = [{
      uri: 'spotify:track:1',
      title: 'Gruppa krovi',
      artists: ['Kino'],
      album: 'Gruppa krovi',
      coverUrl: null,
      durationMs: 285_000,
      available: true,
    }]
    saveCachedSpotifyCandidates(database, key, candidates)

    expect(readCachedSpotifyCandidates(database, key)).toEqual(candidates)
    expect(readCachedSpotifyCandidates(database, { ...key, market: 'US' })).toBeUndefined()
  })
})
