import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DEFAULT_STYLE,
  LOCAL_ACTOR,
  type Board,
  type BoardElement,
} from '../src/contracts/studio.js';
import { NativeContentQueue, type ContentTask } from '../src/app/canvas/content-queue.js';
import WhiteboardCanvas from '../src/app/canvas/WhiteboardCanvas.js';
import ContentConflictDialog from '../src/app/canvas/ContentConflictDialog.js';

const node: BoardElement = {
  id: 'document',
  type: 'document',
  x: 0,
  y: 0,
  w: 600,
  h: 400,
  version: 1,
  text: '说明',
  document: {
    schemaVersion: 1,
    blocks: [
      { id: 'paragraph', type: 'paragraph', props: {}, content: '已保存正文', children: [] },
    ],
  },
};
const board: Board = {
  artifact: {
    id: 'saved-draft',
    type: 'whiteboard',
    title: 'Saved draft',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    pinned: false,
  },
  style: DEFAULT_STYLE,
  elements: [node],
  orderVersion: 0,
};
const saved = (): ContentTask => ({
  id: 'old-layout',
  before: board,
  sources: [node],
  keys: [node.id],
  operations: [{ op: 'update', id: node.id, changes: { x: 200 } }],
  summary: '应用流程排布',
  remember: true,
  state: 'failed',
  strictVersions: { [node.id]: 1, external: 7, $order: 0 },
});
let host: HTMLDivElement;
let session: HTMLDivElement;
let target: HTMLDivElement;
let root: Root;
const button = (label: string) =>
  [...session.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label,
  )!;

async function click(label: string) {
  await act(async () => button(label).click());
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(650);
  localStorage.clear();
  host = document.createElement('div');
  host.className = 'studio';
  session = document.createElement('div');
  session.className = 'studio-session-content';
  target = document.createElement('div');
  host.append(session);
  session.append(target);
  document.body.append(host);
  root = createRoot(target);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps old strict drafts readable without offering removed layout controls or a generic overwrite', async () => {
  await act(async () =>
    root.render(
      <ContentConflictDialog
        task={saved()}
        current={board}
        portalRoot={session}
        onKeep={() => {}}
        onRemote={() => {}}
        onCopy={() => {}}
        onOverwrite={vi.fn()}
        disabled={false}
      />,
    ),
  );
  expect(target.querySelector('[role="dialog"]')).toBeNull();
  expect(session.querySelector('[role="dialog"]')?.textContent).toContain('自动布局功能已移除');
  expect(session.textContent).not.toMatch(/重新预览|重新选择目标并整理/);
  expect(button('明确用我的草稿覆盖此处')).toBeUndefined();
  expect(button('另存为新对象')).toBeUndefined();
  expect(button('保留草稿')).toBeDefined();
  expect(button('采用当前已保存内容')).toBeDefined();
});

it('does not execute restored drafts automatically and retains their exact strict CAS on explicit retry', async () => {
  const send = vi.fn().mockResolvedValue({ board });
  const queue = new NativeContentQueue({ send, changed: () => {}, accepted: () => {} });
  queue.restore([saved()]);
  expect(queue.tasks[0]?.state).toBe('failed');
  expect(send).not.toHaveBeenCalled();
  await queue.retry('old-layout');
  expect(send).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      operationId: 'old-layout',
      expectedVersions: { document: 1, external: 7, $order: 0 },
    }),
  );
  expect(send.mock.calls[0][0]).not.toHaveProperty('merge');
});

it('portals a saved-draft comparison, blocks tool shortcuts and discards only that old task', async () => {
  const send = vi.fn();
  const queue = new NativeContentQueue({ send, changed: () => {}, accepted: () => {} });
  queue.setEnabled(false);
  queue.restore([saved()]);
  const body = [
    {
      op: 'document' as const,
      id: node.id,
      data: {
        operations: [{ op: 'update', id: 'paragraph', changes: { content: '后来的文档草稿' } }],
      },
    },
  ];
  const paint = [{ op: 'update' as const, id: node.id, changes: { fill: '#aabbcc' } }];
  const settled = vi.fn();
  queue
    .enqueue(board, body, '编辑文档', board.elements, true, undefined, 'later-document')
    .then(settled, settled);
  queue
    .enqueue(board, paint, '调整样式', board.elements, true, undefined, 'later-style')
    .then(settled, settled);
  await act(async () =>
    root.render(
      <WhiteboardCanvas
        board={board}
        actor={LOCAL_ACTOR}
        client={{ embedded: true, call: vi.fn() }}
        contentQueue={queue}
        readOnly
        onChanged={() => {}}
        onAnnotate={() => {}}
      />,
    ),
  );
  await click('比较双方内容');
  expect(session.querySelector('[role="dialog"]')?.closest('.studio-whiteboard')).toBeNull();
  const viewport = session.querySelector<HTMLElement>('[aria-label="白板画布"]')!;
  await act(async () => {
    viewport.dispatchEvent(
      new KeyboardEvent('keydown', { key: '2', code: 'Digit2', bubbles: true, cancelable: true }),
    );
  });
  expect(session.querySelector('.studio-whiteboard')?.getAttribute('data-tool')).toBe('select');
  await click('采用当前已保存内容');
  expect(queue.tasks.map((task) => task.id)).toEqual(['later-document', 'later-style']);
  expect(queue.tasks.map((task) => task.operations)).toEqual([body, paint]);
  expect(send).not.toHaveBeenCalled();
  expect(settled).not.toHaveBeenCalled();
});

it('renders persisted label offsets and measured sizes after the layout feature is removed', async () => {
  const arrow: BoardElement = {
    id: 'edge',
    type: 'arrow',
    x: 0,
    y: 0,
    w: 200,
    h: 1,
    version: 1,
    from: [0, 0],
    to: [200, 0],
    label: '已保存标签',
    labelOffset: { x: 17, y: -23 },
    labelSize: { w: 180, h: 48 },
  };
  await act(async () =>
    root.render(
      <WhiteboardCanvas
        board={{ ...board, elements: [arrow] }}
        actor={LOCAL_ACTOR}
        client={{ embedded: true, call: vi.fn() }}
        readOnly
        onChanged={() => {}}
        onAnnotate={() => {}}
      />,
    ),
  );
  const label = session.querySelector('[data-element-id="edge"] foreignObject')!;
  expect(['x', 'y', 'width', 'height'].map((name) => label.getAttribute(name))).toEqual([
    '27',
    '-47',
    '180',
    '48',
  ]);
});
