import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  FeedbackService,
  FeedbackThreadStatus,
  type FeedbackThreadSchema,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { act } from 'react';
import { expect, test } from 'vitest';
import { StudioApp, WhiteboardApp, type StudioAppProps } from '../../src/app/index.js';
import { createBoardFeedbackService, type FeedbackPost } from '../../src/data/feedback/index.js';
import {
  createBoardRoomSession,
  type BoardRoomEvent,
  type BoardRoomService,
  type BoardRoomStreamObserver,
} from '../../src/data/rooms/index.js';
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
  let threads: readonly (typeof noteThread)[] = [noteThread];
  const post: FeedbackPost = async (path, body) => {
    if (path.endsWith('/' + listThreads.name)) {
      expect(fromBinary(listThreads.input, body).boardId).toBe(sampleBoardId);
      return toBinary(
        listThreads.output,
        create(listThreads.output, { threads: [...threads], canWrite: true }),
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

  return {
    post,
    countThreadReads: () => reads,
    setThreads: (value: typeof threads) => {
      threads = value;
    },
  };
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
    const canvas = fixture.host.querySelector('[data-canvas-root]');
    if (!canvas) {
      throw new Error('The assembled board did not mount a canvas.');
    }

    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => new DOMRect(0, 48, 900, 600),
    });
    await act(async () => window.dispatchEvent(new Event('resize')));

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

test('refreshes an open discussion list after a room feedback event', async () => {
  const fixture = createControlFixture();
  const feedback = createFeedbackPost();
  feedback.setThreads([]);
  let observer: BoardRoomStreamObserver | undefined;
  const snapshot: BoardRoomEvent = {
    kind: 'snapshot',
    boardId: sampleBoardId,
    actorId: 'local',
    instanceId: 'review-room',
    sequence: 0n,
    revision: 0n,
    serverTimeUnixMs: 10,
    canEdit: true,
    participants: [],
    timer: { version: 0n, phase: 'idle', durationMs: 0, remainingMs: 0 },
    feedbackVersion: 0n,
  };
  const roomService: BoardRoomService = {
    subscribe(_boardId, _viewId, current) {
      observer = current;
      observer.onEvent(snapshot);
    },
    getRoom: async () => snapshot,
    updatePresence: async () => true,
    leavePresence: async () => true,
    changeTimer: async () => ({ serverTimeUnixMs: 10 }),
    getTimerReceipt: async () => ({ serverTimeUnixMs: 10 }),
  };
  const room = createBoardRoomSession({
    boardId: sampleBoardId,
    viewId: 'local-view',
    service: roomService,
    clock: { now: () => 10, schedule: () => () => undefined },
  });

  try {
    await act(async () =>
      fixture.render(
        <WhiteboardApp
          boardId={sampleBoardId}
          service={createWhiteboardService(createWhiteboardRpcMock().post)}
          createCommandId={() => 'review-command'}
          feedbackService={createBoardFeedbackService(feedback.post)}
          room={room}
        />,
      ),
    );
    const notes = findButton(fixture.host, notesLabel);
    await click(notes);
    expect(fixture.host.textContent).toContain('还没有备注');
    feedback.setThreads([noteThread]);
    await act(async () =>
      observer?.onEvent({
        ...snapshot,
        kind: 'feedbackChanged',
        sequence: 1n,
        version: 1n,
      }),
    );
    expect(notes.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.host.textContent).toContain(noteThread.first.text);
  } finally {
    fixture.dispose();
  }
});
