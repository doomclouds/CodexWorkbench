import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  BoardSharingService,
  SharingRole,
  SharingScope,
} from '@codexworkbench/luming-studio-ii-contracts/sharing/service';
import { act } from 'react';
import { expect, test } from 'vitest';
import { StudioApp, type StudioAppProps } from '../../src/app/index.js';
import type {
  BoardRoomObserver,
  BoardRoomSession,
  BoardRoomState,
} from '../../src/data/rooms/index.js';
import { createBoardSharingService } from '../../src/data/sharing/index.js';
import { createWhiteboardService } from '../../src/data/whiteboard/index.js';
import {
  isGuestAccessDenied,
  readStudioGuestEntry,
  readStudioLocation,
  replaceStudioGuestLocation,
  StudioHttpError,
  subscribeStudioLocation,
  writeStudioLocation,
} from '../../src/platform/browser/index.js';
import { createWhiteboardRpcMock, sampleBoardId } from '../fixtures/whiteboard-rpc.js';
import { createControlFixture } from '../support/render-control.js';

const boardUrl = '/?board=' + sampleBoardId;
const invitationToken = 'commenter.test-token';
const guestName = '测试来宾';
const { inspectBoardInvitation, joinBoardInvitation, getBoardSharing } = BoardSharingService.method;
const version = 1n;
const guestSession = {
  boardId: sampleBoardId,
  actorId: 'guest-1',
  name: guestName,
  role: SharingRole.COMMENTER,
  version,
  canEdit: false,
  canComment: true,
};

function createGuestSharingMock() {
  const calls: string[] = [];
  let joined = false;
  let revoked = false;
  let canComment = true;
  let canEdit = false;
  let role: SharingRole = SharingRole.COMMENTER;
  let scope: SharingScope = SharingScope.LAN;
  let failNextCheck = false;
  const service = createBoardSharingService((path, body) => {
    const method = path.split('/').at(-1) ?? '';
    calls.push(method);
    if (method === inspectBoardInvitation.name) {
      expect(fromBinary(inspectBoardInvitation.input, body)).toMatchObject({
        boardId: sampleBoardId,
        invitationToken,
      });
      const result = create(
        inspectBoardInvitation.output,
        joined && !revoked && canComment
          ? { session: guestSession }
          : {
              invitation: {
                boardId: sampleBoardId,
                title: '来宾白板',
                role: SharingRole.COMMENTER,
              },
            },
      );

      return Promise.resolve(toBinary(inspectBoardInvitation.output, result));
    }
    if (method === joinBoardInvitation.name) {
      expect(fromBinary(joinBoardInvitation.input, body)).toMatchObject({
        boardId: sampleBoardId,
        invitationToken,
        name: guestName,
      });
      joined = true;
      const result = create(joinBoardInvitation.output, { session: guestSession });

      return Promise.resolve(toBinary(joinBoardInvitation.output, result));
    }

    expect(method).toBe(getBoardSharing.name);
    expect(fromBinary(getBoardSharing.input, body).boardId).toBe(sampleBoardId);
    if (!joined || revoked) {
      return Promise.reject(new StudioHttpError(joined ? 403 : 401));
    }

    if (failNextCheck) {
      failNextCheck = false;
      return Promise.reject(new StudioHttpError(503));
    }

    const result = create(getBoardSharing.output, {
      sharing: {
        boardId: sampleBoardId,
        enabled: true,
        scope,
        version,
        role,
        canEdit,
        canComment,
      },
    });

    return Promise.resolve(toBinary(getBoardSharing.output, result));
  });

  return {
    service,
    calls,
    failNextCheck() {
      failNextCheck = true;
    },
    useLocalScope() {
      scope = SharingScope.LOCAL;
    },
    limitToViewing() {
      role = SharingRole.VIEWER;
      canComment = false;
      canEdit = false;
    },
    allowEditing() {
      role = SharingRole.EDITOR;
      canEdit = true;
      canComment = true;
    },
    revoke() {
      revoked = true;
    },
  };
}

type ViewReader = NonNullable<StudioAppProps['navigation']['readBoardView']>;

function guestRoomMock() {
  const listeners = new Set<() => void>();
  let state: BoardRoomState = {
    status: 'connecting',
    viewId: 'test-guest-view',
    canEdit: false,
    participants: [],
  };
  const session: BoardRoomSession = {
    open: () => () => undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    publishPresence: () => undefined,
    changeTimer: () => Promise.reject(new Error('Unexpected guest timer write.')),
    getTimerReceipt: () => Promise.resolve(undefined),
    now: () => 0,
    schedule: () => () => undefined,
  };

  function update(status: BoardRoomState['status']) {
    state = { ...state, status };
    for (const listener of listeners) {
      listener();
    }
  }

  return { session, update };
}

