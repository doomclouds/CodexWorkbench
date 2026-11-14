import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioService } from '../src/core/service.js';
import { LOCAL_ACTOR, type Actor, type Board, type HistoryEntry, type Operation } from '../src/contracts/studio.js';

const agent: Actor = { id: 'codex', name: 'Codex', kind: 'agent', role: 'owner' };
const editor: Actor = { id: 'editor-1', name: '同事', kind: 'human', role: 'editor' };
const commenter: Actor = { id: 'commenter-1', name: '评论者', kind: 'human', role: 'commenter' };
const viewer: Actor = { id: 'viewer-1', name: '查看者', kind: 'human', role: 'viewer' };
let directory: string, service: StudioService;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'agentero-studio-service-')); service = new StudioService({ dataRoot: directory }); });
afterEach(async () => { await service.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory'); await rm(directory, { recursive: true, force: true }); });
async function create(title = '架构讨论') { return (await service.execute('artifact_manage', { action: 'create', title })).board as Board; }
async function apply(board: Board, operations: Operation[], actor = LOCAL_ACTOR, extra: Record<string, unknown> = {}) {
  return await service.execute('artifact_apply', { artifactId: board.artifact.id, operationId: randomUUID(), expectedRevision: board.artifact.revision, operations, ...extra }, actor) as { board: Board; historyEntry: HistoryEntry };
}

describe('Studio work and content persistence', () => {
  it('creates, lists, searches, renames, pins, trashes and restores stable works', async () => {
    const board = await create();
    expect(board.artifact.revision).toBe(0);
    expect((await service.execute('artifact_list', { query: '架构' })).artifacts[0].id).toBe(board.artifact.id);
    await service.execute('artifact_manage', { action: 'rename', artifactId: board.artifact.id, title: '新版架构' });
    await service.execute('artifact_manage', { action: 'pin', artifactId: board.artifact.id, pinned: true });
    expect((await service.execute('artifact_list', {})).artifacts[0]).toMatchObject({ id: board.artifact.id, title: '新版架构', pinned: true });
    await service.execute('artifact_manage', { action: 'trash', artifactId: board.artifact.id });
    expect((await service.execute('artifact_list', {})).artifacts).toHaveLength(0);
    expect((await service.execute('artifact_list', { trashed: true })).artifacts).toHaveLength(1);
    await service.execute('artifact_manage', { action: 'restore', artifactId: board.artifact.id });
    const other = new StudioService({ dataRoot: directory });
    try { expect((await other.execute('artifact_read', { artifactId: board.artifact.id })).artifact.title).toBe('新版架构'); } finally { await other.close(); }
  });
  it('duplicates the scene into a new independent artifact', async () => {
    const original = await create();
    const { board } = await apply(original, [{ op: 'add', element: { id: 'node-a', type: 'text', text: '原文' } }]);
    const duplicate = await service.execute('artifact_manage', { action: 'duplicate', artifactId: original.artifact.id });
    expect(duplicate.artifact.id).not.toBe(original.artifact.id);
    await apply(duplicate.board, [{ op: 'update', id: 'node-a', changes: { text: '副本' } }]);
    expect((await service.execute('artifact_read', { artifactId: board.artifact.id })).elements[0].text).toBe('原文');
  });
  it('validates an entire batch before committing and removes only requested objects', async () => {
    const original = await create();
    await expect(apply(original, [{ op: 'add', element: { id: 'a', type: 'text' } }, { op: 'update', id: 'missing', changes: { text: 'bad' } }])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await service.execute('artifact_read', { artifactId: original.artifact.id })).elements).toHaveLength(0);
    let { board } = await apply(original, [{ op: 'add', element: { id: 'a', type: 'text' } }, { op: 'add', element: { id: 'b', type: 'text' } }]);
    ({ board } = await apply(board, [{ op: 'update', id: 'a', changes: { text: '保留' } }, { op: 'delete', id: 'b' }]));
    expect(board.elements).toHaveLength(1); expect(board.elements[0]?.text).toBe('保留');
  });
  it('returns the original result for a retried operation without applying it twice', async () => {
    const original = await create(), operationId = randomUUID();
    const args = { artifactId: original.artifact.id, operationId, expectedRevision: 0, operations: [{ op: 'add', element: { id: 'a', type: 'text' } }] };
    const first = await service.execute('artifact_apply', args), again = await service.execute('artifact_apply', args);
    expect(again).toEqual(first);
    expect((await service.execute('artifact_read', { artifactId: original.artifact.id, mode: 'history' })).history).toHaveLength(2);
    await expect(service.execute('artifact_apply', { ...args, operations: [{ op: 'delete', id: 'a' }] })).rejects.toMatchObject({ code: 'OPERATION_REUSED' });
  });
  it('checks object versions and accepts independent-object work from an older scene', async () => {
    const original = await create();
    const { board } = await apply(original, [{ op: 'add', element: { id: 'a', type: 'text' } }, { op: 'add', element: { id: 'b', type: 'text' } }]);
    await apply(board, [{ op: 'update', id: 'a', changes: { text: 'A' } }]);
    await expect(apply(board, [{ op: 'update', id: 'a', changes: { text: '覆盖' } }], agent, { expectedVersions: { a: 1 } })).rejects.toMatchObject({ code: 'CONFLICT' });
    const independent = await apply(board, [{ op: 'update', id: 'b', changes: { text: 'B' } }], editor, { expectedVersions: { b: 1 } });
    expect(independent.board.elements.map(item => item.text)).toEqual(['A', 'B']);
  });
  it('serializes two service instances on the same data directory', async () => {
    const original = await create(), other = new StudioService({ dataRoot: directory });
    try {
      const attempts = await Promise.allSettled([service, other].map((instance, index) => instance.execute('artifact_apply', { artifactId: original.artifact.id, operationId: randomUUID(), expectedRevision: 0, operations: [{ op: 'add', element: { id: `node-${index}`, type: 'text' } }] })));
      expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
      expect((await service.execute('artifact_read', { artifactId: original.artifact.id })).elements).toHaveLength(1);
    } finally { await other.close(); }
  });
  it('records preview/diff and restores as a new revision without truncating history', async () => {
    const original = await create();
    const first = await apply(original, [{ op: 'add', element: { id: 'a', type: 'text', text: '一' } }], agent, { summary: '生成图解' });
    const second = await apply(first.board, [{ op: 'update', id: 'a', changes: { text: '二' } }], editor);
    const preview = await service.execute('artifact_read', { artifactId: original.artifact.id, mode: 'version', versionId: first.historyEntry.id });
    expect(preview.board.elements[0].text).toBe('一');
    const diff = await service.execute('artifact_read', { artifactId: original.artifact.id, mode: 'diff', fromVersionId: first.historyEntry.id });
    expect(diff.changes[0].after.text).toBe('二');
    const restored = await apply(second.board, [{ op: 'restore', versionId: first.historyEntry.id }]);
    expect(restored.board.elements[0]?.text).toBe('一'); expect(restored.board.artifact.revision).toBe(3);
    const history = (await service.execute('artifact_read', { artifactId: original.artifact.id, mode: 'history' })).history;
    expect(history).toHaveLength(4); expect(history[1]).toMatchObject({ actor: agent, summary: '生成图解' });
    expect(history.at(-1).restoredFrom).toBe(first.historyEntry.id);
  });
  it('undoes only its own transaction and refuses to overwrite later changes', async () => {
    const original = await create();
    const first = await apply(original, [{ op: 'add', element: { id: 'a', type: 'text', text: '一' } }]);
    const second = await apply(first.board, [{ op: 'update', id: 'a', changes: { text: '别人的更新' } }], editor);
    await expect(apply(second.board, [{ op: 'restore', versionId: first.historyEntry.id, data: { mode: 'undo' } }])).rejects.toMatchObject({ code: 'CONFLICT' });
    const own = await apply(second.board, [{ op: 'add', element: { id: 'b', type: 'text' } }]);
    const undone = await apply(own.board, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }]);
    expect(undone.board.elements.map(item => item.id)).toEqual(['a']); expect(undone.board.elements[0]?.text).toBe('别人的更新');
  });
});

