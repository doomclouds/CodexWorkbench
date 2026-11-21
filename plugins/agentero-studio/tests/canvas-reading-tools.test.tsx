import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WhiteboardCanvas from '../src/app/canvas/WhiteboardCanvas.js';
import {
  DEFAULT_STYLE,
  LOCAL_ACTOR,
  type Board,
  type BoardElement,
} from '../src/contracts/studio.js';

let host: HTMLDivElement;
let root: Root;
const originalView = { x: 14, y: 28, zoom: 0.5 };
const client = { embedded: true, call: vi.fn() };
const item = (id: string, extra: Partial<BoardElement> = {}): BoardElement => ({
  id,
  type: 'shape',
  x: 100,
  y: 100,
  w: 200,
  h: 100,
  version: 1,
  text: id,
  ...extra,
});
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const world = () => host.querySelector<HTMLElement>('.studio-canvas-world')!;

async function click(label: string) {
  await act(async () => button(label).click());
}

async function key(value: string) {
  await act(async () => {
    host
      .querySelector('[aria-label="白板画布"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  });
}

async function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'pointerId', { value: 4 });
  await act(async () => {
    host.querySelector('.studio-reading-marker')!.dispatchEvent(event);
  });
}

async function mount(elements = [item('focus'), item('hidden', { x: 6000 })]) {
  const board: Board = {
    artifact: {
      id: 'reading-tools',
      type: 'whiteboard',
      title: 'Reading controls',
      revision: 1,
      createdAt: '',
      updatedAt: '',
      pinned: false,
    },
    style: DEFAULT_STYLE,
    elements,
  };
  await act(async () =>
    root.render(
      <WhiteboardCanvas
        board={board}
        client={client}
        actor={LOCAL_ACTOR}
        onChanged={() => {}}
        onAnnotate={() => {}}
        externalSelectedIds={['focus']}
        externalViewport={originalView}
      />,
    ),
  );
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
  client.call.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('sets an exact reading zoom and fits only the viewed content, then restores the original view', async () => {
  await mount();
  const before = world().style.transform;
  await click('全屏观看选区');
  expect(host.querySelector('[aria-label="全屏观看工具"]')).not.toBeNull();
  const fitted = world().style.transform;
  const input = host.querySelector<HTMLInputElement>('[aria-label="全屏缩放比例"]')!;
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
  expect(world().style.transform).toContain('scale(1.375)');
  await click('适应全屏内容');
  expect(world().style.transform).toBe(fitted);
  await click('退出全屏观看');
  expect(world().style.transform).toBe(before);
  expect(client.call).not.toHaveBeenCalled();
});
it('cancels an edited percentage before Escape leaves full-screen viewing', async () => {
  await mount();
  await click('全屏观看选区');
  const before = world().style.transform;
  const input = host.querySelector<HTMLInputElement>('[aria-label="全屏缩放比例"]')!;
  await act(async () => {
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  expect(host.querySelector('.is-reading')).not.toBeNull();
  expect(world().style.transform).toBe(before);
  await key('Escape');
  expect(host.querySelector('.is-reading')).toBeNull();
});
it('draws and clears session marks without a content operation, and cancels a stroke before exiting', async () => {
  await mount();
  await click('全屏观看选区');
  await click('临时荧光笔');
  await pointer('pointerdown', 200, 250);
  await pointer('pointermove', 260, 270);
  await pointer('pointerup', 300, 280);
  expect(host.querySelectorAll('.studio-reading-marker path')).toHaveLength(1);
  await click('浏览内容');
  expect((host.querySelector('.studio-reading-marker') as HTMLElement).style.pointerEvents).toBe(
    'none',
  );
  expect(host.querySelectorAll('.studio-reading-marker path')).toHaveLength(1);
  await click('清除临时笔迹');
  expect(host.querySelectorAll('.studio-reading-marker path')).toHaveLength(0);
  await click('临时荧光笔');
  await pointer('pointerdown', 250, 250);
  await pointer('pointermove', 280, 280);
  await key('Escape');
  expect(host.querySelector('.is-reading')).not.toBeNull();
  expect(host.querySelectorAll('.studio-reading-marker path')).toHaveLength(0);
  await key('Escape');
  expect(host.querySelector('.is-reading')).toBeNull();
  expect(client.call).not.toHaveBeenCalled();
  await click('全屏观看选区');
  expect(host.querySelectorAll('.studio-reading-marker path')).toHaveLength(0);
  expect(button('浏览内容').getAttribute('aria-pressed')).toBe('true');
});
