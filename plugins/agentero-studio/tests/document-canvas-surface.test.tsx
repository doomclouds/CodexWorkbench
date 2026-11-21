import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentFocusSurface } from '../src/app/canvas/DocumentRegion.js';
import type { WhiteboardCanvasProps } from '../src/app/canvas/WhiteboardCanvas.js';
import {
  DEFAULT_STYLE,
  LOCAL_ACTOR,
  type Board,
  type BoardElement,
} from '../src/contracts/studio.js';
import type { DocumentContent } from '../src/contracts/document.js';
import { NativeContentQueue } from '../src/app/canvas/content-queue.js';
import useDocumentFocusSurface from '../src/app/canvas/useDocumentFocusSurface.js';
import type { Point } from '../src/app/canvas/canvas-model.js';

type SaveDocument = (
  document: DocumentContent,
  title: string,
  base: BoardElement,
  overwrite?: boolean,
) => Promise<BoardElement | false>;

const controller = vi.hoisted(() => ({
  scrollBy: vi.fn(),
  setZoomAnchor: vi.fn(),
  click: vi.fn(),
  publish: null as null | ((surface: DocumentFocusSurface | null) => void),
  save: null as SaveDocument | null,
}));
vi.mock('../src/app/canvas/DocumentRegion.js', async () => {
  const React = await import('react');
  function MockDocumentRegion({
    expanded,
    readingZoom,
    onFocusSurface,
    onSave,
  }: {
    expanded: boolean;
    readingZoom: number;
    onFocusSurface: (surface: DocumentFocusSurface | null) => void;
    onSave: SaveDocument;
  }) {
    React.useLayoutEffect(() => {
      controller.publish = onFocusSurface;
      controller.save = onSave;
    }, [onFocusSurface, onSave]);
    const publish = React.useEffectEvent((surface: DocumentFocusSurface | null) =>
      onFocusSurface(surface),
    );
    React.useEffect(() => {
      if (!expanded) {
        return;
      }

      publish({
        id: 'doc',
        scopeKey: 'doc:1:820',
        origin: { x: 220, y: 120 },
        clip: { x: 180, y: 90, w: 820, h: 500 },
        zoom: readingZoom,
        baseWidth: 820,
        scrollBy: controller.scrollBy,
        setZoomAnchor: controller.setZoomAnchor,
      });

      return () => publish(null);
    }, [expanded, readingZoom]);

    return (
      <div
        className={expanded ? 'studio-document-focus' : 'studio-document-region'}
        data-native-interactive="true"
      >
        <button aria-label="文档内容按钮" onClick={controller.click}>
          content
        </button>
        {expanded && <input aria-label="文档内查找" />}
        <p>文档正文</p>
      </div>
    );
  }

  return { default: MockDocumentRegion };
});
import WhiteboardCanvas from '../src/app/canvas/WhiteboardCanvas.js';

let host: HTMLDivElement;
let root: Root;
let props: WhiteboardCanvasProps;
const original = { x: 17, y: 39, zoom: 0.5 };
const board: Board = {
  artifact: {
    id: 'board',
    type: 'whiteboard',
    title: 'Document surface',
    revision: 1,
    pinned: false,
    createdAt: '',
    updatedAt: '',
  },
  style: DEFAULT_STYLE,
  elements: [
    {
      id: 'doc',
      type: 'document',
      text: '方案',
      x: 100,
      y: 120,
      w: 600,
      h: 400,
      version: 1,
      document: { schemaVersion: 1, blocks: [] },
    },
  ],
};
const query = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const world = () => host.querySelector<HTMLElement>('.studio-canvas-world')!.style.transform;

async function pointer(target: Element, type: string, button: number, x: number, y: number) {
  await act(async () =>
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button,
        detail: type === 'click' ? 1 : 0,
        clientX: x,
        clientY: y,
      }),
    ),
  );
}

async function click(label: string) {
  await pointer(query(label), 'click', 0, 0, 0);
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(650);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  controller.scrollBy.mockClear();
  controller.setZoomAnchor.mockClear();
  controller.click.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = {
    board,
    actor: LOCAL_ACTOR,
    client: { embedded: true, call: vi.fn() },
    onChanged: vi.fn(),
    onAnnotate: vi.fn(),
    onCursorMove: vi.fn(),
    externalViewport: original,
    externalSelectedIds: ['doc'],
  };
  await act(async () => root.render(<WhiteboardCanvas {...props} />));
  await click('全屏观看选区');
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function FocusSurfaceFixture({
  viewport,
  onChange,
  scrollBy,
}: {
  viewport: HTMLElement;
  onChange(surface: DocumentFocusSurface | null): void;
  scrollBy(delta: Point): void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useDocumentFocusSurface({
    expanded: true,
    id: 'doc',
    version: 1,
    zoom: 1,
    host: viewport,
    scroll,
    content,
    scrollBy,
    prepareExit: async () => true,
    onChange,
  });

  return (
    <div ref={scroll}>
      <div ref={content} />
    </div>
  );
}

it('publishes working document controls when the host changes at the same geometry', async () => {
  const onChange = vi.fn<(surface: DocumentFocusSurface | null) => void>();
  const scrollBy = vi.fn<(delta: Point) => void>();
  const viewport = document.createElement('div');
  await act(async () =>
    root.render(
      <FocusSurfaceFixture viewport={viewport} onChange={onChange} scrollBy={scrollBy} />,
    ),
  );
  const previous = onChange.mock.lastCall?.[0];
  expect(previous?.baseWidth).toBe(820);

  const replacement = document.createElement('div');
  await act(async () =>
    root.render(
      <FocusSurfaceFixture viewport={replacement} onChange={onChange} scrollBy={scrollBy} />,
    ),
  );
  const next = onChange.mock.lastCall?.[0];
  expect(next?.origin).toEqual(previous?.origin);
  expect(next?.scrollBy).not.toBe(previous?.scrollBy);
  previous?.scrollBy({ x: 30, y: 40 });
  expect(scrollBy).not.toHaveBeenCalled();
  next?.scrollBy({ x: 10, y: 20 });
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 20 });
  expect(onChange).toHaveBeenCalledTimes(2);
});

