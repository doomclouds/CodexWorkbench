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
import type { WhiteboardObject, WhiteboardService } from '../../src/data/whiteboard/index.js';
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

function roomApp() {
  const restoreLayout = measureCanvas();
  const fixture = createControlFixture();
  const room = createRoomFixture();
  const board = createBoardFixture();
  const views: ReportedView[] = [];
  const accessLoss: string[] = [];
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
            service={board.service}
            room={room.session}
            createCommandId={() => 'command'}
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

async function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');
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
