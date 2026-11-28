import { describe, expect, it } from 'vitest';
import type { MoveCommand, PayloadRecord } from '../../src/modules/whiteboard/application/index.js';
import {
  createWhiteboardApplication,
  WhiteboardAccessError,
} from '../../src/modules/whiteboard/application/index.js';
import {
  boardId,
  editor,
  object,
  TestWhiteboardRepository,
  viewer,
} from './whiteboard-repository.js';

function move(...ids: string[]): MoveCommand {
  return {
    boardId,
    commandId: 'move-1',
    delta: { dx: 30, dy: -5 },
    targets: ids.map((objectId) => ({ objectId, expectedGeometryVersion: 1n })),
  };
}

describe('Whiteboard queries', () => {
  it('budgets current payload bytes before decoding an oversized batch and always advances one object', () => {
    class SizedRepository extends TestWhiteboardRepository {
      payloadByteSize(_boardId: string, ids: readonly string[]) {
        return ids.reduce((size, id) => size + (id === 'large' ? 500n : 20n), 0n);
      }
    }
    const repository = new SizedRepository([]);
    const application = createWhiteboardApplication(repository);
    const ids = ['small', 'large', 'tail'];
    expect(application.getObjectPayloadPage(viewer, boardId, ids, 100).deferredObjectIds).toEqual([
      'large',
      'tail',
    ]);
    expect(
      application.getObjectPayloadPage(viewer, boardId, ids.slice(1), 100).deferredObjectIds,
    ).toEqual(['tail']);
    expect(repository.payloadQueries).toEqual([['small'], ['large']]);
    expect(() => application.getObjectPayloadPage({ id: 'guest' }, boardId, ids, 100)).toThrow(
      WhiteboardAccessError,
    );
    expect(repository.payloadQueries).toHaveLength(2);
  });

  it('loads only scene metadata and reads distinct requested payload IDs separately', () => {
    const note = object('note', { kind: 'document', payloadVersion: 50n });
    const document: PayloadRecord = {
      objectId: 'note',
      payloadVersion: 50n,
      bodyKind: 'document',
      data: { title: 'Design notes' },
    };
    const unrecognized: PayloadRecord = { ...document, objectId: 'future', bodyKind: 'future' };
    const repository = new TestWhiteboardRepository([note], [document, unrecognized]);
    const board = createWhiteboardApplication(repository);

    expect(board.getBoardScene(viewer, boardId)).toEqual({
      access: { canEdit: false },
      board: { boardId, title: 'Unit board', revision: 10n },
      customColors: [],
      objects: [note],
    });
    expect(repository.payloadQueries).toEqual([]);

    expect(board.getObjectPayloads(viewer, boardId, ['missing', 'note', 'note', 'future'])).toEqual(
      [
        { kind: 'unavailable', objectId: 'missing', reason: 'notFound' },
        { kind: 'payload', payload: document },
        { kind: 'payload', payload: document },
        { kind: 'unavailable', objectId: 'future', reason: 'unsupportedKind' },
      ],
    );
    expect(repository.payloadQueries).toEqual([['missing', 'note', 'future']]);
    expect(repository.sceneReads).toBe(1);
  });

  it('denies all whiteboard queries uniformly without reading protected data', () => {
    const guest = { id: 'guest' };
    const repository = new TestWhiteboardRepository([object('note')]);
    const board = createWhiteboardApplication(repository);

    expect(() => board.getBoardScene(guest, boardId)).toThrow(WhiteboardAccessError);
    expect(() => board.getObjectPayloads(guest, boardId, ['note'])).toThrow(WhiteboardAccessError);
    expect(() => board.getCommandReceipt(guest, boardId, 'move-1')).toThrow(WhiteboardAccessError);
    expect(repository.sceneReads).toBe(0);
    expect(repository.payloadQueries).toEqual([]);
  });
});

