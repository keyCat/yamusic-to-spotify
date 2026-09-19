import { z } from 'zod'
import { getServerConfig } from '../../../config'
import { pollYandexDeviceToken, readYandexIdentity } from '../../../providers/yandex/oauth'
import { decryptSecret, encryptSecret, hashSecret } from '../../../security/secrets'
import { deleteAuthorizationRequest, readAuthorizationRequest, readSessionUser, saveYandexConnection } from '../../../storage/accounts'
import { getDatabase } from '../../../storage/database'
import { assertSameOrigin } from '../../../security/request'

const bodySchema = z.object({ authorizationId: z.string().min(20) })

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const body = bodySchema.safeParse(await readBody(event))
  if (!session || !body.success) throw createError({ statusCode: 400, statusMessage: 'Запрос подключения недействителен.' })

  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  const request = readAuthorizationRequest(database, {
    provider: 'yandex',
    sessionKeyHash: hashSecret(session),
    stateHash: hashSecret(body.data.authorizationId),
  })
  if (!request) throw createError({ statusCode: 410, statusMessage: 'Срок кода Яндекса истек.' })

  const stored = decryptSecret<{ deviceCode: string }>(request.verifier_encrypted, config.encryptionKey)
  const tokens = await pollYandexDeviceToken(stored.deviceCode)
  if (!tokens) return { status: 'pending' as const }

  const identity = await readYandexIdentity(tokens.access_token)
  saveYandexConnection(database, {
    ownerId: user.id,
    providerIdentity: identity.login || identity.uid,
    encryptedTokens: encryptSecret(tokens, config.encryptionKey),
    tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
  })
  deleteAuthorizationRequest(database, request.id)
  return { status: 'connected' as const, identity: identity.login || identity.uid }
})
