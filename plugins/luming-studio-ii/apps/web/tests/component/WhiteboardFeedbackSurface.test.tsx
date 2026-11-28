import { act, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  BoardFeedbackService,
  FeedbackContentTarget,
  FeedbackPage,
  FeedbackThread,
  FeedbackThreadPage,
} from '../../src/data/feedback/index.js';
import {
  WhiteboardFeedbackSurface,
  type FeedbackCanvasObject,
  type WhiteboardFeedbackSurfaceProps,
} from '../../src/surfaces/whiteboard-feedback/index.js';
import { createControlFixture } from '../support/render-control.js';

const boardId = 'review-board';
const card = {
  id: 'card',
  label: '待复核',
  geometryVersion: 7n,
  geometry: { x: 100, y: 50, width: 100, height: 40, rotation: 90 },
} satisfies FeedbackCanvasObject;
const viewport = { x: 20, y: 30, zoom: 2 };
const sample: FeedbackThread = {
  id: 'thread',
  status: 'open',
  anchor: {
    target: { kind: 'object', objectId: 'card', u: 0.75, v: 0.25, geometryVersion: 7n },
    sourceRevision: 12n,
    frozenPoint: { x: 7, y: 8 },
    frozenObject: { ...card.geometry, label: card.label, kind: 'shape' },
    targetMissing: false,
  },
  first: {
    id: 'message',
    authorId: 'editor-one',
    authoredByViewer: true,
    text: '核对流程卡片',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    version: 1n,
    canEdit: true,
  },
  version: 1n,
  updatedAt: 1_700_000_000_000,
  replyCount: 0,
  canResolve: true,
  canDelete: true,
};

let fixture: ReturnType<typeof createControlFixture>;

function showModal(this: HTMLDialogElement) {
  this.open = true;
}

function close(this: HTMLDialogElement) {
  this.open = false;
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: close, configurable: true },
  });
}

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => {
  fixture.dispose();
});

function Harness(props: Omit<WhiteboardFeedbackSurfaceProps, 'panelOpen' | 'onPanelOpenChange'>) {
  const [panelOpen, setOpen] = useState(false);

  return (
    <div>
      <button type="button" aria-label="画布" />
      <WhiteboardFeedbackSurface {...props} panelOpen={panelOpen} onPanelOpenChange={setOpen} />
      <button type="button" onClick={() => setOpen(true)}>
        打开备注
      </button>
    </div>
  );
}

function element<T extends HTMLElement>(selector: string): T {
  const match = fixture.host.querySelector<T>(selector);
  if (!match) {
    throw new Error('Missing feedback control ' + selector);
  }

  return match;
}

function button(label: string): HTMLButtonElement {
  const match = [...fixture.host.querySelectorAll('button')].find(
    (candidate) =>
      candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label,
  );

  if (!match) {
    throw new Error('Missing feedback action ' + label);
  }

  return match;
}

async function click(label: string) {
  await act(async () => {
    const control = button(label);
    control.focus();
    control.click();
  });
}

