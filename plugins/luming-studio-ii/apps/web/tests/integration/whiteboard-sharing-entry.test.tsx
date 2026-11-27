import { act } from 'react';
import { expect, test } from 'vitest';

import { WhiteboardApp } from '../../src/app/index.js';
import type {
  BoardSharingService,
  BoardSharingState,
  BoardInvitationJoin,
  SharingCommand,
  SharingGuestSession,
} from '../../src/data/sharing/index.js';
import {
  createWhiteboardService,
  type ExportBoard,
  type ExportBoardFile,
  type ExportBoardRequest,
} from '../../src/data/whiteboard/index.js';
import { GuestJoinSurface } from '../../src/surfaces/guest-join/index.js';
import { createWhiteboardRpcMock, sampleBoardId } from '../fixtures/whiteboard-rpc.js';
import { createControlFixture } from '../support/render-control.js';

const localLink = 'http://127.0.0.1:8123/?board=' + sampleBoardId + '#invite=viewer.local-invite';
const viewerLink = { role: 'viewer', enabled: true, url: localLink } as const;
const owner: BoardSharingState = {
  boardId: sampleBoardId,
  enabled: false,
  scope: 'local',
  version: 0n,
  role: 'owner',
  canEdit: true,
  canComment: true,
  links: [],
  members: [],
};

function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
}

function closeModal(this: HTMLDialogElement) {
  this.removeAttribute('open');
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: closeModal, configurable: true },
  });
}

function button(root: ParentNode, label: string) {
  const match = [...root.querySelectorAll('button')].find(
    (candidate) =>
      (candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()) === label,
  );

  if (!match) {
    throw new Error('Missing button ' + label);
  }

  return match;
}

async function click(element: HTMLButtonElement) {
  await act(async () => {
    element.focus();
    element.click();
  });
}

function provideAnchor(element: HTMLButtonElement) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(720, 40, 80, 32),
  });

  return element;
}

function fixtureService(overrides: Partial<BoardSharingService>): BoardSharingService {
  return {
    getBoardSharing: async () => owner,
    updateBoardSharing: async () => {
      throw new Error('Unexpected sharing write');
    },
    getBoardSharingReceipt: async () => undefined,
    retryBoardSharing: async () => {
      throw new Error('Unexpected sharing retry');
    },
    inspectBoardInvitation: async () => ({ kind: 'rejected', reason: 'invitationUnavailable' }),
    joinBoardInvitation: async () => ({ kind: 'rejected', reason: 'invitationUnavailable' }),
    ...overrides,
  };
}

function appFixture(
  sharingService: BoardSharingService,
  exportBoard?: ExportBoard,
  copyLink?: (url: string) => Promise<void>,
) {
  const fixture = createControlFixture();
  const service = createWhiteboardService(createWhiteboardRpcMock().post);
  const copied: string[] = [];
  const downloads: ExportBoardFile[] = [];
  let nextCommand = 0;

  async function mount() {
    await act(async () =>
      fixture.render(
        <WhiteboardApp
          boardId={sampleBoardId}
          service={service}
          createCommandId={() => 'sharing-' + ++nextCommand}
          sharingService={sharingService}
          copyShareLink={async (url) => {
            await copyLink?.(url);
            copied.push(url);
          }}
          exportBoard={exportBoard}
          downloadExport={(file) => {
            downloads.push(file);
          }}
        />,
      ),
    );

    return provideAnchor(button(fixture.host, '分享'));
  }

  async function open() {
    const trigger = await mount();
    await click(trigger);

    return trigger;
  }

  return { ...fixture, mount, open, copied, downloads };
}

test('shows the current LAN scope before opening share and after changing it', async () => {
  let sharing: BoardSharingState = { ...owner, enabled: true, scope: 'lan' };
  const app = appFixture(
    fixtureService({
      getBoardSharing: async () => sharing,
      updateBoardSharing: async ({ boardId, commandId, operation }) => {
        if (operation.kind !== 'setScope') {
          throw new Error('Unexpected sharing operation');
        }

        sharing = { ...sharing, scope: operation.scope, version: sharing.version + 1n };
        return { kind: 'applied', boardId, commandId, version: sharing.version };
      },
    }),
  );

  try {
    const share = await app.mount();
    expect(share.getAttribute('aria-description')).toBe('局域网共享已开启');
    await click(share);
    await click(provideAnchor(button(app.host, '一般访问权限')));
    await click(button(app.host, '仅这台电脑'));
    await click(button(app.host, '关闭分享'));
    expect(share.hasAttribute('aria-description')).toBe(false);

    await click(share);
    await click(provideAnchor(button(app.host, '一般访问权限')));
    await click(button(app.host, '局域网可访问'));
    await click(button(app.host, '关闭分享'));
    expect(share.getAttribute('aria-description')).toBe('局域网共享已开启');
  } finally {
    app.dispose();
  }
});

