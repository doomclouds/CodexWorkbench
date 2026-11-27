import { act } from 'react';
import { expect, test } from 'vitest';

import { StudioApp, type StudioAppProps } from '../../src/app/index.js';
import type {
  BoardSharingService,
  BoardSharingState,
  SharingCommand,
} from '../../src/data/sharing/index.js';
import { createWhiteboardService } from '../../src/data/whiteboard/index.js';
import { createWhiteboardRpcMock, sampleBoardId } from '../fixtures/whiteboard-rpc.js';
import { createControlFixture } from '../support/render-control.js';

type Navigation = StudioAppProps['navigation'];
type Location = ReturnType<Navigation['read']>;

const localLink = 'http://127.0.0.1:8123/?board=' + sampleBoardId + '#invite=viewer.local';
const lanLink = 'http://studio.local:8123/?board=' + sampleBoardId + '#invite=viewer.lan';
const owner: BoardSharingState = {
  boardId: sampleBoardId,
  enabled: false,
  role: 'owner',
  scope: 'local',
  canEdit: true,
  canComment: true,
  version: 1n,
  members: [],
  links: [],
};

function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll('button')].find(
    (item) => (item.getAttribute('aria-label') ?? item.textContent.trim()) === label,
  );

  if (!found) {
    throw new Error('Missing button ' + label);
  }

  return found;
}

function workbenchFixture(sharingService?: BoardSharingService) {
  const fixture = createControlFixture();
  const copied: string[] = [];
  const routes: Location[] = [];
  let nextCommand = 0;
  const props: StudioAppProps = {
    service: createWhiteboardService(createWhiteboardRpcMock().post),
    catalog: {
      listBoards: async () => ({
        boards: [
          {
            boardId: sampleBoardId,
            title: '发布白板',
            pinned: false,
            canManage: true,
            entryVersion: 1n,
          },
        ],
      }),
      createBoard: async ({ commandId }) => ({
        kind: 'rejected',
        commandId,
        reason: 'invalidTitle',
      }),
      getReceipt: async () => undefined,
    },
    preferences: {
      layout: 'list',
      resolvedTheme: 'dark',
      rememberLayout: () => undefined,
      rememberTheme: () => undefined,
    },
    navigation: {
      read: () => ({ kind: 'workbench' }),
      write: (route) => {
        routes.push(route);
      },
      subscribe: () => () => undefined,
    },
    createCommandId: () => 'copy-workbench-' + ++nextCommand,
    sharingService,
    copyShareLink: async (url) => {
      copied.push(url);
    },
  };

  async function open() {
    await act(async () => fixture.render(<StudioApp {...props} />));
  }

  async function menu() {
    const trigger = button(fixture.host, '管理作品：发布白板');
    Object.defineProperty(trigger, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(700, 70, 40, 40),
    });
    await act(async () => trigger.click());
    return { trigger, action: button(fixture.host, '复制链接') };
  }

  return { ...fixture, open, menu, copied, routes };
}

function shareFixture(state: BoardSharingState, dropFirstReply = false) {
  let sharing = state;
  const updates: SharingCommand[] = [];
  const retries: SharingCommand[] = [];
  const service: BoardSharingService = {
    getBoardSharing: async () => sharing,
    getBoardSharingReceipt: async () => undefined,
    updateBoardSharing: async (command) => {
      updates.push(command);
      if (dropFirstReply) {
        throw new Error('尚未确认原邀请');
      }

      sharing = {
        ...owner,
        enabled: true,
        version: 2n,
        links: [{ role: 'viewer', enabled: true, url: localLink }],
      };

      return {
        kind: 'applied',
        boardId: command.boardId,
        commandId: command.commandId,
        version: sharing.version,
      };
    },
    retryBoardSharing: async (command) => {
      retries.push(command);
      sharing = {
        ...owner,
        enabled: true,
        version: 2n,
        links: [{ role: 'viewer', enabled: true, url: localLink }],
      };

      return {
        kind: 'applied',
        boardId: command.boardId,
        commandId: command.commandId,
        version: sharing.version,
      };
    },
    inspectBoardInvitation: async () => ({ kind: 'rejected', reason: 'invitationUnavailable' }),
    joinBoardInvitation: async () => ({ kind: 'rejected', reason: 'invitationUnavailable' }),
  };

  return { service, updates, retries };
}

async function copyFromMenu(app: ReturnType<typeof workbenchFixture>) {
  const entry = await app.menu();
  await act(async () => entry.action.click());
  return entry.trigger;
}

test('copies an existing LAN viewer invite without changing the sharing scope', async () => {
  const sharing = shareFixture({
    ...owner,
    enabled: true,
    scope: 'lan',
    links: [
      { role: 'editor', enabled: true, url: 'http://studio.local/editor' },
      { role: 'viewer', enabled: true, url: lanLink },
    ],
  });
  const app = workbenchFixture(sharing.service);
  try {
    await app.open();
    const trigger = await copyFromMenu(app);
    expect(app.copied).toEqual([lanLink]);
    expect(app.host.textContent).toContain('链接已复制。');
    expect(app.routes).toEqual([]);
    expect(sharing.updates).toEqual([]);
    expect(document.activeElement).toBe(trigger);
  } finally {
    app.dispose();
  }
});

test('initializes only local sharing on explicit request and retries the original command when unknown', async () => {
  const sharing = shareFixture(owner, true);
  const app = workbenchFixture(sharing.service);

  try {
    await app.open();
    expect(sharing.updates).toEqual([]);
    await copyFromMenu(app);
    expect(app.host.querySelector('[role="alert"]')?.textContent).toContain('尚未确认原邀请');
    expect(app.copied).toEqual([]);
    expect(sharing.updates).toEqual([
      {
        boardId: sampleBoardId,
        commandId: 'copy-workbench-1',
        expectedVersion: 1n,
        operation: { kind: 'setScope', scope: 'local' },
      },
    ]);

    await copyFromMenu(app);
    expect(sharing.updates).toHaveLength(1);
    expect(sharing.retries).toEqual(sharing.updates);
    expect(app.copied).toEqual([localLink]);
  } finally {
    app.dispose();
  }
});

test('opens the share settings for a stopped viewer link without turning it on', async () => {
  const sharing = shareFixture({
    ...owner,
    enabled: true,
    scope: 'lan',
    links: [{ role: 'viewer', enabled: false }],
  });
  const app = workbenchFixture(sharing.service);

  try {
    await app.open();
    await copyFromMenu(app);
    expect(app.routes).toEqual([{ kind: 'whiteboard', boardId: sampleBoardId }]);
    expect(app.host.querySelector('[role="dialog"][aria-label="分享"]')).not.toBeNull();
    expect(sharing.updates).toEqual([]);
    expect(app.copied).toEqual([]);

    await act(async () => button(app.host, '关闭分享').click());
    expect(app.host.querySelector('[role="dialog"][aria-label="分享"]')).toBeNull();
    await act(async () => button(app.host, '返回 Luming Studio').click());
    await act(async () => button(app.host, '打开白板：发布白板').click());
    expect(app.host.querySelector('[role="dialog"][aria-label="分享"]')).toBeNull();
  } finally {
    app.dispose();
  }
});

test('keeps the card command disabled when no sharing port is supplied', async () => {
  const app = workbenchFixture();

  try {
    await app.open();
    const { action } = await app.menu();
    expect(action.disabled).toBe(true);
    await act(async () => action.click());
    expect(app.copied).toEqual([]);
  } finally {
    app.dispose();
  }
});
