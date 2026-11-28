import { packWhiteboardBackup } from '../../src/infrastructure/adapters/archives/index.js';
import { createBoardSuggestionRepository } from '../../src/infrastructure/adapters/index.js';
import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';

export function readRestoredReviewSource(path: string, boardId: string, sourceId: string) {
  const database = openSqliteDatabase(path);
  try {
    return createBoardSuggestionRepository(database).read((reader) =>
      reader.getReviewSource(boardId, sourceId),
    );
  } finally {
    database.close();
  }
}

export function restoredArchiveCounts(path: string) {
  const database = openSqliteDatabase(path);
  try {
    return database.read((connection) =>
      connection
        .prepare(`
        SELECT (SELECT COUNT(*) FROM boards) AS boards,
               (SELECT COUNT(*) FROM board_versions) AS versions,
               (SELECT COUNT(*) FROM board_history_objects) AS past_objects,
               (SELECT COUNT(*) FROM board_history_payloads) AS past_payloads,
               (SELECT COUNT(*) FROM feedback_threads) AS threads,
               (SELECT COUNT(*) FROM feedback_messages) AS messages,
               (SELECT COUNT(*) FROM feedback_content_anchors) AS anchors,
               (SELECT COUNT(*) FROM board_review_sources) AS sources,
               (SELECT COUNT(*) FROM board_review_target_snapshots) AS frozen_targets,
               (SELECT COUNT(*) FROM board_archive_assets) AS media,
               (SELECT COUNT(*) FROM board_archive_source_chunks) AS chunks,
               (SELECT COUNT(*) FROM board_archive_actors) AS authors,
               (SELECT COUNT(*) FROM board_archive_metadata) AS metadata,
               (SELECT COUNT(*) FROM archive_import_receipts) AS receipts
      `)
        .get(),
    );
  } finally {
    database.close();
  }
}

export function legacyStudioIIBackup() {
  const boardId = 'previous-studio-ii';
  const artifact = {
    id: boardId,
    type: 'whiteboard',
    title: 'Previous Studio II',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:10.000Z',
    revision: 1,
    pinned: false,
  };
  const elements = [
    { id: 'box', type: 'shape', kind: 'rectangle', text: 'Current', x: 20, y: 10, w: 50, h: 50 },
  ];

  return packWhiteboardBackup(
    {
      boardId,
      properties: { schemaVersion: 2, artifact, sources: {}, feedback: [], assets: {} },
      history: [
        {
          entry: { id: 'revision-0', revision: 0, summary: 'baseline', changedObjectCount: 0 },
          artifact: { ...artifact, revision: 0 },
          elements: [],
        },
        {
          entry: {
            id: 'revision-1',
            revision: 1,
            summary: 'geometry',
            createdAt: artifact.updatedAt,
            actor: { id: 'previous-owner', name: 'previous-owner' },
            changedObjectCount: 1,
          },
          artifact,
          elements,
        },
      ],
      elements,
      assets: new Map(),
    },
    1024 * 1024,
  );
}

export function nativeTextBackup(data: Readonly<Record<string, unknown>>) {
  const boardId = 'native-text-backup';
  const artifact = { id: boardId, type: 'whiteboard', title: 'Text backup', revision: 0 };
  const elements = [
    {
      id: 'archived-text',
      type: 'text',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      studioII: {
        kind: 'text',
        geometryVersion: '0',
        payloadVersion: '0',
        bodyKind: 'text',
        data,
      },
    },
  ];

  return packWhiteboardBackup(
    {
      boardId,
      properties: {
        schemaVersion: 2,
        artifact,
        assets: {},
        studioII: { version: 1, revision: '0' },
      },
      history: [
        {
          entry: { revision: 0, studioII: { kind: 'baseline', changedObjectCount: 0 } },
          artifact,
          elements,
        },
      ],
      elements,
      assets: new Map(),
    },
    1024 * 1024,
  );
}
