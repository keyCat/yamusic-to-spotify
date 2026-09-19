import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initialMigration } from '../../server/storage/migrations/001_initial'
import { jobRetryMigration } from '../../server/storage/migrations/003_job_retries'
import {
  cancelJob,
  createMatchingJob,
  completeMatchingJob,
  prepareTransfer,
  readJob,
  readJobReport,
  readDecisionPage,
  readNextUnmatchedEntry,
  readReviewDecisionPage,
  readReviewDecisions,
  resumeJob,
  reviewMatchDecisions,
  reviewMatchDecision,
  saveManualCandidates,
  saveMatchResult,
  scheduleJobRetry,
  setTransferJobState,
  startMatchingJob,
  pauseJob,
} from '../../server/storage/jobs'

let database: Database.Database

beforeEach(() => {
  database = new Database(':memory:')
  database.exec(initialMigration)
  database.exec(jobRetryMigration)
  database.exec(`
    ALTER TABLE source_playlists ADD COLUMN source_type TEXT;
    ALTER TABLE source_playlists ADD COLUMN source_reference TEXT;
  `)
  const now = new Date().toISOString()
  database.prepare(`
    INSERT INTO users (id, spotify_id, access_status, created_at, updated_at)
    VALUES ('owner', 'spotify-user', 'active', ?, ?)
  `).run(now, now)
  const connection = database.prepare(`
    INSERT INTO account_connections
      (id, owner_id, provider, provider_identity, encrypted_tokens, status, created_at, updated_at)
    VALUES (?, 'owner', ?, ?, 'secret', 'active', ?, ?)
  `)
  connection.run('source', 'yandex', 'yandex-user', now, now)
  connection.run('destination', 'spotify', 'spotify-user', now, now)
})

afterEach(() => database.close())

