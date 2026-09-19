export const initialMigration = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  spotify_id TEXT NOT NULL UNIQUE,
  access_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_connections (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_identity TEXT NOT NULL,
  encrypted_tokens TEXT NOT NULL,
  token_expires_at TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, provider, provider_identity)
);

CREATE TABLE IF NOT EXISTS authorization_requests (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  session_key TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  verifier_encrypted TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_connection_id TEXT REFERENCES account_connections(id) ON DELETE RESTRICT,
  destination_connection_id TEXT NOT NULL REFERENCES account_connections(id) ON DELETE RESTRICT,
  state TEXT NOT NULL,
  previous_active_state TEXT,
  pause_reason TEXT,
  confirmed_plan_hash TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS source_playlists (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES transfer_jobs(id) ON DELETE CASCADE,
  source_identity TEXT NOT NULL,
  revision TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  declared_count INTEGER NOT NULL CHECK(declared_count >= 0),
  UNIQUE(job_id, source_identity)
);

CREATE TABLE IF NOT EXISTS source_entries (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES source_playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position >= 0),
  provider_track_id TEXT NOT NULL,
  original_metadata TEXT NOT NULL,
  availability TEXT NOT NULL,
  UNIQUE(playlist_id, position)
);

CREATE TABLE IF NOT EXISTS match_decisions (
  id TEXT PRIMARY KEY,
  source_entry_id TEXT NOT NULL UNIQUE REFERENCES source_entries(id) ON DELETE CASCADE,
  candidate_uri TEXT,
  evidence TEXT NOT NULL,
  decision TEXT NOT NULL,
  reviewer_status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS destination_playlists (
  id TEXT PRIMARY KEY,
  source_playlist_id TEXT NOT NULL UNIQUE REFERENCES source_playlists(id) ON DELETE CASCADE,
  spotify_id TEXT UNIQUE,
  creation_marker TEXT NOT NULL UNIQUE,
  expected_sequence TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_batches (
  id TEXT PRIMARY KEY,
  destination_id TEXT NOT NULL REFERENCES destination_playlists(id) ON DELETE CASCADE,
  sequence_position INTEGER NOT NULL CHECK(sequence_position >= 0),
  intended_uris TEXT NOT NULL,
  outcome TEXT NOT NULL,
  snapshot_identifier TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(destination_id, sequence_position)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_owner_provider ON account_connections(owner_id, provider);
CREATE INDEX IF NOT EXISTS idx_jobs_owner_state ON transfer_jobs(owner_id, state);
CREATE INDEX IF NOT EXISTS idx_source_entries_playlist ON source_entries(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_batches_destination ON transfer_batches(destination_id, sequence_position);
`
