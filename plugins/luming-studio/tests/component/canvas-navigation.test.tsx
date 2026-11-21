import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WhiteboardCanvas from '../../src/app/features/whiteboard/canvas/WhiteboardCanvas.js';
import {
  DEFAULT_STYLE,
  LOCAL_ACTOR,
  type Board,
  type BoardElement,
} from '../../src/contracts/studio.js';

let host: HTMLDivElement;
let root: Root;
const value = (id: string, extra: Partial<BoardElement> = {}): BoardElement => ({
  id,
  type: 'shape',
  x: 100,
  y: 120,
  w: 200,
  h: 100,
  text: id,
  version: 1,
  ...extra,
});
const board = (elements: BoardElement[]): Board => ({
  artifact: {
    id: 'navigation',
    type: 'whiteboard',
    title: 'Navigation',
    revision: 1,
    pinned: false,
    createdAt: '',
    updatedAt: '',
  },
  elements,
  style: DEFAULT_STYLE,
});
const world = () => host.querySelector<HTMLElement>('.studio-canvas-world')!;
const viewport = () => host.querySelector<HTMLElement>('[aria-label="白板画布"]')!;

async function pointer(
  target: Element,
  type: string,
  button: number,
  clientX: number,
  clientY: number,
) {
  await act(async () =>
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX, clientY }),
    ),
  );
}

async function mount(elements: BoardElement[]) {
  const call = vi.fn();
  await act(async () =>
    root.render(
      <WhiteboardCanvas
        board={board(elements)}
        actor={LOCAL_ACTOR}
        client={{ embedded: true, call }}
        onChanged={() => {}}
        onAnnotate={() => {}}
        externalViewport={{ x: 0, y: 0, zoom: 1 }}
        externalSelectedIds={[elements[0]!.id]}
      />,
    ),
  );

  return call;
}

async function click(label: string) {
  await pointer(host.querySelector(`[aria-label="${label}"]`)!, 'click', 0, 0, 0);
}

async function identity(frame: HTMLIFrameElement) {
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  await act(async () => frame.dispatchEvent(new Event('load')));
  const mode = post.mock.calls.find(([data]) => data.type === 'studio-html-mode')![0];

  return { channel: mode.channel, regionId: mode.regionId, sourceRevision: mode.sourceRevision };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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

it('routes middle dragging before a native interactive child can consume it', async () => {
  const call = await mount([value('shape')]);
  const control = document.createElement('button');
  control.dataset.nativeInteractive = 'true';
  control.addEventListener('pointerdown', (event) => event.stopPropagation());
  viewport().append(control);
  await pointer(control, 'pointerdown', 1, 240, 200);
  await pointer(viewport(), 'pointermove', 1, 340, 250);
  await pointer(viewport(), 'pointerup', 1, 340, 250);
  expect(world().style.transform).toBe('translate(100px,50px) scale(1)');
  expect(call).not.toHaveBeenCalled();
});

it('routes Ctrl wheel over an interactive child but leaves ordinary scrolling alone', async () => {
  await mount([value('shape')]);
  const control = document.createElement('textarea');
  control.dataset.nativeInteractive = 'true';
  viewport().append(control);
  const ordinary = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
  await act(async () => control.dispatchEvent(ordinary));
  expect(ordinary.defaultPrevented).toBe(false);
  expect(world().style.transform).toContain('scale(1)');
  const zoom = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: -20,
    ctrlKey: true,
    clientX: 200,
    clientY: 150,
  });
  await act(async () => control.dispatchEvent(zoom));
  expect(zoom.defaultPrevented).toBe(true);
  expect(world().style.transform).not.toContain('scale(1)');
});

it('uses middle on a resize handle for navigation and ignores right-button geometry edits', async () => {
  const call = await mount([value('shape')]);
  const resize = () => host.querySelector('[aria-label="调整元素大小 se"]')!;
  await pointer(resize(), 'pointerdown', 2, 300, 220);
  await pointer(viewport(), 'pointermove', 2, 400, 280);
  await pointer(viewport(), 'pointerup', 2, 400, 280);
  expect(world().style.transform).toContain('scale(1)');
  expect(call).not.toHaveBeenCalled();
  await pointer(resize(), 'pointerdown', 1, 300, 220);
  await pointer(viewport(), 'pointermove', 1, 380, 260);
  await pointer(viewport(), 'pointerup', 1, 380, 260);
  expect(world().style.transform).toBe('translate(80px,40px) scale(1)');
  expect(call).not.toHaveBeenCalled();
});

it('supports space navigation while reading and clears navigation on blur', async () => {
  await mount([value('shape')]);
  await click('全屏观看选区');
  await act(async () =>
    viewport().dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }),
    ),
  );
  expect(host.querySelector('.studio-whiteboard')?.getAttribute('data-tool')).toBe('pan');
  await pointer(viewport(), 'pointerdown', 0, 200, 160);
  await pointer(viewport(), 'pointermove', 0, 280, 180);
  const atBlur = world().style.transform;
  await act(async () => window.dispatchEvent(new Event('blur')));
  await pointer(viewport(), 'pointermove', 0, 330, 200);
  expect(world().style.transform).toBe(atBlur);
});

it('validates iframe navigation and pans by screen deltas without modifying content', async () => {
  const call = await mount([
    value('html', { type: 'html', html: '<button>Keep interactive</button>', sourceRevision: 1 }),
  ]);
  await click('全屏观看选区');
  const frame = host.querySelector('iframe')!;
  const key = await identity(frame);
  const initial = world().style.transform;
  const send = async (data: object, source: MessageEventSource | null = frame.contentWindow) =>
    act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source,
          data: { type: 'studio-html-navigation', ...key, ...data },
        }),
      ),
    );
  await send({
    kind: 'pan',
    phase: 'start',
    pointerId: 1,
    screenX: 100,
    screenY: 100,
    channel: 'stale',
  });
  await send({ kind: 'pan', phase: 'move', pointerId: 1, screenX: 300, screenY: 150 });
  expect(world().style.transform).toBe(initial);
  await send({ kind: 'pan', phase: 'start', pointerId: 1, screenX: 100, screenY: 100 });
  await send({ kind: 'pan', phase: 'move', pointerId: 1, screenX: 300, screenY: 150 });
  const moved = world().style.transform;
  expect(moved).not.toBe(initial);
  await send({ kind: 'pan', phase: 'end', pointerId: 1, screenX: 300, screenY: 150 });
  await send({ kind: 'pan', phase: 'move', pointerId: 1, screenX: 500, screenY: 300 });
  expect(world().style.transform).toBe(moved);
  expect(call).not.toHaveBeenCalled();
});
