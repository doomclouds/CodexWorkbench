import type {
  BoardReviewSource,
  BoardReviewTarget,
  BoardSuggestion,
  BoardSuggestionCommandReceipt,
  BoardSuggestionOptionRecord,
  BoardSuggestionQueries,
  BoardSuggestionWriter,
  StoredBoardSuggestion,
} from '../../modules/whiteboard/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../platform/index.js';
import { readBoardAccess } from './authorization/index.js';
import {
  decodeJson,
  storedArray,
  storedDecimalVersion,
  storedNumber,
  storedRecord,
  storedSqliteBool,
  storedText,
  storedVersion,
} from './stored-values.js';

export const boardSuggestionsSchema = `
  CREATE TABLE IF NOT EXISTS board_review_sources (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    owner_actor_id TEXT NOT NULL,
    board_revision INTEGER NOT NULL CHECK (board_revision >= 0),
    object_ids_json TEXT NOT NULL CHECK (json_valid(object_ids_json)),
    feedback_thread_id TEXT,
    PRIMARY KEY (board_id, source_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS board_review_target_snapshots (
    board_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    targets_board_revision INTEGER NOT NULL CHECK (targets_board_revision >= 0),
    targets_json TEXT NOT NULL CHECK (json_valid(targets_json)),
    PRIMARY KEY (board_id, source_id),
    FOREIGN KEY (board_id, source_id)
      REFERENCES board_review_sources (board_id, source_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE IF NOT EXISTS board_suggestions (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    proposal_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    owner_actor_id TEXT NOT NULL,
    observation TEXT NOT NULL,
    proposal_version INTEGER NOT NULL DEFAULT 0 CHECK (proposal_version >= 0),
    created_at_millis INTEGER NOT NULL,
    expires_at_millis INTEGER NOT NULL,
    accepted_option_id TEXT,
    accepted_board_revision INTEGER,
    rejected INTEGER NOT NULL DEFAULT 0 CHECK (rejected IN (0, 1)),
    PRIMARY KEY (board_id, proposal_id),
    FOREIGN KEY (board_id, source_id)
      REFERENCES board_review_sources (board_id, source_id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX IF NOT EXISTS board_suggestions_feed
    ON board_suggestions (board_id, created_at_millis DESC, proposal_id DESC);
  CREATE TABLE IF NOT EXISTS board_suggestion_options (
    board_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    option_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    edit_kind TEXT NOT NULL CHECK (edit_kind IN ('geometry', 'content')),
    edit_bytes BLOB NOT NULL,
    edit_fingerprint TEXT NOT NULL,
    planned_fingerprint TEXT NOT NULL,
    PRIMARY KEY (board_id, proposal_id, option_id),
    UNIQUE (board_id, proposal_id, position),
    FOREIGN KEY (board_id, proposal_id)
      REFERENCES board_suggestions (board_id, proposal_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE IF NOT EXISTS board_suggestion_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('source', 'submit', 'reject')),
    target_id TEXT NOT NULL,
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;

function optionalText(value: unknown, field: string): string | undefined {
  return value === null ? undefined : storedText(value, field);
}

function decodeReviewTarget(value: unknown): BoardReviewTarget {
  const { objectId, kind, geometryVersion, payloadVersion, geometry } = storedRecord(
    value,
    'review_target',
  );
  const { x, y, width, height, rotation } = storedRecord(geometry, 'review_target_geometry');

  return {
    objectId: storedText(objectId, 'object_id'),
    kind: storedText(kind, 'kind'),
    geometryVersion: storedDecimalVersion(geometryVersion, 'geometry_version'),
    payloadVersion:
      payloadVersion === undefined
        ? undefined
        : storedDecimalVersion(payloadVersion, 'payload_version'),
    geometry: {
      x: storedNumber(x, 'x'),
      y: storedNumber(y, 'y'),
      width: storedNumber(width, 'width'),
      height: storedNumber(height, 'height'),
      rotation: storedNumber(rotation, 'rotation'),
    },
  };
}

function readSource(
  connection: SqliteConnection,
  boardId: string,
  sourceId: string,
): BoardReviewSource | undefined {
  const query = connection.prepare(`
    SELECT sources.*, snapshots.targets_board_revision, snapshots.targets_json
    FROM board_review_sources AS sources
    LEFT JOIN board_review_target_snapshots AS snapshots USING (board_id, source_id)
    WHERE sources.board_id = ? AND sources.source_id = ?
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, sourceId);
  if (!row) {
    return undefined;
  }

  return {
    boardId,
    sourceId,
    ownerActorId: storedText(row.owner_actor_id, 'owner_actor_id'),
    capturedBoardRevision: storedVersion(row.board_revision, 'board_revision'),
    objectIds: storedArray(
      decodeJson(row.object_ids_json, 'object_ids_json'),
      'object_ids_json',
    ).map((id) => storedText(id, 'object_id')),
    feedbackThreadId: optionalText(row.feedback_thread_id, 'feedback_thread_id'),
    targets:
      row.targets_json === null
        ? []
        : storedArray(decodeJson(row.targets_json, 'targets_json'), 'targets_json').map(
            decodeReviewTarget,
          ),
    targetsBoardRevision:
      row.targets_board_revision === null
        ? undefined
        : storedVersion(row.targets_board_revision, 'targets_board_revision'),
  };
}

