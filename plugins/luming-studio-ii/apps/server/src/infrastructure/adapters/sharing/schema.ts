export const sharingSchema = `
  CREATE TABLE IF NOT EXISTS board_sharing (
    board_id TEXT PRIMARY KEY REFERENCES boards (board_id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    scope TEXT NOT NULL CHECK (scope IN ('local', 'lan')),
    version INTEGER NOT NULL CHECK (version >= 0)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_sharing_invites (
    board_id TEXT NOT NULL REFERENCES board_sharing (board_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    version INTEGER NOT NULL CHECK (version >= 0),
    seed TEXT NOT NULL,
    PRIMARY KEY (board_id, role)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS sharing_browser_sessions (
    token_hash TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL UNIQUE,
    expires_at_millis INTEGER NOT NULL CHECK (expires_at_millis >= 0)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_sharing_members (
    board_id TEXT NOT NULL REFERENCES board_sharing (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES sharing_browser_sessions (actor_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
    invitation_version INTEGER NOT NULL CHECK (invitation_version >= 0),
    removed INTEGER NOT NULL CHECK (removed IN (0, 1)),
    PRIMARY KEY (board_id, actor_id),
    UNIQUE (board_id, name_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_sharing_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 0),
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;
