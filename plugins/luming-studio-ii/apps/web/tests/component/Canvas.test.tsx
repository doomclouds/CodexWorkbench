import { act, createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Canvas,
  type CanvasEditIntent,
  type CanvasHandle,
  type CanvasMoveIntent,
  type CanvasPoint,
  type CanvasProps,
  type CanvasScene,
  type CanvasViewport,
} from '../../src/ui/domain/canvas/index.js';
import { createControlFixture } from '../support/render-control.js';

const scene: CanvasScene = {
  boardId: 'fixture-board',
  revision: 12,
  objects: [
    {
      id: 'back',
      kind: 'shape',
      label: '后层',
      geometry: { x: 20, y: 20, width: 160, height: 140, rotation: 0 },
      version: 2,
    },
    {
      id: 'front',
      kind: 'shape',
      label: '前层',
      geometry: { x: 80, y: 70, width: 160, height: 140, rotation: 0 },
      version: 5,
    },
    {
      id: 'locked',
      kind: 'shape',
      label: '锁定对象',
      geometry: { x: 270, y: 40, width: 80, height: 90, rotation: 0 },
      version: 3,
      locked: true,
    },
    {
      id: 'native',
      kind: 'native',
      label: '原生内容',
      geometry: { x: 380, y: 50, width: 160, height: 140, rotation: 0 },
      version: 2,
    },
    {
      id: 'distant',
      kind: 'shape',
      label: '远处对象',
      geometry: { x: 4800, y: 4000, width: 80, height: 70, rotation: 0 },
      version: 2,
    },
  ],
};

const origin: CanvasViewport = { x: 0, y: 0, zoom: 1 };

function pointer(target: EventTarget, type: string, point: CanvasPoint) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 1,
    button: type === 'pointermove' ? -1 : 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: point.x,
    clientY: point.y,
  });
  target.dispatchEvent(event);

  return event;
}

function drag(target: EventTarget, from: CanvasPoint, to: CanvasPoint) {
  act(() => {
    pointer(target, 'pointerdown', from);
    pointer(target, 'pointermove', to);
    pointer(target, 'pointerup', to);
  });
}

function wheel(target: EventTarget, options: WheelEventInit) {
  const event = new WheelEvent('wheel', { ...options, bubbles: true, cancelable: true });
  target.dispatchEvent(event);

  return event;
}

async function flushFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

