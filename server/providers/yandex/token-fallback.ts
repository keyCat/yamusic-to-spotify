export const yandexOAuthClientId = '23cabbbdc6cd418abb4b39c32c41195d'

const redirectHosts = new Set(['music.yandex.ru', 'music.yandex.com'])
const tokenPattern = /^[A-Za-z0-9._~-]{20,2048}$/

export function getYandexTokenAuthorizationUrl() {
  const url = new URL('https://oauth.yandex.ru/authorize')
  url.searchParams.set('response_type', 'token')
  url.searchParams.set('client_id', yandexOAuthClientId)
  url.searchParams.set('force_confirm', 'yes')
  return url.toString()
}

export function parseYandexTokenInput(input: string) {
  const value = input.trim()
  if (tokenPattern.test(value)) return value

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !redirectHosts.has(url.hostname)) return null
    const token = new URLSearchParams(url.hash.slice(1)).get('access_token')
    return token && tokenPattern.test(token) ? token : null
  } catch {
    return null
  }
}
