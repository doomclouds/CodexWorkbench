export const archiveSchema = `
  CREATE TABLE IF NOT EXISTS archive_import_receipts (
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    board_id TEXT,
    title TEXT,
    rejection_reason TEXT,
    CHECK (
      (board_id IS NOT NULL AND title IS NOT NULL AND rejection_reason IS NULL) OR
      (board_id IS NULL AND title IS NULL AND rejection_reason IS NOT NULL)
    ),
    PRIMARY KEY (actor_id, command_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_archive_assets (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY (board_id, asset_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_archive_source_chunks (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    bytes BLOB NOT NULL,
    PRIMARY KEY (board_id, chunk_index)
  ) STRICT;
`;
