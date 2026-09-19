import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import type { MatchResult, MatchTrack } from '../matching/evaluate'
import type { SourcePlaylistSnapshot, SourceTrack } from '../../shared/source'
import type { MatchDecisionState, MatchingJob, ReviewPage, TransferJobState } from '../../shared/transfer-api'
import { createTransferBatches } from '../transfers/batches'

export type SourceLocator =
  | { type: 'private', identity: string, collectionId: string }
  | { type: 'public', url: string }

export function createMatchingJob(
  database: Database.Database,
  input: {
    ownerId: string
    sourceConnectionId: string | null
    destinationConnectionId: string
    idempotencyKey: string
    replaceJobId?: string
    sourceLocator?: SourceLocator
    snapshot: SourcePlaylistSnapshot
  },
) {
  return database.transaction(() => {
    const existing = database.prepare(`
      SELECT id FROM transfer_jobs WHERE owner_id = ? AND idempotency_key = ?
    `).get(input.ownerId, input.idempotencyKey) as { id: string } | undefined
    if (existing) return existing.id

    if (input.replaceJobId) {
      const replaced = database.prepare(`
        SELECT state FROM transfer_jobs WHERE id = ? AND owner_id = ?
      `).get(input.replaceJobId, input.ownerId) as { state: string } | undefined
      if (!replaced || ['transferring', 'verifying'].includes(replaced.state)) {
        throw new Error('JOB_REPLACE_CONFLICT')
      }
      if (!['completed', 'failed', 'cancelled'].includes(replaced.state)) {
        database.prepare(`
          UPDATE transfer_jobs
          SET state = 'cancelled', previous_active_state = NULL, pause_reason = NULL,
            next_attempt_at = NULL, updated_at = ?
          WHERE id = ? AND owner_id = ?
        `).run(new Date().toISOString(), input.replaceJobId, input.ownerId)
      }
    }

    const now = new Date().toISOString()
    const jobId = randomUUID()
    const playlistId = randomUUID()
    database.prepare(`
      INSERT INTO transfer_jobs
        (id, owner_id, source_connection_id, destination_connection_id, state, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
    `).run(
      jobId, input.ownerId, input.sourceConnectionId, input.destinationConnectionId,
      input.idempotencyKey, now, now,
    )
    database.prepare(`
      INSERT INTO source_playlists
        (id, job_id, source_identity, revision, name, description, declared_count,
          source_type, source_reference)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      playlistId, jobId, input.snapshot.id, input.snapshot.revision?.toString() || null,
      input.snapshot.name, input.snapshot.description, input.snapshot.declaredTrackCount,
      input.sourceLocator?.type || null, input.sourceLocator ? JSON.stringify(input.sourceLocator) : null,
    )

    const insertEntry = database.prepare(`
      INSERT INTO source_entries
        (id, playlist_id, position, provider_track_id, original_metadata, availability)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const track of input.snapshot.tracks) {
      insertEntry.run(
        randomUUID(), playlistId, track.position, track.id, JSON.stringify(track),
        track.available ? 'available' : 'unavailable',
      )
    }
    return jobId
  })()
}

export function readNextMatchingJob(database: Database.Database) {
  return database.prepare(`
    SELECT transfer_jobs.id, transfer_jobs.owner_id AS ownerId,
      account_connections.id AS connectionId,
      account_connections.encrypted_tokens AS encryptedTokens,
      account_connections.token_expires_at AS tokenExpiresAt
    FROM transfer_jobs
    JOIN account_connections ON account_connections.id = transfer_jobs.destination_connection_id
    WHERE transfer_jobs.state IN ('queued', 'matching')
      AND (transfer_jobs.next_attempt_at IS NULL OR transfer_jobs.next_attempt_at <= ?)
    ORDER BY transfer_jobs.created_at
    LIMIT 1
  `).get(new Date().toISOString()) as {
    id: string
    ownerId: string
    connectionId: string
    encryptedTokens: string
    tokenExpiresAt: string | null
  } | undefined
}

