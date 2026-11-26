import { act, useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Canvas,
  type CanvasEditIntent,
  type CanvasObject,
  type CanvasObjectActivation,
  type CanvasObjectExtension,
  type CanvasObjectIntent,
  type CanvasObjectReceipt,
  type CanvasObjectViewProps,
  type CanvasPoint,
  type CanvasProps,
  type CanvasScene,
  type CanvasViewport,
} from '../../src/ui/domain/canvas/index.js';
import { stickerExtension } from '../../src/ui/domain/objects/sticker/index.js';
import { todoExtension } from '../../src/ui/domain/objects/todo/index.js';
import { initialReceiptState, reduceReceipts } from '../fixtures/canvas/receipts.js';
import { createControlFixture } from '../support/render-control.js';

const badge: CanvasObject = {
  id: 'test-badge',
  kind: 'spec:badge',
  label: '测试徽标',
  version: 4,
  geometry: { x: 80, y: 60, width: 120, height: 80, rotation: 0 },
};
const underlay: CanvasObject = {
  id: 'underlay',
  kind: 'shape',
  label: '底层图形',
  version: 1,
  geometry: { x: 40, y: 30, width: 230, height: 160, rotation: 0 },
};
const scene: CanvasScene = {
  boardId: 'extension-board',
  revision: 1,
  objects: [underlay, badge],
};
const payload = { version: 7, value: '已登记' };
const badgePayloads = new Map([[badge.id, payload]]);
const badgeOperation = { name: 'badge.assign', expectedVersion: payload.version, value: '已复核' };
const selectedBadge = [badge.id];

function createBadgeExtension(
  observe?: (props: CanvasObjectViewProps) => void,
): CanvasObjectExtension {
  function BadgeView(props: CanvasObjectViewProps) {
    useLayoutEffect(() => observe?.(props), [props]);
    const value = props.payload?.value;

    return <span>{typeof value === 'string' ? value : props.object.label}</span>;
  }

  return {
    kind: badge.kind,
    capabilities: { move: true, resize: false, rotate: false, connect: false, content: 'native' },
    bounds: ({ geometry }) => ({ ...geometry, width: geometry.width + 40 }),
    hitTest: ({ point, geometry }) =>
      point.x >= geometry.x + geometry.width / 2 &&
      point.x <= geometry.x + geometry.width + 40 &&
      point.y >= geometry.y &&
      point.y <= geometry.y + geometry.height,
    View: BadgeView,
  };
}

function pointer(target: HTMLElement, type: string, { x, y }: CanvasPoint) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: y,
    }),
  );
}

function drag(target: HTMLElement, from: CanvasPoint, to = from) {
  act(() => {
    pointer(target, 'pointerdown', from);
    pointer(target, 'pointermove', to);
    pointer(target, 'pointerup', to);
  });
}

function rightPort(root: HTMLElement) {
  const port = root.querySelector<HTMLElement>('[data-canvas-port="right"]');
  if (!port) {
    throw new Error('Expected the selected object to expose its right port.');
  }

  return port;
}

async function flushFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

async function clickNamedButton(root: HTMLElement, label: string) {
  const button = [...root.querySelectorAll('button')].find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent).trim() === label,
  );

  if (!button) {
    throw new Error('Expected a button named ' + label);
  }

  await act(async () => button.click());
}

