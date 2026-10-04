const externalHosts = new Set([
  'accounts.spotify.com', 'open.spotify.com', 'developer.spotify.com',
  'oauth.yandex.ru', 'oauth.yandex.com', 'passport.yandex.ru', 'passport.yandex.com',
  'music.yandex.ru', 'music.yandex.com',
])

export function isAllowedExternalUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
      && (!url.port || url.port === '443') && externalHosts.has(url.hostname)
  } catch { return false }
}

export function isTrustedRendererUrl(value: string, origin: string) {
  try {
    const url = new URL(value)
    return url.origin === origin && url.pathname === '/' && !url.username && !url.password
  } catch { return false }
}

export function isReportUrl(value: string, origin: string) {
  try {
    const url = new URL(value)
    return url.origin === origin && /^\/api\/jobs\/[a-f0-9-]{36}\/report$/.test(url.pathname)
      && ['csv', 'json'].includes(url.searchParams.get('format') || 'json')
  } catch { return false }
}
