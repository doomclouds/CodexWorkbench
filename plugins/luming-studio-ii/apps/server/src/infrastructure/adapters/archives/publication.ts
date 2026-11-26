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
import { ArchiveObjectError, prepareArchiveObjects } from './scene.js';

export interface ArchivePublication {
  readonly objects: ReturnType<typeof prepareArchiveObjects>;
  readonly assetIds: ReadonlySet<string>;
}

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

export function preparePublication(
  archive: StagedCurrentArchive,
  boardId: string,
): ArchivePublication {
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

  const objects = prepareArchiveObjects(archive.objects, resolveSource, {
    sourceBoardId: archive.sourceBoardId,
    boardId,
  });

  return { objects, assetIds };
}

function writeBoard(
  connection: SqliteConnection,
  command: ArchiveImportCommand,
  title: string,
): void {
  const { actorId, boardId, updatedAtMillis } = command;
  connection
    .prepare('INSERT INTO boards (board_id, title, revision) VALUES (?, ?, 0)')
    .run(boardId, title);
  connection
    .prepare('INSERT INTO board_members (board_id, actor_id, can_edit) VALUES (?, ?, 1)')
    .run(boardId, actorId);
  connection
    .prepare(`
      INSERT INTO catalog_entries (board_id, updated_at_millis, pinned, entry_version)
      VALUES (?, ?, 0, 0)
    `)
    .run(boardId, updatedAtMillis);
}

function writeScene(
  connection: SqliteConnection,
  boardId: string,
  objects: ArchivePublication['objects'],
): void {
  const insertObject = connection.prepare(`
    INSERT INTO board_objects (
      board_id, object_id, kind, label, layer_index, x, y, width, height, rotation,
      geometry_version, locked, parent_id, group_id, appearance_json, detail_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `);
  const insertPayload = connection.prepare(`
    INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json)
    VALUES (?, ?, 0, ?, ?)
  `);

  for (const [layerIndex, object] of objects.entries()) {
    insertObject.run(
      boardId,
      object.objectId,
      object.kind,
      object.label,
      layerIndex,
      object.x,
      object.y,
      object.width,
      object.height,
      object.rotation,
      Number(object.locked),
      object.parentId ?? null,
      object.groupId ?? null,
      object.appearance ? JSON.stringify(object.appearance) : null,
      object.detail ? JSON.stringify(object.detail) : null,
    );

    if (object.payload) {
      insertPayload.run(
        boardId,
        object.objectId,
        object.payload.bodyKind,
        JSON.stringify(object.payload.data),
      );
    }
  }
}

function publicMimeType(value: string): string {
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
  writeBoard(connection, command, archive.title);
  writeScene(connection, boardId, publication.objects);
  writeAssets(connection, boardId, archive, publication.assetIds);
  retainSource(connection, boardId, archive);
}

export function readPublishedAsset(
  connection: SqliteConnection,
  actorId: string,
  boardId: string,
  assetId: string,
): ImportedArchiveAsset | undefined {
  const row = connection
    .prepare(`
    SELECT a.mime_type, a.bytes
    FROM board_archive_assets AS a
    JOIN board_members AS m ON m.board_id = a.board_id
    LEFT JOIN board_lifecycle AS l ON l.board_id = a.board_id
    WHERE m.actor_id = ? AND a.board_id = ? AND a.asset_id = ?
      AND l.trashed_at_millis IS NULL
  `)
    .get(actorId, boardId, assetId);

  if (!row) {
    return undefined;
  }

  const { mime_type: mimeType, bytes } = row;
  if (typeof mimeType !== 'string' || !(bytes instanceof Uint8Array)) {
    throw new Error('Invalid published asset data.');
  }

  return { mimeType: publicMimeType(mimeType), bytes };
}
