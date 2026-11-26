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

  CREATE TABLE IF NOT EXISTS catalog_management_receipts (
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
    PRIMARY KEY (actor_id, command_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS catalog_duplicate_sources (
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    source_board_id TEXT NOT NULL,
    PRIMARY KEY (actor_id, command_id),
    FOREIGN KEY (actor_id, command_id)
      REFERENCES catalog_create_receipts (actor_id, command_id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS catalog_members_by_actor
    ON board_members (actor_id, board_id);

  CREATE TRIGGER IF NOT EXISTS catalog_record_created_owner
  AFTER INSERT ON catalog_create_receipts
  BEGIN
    INSERT INTO board_lifecycle (board_id, owner_actor_id)
    VALUES (NEW.board_id, NEW.actor_id);
  END;

  CREATE TRIGGER IF NOT EXISTS catalog_record_imported_owner
  AFTER INSERT ON archive_import_receipts
  WHEN NEW.board_id IS NOT NULL
  BEGIN
    INSERT INTO board_lifecycle (board_id, owner_actor_id)
    VALUES (NEW.board_id, NEW.actor_id);
  END;

  CREATE TRIGGER IF NOT EXISTS catalog_track_board_edit
  AFTER UPDATE OF revision ON boards
  WHEN NEW.revision > OLD.revision
  BEGIN
    INSERT INTO catalog_entries (board_id, updated_at_millis, pinned, entry_version)
    VALUES (NEW.board_id, CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER), 0, 0)
    ON CONFLICT (board_id) DO UPDATE SET updated_at_millis =
      MAX(catalog_entries.updated_at_millis, excluded.updated_at_millis);
  END;

  WITH provenance AS (
    SELECT board_id, actor_id FROM catalog_create_receipts
    UNION
    SELECT board_id, actor_id FROM archive_import_receipts WHERE board_id IS NOT NULL
  ), confirmed_owner AS (
    SELECT board_id, MIN(actor_id) AS actor_id
    FROM provenance
    GROUP BY board_id
    HAVING COUNT(*) = 1
  )
  INSERT INTO board_lifecycle (board_id, owner_actor_id)
  SELECT owner.board_id, owner.actor_id
  FROM confirmed_owner AS owner
  JOIN board_members AS member ON member.board_id = owner.board_id AND member.actor_id = owner.actor_id
  WHERE NOT EXISTS (SELECT 1 FROM board_lifecycle AS lifecycle WHERE lifecycle.board_id = owner.board_id);
`;
