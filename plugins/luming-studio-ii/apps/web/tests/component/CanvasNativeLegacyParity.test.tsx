import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Canvas,
  type CanvasObjectPayload,
  type CanvasProps,
} from '../../src/ui/domain/canvas/index.js';
import { studioObjectExtensions } from '../../src/ui/domain/objects/index.js';
import { createControlFixture } from '../support/render-control.js';

const geometry = { x: 80, y: 70, width: 320, height: 180, rotation: 0 };
const documentObject = {
  id: 'doc',
  kind: 'document',
  label: '文档',
  geometry,
  version: 1,
  locked: true,
} as const;
const scene = {
  boardId: 'legacy-native',
  revision: 1,
  objects: [
    documentObject,
    { id: 'todo', kind: 'todo', label: '清单', geometry: { ...geometry, x: 440 }, version: 1 },
    { id: 'video', kind: 'video', label: '视频', geometry: { ...geometry, y: 310 }, version: 1 },
    { id: 'html', kind: 'html', label: '图解', geometry: { ...geometry, x: 2300 }, version: 1 },
  ],
} satisfies CanvasProps['scene'];
const payloads = new Map<string, CanvasObjectPayload>([
  [
    'doc',
    {
      version: 1,
      value: { title: '文档', version: 1, document: { schemaVersion: 1, blocks: [] } },
    },
  ],
  ['todo', { version: 1, value: { id: 'todo', revision: 1, title: '清单', items: [] } }],
  ['video', { version: 1, value: { src: 'https://example.test/demo.mp4' } }],
  ['html', { version: 1, value: { id: 'html', version: 1, html: '<p>交互图解</p>' } }],
]);

function scrollTo(this: HTMLElement, options: ScrollToOptions) {
  this.scrollTop = options.top ?? this.scrollTop;
  this.scrollLeft = options.left ?? this.scrollLeft;
}

if (typeof HTMLElement.prototype.scrollTo !== 'function') {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, configurable: true });
}

function element(root: HTMLElement, selector: string) {
  const match = root.querySelector<HTMLElement>(selector);
  if (!match) {
    throw new Error('Expected a Canvas element for ' + selector);
  }

  return match;
}

function wheel(target: HTMLElement) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 12 });
  act(() => {
    target.dispatchEvent(event);
  });

  return event.defaultPrevented;
}

async function flushFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

