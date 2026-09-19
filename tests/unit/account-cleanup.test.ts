import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteUserTransferData, disconnectAccount, listYandexConnections } from '../../server/storage/accounts'
import { cleanupExpiredData } from '../../server/storage/cleanup'
import { cancelJob } from '../../server/storage/jobs'
import { initialMigration } from '../../server/storage/migrations/001_initial'
import { spotifyMatchCacheMigration } from '../../server/storage/migrations/002_spotify_match_cache'
import { jobRetryMigration } from '../../server/storage/migrations/003_job_retries'

let database: Database.Database

beforeEach(() => {
  database = new Database(':memory:')
  database.exec(initialMigration)
  database.exec(spotifyMatchCacheMigration)
  database.exec(jobRetryMigration)
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
  database.prepare(`
    INSERT INTO sessions (id_hash, user_id, expires_at, created_at)
    VALUES ('session', 'owner', ?, ?)
  `).run(new Date(Date.now() + 60_000).toISOString(), now)
})

afterEach(() => database.close())

describe('account controls and cleanup', () => {
  it('removes credentials and stops dependent jobs', () => {
    const now = new Date().toISOString()
    database.prepare(`
      INSERT INTO transfer_jobs
        (id, owner_id, source_connection_id, destination_connection_id, state, idempotency_key, created_at, updated_at)
      VALUES ('job', 'owner', 'source', 'destination', 'matching', 'request', ?, ?)
    `).run(now, now)

    expect(disconnectAccount(database, 'owner', 'yandex', 'yandex-user')).toBe(true)
    expect(database.prepare(`
      SELECT encrypted_tokens AS tokens, status FROM account_connections WHERE id = 'source'
    `).get()).toEqual({ tokens: '', status: 'disconnected' })
    expect(database.prepare(`
      SELECT state, previous_active_state AS previousState, pause_reason AS reason FROM transfer_jobs WHERE id = 'job'
    `).get()).toEqual({ state: 'paused', previousState: 'matching', reason: 'ACCOUNT_DISCONNECTED' })

    expect(deleteUserTransferData(database, 'owner')).toBeUndefined()
    expect(cancelJob(database, 'owner', 'job')).toBe(true)
    expect(deleteUserTransferData(database, 'owner')).toBe(1)
    expect(disconnectAccount(database, 'owner', 'spotify')).toBe(true)
    expect(database.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 0 })
  })

  it('does not list a disconnected Yandex account as an active connection', () => {
    expect(listYandexConnections(database, 'owner')).toEqual([
      { identity: 'yandex-user', status: 'active' },
    ])

    expect(disconnectAccount(database, 'owner', 'yandex', 'yandex-user')).toBe(true)
    expect(listYandexConnections(database, 'owner')).toEqual([])
  })

  it('removes expired data', () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    database.prepare(`
      INSERT INTO transfer_jobs
        (id, owner_id, destination_connection_id, state, idempotency_key, created_at, updated_at)
      VALUES ('old-job', 'owner', 'destination', 'completed', 'old-request', ?, ?)
    `).run(old, old)
    database.prepare(`
      INSERT INTO authorization_requests
        (id, provider, session_key, state_hash, expires_at, created_at)
      VALUES ('expired-auth', 'spotify', 'key', 'state', ?, ?)
    `).run(old, old)

    expect(cleanupExpiredData(database)).toMatchObject({ jobs: 1, authorizations: 1 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_jobs').get()).toEqual({ count: 0 })
  })
})
