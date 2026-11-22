import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  createStudioService,
  type ComposedStudioService,
} from '../../src/server/studio-composition.js';
import { LOCAL_ACTOR, type Actor, type Board, type Feedback } from '../../src/contracts/studio.js';
import {
  applyTodoOperations,
  normalizeTodoItems,
  type TodoItem,
  type TodoOperation,
} from '../../src/contracts/todo.js';

const item = (id: string, text = id): TodoItem => ({ id, text, checked: false });
const rows = [
  {
    ...item('design', '核对接口'),
    sourceRef: { elementId: 'source', blockId: 'plan', version: 1 },
  },
  item('release', '发布版本'),
];

describe('canonical Todo operations', () => {
  it('normalizes unchecked rows and applies identity-preserving insertion, moves and partial updates', () => {
    expect(normalizeTodoItems([{ id: 'one', text: '' }])).toEqual([item('one', '')]);
    const next = applyTodoOperations(rows, [
      { op: 'insert', item: item('append') },
      { op: 'insert', item: item('first'), afterId: null },
      { op: 'update', id: 'design', changes: { checked: true } },
      { op: 'move', id: 'release', afterId: 'append' },
      { op: 'delete', id: 'first' },
    ]);
    expect(next).toEqual([{ ...rows[0], checked: true }, item('append'), rows[1]]);
    expect(
      applyTodoOperations(next, [
        { op: 'update', id: 'design', changes: { text: '更新标题', sourceRef: null } },
      ])[0],
    ).toEqual({ id: 'design', text: '更新标题', checked: true });
    expect(rows[0]!.checked).toBe(false);
  });

  it('rejects unstable identities, invalid source references and oversized UTF-8 rows', () => {
    expect(() => normalizeTodoItems([item('bad id')])).toThrow();
    expect(() => normalizeTodoItems([item('one'), item('one')])).toThrow();
    expect(() => normalizeTodoItems([item('one', '任'.repeat(667))])).toThrow();
    expect(() =>
      normalizeTodoItems([
        { ...item('one'), sourceRef: { elementId: 'source', blockId: 'a', itemId: 'b' } },
      ]),
    ).toThrow();
    expect(() =>
      normalizeTodoItems(Array.from({ length: 201 }, (_, index) => item('row-' + index))),
    ).toThrow();
    expect(() =>
      applyTodoOperations(rows, [{ op: 'move', id: 'release', afterId: 'missing' }]),
    ).toThrow();
    expect(() =>
      applyTodoOperations(rows, [
        { op: 'delete', id: 'design' },
        { op: 'insert', item: item('design') },
      ]),
    ).toThrow();
  });
});