describe('Canvas legacy native content parity', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 900, 550),
    );
  });

  afterEach(() => {
    fixture.dispose();
    vi.restoreAllMocks();
  });

  function render(props: Partial<CanvasProps> = {}) {
    fixture.render(
      <Canvas
        viewId="native-parity"
        label="白板画布"
        scene={scene}
        selection={[]}
        tool="select"
        canEdit
        initialViewport={{ x: 0, y: 0, zoom: 1 }}
        objectExtensions={studioObjectExtensions}
        payloadById={payloads}
        {...props}
        onSelectionChange={props.onSelectionChange ?? vi.fn()}
        onEditIntent={props.onEditIntent ?? vi.fn()}
      />,
    );
  }

  it('leaves document and todo scrolling with Canvas until the body owns a single selection', () => {
    render();
    const doc = element(fixture.host, '[aria-label="文档正文"]');
    const todo = element(fixture.host, '[aria-label="任务列表"]');
    const expand = element(fixture.host, '[aria-label="展开文档"]');
    const expandTodo = element(fixture.host, '[aria-label="展开任务清单"]');
    expect(expand.closest('[inert]')).toBeNull();
    expect(expandTodo.closest('[inert]')).toBeNull();
    expect(doc.closest('[inert]')).not.toBeNull();
    expect(todo.closest('[inert]')).not.toBeNull();
    expect(wheel(doc)).toBe(true);
    expect(wheel(todo)).toBe(true);

    render({ selection: ['doc'] });
    expect(doc.closest('[inert]')).toBeNull();
    expect(wheel(doc)).toBe(false);
    expect(wheel(todo)).toBe(true);

    render({ selection: ['todo'] });
    expect(todo.closest('[inert]')).toBeNull();
    expect(wheel(doc)).toBe(true);
    expect(wheel(todo)).toBe(false);

    render({ selection: ['doc', 'todo'] });
    expect(wheel(doc)).toBe(true);
    expect(wheel(todo)).toBe(true);
  });

  it('releases video controls and wheel ownership below 128 by 72 screen pixels', async () => {
    render({ initialViewport: { x: 0, y: 0, zoom: 0.4 } });
    const video = fixture.host.querySelector('video');
    if (!video) {
      throw new Error('Expected the video extension to render its player.');
    }

    expect(video.controls).toBe(true);
    expect(wheel(video)).toBe(false);
    render({
      viewportRequest: { requestId: 'shrink-video', viewport: { x: 0, y: 0, zoom: 0.39 } },
    });
    await flushFrame();
    expect(fixture.host.querySelector('video')).toBe(video);
    expect(video.controls).toBe(false);
    expect(wheel(video)).toBe(true);
  });

  it('retains a visited iframe offscreen until its cached body is evicted', async () => {
    const onVisibleObjectsChange = vi.fn();
    render({ onVisibleObjectsChange });
    expect(fixture.host.querySelector('iframe')).toBeNull();

    render({
      onVisibleObjectsChange,
      viewportRequest: { requestId: 'visit', viewport: { x: -2250, y: 0, zoom: 1 } },
    });
    await flushFrame();
    const iframe = element(fixture.host, 'iframe');
    expect(onVisibleObjectsChange).toHaveBeenLastCalledWith(['html']);

    render({
      onVisibleObjectsChange,
      viewportRequest: { requestId: 'leave', viewport: { x: 0, y: 0, zoom: 1 } },
    });
    await flushFrame();
    expect(fixture.host.querySelector('iframe')).toBe(iframe);
    expect(onVisibleObjectsChange.mock.lastCall?.[0]).not.toContain('html');

    const evicted = new Map(payloads);
    evicted.delete('html');
    render({ onVisibleObjectsChange, payloadById: evicted });
    expect(fixture.host.querySelector('[data-canvas-object="html"]')).toBeNull();
  });

  it('caps only visited offscreen bodies after shrinking a cached overview', async () => {
    const tableGeometry = { x: 0, y: 70, width: 12, height: 12, rotation: 0 };
    const table = { kind: 'table', label: '表格', version: 1 } as const;
    const tables = Array.from({ length: 260 }, (_, index) => ({
      ...table,
      id: 'offscreen-table-' + index,
      geometry: { ...tableGeometry, x: index * 24 },
    })) satisfies CanvasProps['scene']['objects'];
    const onscreen = {
      ...table,
      id: 'onscreen-table',
      geometry: { ...tableGeometry, x: 8_000 },
    };
    const cachedTables = new Map<string, CanvasObjectPayload>(payloads);
    for (const { id } of [...tables, onscreen]) {
      cachedTables.set(id, { version: 1, value: { id, width: tableGeometry.width, version: 1 } });
    }

    const overview: Partial<CanvasProps> = {
      scene: { ...scene, objects: [documentObject, ...tables, onscreen] },
      selection: ['doc'],
      payloadById: cachedTables,
      initialViewport: { x: 0, y: 0, zoom: 0.1 },
    };
    render(overview);
    const offscreenSelector = '[data-canvas-object^="offscreen-table-"]';
    expect(fixture.host.querySelectorAll(offscreenSelector)).toHaveLength(tables.length);
    const focused = element(fixture.host, '[aria-label="文档正文"]');
    act(() => {
      focused.focus();
    });
    expect(document.activeElement).toBe(focused);

    render({
      ...overview,
      viewportRequest: { requestId: 'narrow', viewport: { x: -7_900, y: 0, zoom: 1 } },
    });
    await flushFrame();

    const retained = fixture.host.querySelectorAll(offscreenSelector);
    expect(retained).toHaveLength(256);
    expect(retained[0]?.getAttribute('data-canvas-object')).toBe('offscreen-table-4');
    expect(fixture.host.querySelector('[data-canvas-object="onscreen-table"]')).not.toBeNull();
    expect(document.activeElement).toBe(focused);
  });
});
