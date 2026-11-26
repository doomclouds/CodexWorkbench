import type {
  ArchiveImportCommand,
  ArchiveImportPort,
  ArchiveImportReceipt,
  ArchiveImportRejectionReason,
} from '../../../modules/archives/ports/index.js';
import {
  ArchiveReadError,
  stageCurrentArchive,
  type StagedCurrentArchive,
} from '../../platform/archives/index.js';
import type { SqliteConnection, SqliteDatabase } from '../../platform/index.js';
import {
  preparePublication,
  readPublishedAsset,
  writePublication,
  type ArchivePublication,
} from './publication.js';
import { ArchiveObjectError } from './scene.js';
import { archiveSchema } from './schema.js';

interface StoredReceipt {
  readonly signature: string;
  readonly receipt: ArchiveImportReceipt;
}

const rejectionReasons: ReadonlySet<unknown> = new Set<ArchiveImportRejectionReason>([
  'invalidArchive',
  'unsupportedVersion',
  'incompatibleContent',
  'commandIdReuse',
  'tooLarge',
]);

function rejected(commandId: string, reason: ArchiveImportRejectionReason): ArchiveImportReceipt {
  return { commandId, outcome: { kind: 'rejected', reason } };
}

function isRejectionReason(value: unknown): value is ArchiveImportRejectionReason {
  return rejectionReasons.has(value);
}

function readReceipt(
  connection: SqliteConnection,
  actorId: string,
  commandId: string,
): StoredReceipt | undefined {
  const row = connection
    .prepare(`
    SELECT signature, board_id, title, rejection_reason
    FROM archive_import_receipts
    WHERE actor_id = ? AND command_id = ?
  `)
    .get(actorId, commandId);

  if (!row) {
    return undefined;
  }

  const { signature, board_id: boardId, title, rejection_reason: reason } = row;
  if (typeof signature !== 'string') {
    throw new Error('Invalid archive import signature.');
  }
  if (typeof boardId === 'string' && typeof title === 'string') {
    return { signature, receipt: { commandId, outcome: { kind: 'imported', boardId, title } } };
  }
  if (!isRejectionReason(reason)) {
    throw new Error('Invalid archive import rejection.');
  }

  return { signature, receipt: rejected(commandId, reason) };
}

function writeReceipt(
  connection: SqliteConnection,
  actorId: string,
  signature: string,
  receipt: ArchiveImportReceipt,
): ArchiveImportReceipt {
  const { commandId, outcome } = receipt;
  const imported = outcome.kind === 'imported' ? outcome : undefined;
  const reason = outcome.kind === 'rejected' ? outcome.reason : null;
  connection
    .prepare(`
    INSERT INTO archive_import_receipts (
      actor_id, command_id, signature, board_id, title, rejection_reason
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
    .run(actorId, commandId, signature, imported?.boardId ?? null, imported?.title ?? null, reason);

  return receipt;
}

function replayReceipt(
  connection: SqliteConnection,
  command: ArchiveImportCommand,
  signature: string,
): ArchiveImportReceipt | undefined {
  const existing = readReceipt(connection, command.actorId, command.commandId);
  if (!existing) {
    return undefined;
  }

  return existing.signature === signature
    ? existing.receipt
    : rejected(command.commandId, 'commandIdReuse');
}

function publishArchive(
  connection: SqliteConnection,
  command: ArchiveImportCommand,
  archive: StagedCurrentArchive,
): ArchiveImportReceipt {
  const { actorId, boardId, commandId } = command;
  const { signature, title } = archive;
  const replay = replayReceipt(connection, command, signature);
  if (replay) {
    return replay;
  }

  let publication: ArchivePublication;
  try {
    publication = preparePublication(archive, boardId);
  } catch (error) {
    if (!(error instanceof ArchiveObjectError)) {
      throw error;
    }

    return writeReceipt(connection, actorId, signature, rejected(commandId, 'incompatibleContent'));
  }

  writePublication(connection, command, archive, publication);
  return writeReceipt(connection, actorId, signature, {
    commandId,
    outcome: { kind: 'imported', boardId, title },
  });
}

function recordReadRejection(
  database: SqliteDatabase,
  command: ArchiveImportCommand,
  error: ArchiveReadError,
): ArchiveImportReceipt {
  const { signature } = error;
  const receipt = rejected(command.commandId, error.code);
  if (signature === undefined) {
    return receipt;
  }

  return database.write(
    (connection) =>
      replayReceipt(connection, command, signature) ??
      writeReceipt(connection, command.actorId, signature, receipt),
  );
}

async function importCurrent(
  database: SqliteDatabase,
  command: ArchiveImportCommand,
): Promise<ArchiveImportReceipt> {
  let archive: StagedCurrentArchive;
  try {
    archive = await stageCurrentArchive(command.chunks);
  } catch (error) {
    if (!(error instanceof ArchiveReadError)) {
      throw error;
    }

    return recordReadRejection(database, command, error);
  }

  try {
    return database.write((connection) => publishArchive(connection, command, archive));
  } finally {
    await archive.dispose();
  }
}

export function createArchiveImportRepository(database: SqliteDatabase): ArchiveImportPort {
  database.write((connection) => connection.exec(archiveSchema));

  return {
    importCurrent: (command) => importCurrent(database, command),
    getReceipt: (actorId, commandId) =>
      database.read((connection) => readReceipt(connection, actorId, commandId)?.receipt),
    getAsset: (actorId, boardId, assetId) =>
      database.read((connection) => readPublishedAsset(connection, actorId, boardId, assetId)),
  };
}
