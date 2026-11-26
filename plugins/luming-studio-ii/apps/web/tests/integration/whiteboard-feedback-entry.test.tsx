import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  FeedbackService,
  FeedbackThreadStatus,
  type FeedbackThreadSchema,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { act } from 'react';
import { expect, test } from 'vitest';
import { StudioApp, type StudioAppProps } from '../../src/app/index.js';
import { createBoardFeedbackService, type FeedbackPost } from '../../src/data/feedback/index.js';
import { createWhiteboardService } from '../../src/data/whiteboard/index.js';
import { createWhiteboardRpcMock, sampleBoardId } from '../fixtures/whiteboard-rpc.js';
import { createControlFixture } from '../support/render-control.js';

const { listThreads, getThread } = FeedbackService.method;
const notesLabel = '[aria-label="备注列表"]';
const noteThread = {
  threadId: 'first-review',
  status: FeedbackThreadStatus.OPEN,
  version: 1n,
  anchor: {
    target: { target: { case: 'boardPoint', value: { x: 100, y: 90 } } },
    sourceBoardRevision: 0n,
    frozenPoint: { x: 100, y: 90 },
  },
  first: {
    messageId: 'first-message',
    authorActorId: 'owner',
    text: '走一遍正式备注入口',
    version: 1n,
    authoredByViewer: true,
    canEdit: true,
  },
  canResolve: true,
  canDelete: true,
} satisfies MessageInitShape<typeof FeedbackThreadSchema>;

function findButton(host: HTMLElement, selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error('缺少白板备注入口：' + selector);
  }

  return button;
}

function click(button: HTMLButtonElement) {
  return act(async () => {
    button.focus();
    button.click();
  });
}

function createFeedbackPost() {
  let reads = 0;
  const post: FeedbackPost = async (path, body) => {
    if (path.endsWith('/' + listThreads.name)) {
      expect(fromBinary(listThreads.input, body).boardId).toBe(sampleBoardId);
      return toBinary(
        listThreads.output,
        create(listThreads.output, { threads: [noteThread], canWrite: true }),
      );
    }
    if (path.endsWith('/' + getThread.name)) {
      expect(fromBinary(getThread.input, body)).toMatchObject({
        boardId: sampleBoardId,
        threadId: noteThread.threadId,
      });
      reads += 1;
      return toBinary(
        getThread.output,
        create(getThread.output, { thread: noteThread, canWrite: true }),
      );
    }

    throw new Error('Unexpected feedback method ' + path);
  };

  return { post, countThreadReads: () => reads };
}

test('opens discussion through the assembled Studio board and transfers focus to the original pin', async () => {
  const fixture = createControlFixture();
  const rpc = createWhiteboardRpcMock();
  const feedback = createFeedbackPost();
  const props: StudioAppProps = {
    service: createWhiteboardService(rpc.post),
    feedbackService: createBoardFeedbackService(feedback.post),
    createCommandId: () => 'review-command',
    catalog: {
      listBoards: () => Promise.resolve({ boards: [] }),
      createBoard: ({ commandId }) =>
        Promise.resolve({ kind: 'rejected', commandId, reason: 'invalidTitle' }),
      getReceipt: () => Promise.resolve(undefined),
    },
    navigation: {
      read: () => ({ kind: 'whiteboard', boardId: sampleBoardId }),
      write: () => undefined,
      subscribe: () => () => undefined,
    },
    preferences: {
      layout: 'grid',
      resolvedTheme: 'dark',
      rememberLayout: () => undefined,
      rememberTheme: () => undefined,
    },
  };

  try {
    await act(async () => fixture.render(<StudioApp {...props} />));
    const notes = findButton(fixture.host, notesLabel);
    expect(notes.disabled).toBe(false);
    Object.defineProperty(notes, 'getBoundingClientRect', {
      value: () => new DOMRect(820, 6, 36, 32),
    });
    await click(notes);
    expect(notes.getAttribute('aria-expanded')).toBe('true');
    const list = fixture.host.querySelector<HTMLElement>('[role="dialog"][aria-label="所有备注"]');
    expect(list?.style.left).toBe('496px');
    expect(list?.style.top).toBe('48px');

    const pin = findButton(fixture.host, '[data-feedback-pin="first-review"]');
    await click(pin);
    expect(feedback.countThreadReads()).toBe(1);
    expect(fixture.host.textContent).toContain('保存版次 0');
    expect(notes.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.host.querySelector('[role="dialog"][aria-label="备注线程"]')).not.toBeNull();

    await click(findButton(fixture.host, '[aria-label="关闭备注"]'));
    expect(notes.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(pin);
    expect(rpc.moves).toHaveLength(0);
  } finally {
    fixture.dispose();
  }
});
