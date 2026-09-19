import { getServerConfig } from '../../config'
import { hashSecret } from '../../security/secrets'
import { readSessionUser } from '../../storage/accounts'
import { getDatabase } from '../../storage/database'
import { readLatestJob } from '../../storage/jobs'

export default defineEventHandler((event) => {
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Сначала подключите Spotify.' })
  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  return { job: readLatestJob(database, user.id) || null }
})
