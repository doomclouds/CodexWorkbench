import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { DescMessage, MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardSharingService,
  SharingRejectionReason as WireRejection,
  SharingRole as WireRole,
  SharingScope as WireScope,
} from '@codexworkbench/luming-studio-ii-contracts/sharing/service';
import { expect, test } from 'vitest';
import { createBoardSharingService, type SharingCommand } from '../../src/data/sharing/index.js';

const {
  getBoardSharing,
  updateBoardSharing,
  getBoardSharingReceipt,
  inspectBoardInvitation,
  joinBoardInvitation,
} = BoardSharingService.method;
const boardId = 'sharing-board';
const commandId = 'change-invite';
const ownerVersion = 9_007_199_254_740_993n;
const memberUrl = 'https://example.test:8123/?board=sharing-board';
const inviteUrl = memberUrl + '#invite=viewer.test-token';
const invitation = { boardId, invitationToken: 'viewer.test-token' };
const command = {
  boardId,
  commandId,
  expectedVersion: ownerVersion,
  operation: { kind: 'setInvitation', role: 'viewer', enabled: true },
} as const satisfies SharingCommand;
const applied = {
  boardId,
  commandId,
  outcome: { case: 'applied', value: { version: ownerVersion + 1n } },
} as const;
const appliedResult = { kind: 'applied', boardId, commandId, version: ownerVersion + 1n };
const roster = [
  { actorId: 'owner', role: WireRole.OWNER, name: '房主', active: true },
  { actorId: 'visitor', role: WireRole.VIEWER, name: '访客', removed: true },
];
const links = [
  { role: WireRole.VIEWER, enabled: true, url: inviteUrl },
  { role: WireRole.EDITOR, enabled: false },
];
const ownerState = {
  boardId,
  enabled: true,
  scope: WireScope.LAN,
  version: ownerVersion,
  role: WireRole.OWNER,
  canEdit: true,
  canComment: true,
  members: roster,
  links,
  memberUrl,
} as const;

function reply<T extends DescMessage>(schema: T, value: MessageInitShape<T>): Promise<Uint8Array> {
  return Promise.resolve(toBinary(schema, create(schema, value)));
}

test('reads the owner status through the real wire and preserves large access revisions', async () => {
  const controller = new AbortController();
  const service = createBoardSharingService((path, bytes, signal) => {
    expect(path).toBe('/luming.studio.v1.BoardSharingService/GetBoardSharing');
    expect(fromBinary(getBoardSharing.input, bytes).boardId).toBe(boardId);
    expect(signal).toBe(controller.signal);

    return reply(getBoardSharing.output, { sharing: ownerState });
  });

  await expect(service.getBoardSharing(boardId, controller.signal)).resolves.toEqual({
    boardId,
    enabled: true,
    scope: 'lan',
    version: ownerVersion,
    role: 'owner',
    canEdit: true,
    canComment: true,
    links: [
      { role: 'viewer', enabled: true, url: inviteUrl },
      { role: 'editor', enabled: false, url: undefined },
    ],
    members: [
      { actorId: 'owner', role: 'owner', name: '房主', removed: false, active: true },
      { actorId: 'visitor', role: 'viewer', name: '访客', removed: true, active: false },
    ],
    memberUrl,
  });
});

test('shows a visitor only invitations permitted by the current role and no management roster', async () => {
  const sharing = {
    ...ownerState,
    role: WireRole.VIEWER,
    canEdit: false,
    canComment: false,
    links,
  };
  const service = createBoardSharingService(() => reply(getBoardSharing.output, { sharing }));

  await expect(service.getBoardSharing(boardId)).resolves.toMatchObject({
    role: 'viewer',
    canEdit: false,
    canComment: false,
    links: [{ role: 'viewer', enabled: true, url: inviteUrl }],
    members: [],
  });
});

