import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WhiteboardCanvas, {
  type WhiteboardCanvasProps,
} from '../../src/app/features/whiteboard/canvas/WhiteboardCanvas.js';
import { fitViewport } from '../../src/app/features/whiteboard/canvas/scene/canvas-model.js';
import { storePanelReadingView } from '../../src/app/panel-view-state.js';
import {
  DEFAULT_STYLE,
  LOCAL_ACTOR,
  type Board,
  type BoardElement,
} from '../../src/contracts/studio.js';

let host: HTMLDivElement;
let root: Root;
const originalViewport = { x: 17, y: 39, zoom: 0.5 };
const element = (id: string, extra: Partial<BoardElement> = {}): BoardElement => ({
  id,
  type: 'shape',
  x: 100,
  y: 120,
  w: 200,
  h: 100,
  version: 1,
  text: id,
  ...extra,
});
const board = (elements: BoardElement[]): Board => ({
  artifact: {
    id: 'board',
    type: 'whiteboard',
    title: 'Reading',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    pinned: false,
  },
  style: DEFAULT_STYLE,
  elements,
});
const query = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const world = () => host.querySelector<HTMLElement>('.studio-canvas-world')!;

async function event(node: Element, type: string, extra: MouseEventInit = {}) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...extra }));
  });
}

async function click(label: string) {
  await event(query(label), 'click');
}

async function key(key: string) {
  await act(async () => {
    query('白板画布').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

async function escapeFromHtmlFrame(frame: HTMLIFrameElement) {
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  await act(async () => {
    frame.dispatchEvent(new Event('load'));
  });
  const { channel, regionId, sourceRevision } = post.mock.calls.find(
    ([value]) => value.type === 'studio-html-mode',
  )![0];
  post.mockRestore();
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'studio-html-escape', channel, regionId, sourceRevision },
      }),
    );
  });
}

async function mount(elements: BoardElement[], props: Partial<WhiteboardCanvasProps> = {}) {
  await act(async () => {
    root.render(
      <WhiteboardCanvas
        board={board(elements)}
        client={{ embedded: true, call: vi.fn() }}
        actor={LOCAL_ACTOR}
        onChanged={() => {}}
        onAnnotate={() => {}}
        externalViewport={originalViewport}
        externalSelectedIds={[elements[0]!.id]}
        {...props}
      />,
    );
  });
}