async function typeMessage(text: string) {
  const area = element<HTMLTextAreaElement>('textarea');
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (!nativeValue?.set) {
    throw new Error('Native text area value setter is missing.');
  }

  await act(async () => {
    nativeValue.set?.call(area, text);
    area.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}

async function clickPin(threadId = sample.id) {
  const pin = element<HTMLButtonElement>(`[data-feedback-pin="${threadId}"]`);
  await act(async () => {
    pin.focus();
    pin.click();
  });
}

async function chooseAction(label: string, action: string) {
  await click(label);
  await click(action);
}

function testService(thread: FeedbackThread = sample, canWrite = true) {
  const getThread = vi.fn<BoardFeedbackService['getThread']>().mockResolvedValue({
    thread,
    items: [],
    canWrite,
  } satisfies FeedbackThreadPage);
  const listThreads = vi
    .fn<BoardFeedbackService['listThreads']>()
    .mockResolvedValue({ items: [thread], canWrite });
  const apply = vi.fn<BoardFeedbackService['apply']>().mockResolvedValue({
    kind: 'applied',
    threadId: 'thread',
    threadVersion: 2n,
    deleted: false,
  });
  const getReceipt = vi.fn<BoardFeedbackService['getReceipt']>().mockResolvedValue(undefined);

  return { getThread, listThreads, apply, getReceipt };
}

async function render(
  service: BoardFeedbackService,
  overrides: Partial<WhiteboardFeedbackSurfaceProps> = {},
) {
  await act(async () => {
    fixture.render(
      <Harness
        boardId={boardId}
        canEdit
        viewing={false}
        viewport={viewport}
        objects={[card]}
        selectedIds={[card.id]}
        service={service}
        createCommandId={() => 'feedback-command'}
        {...overrides}
      />,
    );
  });
}

test('creates an anchored note and retains the identical command when the write response is lost', async () => {
  const service = testService();
  service.apply.mockRejectedValueOnce(new Error('连接中断'));
  await render(service, { annotationRequest: { objectId: card.id, sequence: 1 } });
  expect(
    element('[aria-label="新建备注"]').classList.contains('whiteboard-feedback__popup--draft'),
  ).toBe(true);
  expect(document.activeElement).toBe(element('textarea'));
  await typeMessage('请复核箭头');
  await click('保存备注');

  expect(service.getReceipt).toHaveBeenCalledExactlyOnceWith(
    boardId,
    'feedback-command',
    expect.any(AbortSignal),
  );
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('请复核箭头');
  expect(fixture.host.textContent).toContain('尚未确认保存结果');

  await click('重试本次保存');

  const [first, retry] = service.apply.mock.calls;
  expect(first?.[0]).toEqual({
    boardId,
    commandId: 'feedback-command',
    operation: {
      kind: 'create',
      text: '请复核箭头',
      anchor: {
        kind: 'object',
        objectId: 'card',
        geometryVersion: 7n,
        u: expect.closeTo(0.08),
        v: expect.closeTo(0.2),
      },
    },
  });
  expect(retry?.[0]).toBe(first?.[0]);
  expect(service.getThread).toHaveBeenCalledWith(
    expect.objectContaining({ threadId: 'thread' }),
    expect.any(AbortSignal),
  );
});

test('anchors a selected large object inside its visible corner and keeps the same author badge after posting', async () => {
  const object = {
    ...card,
    geometry: { x: -300, y: -200, width: 2000, height: 1500, rotation: 0 },
  };
  const anchor = {
    kind: 'object',
    objectId: object.id,
    geometryVersion: 7n,
    u: 0.834,
    v: 0.088,
  } as const;
  const thread = { ...sample, anchor: { ...sample.anchor, target: anchor } };
  const service = testService(thread);
  service.listThreads.mockResolvedValue({ items: [], canWrite: true });
  service.apply.mockImplementationOnce(async () => {
    service.listThreads.mockResolvedValue({ items: [thread], canWrite: true });

    return { kind: 'applied', threadId: thread.id, threadVersion: 2n, deleted: false };
  });
  const view = { objects: [object], viewport: { x: 100, y: 50, zoom: 0.5 } };
  await render(service, view);
  vi.spyOn(element('.whiteboard-feedback'), 'getBoundingClientRect').mockReturnValue(
    new DOMRect(40, 60, 800, 600),
  );
  await render(service, { ...view, annotationRequest: { objectId: card.id, sequence: 1 } });
  const draft = element('.whiteboard-feedback__draft-pin');
  expect(draft.textContent).toBe('我');
  expect(draft.style.left).toBe('784px');
  expect(draft.style.top).toBe('16px');

  await typeMessage('可见位置已复核');
  await click('保存备注');

  expect(service.apply).toHaveBeenCalledExactlyOnceWith(
    {
      boardId,
      commandId: 'feedback-command',
      operation: {
        kind: 'create',
        anchor: { ...anchor, u: expect.closeTo(anchor.u), v: expect.closeTo(anchor.v) },
        text: '可见位置已复核',
      },
    },
    expect.any(AbortSignal),
  );
  const posted = element('[data-feedback-pin="thread"]');
  expect(posted.textContent).toBe(draft.textContent);
  expect(posted.style.backgroundColor).toBe(draft.style.backgroundColor);
  expect(posted.style.left).toBe(draft.style.left);
  expect(posted.style.top).toBe(draft.style.top);
  expect(fixture.host.querySelector('.whiteboard-feedback__draft-pin')).toBeNull();
});

test('saves before attaching, then retries the original attachment without saving again', async () => {
  const service = testService();
  service.apply.mockRejectedValueOnce(new Error('保存请求尚未确认'));
  const onAttachThread = vi.fn<NonNullable<WhiteboardFeedbackSurfaceProps['onAttachThread']>>();
  onAttachThread.mockRejectedValueOnce(new Error('宿主没有确认附加'));
  const createCommandId = vi.fn(() => 'attachment-command').mockReturnValueOnce('save-command');

  await render(service, {
    annotationRequest: { objectId: card.id, sequence: 1 },
    onAttachThread,
    createCommandId,
  });
  await typeMessage('保存后附加到对话');
  expect(fixture.host.textContent).toContain('附加到 Codex 对话');
  await act(async () => element<HTMLInputElement>('input[type="checkbox"]').click());
  await click('保存备注');
  expect(onAttachThread).not.toHaveBeenCalled();

  await click('重试本次保存');
  expect(service.apply.mock.calls.map(([command]) => command.commandId)).toEqual([
    'save-command',
    'save-command',
  ]);
  expect(fixture.host.textContent).toContain('备注已保存，附加失败后可直接重试。');
  await click('重试附加');

  const attached = { boardId, threadId: sample.id, commandId: 'attachment-command' };
  expect(onAttachThread.mock.calls).toEqual([
    [{ ...attached, signal: expect.any(AbortSignal) }],
    [{ ...attached, signal: expect.any(AbortSignal) }],
  ]);
  expect(service.apply).toHaveBeenCalledTimes(2);
});

test('keeps the discussion actions available without an unsupported Codex attachment', async () => {
  const service = testService();
  await render(service, { annotationRequest: { objectId: card.id, sequence: 1 } });
  expect(fixture.host.textContent).not.toContain('附加到 Codex 对话');
  expect(fixture.host.textContent).not.toContain('复制批注引用');
  await click('取消');
  await clickPin();
  await click('备注操作');
  expect(fixture.host.textContent).toContain('定位备注');
  expect(fixture.host.textContent).not.toContain('附加到 Codex 对话');
  expect(fixture.host.textContent).not.toContain('使用此批注作为建议来源');
});

test('keeps the notes pager in place while appending the next page', async () => {
  const service = testService();
  const older = {
    ...sample,
    id: 'older-thread',
    first: { ...sample.first, id: 'older-message', text: '较早的复核意见' },
  };
  let resolve!: (page: FeedbackPage<FeedbackThread>) => void;
  const promise = new Promise<FeedbackPage<FeedbackThread>>((accept) => {
    resolve = accept;
  });
  service.listThreads.mockImplementation(async ({ cursor }) =>
    cursor ? promise : { items: [sample], canWrite: true, nextCursor: 'older' },
  );
  await render(service);
  await click('打开备注');
  const pager = button('更多备注');
  expect(pager.getAttribute('data-variant')).toBe('ghost');
  await click('更多备注');
  expect(button('加载中…')).toBe(pager);
  expect(pager.getAttribute('aria-busy')).toBe('true');
  expect(fixture.host.textContent).toContain(sample.first.text);

  await act(async () => resolve({ items: [older], canWrite: true }));
  expect(fixture.host.textContent).toContain(older.first.text);
  expect(fixture.host.textContent).toContain(sample.first.text);
  expect(fixture.host.querySelector('.whiteboard-feedback__pager')).toBeNull();
});

test('requests the viewer filter even when their notes are absent from the loaded page', async () => {
  const service = testService();
  const peer = {
    ...sample,
    id: 'peer-thread',
    first: {
      ...sample.first,
      id: 'peer-message',
      authorId: 'reviewer',
      authoredByViewer: false,
      text: '最近来自其他作者的备注',
    },
  };
  service.listThreads.mockImplementation(async ({ authoredByViewer }) =>
    authoredByViewer
      ? { items: [sample], canWrite: true }
      : { items: [peer], canWrite: true, nextCursor: 'older-notes' },
  );
  await render(service);
  await click('打开备注');
  expect(fixture.host.textContent).toContain(peer.first.text);
  expect(fixture.host.textContent).not.toContain(sample.first.text);

  await click('我发起');
  expect(service.listThreads).toHaveBeenCalledWith(
    expect.objectContaining({ authoredByViewer: true, cursor: undefined, authorId: undefined }),
    expect.any(AbortSignal),
  );
  const list = element('[aria-label="备注讨论"]');
  expect(list.textContent).toContain(sample.first.text);
  expect(list.textContent).not.toContain(peer.first.text);
});

test('keeps author colors consistent across pins, the list, threads and viewers', async () => {
  const owner = { id: 'owner-id', text: '所有者的备注', color: '#785ee8' };
  const guest = { id: 'guest-id', text: '来宾的备注', color: '#fbb315' };
  const owners = [owner, guest];
  const colorForAuthor = (actorId: string) => (actorId === owner.id ? owner.color : guest.color);
  const service = testService();

  async function readAs(viewerActorId: string) {
    const threads = owners.map(({ id, text }) => ({
      ...sample,
      id,
      first: { ...sample.first, text, authorId: id, authoredByViewer: id === viewerActorId },
    }));
    service.listThreads.mockResolvedValue({ items: threads, canWrite: true });
    service.getThread.mockImplementation(async ({ threadId }) => {
      const thread = threads.find(({ id }) => id === threadId);
      if (!thread) {
        throw new Error('Could not find the fixture discussion');
      }

      return { thread, canWrite: true, items: [] };
    });
    await render(service, { viewerActorId, colorForAuthor, updateKey: viewerActorId });
    await click('打开备注');

    const colors = new Map<string, string>();
    for (const { id, text } of owners) {
      const pin = element(`[data-feedback-pin="${id}"]`);
      const avatar = button('展开备注 · ' + text).querySelector<HTMLElement>(
        '.whiteboard-feedback__avatar',
      );
      expect(avatar?.style.backgroundColor).toBe(pin.style.backgroundColor);
      colors.set(id, pin.style.backgroundColor);
    }
    await click('展开备注 · ' + owner.text);
    expect(
      element('.whiteboard-feedback__thread .whiteboard-feedback__avatar').style.backgroundColor,
    ).toBe(colors.get(owner.id));
    await click('关闭备注');

    return colors;
  }

  const before = await readAs(owner.id);
  expect(before.get(owner.id)).not.toBe(before.get(guest.id));
  expect(await readAs(guest.id)).toEqual(before);
});

test('creates a real document-block anchor and locates its resolved position', async () => {
  const target = {
    kind: 'content',
    objectId: card.id,
    u: 0.75,
    v: 0.25,
    geometryVersion: 7n,
    payloadVersion: 4n,
    content: { kind: 'document', blockIds: ['selected-paragraph'] },
  } satisfies FeedbackContentTarget;
  const service = testService({
    ...sample,
    anchor: { ...sample.anchor, target, frozenExcerpt: '保留选择的原文' },
  });
  const focusWorldPoint = vi.fn<(point: { x: number; y: number }) => void>();
  const contentPoint = { x: 156, y: 64 };

  await render(service, {
    contentAnnotationRequest: { sequence: 1, target },
    contentPoints: new Map([[sample.id, contentPoint]]),
    focusWorldPoint,
  });
  expect(fixture.host.textContent).toContain('文档段落');
  await typeMessage('请核对选中的段落');
  await click('保存备注');
  expect(service.apply.mock.calls[0]?.[0].operation).toEqual({
    kind: 'create',
    text: '请核对选中的段落',
    anchor: target,
  });
  expect(fixture.host.textContent).toContain('保留选择的原文');
  await chooseAction('备注操作', '定位备注');
  expect(focusWorldPoint).toHaveBeenCalledWith(contentPoint);
});

test.each([
  { content: { kind: 'document', blockIds: ['paragraph'] }, caption: '文档段落' },
  { content: { kind: 'todo', itemId: 'task' }, caption: '待办事项' },
  { content: { kind: 'html', nodeIds: ['node'], sourceRevision: 1n }, caption: 'HTML 内部选区' },
] as const)('keeps the precise $caption location while posting', async ({ content, caption }) => {
  const object = { ...card, kind: content.kind, label: '评审记录' };
  const target = {
    kind: 'content',
    objectId: object.id,
    geometryVersion: object.geometryVersion,
    payloadVersion: 4n,
    u: 0.75,
    v: 0.25,
    content,
  } satisfies FeedbackContentTarget;
  const thread = {
    ...sample,
    anchor: {
      ...sample.anchor,
      target,
      frozenObject: { ...object.geometry, label: object.label, kind: object.kind },
      frozenExcerpt: '发布时的原文',
    },
  };
  const service = testService(thread);
  service.listThreads.mockResolvedValue({ items: [], canWrite: true });
  let publish!: (page: FeedbackPage<FeedbackThread>) => void;
  const refresh = new Promise<FeedbackPage<FeedbackThread>>((accept) => {
    publish = accept;
  });
  service.apply.mockImplementationOnce(async () => {
    service.listThreads.mockReturnValue(refresh);

    return { kind: 'applied', threadId: thread.id, threadVersion: 2n, deleted: false };
  });
  const onContentLocationRequests =
    vi.fn<NonNullable<WhiteboardFeedbackSurfaceProps['onContentLocationRequests']>>();
  const options = {
    objects: [object],
    contentAnnotationRequest: { sequence: 1, target, excerpt: '选取的原文' },
    onContentLocationRequests,
    viewerActorId: sample.first.authorId,
    colorForAuthor: () => '#ce447d',
  };
  await render(service, options);
  const request = onContentLocationRequests.mock.lastCall?.[0]?.get(object.id)?.[0];
  expect(request).toEqual({
    id: expect.any(String),
    target: content,
    u: target.u,
    v: target.v,
    reveal: undefined,
  });
  const point = { x: 156, y: 64 };
  expect(request).toBeDefined();
  if (!request) {
    throw new Error('Missing location for the pending note');
  }

  await render(service, { ...options, contentLocations: new Map([[request.id, { point }]]) });

  const captionText = caption + ' · ' + object.label;
  const draftSelector = '.whiteboard-feedback__draft-pin';
  const position = { left: '332px', top: '158px' };
  expect(element('.whiteboard-feedback__target-label').textContent).toBe(captionText);
  expect(element('blockquote').textContent).toBe('选取的原文');
  expect(element(draftSelector).style).toMatchObject(position);

  const color = element(draftSelector).style.backgroundColor;
  await typeMessage('请核对这里');
  await click('保存备注');

  expect(service.apply.mock.calls[0]?.[0].operation).toEqual({
    kind: 'create',
    text: '请核对这里',
    anchor: target,
  });
  expect(element(draftSelector).style).toMatchObject(position);
  expect(element('.whiteboard-feedback__target-label').textContent).toBe(captionText);
  expect(element('blockquote').textContent).toBe('发布时的原文');
  await act(async () => publish({ items: [thread], canWrite: true }));
  expect(element('[data-feedback-pin="thread"]').style).toMatchObject(position);
  expect(element('[data-feedback-pin="thread"]').style.backgroundColor).toBe(color);
  expect(fixture.host.querySelector(draftSelector)).toBeNull();
});

test('clips saved pins above the whiteboard while keeping the open thread and list accessible', async () => {
  const service = testService();
  const viewportSize = { width: 670, height: 400 };
  const options = { viewportSize };
  await render(service, options);
  vi.spyOn(element('.whiteboard-feedback'), 'getBoundingClientRect').mockReturnValue(
    new DOMRect(60, 96, viewportSize.width, viewportSize.height),
  );
  const pin = '[data-feedback-pin="thread"]';
  await clickPin();
  expect(element(pin).parentElement?.classList.contains('whiteboard-feedback__pin-layer')).toBe(
    true,
  );

  await render(service, { ...options, viewport: { ...viewport, y: -400, zoom: 1.25 } });
  expect(fixture.host.querySelector(pin)).toBeNull();
  const popup = element('[aria-label="备注线程"]');
  expect(Number.parseFloat(popup.style.top)).toBeGreaterThanOrEqual(96);
  expect(Number.parseFloat(popup.style.left)).toBeGreaterThanOrEqual(60);
  expect(Number.parseFloat(popup.style.maxHeight)).toBeLessThanOrEqual(viewportSize.height);

  await render(service, options);
  expect(element(pin).getAttribute('data-selected')).toBe('true');
  await click('打开备注');
  expect(element('[aria-label="备注讨论"]').textContent).toContain(sample.first.text);
});

test('clips the draft pin after panning and keeps the draft available in the whiteboard', async () => {
  const options = {
    viewportSize: { width: 380, height: 280 },
    annotationRequest: { objectId: card.id, sequence: 1, u: 0.75, v: 0.25 },
  };
  const service = testService();
  await render(service, options);
  vi.spyOn(element('.whiteboard-feedback'), 'getBoundingClientRect').mockReturnValue(
    new DOMRect(30, 80, options.viewportSize.width, options.viewportSize.height),
  );
  await typeMessage('平移时继续写');
  const draft = '.whiteboard-feedback__draft-pin';
  expect(element(draft)).toBeDefined();
  await render(service, { ...options, viewport: { ...viewport, y: -400 } });
  expect(fixture.host.querySelector(draft)).toBeNull();
  const popup = element('[aria-label="新建备注"]');
  expect(Number.parseFloat(popup.style.top)).toBeGreaterThanOrEqual(80);
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('平移时继续写');
  await render(service, options);
  expect(element(draft)).toBeDefined();
});

test('lets the host pick directly, keeps Escape and applies only a new point request', async () => {
  const service = testService();
  const onAnnotationActiveChange = vi.fn<(active: boolean) => void>();
  const point = { x: 150, y: 70 };
  const options = {
    hostPicking: true,
    annotationActive: true,
    focusedObjectId: card.id,
    objects: [card, { ...card, id: 'overlapping-hidden', label: '重叠的隐藏对象' }],
    onAnnotationActiveChange,
  };
  await render(service, { ...options, pointAnnotationRequest: { sequence: 1, point } });

  expect(fixture.host.querySelector('[aria-label="在白板选取备注位置"]')).toBeNull();
  expect(fixture.host.textContent).toContain(card.label);
  const escape = () =>
    act(async () =>
      button('画布').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  await escape();
  expect(fixture.host.querySelector('[aria-label="新建备注"]')).toBeNull();
  await escape();
  expect(onAnnotationActiveChange).toHaveBeenLastCalledWith(false);

  await render(service, { ...options, pointAnnotationRequest: { sequence: 1, point } });
  expect(fixture.host.querySelector('[aria-label="新建备注"]')).toBeNull();
  await render(service, {
    ...options,
    pointAnnotationRequest: { sequence: 2, point: { x: -5, y: -6 } },
  });
  expect(fixture.host.textContent).toContain('画板位置');
  await escape();
  await render(service, { ...options, pointAnnotationRequest: { sequence: 3, point } });
  await typeMessage('宿主取得的选择');
  await click('保存备注');
  expect(service.apply.mock.calls[0]?.[0].operation).toMatchObject({
    kind: 'create',
    anchor: { kind: 'object', objectId: card.id, geometryVersion: 7n, u: 0.5, v: 0.5 },
  });
});

test('projects only the focused document pins with independent vertical zoom and keeps other notes listed', async () => {
  const service = testService();
  const boardPoint = { x: 10, y: 10 };
  const boardNote: FeedbackThread = {
    ...sample,
    id: 'board-note',
    anchor: {
      ...sample.anchor,
      target: { kind: 'board', point: boardPoint },
      frozenPoint: boardPoint,
    },
    first: { ...sample.first, text: '普通画板上的备注' },
  };
  service.listThreads.mockResolvedValue({ items: [sample, boardNote], canWrite: true });
  await render(service, { focusedObjectId: card.id, viewport: { ...viewport, zoomY: 3 } });

  const pin = element<HTMLButtonElement>('[data-feedback-pin="thread"]');
  expect(pin.style.left).toBe('340px');
  expect(pin.style.top).toBe('315px');
  expect(fixture.host.querySelector('[data-feedback-pin="board-note"]')).toBeNull();

  await click('打开备注');
  const list = element('[aria-label="备注讨论"]');
  expect(list.textContent).toContain(sample.first.text);
  expect(list.textContent).toContain(boardNote.first.text);
});

test('uses 9 to pick a world coordinate without mutating the Canvas', async () => {
  const service = testService();
  await render(service, { selectedIds: [] });

  await act(async () => {
    button('画布').dispatchEvent(
      new KeyboardEvent('keydown', { key: '9', bubbles: true, cancelable: true }),
    );
  });
  const picking = button('在白板选取备注位置');

  await act(async () => {
    picking.dispatchEvent(
      new MouseEvent('click', { detail: 1, bubbles: true, clientX: 98, clientY: 120 }),
    );
  });
  await typeMessage('白板上的意见');
  await click('保存备注');

  expect(service.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: {
        kind: 'create',
        anchor: { kind: 'board', point: { x: 39, y: 45 } },
        text: '白板上的意见',
      },
    }),
    expect.any(AbortSignal),
  );
});

test('projects rotated object pins and falls back to the frozen point with reader permissions', async () => {
  const readOnly = {
    ...sample,
    canResolve: false,
    canDelete: false,
    first: { ...sample.first, canEdit: false },
  };
  const service = testService(readOnly, false);
  const focusWorldPoint = vi.fn();
  await render(service, { canEdit: false, focusWorldPoint });
  const pin = element<HTMLButtonElement>('[data-feedback-pin="thread"]');
  expect(pin.style.left).toBe('340px');
  expect(pin.style.top).toBe('220px');

  await clickPin();
  await chooseAction('备注操作', '定位备注');
  expect(focusWorldPoint).toHaveBeenLastCalledWith({ x: 160, y: 95 });
  expect(fixture.host.querySelector('[aria-label="解决"]')).toBeNull();
  await click('备注操作');
  expect(
    Array.from(
      element('[role="menu"]').querySelectorAll('[role="menuitem"]'),
      (item) => item.textContent,
    ),
  ).toEqual(['定位备注']);
  await click('定位备注');

  await render(service, { objects: [], canEdit: false, focusWorldPoint });
  expect(element<HTMLButtonElement>('[data-feedback-pin="thread"]').style.left).toBe('34px');
  expect(element<HTMLButtonElement>('[data-feedback-pin="thread"]').style.top).toBe('46px');
  expect(fixture.host.textContent).toContain('原对象已删除');

  await chooseAction('备注操作', '定位备注');
  expect(focusWorldPoint).toHaveBeenLastCalledWith({ x: 7, y: 8 });
  expect(service.apply).not.toHaveBeenCalled();
});

test('requires explicit confirmation to delete and uses the confirmed thread version', async () => {
  const service = testService();
  await render(service);
  await clickPin();
  await chooseAction('备注操作', '删除备注线程');
  expect(element('[aria-label="删除备注确认"]')).toBeDefined();
  expect(service.apply).not.toHaveBeenCalled();

  await click('取消');
  expect(fixture.host.querySelector('[aria-label="删除备注确认"]')).toBeNull();
  expect(document.activeElement).toBe(button('备注操作'));

  await chooseAction('备注操作', '删除备注线程');
  await click('确认删除');
  expect(service.apply).toHaveBeenCalledWith(
    {
      boardId,
      commandId: 'feedback-command',
      operation: { kind: 'delete', threadId: 'thread', expectedVersion: sample.version },
    },
    expect.any(AbortSignal),
  );
});

test('uses server message and thread versions when editing, replying and reopening', async () => {
  const thread = { ...sample, status: 'resolved' as const, version: 4n };
  const service = testService(thread);
  await render(service);
  await click('打开备注');
  await act(async () =>
    element<HTMLInputElement>('.whiteboard-feedback__resolved-filter input').click(),
  );
  await clickPin();

  await chooseAction('备注操作', '编辑');
  await typeMessage('复核后的正文');
  await click('保存');
  expect(service.apply).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: {
        kind: 'edit',
        threadId: 'thread',
        messageId: sample.first.id,
        expectedVersion: sample.first.version,
        text: '复核后的正文',
      },
    }),
    expect.any(AbortSignal),
  );

  await typeMessage('核对通过');
  await click('发送回复');
  expect(service.apply).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: { kind: 'reply', threadId: 'thread', text: '核对通过' },
    }),
    expect.any(AbortSignal),
  );

  await chooseAction('备注操作', '重新打开');
  expect(service.apply).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: { kind: 'reopen', threadId: 'thread', expectedVersion: 4n },
    }),
    expect.any(AbortSignal),
  );
});

