import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
import { openHistoryStorage } from '../support/board-history-database.js';
import {
  createTemporaryDatabase,
  documentId,
  documentPayloadVersion,
  documentTitle,
  editorId,
  lockedId,
  mainBoardId,
  secondBoardId,
  seedWhiteboardDatabase,
  shapeId,
} from '../support/whiteboard-database.js';

const savedAtMillis = 1000;
const geometryCommit = { actorId: editorId, kind: 'geometry', savedAtMillis } as const;

function withHistoryStorage(
  verify: (storage: ReturnType<typeof openHistoryStorage>) => void,
): void {
  const fixture = createTemporaryDatabase();
  try {
    seedWhiteboardDatabase(fixture.path);
    const storage = openHistoryStorage(fixture.path);
    try {
      verify(storage);
    } finally {
      storage.close();
    }
  } finally {
    fixture.dispose();
  }
}

test('reconstructs independent scene and payload histories with tombstones and exact clocks', () => {
  withHistoryStorage(({ repository, counts }) => {
    const editedTitle = '设计文档 🧭';
    const bytes = repository.write((writer) => {
      const board = writer.getBoard(mainBoardId);
      const [before] = writer.getPayloads(mainBoardId, [documentId]);
      assert.ok(board && before);
      const data = { ...before.data, title: editedTitle };
      writer.applyBoardChanges(
        board,
        {
          kind: 'changes',
          payloads: [
            {
              ...before,
              payloadVersion: before.payloadVersion + 1n,
              data,
            },
          ],
        },
        { actorId: editorId, kind: 'content', savedAtMillis },
      );

      const encoder = new TextEncoder();

      return {
        baseline: BigInt(encoder.encode(JSON.stringify(before.data)).byteLength),
        edited: BigInt(encoder.encode(JSON.stringify(data)).byteLength),
      };
    });

    const addedId = 'replacement-document';
    repository.write((writer) => {
      const board = writer.getBoard(mainBoardId);
      const [object] = writer.getObjects(mainBoardId, [documentId]);
      const [payload] = writer.getPayloads(mainBoardId, [documentId]);
      assert.ok(board && object && payload);
      writer.applyBoardChanges(
        board,
        {
          kind: 'changes',
          objects: [{ ...object, objectId: addedId, geometryVersion: 0n, payloadVersion: 0n }],
          payloads: [{ ...payload, objectId: addedId, payloadVersion: 0n }],
          removedObjectIds: [documentId],
        },
        geometryCommit,
      );
    });

    repository.read((reader) => {
      const versions = reader.listVersions(mainBoardId);
      expect(versions.map(({ revision }) => revision)).toEqual([2n, 1n, 0n]);
      expect(reader.listVersions(mainBoardId, 2n, 1)).toEqual([versions[1]]);
      expect(reader.getVersion(mainBoardId, 0n)).toMatchObject({
        kind: 'baseline',
        title: 'Architecture',
        actorId: undefined,
        savedAtMillis: undefined,
      });
      expect(reader.listVersions(secondBoardId)).toEqual([]);

      const before = reader.listVersionObjects(mainBoardId, 0n);
      expect(before.map(({ objectId }) => objectId)).toEqual([shapeId, documentId, lockedId]);
      expect(before[1]?.payloadVersion).toBe(documentPayloadVersion);
      expect(reader.listVersionObjects(mainBoardId, 1n, [documentId, addedId, documentId])).toEqual(
        [{ ...before[1], payloadVersion: documentPayloadVersion + 1n }],
      );
      expect(reader.listVersionObjects(mainBoardId, 2n, [addedId, documentId])).toMatchObject([
        { objectId: addedId, payloadVersion: 0n },
      ]);
      expect(reader.getVersionPayloads(mainBoardId, 0n, [documentId, addedId])).toMatchObject([
        {
          objectId: documentId,
          payloadVersion: documentPayloadVersion,
          data: { title: documentTitle },
        },
      ]);
      expect(reader.getVersionPayloads(mainBoardId, 1n, [documentId, addedId])).toMatchObject([
        {
          objectId: documentId,
          payloadVersion: documentPayloadVersion + 1n,
          data: { title: editedTitle },
        },
      ]);
      expect(reader.getVersionPayloads(mainBoardId, 2n, [documentId, addedId])).toMatchObject([
        { objectId: addedId, payloadVersion: 0n, data: { title: editedTitle } },
      ]);
    });
    repository.read((reader) => {
      if (typeof reader.payloadByteSize !== 'function') {
        throw new Error('Expected the repository to measure payload sizes.');
      }

      const ids = [documentId, addedId, documentId];
      expect(reader.payloadByteSize(mainBoardId, ids, 0n)).toBe(bytes.baseline);
      expect(reader.payloadByteSize(mainBoardId, ids, 1n)).toBe(bytes.edited);
      expect(reader.payloadByteSize(mainBoardId, [documentId], 2n)).toBe(0n);
      expect(reader.payloadByteSize(mainBoardId, ids, 2n)).toBe(bytes.edited);
      expect(reader.payloadByteSize(mainBoardId, ids)).toBe(bytes.edited);
    });
    expect(counts(mainBoardId)).toMatchObject({ versions: 3, objects: 2, payloads: 3 });
  });
});

