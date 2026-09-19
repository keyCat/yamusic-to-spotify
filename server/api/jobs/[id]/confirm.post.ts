import { z } from 'zod'
import { getServerConfig } from '../../../config'
import { hashSecret } from '../../../security/secrets'
import { readSessionUser } from '../../../storage/accounts'
import { getDatabase } from '../../../storage/database'
import { prepareTransfer } from '../../../storage/jobs'
import { assertSameOrigin } from '../../../security/request'

export default defineEventHandler((event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const jobId = z.string().uuid().safeParse(getRouterParam(event, 'id'))
  if (!session || !jobId.success) throw createError({ statusCode: 400, statusMessage: 'Подтверждение недействительно.' })
  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  if (!prepareTransfer(database, user.id, jobId.data)) {
    throw createError({ statusCode: 409, statusMessage: 'Сначала завершите проверку треков.' })
  }
  return { status: 'confirmed' as const }
})
