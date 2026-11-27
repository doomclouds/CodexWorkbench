import {
  SharingRejectionReason as WireRejection,
  SharingRole as WireRole,
  SharingScope as WireScope,
  type BoardSharing as WireSharingState,
  type InspectBoardInvitationResponse,
  type JoinBoardInvitationResponse,
  type SharingCommandReceipt,
  type SharingLink as WireSharingLink,
  type SharingMember as WireSharingMember,
} from '@codexworkbench/luming-studio-ii-contracts/sharing/service';

import type {
  BoardInvitationResult,
  BoardSharingState,
  GuestJoinResult,
  InvitationRole,
  SharingLink,
  SharingMember,
  SharingReceipt,
  SharingRejection,
  SharingRole,
  SharingScope,
} from './contracts.js';

const roles = new Map<WireRole, SharingRole>([
  [WireRole.OWNER, 'owner'],
  [WireRole.EDITOR, 'editor'],
  [WireRole.COMMENTER, 'commenter'],
  [WireRole.VIEWER, 'viewer'],
]);

const scopes = new Map<WireScope, SharingScope>([
  [WireScope.LOCAL, 'local'],
  [WireScope.LAN, 'lan'],
]);

const reasons = new Map<WireRejection, SharingRejection>([
  [WireRejection.FORBIDDEN, 'forbidden'],
  [WireRejection.VERSION_CHANGED, 'versionChanged'],
  [WireRejection.COMMAND_ID_REUSE, 'commandIdReuse'],
  [WireRejection.INVALID_COMMAND, 'invalidCommand'],
  [WireRejection.LAN_UNAVAILABLE, 'lanUnavailable'],
  [WireRejection.INVITATION_UNAVAILABLE, 'invitationUnavailable'],
  [WireRejection.NAME_TAKEN, 'nameTaken'],
  [WireRejection.MEMBER_UNAVAILABLE, 'memberUnavailable'],
  [WireRejection.ROLE_DISABLED, 'roleDisabled'],
]);

const delegationLevel = { viewer: 1, commenter: 2, editor: 3, owner: 4 } as const;

interface SharingPermissions {
  readonly canEdit: boolean;
  readonly canComment: boolean;
}

function validPermissions(role: SharingRole, { canEdit, canComment }: SharingPermissions) {
  const editor = role === 'owner' || role === 'editor';
  const commenter = role !== 'viewer';

  return canEdit === editor && canComment === commenter;
}

function readInvitationRole(wireRole: WireRole, message: string): InvitationRole {
  const role = roles.get(wireRole);
  if (role === undefined || role === 'owner') {
    throw new Error(message);
  }

  return role;
}

function readRejection(wire: WireRejection): SharingRejection {
  const reason = reasons.get(wire);
  if (reason === undefined) {
    throw new Error('分享服务返回了无法识别的拒绝原因。');
  }

  return reason;
}

function readSharingUrl(raw: string, boardId: string): URL {
  const url = URL.parse(raw);
  const web = url?.protocol === 'http:' || url?.protocol === 'https:';
  const hasCredentials = Boolean(url?.username || url?.password);
  if (!web || !url || hasCredentials) {
    throw new Error('分享服务返回了无效的链接。');
  }

  const board = url.searchParams.getAll('board');
  const matchingBoard = url.searchParams.size === 1 && board[0] === boardId;
  if (!matchingBoard || url.pathname !== '/') {
    throw new Error('分享链接指向了不同的白板。');
  }

  return url;
}

function readMemberUrl(raw: string, boardId: string) {
  if (!raw) {
    return undefined;
  }

  const url = readSharingUrl(raw, boardId);
  if (url.hash) {
    throw new Error('分享服务返回了带有邀请凭据的成员地址。');
  }

  return url.href;
}

function readInvitationUrl(raw: string, boardId: string, role: InvitationRole): string {
  const url = readSharingUrl(raw, boardId);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const tokens = fragment.getAll('invite');
  const prefix = role + '.';
  const token = tokens[0];
  const matchingToken = token?.startsWith(prefix) && token.length > prefix.length;
  if (!matchingToken || fragment.size !== 1) {
    throw new Error('分享服务返回了与邀请角色不匹配的链接。');
  }

  return url.href;
}

function readLinks(
  links: readonly WireSharingLink[],
  boardId: string,
  viewer: SharingRole,
): readonly SharingLink[] {
  const byRole = new Map<InvitationRole, SharingLink>();
  for (const link of links) {
    const role = readInvitationRole(link.role, '分享服务返回了无效的邀请角色。');
    if (delegationLevel[role] > delegationLevel[viewer]) {
      continue;
    }
    if (byRole.has(role)) {
      throw new Error('分享服务重复返回了同一角色。');
    }

    const url = link.enabled && link.url ? readInvitationUrl(link.url, boardId, role) : undefined;
    byRole.set(role, { role, enabled: link.enabled, url });
  }

  return [...byRole.values()];
}