test('filters by authoritative author and status with independently loaded pins', async () => {
  const service = testService();
  await render(service);
  await click('打开备注');
  const author = element<HTMLSelectElement>('select');
  const authored = [...author.options].find((option) => option.value === sample.first.authorId);
  expect(authored?.textContent).toBe('我');

  await act(async () => {
    author.value = sample.first.authorId;
    author.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(service.listThreads).toHaveBeenLastCalledWith(
    expect.objectContaining({ boardId, status: 'open', authorId: sample.first.authorId }),
    expect.any(AbortSignal),
  );

  await act(async () =>
    element<HTMLInputElement>('.whiteboard-feedback__resolved-filter input').click(),
  );
  expect(service.listThreads).toHaveBeenCalledWith(
    expect.objectContaining({ boardId, status: undefined, authorId: sample.first.authorId }),
    expect.any(AbortSignal),
  );
  expect(element<HTMLButtonElement>('[data-feedback-pin="thread"]')).toBeDefined();
});

test('keeps all feedback controls hidden in history and presentation views', async () => {
  const service = testService();
  await render(service, { viewing: true });
  await click('打开备注');
  await act(async () => {
    button('画布').dispatchEvent(new KeyboardEvent('keydown', { key: '9', bubbles: true }));
  });

  expect(fixture.host.querySelector('[aria-label="备注列表面板"]')).toBeNull();
  expect(fixture.host.querySelector('[aria-label="在白板选取备注位置"]')).toBeNull();
  expect(service.listThreads).not.toHaveBeenCalled();
  expect(service.apply).not.toHaveBeenCalled();
});

test('retains an unfinished reply when returning to the list and opening the discussion again', async () => {
  const service = testService();
  await render(service);
  await click('打开备注');
  await click('展开备注 · 核对流程卡片');
  expect(
    element('.whiteboard-feedback__list-row[data-expanded]').contains(element('textarea')),
  ).toBe(true);
  await typeMessage('带回讨论的草稿');
  await click('关闭备注');

  const entry = button('展开备注 · 核对流程卡片');
  expect(entry.textContent).toContain('未保存的草稿');
  expect(document.activeElement).toBe(entry);
  await click('展开备注 · 核对流程卡片');
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('带回讨论的草稿');
  await click('发送回复');
  expect(service.apply).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: { kind: 'reply', threadId: 'thread', text: '带回讨论的草稿' },
    }),
    expect.any(AbortSignal),
  );
});

