import assert from 'node:assert/strict';
import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardEditRejectionReason,
  BoardEditService,
  type BoardEditReceipt,
  type EditBoardGeometryRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { callWhiteboard, sendWhiteboardRequest } from '../support/whiteboard-client.js';
import {
  editorId,
  lockedId,
  mainBoardId,
  outsiderId,
  rejectReceiptInserts,
  secondBoardId,
  shapeId,
  teammateId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

type Request = MessageInitShape<typeof EditBoardGeometryRequestSchema>;
type Operation = NonNullable<Request['operation']>;

const server = useWhiteboardTestServer();
const { editBoardGeometry, getBoardEditReceipt } = BoardEditService.method;
const { getBoardScene } = WhiteboardService.method;
const amber = '#C87D3C';
const jade = '#2CA984';

function edit(commandId: string, operation: Operation, actorId = editorId) {
  return callWhiteboard(server.address, actorId, editBoardGeometry, {
    boardId: mainBoardId,
    commandId,
    operation,
  });
}

function receipt(actorId: string, commandId: string) {
  return callWhiteboard(server.address, actorId, getBoardEditReceipt, {
    boardId: mainBoardId,
    commandId,
  });
}

async function scene(actorId = editorId, boardId = mainBoardId) {
  const reply = await callWhiteboard(server.address, actorId, getBoardScene, { boardId });
  assert.ok(reply.scene);

  return reply.scene;
}

function applied(value: BoardEditReceipt | undefined) {
  assert.equal(value?.outcome.case, 'applied');

  return value.outcome.value;
}

function stroke(color: string, expectedGeometryVersion: bigint, objectId = shapeId) {
  return {
    case: 'style',
    value: {
      targets: [{ target: { objectId, expectedGeometryVersion } }],
      patch: { stroke: color },
      rememberColor: color,
    },
  } satisfies Operation;
}

function remove(color: string): Operation {
  return { case: 'removeCustomColor', value: { color } };
}

test('serializes custom inks from two editors, exposes board-scoped reads and restores both receipts after restart', async () => {
  expect((await scene()).customColors?.colors).toEqual([]);
  const first = stroke(amber, 0n);
  const second = stroke(jade, 0n, lockedId);
  const [ownerEdit, memberEdit] = await Promise.all([
    edit('remember-amber', first),
    edit('remember-jade', second, teammateId),
  ]);
  const owned = applied(ownerEdit.receipt);
  const joined = applied(memberEdit.receipt);
  const [earlier, later] = owned.boardRevision === 1n ? [owned, joined] : [joined, owned];
  expect(earlier.boardRevision).toBe(1n);
  expect(earlier.customColors?.colors).toHaveLength(1);
  expect(later.boardRevision).toBe(2n);
  const remembered = later.customColors?.colors;
  expect(new Set(remembered)).toEqual(new Set([amber, jade]));
  expect(remembered?.slice(0, 1)).toEqual(earlier.customColors?.colors);

  const visible = await scene(viewerId);
  expect(visible.access?.canEdit).toBe(false);
  expect(visible.customColors?.colors).toEqual(remembered);
  expect(visible.objects.find(({ objectId }) => objectId === shapeId)?.appearance?.stroke).toBe(
    amber,
  );
  expect(visible.objects.find(({ objectId }) => objectId === lockedId)?.appearance?.stroke).toBe(
    jade,
  );
  expect((await scene(editorId, secondBoardId)).customColors?.colors).toEqual([]);
  const denied = await sendWhiteboardRequest(server.address, outsiderId, getBoardScene, {
    boardId: mainBoardId,
  });
  expect(denied.status).toBe(403);

  await server.restart();
  expect((await scene()).customColors?.colors).toEqual(remembered);
  expect((await receipt(editorId, 'remember-amber')).receipt).toEqual(ownerEdit.receipt);
  expect((await receipt(teammateId, 'remember-jade')).receipt).toEqual(memberEdit.receipt);
  expect((await receipt(teammateId, 'remember-amber')).receipt).toBeUndefined();
  expect((await edit('remember-amber', first)).receipt).toEqual(ownerEdit.receipt);
  expect((await scene()).boardRevision).toBe(2n);
});

test('removes an ink without altering objects and explicitly returns an empty shared palette', async () => {
  const initial = await edit('remember-for-removal', stroke(amber, 0n));
  expect(applied(initial.receipt).customColors?.colors).toEqual([amber]);
  const before = await scene();

  const denied = await edit('readonly-removal', remove(amber), viewerId);
  expect(denied.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.FORBIDDEN },
  });
  const deniedAdd = await edit('readonly-registration', stroke(jade, 1n), viewerId);
  expect(deniedAdd.receipt?.outcome).toEqual(denied.receipt?.outcome);
  expect((await receipt(viewerId, 'remember-for-removal')).receipt?.outcome).toEqual(
    denied.receipt?.outcome,
  );
  expect(await scene()).toEqual(before);

  const removed = await edit('remove-last-ink', remove(amber.toLowerCase()), teammateId);
  expect(applied(removed.receipt)).toMatchObject({
    boardRevision: 2n,
    changedObjects: [],
    customColors: { colors: [] },
  });
  const after = await scene();
  expect(after.customColors?.colors).toEqual([]);
  expect(after.objects).toEqual(before.objects);

  const repeated = await edit('remove-already-absent', remove(amber));
  const unchanged = applied(repeated.receipt);
  expect(unchanged.customColors).toBeUndefined();
  expect(unchanged.boardRevision).toBe(2n);
  expect(await scene()).toEqual(after);
  expect((await receipt(teammateId, 'remove-last-ink')).receipt).toEqual(removed.receipt);
});

