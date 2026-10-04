import { assertDesktopRequest } from '../../../security/desktop'
import { desktopAuthorization } from '../../../security/desktop-authorization'
import { getServerConfig } from '../../../config'
import { createSpotifyAuthorization } from '../../../providers/spotify/oauth'

export default defineEventHandler(event => {
  assertDesktopRequest(event)
  const config = getServerConfig()
  if (!config.spotifyClientId || !config.encryptionKey) throw createError({ statusCode: 503, statusMessage: 'Настройте Spotify Client ID.' })
  const authorization = createSpotifyAuthorization(config.spotifyClientId, config.spotifyRedirectUri)
  return { id: desktopAuthorization.createAttempt(authorization.state, authorization.verifier), url: authorization.url }
})
