import { join } from 'node:path'
import type { DesktopSettingsDto } from '../shared/desktop-api'

export function buildBackendEnvironment(
  inherited: NodeJS.ProcessEnv, profilePath: string, settings: DesktopSettingsDto,
  encryptionKey: string, port: number, launchSecret: string, windowSecret: string,
): Record<string, string> {
  const environment = Object.fromEntries(Object.entries(inherited).filter(([name, value]) =>
    value !== undefined && !/^(NUXT_|NITRO_|NODE_|ELECTRON_|RUNTIME_CONFIG$|HOST$|PORT$)/i.test(name))) as Record<string, string>
  return {
    ...environment,
    NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    NITRO_SHUTDOWN_TIMEOUT: '8000',
    NUXT_DATA_DIR: join(profilePath, 'data'), NUXT_ENCRYPTION_KEY: encryptionKey,
    NUXT_SPOTIFY_CLIENT_ID: settings.spotifyClientId, NUXT_SPOTIFY_MARKET: 'SG',
    NUXT_SPOTIFY_REDIRECT_URI: `http://127.0.0.1:${port}/api/auth/spotify/callback`,
    NUXT_ALLOWED_SPOTIFY_USERS: '', NUXT_DESKTOP_LAUNCH_SECRET: launchSecret,
    NUXT_DESKTOP_WINDOW_SECRET: windowSecret,
  }
}
