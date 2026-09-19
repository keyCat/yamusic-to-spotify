import type Database from 'better-sqlite3'
import type { MatchTrack } from '../matching/evaluate'

type MatchCacheKey = {
  ownerId: string
  destinationConnectionId: string
  market: string
  trackIdentity: string
}

export function readCachedSpotifyCandidates(database: Database.Database, key: MatchCacheKey) {
  const row = database.prepare(`
    SELECT candidates
    FROM spotify_match_cache
    WHERE owner_id = ? AND destination_connection_id = ? AND market = ? AND track_identity = ?
      AND expires_at > ?
  `).get(
    key.ownerId,
    key.destinationConnectionId,
    key.market,
    key.trackIdentity,
    new Date().toISOString(),
  ) as { candidates: string } | undefined
  return row ? JSON.parse(row.candidates) as MatchTrack[] : undefined
}

export function saveCachedSpotifyCandidates(
  database: Database.Database,
  key: MatchCacheKey,
  candidates: MatchTrack[],
) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  database.prepare(`
    INSERT INTO spotify_match_cache
      (owner_id, destination_connection_id, market, track_identity, candidates, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, destination_connection_id, market, track_identity) DO UPDATE SET
      candidates = excluded.candidates,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(
    key.ownerId,
    key.destinationConnectionId,
    key.market,
    key.trackIdentity,
    JSON.stringify(candidates),
    expiresAt.toISOString(),
    now.toISOString(),
  )
}
