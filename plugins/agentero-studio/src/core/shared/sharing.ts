import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { LOCAL_ACTOR, type Actor, type Presence, type Role } from '../../contracts/studio.js';
import { assertAlive, copy, requireRole, safeId, StudioError, text } from './common.js';
import type { ArtifactMetadata, ArtifactState, SharingMember, SharingState } from './model.js';

export const SHARE_ROLES = ['editor', 'commenter', 'viewer'] as const;

type GuestRole = Exclude<Role, 'owner'>;

const newToken = () => randomBytes(24).toString('base64url');
const roleOn = (sharing: SharingState, role: GuestRole) => sharing.roleEnabled?.[role] !== false;

export type ShareAccessReason =
  | 'removed'
  | 'sharing-closed'
  | 'link-disabled'
  | 'link-reset'
  | 'invalid-link'
  | 'local-only';

export const sharingAccess = (sharing: SharingState): 'local' | 'lan' =>
  sharing.enabled ? (sharing.access ?? 'lan') : 'local';
const tokenKey = (token: string) => createHash('sha256').update(token).digest('hex');

function retireTokens(
  sharing: SharingState,
  roles: readonly GuestRole[],
  reason: 'link-reset' | 'sharing-closed',
) {
  sharing.retiredTokens ??= {};
  for (const role of roles) {
    if (sharing.tokens[role]) {
      sharing.retiredTokens[tokenKey(sharing.tokens[role]!)] = reason;
    }
  }

  sharing.retiredTokens = Object.fromEntries(Object.entries(sharing.retiredTokens).slice(-500));
}

type NamedState = Pick<ArtifactState<unknown>, 'sharing' | 'guestNames'>;

const canonicalName = (name: string) => name.normalize('NFKC').trim();

function nameTaken(state: NamedState, id: string, key: string, ownerName: string) {
  return (
    canonicalName(ownerName).toLowerCase() === key ||
    Object.entries(state.guestNames ?? {}).some(
      ([other, entry]) => other !== id && entry.key === key,
    ) ||
    Object.values(state.sharing.members ?? {}).some(
      (member) => member.id !== id && canonicalName(member.name).toLowerCase() === key,
    )
  );
}

export function rememberGuestNames(state: NamedState): void {
  for (const member of Object.values(state.sharing.members ?? {})) {
    const name = canonicalName(member.name);
    if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) {
      continue;
    }

    state.guestNames ??= {};
    state.guestNames[member.id] ??= { name, key: name.toLowerCase() };
  }
}

export function guestName(
  state: NamedState,
  id: string,
  ownerName = LOCAL_ACTOR.name,
): string | undefined {
  const profile = state.guestNames?.[id];

  return profile && !nameTaken(state, id, profile.key, ownerName) ? profile.name : undefined;
}

export function registerGuestName(
  state: NamedState,
  id: string,
  value: unknown,
  ownerName = LOCAL_ACTOR.name,
): string {
  rememberGuestNames(state);
  const name = canonicalName(text(value, '', 60));
  const key = name.toLowerCase();
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new StudioError('INVALID_ARGUMENT', '请输入 1 到 60 个字符的名字。');
  }
  if (nameTaken(state, id, key, ownerName)) {
    throw new StudioError('NAME_TAKEN', '这个名字已有人使用，请选择另一个名字。');
  }

  const saved = guestName(state, id, ownerName);
  if (saved && state.guestNames![id]!.key !== key) {
    throw new StudioError('NAME_ALREADY_SET', '此浏览器已记住你的名字，请直接使用原身份进入白板。');
  }

  state.guestNames ??= {};
  state.guestNames[id] = { name: saved ?? name, key };

  return saved ?? name;
}

function checkedRole(role: unknown): GuestRole {
  if (!SHARE_ROLES.includes(role as GuestRole)) {
    throw new StudioError('INVALID_ARGUMENT', '分享角色无效。');
  }

  return role as GuestRole;
}