describe('HTML feedback, sharing and scope', () => {
  it('keeps an HTML source revision stable across geometry moves and freezes the original source', async () => {
    const original = await create();
    let { board } = await apply(original, [{ op: 'add', element: { id: 'html-a', type: 'html', html: '<h1 data-studio-id="heading">原始标题</h1>' } }]);
    const revision = board.elements[0]!.sourceRevision;
    ({ board } = await apply(board, [{ op: 'update', id: 'html-a', changes: { x: 600, w: 1000 } }]));
    expect(board.elements[0]!.sourceRevision).toBe(revision);
    const created = await service.execute('artifact_feedback', { action: 'create', artifactId: board.artifact.id, type: 'request', text: '把标题调小', anchor: { regionId: 'html-a', targetIds: ['heading'], sourceRevision: revision, quote: '原始标题', excerpt: '<h1>原始标题</h1>' } }, commenter);
    board = await service.execute('artifact_read', { artifactId: board.artifact.id });
    ({ board } = await apply(board, [{ op: 'update', id: 'html-a', changes: { html: '<h2>改过的标题</h2>' } }], agent));
    expect(board.elements[0]!.sourceRevision).toBe(Number(revision) + 1);
    const frozen = await service.execute('artifact_read', { mode: 'source', artifactId: board.artifact.id, feedbackId: created.contextId, regionId: 'html-a' });
    expect(frozen.html).toContain('原始标题'); expect(frozen.sourceRevision).toBe(revision);
    const live = await service.execute('artifact_read', { mode: 'source', artifactId: board.artifact.id, regionId: 'html-a' }); expect(live.html).toContain('改过的标题');
    const pending = await service.execute('artifact_feedback', { action: 'send', artifactId: board.artifact.id, feedbackId: created.contextId }, commenter);
    expect(pending.feedback[0].status).toBe('pending');
    expect((await service.execute('artifact_read', { mode: 'context', artifactId: board.artifact.id, contextId: created.contextId })).sources[0].html).toContain('原始标题');
  });
  it('supports reply/resolution and rejects viewer writes and commenter editing', async () => {
    const board = await create();
    await expect(apply(board, [{ op: 'add', element: { type: 'text' } }], commenter)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.execute('artifact_feedback', { artifactId: board.artifact.id, action: 'create', text: '不允许' }, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const result = await service.execute('artifact_feedback', { artifactId: board.artifact.id, action: 'create', text: '讨论' }, commenter), feedbackId = result.contextId;
    await service.execute('artifact_feedback', { artifactId: board.artifact.id, action: 'reply', feedbackId, text: '已修改' }, agent);
    const resolved = await service.execute('artifact_feedback', { artifactId: board.artifact.id, action: 'resolve', feedbackId }, commenter);
    expect(resolved.feedback[0]).toMatchObject({ status: 'resolved', replies: [{ text: '已修改', author: agent }] });
    expect((await service.execute('artifact_feedback', { artifactId: board.artifact.id, action: 'reopen', feedbackId }, commenter)).feedback[0].status).toBe('open');
  });
  it('revokes old role links on reset and all links on stop and restart', async () => {
    const board = await create(), id = board.artifact.id;
    const started = await service.execute('artifact_share', { artifactId: id, action: 'start' });
    const editorToken = new URL(started.links.editor, 'http://localhost').searchParams.get('share')!;
    const viewerToken = new URL(started.links.viewer, 'http://localhost').searchParams.get('share')!;
    expect(await service.shareRole(id, editorToken)).toBe('editor');
    await service.execute('artifact_share', { artifactId: id, action: 'reset', role: 'editor' });
    expect(await service.shareRole(id, editorToken)).toBeUndefined(); expect(await service.shareRole(id, viewerToken)).toBe('viewer');
    await service.execute('artifact_share', { artifactId: id, action: 'stop' }); expect(await service.shareRole(id, viewerToken)).toBeUndefined();
    await service.execute('artifact_share', { artifactId: id, action: 'start' }); expect(await service.shareRole(id, viewerToken)).toBeUndefined();
    await expect(service.execute('artifact_share', { artifactId: id }, editor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('broadcasts commits and stores view contexts separately from content', async () => {
    const board = await create(), events: string[] = [], unsubscribe = service.subscribe(board.artifact.id, event => events.push(event.type));
    await service.updatePresence(board.artifact.id, { peerId: 'peer-one', context: { viewId: 'view-one', artifactId: board.artifact.id, selectedIds: [], viewport: { x: 0, y: 0, zoom: 1 } }, cursor: { x: 10, y: 20 } }, editor);
    expect((await service.execute('artifact_read', { artifactId: board.artifact.id })).artifact.revision).toBe(0);
    expect((await service.execute('artifact_read', { artifactId: board.artifact.id, mode: 'context' })).contexts[0].viewId).toBe('view-one');
    await apply(board, [{ op: 'add', element: { type: 'text' } }]); unsubscribe();
    expect(events).toEqual(['presence', 'board']);
  });
});