it('opens documents at standard reading scale without a second fullscreen toolbar and restores the board on Escape', async () => {
  expect(world()).toBe('translate(0px,0px) scale(1)');
  expect(query('全屏缩放比例')).toBeNull();
  expect(query('全屏放大')).toBeNull();
  expect(query('退出全屏观看')).toBeNull();
  await act(async () =>
    query('白板画布').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(world()).toBe('translate(17px,39px) scale(0.5)');
  expect(props.onChanged).not.toHaveBeenCalled();
});
it('routes middle and Space drag into actual document scrolling instead of moving the hidden board', async () => {
  const before = world();
  const target = query('文档内容按钮');
  await pointer(target, 'pointerdown', 1, 500, 300);
  await pointer(query('白板画布'), 'pointermove', 1, 460, 250);
  await pointer(query('白板画布'), 'pointerup', 1, 460, 250);
  expect(controller.scrollBy).toHaveBeenCalledWith({ x: 40, y: 50 });
  expect(world()).toBe(before);
  await act(async () =>
    query('白板画布').dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
    ),
  );
  await pointer(target, 'pointerdown', 0, 400, 300);
  await pointer(query('白板画布'), 'pointermove', 0, 390, 270);
  await pointer(query('白板画布'), 'pointerup', 0, 390, 270);
  await pointer(target, 'click', 0, 390, 270);
  expect(controller.scrollBy).toHaveBeenCalledWith({ x: 10, y: 30 });
  expect(controller.click).not.toHaveBeenCalled();
  expect(world()).toBe(before);
  await act(async () =>
    query('白板画布').dispatchEvent(
      new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }),
    ),
  );
});
it('preserves native plain wheels and keeps document writing scale stable on pinch or modified wheel', async () => {
  const before = world();
  const target = query('文档内容按钮');
  const ordinary = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 50 });
  await act(async () => target.dispatchEvent(ordinary));
  expect(ordinary.defaultPrevented).toBe(false);
  expect(world()).toBe(before);
  controller.setZoomAnchor.mockClear();
  const modified = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: -100,
    ctrlKey: true,
    clientX: 330,
    clientY: 240,
  });
  await act(async () => target.dispatchEvent(modified));
  expect(modified.defaultPrevented).toBe(true);
  expect(controller.setZoomAnchor).not.toHaveBeenCalled();
  expect(world()).toBe(before);
});
it('keeps the document native context menu while suppressing the board menu in blank reading space', async () => {
  const native = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  await act(async () => query('文档内容按钮').dispatchEvent(native));
  expect(native.defaultPrevented).toBe(false);
  const blank = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  await act(async () => query('白板画布').dispatchEvent(blank));
  expect(blank.defaultPrevented).toBe(true);
  expect(host.querySelector('.studio-canvas-context-menu')).toBeNull();
});
it('keeps document find reachable from its own controls without making the canvas focusable', async () => {
  expect(query('白板画布').hasAttribute('tabindex')).toBe(false);
  query('文档内容按钮').focus();
  const down = new KeyboardEvent('keydown', {
    key: 'f',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => query('文档内容按钮').dispatchEvent(down));
  expect(down.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(query('文档内查找'));
});
it('omits the generic ink layer and maps document presence back inside its original board frame', async () => {
  expect(query('临时荧光笔')).toBeNull();
  expect(host.querySelector('.studio-reading-marker')).toBeNull();
  await pointer(query('文档内容按钮'), 'pointermove', 0, 590, 340);
  expect(props.onCursorMove).toHaveBeenLastCalledWith({ x: 400, y: 320 });
  expect(props.onChanged).not.toHaveBeenCalled();
});

it('keeps a later geometry task when replacing a failed document save and waits for its confirmation', async () => {
  let finishGeometry!: (receipt: { board: Board }) => void;
  const send = vi.fn(async (args: Record<string, unknown>) => {
    const operations = args.operations as { op: string }[];
    if (operations.some((operation) => operation.op === 'document')) {
      throw new Error('CONFLICT');
    }

    return new Promise<{ board: Board }>((resolve) => {
      finishGeometry = resolve;
    });
  });
  const queue = new NativeContentQueue({ send, changed: vi.fn(), accepted: vi.fn() });
  props = { ...props, contentQueue: queue };
  await act(async () => root.render(<WhiteboardCanvas {...props} />));
  const draft: DocumentContent = {
    schemaVersion: 1,
    blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: '本机正文', children: [] }],
  };
  await act(async () => {
    await expect(controller.save!(draft, '方案', board.elements[0]!)).rejects.toThrow('CONFLICT');
  });
  const failedId = queue.tasks[0]!.id;
  queue.setEnabled(false);
  const confirmedGeometry = vi.fn();
  const geometryFailure = vi.fn();
  await act(async () => {
    queue
      .enqueue(
        board,
        [{ op: 'update', id: 'doc', changes: { x: 250 } }],
        '移动元素',
        board.elements,
        true,
        undefined,
        'later-geometry',
      )
      .then(confirmedGeometry, geometryFailure);
  });
  const canonical = { ...board.elements[0]!, version: 3 };
  let failure: unknown;
  await act(async () => {
    void controller.save!(draft, '方案', canonical, true).catch((cause) => {
      failure = cause;
    });
    await Promise.resolve();
  });
  expect(queue.tasks.some((task) => task.id === 'later-geometry')).toBe(true);
  expect(queue.tasks.some((task) => task.id === failedId)).toBe(false);
  expect(String(failure)).toContain('未确认');
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => queue.setEnabled(true));
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]![0].operations).toEqual([
    { op: 'update', id: 'doc', changes: { x: 250 } },
  ]);
  await act(async () =>
    finishGeometry({
      board: {
        ...board,
        artifact: { ...board.artifact, revision: 2 },
        elements: [{ ...canonical, x: 250, version: 4 }],
      },
    }),
  );
  expect(queue.tasks).toEqual([]);
  expect(confirmedGeometry).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      board: expect.objectContaining({
        elements: [expect.objectContaining({ id: 'doc', x: 250, version: 4 })],
      }),
    }),
  );
  expect(geometryFailure).not.toHaveBeenCalled();
});

