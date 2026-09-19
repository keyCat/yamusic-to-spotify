import { z } from 'zod'
import { getServerConfig } from '../../../../../config'
import { getSpotifyAccessToken, searchSpotifyTracksByQuery } from '../../../../../providers/spotify/client'
import { assertSameOrigin } from '../../../../../security/request'
import { hashSecret } from '../../../../../security/secrets'
import { readSessionUser } from '../../../../../storage/accounts'
import { getDatabase } from '../../../../../storage/database'
import { readReviewSearchContext, saveManualCandidates } from '../../../../../storage/jobs'

const bodySchema = z.object({ query: z.string().trim().min(1).max(200) })

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const jobId = z.string().uuid().safeParse(getRouterParam(event, 'id'))
  const entryId = z.string().uuid().safeParse(getRouterParam(event, 'entryId'))
  const body = bodySchema.safeParse(await readBody(event))
  if (!session || !jobId.success || !entryId.success || !body.success) {
    throw createError({ statusCode: 400, statusMessage: 'Введите запрос для поиска.' })
  }

  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  const context = readReviewSearchContext(database, user.id, jobId.data, entryId.data)
  if (!context) throw createError({ statusCode: 409, statusMessage: 'Изменение этого трека недоступно.' })

  try {
    const accessToken = await getSpotifyAccessToken(database, {
      id: context.connectionId,
      encryptedTokens: context.encryptedTokens,
      tokenExpiresAt: context.tokenExpiresAt,
    }, config.spotifyClientId, config.encryptionKey)
    const candidates = await searchSpotifyTracksByQuery(accessToken, body.data.query, config.spotifyMarket)
    const evidence = saveManualCandidates(database, {
      ownerId: user.id,
      jobId: jobId.data,
      entryId: entryId.data,
      query: body.data.query,
      candidates,
    })
    if (!evidence) throw new Error('REVIEW_NOT_AVAILABLE')
    return { candidates: evidence.candidates }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'REVIEW_NOT_AVAILABLE') {
      throw createError({ statusCode: 409, statusMessage: 'Изменение этого трека недоступно.' })
    }
    if (code === 'SPOTIFY_RECONNECT_REQUIRED') {
      throw createError({ statusCode: 401, statusMessage: 'Spotify отклонил доступ. Подключите аккаунт повторно.' })
    }
    if (code === 'SPOTIFY_RATE_LIMIT') {
      throw createError({ statusCode: 429, statusMessage: 'Spotify ограничил запросы. Повторите поиск позднее.' })
    }
    throw createError({ statusCode: 502, statusMessage: 'Не удалось выполнить поиск в Spotify.' })
  }
})