test('preserves the draft through resolving and reopening the same discussion', async () => {
  const service = testService();
  service.apply.mockImplementation(async ({ operation }) => {
    const status = operation.kind === 'resolve' ? 'resolved' : 'open';
    const thread = { ...sample, status } satisfies FeedbackThread;
    service.getThread.mockResolvedValue({ thread, items: [], canWrite: true });
    return { kind: 'applied', threadId: thread.id, threadVersion: 2n, deleted: false };
  });
  await render(service);
  await clickPin();
  await typeMessage('继续补充细节');

  await click('解决');
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('继续补充细节');
  await chooseAction('备注操作', '重新打开');
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('继续补充细节');

  await click('发送回复');
  expect(service.apply).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: { kind: 'reply', threadId: 'thread', text: '继续补充细节' },
    }),
    expect.any(AbortSignal),
  );
});

test('keeps a changed edit until discarding it for a different message is confirmed', async () => {
  const service = testService();
  const reply = { ...sample.first, id: 'reply', text: '第二条消息' };
  service.getThread.mockResolvedValue({ thread: sample, items: [reply], canWrite: true });
  await render(service);
  await clickPin();
  await chooseAction('备注操作', '编辑');
  await typeMessage('第一条尚未保存的改动');
  await chooseAction('回复操作：我', '编辑回复');

  expect(element('dialog[open]').textContent).toContain('放弃草稿');
  await act(async () => {
    element('dialog[open]').dispatchEvent(
      new KeyboardEvent('keydown', { key: '9', bubbles: true }),
    );
  });
  expect(element('dialog[open]').textContent).toContain('放弃草稿');
  await click('保留草稿');
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('第一条尚未保存的改动');
  expect(service.apply).not.toHaveBeenCalled();

  await chooseAction('回复操作：我', '编辑回复');
  await click('放弃并编辑');
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('第二条消息');
});

