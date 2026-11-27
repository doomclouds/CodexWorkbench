import {
  backupElement,
  BackupElementError,
  exportFilename,
  legacyBackupFeedback,
  maxBoardBackupAssetBytes,
  maxBoardBackupBytes,
  type Actor,
  type BoardBackupActor,
  type BoardBackupArchive,
  type BoardBackupAsset,
  type BoardBackupMetadata,
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
const maxStoredPayload = 64n * 1024n * 1024n;
const portableId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const assetPrefix = '/studio-archive-assets/';

const legacyStyle = {
  name: 'Diagram',
  paper: '#f5f5f5',
  ink: '#2d3142',
  muted: '#4f5d75',
  accent: '#eb6c36',
  link: '#2e5aa8',
  fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
  titleFont: 'Georgia, "Songti SC", serif',
  monoFont: 'Consolas, monospace',
};

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
    createdAt: formatTime(metadata.createdAtMillis ?? metadata.updatedAtMillis),
    updatedAt: formatTime(version?.savedAtMillis ?? metadata.updatedAtMillis),
    pinned: metadata.pinned,
    sharing: false,
  };
}

const lifecycleSummaries: Partial<Record<BoardVersionSummary['kind'], string>> = {
  trash: '移入回收站',
  restoreTrash: '恢复作品',
};

function historyEntry(
  version: BoardVersionSummary,
  actor: BoardBackupActor,
  metadata: BoardBackupMetadata,
  formatTime: FormatTime,
  changedIds: readonly string[],
) {
  const { actorId, revision, savedAtMillis, kind, sourceRevision, changedObjectCount } = version;
  const lifecycleKind = kind === 'trash' || kind === 'restoreTrash' ? kind : undefined;

  return {
    id: 'revision-' + revision,
    revision: numericVersion(revision),
    createdAt: formatTime(savedAtMillis ?? metadata.createdAtMillis ?? metadata.updatedAtMillis),
    actor,
    summary: lifecycleSummaries[kind] ?? kind,
    changedIds,
    restoredFrom: sourceRevision !== undefined ? 'revision-' + sourceRevision : undefined,
    studioII: {
      actorId,
      savedAtMillis,
      kind: lifecycleKind ? 'content' : kind,
      lifecycleKind,
      sourceRevision: sourceRevision?.toString(),
      changedObjectCount,
    },
  };
}

function payloadKey(objectId: string, payloadVersion: bigint) {
  return objectId + ':' + payloadVersion;
}

class BackupCapture {
  readonly assets = new Map<string, BoardBackupAsset>();
  private readonly payloads = new Map<string, PayloadRecord>();
  private readonly objects = new Map<string, Element>();
  private remainingPayload = maxStoredPayload;
  private remainingAssets = maxBoardBackupBytes;

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
      const limit = Math.min(maxBoardBackupAssetBytes, this.remainingAssets);
      const media = this.reader.getBackupAsset?.(this.boardId, assetId, limit);
      if (!media) {
        throw new BackupError('assetUnavailable');
      }
      if (media.kind === 'tooLarge' || media.asset.bytes.byteLength > limit) {
        throw new BackupError('tooLarge');
      }

