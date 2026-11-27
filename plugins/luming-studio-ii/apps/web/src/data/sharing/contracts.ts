export type SharingPost = (
  path: string,
  body: Uint8Array,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

export type SharingRole = 'owner' | 'editor' | 'commenter' | 'viewer';
export type InvitationRole = Exclude<SharingRole, 'owner'>;
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

export interface SharingLink {
  readonly role: InvitationRole;
  readonly enabled: boolean;
  readonly url?: string;
}

export interface SharingMember {
  readonly actorId: string;
  readonly name: string;
  readonly role: SharingRole;
  readonly removed: boolean;
  readonly active: boolean;
  readonly online?: boolean;
  readonly lastSeenAtMillis?: number;
}

export interface BoardSharingState {
  readonly boardId: string;
  readonly enabled: boolean;
  readonly scope: SharingScope;
  readonly version: bigint;
  readonly role: SharingRole;
  readonly canEdit: boolean;
  readonly canComment: boolean;
  readonly links: readonly SharingLink[];
  readonly members: readonly SharingMember[];
  readonly memberUrl?: string;
  readonly ownerDisplayName?: string;
}

export type SharingOperation =
  | { readonly kind: 'setScope'; readonly scope: SharingScope }
  | { readonly kind: 'stop' }
  | { readonly kind: 'setInvitation'; readonly role: InvitationRole; readonly enabled: boolean }
  | { readonly kind: 'resetInvitation'; readonly role: InvitationRole }
  | { readonly kind: 'changeMemberRole'; readonly actorId: string; readonly role: InvitationRole }
  | { readonly kind: 'removeMember'; readonly actorId: string }
  | { readonly kind: 'restoreMember'; readonly actorId: string; readonly role: InvitationRole }
  | { readonly kind: 'forgetMember'; readonly actorId: string };

interface SharingCommandIdentity {
  readonly boardId: string;
  readonly commandId: string;
}

export interface SharingCommand extends SharingCommandIdentity {
  readonly expectedVersion: bigint;
  readonly operation: SharingOperation;
}

interface AppliedSharingReceipt extends SharingCommandIdentity {
  readonly kind: 'applied';
  readonly version: bigint;
}

interface RejectedSharingReceipt extends SharingCommandIdentity {
  readonly kind: 'rejected';
  readonly reason: SharingRejection;
}

export type SharingReceipt = AppliedSharingReceipt | RejectedSharingReceipt;

export interface BoardInvitationRequest {
  readonly boardId: string;
  readonly invitationToken: string;
}

export interface BoardInvitationJoin extends BoardInvitationRequest {
  readonly name: string;
}

export interface BoardInvitation {
  readonly boardId: string;
  readonly title: string;
  readonly role: InvitationRole;
}

export interface SharingGuestSession {
  readonly boardId: string;
  readonly actorId: string;
  readonly name: string;
  readonly role: InvitationRole;
  readonly version: bigint;
  readonly canEdit: boolean;
  readonly canComment: boolean;
}

interface InvitationRejected {
  readonly kind: 'rejected';
  readonly reason: SharingRejection;
}

export type BoardInvitationResult =
  | { readonly kind: 'available'; readonly invitation: BoardInvitation }
  | GuestJoinResult;

export type GuestJoinResult =
  | { readonly kind: 'joined'; readonly session: SharingGuestSession }
  | InvitationRejected;

export interface BoardSharingService {
  getBoardSharing(boardId: string, signal?: AbortSignal): Promise<BoardSharingState>;
  updateBoardSharing(command: SharingCommand, signal?: AbortSignal): Promise<SharingReceipt>;
  getBoardSharingReceipt(
    boardId: string,
    commandId: string,
    signal?: AbortSignal,
  ): Promise<SharingReceipt | undefined>;
  retryBoardSharing(command: SharingCommand, signal?: AbortSignal): Promise<SharingReceipt>;
  inspectBoardInvitation(
    request: BoardInvitationRequest,
    signal?: AbortSignal,
  ): Promise<BoardInvitationResult>;
  joinBoardInvitation(request: BoardInvitationJoin, signal?: AbortSignal): Promise<GuestJoinResult>;
}