function metadataFromRow(row: SqliteRow) {
  return {
    proposalId: storedText(row.proposal_id, 'proposal_id'),
    sourceId: storedText(row.source_id, 'source_id'),
    observation: storedText(row.observation, 'observation'),
    proposalVersion: storedVersion(row.proposal_version, 'proposal_version'),
    expiresAtMillis: storedVersion(row.expires_at_millis, 'expires_at_millis'),
    acceptedOptionId: optionalText(row.accepted_option_id, 'accepted_option_id'),
    acceptedBoardRevision:
      row.accepted_board_revision === null
        ? undefined
        : storedVersion(row.accepted_board_revision, 'accepted_board_revision'),
    rejected: storedSqliteBool(row.rejected, 'rejected'),
  };
}

function optionMetadata(row: SqliteRow) {
  return {
    optionId: storedText(row.option_id, 'option_id'),
    label: storedText(row.label, 'label'),
    description: optionalText(row.description, 'description'),
  };
}

function decodeOption(row: SqliteRow): BoardSuggestionOptionRecord {
  const kind = storedText(row.edit_kind, 'edit_kind');
  const bytes = row.edit_bytes;
  if ((kind !== 'geometry' && kind !== 'content') || !(bytes instanceof Uint8Array)) {
    throw new Error('A saved board suggestion option has an invalid typed edit.');
  }

  return {
    ...optionMetadata(row),
    edit: { kind, bytes },
    editFingerprint: storedText(row.edit_fingerprint, 'edit_fingerprint'),
    plannedFingerprint: storedText(row.planned_fingerprint, 'planned_fingerprint'),
  };
}

