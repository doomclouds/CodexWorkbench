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
import { useSharingTestServer } from './sharing-test-server.js';

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
const { getBoardScene } = WhiteboardService.method;
const { applyFeedback } = FeedbackService.method;
const { attachBoardImage } = BoardEditService.method;
const share = BoardSharingService.method;

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
  expect((await sendGuest('lan', applyFeedback, feedback, { cookie })).status).toBe(403);
  const commented = await sendGuest('lan', applyFeedback, feedback, { cookie: commenterCookie });
  expect((await decodeGuest(commented, applyFeedback.output)).receipt?.outcome.case).toBe(
    'applied',
  );

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
