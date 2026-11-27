import { expect, test } from 'vitest';
import type {
  BoardEditReceipt,
  EditBoardGeometryCommand,
  EditObjectContentCommand,
  WhiteboardEditService,
  WhiteboardObject,
  WhiteboardPayload,
  WhiteboardService,
} from '../../src/data/whiteboard/index.js';
import { createAppMock } from '../support/whiteboard-app-mock.js';

const boardId = 'geometry-board';
const bounds = { x: 48, y: 48, width: 100, height: 64, rotation: 0 };
const baseObject: WhiteboardObject = {
  id: 'base-shape',
  kind: 'shape',
  label: '原有形状',
  geometry: bounds,
  geometryVersion: 0n,
  locked: false,
};

type AppliedEdit = Extract<BoardEditReceipt, { kind: 'applied' }>;
type AppliedChanges = Omit<AppliedEdit, 'boardId' | 'commandId' | 'kind' | 'revision'>;

function initialTable(id: string): WhiteboardPayload {
  return {
    id,
    version: 0n,
    body: {
      kind: 'table',
      value: {
        data: {
          rows: [
            ['名称', '说明', '状态'],
            ['项目 A', '双击编辑表格', '进行中'],
            ['项目 B', '待补充', '待处理'],
          ],
          rowIds: ['header', 'first', 'second'],
          columnIds: ['name', 'description', 'status'],
          head: true,
        },
      },
    },
  };
}

function applyOperation(
  objects: ReadonlyMap<string, WhiteboardObject>,
  { operation }: EditBoardGeometryCommand,
): AppliedChanges {
  const base = { objects: [], removedIds: [], order: [], payloads: [] };
  switch (operation.kind) {
    case 'create': {
      const object = { ...operation.object, geometryVersion: 1n, locked: false };
      if (object.kind === 'text') {
        const payload: WhiteboardPayload = {
          id: object.id,
          version: 0n,
          body: { kind: 'text', value: { text: '' } },
        };

        return {
          ...base,
          objects: [{ ...object, payloadVersion: payload.version }],
          payloads: [{ kind: 'loaded', payload }],
        };
      }
      if (object.kind === 'table') {
        const payload = initialTable(object.id);

        return {
          ...base,
          objects: [{ ...object, payloadVersion: payload.version }],
          payloads: [{ kind: 'loaded', payload }],
        };
      }

      return {
        ...base,
        objects: [object],
      };
    }
    case 'changeLock':
      return {
        ...base,
        objects: operation.targets.map(({ id, expectedGeometryVersion }) => ({
          ...existingObject(objects, id),
          geometryVersion: expectedGeometryVersion + 1n,
          locked: operation.locked,
        })),
      };
    case 'transform':
      return {
        ...base,
        objects: operation.objects.map(({ target, geometry }) => ({
          ...existingObject(objects, target.id),
          geometry,
          geometryVersion: target.expectedGeometryVersion + 1n,
        })),
      };
    case 'reorder': {
      const selected = operation.targets.map(({ id }) => id);
      const others = [...objects.keys()].filter((id) => !selected.includes(id));

      return { ...base, order: [...selected, ...others] };
    }
    case 'delete':
      return { ...base, removedIds: operation.targets.map(({ id }) => id) };
    case 'duplicate':
      return {
        ...base,
        objects: operation.targets.map(({ source, newObjectId }) => {
          const current = existingObject(objects, source.id);
          const { x, y } = current.geometry;

          return {
            ...current,
            id: newObjectId,
            geometryVersion: 1n,
            geometry: { ...current.geometry, x: x + operation.delta.x, y: y + operation.delta.y },
          };
        }),
      };
    case 'arrange':
    case 'createSection':
    case 'group':
    case 'paste':
    case 'style':
    case 'ungroup':
      throw new Error('Unexpected fixture geometry operation ' + operation.kind);
  }
}

function existingObject(objects: ReadonlyMap<string, WhiteboardObject>, id: string) {
  const object = objects.get(id);
  if (!object) {
    throw new Error('Missing fixture object ' + id);
  }

  return object;
}

