import type { YandexTokens } from '../../providers/yandex/oauth'
import type { YandexCollectionsResult } from '../../../shared/transfer-api'
import { readYandexCollections } from '../../providers/yandex/library'
import { getServerConfig } from '../../config'
import { decryptSecret, hashSecret } from '../../security/secrets'
import { readSessionUser, readYandexConnection } from '../../storage/accounts'
import { getDatabase } from '../../storage/database'

export default defineEventHandler(async (event) => {
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Сначала подключите Spotify.' })

  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  const connection = readYandexConnection(database, user.id)
  if (!connection) throw createError({ statusCode: 409, statusMessage: 'Подключите Яндекс Музыку.' })

  try {
    const tokens = decryptSecret<YandexTokens>(connection.encryptedTokens, config.encryptionKey)
    const collections = await readYandexCollections(connection.identity, tokens.access_token)
    return { identity: connection.identity, collections } satisfies YandexCollectionsResult
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'YANDEX_ACCESS_DENIED') {
      throw createError({ statusCode: 401, statusMessage: 'Яндекс отклонил доступ. Подключите аккаунт повторно.' })
    }
    throw createError({ statusCode: 502, statusMessage: 'Не удалось получить медиатеку Яндекс Музыки.' })
  }
})
