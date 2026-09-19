import { z } from 'zod'
import { getServerConfig } from '../../../../config'
import { assertSameOrigin } from '../../../../security/request'
import { hashSecret } from '../../../../security/secrets'
import { readSessionUser } from '../../../../storage/accounts'
import { getDatabase } from '../../../../storage/database'
import { reviewMatchDecisions } from '../../../../storage/jobs'

const decisionSchema = z.discriminatedUnion('action', [
  z.object({
    entryId: z.string().uuid(),
    action: z.literal('select'),
    candidateUri: z.string().startsWith('spotify:track:'),
  }),
  z.object({ entryId: z.string().uuid(), action: z.literal('exclude') }),
])

const bodySchema = z.object({
  decisions: z.array(decisionSchema).min(1).max(100),
}).refine(
  value => new Set(value.decisions.map(decision => decision.entryId)).size === value.decisions.length,
  { message: 'DUPLICATE_ENTRY' },
)

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const jobId = z.string().uuid().safeParse(getRouterParam(event, 'id'))
  const body = bodySchema.safeParse(await readBody(event))
  if (!session || !jobId.success || !body.success) {
    throw createError({ statusCode: 400, statusMessage: 'Групповое решение недействительно.' })
  }

  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  const updated = reviewMatchDecisions(database, {
    ownerId: user.id,
    jobId: jobId.data,
    decisions: body.data.decisions,
  })
  if (updated === undefined) {
    throw createError({ statusCode: 409, statusMessage: 'Одно из решений больше недоступно.' })
  }
  return { status: 'updated' as const, updated }
})
