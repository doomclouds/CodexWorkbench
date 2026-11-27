import {
  capabilities,
  initialSettings,
  permittedInvitations,
  type BoardSharing,
  type GuestSession,
  type Invitation,
  type InvitationView,
  type ShareResult,
  type ShareSettings,
  type SharingMember,
  type SharingRole,
  type SharingScope,
} from '../domain/index.js';
import type { SharingReader } from '../ports/index.js';

export interface SharingApplicationServices {
  readonly now: () => number;
  readonly digest: (input: string) => string;
  readonly equalToken: (left: string, right: string) => boolean;
  readonly newInvitationSeed: () => string;
  readonly newGuestId: () => string;
  readonly inviteOrigin: (scope: SharingScope) => string | undefined;
}

export interface Verification {
  readonly settings: ShareSettings;
  readonly invitation: Invitation;
  readonly view: InvitationView;
}

export class SharingAccessError extends Error {}

export function getSettings(reader: SharingReader, boardId: string): ShareSettings {
  return reader.getSettings(boardId) ?? initialSettings;
}

function credential(boardId: string, invitation: Invitation, services: SharingApplicationServices) {
  const { role, version, seed } = invitation;
  const identity = JSON.stringify([boardId, role, version.toString(), seed]);

  return role + '.' + services.digest(identity);
}

function memberUrl(origin: string | undefined, boardId: string) {
  if (origin === undefined) {
    return '';
  }

  const url = new URL('/', origin);
  url.searchParams.set('board', boardId);

  return url.href;
}

function invitationUrl(
  path: string,
  boardId: string,
  invitation: Invitation,
  services: SharingApplicationServices,
) {
  if (!path || !invitation.enabled) {
    return '';
  }

  const url = new URL(path);
  url.hash = new URLSearchParams({ invite: credential(boardId, invitation, services) }).toString();

  return url.href;
}

export function availableOn(settings: ShareSettings, scope: SharingScope) {
  return settings.enabled && (scope === 'local' || settings.scope === 'lan');
}

export function memberCanEnter(member: SharingMember, invitation: Invitation | undefined): boolean {
  return (
    !member.removed &&
    Boolean(invitation?.enabled && invitation.version === member.invitationVersion)
  );
}

export function readInvitation(
  reader: SharingReader,
  services: SharingApplicationServices,
  boardId: string,
  token: string,
  scope: SharingScope,
): ShareResult<Verification> {
  const settings = getSettings(reader, boardId);
  const board = reader.getBoard(boardId);
  if (!board || !availableOn(settings, scope) || token.length > 80) {
    return { rejection: 'invitationUnavailable' };
  }

  const invitation = reader
    .listInvitations(boardId)
    .find(({ role }) => token.startsWith(role + '.'));

  if (
    !invitation?.enabled ||
    !services.equalToken(token, credential(boardId, invitation, services))
  ) {
    return { rejection: 'invitationUnavailable' };
  }

  return { value: { settings, invitation, view: { ...board, role: invitation.role } } };
}

export function readGuestSession(
  reader: SharingReader,
  services: SharingApplicationServices,
  boardId: string,
  actorId: string,
  scope: SharingScope,
): GuestSession | undefined {
  const guest = reader.getActiveGuest(boardId, actorId, services.now());
  if (guest && (scope === 'local' || guest.scope === 'lan')) {
    const { role, name, version } = guest;

    return { boardId, actorId, role, name, version, ...capabilities(role) };
  }
}

export function guestSession(
  boardId: string,
  member: SharingMember,
  settings: ShareSettings,
): GuestSession {
  const { actorId, name, role } = member;

  return { boardId, actorId, name, role, version: settings.version, ...capabilities(role) };
}

export function sharingView(
  reader: SharingReader,
  services: SharingApplicationServices,
  boardId: string,
  role: SharingRole,
): BoardSharing {
  const settings = getSettings(reader, boardId);
  const invitations = reader.listInvitations(boardId);
  const permitted = permittedInvitations(role);
  const path = settings.enabled ? memberUrl(services.inviteOrigin(settings.scope), boardId) : '';
  const links = permitted.map((grade) => {
    const invitation = invitations.find(({ role: invitedRole }) => invitedRole === grade);

    return {
      role: grade,
      enabled: invitation?.enabled ?? false,
      url: invitation ? invitationUrl(path, boardId, invitation, services) : '',
    };
  });
  const members =
    role === 'owner'
      ? reader.listMembers(boardId).map((member) => ({
          actorId: member.actorId,
          name: member.name,
          role: member.role,
          removed: member.removed,
          active:
            settings.enabled &&
            memberCanEnter(
              member,
              invitations.find(({ role: invitedRole }) => invitedRole === member.role),
            ) &&
            reader.actorSessionIsActive(member.actorId, services.now()),
        }))
      : [];

  return { ...settings, ...capabilities(role), boardId, role, links, members, memberUrl: path };
}
