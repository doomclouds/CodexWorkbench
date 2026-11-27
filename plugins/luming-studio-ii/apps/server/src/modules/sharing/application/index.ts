import {
  isBrowserCredential,
  normalizeGuestName,
  type BoardSharing,
  type GuestSession,
  type InvitationView,
  type ShareResult,
  type SharingCommand,
  type SharingReceipt,
  type SharingScope,
} from '../domain/index.js';
import type { SharingReader, SharingRepository, SharingWriter } from '../ports/index.js';
import {
  guestSession,
  readGuestSession,
  readInvitation,
  SharingAccessError,
  sharingView,
  type SharingApplicationServices,
} from './access.js';
import { applySharing, previousOrRejected } from './commands.js';

export type {
  BoardSharing,
  GuestRole,
  GuestSession,
  InvitationView,
  ShareResult,
  SharingCommand,
  SharingOperation,
  SharingReceipt,
  SharingRejection,
  SharingRole,
  SharingScope,
} from '../domain/index.js';
export { SharingAccessError } from './access.js';

const browserSessionMillis = 365 * 24 * 60 * 60 * 1_000;

export function validBrowserCredential(value: string) {
  return isBrowserCredential(value);
}

export interface GuestInvitationRequest {
  readonly boardId: string;
  readonly invitationToken: string;
  readonly scope: SharingScope;
}

export interface GuestJoinRequest extends GuestInvitationRequest {
  readonly name: string;
  readonly browserToken: string;
}

export interface SharingApplication {
  activeSharingScopes(): readonly SharingScope[];
  getSharing(boardId: string, actorId: string, scope?: SharingScope): BoardSharing;
  getReceipt(boardId: string, actorId: string, commandId: string): SharingReceipt | undefined;
  prepareUpdate(actorId: string, command: SharingCommand): SharingReceipt | undefined;
  update(actorId: string, command: SharingCommand): SharingReceipt;
  inspectInvitation(request: GuestInvitationRequest): ShareResult<InvitationView>;
  joinInvitation(request: GuestJoinRequest): ShareResult<GuestSession>;
  browserActor(token: string): string | undefined;
  browserTokenExpired(token: string): boolean;
  guestAccess(boardId: string, actorId: string, scope: SharingScope): GuestSession | undefined;
}

function join(
  writer: SharingWriter,
  services: SharingApplicationServices,
  request: GuestJoinRequest,
): ShareResult<GuestSession> {
  const { boardId, invitationToken, name: rawName, scope, browserToken } = request;
  const match = readInvitation(writer, services, boardId, invitationToken, scope);
  if ('rejection' in match) {
    return match;
  }

  const name = normalizeGuestName(rawName);
  if (!name || !isBrowserCredential(browserToken)) {
    return { rejection: 'invalidCommand' };
  }

  const hash = services.digest(browserToken);
  const now = services.now();
  const browser = writer.getBrowserSession(hash);
  if (browser && browser.expiresAt <= now) {
    return { rejection: 'invitationUnavailable' };
  }

  const actorId = browser?.actorId ?? services.newGuestId();
  const previous = writer.getMember(boardId, actorId);
  if (previous?.removed) {
    return { rejection: 'memberUnavailable' };
  }

  const { invitation, settings } = match.value;
  const existing = previous && readGuestSession(writer, services, boardId, actorId, scope);
  if (existing) {
    return { value: existing };
  }

  const occupied = writer.findMemberByName(boardId, name.nameKey);
  if (occupied && occupied.actorId !== actorId) {
    return { rejection: 'nameTaken' };
  }

  if (!browser) {
    writer.saveBrowserSession(hash, { actorId, expiresAt: now + browserSessionMillis });
  }

  const member = {
    ...name,
    actorId,
    role: invitation.role,
    removed: false,
    invitationVersion: invitation.version,
  };
  writer.saveMember(boardId, member);

  return { value: guestSession(boardId, member, settings) };
}

function readSharingRole(
  reader: SharingReader,
  services: SharingApplicationServices,
  boardId: string,
  actorId: string,
  scope: SharingScope | undefined,
) {
  if (scope) {
    return readGuestSession(reader, services, boardId, actorId, scope)?.role;
  }

  return reader.ownsBoard(boardId, actorId) ? 'owner' : undefined;
}

export function createSharingApplication(
  repository: SharingRepository,
  services: SharingApplicationServices,
): SharingApplication {
  function readBrowser(token: string) {
    if (isBrowserCredential(token)) {
      return repository.read((reader) => reader.getBrowserSession(services.digest(token)));
    }
  }

  return {
    activeSharingScopes: () => repository.read((reader) => reader.activeSharingScopes()),
    getSharing: (boardId, actorId, scope) =>
      repository.read((reader) => {
        const role = readSharingRole(reader, services, boardId, actorId, scope);
        if (!role) {
          throw new SharingAccessError('Sharing access is unavailable.');
        }

        return sharingView(reader, services, boardId, role);
      }),
    getReceipt: (boardId, actorId, commandId) =>
      repository.read((reader) => {
        if (!reader.ownsBoard(boardId, actorId)) {
          throw new SharingAccessError('Sharing owner access is required.');
        }

        return reader.getReceipt(boardId, actorId, commandId)?.receipt;
      }),
    prepareUpdate: (actorId, command) =>
      repository.read((reader) => previousOrRejected(reader, services, actorId, command)),
    update: (actorId, command) =>
      repository.write((writer) => applySharing(writer, services, actorId, command)),
    inspectInvitation: ({ boardId, scope, invitationToken }) =>
      repository.read((reader) => {
        const result = readInvitation(reader, services, boardId, invitationToken, scope);

        return 'value' in result ? { value: result.value.view } : result;
      }),
    joinInvitation: (request) => repository.write((writer) => join(writer, services, request)),
    browserActor: (token) => {
      const expires = readBrowser(token);

      return expires && expires.expiresAt > services.now() ? expires.actorId : undefined;
    },
    browserTokenExpired: (token) => {
      const session = readBrowser(token);

      return session !== undefined && session.expiresAt <= services.now();
    },
    guestAccess: (boardId, actorId, scope) =>
      repository.read((reader) => readGuestSession(reader, services, boardId, actorId, scope)),
  };
}
