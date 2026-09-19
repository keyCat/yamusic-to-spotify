import { z } from 'zod'
import { getServerConfig } from '../../../config'
import { exchangeSpotifyCode, readSpotifyProfile } from '../../../providers/spotify/oauth'
import { createSecret, decryptSecret, encryptSecret, hashSecret } from '../../../security/secrets'
import { consumeAuthorizationRequest, createSpotifySession } from '../../../storage/accounts'
import { getDatabase } from '../../../storage/database'

const querySchema = z.object({ code: z.string().min(1), state: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const config = getServerConfig()
  const query = querySchema.safeParse(getQuery(event))
  const browserKey = getCookie(event, 'yamusic_preauth')
  if (!query.success || !browserKey) {
    return sendRedirect(event, '/?authError=invalid_request')
  }

  const database = getDatabase(config.dataDir)
  const request = consumeAuthorizationRequest(database, {
    provider: 'spotify',
    sessionKeyHash: hashSecret(browserKey),
    stateHash: hashSecret(query.data.state),
  })
  deleteCookie(event, 'yamusic_preauth', { path: '/' })
  if (!request) return sendRedirect(event, '/?authError=expired_request')

  try {
    const verifier = decryptSecret<string>(request.verifier_encrypted, config.encryptionKey)
    const tokens = await exchangeSpotifyCode(config.spotifyClientId, config.spotifyRedirectUri, query.data.code, verifier)
    const profile = await readSpotifyProfile(tokens.access_token)
    const allowedUsers = new Set(config.allowedSpotifyUsers.split(',').map(value => value.trim()).filter(Boolean))
    if (allowedUsers.size > 0 && !allowedUsers.has(profile.id)) {
      return sendRedirect(event, '/?authError=access_denied')
    }

    const session = createSecret(32)
    createSpotifySession(database, {
      spotifyId: profile.id,
      encryptedTokens: encryptSecret(tokens, config.encryptionKey),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      sessionHash: hashSecret(session),
    })
    setCookie(event, 'yamusic_session', session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.spotifyRedirectUri.startsWith('https://'),
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    })
    return sendRedirect(event, '/')
  } catch {
    return sendRedirect(event, '/?authError=provider_failure')
  }
})
