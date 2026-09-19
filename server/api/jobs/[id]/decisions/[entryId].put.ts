import { z } from 'zod'
import { getServerConfig } from '../../../../config'
import { hashSecret } from '../../../../security/secrets'
import { readSessionUser } from '../../../../storage/accounts'
import { getDatabase } from '../../../../storage/database'
import { reviewMatchDecision } from '../../../../storage/jobs'
import { assertSameOrigin } from '../../../../security/request'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('select'), candidateUri: z.string().startsWith('spotify:track:') }),
  z.object({ action: z.literal('exclude') }),
])

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const jobId = z.string().uuid().safeParse(getRouterParam(event, 'id'))
  const entryId = z.string().uuid().safeParse(getRouterParam(event, 'entryId'))
  const body = bodySchema.safeParse(await readBody(event))
  if (!session || !jobId.success || !entryId.success || !body.success) {
    throw createError({ statusCode: 400, statusMessage: 'Решение недействительно.' })
  }
  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  const updated = reviewMatchDecision(database, {
    ownerId: user.id,
    jobId: jobId.data,
    entryId: entryId.data,
    ...body.data,
  })
  if (!updated) throw createError({ statusCode: 409, statusMessage: 'Это решение больше недоступно.' })
  return { status: 'updated' as const }
})
