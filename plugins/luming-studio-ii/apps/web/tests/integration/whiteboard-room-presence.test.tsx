import { act, type ComponentProps } from 'react';
import { expect, test } from 'vitest';
import { WhiteboardApp } from '../../src/app/index.js';
import type {
  BoardRoomContentChange,
  BoardRoomGesturePreview,
  BoardRoomObserver,
  BoardRoomPresence,
  BoardRoomSession,
  BoardRoomState,
} from '../../src/data/rooms/index.js';
import type {
  EditObjectContentCommand,
  WhiteboardEditService,
  WhiteboardObject,
  WhiteboardPayload,
  WhiteboardPayloadResult,
  WhiteboardService,
} from '../../src/data/whiteboard/index.js';
import { createControlFixture } from '../support/render-control.js';

type ViewReporter = NonNullable<ComponentProps<typeof WhiteboardApp>['onViewContext']>;
type ReportedView = Parameters<ViewReporter>[0];

const shape: WhiteboardObject = {
  id: 'card',
  kind: 'shape',
  label: '待确认',
  geometry: { x: 40, y: 40, width: 160, height: 100, rotation: 0 },
  geometryVersion: 0n,
  locked: false,
  detail: { kind: 'shape', outline: 'rectangle' },
};

function createRoomFixture() {
  let state: BoardRoomState = {
    status: 'online',
    actorId: 'owner',
    viewId: 'local',
    boardRevision: 0n,
    canEdit: true,
    participants: [
      {
        actorId: 'peer',
        viewId: 'remote',
        displayName: '作者',
        role: 'editor',
        sequence: 1n,
        expiresAtMillis: 18_000,
        following: false,
        viewport: { centerX: 1000, centerY: 750, zoom: 0.5, width: 1800, height: 1200 },
      },
    ],
  };
  let observer: BoardRoomObserver | undefined;
  const updates: BoardRoomPresence[] = [];
  const listeners = new Set<() => void>();
  const session: BoardRoomSession = {
    open(source) {
      observer = source;
      return () => {
        observer = undefined;
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    publishPresence: (presence) => updates.push(presence),
    changeTimer: async () => {
      throw new Error('Unexpected timer command.');
    },
    getTimerReceipt: async () => undefined,
    now: () => 0,
    schedule: () => () => undefined,
  };

  return {
    session,
    updates,
    change(change: BoardRoomContentChange) {
      observer?.onContentChanged?.(change);
    },
    gesture(gesture: BoardRoomGesturePreview | undefined) {
      const participants = state.participants.map((peer) => ({
        ...peer,
        gesture,
        gestureExpiresAtMillis: 1_200,
      }));
      state = { ...state, participants };
      listeners.forEach((listener) => listener());
    },
    revoke() {
      state = { ...state, status: 'accessLost', participants: [], canEdit: false };
      listeners.forEach((listener) => listener());
      observer?.onAccessLost?.();
    },
  };
}

function createBoardFixture() {
  const sceneReads: string[] = [];
  const payloadReads: (readonly string[])[] = [];
  const service: WhiteboardService = {
    async getScene(boardId) {
      sceneReads.push(boardId);
      return { boardId, title: '共享白板', revision: 0n, objects: [shape], canEdit: true };
    },
    async getPayloads(_boardId, ids) {
      payloadReads.push(ids);
      return [];
    },
    moveObjects: async () => {
      throw new Error('Unexpected whiteboard mutation.');
    },
    getReceipt: async () => undefined,
  };

  return { service, sceneReads, payloadReads };
}

function measureCanvas() {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');

  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 900, 600),
  });

  return () => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', original);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect');
    }
  };
}

function roomApp(overrides: Partial<WhiteboardService> = {}, editService?: WhiteboardEditService) {
  const restoreLayout = measureCanvas();
  const fixture = createControlFixture();
  const room = createRoomFixture();
  const board = createBoardFixture();
  const service = { ...board.service, ...overrides };
  const views: ReportedView[] = [];
  const accessLoss: string[] = [];
  let command = 0;
  return {
    host: fixture.host,
    room,
    board,
    views,
    accessLoss,
    async open() {
      await act(async () =>
        fixture.render(
          <WhiteboardApp
            boardId="shared"
            service={service}
            editService={editService}
            room={room.session}
            createCommandId={() => 'command-' + ++command}
            onViewContext={(view) => views.push(view)}
            onRoomAccessLost={() => accessLoss.push('revoked')}
          />,
        ),
      );
    },
    dispose() {
      fixture.dispose();
      restoreLayout();
    },
  };
}

