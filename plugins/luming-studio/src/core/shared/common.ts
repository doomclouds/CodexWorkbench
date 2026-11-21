import type { Actor, Role } from '../../contracts/studio.js';
import { StudioError } from '../../shared/studio-error.js';

export { StudioError };
export { safeId, text } from '../../shared/studio-error.js';
export { isRecord as object } from '../../shared/is-record.js';

export const copy = <T>(value: T): T => structuredClone(value);
export const same = (before: unknown, after: unknown) =>
  JSON.stringify(before) === JSON.stringify(after);

export function finite(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10_000_000) {
    throw new StudioError('INVALID_ARGUMENT', '坐标或尺寸无效。');
  }

  return value;
}

export function requireRole(actor: Actor, roles: readonly Role[]): void {
  if (!roles.includes(actor.role)) {
    throw new StudioError('FORBIDDEN', '当前身份没有此操作权限。');
  }
}

export function assertAlive(artifact: { trashedAt?: string }): void {
  if (artifact.trashedAt) {
    throw new StudioError('TRASHED', '作品已在回收站，请先恢复。');
  }
}
