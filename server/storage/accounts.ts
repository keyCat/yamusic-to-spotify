import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

type AuthorizationRequest = {
  id: string
  session_key: string
  verifier_encrypted: string
  expires_at: string
}

export function saveAuthorizationRequest(
  database: Database.Database,
  input: { provider: string, sessionKeyHash: string, stateHash: string, encryptedVerifier: string },
) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
  database.prepare(`
    INSERT INTO authorization_requests
      (id, provider, session_key, state_hash, verifier_encrypted, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), input.provider, input.sessionKeyHash, input.stateHash,
    input.encryptedVerifier, expiresAt.toISOString(), now.toISOString(),
  )
}

export function consumeAuthorizationRequest(
  database: Database.Database,
  input: { provider: string, sessionKeyHash: string, stateHash: string },
) {
  return database.transaction(() => {
    const request = database.prepare(`
      SELECT id, session_key, verifier_encrypted, expires_at
      FROM authorization_requests
      WHERE provider = ? AND state_hash = ?
    `).get(input.provider, input.stateHash) as AuthorizationRequest | undefined

    if (!request || request.session_key !== input.sessionKeyHash) return null
    database.prepare('DELETE FROM authorization_requests WHERE id = ?').run(request.id)
    if (new Date(request.expires_at).getTime() <= Date.now()) return null
    return request
  })()
}

export function readAuthorizationRequest(
  database: Database.Database,
  input: { provider: string, sessionKeyHash: string, stateHash: string },
) {
  const request = database.prepare(`
    SELECT id, session_key, verifier_encrypted, expires_at
    FROM authorization_requests
    WHERE provider = ? AND state_hash = ?
  `).get(input.provider, input.stateHash) as AuthorizationRequest | undefined
  if (!request || request.session_key !== input.sessionKeyHash) return null
  if (new Date(request.expires_at).getTime() <= Date.now()) {
    database.prepare('DELETE FROM authorization_requests WHERE id = ?').run(request.id)
    return null
  }
  return request
}

export function deleteAuthorizationRequest(database: Database.Database, id: string) {
  database.prepare('DELETE FROM authorization_requests WHERE id = ?').run(id)
}

export function createSpotifySession(
  database: Database.Database,
  input: {
    spotifyId: string
    encryptedTokens: string
    tokenExpiresAt: string
    sessionHash: string
  },
) {
  return database.transaction(() => {
    const now = new Date().toISOString()
    const existing = database.prepare('SELECT id FROM users WHERE spotify_id = ?')
      .get(input.spotifyId) as { id: string } | undefined
    const userId = existing?.id || randomUUID()

    if (existing) {
      database.prepare('UPDATE users SET access_status = ?, updated_at = ? WHERE id = ?')
        .run('active', now, userId)
    } else {
      database.prepare(`
        INSERT INTO users (id, spotify_id, access_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, input.spotifyId, 'active', now, now)
    }

    database.prepare(`
      INSERT INTO account_connections
        (id, owner_id, provider, provider_identity, encrypted_tokens, token_expires_at, status, created_at, updated_at)
      VALUES (?, ?, 'spotify', ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(owner_id, provider, provider_identity) DO UPDATE SET
        encrypted_tokens = excluded.encrypted_tokens,
        token_expires_at = excluded.token_expires_at,
        status = 'active',
        updated_at = excluded.updated_at
    `).run(randomUUID(), userId, input.spotifyId, input.encryptedTokens, input.tokenExpiresAt, now, now)

    database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    database.prepare(`
      INSERT INTO sessions (id_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(input.sessionHash, userId, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), now)
    return userId
  })()
}

export function readSessionUser(database: Database.Database, sessionHash: string) {
  return database.prepare(`
    SELECT users.id, users.spotify_id AS spotifyId
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id_hash = ? AND sessions.expires_at > ? AND users.access_status = 'active'
  `).get(sessionHash, new Date().toISOString()) as { id: string, spotifyId: string } | undefined
}

export function saveYandexConnection(
  database: Database.Database,
  input: { ownerId: string, providerIdentity: string, encryptedTokens: string, tokenExpiresAt: string | null },
) {
  const now = new Date().toISOString()
  database.prepare(`
    INSERT INTO account_connections
      (id, owner_id, provider, provider_identity, encrypted_tokens, token_expires_at, status, created_at, updated_at)
    VALUES (?, ?, 'yandex', ?, ?, ?, 'active', ?, ?)
    ON CONFLICT(owner_id, provider, provider_identity) DO UPDATE SET
      encrypted_tokens = excluded.encrypted_tokens,
      token_expires_at = excluded.token_expires_at,
      status = 'active',
      updated_at = excluded.updated_at
  `).run(randomUUID(), input.ownerId, input.providerIdentity, input.encryptedTokens, input.tokenExpiresAt, now, now)
}

export function listYandexConnections(database: Database.Database, ownerId: string) {
  return database.prepare(`
    SELECT provider_identity AS identity, status
    FROM account_connections
    WHERE owner_id = ? AND provider = 'yandex' AND status = 'active'
    ORDER BY created_at
  `).all(ownerId) as Array<{ identity: string, status: string }>
}

export function readYandexConnection(
  database: Database.Database,
  ownerId: string,
  identity?: string,
) {
  const identityClause = identity ? 'AND provider_identity = ?' : ''
  const parameters = identity ? [ownerId, identity] : [ownerId]
  return database.prepare(`
    SELECT id, provider_identity AS identity, encrypted_tokens AS encryptedTokens,
      token_expires_at AS tokenExpiresAt, status
    FROM account_connections
    WHERE owner_id = ? AND provider = 'yandex' AND status = 'active' ${identityClause}
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(...parameters) as {
    id: string
    identity: string
    encryptedTokens: string
    tokenExpiresAt: string | null
    status: string
  } | undefined
}

