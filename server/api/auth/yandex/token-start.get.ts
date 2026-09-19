import { getYandexTokenAuthorizationUrl } from '../../../providers/yandex/token-fallback'

export default defineEventHandler((event) => {
  return sendRedirect(event, getYandexTokenAuthorizationUrl(), 302)
})
