import { randomUUID } from 'node:crypto';
import type { Actor } from '../../contracts/studio.js';
import { copy, requireRole, StudioError, text } from './common.js';
import { createState, makeHistory } from './history.js';
import type { ArtifactState } from './model.js';

export function createArtifact<C, A = unknown, S = unknown>(type: string, title: string, content: C, actor: Actor, summary: string, changedIds: string[]): ArtifactState<C, A, S> {
  requireRole(actor, ['owner']);
  const now = new Date().toISOString(), name = text(title, '', 200).trim();
  if (!name) throw new StudioError('INVALID_ARGUMENT', '作品名称不能为空。');
  return createState({ id: randomUUID(), type, title: name, revision: 0, createdAt: now, updatedAt: now, pinned: false }, content, actor, summary, changedIds);
}
export function manageArtifact<C, A, S>(state: ArtifactState<C, A, S>, action: string, args: Record<string, unknown>, actor: Actor): void {
  requireRole(actor, ['owner']);
  if (args.expectedRevision !== undefined && args.expectedRevision !== state.artifact.revision) throw new StudioError('CONFLICT', '作品已被修改，请刷新后重试。', { revision: state.artifact.revision });
  if (action === 'rename') { const title = text(args.title, '', 200).trim(); if (!title) throw new StudioError('INVALID_ARGUMENT', '作品名称不能为空。'); state.artifact.title = title; }
  else if (action === 'pin') state.artifact.pinned = args.pinned === undefined ? !state.artifact.pinned : Boolean(args.pinned);
  else if (action === 'trash') { state.artifact.trashedAt = new Date().toISOString(); state.sharing.enabled = false; state.sharing.generation++; }
  else if (action === 'restore') delete state.artifact.trashedAt;
  else throw new StudioError('INVALID_ARGUMENT', '不支持的作品管理操作。');
  makeHistory(state, actor, ({ rename: '重命名作品', pin: '调整固定状态', trash: '移入回收站', restore: '恢复作品' } as Record<string, string>)[action]!, ['$artifact']);
}
export function listArtifacts<C, A, S>(states: ArtifactState<C, A, S>[], args: Record<string, unknown>, actor: Actor) {
  requireRole(actor, ['owner']);
  const query = text(args.query ?? args.search).trim().toLocaleLowerCase();
  let list = states.map(state => ({ ...copy(state.artifact), sharing: state.sharing.enabled })).filter(item => Boolean(item.trashedAt) === (args.trashed === true));
  if (query) list = list.filter(item => item.title.toLocaleLowerCase().includes(query));
  if (args.pinned === true) list = list.filter(item => item.pinned);
  if (Array.isArray(args.artifactIds)) list = list.filter(item => (args.artifactIds as unknown[]).includes(item.id));
  list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const start = args.cursor === undefined ? 0 : Number(args.cursor), limit = Math.min(200, Math.max(1, Number(args.limit) || 100));
  if (!Number.isInteger(start) || start < 0) throw new StudioError('INVALID_ARGUMENT', '分页位置无效。');
  return { artifacts: list.slice(start, start + limit), ...(start + limit < list.length ? { nextCursor: String(start + limit) } : {}) };
}