describe('matching jobs', () => {
  it('replaces a current job without losing its source reference', () => {
    const firstJobId = createMatchingJob(database, {
      ownerId: 'owner',
      sourceConnectionId: 'source',
      destinationConnectionId: 'destination',
      idempotencyKey: 'first-search',
      sourceLocator: { type: 'private', identity: 'yandex-user', collectionId: 'likes' },
      snapshot: {
        id: 'liked',
        owner: 'yandex-user',
        revision: 1,
        name: 'Любимые треки',
        description: '',
        coverUrl: null,
        declaredTrackCount: 0,
        tracks: [],
      },
    })

    const nextJobId = createMatchingJob(database, {
      ownerId: 'owner',
      sourceConnectionId: 'source',
      destinationConnectionId: 'destination',
      idempotencyKey: 'second-search',
      replaceJobId: firstJobId,
      sourceLocator: { type: 'private', identity: 'yandex-user', collectionId: 'likes' },
      snapshot: {
        id: 'liked',
        owner: 'yandex-user',
        revision: 2,
        name: 'Любимые треки',
        description: '',
        coverUrl: null,
        declaredTrackCount: 0,
        tracks: [],
      },
    })

    expect(readJob(database, 'owner', firstJobId)).toMatchObject({ state: 'cancelled' })
    expect(readJob(database, 'owner', nextJobId)).toMatchObject({
      state: 'queued',
      sourceType: 'private',
      sourceLocator: { type: 'private', identity: 'yandex-user', collectionId: 'likes' },
      sourceConnectionIdentity: 'yandex-user',
      canRestart: true,
    })
  })

  it('makes a job ready when every match has automatic acceptance', () => {
    const jobId = createMatchingJob(database, {
      ownerId: 'owner',
      sourceConnectionId: 'source',
      destinationConnectionId: 'destination',
      idempotencyKey: 'automatic-ready',
      snapshot: {
        id: 'automatic-ready',
        owner: 'yandex-user',
        revision: 1,
        name: 'Готовый плейлист',
        description: '',
        coverUrl: null,
        declaredTrackCount: 1,
        tracks: [{
          id: 'track-automatic',
          title: 'Песня',
          artists: ['Автор'],
          album: 'Альбом',
          coverUrl: null,
          durationMs: 120_000,
          available: true,
          position: 0,
        }],
      },
    })
    startMatchingJob(database, jobId)
    const entry = readNextUnmatchedEntry(database, jobId)!
    const candidate = {
      uri: 'spotify:track:automatic',
      title: 'Песня',
      artists: ['Автор'],
      album: 'Альбом',
      coverUrl: null,
      durationMs: 120_000,
      available: true,
    }
    saveMatchResult(database, entry.id, {
      candidate,
      score: 0.99,
      margin: 0.4,
      decision: 'accepted',
      evidence: ['METADATA_SCORE'],
    }, [candidate])

    completeMatchingJob(database, jobId)

    expect(readJob(database, 'owner', jobId)).toMatchObject({ state: 'ready', accepted: 1 })
  })

  it('lists all decisions with review-first order and state filters', () => {
    const tracks = ['Совпало', 'Проверить', 'Не найдено', 'Не переносится'].map((title, position) => ({
      id: `track-${position}`,
      title,
      artists: ['Автор'],
      album: 'Альбом',
      coverUrl: null,
      durationMs: 120_000,
      available: true,
      position,
    }))
    const jobId = createMatchingJob(database, {
      ownerId: 'owner',
      sourceConnectionId: 'source',
      destinationConnectionId: 'destination',
      idempotencyKey: 'all-decisions',
      snapshot: {
        id: 'all-decisions',
        owner: 'yandex-user',
        revision: 1,
        name: 'Все решения',
        description: '',
        coverUrl: null,
        declaredTrackCount: tracks.length,
        tracks,
      },
    })
    startMatchingJob(database, jobId)

    const acceptedEntry = readNextUnmatchedEntry(database, jobId)!
    const accepted = {
      uri: 'spotify:track:accepted',
      title: 'Совпало',
      artists: ['Автор'],
      album: 'Альбом',
      coverUrl: null,
      durationMs: 120_000,
      available: true,
    }
    const alternate = { ...accepted, uri: 'spotify:track:alternate', title: 'Другой вариант' }
    saveMatchResult(database, acceptedEntry.id, {
      candidate: accepted,
      score: 0.95,
      margin: 0.2,
      decision: 'accepted',
      evidence: ['METADATA_SCORE'],
    }, [accepted, alternate])

    const reviewEntry = readNextUnmatchedEntry(database, jobId)!
    const reviewCandidate = { ...accepted, uri: 'spotify:track:review', title: 'Проверить' }
    saveMatchResult(database, reviewEntry.id, {
      candidate: reviewCandidate,
      score: 0.8,
      margin: 0.02,
      decision: 'review_required',
      evidence: ['METADATA_SCORE'],
    }, [reviewCandidate])

    const unavailableEntry = readNextUnmatchedEntry(database, jobId)!
    saveMatchResult(database, unavailableEntry.id, {
      candidate: null,
      score: 0,
      margin: 0,
      decision: 'unavailable',
      evidence: ['NO_CANDIDATES'],
    }, [])

    const lastAcceptedEntry = readNextUnmatchedEntry(database, jobId)!
    const lastAcceptedCandidate = { ...accepted, uri: 'spotify:track:last', title: 'Не переносится' }
    saveMatchResult(database, lastAcceptedEntry.id, {
      candidate: lastAcceptedCandidate,
      score: 0.95,
      margin: 0.2,
      decision: 'accepted',
      evidence: ['METADATA_SCORE'],
    }, [lastAcceptedCandidate])
    completeMatchingJob(database, jobId)
    expect(reviewMatchDecision(database, {
      ownerId: 'owner',
      jobId,
      entryId: acceptedEntry.id,
      action: 'exclude',
    })).toBe(true)

    expect(readDecisionPage(database, 'owner', jobId, 1, 25, 'all')?.decisions.map(item => item.position))
      .toEqual([2, 1, 3, 0])
    expect(readDecisionPage(database, 'owner', jobId, 1, 25, 'matched')).toMatchObject({ total: 1 })
    expect(readDecisionPage(database, 'owner', jobId, 1, 25, 'review')).toMatchObject({ total: 2 })
    expect(readDecisionPage(database, 'owner', jobId, 1, 25, 'unavailable')).toMatchObject({
      total: 1,
      decisions: [{ position: 2, decision: 'unavailable' }],
    })
    expect(readDecisionPage(database, 'owner', jobId, 1, 25, 'excluded')).toMatchObject({
      total: 1,
      decisions: [{ position: 0, decision: 'excluded' }],
    })

    expect(reviewMatchDecision(database, {
      ownerId: 'owner',
      jobId,
      entryId: acceptedEntry.id,
      action: 'select',
      candidateUri: accepted.uri,
    })).toBe(true)
    expect(readDecisionPage(database, 'owner', jobId, 1, 25, 'excluded')).toMatchObject({ total: 0 })

    database.prepare("UPDATE transfer_jobs SET state = 'ready' WHERE id = ?").run(jobId)
    expect(reviewMatchDecision(database, {
      ownerId: 'owner',
      jobId,
      entryId: acceptedEntry.id,
      action: 'select',
      candidateUri: alternate.uri,
    })).toBe(true)
    expect(readDecisionPage(database, 'owner', jobId, 1, 25, 'matched')?.decisions[0]).toMatchObject({
      candidateUri: alternate.uri,
      reviewerStatus: 'user',
    })
  })

  it('stores a review decision and makes the job ready', () => {
    const jobId = createMatchingJob(database, {
      ownerId: 'owner',
      sourceConnectionId: 'source',
      destinationConnectionId: 'destination',
      idempotencyKey: 'request-1',
      snapshot: {
        id: 'liked',
        owner: 'yandex-user',
        revision: 1,
        name: 'Любимые треки',
        description: '',
        declaredTrackCount: 1,
        coverUrl: null,
        tracks: [{
          id: 'track-1',
          title: 'Песня',
          artists: ['Автор'],
          album: 'Альбом',
          coverUrl: null,
          durationMs: 120_000,
          available: true,
          position: 0,
        }],
      },
    })
    startMatchingJob(database, jobId)
    const entry = readNextUnmatchedEntry(database, jobId)!
    const candidate = {
      uri: 'spotify:track:1',
      title: 'Песня',
      artists: ['Автор'],
      album: 'Альбом',
      coverUrl: null,
      durationMs: 120_000,
      available: true,
    }
    saveMatchResult(database, entry.id, {
      candidate,
      score: 0.8,
      margin: 0.02,
      decision: 'review_required',
      evidence: ['METADATA_SCORE'],
    }, [candidate])
    completeMatchingJob(database, jobId)

    const review = readReviewDecisions(database, 'owner', jobId)!
    expect(review).toHaveLength(1)
    const manualCandidate = { ...candidate, uri: 'spotify:track:manual', title: 'Ручной результат' }
    const evidence = saveManualCandidates(database, {
      ownerId: 'owner',
      jobId,
      entryId: entry.id,
      query: 'Другой запрос',
      candidates: [manualCandidate],
    })
    expect(evidence?.candidates[0]?.uri).toBe(manualCandidate.uri)
    expect(readReviewDecisions(database, 'owner', jobId)?.[0]?.evidence.candidates[0]?.uri)
      .toBe(manualCandidate.uri)
    expect(reviewMatchDecision(database, {
      ownerId: 'owner',
      jobId,
      entryId: entry.id,
      action: 'select',
      candidateUri: manualCandidate.uri,
    })).toBe(true)
    expect(readJob(database, 'owner', jobId)).toMatchObject({ state: 'ready', accepted: 1 })
    expect(prepareTransfer(database, 'owner', jobId)).toBe(true)
    expect(readJob(database, 'owner', jobId)).toMatchObject({ state: 'transferring', accepted: 1 })
    expect(prepareTransfer(database, 'owner', jobId)).toBe(true)
    expect(pauseJob(database, 'owner', jobId)).toBe(true)
    expect(prepareTransfer(database, 'owner', jobId)).toBe(true)
    expect(resumeJob(database, 'owner', jobId)).toBe(true)
    expect(database.prepare('SELECT outcome FROM transfer_batches').all()).toEqual([{ outcome: 'prepared' }])
    expect(cancelJob(database, 'owner', jobId)).toBe(true)
    expect(prepareTransfer(database, 'owner', jobId)).toBe(false)
    database.prepare("UPDATE transfer_jobs SET state = 'ready' WHERE id = ?").run(jobId)
    expect(prepareTransfer(database, 'owner', jobId)).toBe(false)
    database.prepare("UPDATE transfer_jobs SET state = 'failed' WHERE id = ?").run(jobId)
    expect(prepareTransfer(database, 'owner', jobId)).toBe(false)
    database.prepare("UPDATE transfer_jobs SET state = 'cancelled' WHERE id = ?").run(jobId)
    setTransferJobState(database, jobId, 'verifying')
    expect(readJob(database, 'owner', jobId)).toMatchObject({ state: 'cancelled', accepted: 1 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM destination_playlists').get()).toEqual({ count: 1 })
    const report = readJobReport(database, 'owner', jobId)!
    expect(report.entries).toHaveLength(1)
    expect(report.entries[0]).toMatchObject({
      decision: 'accepted',
      candidateUri: manualCandidate.uri,
      selectedCandidate: { title: 'Ручной результат' },
    })
    expect(JSON.stringify(report)).not.toContain('secret')
  })

  it('pages 1,501 review entries and stores bulk decisions', () => {
    const tracks = Array.from({ length: 1_501 }, (_, position) => ({
      id: `track-${position}`,
      title: `Песня ${position}`,
      artists: ['Автор'],
      album: 'Альбом',
      coverUrl: null,
      durationMs: 120_000,
      available: true,
      position,
    }))
    const jobId = createMatchingJob(database, {
      ownerId: 'owner',
      sourceConnectionId: 'source',
      destinationConnectionId: 'destination',
      idempotencyKey: 'large-playlist',
      snapshot: {
        id: 'large',
        owner: 'yandex-user',
        revision: 1,
        name: 'Большой плейлист',
        description: '',
        declaredTrackCount: tracks.length,
        coverUrl: null,
        tracks,
      },
    })
    startMatchingJob(database, jobId)
    const entries = database.prepare(`
      SELECT source_entries.id
      FROM source_entries
      JOIN source_playlists ON source_playlists.id = source_entries.playlist_id
      WHERE source_playlists.job_id = ?
      ORDER BY source_entries.position
    `).all(jobId) as Array<{ id: string }>
    const insert = database.prepare(`
      INSERT INTO match_decisions
        (id, source_entry_id, candidate_uri, evidence, decision, reviewer_status, updated_at)
      VALUES (?, ?, ?, ?, 'review_required', 'pending', ?)
    `)
    const now = new Date().toISOString()
    database.transaction(() => {
      entries.forEach((entry, position) => {
        const candidate = {
          uri: `spotify:track:${position}`,
          title: `Песня ${position}`,
          artists: ['Автор'],
          album: 'Альбом',
          durationMs: 120_000,
          available: true,
        }
        insert.run(`decision-${position}`, entry.id, candidate.uri, JSON.stringify({
          score: 0.8,
          margin: 0.02,
          codes: ['METADATA_SCORE'],
          candidates: [candidate],
        }), now)
      })
    })()
    completeMatchingJob(database, jobId)

    const lastPage = readReviewDecisionPage(database, 'owner', jobId, 61, 25)!
    expect(lastPage).toMatchObject({ page: 61, pageSize: 25, total: 1_501, pageCount: 61 })
    expect(lastPage.decisions).toHaveLength(1)
    expect(lastPage.decisions[0]?.position).toBe(1_500)

    const firstPage = readReviewDecisionPage(database, 'owner', jobId, 1, 25)!
    const updated = reviewMatchDecisions(database, {
      ownerId: 'owner',
      jobId,
      decisions: firstPage.decisions.map(decision => ({
        entryId: decision.entryId,
        action: 'select' as const,
        candidateUri: decision.evidence.candidates[0]!.uri,
      })),
    })
    expect(updated).toBe(25)
    expect(readReviewDecisionPage(database, 'owner', jobId, 1, 25)).toMatchObject({ total: 1_476 })
    expect(readJob(database, 'owner', jobId)).toMatchObject({ accepted: 25, reviewRequired: 1_476 })
  })

  it('stores a public job and applies user controls', () => {
    const jobId = createMatchingJob(database, {
      ownerId: 'owner',
      sourceConnectionId: null,
      destinationConnectionId: 'destination',
      idempotencyKey: 'public-playlist',
      snapshot: {
        id: 'public-id',
        owner: 'public-owner',
        revision: 1,
        name: 'Публичный плейлист',
        description: '',
        declaredTrackCount: 1,
        coverUrl: null,
        tracks: [{
          id: 'public-track',
          title: 'Песня',
          artists: ['Автор'],
          album: null,
          coverUrl: null,
          durationMs: null,
          available: true,
          position: 0,
        }],
      },
    })

    expect(pauseJob(database, 'owner', jobId)).toBe(true)
    expect(readJob(database, 'owner', jobId)).toMatchObject({ state: 'paused', pauseReason: 'USER_PAUSED' })
    expect(resumeJob(database, 'owner', jobId)).toBe(true)
    expect(readJob(database, 'owner', jobId)).toMatchObject({ state: 'queued', pauseReason: null })
    expect(cancelJob(database, 'owner', jobId)).toBe(true)
    expect(readJob(database, 'owner', jobId)).toMatchObject({ state: 'cancelled' })
    expect(resumeJob(database, 'owner', jobId)).toBe(false)
  })

  it('stores retry delays and pauses after the retry limit', () => {
    const jobId = createMatchingJob(database, {
      ownerId: 'owner',
      sourceConnectionId: null,
      destinationConnectionId: 'destination',
      idempotencyKey: 'retry-job',
      snapshot: {
        id: 'retry-source',
        owner: 'public-owner',
        revision: null,
        name: 'Повтор запроса',
        description: '',
        declaredTrackCount: 0,
        coverUrl: null,
        tracks: [],
      },
    })

    expect(scheduleJobRetry(database, jobId, 'SPOTIFY_RATE_LIMIT', 30_000)).toBe('scheduled')
    const first = database.prepare(`
      SELECT retry_count AS retryCount, next_attempt_at AS nextAttemptAt
      FROM transfer_jobs WHERE id = ?
    `).get(jobId) as { retryCount: number, nextAttemptAt: string }
    expect(first.retryCount).toBe(1)
    expect(new Date(first.nextAttemptAt).getTime()).toBeGreaterThan(Date.now() + 29_000)

    expect(scheduleJobRetry(database, jobId, 'SPOTIFY_PROVIDER_FAILURE', 1_000)).toBe('scheduled')
    expect(scheduleJobRetry(database, jobId, 'SPOTIFY_PROVIDER_FAILURE', 1_000)).toBe('scheduled')
    expect(scheduleJobRetry(database, jobId, 'SPOTIFY_PROVIDER_FAILURE', 1_000)).toBe('scheduled')
    expect(scheduleJobRetry(database, jobId, 'SPOTIFY_PROVIDER_FAILURE', 1_000)).toBe('paused')
    expect(readJob(database, 'owner', jobId)).toMatchObject({
      state: 'paused',
      pauseReason: 'SPOTIFY_PROVIDER_FAILURE_RETRY_EXHAUSTED',
    })
  })

  it('keeps quota retries active with the provider delay', () => {
    const jobId = createMatchingJob(database, {
      ownerId: 'owner',
      sourceConnectionId: null,
      destinationConnectionId: 'destination',
      idempotencyKey: 'quota-retry-job',
      snapshot: {
        id: 'quota-retry-source',
        owner: 'public-owner',
        revision: null,
        name: 'Ожидание квоты',
        description: '',
        declaredTrackCount: 0,
        coverUrl: null,
        tracks: [],
      },
    })

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const before = Date.now()
      expect(scheduleJobRetry(database, jobId, 'SPOTIFY_QUOTA_EXCEEDED', 86_401_000)).toBe('scheduled')
      const job = readJob(database, 'owner', jobId)
      expect(job).toMatchObject({
        state: 'queued',
        pauseReason: 'SPOTIFY_QUOTA_EXCEEDED',
      })
      expect(new Date(job!.nextAttemptAt!).getTime()).toBeGreaterThanOrEqual(before + 86_401_000)
      expect(new Date(job!.nextAttemptAt!).getTime()).toBeLessThan(before + 86_402_000)
    }
  })
})
