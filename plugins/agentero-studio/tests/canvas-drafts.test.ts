import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, type Board, type BoardElement } from '../src/contracts/studio.js';
import {
  decodeCanvasDraft,
  encodeCanvasDraft,
  promoteCanvasDraft,
} from '../src/app/canvas/canvas-drafts.js';
import type { ContentTask } from '../src/app/canvas/content-queue.js';

const text: BoardElement = {
  id: 'text',
  type: 'text',
  x: 10,
  y: 20,
  w: 300,
  h: 70,
  version: 2,
  text: 'Saved',
};
const table: BoardElement = { ...text, id: 'table', type: 'table', data: { rows: [['value']] } };
const board: Board = {
  artifact: {
    id: 'board',
    type: 'whiteboard',
    title: 'Board',
    revision: 2,
    createdAt: '',
    updatedAt: '',
    pinned: false,
  },
  style: DEFAULT_STYLE,
  elements: [],
};

function task(overrides: Partial<ContentTask> = {}): ContentTask {
  return {
    id: 'cached-save',
    keys: [text.id],
    before: board,
    operations: [{ op: 'update', id: text.id, changes: { text: 'Draft text' } }],
    sources: [text],
    summary: 'Edit',
    remember: true,
    state: 'failed',
    ...overrides,
  };
}

describe('Canvas draft recovery', () => {
  it('quarantines malformed fields while retaining valid properties, table drafts and tasks', () => {
    const tableDraft = { base: table, changes: { data: { rows: [['Unsaved']] } } };
    const propertyDraft = { base: text, changes: { x: 50, bold: true } };
    const raw = JSON.stringify({
      text: { id: text.id, text: 5 },
      properties: { [text.id]: propertyDraft, invalid: { base: text, changes: { x: 100 } } },
      tables: {
        [table.id]: tableDraft,
        malformed: { base: { ...table, id: 'malformed' }, changes: { h: 'large' } },
      },
      tasks: [task(), { id: 'failed-but-incomplete' }],
    });

    expect(decodeCanvasDraft(raw, board.artifact.id)).toMatchObject({
      draft: {
        text: undefined,
        properties: { [text.id]: propertyDraft },
        tables: { [table.id]: tableDraft },
        tasks: [task()],
      },
      unreadableDraft: raw,
      discardEmpty: false,
    });
    const recovery = decodeCanvasDraft(raw, board.artifact.id);
    expect(Object.keys(recovery.draft?.properties ?? {})).toEqual([text.id]);
    expect(Object.keys(recovery.draft?.tables ?? {})).toEqual([table.id]);
  });

  it.each(['{"text": {', '{"version":2,"payload":{"text":"Future draft"}}'])(
    'retains unreadable local text verbatim: %s',
    (raw) => {
      expect(decodeCanvasDraft(raw, board.artifact.id)).toMatchObject({
        draft: null,
        unreadableDraft: raw,
        discardEmpty: false,
      });
    },
  );

  it('keeps supported saved CAS requests byte-for-byte on their prepared operation targets', () => {
    const source = task({
      strictVersions: { [text.id]: text.version, $order: 0 },
      args: {
        artifactId: board.artifact.id,
        operationId: task().id,
        expectedVersions: { [text.id]: 2, $order: 0 },
        operations: [{ op: 'update', id: text.id, changes: { text: 'Rebased draft text' } }],
        summary: 'Edit',
      },
    });
    const legacyUndo = task({
      id: 'legacy-undo',
      keys: ['$board'],
      remember: false,
      sources: [],
      operations: [{ op: 'restore', versionId: 'legacy-history', data: { mode: 'undo' } }],
    });
    const raw = JSON.stringify({ tasks: [source, legacyUndo] });

    expect(decodeCanvasDraft(raw, board.artifact.id)).toMatchObject({
      draft: { tasks: [source] },
      unreadableDraft: undefined,
    });
    expect(
      decodeCanvasDraft(JSON.stringify({ tasks: [legacyUndo] }), board.artifact.id),
    ).toMatchObject({ draft: null, discardEmpty: true });
  });

  it('quarantines a prepared write whose artifact or target no longer matches the retained operation', () => {
    const changedTarget = task({
      args: {
        artifactId: board.artifact.id,
        operationId: task().id,
        operations: [{ op: 'update', id: 'different', changes: { text: 'Draft' } }],
      },
    });
    const changedBoard = task({
      before: { ...board, artifact: { ...board.artifact, id: 'unrelated' } },
    });
    const raw = JSON.stringify({ tasks: [changedTarget, changedBoard] });

    expect(decodeCanvasDraft(raw, board.artifact.id)).toMatchObject({
      draft: null,
      unreadableDraft: raw,
    });
  });

  it('round-trips active edits and unresolved earlier drafts without nesting stored envelopes', () => {
    const previous = { id: text.id, text: 'Earlier draft' };
    const active = { id: text.id, text: 'New edit' };
    const priorRecovery = decodeCanvasDraft(JSON.stringify({ text: previous }), board.artifact.id);
    const persisted = encodeCanvasDraft({ text: active }, priorRecovery)!;
    const resumed = decodeCanvasDraft(persisted, board.artifact.id);
    expect(resumed.draft?.text).toEqual(active);
    expect(resumed.retainedDrafts).toEqual([JSON.stringify(priorRecovery.draft)]);

    const older = promoteCanvasDraft({ ...resumed, draft: null }, board.artifact.id);
    expect(older.draft?.text).toEqual(previous);
    expect(older.retainedDrafts).toEqual([]);
  });

  it('preserves unreadable raw after valid portions have been restored and saved', () => {
    const raw = '{"text":{"id":"text","text":42}}';
    const recovery = decodeCanvasDraft(raw, board.artifact.id);
    const saved = encodeCanvasDraft(null, recovery)!;

    expect(decodeCanvasDraft(saved, board.artifact.id)).toMatchObject({
      draft: null,
      unreadableDraft: raw,
      discardEmpty: false,
    });
  });
});
