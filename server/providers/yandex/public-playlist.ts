import { z } from 'zod'
import type { SourcePlaylistSnapshot } from '../../../shared/source'
import { providerFetch } from '../request-budget'
import { yandexCoverUrl } from './cover'

const legacyPath = /^\/users\/([^/]+)\/playlists\/(\d+)\/?$/
const uuidPath = /^\/playlists\/([0-9a-f-]{36})\/?$/i

const trackSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  durationMs: z.number().nullable().optional(),
  available: z.boolean().optional(),
  artists: z.array(z.object({ name: z.string() })),
  albums: z.array(z.object({ title: z.string(), coverUri: z.string().nullable().optional() })).optional(),
})

const playlistSchema = z.object({
  uid: z.union([z.string(), z.number()]).transform(String).optional(),
  playlistUuid: z.string().optional(),
  revision: z.number().nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  cover: z.object({
    uri: z.string().nullable().optional(),
    itemsUri: z.array(z.string()).optional(),
  }).nullable().optional(),
  trackCount: z.number(),
  tracks: z.array(z.object({ track: trackSchema })),
})

export function parseYandexPlaylistUrl(input: string) {
  const url = new URL(input)
  if (!['music.yandex.ru', 'music.yandex.com'].includes(url.hostname)) throw new Error('UNSUPPORTED_HOST')

  const legacy = url.pathname.match(legacyPath)
  if (legacy) {
    return {
      owner: decodeURIComponent(legacy[1]!),
      apiUrl: `https://api.music.yandex.net/users/${encodeURIComponent(legacy[1]!)}/playlists/${legacy[2]}`,
    }
  }

  const uuid = url.pathname.match(uuidPath)
  if (uuid) {
    return {
      owner: 'unknown',
      apiUrl: `https://api.music.yandex.net/playlist/${uuid[1]}`,
    }
  }

  throw new Error('UNSUPPORTED_PATH')
}

export async function readPublicYandexPlaylist(input: string): Promise<SourcePlaylistSnapshot> {
  const parsedUrl = parseYandexPlaylistUrl(input)
  const response = await providerFetch('yandex', parsedUrl.apiUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })

  if (response.status === 404 || response.status === 410) throw new Error('PLAYLIST_NOT_FOUND')
  if (response.status === 401 || response.status === 403) throw new Error('PLAYLIST_PRIVATE')
  if (!response.ok) throw new Error('PROVIDER_FAILURE')

  const body = z.object({ result: playlistSchema }).parse(await response.json()).result
  return {
    id: body.playlistUuid || `${parsedUrl.owner}:${body.uid || 'playlist'}`,
    owner: parsedUrl.owner,
    revision: body.revision ?? null,
    name: body.title,
    description: body.description || '',
    coverUrl: yandexCoverUrl(body.cover?.uri || body.cover?.itemsUri?.[0]),
    declaredTrackCount: body.trackCount,
    tracks: body.tracks.map(({ track }, position) => ({
      id: track.id,
      title: track.title,
      artists: track.artists.map(artist => artist.name),
      album: track.albums?.[0]?.title || null,
      coverUrl: yandexCoverUrl(track.albums?.[0]?.coverUri),
      durationMs: track.durationMs ?? null,
      available: track.available ?? true,
      position,
    })),
  }
}