test('opens a trashed owner preview without joining the active collaboration room', async () => {
  const app = roomApp({
    async getScene(boardId) {
      return {
        boardId,
        title: '回收中的白板',
        revision: 1n,
        objects: [shape],
        canEdit: false,
        trashed: true,
      };
    },
  });

  try {
    await app.open();
    await act(async () => app.room.revoke());

    const title = app.host.querySelector<HTMLInputElement>('[aria-label="白板名称"]');
    expect(title?.value).toBe('回收中的白板');
    expect(title?.readOnly).toBe(true);
    expect(app.host.textContent).toContain('只读');
    expect(app.host.textContent).not.toContain('白板访问已撤销');
    expect(app.views).toEqual([]);
    expect(app.accessLoss).toEqual([]);
    expect(app.room.updates).toEqual([]);
  } finally {
    app.dispose();
  }
});

async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (control) => control.ariaLabel === label || control.textContent?.trim() === label,
  );

  if (!button) {
    throw new Error('Missing board control: ' + label);
  }

  await act(async () => button.click());
}

function gesturePointer(root: Element, kind: 'pointerdown' | 'pointermove', x: number, y: number) {
  root.dispatchEvent(
    new PointerEvent(kind, {
      bubbles: true,
      cancelable: true,
      button: kind === 'pointerdown' ? 0 : -1,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
      pointerType: 'mouse',
      clientX: x,
      clientY: y,
    }),
  );
}

async function nextFrame() {
  await act(async () => {
    await new Promise<void>((done) => {
      requestAnimationFrame(() => done());
    });
  });
}

function roomDocumentPayload(id: string, version: bigint, title: string, text: string) {
  return {
    id,
    version,
    body: {
      kind: 'document',
      value: {
        title,
        document: {
          schemaVersion: 1,
          blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: text }],
        },
      },
    },
  } as const satisfies WhiteboardPayload;
}

function deferredPayload() {
  let respond: (results: readonly WhiteboardPayloadResult[]) => void = () => {
    throw new Error('The document payload request was not initialized.');
  };
  const results = new Promise<readonly WhiteboardPayloadResult[]>((resolve) => {
    respond = resolve;
  });

  return { results, respond };
}

function roomDocumentFixture() {
  const source: WhiteboardObject = {
    id: 'room-document',
    kind: 'document',
    label: '原标题',
    geometry: { x: 80, y: 80, width: 550, height: 380, rotation: 0 },
    geometryVersion: 0n,
    payloadVersion: 0n,
    locked: false,
  };
  const initial = roomDocumentPayload(source.id, 0n, '原标题', '原正文');
  const remote = roomDocumentPayload(source.id, 1n, '远端标题', '远端改动的正文');
  const delayed = deferredPayload();
  let version = 0n;
  const writes: EditObjectContentCommand[] = [];
  const unused = async (): Promise<never> => {
    throw new Error('Unexpected write to the test whiteboard.');
  };
  const editService: WhiteboardEditService = {
    async editContent(command) {
      writes.push(command);
      const { boardId, commandId, edit } = command;
      if (command.expectedPayloadVersion !== version || edit.kind !== 'document') {
        return {
          kind: 'conflict',
          boardId,
          commandId,
          revision: version,
          objects: [],
          payloads: [],
        };
      }

      version++;
      return {
        kind: 'applied',
        boardId,
        commandId,
        revision: version,
        objects: [{ ...source, label: edit.value.title, payloadVersion: version }],
        payloads: [
          {
            kind: 'loaded',
            payload: { id: source.id, version, body: { ...edit, value: { ...edit.value } } },
          },
        ],
        removedIds: [],
        order: [],
      };
    },
    getReceipt: async () => undefined,
    editGeometry: unused,
    attachImage: unused,
  };
  const app = roomApp(
    {
      async getScene(boardId) {
        const current = version ? remote : initial;
        const object = { ...source, label: current.body.value.title, payloadVersion: version };

        return { boardId, title: '共享白板', revision: version, objects: [object], canEdit: true };
      },
      async getPayloads() {
        return version ? delayed.results : [{ kind: 'loaded', payload: initial }];
      },
    },
    editService,
  );

  return {
    ...app,
    writes,
    updateRemote() {
      version = 1n;
      app.room.change({
        revision: version,
        changedObjectIds: [source.id],
        changedObjects: [{ ...source, label: remote.body.value.title, payloadVersion: version }],
        removedObjectIds: [],
        refreshScene: false,
      });
    },
    deliverRemote() {
      delayed.respond([{ kind: 'loaded', payload: remote }]);
    },
  };
}

