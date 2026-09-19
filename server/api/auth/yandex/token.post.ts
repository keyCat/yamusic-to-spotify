import { z } from 'zod'
import { getServerConfig } from '../../../config'
import { readYandexIdentity } from '../../../providers/yandex/oauth'
import { parseYandexTokenInput } from '../../../providers/yandex/token-fallback'
import { encryptSecret, hashSecret } from '../../../security/secrets'
import { assertSameOrigin } from '../../../security/request'
import { readSessionUser, saveYandexConnection } from '../../../storage/accounts'
import { getDatabase } from '../../../storage/database'

const bodySchema = z.object({ tokenInput: z.string().trim().min(20).max(4096) })

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const body = bodySchema.safeParse(await readBody(event))
  if (!session || !body.success) {
    throw createError({ statusCode: 400, statusMessage: 'Данные токена недействительны.' })
  }

  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  }

  const accessToken = parseYandexTokenInput(body.data.tokenInput)
  if (!accessToken) {
    throw createError({ statusCode: 400, statusMessage: 'Вставьте ссылку Яндекс Музыки или токен.' })
  }

  let identity: Awaited<ReturnType<typeof readYandexIdentity>>
  try {
    identity = await readYandexIdentity(accessToken)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Яндекс отклонил этот токен.' })
  }

  const providerIdentity = identity.login || identity.uid
  saveYandexConnection(database, {
    ownerId: user.id,
    providerIdentity,
    encryptedTokens: encryptSecret({ access_token: accessToken }, config.encryptionKey),
    tokenExpiresAt: null,
  })

  return { status: 'connected' as const, identity: providerIdentity }
})
