import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseYandexPlaylistUrl, readPublicYandexPlaylist } from '../../server/providers/yandex/public-playlist'

afterEach(() => vi.unstubAllGlobals())

describe('parseYandexPlaylistUrl', () => {
  it('parses a legacy playlist URL', () => {
    expect(parseYandexPlaylistUrl('https://music.yandex.ru/users/music-blog/playlists/2465')).toEqual({
      owner: 'music-blog',
      apiUrl: 'https://api.music.yandex.net/users/music-blog/playlists/2465',
    })
  })

  it('parses a UUID playlist URL', () => {
    expect(parseYandexPlaylistUrl('https://music.yandex.ru/playlists/334596d4-531a-1fa8-8bff-1eeddbc17266')).toEqual({
      owner: 'unknown',
      apiUrl: 'https://api.music.yandex.net/playlist/334596d4-531a-1fa8-8bff-1eeddbc17266',
    })
  })

  it('rejects another host', () => {
    expect(() => parseYandexPlaylistUrl('https://example.com/users/a/playlists/1')).toThrow('UNSUPPORTED_HOST')
  })

  it('keeps Yandex cover art for the playlist and tracks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: {
        uid: 'owner',
        playlistUuid: 'playlist-id',
        revision: 1,
        title: 'Плейлист',
        description: '',
        trackCount: 1,
        cover: { uri: 'avatars.yandex.net/get-music-content/123/%%' },
        tracks: [{
          track: {
            id: 'track-id',
            title: 'Песня',
            durationMs: 120_000,
            available: true,
            artists: [{ name: 'Автор' }],
            albums: [{ title: 'Альбом', coverUri: 'avatars.yandex.net/get-music-content/456/%%' }],
          },
        }],
      },
    }), { status: 200 })))

    const playlist = await readPublicYandexPlaylist('https://music.yandex.ru/users/owner/playlists/1')

    expect(playlist.coverUrl).toBe('https://avatars.yandex.net/get-music-content/123/400x400')
    expect(playlist.tracks[0]?.coverUrl).toBe('https://avatars.yandex.net/get-music-content/456/400x400')
  })
})
