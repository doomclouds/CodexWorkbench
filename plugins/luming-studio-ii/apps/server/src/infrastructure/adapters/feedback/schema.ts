export const feedbackSchema = `
  CREATE TABLE IF NOT EXISTS feedback_threads (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
    source_board_revision INTEGER NOT NULL CHECK (source_board_revision >= 0),
    frozen_x REAL NOT NULL,
    frozen_y REAL NOT NULL,
    object_id TEXT,
    object_u REAL,
    object_v REAL,
    object_geometry_version INTEGER,
    object_kind TEXT,
    object_label TEXT,
    object_x REAL,
    object_y REAL,
    object_width REAL,
    object_height REAL,
    object_rotation REAL,
    version INTEGER NOT NULL CHECK (version >= 1),
    updated_at_millis INTEGER NOT NULL CHECK (updated_at_millis >= 0),
    reply_count INTEGER NOT NULL CHECK (reply_count BETWEEN 0 AND 4294967295),
    PRIMARY KEY (board_id, thread_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS feedback_threads_recent
    ON feedback_threads (board_id, updated_at_millis DESC, thread_id DESC);

  CREATE INDEX IF NOT EXISTS feedback_threads_by_status
    ON feedback_threads (board_id, status, updated_at_millis DESC, thread_id DESC);

  CREATE TABLE IF NOT EXISTS feedback_messages (
    board_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    author_actor_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at_millis INTEGER NOT NULL CHECK (created_at_millis >= 0),
    updated_at_millis INTEGER NOT NULL CHECK (updated_at_millis >= created_at_millis),
    version INTEGER NOT NULL CHECK (version >= 1),
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4294967295),
    CHECK ((position = 0) = (message_id = thread_id)),
    PRIMARY KEY (board_id, thread_id, message_id),
    UNIQUE (board_id, thread_id, position),
    FOREIGN KEY (board_id, thread_id) REFERENCES feedback_threads (board_id, thread_id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS feedback_command_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    result_kind TEXT NOT NULL CHECK (result_kind IN ('applied', 'rejected')),
    thread_id TEXT,
    thread_version INTEGER,
    message_id TEXT,
    message_version INTEGER,
    deleted INTEGER CHECK (deleted IN (0, 1)),
    reason TEXT,
    current_version INTEGER,
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;