export function shareInfo(
  artifactId: string,
  sharing: SharingState,
  origin: string,
  peers: Presence[] = [],
  owner = LOCAL_ACTOR,
  actor: Actor = owner,
) {
  const allowed =
    actor.role === 'owner' ? [...SHARE_ROLES] : SHARE_ROLES.slice(SHARE_ROLES.indexOf(actor.role));
  const roles = allowed.filter((role) => roleOn(sharing, role));
  const links = sharing.enabled
    ? Object.fromEntries(
        roles.map((role) => [
          role,
          `${origin}/?${new URLSearchParams({ artifactId, share: sharing.tokens[role] ?? '' })}`,
        ]),
      )
    : {};
  const canonicalPath = `/?${new URLSearchParams({ artifactId })}`;
  if (actor.role !== 'owner') {
    return {
      enabled: sharing.enabled,
      access: sharingAccess(sharing),
      role: actor.role,
      roles,
      links,
      canonicalPath,
    };
  }

  const roleEnabled = Object.fromEntries(SHARE_ROLES.map((role) => [role, roleOn(sharing, role)]));
  const projectMember = (member: SharingMember) => {
    const active =
      !member.removed &&
      sharing.enabled &&
      roleOn(sharing, member.role) &&
      sharing.tokens[member.role] === member.roleToken;

    return {
      id: member.id,
      name: member.name,
      role: member.role,
      joinedAt: member.joinedAt,
      lastSeenAt: member.lastSeenAt,
      active,
      online:
        active &&
        peers.some((peer) => peer.actor.id === member.id && peer.actor.role === member.role),
    };
  };

  const members = Object.values(sharing.members ?? {})
    .filter((member) => !member.removed && sharing.tokens[member.role] === member.roleToken)
    .map(projectMember)
    .sort(
      (a, b) => Number(b.online) - Number(a.online) || b.lastSeenAt.localeCompare(a.lastSeenAt),
    );
  const removedMembers = Object.values(sharing.members ?? {})
    .filter((member) => member.removed)
    .map(projectMember)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  return {
    enabled: sharing.enabled,
    access: sharingAccess(sharing),
    generation: sharing.generation,
    links,
    roles: [...SHARE_ROLES],
    roleEnabled,
    members,
    removedMembers,
    owner: copy(owner),
    canonicalPath,
  };
}

interface SharingRevocations {
  revokedRoles: GuestRole[];
  revokedMemberIds: string[];
}

function startSharing(sharing: SharingState, requestedAccess: unknown): void {
  if (requestedAccess !== undefined && requestedAccess !== 'local' && requestedAccess !== 'lan') {
    throw new StudioError('INVALID_ARGUMENT', '访问范围应为 local 或 lan。');
  }

  const access = requestedAccess ?? 'lan';
  if (!sharing.enabled) {
    retireTokens(sharing, SHARE_ROLES, 'sharing-closed');
    sharing.tokens = Object.fromEntries(SHARE_ROLES.map((role) => [role, newToken()]));
    sharing.members = {};
    sharing.generation++;
  } else if (sharingAccess(sharing) !== access) {
    sharing.generation++;
  }

  sharing.access = access;
  sharing.enabled = true;
}

function setInvitation(sharing: SharingState, args: Record<string, unknown>): GuestRole[] {
  const role = checkedRole(args.role);
  if (typeof args.on !== 'boolean') {
    throw new StudioError('INVALID_ARGUMENT', '请指定链接启用状态。');
  }

  sharing.tokens[role] ??= newToken();
  sharing.roleEnabled ??= {};
  sharing.roleEnabled[role] = args.on;
  sharing.generation++;

  return args.on ? [] : [role];
}

function resetInvitations(sharing: SharingState, role: unknown): GuestRole[] {
  const roles = role === undefined || role === 'all' ? [...SHARE_ROLES] : [checkedRole(role)];
  retireTokens(sharing, roles, 'link-reset');
  for (const resetRole of roles) {
    sharing.tokens[resetRole] = newToken();
  }

  sharing.generation++;

  return roles;
}

function changeMember(
  sharing: SharingState,
  action: 'role' | 'remove' | 'restore' | 'forget',
  args: Record<string, unknown>,
): string[] {
  const id = safeId(args.memberId, '成员 ID');
  const member =
    sharing.members && Object.hasOwn(sharing.members, id) ? sharing.members[id] : undefined;

  if (action === 'forget' || action === 'restore') {
    if (!member?.removed) {
      throw new StudioError('NOT_FOUND', '已移除成员不存在。');
    }

    if (action === 'forget') {
      delete sharing.members![id];
      sharing.generation++;

      return [id];
    }

    const role = checkedRole(args.role);
    if (!sharing.enabled || !roleOn(sharing, role) || !sharing.tokens[role]) {
      throw new StudioError('INVALID_ARGUMENT', '请先启用该角色的邀请链接。');
    }

    member.role = role;
    member.roleToken = sharing.tokens[role]!;
    member.credential = sharing.tokens[role]!;
    member.grantId = newToken();
    member.ownerAssigned = true;
    delete member.removed;
    sharing.generation++;

    return [];
  }
  if (!member || member.removed || sharing.tokens[member.role] !== member.roleToken) {
    throw new StudioError('NOT_FOUND', '成员不存在。');
  }

  if (action === 'role') {
    const role = checkedRole(args.role);
    if (!roleOn(sharing, role) || !sharing.tokens[role]) {
      throw new StudioError('INVALID_ARGUMENT', '请先启用该角色的邀请链接。');
    }

    member.role = role;
    member.roleToken = sharing.tokens[role]!;
    member.ownerAssigned = true;
  } else {
    member.removed = true;
  }

  sharing.generation++;

  return [id];
}

