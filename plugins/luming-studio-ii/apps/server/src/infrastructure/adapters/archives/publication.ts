import type {
  ArchiveImportCommand,
  ImportedArchiveAsset,
} from '../../../modules/archives/ports/index.js';
import {
  readStagedArchiveChunks,
  readStagedArchiveEntry,
  type StagedCurrentArchive,
} from '../../platform/archives/index.js';
import type { SqliteConnection } from '../../platform/index.js';
import { isTrashedBoardOwner, readBoardAccess } from '../authorization/index.js';
import {
  writeArchiveHistory,
  type ArchiveHistoryObject,
  type ArchiveHistorySnapshot,
} from './history.js';
import { prepareArchiveScene, type ValidateNativeObject } from './restore-scene.js';
import { prepareRestoredMetadata, writeRestoredMetadata } from './restored-metadata.js';
import { ArchiveObjectError } from './scene.js';

export type ArchivePublication = ReturnType<typeof preparePublication>;

const webMediaTypes = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'video/mp4',
  'video/ogg',
  'video/quicktime',
  'video/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
]);

function legacyVersionAuthors(history: readonly ArchiveHistorySnapshot[]) {
  const names = new Map<string, string>();
  for (const { actorId, agentName } of history) {
    if (actorId && agentName) {
      names.set(actorId, agentName);
    }
  }
  if (names.size) {
    return {
      actors: Array.from(names, ([id, name]) => ({ id, name, kind: 'agent', role: 'editor' })),
    };
  }
}

export function preparePublication(
  archive: StagedCurrentArchive,
  { actorId, boardId }: ArchiveImportCommand,
  validate: ValidateNativeObject,
) {
  const prefix = `/assets/${archive.sourceBoardId}/`;
  const assetIds = new Set<string>();
  function resolveSource(source: string, kind: 'reference' | 'text'): string {
    if (!source.startsWith('/assets/')) {
      return source;
    }

    const assetId = source.slice(prefix.length);
    if (!source.startsWith(prefix) || !archive.assets.has(assetId)) {
      if (kind === 'text') {
        return source;
      }

      throw new ArchiveObjectError('The board refers to an asset absent from its archive.');
    }

    assetIds.add(assetId);
    return `/studio-archive-assets/${boardId}/${assetId}`;
  }

  const origin = { sourceBoardId: archive.sourceBoardId, boardId };
  const scene = prepareArchiveScene(
    archive.objects,
    resolveSource,
    origin,
    validate,
    archive.restoration,
  );
  const details = archive.restoration?.details ?? legacyVersionAuthors(scene.history);
  const metadata = details ? prepareRestoredMetadata(details, actorId) : undefined;

  return { ...scene, assetIds, metadata };
}

function writeBoard(
  connection: SqliteConnection,
  command: ArchiveImportCommand,
  title: string,
  { revision, pinned, createdAtMillis, updatedAtMillis }: ArchivePublication,
): void {
  const { actorId, boardId } = command;
  connection
    .prepare('INSERT INTO boards (board_id, title, revision) VALUES (?, ?, ?)')
    .run(boardId, title, revision);
  connection
    .prepare('INSERT INTO board_members (board_id, actor_id, can_edit) VALUES (?, ?, 1)')
    .run(boardId, actorId);
  connection
    .prepare(`
      INSERT INTO catalog_entries (board_id, updated_at_millis, pinned, entry_version)
      VALUES (?, ?, ?, 0)
    `)
    .run(boardId, updatedAtMillis ?? command.updatedAtMillis, Number(pinned));

  if (createdAtMillis !== undefined) {
    connection
      .prepare('INSERT INTO board_archive_metadata (board_id, created_at_millis) VALUES (?, ?)')
      .run(boardId, createdAtMillis);
  }
}

function writeScene(
  connection: SqliteConnection,
  boardId: string,
  objects: readonly ArchiveHistoryObject[],
): void {
  const insertObject = connection.prepare(`
    INSERT INTO board_objects (
      board_id, object_id, kind, label, layer_index, x, y, width, height, rotation,
      geometry_version, locked, parent_id, group_id, appearance_json, detail_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPayload = connection.prepare(`
    INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const object of objects) {
    insertObject.run(
      boardId,
      object.objectId,
      object.kind,
      object.label,
      object.layerIndex,
      object.x,
      object.y,
      object.width,
      object.height,
      object.rotation,
      object.geometryVersion,
      Number(object.locked),
      object.parentId ?? null,
      object.groupId ?? null,
      object.appearanceJson ?? null,
      object.detailJson ?? null,
    );

    if (object.payload) {
      insertPayload.run(
        boardId,
        object.objectId,
        object.payload.version,
        object.payload.kind,
        object.payload.json,
      );
    }
  }
}

export function publicMimeType(value: string): string {
  const lower = value.trim().toLowerCase();
  return webMediaTypes.has(lower) ? lower : 'application/octet-stream';
}

function writeAssets(
  connection: SqliteConnection,
  boardId: string,
  archive: StagedCurrentArchive,
  assetIds: ArchivePublication['assetIds'],
): void {
  const insert = connection.prepare(`
    INSERT INTO board_archive_assets (board_id, asset_id, mime_type, bytes) VALUES (?, ?, ?, ?)
  `);

  for (const [assetId, entry] of archive.assets) {
    if (assetIds.has(assetId)) {
      insert.run(boardId, assetId, publicMimeType(entry.mimeType), readStagedArchiveEntry(entry));
    }
  }
}

function retainSource(
  connection: SqliteConnection,
  boardId: string,
  archive: StagedCurrentArchive,
): void {
  const insert = connection.prepare(`
    INSERT INTO board_archive_source_chunks (board_id, chunk_index, bytes) VALUES (?, ?, ?)
  `);
  let chunkIndex = 0;
  for (const bytes of readStagedArchiveChunks(archive)) {
    insert.run(boardId, chunkIndex, bytes);
    chunkIndex += 1;
  }
}

export function writePublication(
  connection: SqliteConnection,
  command: ArchiveImportCommand,
  archive: StagedCurrentArchive,
  publication: ArchivePublication,
): void {
  const { boardId } = command;
  writeBoard(connection, command, archive.title, publication);
  if (archive.customColors?.length) {
    connection
      .prepare('INSERT INTO board_custom_colors (board_id, colors_json) VALUES (?, ?)')
      .run(boardId, JSON.stringify(archive.customColors));
  }

  writeScene(connection, boardId, publication.objects);
  writeAssets(connection, boardId, archive, publication.assetIds);
  if (publication.history.length) {
    writeArchiveHistory(connection, boardId, publication.history);
  }
  if (publication.metadata) {
    writeRestoredMetadata(connection, boardId, publication.metadata);
  }
  retainSource(connection, boardId, archive);
}

export function readPublishedAsset(
  connection: SqliteConnection,
  actorId: string,
  boardId: string,
  assetId: string,
  allowTrashedOwner: boolean,
): ImportedArchiveAsset | undefined {
  const access = readBoardAccess(connection, boardId, actorId);
  if (!access && !(allowTrashedOwner && isTrashedBoardOwner(connection, boardId, actorId))) {
    return undefined;
  }

  const row = connection
    .prepare(`
    SELECT mime_type, bytes FROM board_archive_assets
    WHERE board_id = ? AND asset_id = ?
  `)
    .get(boardId, assetId);

  if (!row) {
    return undefined;
  }

  const { mime_type: mimeType, bytes } = row;
  if (typeof mimeType !== 'string' || !(bytes instanceof Uint8Array)) {
    throw new Error('Invalid published asset data.');
  }

  return { mimeType: publicMimeType(mimeType), bytes };
}
