import type Database from 'better-sqlite3'

export function cleanupExpiredData(database: Database.Database) {
  const now = new Date()
  const terminalCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  return database.transaction(() => ({
    jobs: database.prepare(`
      DELETE FROM transfer_jobs
      WHERE state IN ('completed', 'failed', 'cancelled') AND updated_at < ?
    `).run(terminalCutoff).changes,
    authorizations: database.prepare('DELETE FROM authorization_requests WHERE expires_at <= ?')
      .run(now.toISOString()).changes,
    sessions: database.prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(now.toISOString()).changes,
    cache: database.prepare('DELETE FROM spotify_match_cache WHERE expires_at <= ?')
      .run(now.toISOString()).changes,
  }))()
}
