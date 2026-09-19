import { publicPlaylistRequestSchema } from '../../../shared/source'
import type { PlaylistResult } from '../../../shared/transfer-api'
import { readPublicYandexPlaylist } from '../../providers/yandex/public-playlist'
import { assertSameOrigin } from '../../security/request'

const messages: Record<string, string> = {
  UNSUPPORTED_HOST: 'Используйте ссылку с сайта Яндекс Музыки.',
  UNSUPPORTED_PATH: 'Ссылка не содержит поддерживаемый плейлист.',
  PLAYLIST_NOT_FOUND: 'Яндекс Музыка не нашла этот плейлист.',
  PLAYLIST_PRIVATE: 'Подключите аккаунт владельца для доступа к этому плейлисту.',
  PROVIDER_FAILURE: 'Яндекс Музыка временно не отвечает.',
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const parsedBody = publicPlaylistRequestSchema.safeParse(await readBody(event))
  if (!parsedBody.success) {
    throw createError({ statusCode: 400, statusMessage: 'Введите корректную ссылку на плейлист.' })
  }

  try {
    const snapshot = await readPublicYandexPlaylist(parsedBody.data.url)
    return {
      playlist: {
        id: snapshot.id,
        name: snapshot.name,
        owner: snapshot.owner,
        coverUrl: snapshot.coverUrl,
        declaredTrackCount: snapshot.declaredTrackCount,
        returnedTrackCount: snapshot.tracks.length,
        tracks: snapshot.tracks,
      },
    } satisfies PlaylistResult
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PROVIDER_FAILURE'
    throw createError({
      statusCode: code === 'PLAYLIST_NOT_FOUND' ? 404 : 422,
      statusMessage: messages[code] || messages.PROVIDER_FAILURE,
    })
  }
})
