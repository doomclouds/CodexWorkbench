import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { DescMessage, DescMethodUnary, MessageInitShape } from '@bufbuild/protobuf';
import {
  FeedbackAttachmentState,
  FeedbackService,
  FeedbackThreadStatus,
  type FeedbackAttachmentSchema,
  type FeedbackThreadSchema,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import {
  BoardSuggestionService,
  type BoardSuggestionSchema,
} from '@codexworkbench/luming-studio-ii-contracts/suggestions/service';
import { act } from 'react';
import { expect, test } from 'vitest';
import { createBoardFeedbackService } from '../../src/data/feedback/index.js';
import {
  createSuggestionService,
  type AttachedReviewSource,
  type SuggestionPost,
} from '../../src/data/suggestions/index.js';
import { createWhiteboardEditService } from '../../src/data/whiteboard/index.js';
import { createWhiteboardRpcMock, sampleBoardId } from '../fixtures/whiteboard-rpc.js';
import { boardCommandId, createAppMock } from '../support/whiteboard-app-mock.js';

const {
  listBoardSuggestions,
  createBoardReviewSource,
  previewBoardSuggestion,
  acceptBoardSuggestion,
} = BoardSuggestionService.method;
const { listThreads, getThread, applyFeedback } = FeedbackService.method;
const attachmentRequestId = 'stored-note-attachment';
const attachmentCommands = ['queue-note', 'claim-note', 'confirm-note'];
const suggestion = {
  proposalId: 'stored-suggestion',
  sourceId: 'frozen-selection',
  observation: '向右移动已选择的矩形。',
  proposalVersion: 0n,
  expiresAtMillis: 1_800_000_000_000n,
  options: [{ optionId: 'move-right', label: '右移矩形' }],
} satisfies MessageInitShape<typeof BoardSuggestionSchema>;
const previewedObject = {
  objectId: 'rectangle',
  kind: 'shape',
  label: '可移动图形',
  geometryVersion: 1n,
  geometry: { x: 140, y: 40, width: 120, height: 80, rotation: 0 },
};
const frozenTarget = {
  objectId: 'rectangle',
  kind: 'shape',
  geometryVersion: 0n,
  geometry: { x: 40, y: 40, width: 120, height: 80, rotation: 0 },
};

const notePoint = { x: 50, y: 40 };
const note = {
  threadId: 'owner-note',
  status: FeedbackThreadStatus.OPEN,
  anchor: {
    target: {
      target: {
        case: 'objectPoint',
        value: { objectId: 'rectangle', u: 0.1, v: 0.1, geometryVersion: 0n },
      },
    },
    sourceBoardRevision: 0n,
    frozenPoint: notePoint,
    frozenObject: { kind: 'shape', label: previewedObject.label, ...frozenTarget.geometry },
    frozenExcerpt: '用户选中的原文摘录',
    targetMissing: false,
  },
  first: {
    messageId: 'owner-message',
    authorActorId: 'owner',
    authoredByViewer: true,
    text: '作者筛选仍然适用',
    createdAtMillis: 0n,
    updatedAtMillis: 0n,
    version: 0n,
    canEdit: true,
  },
  version: 0n,
  updatedAtMillis: 0n,
  replyCount: 0,
  canResolve: true,
  canDelete: true,
} satisfies MessageInitShape<typeof FeedbackThreadSchema>;

function route(method: DescMethodUnary): string {
  return '/' + method.parent.typeName + '/' + method.name;
}

function reply<Output extends DescMessage>(schema: Output, result: MessageInitShape<Output>) {
  return toBinary(schema, create(schema, result));
}

function feedbackRpc() {
  const actions: string[] = [];
  let attachment: MessageInitShape<typeof FeedbackAttachmentSchema>;

  function post(path: string, bytes: Uint8Array) {
    const thread = { ...note, attachment };
    if (path === route(listThreads)) {
      const query = fromBinary(listThreads.input, bytes);
      expect(query.boardId).toBe(sampleBoardId);
      const matchesAuthor =
        !query.authorActorId || query.authorActorId === note.first.authorActorId;
      const pending =
        attachment?.state === FeedbackAttachmentState.PENDING ||
        attachment?.state === FeedbackAttachmentState.CLAIMED;
      const show = matchesAuthor && (!query.pendingAttachment || pending);

      return reply(listThreads.output, { threads: show ? [thread] : [], canWrite: true });
    }
    if (path === route(getThread)) {
      const query = fromBinary(getThread.input, bytes);
      expect(query).toMatchObject({ boardId: sampleBoardId, threadId: note.threadId });

      return reply(getThread.output, { thread, canWrite: true });
    }
    if (path !== route(applyFeedback)) {
      return undefined;
    }

    const request = fromBinary(applyFeedback.input, bytes);
    expect(request.boardId).toBe(sampleBoardId);
    const operation = request.operation;
    switch (operation.case) {
      case 'requestAttachment':
        expect(operation.value).toMatchObject({
          threadId: note.threadId,
          expectedThreadVersion: note.version,
        });
        expect(attachment).toBeUndefined();
        attachment = {
          requestId: attachmentRequestId,
          threadVersion: note.version,
          state: FeedbackAttachmentState.PENDING,
        };
        break;
      case 'claimAttachment':
        expect(operation.value).toMatchObject({
          threadId: note.threadId,
          requestId: attachmentRequestId,
        });
        expect(attachment?.state).toBe(FeedbackAttachmentState.PENDING);
        attachment = { ...attachment, state: FeedbackAttachmentState.CLAIMED };
        break;
      case 'confirmAttachment':
        expect(operation.value).toMatchObject({
          threadId: note.threadId,
          requestId: attachmentRequestId,
          claimId: 'claim-note',
        });
        expect(attachment?.state).toBe(FeedbackAttachmentState.CLAIMED);
        attachment = { ...attachment, state: FeedbackAttachmentState.ATTACHED };
        break;
      case 'create':
      case 'delete':
      case 'edit':
      case 'reopen':
      case 'reply':
      case 'resetAttachmentClaim':
      case 'resolve':
      case undefined:
        throw new Error('Unexpected note edit during suggestion review.');
    }
    actions.push(operation.case);
    expect(request.commandId).toBe(attachmentCommands[actions.length - 1]);

    return reply(applyFeedback.output, {
      receipt: {
        boardId: request.boardId,
        commandId: request.commandId,
        outcome: {
          case: 'applied',
          value: { threadId: note.threadId, threadVersion: note.version },
        },
      },
    });
  }

  return { post, actions, state: () => attachment?.state };
}

function createSuggestionRpc() {
  const whiteboard = createWhiteboardRpcMock();
  const feedback = feedbackRpc();
  const calls: string[] = [];
  let applied = false;

  const post: SuggestionPost = async (path, bytes) => {
    calls.push(path);
    const response = feedback.post(path, bytes);
    if (response) {
      return response;
    }

    if (path === route(listBoardSuggestions)) {
      const value = applied
        ? {
            ...suggestion,
            acceptedOptionId: 'move-right',
            acceptedBoardRevision: 1n,
            activeOptionIds: ['move-right'],
            proposalVersion: 1n,
          }
        : suggestion;

      return reply(listBoardSuggestions.output, { proposals: [value] });
    }
    if (path === route(createBoardReviewSource)) {
      const query = fromBinary(createBoardReviewSource.input, bytes);
      expect(query).toMatchObject({
        boardId: sampleBoardId,
        commandId: attachmentRequestId,
        origin: { case: 'feedbackThreadId', value: note.threadId },
      });
      expect(feedback.state()).toBe(FeedbackAttachmentState.CLAIMED);

      return reply(createBoardReviewSource.output, {
        source: {
          boardId: sampleBoardId,
          sourceId: suggestion.sourceId,
          capturedBoardRevision: 0n,
          targetsBoardRevision: 0n,
          objectIds: ['rectangle'],
          targets: [frozenTarget],
          feedbackThreadId: note.threadId,
        },
      });
    }
    if (path === route(previewBoardSuggestion)) {
      const query = fromBinary(previewBoardSuggestion.input, bytes);
      expect(query).toMatchObject({
        boardId: sampleBoardId,
        proposalId: suggestion.proposalId,
        optionId: 'move-right',
        expectedProposalVersion: 0n,
      });

      return reply(previewBoardSuggestion.output, {
        result: {
          case: 'preview',
          value: { boardRevision: 0n, changedObjects: [previewedObject] },
        },
      });
    }
    if (path === route(acceptBoardSuggestion)) {
      const query = fromBinary(acceptBoardSuggestion.input, bytes);
      expect(query).toMatchObject({
        boardId: sampleBoardId,
        commandId: boardCommandId,
        proposalId: suggestion.proposalId,
        optionId: 'move-right',
        expectedProposalVersion: 0n,
      });
      applied = true;

      return reply(acceptBoardSuggestion.output, {
        receipt: {
          boardId: sampleBoardId,
          commandId: boardCommandId,
          outcome: {
            case: 'applied',
            value: { boardRevision: 1n, changedObjects: [previewedObject] },
          },
        },
      });
    }

    return whiteboard.post(path, bytes);
  };

  return { post, calls, feedback };
}

function rectangle(stage: ParentNode) {
  const target = stage.querySelector<HTMLElement>('[data-canvas-object="rectangle"]');
  if (!target) {
    throw new Error('The staged board did not render the test rectangle.');
  }

  return target;
}

test('opens suggestions inside the notes panel, filters by author, previews and applies the acknowledged change', async () => {
  const rpc = createSuggestionRpc();
  const editService = createWhiteboardEditService(rpc.post);
  const suggestions = createSuggestionService(rpc.post, editService);
  type Attachment = AttachedReviewSource & {
    readonly boardId: string;
    readonly feedbackThreadId: string;
    readonly comment: string;
    readonly excerpt?: string;
  };
  const attached: Attachment[] = [];
  let issued = 0;
  const app = createAppMock(rpc.post, {
    feedbackService: createBoardFeedbackService(rpc.post),
    createCommandId: () => attachmentCommands[issued++] ?? boardCommandId,
    suggestions,
    async onAttachReviewSource(reference) {
      expect(rpc.feedback.state()).toBe(FeedbackAttachmentState.CLAIMED);
      attached.push(reference);
    },
  });

  try {
    await app.open(sampleBoardId);
    const shape = rectangle(app.canvas());
    expect(shape.style.left).toBe('40px');
    await app.drag({ x: 55, y: 55 }, { x: 55, y: 55 }, shape);
    expect(app.host.querySelector('button[aria-label="私人建议"]')).toBeNull();
    await app.click('备注列表');
    const panel = app.host.querySelector('[aria-label="所有备注"]');
    expect(panel?.querySelector('article[aria-label="私人建议"]')).not.toBeNull();
    expect(panel?.textContent).toContain(note.first.text);
    expect(panel?.textContent).not.toMatch(/复制选区引用|附加选区/u);
    expect(rpc.calls).not.toContain(route(createBoardReviewSource));

    await app.click('我发起');
    expect(panel?.querySelector('article[aria-label="私人建议"]')).toBeNull();
    expect(panel?.textContent).toContain(note.first.text);
    await app.click('全部');
    const authorFilter = panel?.querySelector('select');
    await act(async () => {
      if (authorFilter) {
        authorFilter.value = note.first.authorActorId;
        authorFilter.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(panel?.querySelector('article[aria-label="私人建议"]')).toBeNull();
    await act(async () => {
      if (authorFilter) {
        authorFilter.value = '';
        authorFilter.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    const showResolved = panel?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => showResolved?.click());
    expect(panel?.querySelector('article[aria-label="私人建议"]')).not.toBeNull();

    await app.click('展开备注 · ' + note.first.text);
    await app.click('备注操作');
    await app.click('附加到 Codex 对话');
    expect(attached).toEqual([
      {
        boardId: sampleBoardId,
        feedbackThreadId: note.threadId,
        comment: note.first.text,
        excerpt: note.anchor.frozenExcerpt,
        targetLabel: previewedObject.label,
        selectedTargets: [],
        sourceId: suggestion.sourceId,
        capturedBoardRevision: 0n,
        targetsBoardRevision: 0n,
        targets: [frozenTarget],
      },
    ]);
    expect(rpc.feedback.actions).toEqual([
      'requestAttachment',
      'claimAttachment',
      'confirmAttachment',
    ]);
    expect(rpc.feedback.state()).toBe(FeedbackAttachmentState.ATTACHED);

    const option = app.host.querySelector<HTMLButtonElement>('[aria-label="右移矩形"]');
    expect(option).not.toBeNull();
    await act(async () => option?.focus());
    const review = app.host.querySelector('[aria-label="只读方案预览"]');
    expect(review).not.toBeNull();
    expect(panel?.contains(review)).toBe(false);
    expect(rectangle(review ?? app.host).style.left).toBe('140px');
    expect(rectangle(app.canvas()).style.left).toBe('40px');
    expect(app.canvas().closest('[inert]')).not.toBeNull();
    expect(rpc.calls).not.toContain(route(acceptBoardSuggestion));

    await app.click('右移矩形');
    expect(app.host.querySelector('[aria-label="只读方案预览"]')).toBeNull();
    expect(rectangle(app.canvas()).style.left).toBe('140px');
    expect(rpc.calls.filter((path) => path === route(acceptBoardSuggestion))).toHaveLength(1);
    expect(app.host.querySelector('[aria-label="右移矩形"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  } finally {
    app.dispose();
  }
});

test('rejects an encoded source reply that adds an object beyond the explicit selection', async () => {
  const post: SuggestionPost = async () =>
    reply(createBoardReviewSource.output, {
      source: {
        boardId: sampleBoardId,
        sourceId: 'unexpected-scope',
        capturedBoardRevision: 0n,
        targetsBoardRevision: 0n,
        objectIds: ['rectangle', 'other-object'],
        targets: [frozenTarget, { ...frozenTarget, objectId: 'other-object' }],
      },
    });
  const service = createSuggestionService(post, createWhiteboardEditService(post));
  await expect(
    service.createReviewSource({
      boardId: sampleBoardId,
      commandId: boardCommandId,
      origin: { kind: 'selection', objectIds: ['rectangle'] },
    }),
  ).rejects.toThrow('冻结来源与原选区不匹配。');
});
