import { z } from 'zod'
import type { SourcePlaylistSnapshot, SourceTrack } from '../../../shared/source'
import { providerFetch } from '../request-budget'
import { yandexCoverUrl } from './cover'

const baseUrl = 'https://api.music.yandex.net'
const metadataBatchSize = 200

const trackSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  durationMs: z.number().nullable().optional(),
  available: z.boolean().optional(),
  artists: z.array(z.object({ name: z.string() })),
  albums: z.array(z.object({
    id: z.union([z.string(), z.number()]).transform(String).optional(),
    title: z.string(),
    coverUri: z.string().nullable().optional(),
  })).optional(),
})

const coverSchema = z.object({
  uri: z.string().nullable().optional(),
  itemsUri: z.array(z.string()).optional(),
}).nullable().optional()

const playlistSummarySchema = z.object({
  uid: z.union([z.string(), z.number()]).transform(String).optional(),
  kind: z.union([z.string(), z.number()]).transform(String),
  playlistUuid: z.string().optional(),
  revision: z.number().nullable().optional(),
  title: z.string(),
  trackCount: z.number(),
  cover: coverSchema,
})

const playlistSchema = playlistSummarySchema.extend({
  description: z.string().nullable().optional(),
  tracks: z.array(z.object({ track: trackSchema })),
})

const likedTrackSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  albumId: z.union([z.string(), z.number()]).transform(String).nullable().optional(),
})

const likedLibrarySchema = z.object({
  library: z.object({
  revision: z.number().nullable().optional(),
  playlistUuid: z.string().optional(),
  tracks: z.array(likedTrackSchema),
  }),
})

export type YandexCollection = {
  id: string
  sourceIdentity: string
  type: 'likes' | 'playlist'
  name: string
  trackCount: number
  revision: number | null
  coverUrl: string | null
}

function requestHeaders(accessToken: string) {
  return {
    Accept: 'application/json',
    Authorization: `OAuth ${accessToken}`,
  }
}

async function readResult(response: Response) {
  if (response.status === 401 || response.status === 403) throw new Error('YANDEX_ACCESS_DENIED')
  if (!response.ok) throw new Error('YANDEX_PROVIDER_FAILURE')
  return z.object({ result: z.unknown() }).parse(await response.json()).result
}

function toSourceTrack(track: z.infer<typeof trackSchema>, position: number): SourceTrack {
  return {
    id: track.id,
    title: track.title,
    artists: track.artists.map(artist => artist.name),
    album: track.albums?.[0]?.title || null,
    coverUrl: yandexCoverUrl(track.albums?.[0]?.coverUri),
    durationMs: track.durationMs ?? null,
    available: track.available ?? true,
    position,
  }
}

function splitIntoBatches<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => (
    values.slice(index * size, (index + 1) * size)
  ))
}

async function readLikedLibrary(identity: string, accessToken: string) {
  const response = await providerFetch('yandex', `${baseUrl}/users/${encodeURIComponent(identity)}/likes/tracks`, {
    headers: requestHeaders(accessToken),
    signal: AbortSignal.timeout(20_000),
  })
  return likedLibrarySchema.parse(await readResult(response)).library
}

async function readTrackMetadata(
  references: Array<z.infer<typeof likedTrackSchema>>,
  accessToken: string,
) {
  const tracks: Array<z.infer<typeof trackSchema>> = []
  for (const batch of splitIntoBatches(references, metadataBatchSize)) {
    const trackIds = batch.map(reference => (
      reference.albumId ? `${reference.id}:${reference.albumId}` : reference.id
    ))
    const response = await providerFetch('yandex', `${baseUrl}/tracks`, {
      method: 'POST',
      headers: {
        ...requestHeaders(accessToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ 'track-ids': trackIds.join(',') }),
      signal: AbortSignal.timeout(30_000),
    })
    tracks.push(...z.array(trackSchema).parse(await readResult(response)))
  }
  return tracks
}

export async function readYandexCollections(identity: string, accessToken: string) {
  const [playlistsResponse, likedLibrary] = await Promise.all([
    providerFetch('yandex', `${baseUrl}/users/${encodeURIComponent(identity)}/playlists/list`, {
      headers: requestHeaders(accessToken),
      signal: AbortSignal.timeout(20_000),
    }),
    readLikedLibrary(identity, accessToken),
  ])
  const playlists = z.array(playlistSummarySchema).parse(await readResult(playlistsResponse))
  const collections: YandexCollection[] = [{
    id: 'likes',
    sourceIdentity: likedLibrary.playlistUuid || `${identity}:likes`,
    type: 'likes',
    name: 'Любимые треки',
    trackCount: likedLibrary.tracks.length,
    revision: likedLibrary.revision ?? null,
    coverUrl: null,
  }]
  collections.push(...playlists.map(playlist => ({
    id: playlist.kind,
    sourceIdentity: playlist.playlistUuid || `${identity}:${playlist.kind}`,
    type: 'playlist' as const,
    name: playlist.title,
    trackCount: playlist.trackCount,
    revision: playlist.revision ?? null,
    coverUrl: yandexCoverUrl(playlist.cover?.uri || playlist.cover?.itemsUri?.[0]),
  })))
  return collections
}

export async function readYandexCollection(
  identity: string,
  collectionId: string,
  accessToken: string,
): Promise<SourcePlaylistSnapshot> {
  if (collectionId === 'likes') {
    const library = await readLikedLibrary(identity, accessToken)
    const metadata = await readTrackMetadata(library.tracks, accessToken)
    if (metadata.length !== library.tracks.length) throw new Error('YANDEX_INCOMPLETE_COLLECTION')
    return {
      id: library.playlistUuid || `${identity}:likes`,
      owner: identity,
      revision: library.revision ?? null,
      name: 'Любимые треки',
      description: '',
      coverUrl: metadata[0]?.albums?.[0]?.coverUri
        ? yandexCoverUrl(metadata[0].albums[0].coverUri)
        : null,
      declaredTrackCount: library.tracks.length,
      tracks: metadata.map(toSourceTrack),
    }
  }

  const response = await providerFetch(
    'yandex',
    `${baseUrl}/users/${encodeURIComponent(identity)}/playlists/${encodeURIComponent(collectionId)}`,
    { headers: requestHeaders(accessToken), signal: AbortSignal.timeout(30_000) },
  )
  const playlist = playlistSchema.parse(await readResult(response))
  if (playlist.tracks.length !== playlist.trackCount) throw new Error('YANDEX_INCOMPLETE_COLLECTION')
  return {
    id: playlist.playlistUuid || `${identity}:${playlist.kind}`,
    owner: identity,
    revision: playlist.revision ?? null,
    name: playlist.title,
    description: playlist.description || '',
    coverUrl: yandexCoverUrl(playlist.cover?.uri || playlist.cover?.itemsUri?.[0]),
    declaredTrackCount: playlist.trackCount,
    tracks: playlist.tracks.map(({ track }, position) => toSourceTrack(track, position)),
  }
}
