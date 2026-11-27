export const guestRoles = ['editor', 'commenter', 'viewer'] as const;

export type GuestRole = (typeof guestRoles)[number];
export type SharingRole = 'owner' | GuestRole;
export type SharingScope = 'local' | 'lan';

export type SharingRejection =
  | 'forbidden'
  | 'versionChanged'
  | 'commandIdReuse'
  | 'invalidCommand'
  | 'lanUnavailable'
  | 'invitationUnavailable'
  | 'nameTaken'
  | 'memberUnavailable'
  | 'roleDisabled';

export interface ShareSettings {
  readonly enabled: boolean;
  readonly scope: SharingScope;
  readonly version: bigint;
}

export interface Invitation {
  readonly role: GuestRole;
  readonly enabled: boolean;
  readonly version: bigint;
  readonly seed: string;
}

export interface SharingMember {
  readonly actorId: string;
  readonly name: string;
  readonly nameKey: string;
  readonly role: GuestRole;
  readonly invitationVersion: bigint;
  readonly removed: boolean;
  readonly lastSeenAtMillis?: number;
}

export interface BrowserSession {
  readonly actorId: string;
  readonly expiresAt: number;
}

export interface ActiveBoardGuest {
  readonly role: GuestRole;
  readonly name: string;
  readonly scope: SharingScope;
  readonly version: bigint;
  readonly lastSeenAtMillis?: number;
}

export interface BoardIdentity {
  readonly boardId: string;
  readonly title: string;
}

export interface SharingLink {
  readonly role: GuestRole;
  readonly enabled: boolean;
  readonly url: string;
}

export interface SharingMemberView {
  readonly actorId: string;
  readonly name: string;
  readonly role: GuestRole;
  readonly removed: boolean;
  readonly active: boolean;
  readonly lastSeenAtMillis?: number;
}

export interface SharingCapabilities {
  readonly canEdit: boolean;
  readonly canComment: boolean;
}

export interface BoardSharing extends ShareSettings, SharingCapabilities {
  readonly boardId: string;
  readonly role: SharingRole;
  readonly links: readonly SharingLink[];
  readonly members: readonly SharingMemberView[];
  readonly memberUrl: string;
}

export interface InvitationView extends BoardIdentity {
  readonly role: GuestRole;
}

export interface GuestSession extends SharingCapabilities {
  readonly boardId: string;
  readonly actorId: string;
  readonly name: string;
  readonly role: GuestRole;
  readonly version: bigint;
}

export type ShareResult<T> = { readonly value: T } | { readonly rejection: SharingRejection };

export type SharingOperation =
  | { readonly kind: 'setScope'; readonly scope: SharingScope }
  | { readonly kind: 'stop' }
  | { readonly kind: 'setInvitation'; readonly role: GuestRole; readonly enabled: boolean }
  | { readonly kind: 'resetInvitation'; readonly role?: GuestRole }
  | {
      readonly kind: 'changeMemberRole' | 'restoreMember';
      readonly actorId: string;
      readonly role: GuestRole;
    }
  | { readonly kind: 'removeMember' | 'forgetMember'; readonly actorId: string };

export interface SharingCommand {
  readonly boardId: string;
  readonly commandId: string;
  readonly expectedVersion: bigint;
  readonly operation: SharingOperation;
}

export type SharingOutcome =
  | { readonly kind: 'applied'; readonly version: bigint }
  | { readonly kind: 'rejected'; readonly reason: SharingRejection };

export interface SharingReceipt {
  readonly boardId: string;
  readonly commandId: string;
  readonly outcome: SharingOutcome;
}

const maximumVersion = (1n << 63n) - 1n;
const maximumNameLength = 60;
const boardIdentity = /^[A-Za-z0-9_-]{1,128}$/u;
const guestCookie = /^[A-Za-z0-9_-]{43}$/u;

export const initialSettings: ShareSettings = { enabled: false, scope: 'local', version: 0n };

export function isSharingIdentifier(value: string) {
  return boardIdentity.test(value);
}

export function isBrowserCredential(value: string) {
  return guestCookie.test(value);
}

export function capabilities(role: SharingRole): SharingCapabilities {
  return {
    canEdit: role === 'owner' || role === 'editor',
    canComment: role !== 'viewer',
  };
}

export function permittedInvitations(role: SharingRole) {
  return role === 'owner' ? guestRoles : guestRoles.slice(guestRoles.indexOf(role));
}

export function nextSharingVersion(version: bigint) {
  return version < maximumVersion ? version + 1n : undefined;
}

export function normalizeGuestName(value: string) {
  const name = value.trim();
  if (!name || name.length > maximumNameLength || /[\p{Cc}\p{Cs}]/u.test(name)) {
    return undefined;
  }

  return { name, nameKey: name.normalize('NFKC').toLowerCase() };
}