test.each([
  { boardId: 'different-board' },
  { version: undefined },
  { role: WireRole.UNSPECIFIED },
  { role: WireRole.VIEWER, canEdit: true },
  { memberUrl: memberUrl + '&invite=viewer.test-token' },
  { links: [{ role: WireRole.VIEWER, enabled: true, url: 'javascript:alert(1)' }] },
  {
    links: [
      {
        role: WireRole.VIEWER,
        enabled: true,
        url: inviteUrl.replace('sharing-board', 'other-board'),
      },
    ],
  },
])('rejects invalid or misdirected sharing status %o', async (patch) => {
  const sharing = { ...ownerState, ...patch };
  const service = createBoardSharingService(() => reply(getBoardSharing.output, { sharing }));

  await expect(service.getBoardSharing(boardId)).rejects.toThrow('分享');
});

test('checks the original receipt after a lost write response', async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  const service = createBoardSharingService((path, bytes, signal) => {
    expect(signal).toBe(controller.signal);
    calls.push(path);
    if (path.endsWith('/UpdateBoardSharing')) {
      expect(fromBinary(updateBoardSharing.input, bytes)).toMatchObject({
        boardId,
        commandId,
        expectedVersion: ownerVersion,
        operation: { case: 'setInvitation', value: { role: WireRole.VIEWER, enabled: true } },
      });

      return Promise.reject(new Error('lost sharing response'));
    }

    expect(path).toBe('/luming.studio.v1.BoardSharingService/GetBoardSharingReceipt');
    expect(fromBinary(getBoardSharingReceipt.input, bytes)).toMatchObject({ boardId, commandId });

    return reply(getBoardSharingReceipt.output, { receipt: applied });
  });

  await expect(service.updateBoardSharing(command, controller.signal)).resolves.toEqual(
    appliedResult,
  );
  expect(calls).toHaveLength(2);
});

const administration = [
  [
    { kind: 'setScope', scope: 'lan' },
    { case: 'setScope', value: { scope: WireScope.LAN } },
  ],
  [{ kind: 'stop' }, { case: 'stop', value: {} }],
  [
    { kind: 'resetInvitation', role: 'editor' },
    { case: 'resetInvitation', value: { role: WireRole.EDITOR } },
  ],
  [
    { kind: 'changeMemberRole', actorId: 'visitor', role: 'commenter' },
    { case: 'changeMemberRole', value: { actorId: 'visitor', role: WireRole.COMMENTER } },
  ],
  [
    { kind: 'removeMember', actorId: 'visitor' },
    { case: 'removeMember', value: { actorId: 'visitor' } },
  ],
  [
    { kind: 'restoreMember', actorId: 'visitor', role: 'viewer' },
    { case: 'restoreMember', value: { actorId: 'visitor', role: WireRole.VIEWER } },
  ],
  [
    { kind: 'forgetMember', actorId: 'visitor' },
    { case: 'forgetMember', value: { actorId: 'visitor' } },
  ],
] as const;

test.each(administration)(
  'encodes sharing administration %o with explicit zero revision',
  async (operation, wire) => {
    const service = createBoardSharingService((path, body) => {
      expect(path).toBe('/luming.studio.v1.BoardSharingService/UpdateBoardSharing');
      expect(fromBinary(updateBoardSharing.input, body)).toMatchObject({
        boardId,
        commandId,
        expectedVersion: 0n,
        operation: wire,
      });

      return reply(updateBoardSharing.output, {
        receipt: {
          boardId,
          commandId,
          outcome: { case: 'rejected', value: { reason: WireRejection.FORBIDDEN } },
        },
      });
    });

    await expect(
      service.updateBoardSharing({ ...command, operation, expectedVersion: 0n }),
    ).resolves.toEqual({
      kind: 'rejected',
      boardId,
      commandId,
      reason: 'forbidden',
    });
  },
);