export function startMatchingJob(database: Database.Database, jobId: string) {
  database.prepare(`
    UPDATE transfer_jobs SET state = 'matching', updated_at = ?
    WHERE id = ? AND state = 'queued'
  `).run(new Date().toISOString(), jobId)
}

export function readNextUnmatchedEntry(database: Database.Database, jobId: string) {
  return database.prepare(`
    SELECT source_entries.id, source_entries.original_metadata AS originalMetadata,
      source_entries.availability
    FROM source_entries
    JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
    LEFT JOIN match_decisions ON match_decisions.source_entry_id = source_entries.id
    WHERE source_playlists.job_id = ? AND match_decisions.id IS NULL
    ORDER BY source_entries.position
    LIMIT 1
  `).get(jobId) as {
    id: string
    originalMetadata: string
    availability: string
  } | undefined
}

export function saveMatchResult(
  database: Database.Database,
  sourceEntryId: string,
  result: MatchResult,
  candidates: MatchTrack[],
) {
  database.prepare(`
    INSERT INTO match_decisions
      (id, source_entry_id, candidate_uri, evidence, decision, reviewer_status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), sourceEntryId, result.candidate?.uri || null,
    JSON.stringify({ score: result.score, margin: result.margin, codes: result.evidence, candidates }),
    result.decision, result.decision === 'accepted' ? 'automatic' : 'pending', new Date().toISOString(),
  )
}

export function completeMatchingJob(database: Database.Database, jobId: string) {
  const unresolved = database.prepare(`
    SELECT COUNT(*) AS count
    FROM match_decisions
    JOIN source_entries ON source_entries.id = match_decisions.source_entry_id
    JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
    WHERE source_playlists.job_id = ?
      AND match_decisions.decision IN ('review_required', 'unavailable')
  `).get(jobId) as { count: number }
  database.prepare(`
    UPDATE transfer_jobs SET state = ?, updated_at = ?
    WHERE id = ? AND state = 'matching'
  `).run(unresolved.count ? 'review_required' : 'ready', new Date().toISOString(), jobId)
}

export function pauseMatchingJob(database: Database.Database, jobId: string, reason: string) {
  database.prepare(`
    UPDATE transfer_jobs
    SET state = 'paused', previous_active_state = 'matching', pause_reason = ?, updated_at = ?
    WHERE id = ? AND state IN ('queued', 'matching')
  `).run(reason, new Date().toISOString(), jobId)
}

export function clearJobRetry(database: Database.Database, jobId: string) {
  database.prepare(`
    UPDATE transfer_jobs SET retry_count = 0, next_attempt_at = NULL WHERE id = ?
  `).run(jobId)
}

export function scheduleJobRetry(
  database: Database.Database,
  jobId: string,
  reason: string,
  delayMs: number,
) {
  return database.transaction(() => {
    const row = database.prepare(`
      SELECT state, retry_count AS retryCount
      FROM transfer_jobs
      WHERE id = ? AND state IN ('queued', 'matching', 'transferring', 'verifying')
    `).get(jobId) as { state: string, retryCount: number } | undefined
    if (!row) return 'ignored' as const

    const retryCount = row.retryCount + 1
    const now = new Date()
    const isQuotaRetry = reason === 'SPOTIFY_QUOTA_EXCEEDED'
    if (!isQuotaRetry && retryCount >= 5) {
      database.prepare(`
        UPDATE transfer_jobs
        SET state = 'paused', previous_active_state = ?, pause_reason = ?,
          retry_count = ?, next_attempt_at = NULL, updated_at = ?
        WHERE id = ? AND state = ?
      `).run(row.state, `${reason}_RETRY_EXHAUSTED`, retryCount, now.toISOString(), jobId, row.state)
      return 'paused' as const
    }

    const usesProviderDelay = reason === 'SPOTIFY_RATE_LIMIT' || isQuotaRetry
    const backoff = usesProviderDelay ? delayMs : delayMs * 2 ** row.retryCount
    const jitter = isQuotaRetry ? 0 : Math.floor(Math.random() * Math.min(1_000, backoff * 0.25))
    const nextAttemptAt = new Date(now.getTime() + Math.max(0, backoff) + jitter).toISOString()
    database.prepare(`
      UPDATE transfer_jobs
      SET retry_count = ?, next_attempt_at = ?, pause_reason = ?, updated_at = ?
      WHERE id = ? AND state = ?
    `).run(retryCount, nextAttemptAt, reason, now.toISOString(), jobId, row.state)
    return 'scheduled' as const
  })()
}

const resumableStates = ['queued', 'matching', 'ready', 'transferring', 'verifying'] as const

export function pauseJob(database: Database.Database, ownerId: string, jobId: string) {
  const placeholders = resumableStates.map(() => '?').join(', ')
  const result = database.prepare(`
    UPDATE transfer_jobs
    SET previous_active_state = state, state = 'paused', pause_reason = 'USER_PAUSED',
      next_attempt_at = NULL, updated_at = ?
    WHERE id = ? AND owner_id = ? AND state IN (${placeholders})
  `).run(new Date().toISOString(), jobId, ownerId, ...resumableStates)
  return result.changes === 1
}

export function resumeJob(database: Database.Database, ownerId: string, jobId: string) {
  const placeholders = resumableStates.map(() => '?').join(', ')
  const result = database.prepare(`
    UPDATE transfer_jobs
    SET state = previous_active_state, previous_active_state = NULL, pause_reason = NULL,
      retry_count = 0, next_attempt_at = NULL, updated_at = ?
    WHERE id = ? AND owner_id = ? AND state = 'paused'
      AND previous_active_state IN (${placeholders})
  `).run(new Date().toISOString(), jobId, ownerId, ...resumableStates)
  return result.changes === 1
}

export function cancelJob(database: Database.Database, ownerId: string, jobId: string) {
  const result = database.prepare(`
    UPDATE transfer_jobs
    SET state = 'cancelled', previous_active_state = NULL, pause_reason = NULL,
      next_attempt_at = NULL, updated_at = ?
    WHERE id = ? AND owner_id = ?
      AND state NOT IN ('completed', 'failed', 'cancelled')
  `).run(new Date().toISOString(), jobId, ownerId)
  return result.changes === 1
}

export function readJob(database: Database.Database, ownerId: string, jobId: string) {
  const job = database.prepare(`
    SELECT transfer_jobs.id, transfer_jobs.state, transfer_jobs.pause_reason AS pauseReason,
      transfer_jobs.next_attempt_at AS nextAttemptAt,
      transfer_jobs.created_at AS createdAt, source_playlists.name,
      source_playlists.source_type AS sourceType,
      source_playlists.source_reference AS sourceReference,
      source_connection.provider_identity AS sourceConnectionIdentity,
      destination_playlists.spotify_id AS spotifyId,
      source_playlists.declared_count AS total
    FROM transfer_jobs
    JOIN source_playlists ON source_playlists.job_id = transfer_jobs.id
    LEFT JOIN account_connections AS source_connection
      ON source_connection.id = transfer_jobs.source_connection_id
    LEFT JOIN destination_playlists ON destination_playlists.source_playlist_id = source_playlists.id
    WHERE transfer_jobs.id = ? AND transfer_jobs.owner_id = ?
  `).get(jobId, ownerId) as {
    id: string
    state: TransferJobState
    pauseReason: string | null
    nextAttemptAt: string | null
    createdAt: string
    name: string
    sourceType: 'private' | 'public' | null
    sourceReference: string | null
    sourceConnectionIdentity: string | null
    spotifyId: string | null
    total: number
  } | undefined
  if (!job) return undefined

  const counts = database.prepare(`
    SELECT
      COUNT(match_decisions.id) AS processed,
      COALESCE(SUM(match_decisions.decision = 'accepted'), 0) AS accepted,
      COALESCE(SUM(match_decisions.decision = 'review_required'), 0) AS reviewRequired,
      COALESCE(SUM(match_decisions.decision = 'unavailable'), 0) AS unavailable,
      COALESCE(SUM(match_decisions.decision = 'excluded'), 0) AS excluded
    FROM source_entries
    JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
    LEFT JOIN match_decisions ON match_decisions.source_entry_id = source_entries.id
    WHERE source_playlists.job_id = ?
  `).get(jobId) as {
    processed: number
    accepted: number
    reviewRequired: number
    unavailable: number
    excluded: number
  }
  const { sourceReference, ...summary } = job
  const result = {
    ...summary,
    ...counts,
    sourceLocator: sourceReference ? JSON.parse(sourceReference) as SourceLocator : null,
    canRestart: !['transferring', 'verifying'].includes(job.state),
  }
  return result satisfies MatchingJob
}

export function readLatestJob(database: Database.Database, ownerId: string) {
  const row = database.prepare(`
    SELECT id FROM transfer_jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(ownerId) as { id: string } | undefined
  return row ? readJob(database, ownerId, row.id) : undefined
}

export function readJobReport(database: Database.Database, ownerId: string, jobId: string) {
  const job = database.prepare(`
    SELECT transfer_jobs.id, transfer_jobs.state, transfer_jobs.created_at AS createdAt,
      transfer_jobs.updated_at AS updatedAt, source_playlists.name,
      source_playlists.source_identity AS sourceIdentity, source_playlists.revision,
      source_playlists.declared_count AS declaredCount,
      destination_playlists.spotify_id AS spotifyId
    FROM transfer_jobs
    JOIN source_playlists ON source_playlists.job_id = transfer_jobs.id
    LEFT JOIN destination_playlists ON destination_playlists.source_playlist_id = source_playlists.id
    WHERE transfer_jobs.id = ? AND transfer_jobs.owner_id = ?
  `).get(jobId, ownerId) as {
    id: string
    state: string
    createdAt: string
    updatedAt: string
    name: string
    sourceIdentity: string
    revision: string | null
    declaredCount: number
    spotifyId: string | null
  } | undefined
  if (!job) return undefined

  const rows = database.prepare(`
    SELECT source_entries.position, source_entries.original_metadata AS sourceMetadata,
      source_entries.availability, match_decisions.candidate_uri AS candidateUri,
      match_decisions.evidence, match_decisions.decision, match_decisions.reviewer_status AS reviewerStatus
    FROM source_entries
    JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
    LEFT JOIN match_decisions ON match_decisions.source_entry_id = source_entries.id
    WHERE source_playlists.job_id = ?
    ORDER BY source_entries.position
  `).all(jobId) as Array<{
    position: number
    sourceMetadata: string
    availability: string
    candidateUri: string | null
    evidence: string | null
    decision: string | null
    reviewerStatus: string | null
  }>
  const entries = rows.map((row) => {
    const evidence = row.evidence ? JSON.parse(row.evidence) as {
      codes?: string[]
      candidates?: MatchTrack[]
    } : null
    return {
      position: row.position,
      source: JSON.parse(row.sourceMetadata) as SourceTrack,
      availability: row.availability,
      decision: row.decision || 'pending',
      reviewerStatus: row.reviewerStatus,
      candidateUri: row.candidateUri,
      selectedCandidate: evidence?.candidates?.find(candidate => candidate.uri === row.candidateUri) || null,
      evidenceCodes: evidence?.codes || [],
    }
  })
  return { job, entries }
}

export type DecisionFilter = 'all' | 'matched' | 'review' | 'unavailable' | 'excluded'

function decisionFilterClause(filter: DecisionFilter) {
  if (filter === 'matched') return "AND match_decisions.decision = 'accepted'"
  if (filter === 'review') return "AND match_decisions.decision IN ('review_required', 'unavailable')"
  if (filter === 'unavailable') return "AND match_decisions.decision = 'unavailable'"
  if (filter === 'excluded') return "AND match_decisions.decision = 'excluded'"
  return ''
}

export function readDecisionPage(
  database: Database.Database,
  ownerId: string,
  jobId: string,
  page: number,
  pageSize: number,
  filter: DecisionFilter = 'all',
) {
  const ownsJob = database.prepare(`
    SELECT 1 FROM transfer_jobs WHERE id = ? AND owner_id = ?
  `).get(jobId, ownerId)
  if (!ownsJob) return undefined

  const filterClause = decisionFilterClause(filter)
  const countRow = database.prepare(`
    SELECT COUNT(*) AS count
    FROM source_entries
    JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
    JOIN match_decisions ON match_decisions.source_entry_id = source_entries.id
    WHERE source_playlists.job_id = ?
      ${filterClause}
  `).get(jobId) as { count: number }
  const total = countRow.count
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount)

  const rows = database.prepare(`
    SELECT source_entries.id AS entryId, source_entries.position,
      source_entries.original_metadata AS sourceMetadata,
      match_decisions.candidate_uri AS candidateUri, match_decisions.evidence,
      match_decisions.decision, match_decisions.reviewer_status AS reviewerStatus
    FROM source_entries
    JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
    JOIN match_decisions ON match_decisions.source_entry_id = source_entries.id
    WHERE source_playlists.job_id = ?
      ${filterClause}
    ORDER BY
      CASE match_decisions.decision
        WHEN 'unavailable' THEN 0
        WHEN 'review_required' THEN 1
        WHEN 'accepted' THEN 2
        ELSE 3
      END,
      source_entries.position
    LIMIT ? OFFSET ?
  `).all(jobId, pageSize, (safePage - 1) * pageSize) as Array<{
    entryId: string
    position: number
    sourceMetadata: string
    candidateUri: string | null
    evidence: string
    decision: MatchDecisionState
    reviewerStatus: 'automatic' | 'pending' | 'user'
  }>
  const decisions = rows.map(row => ({
    entryId: row.entryId,
    position: row.position,
    source: JSON.parse(row.sourceMetadata) as SourceTrack,
    candidateUri: row.candidateUri,
    decision: row.decision,
    reviewerStatus: row.reviewerStatus,
    evidence: JSON.parse(row.evidence) as {
      score: number
      margin: number
      codes: string[]
      candidates: MatchTrack[]
    },
  }))
  return { decisions, page: safePage, pageSize, total, pageCount } satisfies ReviewPage
}

