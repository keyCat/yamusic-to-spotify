import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPublicYandexPlaylist } from '../../server/providers/yandex/public-playlist'

vi.mock('../../server/providers/yandex/public-playlist', () => ({
  readPublicYandexPlaylist: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('public playlist request origin', () => {
  it('rejects another origin before reading the request body', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getHeader', () => 'https://another.example')
    vi.stubGlobal('getRequestURL', () => new URL('https://app.example/api/yandex/public-playlist'))
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) =>
      Object.assign(new Error(input.statusMessage), input))
    const readBody = vi.fn().mockResolvedValue({ url: 'https://music.yandex.ru/users/a/playlists/1' })
    vi.stubGlobal('readBody', readBody)
    const handler = (await import('../../server/api/yandex/public-playlist.post')).default

    await expect(handler({} as Parameters<typeof handler>[0])).rejects.toMatchObject({ statusCode: 403 })
    expect(readBody).not.toHaveBeenCalled()
    expect(readPublicYandexPlaylist).not.toHaveBeenCalled()
  })

  it('accepts the same origin', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getHeader', () => 'https://app.example')
    vi.stubGlobal('getRequestURL', () => new URL('https://app.example/api/yandex/public-playlist'))
    vi.stubGlobal('readBody', async () => ({ url: 'https://music.yandex.ru/users/a/playlists/1' }))
    vi.mocked(readPublicYandexPlaylist).mockResolvedValue({
      id: 'playlist', owner: 'a', revision: null, name: 'Плейлист', description: '',
      coverUrl: null, declaredTrackCount: 0, tracks: [],
    })
    const handler = (await import('../../server/api/yandex/public-playlist.post')).default

    await expect(handler({} as Parameters<typeof handler>[0])).resolves.toMatchObject({
      playlist: { id: 'playlist' },
    })
  })
})