test('queries before retry and replays the original bytes only when no receipt exists', async () => {
  const attempts: Uint8Array[] = [];
  const calls: string[] = [];
  const service = createBoardSharingService((path, body) => {
    const method = path.split('/').at(-1);
    if (!method) {
      throw new Error('Missing sharing method');
    }

    calls.push(method);
    if (method === updateBoardSharing.name) {
      attempts.push(body);

      return attempts.length === 1
        ? Promise.reject(new Error('lost sharing response'))
        : reply(updateBoardSharing.output, { receipt: applied });
    }

    expect(method).toBe(getBoardSharingReceipt.name);
    expect(fromBinary(getBoardSharingReceipt.input, body)).toMatchObject({ boardId, commandId });

    return reply(getBoardSharingReceipt.output, {});
  });

  await expect(service.updateBoardSharing(command)).rejects.toThrow('尚未确认');
  await expect(service.retryBoardSharing(command)).resolves.toEqual(appliedResult);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(calls).toEqual([
    updateBoardSharing.name,
    getBoardSharingReceipt.name,
    getBoardSharingReceipt.name,
    updateBoardSharing.name,
  ]);
});

test('never accepts a receipt belonging to a different command', async () => {
  const service = createBoardSharingService(() =>
    reply(getBoardSharingReceipt.output, {
      receipt: { ...applied, commandId: 'different-command' },
    }),
  );

  await expect(service.getBoardSharingReceipt(boardId, commandId)).rejects.toThrow('回执');
});

test('does not check or replay a command after its lifecycle has been canceled', async () => {
  const controller = new AbortController();
  const accepted: string[] = [];
  const service = createBoardSharingService((path) => {
    accepted.push(path);
    controller.abort();

    return Promise.reject(new Error('The first post was interrupted'));
  });

  await expect(service.updateBoardSharing(command, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  await expect(service.retryBoardSharing(command, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(accepted).toEqual(['/luming.studio.v1.BoardSharingService/UpdateBoardSharing']);
});

test('ignores a status returned by a transport after the caller left the board', async () => {
  const controller = new AbortController();
  const service = createBoardSharingService(() => {
    controller.abort();

    return reply(getBoardSharing.output, { sharing: ownerState });
  });

  await expect(service.getBoardSharing(boardId, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
});

test('decodes invitation rejection and a joined guest from typed responses without exposing the invitation token', async () => {
  const service = createBoardSharingService((path, body) => {
    if (path.endsWith('/InspectBoardInvitation')) {
      expect(fromBinary(inspectBoardInvitation.input, body)).toMatchObject(invitation);

      return reply(inspectBoardInvitation.output, {
        rejection: WireRejection.INVITATION_UNAVAILABLE,
      });
    }

    expect(path).toBe('/luming.studio.v1.BoardSharingService/JoinBoardInvitation');
    expect(fromBinary(joinBoardInvitation.input, body)).toMatchObject({
      ...invitation,
      name: '同事',
    });

    return reply(joinBoardInvitation.output, {
      session: {
        boardId,
        actorId: 'colleague',
        name: '同事',
        role: WireRole.COMMENTER,
        version: 0n,
        canEdit: false,
        canComment: true,
      },
    });
  });

  await expect(service.inspectBoardInvitation(invitation)).resolves.toEqual({
    kind: 'rejected',
    reason: 'invitationUnavailable',
  });
  await expect(service.joinBoardInvitation({ ...invitation, name: '同事' })).resolves.toEqual({
    kind: 'joined',
    session: {
      boardId,
      actorId: 'colleague',
      name: '同事',
      role: 'commenter',
      version: 0n,
      canEdit: false,
      canComment: true,
    },
  });
});

test('rejects a joined session with owner privileges or a different board', async () => {
  const guest = {
    boardId: 'other-board',
    actorId: 'owner',
    name: '房主',
    role: WireRole.OWNER,
    canEdit: true,
    canComment: true,
    version: 0n,
  };
  const service = createBoardSharingService(() =>
    reply(joinBoardInvitation.output, { session: guest }),
  );

  await expect(service.joinBoardInvitation({ ...invitation, name: '同事' })).rejects.toThrow(
    '加入',
  );
});
