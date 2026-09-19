import { z } from 'zod'
import { providerFetch } from '../request-budget'

// The maintained client publishes these credentials from the official Android application.
const clientId = '23cabbbdc6cd418abb4b39c32c41195d'
const clientSecret = '53bc75238f0c4d08a118e51fe9203300'

const deviceCodeSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_url: z.string().url(),
  expires_in: z.number(),
  interval: z.number().default(5),
})

const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
})

const accountSchema = z.object({
  result: z.object({
    account: z.object({
      uid: z.union([z.string(), z.number()]).transform(String),
      login: z.string().optional(),
    }),
  }),
})

export type YandexTokens = z.infer<typeof tokenSchema>

export async function requestYandexDeviceCode() {
  const response = await providerFetch('yandex', 'https://oauth.yandex.ru/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      device_id: crypto.randomUUID().replaceAll('-', '').slice(0, 10),
      device_name: 'YandexMusicAPI',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('YANDEX_DEVICE_CODE_FAILURE')
  return deviceCodeSchema.parse(await response.json())
}

export async function pollYandexDeviceToken(deviceCode: string) {
  const response = await providerFetch('yandex', 'https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'device_code',
      code: deviceCode,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.json() as unknown
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body)
    if (error.success && error.data.error === 'authorization_pending') return null
    throw new Error(error.success ? `YANDEX_OAUTH_${error.data.error.toUpperCase()}` : 'YANDEX_TOKEN_FAILURE')
  }
  return tokenSchema.parse(body)
}

export async function readYandexIdentity(accessToken: string) {
  const response = await providerFetch('yandex', 'https://api.music.yandex.net/account/status', {
    headers: { Authorization: `OAuth ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('YANDEX_PROFILE_FAILURE')
  return accountSchema.parse(await response.json()).result.account
}
