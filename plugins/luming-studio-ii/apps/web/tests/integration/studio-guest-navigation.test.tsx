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

function createGuestSharingMock() {
  const calls: string[] = [];
  let joined = false;
  let revoked = false;
  let canComment = true;
  const service = createBoardSharingService((path, body) => {
    const method = path.split('/').at(-1) ?? '';
    calls.push(method);
    if (method === inspectBoardInvitation.name) {
      expect(fromBinary(inspectBoardInvitation.input, body)).toMatchObject({
        boardId: sampleBoardId,
        invitationToken,
      });
      const result = create(inspectBoardInvitation.output, {
        invitation: { boardId: sampleBoardId, title: '来宾白板', role: SharingRole.COMMENTER },
      });

      return Promise.resolve(toBinary(inspectBoardInvitation.output, result));
    }
    if (method === joinBoardInvitation.name) {
      expect(fromBinary(joinBoardInvitation.input, body)).toMatchObject({
        boardId: sampleBoardId,
        invitationToken,
        name: guestName,
      });
      joined = true;
      const result = create(joinBoardInvitation.output, {
        session: {
          boardId: sampleBoardId,
          actorId: 'guest-1',
          name: guestName,
          role: SharingRole.COMMENTER,
          version,
          canEdit: false,
          canComment: true,
        },
      });

      return Promise.resolve(toBinary(joinBoardInvitation.output, result));
    }

    expect(method).toBe(getBoardSharing.name);
    expect(fromBinary(getBoardSharing.input, body).boardId).toBe(sampleBoardId);
    if (!joined || revoked) {
      return Promise.reject(new StudioHttpError(joined ? 403 : 401));
    }

    const result = create(getBoardSharing.output, {
      sharing: {
        boardId: sampleBoardId,
        enabled: true,
        scope: SharingScope.LAN,
        version,
        role: canComment ? SharingRole.COMMENTER : SharingRole.VIEWER,
        canEdit: false,
        canComment,
      },
    });

    return Promise.resolve(toBinary(getBoardSharing.output, result));
  });

  return {
    service,
    calls,
    limitToViewing() {
      canComment = false;
    },
    revoke() {
      revoked = true;
    },
  };
}

function createGuestAppMock(
  url: string,
  createRoomSession?: NonNullable<StudioAppProps['guest']>['createRoomSession'],
) {
  const previousUrl = window.location.href;
  const previousState: unknown = window.history.state;
  const fixture = createControlFixture();
  const guestBoard = createWhiteboardRpcMock();
  const ownerBoard = createWhiteboardRpcMock();
  const sharing = createGuestSharingMock();
  let refreshAccess: (() => void) | undefined;
  let catalogReads = 0;
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
    },
    preferences: {
      layout: 'grid',
      resolvedTheme: 'dark',
      rememberLayout: () => undefined,
      rememberTheme: () => undefined,
    },
    createCommandId: () => 'guest-command',
    guest: {
      service: createWhiteboardService(guestBoard.post),
      sharingService: sharing.service,
      createRoomSession,
      feedbackService: {
        listThreads: () => Promise.resolve({ items: [], canWrite: true }),
        getThread: () => Promise.reject(new Error('No feedback thread is in this fixture.')),
        apply: () => Promise.reject(new Error('Unexpected feedback write.')),
        getReceipt: () => Promise.resolve(undefined),
      },
      readEntry: readStudioGuestEntry,
      replaceEntry: replaceStudioGuestLocation,
      isAccessDenied: isGuestAccessDenied,
      subscribeRefresh(read) {
        refreshAccess = read;

        return () => {
          refreshAccess = undefined;
        };
      },
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
    refresh: () => act(async () => refreshAccess?.()),
    dispose() {
      fixture.dispose();
      window.history.replaceState(previousState, '', previousUrl);
    },
  };
}

function guestButton(host: HTMLElement, label: string): HTMLButtonElement {
  const element = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === label,
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

test('joins an explicit invitation, strips the token and resumes only the guest board', async () => {
  const app = createGuestAppMock(boardUrl + '#invite=' + invitationToken);
  try {
    await app.open('invited');

    expect(app.sharing.calls).toEqual([inspectBoardInvitation.name]);
    expect(app.host.textContent).toContain('你被邀请评论这块白板。');
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
    expect(app.host.querySelector('[aria-label="返回 Luming Studio"]')).toBeNull();
    expect(app.host.querySelector('[aria-label="白板名称"]')).toHaveProperty('readOnly', true);
    expect(app.host.querySelector('[aria-label="备注"]')).toHaveProperty('disabled', false);

    await app.open('restored');
    expect(app.sharing.calls.at(-1)).toBe(getBoardSharing.name);
    expect(app.guestBoard.sceneReads).toEqual([sampleBoardId, sampleBoardId]);
    expect(app.ownerBoard.sceneReads).toEqual([]);
    expect(app.readCatalogCalls()).toBe(0);

    app.sharing.limitToViewing();
    await app.refresh();
    expect(app.host.querySelector('[data-canvas-root]')).not.toBeNull();
    expect(app.host.querySelector('[aria-label="备注"]')).toHaveProperty('disabled', true);

    app.sharing.revoke();
    await app.refresh();

    expect(app.host.querySelector('[data-canvas-root]')).toBeNull();
    expect(app.host.textContent).toContain('无权访问');
    await act(async () => guestButton(app.host, '退出此白板').click());
    expect(window.location.search).toBe('');
    expect(app.host.textContent).toContain('当前没有打开的白板。');
    expect(app.readCatalogCalls()).toBe(0);
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
    const state: BoardRoomState = { status: 'online', viewId, canEdit: false, participants: [] };

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
