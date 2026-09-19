import { createHash } from 'node:crypto'
import { z } from 'zod'
import { providerFetch } from '../request-budget'
import { createSecret } from '../../security/secrets'

const tokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  scope: z.string().optional(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
})

const profileSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
  country: z.string().optional(),
})

export type SpotifyTokens = z.infer<typeof tokenSchema>
export type SpotifyProfile = z.infer<typeof profileSchema>

export function createSpotifyAuthorization(clientId: string, redirectUri: string) {
  const verifier = createSecret(48)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = createSecret(24)
  const url = new URL('https://accounts.spotify.com/authorize')
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: 'playlist-modify-private playlist-read-private',
  }).toString()
  return { verifier, state, url: url.toString() }
}

export async function exchangeSpotifyCode(clientId: string, redirectUri: string, code: string, verifier: string) {
  const response = await providerFetch('spotify', 'https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('SPOTIFY_TOKEN_FAILURE')
  return tokenSchema.parse(await response.json())
}

export async function readSpotifyProfile(accessToken: string) {
  const response = await providerFetch('spotify', 'https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('SPOTIFY_PROFILE_FAILURE')
  return profileSchema.parse(await response.json())
}

export async function refreshSpotifyTokens(clientId: string, refreshToken: string) {
  const response = await providerFetch('spotify', 'https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('SPOTIFY_REFRESH_FAILURE')
  return tokenSchema.parse(await response.json())
}