describe('Move objects', () => {
  it('writes geometry and one receipt, replays reordered targets, and rejects command ID reuse', () => {
    const repository = new TestWhiteboardRepository([
      object('one', { payloadVersion: 50n }),
      object('two'),
      object('untouched'),
    ]);
    const board = createWhiteboardApplication(repository);
    const request = move('one', 'two');
    const applied = board.moveObjects(editor, request);

    expect(applied.outcome).toMatchObject({
      kind: 'applied',
      boardRevision: 11n,
      objects: [
        { objectId: 'one', geometry: { x: 30, y: -5 }, geometryVersion: 2n, payloadVersion: 50n },
        { objectId: 'two', geometry: { x: 30, y: -5 }, geometryVersion: 2n },
      ],
    });
    expect(board.moveObjects(editor, move('two', 'one'))).toEqual(applied);
    expect(board.moveObjects(editor, move('one')).outcome).toEqual({
      kind: 'rejected',
      reason: 'commandIdReuse',
    });
    expect(board.getCommandReceipt(editor, boardId, request.commandId)).toEqual(applied);
    expect(board.getCommandReceipt(viewer, boardId, request.commandId)).toBeUndefined();
    expect(repository.revision).toBe(11n);
    expect(repository.geometryWrites).toEqual([['one', 'two']]);
    expect(repository.objectQueries).toEqual([['one', 'two']]);
    expect(repository.sceneReads).toBe(0);
    expect(repository.payloadQueries).toEqual([]);
  });

  it('permits an authorized replay after losing write access and conceals it after losing read access', () => {
    const repository = new TestWhiteboardRepository([object('one')]);
    const board = createWhiteboardApplication(repository);
    const request = move('one');
    const applied = board.moveObjects(editor, request);
    repository.access.set(editor.id, { canEdit: false });

    expect(board.moveObjects(editor, request)).toEqual(applied);
    expect(board.moveObjects(editor, { ...request, commandId: 'another' }).outcome).toEqual({
      kind: 'rejected',
      reason: 'forbidden',
    });

    repository.access.delete(editor.id);

    expect(board.moveObjects(editor, request).outcome).toEqual({
      kind: 'rejected',
      reason: 'forbidden',
    });
    expect(() => board.getCommandReceipt(editor, boardId, request.commandId)).toThrow(
      WhiteboardAccessError,
    );
    expect(repository.geometryWrites).toEqual([['one']]);
  });

  it('rejects a duplicate target, nonfinite delta, and inherited lock without persisting receipts', () => {
    const repository = new TestWhiteboardRepository([
      object('locked-parent', { locked: true }),
      object('child', { parentId: 'locked-parent' }),
    ]);
    const board = createWhiteboardApplication(repository);
    const rejected = { kind: 'rejected', reason: 'invalidMove' };

    expect(board.moveObjects(editor, move('child', 'child')).outcome).toEqual(rejected);
    expect(
      board.moveObjects(editor, { ...move('child'), delta: { dx: Infinity, dy: 0 } }).outcome,
    ).toEqual(rejected);
    expect(board.moveObjects(editor, move('child')).outcome).toEqual({
      kind: 'rejected',
      reason: 'geometryLocked',
    });
    expect(board.getCommandReceipt(editor, boardId, move('child').commandId)).toBeUndefined();
    expect(repository.geometryWrites).toEqual([]);
    expect(repository.revision).toBe(10n);
  });

  it('returns current object versions and missing request IDs without a partial write', () => {
    const current = object('newer', { geometryVersion: 2n });
    const unchanged = object('unchanged');
    const repository = new TestWhiteboardRepository([current, unchanged]);
    const board = createWhiteboardApplication(repository);

    expect(board.moveObjects(editor, move('newer', 'unchanged')).outcome).toEqual({
      kind: 'conflict',
      reason: 'geometryVersionChanged',
      boardRevision: 10n,
      currentObjects: [current, unchanged],
      missingObjectIds: [],
    });
    expect(board.moveObjects(editor, move('missing', 'unchanged')).outcome).toEqual({
      kind: 'conflict',
      reason: 'targetsChanged',
      boardRevision: 10n,
      currentObjects: [unchanged],
      missingObjectIds: ['missing'],
    });
    expect(repository.geometryWrites).toEqual([]);
    expect(repository.receipts.size).toBe(0);
  });

  it('expands group and parent relationships transitively without listing an ordinary board', () => {
    const parent = object('parent', { groupId: 'group' });
    const sibling = object('sibling', { groupId: 'group' });
    const child = object('child', { parentId: sibling.objectId });
    const locked = object('locked', { parentId: sibling.objectId, locked: true });
    const repository = new TestWhiteboardRepository([parent, sibling, child, locked]);
    const board = createWhiteboardApplication(repository);

    expect(board.moveObjects(editor, move('parent')).outcome).toMatchObject({
      kind: 'conflict',
      reason: 'targetsChanged',
      currentObjects: [parent, sibling, child],
    });
    expect(board.moveObjects(editor, move('parent', 'sibling', 'child')).outcome.kind).toBe(
      'applied',
    );
    expect(repository.sceneReads).toBe(0);
    expect(repository.geometryWrites).toEqual([['parent', 'sibling', 'child']]);
  });

  it('includes objects inside a rotated section using metadata and skips locked or outside items', () => {
    const section = object('section', {
      kind: 'section',
      geometry: { x: 0, y: 0, width: 100, height: 50, rotation: 90 },
    });
    const inside = object('inside', { geometry: { ...object('inside').geometry, x: 30, y: -10 } });
    const outside = object('outside');
    const locked = object('locked', { geometry: inside.geometry, locked: true });
    const repository = new TestWhiteboardRepository([section, inside, outside, locked]);
    const board = createWhiteboardApplication(repository);

    expect(board.moveObjects(editor, move('section')).outcome).toMatchObject({
      kind: 'conflict',
      reason: 'targetsChanged',
      currentObjects: [section, inside],
    });
    expect(board.moveObjects(editor, move('section', 'inside')).outcome.kind).toBe('applied');
    expect(repository.sceneReads).toBe(2);
    expect(repository.payloadQueries).toEqual([]);
    expect(repository.geometryWrites).toEqual([['section', 'inside']]);
  });

  it('translates only free connector points and absolute bends', () => {
    const connection = object('connector', {
      kind: 'connector',
      detail: {
        kind: 'connector',
        start: { point: { x: 0, y: 0 }, attachment: { objectId: 'anchor', port: 'left' } },
        end: { point: { x: 20, y: 15 } },
        bends: [{ x: 10, y: 5 }],
        relativeBends: { firstAxis: 'horizontal', offsets: [0.5] },
      },
    });
    const repository = new TestWhiteboardRepository([connection]);
    const board = createWhiteboardApplication(repository);

    expect(board.moveObjects(editor, move('connector')).outcome).toMatchObject({
      kind: 'applied',
      objects: [
        {
          geometryVersion: 2n,
          detail: {
            start: { point: { x: 0, y: 0 }, attachment: { objectId: 'anchor', port: 'left' } },
            end: { point: { x: 50, y: 10 } },
            bends: [{ x: 40, y: 0 }],
            relativeBends: { firstAxis: 'horizontal', offsets: [0.5] },
          },
        },
      ],
    });
  });

  it('leaves fully anchored connectors and out-of-range geometry unchanged', () => {
    const anchored = object('anchored', {
      kind: 'connector',
      detail: {
        kind: 'connector',
        start: { point: { x: 0, y: 0 }, attachment: { objectId: 'start' } },
        end: { point: { x: 20, y: 15 }, attachment: { objectId: 'end' } },
        bends: [],
        relativeBends: { firstAxis: 'horizontal', offsets: [0.5] },
      },
    });
    const far = object('far', { geometry: { ...object('far').geometry, x: Number.MAX_VALUE } });
    const repository = new TestWhiteboardRepository([anchored, far]);
    const board = createWhiteboardApplication(repository);
    const invalid = { kind: 'rejected', reason: 'invalidMove' };

    expect(board.moveObjects(editor, move('anchored')).outcome).toEqual(invalid);
    expect(
      board.moveObjects(editor, { ...move('far'), delta: { dx: Number.MAX_VALUE, dy: 0 } }).outcome,
    ).toEqual(invalid);
    expect(repository.geometryWrites).toEqual([]);
    expect(repository.receipts.size).toBe(0);
  });
});
