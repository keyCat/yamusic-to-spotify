import { hasDesktopCredential, parseDesktopRuntimeConfig } from '../security/desktop'

export default defineEventHandler(event => {
  const config = parseDesktopRuntimeConfig()
  if (!config.desktopLaunchSecret) return
  const callbackUrl = new URL(config.spotifyRedirectUri)
  if (getHeader(event, 'host') !== callbackUrl.host) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid desktop host.' })
  }
  const origin = getHeader(event, 'origin')
  if (origin && origin !== callbackUrl.origin) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid desktop origin.' })
  }
  if (getRequestURL(event).pathname === '/api/auth/spotify/callback' && event.method === 'GET') return
  if (getRequestURL(event).pathname === '/api/desktop/ready' && event.method === 'GET') return
  if (hasDesktopCredential(getHeader(event, 'x-desktop-secret'), config.desktopLaunchSecret)
    || hasDesktopCredential(getHeader(event, 'x-desktop-window'), config.desktopWindowSecret)) return
  throw createError({ statusCode: 403, statusMessage: 'Desktop authorization required.' })
})