function readMembers(members: readonly WireSharingMember[]): readonly SharingMember[] {
  const seen = new Set<string>();

  return members.map(
    ({ actorId, name, role: rawRole, removed, active, online, lastSeenAtMillis }) => {
      const role = roles.get(rawRole);
      const hasIdentity = actorId.trim() !== '' && name.trim() !== '';
      if (!role || !hasIdentity || seen.has(actorId)) {
        throw new Error('分享服务返回了无效的成员身份。');
      }

      seen.add(actorId);

      const visitTime = lastSeenAtMillis === undefined ? undefined : Number(lastSeenAtMillis);
      return {
        actorId,
        name,
        role,
        removed,
        active,
        online: online && active && !removed,
        lastSeenAtMillis: Number.isSafeInteger(visitTime) ? visitTime : undefined,
      };
    },
  );
}

export function readBoardSharing(
  value: WireSharingState | undefined,
  expectedBoardId: string,
): BoardSharingState {
  if (value?.boardId !== expectedBoardId || value.version === undefined) {
    throw new Error('分享服务未返回匹配白板及版次。');
  }

  const { boardId, enabled, version, canEdit, canComment } = value;
  const role = roles.get(value.role);
  const scope = scopes.get(value.scope);
  if (!role || !scope || !validPermissions(role, value)) {
    throw new Error('分享服务返回了不匹配的访问权限。');
  }

  return {
    boardId,
    enabled,
    scope,
    version,
    role,
    canEdit,
    canComment,
    links: readLinks(value.links, boardId, role),
    members: role === 'owner' ? readMembers(value.members) : [],
    memberUrl: readMemberUrl(value.memberUrl, boardId),
    ownerDisplayName: role === 'owner' ? value.ownerDisplayName?.trim() || undefined : undefined,
  };
}

export function readSharingReceipt(
  value: SharingCommandReceipt | undefined,
  boardId: string,
  commandId: string,
): SharingReceipt {
  if (value?.boardId !== boardId || value.commandId !== commandId) {
    throw new Error('分享服务未返回匹配的原命令回执。');
  }

  const { outcome } = value;
  if (outcome.case === 'applied' && outcome.value.version !== undefined) {
    return { kind: 'applied', boardId, commandId, version: outcome.value.version };
  }
  if (outcome.case === 'rejected') {
    return { kind: 'rejected', boardId, commandId, reason: readRejection(outcome.value.reason) };
  }

  throw new Error('分享服务返回的回执缺少结果或版次。');
}

export function readBoardInvitation(
  response: InspectBoardInvitationResponse,
  boardId: string,
): BoardInvitationResult {
  const { invitation, rejection, session } = response;
  if (session) {
    if (invitation) {
      throw new Error('分享服务同时返回了邀请与加入结果。');
    }

    return readGuestJoin({ session, rejection }, boardId);
  }
  if (!invitation) {
    return { kind: 'rejected', reason: readRejection(rejection) };
  }
  if (invitation.boardId !== boardId || rejection !== WireRejection.UNSPECIFIED) {
    throw new Error('分享服务返回了不匹配的邀请。');
  }

  const role = readInvitationRole(invitation.role, '分享服务返回了无效的邀请角色。');

  return { kind: 'available', invitation: { boardId, title: invitation.title, role } };
}

export function readGuestJoin(
  response: Pick<JoinBoardInvitationResponse, 'session' | 'rejection'>,
  boardId: string,
): GuestJoinResult {
  const { session, rejection } = response;
  if (!session) {
    return { kind: 'rejected', reason: readRejection(rejection) };
  }

  const { actorId, name, canEdit, canComment, version } = session;
  const accepted = session.boardId === boardId && rejection === WireRejection.UNSPECIFIED;
  const hasIdentity = actorId.trim() !== '' && name.trim() !== '';
  if (!accepted || !hasIdentity || version === undefined) {
    throw new Error('分享服务返回了不匹配的加入结果。');
  }

  const role = readInvitationRole(session.role, '分享服务返回了无效的加入角色。');
  if (!validPermissions(role, session)) {
    throw new Error('分享服务返回了不匹配的加入权限。');
  }

  return {
    kind: 'joined',
    session: { boardId, actorId, name, role, version, canEdit, canComment },
  };
}
