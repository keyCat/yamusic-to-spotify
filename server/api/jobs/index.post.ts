import { z } from 'zod'
import type { YandexTokens } from '../../providers/yandex/oauth'
import { readYandexCollection } from '../../providers/yandex/library'
import { readPublicYandexPlaylist } from '../../providers/yandex/public-playlist'
import { getServerConfig } from '../../config'
import { decryptSecret, hashSecret } from '../../security/secrets'
import { readSessionUser, readSpotifyConnection, readYandexConnection } from '../../storage/accounts'
import { getDatabase } from '../../storage/database'
import { createMatchingJob } from '../../storage/jobs'
import { assertSameOrigin } from '../../security/request'

const bodySchema = z.union([
  z.object({
    sourceType: z.literal('private'),
    requestId: z.string().uuid(),
    replaceJobId: z.string().uuid().optional(),
    identity: z.string().min(1),
    collectionId: z.string().min(1),
  }),
  z.object({
    sourceType: z.literal('public'),
    requestId: z.string().uuid(),
    replaceJobId: z.string().uuid().optional(),
    url: z.string().url(),
  }),
])

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const body = bodySchema.safeParse(await readBody(event))
  if (!session || !body.success) throw createError({ statusCode: 400, statusMessage: 'Запрос поиска недействителен.' })

  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  const destination = readSpotifyConnection(database, user.id)
  if (!destination) throw createError({ statusCode: 409, statusMessage: 'Подключите Spotify.' })

  try {
    let sourceConnectionId: string | null = null
    let snapshot
    if (body.data.sourceType === 'public') {
      snapshot = await readPublicYandexPlaylist(body.data.url)
    } else {
      const source = readYandexConnection(database, user.id, body.data.identity)
      if (!source) throw new Error('YANDEX_CONNECTION_REQUIRED')
      const tokens = decryptSecret<YandexTokens>(source.encryptedTokens, config.encryptionKey)
      snapshot = await readYandexCollection(source.identity, body.data.collectionId, tokens.access_token)
      sourceConnectionId = source.id
    }
    const jobId = createMatchingJob(database, {
      ownerId: user.id,
      sourceConnectionId,
      destinationConnectionId: destination.id,
      idempotencyKey: body.data.requestId,
      replaceJobId: body.data.replaceJobId,
      sourceLocator: body.data.sourceType === 'public'
        ? { type: 'public', url: body.data.url }
        : {
            type: 'private',
            identity: body.data.identity,
            collectionId: body.data.collectionId,
          },
      snapshot,
    })
    return { jobId }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'YANDEX_INCOMPLETE_COLLECTION') {
      throw createError({ statusCode: 502, statusMessage: 'Яндекс вернул не все треки. Повторите попытку.' })
    }
    if (code === 'YANDEX_CONNECTION_REQUIRED') {
      throw createError({ statusCode: 409, statusMessage: 'Подключите Яндекс Музыку.' })
    }
    if (code === 'PLAYLIST_PRIVATE') {
      throw createError({ statusCode: 422, statusMessage: 'Подключите аккаунт владельца для доступа к этому плейлисту.' })
    }
    if (code === 'JOB_REPLACE_CONFLICT') {
      throw createError({ statusCode: 409, statusMessage: 'Текущее задание уже выполняет перенос.' })
    }
    throw createError({ statusCode: 502, statusMessage: 'Не удалось подготовить поиск.' })
  }
})
