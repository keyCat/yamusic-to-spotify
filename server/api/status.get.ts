import type { ProviderStatus } from '../../shared/transfer-api'
import { getServerConfig } from '../config'
import { hashSecret } from '../security/secrets'
import { listYandexConnections, readSessionUser } from '../storage/accounts'
import { getDatabase } from '../storage/database'

export default defineEventHandler((event) => {
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const user = session ? readSessionUser(getDatabase(config.dataDir), hashSecret(session)) : undefined
  return {
    spotify: {
      configured: Boolean(config.spotifyClientId && config.spotifyRedirectUri),
      connected: Boolean(user),
      identity: user?.spotifyId || null,
    },
    yandex: {
      publicPlaylists: true,
      privatePlaylists: Boolean(user),
      connections: user ? listYandexConnections(getDatabase(config.dataDir), user.id) : [],
    },
  } satisfies ProviderStatus
})
