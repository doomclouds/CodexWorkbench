import assert from 'node:assert/strict';
import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardCatalogService,
  BoardLifecycleAction,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import {
  FeedbackRejectionReason,
  FeedbackService,
  FeedbackThreadStatus,
  type ApplyFeedbackRequestSchema,
  type FeedbackReceipt,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { grantCatalogEditor } from '../support/catalog-lifecycle-database.js';
import {
  deleteFeedbackAnchorObject,
  feedbackCounts,
  rejectFeedbackReceipts,
  removeFeedbackWritePermission,
  setFeedbackAnchorRotation,
} from '../support/feedback-database.js';
import {
  callWhiteboard as callProtobuf,
  sendWhiteboardRequest as sendProtobuf,
} from '../support/whiteboard-client.js';
import {
  editorId,
  mainBoardId,
  outsiderId,
  secondBoardId,
  shapeId,
  teammateId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

type Operation = NonNullable<MessageInitShape<typeof ApplyFeedbackRequestSchema>['operation']>;

const server = useWhiteboardTestServer();
const { applyFeedback, getFeedbackReceipt, getThread, listThreads } = FeedbackService.method;
const { getBoardScene, moveObjects } = WhiteboardService.method;

function boardPoint(text: string): Operation {
  return {
    case: 'create',
    value: { text, anchor: { target: { case: 'boardPoint', value: { x: -4, y: 8 } } } },
  };
}

function objectPoint(geometryVersion: bigint): Operation {
  return {
    case: 'create',
    value: {
      text: 'Review this corner.',
      anchor: {
        target: {
          case: 'objectPoint',
          value: { objectId: shapeId, u: 0, v: 0, geometryVersion },
        },
      },
    },
  };
}

async function apply(
  commandId: string,
  operation: Operation,
  actorId = editorId,
  boardId = mainBoardId,
): Promise<FeedbackReceipt> {
  const { receipt } = await callProtobuf(server.address, actorId, applyFeedback, {
    boardId,
    commandId,
    operation,
  });
  assert.ok(receipt);

  return receipt;
}

function applied(receipt: FeedbackReceipt) {
  assert.ok(receipt.outcome.case === 'applied');

  return receipt.outcome.value;
}

function list(actorId = editorId, boardId = mainBoardId) {
  return callProtobuf(server.address, actorId, listThreads, { boardId, pageSize: 20 });
}

function detail(threadId: string, actorId = editorId) {
  return callProtobuf(server.address, actorId, getThread, { boardId: mainBoardId, threadId });
}

function assertRejected(receipt: FeedbackReceipt, reason: FeedbackRejectionReason) {
  assert.ok(receipt.outcome.case === 'rejected');
  expect(receipt.outcome.value.reason).toBe(reason);
}

test('freezes object geometry, retains its original location, and keeps feedback off the board revision', async () => {
  setFeedbackAnchorRotation(server.databasePath, mainBoardId, shapeId, 90);
  const attached = await apply('attach', objectPoint(0n));
  const { threadId } = applied(attached);
  await server.restart();
  const lookup = await callProtobuf(server.address, editorId, getFeedbackReceipt, {
    boardId: mainBoardId,
    commandId: 'attach',
  });
  expect(lookup.result).toMatchObject({ case: 'receipt', value: attached });

  const { thread } = await detail(threadId);
  assert.ok(thread?.anchor?.frozenPoint);
  expect(thread.anchor).toMatchObject({
    sourceBoardRevision: 0n,
    targetMissing: false,
    target: { target: { case: 'objectPoint', value: { objectId: shapeId, geometryVersion: 0n } } },
    frozenObject: { kind: 'shape', label: 'Movable shape', x: 16, y: -8, rotation: 90 },
  });
  expect(thread.anchor.frozenPoint.x).toBeCloseTo(106);
  expect(thread.anchor.frozenPoint.y).toBeCloseTo(-18);

  const before = await callProtobuf(server.address, editorId, getBoardScene, {
    boardId: mainBoardId,
  });
  expect(before.scene?.boardRevision).toBe(0n);
  const { receipt } = await callProtobuf(server.address, editorId, moveObjects, {
    boardId: mainBoardId,
    commandId: 'move',
    delta: { dx: 44, dy: 24 },
    targets: [{ objectId: shapeId, expectedGeometryVersion: 0n }],
  });
  expect(receipt?.outcome.case).toBe('applied');
  expect((await detail(threadId)).thread?.anchor).toEqual(thread.anchor);

  const stale = await apply('stale-target', objectPoint(0n));
  assertRejected(stale, FeedbackRejectionReason.TARGET_CHANGED);
  deleteFeedbackAnchorObject(server.databasePath, mainBoardId, shapeId);
  const after = await detail(threadId);
  expect(after.thread?.anchor?.targetMissing).toBe(true);
  expect(after.thread?.anchor?.frozenPoint).toEqual(thread.anchor.frozenPoint);
  expect((await list()).threads).toHaveLength(1);
});

test('authorizes readers and current editors before exposing receipts or applying feedback', async () => {
  const receipt = await apply('create', boardPoint('Owner draft.'));
  const { threadId } = applied(receipt);
  const viewer = await detail(threadId, viewerId);
  expect(viewer.canWrite).toBe(false);
  expect(viewer.thread).toMatchObject({
    first: { text: 'Owner draft.', canEdit: false, authoredByViewer: false },
    canDelete: false,
    canResolve: false,
  });
  const boardQuery = { boardId: mainBoardId };
  const receiptQuery = { ...boardQuery, commandId: 'create' };
  const hidden = await Promise.all([
    sendProtobuf(server.address, outsiderId, listThreads, boardQuery),
    sendProtobuf(server.address, viewerId, getFeedbackReceipt, receiptQuery),
    sendProtobuf(server.address, viewerId, applyFeedback, {
      ...receiptQuery,
      operation: boardPoint('Forbidden.'),
    }),
  ]);
  expect(hidden.map((response) => response.status)).toEqual([403, 403, 403]);

  const otherEditor = await detail(threadId, teammateId);
  expect(otherEditor.thread).toMatchObject({
    first: { canEdit: false },
    canDelete: false,
    canResolve: true,
  });
  const anotherActorsReceipt = await callProtobuf(
    server.address,
    teammateId,
    getFeedbackReceipt,
    receiptQuery,
  );
  expect(anotherActorsReceipt.result).toMatchObject({
    case: 'notRecorded',
    value: { commandId: 'create' },
  });
  const missing = await sendProtobuf(server.address, editorId, getThread, {
    boardId: secondBoardId,
    threadId,
  });
  expect(missing.status).toBe(404);

  removeFeedbackWritePermission(server.databasePath, mainBoardId, editorId);
  const [retry, lookup] = await Promise.all([
    sendProtobuf(server.address, editorId, applyFeedback, {
      ...receiptQuery,
      operation: boardPoint('Owner draft.'),
    }),
    sendProtobuf(server.address, editorId, getFeedbackReceipt, receiptQuery),
  ]);
  expect([retry.status, lookup.status]).toEqual([403, 403]);
  expect((await detail(threadId)).thread?.first?.canEdit).toBe(false);
});

test('rejects incomplete, non-finite, and out-of-range targets without making a thread', async () => {
  const invalidBoardPoint: Operation = {
    case: 'create',
    value: {
      text: 'Invalid point.',
      anchor: { target: { case: 'boardPoint', value: { x: Number.NaN, y: 14 } } },
    },
  };
  assertRejected(
    await apply('non-finite', invalidBoardPoint),
    FeedbackRejectionReason.INVALID_ANCHOR,
  );
  assertRejected(
    await apply('blank-text', boardPoint('   ')),
    FeedbackRejectionReason.INVALID_TEXT,
  );

  const anchor = { objectId: shapeId, u: 1.5, v: 0, geometryVersion: 0n };
  const invalidObjectPoint: Operation = {
    case: 'create',
    value: {
      text: 'Invalid object point.',
      anchor: { target: { case: 'objectPoint', value: anchor } },
    },
  };
  assertRejected(
    await apply('invalid-object', invalidObjectPoint),
    FeedbackRejectionReason.INVALID_ANCHOR,
  );

  const missingVersion = await sendProtobuf(server.address, editorId, applyFeedback, {
    boardId: mainBoardId,
    commandId: 'missing-version',
    operation: {
      case: 'create',
      value: {
        text: 'Version is required.',
        anchor: { target: { case: 'objectPoint', value: { objectId: shapeId, u: 0, v: 0 } } },
      },
    },
  });
  expect(missingVersion.status).toBe(400);
  expect(feedbackCounts(server.databasePath, mainBoardId)).toEqual({
    threads: 0,
    messages: 0,
    receipts: 3,
  });
});

test('deduplicates create and replies, advances versions and only reopens for a new reply', async () => {
  const first = boardPoint('Please review.');
  const [created, duplicate] = await Promise.all([apply('add', first), apply('add', first)]);
  expect(duplicate).toEqual(created);
  const { threadId } = applied(created);
  const other = await apply('add', boardPoint('Different content.'));
  assertRejected(other, FeedbackRejectionReason.COMMAND_ID_REUSE);

  const reply: Operation = { case: 'reply', value: { threadId, text: 'Answered.' } };
  const acknowledged = await apply('reply', reply, teammateId);
  const { messageId, threadVersion } = applied(acknowledged);
  assert.ok(messageId);

  const resolved = await apply(
    'resolve',
    { case: 'resolve', value: { threadId, expectedThreadVersion: threadVersion } },
    teammateId,
  );
  expect(applied(resolved).threadVersion).toBe(3n);
  expect(await apply('reply', reply, teammateId)).toEqual(acknowledged);
  expect((await detail(threadId)).thread?.status).toBe(FeedbackThreadStatus.RESOLVED);

  const unauthorized = await apply('edit-foreign', {
    case: 'edit',
    value: { threadId, messageId, expectedMessageVersion: 1n, text: 'Changed without authority.' },
  });
  assertRejected(unauthorized, FeedbackRejectionReason.FORBIDDEN);
  const edited = await apply(
    'edit-own',
    { case: 'edit', value: { threadId, messageId, expectedMessageVersion: 1n, text: 'Edited.' } },
    teammateId,
  );
  expect(applied(edited).messageVersion).toBe(2n);
  const staleEdit = await apply(
    'stale-edit',
    { case: 'edit', value: { threadId, messageId, expectedMessageVersion: 1n, text: 'Stale.' } },
    teammateId,
  );
  assertRejected(staleEdit, FeedbackRejectionReason.VERSION_CHANGED);

  const newReply = await apply('new-reply', reply, teammateId);
  const reopened = await detail(threadId);
  expect(reopened.thread?.status).toBe(FeedbackThreadStatus.OPEN);
  expect(reopened.replies.map(({ text }) => text)).toEqual(['Edited.', 'Answered.']);
  const deletion: Operation = {
    case: 'delete',
    value: { threadId, expectedThreadVersion: applied(newReply).threadVersion },
  };
  expect(applied(await apply('delete', deletion)).deleted).toBe(true);
  expect(applied(await apply('delete', deletion)).deleted).toBe(true);
  expect(await apply('add', first)).toEqual(created);
  expect(await list()).toMatchObject({ threads: [] });
  expect(feedbackCounts(server.databasePath, mainBoardId)).toMatchObject({
    threads: 0,
    messages: 0,
  });

  const recorded = await callProtobuf(server.address, teammateId, getFeedbackReceipt, {
    boardId: mainBoardId,
    commandId: 'new-reply',
  });
  expect(recorded.result).toMatchObject({ case: 'receipt', value: newReply });
});

test('pages matching threads and replies with stable keys and rejects malformed cursors', async () => {
  const editor = applied(await apply('editor-thread', boardPoint('First.')));
  const teammate = applied(await apply('teammate-thread', boardPoint('Second.'), teammateId));
  const resolve: Operation = {
    case: 'resolve',
    value: { threadId: teammate.threadId, expectedThreadVersion: 1n },
  };
  await apply('resolve-thread', resolve);
  const reopened = await apply('reopen-thread', {
    case: 'reopen',
    value: { threadId: teammate.threadId, expectedThreadVersion: 2n },
  });
  expect(applied(reopened).threadVersion).toBe(3n);

  const page = await callProtobuf(server.address, editorId, listThreads, {
    boardId: mainBoardId,
    pageSize: 1,
  });
  assert.ok(page.nextCursor);
  const next = await callProtobuf(server.address, editorId, listThreads, {
    boardId: mainBoardId,
    pageSize: 1,
    cursor: page.nextCursor,
  });
  const ids = [...page.threads, ...next.threads].map(({ threadId }) => threadId).sort();
  expect(ids).toEqual([editor.threadId, teammate.threadId].sort());
  expect(next.nextCursor).toBeUndefined();

  const authored = await callProtobuf(server.address, editorId, listThreads, {
    boardId: mainBoardId,
    authorActorId: teammateId,
    status: FeedbackThreadStatus.OPEN,
  });
  expect(authored.threads.map(({ threadId }) => threadId)).toEqual([teammate.threadId]);

  await apply('one', { case: 'reply', value: { threadId: editor.threadId, text: 'One.' } });
  await apply('two', { case: 'reply', value: { threadId: editor.threadId, text: 'Two.' } });
  const firstReplies = await callProtobuf(server.address, editorId, getThread, {
    boardId: mainBoardId,
    threadId: editor.threadId,
    pageSize: 1,
  });
  assert.ok(firstReplies.nextCursor);
  const laterReplies = await callProtobuf(server.address, editorId, getThread, {
    boardId: mainBoardId,
    threadId: editor.threadId,
    pageSize: 1,
    cursor: firstReplies.nextCursor,
  });
  expect([...firstReplies.replies, ...laterReplies.replies].map(({ text }) => text)).toEqual([
    'One.',
    'Two.',
  ]);
  const badCursor = await sendProtobuf(server.address, editorId, listThreads, {
    boardId: mainBoardId,
    cursor: 'bad',
  });
  expect(badCursor.status).toBe(400);
});

test('rolls back the thread and message when receipt persistence fails', async () => {
  rejectFeedbackReceipts(server.databasePath);
  const response = await sendProtobuf(server.address, editorId, applyFeedback, {
    boardId: mainBoardId,
    commandId: 'failed',
    operation: boardPoint('Failed to save.'),
  });
  expect(response.status).toBe(500);
  expect(feedbackCounts(server.databasePath, mainBoardId)).toEqual({
    threads: 0,
    messages: 0,
    receipts: 0,
  });
  expect(server.errors).toHaveLength(1);
});

test('uses the board lifecycle owner and removes feedback and receipts when the board is purged', async () => {
  const { createBoard, manageBoard, purgeBoards } = BoardCatalogService.method;
  const created = await callProtobuf(server.address, editorId, createBoard, {
    commandId: 'create-board',
    title: 'Review board',
  });
  assert.ok(created.receipt?.outcome.case === 'created');
  const { boardId, entryVersion } = created.receipt.outcome.value;
  grantCatalogEditor(server.databasePath, boardId, teammateId);
  const foreign = applied(
    await apply('foreign-thread', boardPoint('Owner may moderate.'), teammateId, boardId),
  );
  const ownedView = await callProtobuf(server.address, editorId, getThread, {
    boardId,
    threadId: foreign.threadId,
  });
  expect(ownedView.thread).toMatchObject({
    canDelete: true,
    first: { authoredByViewer: false, canEdit: false },
  });
  const removed = await apply(
    'delete-foreign-thread',
    {
      case: 'delete',
      value: { threadId: foreign.threadId, expectedThreadVersion: foreign.threadVersion },
    },
    editorId,
    boardId,
  );
  expect(applied(removed).deleted).toBe(true);
  await apply('create-thread', boardPoint('To be purged.'), editorId, boardId);
  expect(feedbackCounts(server.databasePath, boardId)).toEqual({
    threads: 1,
    messages: 1,
    receipts: 3,
  });

  const trashed = await callProtobuf(server.address, editorId, manageBoard, {
    boardId,
    commandId: 'trash-board',
    expectedEntryVersion: entryVersion,
    operation: { case: 'lifecycle', value: BoardLifecycleAction.TRASH },
  });
  assert.ok(trashed.receipt?.outcome.case === 'changed');
  const hidden = await sendProtobuf(server.address, editorId, listThreads, { boardId });
  expect(hidden.status).toBe(403);
  const result = await callProtobuf(server.address, editorId, purgeBoards, {
    commandId: 'purge-board',
    targets: [{ boardId, expectedEntryVersion: trashed.receipt.outcome.value.entryVersion }],
  });
  expect(result.receipt?.outcome.case).toBe('purged');
  expect(feedbackCounts(server.databasePath, boardId)).toEqual({
    threads: 0,
    messages: 0,
    receipts: 0,
  });
});
