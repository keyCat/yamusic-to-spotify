import { getServerConfig } from '../../../config'
import { createSpotifyAuthorization } from '../../../providers/spotify/oauth'
import { createSecret, encryptSecret, hashSecret } from '../../../security/secrets'
import { saveAuthorizationRequest } from '../../../storage/accounts'
import { getDatabase } from '../../../storage/database'

export default defineEventHandler((event) => {
  const config = getServerConfig()
  if (!config.spotifyClientId || !config.spotifyRedirectUri) {
    throw createError({ statusCode: 503, statusMessage: 'Приложение Spotify еще не настроено.' })
  }
  if (!config.encryptionKey) {
    throw createError({ statusCode: 503, statusMessage: 'Ключ защиты данных еще не настроен.' })
  }

  const requestUrl = getRequestURL(event)
  const callbackUrl = new URL(config.spotifyRedirectUri)
  if (requestUrl.origin !== callbackUrl.origin) {
    return sendRedirect(event, new URL('/api/auth/spotify/start', callbackUrl.origin).toString())
  }

  const authorization = createSpotifyAuthorization(config.spotifyClientId, config.spotifyRedirectUri)
  const browserKey = createSecret(32)
  saveAuthorizationRequest(getDatabase(config.dataDir), {
    provider: 'spotify',
    sessionKeyHash: hashSecret(browserKey),
    stateHash: hashSecret(authorization.state),
    encryptedVerifier: encryptSecret(authorization.verifier, config.encryptionKey),
  })

  setCookie(event, 'yamusic_preauth', browserKey, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.spotifyRedirectUri.startsWith('https://'),
    maxAge: 600,
    path: '/',
  })
  return sendRedirect(event, authorization.url)
})