describe('Todo service contracts', () => {
  let directory: string;
  let service: ComposedStudioService;
  let artifactId: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'studio-todo-'));
    service = createStudioService({ dataRoot: directory });
    const created = await service.execute('artifact_manage', {
      action: 'create',
      title: '任务清单验证',
      elements: [
        {
          id: 'list',
          type: 'todo',
          text: '发布准备',
          x: 100,
          y: 80,
          w: 480,
          h: 300,
          locked: true,
          data: { items: rows },
        },
        { id: 'other', type: 'note', text: '独立区域', x: 800, y: 80, w: 200, h: 100 },
      ],
    });
    artifactId = created.artifact.id;
  });
  afterEach(async () => {
    await service.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
      throw new Error('Unexpected test directory');
    }

    await rm(directory, { recursive: true, force: true });
  });

  const patch = (
    operations: TodoOperation[],
    version = 1,
    actor = LOCAL_ACTOR,
    extra: Record<string, unknown> = {},
  ) =>
    service.execute(
      'artifact_apply',
      {
        artifactId,
        expectedVersions: { list: version },
        operations: [{ op: 'todo', id: 'list', data: { operations } }],
        ...extra,
      },
      actor,
    );
  const read: () => Promise<Board> = () =>
    service.execute('artifact_read', { artifactId, mode: 'objects', ids: ['list', 'other'] });
  const readRows = (extra: Record<string, unknown> = {}) =>
    service.execute('artifact_read', { artifactId, mode: 'tasks', elementId: 'list', ...extra });

  it('persists a scoped patch and supports bounded filters without changing the title, geometry or unrelated elements', async () => {
    const before = await read();
    const update: TodoOperation[] = [{ op: 'update', id: 'design', changes: { checked: true } }];
    const written = await patch(update, 1, LOCAL_ACTOR, { operationId: 'mark-one-done' });
    expect(written.board.elements[0]).toMatchObject({
      id: 'list',
      text: '发布准备',
      x: 100,
      y: 80,
      w: 480,
      h: 300,
      locked: true,
      version: 2,
    });
    expect(written.board.elements[1]).toEqual(before.elements[1]);
    expect(written.board.elements[0].data.items[0]).toEqual({ ...rows[0], checked: true });
    const retry = await patch(update, 1, LOCAL_ACTOR, { operationId: 'mark-one-done' });
    expect(retry.board.artifact.revision).toBe(written.board.artifact.revision);
    await patch(update, 2);
    expect((await read()).elements[0]!.version).toBe(2);
    expect(await readRows({ limit: 1 })).toMatchObject({
      items: [{ id: 'design' }],
      totalCount: 2,
      totalItems: 2,
      completedCount: 1,
      nextOffset: 1,
    });
    expect(await readRows({ itemIds: ['release'], checked: false })).toMatchObject({
      items: [rows[1]],
      totalCount: 1,
      totalItems: 2,
    });
    expect(await readRows({ offset: 1, limit: 1 })).toMatchObject({
      items: [rows[1]],
      totalCount: 2,
    });
    await expect(readRows({ limit: 21 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const reopened = createStudioService({ dataRoot: directory });
    try {
      const saved = await reopened.execute('artifact_read', {
        artifactId,
        mode: 'tasks',
        elementId: 'list',
        checked: true,
      });
      expect(saved.items).toEqual([{ ...rows[0], checked: true }]);
    } finally {
      await reopened.close();
    }
  });

  it('requires permissions, CAS and the Agent scope and leaves failed batches intact', async () => {
    const update: TodoOperation[] = [{ op: 'update', id: 'design', changes: { checked: true } }];
    const viewer: Actor = { id: 'viewer', name: 'Viewer', kind: 'human', role: 'viewer' };
    await expect(patch(update, 1, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const agent: Actor = { id: 'agent', name: 'Task Agent', kind: 'agent', role: 'owner' };
    await expect(patch(update, 1, agent)).rejects.toMatchObject({ code: 'TASK_REQUIRED' });
    const task = (
      await service.execute(
        'artifact_activity',
        { artifactId, action: 'begin', taskId: 'todo-task', scope: { ids: ['other'] } },
        agent,
      )
    ).tasks[0];
    await expect(
      patch(update, 1, agent, { taskId: task.taskId, generation: task.generation }),
    ).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    await service.execute(
      'artifact_activity',
      {
        artifactId,
        action: 'end',
        taskId: task.taskId,
        generation: task.generation,
        outcome: 'completed',
      },
      agent,
    );
    await expect(patch([...update, { op: 'delete', id: 'missing' }])).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await readRows()).items).toEqual(rows);
    await expect(
      service.execute('artifact_apply', {
        artifactId,
        expectedVersions: { list: 1 },
        operations: [{ op: 'update', id: 'list', changes: { data: { items: [] } } }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      service.execute('artifact_apply', {
        artifactId,
        expectedVersions: { list: 1 },
        operations: [{ op: 'update', id: 'list', changes: { x: 200 } }],
      }),
    ).rejects.toMatchObject({ code: 'LOCKED' });
    const results = await Promise.allSettled([
      patch(update),
      patch([{ op: 'update', id: 'release', changes: { checked: true } }]),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({ code: 'CONFLICT' });
  });

  it('safely undoes an atomic row update while retaining a later edit to a different row', async () => {
    const changed = await patch([{ op: 'update', id: 'design', changes: { checked: true } }]);
    const editor: Actor = { id: 'second-editor', name: 'Editor', kind: 'human', role: 'editor' };
    await patch([{ op: 'update', id: 'release', changes: { text: '新的发布标题' } }], 2, editor);
    await service.execute('artifact_apply', {
      artifactId,
      expectedRevision: 2,
      operations: [{ op: 'restore', versionId: changed.historyEntry.id, data: { mode: 'undo' } }],
    });
    expect((await readRows()).items).toEqual([rows[0], item('release', '新的发布标题')]);
    expect((await read()).elements[0]).toMatchObject({
      x: 100,
      y: 80,
      w: 480,
      h: 300,
      locked: true,
    });
  });

  it('freezes one exact row and retains its anchor through moving, deleting, restoring and archive import', async () => {
    const anchor = {
      coordinateSpace: 'todo' as const,
      elementIds: ['list'],
      itemId: 'design',
      sourceVersion: 1,
      quote: '核对接口',
      pin: { coordinateSpace: 'todo' as const, x: 0.2, y: 0.8 },
    };
    const created = await service.execute('artifact_feedback', {
      artifactId,
      action: 'create',
      text: '明确接口要求',
      anchor,
      versions: { list: 1 },
    });
    const feedback: Feedback = created.feedback[0];
    expect(feedback.anchor).toEqual(anchor);
    await expect(
      service.execute('artifact_feedback', {
        artifactId,
        action: 'create',
        text: '引用错版本',
        anchor,
        versions: { list: 2 },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      service.execute('artifact_feedback', {
        artifactId,
        action: 'create',
        text: '引用错对象',
        anchor: { ...anchor, elementIds: ['other'] },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const moved = await patch([{ op: 'move', id: 'design', afterId: 'release' }]);
    await patch([{ op: 'delete', id: 'design' }], 2);
    expect((await readRows()).items).toEqual([rows[1]]);
    expect(await readRows({ feedbackId: feedback.id })).toMatchObject({
      version: 1,
      items: [rows[0]],
      totalItems: 1,
    });
    await service.execute('artifact_apply', {
      artifactId,
      expectedVersions: { list: 3 },
      operations: [{ op: 'restore', id: 'list', versionId: moved.historyEntry.id }],
    });
    expect((await readRows()).items).toEqual([rows[1], rows[0]]);
    const exported = await service.execute('artifact_export', { artifactId, format: 'zip' });
    const imported = await service.importArchive((await service.getExport(exported.exportId)).data);
    const saved = await service.execute('artifact_feedback', {
      artifactId: imported.artifact.id,
      action: 'get',
      feedbackId: feedback.id,
    });
    expect(saved.feedback[0].anchor).toEqual(anchor);
    const frozen = await service.execute('artifact_read', {
      artifactId: imported.artifact.id,
      mode: 'tasks',
      elementId: 'list',
      feedbackId: feedback.id,
    });
    expect(frozen).toMatchObject({ version: 1, items: [rows[0]], totalItems: 1 });
  });
});
