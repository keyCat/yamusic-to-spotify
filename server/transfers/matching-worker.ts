import type { getServerConfig } from '../config'
import { evaluateCandidates, type MatchTrack } from '../matching/evaluate'
import { createMatchIdentity } from '../matching/normalize'
import { searchSpotifyTracks, SpotifyProviderError, withSpotifyAccessToken } from '../providers/spotify/client'
import { getDatabase } from '../storage/database'
import { readCachedSpotifyCandidates, saveCachedSpotifyCandidates } from '../storage/match-cache'
import {
  completeMatchingJob,
  clearJobRetry,
  pauseMatchingJob,
  readNextMatchingJob,
  readNextUnmatchedEntry,
  saveMatchResult,
  scheduleJobRetry,
  startMatchingJob,
} from '../storage/jobs'

type ServerConfig = ReturnType<typeof getServerConfig>
let active = false

export async function runMatchingStep(config: ServerConfig) {
  if (active) return
  active = true
  let activeJobId: string | undefined
  try {
    const database = getDatabase(config.dataDir)
    const job = readNextMatchingJob(database)
    if (!job) return
    activeJobId = job.id
    startMatchingJob(database, job.id)
    const entry = readNextUnmatchedEntry(database, job.id)
    if (!entry) {
      completeMatchingJob(database, job.id)
      return
    }

    const source = JSON.parse(entry.originalMetadata) as {
      id: string
      title: string
      artists: string[]
      album: string | null
      coverUrl: string | null
      durationMs: number | null
      available: boolean
    }
    const matchSource: MatchTrack = {
      uri: `yandex:track:${source.id}`,
      title: source.title,
      artists: source.artists,
      album: source.album,
      coverUrl: source.coverUrl,
      durationMs: source.durationMs,
      available: source.available,
    }
    const spotifyConnection = {
      id: job.connectionId,
      encryptedTokens: job.encryptedTokens,
      tokenExpiresAt: job.tokenExpiresAt,
    }
    const cacheKey = {
      ownerId: job.ownerId,
      destinationConnectionId: job.connectionId,
      market: config.spotifyMarket,
      trackIdentity: createMatchIdentity(matchSource),
    }
    let candidates = entry.availability === 'available'
      ? readCachedSpotifyCandidates(database, cacheKey)
      : []
    if (!candidates) {
      candidates = await withSpotifyAccessToken(
        database,
        spotifyConnection,
        config.spotifyClientId,
        config.encryptionKey,
        accessToken => searchSpotifyTracks(accessToken, matchSource, config.spotifyMarket),
      )
      saveCachedSpotifyCandidates(database, cacheKey, candidates)
    }
    saveMatchResult(database, entry.id, evaluateCandidates(matchSource, candidates), candidates)
    clearJobRetry(database, job.id)
  } catch (error) {
    const database = getDatabase(config.dataDir)
    if (!activeJobId) return
    const reason = error instanceof Error ? error.message : 'MATCHING_FAILURE'
    if (reason === 'SPOTIFY_RECONNECT_REQUIRED') {
      pauseMatchingJob(database, activeJobId, reason)
      return
    }
    const retryAfterMs = error instanceof SpotifyProviderError ? error.retryAfterMs : null
    if (['SPOTIFY_RATE_LIMIT', 'SPOTIFY_QUOTA_EXCEEDED', 'SPOTIFY_PROVIDER_FAILURE', 'MATCHING_FAILURE'].includes(reason)) {
      scheduleJobRetry(database, activeJobId, reason, retryAfterMs ?? 1_000)
      return
    }
    pauseMatchingJob(database, activeJobId, reason)
  } finally {
    active = false
  }
}