function typeDocumentTitle(title: string) {
  const input = document.querySelector<HTMLInputElement>(
    '[data-document-view="edit"] input.studio-document-title',
  );

  if (!input) {
    throw new Error('Missing document title editor.');
  }

  act(() => {
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    value?.set?.call(input, title);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: title }));
  });
}

async function waitForDocument(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check() && Date.now() < deadline) {
    await nextFrame();
  }

  expect(check()).toBe(true);
}

function prepareDocumentScrolling() {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
    },
  });

  return () => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', original);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    }
  };
}

test('keeps the active document and its exact save version while room metadata awaits the body', async () => {
  const restoreScroll = prepareDocumentScrolling();
  const app = roomDocumentFixture();
  const editorSelector = '[data-document-editor] [contenteditable="true"]';
  try {
    await app.open();
    await click('编辑文档');
    await waitForDocument(() => document.querySelector(editorSelector) !== null);
    const editor = document.querySelector(editorSelector);
    typeDocumentTitle('本地草稿标题');
    await act(async () => app.updateRemote());
    expect(document.querySelector(editorSelector)).toBe(editor);
    await waitForDocument(() => app.writes.length === 1);
    expect(app.writes[0]?.expectedPayloadVersion).toBe(0n);

    await click('比较最新内容');
    await click('保存此草稿');
    expect(app.writes[1]?.expectedPayloadVersion).toBe(0n);
    await act(async () => app.deliverRemote());
    expect(app.host.textContent).toContain('远端改动的正文');
    await click('保存此草稿');
    expect(app.writes[2]).toMatchObject({
      expectedPayloadVersion: 1n,
      edit: {
        kind: 'document',
        value: { title: '本地草稿标题', document: { blocks: [{ content: '远端改动的正文' }] } },
      },
    });

    await act(async () => app.room.revoke());
    expect(document.querySelector(editorSelector)).toBeNull();
    expect(app.host.textContent).toContain('白板访问已撤销');
    expect(app.host.textContent).not.toContain('远端改动的正文');
  } finally {
    app.dispose();
    restoreScroll();
  }
});

test('follows a larger peer viewport, publishes world pointer coordinates and detaches on a real action', async () => {
  const app = roomApp();
  try {
    await app.open();
    await click('此刻在这里');
    await click('跟随 作者');
    await act(async () => {
      await new Promise<void>((done) => {
        requestAnimationFrame(() => done());
      });
    });
    expect(app.host.textContent).toContain('正在跟随 作者');
    expect(app.views.at(-1)).toMatchObject({
      boardId: 'shared',
      selectedIds: [],
      viewport: { x: 200, y: 112.5, zoom: 0.25 },
    });

    const canvas = app.host.querySelector('[data-canvas-root]');
    expect(canvas).not.toBeNull();
    act(() => {
      canvas?.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: 225,
          clientY: 137.5,
          isPrimary: true,
          pointerType: 'mouse',
        }),
      );
    });
    expect(app.room.updates.at(-1)).toEqual({
      cursor: { x: 100, y: 100 },
      following: true,
      viewport: undefined,
    });
    expect(app.host.textContent).toContain('正在跟随 作者');

    act(() => {
      canvas?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });
    expect(app.host.textContent).not.toContain('正在跟随 作者');
    expect(app.room.updates.at(-1)).toMatchObject({ following: false });
  } finally {
    app.dispose();
  }
});

