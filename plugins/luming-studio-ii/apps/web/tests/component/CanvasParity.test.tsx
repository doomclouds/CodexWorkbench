import { act, createRef } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Canvas,
  type CanvasEditIntent,
  type CanvasHandle,
  type CanvasObject,
  type CanvasPoint,
  type CanvasProps,
  type CanvasScene,
  type CanvasViewport,
} from '../../src/ui/domain/canvas/index.js';
import { createControlFixture } from '../support/render-control.js';

const view: CanvasViewport = { x: 0, y: 0, zoom: 1 };
const shapeCenter = { x: 120, y: 120 };
const dragEnd = { x: 183, y: 164 };
const documentBody = { x: 360, y: 170 };
const pointerButtons = [1, 4, 2];
const board: CanvasScene = {
  boardId: 'parity-board',
  revision: 5,
  objects: [
    {
      id: 'card',
      kind: 'shape',
      label: '卡片',
      geometry: { x: 80, y: 80, width: 100, height: 80, rotation: 25 },
      version: 3,
    },
    {
      id: 'document',
      kind: 'document',
      label: '文档',
      geometry: { x: 300, y: 80, width: 220, height: 190, rotation: 0 },
      version: 2,
    },
    {
      id: 'remote',
      kind: 'shape',
      label: '远处',
      geometry: { x: 4100, y: 2450, width: 160, height: 120, rotation: 0 },
      version: 1,
    },
  ],
};

function requireElement<T extends Element>(root: ParentNode, selector: string) {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error('Expected Canvas element for ' + selector);
  }

  return element;
}

function pointer(target: EventTarget, type: string, point: CanvasPoint, button = 0) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    button: type === 'pointermove' ? -1 : button,
    buttons: type === 'pointerup' ? 0 : pointerButtons[button],
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  });
  target.dispatchEvent(event);

  return event;
}

function key(target: EventTarget, keyName: string) {
  const event = new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true });
  target.dispatchEvent(event);

  return event;
}

function zoom(target: EventTarget, point: CanvasPoint) {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    deltaY: -100,
    clientX: point.x,
    clientY: point.y,
  });
  target.dispatchEvent(event);

  return event;
}

async function flushFrame() {
  await act(async () => {
    await new Promise<void>((done) => {
      window.requestAnimationFrame(() => done());
    });
  });
}

