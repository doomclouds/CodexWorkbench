import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  documentPlainText,
  type DocumentBlock,
  type DocumentBlockOperation,
} from '../../src/contracts/document.js';
import type { Board, Operation } from '../../src/contracts/studio.js';
import type { TodoItem, TodoOperation } from '../../src/contracts/todo.js';
import {
  createStudioService,
  type ComposedStudioService,
} from '../../src/server/studio-composition.js';

const block = (id: string, children: DocumentBlock[] = []): DocumentBlock => ({
  id,
  type: 'paragraph',
  props: {},
  content: id,
  children,
});
const item = (id: string): TodoItem => ({ id, text: id, checked: false });
const document = (operations: DocumentBlockOperation[], id = 'doc'): Operation => ({
  op: 'document',
  id,
  data: { operations },
});
const todo = (operations: TodoOperation[], id = 'list'): Operation => ({
  op: 'todo',
  id,
  data: { operations },
});

describe('explicit native content merge', () => {
  let directory: string;
  let service: ComposedStudioService;
  let artifactId: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'luming-native-merge-'));
    service = createStudioService({ dataRoot: directory });
    const created = await service.execute('artifact_manage', {
      action: 'create',
      elements: [
        {
          id: 'doc',
          type: 'document',
          document: {
            schemaVersion: 1,
            blocks: [
              block('one'),
              block('parent', [block('child'), block('anchor')]),
              block('two'),
            ],
          },
        },
        {
          id: 'list',
          type: 'todo',
          data: { items: [item('first'), item('target'), item('last')] },
        },
        { id: 'empty', type: 'document', document: { schemaVersion: 1, blocks: [] } },
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

  function patch(
    operations: Operation[],
    expectedVersions: Record<string, number>,
    explicit = false,
  ) {
    return service.execute('artifact_apply', {
      artifactId,
      expectedVersions,
      operations,
      ...(explicit ? { merge: 'same-generation' } : {}),
    });
  }

  function read(): Promise<Board> {
    return service.execute('artifact_read', { artifactId });
  }

  async function expectNoCommit(operations: Operation[], expected: Record<string, number>) {
    const before = await read();
    await expect(patch(operations, expected, true)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await read()).toEqual(before);
  }

  it('merges disjoint document blocks and preserves the legacy stale-version rejection', async () => {
    await patch([document([{ op: 'update', id: 'one', changes: { content: 'first edit' } }])], {
      doc: 1,
    });
    const other = document([{ op: 'update', id: 'two', changes: { content: 'second edit' } }]);
    await expect(patch([other], { doc: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    const updated = await patch([other], { doc: 1 }, true);
    expect(documentPlainText(updated.board.elements[0].document)).toBe(
      'first edit\nparent\nchild\nanchor\nsecond edit',
    );
  });

  it('rejects divergent same-block edits and rolls back independent work in the batch', async () => {
    await patch([document([{ op: 'update', id: 'one', changes: { content: 'saved' } }])], {
      doc: 1,
    });
    await expectNoCommit(
      [
        document([{ op: 'update', id: 'two', changes: { content: 'independent' } }]),
        document([{ op: 'update', id: 'one', changes: { content: 'stale' } }]),
      ],
      { doc: 1 },
    );
  });

  it('records ABA for an identical replacement of a block in one operations array', async () => {
    const replaced = await patch(
      [
        document([
          { op: 'delete', id: 'one' },
          { op: 'insert', block: block('one'), afterId: null },
        ]),
      ],
      { doc: 1 },
    );
    expect(replaced.board.elements[0].version).toBeGreaterThan(1);
    await expectNoCommit([document([{ op: 'update', id: 'one', changes: { content: 'stale' } }])], {
      doc: 1,
    });
  });

  it.each([
    {
      id: 'parent',
      replacement: block('parent', [block('child'), block('anchor')]),
      position: { afterId: 'one' },
    },
    {
      id: 'anchor',
      replacement: block('anchor'),
      position: { parentId: 'parent', afterId: 'child' },
    },
  ])(
    'rejects a re-created $id even with identical content and position',
    async ({ id, replacement, position }) => {
      await patch(
        [
          document([
            { op: 'delete', id },
            { op: 'insert', block: replacement, ...position },
          ]),
        ],
        { doc: 1 },
      );
      await expectNoCommit(
        [document([{ op: 'insert', block: block('new'), parentId: 'parent', afterId: 'anchor' }])],
        { doc: 1 },
      );
    },
  );

  it('allows independently targeted gaps and rejects a changed insertion gap', async () => {
    await patch([document([{ op: 'insert', block: block('root-new'), afterId: 'one' }])], {
      doc: 1,
    });
    await expectNoCommit([document([{ op: 'insert', block: block('bad'), afterId: 'one' }])], {
      doc: 1,
    });
    await patch(
      [
        document([
          { op: 'insert', block: block('last-child'), parentId: 'parent', afterId: 'anchor' },
        ]),
      ],
      { doc: 1 },
      true,
    );
    const latest = await read();
    expect(latest.elements[0]?.document?.blocks.map(({ id }) => id)).toEqual([
      'one',
      'root-new',
      'parent',
      'two',
    ]);
    expect(latest.elements[0]?.document?.blocks[2]?.children?.at(-1)?.id).toBe('last-child');
  });

  it('treats an empty sibling list as a position and rejects a competing insert into it', async () => {
    await patch([{ op: 'update', id: 'empty', changes: { x: 40 } }], { empty: 1 });
    await patch([document([{ op: 'insert', block: block('first') }], 'empty')], { empty: 1 }, true);
    await expectNoCommit([document([{ op: 'insert', block: block('competing') }], 'empty')], {
      empty: 1,
    });
  });

  it('merges independent fields of a Todo row, then rejects conflicting changes to the same field', async () => {
    await patch([todo([{ op: 'update', id: 'target', changes: { checked: true } }])], { list: 1 });
    const text = todo([{ op: 'update', id: 'target', changes: { text: 'renamed' } }]);
    await expect(patch([text], { list: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    const saved = await patch([text], { list: 1 }, true);
    expect(saved.board.elements[1].data.items[1]).toEqual({
      id: 'target',
      text: 'renamed',
      checked: true,
    });
    await expectNoCommit(
      [
        todo([
          { op: 'update', id: 'first', changes: { checked: true } },
          { op: 'update', id: 'target', changes: { text: 'divergent' } },
        ]),
      ],
      { list: 1 },
    );
  });

  it.each(['target', 'first'])(
    'rejects a reused Todo row or position anchor %s across reload',
    async (id) => {
      const deleted = await patch([todo([{ op: 'delete', id }])], { list: 1 });
      await patch(
        [todo([{ op: 'insert', item: item(id), afterId: id === 'first' ? null : 'first' }])],
        { list: deleted.board.elements[1].version },
      );
      await service.close();
      service = createStudioService({ dataRoot: directory });
      const stale =
        id === 'first'
          ? todo([{ op: 'insert', item: item('new'), afterId: 'first' }])
          : todo([{ op: 'update', id: 'target', changes: { checked: true } }]);
      await expectNoCommit([stale], { list: 1 });
    },
  );

  it('refuses missing lineage even if trusted history still has the old block ID', async () => {
    await patch([document([{ op: 'update', id: 'one', changes: { content: 'saved' } }])], {
      doc: 1,
    });
    await service.store.transaction(artifactId, (state) => {
      delete state.unitClocks!.doc!.children;
    });
    await expectNoCommit([document([{ op: 'update', id: 'two', changes: { content: 'stale' } }])], {
      doc: 1,
    });
  });

  it('allows moves across parents when unrelated content changed and rejects a competing move', async () => {
    await patch([document([{ op: 'update', id: 'two', changes: { content: 'separate' } }])], {
      doc: 1,
    });
    const moved = await patch(
      [document([{ op: 'move', id: 'one', parentId: 'parent', afterId: 'anchor' }])],
      { doc: 1 },
      true,
    );
    expect(
      moved.board.elements[0].document.blocks[0].children.map(({ id }: DocumentBlock) => id),
    ).toEqual(['child', 'anchor', 'one']);
    await expectNoCommit([document([{ op: 'move', id: 'one', afterId: 'two' }])], { doc: 1 });
  });

  it('uses a locally introduced anchor in a later operation of the same stale batch', async () => {
    await patch([document([{ op: 'update', id: 'two', changes: { content: 'separate' } }])], {
      doc: 1,
    });
    const saved = await patch(
      [
        document([{ op: 'insert', block: block('local-anchor'), afterId: 'parent' }]),
        document([{ op: 'insert', block: block('second-local'), afterId: 'local-anchor' }]),
      ],
      { doc: 1 },
      true,
    );
    expect(saved.board.elements[0].document.blocks.map(({ id }: DocumentBlock) => id)).toEqual([
      'one',
      'parent',
      'local-anchor',
      'second-local',
      'two',
    ]);
  });

  it('refuses a pruned original content snapshot despite a surviving child clock', async () => {
    await patch([document([{ op: 'update', id: 'one', changes: { content: 'saved' } }])], {
      doc: 1,
    });
    await service.store.transaction(artifactId, (state) => {
      state.history = state.history.slice(-1);
    });
    await expectNoCommit([document([{ op: 'update', id: 'two', changes: { content: 'stale' } }])], {
      doc: 1,
    });
  });

  it('rejects duplicate insert IDs and explicit policy for unsupported or unversioned operations', async () => {
    await expectNoCommit([document([{ op: 'insert', block: block('one') }])], { doc: 1 });
    await expect(
      patch([{ op: 'update', id: 'doc', changes: { x: 20 } }], { doc: 1 }, true),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(patch([todo([{ op: 'delete', id: 'target' }])], {}, true)).rejects.toMatchObject({
      code: 'VERSION_REQUIRED',
    });
  });
});
