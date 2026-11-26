import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  FeedbackRejectionReason,
  FeedbackService,
  FeedbackThreadStatus,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { expect, test } from 'vitest';
import { createBoardFeedbackService, type FeedbackCommand } from '../../src/data/feedback/index.js';

const boardId = 'review-board';
const commandId = 'review-command';

test('sends a versioned relative anchor through the public protobuf command', async () => {
  const method = FeedbackService.method.applyFeedback;
  const controller = new AbortController();
  const feedback = createBoardFeedbackService(async (path, bytes, signal) => {
    expect(path).toBe('/luming.studio.v1.FeedbackService/ApplyFeedback');
    expect(signal).toBe(controller.signal);
    expect(fromBinary(method.input, bytes)).toMatchObject({
      boardId,
      commandId,
      operation: {
        case: 'create',
        value: {
          text: '核对边界',
          anchor: {
            target: {
              case: 'objectPoint',
              value: { objectId: 'card', u: 0.25, v: 0.5, geometryVersion: 0n },
            },
          },
        },
      },
    });

    return toBinary(
      method.output,
      create(method.output, {
        receipt: {
          boardId,
          commandId,
          outcome: {
            case: 'applied',
            value: { threadId: 'thread', threadVersion: 1n, messageId: 'msg' },
          },
        },
      }),
    );
  });

  await expect(
    feedback.apply(
      {
        boardId,
        commandId,
        operation: {
          kind: 'create',
          anchor: { kind: 'object', objectId: 'card', u: 0.25, v: 0.5, geometryVersion: 0n },
          text: '核对边界',
        },
      },
      controller.signal,
    ),
  ).resolves.toMatchObject({
    kind: 'applied',
    threadId: 'thread',
    threadVersion: 1n,
    messageId: 'msg',
  });
});

test('decodes frozen location and permission flags on a filtered discussion list', async () => {
  const method = FeedbackService.method.listThreads;
  const feedback = createBoardFeedbackService(async (path, body) => {
    expect(path).toBe('/luming.studio.v1.FeedbackService/ListThreads');
    expect(fromBinary(method.input, body)).toMatchObject({
      boardId,
      cursor: 'cursor-1',
      pageSize: 30,
      status: FeedbackThreadStatus.RESOLVED,
      authorActorId: 'owner',
    });

    return toBinary(
      method.output,
      create(method.output, {
        threads: [
          {
            threadId: 'thread',
            status: FeedbackThreadStatus.RESOLVED,
            version: 3n,
            replyCount: 1,
            anchor: {
              target: {
                target: {
                  case: 'objectPoint',
                  value: { objectId: 'card', u: 0.5, v: 0.5, geometryVersion: 7n },
                },
              },
              sourceBoardRevision: 17n,
              frozenPoint: { x: 70, y: 45 },
              frozenObject: { label: '已删除的卡片', width: 80, height: 40, x: 30, y: 25 },
              targetMissing: true,
            },
            first: {
              messageId: 'first',
              authorActorId: 'owner',
              text: '请检查标题',
              createdAtMillis: 1_700_000_000_000n,
              authoredByViewer: false,
              canEdit: false,
            },
          },
        ],
        nextCursor: 'cursor-2',
        canWrite: false,
      }),
    );
  });

  await expect(
    feedback.listThreads({
      boardId,
      cursor: 'cursor-1',
      pageSize: 30,
      status: 'resolved',
      authorId: 'owner',
    }),
  ).resolves.toMatchObject({
    canWrite: false,
    nextCursor: 'cursor-2',
    items: [
      {
        id: 'thread',
        canDelete: false,
        canResolve: false,
        status: 'resolved',
        anchor: {
          target: { kind: 'object', objectId: 'card', geometryVersion: 7n },
          sourceRevision: 17n,
          frozenPoint: { x: 70, y: 45 },
          frozenObject: { label: '已删除的卡片' },
          targetMissing: true,
        },
        first: {
          authorId: 'owner',
          authoredByViewer: false,
          canEdit: false,
          createdAt: 1_700_000_000_000,
        },
      },
    ],
  });
});

test('preserves edit CAS versions and checks original receipt identity', async () => {
  const apply = FeedbackService.method.applyFeedback;
  const lookup = FeedbackService.method.getFeedbackReceipt;
  const command: FeedbackCommand = {
    boardId,
    commandId,
    operation: {
      kind: 'edit',
      threadId: 'thread',
      messageId: 'msg',
      expectedVersion: 0n,
      text: '更新',
    },
  };
  const feedback = createBoardFeedbackService(async (path, bytes) => {
    if (path.endsWith('/' + apply.name)) {
      expect(fromBinary(apply.input, bytes)).toMatchObject({
        operation: { case: 'edit', value: { messageId: 'msg', expectedMessageVersion: 0n } },
      });

      return toBinary(
        apply.output,
        create(apply.output, {
          receipt: {
            boardId,
            commandId,
            outcome: {
              case: 'rejected',
              value: { reason: FeedbackRejectionReason.VERSION_CHANGED, currentVersion: 7n },
            },
          },
        }),
      );
    }

    expect(fromBinary(lookup.input, bytes)).toMatchObject({ boardId, commandId });
    return toBinary(
      lookup.output,
      create(lookup.output, {
        result: { case: 'notRecorded', value: { commandId: 'another-operation' } },
      }),
    );
  });

  await expect(feedback.apply(command)).resolves.toEqual({
    kind: 'rejected',
    reason: 'versionChanged',
    currentVersion: 7n,
  });
  await expect(feedback.getReceipt(boardId, commandId)).rejects.toThrow('未返回匹配');
});