describe('Canvas legacy interaction parity', () => {
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
      <>
        <button type="button">画布之外</button>
        <Canvas
          viewId="parity-view"
          label="画布回归"
          scene={board}
          selection={[]}
          tool="select"
          canEdit
          initialViewport={view}
          onSelectionChange={onSelectionChange}
          onEditIntent={onEditIntent}
          onViewportChange={onViewportChange}
          onVisibleObjectsChange={onVisibleObjectsChange}
          {...props}
        />
      </>,
    );

    const region = requireElement<HTMLDivElement>(fixture.host, '[aria-label="画布回归"]');

    return { region, onSelectionChange, onEditIntent, onViewportChange, onVisibleObjectsChange };
  }

  it('navigates from a middle press before native content stops bubbling', () => {
    const content = (
      <button
        type="button"
        aria-label="原生内容操作"
        onPointerDown={(event) => event.stopPropagation()}
      >
        原生操作
      </button>
    );
    const { region, onEditIntent, onViewportChange } = renderCanvas({
      contentById: new Map([['document', content]]),
    });
    const control = requireElement<HTMLButtonElement>(region, '[aria-label="原生内容操作"]');
    const end = { x: documentBody.x + 48, y: documentBody.y + 31 };
    act(() => {
      pointer(control, 'pointerdown', documentBody, 1);
      pointer(region, 'pointermove', end, 1);
      pointer(region, 'pointerup', end, 1);
    });

    expect(onViewportChange).toHaveBeenLastCalledWith({ x: 48, y: 31, zoom: 1 });
    expect(onEditIntent).not.toHaveBeenCalled();
  });

  it('pans from a resize handle with the middle button and rejects right-button geometry edits', () => {
    const { region, onEditIntent, onViewportChange } = renderCanvas({ selection: ['card'] });
    const handle = requireElement<HTMLButtonElement>(region, '[data-canvas-handle="se"]');
    const from = { x: 180, y: 160 };
    const to = { x: 200, y: 202 };
    act(() => {
      pointer(handle, 'pointerdown', from, 1);
      pointer(region, 'pointermove', to, 1);
      pointer(region, 'pointerup', to, 1);
      pointer(handle, 'pointerdown', from, 2);
      pointer(region, 'pointermove', to, 2);
      pointer(region, 'pointerup', to, 2);
    });

    expect(onViewportChange).toHaveBeenLastCalledWith({ x: 20, y: 42, zoom: 1 });
    expect(onEditIntent).not.toHaveBeenCalled();
  });

  it('releases the temporary pan tool on blur so the next primary drag moves the object', () => {
    const { region, onEditIntent, onViewportChange } = renderCanvas({ selection: ['card'] });
    const outside = requireElement<HTMLButtonElement>(fixture.host, 'button');
    act(() => {
      region.focus();
      key(region, ' ');
      outside.focus();
      pointer(region, 'pointerdown', shapeCenter);
      pointer(region, 'pointermove', dragEnd);
      pointer(region, 'pointerup', dragEnd);
    });

    expect(onViewportChange).toHaveBeenLastCalledWith(view);
    expect(onEditIntent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'move' }));
  });

  it('preserves consecutive Ctrl-wheel anchors and publishes their combined viewport once', async () => {
    const content = <textarea aria-label="文档正文" />;
    const { region, onViewportChange, onEditIntent } = renderCanvas({
      contentById: new Map([['document', content]]),
    });
    const input = requireElement<HTMLTextAreaElement>(region, 'textarea');
    const first = { x: 80, y: 50 };
    const second = documentBody;
    onViewportChange.mockClear();
    act(() => {
      expect(zoom(region, first).defaultPrevented).toBe(true);
      expect(zoom(input, second).defaultPrevented).toBe(true);
    });
    await flushFrame();

    expect(onViewportChange).toHaveBeenCalledTimes(1);
    const final = onViewportChange.mock.lastCall?.[0] ?? view;
    const factor = Math.sqrt(final.zoom);
    expect(factor).toBeGreaterThan(1);
    expect(final.x).toBeCloseTo((first.x * factor + second.x) * (1 - factor));
    expect(final.y).toBeCloseTo((first.y * factor + second.y) * (1 - factor));
    expect(onEditIntent).not.toHaveBeenCalled();
  });

  it('opens directly at an explicit viewport and only mounts objects within its window', () => {
    const opening = { x: -4100, y: -2450, zoom: 1 };
    const renderContent = vi.fn(() => <p>离屏正文</p>);
    const content = <ContentProbe render={renderContent} />;
    const { region, onViewportChange, onVisibleObjectsChange } = renderCanvas({
      initialViewport: opening,
      contentById: new Map([['document', content]]),
    });

    expect(onViewportChange).toHaveBeenCalledExactlyOnceWith(opening);
    expect(onVisibleObjectsChange).toHaveBeenLastCalledWith(['remote']);
    expect(region.querySelector('[data-canvas-object="document"]')).toBeNull();
    expect(renderContent).not.toHaveBeenCalled();
  });

  it('keeps document input shortcuts and keyboard events from an outside dialog out of Canvas', async () => {
    const content = <textarea aria-label="文档正文" />;
    const { region, onViewportChange, onSelectionChange, onEditIntent } = renderCanvas({
      contentById: new Map([['document', content]]),
    });
    const input = requireElement<HTMLTextAreaElement>(region, 'textarea');
    const outside = requireElement<HTMLButtonElement>(fixture.host, 'button');
    onViewportChange.mockClear();
    act(() => {
      input.focus();
      expect(key(input, '+').defaultPrevented).toBe(false);
      expect(key(input, 'Escape').defaultPrevented).toBe(false);
      outside.focus();
      expect(key(outside, '+').defaultPrevented).toBe(false);
    });
    await flushFrame();

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onViewportChange).not.toHaveBeenCalled();
    expect(onEditIntent).not.toHaveBeenCalled();
  });

  it('treats sub-threshold document header motion at any zoom as selection only', () => {
    const { region, onEditIntent, onSelectionChange } = renderCanvas({
      initialViewport: { x: -440, y: -90, zoom: 2 },
    });
    const documentView = requireElement<HTMLElement>(region, '[data-canvas-object="document"]');
    const from = { x: 220, y: 92 };
    const to = { x: 222, y: 93 };
    act(() => {
      pointer(documentView, 'pointerdown', from);
      pointer(region, 'pointermove', to);
      pointer(region, 'pointerup', to);
    });

    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(['document']);
    expect(onEditIntent).not.toHaveBeenCalled();
  });

  it('ignores wheel navigation while a stationary object press still owns the gesture', async () => {
    const { region, onEditIntent, onViewportChange } = renderCanvas({ selection: ['card'] });
    onViewportChange.mockClear();
    act(() => {
      pointer(region, 'pointerdown', shapeCenter);
      expect(zoom(region, shapeCenter).defaultPrevented).toBe(true);
      pointer(region, 'pointerup', shapeCenter);
    });
    await flushFrame();

    expect(onViewportChange).not.toHaveBeenCalled();
    expect(onEditIntent).not.toHaveBeenCalled();
  });

  it('cancels a geometry preview on Escape and consumes its later pointer release', () => {
    const { region, onEditIntent } = renderCanvas({ selection: ['card'] });
    act(() => {
      pointer(region, 'pointerdown', shapeCenter);
      pointer(region, 'pointermove', dragEnd);
      expect(key(region, 'Escape').defaultPrevented).toBe(true);
      pointer(region, 'pointerup', dragEnd);
    });

    expect(onEditIntent).not.toHaveBeenCalled();
  });

  it('drops a drag when edit permission is revoked while the pointer is held', () => {
    const onEditIntent = vi.fn<(intent: CanvasEditIntent) => void>();
    const { region } = renderCanvas({ onEditIntent, selection: ['card'] });
    act(() => {
      pointer(region, 'pointerdown', shapeCenter);
      pointer(region, 'pointermove', dragEnd);
    });
    const readonly = renderCanvas({ onEditIntent, selection: ['card'], canEdit: false });
    act(() => {
      pointer(readonly.region, 'pointerup', dragEnd);
    });

    expect(onEditIntent).not.toHaveBeenCalled();
    expect(readonly.region.querySelector('[data-canvas-handle]')).toBeNull();
  });

  it('fits only the requested rotated geometry and ignores missing ids', () => {
    const ref = createRef<CanvasHandle>();
    const card = { x: 80, y: 80, width: 720, height: 120, rotation: 90 };
    const scene: CanvasScene = {
      ...board,
      objects: board.objects.map((object) =>
        object.id === 'card' ? { ...object, geometry: card } : object,
      ),
    };
    const { onViewportChange, onVisibleObjectsChange } = renderCanvas({ ref, scene });
    act(() => ref.current?.fitToObjects(['missing', 'card']));
    const camera = onViewportChange.mock.lastCall?.[0] ?? view;

    expect(camera.x + 440 * camera.zoom).toBeCloseTo(360);
    expect(camera.y + 140 * camera.zoom).toBeCloseTo(250);
    expect(card.width * camera.zoom).toBeCloseTo(356);
    expect(onVisibleObjectsChange.mock.lastCall?.[0]).toContain('card');
    expect(onVisibleObjectsChange.mock.lastCall?.[0]).not.toContain('remote');
    onViewportChange.mockClear();
    act(() => ref.current?.fitToObjects(['missing']));
    expect(onViewportChange).not.toHaveBeenCalled();
  });

  it('fits once when the initial scene becomes available', async () => {
    const onViewportChange = vi.fn<(viewport: CanvasViewport) => void>();
    const scene: CanvasScene = {
      ...board,
      objects: board.objects.slice(0, 1).map((object) => ({
        ...object,
        geometry: { x: 80, y: 80, width: 720, height: 130, rotation: 0 },
      })),
    };
    const props = { fitOnMount: true, initialViewport: undefined, onViewportChange };
    renderCanvas({ ...props, scene: { ...scene, objects: [] } });
    await flushFrame();
    expect(onViewportChange).toHaveBeenLastCalledWith(view);

    renderCanvas({ ...props, scene });
    await flushFrame();
    expect(onViewportChange).toHaveBeenLastCalledWith({ x: 8, y: 134, zoom: 0.8 });
    onViewportChange.mockClear();
    const moved = scene.objects.map((object) => ({
      ...object,
      geometry: { ...object.geometry, x: 2080 },
    }));
    renderCanvas({ ...props, scene: { ...scene, objects: moved } });
    await flushFrame();
    expect(onViewportChange).not.toHaveBeenCalled();
  });

  it('keeps an explicit viewport instead of fitting on mount', async () => {
    const initialViewport = { x: 30, y: -25, zoom: 0.8 };
    const { onViewportChange } = renderCanvas({ fitOnMount: true, initialViewport });
    await flushFrame();
    expect(onViewportChange).toHaveBeenCalledExactlyOnceWith(initialViewport);
  });

  it('keeps the same embedded HTML element across zoom and a confirmed scene update', async () => {
    const initial: CanvasObject = {
      id: 'html',
      kind: 'html',
      label: 'HTML 内容',
      geometry: { x: 300, y: 90, width: 230, height: 170, rotation: 0 },
      version: 2,
    };
    const source = '<p>交互式图解</p>';
    const embed = <iframe title="交互式图解" srcDoc={source} />;
    const contentById = new Map([['html', embed]]);
    const scene = { ...board, objects: [initial] };
    const { region, onViewportChange } = renderCanvas({ contentById, scene });
    const before = requireElement<HTMLIFrameElement>(region, 'iframe');
    act(() => {
      before.focus();
      zoom(region, documentBody);
    });
    await flushFrame();

    expect(onViewportChange.mock.lastCall?.[0].zoom).toBeGreaterThan(view.zoom);
    expect(requireElement<HTMLIFrameElement>(region, 'iframe')).toBe(before);

    const nextScene = {
      ...scene,
      revision: scene.revision + 1,
      objects: [{ ...initial, version: initial.version + 1 }],
    };
    const updated = renderCanvas({ contentById, scene: nextScene, selection: ['html'] });
    expect(requireElement<HTMLIFrameElement>(updated.region, 'iframe')).toBe(before);
    expect(document.activeElement).toBe(before);
    expect(before.srcdoc).toBe(source);
  });

  it('retains focused native content beyond the visible window until that content loses focus', () => {
    const ref = createRef<CanvasHandle>();
    const editor = <textarea aria-label="保持焦点的正文" defaultValue="尚未提交" />;
    const { region, onVisibleObjectsChange } = renderCanvas({
      contentById: new Map([['document', editor]]),
      ref,
    });
    const input = requireElement<HTMLTextAreaElement>(region, 'textarea');
    const outside = requireElement<HTMLButtonElement>(fixture.host, 'button');
    act(() => {
      input.focus();
      ref.current?.fitToObjects(['remote']);
    });

    expect(onVisibleObjectsChange).toHaveBeenLastCalledWith(['remote']);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('尚未提交');
    expect(region.querySelector('textarea')).toBe(input);

    act(() => outside.focus());
    expect(region.querySelector('textarea')).toBeNull();
  });

  it('uses the confirmed scene order for hit testing when overlapping objects change layers', () => {
    const geometry = { x: 80, y: 80, width: 150, height: 100, rotation: 0 };
    const a: CanvasObject = { id: 'a', kind: 'shape', label: 'A', version: 2, geometry };
    const b: CanvasObject = { id: 'b', kind: 'shape', label: 'B', version: 2, geometry };
    const scene = { ...board, objects: [a, b] };
    const first = renderCanvas({ scene });
    act(() => {
      pointer(first.region, 'pointerdown', shapeCenter);
      pointer(first.region, 'pointerup', shapeCenter);
    });
    expect(first.onSelectionChange).toHaveBeenCalledExactlyOnceWith(['b']);

    const updated = renderCanvas({
      scene: { ...scene, revision: scene.revision + 1, objects: [b, a] },
    });
    act(() => {
      pointer(updated.region, 'pointerdown', shapeCenter);
      pointer(updated.region, 'pointerup', shapeCenter);
    });
    expect(updated.onSelectionChange).toHaveBeenCalledExactlyOnceWith(['a']);
  });

  it('keeps a hollow person path dashed and renders only the requested connector head', () => {
    const shape: CanvasObject = {
      id: 'person',
      kind: 'shape',
      shape: 'person',
      label: '人物',
      dashed: true,
      hollow: true,
      geometry: { x: 80, y: 80, width: 140, height: 120, rotation: 0 },
      version: 1,
    };
    const connector: CanvasObject = {
      id: 'line',
      kind: 'connector',
      label: '标注',
      dashed: true,
      geometry: { x: 440, y: 90, width: 120, height: 120, rotation: 0 },
      connection: {
        start: { point: { x: 440, y: 90 } },
        end: { point: { x: 560, y: 210 } },
        startHead: 'circle',
        endHead: 'none',
      },
      version: 1,
    };
    const { region } = renderCanvas({ scene: { ...board, objects: [shape, connector] } });
    const person = requireElement<SVGSVGElement>(region, '[data-canvas-object="person"] svg');
    const arrow = requireElement<SVGSVGElement>(region, '[data-canvas-object="line"] svg');
    const line = requireElement<SVGPathElement>(arrow, 'path');
    const caption = requireElement<HTMLElement>(region, '.studio-ui-canvas-connector-label');

    expect(person.querySelector('path')).not.toBeNull();
    expect(person.style.fill).toBe('none');
    expect(person.style.strokeDasharray).toBe('6 5');
    expect(line.getAttribute('stroke-dasharray')).toBe('6 5');
    expect(arrow.querySelector('circle')).not.toBeNull();
    expect(arrow.querySelector('polyline')).toBeNull();
    expect(caption.textContent).toBe('标注');
    expect(caption.closest('svg')).toBeNull();
  });
});

function ContentProbe({ render }: { render: () => ReactNode }) {
  return render();
}
