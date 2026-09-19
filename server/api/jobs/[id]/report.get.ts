import { z } from 'zod'
import { getServerConfig } from '../../../config'
import { hashSecret } from '../../../security/secrets'
import { readSessionUser } from '../../../storage/accounts'
import { getDatabase } from '../../../storage/database'
import { readJobReport } from '../../../storage/jobs'

const querySchema = z.object({ format: z.enum(['json', 'csv']).default('json') })

function csvValue(value: unknown) {
  const text = Array.isArray(value) ? value.join(', ') : String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

export default defineEventHandler((event) => {
  const config = getServerConfig()
  const session = getCookie(event, 'yamusic_session')
  const jobId = z.string().uuid().safeParse(getRouterParam(event, 'id'))
  const query = querySchema.safeParse(getQuery(event))
  if (!session || !jobId.success || !query.success) {
    throw createError({ statusCode: 400, statusMessage: 'Запрос отчета недействителен.' })
  }
  const database = getDatabase(config.dataDir)
  const user = readSessionUser(database, hashSecret(session))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Срок сеанса истек. Подключите Spotify повторно.' })
  const report = readJobReport(database, user.id, jobId.data)
  if (!report) throw createError({ statusCode: 404, statusMessage: 'Задание не найдено.' })
  setHeader(event, 'Cache-Control', 'private, no-store')

  if (query.data.format === 'json') {
    setHeader(event, 'Content-Disposition', `attachment; filename="transfer-${jobId.data}.json"`)
    return report
  }

  const columns = [
    'position', 'source_title', 'source_artists', 'source_album', 'availability',
    'decision', 'spotify_uri', 'spotify_title', 'spotify_artists', 'evidence',
  ]
  const lines = report.entries.map(entry => [
    entry.position + 1,
    entry.source.title,
    entry.source.artists,
    entry.source.album,
    entry.availability,
    entry.decision,
    entry.candidateUri,
    entry.selectedCandidate?.title,
    entry.selectedCandidate?.artists,
    entry.evidenceCodes,
  ].map(csvValue).join(','))
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="transfer-${jobId.data}.csv"`)
  return `\uFEFF${columns.map(csvValue).join(',')}\n${lines.join('\n')}\n`
})
