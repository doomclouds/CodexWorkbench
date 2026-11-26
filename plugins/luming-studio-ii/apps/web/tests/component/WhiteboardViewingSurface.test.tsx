import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WhiteboardViewingSurface } from '../../src/surfaces/whiteboard-viewing/index.js';
import type { WhiteboardViewingSurfaceProps } from '../../src/surfaces/whiteboard-viewing/index.js';
import { Canvas } from '../../src/ui/domain/canvas/index.js';
import type { CanvasEditIntent, CanvasScene } from '../../src/ui/domain/canvas/index.js';
import { createControlFixture } from '../support/render-control.js';

const scene: CanvasScene = {
  boardId: 'viewing-test',
  revision: 1,
  objects: [],
};
const camera = { x: 10, y: 20, zoom: 2 };

function findElement<ElementType extends Element>(root: HTMLElement, selector: string) {
  const match = root.querySelector<ElementType>(selector);
  if (!match) {
    throw new Error('Expected element ' + selector);
  }

  return match;
}

function press(target: Element, key: string, options?: KeyboardEventInit) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }),
    );
  });
}

function pointer(target: Element, name: string, clientX: number, clientY: number, button = 0) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(name, {
        bubbles: true,
        cancelable: true,
        pointerId: 4,
        pointerType: 'mouse',
        isPrimary: true,
        button,
        clientX,
        clientY,
      }),
    );
  });
}

function changePercent(field: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  act(() => {
    field.focus();
    descriptor?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Whiteboard viewing controls and scoped ink', () => {
  let fixture: ReturnType<typeof createControlFixture>;
  const onExit = vi.fn<() => void>();
  const onZoom = vi.fn<(zoom: number) => void>();
  const onFit = vi.fn<() => void>();
  const onEditIntent = vi.fn<(intent: CanvasEditIntent) => void>();

  beforeEach(() => {
    vi.useFakeTimers();
    fixture = createControlFixture();
    onExit.mockClear();
    onZoom.mockClear();
    onFit.mockClear();
    onEditIntent.mockClear();
  });

  afterEach(() => {
    fixture.dispose();
    vi.useRealTimers();
  });

  function canvas() {
    return findElement<HTMLDivElement>(fixture.host, '[data-canvas-root]');
  }

  function button(label: string) {
    return findElement<HTMLButtonElement>(fixture.host, `button[aria-label="${label}"]`);
  }

  function click(label: string) {
    act(() => button(label).click());
  }

  function render(props: Partial<WhiteboardViewingSurfaceProps> = {}) {
    fixture.render(
      <WhiteboardViewingSurface
        active
        documentReading={false}
        title="版本评审"
        viewport={camera}
        onExit={onExit}
        onZoom={onZoom}
        onFit={onFit}
        onCanvasFocus={() => canvas().focus()}
        {...props}
      >
        <Canvas
          viewId="viewing-test"
          label="白板画布"
          scene={scene}
          selection={[]}
          canEdit={false}
          initialViewport={camera}
          tool="select"
          onSelectionChange={vi.fn()}
          onEditIntent={onEditIntent}
        />
      </WhiteboardViewingSurface>,
    );
  }

  it('keeps Canvas mounted and leaves the document return action to its reading surface', () => {
    render({ active: false });
    const board = canvas();
    expect(fixture.host.querySelector('[role="toolbar"]')).toBeNull();
    render();
    expect(canvas()).toBe(board);
    expect(document.activeElement).toBe(button('退出全屏观看'));
    render({ documentReading: true });
    expect(canvas()).toBe(board);
    expect(fixture.host.querySelector('[role="toolbar"]')).toBeNull();
    expect(fixture.host.querySelector('[data-whiteboard-viewing-chrome]')).toBeNull();
    press(canvas(), 'Escape');
    expect(onExit).toHaveBeenCalledOnce();
    render({ active: false });
    expect(canvas()).toBe(board);
  });

  it('validates exact percentages and lets the input and preset menu consume Escape first', () => {
    render();
    const field = findElement<HTMLInputElement>(fixture.host, 'input[aria-label="全屏缩放比例"]');
    expect(field.value).toBe('200');
    changePercent(field, '137.5%');
    press(field, 'Enter');
    expect(onZoom).toHaveBeenLastCalledWith(1.375);
    expect(document.activeElement).toBe(canvas());

    changePercent(field, '900%');
    press(field, 'Enter');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    press(field, 'Escape');
    expect(field.value).toBe('200');
    expect(onExit).not.toHaveBeenCalled();

    click('常用全屏比例');
    const menu = findElement<HTMLElement>(fixture.host, '[role="menu"]');
    const checked = menu.querySelector('[aria-checked="true"]');
    expect(document.activeElement).toBe(checked);
    press(menu, 'Home');
    expect(document.activeElement?.textContent).toBe('25%');
    press(menu, 'Escape');
    expect(fixture.host.querySelector('[role="menu"]')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();

    click('适应全屏内容');
    expect(onFit).toHaveBeenCalledOnce();
    press(canvas(), 'Escape');
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('keeps completed strokes in world coordinates and removes them after fading', () => {
    render();
    click('临时荧光笔');
    pointer(canvas(), 'pointerdown', 50, 70);
    pointer(canvas(), 'pointermove', 90, 110);
    pointer(canvas(), 'pointerup', 110, 130);
    const stroke = findElement<SVGPathElement>(fixture.host, '.whiteboard-viewing__ink path');
    expect(stroke.getAttribute('d')).toBe('M20 25 L40 45 L50 55');
    expect(stroke.getAttribute('stroke-width')).toBe('7');
    expect(onEditIntent).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    render({ viewport: { x: -100, y: 50, zoom: 4 } });
    expect(stroke.parentElement?.getAttribute('transform')).toBe('translate(-100 50) scale(4)');
    expect(stroke.getAttribute('data-fading')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(stroke.getAttribute('data-fading')).toBe('true');
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(stroke.isConnected).toBe(false);
  });

  it('leaves middle-button and space navigation intact and cancels an unfinished pen before exit', () => {
    render();
    click('临时荧光笔');
    pointer(canvas(), 'pointerdown', 50, 70, 1);
    pointer(canvas(), 'pointerup', 50, 70, 1);
    expect(fixture.host.querySelector('[data-drawing]')).toBeNull();

    press(canvas(), ' ', { code: 'Space' });
    pointer(canvas(), 'pointerdown', 50, 70);
    pointer(canvas(), 'pointerup', 50, 70);
    expect(fixture.host.querySelector('[data-drawing]')).toBeNull();
    act(() => {
      canvas().dispatchEvent(
        new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }),
      );
    });

    pointer(canvas(), 'pointerdown', 50, 70);
    expect(fixture.host.querySelector('[data-drawing]')).not.toBeNull();
    press(canvas(), 'Escape');
    expect(fixture.host.querySelector('[data-drawing]')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    press(canvas(), 'Escape');
    expect(onExit).toHaveBeenCalledOnce();
    expect(onEditIntent).not.toHaveBeenCalled();
  });
});
