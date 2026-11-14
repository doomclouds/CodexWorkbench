import { randomBytes, timingSafeEqual } from 'node:crypto';
import { LOCAL_ACTOR, type Actor, type Presence, type Role } from '../../contracts/studio.js';
import { assertAlive, copy, requireRole, safeId, StudioError } from './common.js';
import type { ArtifactMetadata, SharingState } from './model.js';

export const SHARE_ROLES = ['editor', 'commenter', 'viewer'] as const;
type GuestRole = Exclude<Role, 'owner'>;
const newToken = () => randomBytes(24).toString('base64url');
const roleOn = (sharing: SharingState, role: GuestRole) => sharing.roleEnabled?.[role] !== false;
function checkedRole(role: unknown): GuestRole {
  if (!SHARE_ROLES.includes(role as GuestRole)) throw new StudioError('INVALID_ARGUMENT', '分享角色无效。');
  return role as GuestRole;
}
export function shareInfo(artifactId: string, sharing: SharingState, origin: string, peers: Presence[] = []) {
  const roleEnabled = Object.fromEntries(SHARE_ROLES.map(role => [role, roleOn(sharing, role)]));
  const members = Object.values(sharing.members ?? {}).filter(member => !member.removed && sharing.tokens[member.role] === member.roleToken).map(({ credential: _credential, roleToken: _roleToken, ownerAssigned: _ownerAssigned, removed: _removed, ...member }) => ({
    ...copy(member), active: sharing.enabled && roleOn(sharing, member.role),
    online: sharing.enabled && roleOn(sharing, member.role) && peers.some(peer => peer.actor.id === member.id && peer.actor.role === member.role),
  })).sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeenAt.localeCompare(a.lastSeenAt));
  return { enabled: sharing.enabled, generation: sharing.generation, links: sharing.enabled ? Object.fromEntries(SHARE_ROLES.filter(role => roleOn(sharing, role)).map(role => [role, `${origin}/?${new URLSearchParams({ artifactId, share: sharing.tokens[role] ?? '' })}`])) : {}, roles: [...SHARE_ROLES], roleEnabled, members, owner: copy(LOCAL_ACTOR) };
}
export function updateSharing(artifact: ArtifactMetadata, sharing: SharingState, action: string, actor: Actor, args: Record<string, unknown>): { revokedRoles: GuestRole[]; revokedMemberIds: string[] } {
  requireRole(actor, ['owner']); assertAlive(artifact);
  const result = { revokedRoles: [] as GuestRole[], revokedMemberIds: [] as string[] };
  if (action === 'start') {
    if (!sharing.enabled) { sharing.tokens = Object.fromEntries(SHARE_ROLES.map(role => [role, newToken()])); sharing.members = {}; sharing.generation++; }
    sharing.enabled = true; return result;
  }
  if (action === 'stop') { revokeSharing(sharing); result.revokedRoles = [...SHARE_ROLES]; return result; }
  if (action === 'link') {
    const role = checkedRole(args.role);
    if (typeof args.on !== 'boolean') throw new StudioError('INVALID_ARGUMENT', '请指定链接启用状态。');
    sharing.tokens[role] ??= newToken(); sharing.roleEnabled ??= {}; sharing.roleEnabled[role] = args.on;
    sharing.generation++; if (!args.on) result.revokedRoles = [role]; return result;
  }
  if (action === 'reset') {
    const roles = args.role === undefined || args.role === 'all' ? [...SHARE_ROLES] : [checkedRole(args.role)];
    for (const role of roles) sharing.tokens[role] = newToken(); sharing.generation++;
    result.revokedRoles = roles; return result;
  }
  if (action === 'role' || action === 'remove') {
    const id = safeId(args.memberId, '成员 ID'), member = sharing.members && Object.hasOwn(sharing.members, id) ? sharing.members[id] : undefined;
    if (!member || member.removed || sharing.tokens[member.role] !== member.roleToken) throw new StudioError('NOT_FOUND', '成员不存在。');
    if (action === 'role') {
      const role = checkedRole(args.role);
      if (!roleOn(sharing, role) || !sharing.tokens[role]) throw new StudioError('INVALID_ARGUMENT', '请先启用该角色的邀请链接。');
      member.role = role; member.roleToken = sharing.tokens[role]!; member.ownerAssigned = true;
    } else member.removed = true;
    sharing.generation++; result.revokedMemberIds = [id]; return result;
  }
  throw new StudioError('INVALID_ARGUMENT', '不支持的分享操作。');
}
export function shareRole(artifact: ArtifactMetadata, sharing: SharingState, token: string, memberId?: string): GuestRole | undefined {
  if (!sharing.enabled || artifact.trashedAt || token.length > 200) return;
  const member = memberId ? sharing.members?.[memberId] : undefined;
  // Removal belongs to the signed identity, not just the invitation most recently presented.
  if (member?.removed) return;
  let invitedRole: GuestRole | undefined;
  for (const role of SHARE_ROLES) {
    const expected = sharing.tokens[role];
    if (roleOn(sharing, role) && expected && Buffer.byteLength(expected) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(expected), Buffer.from(token))) { invitedRole = role; break; }
  }
  // An owner's assignment survives switching invitations and follows its assigned link lifecycle.
  if (member?.ownerAssigned) return roleOn(sharing, member.role) && sharing.tokens[member.role] === member.roleToken && (member.credential === token || invitedRole !== undefined) ? member.role : undefined;
  return invitedRole;
}
export function joinSharingMember(artifact: ArtifactMetadata, sharing: SharingState, token: string, id: string, name: string): Actor | undefined {
  const role = shareRole(artifact, sharing, token, id); if (!role) return;
  sharing.members ??= {}; const current = sharing.members[id], now = new Date().toISOString();
  if (!current) sharing.members[id] = { id, name, role, credential: token, roleToken: sharing.tokens[role]!, joinedAt: now, lastSeenAt: now };
  else {
    if (!current.ownerAssigned) { current.role = role; current.roleToken = sharing.tokens[role]!; current.credential = token; }
    current.name = name; current.lastSeenAt = now;
  }
  return { id, name, kind: 'human', role };
}
export function revokeSharing(sharing: SharingState): void { sharing.enabled = false; sharing.tokens = {}; sharing.members = {}; sharing.generation++; }