export function readReviewDecisionPage(
  database: Database.Database,
  ownerId: string,
  jobId: string,
  page: number,
  pageSize: number,
) {
  return readDecisionPage(database, ownerId, jobId, page, pageSize, 'review')
}

export function readReviewDecisions(database: Database.Database, ownerId: string, jobId: string) {
  return readReviewDecisionPage(database, ownerId, jobId, 1, 50)?.decisions
}

export function readReviewSearchContext(
  database: Database.Database,
  ownerId: string,
  jobId: string,
  entryId: string,
) {
  return database.prepare(`
    SELECT account_connections.id AS connectionId,
      account_connections.encrypted_tokens AS encryptedTokens,
      account_connections.token_expires_at AS tokenExpiresAt
    FROM match_decisions
    JOIN source_entries ON source_entries.id = match_decisions.source_entry_id
    JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
    JOIN transfer_jobs ON transfer_jobs.id = source_playlists.job_id
    JOIN account_connections ON account_connections.id = transfer_jobs.destination_connection_id
    WHERE transfer_jobs.id = ? AND transfer_jobs.owner_id = ? AND source_entries.id = ?
      AND transfer_jobs.state IN ('review_required', 'ready')
      AND match_decisions.decision IN ('accepted', 'review_required', 'unavailable', 'excluded')
  `).get(jobId, ownerId, entryId) as {
    connectionId: string
    encryptedTokens: string
    tokenExpiresAt: string | null
  } | undefined
}