test('keeps an unknown status command intact and restores local draft cancellation after confirmation', async () => {
  const service = testService();
  service.apply.mockRejectedValueOnce(new Error('状态回执未返回'));
  await render(service);
  await clickPin();
  await typeMessage('未提交的讨论回复');

  await click('解决');
  expect(button('取消').disabled).toBe(true);
  expect(button('关闭备注').disabled).toBe(true);
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('未提交的讨论回复');

  await click('重试本次保存');
  const [original, retry] = service.apply.mock.calls;
  expect(retry?.[0]).toBe(original?.[0]);
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('未提交的讨论回复');

  await render(service, { canEdit: false });
  expect(button('取消').disabled).toBe(false);
  await click('取消');
  expect(fixture.host.querySelector('textarea')).toBeNull();
});

test('reopens the draft for the selected discussion when changing between two pins', async () => {
  const service = testService();
  const other: FeedbackThread = {
    ...sample,
    id: 'another-thread',
    first: { ...sample.first, id: 'other-message', text: '另一块卡片' },
  };
  service.listThreads.mockResolvedValue({ items: [sample, other], canWrite: true });
  service.getThread.mockImplementation(async ({ threadId }) => ({
    thread: threadId === other.id ? other : sample,
    items: [],
    canWrite: true,
  }));
  await render(service);
  await clickPin();
  await typeMessage('第一条讨论的回复');

  await clickPin(other.id);
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('');
  await typeMessage('第二条讨论的回复');

  await clickPin();
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('第一条讨论的回复');
  await clickPin(other.id);
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('第二条讨论的回复');
});

