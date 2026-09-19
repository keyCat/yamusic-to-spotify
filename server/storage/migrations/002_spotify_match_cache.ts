export const spotifyMatchCacheMigration = `
CREATE TABLE IF NOT EXISTS spotify_match_cache (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_connection_id TEXT NOT NULL REFERENCES account_connections(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  track_identity TEXT NOT NULL,
  candidates TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, destination_connection_id, market, track_identity)
);

CREATE INDEX IF NOT EXISTS idx_spotify_match_cache_expiry
ON spotify_match_cache(expires_at);
`