test('retains two hundred versions and prunes only obsolete changes without copying payloads', () => {
  withHistoryStorage(({ repository, counts }) => {
    const moveCount = 203;
    const retainedCount = 200;
    const oldestRevision = BigInt(moveCount + 1 - retainedCount);
    for (let move = 0; move < moveCount; move += 1) {
      repository.write((writer) => {
        const board = writer.getBoard(mainBoardId);
        const [object] = writer.getObjects(mainBoardId, [shapeId]);
        assert.ok(board && object);
        const moved = {
          ...object,
          geometryVersion: object.geometryVersion + 1n,
          geometry: { ...object.geometry, x: object.geometry.x + 1 },
        };
        writer.applyBoardChanges(board, { kind: 'changes', objects: [moved] }, geometryCommit);
      });
    }

    repository.read((reader) => {
      const versions = reader.listVersions(mainBoardId, undefined, retainedCount);
      expect(versions).toHaveLength(retainedCount);
      expect(versions[0]?.revision).toBe(BigInt(moveCount));
      expect(versions.at(-1)?.revision).toBe(oldestRevision);
      expect(reader.getVersion(mainBoardId, oldestRevision - 1n)).toBeUndefined();
      const [oldest] = reader.listVersionObjects(mainBoardId, oldestRevision, [shapeId]);
      expect(oldest?.geometry.x).toBe(16 + Number(oldestRevision));
      const [unchanged] = reader.getVersionPayloads(mainBoardId, oldestRevision, [documentId]);
      expect(unchanged?.payloadVersion).toBe(documentPayloadVersion);
    });
    expect(counts(mainBoardId)).toMatchObject({
      versions: retainedCount,
      objects: retainedCount - 1,
      payloads: 0,
    });
  });
});

test('rolls back geometry and its history if version publication fails', () => {
  withHistoryStorage(({ repository, counts }) => {
    expect(() =>
      repository.write((writer) => {
        const board = writer.getBoard(mainBoardId);
        const [object] = writer.getObjects(mainBoardId, [shapeId]);
        assert.ok(board && object);
        writer.applyBoardChanges(
          board,
          {
            kind: 'changes',
            objects: [{ ...object, geometry: { ...object.geometry, x: 17 }, geometryVersion: 1n }],
          },
          { ...geometryCommit, savedAtMillis: -1 },
        );
      }),
    ).toThrow();

    repository.read((reader) => {
      expect(reader.getBoard(mainBoardId)?.revision).toBe(0n);
      expect(reader.getObjects(mainBoardId, [shapeId])[0]?.geometry.x).toBe(16);
    });
    expect(counts(mainBoardId)).toMatchObject({ versions: 0, objects: 0, payloads: 0 });
  });
});
