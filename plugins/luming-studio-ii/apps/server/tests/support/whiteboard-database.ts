import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWhiteboardRepository } from '../../src/infrastructure/adapters/index.js';
import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';

export const mainBoardId = 'architecture-board';
export const secondBoardId = 'planning-board';
export const editorId = 'editor';
export const teammateId = 'teammate';
export const viewerId = 'viewer';
export const outsiderId = 'outsider';
export const shapeId = 'shape-1';
export const documentId = 'document-1';
export const lockedId = 'locked-1';
export const documentTitle = 'The architecture outline';
export const documentContent = 'The payload is only fetched when a reader requests it.';
export const documentPayloadVersion = 9_007_199_254_740_997n;

const insertPayload = `INSERT INTO object_payloads
  (board_id, object_id, payload_version, body_kind, body_json)
  VALUES (?, ?, ?, ?, ?)`;

export function createTemporaryDatabase() {
  const folder = mkdtempSync(join(tmpdir(), 'luming-whiteboard-'));
  const path = join(folder, 'whiteboards.sqlite');

  return {
    path,
    dispose() {
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        rmSync(path + suffix, { force: true });
      }

      rmdirSync(folder);
    },
  };
}

export function seedWhiteboardDatabase(path: string) {
  const database = openSqliteDatabase(path);
  try {
    createWhiteboardRepository(database);
    database.write((connection) => {
      const addBoard = connection.prepare('INSERT INTO boards (board_id, title) VALUES (?, ?)');
      addBoard.run(mainBoardId, 'Architecture');
      addBoard.run(secondBoardId, 'Planning');

      const grantMemberAccess = connection.prepare(
        'INSERT INTO board_members (board_id, actor_id, can_edit) VALUES (?, ?, ?)',
      );
      grantMemberAccess.run(mainBoardId, editorId, 1);
      grantMemberAccess.run(mainBoardId, teammateId, 1);
      grantMemberAccess.run(mainBoardId, viewerId, 0);
      grantMemberAccess.run(secondBoardId, editorId, 1);

      const addObject = connection.prepare(
        `INSERT INTO board_objects
           (board_id, object_id, kind, label, layer_index, x, y, width, height, locked)
         VALUES (?, ?, ?, ?, ?, ?, ?, 100, 80, ?)`,
      );
      addObject.run(mainBoardId, documentId, 'document', 'Design document', 1, 100, 24, 0);
      addObject.run(mainBoardId, lockedId, 'shape', 'Locked shape', 2, 300, 44, 1);
      addObject.run(mainBoardId, shapeId, 'shape', 'Movable shape', 0, 16, -8, 0);
      addObject.run(secondBoardId, shapeId, 'shape', 'Planning shape', 0, 50, 20, 0);

      connection.prepare(insertPayload).run(
        mainBoardId,
        documentId,
        documentPayloadVersion,
        'document',
        JSON.stringify({
          title: documentTitle,
          schemaVersion: 1,
          blocks: [{ blockId: 'paragraph-1', type: 'paragraph', content: documentContent }],
        }),
      );
    });
  } finally {
    database.close();
  }
}

export function rejectReceiptInserts(path: string) {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      connection.exec(
        `CREATE TRIGGER reject_receipt_inserts BEFORE INSERT ON command_receipts
         BEGIN
           SELECT RAISE(ABORT, 'Injected receipt write failure');
         END`,
      );
    });
  } finally {
    database.close();
  }
}

export function insertUnreadableShapePayload(path: string) {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      connection.prepare(insertPayload).run(mainBoardId, shapeId, 0n, 'text', 'null');
    });
  } finally {
    database.close();
  }
}
