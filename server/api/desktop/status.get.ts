import { assertDesktopRequest } from '../../security/desktop'
import { getServerConfig } from '../../config'
import { getDatabase } from '../../storage/database'

export default defineEventHandler(event => {
  assertDesktopRequest(event)
  const database = getDatabase(getServerConfig().dataDir)
  const connection = database.prepare("SELECT 1 FROM account_connections WHERE provider = 'spotify' AND encrypted_tokens <> '' LIMIT 1").get()
  return {
    hasSpotifyConnection: Boolean(connection),
    migrationCount: (database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count,
    integrity: database.pragma('quick_check', { simple: true }),
  }
})