describe('Canvas', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 720, 500),
    );
  });

  afterEach(() => {
    fixture.dispose();
    vi.restoreAllMocks();
  });

  function renderCanvas(props: Partial<CanvasProps> = {}) {
    const onSelectionChange = vi.fn<(selection: readonly string[]) => void>();
    const onEditIntent = vi.fn<(intent: CanvasEditIntent) => void>();
    const onViewportChange = vi.fn<(viewport: CanvasViewport) => void>();
    const onVisibleObjectsChange = vi.fn<(ids: readonly string[]) => void>();
    fixture.render(
      <Canvas
        viewId="fixture-view"
        label="测试画布"
        scene={scene}
        selection={[]}
        tool="select"
        canEdit
        initialViewport={origin}
        onSelectionChange={onSelectionChange}
        onEditIntent={onEditIntent}
        onViewportChange={onViewportChange}
        onVisibleObjectsChange={onVisibleObjectsChange}
        {...props}
      />,
    );

    const root = fixture.host.querySelector<HTMLElement>('[role="region"][aria-label="测试画布"]');
    if (!root) {
      throw new Error('Expected a named canvas region.');
    }

    return { root, onSelectionChange, onEditIntent, onViewportChange, onVisibleObjectsChange };
  }

  it('selects the topmost object at an overlapping point without submitting an edit', () => {
    const canvas = renderCanvas();
    const overlap = { x: 120, y: 110 };
    drag(canvas.root, overlap, overlap);

    expect(canvas.onSelectionChange).toHaveBeenLastCalledWith(['front']);
    expect(canvas.onEditIntent).not.toHaveBeenCalled();
    expect(canvas.onVisibleObjectsChange).toHaveBeenLastCalledWith([
      'back',
      'front',
      'locked',
      'native',
    ]);
    expect(canvas.root.querySelector('[data-canvas-object="distant"]')).toBeNull();
  });

  it('reports exactly one move on release with the object version and board-space geometry', () => {
    const canvas = renderCanvas({ selection: ['front'] });
    act(() => {
      pointer(canvas.root, 'pointerdown', { x: 140, y: 125 });
      pointer(canvas.root, 'pointermove', { x: 174, y: 145 });
    });
    expect(canvas.onEditIntent).not.toHaveBeenCalled();

    act(() => {
      pointer(canvas.root, 'pointermove', { x: 190, y: 160 });
      pointer(canvas.root, 'pointerup', { x: 190, y: 160 });
    });
    expect(canvas.onEditIntent).toHaveBeenCalledExactlyOnceWith({
      interactionId: expect.any(String),
      kind: 'move',
      delta: { x: 50, y: 35 },
      changes: [
        {
          id: 'front',
          expectedVersion: 5,
          geometry: { x: 130, y: 105, width: 160, height: 140, rotation: 0 },
        },
      ],
    });
  });

  it('drops a cancelled gesture without emitting a durable edit', () => {
    const canvas = renderCanvas({ selection: ['front'] });
    act(() => {
      pointer(canvas.root, 'pointerdown', { x: 140, y: 125 });
      pointer(canvas.root, 'pointermove', { x: 190, y: 160 });
      pointer(canvas.root, 'pointercancel', { x: 190, y: 160 });
      pointer(canvas.root, 'pointerup', { x: 190, y: 160 });
    });

    expect(canvas.onEditIntent).not.toHaveBeenCalled();
  });

  it('reconciles pending geometry after rejection and ignores edits based on an older object version', () => {
    const moved: CanvasMoveIntent = {
      interactionId: 'pending-front',
      kind: 'move',
      delta: { x: 1120, y: 0 },
      changes: [
        {
          id: 'front',
          expectedVersion: 5,
          geometry: { x: 1200, y: 70, width: 160, height: 140, rotation: 0 },
        },
      ],
    };
    const onVisibleObjectsChange = vi.fn<(ids: readonly string[]) => void>();
    renderCanvas({ pendingEdits: [moved], onVisibleObjectsChange });
    expect(onVisibleObjectsChange).toHaveBeenLastCalledWith(['back', 'locked', 'native']);

    renderCanvas({ pendingEdits: [], onVisibleObjectsChange });
    expect(onVisibleObjectsChange).toHaveBeenLastCalledWith(['back', 'front', 'locked', 'native']);

    const confirmed: CanvasScene = {
      ...scene,
      revision: scene.revision + 1,
      objects: scene.objects.map((object) =>
        object.id === 'front'
          ? { ...object, version: 6, geometry: { ...object.geometry, x: 550 } }
          : object,
      ),
    };
    const canvas = renderCanvas({
      scene: confirmed,
      pendingEdits: [moved],
      onVisibleObjectsChange,
    });
    const newLocation = { x: 620, y: 130 };
    drag(canvas.root, newLocation, newLocation);
    expect(canvas.onSelectionChange).toHaveBeenLastCalledWith(['front']);
    expect(onVisibleObjectsChange).toHaveBeenLastCalledWith(['back', 'front', 'locked', 'native']);
  });

  it('does not submit edits for readonly scenes or locked objects', () => {
    const readonly = renderCanvas({ canEdit: false, selection: ['front'] });
    drag(readonly.root, { x: 140, y: 125 }, { x: 190, y: 160 });
    expect(readonly.onEditIntent).not.toHaveBeenCalled();

    const locked = renderCanvas({ selection: ['locked'] });
    drag(locked.root, { x: 310, y: 80 }, { x: 350, y: 120 });
    expect(locked.onEditIntent).not.toHaveBeenCalled();
  });

  it('gives temporary pan priority when a gesture begins on a transform handle', () => {
    const { root, onEditIntent, onViewportChange } = renderCanvas({ selection: ['front'] });
    const handle = root.querySelector<HTMLElement>('[data-canvas-handle="se"]');
    if (!handle) {
      throw new Error('Expected the selected object to show its resize handle.');
    }

    act(() => {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      pointer(handle, 'pointerdown', { x: 240, y: 210 });
      pointer(root, 'pointermove', { x: 280, y: 240 });
      pointer(root, 'pointerup', { x: 280, y: 240 });
      root.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    });

    expect(onEditIntent).not.toHaveBeenCalled();
    expect(onViewportChange).toHaveBeenLastCalledWith({ x: 40, y: 30, zoom: 1 });
  });

  it('routes native input and selection to the owning canvas in nested views', () => {
    const innerScene: CanvasScene = {
      boardId: 'inner-board',
      revision: 1,
      objects: [
        {
          id: 'inner-native',
          kind: 'native',
          label: '内层容器',
          version: 1,
          geometry: { x: 10, y: 20, width: 130, height: 100, rotation: 0 },
        },
      ],
    };
    const innerSelect = vi.fn();
    const innerButton = <button type="button">内层输入</button>;
    const innerContent = new Map([['inner-native', innerButton]]);
    const innerCanvas = (
      <Canvas
        viewId="inner-view"
        label="内层画布"
        scene={innerScene}
        selection={[]}
        tool="select"
        canEdit
        contentById={innerContent}
        onSelectionChange={innerSelect}
        onEditIntent={vi.fn()}
      />
    );
    const { root, onSelectionChange } = renderCanvas({
      contentById: new Map([['native', innerCanvas]]),
    });
    const innerControl = root.querySelector<HTMLElement>('[aria-label="内层画布"] button');
    if (!innerControl) {
      throw new Error('Expected the nested native control to be mounted.');
    }

    act(() => {
      pointer(innerControl, 'pointerdown', { x: 410, y: 80 });
      pointer(innerControl, 'pointerup', { x: 410, y: 80 });
    });

    expect(innerSelect).toHaveBeenCalledExactlyOnceWith(['inner-native']);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('cancels an active drag when the authority removes its target', () => {
    const onEditIntent = vi.fn();
    const { root } = renderCanvas({ onEditIntent });
    act(() => {
      pointer(root, 'pointerdown', { x: 130, y: 100 });
      pointer(root, 'pointermove', { x: 160, y: 130 });
    });

    const nextScene = {
      ...scene,
      revision: scene.revision + 1,
      objects: scene.objects.filter((object) => object.id !== 'front'),
    };
    const next = renderCanvas({ onEditIntent, scene: nextScene });
    act(() => {
      pointer(next.root, 'pointerup', { x: 160, y: 130 });
    });

    expect(onEditIntent).not.toHaveBeenCalled();
    expect(next.root.querySelector('[data-canvas-object="front"]')).toBeNull();
  });

  it('exposes canvas focus and a fit operation without exposing the DOM node', async () => {
    const ref = createRef<CanvasHandle>();
    const canvas = renderCanvas({ ref });
    act(() => {
      ref.current?.focus();
    });
    expect(document.activeElement).toBe(canvas.root);
    expect(ref.current).toEqual({
      focus: expect.any(Function),
      fitToObjects: expect.any(Function),
    });

    act(() => {
      ref.current?.fitToObjects(['distant']);
    });
    await flushFrame();
    expect(canvas.onVisibleObjectsChange).toHaveBeenLastCalledWith(['distant']);
    expect(canvas.onViewportChange).toHaveBeenCalled();
  });

  it('preserves wheel ownership on native content and pans or zooms on the surrounding canvas', async () => {
    const native = <textarea aria-label="嵌入的文本框" />;
    const contentById = new Map([['native', native]]);
    const canvas = renderCanvas({ contentById });
    const textarea = canvas.root.querySelector('textarea');
    if (!textarea) {
      throw new Error('Expected native content in the viewport.');
    }

    canvas.onViewportChange.mockClear();
    act(() => {
      textarea.focus();
      expect(pointer(textarea, 'pointerdown', { x: 410, y: 70 }).defaultPrevented).toBe(false);
      pointer(textarea, 'pointermove', { x: 460, y: 90 });
      pointer(textarea, 'pointerup', { x: 460, y: 90 });
      expect(wheel(textarea, { deltaY: 60 }).defaultPrevented).toBe(false);
    });
    expect(document.activeElement).toBe(textarea);
    expect(canvas.onSelectionChange).toHaveBeenCalledExactlyOnceWith(['native']);
    expect(canvas.onViewportChange).not.toHaveBeenCalled();

    act(() => {
      wheel(canvas.root, { deltaY: 48 });
    });
    await flushFrame();
    expect(canvas.onViewportChange).toHaveBeenLastCalledWith({ x: 0, y: -48, zoom: 1 });

    act(() => {
      wheel(canvas.root, { deltaY: -100, ctrlKey: true, clientX: 80, clientY: 80 });
    });
    await flushFrame();
    const zoomed = canvas.onViewportChange.mock.lastCall?.[0];
    expect(zoomed?.zoom).toBeGreaterThan(1);
    expect(zoomed?.x).toBeLessThan(0);
    expect(canvas.onEditIntent).not.toHaveBeenCalled();
  });
});
