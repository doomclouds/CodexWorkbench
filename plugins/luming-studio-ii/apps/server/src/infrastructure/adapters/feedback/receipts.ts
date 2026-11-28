import type {
  FeedbackOutcome,
  FeedbackRejectionReason,
  FeedbackStoredReceipt,
} from '../../../modules/feedback/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../../platform/index.js';
import { readBool, readOptionalUnsigned, readText, readUnsigned } from './stored-values.js';

function readRejection(value: unknown): FeedbackRejectionReason {
  switch (value) {
    case 'invalidText':
    case 'invalidAnchor':
    case 'targetChanged':
    case 'notFound':
    case 'forbidden':
    case 'versionChanged':
    case 'commandIdReuse':
    case 'attachmentClaimed':
      return value;
    default:
      throw new Error('Invalid stored feedback rejection.');
  }
}

function readOutcome(row: SqliteRow): FeedbackOutcome {
  if (row.result_kind === 'applied') {
    return {
      kind: 'applied',
      threadId: readText(row.thread_id, 'thread_id'),
      threadVersion: readUnsigned(row.thread_version, 'thread_version'),
      messageId: row.message_id === null ? undefined : readText(row.message_id, 'message_id'),
      messageVersion: readOptionalUnsigned(row.message_version, 'message_version'),
      deleted: readBool(row.deleted, 'deleted'),
    };
  }
  if (row.result_kind === 'rejected') {
    return {
      kind: 'rejected',
      reason: readRejection(row.reason),
      currentVersion: readOptionalUnsigned(row.current_version, 'current_version'),
    };
  }

  throw new Error('Invalid stored feedback receipt.');
}

export function getReceipt(
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
  commandId: string,
): FeedbackStoredReceipt | undefined {
  const statement = connection.prepare(`
    SELECT signature, result_kind, thread_id, thread_version, message_id, message_version,
      deleted, reason, current_version
    FROM feedback_command_receipts
    WHERE board_id = ? AND actor_id = ? AND command_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(boardId, actorId, commandId);
  if (!row) {
    return undefined;
  }

  return {
    signature: readText(row.signature, 'signature'),
    receipt: { boardId, commandId, outcome: readOutcome(row) },
  };
}

export function saveReceipt(
  connection: SqliteConnection,
  actorId: string,
  stored: FeedbackStoredReceipt,
): void {
  const { signature, receipt } = stored;
  const { boardId, commandId, outcome } = receipt;
  const fields =
    outcome.kind === 'applied'
      ? [
          outcome.threadId,
          outcome.threadVersion,
          outcome.messageId ?? null,
          outcome.messageVersion ?? null,
          Number(outcome.deleted),
          null,
          null,
        ]
      : [null, null, null, null, null, outcome.reason, outcome.currentVersion ?? null];
  connection
    .prepare(`
      INSERT INTO feedback_command_receipts (
        board_id, actor_id, command_id, signature, result_kind, thread_id, thread_version,
        message_id, message_version, deleted, reason, current_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(boardId, actorId, commandId, signature, outcome.kind, ...fields);
}