export function saveManualCandidates(
  database: Database.Database,
  input: {
    ownerId: string
    jobId: string
    entryId: string
    query: string
    candidates: MatchTrack[]
  },
) {
  return database.transaction(() => {
    const row = database.prepare(`
      SELECT match_decisions.id, match_decisions.evidence
      FROM match_decisions
      JOIN source_entries ON source_entries.id = match_decisions.source_entry_id
      JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
      JOIN transfer_jobs ON transfer_jobs.id = source_playlists.job_id
      WHERE transfer_jobs.id = ? AND transfer_jobs.owner_id = ? AND source_entries.id = ?
        AND transfer_jobs.state IN ('review_required', 'ready')
        AND match_decisions.decision IN ('accepted', 'review_required', 'unavailable', 'excluded')
    `).get(input.jobId, input.ownerId, input.entryId) as { id: string, evidence: string } | undefined
    if (!row) return undefined

    const evidence = JSON.parse(row.evidence) as {
      score: number
      margin: number
      codes: string[]
      candidates: MatchTrack[]
      manualQueries?: string[]
    }
    const candidates = [...input.candidates, ...evidence.candidates]
      .filter((candidate, index, values) => values.findIndex(value => value.uri === candidate.uri) === index)
    const manualQueries = [...(evidence.manualQueries || []), input.query].slice(-10)
    const updatedEvidence = { ...evidence, candidates, manualQueries }
    database.prepare(`
      UPDATE match_decisions SET evidence = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(updatedEvidence), new Date().toISOString(), row.id)
    return updatedEvidence
  })()
}

export function reviewMatchDecision(
  database: Database.Database,
  input: {
    ownerId: string
    jobId: string
    entryId: string
    action: 'select' | 'exclude'
    candidateUri?: string
  },
) {
  return database.transaction(() => {
    const row = database.prepare(`
      SELECT match_decisions.id, match_decisions.evidence
      FROM match_decisions
      JOIN source_entries ON source_entries.id = match_decisions.source_entry_id
      JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
      JOIN transfer_jobs ON transfer_jobs.id = source_playlists.job_id
      WHERE transfer_jobs.id = ? AND transfer_jobs.owner_id = ? AND source_entries.id = ?
        AND transfer_jobs.state IN ('review_required', 'ready')
        AND match_decisions.decision IN ('accepted', 'review_required', 'unavailable', 'excluded')
    `).get(input.jobId, input.ownerId, input.entryId) as { id: string, evidence: string } | undefined
    if (!row) return false

    let candidateUri: string | null = null
    let decision = 'excluded'
    if (input.action === 'select') {
      const evidence = JSON.parse(row.evidence) as { candidates: MatchTrack[] }
      const candidate = evidence.candidates.find(item => item.uri === input.candidateUri)
      if (!candidate) return false
      candidateUri = candidate.uri
      decision = 'accepted'
    }
    database.prepare(`
      UPDATE match_decisions
      SET candidate_uri = ?, decision = ?, reviewer_status = 'user', updated_at = ?
      WHERE id = ?
    `).run(candidateUri, decision, new Date().toISOString(), row.id)

    const pending = database.prepare(`
      SELECT COUNT(*) AS count
      FROM match_decisions
      JOIN source_entries ON source_entries.id = match_decisions.source_entry_id
      JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
      WHERE source_playlists.job_id = ? AND match_decisions.decision IN ('review_required', 'unavailable')
    `).get(input.jobId) as { count: number }
    if (pending.count === 0) {
      database.prepare(`
        UPDATE transfer_jobs SET state = 'ready', updated_at = ?
        WHERE id = ? AND state = 'review_required'
      `).run(new Date().toISOString(), input.jobId)
    }
    return true
  })()
}

export function reviewMatchDecisions(
  database: Database.Database,
  input: {
    ownerId: string
    jobId: string
    decisions: Array<{
      entryId: string
      action: 'select' | 'exclude'
      candidateUri?: string
    }>
  },
) {
  return database.transaction(() => {
    const readDecision = database.prepare(`
      SELECT match_decisions.id, match_decisions.evidence
      FROM match_decisions
      JOIN source_entries ON source_entries.id = match_decisions.source_entry_id
      JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
      JOIN transfer_jobs ON transfer_jobs.id = source_playlists.job_id
      WHERE transfer_jobs.id = ? AND transfer_jobs.owner_id = ? AND source_entries.id = ?
        AND transfer_jobs.state = 'review_required'
        AND match_decisions.decision IN ('review_required', 'unavailable')
    `)
    const rows = input.decisions.map(decision => ({
      decision,
      row: readDecision.get(input.jobId, input.ownerId, decision.entryId) as {
        id: string
        evidence: string
      } | undefined,
    }))
    if (rows.some(item => !item.row)) return undefined

    const updates = rows.map(({ decision, row }) => {
      if (decision.action === 'exclude') return { id: row!.id, candidateUri: null, value: 'excluded' }
      const evidence = JSON.parse(row!.evidence) as { candidates: MatchTrack[] }
      const candidate = evidence.candidates.find(item => item.uri === decision.candidateUri)
      if (!candidate) return undefined
      return { id: row!.id, candidateUri: candidate.uri, value: 'accepted' }
    })
    if (updates.some(update => !update)) return undefined

    const updateDecision = database.prepare(`
      UPDATE match_decisions
      SET candidate_uri = ?, decision = ?, reviewer_status = 'user', updated_at = ?
      WHERE id = ?
    `)
    const now = new Date().toISOString()
    for (const update of updates) {
      updateDecision.run(update!.candidateUri, update!.value, now, update!.id)
    }

    const pending = database.prepare(`
      SELECT COUNT(*) AS count
      FROM match_decisions
      JOIN source_entries ON source_entries.id = match_decisions.source_entry_id
      JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
      WHERE source_playlists.job_id = ? AND match_decisions.decision IN ('review_required', 'unavailable')
    `).get(input.jobId) as { count: number }
    if (pending.count === 0) {
      database.prepare(`
        UPDATE transfer_jobs SET state = 'ready', updated_at = ?
        WHERE id = ? AND state = 'review_required'
      `).run(now, input.jobId)
    }
    return updates.length
  })()
}

export function prepareTransfer(database: Database.Database, ownerId: string, jobId: string) {
  return database.transaction(() => {
    const job = database.prepare(`
      SELECT transfer_jobs.state, transfer_jobs.previous_active_state AS previousActiveState,
        source_playlists.id AS playlistId,
        destination_playlists.id AS destinationId
      FROM transfer_jobs
      JOIN source_playlists ON source_playlists.job_id = transfer_jobs.id
      LEFT JOIN destination_playlists ON destination_playlists.source_playlist_id = source_playlists.id
      WHERE transfer_jobs.id = ? AND transfer_jobs.owner_id = ?
    `).get(jobId, ownerId) as {
      state: string
      previousActiveState: string | null
      playlistId: string
      destinationId: string | null
    } | undefined
    if (!job) return false
    if (job.destinationId) {
      return ['transferring', 'verifying', 'completed'].includes(job.state)
        || (job.state === 'paused' && ['transferring', 'verifying'].includes(job.previousActiveState || ''))
    }
    if (job.state !== 'ready') return false

    const rows = database.prepare(`
      SELECT match_decisions.candidate_uri AS uri, match_decisions.decision
      FROM source_entries
      JOIN match_decisions ON match_decisions.source_entry_id = source_entries.id
      WHERE source_entries.playlist_id = ?
      ORDER BY source_entries.position
    `).all(job.playlistId) as Array<{ uri: string | null, decision: string }>
    if (rows.some(row => !['accepted', 'excluded'].includes(row.decision))) return false
    const uris = rows.filter(row => row.decision === 'accepted').map(row => row.uri).filter(Boolean) as string[]
    const planHash = createHash('sha256').update(JSON.stringify(uris)).digest('base64url')
    const destinationId = randomUUID()
    const marker = `yamusic-job:${jobId}`
    const now = new Date().toISOString()
    database.prepare(`
      INSERT INTO destination_playlists
        (id, source_playlist_id, creation_marker, expected_sequence, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(destinationId, job.playlistId, marker, JSON.stringify(uris), now)

    const insertBatch = database.prepare(`
      INSERT INTO transfer_batches
        (id, destination_id, sequence_position, intended_uris, outcome, updated_at)
      VALUES (?, ?, ?, ?, 'prepared', ?)
    `)
    let position = 0
    for (const batch of createTransferBatches(uris)) {
      insertBatch.run(randomUUID(), destinationId, position, JSON.stringify(batch), now)
      position += batch.length
    }
    database.prepare(`
      UPDATE transfer_jobs
      SET state = 'transferring', confirmed_plan_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(planHash, now, jobId)
    return true
  })()
}

export function readNextTransferJob(database: Database.Database) {
  return database.prepare(`
    SELECT transfer_jobs.id, transfer_jobs.state, transfer_jobs.owner_id AS ownerId,
      source_playlists.name, destination_playlists.id AS destinationId,
      destination_playlists.spotify_id AS spotifyId,
      destination_playlists.creation_marker AS marker,
      destination_playlists.expected_sequence AS expectedSequence,
      account_connections.id AS connectionId,
      account_connections.encrypted_tokens AS encryptedTokens,
      account_connections.token_expires_at AS tokenExpiresAt
    FROM transfer_jobs
    JOIN source_playlists ON source_playlists.job_id = transfer_jobs.id
    JOIN destination_playlists ON destination_playlists.source_playlist_id = source_playlists.id
    JOIN account_connections ON account_connections.id = transfer_jobs.destination_connection_id
    WHERE transfer_jobs.state IN ('transferring', 'verifying')
      AND (transfer_jobs.next_attempt_at IS NULL OR transfer_jobs.next_attempt_at <= ?)
    ORDER BY transfer_jobs.updated_at
    LIMIT 1
  `).get(new Date().toISOString()) as {
    id: string
    state: 'transferring' | 'verifying'
    ownerId: string
    name: string
    destinationId: string
    spotifyId: string | null
    marker: string
    expectedSequence: string
    connectionId: string
    encryptedTokens: string
    tokenExpiresAt: string | null
  } | undefined
}

export function setDestinationSpotifyId(
  database: Database.Database,
  destinationId: string,
  spotifyId: string,
) {
  database.prepare(`
    UPDATE destination_playlists SET spotify_id = ? WHERE id = ? AND spotify_id IS NULL
  `).run(spotifyId, destinationId)
}

export function readNextTransferBatch(database: Database.Database, destinationId: string) {
  const row = database.prepare(`
    SELECT id, sequence_position AS position, intended_uris AS intendedUris, outcome
    FROM transfer_batches
    WHERE destination_id = ? AND outcome != 'confirmed'
    ORDER BY sequence_position
    LIMIT 1
  `).get(destinationId) as {
    id: string
    position: number
    intendedUris: string
    outcome: 'prepared' | 'in_flight'
  } | undefined
  return row ? { ...row, intendedUris: JSON.parse(row.intendedUris) as string[] } : undefined
}

export function setTransferBatchOutcome(
  database: Database.Database,
  batchId: string,
  outcome: 'prepared' | 'in_flight' | 'confirmed',
  snapshotIdentifier: string | null = null,
) {
  database.prepare(`
    UPDATE transfer_batches
    SET outcome = ?, snapshot_identifier = ?, updated_at = ?
    WHERE id = ?
  `).run(outcome, snapshotIdentifier, new Date().toISOString(), batchId)
}

export function setTransferJobState(
  database: Database.Database,
  jobId: string,
  state: 'verifying' | 'completed' | 'paused',
  pauseReason: string | null = null,
) {
  const sourceStates = state === 'verifying'
    ? ['transferring']
    : state === 'completed'
      ? ['verifying']
      : ['transferring', 'verifying']
  const placeholders = sourceStates.map(() => '?').join(', ')
  database.prepare(`
    UPDATE transfer_jobs
    SET state = ?, pause_reason = ?, previous_active_state = CASE WHEN ? = 'paused' THEN state ELSE NULL END,
      updated_at = ?
    WHERE id = ? AND state IN (${placeholders})
  `).run(state, pauseReason, state, new Date().toISOString(), jobId, ...sourceStates)
}
