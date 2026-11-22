import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, type Board, type BoardElement } from '../../src/contracts/studio.js';
import {
  decodeCanvasDraft,
  encodeCanvasDraft,
  promoteCanvasDraft,
} from '../../src/app/features/whiteboard/canvas/sync/canvas-drafts.js';
import {
  NativeContentQueue,
  overlayContent,
  type ContentReceipt,
  type ContentTask,
} from '../../src/app/features/whiteboard/canvas/sync/content-queue.js';

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

function diagramBoard(): Board {
  const font = Buffer.concat(
    Array.from({ length: 1752 }, (_, index) => createHash('sha256').update(String(index)).digest()),
  ).toString('base64');

  return {
    ...board,
    elements: Array.from({ length: 87 }, (_, index) => {
      const element = { ...text, id: `element-${index}` };
      if (index >= 71) {
        return element;
      }

      return {
        ...element,
        type: 'html',
        html: `<style>\n@font-face{font-family:fixture;src:url(data:font/woff2;base64,${font})}\n</style>\n<main id="element-${index}">方案 ${index}</main>`,
      };
    }),
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

  it('keeps ordinary JSON when sharing HTML would increase the draft size', () => {
    const unique = { ...text, type: 'html' as const, html: '<p>' + 'x'.repeat(4096) + '</p>' };
    const active = { properties: { [unique.id]: { base: unique, changes: { x: 20 } } } };
    const raw = encodeCanvasDraft(active, { draft: null, error: '', discardEmpty: false });

    expect(raw).toBe(JSON.stringify(active));
  });

  it.each(['move', 'lock'] as const)(
    'keeps a large in-flight %s draft compact and restores full sources and the original request',
    async (kind) => {
      const richBoard = diagramBoard();
      const edits = kind === 'lock' ? { locked: true } : { x: 25, y: 45 };
      const operations = richBoard.elements.map(({ id }) => ({
        op: 'update' as const,
        id,
        changes: edits,
      }));
      let accept!: (receipt: ContentReceipt) => void;
      const receipt = new Promise<ContentReceipt>((resolve) => {
        accept = resolve;
      });
      const send = vi.fn(() => receipt);
      const queue = new NativeContentQueue({ send, changed: () => {}, accepted: () => {} });
      const save = queue.enqueue(richBoard, operations, kind);

      const original = queue.drafts[0]!;
      const properties =
        kind === 'lock'
          ? Object.fromEntries(
              richBoard.elements.map((base) => [base.id, { base, changes: edits }]),
            )
          : {};
      const active = { text: { id: text.id, text: '\0literal' }, properties, tasks: [original] };
      const persisted = encodeCanvasDraft(active, { draft: null, error: '', discardEmpty: false })!;

      expect(original.state).toBe('inflight');
      expect(original.appliedSources).toHaveLength(87);
      expect(JSON.stringify(active).length).toBeGreaterThan(10 * 1024 * 1024);
      expect(persisted.length).toBeLessThan(256 * 1024);

      const recovered = decodeCanvasDraft(persisted, board.artifact.id);
      const restored = recovered.draft?.tasks?.[0];
      const html = (elements: readonly BoardElement[] | undefined) =>
        elements?.map((item) => item.html);

      expect(recovered.unreadableDraft).toBeUndefined();
      expect(recovered.draft?.text?.text).toBe('\0literal');
      expect(html(restored?.sources)).toEqual(html(original.sources));
      expect(html(restored?.appliedSources)).toEqual(html(original.appliedSources));
      expect(
        html(Object.values(recovered.draft?.properties ?? {}).map(({ base }) => base)),
      ).toEqual(html(Object.values(properties).map(({ base }) => base)));

      const changed = { ...richBoard.elements[0]!, html: '<p>另一个人修改的内容</p>', version: 3 };
      const elements = [changed, ...richBoard.elements.slice(1)];
      const sendRetry = vi.fn().mockResolvedValue({ board: { ...richBoard, elements } });
      const reopened = new NativeContentQueue({
        send: vi.fn(),
        confirm: sendRetry,
        changed: () => {},
        accepted: () => {},
      });
      reopened.restore(recovered.draft?.tasks ?? []);

      expect(sendRetry).not.toHaveBeenCalled();
      expect(overlayContent(elements, reopened.drafts)[0]).toMatchObject({ ...changed, ...edits });
      await reopened.retry(original.id);
      expect(sendRetry).toHaveBeenCalledExactlyOnceWith(original.args);
      expect(JSON.stringify(sendRetry.mock.calls[0]![0])).toBe(JSON.stringify(original.args));
      accept({ board: richBoard });
      await save;
    },
  );

  it('retains the original record when its packed HTML reference is malformed', () => {
    const original =
      'studio-canvas-draft:1\n' +
      JSON.stringify({
        html: [[91]],
        lines: ['another source'],
        payload: '{}',
      });

    expect(decodeCanvasDraft(original, board.artifact.id)).toMatchObject({
      draft: null,
      unreadableDraft: original,
    });
  });
});
