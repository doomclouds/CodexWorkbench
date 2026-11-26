export const catalogSchema = `
  CREATE TABLE IF NOT EXISTS catalog_entries (
    board_id TEXT PRIMARY KEY REFERENCES boards (board_id) ON DELETE CASCADE,
    updated_at_millis INTEGER NOT NULL CHECK (updated_at_millis >= 0),
    pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
    entry_version INTEGER NOT NULL CHECK (entry_version >= 0)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS catalog_create_receipts (
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    board_id TEXT NOT NULL,
    title TEXT NOT NULL,
    updated_at_millis INTEGER NOT NULL CHECK (updated_at_millis >= 0),
    pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
    entry_version INTEGER NOT NULL CHECK (entry_version >= 0),
    PRIMARY KEY (actor_id, command_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS catalog_members_by_actor
    ON board_members (actor_id, board_id);

  CREATE TRIGGER IF NOT EXISTS catalog_track_board_edit
  AFTER UPDATE OF revision ON boards
  WHEN NEW.revision > OLD.revision
  BEGIN
    INSERT INTO catalog_entries (board_id, updated_at_millis, pinned, entry_version)
    VALUES (NEW.board_id, CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER), 0, 0)
    ON CONFLICT (board_id) DO UPDATE SET updated_at_millis =
      MAX(catalog_entries.updated_at_millis, excluded.updated_at_millis);
  END;
`;
