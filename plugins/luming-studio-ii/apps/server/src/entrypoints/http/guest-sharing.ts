import type { IncomingMessage, ServerResponse } from 'node:http';
import { create, toBinary } from '@bufbuild/protobuf';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { BoardHistoryService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { FeedbackService } from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { BoardRoomService } from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { BoardSharingService } from '@codexworkbench/luming-studio-ii-contracts/sharing/service';
import {
  SharingAccessError,
  validBrowserCredential,
  type GuestSession,
  type SharingScope,
} from '../../modules/sharing/application/index.js';
import { decodeRequest, mediaType, readBody, requireId } from './request.js';
import { protobufContentType, sendProtobuf, sendStatus } from './response.js';
import { roomEventPath } from './room-routes.js';
import { wireRejection, wireRoles, type SharingRoutesOptions } from './share-routes.js';
import type { HttpActor } from './unary-route.js';

export interface GuestHttpOptions {
  readonly scope: SharingScope;
  readonly origin: () => string | undefined;
}

const cookieName = 'luming-studio-ii-guest';
const cookieLifetimeSeconds = 31_536_000;
const invitationBodyLimit = 16 * 1024;

type Access = 'read' | 'edit' | 'comment';
type Method = { readonly parent: { readonly typeName: string }; readonly name: string };

function path(method: Method) {
  return '/' + method.parent.typeName + '/' + method.name;
}

const paths = new Map<string, Access>([
  [path(WhiteboardService.method.getBoardScene), 'read'],
  [path(WhiteboardService.method.getObjectPayloads), 'read'],
  [path(WhiteboardService.method.exportBoard), 'read'],
  [path(WhiteboardService.method.moveObjects), 'edit'],
  [path(WhiteboardService.method.getCommandReceipt), 'edit'],
  [path(BoardEditService.method.editBoardGeometry), 'edit'],
  [path(BoardEditService.method.editObjectContent), 'edit'],
  [path(BoardEditService.method.attachBoardImage), 'edit'],
  [path(BoardEditService.method.attachBoardVideo), 'edit'],
  [path(BoardEditService.method.uploadBoardDocumentImage), 'edit'],
  [path(BoardEditService.method.reverseBoardEdit), 'edit'],
  [path(BoardEditService.method.getBoardEditReceipt), 'edit'],
  [path(BoardHistoryService.method.listBoardVersions), 'read'],
  [path(BoardHistoryService.method.getBoardVersionScene), 'read'],
  [path(BoardHistoryService.method.getBoardVersionPayloads), 'read'],
  [path(BoardHistoryService.method.exportBoardVersion), 'read'],
  [path(BoardHistoryService.method.restoreBoardVersion), 'edit'],
  [path(FeedbackService.method.listThreads), 'read'],
  [path(FeedbackService.method.getThread), 'read'],
  [path(FeedbackService.method.applyFeedback), 'comment'],
  [path(FeedbackService.method.getFeedbackReceipt), 'comment'],
  [path(BoardSharingService.method.getBoardSharing), 'read'],
  [path(BoardRoomService.method.getBoardRoom), 'read'],
  [path(BoardRoomService.method.updateBoardPresence), 'read'],
  [path(BoardRoomService.method.leaveBoardPresence), 'read'],
  [path(BoardRoomService.method.changeBoardTimer), 'edit'],
  [path(BoardRoomService.method.getBoardTimerReceipt), 'edit'],
]);

const { inspectBoardInvitation, joinBoardInvitation } = BoardSharingService.method;
const inspectPath = path(inspectBoardInvitation);
const joinPath = path(joinBoardInvitation);

export function isGuestInvitationPath(value: string) {
  return value === inspectPath || value === joinPath;
}

export function guestAccessForPath(value: string): Access | undefined {
  const readable = value.startsWith('/studio-archive-assets/') || roomEventPath(value);

  return readable ? 'read' : paths.get(value);
}

export function allowsGuestOrigin(request: IncomingMessage, guest: GuestHttpOptions) {
  const origin = request.headers.origin;

  return origin === undefined || origin === guest.origin();
}

function readBrowserToken(request: IncomingMessage) {
  const prefix = cookieName + '=';
  const cookies = request.headers.cookie?.split(';').map((part) => part.trim());
  const matches = cookies?.filter((part) => part.startsWith(prefix));
  if (matches?.length === 1) {
    const token = matches[0]?.slice(prefix.length);

    return token && validBrowserCredential(token) ? token : undefined;
  }
}

function stagedToken(request: IncomingMessage, options: SharingRoutesOptions) {
  const previous = readBrowserToken(request);
  if (previous && !options.application.browserTokenExpired(previous)) {
    return { token: previous, fresh: false };
  }

  return { token: options.newBrowserToken(), fresh: true };
}

function setCookie(response: ServerResponse, token: string, guest: GuestHttpOptions) {
  const secure = guest.origin()?.startsWith('https:') ? '; Secure' : '';
  response.setHeader(
    'set-cookie',
    cookieName +
      '=' +
      token +
      '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
      cookieLifetimeSeconds +
      secure,
  );
}

function boardIdIn(value: object): string {
  if ('boardId' in value && typeof value.boardId === 'string') {
    return requireId(value.boardId);
  }

  throw new SharingAccessError('Board-scoped guest access is required.');
}

function permits(session: GuestSession, access: Access) {
  switch (access) {
    case 'read':
      return true;
    case 'edit':
      return session.canEdit;
    case 'comment':
      return session.canComment;
  }
}

export function resolveGuestActor(
  request: IncomingMessage,
  options: SharingRoutesOptions,
  guest: GuestHttpOptions,
  access: Access,
): HttpActor | undefined {
  const token = readBrowserToken(request);
  const actorId = token ? options.application.browserActor(token) : undefined;
  if (!actorId) {
    return undefined;
  }

  const requireGuestAccess = (boardId: string, action: Access) => {
    const session = options.application.guestAccess(boardId, actorId, guest.scope);
    if (!session || !permits(session, action)) {
      throw new SharingAccessError('Guest access to this board is unavailable.');
    }
  };

  return {
    id: actorId,
    guestScope: guest.scope,
    authorize: (value) => requireGuestAccess(boardIdIn(value), access),
    authorizeRead: (boardId) => requireGuestAccess(requireId(boardId), 'read'),
  };
}

function existingInvitationSession(
  request: IncomingMessage,
  { application }: SharingRoutesOptions,
  boardId: string,
  scope: SharingScope,
  role: GuestSession['role'],
) {
  const token = readBrowserToken(request);
  const actorId = token ? application.browserActor(token) : undefined;
  const session = actorId ? application.guestAccess(boardId, actorId, scope) : undefined;
  if (session?.role === role) {
    return { ...session, role: wireRoles[session.role] };
  }
}

function inspectInvitation(
  request: IncomingMessage,
  response: ServerResponse,
  options: SharingRoutesOptions,
  guest: GuestHttpOptions,
  bytes: Uint8Array,
) {
  const { boardId, invitationToken } = decodeRequest(inspectBoardInvitation.input, bytes);
  const result = options.application.inspectInvitation({
    boardId: requireId(boardId),
    invitationToken,
    scope: guest.scope,
  });

  const schema = inspectBoardInvitation.output;
  if ('rejection' in result) {
    sendProtobuf(
      response,
      toBinary(schema, create(schema, { rejection: wireRejection[result.rejection] })),
    );

    return;
  }

  const { role } = result.value;
  const session = existingInvitationSession(request, options, boardId, guest.scope, role);
  const browser = stagedToken(request, options);
  if (browser.fresh) {
    setCookie(response, browser.token, guest);
  }

  const value = session ? { session } : { invitation: { ...result.value, role: wireRoles[role] } };
  sendProtobuf(response, toBinary(schema, create(schema, value)));
}

function joinInvitation(
  request: IncomingMessage,
  response: ServerResponse,
  options: SharingRoutesOptions,
  guest: GuestHttpOptions,
  bytes: Uint8Array,
) {
  const { boardId, invitationToken, name } = decodeRequest(joinBoardInvitation.input, bytes);
  const browser = stagedToken(request, options);
  const result = options.application.joinInvitation({
    boardId: requireId(boardId),
    invitationToken,
    name,
    scope: guest.scope,
    browserToken: browser.token,
  });

  if ('value' in result && browser.fresh) {
    setCookie(response, browser.token, guest);
  }

  const value =
    'value' in result
      ? { session: { ...result.value, role: wireRoles[result.value.role] } }
      : { rejection: wireRejection[result.rejection] };
  const schema = joinBoardInvitation.output;
  sendProtobuf(response, toBinary(schema, create(schema, value)));
}

export async function handleGuestInvitation(
  request: IncomingMessage,
  response: ServerResponse,
  options: SharingRoutesOptions,
  guest: GuestHttpOptions,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    sendStatus(response, 405);
    return;
  }
  if (mediaType(request) !== protobufContentType) {
    sendStatus(response, 415);
    return;
  }

  const bytes = await readBody(request, invitationBodyLimit);
  if (request.url === inspectPath) {
    inspectInvitation(request, response, options, guest, bytes);
  } else {
    joinInvitation(request, response, options, guest, bytes);
  }
}
