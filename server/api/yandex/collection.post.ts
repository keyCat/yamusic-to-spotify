import { z } from 'zod'
import type { PlaylistResult } from '../../../shared/transfer-api'
import type { YandexTokens } from '../../providers/yandex/oauth'
import { readYandexCollection } from '../../providers/yandex/library'
import { getServerConfig } from '../../config'
import { decryptSecret, hashSecret } from '../../security/secrets'
import { readSessionUser, readYandexConnection } from '../../storage/accounts'
import { getDatabase } from '../../storage/database'
import { assertSameOrigin } from '../../security/request'

const bodySchema = z.object({
  identity: z.string().min(1),
  collectionId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const body = bodySchema.safeParse(await readBody(event))
  if (!session || !body.success) throw createError({ statusCode: 400, statusMessage: 'Запрос медиатеки недействителен.' })

  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  const connection = readYandexConnection(database, user.id, body.data.identity)
  if (!connection) throw createError({ statusCode: 404, statusMessage: 'Подключение Яндекс Музыки не найдено.' })

  try {
    const tokens = decryptSecret<YandexTokens>(connection.encryptedTokens, config.encryptionKey)
    const snapshot = await readYandexCollection(connection.identity, body.data.collectionId, tokens.access_token)
    return {
      playlist: {
        id: snapshot.id,
        name: snapshot.name,
        owner: snapshot.owner,
        description: snapshot.description,
        coverUrl: snapshot.coverUrl,
        declaredTrackCount: snapshot.declaredTrackCount,
        returnedTrackCount: snapshot.tracks.length,
        tracks: snapshot.tracks,
      },
    } satisfies PlaylistResult
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'YANDEX_ACCESS_DENIED') {
      throw createError({ statusCode: 401, statusMessage: 'Яндекс отклонил доступ. Подключите аккаунт повторно.' })
    }
    if (code === 'YANDEX_INCOMPLETE_COLLECTION') {
      throw createError({ statusCode: 502, statusMessage: 'Яндекс вернул не все треки. Повторите попытку.' })
    }
    throw createError({ statusCode: 502, statusMessage: 'Не удалось получить треки из Яндекс Музыки.' })
  }
})