test('requires a valid remembered ink to match the object style change and keeps it behind the same version check', async () => {
  const base = stroke(amber, 0n);
  const invalid = [
    { ...base.value, rememberColor: jade },
    { ...base.value, patch: { fill: amber } },
    { ...base.value, patch: { stroke: '#123' }, rememberColor: '#123' },
  ];
  const before = await scene();
  for (const [index, value] of invalid.entries()) {
    const response = await edit('invalid-ink-' + index, { case: 'style', value });
    expect(response.receipt?.outcome).toMatchObject({
      case: 'rejected',
      value: { reason: BoardEditRejectionReason.INVALID_EDIT },
    });
  }
  expect(await scene()).toEqual(before);
  const stale = await edit('stale-style-and-ink', stroke(amber, 1n));
  expect(stale.receipt?.outcome.case).toBe('conflict');
  expect(await scene()).toEqual(before);

  const saved = await edit('remember-text-ink', {
    case: 'style',
    value: { ...base.value, patch: { textColor: amber.toLowerCase() } },
  });
  expect(applied(saved.receipt).customColors?.colors).toEqual([amber]);
  const fill = await edit('ordinary-fill', {
    case: 'style',
    value: {
      targets: [{ target: { objectId: shapeId, expectedGeometryVersion: 0n } }],
      patch: { fill: jade },
    },
  });
  expect(applied(fill.receipt).customColors).toBeUndefined();
  expect((await scene()).customColors?.colors).toEqual([amber]);
});

test('rolls back the object, palette and board revision when saving the edit receipt fails', async () => {
  const before = await scene();
  rejectReceiptInserts(server.databasePath, 'edit');
  const commandId = 'rollback-style-and-ink';
  const failed = await sendWhiteboardRequest(server.address, editorId, editBoardGeometry, {
    boardId: mainBoardId,
    commandId,
    operation: stroke(amber, 0n),
  });
  expect(failed.status).toBe(500);
  expect(await scene()).toEqual(before);
  expect((await receipt(editorId, commandId)).receipt).toBeUndefined();
});

function syntheticInk(index: number) {
  return '#' + index.toString(16).toUpperCase().padStart(6, '0');
}

test('keeps the latest 64 inks in insertion order, with no case duplicates or implicit reordering', async () => {
  const inks = Array.from({ length: 65 }, (_, index) => syntheticInk(index));
  for (const [index, color] of inks.entries()) {
    const saved = await edit('register-ink-' + index, stroke(color.toLowerCase(), BigInt(index)));
    expect(applied(saved.receipt).customColors?.colors.at(-1)).toBe(color);
  }

  const expected = inks.slice(1);
  expect((await scene()).customColors?.colors).toEqual(expected);
  const duplicate = await edit('reuse-first-kept-ink', stroke(expected[0]!.toLowerCase(), 65n));
  expect(applied(duplicate.receipt).customColors).toBeUndefined();
  expect((await scene()).customColors?.colors).toEqual(expected);
});
