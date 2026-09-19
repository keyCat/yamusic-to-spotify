import { z } from 'zod'
import { getServerConfig } from '../../config'
import { hashSecret } from '../../security/secrets'
import { readSessionUser } from '../../storage/accounts'
import { getDatabase } from '../../storage/database'
import { readJob } from '../../storage/jobs'

export default defineEventHandler((event) => {
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const jobId = z.string().uuid().safeParse(getRouterParam(event, 'id'))
  if (!session || !jobId.success) throw createError({ statusCode: 400, statusMessage: 'Запрос задания недействителен.' })
  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  const job = readJob(database, user.id, jobId.data)
  if (!job) throw createError({ statusCode: 404, statusMessage: 'Задание не найдено.' })
  return { job }
})