test('opens local invitation copying and uses the same panel for the existing revision-pinned export', async () => {
  let sharing = owner;
  const updates: (readonly [SharingCommand, AbortSignal | undefined])[] = [];
  const exports: (readonly [ExportBoardRequest, AbortSignal | undefined])[] = [];
  const update: BoardSharingService['updateBoardSharing'] = async (command, signal) => {
    updates.push([command, signal]);
    sharing = { ...owner, enabled: true, version: 1n, links: [viewerLink] };
    return { kind: 'applied', boardId: command.boardId, commandId: command.commandId, version: 1n };
  };
  const exportBoard: ExportBoard = async (request, signal) => {
    exports.push([request, signal]);
    return {
      kind: 'file',
      file: {
        filename: 'board.svg',
        revision: request.expectedRevision,
        mimeType: 'image/svg+xml',
        content: new TextEncoder().encode('<svg/>'),
      },
    };
  };
  const app = appFixture(
    fixtureService({ getBoardSharing: async () => sharing, updateBoardSharing: update }),
    exportBoard,
  );

  try {
    const share = await app.open();
    await click(button(app.host, '复制仅查看链接'));
    expect(updates).toEqual([
      [
        {
          boardId: sampleBoardId,
          commandId: 'sharing-1',
          expectedVersion: 0n,
          operation: { kind: 'setScope', scope: 'local' },
        },
        expect.any(AbortSignal),
      ],
    ]);
    expect(app.copied).toEqual([localLink]);

    await click(button(app.host, '导出'));
    await click(button(app.host, 'SVG 图片'));
    expect(exports).toEqual([
      [
        { boardId: sampleBoardId, expectedRevision: 0n, format: 'svg', scope: { kind: 'whole' } },
        expect.any(AbortSignal),
      ],
    ]);
    expect(app.downloads).toHaveLength(1);

    await click(button(app.host, '关闭分享'));
    expect(app.host.querySelector('[aria-label="分享与导出"]')).toBeNull();
    expect(document.activeElement).toBe(share);
  } finally {
    app.dispose();
  }
});

test('keeps the original command across panel reopen and queries its receipt on explicit retry', async () => {
  const updates: SharingCommand[] = [];
  const retries: (readonly [SharingCommand, AbortSignal | undefined])[] = [];
  const update: BoardSharingService['updateBoardSharing'] = async (command) => {
    updates.push(command);
    throw new Error('disconnected');
  };
  const retry: BoardSharingService['retryBoardSharing'] = async (command, signal) => {
    retries.push([command, signal]);
    return { kind: 'applied', boardId: command.boardId, commandId: command.commandId, version: 1n };
  };
  const app = appFixture(fixtureService({ updateBoardSharing: update, retryBoardSharing: retry }));

  try {
    const opener = await app.open();
    await click(button(app.host, '复制仅查看链接'));
    expect(app.host.textContent).toContain('分享操作结果未知');
    const [request] = updates;
    await click(button(app.host, '关闭分享'));
    await click(opener);
    await click(button(app.host, '重试原操作'));
    expect(retries).toEqual([[request, expect.any(AbortSignal)]]);
    expect(updates).toHaveLength(1);
    expect(app.copied).toEqual([]);
  } finally {
    app.dispose();
  }
});

test('offers the exact invitation URL for manual copying when the clipboard is unavailable', async () => {
  const current = { ...owner, enabled: true, links: [viewerLink] };
  const service = fixtureService({ getBoardSharing: () => Promise.resolve(current) });
  const app = appFixture(service, undefined, () => Promise.reject(new Error('剪贴板受限')));

  try {
    await app.open();
    const trigger = button(app.host, '复制仅查看链接');
    await click(trigger);
    const input = app.host.querySelector<HTMLInputElement>('dialog[open] input');
    expect(input?.value).toBe(localLink);
    expect(input?.readOnly).toBe(true);
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(localLink.length);
    expect(document.activeElement).toBe(input);

    await click(button(app.host, '关闭'));
    expect(document.activeElement).toBe(trigger);
    expect(app.copied).toEqual([]);
  } finally {
    app.dispose();
  }
});