      this.remainingAssets -= media.asset.bytes.byteLength;
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

function currentVersion(board: BoardHeader): BoardVersionSummary {
  return {
    revision: board.revision,
    title: board.title,
    kind: 'baseline',
    changedObjectCount: 0,
  };
}

function changedObjectIds(previous: readonly Element[], elements: readonly Element[]) {
  const unchanged = new Set(previous);
  const remaining = new Set(elements);
  return [
    ...new Set([
      ...elements.filter((element) => !unchanged.has(element)).map((element) => String(element.id)),
      ...previous.filter((element) => !remaining.has(element)).map((element) => String(element.id)),
    ]),
  ];
}

function capture(
  reader: BoardEditReader,
  actor: Actor,
  command: ExportBoardFileCommand,
  formatTime: FormatTime,
  ownerName?: string,
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
  const details = reader.getBackupDetails?.(boardId);
  const authors = new Map<string, BoardBackupActor>();
  function author(id: string, role: BoardBackupActor['role'], name?: string) {
    const known = authors.get(id) ?? details?.actors.get(id);
    const ownerFallback = id === actor.id && (!known || known.name === id || known.name === '我');
    const profile = {
      id,
      name: name ?? (ownerFallback ? ownerName : undefined) ?? known?.name ?? id,
      kind: known?.kind ?? 'human',
      role: known?.role ?? role,
    };
    authors.set(id, profile);

    return profile;
  }

  const versions = [...reader.listVersions(boardId, undefined, maxVersions)].reverse();
  if (versions.at(-1)?.revision !== board.revision) {
    versions.push(reader.getVersion(boardId, board.revision) ?? currentVersion(board));
  }

  let previous: readonly Element[] | undefined;
  const history = versions.slice(-maxVersions).map((version) => {
    const scene =
      version.revision === board.revision
        ? elements
        : builder.elements(reader.listVersionObjects(boardId, version.revision), version.revision);
    const changedIds = previous ? changedObjectIds(previous, scene) : [];
    previous = scene;

    return {
      entry: historyEntry(
        version,
        author(
          version.actorId ?? actor.id,
          !version.actorId || version.actorId === actor.id ? 'owner' : 'editor',
        ),
        metadata,
        formatTime,
        changedIds,
      ),
      artifact: artifact(board, metadata, formatTime, version),
      elements: scene,
    };
  });
  const feedback = details?.feedback ?? { threads: [], messages: [], contentAnchors: [] };
  const historyElements = new Map(
    history.map((version) => [String(version.entry.revision), version.elements]),
  );
  const legacyFeedback = legacyBackupFeedback(
    boardId,
    feedback,
    (id, name) => author(id, id === actor.id ? 'owner' : 'commenter', name),
    formatTime,
    (revision, objectId) =>
      historyElements.get(revision)?.find((element) => element.id === objectId),
  );
  const assetIndex = Object.fromEntries(
    [...builder.assets].map(([id, asset]) => [
      id,
      { id, filename: id, size: asset.bytes.byteLength, mimeType: asset.mimeType },
    ]),
  );
  const properties = {
    schemaVersion: 2,
    artifact: artifact(board, metadata, formatTime),
    ...legacyFeedback,
    operations: [],
    sharing: { enabled: false, generation: 0, tokens: {} },
    assets: assetIndex,
    studioII: {
      version: 1,
      revision: board.revision.toString(),
      createdAtMillis: metadata.createdAtMillis ?? metadata.updatedAtMillis,
      updatedAtMillis: metadata.updatedAtMillis,
      actors: [...authors.values()],
      feedback,
      reviewSources: details?.reviewSources ?? { sources: [], targetSnapshots: [] },
    },
  };
  const nativeInks = reader
    .getBoardCustomColors(boardId)
    .map((color) => color.slice(1))
    .join(',');

  return {
    board,
    archive: {
      boardId,
      properties,
      contentFields: { style: { ...legacyStyle, ...(nativeInks && { nativeInks }) } },
      elements,
      history,
      assets: builder.assets,
    },
  };
}

export function createBoardBackup(
  repository: BoardEditRepository,
  encode: BackupEncoder,
  formatTime: FormatTime,
  ownerName?: string,
) {
  return async (actor: Actor, command: ExportBoardFileCommand): Promise<ExportBoardResult> => {
    try {
      const snapshot = repository.read((reader) =>
        capture(reader, actor, command, formatTime, ownerName?.trim() || undefined),
      );

      if ('kind' in snapshot) {
        return snapshot;
      }

      const content = await encode(snapshot.archive, maxBoardBackupBytes);
      if (!content?.byteLength || content.byteLength > maxBoardBackupBytes) {
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