export function updateSharing(
  artifact: ArtifactMetadata,
  sharing: SharingState,
  action: string,
  actor: Actor,
  args: Record<string, unknown>,
): SharingRevocations {
  requireRole(actor, ['owner']);
  assertAlive(artifact);
  const result: SharingRevocations = { revokedRoles: [], revokedMemberIds: [] };
  switch (action) {
    case 'start':
      startSharing(sharing, args.access);
      break;
    case 'stop':
      revokeSharing(sharing);
      result.revokedRoles = [...SHARE_ROLES];
      break;
    case 'link':
      result.revokedRoles = setInvitation(sharing, args);
      break;
    case 'reset':
      result.revokedRoles = resetInvitations(sharing, args.role);
      break;
    case 'role':
    case 'remove':
    case 'restore':
    case 'forget':
      result.revokedMemberIds = changeMember(sharing, action, args);
      break;
    default:
      throw new StudioError('INVALID_ARGUMENT', '不支持的分享操作。');
  }

  return result;
}

type ShareAccess = { role?: GuestRole; reason?: ShareAccessReason };

function memberAccess(sharing: SharingState, member: SharingMember): ShareAccess {
  if (!roleOn(sharing, member.role)) {
    return { reason: 'link-disabled' };
  }
  if (sharing.tokens[member.role] !== member.roleToken) {
    return { reason: 'link-reset' };
  }

  return { role: member.role };
}

function matchInvitation(sharing: SharingState, token: string): GuestRole | undefined {
  for (const role of SHARE_ROLES) {
    const expected = sharing.tokens[role];
    if (
      expected &&
      Buffer.byteLength(expected) === Buffer.byteLength(token) &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(token))
    ) {
      return role;
    }
  }
}

function assignedAccess(
  sharing: SharingState,
  member: SharingMember,
  token: string,
  invitedRole: GuestRole | undefined,
): ShareAccess {
  const access = memberAccess(sharing, member);
  if (access.reason) {
    return access;
  }

  return member.credential === token || invitedRole !== undefined
    ? access
    : { reason: 'invalid-link' };
}

export function shareAccess(
  artifact: ArtifactMetadata,
  sharing: SharingState,
  token: string | undefined,
  memberId?: string,
): ShareAccess {
  if (!sharing.enabled || artifact.trashedAt) {
    return { reason: 'sharing-closed' };
  }

  const member = memberId ? sharing.members?.[memberId] : undefined;
  if (member?.removed) {
    return { reason: 'removed' };
  }
  if (!token) {
    return member ? memberAccess(sharing, member) : { reason: 'invalid-link' };
  }
  if (token.length > 200) {
    return { reason: 'invalid-link' };
  }

  const matchedRole = matchInvitation(sharing, token);
  const invitedRole = matchedRole && roleOn(sharing, matchedRole) ? matchedRole : undefined;
  if (member?.ownerAssigned) {
    return assignedAccess(sharing, member, token, invitedRole);
  }
  if (invitedRole) {
    return { role: invitedRole };
  }
  if (matchedRole) {
    return { reason: 'link-disabled' };
  }

  return { reason: sharing.retiredTokens?.[tokenKey(token)] ?? 'invalid-link' };
}

export function shareRole(
  artifact: ArtifactMetadata,
  sharing: SharingState,
  token: string | undefined,
  memberId?: string,
): GuestRole | undefined {
  return shareAccess(artifact, sharing, token, memberId).role;
}

export function joinSharingMember(
  artifact: ArtifactMetadata,
  sharing: SharingState,
  token: string | undefined,
  id: string,
  name: string,
): Actor | undefined {
  const role = shareRole(artifact, sharing, token, id);
  if (!role) {
    return;
  }

  sharing.members ??= {};
  const current = sharing.members[id];
  const now = new Date().toISOString();
  if (!current && token) {
    sharing.members[id] = {
      id,
      name,
      role,
      credential: token,
      roleToken: sharing.tokens[role]!,
      grantId: newToken(),
      joinedAt: now,
      lastSeenAt: now,
    };
  } else {
    if (!current) {
      return;
    }

    if (!current.ownerAssigned && token) {
      current.role = role;
      current.roleToken = sharing.tokens[role]!;
      current.credential = token;
    }

    current.name = name;
    current.lastSeenAt = now;
  }

  return { id, name, kind: 'human', role };
}

export function revokeSharing(sharing: SharingState): void {
  retireTokens(sharing, SHARE_ROLES, 'sharing-closed');
  sharing.enabled = false;
  sharing.access = 'local';
  sharing.tokens = {};
  sharing.members = {};
  sharing.generation++;
}