function createGuestAppMock(
  url: string,
  createRoomSession?: NonNullable<StudioAppProps['guest']>['createRoomSession'],
  initialBoardView?: ReturnType<ViewReader>,
) {
  const previousUrl = window.location.href;
  const previousState: unknown = window.history.state;
  const fixture = createControlFixture();
  const guestBoard = createWhiteboardRpcMock();
  const ownerBoard = createWhiteboardRpcMock();
  const sharing = createGuestSharingMock();
  const room = guestRoomMock();
  let catalogReads = 0;
  let savedView = initialBoardView;
  const props: StudioAppProps = {
    catalog: {
      listBoards() {
        catalogReads += 1;

        return Promise.resolve({ boards: [] });
      },
      createBoard: ({ commandId }) =>
        Promise.resolve({ kind: 'rejected', commandId, reason: 'invalidTitle' }),
      getReceipt: () => Promise.resolve(undefined),
    },
    service: createWhiteboardService(ownerBoard.post),
    navigation: {
      read: readStudioLocation,
      write: writeStudioLocation,
      subscribe: subscribeStudioLocation,
      readBoardView: () => savedView,
    },
    onViewContext:
      initialBoardView &&
      ((view) => {
        if (view) {
          savedView = view;
        }
      }),
    preferences: {
      layout: 'grid',
      resolvedTheme: 'dark',
      rememberLayout: () => undefined,
      rememberTheme: () => undefined,
    },
    createCommandId: () => 'guest-command',
    copyShareLink: () => Promise.resolve(),
    guest: {
      service: createWhiteboardService(guestBoard.post),
      sharingService: sharing.service,
      createRoomSession: createRoomSession ?? (() => room.session),
      feedbackService: {
        listThreads: () => Promise.resolve({ items: [], canWrite: true }),
        getThread: () => Promise.reject(new Error('No feedback thread is in this fixture.')),
        apply: () => Promise.reject(new Error('Unexpected feedback write.')),
        getReceipt: () => Promise.resolve(undefined),
      },
      readEntry: readStudioGuestEntry,
      replaceEntry: replaceStudioGuestLocation,
      isAccessDenied: isGuestAccessDenied,
    },
  };
  window.history.replaceState(null, '', url);

  return {
    host: fixture.host,
    ownerBoard,
    guestBoard,
    sharing,
    readCatalogCalls: () => catalogReads,
    open: (key: string) => act(async () => fixture.render(<StudioApp key={key} {...props} />)),
    announceOnline: () => act(async () => room.update('online')),
    refresh: () =>
      act(async () => {
        room.update('reconnecting');
        room.update('online');
      }),
    dispose() {
      fixture.dispose();
      window.history.replaceState(previousState, '', previousUrl);
    },
  };
}

function guestButton(host: HTMLElement, label: string): HTMLButtonElement {
  const element = [...host.querySelectorAll('button')].find(
    (button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label,
  );

  if (!element) {
    throw new Error('Missing guest action: ' + label);
  }

  return element;
}

function enterName(host: HTMLElement, name: string): void {
  const input = host.querySelector('input[name="name"]');
  const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!input || !value?.set) {
    throw new Error('Missing guest name field.');
  }

  value.set.call(input, name);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: name }));
}

function readCamera(host: HTMLElement) {
  return host.querySelector<HTMLElement>('.studio-canvas__world')?.style.transform;
}

function mockCanvasMetrics(width: number, height: number, ratio = 1) {
  const metric = 'getBoundingClientRect';
  const pixelRatio = 'devicePixelRatio';
  const originalBounds = Object.getOwnPropertyDescriptor(HTMLElement.prototype, metric);
  const originalPixelRatio = Object.getOwnPropertyDescriptor(window, pixelRatio);
  let bounds = new DOMRect(0, 0, width, height);
  Object.defineProperty(HTMLElement.prototype, metric, {
    configurable: true,
    value: () => bounds,
  });
  Object.defineProperty(window, pixelRatio, { configurable: true, value: ratio });

  return {
    resize(width: number, height: number) {
      bounds = new DOMRect(0, 0, width, height);
    },
    restore() {
      if (originalBounds) {
        Object.defineProperty(HTMLElement.prototype, metric, originalBounds);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, metric);
      }
      if (originalPixelRatio) {
        Object.defineProperty(window, pixelRatio, originalPixelRatio);
      } else {
        Reflect.deleteProperty(window, pixelRatio);
      }
    },
  };
}