function button(host: HTMLElement, label: string) {
  const control = [...host.querySelectorAll('button')].find(
    (candidate) =>
      candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label,
  );

  if (!control) {
    throw new Error('Missing whiteboard action ' + label);
  }

  return control;
}

async function unexpected(): Promise<never> {
  throw new Error('Unexpected whiteboard operation.');
}

interface GeometryFixtureOptions {
  readonly failFirst?: boolean;
  readonly pendingMove?: Promise<void>;
  readonly pendingGeometry?: Promise<void>;
  readonly createFailure?: 'conflict' | 'rejected';
  readonly initialObjects?: readonly WhiteboardObject[];
  readonly initialPayloads?: readonly WhiteboardPayload[];
}

function geometryFixture({
  failFirst = false,
  pendingMove,
  pendingGeometry,
  createFailure,
  initialObjects = [baseObject],
  initialPayloads = [],
}: GeometryFixtureOptions = {}) {
  let objects = new Map(initialObjects.map((object) => [object.id, object]));
  const payloads = new Map(initialPayloads.map((payload) => [payload.id, payload]));
  let revision = 0n;
  let commandSequence = 0;
  const commands: EditBoardGeometryCommand[] = [];
  const contentCommands: EditObjectContentCommand[] = [];
  const receiptRequests: string[][] = [];
  const createCommandId = () => 'new-geometry-' + ++commandSequence;
  const service: WhiteboardService = {
    async getScene() {
      return {
        boardId,
        title: '几何编辑验收',
        canEdit: true,
        revision,
        objects: [...objects.values()],
      };
    },
    async getPayloads(_id, objectIds) {
      return objectIds.flatMap((objectId) => {
        const payload = payloads.get(objectId);

        return payload ? [{ kind: 'loaded', payload }] : [];
      });
    },
    async moveObjects({ commandId, targets, delta }) {
      if (!pendingMove) {
        return unexpected();
      }

      await pendingMove;
      const moved = targets.map(({ id }) => {
        const current = existingObject(objects, id);
        const { x, y } = current.geometry;
        const geometry = { ...current.geometry, x: x + delta.x, y: y + delta.y };
        const updated = { ...current, geometry, geometryVersion: current.geometryVersion + 1n };
        objects.set(id, updated);

        return updated;
      });
      revision += 1n;
      return { kind: 'applied', boardId, commandId, revision, objects: moved };
    },
    getReceipt: unexpected,
  };

  const editService: WhiteboardEditService = {
    async editGeometry(command) {
      commands.push(command);
      if (failFirst && commands.length === 1) {
        throw new Error('连接已断开');
      }

      if (pendingGeometry) {
        await pendingGeometry;
      }
      const identity = { boardId, commandId: command.commandId };
      if (command.operation.kind === 'create') {
        if (createFailure === 'rejected') {
          return { ...identity, kind: 'rejected', reason: 'invalidEdit' };
        }
        if (createFailure === 'conflict') {
          return { ...identity, kind: 'conflict', revision, objects: [], payloads: [] };
        }
      }

      const changes = applyOperation(objects, command);
      for (const id of changes.removedIds) {
        objects.delete(id);
        payloads.delete(id);
      }
      for (const object of changes.objects) {
        objects.set(object.id, object);
      }
      for (const result of changes.payloads) {
        if (result.kind === 'loaded') {
          payloads.set(result.payload.id, result.payload);
        }
      }
      if (changes.order.length > 0) {
        objects = new Map(changes.order.map((id) => [id, existingObject(objects, id)]));
      }

      revision += 1n;
      return { ...changes, boardId, commandId: command.commandId, kind: 'applied', revision };
    },
    async editContent(command) {
      if (command.edit.kind !== 'table') {
        return unexpected();
      }

      contentCommands.push(command);
      const { objectId, commandId, expectedPayloadVersion } = command;
      const { text, ...data } = command.edit.value;
      const payload: WhiteboardPayload = {
        id: objectId,
        version: expectedPayloadVersion + 1n,
        body: { kind: 'table', value: { text, data } },
      };
      const object = { ...existingObject(objects, objectId), payloadVersion: payload.version };
      objects.set(objectId, object);
      payloads.set(objectId, payload);
      revision += 1n;
      return {
        boardId,
        commandId,
        kind: 'applied',
        revision,
        objects: [object],
        removedIds: [],
        order: [],
        payloads: [{ kind: 'loaded', payload }],
      };
    },
    attachImage: unexpected,
    async getReceipt(id, commandId) {
      receiptRequests.push([id, commandId]);
      return undefined;
    },
  };
  const app = createAppMock(service, { editService, createCommandId });
  const placementPoint = { x: 260, y: 170 };

  return {
    ...app,
    commands,
    contentCommands,
    receiptRequests,
    open: (key = 'start') => app.open(boardId, key),
    place: () => app.drag(placementPoint, placementPoint),
  };
}

