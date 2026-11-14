import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Actor, Role } from '../../contracts/studio.js';

export class StudioError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) { super(message); this.name = 'StudioError'; }
}
export const copy = <T>(value: T): T => structuredClone(value);
export const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const same = (before: unknown, after: unknown) => JSON.stringify(before) === JSON.stringify(after);
export function safeId(value: unknown, label = '作品 ID'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value)) throw new StudioError('INVALID_ARGUMENT', `${label}无效。`);
  return value;
}
export function text(value: unknown, fallback = '', maximum = 20_000): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > maximum) throw new StudioError('INVALID_ARGUMENT', '文字内容无效或过长。');
  return value;
}
export function finite(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10_000_000) throw new StudioError('INVALID_ARGUMENT', '坐标或尺寸无效。');
  return value;
}
export function requireRole(actor: Actor, roles: readonly Role[]): void {
  if (!roles.includes(actor.role)) throw new StudioError('FORBIDDEN', '当前身份没有此操作权限。');
}
export function assertAlive(artifact: { trashedAt?: string }): void {
  if (artifact.trashedAt) throw new StudioError('TRASHED', '作品已在回收站，请先恢复。');
}
export async function atomicWrite(file: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = join(dirname(file), `.${randomUUID()}.tmp`);
  try { await writeFile(temporary, content, { flag: 'wx' }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
