import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  create,
  fromBinary,
  toBinary,
  type DescMessage,
  type DescMethodUnary,
  type MessageInitShape,
} from '@bufbuild/protobuf';
import {
  BoardCatalogService,
  BoardLifecycleAction,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { FeedbackService } from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import {
  AgentActivityEndReason,
  AgentActivityPhase,
  AgentActivityRejection,
  BoardRoomService,
  type ChangeAgentActivityRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import {
  BoardSharingService,
  SharingRejectionReason,
  SharingRole,
  SharingScope,
  type UpdateBoardSharingRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/sharing/service';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { pngImage } from '../fixtures/board-image-bytes.js';
import { rejectSharingReceipts, storedSharingCredentials } from '../support/sharing-database.js';
import {
  actorHeader,
  callWhiteboard,
  sendWhiteboardRequest,
} from '../support/whiteboard-client.js';
import { agentPrincipalPrefix, useSharingTestServer } from './sharing-test-server.js';

type Scope = 'local' | 'lan';
type SharingOperation = NonNullable<
  MessageInitShape<typeof UpdateBoardSharingRequestSchema>['operation']
>;

const server = useSharingTestServer();
const owner = 'sharing-owner';
const stranger = 'sharing-stranger';
const type = 'application/protobuf';
const timeout = 5_000;
const { createBoard, listBoards, manageBoard } = BoardCatalogService.method;
const { getBoardScene, getObjectPayloads } = WhiteboardService.method;
const { applyFeedback, listThreads } = FeedbackService.method;
const { attachBoardImage } = BoardEditService.method;
const share = BoardSharingService.method;
const { updateBoardPresence, leaveBoardPresence } = BoardRoomService.method;
const { changeAgentActivity, getBoardRoom } = BoardRoomService.method;

async function board(label: string, actor = owner) {
  const { receipt } = await callWhiteboard(server.owner, actor, createBoard, {
    commandId: label,
    title: label,
  });
  assert.ok(receipt?.outcome.case === 'created');

  return receipt.outcome.value.boardId;
}

async function view(boardId: string) {
  const response = await callWhiteboard(server.owner, owner, share.getBoardSharing, { boardId });
  assert.ok(response.sharing);

  return response.sharing;
}

async function update(
  boardId: string,
  commandId: string,
  expectedVersion: bigint,
  operation: SharingOperation,
) {
  const response = await callWhiteboard(server.owner, owner, share.updateBoardSharing, {
    boardId,
    commandId,
    expectedVersion,
    operation,
  });
  assert.ok(response.receipt);

  return response.receipt;
}

function scopeOperation(scope: SharingScope): SharingOperation {
  return { case: 'setScope', value: { scope } };
}

function tokenFrom(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('invite');
  assert.ok(token);

  return token;
}

async function invitation(boardId: string, role: SharingRole) {
  const url = (await view(boardId)).links.find((link) => link.role === role)?.url;
  assert.ok(url);

  return tokenFrom(url);
}

function sendGuest<Input extends DescMessage>(
  scope: Scope,
  method: DescMethodUnary<Input>,
  input: MessageInitShape<Input>,
  init?: HeadersInit,
) {
  const headers = new Headers(init);
  headers.set('content-type', type);
  const path = '/' + method.parent.typeName + '/' + method.name;

  return fetch(new URL(path, server.guest(scope)), {
    method: 'POST',
    headers,
    body: Buffer.from(toBinary(method.input, create(method.input, input))),
    signal: AbortSignal.timeout(timeout),
  });
}

async function decodeGuest<Output extends DescMessage>(response: Response, schema: Output) {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe(type);

  return fromBinary(schema, new Uint8Array(await response.arrayBuffer()));
}

async function join(boardId: string, invitationToken: string, name: string, scope: Scope = 'lan') {
  const request = { boardId, invitationToken };
  const inspected = await sendGuest(scope, share.inspectBoardInvitation, request);
  const header = inspected.headers.get('set-cookie');
  expect(header).toMatch(/^luming-studio-ii-guest=[\w-]{43}; Path=\/; HttpOnly; SameSite=Strict;/u);
  assert.ok(header);
  const cookie = header.split(';')[0];
  assert.ok(cookie);
  const information = await decodeGuest(inspected, share.inspectBoardInvitation.output);
  const reply = await sendGuest(scope, share.joinBoardInvitation, { ...request, name }, { cookie });
  const result = await decodeGuest(reply, share.joinBoardInvitation.output);
  assert.ok(result.session);
  expect(reply.headers.get('set-cookie')).toBeNull();

  return { session: result.session, cookie, information };
}

function guestScene(boardId: string, cookie: string, scope: Scope = 'lan') {
  return sendGuest(scope, getBoardScene, { boardId }, { cookie });
}

function addImage(boardId: string) {
  return callWhiteboard(server.owner, owner, attachBoardImage, {
    boardId,
    commandId: 'attach-image',
    objectId: 'drawing',
    displayName: 'Drawing.png',
    geometry: { x: 0, y: 0, width: 200, height: 300 },
    content: pngImage,
  });
}

function guestImage(boardId: string, cookie: string) {
  return fetch(
    new URL('/studio-archive-assets/' + boardId + '/image-drawing', server.guest('lan')),
    {
      headers: { cookie },
      signal: AbortSignal.timeout(timeout),
    },
  );
}

test('publishes only a versioned owner-authorized sharing change and replays its original receipt', async () => {
  const boardId = await board('Scope');
  const initial = await view(boardId);
  expect(initial).toMatchObject({
    enabled: false,
    version: 0n,
    role: SharingRole.OWNER,
    memberUrl: '',
  });
  const operation = scopeOperation(SharingScope.LAN);
  const base = { boardId, commandId: 'publish', expectedVersion: 0n, operation };
  const denied = await callWhiteboard(server.owner, stranger, share.updateBoardSharing, base);
  expect(denied.receipt?.outcome.value).toMatchObject({ reason: SharingRejectionReason.FORBIDDEN });
  const stale = await update(boardId, 'publish', 4n, operation);
  expect(stale.outcome.value).toMatchObject({ reason: SharingRejectionReason.VERSION_CHANGED });
  expect(server.activated).toEqual([]);

  const applied = await update(boardId, 'publish', 0n, operation);
  expect(applied.outcome).toMatchObject({ case: 'applied', value: { version: 1n } });
  expect(server.activated).toEqual(['lan']);
  const started = await view(boardId);
  expect(started.memberUrl).toBe(server.guest('lan').href + '?board=' + boardId);
  expect(started.links.every((link) => tokenFrom(link.url).length > 40)).toBe(true);

  await server.restart();
  expect(await update(boardId, 'publish', 0n, operation)).toEqual(applied);
  const saved = await callWhiteboard(server.owner, owner, share.getBoardSharingReceipt, {
    boardId,
    commandId: 'publish',
  });
  expect(saved.receipt).toEqual(applied);
  expect(server.activated).toEqual(['lan']);
  const reuse = await update(boardId, 'publish', 1n, scopeOperation(SharingScope.LOCAL));
  expect(reuse.outcome.value).toMatchObject({ reason: SharingRejectionReason.COMMAND_ID_REUSE });
  expect(server.errors).toEqual([]);
});

test('keeps invitations local until the owner opens LAN, and denies catalog and owner credentials on the guest listener', async () => {
  const boardId = await board('Local only');
  const localOnly = await update(boardId, 'local', 0n, scopeOperation(SharingScope.LOCAL));
  expect(localOnly.outcome.case).toBe('applied');
  const issued = await invitation(boardId, SharingRole.VIEWER);
  const request = { boardId, invitationToken: issued };
  const lan = await sendGuest('lan', share.inspectBoardInvitation, request);
  const unavailable = await decodeGuest(lan, share.inspectBoardInvitation.output);
  expect(unavailable.rejection).toBe(SharingRejectionReason.INVITATION_UNAVAILABLE);
  expect(lan.headers.get('set-cookie')).toBeNull();
  const { cookie } = await join(boardId, issued, 'Local guest', 'local');
  expect((await guestScene(boardId, cookie, 'local')).status).toBe(200);
  expect((await guestScene(boardId, cookie)).status).toBe(403);
  expect(
    (await sendGuest('lan', getBoardScene, { boardId }, { [actorHeader]: owner })).status,
  ).toBe(401);
  expect((await sendGuest('local', listBoards, { pageSize: 10 }, { cookie })).status).toBe(404);
  expect(
    (
      await sendGuest(
        'local',
        share.getBoardSharing,
        { boardId },
        { cookie, origin: 'http://other.test' },
      )
    ).status,
  ).toBe(403);

  await update(boardId, 'lan', 1n, scopeOperation(SharingScope.LAN));
  expect((await guestScene(boardId, cookie)).status).toBe(200);
  await update(boardId, 'local-after-lan', 2n, scopeOperation(SharingScope.LOCAL));
  expect((await guestScene(boardId, cookie)).status).toBe(403);
  expect((await guestScene(boardId, cookie, 'local')).status).toBe(200);
});

test('scopes cookie sessions, access tiers and asset bytes to each whiteboard', async () => {
  const boardId = await board('Team board');
  const foreignId = await board('Another board');
  await update(boardId, 'publish', 0n, scopeOperation(SharingScope.LAN));
  await update(foreignId, 'publish', 0n, scopeOperation(SharingScope.LAN));
  const viewerToken = await invitation(boardId, SharingRole.VIEWER);
  const { session, cookie } = await join(boardId, viewerToken, 'Viewer');
  const { cookie: editorCookie } = await join(
    boardId,
    await invitation(boardId, SharingRole.EDITOR),
    'Editor',
  );
  const { cookie: commenterCookie } = await join(
    boardId,
    await invitation(boardId, SharingRole.COMMENTER),
    'Commenter',
  );
  expect(session).toMatchObject({ boardId, name: 'Viewer', canEdit: false, canComment: false });
  const reply = await sendGuest('lan', share.getBoardSharing, { boardId }, { cookie });
  const guest = await decodeGuest(reply, share.getBoardSharing.output);
  expect(guest.sharing?.links.map(({ role }) => role)).toEqual([SharingRole.VIEWER]);
  expect(guest.sharing?.members).toEqual([]);
  const foreignInvite = await sendGuest('lan', share.inspectBoardInvitation, {
    boardId: foreignId,
    invitationToken: viewerToken,
  });
  expect((await decodeGuest(foreignInvite, share.inspectBoardInvitation.output)).rejection).toBe(
    SharingRejectionReason.INVITATION_UNAVAILABLE,
  );
  expect((await guestScene(foreignId, cookie)).status).toBe(403);

  const image = {
    boardId,
    commandId: 'attach-image',
    objectId: 'drawing',
    displayName: 'Drawing.png',
    geometry: { x: 0, y: 0, width: 200, height: 300 },
    content: pngImage,
  };
  const editDenied = await sendGuest('lan', attachBoardImage, image, { cookie: commenterCookie });
  expect(editDenied.status).toBe(403);
  const editAllowed = await sendGuest('lan', attachBoardImage, image, { cookie: editorCookie });
  expect((await decodeGuest(editAllowed, attachBoardImage.output)).receipt?.outcome.case).toBe(
    'applied',
  );
  expect((await addImage(foreignId)).receipt?.outcome.case).toBe('applied');

  const authorized = await guestImage(boardId, cookie);
  expect(authorized.status).toBe(200);
  expect(authorized.headers.get('cache-control')).toBe('private, no-store');
  expect(new Uint8Array(await authorized.arrayBuffer())).toEqual(pngImage);
  expect((await guestImage(foreignId, cookie)).status).toBe(403);

  const feedback = {
    boardId,
    commandId: 'comment-1',
    operation: {
      case: 'create' as const,
      value: {
        text: 'Shared feedback',
        anchor: { target: { case: 'boardPoint' as const, value: { x: 10, y: 20 } } },
      },
    },
  };
  const roomBefore = await decodeGuest(
    await sendGuest('lan', getBoardRoom, { boardId }, { cookie }),
    getBoardRoom.output,
  );
  expect(roomBefore.event?.payload).toMatchObject({
    case: 'snapshot',
    value: { feedbackVersion: 0n },
  });
  expect(roomBefore.event?.payload.value).not.toHaveProperty('suggestionsVersion');
  expect((await sendGuest('lan', applyFeedback, feedback, { cookie })).status).toBe(403);
  const commented = await sendGuest('lan', applyFeedback, feedback, { cookie: commenterCookie });
  expect((await decodeGuest(commented, applyFeedback.output)).receipt?.outcome.case).toBe(
    'applied',
  );
  const replay = await sendGuest('lan', applyFeedback, feedback, { cookie: commenterCookie });
  expect((await decodeGuest(replay, applyFeedback.output)).receipt?.outcome.case).toBe('applied');
  const roomAfter = await decodeGuest(
    await sendGuest('lan', getBoardRoom, { boardId }, { cookie }),
    getBoardRoom.output,
  );
  expect(roomAfter.event?.payload).toMatchObject({
    case: 'snapshot',
    value: { feedbackVersion: 1n },
  });
  expect(roomAfter.event?.payload.value).not.toHaveProperty('suggestionsVersion');
  expect(roomAfter.event?.sequence).toBe((roomBefore.event?.sequence ?? 0n) + 1n);
  const externalThreads = await sendGuest(
    'lan',
    listThreads,
    { boardId, pageSize: 10 },
    { cookie },
  );
  expect((await decodeGuest(externalThreads, listThreads.output)).threads).toMatchObject([
    {
      first: {
        authorName: 'Commenter',
        authoredByViewer: false,
        text: feedback.operation.value.text,
      },
    },
  ]);
  const member = (await view(boardId)).members.find(({ name }) => name === 'Commenter');
  expect(member?.online).toBe(false);
  expect(member?.lastSeenAtMillis).toBeGreaterThan(0n);

  const stored = storedSharingCredentials(server.databasePath);
  expect(stored.browsers).toHaveLength(3);
  for (const { token_hash } of stored.browsers) {
    expect(token_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(cookie).not.toContain(String(token_hash));
  }
  expect(stored.invitations.every(({ seed }) => !viewerToken.includes(String(seed)))).toBe(true);
});

test('revokes active sessions, rejects old links, and persists membership across process restarts', async () => {
  const boardId = await board('Membership');
  await update(boardId, 'publish', 0n, scopeOperation(SharingScope.LAN));
  const token = await invitation(boardId, SharingRole.VIEWER);
  const { cookie, session } = await join(boardId, token, 'Approved guest');
  const { actorId } = session;
  const repeated = await sendGuest(
    'lan',
    share.joinBoardInvitation,
    {
      boardId,
      invitationToken: token,
      name: 'New display name',
    },
    { cookie },
  );
  expect((await decodeGuest(repeated, share.joinBoardInvitation.output)).session).toEqual(session);

  const duplicate = await sendGuest('lan', share.joinBoardInvitation, {
    boardId,
    invitationToken: token,
    name: 'approved guest',
  });
  expect((await decodeGuest(duplicate, share.joinBoardInvitation.output)).rejection).toBe(
    SharingRejectionReason.NAME_TAKEN,
  );
  await server.restart();
  expect((await guestScene(boardId, cookie)).status).toBe(200);
  await update(boardId, 'remove', 1n, { case: 'removeMember', value: { actorId } });
  expect((await guestScene(boardId, cookie)).status).toBe(403);
  const blocked = await sendGuest(
    'lan',
    share.joinBoardInvitation,
    {
      boardId,
      invitationToken: token,
      name: 'Approved guest',
    },
    { cookie },
  );
  expect((await decodeGuest(blocked, share.joinBoardInvitation.output)).rejection).toBe(
    SharingRejectionReason.MEMBER_UNAVAILABLE,
  );

  await update(boardId, 'restore', 2n, {
    case: 'restoreMember',
    value: { actorId, role: SharingRole.EDITOR },
  });
  expect((await guestScene(boardId, cookie)).status).toBe(200);
  const scene = await decodeGuest(await guestScene(boardId, cookie), getBoardScene.output);
  expect(scene.scene?.access?.canEdit).toBe(true);
  await update(boardId, 'rotate-editors', 3n, {
    case: 'resetInvitation',
    value: { role: SharingRole.EDITOR },
  });
  expect((await guestScene(boardId, cookie)).status).toBe(403);
  await update(boardId, 'stop', 4n, { case: 'stop', value: {} });
  const stopped = await view(boardId);
  expect(stopped).toMatchObject({ enabled: false, memberUrl: '', version: 5n });
  expect(stopped.links.every(({ url }) => url === '')).toBe(true);
  await update(boardId, 'reopen', 5n, scopeOperation(SharingScope.LAN));
  const expired = await sendGuest('lan', share.inspectBoardInvitation, {
    boardId,
    invitationToken: token,
  });
  expect((await decodeGuest(expired, share.inspectBoardInvitation.output)).rejection).toBe(
    SharingRejectionReason.INVITATION_UNAVAILABLE,
  );
  expect((await guestScene(boardId, cookie)).status).toBe(403);
});

test('restores only the authenticated member of a valid invitation in the current board', async () => {
  const boardId = await board('Known browser');
  const foreignBoard = await board('Other known browser');
  await update(boardId, 'publish', 0n, scopeOperation(SharingScope.LAN));
  await update(foreignBoard, 'publish', 0n, scopeOperation(SharingScope.LAN));
  const invitationToken = await invitation(boardId, SharingRole.VIEWER);
  const { session, cookie } = await join(boardId, invitationToken, 'Known guest');
  const method = share.inspectBoardInvitation;
  const request = { boardId, invitationToken };
  const returning = await sendGuest('lan', method, request, { cookie });
  expect(returning.headers.get('set-cookie')).toBeNull();
  const restored = await decodeGuest(returning, method.output);
  expect(restored.session).toEqual(session);
  expect(restored.invitation).toBeUndefined();

  const foreign = {
    boardId: foreignBoard,
    invitationToken: await invitation(foreignBoard, SharingRole.VIEWER),
  };
  const other = await decodeGuest(
    await sendGuest('lan', method, foreign, { cookie }),
    method.output,
  );
  expect(other.invitation?.boardId).toBe(foreignBoard);
  expect(other.session).toBeUndefined();

  await update(boardId, 'rotate', 1n, {
    case: 'resetInvitation',
    value: { role: SharingRole.VIEWER },
  });
  const stale = await decodeGuest(
    await sendGuest('lan', method, request, { cookie }),
    method.output,
  );
  expect(stale.session).toBeUndefined();
  expect(stale.rejection).toBe(SharingRejectionReason.INVITATION_UNAVAILABLE);
});

test('keeps sharing membership and room presence distinct in the owner projection', async () => {
  const boardId = await board('Sharing presence');
  await update(boardId, 'publish', 0n, scopeOperation(SharingScope.LAN));
  const { cookie, session } = await join(
    boardId,
    await invitation(boardId, SharingRole.VIEWER),
    'Online guest',
  );
  expect(await view(boardId)).toMatchObject({
    ownerDisplayName: 'Studio Test Owner',
    members: [{ actorId: session.actorId, active: true, online: false }],
  });

  const viewId = 'guest-view';
  const joined = await sendGuest(
    'lan',
    updateBoardPresence,
    { boardId, viewId, sequence: 1n },
    { cookie },
  );
  expect((await decodeGuest(joined, updateBoardPresence.output)).accepted).toBe(true);
  expect((await view(boardId)).members).toMatchObject([{ actorId: session.actorId, online: true }]);

  const localView = { boardId, viewId: 'owner-tab', sequence: 1n };
  expect((await callWhiteboard(server.owner, owner, updateBoardPresence, localView)).accepted).toBe(
    true,
  );
  const ownerRoom = await callWhiteboard(server.owner, owner, getBoardRoom, { boardId });
  const guestRoom = await decodeGuest(
    await sendGuest('lan', getBoardRoom, { boardId }, { cookie }),
    getBoardRoom.output,
  );
  const members = [
    { key: { actorId: session.actorId, viewId }, role: 'viewer', displayName: 'Online guest' },
    {
      key: { actorId: owner, viewId: localView.viewId },
      role: 'owner',
      displayName: 'Studio Test Owner',
    },
  ];
  expect(ownerRoom.event?.payload).toMatchObject({
    case: 'snapshot',
    value: { actorId: owner, participants: members },
  });
  expect(guestRoom.event?.payload).toMatchObject({
    case: 'snapshot',
    value: { actorId: session.actorId, participants: members },
  });

  const guest = await sendGuest('lan', share.getBoardSharing, { boardId }, { cookie });
  const guestSharing = (await decodeGuest(guest, share.getBoardSharing.output)).sharing;
  expect(guestSharing?.ownerDisplayName).toBeUndefined();
  expect(guestSharing?.members).toEqual([]);

  const left = await sendGuest(
    'lan',
    leaveBoardPresence,
    { boardId, viewId, sequence: 2n },
    { cookie },
  );
  expect((await decodeGuest(left, leaveBoardPresence.output)).accepted).toBe(true);
  expect((await view(boardId)).members).toMatchObject([{ active: true, online: false }]);
});

test('authorizes Agent activity separately from viewing and exposes only the scoped temporary projection', async () => {
  const boardId = await board('Agent workspace');
  await update(boardId, 'publish', 0n, scopeOperation(SharingScope.LAN));
  const { cookie } = await join(
    boardId,
    await invitation(boardId, SharingRole.EDITOR),
    'Guest editor',
  );
  const agentActor = agentPrincipalPrefix + owner;
  const target = { boardId, agentId: 'agent-tool-connection', taskId: 'sketch' };
  const bounds = { x: 400, y: 200, width: 3000, height: 2400 };
  const begin: MessageInitShape<typeof ChangeAgentActivityRequestSchema> = {
    ...target,
    action: {
      case: 'begin',
      value: { label: '整理方案', scope: { target: { case: 'area', value: bounds } } },
    },
  };
  expect(
    (await sendWhiteboardRequest(server.owner, owner, changeAgentActivity, begin)).status,
  ).toBe(403);
  expect(
    (
      await sendWhiteboardRequest(
        server.owner,
        agentPrincipalPrefix + stranger,
        changeAgentActivity,
        begin,
      )
    ).status,
  ).toBe(403);
  expect(
    (await sendWhiteboardRequest(server.owner, agentActor, getBoardScene, { boardId })).status,
  ).toBe(403);
  expect((await sendGuest('lan', changeAgentActivity, begin, { cookie })).status).toBe(404);

  const opened = await callWhiteboard(server.owner, agentActor, changeAgentActivity, begin);
  assert.ok(opened.result.case === 'workspace');
  const { generation } = opened.result.value;
  expect(opened.result.value).toMatchObject({
    agentId: target.agentId,
    taskId: target.taskId,
    phase: AgentActivityPhase.PREPARING,
    areas: [{ id: '@area', bounds }],
  });

  const ownerRoom = await callWhiteboard(server.owner, owner, getBoardRoom, { boardId });
  expect(ownerRoom.event?.payload).toMatchObject({
    case: 'snapshot',
    value: { canReleaseAgentActivity: true, agentWorkspaces: [{ generation }] },
  });
  const guestRoom = await sendGuest('lan', getBoardRoom, { boardId }, { cookie });
  expect((await decodeGuest(guestRoom, getBoardRoom.output)).event?.payload).toMatchObject({
    case: 'snapshot',
    value: { canEdit: true, canReleaseAgentActivity: false, agentWorkspaces: [{ generation }] },
  });

  const release = { ...target, action: { case: 'release' as const, value: { generation } } };
  expect(
    (await sendWhiteboardRequest(server.owner, agentActor, changeAgentActivity, release)).status,
  ).toBe(403);
  const ended = await callWhiteboard(server.owner, owner, changeAgentActivity, release);
  expect(ended.result).toMatchObject({
    case: 'ended',
    value: { generation, reason: AgentActivityEndReason.RELEASED },
  });
  const current = await callWhiteboard(server.owner, owner, getBoardRoom, { boardId });
  expect(current.event?.payload).toMatchObject({
    case: 'snapshot',
    value: {
      agentWorkspaces: [
        {
          generation,
          endReason: AgentActivityEndReason.RELEASED,
          areas: [{ id: '@area', active: false }],
        },
      ],
      boardRevision: 0n,
    },
  });

  const late = await callWhiteboard(server.owner, agentActor, changeAgentActivity, begin);
  expect(late.result).toEqual({
    case: 'rejected',
    value: AgentActivityRejection.WORKSPACE_RELEASED,
  });
});

test('keeps idle Agents in the room roster and pushes only the disconnected Agent out', async () => {
  const boardId = await board('Agent online roster');
  const agentActor = agentPrincipalPrefix + owner;
  const original = {
    boardId,
    agentId: 'agent-first',
    taskId: 'scope',
  };
  async function begin(agentId: string, x: number) {
    const { result } = await callWhiteboard(server.owner, agentActor, changeAgentActivity, {
      ...original,
      agentId,
      action: {
        case: 'begin',
        value: {
          label: agentId,
          scope: { target: { case: 'area', value: { x, y: 100, width: 100, height: 100 } } },
        },
      },
    });
    assert.ok(result.case === 'workspace');

    return result.value.generation;
  }
  const generation = await begin(original.agentId, 0);
  await begin('agent-second', 500);
  await callWhiteboard(server.owner, agentActor, changeAgentActivity, {
    ...original,
    action: { case: 'end', value: { generation } },
  });
  const { event } = await callWhiteboard(server.owner, owner, getBoardRoom, { boardId });
  assert.ok(event?.payload.case === 'snapshot');
  expect(event.payload.value.onlineAgents?.agentIds).toEqual([original.agentId, 'agent-second']);
  const disconnect = {
    agentId: original.agentId,
    action: { case: 'disconnect' as const, value: {} },
  };
  expect(
    (await sendWhiteboardRequest(server.owner, owner, changeAgentActivity, disconnect)).status,
  ).toBe(403);
  expect(
    (await callWhiteboard(server.owner, agentActor, changeAgentActivity, disconnect)).result.case,
  ).toBe('disconnected');
  const wait = BoardRoomService.method.waitBoardRoomEvents;
  const { events } = await callWhiteboard(server.owner, owner, wait, {
    boardId,
    viewId: 'owner-view',
    after: { roomInstanceId: event.roomInstanceId, sequence: event.sequence },
  });
  expect(events.map(({ payload }) => payload)).toContainEqual(
    expect.objectContaining({
      case: 'agentWorkspaces',
      value: expect.objectContaining({
        onlineAgents: expect.objectContaining({ agentIds: ['agent-second'] }),
      }),
    }),
  );
});

test('accepts protected Agent read presence without granting a workspace', async () => {
  const boardId = await board('Agent read presence');
  const actor = agentPrincipalPrefix + owner;
  const agentId = 'agent-reader';
  const input = {
    boardId,
    agentId,
    action: { case: 'readPresence' as const, value: { activityId: 'read-one', reading: true } },
  };
  expect(
    (await sendWhiteboardRequest(server.owner, owner, changeAgentActivity, input)).status,
  ).toBe(403);
  expect(
    (
      await sendWhiteboardRequest(
        server.owner,
        agentPrincipalPrefix + stranger,
        changeAgentActivity,
        input,
      )
    ).status,
  ).toBe(403);
  await callWhiteboard(server.owner, actor, changeAgentActivity, input);
  const reading = await callWhiteboard(server.owner, owner, getBoardRoom, { boardId });
  expect(reading.event?.payload).toMatchObject({
    case: 'snapshot',
    value: {
      agentWorkspaces: [],
      onlineAgents: { agentIds: [agentId], readingAgentIds: [agentId] },
    },
  });
  await callWhiteboard(server.owner, actor, changeAgentActivity, {
    ...input,
    action: { ...input.action, value: { ...input.action.value, reading: false } },
  });
  const idle = await callWhiteboard(server.owner, owner, getBoardRoom, { boardId });
  expect(idle.event?.payload).toMatchObject({
    case: 'snapshot',
    value: { agentWorkspaces: [], onlineAgents: { agentIds: [agentId], readingAgentIds: [] } },
  });
});

test('leaves sharing state unchanged if the listener or receipt write fails', async () => {
  const boardId = await board('Rollback');
  const commandId = 'publish';
  const operation = scopeOperation(SharingScope.LAN);
  rejectSharingReceipts(server.databasePath);
  const failed = await sendWhiteboardRequest(server.owner, owner, share.updateBoardSharing, {
    boardId,
    commandId,
    expectedVersion: 0n,
    operation,
  });
  expect(failed.status).toBe(500);
  expect(server.errors).toMatchObject([{ message: 'Injected sharing receipt write failure' }]);
  expect((await view(boardId)).version).toBe(0n);
  expect(storedSharingCredentials(server.databasePath).invitations).toEqual([]);
  const lookup = await callWhiteboard(server.owner, owner, share.getBoardSharingReceipt, {
    boardId,
    commandId,
  });
  expect(lookup.receipt).toBeUndefined();

  server.failActivation();
  const unavailable = await update(boardId, commandId, 0n, operation);
  expect(unavailable.outcome.value).toMatchObject({
    reason: SharingRejectionReason.LAN_UNAVAILABLE,
  });
  expect(server.errors[1]).toMatchObject({ message: 'Could not bind sharing listener.' });
  expect(await view(boardId)).toMatchObject({ enabled: false, version: 0n });
});

test('terminates a LAN room stream when sharing becomes local while keeping its local membership', async () => {
  const boardId = await board('Room scope');
  await update(boardId, 'publish', 0n, scopeOperation(SharingScope.LAN));
  const token = await invitation(boardId, SharingRole.VIEWER);
  const { cookie } = await join(boardId, token, 'Observer');
  const stream = new URL('/studio-room-events', server.guest('lan'));
  stream.searchParams.set('boardId', boardId);
  stream.searchParams.set('viewId', 'guest-room-view');
  const response = await fetch(stream, {
    headers: { cookie, origin: server.guest('lan').origin },
    signal: AbortSignal.timeout(timeout),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');

  await update(boardId, 'local-only', 1n, scopeOperation(SharingScope.LOCAL));
  const events = await response.text();
  expect(events).toContain('"snapshot":');
  expect(events).toContain('"accessLost":');
  expect((await guestScene(boardId, cookie, 'local')).status).toBe(200);
  expect((await guestScene(boardId, cookie)).status).toBe(403);
  expect(server.errors).toEqual([]);
});

test('restores only previously published scopes on live boards after database restart', async () => {
  const lanBoard = await board('LAN');
  const localBoard = await board('Local');
  const stoppedBoard = await board('Stopped');
  expect(server.activeSharingScopes()).toEqual([]);
  await update(lanBoard, 'publish', 0n, scopeOperation(SharingScope.LAN));
  await update(localBoard, 'publish', 0n, scopeOperation(SharingScope.LOCAL));
  await update(stoppedBoard, 'publish', 0n, scopeOperation(SharingScope.LAN));
  await update(stoppedBoard, 'stop', 1n, { case: 'stop', value: {} });
  await server.restart();
  expect(server.activeSharingScopes()).toEqual(['lan', 'local']);

  const { boards } = await callWhiteboard(server.owner, owner, listBoards, { pageSize: 10 });
  const entry = boards.find(({ boardId }) => boardId === lanBoard);
  assert.ok(entry?.entryVersion !== undefined);
  const { receipt } = await callWhiteboard(server.owner, owner, manageBoard, {
    boardId: lanBoard,
    commandId: 'trash-lan-board',
    expectedEntryVersion: entry.entryVersion,
    operation: { case: 'lifecycle', value: BoardLifecycleAction.TRASH },
  });
  expect(receipt?.outcome.case).toBe('changed');
  await server.restart();
  expect(server.activeSharingScopes()).toEqual(['local']);
});

test('denies old guest invitations and Agent reads when the owner can preview a trashed board', async () => {
  const boardId = await board('Trashed board guest boundaries');
  expect((await addImage(boardId)).receipt?.outcome.case).toBe('applied');
  await update(boardId, 'publish-trashed-preview', 0n, scopeOperation(SharingScope.LAN));
  const link = (await view(boardId)).links.find(({ role }) => role === SharingRole.VIEWER);
  assert.ok(link?.url);
  const invitationToken = tokenFrom(link.url);
  const { cookie } = await join(boardId, invitationToken, 'Former viewer');
  expect((await guestScene(boardId, cookie)).status).toBe(200);
  expect((await guestImage(boardId, cookie)).status).toBe(200);

  const { boards } = await callWhiteboard(server.owner, owner, listBoards, { pageSize: 10 });
  const entry = boards.find((item) => item.boardId === boardId);
  assert.ok(entry?.entryVersion !== undefined);
  const { receipt } = await callWhiteboard(server.owner, owner, manageBoard, {
    boardId,
    commandId: 'trash-shared-preview',
    expectedEntryVersion: entry.entryVersion,
    operation: { case: 'lifecycle', value: BoardLifecycleAction.TRASH },
  });
  expect(receipt?.outcome.case).toBe('changed');

  const ownerScene = await callWhiteboard(server.owner, owner, getBoardScene, { boardId });
  expect(ownerScene.scene?.access).toMatchObject({ canEdit: false, trashed: true });
  expect((await guestScene(boardId, cookie)).status).toBe(403);
  expect((await guestImage(boardId, cookie)).status).toBe(403);
  const payloads = { boardId, objectIds: ['drawing'] };
  expect((await sendGuest('lan', getObjectPayloads, payloads, { cookie })).status).toBe(403);
  const invitation = await sendGuest('lan', share.inspectBoardInvitation, {
    boardId,
    invitationToken,
  });
  expect((await decodeGuest(invitation, share.inspectBoardInvitation.output)).rejection).toBe(
    SharingRejectionReason.INVITATION_UNAVAILABLE,
  );
  const agent = agentPrincipalPrefix + owner;
  expect(
    (await sendWhiteboardRequest(server.owner, agent, getBoardScene, { boardId })).status,
  ).toBe(403);
  expect(
    (await sendWhiteboardRequest(server.owner, agent, getObjectPayloads, payloads)).status,
  ).toBe(403);

  const missing = await board('Another empty board');
  const asset = (id: string, actor: string) =>
    fetch(new URL(`/studio-archive-assets/${id}/image-drawing`, server.owner), {
      headers: { [actorHeader]: actor },
      signal: AbortSignal.timeout(timeout),
    });
  expect((await asset(boardId, agent)).status).toBe(403);
  expect((await asset(boardId, owner)).status).toBe(200);
  expect((await asset(missing, owner)).status).toBe(404);
});
