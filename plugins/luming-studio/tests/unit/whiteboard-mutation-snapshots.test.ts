import { expect, it, vi } from 'vitest';
import type { DocumentBlock, DocumentBlockOperation } from '../../src/contracts/document.js';
import { LOCAL_ACTOR, type Anchor, type Operation } from '../../src/contracts/studio.js';
import type { TodoOperation } from '../../src/contracts/todo.js';
import {
  initialWhiteboard,
  whiteboardAdapter,
  type SourceSnapshot,
  type WhiteboardContent,
  type WhiteboardState,
} from '../../src/core/products/whiteboard.js';
import { applyMutation, createState } from '../../src/core/shared/history.js';

const block = (content: string): DocumentBlock => ({
  id: 'paragraph',
  type: 'paragraph',
  props: {},
  content,
  children: [],
});

const document = (...operations: DocumentBlockOperation[]): Operation => ({
  op: 'document',
  id: 'outline',
  data: { operations },
});

const todo = (...operations: TodoOperation[]): Operation => ({
  op: 'todo',
  id: 'checklist',
  data: { operations },
});

function fixture(): WhiteboardState {
  const content = initialWhiteboard([
    { id: 'outline', type: 'document', document: { schemaVersion: 1, blocks: [block('First')] } },
    { id: 'checklist', type: 'todo', data: { items: [] } },
    { id: 'page', type: 'html', html: '<h1>First</h1>' },
    { id: 'pin', type: 'shape', locked: true },
  ]);
  const timestamp = '2026-01-01T00:00:00.000Z';

  return createState<WhiteboardContent, Anchor, SourceSnapshot>(
    {
      id: 'board',
      type: 'whiteboard',
      title: 'Board',
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      pinned: false,
    },
    content,
    LOCAL_ACTOR,
    'Create board',
    content.elements.map(({ id }) => id),
  );
}

const element = (content: WhiteboardContent, id: string) =>
  content.elements.find((element) => element.id === id)!;

function editBatch(): Operation[] {
  return [
    document({ op: 'update', id: 'paragraph', changes: { content: 'Revised' } }),
    document({ op: 'delete', id: 'paragraph' }, { op: 'insert', block: block('Revised') }),
    todo({ op: 'insert', item: { id: 'task', text: 'Review', checked: false } }),
    todo({ op: 'update', id: 'task', changes: { checked: true } }),
    { op: 'update', id: 'page', changes: { html: '<h1>Revised</h1>' } },
    { op: 'update', id: 'page', changes: { x: 25 } },
    { op: 'delete', id: 'page' },
    { op: 'add', element: { id: 'page', type: 'html', html: '<h1>Revised</h1>' } },
    { op: 'layout', preset: 'row', ids: ['page'] },
    { op: 'layout', preset: 'front', ids: ['outline'] },
    { op: 'style', style: { accent: '#123456' } },
    { op: 'motion', data: { duration: 200 } },
  ];
}

it('advances per-operation clocks while cloning the whole board only at batch boundaries', () => {
  const state = fixture();
  const args = { operationId: 'mixed-batch', expectedRevision: 1, operations: editBatch() };
  const clone = vi.spyOn(globalThis, 'structuredClone');
  try {
    const result = applyMutation(state, args, LOCAL_ACTOR, whiteboardAdapter);
    const contentCopies = clone.mock.calls.filter(
      ([value]) => typeof value === 'object' && value !== null && 'elements' in value,
    );

    expect(contentCopies).toHaveLength(2);
    expect(state.unitClocks?.outline?.children).toEqual({
      sinceVersion: 1,
      throughVersion: 4,
      inserted: { paragraph: 3 },
    });
    expect(state.unitClocks?.checklist?.children).toEqual({
      sinceVersion: 1,
      throughVersion: 3,
      inserted: { task: 2 },
    });
    expect(state.unitClocks?.page).toMatchObject({
      version: 5,
      incarnationStart: 4,
      sourceRevision: 3,
    });
    expect(element(state.content, 'pin').version).toBe(1);
    expect(state.content.elements.map(({ id }) => id)).toEqual([
      'checklist',
      'pin',
      'page',
      'outline',
    ]);

    element(result.snapshot.content, 'outline').document!.blocks[0]!.content = 'Caller change';
    const replay = applyMutation(state, args, LOCAL_ACTOR, whiteboardAdapter);
    expect(replay.changed).toBe(false);
    expect(replay.snapshot.content).toEqual(state.content);
    expect(element(replay.snapshot.content, 'outline').document!.blocks[0]!.content).toBe(
      'Revised',
    );
    expect(element(state.history[0]!.content, 'outline').document!.blocks[0]!.content).toBe(
      'First',
    );
    expect(state.history).toHaveLength(2);
  } finally {
    clone.mockRestore();
  }
});

it('rolls back earlier writes and keeps the batch lock after an in-batch unlock', () => {
  const state = fixture();
  const before = structuredClone(state);
  const args = {
    operationId: 'rejected-batch',
    expectedRevision: 1,
    operations: [
      document({ op: 'update', id: 'paragraph', changes: { content: 'Discarded' } }),
      { op: 'update', id: 'pin', changes: { locked: false } },
      { op: 'layout', preset: 'row', ids: ['pin'] },
    ] satisfies Operation[],
  };

  expect(() => applyMutation(state, args, LOCAL_ACTOR, whiteboardAdapter)).toThrow(
    expect.objectContaining({ code: 'LOCKED' }),
  );
  expect(state).toEqual(before);
});

it('keeps deep before snapshots for adapters that change an object in place', () => {
  const state = fixture();
  const wrapper: typeof whiteboardAdapter = {
    ...whiteboardAdapter,
    apply(content) {
      element(content, 'page').html = '<h1>Updated by wrapper</h1>';

      return ['page'];
    },
  };
  const operations: Operation[] = [{ op: 'update', id: 'page' }];
  const args = { operationId: 'wrapped-batch', expectedRevision: 1, operations };

  applyMutation(state, args, LOCAL_ACTOR, wrapper);
  expect(element(state.content, 'page')).toMatchObject({ version: 2, sourceRevision: 2 });
  expect(element(state.history[0]!.content, 'page').html).toBe('<h1>First</h1>');
});
