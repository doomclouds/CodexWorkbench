import {
  backupElement,
  BackupElementError,
  exportFilename,
  maxExportFileBytes,
  type Actor,
  type BoardBackupArchive,
  type BoardBackupMetadata,
  type BoardExportAsset,
  type BoardExportRejection,
  type BoardExportStale,
  type BoardHeader,
  type BoardObject,
  type BoardVersionSummary,
  type ExportBoardFileCommand,
  type ExportBoardResult,
  type PayloadRecord,
} from '../domain/index.js';
import type { BoardEditReader, BoardEditRepository } from '../ports/index.js';
import { WhiteboardAccessError } from './board-read.js';

type BackupEncoder = (
  snapshot: BoardBackupArchive,
  maximumBytes: number,
) => Promise<Uint8Array | undefined>;
type BackupSnapshot = { readonly archive: BoardBackupArchive; readonly board: BoardHeader };
type CapturedBackup = BackupSnapshot | BoardExportStale | BoardExportRejection;
type Element = Readonly<Record<string, unknown>>;
type FormatTime = (value: number) => string;

const maxVersions = 200;
const maxObjects = 4_000;
const maxStoredPayload = 32n * 1024n * 1024n;
const maxAssetBytes = 20 * 1024 * 1024;
const portableId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const assetPrefix = '/studio-archive-assets/';

class BackupError extends Error {
  constructor(readonly reason: BoardExportRejection['reason']) {
    super('Could not compose the whiteboard archive.');
  }
}

function requireOwner(reader: BoardEditReader, actor: Actor, boardId: string): BoardBackupMetadata {
  const metadata = reader.getBackupMetadata?.(boardId, actor.id);
  if (!metadata) {
    throw new WhiteboardAccessError();
  }

  return metadata;
}

function numericVersion(value: bigint) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new BackupError('unsupported');
  }

  return version;
}

function timeString(value: number | undefined, formatTime: FormatTime) {
  return value === undefined ? undefined : formatTime(value);
}

function artifact(
  board: BoardHeader,
  metadata: BoardBackupMetadata,
  formatTime: FormatTime,
  version?: BoardVersionSummary,
) {
  return {
    id: board.boardId,
    title: version?.title ?? board.title,
    type: 'whiteboard',
    revision: numericVersion(version?.revision ?? board.revision),
    createdAt: timeString(metadata.createdAtMillis, formatTime),
    updatedAt: timeString(version?.savedAtMillis ?? metadata.updatedAtMillis, formatTime),
    pinned: metadata.pinned,
    sharing: false,
  };
}

function historyEntry(version: BoardVersionSummary, formatTime: FormatTime) {
  const { actorId, revision, savedAtMillis, kind, sourceRevision, changedObjectCount } = version;

  return {
    id: 'revision-' + revision,
    revision: numericVersion(revision),
    createdAt: timeString(savedAtMillis, formatTime),
    actor: actorId ? { id: actorId, name: actorId } : undefined,
    summary: kind,
    changedIds: [],
    changedObjectCount,
    restoredFrom: sourceRevision !== undefined ? 'revision-' + sourceRevision : undefined,
  };
}

function payloadKey(objectId: string, payloadVersion: bigint) {
  return objectId + ':' + payloadVersion;
}

class BackupCapture {
  readonly assets = new Map<string, BoardExportAsset>();
  private readonly payloads = new Map<string, PayloadRecord>();
  private readonly objects = new Map<string, Element>();
  private remainingPayload = maxStoredPayload;
  private remainingAssets = maxAssetBytes;

  constructor(
    private readonly reader: BoardEditReader,
    private readonly boardId: string,
  ) {}

  private readAsset(source: string): string {
    const prefix = assetPrefix + this.boardId + '/';
    const assetId = source.slice(prefix.length);
    if (!source.startsWith(prefix) || !portableId.test(assetId)) {
      throw new BackupError('assetUnavailable');
    }

    if (!this.assets.has(assetId)) {
      const media = this.reader.getExportAsset?.(this.boardId, assetId, this.remainingAssets);
      if (!media) {
        throw new BackupError('assetUnavailable');
      }
      if (media.kind === 'tooLarge' || media.asset.byteLength > this.remainingAssets) {
        throw new BackupError('tooLarge');
      }

      this.remainingAssets -= media.asset.byteLength;
      this.assets.set(assetId, media.asset);
    }

    return '/assets/' + this.boardId + '/' + assetId;
  }