test('applies room object metadata without rereading the scene and clears view context on access loss', async () => {
  const app = roomApp();
  try {
    await app.open();
    expect(app.host.textContent).toContain('待确认');
    const change = {
      revision: 1n,
      changedObjectIds: [shape.id],
      changedObjects: [{ ...shape, label: '已同步' }],
      removedObjectIds: [],
      refreshScene: false,
    };

    act(() => app.room.change(change));
    act(() => app.room.change(change));
    expect(app.host.textContent).toContain('已同步');
    expect(app.board.sceneReads).toEqual(['shared']);
    expect(app.board.payloadReads).toEqual([]);

    await act(async () => app.room.revoke());
    expect(app.host.textContent).toContain('白板访问已撤销');
    expect(app.host.querySelector('[data-canvas-root]')).toBeNull();
    expect(app.views.at(-1)).toBeUndefined();
    expect(app.accessLoss).toEqual(['revoked']);
  } finally {
    app.dispose();
  }
});

test('keeps the canvas and existing object mounted while recovering a missing room revision', async () => {
  type Scene = Awaited<ReturnType<WhiteboardService['getScene']>>;
  let resolveRecovery: ((scene: Scene) => void) | undefined;
  const recovery = new Promise<Scene>((resolve) => {
    resolveRecovery = resolve;
  });
  const baseline = { ...shape, geometryVersion: 2n };
  const latest = { ...baseline, geometryVersion: 3n, label: '已从房间恢复' };
  let sceneReads = 0;
  const app = roomApp({
    async getScene(boardId) {
      sceneReads++;
      if (sceneReads === 2) {
        return recovery;
      }

      return { boardId, title: '共享白板', revision: 0n, objects: [shape], canEdit: true };
    },
  });
  const canvasRoot = () => app.host.querySelector('[data-canvas-root]');
  const card = () => app.host.querySelector('[data-canvas-object="card"]');
  try {
    await app.open();
    const canvas = canvasRoot();
    const originalCard = card();
    expect(canvas).not.toBeNull();
    expect(originalCard).not.toBeNull();

    act(() => {
      app.room.change({
        revision: 2n,
        changedObjectIds: [],
        removedObjectIds: [],
        refreshScene: true,
      });
      app.room.change({
        revision: 3n,
        changedObjectIds: [shape.id],
        changedObjects: [latest],
        removedObjectIds: [],
        refreshScene: false,
      });
    });
    expect(canvasRoot()).toBe(canvas);
    expect(card()).toBe(originalCard);

    await act(async () => {
      resolveRecovery?.({
        boardId: 'shared',
        title: '共享白板',
        revision: 2n,
        objects: [baseline],
        canEdit: true,
      });
    });
    expect(app.host.textContent).toContain('已从房间恢复');
    expect(canvasRoot()).toBe(canvas);
    expect(card()).toBe(originalCard);
    expect(sceneReads).toBe(2);
    expect(app.board.payloadReads).toEqual([]);
  } finally {
    app.dispose();
  }
});

test('shows an unsaved pointer drag in a second whiteboard view and clears it on cancel', async () => {
  const sender = roomApp();
  const recipient = roomApp();
  try {
    await sender.open();
    await recipient.open();
    await nextFrame();
    const canvas = sender.host.querySelector('[data-canvas-root]');
    const camera = sender.views.at(-1)?.viewport;
    if (!canvas || !camera) {
      throw new Error('The source whiteboard did not render a camera.');
    }

    const clientX = camera.x + 80 * camera.zoom;
    const clientY = camera.y + 80 * camera.zoom;
    act(() => {
      gesturePointer(canvas, 'pointerdown', clientX, clientY);
      gesturePointer(canvas, 'pointermove', clientX + 140, clientY);
    });
    await nextFrame();
    const preview = sender.room.updates.at(-1)?.gesture;
    expect(preview?.kind).toBe('move');
    const x = preview?.changes[0]?.geometry.x;
    expect(x).toBeGreaterThan(40);

    act(() => recipient.room.gesture(preview));
    const position = () =>
      recipient.host.querySelector<HTMLElement>('[data-canvas-object="card"]')?.style.left;
    expect(position()).toBe(x + 'px');
    expect(recipient.board.sceneReads).toEqual(['shared']);
    expect(recipient.board.payloadReads).toEqual([]);

    act(() => {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    const cleared = sender.room.updates.at(-1)?.gesture;
    expect(cleared).toBeUndefined();
    act(() => recipient.room.gesture(cleared));
    expect(position()).toBe('40px');
  } finally {
    recipient.dispose();
    sender.dispose();
  }
});
