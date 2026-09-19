import { z } from 'zod'

const runtimeSchema = z.object({
  dataDir: z.string().min(1),
  encryptionKey: z.string(),
  spotifyClientId: z.string(),
  spotifyRedirectUri: z.string(),
  spotifyMarket: z.string().regex(/^[A-Z]{2}$/),
  allowedSpotifyUsers: z.string(),
})

export function getServerConfig() {
  const config = useRuntimeConfig()
  return runtimeSchema.parse({
    dataDir: config.dataDir,
    encryptionKey: config.encryptionKey,
    spotifyClientId: config.spotifyClientId,
    spotifyRedirectUri: config.spotifyRedirectUri,
    spotifyMarket: config.spotifyMarket,
    allowedSpotifyUsers: config.allowedSpotifyUsers,
  })
}
