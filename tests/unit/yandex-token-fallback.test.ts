import { describe, expect, test } from 'vitest'
import { getYandexTokenAuthorizationUrl, parseYandexTokenInput } from '../../server/providers/yandex/token-fallback'

const accessToken = 'AQAAAABbCcDdEeFfGgHhIiJjKkLlMmNnOoPp'

describe('Yandex token fallback', () => {
  test('accepts a raw access token', () => {
    expect(parseYandexTokenInput(accessToken)).toBe(accessToken)
  })

  test('extracts a token from the Yandex Music redirect URL', () => {
    const input = `https://music.yandex.ru/#access_token=${accessToken}&token_type=bearer&expires_in=31536000`

    expect(parseYandexTokenInput(input)).toBe(accessToken)
  })

  test('rejects a redirect URL from another host', () => {
    const input = `https://example.com/#access_token=${accessToken}`

    expect(parseYandexTokenInput(input)).toBeNull()
  })

  test('rejects a value with whitespace', () => {
    expect(parseYandexTokenInput(`${accessToken} extra`)).toBeNull()
  })

  test('creates the Yandex token authorization URL', () => {
    const url = new URL(getYandexTokenAuthorizationUrl())

    expect(url.origin + url.pathname).toBe('https://oauth.yandex.ru/authorize')
    expect(url.searchParams.get('response_type')).toBe('token')
    expect(url.searchParams.get('client_id')).toBe('23cabbbdc6cd418abb4b39c32c41195d')
    expect(url.searchParams.get('force_confirm')).toBe('yes')
  })
})
