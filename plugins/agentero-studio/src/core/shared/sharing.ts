import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Actor, Role } from '../../contracts/studio.js';
import { assertAlive, requireRole, StudioError } from './common.js';
import type { ArtifactMetadata, SharingState } from './model.js';

export const SHARE_ROLES = ['editor', 'commenter', 'viewer'] as const;
export function shareInfo(artifactId: string, sharing: SharingState, origin: string) {
  return { enabled: sharing.enabled, generation: sharing.generation, links: sharing.enabled ? Object.fromEntries(SHARE_ROLES.map(role => [role, `${origin}/?${new URLSearchParams({ artifactId, share: sharing.tokens[role] ?? '' })}`])) : {}, roles: [...SHARE_ROLES] };
}
export function updateSharing(artifact: ArtifactMetadata, sharing: SharingState, action: string, actor: Actor, role?: unknown): readonly string[] {
  requireRole(actor, ['owner']); assertAlive(artifact);
  if (action === 'start') {
    if (!sharing.enabled) { sharing.tokens = Object.fromEntries(SHARE_ROLES.map(value => [value, randomBytes(24).toString('base64url')])); sharing.generation++; }
    sharing.enabled = true; return [];
  }
  if (action === 'stop') { sharing.enabled = false; sharing.generation++; return SHARE_ROLES; }
  if (action === 'reset') {
    const roles = role === undefined || role === 'all' ? SHARE_ROLES : SHARE_ROLES.filter(value => value === role);
    if (!roles.length) throw new StudioError('INVALID_ARGUMENT', '分享角色无效。');
    for (const value of roles) sharing.tokens[value] = randomBytes(24).toString('base64url'); sharing.generation++;
    return roles;
  }
  throw new StudioError('INVALID_ARGUMENT', '不支持的分享操作。');
}
export function shareRole(artifact: ArtifactMetadata, sharing: SharingState, token: string): Exclude<Role, 'owner'> | undefined {
  if (!sharing.enabled || artifact.trashedAt || token.length > 200) return;
  for (const role of SHARE_ROLES) {
    const expected = sharing.tokens[role];
    if (expected && Buffer.byteLength(expected) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return role;
  }
}
export function revokeSharing(sharing: SharingState): void { sharing.enabled = false; sharing.tokens = {}; sharing.generation++; }
