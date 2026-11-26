export const whiteboardSchema = `
  CREATE TABLE IF NOT EXISTS boards (
    board_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_members (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    can_edit INTEGER NOT NULL CHECK (can_edit IN (0, 1)),
    PRIMARY KEY (board_id, actor_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_objects (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    object_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    layer_index INTEGER NOT NULL DEFAULT 0,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL CHECK (width >= 0),
    height REAL NOT NULL CHECK (height >= 0),
    rotation REAL NOT NULL DEFAULT 0,
    geometry_version INTEGER NOT NULL DEFAULT 0 CHECK (geometry_version >= 0),
    locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    parent_id TEXT,
    group_id TEXT,
    appearance_json TEXT CHECK (json_valid(appearance_json)),
    detail_json TEXT CHECK (json_valid(detail_json)),
    PRIMARY KEY (board_id, object_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS board_objects_layer
    ON board_objects (board_id, layer_index, object_id);
  CREATE INDEX IF NOT EXISTS board_objects_group
    ON board_objects (board_id, group_id, layer_index, object_id);
  CREATE INDEX IF NOT EXISTS board_objects_parent
    ON board_objects (board_id, parent_id, layer_index, object_id);

  CREATE TABLE IF NOT EXISTS object_payloads (
    board_id TEXT NOT NULL,
    object_id TEXT NOT NULL,
    payload_version INTEGER NOT NULL CHECK (payload_version >= 0),
    body_kind TEXT NOT NULL,
    body_json TEXT NOT NULL CHECK (json_valid(body_json)),
    PRIMARY KEY (board_id, object_id),
    FOREIGN KEY (board_id, object_id) REFERENCES board_objects (board_id, object_id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS object_payloads_versions
    ON object_payloads (board_id, object_id, payload_version);

  CREATE TABLE IF NOT EXISTS command_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;
