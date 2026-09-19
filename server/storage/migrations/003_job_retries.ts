export const jobRetryMigration = `
ALTER TABLE transfer_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transfer_jobs ADD COLUMN next_attempt_at TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_next_attempt
ON transfer_jobs(state, next_attempt_at);
`