  private readPayloads(objects: readonly BoardObject[], revision?: bigint) {
    const missing = objects.flatMap(({ objectId, payloadVersion }) => {
      const cached =
        payloadVersion === undefined || this.payloads.has(payloadKey(objectId, payloadVersion));

      return cached ? [] : [objectId];
    });

    if (!missing.length) {
      return;
    }

    const size = this.reader.payloadByteSize?.(this.boardId, missing, revision) ?? 0n;
    if (size > this.remainingPayload) {
      throw new BackupError('tooLarge');
    }

    this.remainingPayload -= size;
    const loaded =
      revision === undefined
        ? this.reader.getPayloads(this.boardId, missing)
        : this.reader.getVersionPayloads(this.boardId, revision, missing);

    for (const payload of loaded) {
      this.payloads.set(payloadKey(payload.objectId, payload.payloadVersion), payload);
    }
  }

  private encodeObject(object: BoardObject) {
    if (!portableId.test(object.objectId)) {
      throw new BackupError('unsupported');
    }

    const { objectId, geometryVersion, payloadVersion } = object;
    const key = objectId + ':' + geometryVersion + ':' + String(payloadVersion);
    const existing = this.objects.get(key);
    if (existing) {
      return existing;
    }

    const payload =
      payloadVersion === undefined
        ? undefined
        : this.payloads.get(payloadKey(objectId, payloadVersion));

    if (!payload && payloadVersion !== undefined) {
      throw new BackupError('unsupported');
    }

    const element = backupElement(object, payload, (source) => this.readAsset(source));
    if (!element) {
      throw new BackupError('unsupported');
    }

    this.objects.set(key, element);

    return element;
  }

  elements(objects: readonly BoardObject[], revision?: bigint) {
    if (objects.length > maxObjects) {
      throw new BackupError('tooLarge');
    }

    this.readPayloads(objects, revision);

    return objects.map((object) => this.encodeObject(object));
  }
}

function capture(
  reader: BoardEditReader,
  actor: Actor,
  command: ExportBoardFileCommand,
  formatTime: FormatTime,
): CapturedBackup {
  const { boardId, expectedRevision, scope } = command;
  const metadata = requireOwner(reader, actor, boardId);
  const board = reader.getBoard(boardId);
  if (!board) {
    throw new WhiteboardAccessError();
  }
  if (board.revision !== expectedRevision) {
    return { kind: 'stale', revision: board.revision };
  }
  if (scope.kind !== 'whole') {
    return { kind: 'rejected', reason: 'invalidSelection' };
  }

  const builder = new BackupCapture(reader, boardId);
  const elements = builder.elements(reader.listObjects(boardId, maxObjects + 1));
  const history = [...reader.listVersions(boardId, undefined, maxVersions)]
    .reverse()
    .map((version) => ({
      entry: historyEntry(version, formatTime),
      artifact: artifact(board, metadata, formatTime, version),
      elements:
        version.revision === board.revision
          ? elements
          : builder.elements(
              reader.listVersionObjects(boardId, version.revision),
              version.revision,
            ),
    }));
  const assetIndex = Object.fromEntries(
    [...builder.assets].map(([id, asset]) => [
      id,
      { id, filename: id, size: asset.byteLength, mimeType: asset.mimeType },
    ]),
  );
  const properties = {
    schemaVersion: 2,
    artifact: artifact(board, metadata, formatTime),
    feedback: [],
    sources: {},
    operations: [],
    sharing: { enabled: false, generation: 0, tokens: {} },
    assets: assetIndex,
  };

  return { board, archive: { boardId, properties, elements, history, assets: builder.assets } };
}

export function createBoardBackup(
  repository: BoardEditRepository,
  encode: BackupEncoder,
  formatTime: FormatTime,
) {
  return async (actor: Actor, command: ExportBoardFileCommand): Promise<ExportBoardResult> => {
    try {
      const snapshot = repository.read((reader) => capture(reader, actor, command, formatTime));
      if ('kind' in snapshot) {
        return snapshot;
      }

      const content = await encode(snapshot.archive, maxExportFileBytes);
      if (!content?.byteLength) {
        return { kind: 'rejected', reason: 'tooLarge' };
      }

      repository.read((reader) => requireOwner(reader, actor, command.boardId));

      return {
        kind: 'file',
        filename: exportFilename(snapshot.board.title, 'studio.zip'),
        mimeType: 'application/zip',
        revision: snapshot.board.revision,
        content,
      };
    } catch (error) {
      if (error instanceof BackupError || error instanceof BackupElementError) {
        return { kind: 'rejected', reason: error.reason };
      }

      throw error;
    }
  };
}