async function afterCameraFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function resetCameraZoom(host: HTMLElement) {
  const canvas = host.querySelector('[data-canvas-root]');
  await act(async () =>
    canvas?.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        code: 'Digit0',
        key: ')',
        shiftKey: true,
      }),
    ),
  );
}

test.each([
  [960, 600, 1],
  [1440, 900, 2],
])(
  'fits owner and invited guest equally in a %s by %s CSS pixel canvas at DPR %s',
  async (width, height, ratio) => {
    const metrics = mockCanvasMetrics(width, height, ratio);
    try {
      const owner = createGuestAppMock(boardUrl);
      let ownerCamera: string | undefined;
      try {
        await owner.open('owner');
        await afterCameraFrame();
        const expectedZoom = (width - 144) / 6160;
        ownerCamera = readCamera(owner.host);
        expect(ownerCamera).toContain('scale(' + expectedZoom + ')');
      } finally {
        owner.dispose();
      }

      const guest = createGuestAppMock(boardUrl + '#invite=' + invitationToken);
      try {
        await guest.open('invited');
        await act(async () => enterName(guest.host, guestName));
        await act(async () => guestButton(guest.host, '打开白板').click());
        await afterCameraFrame();
        expect(readCamera(guest.host)).toBe(ownerCamera);
        expect(guest.host.querySelector('[aria-label="返回 Luming Studio II"]')).toBeNull();

        await resetCameraZoom(guest.host);
        const manualCamera = readCamera(guest.host);
        expect(manualCamera).toContain('scale(1)');
        await guest.refresh();
        metrics.resize(width - 64, height - 64);
        await act(async () => window.dispatchEvent(new Event('resize')));
        await afterCameraFrame();
        expect(readCamera(guest.host)).toBe(manualCamera);
      } finally {
        guest.dispose();
      }
    } finally {
      metrics.restore();
    }
  },
);

test('uses the saved camera ahead of fitting on a remounted guest board', async () => {
  const metrics = mockCanvasMetrics(960, 600);
  const app = createGuestAppMock(boardUrl + '#invite=' + invitationToken, undefined, {
    boardId: sampleBoardId,
    selectedIds: [],
    viewport: { x: 80, y: 35, zoom: 0.55 },
  });

  try {
    await app.open('invited');
    await act(async () => enterName(app.host, guestName));
    await act(async () => guestButton(app.host, '打开白板').click());
    await afterCameraFrame();
    expect(readCamera(app.host)).toBe('translate(80px, 35px) scale(0.55)');

    await resetCameraZoom(app.host);
    const manualCamera = readCamera(app.host);
    expect(manualCamera).toContain('scale(1)');
    await app.open('remounted');
    await afterCameraFrame();
    expect(readCamera(app.host)).toBe(manualCamera);
  } finally {
    app.dispose();
    metrics.restore();
  }
});

test('uses authorized guest sharing scope and switches theme without leaving the board', async () => {
  const app = createGuestAppMock(boardUrl + '#invite=' + invitationToken);
  try {
    await app.open('invited');
    await act(async () => enterName(app.host, guestName));
    await act(async () => guestButton(app.host, '打开白板').click());

    const share = guestButton(app.host, '分享');
    Object.defineProperty(share, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(720, 40, 80, 32),
    });
    expect(share.getAttribute('aria-description')).toBe('局域网共享已开启');
    app.sharing.useLocalScope();
    await app.refresh();
    expect(share.hasAttribute('aria-description')).toBe(false);

    const theme = guestButton(app.host, '切换为明亮主题');
    expect(share.getAttribute('aria-expanded')).toBe('false');
    await act(async () => theme.click());
    expect(app.host.querySelector('.studio-whiteboard-app')?.getAttribute('data-theme')).toBe(
      'light',
    );
    expect(share.getAttribute('aria-expanded')).toBe('false');
    await act(async () => share.click());
    expect(share.getAttribute('aria-expanded')).toBe('true');
    expect(app.guestBoard.sceneReads).toEqual([sampleBoardId]);
  } finally {
    app.dispose();
  }
});

