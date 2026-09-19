import { getServerConfig } from '../../../config'
import { assertSameOrigin } from '../../../security/request'
import { hashSecret } from '../../../security/secrets'
import { disconnectAccount, readSessionUser } from '../../../storage/accounts'
import { getDatabase } from '../../../storage/database'

export default defineEventHandler((event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек.' })
  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек.' })
  if (!disconnectAccount(database, user.id, 'spotify')) {
    throw createError({ statusCode: 409, statusMessage: 'Аккаунт Spotify уже отключен.' })
  }
  deleteCookie(event, 'yamusic_session', { path: '/' })
  return { status: 'disconnected' as const }
})