describe('Canvas object extensions', () => {
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
    fixture.render(
      <Canvas
        viewId="extensions-view"
        label="扩展验收"
        scene={scene}
        selection={[]}
        tool="select"
        canEdit
        onSelectionChange={onSelectionChange}
        onEditIntent={onEditIntent}
        {...props}
      />,
    );
    const root = fixture.host.querySelector<HTMLElement>('[role="region"][aria-label="扩展验收"]');
    if (!root) {
      throw new Error('Expected a named canvas region.');
    }

    return { root, onSelectionChange, onEditIntent };
  }

  it('uses registered bounds and exact hit tests and restricts available geometry operations', () => {
    const objectExtensions = [createBadgeExtension()];
    const hit = { x: 225, y: 90 };
    const canvas = renderCanvas({ objectExtensions });
    drag(canvas.root, { x: 100, y: 90 });
    expect(canvas.onSelectionChange).toHaveBeenLastCalledWith([underlay.id]);

    drag(canvas.root, hit);
    expect(canvas.onSelectionChange).toHaveBeenLastCalledWith(selectedBadge);
    expect(canvas.onEditIntent).not.toHaveBeenCalled();

    const selected = renderCanvas({ objectExtensions, selection: selectedBadge });
    expect(selected.root.querySelector('[data-canvas-handle]')).toBeNull();
    drag(selected.root, hit, { x: 440, y: 345 });
    expect(selected.onEditIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'move',
      interactionId: expect.any(String),
      delta: { x: 215, y: 255 },
      changes: [
        {
          id: badge.id,
          expectedVersion: badge.version,
          geometry: { ...badge.geometry, x: 295, y: 315 },
        },
      ],
    });
  });

  it('cancels a move when the latest registration revokes the capability during the gesture', async () => {
    const extension = createBadgeExtension();
    const onEditIntent = vi.fn<(intent: CanvasEditIntent) => void>();
    const canvas = renderCanvas({ objectExtensions: [extension], onEditIntent });
    const from = { x: 225, y: 90 };
    const to = { x: 440, y: 345 };
    act(() => {
      pointer(canvas.root, 'pointerdown', from);
      pointer(canvas.root, 'pointermove', to);
    });
    await flushFrame();
    const frame = canvas.root.querySelector<HTMLElement>('[data-canvas-object="test-badge"]');
    expect(frame?.style.left).toBe('295px');
    expect(onEditIntent).not.toHaveBeenCalled();

    const replacement = { ...extension, capabilities: { ...extension.capabilities, move: false } };
    renderCanvas({ objectExtensions: [replacement], onEditIntent });
    act(() => {
      pointer(canvas.root, 'pointerup', to);
    });
    await flushFrame();

    expect(onEditIntent).not.toHaveBeenCalled();
    expect(frame?.style.left).toBe('80px');
  });

  it('creates an adjacent copy of a shape with one versioned link and applies both in the receipt', () => {
    const source: CanvasObject = {
      ...underlay,
      shape: 'hexagon',
      fill: '#dbe9ff',
      stroke: '#2b528c',
      strokeWidth: 2,
      dashed: true,
    };
    const sourceScene = { ...scene, objects: [source] };
    const { root, onEditIntent } = renderCanvas({ scene: sourceScene, selection: [source.id] });
    drag(rightPort(root), { x: 282, y: 110 });

    const intent = onEditIntent.mock.lastCall?.[0];
    if (intent?.kind !== 'create' || intent.object.kind !== 'shape') {
      throw new Error('Expected a shape creation with an attached link.');
    }

    expect(onEditIntent).toHaveBeenCalledTimes(1);
    const { geometry } = intent.object;
    expect(geometry.x).toBeGreaterThan(source.geometry.x + source.geometry.width);
    expect(intent.object).toMatchObject({
      kind: 'shape',
      shape: source.shape,
      label: '',
      fill: source.fill,
      stroke: source.stroke,
      strokeWidth: source.strokeWidth,
      dashed: source.dashed,
      geometry: { ...source.geometry, x: geometry.x },
    });
    expect(intent.link).toEqual({
      source: {
        objectId: source.id,
        port: 'right',
        expectedVersion: source.version,
        point: { x: 270, y: 110 },
      },
      target: { port: 'left', point: { x: geometry.x, y: 110 } },
    });

    const pending = reduceReceipts(
      { ...initialReceiptState, scene: sourceScene },
      { type: 'edit', intent },
    );
    const reply = { type: 'receipt', interactionId: intent.interactionId, accepted: true } as const;
    const confirmed = reduceReceipts(pending, reply);
    expect(pending.scene).toBe(sourceScene);
    expect(confirmed.scene.revision).toBe(sourceScene.revision + 1);
    expect(confirmed.scene.objects).toEqual([
      source,
      { ...intent.object, id: intent.interactionId, version: 1 },
      expect.objectContaining({
        kind: 'connector',
        connection: {
          start: { point: { x: 270, y: 110 }, attachment: { objectId: source.id, port: 'right' } },
          end: {
            point: { x: geometry.x, y: 110 },
            attachment: { objectId: intent.interactionId, port: 'left' },
          },
        },
      }),
    ]);

    const changed = { ...sourceScene, objects: [{ ...source, version: source.version + 1 }] };
    expect(reduceReceipts({ ...pending, scene: changed }, reply).scene).toBe(changed);
  });

  it('places only an adjacent note for a short port click and ignores a port drag', () => {
    const note: CanvasObject = { ...underlay, kind: 'note', label: '种子便签', fill: '#fff0b0' };
    const { root, onEditIntent } = renderCanvas({
      scene: { ...scene, objects: [note] },
      selection: [note.id],
    });
    const origin = { x: 282, y: 110 };
    drag(rightPort(root), origin, { x: 365, y: 175 });
    expect(onEditIntent).not.toHaveBeenCalled();

    drag(rightPort(root), origin, { x: 284, y: 111 });
    const intent = onEditIntent.mock.lastCall?.[0];
    if (intent?.kind !== 'create' || intent.object.kind !== 'note') {
      throw new Error('Expected a note placement from the port click.');
    }

    expect(onEditIntent).toHaveBeenCalledTimes(1);
    expect(intent.link).toBeUndefined();
    expect(intent.object.geometry.x).toBeGreaterThan(note.geometry.x + note.geometry.width);
    expect(intent.object).toMatchObject({ label: '', fill: note.fill });
  });

  it('passes the payload and edit request to the view and forwards a versioned operation', async () => {
    const observe = vi.fn<(view: CanvasObjectViewProps) => void>();
    const onObjectActivate = vi.fn<(activation: CanvasObjectActivation) => void>();
    const saved = { version: 8, value: badgeOperation.value };
    const submit = vi.fn<(intent: CanvasObjectIntent) => CanvasObjectReceipt>().mockReturnValue({
      ok: true,
      payload: saved,
    });
    const { root } = renderCanvas({
      objectExtensions: [createBadgeExtension(observe)],
      payloadById: badgePayloads,
      onObjectActivate,
      onObjectIntent: submit,
      selection: selectedBadge,
    });
    expect(root.textContent).toContain(payload.value);
    act(() => {
      root.dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          clientX: 170,
          clientY: 95,
        }),
      );
    });

    const view = observe.mock.lastCall?.[0];
    if (!view) {
      throw new Error('Expected the registered view to mount.');
    }

    expect(onObjectActivate).toHaveBeenCalledExactlyOnceWith({
      id: badge.id,
      point: { x: 170, y: 95 },
    });
    expect(view).toMatchObject({
      id: badge.id,
      object: badge,
      payload,
      editRequest: 1,
      selected: true,
      readOnly: false,
    });
    await expect(view.request(badgeOperation)).resolves.toEqual({ ok: true, payload: saved });
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      ...badgeOperation,
      objectId: badge.id,
      kind: badge.kind,
    });
  });

  it('keeps the sticker palette closed without an object writer', () => {
    const sticker: CanvasObject = {
      id: 'heart-sticker',
      kind: 'sticker',
      label: '爱心',
      version: 1,
      geometry: { x: 30, y: 30, width: 64, height: 64, rotation: 0 },
    };
    const onObjectActivate = vi.fn<(activation: CanvasObjectActivation) => void>();
    const { root } = renderCanvas({
      scene: { ...scene, objects: [sticker] },
      selection: [sticker.id],
      objectExtensions: [stickerExtension],
      payloadById: new Map([[sticker.id, { version: 1, value: { id: 'heart' } }]]),
      onObjectActivate,
    });
    act(() => {
      root.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 50, clientY: 50 }));
    });

    expect(onObjectActivate).toHaveBeenCalledExactlyOnceWith({
      id: sticker.id,
      point: { x: 50, y: 50 },
    });
    expect(root.querySelector('dialog')).toBeNull();
  });

  it('revokes one object type without removing the board writer', async () => {
    const observe = vi.fn<(view: CanvasObjectViewProps) => void>();
    const objectExtensions = [createBadgeExtension(observe), stickerExtension];
    const sticker: CanvasObject = {
      id: 'heart-sticker',
      kind: 'sticker',
      label: '爱心',
      version: 1,
      geometry: { x: 30, y: 30, width: 64, height: 64, rotation: 0 },
    };
    const saved = { version: 8, value: '已复核' };
    const onObjectIntent = vi
      .fn<(intent: CanvasObjectIntent) => CanvasObjectReceipt>()
      .mockReturnValue({ ok: true, payload: saved });
    const board = { ...scene, objects: [badge, sticker] };
    renderCanvas({ scene: board, objectExtensions, onObjectIntent, payloadById: badgePayloads });
    const badgeRequest = observe.mock.lastCall?.[0].request;
    if (!badgeRequest) {
      throw new Error('Expected a request function for the badge.');
    }

    renderCanvas({
      scene: board,
      objectExtensions,
      onObjectIntent,
      canWriteObject: (kind) => kind === sticker.kind,
    });
    expect(observe.mock.lastCall?.[0].readOnly).toBe(true);
    await expect(badgeRequest(badgeOperation)).resolves.toMatchObject({ ok: false });
    expect(onObjectIntent).not.toHaveBeenCalled();

    renderCanvas({
      scene: board,
      objectExtensions,
      onObjectIntent,
      canWriteObject: (kind) => kind === badge.kind,
    });
    expect(observe.mock.lastCall?.[0].readOnly).toBe(false);
    await expect(badgeRequest(badgeOperation)).resolves.toEqual({ ok: true, payload: saved });
    expect(onObjectIntent).toHaveBeenCalledExactlyOnceWith({
      ...badgeOperation,
      objectId: badge.id,
      kind: badge.kind,
    });
  });

  it('checks current permission and releases callbacks when a registered view is replaced or unmounted', async () => {
    const observe = vi.fn<(view: CanvasObjectViewProps) => void>();
    const objectExtensions = [createBadgeExtension(observe)];
    const initial = vi.fn<(intent: CanvasObjectIntent) => CanvasObjectReceipt>();
    const newest = { version: 8, value: '已更新' };
    const current = { ok: false, message: '版本冲突', current: newest } as const;
    const latest = vi
      .fn<(intent: CanvasObjectIntent) => CanvasObjectReceipt>()
      .mockReturnValue(current);
    renderCanvas({ objectExtensions, onObjectIntent: initial, payloadById: badgePayloads });
    const request = observe.mock.lastCall?.[0].request;
    if (!request) {
      throw new Error('Expected a request from the initial view.');
    }

    renderCanvas({
      objectExtensions,
      onObjectIntent: latest,
      payloadById: new Map([[badge.id, newest]]),
    });
    await expect(request(badgeOperation)).resolves.toEqual(current);
    expect(initial).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith({
      ...badgeOperation,
      objectId: badge.id,
      kind: badge.kind,
    });

    renderCanvas({ objectExtensions, onObjectIntent: latest, canEdit: false });
    expect(observe.mock.lastCall?.[0].readOnly).toBe(true);
    await expect(request(badgeOperation)).resolves.toMatchObject({ ok: false });

    const replacement = [createBadgeExtension(observe)];
    renderCanvas({ objectExtensions: replacement, onObjectIntent: latest });
    const replacementRequest = observe.mock.lastCall?.[0].request;
    if (!replacementRequest) {
      throw new Error('Expected a request from the replacement view.');
    }

    await expect(request(badgeOperation)).resolves.toMatchObject({ ok: false });
    await expect(replacementRequest(badgeOperation)).resolves.toEqual(current);
    fixture.render(<div />);
    await expect(replacementRequest(badgeOperation)).resolves.toMatchObject({ ok: false });
    expect(latest).toHaveBeenCalledTimes(2);
  });

  it('keeps an unfocused extension mounted until its in-flight request settles', async () => {
    const observe = vi.fn<(view: CanvasObjectViewProps) => void>();
    const objectExtensions = [createBadgeExtension(observe)];
    const receipt: { resolve?: (value: CanvasObjectReceipt) => void } = {};
    const waiting = new Promise<CanvasObjectReceipt>((resolve) => {
      receipt.resolve = resolve;
    });
    const onObjectIntent = vi
      .fn<(intent: CanvasObjectIntent) => Promise<CanvasObjectReceipt>>()
      .mockReturnValue(waiting);
    const { root } = renderCanvas({ objectExtensions, onObjectIntent });
    const request = observe.mock.lastCall?.[0].request;
    if (!request || !receipt.resolve) {
      throw new Error('Expected a mounted extension and a pending receipt.');
    }

    let response: Promise<CanvasObjectReceipt> | undefined;
    act(() => {
      response = request(badgeOperation);
    });
    const viewportRequest = { requestId: 'badge-away', viewport: { x: -3000, y: 0, zoom: 1 } };
    renderCanvas({ objectExtensions, onObjectIntent, viewportRequest });
    await flushFrame();
    expect(root.textContent).toContain(badge.label);

    const saved = { ok: true, payload: { version: 8, value: badgeOperation.value } } as const;
    await act(async () => {
      receipt.resolve?.(saved);
      await expect(response).resolves.toEqual(saved);
    });
    expect(root.textContent).not.toContain(badge.label);
  });

  it('renders a labelled selectable placeholder for an unregistered object kind', () => {
    const unknown = { ...badge, kind: 'spec:unknown', label: '未知对象' } as const;
    const { root, onSelectionChange } = renderCanvas({ scene: { ...scene, objects: [unknown] } });
    expect(root.textContent).toContain(unknown.label);
    drag(root, { x: 110, y: 90 });
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith([unknown.id]);
  });

  it('fails when an object kind is registered more than once', () => {
    const extension = createBadgeExtension();
    expect(() => renderCanvas({ objectExtensions: [extension, extension] })).toThrow(
      /registered twice/u,
    );
  });

  it('fails when a registration declares a placement for a different kind', () => {
    const extension: CanvasObjectExtension = {
      ...createBadgeExtension(),
      placement: { kind: 'shape', label: '错误放置对象', width: 80, height: 60 },
    };
    expect(() => renderCanvas({ objectExtensions: [extension] })).toThrow(
      /placement kind differs/u,
    );
  });

  it('renders the actual todo body and saves a change through the Canvas operation contract', async () => {
    const object: CanvasObject = {
      id: 'checklist',
      kind: 'todo',
      label: '交付任务',
      version: 3,
      geometry: { x: 60, y: 60, width: 360, height: 250, rotation: 0 },
    };
    const item = { id: 'one', text: '核对提交', checked: false };
    const todo = { id: object.id, revision: 5, title: object.label, items: [item] };
    const updated = { ...todo, revision: 6, items: [{ ...item, checked: true }] };
    const onObjectIntent = vi
      .fn<(intent: CanvasObjectIntent) => CanvasObjectReceipt>()
      .mockReturnValue({
        ok: true,
        payload: { version: updated.revision, value: updated },
      });
    const { root } = renderCanvas({
      scene: { ...scene, objects: [object] },
      selection: [object.id],
      objectExtensions: [todoExtension],
      payloadById: new Map([[object.id, { version: todo.revision, value: todo }]]),
      onObjectIntent,
    });
    const control = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!control) {
      throw new Error('Expected the todo extension to mount its checkbox.');
    }

    await act(async () => {
      control.click();
    });
    expect(onObjectIntent).toHaveBeenCalledExactlyOnceWith({
      name: 'todo.edit',
      objectId: object.id,
      kind: object.kind,
      expectedVersion: todo.revision,
      value: {
        objectId: object.id,
        expectedRevision: todo.revision,
        changes: [{ op: 'update', id: item.id, changes: { checked: true } }],
      },
    });
    expect(control.checked).toBe(true);
    expect(root.textContent).toContain('1/1 完成');
  });

  it('retains a rejected todo title draft offscreen and releases the saved body when evicted', async () => {
    const object: CanvasObject = {
      id: 'retained-checklist',
      kind: 'todo',
      label: '交付清单',
      version: 3,
      geometry: { x: 60, y: 60, width: 360, height: 250, rotation: 0 },
    };
    const draftTitle = '验收后的清单标题';
    const todo = { id: object.id, revision: 5, title: object.label, items: [] };
    const saved = { ...todo, revision: 6, title: draftTitle };
    const rejection = '模拟拒绝保存';
    const onObjectIntent = vi
      .fn<(intent: CanvasObjectIntent) => CanvasObjectReceipt>()
      .mockReturnValueOnce({ ok: false, message: rejection })
      .mockReturnValueOnce({ ok: true, payload: { version: saved.revision, value: saved } });
    const props = {
      scene: { ...scene, objects: [object] },
      selection: [object.id],
      objectExtensions: [todoExtension],
      payloadById: new Map([[object.id, { version: todo.revision, value: todo }]]),
      onObjectIntent,
    };
    const { root } = renderCanvas(props);
    await clickNamedButton(root, '编辑清单标题');

    const title = root.querySelector<HTMLInputElement>('input[type="text"]');
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!title || !value?.set) {
      throw new Error('Expected the todo title editor.');
    }

    act(() => {
      value.set?.call(title, draftTitle);
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => title.blur());
    expect(document.activeElement).not.toBe(title);
    expect(onObjectIntent).toHaveBeenCalledTimes(1);
    expect(title.value).toBe(draftTitle);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(rejection);

    const movedViewport = { x: -3000, y: 0, zoom: 1 };
    renderCanvas({
      ...props,
      viewportRequest: { requestId: 'todo-away', viewport: movedViewport },
    });
    await flushFrame();
    expect(root.querySelector('input[type="text"]')).toBe(title);

    renderCanvas({
      ...props,
      viewportRequest: { requestId: 'todo-back', viewport: { x: 0, y: 0, zoom: 1 } },
    });
    await flushFrame();
    expect(root.querySelector('input[type="text"]')).toBe(title);
    expect(title.value).toBe(draftTitle);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(rejection);

    await clickNamedButton(root, '重试保存');
    expect(onObjectIntent.mock.calls).toHaveLength(2);
    expect(onObjectIntent.mock.calls[1]).toEqual(onObjectIntent.mock.calls[0]);
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.querySelector('[data-todo-id]')?.getAttribute('aria-label')).toBe(draftTitle);

    renderCanvas({
      ...props,
      viewportRequest: { requestId: 'todo-cleared', viewport: movedViewport },
    });
    await flushFrame();
    expect(root.querySelector('[data-todo-id]')?.getAttribute('aria-label')).toBe(draftTitle);

    renderCanvas({ ...props, payloadById: new Map() });
    expect(root.querySelector('[data-todo-id]')).toBeNull();
  });

  it('reapplies identical viewport coordinates only for a new request id', async () => {
    const onViewportChange = vi.fn<(viewport: CanvasViewport) => void>();
    const viewport = { x: 30, y: 50, zoom: 1.25 };
    const first = { requestId: 'follow-first', viewport };
    const { root } = renderCanvas({ viewportRequest: first, onViewportChange });
    await flushFrame();
    expect(onViewportChange).toHaveBeenLastCalledWith(viewport);

    act(() => {
      root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 }));
    });
    await flushFrame();
    const panned = { ...viewport, y: 10 };
    expect(onViewportChange).toHaveBeenLastCalledWith(panned);

    renderCanvas({ viewportRequest: { ...first }, onViewportChange });
    await flushFrame();
    expect(onViewportChange).toHaveBeenLastCalledWith(panned);

    renderCanvas({ viewportRequest: { requestId: 'follow-again', viewport }, onViewportChange });
    await flushFrame();
    expect(onViewportChange).toHaveBeenLastCalledWith(viewport);
  });
});
