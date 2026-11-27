import { act } from 'react';
import { expect, test } from 'vitest';
import type {
  BoardFeedbackService,
  FeedbackContentTarget,
  FeedbackThread,
} from '../../src/data/feedback/index.js';
import type {
  WhiteboardEditService,
  WhiteboardObject,
  WhiteboardPayload,
  WhiteboardService,
} from '../../src/data/whiteboard/index.js';
import { createAppMock } from '../support/whiteboard-app-mock.js';

const boardId = 'feedback-content-board';
const objectId = 'notes-target';
const unitId = 'persistent-id';
const frozenPoint = { x: 60, y: 65 };
const documentBody = {
  kind: 'document',
  value: {
    title: '文档',
    document: {
      schemaVersion: 1,
      blocks: [{ id: unitId, type: 'paragraph', props: {}, content: '跟随的段落' }],
    },
  },
} as const satisfies WhiteboardPayload['body'];
const todoBody = {
  kind: 'todo',
  value: { title: '清单', items: [{ id: unitId, text: '跟随的任务', checked: false }] },
} as const satisfies WhiteboardPayload['body'];

function contentBoard(
  body: typeof documentBody | typeof todoBody,
  content: FeedbackContentTarget['content'],
) {
  const pendingEdit = () => {
    throw new Error('Locating feedback must not write to the board.');
  };
  const thread: FeedbackThread = {
    id: 'tracked',
    status: 'open',
    anchor: {
      target: {
        kind: 'content',
        objectId,
        geometryVersion: 0n,
        payloadVersion: 0n,
        u: 0.5,
        v: 0.5,
        content,
      },
      sourceRevision: 0n,
      frozenPoint,
      targetMissing: false,
    },
    first: {
      id: 'message',
      authorId: 'owner',
      authoredByViewer: true,
      text: '请检查重排后的目标',
      createdAt: 0,
      updatedAt: 0,
      version: 0n,
      canEdit: true,
    },
    version: 0n,
    updatedAt: 0,
    replyCount: 0,
    canResolve: true,
    canDelete: true,
  };
  const fallback = {
    ...thread,
    id: 'missing',
    anchor: { ...thread.anchor, targetMissing: true },
    first: { ...thread.first, text: '已删除目标的备注' },
  };
  const object = {
    id: objectId,
    kind: body.kind,
    label: body.value.title,
    geometry: { x: 0, y: 0, width: 900, height: 600, rotation: 0 },
    geometryVersion: 0n,
    payloadVersion: 0n,
    locked: false,
  } satisfies WhiteboardObject;
  const service = {
    getScene: async () => ({
      boardId,
      title: '内容备注',
      revision: 0n,
      canEdit: true,
      objects: [object],
    }),
    getPayloads: async () => [{ kind: 'loaded', payload: { id: objectId, body, version: 0n } }],
    moveObjects: pendingEdit,
    getReceipt: async () => undefined,
  } satisfies WhiteboardService;
  const editService = {
    editContent: pendingEdit,
    editGeometry: pendingEdit,
    attachImage: pendingEdit,
    getReceipt: async () => undefined,
  } satisfies WhiteboardEditService;
  const feedbackService = {
    listThreads: async () => ({ items: [thread, fallback], canWrite: true }),
    getThread: async ({ threadId }) => ({
      thread: threadId === thread.id ? thread : fallback,
      items: [],
      canWrite: true,
    }),
    apply: pendingEdit,
    getReceipt: async () => undefined,
  } satisfies BoardFeedbackService;

  return createAppMock(service, { editService, feedbackService });
}

function element(root: ParentNode, selector: string) {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) {
    throw new Error('Missing anchored feedback test element ' + selector);
  }

  return node;
}

async function draw() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function scrollTo(this: HTMLElement, options: ScrollToOptions) {
  this.scrollTop = options.top ?? this.scrollTop;
  this.scrollLeft = options.left ?? this.scrollLeft;
}

if (typeof HTMLElement.prototype.scrollTo !== 'function') {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, configurable: true });
}

const nativeCases = [
  {
    body: documentBody,
    content: { kind: 'document', blockIds: [unitId] },
    marker: 'data-document-read-block',
  },
  { body: todoBody, content: { kind: 'todo', itemId: unitId }, marker: 'data-todo-item-id' },
] as const;

test.each(nativeCases)(
  'follows a $content.kind reflow and reveals the unit from its list entry',
  async ({ body, content, marker }) => {
    const app = contentBoard(body, content);
    try {
      await app.open(boardId);
      const target = element(app.host, '[' + marker + ']');
      const tracked = element(app.host, '[data-feedback-pin="tracked"]');
      const missing = element(app.host, '[data-feedback-pin="missing"]');
      const frozenTop = missing.style.top;
      let y = 130;
      Object.defineProperty(target, 'getBoundingClientRect', {
        value: () => new DOMRect(120, y, 160, 30),
      });
      await app.update(() => target.setAttribute('data-test-layout', 'initial'));
      await draw();
      const liveTop = Number.parseFloat(tracked.style.top);
      expect(tracked.style.top).not.toBe(frozenTop);
      await app.update(() => {
        y += 75;
        target.setAttribute('data-test-layout', 'reordered');
      });
      await draw();
      expect(Number.parseFloat(tracked.style.top) - liveTop).toBeCloseTo(75);
      expect(missing.style.top).toBe(frozenTop);

      const reveals: ScrollIntoViewOptions[] = [];
      Object.defineProperty(target, 'scrollIntoView', {
        value: (options: ScrollIntoViewOptions) => reveals.push(options),
      });
      const zoom = element(app.host, '[aria-label="缩放菜单"]');
      const originalZoom = zoom.textContent;
      await app.click('备注列表');
      await app.click('展开备注 · 请检查重排后的目标');
      await draw();
      expect(reveals).toEqual([{ block: 'nearest', inline: 'nearest', container: 'nearest' }]);
      expect(element(app.host, '[data-expanded]').textContent).toContain('请检查重排后的目标');
      expect(zoom.textContent).toBe(originalZoom);
    } finally {
      app.dispose();
    }
  },
);

test('fits a compact Todo only when locating its hidden task', async () => {
  const app = contentBoard(todoBody, { kind: 'todo', itemId: unitId });
  try {
    await app.open(boardId);
    await app.click('缩放菜单');
    await app.click('25%');
    await draw();
    const todo = element(app.host, '[data-todo-layout]');
    const zoom = element(app.host, '[aria-label="缩放菜单"]');
    expect(zoom.textContent).toContain('25%');
    expect(todo.dataset.todoLayout).toBe('overview');
    expect(todo.querySelector('[data-todo-item-id]')).toBeNull();

    await app.click('备注列表');
    await app.click('展开备注 · 请检查重排后的目标');
    await draw();
    expect(zoom.textContent).not.toContain('25%');
    expect(todo.dataset.todoLayout).toBe('full');
    expect(element(todo, '[data-todo-item-id]').dataset.todoItemId).toBe(unitId);
  } finally {
    app.dispose();
  }
});