function readProposal(
  connection: SqliteConnection,
  boardId: string,
  proposalId: string,
): StoredBoardSuggestion | undefined {
  const query = connection.prepare(`
    SELECT * FROM board_suggestions WHERE board_id = ? AND proposal_id = ?
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, proposalId);
  if (!row) {
    return undefined;
  }

  const options = connection
    .prepare(
      `SELECT * FROM board_suggestion_options WHERE board_id = ? AND proposal_id = ? ORDER BY position`,
    )
    .all(boardId, proposalId)
    .map(decodeOption);

  return {
    ...metadataFromRow(row),
    boardId,
    ownerActorId: storedText(row.owner_actor_id, 'owner_actor_id'),
    createdAtMillis: storedVersion(row.created_at_millis, 'created_at_millis'),
    options,
  };
}

function listProposals(
  connection: SqliteConnection,
  boardId: string,
  nowMillis: bigint,
  limit: number,
  beforeProposalId?: string,
): readonly BoardSuggestion[] {
  const query = connection.prepare(`
    SELECT * FROM board_suggestions
    WHERE board_id = ? AND expires_at_millis > ?
      AND (? IS NULL OR (created_at_millis, proposal_id) <
        (SELECT created_at_millis, proposal_id FROM board_suggestions
          WHERE board_id = ? AND proposal_id = ?))
    ORDER BY created_at_millis DESC, proposal_id DESC LIMIT ?
  `);
  query.setReadBigInts(true);
  const cursor = beforeProposalId ?? null;
  const rows = query.all(boardId, nowMillis, cursor, boardId, cursor, limit);
  const options = connection.prepare(`
    SELECT option_id, label, description FROM board_suggestion_options
    WHERE board_id = ? AND proposal_id = ? ORDER BY position
  `);

  return rows.map((row) => {
    const proposal = metadataFromRow(row);

    return {
      ...proposal,
      options: options.all(boardId, proposal.proposalId).map(optionMetadata),
    };
  });
}

function readReceipt(
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
  commandId: string,
): BoardSuggestionCommandReceipt | undefined {
  const row = connection
    .prepare(`
    SELECT signature, kind, target_id FROM board_suggestion_receipts
    WHERE board_id = ? AND actor_id = ? AND command_id = ?
  `)
    .get(boardId, actorId, commandId);

  if (!row) {
    return undefined;
  }

  const kind = storedText(row.kind, 'kind');
  if (kind !== 'source' && kind !== 'submit' && kind !== 'reject') {
    throw new Error('A saved board suggestion receipt has an invalid action.');
  }

  return {
    kind,
    signature: storedText(row.signature, 'signature'),
    targetId: storedText(row.target_id, 'target_id'),
  };
}

export function createSuggestionQueries(connection: SqliteConnection): BoardSuggestionQueries {
  return {
    canReviewBoard(boardId, actorId) {
      const access = readBoardAccess(connection, boardId, actorId);

      return access?.isOwner === true && access.canEdit;
    },
    getReviewSource: (boardId, sourceId) => readSource(connection, boardId, sourceId),
    getSuggestion: (boardId, proposalId) => readProposal(connection, boardId, proposalId),
    listSuggestions: (boardId, now, limit, cursor) =>
      listProposals(connection, boardId, now, limit, cursor),
    getSuggestionReceipt: (boardId, actorId, commandId) =>
      readReceipt(connection, boardId, actorId, commandId),
  };
}

function insertSource(connection: SqliteConnection, source: BoardReviewSource): void {
  connection
    .prepare(`
      INSERT INTO board_review_sources (
        board_id, source_id, owner_actor_id, board_revision, object_ids_json, feedback_thread_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      source.boardId,
      source.sourceId,
      source.ownerActorId,
      source.capturedBoardRevision,
      JSON.stringify(source.objectIds),
      source.feedbackThreadId ?? null,
    );

  if (source.targetsBoardRevision === undefined) {
    throw new Error('A new board review source requires a frozen target revision.');
  }

  const targets = JSON.stringify(source.targets, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  connection
    .prepare(`
      INSERT INTO board_review_target_snapshots (
        board_id, source_id, targets_board_revision, targets_json
      ) VALUES (?, ?, ?, ?)
    `)
    .run(source.boardId, source.sourceId, source.targetsBoardRevision, targets);
}

function insertOptions(connection: SqliteConnection, proposal: StoredBoardSuggestion): void {
  const insert = connection.prepare(`
    INSERT INTO board_suggestion_options (
      board_id, proposal_id, option_id, position, label, description,
      edit_kind, edit_bytes, edit_fingerprint, planned_fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [position, option] of proposal.options.entries()) {
    insert.run(
      proposal.boardId,
      proposal.proposalId,
      option.optionId,
      position,
      option.label,
      option.description ?? null,
      option.edit.kind,
      option.edit.bytes,
      option.editFingerprint,
      option.plannedFingerprint,
    );
  }
}

function insertProposal(connection: SqliteConnection, proposal: StoredBoardSuggestion): void {
  connection
    .prepare(`
      INSERT INTO board_suggestions (
        board_id, proposal_id, source_id, owner_actor_id, observation,
        created_at_millis, expires_at_millis
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      proposal.boardId,
      proposal.proposalId,
      proposal.sourceId,
      proposal.ownerActorId,
      proposal.observation,
      proposal.createdAtMillis,
      proposal.expiresAtMillis,
    );
  insertOptions(connection, proposal);
}

function updateProposal(connection: SqliteConnection, proposal: StoredBoardSuggestion): void {
  const update = connection.prepare(`
    UPDATE board_suggestions
    SET proposal_version = ?, accepted_option_id = ?, accepted_board_revision = ?, rejected = ?
    WHERE board_id = ? AND proposal_id = ? AND proposal_version = ?
  `);
  const result = update.run(
    proposal.proposalVersion,
    proposal.acceptedOptionId ?? null,
    proposal.acceptedBoardRevision ?? null,
    Number(proposal.rejected),
    proposal.boardId,
    proposal.proposalId,
    proposal.proposalVersion - 1n,
  );

  if (Number(result.changes) !== 1) {
    throw new Error('The whiteboard suggestion state changed before it could be saved.');
  }
}

type SuggestionMutations = Pick<
  BoardSuggestionWriter,
  'createReviewSource' | 'createSuggestion' | 'decideSuggestion' | 'saveSuggestionReceipt'
>;

export function createSuggestionMutations(connection: SqliteConnection): SuggestionMutations {
  return {
    createReviewSource: (source) => insertSource(connection, source),
    createSuggestion: (proposal) => insertProposal(connection, proposal),
    decideSuggestion: (proposal) => updateProposal(connection, proposal),
    saveSuggestionReceipt(boardId, actorId, commandId, receipt) {
      connection
        .prepare(`
          INSERT INTO board_suggestion_receipts (
            board_id, actor_id, command_id, signature, kind, target_id
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(boardId, actorId, commandId, receipt.signature, receipt.kind, receipt.targetId);
    },
  };
}
