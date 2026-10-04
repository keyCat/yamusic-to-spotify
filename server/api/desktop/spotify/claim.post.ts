import { z } from 'zod'
import { assertDesktopRequest } from '../../../security/desktop'
import { desktopAuthorization } from '../../../security/desktop-authorization'

export default defineEventHandler(async event => {
  assertDesktopRequest(event)
  const input = z.object({ id: z.string().min(1).max(100) }).parse(await readBody(event))
  setHeader(event, 'cache-control', 'no-store')
  return desktopAuthorization.claimSession(input.id)
})
