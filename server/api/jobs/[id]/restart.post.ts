import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { YandexTokens } from '../../../providers/yandex/oauth'
import { readYandexCollection, readYandexCollections } from '../../../providers/yandex/library'
import { readPublicYandexPlaylist } from '../../../providers/yandex/public-playlist'
import { getServerConfig } from '../../../config'
import { assertSameOrigin } from '../../../security/request'
import { decryptSecret, hashSecret } from '../../../security/secrets'
import { readSessionUser, readSpotifyConnection, readYandexConnection } from '../../../storage/accounts'
import { getDatabase } from '../../../storage/database'
import { createMatchingJob, readJob, readJobReport } from '../../../storage/jobs'
import type { SourcePlaylistSnapshot } from '../../../../shared/source'

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const jobId = z.string().uuid().safeParse(getRouterParam(event, 'id'))
  if (!session || !jobId.success) {
    throw createError({ statusCode: 400, statusMessage: 'Запрос повторного поиска недействителен.' })
  }

  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  const job = readJob(database, user.id, jobId.data)
  const report = readJobReport(database, user.id, jobId.data)
  const destination = readSpotifyConnection(database, user.id)
  if (!job || !report) throw createError({ statusCode: 404, statusMessage: 'Задание не найдено.' })
  if (!job.canRestart) throw createError({ statusCode: 409, statusMessage: 'Дождитесь завершения переноса.' })
  if (!destination) throw createError({ statusCode: 409, statusMessage: 'Подключите Spotify.' })

  try {
    let sourceConnectionId: string | null = null
    let sourceLocator = job.sourceLocator || undefined
    let snapshot: SourcePlaylistSnapshot
    if (job.sourceLocator?.type === 'public') {
      snapshot = await readPublicYandexPlaylist(job.sourceLocator.url)
    } else if (job.sourceLocator?.type === 'private') {
      const source = readYandexConnection(database, user.id, job.sourceLocator.identity)
      if (!source) throw new Error('YANDEX_CONNECTION_REQUIRED')
      const tokens = decryptSecret<YandexTokens>(source.encryptedTokens, config.encryptionKey)
      snapshot = await readYandexCollection(
        source.identity,
        job.sourceLocator.collectionId,
        tokens.access_token,
      )
      sourceConnectionId = source.id
    } else if (job.sourceConnectionIdentity) {
      const source = readYandexConnection(database, user.id, job.sourceConnectionIdentity)
      if (!source) throw new Error('YANDEX_CONNECTION_REQUIRED')
      const tokens = decryptSecret<YandexTokens>(source.encryptedTokens, config.encryptionKey)
      const collections = await readYandexCollections(source.identity, tokens.access_token)
      const collection = collections.find(item => item.sourceIdentity === report.job.sourceIdentity)
      if (collection) {
        snapshot = await readYandexCollection(source.identity, collection.id, tokens.access_token)
        sourceConnectionId = source.id
        sourceLocator = { type: 'private', identity: source.identity, collectionId: collection.id }
      } else {
        snapshot = {
          id: report.job.sourceIdentity,
          owner: source.identity,
          revision: report.job.revision === null ? null : Number(report.job.revision),
          name: report.job.name,
          description: '',
          coverUrl: report.entries[0]?.source.coverUrl || null,
          declaredTrackCount: report.job.declaredCount,
          tracks: report.entries.map(entry => ({ ...entry.source, position: entry.position })),
        }
      }
    } else {
      snapshot = {
        id: report.job.sourceIdentity,
        owner: 'saved-snapshot',
        revision: report.job.revision === null ? null : Number(report.job.revision),
        name: report.job.name,
        description: '',
        coverUrl: report.entries[0]?.source.coverUrl || null,
        declaredTrackCount: report.job.declaredCount,
        tracks: report.entries.map(entry => ({ ...entry.source, position: entry.position })),
      }
    }

    const nextJobId = createMatchingJob(database, {
      ownerId: user.id,
      sourceConnectionId,
      destinationConnectionId: destination.id,
      idempotencyKey: randomUUID(),
      replaceJobId: job.id,
      sourceLocator,
      snapshot,
    })
    return { jobId: nextJobId }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'YANDEX_INCOMPLETE_COLLECTION') {
      throw createError({ statusCode: 502, statusMessage: 'Яндекс вернул не все треки. Текущее задание сохранено.' })
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
    throw createError({ statusCode: 502, statusMessage: 'Не удалось повторить поиск. Текущее задание сохранено.' })
  }
})