function observeInitialHtmlMount() {
  const observations: { transform: string; textVisible: boolean }[] = [];
  const setSource = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc')!.set!;
  vi.spyOn(HTMLIFrameElement.prototype, 'srcdoc', 'set').mockImplementation(function (
    this: HTMLIFrameElement,
    source,
  ) {
    const scene = this.closest<HTMLElement>('.studio-canvas-world')!;
    observations.push({
      transform: scene.style.transform,
      textVisible: Boolean(
        scene.querySelector('[data-element-id="startup-text"] .studio-element-text'),
      ),
    });
    setSource.call(this, source);
  });

  return observations;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(650);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  host = document.createElement('div');
  host.className = 'studio';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('fits using the actual host dimensions before mounting rich content and its first level of detail', async () => {
  const observations = observeInitialHtmlMount();
  const elements = [
    element('preview', { type: 'html', html: '<p>Preview</p>' }),
    element('startup-text', { type: 'text', x: 4_800 }),
  ];
  const fitted = fitViewport(elements, 1_000, 650);
  const onViewportChange = vi.fn();
  await mount(elements, { externalViewport: undefined, onViewportChange });

  expect(observations).toEqual([
    {
      transform: `translate(${fitted.x}px,${fitted.y}px) scale(${fitted.zoom})`,
      textVisible: false,
    },
  ]);
  expect(onViewportChange).toHaveBeenCalledExactlyOnceWith(fitted);
});

it('mounts a preview directly at its explicitly supplied viewport', async () => {
  const observations = observeInitialHtmlMount();
  await mount([element('preview', { type: 'html', html: '<p>Preview</p>' })], { preview: true });

  expect(observations).toEqual([
    {
      transform: `translate(${originalViewport.x}px,${originalViewport.y}px) scale(${originalViewport.zoom})`,
      textVisible: false,
    },
  ]);
});

it('mounts restored reading content at its saved camera before accepting an external viewport', async () => {
  const observations = observeInitialHtmlMount();
  const restoreReadingFrom = 'startup-reading-source';
  const panelViewId = 'startup-reading-resumed';
  const saved = { x: 60, y: 25, zoom: 0.25 };
  storePanelReadingView(restoreReadingFrom, {
    artifactId: 'board',
    ids: ['preview'],
    viewport: saved,
    returnViewport: originalViewport,
  });

  try {
    await mount([element('preview', { type: 'html', html: '<p>Preview</p>' })], {
      restoreReadingFrom,
      panelViewId,
    });

    expect(observations).toEqual([
      {
        transform: `translate(${saved.x}px,${saved.y}px) scale(${saved.zoom})`,
        textVisible: false,
      },
    ]);
    expect(host.querySelector('.is-reading')).not.toBeNull();
  } finally {
    await act(async () => root.render(null));
    storePanelReadingView(restoreReadingFrom, null);
    storePanelReadingView(panelViewId, null);
  }
});

it('opens a native component from its first-level toolbar, enlarges only that component, and restores view and focus on Escape', async () => {
  const reading = vi.fn();
  const changed = vi.fn();
  await mount([element('one'), element('other', { x: 1400 })], {
    onReadingChange: reading,
    onChanged: changed,
  });
  expect(query('白板画布').getAttribute('tabindex')).toBe('0');
  const before = world().style.transform;
  expect(query('全屏观看选区').closest('[role="toolbar"]')?.getAttribute('aria-label')).toBe(
    '选区格式',
  );
  expect(host.querySelector('[role="menu"]')).toBeNull();
  await click('全屏观看选区');
  expect(query('白板画布').getAttribute('tabindex')).toBe('0');
  expect(host.querySelector('.studio-whiteboard')?.classList.contains('is-reading')).toBe(true);
  expect(world().style.transform).toContain('scale(4.52)');
  expect((host.querySelector('[data-element-id="other"]') as HTMLElement).style.display).toBe(
    'none',
  );
  expect(query('白板工具').hidden).toBe(true);
  expect(host.querySelector('.studio-selection-frame')).toBeNull();
  expect(host.querySelector('.studio-reading-hint')?.textContent).toContain('Esc');
  await key('Delete');
  await key('3');
  await event(host.querySelector('[data-element-id="one"]')!, 'dblclick');
  expect(changed).not.toHaveBeenCalled();
  expect(host.querySelector('[contenteditable="true"]')).toBeNull();
  await key('Escape');
  expect(query('白板画布').getAttribute('tabindex')).toBe('0');
  expect(world().style.transform).toBe(before);
  expect(query('白板工具').hidden).toBe(false);
  expect((host.querySelector('[data-element-id="other"]') as HTMLElement).style.display).toBe('');
  expect(reading.mock.calls).toEqual([[true], [false]]);
  await vi.waitFor(() => expect(document.activeElement).toBe(query('全屏观看选区')));
});

it('views multiple native components and keeps locked contents of a selected container visible', async () => {
  const elements = [
    element('section', { type: 'container', x: 0, y: 0, w: 600, h: 360 }),
    element('locked-child', { locked: true }),
    element('second', { x: 800 }),
    element('outside', { x: 1600 }),
  ];
  await mount(elements, { externalSelectedIds: ['section', 'second'] });
  await click('全屏观看选区');
  for (const id of ['section', 'locked-child', 'second']) {
    expect((host.querySelector(`[data-element-id="${id}"]`) as HTMLElement).style.display).toBe('');
  }

  expect((host.querySelector('[data-element-id="outside"]') as HTMLElement).style.display).toBe(
    'none',
  );
  await click('退出全屏观看');
  expect(host.querySelector('.is-reading')).toBeNull();
});

it('resumes the expanded document, scroll and return viewport only in the restored panel', async () => {
  const elements = [
    element('document', { type: 'document', w: 820, h: 560, text: '恢复文档' }),
    element('other'),
  ];
  const remount = async () => {
    await act(async () => root.unmount());
    root = createRoot(host);
  };

  const view = { panelViewId: 'view-reading-a' };
  try {
    await mount(elements, view);
    const previousViewport = world().style.transform;
    await click('展开文档');
    const scroll = query('文档正文：恢复文档');
    await act(async () => {
      scroll.scrollTop = 246;
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    await remount();
    await mount(elements, {
      restoreReadingFrom: 'view-reading-b',
      panelViewId: 'view-reading-b-remounted',
      externalSelectedIds: ['other'],
    });
    expect(host.querySelector('.is-reading')).toBeNull();
    expect(host.querySelector('[data-element-id="other"]')!.classList.contains('is-selected')).toBe(
      true,
    );

    await remount();
    const wrongBoard = board(elements);
    await mount(elements, {
      panelViewId: 'view-reading-wrong-board',
      restoreReadingFrom: view.panelViewId,
      board: { ...wrongBoard, artifact: { ...wrongBoard.artifact, id: 'different-board' } },
    });
    expect(host.querySelector('.is-reading')).toBeNull();

    await remount();
    const resumedViewId = 'view-reading-a-remounted';
    await mount(elements, { panelViewId: resumedViewId, restoreReadingFrom: view.panelViewId });
    expect(host.querySelector('.is-reading')).not.toBeNull();
    expect(query('文档正文：恢复文档').scrollTop).toBe(246);
    expect(sessionStorage.getItem('studio-panel-reading:' + resumedViewId)).toContain('"y":246');
    await event(
      [...host.querySelectorAll('button')].find((button) => button.textContent === '返回画板')!,
      'click',
    );
    expect(world().style.transform).toBe(previousViewport);
    expect(
      host.querySelector('[data-element-id="document"]')!.classList.contains('is-selected'),
    ).toBe(true);

    await click('展开文档');
    await remount();

    await mount(elements, { panelViewId: resumedViewId });
    expect(host.querySelector('.is-reading')).toBeNull();
    expect(sessionStorage.getItem('studio-panel-reading:' + resumedViewId)).toBeNull();
    await remount();
    await mount(elements, {
      panelViewId: 'view-reading-a-remounted-again',
      restoreReadingFrom: resumedViewId,
    });
    expect(host.querySelector('.is-reading')).toBeNull();
  } finally {
    sessionStorage.removeItem('studio-panel-reading:view-reading-a');
    sessionStorage.removeItem('studio-panel-reading:view-reading-b');
    sessionStorage.removeItem('studio-panel-reading:view-reading-a-remounted');
  }
});

it.each([
  ['Enter', 'Enter'],
  [' ', 'Space'],
])('lets %s activate the reading button instead of editing or panning', async (key, code) => {
  await mount([element('one', { type: 'note' })]);
  const button = query('全屏观看选区');
  button.focus();
  const down = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
  await act(async () => {
    button.dispatchEvent(down);
  });
  expect(down.defaultPrevented).toBe(false);
  expect(host.querySelector('[contenteditable="true"]')).toBeNull();
  expect(host.querySelector('.studio-whiteboard')?.getAttribute('data-tool')).toBe('select');

  await click('全屏观看选区');
  expect(host.querySelector('.is-reading')).not.toBeNull();
});

it.each([false, true])(
  'makes HTML interactive while reading, then restores whether it was singly selected (%s)',
  async (singlySelected) => {
    const html = element('html', {
      type: 'html',
      html: '<button>Count</button>',
      sourceRevision: 1,
    });
    await mount([html, element('shape', { x: 360 })], {
      externalSelectedIds: singlySelected ? ['html'] : ['html', 'shape'],
    });
    const frame = host.querySelector('iframe')!;
    const source = frame.srcdoc;
    expect(frame.tabIndex).toBe(singlySelected ? 0 : -1);
    await click('全屏观看选区');
    expect(host.querySelector('iframe')).toBe(frame);
    expect(frame.srcdoc).toBe(source);
    expect(frame.style.pointerEvents).toBe('auto');
    expect(frame.tabIndex).toBe(0);
    expect(query('白板画布').getAttribute('tabindex')).toBe('0');
    frame.focus();
    await escapeFromHtmlFrame(frame);
    expect(host.querySelector('.is-reading')).toBeNull();
    expect(frame.style.pointerEvents).toBe(singlySelected ? 'auto' : 'none');
    expect(frame.tabIndex).toBe(singlySelected ? 0 : -1);
    expect(query('白板画布').getAttribute('tabindex')).toBe('0');
    expect(host.querySelector('iframe')).toBe(frame);
    await vi.waitFor(() => expect(document.activeElement).toBe(query('全屏观看选区')));
  },
);

it('returns focus to the whiteboard on iframe Escape before a second Escape clears selection', async () => {
  const changed = vi.fn();
  await mount([element('html', { type: 'html', html: '<input>', sourceRevision: 1 })], {
    externalSelectedIds: [],
    onChanged: changed,
  });
  const target = host.querySelector<HTMLElement>('[data-element-id="html"]')!;
  const frame = target.querySelector('iframe')!;
  expect(frame.style.pointerEvents).toBe('none');
  await event(target, 'pointerdown', { clientX: 90, clientY: 120 });
  await event(query('白板画布'), 'pointerup', { clientX: 90, clientY: 120 });
  expect(target.classList.contains('is-selected')).toBe(true);
  expect(frame.style.pointerEvents).toBe('auto');
  frame.focus();
  expect(document.activeElement).toBe(frame);
  await escapeFromHtmlFrame(frame);
  expect(document.activeElement).toBe(query('白板画布'));
  expect(target.classList.contains('is-selected')).toBe(true);
  expect(frame.tabIndex).toBe(0);
  await key('Escape');
  expect(target.classList.contains('is-selected')).toBe(false);
  expect(frame.style.pointerEvents).toBe('none');
  expect(frame.tabIndex).toBe(-1);
  expect(changed).not.toHaveBeenCalled();
});

it('keeps one HTML frame across overview, ordinary and reading zoom', async () => {
  const ordinaryView = { ...originalViewport, zoom: 0.867 };
  const html = element('html', {
    type: 'html',
    w: 500,
    h: 300,
    html: '<input value="Keep the current document"/>',
    sourceRevision: 1,
  });
  await mount([html], { externalViewport: ordinaryView });
  const frame = host.querySelector('iframe')!;
  const source = frame.srcdoc;
  const contentWindow = frame.contentWindow;
  const before = world().style.transform;
  const expectCurrentFrame = (rasterZoom: number) => {
    expect(host.querySelector('iframe')).toBe(frame);
    expect(frame.contentWindow).toBe(contentWindow);
    expect(frame.srcdoc).toBe(source);

    expect(Number(frame.style.zoom)).toBeCloseTo(rasterZoom, 12);
  };

  expectCurrentFrame(0.867);
  for (const zoom of [0.28, 0.103]) {
    await mount([html], { externalViewport: { ...ordinaryView, zoom } });
    expect(world().style.transform).toContain(`scale(${zoom})`);
    expectCurrentFrame(1);
    expect(frame.style.width).toBe('100%');
    expect(frame.style.height).toBe('100%');
    expect(frame.style.transform).toBe('');
  }

  await mount([html], { externalViewport: ordinaryView });
  expectCurrentFrame(0.867);
  await click('全屏观看选区');
  const fittedZoom = Number(/scale\(([^)]+)\)/.exec(world().style.transform)![1]);
  expect(fittedZoom).not.toBe(0.867);
  expectCurrentFrame(fittedZoom);
  expect(frame.style.pointerEvents).toBe('auto');
  const input = query('全屏缩放比例') as HTMLInputElement;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '137.5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
  expectCurrentFrame(1.375);
  await click('退出全屏观看');
  expectCurrentFrame(0.867);
  expect(world().style.transform).toBe(before);
  expect(frame.style.pointerEvents).toBe('auto');
});

it('exits safely if the viewed component is deleted remotely', async () => {
  const reading = vi.fn();
  await mount([element('one')], { onReadingChange: reading });
  await click('全屏观看选区');
  await act(async () => {
    root.render(
      <WhiteboardCanvas
        board={board([])}
        client={{ embedded: true, call: vi.fn() }}
        actor={LOCAL_ACTOR}
        onChanged={() => {}}
        onAnnotate={() => {}}
        onReadingChange={reading}
      />,
    );
  });
  expect(host.querySelector('.is-reading')).toBeNull();
  expect(reading.mock.lastCall).toEqual([false]);
});

it('cancels an active reading pan before restoring the previous viewport', async () => {
  await mount([element('one')]);
  const before = world().style.transform;
  await click('全屏观看选区');
  await event(query('白板画布'), 'pointerdown', { clientX: 300, clientY: 300 });
  await event(query('白板画布'), 'pointermove', { clientX: 400, clientY: 350 });
  await key('Escape');
  expect(world().style.transform).toBe(before);
  await event(query('白板画布'), 'pointermove', { clientX: 480, clientY: 390 });
  await event(query('白板画布'), 'pointerup', { clientX: 480, clientY: 390 });
  expect(world().style.transform).toBe(before);
});

it('keeps a remotely moved reading target in view', async () => {
  await mount([element('one')]);
  await click('全屏观看选区');
  const before = world().style.transform;
  await mount([element('one', { x: 5000, version: 2 })]);
  expect(world().style.transform).not.toBe(before);
  expect(host.querySelector('.is-reading')).not.toBeNull();
});

it('does not open an arrow label editor while reading', async () => {
  const changed = vi.fn();
  await mount(
    [element('arrow', { type: 'arrow', label: 'Read only', from: [100, 120], to: [300, 220] })],
    { onChanged: changed },
  );
  await click('全屏观看选区');
  await event(host.querySelector('.studio-canvas-arrow path[stroke="transparent"]')!, 'dblclick');
  expect(host.querySelector('[contenteditable="true"]')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

it('does not steal iframe focus when only its saved interaction state changes', async () => {
  const html = element('html', {
    type: 'html',
    html: '<input value="Reading"/>',
    sourceRevision: 1,
  });
  await mount([html]);
  await click('全屏观看选区');
  const frame = host.querySelector('iframe')!;
  frame.focus();
  expect(document.activeElement).toBe(frame);
  await mount([{ ...html, version: 2, state: { value: 'Changed' } }]);
  expect(document.activeElement).toBe(frame);
});

it('offers fit selection in the element context menu and fits selected rotated geometry without including the rest of the board', async () => {
  await mount([element('one', { rotation: 90 }), element('other', { x: 5000 })]);
  await event(host.querySelector('[data-element-id="one"]')!, 'contextmenu', {
    clientX: 120,
    clientY: 140,
  });
  const fit = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.startsWith('适应选区'),
  )!;
  expect(fit).toBeDefined();
  await event(fit, 'click');
  expect(world().style.transform).toContain('scale(2.53)');
  expect(host.querySelector('[role="menu"]')).toBeNull();
});

it('converts an interactive iframe pointer through element rotation independently of canvas zoom and clears it on leave', async () => {
  const cursor = vi.fn();
  await mount(
    [element('html', { type: 'html', html: '<p>Pointer</p>', rotation: 90, sourceRevision: 1 })],
    { onCursorMove: cursor },
  );
  const frame = host.querySelector('iframe')!;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  await act(async () => {
    frame.dispatchEvent(new Event('load'));
  });
  const mode = post.mock.calls.find(([value]) => value.type === 'studio-html-mode')![0];
  const send = (point: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'studio-html-pointer',
          channel: mode.channel,
          regionId: 'html',
          sourceRevision: 1,
          point,
        },
      }),
    );
  await act(async () => {
    send({ x: 0.75, y: 0.5 });
  });
  await vi.waitFor(() => expect(cursor.mock.lastCall?.[0]).toEqual({ x: 200, y: 220 }));
  await act(async () => {
    send(null);
  });
  expect(cursor.mock.lastCall).toEqual([null]);
});
