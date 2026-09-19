import { z } from 'zod'
import { getServerConfig } from '../../../config'
import { hashSecret } from '../../../security/secrets'
import { readSessionUser } from '../../../storage/accounts'
import { getDatabase } from '../../../storage/database'
import { readDecisionPage } from '../../../storage/jobs'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
  filter: z.enum(['all', 'matched', 'review', 'unavailable', 'excluded']).default('all'),
})

export default defineEventHandler((event) => {
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const jobId = z.string().uuid().safeParse(getRouterParam(event, 'id'))
  const query = querySchema.safeParse(getQuery(event))
  if (!session || !jobId.success || !query.success) {
    throw createError({ statusCode: 400, statusMessage: 'Запрос решений недействителен.' })
  }
  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  const result = readDecisionPage(
    database,
    user.id,
    jobId.data,
    query.data.page,
    query.data.pageSize,
    query.data.filter,
  )
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Задание не найдено.' })
  return result
})