export function readSpotifyConnection(database: Database.Database, ownerId: string) {
  return database.prepare(`
    SELECT id, provider_identity AS identity, encrypted_tokens AS encryptedTokens,
      token_expires_at AS tokenExpiresAt, status
    FROM account_connections
    WHERE owner_id = ? AND provider = 'spotify' AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(ownerId) as {
    id: string
    identity: string
    encryptedTokens: string
    tokenExpiresAt: string | null
    status: string
  } | undefined
}

export function updateConnectionTokens(
  database: Database.Database,
  input: { connectionId: string, encryptedTokens: string, tokenExpiresAt: string | null },
) {
  database.prepare(`
    UPDATE account_connections
    SET encrypted_tokens = ?, token_expires_at = ?, updated_at = ?
    WHERE id = ?
  `).run(input.encryptedTokens, input.tokenExpiresAt, new Date().toISOString(), input.connectionId)
}

export function disconnectAccount(
  database: Database.Database,
  ownerId: string,
  provider: 'spotify' | 'yandex',
  identity?: string,
) {
  return database.transaction(() => {
    const identityClause = identity ? 'AND provider_identity = ?' : ''
    const parameters = identity ? [ownerId, provider, identity] : [ownerId, provider]
    const connection = database.prepare(`
      SELECT id FROM account_connections
      WHERE owner_id = ? AND provider = ? AND status = 'active' ${identityClause}
      ORDER BY updated_at DESC LIMIT 1
    `).get(...parameters) as { id: string } | undefined
    if (!connection) return false

    const now = new Date().toISOString()
    database.prepare(`
      UPDATE transfer_jobs
      SET state = 'paused', previous_active_state = state, pause_reason = 'ACCOUNT_DISCONNECTED',
        next_attempt_at = NULL, updated_at = ?
      WHERE owner_id = ? AND (source_connection_id = ? OR destination_connection_id = ?)
        AND state NOT IN ('completed', 'failed', 'cancelled', 'paused')
    `).run(now, ownerId, connection.id, connection.id)
    database.prepare(`
      UPDATE account_connections
      SET encrypted_tokens = '', token_expires_at = NULL, status = 'disconnected', updated_at = ?
      WHERE id = ?
    `).run(now, connection.id)
    if (provider === 'spotify') database.prepare('DELETE FROM sessions WHERE user_id = ?').run(ownerId)
    return true
  })()
}

export function deleteUserTransferData(database: Database.Database, ownerId: string) {
  return database.transaction(() => {
    const active = database.prepare(`
      SELECT COUNT(*) AS count FROM transfer_jobs
      WHERE owner_id = ? AND state NOT IN ('completed', 'failed', 'cancelled')
    `).get(ownerId) as { count: number }
    if (active.count) return undefined
    return database.prepare('DELETE FROM transfer_jobs WHERE owner_id = ?').run(ownerId).changes
  })()
}