test('joins an explicit invitation, strips the token and resumes only the guest board', async () => {
  const app = createGuestAppMock(boardUrl + '#invite=' + invitationToken);
  try {
    await app.open('invited');

    expect(app.sharing.calls).toEqual([inspectBoardInvitation.name]);
    expect(app.host.textContent).toContain('你被邀请评论这块白板。');
    expect(app.host.querySelector('.studio-app-page[data-guest-invitation]')).not.toBeNull();
    expect(app.guestBoard.sceneReads).toEqual([]);
    expect(app.ownerBoard.sceneReads).toEqual([]);

    await act(async () => enterName(app.host, guestName));
    await act(async () => guestButton(app.host, '打开白板').click());

    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe(boardUrl.slice(1));
    expect(app.sharing.calls).toEqual([
      inspectBoardInvitation.name,
      joinBoardInvitation.name,
      getBoardSharing.name,
    ]);
    expect(app.guestBoard.sceneReads).toEqual([sampleBoardId]);
    expect(app.host.querySelector('[data-canvas-root]')).not.toBeNull();
    expect(app.host.querySelector('.studio-app-page[data-guest-invitation]')).toBeNull();
    expect(app.host.querySelector('[aria-label="返回 Luming Studio II"]')).toBeNull();
    expect(app.host.querySelector('[aria-label="白板名称"]')).toHaveProperty('readOnly', true);
    expect(app.host.querySelector('[aria-label="备注"]')).toHaveProperty('disabled', false);

    await app.open('restored');
    expect(app.sharing.calls.at(-1)).toBe(getBoardSharing.name);
    expect(app.guestBoard.sceneReads).toEqual([sampleBoardId, sampleBoardId]);
    expect(app.ownerBoard.sceneReads).toEqual([]);
    expect(app.readCatalogCalls()).toBe(0);

    const canvas = app.host.querySelector('[data-canvas-root]');
    app.sharing.limitToViewing();
    await app.refresh();
    expect(app.host.querySelector('[data-canvas-root]')).toBe(canvas);
    expect(app.host.querySelector('[aria-label="备注"]')).toHaveProperty('disabled', true);
    expect(app.guestBoard.sceneReads).toEqual([sampleBoardId, sampleBoardId]);

    app.sharing.allowEditing();
    await app.refresh();
    expect(app.host.querySelector('[data-canvas-root]')).toBe(canvas);
    expect(app.host.querySelector('[aria-label="备注"]')).toHaveProperty('disabled', false);
    expect(app.host.querySelector('[aria-label="白板工具"]')).not.toBeNull();

    app.sharing.revoke();
    await app.refresh();

    expect(app.host.querySelector('[data-canvas-root]')).toBeNull();
    expect(app.host.textContent).toContain('无法访问此白板');
    expect(document.activeElement).toBe(app.host.querySelector('.guest-session-denied'));
    await act(async () => guestButton(app.host, '退出此白板').click());
    expect(window.location.search).toBe('');
    expect(app.host.textContent).toContain('当前没有打开的白板。');
    expect(app.readCatalogCalls()).toBe(0);
  } finally {
    app.dispose();
  }
});

test('corrects a permission change during first room connection while keeping the original canvas', async () => {
  const app = createGuestAppMock(boardUrl + '#invite=' + invitationToken);
  try {
    await app.open('invited');
    await act(async () => enterName(app.host, guestName));
    await act(async () => guestButton(app.host, '打开白板').click());
    const initial = app.sharing.calls.slice();
    const canvas = app.host.querySelector('[data-canvas-root]');
    expect(canvas).not.toBeNull();
    expect(guestButton(app.host, '备注').disabled).toBe(false);

    app.sharing.limitToViewing();
    await app.announceOnline();
    await app.announceOnline();
    expect(guestButton(app.host, '备注').disabled).toBe(true);
    expect(app.sharing.calls).toEqual([...initial, getBoardSharing.name]);
    expect(app.host.querySelector('[data-canvas-root]')).toBe(canvas);
    expect(app.guestBoard.sceneReads).toEqual([sampleBoardId]);
  } finally {
    app.dispose();
  }
});

