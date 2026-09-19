import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { MatchTrack } from '../../matching/evaluate'
import { decryptSecret, encryptSecret } from '../../security/secrets'
import { updateConnectionTokens } from '../../storage/accounts'
import { providerFetch } from '../request-budget'
import { refreshSpotifyTokens, type SpotifyTokens } from './oauth'

type SpotifyConnection = {
  id: string
  encryptedTokens: string
  tokenExpiresAt: string | null
}

const refreshes = new Map<string, Promise<string>>()

export class SpotifyProviderError extends Error {
  constructor(message: string, public readonly retryAfterMs: number | null = null) {
    super(message)
  }
}

const searchSchema = z.object({
  tracks: z.object({
    items: z.array(z.object({
      uri: z.string(),
      name: z.string(),
      duration_ms: z.number().nullable().optional(),
      is_playable: z.boolean().optional(),
      artists: z.array(z.object({ name: z.string() })),
      album: z.object({
        name: z.string(),
        images: z.array(z.object({
          url: z.string().url(),
          width: z.number().nullable().optional(),
          height: z.number().nullable().optional(),
        })).optional(),
      }).nullable().optional(),
      external_ids: z.object({ isrc: z.string().optional() }).optional(),
    })),
  }),
})

const playlistSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  external_urls: z.object({ spotify: z.string().url() }).optional(),
})

const playlistPageSchema = z.object({
  items: z.array(playlistSchema),
  next: z.string().url().nullable(),
})

const snapshotSchema = z.object({ snapshot_id: z.string() })

const playlistItemsSchema = z.object({
  items: z.array(z.object({
    item: z.object({ uri: z.string() }).nullable().optional(),
    track: z.object({ uri: z.string() }).nullable().optional(),
  })),
  next: z.string().url().nullable(),
})

async function refreshAccessToken(
  database: Database.Database,
  connection: SpotifyConnection,
  clientId: string,
  encryptionKey: string,
) {
  const stored = decryptSecret<SpotifyTokens>(connection.encryptedTokens, encryptionKey)
  if (!stored.refresh_token) throw new Error('SPOTIFY_RECONNECT_REQUIRED')
  const refreshed = await refreshSpotifyTokens(clientId, stored.refresh_token)
  const tokens: SpotifyTokens = {
    ...stored,
    ...refreshed,
    refresh_token: refreshed.refresh_token || stored.refresh_token,
  }
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  const encryptedTokens = encryptSecret(tokens, encryptionKey)
  updateConnectionTokens(database, {
    connectionId: connection.id,
    encryptedTokens,
    tokenExpiresAt,
  })
  connection.encryptedTokens = encryptedTokens
  connection.tokenExpiresAt = tokenExpiresAt
  return tokens.access_token
}

export async function getSpotifyAccessToken(
  database: Database.Database,
  connection: SpotifyConnection,
  clientId: string,
  encryptionKey: string,
  forceRefresh = false,
) {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0
  if (!forceRefresh && expiresAt > Date.now() + 60_000) {
    return decryptSecret<SpotifyTokens>(connection.encryptedTokens, encryptionKey).access_token
  }

  const activeRefresh = refreshes.get(connection.id)
  if (activeRefresh) return activeRefresh
  const refresh = refreshAccessToken(database, connection, clientId, encryptionKey)
    .finally(() => refreshes.delete(connection.id))
  refreshes.set(connection.id, refresh)
  return refresh
}

export async function withSpotifyAccessToken<T>(
  database: Database.Database,
  connection: SpotifyConnection,
  clientId: string,
  encryptionKey: string,
  operation: (accessToken: string) => Promise<T>,
) {
  const accessToken = await getSpotifyAccessToken(database, connection, clientId, encryptionKey)
  try {
    return await operation(accessToken)
  } catch (error) {
    if (!(error instanceof SpotifyProviderError) || error.message !== 'SPOTIFY_RECONNECT_REQUIRED') throw error
    const refreshedAccessToken = await getSpotifyAccessToken(database, connection, clientId, encryptionKey, true)
    return operation(refreshedAccessToken)
  }
}

