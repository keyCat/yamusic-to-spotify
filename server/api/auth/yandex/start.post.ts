import { getServerConfig } from '../../../config'
import { requestYandexDeviceCode } from '../../../providers/yandex/oauth'
import { createSecret, encryptSecret, hashSecret } from '../../../security/secrets'
import { readSessionUser, saveAuthorizationRequest } from '../../../storage/accounts'
import { getDatabase } from '../../../storage/database'
import { assertSameOrigin } from '../../../security/request'

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Сначала подключите Spotify.' })
  if (!config.encryptionKey) throw createError({ statusCode: 503, statusMessage: 'Ключ защиты данных еще не настроен.' })

  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })

  const device = await requestYandexDeviceCode()
  const authorizationId = createSecret(24)
  saveAuthorizationRequest(database, {
    provider: 'yandex',
    sessionKeyHash: hashSecret(session),
    stateHash: hashSecret(authorizationId),
    encryptedVerifier: encryptSecret({ deviceCode: device.device_code }, config.encryptionKey),
  })

  return {
    authorizationId,
    userCode: device.user_code,
    verificationUrl: device.verification_url,
    expiresIn: device.expires_in,
    interval: Math.max(device.interval, 5),
  }
})