test('places once and saves geometry, locks and order through the existing whiteboard UI', async () => {
  const app = geometryFixture();
  try {
    await app.open();
    await app.click('形状');
    await app.click('形状 菱形');
    await app.place();
    expect(button(app.host, '选择').getAttribute('aria-pressed')).toBe('true');
    expect(app.commands[0]?.operation).toMatchObject({
      kind: 'create',
      object: { detail: { kind: 'shape', outline: 'diamond' } },
    });

    const objectId = 'new-geometry-1';
    const selector = '[data-canvas-object="' + objectId + '"]';
    expect(app.host.querySelector(selector)).not.toBeNull();
    const handle = app.canvas().querySelector<HTMLElement>('[data-canvas-handle="se"]');
    if (!handle) {
      throw new Error('The created object must be selected, with an active resize handle.');
    }

    await app.drag({ x: 328, y: 236 }, { x: 358, y: 259 }, handle);
    expect(app.commands[1]?.operation).toMatchObject({
      kind: 'transform',
      transform: 'resize',
      objects: [{ target: { id: objectId, expectedGeometryVersion: 1n } }],
    });

    await app.click('锁定元素');
    expect(button(app.host, '图层顺序').disabled).toBe(true);
    await app.click('更多操作');
    expect(button(app.host, '删除 Delete').getAttribute('aria-disabled')).toBe('true');
    expect(
      button(app.host, '解锁位置与尺寸 Ctrl/⌘ Shift L').getAttribute('aria-disabled'),
    ).toBeNull();
    await app.click('解锁位置与尺寸 Ctrl/⌘ Shift L');
    await app.click('图层顺序');
    const layers = app.host.querySelector('[role="menu"][aria-label="图层顺序"]');
    expect(layers?.querySelector('[role="separator"]')?.nextElementSibling?.textContent).toBe(
      '置于顶层',
    );
    await app.click('下移一层');
    expect(app.commands[4]?.operation).toMatchObject({
      kind: 'reorder',
      direction: 'backward',
      expectedBoardRevision: 4n,
    });

    await app.click('更多操作');
    const rows = [
      ...app.host.querySelectorAll('[role="menu"][aria-label="白板操作"] [role="menuitem"]'),
    ];
    expect(
      rows.slice(0, 8).map((row) => row.getAttribute('aria-label') ?? row.textContent),
    ).toEqual([
      '剪切 Ctrl/⌘ X',
      '复制 Ctrl/⌘ C',
      '粘贴 Ctrl/⌘ V',
      '重复 Ctrl/⌘ D',
      '置于顶层',
      '置于底层',
      '上移一层',
      '下移一层',
    ]);
    await app.click('删除 Delete');
    expect(app.commands[5]?.operation).toMatchObject({ kind: 'delete' });
    expect(app.host.querySelector(selector)).toBeNull();
    await app.open('reopened');
    expect(app.host.querySelector(selector)).toBeNull();
    expect(app.host.querySelector('[data-canvas-object="base-shape"]')).not.toBeNull();
  } finally {
    app.dispose();
  }
});