test('retries one temporary access failure after reconnecting without replacing the canvas', async () => {
  const app = createGuestAppMock(boardUrl + '#invite=' + invitationToken);
  try {
    await app.open('invited');
    await act(async () => enterName(app.host, guestName));
    await act(async () => guestButton(app.host, '打开白板').click());
    await app.announceOnline();
    const initial = app.sharing.calls.slice();
    const canvas = app.host.querySelector('[data-canvas-root]');
    expect(canvas).not.toBeNull();

    app.sharing.limitToViewing();
    app.sharing.failNextCheck();
    await app.refresh();
    expect(app.sharing.calls).toEqual([...initial, getBoardSharing.name]);
    expect(app.host.querySelector('[data-canvas-root]')).toBe(canvas);
    await expect
      .poll(async () => {
        await act(async () => Promise.resolve());
        return guestButton(app.host, '备注').disabled;
      })
      .toBe(true);
    await app.announceOnline();
    expect(app.sharing.calls).toEqual([...initial, getBoardSharing.name, getBoardSharing.name]);
    expect(app.host.querySelector('[data-canvas-root]')).toBe(canvas);
    expect(app.guestBoard.sceneReads).toEqual([sampleBoardId]);
  } finally {
    app.dispose();
  }
});

test('reopens a valid invitation in a known browser without repeating name entry', async () => {
  const url = boardUrl + '#invite=' + invitationToken;
  const app = createGuestAppMock(url);
  try {
    await app.open('first-invite');
    await act(async () => enterName(app.host, guestName));
    await act(async () => guestButton(app.host, '打开白板').click());
    window.history.replaceState(null, '', url);
    await app.open('reopened-invite');

    expect(app.sharing.calls).toEqual([
      inspectBoardInvitation.name,
      joinBoardInvitation.name,
      getBoardSharing.name,
      inspectBoardInvitation.name,
      getBoardSharing.name,
    ]);
    expect(app.host.querySelector('[data-canvas-root]')).not.toBeNull();
    expect(app.host.querySelector('input[name="name"]')).toBeNull();
    expect(window.location.hash).toBe('');
  } finally {
    app.dispose();
  }
});

test('keeps a cold member link on a guest listener inside the unauthorized gate', async () => {
  const app = createGuestAppMock(boardUrl);
  const html = document.documentElement;
  html.dataset.studioGuestEntry = 'true';
  try {
    await app.open('cold-guest');

    expect(app.sharing.calls).toEqual([getBoardSharing.name]);
    expect(app.host.textContent).toContain('无权访问');
    expect(app.guestBoard.sceneReads).toEqual([]);
    expect(app.ownerBoard.sceneReads).toEqual([]);
    expect(app.readCatalogCalls()).toBe(0);
  } finally {
    delete html.dataset.studioGuestEntry;
    app.dispose();
  }
});

test('rechecks a terminated guest room and mounts a new view when access is still valid', async () => {
  const roomObservers: BoardRoomObserver[] = [];
  const closed: string[] = [];
  let sequence = 0;

  function createRoomSession(_boardId: string): BoardRoomSession {
    sequence++;
    const viewId = 'guest-view-' + sequence;
    const state: BoardRoomState = {
      status: 'connecting',
      viewId,
      canEdit: false,
      participants: [],
    };

    return {
      getSnapshot: () => state,
      subscribe: () => () => undefined,
      open(observer) {
        if (observer) {
          roomObservers.push(observer);
        }

        return () => {
          closed.push(viewId);
        };
      },
      publishPresence: () => undefined,
      async changeTimer() {
        throw new Error('Unexpected guest timer mutation.');
      },
      async getTimerReceipt() {
        return undefined;
      },
      now: () => 0,
      schedule: () => () => undefined,
    };
  }

  const app = createGuestAppMock(boardUrl + '#invite=' + invitationToken, createRoomSession);
  try {
    await app.open('invited');
    await act(async () => enterName(app.host, guestName));
    await act(async () => guestButton(app.host, '打开白板').click());
    expect(roomObservers).toHaveLength(1);
    expect(app.host.querySelector('[data-canvas-root]')).not.toBeNull();

    await act(async () => roomObservers[0]?.onAccessLost?.());
    expect(app.sharing.calls).toEqual([
      inspectBoardInvitation.name,
      joinBoardInvitation.name,
      getBoardSharing.name,
      getBoardSharing.name,
    ]);
    expect(closed).toEqual(['guest-view-1']);
    expect(roomObservers).toHaveLength(2);
    expect(app.host.querySelector('[data-canvas-root]')).not.toBeNull();
    expect(app.host.querySelector('[aria-label="备注"]')).toHaveProperty('disabled', false);
  } finally {
    app.dispose();
  }
});

test('loads the owner workbench through its existing route without touching guest sharing', async () => {
  const app = createGuestAppMock('/');
  try {
    await app.open('owner');

    expect(app.readCatalogCalls()).toBe(1);
    expect(app.sharing.calls).toEqual([]);
  } finally {
    app.dispose();
  }
});
