import { z } from 'zod'
import { getServerConfig } from '../../../config'
import { assertSameOrigin } from '../../../security/request'
import { hashSecret } from '../../../security/secrets'
import { disconnectAccount, readSessionUser } from '../../../storage/accounts'
import { getDatabase } from '../../../storage/database'

const bodySchema = z.object({ identity: z.string().min(1) })

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const body = bodySchema.safeParse(await readBody(event))
  if (!session || !body.success) throw createError({ statusCode: 400, statusMessage: 'Запрос отключения недействителен.' })
  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  if (!disconnectAccount(database, user.id, 'yandex', body.data.identity)) {
    throw createError({ statusCode: 409, statusMessage: 'Аккаунт Яндекс Музыки уже отключен.' })
  }
  return { status: 'disconnected' as const }
})