export function createSpotifySearchQuery(track: Pick<MatchTrack, 'title' | 'artists'>) {
  const artist = track.artists[0]?.trim()
  return artist ? `track:${track.title} artist:${artist}` : `track:${track.title}`
}

export async function searchSpotifyTracks(accessToken: string, source: MatchTrack, market: string) {
  return searchSpotifyTracksByQuery(accessToken, createSpotifySearchQuery(source), market)
}

export async function searchSpotifyTracksByQuery(accessToken: string, query: string, market?: string) {
  const url = new URL('https://api.spotify.com/v1/search')
  const parameters = new URLSearchParams({
    q: query,
    type: 'track',
    limit: '10',
  })
  if (market) parameters.set('market', market)
  url.search = parameters.toString()
  const response = await providerFetch('spotify', url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  const body = searchSchema.parse(await readSpotifyResponse(response))
  return body.tracks.items.map((track): MatchTrack => ({
    uri: track.uri,
    title: track.name,
    artists: track.artists.map(artist => artist.name),
    album: track.album?.name || null,
    coverUrl: track.album?.images?.[0]?.url || null,
    durationMs: track.duration_ms ?? null,
    available: track.is_playable ?? true,
    isrc: track.external_ids?.isrc || null,
  }))
}

async function readSpotifyResponse(response: Response) {
  if (response.status === 401) throw new SpotifyProviderError('SPOTIFY_RECONNECT_REQUIRED')
  const errorBody = [403, 429].includes(response.status)
    ? await response.clone().json().catch(() => null) as { error?: { reason?: string } } | null
    : null
  const errorReason = errorBody?.error?.reason?.toLocaleLowerCase('en')
  if (errorReason === 'quota_exceeded') {
    throw new SpotifyProviderError('SPOTIFY_QUOTA_EXCEEDED', readRetryAfter(response, 86_400_000))
  }
  if (response.status === 429) {
    throw new SpotifyProviderError('SPOTIFY_RATE_LIMIT', readRetryAfter(response, 30_000))
  }
  if (!response.ok) throw new SpotifyProviderError('SPOTIFY_PROVIDER_FAILURE')
  return response.json() as Promise<unknown>
}

function readRetryAfter(response: Response, fallbackMs: number) {
  const retryAfter = response.headers.get('retry-after')
  if (!retryAfter) return fallbackMs
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000) + 1_000
  const dateDelay = Date.parse(retryAfter) - Date.now()
  return Number.isFinite(dateDelay) ? Math.max(0, dateDelay) + 1_000 : fallbackMs
}

export async function findSpotifyPlaylistByMarker(accessToken: string, marker: string) {
  let url: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50'
  const matches: Array<z.infer<typeof playlistSchema>> = []
  while (url) {
    const response = await providerFetch('spotify', url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    })
    const page = playlistPageSchema.parse(await readSpotifyResponse(response))
    matches.push(...page.items.filter(playlist => playlist.description?.includes(marker)))
    url = page.next
  }
  return matches
}

export async function createSpotifyPlaylist(accessToken: string, name: string, marker: string) {
  const response = await providerFetch('spotify', 'https://api.spotify.com/v1/me/playlists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      public: false,
      description: `Перенос из Яндекс Музыки. ${marker}`,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  return playlistSchema.parse(await readSpotifyResponse(response))
}

export async function addSpotifyPlaylistItems(accessToken: string, playlistId: string, uris: string[]) {
  const response = await providerFetch('spotify', `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris }),
    signal: AbortSignal.timeout(30_000),
  })
  return snapshotSchema.parse(await readSpotifyResponse(response)).snapshot_id
}

export async function readSpotifyPlaylistItems(accessToken: string, playlistId: string) {
  let url: string | null = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=100`
  const uris: string[] = []
  while (url) {
    const response = await providerFetch('spotify', url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    })
    const page = playlistItemsSchema.parse(await readSpotifyResponse(response))
    for (const row of page.items) {
      const uri = row.item?.uri || row.track?.uri
      if (uri) uris.push(uri)
    }
    url = page.next
  }
  return uris
}
