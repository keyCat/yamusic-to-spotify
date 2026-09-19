import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { initialMigration } from './migrations/001_initial'
import { spotifyMatchCacheMigration } from './migrations/002_spotify_match_cache'
import { jobRetryMigration } from './migrations/003_job_retries'
import { sourceReferenceMigration } from './migrations/004_source_reference'

type DatabaseState = { database?: Database.Database, migrationVersion?: number }
const state = globalThis as typeof globalThis & DatabaseState
const currentMigrationVersion = 4

export function getDatabase(dataDir: string) {
  if (state.database && state.migrationVersion === currentMigrationVersion) return state.database

  const absoluteDataDir = resolve(dataDir)
  mkdirSync(absoluteDataDir, { recursive: true, mode: 0o700 })

  const database = state.database || new Database(resolve(absoluteDataDir, 'application.sqlite'))
  if (!state.database) {
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.pragma('busy_timeout = 5000')
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const migrations = [
    { version: 1, sql: initialMigration },
    { version: 2, sql: spotifyMatchCacheMigration },
    { version: 3, sql: jobRetryMigration },
    { version: 4, sql: sourceReferenceMigration },
  ]
  for (const migration of migrations) {
    const migrationExists = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version)
    if (migrationExists) continue
    database.transaction(() => {
      database.exec(migration.sql)
      database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString())
    })()
  }

  database.pragma('optimize')
  state.database = database
  state.migrationVersion = currentMigrationVersion
  return database
}

export function closeDatabase() {
  state.database?.close()
  state.database = undefined
  state.migrationVersion = undefined
}
