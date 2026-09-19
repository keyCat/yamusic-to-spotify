import type { H3Event } from 'h3'

export function assertSameOrigin(event: H3Event) {
  const origin = getHeader(event, 'origin')
  if (!origin) return
  if (origin !== getRequestURL(event).origin) {
    throw createError({ statusCode: 403, statusMessage: 'Источник запроса недействителен.' })
  }
}