test('the numeric-tools setting guards 9 and Escape leaves annotation mode without opening the list', async () => {
  const service = testService();
  const onAnnotationActiveChange = vi.fn<(active: boolean) => void>();
  const press = (key: string) =>
    act(async () => {
      button('画布').dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    });

  await render(service, { singleKeys: false, onAnnotationActiveChange });
  await press('9');
  expect(fixture.host.querySelector('[aria-label="在白板选取备注位置"]')).toBeNull();

  await render(service, { singleKeys: true, onAnnotationActiveChange });
  await press('9');
  expect(button('在白板选取备注位置')).toBeDefined();
  expect(fixture.host.querySelector('[aria-label="所有备注"]')).toBeNull();
  expect(onAnnotationActiveChange).toHaveBeenLastCalledWith(true);

  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  expect(fixture.host.querySelector('[aria-label="在白板选取备注位置"]')).toBeNull();
  expect(onAnnotationActiveChange).toHaveBeenLastCalledWith(false);
});

test('keeps the catalog panel open for outside presses and gives a pin its own floating thread', async () => {
  const service = testService();
  await render(service);
  await click('打开备注');
  const list = element('[role="dialog"][aria-label="所有备注"]');
  expect(document.activeElement).toBe(list);

  await act(async () => {
    button('画布').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
  expect(fixture.host.contains(list)).toBe(true);

  await clickPin();
  expect(fixture.host.contains(list)).toBe(false);
  const thread = element('[role="dialog"][aria-label="备注线程"]');
  expect(document.activeElement).toBe(thread);
  const tools = thread.querySelectorAll('.whiteboard-feedback__message-actions button');
  expect(Array.from(tools, (item) => item.getAttribute('aria-label'))).toEqual([
    '解决',
    '备注操作',
    '关闭备注',
  ]);

  await act(async () => {
    thread.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  expect(fixture.host.contains(thread)).toBe(false);
  expect(document.activeElement).toBe(element('[data-feedback-pin="thread"]'));
});

test('reopens the same annotated object when another target is clicked with an unsent draft', async () => {
  const service = testService();
  await render(service);
  await act(async () => {
    button('画布').dispatchEvent(new KeyboardEvent('keydown', { key: '9', bubbles: true }));
  });
  async function pick(clientX: number, clientY: number) {
    const control = button('在白板选取备注位置');
    await act(async () => {
      control.dispatchEvent(
        new MouseEvent('click', { detail: 1, bubbles: true, clientX, clientY }),
      );
    });
  }

  await pick(320, 170);
  await typeMessage('保留原对象定位的备注');
  await click('关闭备注');
  expect(fixture.host.querySelector('[aria-label="新建备注"]')).toBeNull();

  await pick(126, 120);
  expect(element<HTMLTextAreaElement>('textarea').value).toBe('保留原对象定位的备注');
  expect(fixture.host.textContent).toContain('已有未发送的备注草稿');
  await click('保存备注');

  expect(service.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: {
        kind: 'create',
        anchor: { kind: 'object', objectId: card.id, geometryVersion: 7n, u: 0.5, v: 0.5 },
        text: '保留原对象定位的备注',
      },
    }),
    expect.any(AbortSignal),
  );
});
