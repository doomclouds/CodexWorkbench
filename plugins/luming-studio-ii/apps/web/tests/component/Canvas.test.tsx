import { act, createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Canvas,
  type CanvasCreateIntent,
  type CanvasEditIntent,
  type CanvasGesturePreview,
  type CanvasHandle,
  type CanvasMoveIntent,
  type CanvasPlacementTool,
  type CanvasPoint,
  type CanvasProps,
  type CanvasScene,
  type CanvasTool,
  type CanvasViewport,
} from '../../src/ui/domain/canvas/index.js';
import { initialReceiptState, reduceReceipts } from '../fixtures/canvas/receipts.js';
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
const placement: CanvasPlacementTool = {
  kind: 'place',
  requestId: 'place-rectangle',
  object: { kind: 'shape', label: '新图形', shape: 'rect', width: 100, height: 80 },
};

function pointer(
  target: EventTarget,
  type: string,
  point: CanvasPoint,
  modifiers: Pick<PointerEventInit, 'altKey' | 'shiftKey'> = {},
) {
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
    ...modifiers,
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
    const onToolChange = vi.fn<(tool: CanvasTool) => void>();
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
        onToolChange={onToolChange}
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

    return {
      root,
      onSelectionChange,
      onToolChange,
      onEditIntent,
      onViewportChange,
      onVisibleObjectsChange,
    };
  }

  it('emits only temporary geometry while dragging then clears it on cancel', async () => {
    const preview = vi.fn<(gesture: CanvasGesturePreview | undefined) => void>();
    const { root, onEditIntent } = renderCanvas({ onGesturePreviewChange: preview });
    act(() => {
      pointer(root, 'pointerdown', { x: 110, y: 90 });
      pointer(root, 'pointermove', { x: 155, y: 125 });
    });
    await flushFrame();

    expect(preview).toHaveBeenLastCalledWith({
      kind: 'move',
      changes: [
        { id: 'front', expectedVersion: 5, geometry: expect.objectContaining({ width: 160 }) },
      ],
    });
    expect(onEditIntent).not.toHaveBeenCalled();

    act(() => {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(preview).toHaveBeenLastCalledWith(undefined);
    expect(onEditIntent).not.toHaveBeenCalled();
  });

  it('keeps the nearby render window across modest zoom changes while reporting exact visibility', async () => {
    const edge = {
      ...scene.objects[0]!,
      id: 'edge',
      geometry: { x: 665, y: 90, width: 45, height: 25, rotation: 0 },
    };
    const board = { ...scene, objects: [...scene.objects, edge] };
    const visible = vi.fn<(ids: readonly string[]) => void>();
    const view = (zoom: number) =>
      renderCanvas({
        scene: board,
        onVisibleObjectsChange: visible,
        viewportRequest: { requestId: String(zoom), viewport: { x: 0, y: 0, zoom } },
      });
    view(1);
    await flushFrame();
    const element = fixture.host.querySelector('[data-canvas-object="edge"]');
    expect(element).toBeInstanceOf(HTMLElement);
    view(1.6);
    await flushFrame();
    expect(fixture.host.querySelector('[data-canvas-object="edge"]')).toBe(element);
    expect(visible.mock.lastCall?.[0]).not.toContain('edge');
    view(4);
    await flushFrame();
    expect(fixture.host.querySelector('[data-canvas-object="edge"]')).toBeNull();
  });

  it('paints a peer resize on a read-only canvas until the committed version supersedes it', () => {
    const gesture = {
      kind: 'resize',
      changes: [
        {
          id: 'front',
          expectedVersion: 5,
          geometry: { x: 80, y: 70, width: 400, height: 260, rotation: 0 },
        },
      ],
    } as const satisfies CanvasGesturePreview;
    const initial = renderCanvas({ canEdit: false, remoteGesturePreviews: [gesture] });
    const dimensions = () =>
      fixture.host.querySelector<HTMLElement>('[data-canvas-object="front"]')?.style.width;
    expect(dimensions()).toBe('400px');
    expect(initial.onEditIntent).not.toHaveBeenCalled();

    const committed = {
      ...scene,
      revision: scene.revision + 1,
      objects: scene.objects.map((object) =>
        object.id === 'front'
          ? { ...object, version: 6, geometry: { ...object.geometry, width: 440 } }
          : object,
      ),
    };
    renderCanvas({ scene: committed, canEdit: false, remoteGesturePreviews: [gesture] });
    expect(dimensions()).toBe('440px');
  });

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

  it('places once in board coordinates while the caller still supplies the previous tool', () => {
    const { root, onEditIntent, onToolChange } = renderCanvas({
      tool: placement,
      initialViewport: { x: 40, y: 20, zoom: 2 },
    });
    const first = { x: 560, y: 300 };
    const second = { x: 600, y: 380 };
    act(() => {
      pointer(root, 'pointerdown', first);
      pointer(root, 'pointerup', first);
      pointer(root, 'pointerdown', second);
      pointer(root, 'pointerup', second);
    });

    expect(onEditIntent).toHaveBeenCalledExactlyOnceWith({
      interactionId: expect.any(String),
      kind: 'create',
      object: {
        kind: 'shape',
        label: '新图形',
        shape: 'rect',
        geometry: { x: 260, y: 140, width: 100, height: 80, rotation: 0 },
      },
    });
    expect(onToolChange).toHaveBeenCalledExactlyOnceWith('select');
  });

  it('cancels the placement preview on Escape and exits the tool on a second press', async () => {
    const onEditIntent = vi.fn<(intent: CanvasEditIntent) => void>();
    const { root, onToolChange } = renderCanvas({ tool: placement, onEditIntent });
    const start = { x: 470, y: 240 };
    const end = { x: 590, y: 360 };
    act(() => {
      pointer(root, 'pointerdown', start);
      pointer(root, 'pointermove', end);
    });
    await flushFrame();
    expect(root.querySelector('[data-canvas-draft]')).not.toBeNull();

    act(() => {
      root.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      pointer(root, 'pointerup', end);
    });
    expect(onEditIntent).not.toHaveBeenCalled();
    expect(onToolChange).not.toHaveBeenCalled();
    expect(root.querySelector('[data-canvas-draft]')).toBeNull();

    act(() => {
      root.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    drag(root, start, start);
    expect(onEditIntent).not.toHaveBeenCalled();
    expect(onToolChange).toHaveBeenCalledExactlyOnceWith('select');
    expect(root.querySelector('[data-canvas-draft]')).toBeNull();

    renderCanvas({ tool: { ...placement, requestId: 'next-rectangle' }, onEditIntent });
    drag(root, start, start);
    expect(onEditIntent).toHaveBeenCalledTimes(1);
  });

  it('keeps a pending creation outside the confirmed scene and reconciles its receipt', () => {
    const created: CanvasCreateIntent = {
      interactionId: 'placed-note',
      kind: 'create',
      object: {
        kind: 'note',
        label: '待确认便签',
        geometry: { x: 400, y: 260, width: 120, height: 100, rotation: 0 },
      },
    };
    const { root } = renderCanvas({ pendingEdits: [created] });
    const confirmedNote = '[data-canvas-object="placed-note"]';
    expect(root.querySelector('[data-canvas-draft]')?.textContent).toContain('待确认便签');
    expect(root.querySelector(confirmedNote)).toBeNull();

    renderCanvas({ pendingEdits: [] });
    expect(root.querySelector('[data-canvas-draft]')).toBeNull();

    const confirmed: CanvasScene = {
      ...scene,
      revision: scene.revision + 1,
      objects: [...scene.objects, { ...created.object, id: created.interactionId, version: 1 }],
    };
    renderCanvas({ scene: confirmed, pendingEdits: [] });
    expect(root.querySelector(confirmedNote)?.textContent).toContain('待确认便签');
    expect(root.querySelector('[data-canvas-draft]')).toBeNull();
  });

  it('passes through nested transparent interiors and selects the actual section title', () => {
    const framed: CanvasScene = {
      ...scene,
      objects: [
        ...scene.objects,
        {
          id: 'outer-section',
          kind: 'section',
          label: '外层分区',
          transparent: true,
          geometry: { x: 8, y: 12, width: 250, height: 240, rotation: 0 },
          version: 1,
        },
        {
          id: 'inner-section',
          kind: 'section',
          label: '内层分区',
          transparent: true,
          parentId: 'outer-section',
          geometry: { x: 72, y: 58, width: 165, height: 165, rotation: 0 },
          version: 1,
        },
      ],
    };
    const { root, onSelectionChange, onEditIntent } = renderCanvas({ scene: framed });
    const overlap = { x: 120, y: 110 };
    drag(root, overlap, overlap);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['front']);

    const title = root.querySelector(
      '[data-canvas-object="inner-section"] [data-canvas-section-title]',
    );

    if (!title) {
      throw new Error('Expected the nested section title to be available for hit testing.');
    }

    const titlePoint = { x: 86, y: 50 };
    drag(title, titlePoint, titlePoint);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['inner-section']);
    expect(onEditIntent).not.toHaveBeenCalled();
  });

  it('uses the same snapped geometry for the preview and the committed move', async () => {
    const snappingScene: CanvasScene = {
      ...scene,
      objects: [
        {
          id: 'moving',
          kind: 'shape',
          label: '移动图形',
          geometry: { x: 20, y: 90, width: 60, height: 60, rotation: 0 },
          version: 4,
        },
        {
          id: 'anchor',
          kind: 'shape',
          label: '参照图形',
          geometry: { x: 200, y: 90, width: 80, height: 60, rotation: 0 },
          version: 1,
        },
      ],
    };
    const { root, onEditIntent } = renderCanvas({ scene: snappingScene, selection: ['moving'] });
    const end = { x: 157, y: 120 };
    act(() => {
      pointer(root, 'pointerdown', { x: 40, y: 120 });
      pointer(root, 'pointermove', end);
    });
    await flushFrame();
    const moving = root.querySelector<HTMLElement>('[data-canvas-object="moving"]');
    expect(moving?.style.left).toBe('140px');

    act(() => {
      pointer(root, 'pointerup', end);
    });
    expect(onEditIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'move',
      interactionId: expect.any(String),
      delta: { x: 120, y: 0 },
      changes: [
        {
          id: 'moving',
          expectedVersion: 4,
          geometry: { x: 140, y: 90, width: 60, height: 60, rotation: 0 },
        },
      ],
    });
  });

  it('keeps the original in place while an Alt drag previews and submits its copy', async () => {
    const { root, onEditIntent } = renderCanvas({ selection: ['front'] });
    const start = { x: 140, y: 125 };
    const end = { x: 225, y: 180 };
    const alt = { altKey: true };
    act(() => {
      pointer(root, 'pointerdown', start, alt);
      pointer(root, 'pointermove', end, alt);
    });
    await flushFrame();
    const original = root.querySelector<HTMLElement>('[data-canvas-object="front"]');
    expect(original?.style.left).toBe('80px');
    expect(root.querySelector('[data-canvas-draft]')).not.toBeNull();

    act(() => {
      pointer(root, 'pointerup', end, alt);
    });
    const intent = onEditIntent.mock.lastCall?.[0];
    if (intent?.kind !== 'duplicate') {
      throw new Error('Expected Alt drag to emit a duplication intent.');
    }

    expect(intent.sources).toEqual([
      {
        id: 'front',
        expectedVersion: 5,
        geometry: {
          x: 80 + intent.delta.x,
          y: 70 + intent.delta.y,
          width: 160,
          height: 140,
          rotation: 0,
        },
      },
    ]);
  });

  it('copies a group with its attached connector and binds the confirmed copy to the new nodes', () => {
    const groupId = 'connected-group';
    const connected: CanvasScene = {
      ...scene,
      objects: [
        {
          id: 'source',
          kind: 'shape',
          label: '起点',
          groupId,
          geometry: { x: 60, y: 60, width: 100, height: 80, rotation: 0 },
          version: 2,
        },
        {
          id: 'target',
          kind: 'shape',
          label: '终点',
          groupId,
          geometry: { x: 240, y: 60, width: 100, height: 80, rotation: 0 },
          version: 3,
        },
        {
          id: 'wire',
          kind: 'connector',
          label: '组内连线',
          groupId,
          geometry: { x: 160, y: 100, width: 80, height: 1, rotation: 0 },
          connection: {
            start: { point: { x: 160, y: 100 }, attachment: { objectId: 'source', port: 'right' } },
            end: { point: { x: 240, y: 100 }, attachment: { objectId: 'target', port: 'left' } },
          },
          version: 4,
        },
      ],
    };
    const originals = structuredClone(connected.objects);
    const { root, onEditIntent } = renderCanvas({ scene: connected });
    const start = { x: 100, y: 100 };
    const end = { x: 180, y: 200 };
    const alt = { altKey: true };
    act(() => {
      pointer(root, 'pointerdown', start, alt);
      pointer(root, 'pointermove', end, alt);
      pointer(root, 'pointerup', end, alt);
    });

    const intent = onEditIntent.mock.lastCall?.[0];
    if (intent?.kind !== 'duplicate') {
      throw new Error('Expected a duplication intent for the connected group.');
    }

    expect(onEditIntent).toHaveBeenCalledTimes(1);
    expect(intent.sources.map(({ id }) => id).sort()).toEqual(['source', 'target', 'wire']);

    const state = { ...initialReceiptState, scene: connected };
    const pending = reduceReceipts(state, { type: 'edit', intent });
    const confirmed = reduceReceipts(pending, {
      type: 'receipt',
      interactionId: intent.interactionId,
      accepted: true,
    });
    expect(confirmed.scene.objects.slice(0, 3)).toEqual(originals);

    const [source, target, connector] = confirmed.scene.objects.slice(3);
    expect(source?.geometry).toMatchObject({ x: 140, y: 160 });
    expect(target?.geometry).toMatchObject({ x: 320, y: 160 });
    expect(connector).toMatchObject({
      kind: 'connector',
      connection: {
        start: { attachment: { objectId: source?.id, port: 'right' } },
        end: { attachment: { objectId: target?.id, port: 'left' } },
      },
    });
  });

  it('publishes consecutive pen strokes with their final point and exits on Escape', () => {
    const { root, onEditIntent, onToolChange } = renderCanvas({ tool: 'pen' });
    act(() => {
      pointer(root, 'pointerdown', { x: 470, y: 250 });
      pointer(root, 'pointermove', { x: 510, y: 270 });
    });
    expect(onEditIntent).not.toHaveBeenCalled();

    act(() => {
      pointer(root, 'pointerup', { x: 530, y: 300 });
    });
    const intent = onEditIntent.mock.lastCall?.[0];
    if (intent?.kind !== 'create' || intent.object.kind !== 'ink') {
      throw new Error('Expected a completed pen stroke.');
    }

    expect(onEditIntent).toHaveBeenCalledTimes(1);
    expect(intent.object.ink.points).toHaveLength(3);
    expect(intent.object.geometry.width).toBeGreaterThanOrEqual(60);
    expect(onToolChange).not.toHaveBeenCalled();

    renderCanvas({ tool: 'pen', canEdit: false, canDraw: true, onEditIntent, onToolChange });
    drag(root, { x: 470, y: 330 }, { x: 530, y: 360 });
    expect(onEditIntent).toHaveBeenCalledTimes(2);
    expect(onEditIntent.mock.lastCall?.[0]).toMatchObject({
      kind: 'create',
      object: { kind: 'ink' },
    });
    expect(onToolChange).not.toHaveBeenCalled();

    act(() => {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onToolChange).toHaveBeenCalledExactlyOnceWith('select');
  });

  it('cancels an active pen stroke when edit permission is revoked', async () => {
    const onEditIntent = vi.fn<(intent: CanvasEditIntent) => void>();
    const { root } = renderCanvas({ tool: 'pen', onEditIntent });
    const start = { x: 470, y: 250 };
    const end = { x: 530, y: 300 };
    act(() => {
      pointer(root, 'pointerdown', start);
      pointer(root, 'pointermove', end);
    });
    await flushFrame();
    expect(root.querySelector('[data-canvas-draft]')).not.toBeNull();

    renderCanvas({ tool: 'pen', canEdit: false, onEditIntent });
    act(() => {
      pointer(root, 'pointerup', end);
    });
    await flushFrame();

    expect(onEditIntent).not.toHaveBeenCalled();
    expect(root.querySelector('[data-canvas-draft]')).toBeNull();
  });

  it('creates a connector between ports selected in the canvas', () => {
    const { root, onEditIntent, onToolChange } = renderCanvas({ tool: 'connector' });
    drag(root, { x: 240, y: 140 }, { x: 380, y: 120 });

    const intent = onEditIntent.mock.lastCall?.[0];
    expect(onEditIntent).toHaveBeenCalledTimes(1);
    expect(intent).toMatchObject({
      kind: 'create',
      object: {
        kind: 'connector',
        connection: {
          start: { attachment: { objectId: 'front', port: 'right' } },
          end: { attachment: { objectId: 'native', port: 'left' } },
        },
      },
    });
    expect(onToolChange).toHaveBeenCalledExactlyOnceWith('select');
  });

  it('reconnects an existing end through its handle and carries the version of that connector', () => {
    const withConnector: CanvasScene = {
      ...scene,
      objects: [
        ...scene.objects,
        {
          id: 'wire',
          kind: 'connector',
          label: '连接',
          geometry: { x: 240, y: 85, width: 30, height: 55, rotation: 0 },
          version: 8,
          connection: {
            start: { point: { x: 240, y: 140 }, attachment: { objectId: 'front', port: 'right' } },
            end: { point: { x: 270, y: 85 }, attachment: { objectId: 'locked', port: 'left' } },
          },
        },
      ],
    };
    const { root, onEditIntent } = renderCanvas({ scene: withConnector, selection: ['wire'] });
    const endHandle = root.querySelector('[data-canvas-connector-handle="end"]');
    if (!endHandle) {
      throw new Error('Expected the selected connector to show an end handle.');
    }

    act(() => {
      const next = { x: 380, y: 120 };
      pointer(endHandle, 'pointerdown', { x: 270, y: 85 });
      pointer(root, 'pointermove', next);
      pointer(root, 'pointerup', next);
    });

    expect(onEditIntent).toHaveBeenCalledTimes(1);
    expect(onEditIntent.mock.lastCall?.[0]).toMatchObject({
      kind: 'connect',
      changes: [
        {
          id: 'wire',
          expectedVersion: 8,
          connection: {
            start: { attachment: { objectId: 'front', port: 'right' } },
            end: { attachment: { objectId: 'native', port: 'left' } },
          },
        },
      ],
    });
  });

  it('moves a section and its editable children without changing locked geometry', () => {
    const withSection: CanvasScene = {
      ...scene,
      objects: [
        {
          id: 'section',
          kind: 'section',
          label: '包含锁定对象的分区',
          transparent: true,
          geometry: { x: 20, y: 50, width: 320, height: 210, rotation: 0 },
          version: 3,
        },
        {
          id: 'child',
          kind: 'shape',
          label: '可移动子对象',
          parentId: 'section',
          geometry: { x: 60, y: 80, width: 60, height: 50, rotation: 0 },
          version: 4,
        },
        {
          id: 'locked-child',
          kind: 'shape',
          label: '锁定子对象',
          parentId: 'section',
          geometry: { x: 70, y: 144, width: 70, height: 60, rotation: 0 },
          version: 5,
          locked: true,
        },
      ],
    };
    const { root, onEditIntent } = renderCanvas({ scene: withSection });
    const title = root.querySelector('[data-canvas-object="section"] [data-canvas-section-title]');
    if (!title) {
      throw new Error('Expected to be able to drag the section title.');
    }

    drag(title, { x: 40, y: 41 }, { x: 105, y: 102 });
    const intent = onEditIntent.mock.lastCall?.[0];
    if (intent?.kind !== 'move') {
      throw new Error('Expected a move intent for the section drag.');
    }

    expect(intent.changes.map(({ id }) => id).sort()).toEqual(['child', 'section']);
  });

  it.each(['document', 'todo'] as const)(
    'resizes a %s with an optimistic projection while preserving its focused content',
    async (kind) => {
      const card = {
        id: 'card',
        kind,
        label: '原生对象',
        geometry: { x: 100, y: 80, width: 180, height: 120, rotation: 0 },
        version: 1,
      };
      const withCard = { ...scene, objects: [card] };
      const body =
        kind === 'document' ? (
          <textarea aria-label="文档内容" defaultValue="正文" />
        ) : (
          <input type="checkbox" aria-label="清单项目" defaultChecked />
        );
      const contentById = new Map([[card.id, body]]);
      const selection = [card.id];
      const onGesturePreviewChange = vi.fn<(preview: CanvasGesturePreview | undefined) => void>();
      const { root, onEditIntent } = renderCanvas({
        scene: withCard,
        contentById,
        selection,
        onGesturePreviewChange,
      });
      const control = root.querySelector<HTMLElement>('textarea, input');
      const handle = root.querySelector('[data-canvas-handle="e"]');
      if (!control || !handle) {
        throw new Error('Expected focusable content and a side resize handle.');
      }

      const end = { x: 368, y: 140 };
      act(() => {
        pointer(handle, 'pointerdown', { x: 280, y: 140 });
        pointer(root, 'pointermove', end);
      });
      await flushFrame();
      const cardView = root.querySelector<HTMLElement>('[data-canvas-object="card"]');
      expect(cardView?.style.width).toBe('268px');
      expect(onEditIntent).not.toHaveBeenCalled();
      expect(onGesturePreviewChange).toHaveBeenLastCalledWith({
        kind: 'resize',
        changes: [
          {
            id: card.id,
            expectedVersion: card.version,
            geometry: { ...card.geometry, width: 268 },
          },
        ],
      });
      expect(root.querySelector('textarea, input')).toBe(control);

      act(() => {
        pointer(root, 'pointerup', end);
        control.focus();
      });
      const resize = onEditIntent.mock.lastCall?.[0];
      expect(onGesturePreviewChange).toHaveBeenLastCalledWith(undefined);
      if (resize?.kind !== 'resize') {
        throw new Error('Expected resize to emit an editable object change on release.');
      }

      expect(resize.changes).toEqual([
        { id: card.id, expectedVersion: card.version, geometry: { ...card.geometry, width: 268 } },
      ]);
      renderCanvas({ scene: withCard, contentById, selection, pendingEdits: [resize] });

      expect(cardView?.style.width).toBe('268px');
      expect(root.querySelector('textarea, input')).toBe(control);
      expect(document.activeElement).toBe(control);
    },
  );

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

  it('cancels body dragging when the captured content is replaced', async () => {
    const onEditIntent = vi.fn<(intent: CanvasEditIntent) => void>();
    const onGesturePreviewChange = vi.fn<(gesture: CanvasGesturePreview | undefined) => void>();
    const options: Partial<CanvasProps> = {
      selection: ['native'],
      objectExtensions: [
        {
          kind: 'native',
          capabilities: {
            move: true,
            resize: true,
            rotate: true,
            connect: true,
            content: 'native',
          },
          capturePointerTargetOnBodyDrag: true,
        },
      ],
      onGesturePreviewChange,
      onEditIntent,
    };
    const body = <span data-canvas-drag-surface="body">可移动内容</span>;
    const { root } = renderCanvas({ ...options, contentById: new Map([['native', body]]) });
    const captured = root.querySelector('[data-canvas-drag-surface="body"]');
    if (!captured) {
      throw new Error('Expected an editable body drag surface.');
    }

    const release = { x: 470, y: 110 };
    act(() => {
      pointer(captured, 'pointerdown', { x: 410, y: 90 });
      pointer(captured, 'pointermove', release);
    });
    await flushFrame();
    expect(onGesturePreviewChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'move' }),
    );

    renderCanvas(options);
    expect(captured.isConnected).toBe(false);
    act(() => {
      pointer(root.ownerDocument, 'lostpointercapture', release);
      pointer(root, 'pointerup', release);
    });
    expect(onGesturePreviewChange).toHaveBeenLastCalledWith(undefined);
    expect(onEditIntent).not.toHaveBeenCalled();
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
    const innerRegion = root.querySelector<HTMLElement>('[aria-label="内层画布"]');
    const innerControl = innerRegion?.querySelector('button');
    if (!innerRegion || !innerControl) {
      throw new Error('Expected the nested native control to be mounted.');
    }

    vi.spyOn(innerRegion, 'getBoundingClientRect').mockReturnValue(new DOMRect(380, 50, 160, 140));
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
