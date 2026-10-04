import { z } from 'zod'
import { buildDesktopReadyProof, parseDesktopRuntimeConfig } from '../../security/desktop'

export default defineEventHandler(event => {
  const config = parseDesktopRuntimeConfig()
  if (!config.desktopLaunchSecret) throw createError({ statusCode: 403, statusMessage: 'Desktop authorization required.' })
  const input = z.object({ challenge: z.string().regex(/^[a-f0-9]{64}$/) }).parse(getQuery(event))
  setHeader(event, 'cache-control', 'no-store')
  return { proof: buildDesktopReadyProof(config.desktopLaunchSecret, input.challenge) }
})