it.each([{ x: 250 }, { text: '标题与样式', fill: '#ffffff' }])(
  'does not mistake unrelated changes %j for a document save during comparison',
  async (changes) => {
    const send = vi.fn(async () => {
      throw new Error('geometry offline');
    });
    const queue = new NativeContentQueue({ send, changed: vi.fn(), accepted: vi.fn() });
    await queue.enqueue(
      board,
      [{ op: 'update', id: 'doc', changes }],
      '编辑文档',
      board.elements,
      true,
      undefined,
      'failed-geometry',
    );
    queue.setEnabled(false);
    props = { ...props, contentQueue: queue };
    await act(async () => root.render(<WhiteboardCanvas {...props} />));
    const draft: DocumentContent = {
      schemaVersion: 1,
      blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: '正文', children: [] }],
    };
    let failure: unknown;
    await act(async () => {
      void controller.save!(draft, '方案', board.elements[0]!, true).catch((cause) => {
        failure = cause;
      });
      await Promise.resolve();
    });
    expect(String(failure)).toContain('未确认');
    expect(queue.tasks.map((task) => task.id)).toEqual(['failed-geometry']);
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it('recognizes a restored title-only document save without losing later queued geometry', async () => {
  const send = vi.fn().mockRejectedValue(new Error('几何保存尚未确认'));
  const queue = new NativeContentQueue({ send, changed: vi.fn(), accepted: vi.fn() });
  queue.setEnabled(false);
  queue.restore([
    {
      id: 'restored-document-title',
      keys: ['doc'],
      before: structuredClone(board),
      sources: structuredClone(board.elements),
      operations: [{ op: 'update', id: 'doc', changes: { text: '上次的文档标题' } }],
      summary: '编辑文档',
      remember: true,
      state: 'failed',
    },
  ]);
  const geometrySettled = vi.fn();
  const geometryFailure = vi.fn();
  queue
    .enqueue(
      board,
      [{ op: 'update', id: 'doc', changes: { x: 300 } }],
      '移动元素',
      board.elements,
      true,
      undefined,
      'restored-later-geometry',
    )
    .then(geometrySettled, geometryFailure);
  props = { ...props, contentQueue: queue };
  await act(async () => root.render(<WhiteboardCanvas {...props} />));
  let failure: unknown;
  await act(async () => {
    void controller.save!(
      { schemaVersion: 1, blocks: [] },
      '已比较的标题',
      { ...board.elements[0]!, version: 3 },
      true,
    ).catch((cause) => {
      failure = cause;
    });
    await Promise.resolve();
  });
  expect(String(failure)).toContain('未确认');
  expect(queue.tasks.map((task) => task.id)).toEqual(['restored-later-geometry']);
  expect(queue.tasks[0]!.operations).toEqual([{ op: 'update', id: 'doc', changes: { x: 300 } }]);
  expect(geometrySettled).toHaveBeenCalledExactlyOnceWith(null);
  expect(geometryFailure).not.toHaveBeenCalled();
});
