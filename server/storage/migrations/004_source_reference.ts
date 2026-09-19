export const sourceReferenceMigration = `
ALTER TABLE source_playlists ADD COLUMN source_type TEXT;
ALTER TABLE source_playlists ADD COLUMN source_reference TEXT;
`