test('keeps the newer object selection and menu when a pending duplicate is confirmed', async () => {
  let confirmDuplicate!: () => void;
  const pendingGeometry = new Promise<void>((resolve) => {
    confirmDuplicate = resolve;
  });
  const other = {
    ...baseObject,
    id: 'other-shape',
    geometry: { ...baseObject.geometry, x: 280 },
  };
  const app = geometryFixture({ pendingGeometry, initialObjects: [baseObject, other] });
  const boardMenu = '[role="menu"][aria-label="白板操作"]';
  try {
    await app.open();
    await app.drag({ x: 70, y: 70 }, { x: 70, y: 70 });
    await app.click('更多操作');
    await app.click('重复 Ctrl/⌘ D');
    expect(app.commands[0]?.operation).toMatchObject({
      kind: 'duplicate',
      targets: [{ source: { id: baseObject.id } }],
    });

    await app.update(() => {
      app.canvas().dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 300,
          clientY: 70,
        }),
      );
    });
    expect(app.host.querySelector(boardMenu)).not.toBeNull();
    expect(button(app.host, '删除 Delete').getAttribute('aria-disabled')).toBe('true');

    await app.update(confirmDuplicate);
    expect(app.host.querySelector('[data-canvas-object="new-geometry-1-1"]')).not.toBeNull();
    expect(app.host.querySelector(boardMenu)).not.toBeNull();
  } finally {
    confirmDuplicate();
    app.dispose();
  }
});

test('creates blank text at a double click in the selection tool and opens its editor', async () => {
  const app = geometryFixture();
  try {
    await app.open();
    await app.update(() => {
      app
        .canvas()
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 430, clientY: 270 }));
    });
    expect(app.commands[0]?.operation).toMatchObject({
      kind: 'create',
      object: { kind: 'text', geometry: { x: 430, y: 270 } },
      initialPayload: { kind: 'text', value: { text: '' } },
    });
    expect(app.host.querySelector('[role="textbox"][contenteditable="true"]')).not.toBeNull();
    expect(app.commands).toHaveLength(1);
  } finally {
    app.dispose();
  }
});

test.each(['另一个对象', '空白'])('保留慢回执之前更新的选区（%s）', async (target) => {
  let confirm!: () => void;
  const pendingGeometry = new Promise<void>((resolve) => {
    confirm = resolve;
  });
  const app = geometryFixture({ pendingGeometry });
  const box = () => app.canvas().querySelector<HTMLElement>('.studio-ui-canvas-selection-outline');
  try {
    await app.open();
    await app.click('形状');
    await app.place();
    expect(box()?.style.left).toBe('260px');

    const point = target === '空白' ? { x: 750, y: 430 } : { x: 70, y: 70 };
    await app.drag(point, point);
    const latestLeft = target === '空白' ? undefined : '48px';
    expect(box()?.style.left).toBe(latestLeft);

    await app.update(confirm);
    expect(box()?.style.left).toBe(latestLeft);
    expect(app.host.querySelector('[data-canvas-object="new-geometry-1"]')).not.toBeNull();
  } finally {
    confirm();
    app.dispose();
  }
});

test('previews resizing a pending placement and saves it against the confirmed version', async () => {
  let confirm!: () => void;
  const pendingGeometry = new Promise<void>((resolve) => {
    confirm = resolve;
  });
  const app = geometryFixture({ pendingGeometry });
  try {
    await app.open();
    await app.click('形状');
    await app.place();
    const operation = app.commands[0]?.operation;
    if (operation?.kind !== 'create') {
      throw new Error('Expected a pending creation.');
    }

    const { x, y, width, height } = operation.object.geometry;
    const handle = app.canvas().querySelector<HTMLElement>('[data-canvas-handle="se"]');
    if (!handle) {
      throw new Error('The pending object must be resizable.');
    }

    const end = { x: x + width + 45, y: y + height + 36 };
    await app.drag({ x: x + width, y: y + height }, end, handle);

    const object = () =>
      app.canvas().querySelector<HTMLElement>('[data-canvas-object="new-geometry-1"]');
    expect(object()?.style.width).toBe(width + 45 + 'px');
    expect(app.commands).toHaveLength(1);

    await app.update(confirm);
    expect(app.commands[1]?.operation).toMatchObject({
      kind: 'transform',
      transform: 'resize',
      objects: [
        {
          target: { id: 'new-geometry-1', expectedGeometryVersion: 1n },
          geometry: { x, y, width: width + 45, height: height + 36 },
        },
      ],
    });
    expect(object()?.style.width).toBe(width + 45 + 'px');
  } finally {
    confirm();
    app.dispose();
  }
});