test('cancels invite reset with its focus restored, then applies member changes by revision', async () => {
  let sharing: BoardSharingState = {
    ...owner,
    enabled: true,
    version: 3n,
    links: [viewerLink, { role: 'commenter', enabled: true }],
    members: [
      { actorId: 'member-a', role: 'viewer', name: '访客甲', active: true, removed: false },
    ],
  };
  const updates: SharingCommand[] = [];
  const service = fixtureService({
    getBoardSharing: async () => sharing,
    updateBoardSharing: async (command) => {
      updates.push(command);
      const { boardId, commandId, operation } = command;
      const [member] = sharing.members;
      if (!member || operation.kind !== 'changeMemberRole') {
        return { kind: 'rejected', boardId, commandId, reason: 'invalidCommand' };
      }

      sharing = { ...sharing, version: 4n, members: [{ ...member, role: operation.role }] };
      return { kind: 'applied', boardId, commandId, version: 4n };
    },
  });
  const app = appFixture(service);

  try {
    await app.open();
    const invite = provideAnchor(button(app.host, '仅查看链接更多操作'));
    await click(invite);
    await click(button(app.host, '重置此链接'));
    expect(app.host.querySelector('dialog[open]')?.textContent).toContain('重置邀请链接？');
    await click(button(app.host, '取消'));
    expect(app.host.querySelector('dialog[open]')).toBeNull();
    expect(document.activeElement).toBe(invite);
    expect(updates).toEqual([]);

    const member = provideAnchor(button(app.host, '访客甲的访问权限'));
    await click(member);
    await click(button(app.host, '可评论'));
    expect(updates).toMatchObject([
      {
        expectedVersion: 3n,
        operation: { kind: 'changeMemberRole', actorId: 'member-a', role: 'commenter' },
      },
    ]);
    expect(button(app.host, '访客甲的访问权限').textContent).toContain('可评论');
  } finally {
    app.dispose();
  }
});

test('keeps viewer sharing limited to server-authorized links', async () => {
  const app = appFixture(
    fixtureService({
      getBoardSharing: async () => ({
        ...owner,
        enabled: true,
        role: 'viewer',
        canEdit: false,
        canComment: false,
        links: [viewerLink],
      }),
    }),
  );

  try {
    await app.open();
    expect(app.host.textContent).not.toContain('一般访问权限');
    expect(
      [...app.host.querySelectorAll('h3')].map(({ textContent }) => textContent),
    ).not.toContain('有权访问的人');
    expect(app.host.querySelector('[aria-label="仅查看链接更多操作"]')).toBeNull();
    await click(button(app.host, '复制仅查看链接'));
    expect(app.copied).toEqual([localLink]);
  } finally {
    app.dispose();
  }
});

test('rejects an old invitation and joins a current one with its authoritative role', async () => {
  const fixture = createControlFixture();
  const inspect: BoardSharingService['inspectBoardInvitation'] = async ({
    boardId,
    invitationToken,
  }) => {
    if (invitationToken === 'retired') {
      return { kind: 'rejected', reason: 'invitationUnavailable' };
    }

    return { kind: 'available', invitation: { boardId, title: '方案白板', role: 'commenter' } };
  };
  const session = {
    boardId: sampleBoardId,
    actorId: 'member-a',
    name: '小林',
    role: 'commenter',
    version: 3n,
    canEdit: false,
    canComment: true,
  } as const;
  const attempts: (readonly [BoardInvitationJoin, AbortSignal | undefined])[] = [];
  const join: BoardSharingService['joinBoardInvitation'] = async (request, signal) => {
    attempts.push([request, signal]);
    return attempts.length === 1
      ? { kind: 'rejected', reason: 'nameTaken' }
      : { kind: 'joined', session };
  };
  const service = fixtureService({ inspectBoardInvitation: inspect, joinBoardInvitation: join });
  const joined: SharingGuestSession[] = [];
  const onJoined = (current: SharingGuestSession) => {
    joined.push(current);
  };

  try {
    await act(async () =>
      fixture.render(
        <GuestJoinSurface
          boardId={sampleBoardId}
          invitationToken="retired"
          service={service}
          onJoined={onJoined}
        />,
      ),
    );
    expect(fixture.host.textContent).toContain('这个邀请链接已失效。');
    expect(attempts).toEqual([]);

    await act(async () =>
      fixture.render(
        <GuestJoinSurface
          boardId={sampleBoardId}
          invitationToken="current"
          service={service}
          onJoined={onJoined}
        />,
      ),
    );
    expect(fixture.host.textContent).toContain('你被邀请评论这块白板。');
    const input = fixture.host.querySelector<HTMLInputElement>('input');
    if (!input) {
      throw new Error('Missing guest name field');
    }

    expect(document.activeElement).toBe(input);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    await act(async () => {
      descriptor?.set?.call(input, '小林');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const submit = button(fixture.host, '打开白板');
    await click(submit);
    expect(fixture.host.textContent).toContain('请换一个名字');
    expect(document.activeElement).toBe(input);
    await click(submit);
    expect(attempts.at(-1)).toEqual([
      { boardId: sampleBoardId, invitationToken: 'current', name: '小林' },
      expect.any(AbortSignal),
    ]);
    expect(joined).toEqual([session]);
  } finally {
    fixture.dispose();
  }
});
