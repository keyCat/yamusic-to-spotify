import { createHmac, timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { z } from 'zod'

const desktopConfigSchema = z.object({
  desktopLaunchSecret: z.string().default(''),
  desktopWindowSecret: z.string().default(''),
  spotifyRedirectUri: z.string().default(''),
})

export function parseDesktopRuntimeConfig() {
  return desktopConfigSchema.parse(useRuntimeConfig())
}

export function buildDesktopReadyProof(secret: string, challenge: string) {
  return createHmac('sha256', secret).update(`desktop-ready:${challenge}`).digest('hex')
}

export function hasDesktopCredential(actual: string | undefined, expected: string) {
  if (!actual || !expected) return false
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

export function assertDesktopRequest(event: H3Event) {
  const secret = parseDesktopRuntimeConfig().desktopLaunchSecret
  if (!hasDesktopCredential(getHeader(event, 'x-desktop-secret'), secret)) {
    throw createError({ statusCode: 403, statusMessage: 'Desktop authorization required.' })
  }
}