test.each(['conflict', 'rejected'] as const)(
  'rolls back a pending placement after %s',
  async (createFailure) => {
    let confirm!: () => void;
    const pendingGeometry = new Promise<void>((resolve) => {
      confirm = resolve;
    });
    const app = geometryFixture({ pendingGeometry, createFailure });
    const box = () =>
      app.canvas().querySelector<HTMLElement>('.studio-ui-canvas-selection-outline');

    try {
      await app.open();
      await app.drag({ x: 70, y: 70 }, { x: 70, y: 70 });
      await app.click('形状');
      await app.place();
      expect(box()?.style.left).toBe('260px');
      const handle = app.canvas().querySelector<HTMLElement>('[data-canvas-handle="se"]');
      if (!handle) {
        throw new Error('The pending object must be resizable.');
      }

      await app.drag({ x: 420, y: 280 }, { x: 445, y: 310 }, handle);

      await app.update(confirm);
      expect(app.canvas().querySelector('[data-canvas-object="new-geometry-1"]')).toBeNull();
      expect(app.commands).toHaveLength(1);
      expect(box()?.style.left).toBe('48px');
    } finally {
      confirm();
      app.dispose();
    }
  },
);

test('cancels a placement with Escape and retries an unknown save with the original command', async () => {
  const app = geometryFixture({ failFirst: true });
  try {
    await app.open();
    await app.click('便签');
    await app.update(() => {
      app.canvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await app.place();
    expect(app.commands).toHaveLength(0);

    await app.click('便签');
    await app.place();
    expect(app.receiptRequests).toEqual([[boardId, 'new-geometry-1']]);
    expect(app.host.textContent).toContain('保存结果未知');
    await app.click('重试原编辑');
    expect(app.commands[1]).toBe(app.commands[0]);
    expect(app.host.querySelector('[data-canvas-object="new-geometry-1"]')).not.toBeNull();
    await app.open('reopened');
    expect(app.host.querySelector('[data-canvas-object="new-geometry-1"]')).not.toBeNull();
  } finally {
    app.dispose();
  }
});

test('commits existing Canvas duplicate and connector gestures through geometry editing', async () => {
  const app = geometryFixture();
  try {
    await app.open();
    await app.drag({ x: 72, y: 72 }, { x: 188, y: 89 }, undefined, { altKey: true });
    expect(app.commands[0]?.operation).toMatchObject({
      kind: 'duplicate',
      targets: [
        {
          source: { id: baseObject.id, expectedGeometryVersion: 0n },
          newObjectId: 'new-geometry-1-1',
        },
      ],
    });
    expect(app.host.querySelector('[data-canvas-object="new-geometry-1-1"]')).not.toBeNull();

    await app.click('画笔');
    await app.click('箭头模式');
    await app.drag({ x: 260, y: 234 }, { x: 422, y: 308 });
    expect(app.commands[1]?.operation).toMatchObject({
      kind: 'create',
      object: {
        kind: 'connector',
        detail: {
          kind: 'connector',
          connection: {
            start: { point: { x: 260, y: 234 } },
            end: { point: { x: 422, y: 308 } },
          },
        },
      },
    });
    expect(button(app.host, '选择').getAttribute('aria-pressed')).toBe('true');
  } finally {
    app.dispose();
  }
});

test('uses the original picker shortcuts and repeats the selection from the more menu', async () => {
  const app = geometryFixture();
  try {
    await app.open();
    await app.update(() => {
      app
        .canvas()
        .dispatchEvent(new KeyboardEvent('keydown', { key: '6', bubbles: true, cancelable: true }));
    });
    const inks = app.host.querySelector('[role="group"][aria-label="墨色色板"]');
    expect(
      [...(inks?.querySelectorAll('button') ?? [])].map((ink) => ink.getAttribute('aria-label')),
    ).toEqual(['墨色 墨色', '墨色 陶土色', '墨色 蓝色', '墨色 绿色', '墨色 紫色']);

    await app.update(() => {
      app
        .canvas()
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
    });
    expect(button(app.host, '选择').getAttribute('aria-pressed')).toBe('true');
    await app.drag({ x: 70, y: 70 }, { x: 70, y: 70 });
    await app.click('更多操作');
    await app.click('重复 Ctrl/⌘ D');
    expect(app.commands[0]?.operation).toMatchObject({
      kind: 'duplicate',
      delta: { x: 32, y: 32 },
      targets: [{ source: { id: baseObject.id, expectedGeometryVersion: 0n } }],
    });

    await app.update(() => {
      app.canvas().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'd',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(app.commands[1]?.operation).toMatchObject({
      kind: 'duplicate',
      targets: [{ source: { id: 'new-geometry-1-1', expectedGeometryVersion: 1n } }],
    });

    await app.update(() => {
      app.canvas().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'a',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await app.update(() => {
      app.canvas().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'L',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(app.commands[2]?.operation).toMatchObject({
      kind: 'changeLock',
      locked: true,
      targets: [{ id: baseObject.id }, { id: 'new-geometry-1-1' }, { id: 'new-geometry-2-1' }],
    });
    await app.click('解锁元素');
    await app.update(() => {
      app
        .canvas()
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
        );
    });
    expect(app.commands[4]?.operation).toMatchObject({ kind: 'delete' });
  } finally {
    app.dispose();
  }
});

test('uses the same shape outlines as Canvas and saves the selected drawing ink', async () => {
  const app = geometryFixture();
  try {
    await app.open();
    await app.click('形状');
    expect(
      button(app.host, '形状 菱形')
        .querySelector('svg.studio-ui-canvas-shape-outline')
        ?.getAttribute('viewBox'),
    ).toBe('-2 -2 68 52');

    await app.click('画笔');
    await app.click('墨色 蓝色');
    expect(button(app.host, '墨色 蓝色').getAttribute('aria-pressed')).toBe('true');
    await app.drag({ x: 225, y: 198 }, { x: 278, y: 241 });
    expect(app.commands[0]?.operation).toMatchObject({
      kind: 'create',
      object: { kind: 'ink', appearance: { stroke: '#2F7CC4' } },
    });
    expect(button(app.host, '选择').getAttribute('aria-pressed')).toBe('true');
  } finally {
    app.dispose();
  }
});

test('shows the current move saving state after a geometry edit was saved', async () => {
  let finishMove = () => {};
  const pendingMove = new Promise<void>((done) => {
    finishMove = done;
  });
  const app = geometryFixture({ pendingMove });
  const status = () => app.host.querySelector('header [role="status"]')?.textContent;
  try {
    await app.open();
    await app.click('形状');
    await app.place();
    expect(status()).toContain('已保存');

    await app.drag({ x: 72, y: 72 }, { x: 100, y: 92 });
    expect(status()).toContain('保存中');

    await app.update(finishMove);
    expect(status()).toContain('已保存');
  } finally {
    finishMove();
    app.dispose();
  }
});

test('places the original table from the shape menu, edits a cell and reopens the saved grid', async () => {
  const app = geometryFixture();
  try {
    await app.open();
    await app.click('形状');
    await app.click('表格');
    expect(button(app.host, '形状').getAttribute('aria-pressed')).toBe('true');
    await app.update(() => {
      app.canvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await app.place();
    expect(app.commands).toHaveLength(0);

    await app.click('形状');
    await app.place();
    expect(app.commands[0]?.operation).toMatchObject({
      kind: 'create',
      object: { kind: 'table', geometry: { width: 480, height: 180 } },
      initialPayload: undefined,
    });
    expect(button(app.host, '选择').getAttribute('aria-pressed')).toBe('true');
    const table = '[data-canvas-object="new-geometry-1"]';
    expect(app.host.querySelector(table)?.textContent).toContain('项目 A');

    await app.place();
    expect(app.commands).toHaveLength(1);

    const cell = app.host.querySelector<HTMLElement>(table + ' th');
    if (!cell) {
      throw new Error('The saved table must show its initial header.');
    }

    await app.update(() => {
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
    });
    const editor = app.host.querySelector<HTMLElement>(
      table + ' [role="textbox"][contenteditable]',
    );

    if (!editor) {
      throw new Error('The created table must enter cell editing on double click.');
    }

    await app.update(() => {
      editor.textContent = '名称已保存';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    await app.update(() => {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(app.contentCommands[0]).toMatchObject({
      objectId: 'new-geometry-1',
      expectedPayloadVersion: 0n,
      edit: {
        kind: 'table',
        value: { rows: [['名称已保存', '说明', '状态'], expect.any(Array), expect.any(Array)] },
      },
    });

    await app.open('reopened');
    expect(app.host.querySelector(table)?.textContent).toContain('名称已保存');
    expect(app.host.querySelector(table)?.textContent).toContain('项目 B');
  } finally {
    app.dispose();
  }
});

test('keeps HTML selection actions in the original order and opens the existing source editor', async () => {
  const prototype = HTMLDialogElement.prototype;
  const hasModalSupport = typeof prototype.showModal === 'function';
  if (!hasModalSupport) {
    Object.defineProperties(prototype, {
      showModal: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = true;
        },
      },
      close: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = false;
        },
      },
    });
  }

  const html = {
    ...baseObject,
    id: 'selected-html',
    kind: 'html',
    label: '报表图解',
    payloadVersion: 0n,
    geometry: { ...bounds, width: 380, height: 240 },
  };
  const app = geometryFixture({
    initialObjects: [html],
    initialPayloads: [
      {
        id: html.id,
        version: 0n,
        body: {
          kind: 'embed',
          value: { title: html.label, html: '<p>当前报表</p>', sourceRevision: 1 },
        },
      },
    ],
  });

  try {
    await app.open();
    await app.drag({ x: 70, y: 70 }, { x: 70, y: 70 });
    const toolbar = app.host.querySelector<HTMLElement>('[data-canvas-selection-actions]');
    if (!toolbar) {
      throw new Error('The selected HTML frame must have its own toolbar.');
    }

    expect(toolbar.querySelector('[title="报表图解"]')?.textContent).toBe('报表图解');
    expect(
      [...toolbar.querySelectorAll('button')].map((control) => control.getAttribute('aria-label')),
    ).toEqual(['全屏观看选区', '编辑 HTML 源码', '锁定元素', '图层顺序', '更多操作']);

    await app.click('图层顺序');
    await app.update(() => {
      app.canvas().dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 70,
          clientY: 70,
        }),
      );
    });
    const menus = [...app.host.querySelectorAll('[role="menu"]')];
    expect(menus.map((menu) => menu.getAttribute('aria-label'))).toEqual(['白板操作']);
    expect(menus[0]?.querySelector('[aria-label="重复 Ctrl/⌘ D"]')).not.toBeNull();
    expect(menus[0]?.querySelector('[aria-label="适应选区 Shift 2"]')).not.toBeNull();
    await app.update(() => {
      app
        .canvas()
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
    });
    await app.update(() => button(toolbar, '编辑 HTML 源码').click());
    expect(app.host.querySelector('dialog[open]')?.textContent).toContain('编辑 HTML 源码');
    expect(app.host.querySelector('textarea')?.value).toBe('<p>当前报表</p>');
  } finally {
    app.dispose();
    if (!hasModalSupport) {
      Reflect.deleteProperty(prototype, 'showModal');
      Reflect.deleteProperty(prototype, 'close');
    }
  }
});
