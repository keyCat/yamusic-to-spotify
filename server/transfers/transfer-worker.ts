import type { getServerConfig } from '../config'
import {
  addSpotifyPlaylistItems,
  createSpotifyPlaylist,
  findSpotifyPlaylistByMarker,
  readSpotifyPlaylistItems,
  SpotifyProviderError,
  withSpotifyAccessToken,
} from '../providers/spotify/client'
import { getDatabase } from '../storage/database'
import {
  clearJobRetry,
  readNextTransferBatch,
  readNextTransferJob,
  scheduleJobRetry,
  setDestinationSpotifyId,
  setTransferBatchOutcome,
  setTransferJobState,
} from '../storage/jobs'
import { inspectUnknownBatch } from './batches'

type ServerConfig = ReturnType<typeof getServerConfig>
let active = false

export async function runTransferStep(config: ServerConfig) {
  if (active) return
  active = true
  let activeJobId: string | undefined
  try {
    const database = getDatabase(config.dataDir)
    const job = readNextTransferJob(database)
    if (!job) return
    activeJobId = job.id
    const spotifyConnection = {
      id: job.connectionId,
      encryptedTokens: job.encryptedTokens,
      tokenExpiresAt: job.tokenExpiresAt,
    }
    const useSpotify = <T>(operation: (accessToken: string) => Promise<T>) => withSpotifyAccessToken(
      database,
      spotifyConnection,
      config.spotifyClientId,
      config.encryptionKey,
      operation,
    )

    if (!job.spotifyId) {
      const existing = await useSpotify(accessToken => findSpotifyPlaylistByMarker(accessToken, job.marker))
      if (existing.length > 1) {
        setTransferJobState(database, job.id, 'paused', 'SPOTIFY_PLAYLIST_AMBIGUOUS')
        return
      }
      const playlist = existing[0] || await useSpotify(accessToken => createSpotifyPlaylist(accessToken, job.name, job.marker))
      setDestinationSpotifyId(database, job.destinationId, playlist.id)
      clearJobRetry(database, job.id)
      return
    }

    const expected = JSON.parse(job.expectedSequence) as string[]
    if (job.state === 'verifying') {
      const actual = await useSpotify(accessToken => readSpotifyPlaylistItems(accessToken, job.spotifyId!))
      const matches = actual.length === expected.length && actual.every((uri, index) => uri === expected[index])
      setTransferJobState(database, job.id, matches ? 'completed' : 'paused', matches ? null : 'SPOTIFY_VERIFICATION_MISMATCH')
      if (matches) clearJobRetry(database, job.id)
      return
    }

    const batch = readNextTransferBatch(database, job.destinationId)
    if (!batch) {
      setTransferJobState(database, job.id, 'verifying')
      return
    }
    if (batch.outcome === 'in_flight') {
      const actual = await useSpotify(accessToken => readSpotifyPlaylistItems(accessToken, job.spotifyId!))
      const recovery = inspectUnknownBatch(actual, batch.intendedUris, batch.position)
      if (recovery === 'confirm') setTransferBatchOutcome(database, batch.id, 'confirmed')
      if (recovery === 'retry') setTransferBatchOutcome(database, batch.id, 'prepared')
      if (recovery === 'pause') setTransferJobState(database, job.id, 'paused', 'SPOTIFY_BATCH_MISMATCH')
      if (recovery !== 'pause') clearJobRetry(database, job.id)
      return
    }

    setTransferBatchOutcome(database, batch.id, 'in_flight')
    const snapshot = await useSpotify(accessToken => addSpotifyPlaylistItems(
      accessToken,
      job.spotifyId!,
      batch.intendedUris,
    ))
    setTransferBatchOutcome(database, batch.id, 'confirmed', snapshot)
    clearJobRetry(database, job.id)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'TRANSFER_FAILURE'
    if (activeJobId && ['SPOTIFY_RECONNECT_REQUIRED', 'SPOTIFY_QUOTA_EXCEEDED'].includes(reason)) {
      setTransferJobState(getDatabase(config.dataDir), activeJobId, 'paused', reason)
    } else if (activeJobId) {
      const retryAfterMs = error instanceof SpotifyProviderError ? error.retryAfterMs : null
      scheduleJobRetry(getDatabase(config.dataDir), activeJobId, reason, retryAfterMs ?? 1_000)
    }
  } finally {
    active = false
  }
}
